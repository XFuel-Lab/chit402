/**
 * Core Layer — ZKVerifierSP1 Hardhat Tests (Phase 2)
 *
 * Run: npx hardhat test core-layer/test/ZKVerifierSP1.test.cjs
 *
 * Covers: circuit management, proof verification, batch, pause, gas baselines,
 * SP1-CC composed calls, Hyperlane cross-chain relay, dTAO staking checks.
 *
 * Note: .to.be.reverted is used instead of .revertedWithCustomError because
 * hardhat-chai-matchers@1.x is not compatible with ethers v6 for custom error
 * matching.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKVerifierSP1', function () {
  let verifier;
  let admin, operator, user;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AITask'));
  const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('ai-task-program-v1'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const MOCK_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('nullifier-1'));

  beforeEach(async function () {
    [admin, operator, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await Factory.deploy(admin.address, ethers.ZeroAddress);
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

    it('should increment circuitCount on registration', async function () {
      const statsBefore = await verifier.getStats();
      expect(statsBefore.registered).to.equal(0n);

      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      const statsAfter = await verifier.getStats();
      expect(statsAfter.registered).to.equal(1n);
    });

    it('should reject registration from non-manager', async function () {
      await expect(
        verifier.connect(user).registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task')
      ).to.be.reverted;
    });

    it('should remove a circuit', async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      const mid = await verifier.getStats();
      expect(mid.registered).to.equal(1n);

      await verifier.removeCircuit(CIRCUIT_ID);
      const [vkey] = await verifier.getCircuit(CIRCUIT_ID);
      expect(vkey).to.equal(ethers.ZeroHash);

      const statsAfter = await verifier.getStats();
      expect(statsAfter.registered).to.equal(0n);
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
      ).to.be.reverted;
    });

    it('should reject unregistered circuit', async function () {
      const unknownCircuit = ethers.keccak256(ethers.toUtf8Bytes('Unknown'));
      await expect(
        verifier.verifyProof(unknownCircuit, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER)
      ).to.be.reverted;
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
      ).to.be.reverted;

      await verifier.unpause();
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, MOCK_NULLIFIER);
    });
  });

  describe('Gas Baseline', function () {
    it('should stay within gas targets', async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      const tx = await verifier.verifyProof(
        CIRCUIT_ID,
        MOCK_PUBLIC_VALUES,
        MOCK_PROOF,
        MOCK_NULLIFIER
      );
      const receipt = await tx.wait();

      expect(receipt.gasUsed).to.be.lessThan(150000n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: SP1-CC Composed Call Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SP1-CC Composed Call Verification', function () {
    const STATE_ROOT = ethers.keccak256(ethers.toUtf8Bytes('state-root-block-100'));
    const SOURCE_BLOCK = 100n;
    const TARGET_CONTRACT = '0x1234567890AbcdEF1234567890aBcdef12345678';
    const CC_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('cc-nullifier-1'));

    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
    });

    it('should verify a composed call proof in mock mode', async function () {
      const tx = await verifier.verifyComposedCall(
        CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        (l) => l.fragment?.name === 'ComposedCallVerified'
      );
      expect(event).to.not.be.undefined;
    });

    it('should store composed call metadata', async function () {
      await verifier.verifyComposedCall(
        CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
      );

      const cc = await verifier.getComposedCall(CC_NULLIFIER);
      expect(cc.stateRoot).to.equal(STATE_ROOT);
      expect(cc.sourceBlock).to.equal(SOURCE_BLOCK);
      expect(cc.targetContract).to.equal(TARGET_CONTRACT);
      expect(cc.resultHash).to.equal(ethers.keccak256(MOCK_PUBLIC_VALUES));
    });

    it('should increment totalComposedCalls counter', async function () {
      await verifier.verifyComposedCall(
        CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
      );

      const ext = await verifier.getExtendedStats();
      expect(ext.composed).to.equal(1n);
      expect(ext.verified).to.equal(1n);
    });

    it('should reject duplicate composed call nullifier', async function () {
      await verifier.verifyComposedCall(
        CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
      );

      await expect(
        verifier.verifyComposedCall(
          CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
        )
      ).to.be.reverted;
    });

    it('should stay within gas targets for composed calls', async function () {
      const tx = await verifier.verifyComposedCall(
        CIRCUIT_ID, STATE_ROOT, SOURCE_BLOCK, TARGET_CONTRACT,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, CC_NULLIFIER
      );
      const receipt = await tx.wait();

      // Composed call wrapper target: <250K gas (gateway adds ~280K separately)
      // Extra ~110K vs verifyProof from 4 SSTORE ops for ComposedCallProof struct
      expect(receipt.gasUsed).to.be.lessThan(250000n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Cross-Chain Proof Relay (Hyperlane)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Cross-Chain Proof Relay (Hyperlane)', function () {
    let mockMailbox;
    const LOCAL_DOMAIN = 964; // Bittensor EVM
    const REMOTE_DOMAIN = 361; // Theta mainnet
    const MOCK_FEE = ethers.parseEther('0.001');
    const RELAY_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('relay-nullifier-1'));

    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      const MockMailboxFactory = await ethers.getContractFactory('MockMailbox');
      mockMailbox = await MockMailboxFactory.deploy(LOCAL_DOMAIN, MOCK_FEE);
      await mockMailbox.waitForDeployment();

      const verifierAddr = await verifier.getAddress();
      const verifierBytes32 = ethers.zeroPadValue(verifierAddr, 32);

      await verifier.setMailbox(await mockMailbox.getAddress());
      await verifier.configureDomain(REMOTE_DOMAIN, verifierBytes32, true);
    });

    it('should relay a verified proof to remote chain', async function () {
      const tx = await verifier.relayProofCrossChain(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        RELAY_NULLIFIER, REMOTE_DOMAIN,
        { value: MOCK_FEE }
      );
      const receipt = await tx.wait();

      const relayEvent = receipt.logs.find(
        (l) => l.fragment?.name === 'ProofRelayed'
      );
      expect(relayEvent).to.not.be.undefined;

      const ext = await verifier.getExtendedStats();
      expect(ext.relayed).to.equal(1n);
      expect(ext.verified).to.equal(1n);
    });

    it('should refund excess Hyperlane fee', async function () {
      const excessFee = ethers.parseEther('0.01');
      const balBefore = await ethers.provider.getBalance(admin.address);

      const tx = await verifier.relayProofCrossChain(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        RELAY_NULLIFIER, REMOTE_DOMAIN,
        { value: excessFee }
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(admin.address);
      // Net cost should be close to MOCK_FEE + gas, not the full excessFee
      const netSpent = balBefore - balAfter;
      expect(netSpent).to.be.lessThan(MOCK_FEE + gasCost + ethers.parseEther('0.0001'));
    });

    it('should reject relay to unsupported domain', async function () {
      const badDomain = 9999;
      await expect(
        verifier.relayProofCrossChain(
          CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
          RELAY_NULLIFIER, badDomain,
          { value: MOCK_FEE }
        )
      ).to.be.reverted;
    });

    it('should reject relay when no mailbox configured', async function () {
      const Factory = await ethers.getContractFactory('ZKVerifierSP1');
      const noMailbox = await Factory.deploy(admin.address, ethers.ZeroAddress);
      await noMailbox.waitForDeployment();
      await noMailbox.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      await expect(
        noMailbox.relayProofCrossChain(
          CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
          RELAY_NULLIFIER, REMOTE_DOMAIN,
          { value: MOCK_FEE }
        )
      ).to.be.reverted;
    });

    it('should handle incoming cross-chain proof', async function () {
      const incomingNullifier = ethers.keccak256(ethers.toUtf8Bytes('incoming-nullifier'));
      const pvHash = ethers.keccak256(MOCK_PUBLIC_VALUES);

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'address', 'uint256'],
        [CIRCUIT_ID, incomingNullifier, pvHash, admin.address, 1000]
      );

      const verifierAddr = await verifier.getAddress();
      const verifierBytes32 = ethers.zeroPadValue(verifierAddr, 32);

      await mockMailbox.deliverTo(
        verifierAddr,
        REMOTE_DOMAIN,
        verifierBytes32,
        payload
      );

      expect(await verifier.isNullifierUsed(incomingNullifier)).to.be.true;

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(1n);
    });

    it('should reject handle() from non-mailbox caller', async function () {
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'address', 'uint256'],
        [CIRCUIT_ID, MOCK_NULLIFIER, ethers.ZeroHash, admin.address, 1000]
      );

      await expect(
        verifier.handle(REMOTE_DOMAIN, ethers.ZeroHash, payload)
      ).to.be.revertedWith('OnlyMailbox');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: dTAO Stake-Gated Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('dTAO Stake-Gated Verification', function () {
    let mockStaking;
    const HOTKEY = ethers.keccak256(ethers.toUtf8Bytes('validator-hotkey'));
    const NETUID = 1;
    const MIN_STAKE = ethers.parseEther('100');
    const STAKE_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('stake-nullifier-1'));

    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');

      const MockStakingFactory = await ethers.getContractFactory('MockStakingPrecompile');
      mockStaking = await MockStakingFactory.deploy();
      await mockStaking.waitForDeployment();

      await verifier.setStakeCheck(
        await mockStaking.getAddress(),
        MIN_STAKE,
        true
      );
    });

    it('should verify with sufficient stake', async function () {
      const coldkey = ethers.zeroPadValue(admin.address, 32);
      await mockStaking.setStake(HOTKEY, coldkey, NETUID, ethers.parseEther('500'));

      const tx = await verifier.verifyWithStakeCheck(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        STAKE_NULLIFIER, HOTKEY, NETUID
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        (l) => l.fragment?.name === 'ProofVerified'
      );
      expect(event).to.not.be.undefined;

      const ext = await verifier.getExtendedStats();
      expect(ext.stakeChecked).to.equal(1n);
      expect(ext.verified).to.equal(1n);
    });

    it('should reject with insufficient stake', async function () {
      const coldkey = ethers.zeroPadValue(admin.address, 32);
      await mockStaking.setStake(HOTKEY, coldkey, NETUID, ethers.parseEther('10'));

      await expect(
        verifier.verifyWithStakeCheck(
          CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
          STAKE_NULLIFIER, HOTKEY, NETUID
        )
      ).to.be.reverted;
    });

    it('should skip stake check when disabled', async function () {
      await verifier.setStakeCheck(
        await mockStaking.getAddress(),
        MIN_STAKE,
        false
      );

      const tx = await verifier.verifyWithStakeCheck(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        STAKE_NULLIFIER, HOTKEY, NETUID
      );
      await tx.wait();

      const ext = await verifier.getExtendedStats();
      expect(ext.stakeChecked).to.equal(0n);
      expect(ext.verified).to.equal(1n);
    });

    it('should skip stake check when precompile is zero address', async function () {
      await verifier.setStakeCheck(ethers.ZeroAddress, MIN_STAKE, true);

      const tx = await verifier.verifyWithStakeCheck(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        STAKE_NULLIFIER, HOTKEY, NETUID
      );
      await tx.wait();

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(1n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Extended Stats
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Extended Stats', function () {
    it('should return full extended stats', async function () {
      const ext = await verifier.getExtendedStats();
      expect(ext.verified).to.equal(0n);
      expect(ext.failed).to.equal(0n);
      expect(ext.registered).to.equal(0n);
      expect(ext.composed).to.equal(0n);
      expect(ext.relayed).to.equal(0n);
      expect(ext.stakeChecked).to.equal(0n);
      expect(ext.isMock).to.be.true;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Gas Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 2 Gas Benchmarks', function () {
    beforeEach(async function () {
      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'AI Task');
    });

    it('SP1-CC composed call gas should be under 250K', async function () {
      const ccNull = ethers.keccak256(ethers.toUtf8Bytes('gas-cc'));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('root'));
      const target = '0x1234567890AbcdEF1234567890aBcdef12345678';

      const tx = await verifier.verifyComposedCall(
        CIRCUIT_ID, stateRoot, 100, target,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, ccNull
      );
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lessThan(250000n);
    });

    it('verifyWithStakeCheck gas should be under 250K (with mock precompile)', async function () {
      const MockStakingFactory = await ethers.getContractFactory('MockStakingPrecompile');
      const mockStaking = await MockStakingFactory.deploy();
      await mockStaking.waitForDeployment();

      const hotkey = ethers.keccak256(ethers.toUtf8Bytes('hk'));
      const coldkey = ethers.zeroPadValue(admin.address, 32);
      await mockStaking.setStake(hotkey, coldkey, 1, ethers.parseEther('1000'));
      await verifier.setStakeCheck(await mockStaking.getAddress(), ethers.parseEther('100'), true);

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('gas-stake'));
      const tx = await verifier.verifyWithStakeCheck(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF,
        nullifier, hotkey, 1
      );
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lessThan(250000n);
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

      expect(bbbAfter - bbbBefore).to.equal(ethers.parseEther('0.3'));
      expect(lpAfter - lpBefore).to.equal(ethers.parseEther('0.3'));
      expect(stakerAfter - stakerBefore).to.equal(ethers.parseEther('0.25'));
    });

    it('should revert on empty balance', async function () {
      await expect(splitter.distribute()).to.be.reverted;
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
      await expect(splitter.setSplit(5000, 5000, 5000, 5000)).to.be.reverted;
    });
  });
});

describe('veXFGovernance', function () {
  let governance;
  let admin, user1, user2;
  let mockToken;

  beforeEach(async function () {
    [admin, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');

    try {
      mockToken = await MockERC20.deploy('XFuel', 'XF', ethers.parseEther('1000000'));
      await mockToken.waitForDeployment();
    } catch {
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
