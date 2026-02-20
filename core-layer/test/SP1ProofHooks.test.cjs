/**
 * Core Layer — SP1ProofHooks Library Tests
 *
 * Run: npx hardhat test core-layer/test/SP1ProofHooks.test.cjs
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('SP1ProofHooks (via harness)', function () {
  let harness;

  before(async function () {
    // Deploy a thin wrapper that exposes the library functions
    const Factory = await ethers.getContractFactory('SP1ProofHooksHarness');
    harness = await Factory.deploy();
    await harness.waitForDeployment();
  });

  describe('computeNullifier', function () {
    it('should produce deterministic output', async function () {
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-1'));
      const chain = 361n; // Theta mainnet
      const nonce = 1n;

      const n1 = await harness.computeNullifier(proofHash, chain, nonce);
      const n2 = await harness.computeNullifier(proofHash, chain, nonce);
      expect(n1).to.equal(n2);
    });

    it('should differ for different nonces', async function () {
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes('proof-1'));
      const n1 = await harness.computeNullifier(proofHash, 361n, 1n);
      const n2 = await harness.computeNullifier(proofHash, 361n, 2n);
      expect(n1).to.not.equal(n2);
    });
  });

  describe('computeFeeCommitment', function () {
    it('should produce deterministic output', async function () {
      const [signer] = await ethers.getSigners();
      const feeBps = 50n; // 0.5%
      const amount = ethers.parseEther('1.0');

      const c1 = await harness.computeFeeCommitment(signer.address, feeBps, amount);
      const c2 = await harness.computeFeeCommitment(signer.address, feeBps, amount);
      expect(c1).to.equal(c2);
    });
  });

  describe('encodeAITaskPublicValues', function () {
    it('should encode public values', async function () {
      const [signer] = await ethers.getSigners();
      const encoded = await harness.encodeAITaskPublicValues(
        signer.address,
        ethers.keccak256(ethers.toUtf8Bytes('task-1')),
        50n,
        1n,
        361n
      );
      expect(encoded.length).to.be.greaterThan(2); // "0x..."
    });
  });
});
