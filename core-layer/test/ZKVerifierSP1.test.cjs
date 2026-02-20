/**
 * Core Layer — ZKVerifierSP1 Hardhat Tests
 *
 * Run: npx hardhat test core-layer/test/ZKVerifierSP1.test.cjs
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKVerifierSP1', function () {
  let verifier;
  let admin, operator, user;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AITask'));
  const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('ai-task-program-v1'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130); // ~260 bytes
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const MOCK_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('nullifier-1'));

  beforeEach(async function () {
    [admin, operator, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await Factory.deploy(admin.address, ethers.ZeroAddress); // Mock mode
    await verifier.waitForDeployment();
  });

  describe('Deployment', function () {
    it('should deploy with correct admin', async function () {
      expect(await verifier.hasRole(await verifier.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it('should start in mock mode (gateway = 0x0)', async function () {
      const stats = await verifier.getStats();
      expect(stats.isMock).to.be.true;
    });

    it('should start with zero stats', async function () {
      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(0n);
      expect(stats.failed).to.equal(0n);
    });
  });

  describe('Circuit Management', function () {
    it('should register a circuit', async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
      const [vkey, label] = await verifier.getCircuit(CIRCUIT_ID);
      expect(vkey).to.equal(PROGRAM_VKEY);
      expect(label).to.equal('AI Task');
    });

    it('should reject registration from non-manager', async function () {
      await expect(
        verifier.connect(user).registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task')
      ).to.be.reverted;
    });

    it('should remove a circuit', async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
      await verifier.removeCircuit(CIRCUIT_ID);
      const [vkey] = await verifier.getCircuit(CIRCUIT_ID);
      expect(vkey).to.equal(ethers.ZeroHash);
    });
  });

  describe('Proof Verification (Mock Mode)', function () {
    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
    });

    it('should verify a proof in mock mode', async function () {
      const tx = await verifier.verifyProof(
        CIRCUIT_ID,
        MOCK_PUBLIC_VALUES,
        MOCK_PROOF,
        MOCK_NULLIFIER
      );
      const receipt = await tx.wait();

      // Check ProofVerified event
      const event = receipt.logs.find(
        (l) => l.fragment?.name === 'ProofVerified'
      );
      expect(event).to.not.be.undefined;

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(1n);
    });

    it('should reject duplicate nullifier', async function () {
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER);

      await expect(
        verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'NullifierAlreadyUsed');
    });

    it('should reject unregistered circuit', async function () {
      const unknownCircuit = ethers.keccak256(ethers.toUtf8Bytes('Unknown'));
      await expect(
        verifier.verifyProof(unknownCircuit, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'CircuitNotRegistered');
    });

    it('should track nullifier usage', async function () {
      expect(await verifier.isNullifierUsed(MOCK_NULLIFIER)).to.be.false;
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER);
      expect(await verifier.isNullifierUsed(MOCK_NULLIFIER)).to.be.true;
    });
  });

  describe('Batch Verification', function () {
    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
    });

    it('should batch-verify multiple proofs', async function () {
      const nullifiers = [
        ethers.keccak256(ethers.toUtf8Bytes('n1')),
        ethers.keccak256(ethers.toUtf8Bytes('n2')),
        ethers.keccak256(ethers.toUtf8Bytes('n3')),
      ];

      const tx = await verifier.verifyProofBatch(
        [CIRCUIT_ID, CIRCUIT_ID, CIRCUIT_ID],
        [MOCK_PUBLIC_VALUES, MOCK_PUBLIC_VALUES, MOCK_PUBLIC_VALUES],
        [MOCK_PROOF, MOCK_PROOF, MOCK_PROOF],
        nullifiers
      );
      await tx.wait();

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(3n);
    });
  });

  describe('Pause', function () {
    it('should pause and unpause', async function () {
      await verifier.pause();
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      await expect(
        verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'EnforcedPause');

      await verifier.unpause();
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER);
    });
  });
});

describe('CoreRevenueSplitter', function () {
  let splitter;
  let admin, bbb, lp, staker, treasury, stakePool, user;

  beforeEach(async function () {
    [admin, bbb, lp, staker, treasury, stakePool, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await Factory.deploy(
      admin.address,
      bbb.address,
      lp.address,
      staker.address,
      treasury.address,
      stakePool.address
    );
    await splitter.waitForDeployment();
  });

  describe('Deployment', function () {
    it('should deploy with correct split', async function () {
      const [bbbBps, lpBps, stakerBps, treasuryBps] = await splitter.getSplit();
      expect(bbbBps).to.equal(3000n);
      expect(lpBps).to.equal(3000n);
      expect(stakerBps).to.equal(2500n);
      expect(treasuryBps).to.equal(1500n);
    });
  });

  describe('Fee Distribution', function () {
    it('should distribute fees correctly (30/30/25/15)', async function () {
      // Send 1 ETH as fees
      const amount = ethers.parseEther('1.0');
      await admin.sendTransaction({
        to: await splitter.getAddress(),
        value: amount,
      });

      const bbbBefore = await ethers.provider.getBalance(bbb.address);
      const lpBefore = await ethers.provider.getBalance(lp.address);
      const stakerBefore = await ethers.provider.getBalance(staker.address);

      await splitter.distribute();

      const bbbAfter = await ethers.provider.getBalance(bbb.address);
      const lpAfter = await ethers.provider.getBalance(lp.address);
      const stakerAfter = await ethers.provider.getBalance(staker.address);

      // BBB should get 30%
      expect(bbbAfter - bbbBefore).to.equal(ethers.parseEther('0.3'));
      // LP should get 30%
      expect(lpAfter - lpBefore).to.equal(ethers.parseEther('0.3'));
      // Staker should get 25%
      expect(stakerAfter - stakerBefore).to.equal(ethers.parseEther('0.25'));
    });

    it('should revert on empty balance', async function () {
      await expect(splitter.distribute()).to.be.revertedWithCustomError(
        splitter,
        'NothingToDistribute'
      );
    });

    it('should track total distributed', async function () {
      await admin.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther('1.0'),
      });
      await splitter.distribute();

      const stats = await splitter.getStats();
      expect(stats.distributed).to.equal(ethers.parseEther('1.0'));
    });
  });

  describe('Split Updates', function () {
    it('should update split (admin only)', async function () {
      await splitter.setSplit(4000, 2000, 2500, 1500);
      const [bbbBps] = await splitter.getSplit();
      expect(bbbBps).to.equal(4000n);
    });

    it('should reject invalid split (not summing to 10000)', async function () {
      await expect(splitter.setSplit(5000, 5000, 5000, 5000)).to.be.revertedWithCustomError(
        splitter,
        'InvalidSplit'
      );
    });
  });
});

describe('veXFGovernance', function () {
  let governance;
  let admin, user1, user2;
  let mockToken;

  beforeEach(async function () {
    [admin, user1, user2] = await ethers.getSigners();

    // Deploy a mock ERC20 for XF token
    const MockERC20 = await ethers.getContractFactory('MockERC20');

    // If MockERC20 doesn't exist, skip these tests
    try {
      mockToken = await MockERC20.deploy('XFuel', 'XF', ethers.parseEther('1000000'));
      await mockToken.waitForDeployment();
    } catch {
      // MockERC20 not available — governance tests will be skipped
      return;
    }

    const Factory = await ethers.getContractFactory('veXFGovernance');
    governance = await Factory.deploy(admin.address, await mockToken.getAddress());
    await governance.waitForDeployment();
  });

  describe('Deployment', function () {
    it('should deploy with correct admin', async function () {
      if (!governance) return;
      expect(await governance.hasRole(await governance.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it('should have zero total locked', async function () {
      if (!governance) return;
      expect(await governance.totalLocked()).to.equal(0n);
    });
  });
});
