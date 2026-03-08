/**
 * ZKVerifierSP1 — Expanded Coverage Tests
 *
 * Targets uncovered paths: settleRollupBatch, verifyRecursiveProof,
 * circuit breaker, setGateway, view functions, error paths.
 * Target: push ZKVerifierSP1 from 55% → >85% line coverage.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKVerifierSP1 — Expanded Coverage', function () {
  let verifier, mockMailbox;
  let admin, operator, user, relayer;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('RollupCircuit'));
  const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('rollup-program-v1'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);

  beforeEach(async function () {
    [admin, operator, user, relayer] = await ethers.getSigners();

    const VerifierFactory = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VerifierFactory.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    const OPERATOR_ROLE = await verifier.OPERATOR_ROLE();
    const CIRCUIT_MANAGER_ROLE = await verifier.CIRCUIT_MANAGER_ROLE();
    const RELAYER_ROLE = await verifier.RELAYER_ROLE();
    await verifier.grantRole(OPERATOR_ROLE, operator.address);
    await verifier.grantRole(CIRCUIT_MANAGER_ROLE, admin.address);
    await verifier.grantRole(RELAYER_ROLE, relayer.address);

    await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'RollupCircuit');
  });

  describe('settleRollupBatch', function () {
    function computeBatchRoot(nullifiers, circuitIds) {
      let root = ethers.keccak256(
        ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]])
      );
      for (let i = 1; i < nullifiers.length; i++) {
        root = ethers.keccak256(
          ethers.solidityPacked(['bytes32', 'bytes32', 'bytes32'], [root, nullifiers[i], circuitIds[i]])
        );
      }
      return root;
    }

    it('should settle a batch of 3 inner proofs', async function () {
      const innerNullifiers = [
        ethers.keccak256(ethers.toUtf8Bytes('inner-1')),
        ethers.keccak256(ethers.toUtf8Bytes('inner-2')),
        ethers.keccak256(ethers.toUtf8Bytes('inner-3')),
      ];
      const innerCircuitIds = [CIRCUIT_ID, CIRCUIT_ID, CIRCUIT_ID];
      const batchRoot = computeBatchRoot(innerNullifiers, innerCircuitIds);
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('rollup-null-1'));

      const tx = await verifier.settleRollupBatch(
        CIRCUIT_ID, batchRoot, innerNullifiers, innerCircuitIds,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
      );
      const receipt = await tx.wait();

      expect(await verifier.usedNullifiers(rollupNullifier)).to.be.true;
      for (const n of innerNullifiers) {
        expect(await verifier.usedNullifiers(n)).to.be.true;
      }

      const stats = await verifier.getRollupStats();
      expect(stats.batchCount).to.equal(1n);
      expect(stats.recursiveVerified).to.be.greaterThanOrEqual(3n);
    });

    it('should retrieve settled batch details', async function () {
      const innerNullifiers = [
        ethers.keccak256(ethers.toUtf8Bytes('batch2-1')),
        ethers.keccak256(ethers.toUtf8Bytes('batch2-2')),
      ];
      const innerCircuitIds = [CIRCUIT_ID, CIRCUIT_ID];
      const batchRoot = computeBatchRoot(innerNullifiers, innerCircuitIds);
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('rollup-null-2'));

      await verifier.settleRollupBatch(
        CIRCUIT_ID, batchRoot, innerNullifiers, innerCircuitIds,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
      );

      const batch = await verifier.getRollupBatch(1);
      expect(batch.batchRoot).to.equal(batchRoot);
      expect(batch.proofCount).to.equal(2n);
      expect(batch.submitter).to.equal(admin.address);
    });

    it('should reject duplicate rollup nullifier', async function () {
      const innerNullifiers = [ethers.keccak256(ethers.toUtf8Bytes('dup-inner-1'))];
      const innerCircuitIds = [CIRCUIT_ID];
      const batchRoot = computeBatchRoot(innerNullifiers, innerCircuitIds);
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-rollup'));

      await verifier.settleRollupBatch(
        CIRCUIT_ID, batchRoot, innerNullifiers, innerCircuitIds,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
      );

      const newInner = [ethers.keccak256(ethers.toUtf8Bytes('dup-inner-2'))];
      const newRoot = computeBatchRoot(newInner, innerCircuitIds);

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, newRoot, newInner, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject mismatched batch root', async function () {
      const innerNullifiers = [ethers.keccak256(ethers.toUtf8Bytes('mismatch-1'))];
      const innerCircuitIds = [CIRCUIT_ID];
      const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes('wrong-root'));
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('mismatch-rollup'));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, wrongRoot, innerNullifiers, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject empty batch', async function () {
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('empty-batch'));
      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, ethers.ZeroHash, [], [],
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject mismatched array lengths', async function () {
      const innerNullifiers = [
        ethers.keccak256(ethers.toUtf8Bytes('len-1')),
        ethers.keccak256(ethers.toUtf8Bytes('len-2')),
      ];
      const innerCircuitIds = [CIRCUIT_ID];
      const batchRoot = ethers.keccak256(ethers.toUtf8Bytes('len-root'));
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('len-rollup'));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, batchRoot, innerNullifiers, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject duplicate inner nullifiers', async function () {
      const dupeNull = ethers.keccak256(ethers.toUtf8Bytes('dupe-inner'));
      await verifier.verifyProof(
        CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, dupeNull
      );

      const innerNullifiers = [dupeNull];
      const innerCircuitIds = [CIRCUIT_ID];
      const batchRoot = computeBatchRoot(innerNullifiers, innerCircuitIds);
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('dupe-rollup'));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, batchRoot, innerNullifiers, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject unregistered circuit', async function () {
      const fakeCircuit = ethers.keccak256(ethers.toUtf8Bytes('FakeCircuit'));
      const innerNullifiers = [ethers.keccak256(ethers.toUtf8Bytes('unreg-1'))];
      const innerCircuitIds = [fakeCircuit];
      const batchRoot = ethers.keccak256(ethers.toUtf8Bytes('unreg-root'));
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('unreg-rollup'));

      await expect(
        verifier.settleRollupBatch(
          fakeCircuit, batchRoot, innerNullifiers, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });
  });

  describe('verifyRecursiveProof', function () {
    it('should verify a top-level recursive proof (no parent)', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('recursive-1'));

      const tx = await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 1
      );
      await tx.wait();

      expect(await verifier.usedNullifiers(nullifier)).to.be.true;

      const recNull = await verifier.getRecursiveNullifier(nullifier);
      expect(recNull.verified).to.be.true;
      expect(recNull.depth).to.equal(1n);
      expect(recNull.parentNullifier).to.equal(ethers.ZeroHash);
    });

    it('should verify a child proof with verified parent', async function () {
      const parentNullifier = ethers.keccak256(ethers.toUtf8Bytes('parent-null'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, parentNullifier, 1
      );

      const childNullifier = ethers.keccak256(ethers.toUtf8Bytes('child-null'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, parentNullifier, MOCK_PUBLIC_VALUES, MOCK_PROOF, childNullifier, 2
      );

      const childRec = await verifier.getRecursiveNullifier(childNullifier);
      expect(childRec.verified).to.be.true;
      expect(childRec.depth).to.equal(2n);
      expect(childRec.parentNullifier).to.equal(parentNullifier);
    });

    it('should reject unverified parent', async function () {
      const fakeParent = ethers.keccak256(ethers.toUtf8Bytes('fake-parent'));
      const childNullifier = ethers.keccak256(ethers.toUtf8Bytes('orphan-child'));

      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, fakeParent, MOCK_PUBLIC_VALUES, MOCK_PROOF, childNullifier, 2
        )
      ).to.be.reverted;
    });

    it('should reject depth 0', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('depth-0'));
      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 0
        )
      ).to.be.reverted;
    });

    it('should reject depth > 8', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('depth-9'));
      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 9
        )
      ).to.be.reverted;
    });

    it('should accept max depth of 8', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('depth-8'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 8
      );
      const recNull = await verifier.getRecursiveNullifier(nullifier);
      expect(recNull.depth).to.equal(8n);
    });

    it('should reject duplicate nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-recursive'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 1
      );

      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 1
        )
      ).to.be.reverted;
    });

    it('should increment totalRecursiveVerified', async function () {
      const statsBefore = await verifier.getRollupStats();

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('count-recursive'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 1
      );

      const statsAfter = await verifier.getRollupStats();
      expect(statsAfter.recursiveVerified).to.equal(statsBefore.recursiveVerified + 1n);
    });
  });

  describe('setGateway', function () {
    it('should update gateway address', async function () {
      const newGateway = '0x9999999999999999999999999999999999999999';
      await verifier.setGateway(newGateway);

      const stats = await verifier.getStats();
      expect(stats.isMock).to.be.false;
    });

    it('should allow setting gateway back to zero (mock mode)', async function () {
      const newGateway = '0x9999999999999999999999999999999999999999';
      await verifier.setGateway(newGateway);
      await verifier.setGateway(ethers.ZeroAddress);

      const stats = await verifier.getStats();
      expect(stats.isMock).to.be.true;
    });

    it('should reject non-admin', async function () {
      await expect(
        verifier.connect(user).setGateway(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe('View Functions (full coverage)', function () {
    it('should return circuit info via getCircuit', async function () {
      const [vkey, label] = await verifier.getCircuit(CIRCUIT_ID);
      expect(vkey).to.equal(PROGRAM_VKEY);
      expect(label).to.equal('RollupCircuit');
    });

    it('should return isNullifierUsed false for fresh nullifier', async function () {
      const n = ethers.keccak256(ethers.toUtf8Bytes('view-test'));
      expect(await verifier.isNullifierUsed(n)).to.be.false;
    });

    it('should return isNullifierUsed true after verification', async function () {
      const n = ethers.keccak256(ethers.toUtf8Bytes('view-used'));
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, n);
      expect(await verifier.isNullifierUsed(n)).to.be.true;
    });

    it('should return getExtendedStats', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('ext-stats'));
      await verifier.verifyProof(CIRCUIT_ID, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier);

      const stats = await verifier.getExtendedStats();
      expect(stats[0]).to.be.greaterThanOrEqual(1n); // totalVerified
    });

    it('should return getRollupStats', async function () {
      const stats = await verifier.getRollupStats();
      expect(stats.batchCount).to.equal(0n);
      expect(stats.recursiveVerified).to.equal(0n);
    });

    it('should return getComposedCall for verified proof', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('cc-view'));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('state'));
      const targetContract = '0x7777777777777777777777777777777777777777';

      await verifier.verifyComposedCall(
        CIRCUIT_ID, stateRoot, 100, targetContract,
        MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier
      );

      const cc = await verifier.getComposedCall(nullifier);
      expect(cc.stateRoot).to.equal(stateRoot);
      expect(cc.targetContract).to.equal(targetContract);
    });
  });

  describe('Mailbox Configuration', function () {
    it('should configure mailbox and domain', async function () {
      const MailboxFactory = await ethers.getContractFactory('MockMailbox');
      mockMailbox = await MailboxFactory.deploy(1337, 0);
      await mockMailbox.waitForDeployment();

      await verifier.setMailbox(await mockMailbox.getAddress());
      const remote = ethers.zeroPadValue(admin.address, 32);
      await verifier.configureDomain(964, remote, true);

      expect(await verifier.supportedDomains(964)).to.be.true;
    });

    it('should reject setMailbox from non-admin', async function () {
      await expect(
        verifier.connect(user).setMailbox(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it('should reject configureDomain from non-admin', async function () {
      const remote = ethers.zeroPadValue(user.address, 32);
      await expect(
        verifier.connect(user).configureDomain(964, remote, true)
      ).to.be.reverted;
    });
  });

  describe('Stake Check Configuration', function () {
    it('should configure stake check parameters', async function () {
      const mockStaking = '0x8888888888888888888888888888888888888888';
      await verifier.setStakeCheck(
        mockStaking, ethers.parseEther('100'), true
      );
    });

    it('should reject setStakeCheck from non-admin', async function () {
      await expect(
        verifier.connect(user).setStakeCheck(
          ethers.ZeroAddress, 0, false
        )
      ).to.be.reverted;
    });
  });

  describe('Pause During Batch Operations', function () {
    it('should reject settleRollupBatch when paused', async function () {
      await verifier.connect(operator).pause();

      const innerNullifiers = [ethers.keccak256(ethers.toUtf8Bytes('pause-inner'))];
      const innerCircuitIds = [CIRCUIT_ID];
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('pause-rollup'));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, ethers.ZeroHash, innerNullifiers, innerCircuitIds,
          MOCK_PUBLIC_VALUES, MOCK_PROOF, rollupNullifier
        )
      ).to.be.reverted;
    });

    it('should reject verifyRecursiveProof when paused', async function () {
      await verifier.connect(operator).pause();

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('pause-recursive'));
      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, ethers.ZeroHash, MOCK_PUBLIC_VALUES, MOCK_PROOF, nullifier, 1
        )
      ).to.be.reverted;
    });
  });
});
