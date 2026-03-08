/**
 * Phase 4 — ZK Rollup & SP1 Recursive Proof Tests (18 tests)
 *
 * Tests SP1 recursion for batch proofs, rollup settlement, recursive
 * nullifier tracking, and amortized gas verification.
 *
 * Run: npx hardhat test test/phase4/ZKRollup.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('ZK Rollup & SP1 Recursion (Phase 4)', function () {
  let verifier;
  let admin, prover, relayer;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('RollupCircuit'));
  const VKEY = ethers.keccak256(ethers.toUtf8Bytes('rollup-vkey'));

  beforeEach(async function () {
    [admin, prover, relayer] = await ethers.getSigners();

    const F = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await F.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    await verifier.registerCircuit(CIRCUIT_ID, VKEY, 'RollupCircuit');
  });

  describe('settleRollupBatch', function () {
    it('should settle a batch of 5 proofs via recursive verification', async function () {
      const nullifiers = [];
      const circuitIds = [];
      for (let i = 0; i < 5; i++) {
        nullifiers.push(ethers.keccak256(ethers.toUtf8Bytes(`inner-null-${i}`)));
        circuitIds.push(CIRCUIT_ID);
      }

      let root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]]));
      for (let i = 1; i < nullifiers.length; i++) {
        root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32', 'bytes32'], [root, nullifiers[i], circuitIds[i]]));
      }

      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('rollup-null-1'));
      const publicValues = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [root, 5]);
      const proofBytes = '0x' + 'ab'.repeat(130);

      const tx = await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        publicValues, proofBytes, rollupNullifier
      );
      const receipt = await tx.wait();

      expect(await verifier.totalRollupBatches()).to.equal(1n);
      expect(await verifier.totalRecursiveVerified()).to.equal(5n);

      for (const n of nullifiers) {
        expect(await verifier.isNullifierUsed(n)).to.be.true;
      }
      expect(await verifier.isNullifierUsed(rollupNullifier)).to.be.true;
    });

    it('should emit RollupSettled event with correct batch details', async function () {
      const nullifiers = [ethers.keccak256(ethers.toUtf8Bytes('rs-null-0'))];
      const circuitIds = [CIRCUIT_ID];
      const root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]]));
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('rs-rollup-1'));

      const tx = await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        '0xabcd', '0x' + 'ff'.repeat(130), rollupNullifier
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return verifier.interface.parseLog(l)?.name === 'RollupSettled'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = verifier.interface.parseLog(event);
      expect(parsed.args.batchId).to.equal(1n);
      expect(parsed.args.proofCount).to.equal(1n);
    });

    it('should reject batch with duplicate inner nullifiers', async function () {
      const dup = ethers.keccak256(ethers.toUtf8Bytes('dup-null'));
      const nullifiers = [dup];
      const circuitIds = [CIRCUIT_ID];
      const root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [dup, CIRCUIT_ID]));

      await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        '0xab', '0x' + 'ff'.repeat(130),
        ethers.keccak256(ethers.toUtf8Bytes('rollup-a'))
      );

      const nullifiers2 = [dup];
      const root2 = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [dup, CIRCUIT_ID]));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, root2, nullifiers2, circuitIds,
          '0xab', '0x' + 'ff'.repeat(130),
          ethers.keccak256(ethers.toUtf8Bytes('rollup-b'))
        )
      ).to.be.reverted;
    });

    it('should reject batch with mismatched root', async function () {
      const nullifiers = [ethers.keccak256(ethers.toUtf8Bytes('mismatch-null'))];
      const circuitIds = [CIRCUIT_ID];
      const fakeRoot = ethers.keccak256(ethers.toUtf8Bytes('fake-root'));
      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('rollup-mismatch'));

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, fakeRoot, nullifiers, circuitIds,
          '0xab', '0x' + 'ff'.repeat(130), rollupNullifier
        )
      ).to.be.revertedWith('BatchRootMismatch');
    });

    it('should reject batch exceeding 100 proofs', async function () {
      const nullifiers = [];
      const circuitIds = [];
      for (let i = 0; i < 101; i++) {
        nullifiers.push(ethers.keccak256(ethers.toUtf8Bytes(`big-${i}`)));
        circuitIds.push(CIRCUIT_ID);
      }

      await expect(
        verifier.settleRollupBatch(
          CIRCUIT_ID, ethers.ZeroHash, nullifiers, circuitIds,
          '0xab', '0x' + 'ff'.repeat(130),
          ethers.keccak256(ethers.toUtf8Bytes('big-rollup'))
        )
      ).to.be.revertedWith('InvalidBatchSize');
    });

    it('should reject batch for unregistered circuit', async function () {
      const fakeCircuit = ethers.keccak256(ethers.toUtf8Bytes('FakeCircuit'));
      const nullifiers = [ethers.keccak256(ethers.toUtf8Bytes('unreg-null'))];

      await expect(
        verifier.settleRollupBatch(
          fakeCircuit, ethers.ZeroHash, nullifiers, [fakeCircuit],
          '0xab', '0x' + 'ff'.repeat(130),
          ethers.keccak256(ethers.toUtf8Bytes('unreg-rollup'))
        )
      ).to.be.reverted;
    });

    it('should amortize gas across batch of 10 proofs (mock mode)', async function () {
      const nullifiers = [];
      const circuitIds = [];
      for (let i = 0; i < 10; i++) {
        nullifiers.push(ethers.keccak256(ethers.toUtf8Bytes(`gas-null-${i}`)));
        circuitIds.push(CIRCUIT_ID);
      }

      let root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]]));
      for (let i = 1; i < 10; i++) {
        root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32', 'bytes32'], [root, nullifiers[i], circuitIds[i]]));
      }

      const rollupNullifier = ethers.keccak256(ethers.toUtf8Bytes('gas-rollup'));
      const tx = await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        '0xab', '0x' + 'ff'.repeat(130), rollupNullifier
      );
      const receipt = await tx.wait();

      const amortized = Number(receipt.gasUsed) / 10;
      console.log(`    Batch(10) total gas: ${receipt.gasUsed}, amortized: ${Math.round(amortized)}`);
      // Mock mode: ~190K amortized (nullifier SSTORE per inner proof ~20K each).
      // Production with gateway: single recursive Groth16 (~270K) + nullifier writes
      // = ~470K/10 = ~47K per proof amortized (under 100K target).
      expect(amortized).to.be.lt(250000);

      // Compare to 10 individual verifyProof calls (which would be ~300K each = 3M total)
      expect(Number(receipt.gasUsed)).to.be.lt(3000000);
    });
  });

  describe('verifyRecursiveProof', function () {
    it('should verify a depth-1 recursive proof', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('recursive-1'));
      const tx = await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, '0xab', '0x' + 'ff'.repeat(130), nullifier, 1
      );
      const receipt = await tx.wait();

      expect(await verifier.isNullifierUsed(nullifier)).to.be.true;
      expect(await verifier.totalRecursiveVerified()).to.equal(1n);
    });

    it('should verify a depth-2 recursive proof with parent', async function () {
      const parent = ethers.keccak256(ethers.toUtf8Bytes('parent-null'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, '0xab', '0x' + 'ff'.repeat(130), parent, 1
      );

      const child = ethers.keccak256(ethers.toUtf8Bytes('child-null'));
      await verifier.verifyRecursiveProof(
        CIRCUIT_ID, parent, '0xab', '0x' + 'ff'.repeat(130), child, 2
      );

      const rec = await verifier.getRecursiveNullifier(child);
      expect(rec.parentNullifier).to.equal(parent);
      expect(rec.depth).to.equal(2n);
      expect(rec.verified).to.be.true;
    });

    it('should reject depth > 8', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('deep-null'));
      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, ethers.ZeroHash, '0xab', '0x' + 'ff'.repeat(130), nullifier, 9
        )
      ).to.be.revertedWith('InvalidDepth');
    });

    it('should reject unverified parent', async function () {
      const fakeParent = ethers.keccak256(ethers.toUtf8Bytes('fake-parent'));
      const child = ethers.keccak256(ethers.toUtf8Bytes('orphan-child'));

      await expect(
        verifier.verifyRecursiveProof(
          CIRCUIT_ID, fakeParent, '0xab', '0x' + 'ff'.repeat(130), child, 2
        )
      ).to.be.revertedWith('ParentNotVerified');
    });

    it('should emit RecursiveProofVerified event', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('event-null'));
      const tx = await verifier.verifyRecursiveProof(
        CIRCUIT_ID, ethers.ZeroHash, '0xab', '0x' + 'ff'.repeat(130), nullifier, 1
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return verifier.interface.parseLog(l)?.name === 'RecursiveProofVerified'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });
  });

  describe('getRollupStats', function () {
    it('should return correct rollup statistics', async function () {
      const [rv, bc, bs] = await verifier.getRollupStats();
      expect(rv).to.equal(0n);
      expect(bc).to.equal(0n);
    });

    it('should update after batch settlement', async function () {
      const nullifiers = [ethers.keccak256(ethers.toUtf8Bytes('stat-null'))];
      const circuitIds = [CIRCUIT_ID];
      const root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]]));

      await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        '0xab', '0x' + 'ff'.repeat(130),
        ethers.keccak256(ethers.toUtf8Bytes('stat-rollup'))
      );

      const [rv, bc] = await verifier.getRollupStats();
      expect(rv).to.equal(1n);
      expect(bc).to.equal(1n);
    });
  });

  describe('getRollupBatch', function () {
    it('should return batch details after settlement', async function () {
      const nullifiers = [ethers.keccak256(ethers.toUtf8Bytes('detail-null'))];
      const circuitIds = [CIRCUIT_ID];
      const root = ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [nullifiers[0], circuitIds[0]]));

      await verifier.settleRollupBatch(
        CIRCUIT_ID, root, nullifiers, circuitIds,
        '0xab', '0x' + 'ff'.repeat(130),
        ethers.keccak256(ethers.toUtf8Bytes('detail-rollup'))
      );

      const [batchRoot, proofCount, amortizedGas, settledAt, submitter] = await verifier.getRollupBatch(1);
      expect(batchRoot).to.equal(root);
      expect(proofCount).to.equal(1n);
      expect(settledAt).to.be.gt(0n);
      expect(submitter).to.equal(admin.address);
    });
  });
});
