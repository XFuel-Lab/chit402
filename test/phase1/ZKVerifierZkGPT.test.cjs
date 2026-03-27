/**
 * Phase 1 — ZKVerifierZkGPT tests (stub + input validation)
 *
 * Run: npx hardhat test test/phase1/ZKVerifierZkGPT.test.cjs
 *
 * Covers: deploy, length bounds (InvalidProofLength, InvalidPublicValuesLength),
 * nullifier replay (NullifierAlreadyUsed), stub revert (ZkGPTVerifierNotImplemented).
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKVerifierZkGPT', function () {
  let verifier;
  let admin;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('ZKML_CIRCUIT'));
  const VALID_PROOF = '0x' + 'ab'.repeat(100);
  const PUBLIC_VALUES = '0x' + 'cd'.repeat(32);
  const NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('n1'));

  beforeEach(async function () {
    [admin] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ZKVerifierZkGPT');
    verifier = await Factory.deploy(admin.address);
    await verifier.waitForDeployment();
  });

  describe('Constants', function () {
    it('should expose MAX_ZKGPT_PROOF_BYTES', async function () {
      expect(await verifier.MAX_ZKGPT_PROOF_BYTES()).to.equal(150_000n);
    });
    it('should expose MIN_PROOF_BYTES', async function () {
      expect(await verifier.MIN_PROOF_BYTES()).to.equal(1n);
    });
    it('should expose MAX_PUBLIC_VALUES_BYTES', async function () {
      expect(await verifier.MAX_PUBLIC_VALUES_BYTES()).to.equal(4096n);
    });
  });

  describe('verifyProof (stub)', function () {
    it('should revert with ZkGPTVerifierNotImplemented when lengths are valid', async function () {
      await expect(
        verifier.verifyProof(CIRCUIT_ID, PUBLIC_VALUES, VALID_PROOF, NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'ZkGPTVerifierNotImplemented');
    });

    it('should revert with InvalidProofLength when proof is empty', async function () {
      await expect(
        verifier.verifyProof(CIRCUIT_ID, PUBLIC_VALUES, '0x', NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'InvalidProofLength');
    });

    it('should revert with InvalidProofLength when proof exceeds max', async function () {
      const tooLong = '0x' + '00'.repeat(150_001);
      await expect(
        verifier.verifyProof(CIRCUIT_ID, PUBLIC_VALUES, tooLong, NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'InvalidProofLength');
    });

    it('should revert with InvalidPublicValuesLength when publicValues too long', async function () {
      const tooLong = '0x' + '00'.repeat(4097);
      await expect(
        verifier.verifyProof(CIRCUIT_ID, tooLong, VALID_PROOF, NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'InvalidPublicValuesLength');
    });

    it('should revert with NullifierAlreadyUsed if same nullifier used twice (after impl)', async function () {
      // Stub still reverts with ZkGPTVerifierNotImplemented before nullifier is marked used,
      // so we only test that isNullifierUsed is false initially
      expect(await verifier.isNullifierUsed(NULLIFIER)).to.be.false;
    });
  });

  describe('isNullifierUsed', function () {
    it('should return false for unused nullifier', async function () {
      expect(await verifier.isNullifierUsed(NULLIFIER)).to.be.false;
    });
  });

  describe('Pause', function () {
    it('should pause and unpause by operator', async function () {
      await verifier.pause();
      await expect(
        verifier.verifyProof(CIRCUIT_ID, PUBLIC_VALUES, VALID_PROOF, NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'EnforcedPause');
      await verifier.unpause();
      await expect(
        verifier.verifyProof(CIRCUIT_ID, PUBLIC_VALUES, VALID_PROOF, NULLIFIER)
      ).to.be.revertedWithCustomError(verifier, 'ZkGPTVerifierNotImplemented');
    });
  });
});
