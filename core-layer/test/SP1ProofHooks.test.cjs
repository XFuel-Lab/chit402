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
    const Factory = await ethers.getContractFactory('SP1ProofHooksHarness');
    harness = await Factory.deploy();
    await harness.waitForDeployment();
  });

  describe('computeNullifier', function () {
    it('should produce deterministic output', async function () {
      const [signer] = await ethers.getSigners();
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const nonce = 1n;
      const blockNumber = 1000n;

      const n1 = await harness.computeNullifier(taskId, signer.address, nonce, blockNumber);
      const n2 = await harness.computeNullifier(taskId, signer.address, nonce, blockNumber);
      expect(n1).to.equal(n2);
    });

    it('should differ for different nonces', async function () {
      const [signer] = await ethers.getSigners();
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const blockNumber = 1000n;

      const n1 = await harness.computeNullifier(taskId, signer.address, 1n, blockNumber);
      const n2 = await harness.computeNullifier(taskId, signer.address, 2n, blockNumber);
      expect(n1).to.not.equal(n2);
    });

    it('should differ for different senders', async function () {
      const [signer1, signer2] = await ethers.getSigners();
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));

      const n1 = await harness.computeNullifier(taskId, signer1.address, 1n, 1000n);
      const n2 = await harness.computeNullifier(taskId, signer2.address, 1n, 1000n);
      expect(n1).to.not.equal(n2);
    });
  });

  describe('computeFeeCommitment', function () {
    it('should produce deterministic output', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const feeAmount = ethers.parseEther('0.005'); // 0.5% of 1 ETH
      const chainDiscriminant = 0; // Theta

      const c1 = await harness.computeFeeCommitment(feeAmount, taskId, chainDiscriminant);
      const c2 = await harness.computeFeeCommitment(feeAmount, taskId, chainDiscriminant);
      expect(c1).to.equal(c2);
    });

    it('should differ for different chain discriminants', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const feeAmount = ethers.parseEther('0.005');

      const c1 = await harness.computeFeeCommitment(feeAmount, taskId, 0); // Theta
      const c2 = await harness.computeFeeCommitment(feeAmount, taskId, 1); // Osmosis
      expect(c1).to.not.equal(c2);
    });
  });

  describe('encodeAITaskPublicValues', function () {
    it('should encode public values with correct length', async function () {
      const [signer] = await ethers.getSigners();
      const taskIdHash = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const senderHash = ethers.keccak256(signer.address);
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));

      const encoded = await harness.encodeAITaskPublicValues(
        0,                          // taskType: INFERENCE_REQUEST
        0,                          // sourceChain: Theta
        1,                          // destChain: Osmosis
        taskIdHash,
        senderHash,
        ethers.parseEther('0.995'), // netAmount (after 0.5% fee)
        ethers.parseEther('0.005'), // feeAmount
        50n,                        // feeBps: 0.5%
        outputHash,
        1000n,                      // blockHeight
        BigInt(Math.floor(Date.now() / 1000)), // timestamp
        1n                          // nonce
      );
      expect(encoded.length).to.be.greaterThan(2); // non-empty bytes
    });

    it('should produce different encodings for different task types', async function () {
      const [signer] = await ethers.getSigners();
      const taskIdHash = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const senderHash = ethers.keccak256(signer.address);
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));
      const args = [
        taskIdHash, senderHash,
        ethers.parseEther('0.995'), ethers.parseEther('0.005'),
        50n, outputHash, 1000n, BigInt(Math.floor(Date.now() / 1000)), 1n
      ];

      const e1 = await harness.encodeAITaskPublicValues(0, 0, 1, ...args); // INFERENCE_REQUEST
      const e2 = await harness.encodeAITaskPublicValues(1, 0, 1, ...args); // COMPUTE_BID
      expect(e1).to.not.equal(e2);
    });
  });

  describe('encodeCrossChainPayload', function () {
    it('should encode a 160-byte cross-chain payload', async function () {
      const [signer] = await ethers.getSigners();
      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('ThetaInferenceCircuit'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('nullifier-1'));
      const publicValuesHash = ethers.keccak256(ethers.toUtf8Bytes('values-1'));
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const payload = await harness.encodeCrossChainPayload(
        circuitId, nullifier, publicValuesHash, signer.address, timestamp
      );
      // 5 × 32-byte ABI words = 160 bytes = "0x" + 320 hex chars
      expect(payload.length).to.equal(2 + 320);
    });
  });

  describe('computeComposedCallNullifier', function () {
    it('should produce deterministic output', async function () {
      const [signer] = await ethers.getSigners();
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-cc-1'));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('state-root'));
      const sourceBlock = 12345n;

      const n1 = await harness.computeComposedCallNullifier(taskId, stateRoot, sourceBlock, signer.address, 1n);
      const n2 = await harness.computeComposedCallNullifier(taskId, stateRoot, sourceBlock, signer.address, 1n);
      expect(n1).to.equal(n2);
    });

    it('should differ for different state roots (state-binding)', async function () {
      const [signer] = await ethers.getSigners();
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-cc-1'));

      const n1 = await harness.computeComposedCallNullifier(
        taskId, ethers.keccak256(ethers.toUtf8Bytes('root-A')), 100n, signer.address, 1n
      );
      const n2 = await harness.computeComposedCallNullifier(
        taskId, ethers.keccak256(ethers.toUtf8Bytes('root-B')), 100n, signer.address, 1n
      );
      expect(n1).to.not.equal(n2);
    });
  });

  describe('encodeComposedCallPublicValues', function () {
    it('should encode public values for SP1-CC proofs', async function () {
      const [signer] = await ethers.getSigners();
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('state-root'));
      const callResultHash = ethers.keccak256(ethers.toUtf8Bytes('result'));
      const taskIdHash = ethers.keccak256(ethers.toUtf8Bytes('task-cc-1'));
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const encoded = await harness.encodeComposedCallPublicValues(
        stateRoot, 12345n, signer.address, callResultHash, taskIdHash, timestamp
      );
      expect(encoded.length).to.be.greaterThan(2);
    });
  });
});
