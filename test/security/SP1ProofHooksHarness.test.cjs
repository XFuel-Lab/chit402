/**
 * SP1ProofHooks Library — Harness Tests
 *
 * Tests every public library function via SP1ProofHooksHarness wrapper.
 * Target: >90% line coverage for SP1ProofHooks.sol
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('SP1ProofHooks Library (via Harness)', function () {
  let harness;

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory('SP1ProofHooksHarness');
    harness = await Factory.deploy();
    await harness.waitForDeployment();
  });

  describe('computeNullifier', function () {
    it('should produce deterministic nullifier', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const sender = '0x1111111111111111111111111111111111111111';
      const nonce = 1n;
      const blockNumber = 12345n;

      const result = await harness.computeNullifier(taskId, sender, nonce, blockNumber);
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'address', 'uint64', 'uint256'],
          [taskId, sender, nonce, blockNumber]
        )
      );
      expect(result).to.equal(expected);
    });

    it('should produce different nullifiers for different inputs', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const sender = '0x1111111111111111111111111111111111111111';

      const n1 = await harness.computeNullifier(taskId, sender, 1n, 100n);
      const n2 = await harness.computeNullifier(taskId, sender, 2n, 100n);
      const n3 = await harness.computeNullifier(taskId, sender, 1n, 200n);

      expect(n1).to.not.equal(n2);
      expect(n1).to.not.equal(n3);
      expect(n2).to.not.equal(n3);
    });

    it('should handle zero values', async function () {
      const result = await harness.computeNullifier(
        ethers.ZeroHash, ethers.ZeroAddress, 0n, 0n
      );
      expect(result).to.not.equal(ethers.ZeroHash);
    });

    it('should handle max uint64 nonce', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-max'));
      const sender = '0xdead000000000000000000000000000000000001';
      const maxNonce = (2n ** 64n) - 1n;
      const result = await harness.computeNullifier(taskId, sender, maxNonce, 999999n);
      expect(result).to.be.a('string').with.length(66);
    });
  });

  describe('computeFeeCommitment', function () {
    it('should produce deterministic commitment', async function () {
      const feeAmount = ethers.parseEther('0.5');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('fee-task-1'));
      const chainDiscriminant = 0; // Theta

      const result = await harness.computeFeeCommitment(feeAmount, taskId, chainDiscriminant);
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ['uint256', 'bytes32', 'uint8'],
          [feeAmount, taskId, chainDiscriminant]
        )
      );
      expect(result).to.equal(expected);
    });

    it('should differ by chain discriminant', async function () {
      const feeAmount = ethers.parseEther('1.0');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('fee-chain-test'));

      const theta = await harness.computeFeeCommitment(feeAmount, taskId, 0);
      const osmosis = await harness.computeFeeCommitment(feeAmount, taskId, 1);
      const akash = await harness.computeFeeCommitment(feeAmount, taskId, 2);

      expect(theta).to.not.equal(osmosis);
      expect(theta).to.not.equal(akash);
      expect(osmosis).to.not.equal(akash);
    });

    it('should handle zero fee amount', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('zero-fee'));
      const result = await harness.computeFeeCommitment(0n, taskId, 0);
      expect(result).to.be.a('string').with.length(66);
    });

    it('should handle large fee amounts', async function () {
      const largeFee = ethers.parseEther('1000000');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('big-fee'));
      const result = await harness.computeFeeCommitment(largeFee, taskId, 255);
      expect(result).to.be.a('string').with.length(66);
    });
  });

  describe('encodeAITaskPublicValues', function () {
    it('should produce decodable ABI-encoded output', async function () {
      const result = await harness.encodeAITaskPublicValues(
        1, 0, 1, // taskType, sourceChain, destChain
        ethers.keccak256(ethers.toUtf8Bytes('task-id')),
        ethers.keccak256(ethers.toUtf8Bytes('sender')),
        ethers.parseEther('0.95'), // netAmount
        ethers.parseEther('0.05'), // feeAmount
        50, // feeBps
        ethers.keccak256(ethers.toUtf8Bytes('output')),
        12345n, // blockHeight
        1700000000n, // timestamp
        1n // nonce
      );

      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(2);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint8', 'uint8', 'uint8', 'bytes32', 'bytes32',
         'uint256', 'uint256', 'uint16', 'bytes32', 'uint64', 'uint64', 'uint64'],
        result
      );
      expect(decoded[0]).to.equal(1n); // taskType
      expect(decoded[5]).to.equal(ethers.parseEther('0.95'));
      expect(decoded[7]).to.equal(50n); // feeBps
    });

    it('should produce different encodings for different inputs', async function () {
      const base = [
        1, 0, 1,
        ethers.keccak256(ethers.toUtf8Bytes('task')),
        ethers.keccak256(ethers.toUtf8Bytes('sender')),
        ethers.parseEther('1'), ethers.parseEther('0.01'),
        50, ethers.keccak256(ethers.toUtf8Bytes('out')),
        100n, 200n, 1n,
      ];
      const r1 = await harness.encodeAITaskPublicValues(...base);

      const modified = [...base];
      modified[0] = 2; // different taskType
      const r2 = await harness.encodeAITaskPublicValues(...modified);

      expect(r1).to.not.equal(r2);
    });

    it('should handle all-zero parameters', async function () {
      const result = await harness.encodeAITaskPublicValues(
        0, 0, 0, ethers.ZeroHash, ethers.ZeroHash, 0n, 0n, 0, ethers.ZeroHash, 0n, 0n, 0n
      );
      expect(result.length).to.be.greaterThan(2);
    });
  });

  describe('computePaymentCommitment (Phase 2 x402 binding)', function () {
    const railUsdc = 1;
    const railTfuel = 2;

    it('should match the backend JS formula (parity)', async function () {
      const paymentRefHash = ethers.keccak256(ethers.toUtf8Bytes('base:0xabc123'));
      const taskIdHash = ethers.keccak256(ethers.toUtf8Bytes('task-pay-1'));
      const amount = ethers.parseEther('0.95');

      const result = await harness.computePaymentCommitment(paymentRefHash, taskIdHash, railUsdc, amount);
      // Mirror of backend/theta-bridge/src/payment-binding.js computePaymentCommitment.
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'bytes32', 'uint8', 'uint256'],
          [paymentRefHash, taskIdHash, railUsdc, amount]
        )
      );
      expect(result).to.equal(expected);
    });

    it('should differ by rail, ref, task, and amount', async function () {
      const ref = ethers.keccak256(ethers.toUtf8Bytes('base:0xtx'));
      const task = ethers.keccak256(ethers.toUtf8Bytes('t'));
      const amt = 1000n;

      const base = await harness.computePaymentCommitment(ref, task, railUsdc, amt);
      const byRail = await harness.computePaymentCommitment(ref, task, railTfuel, amt);
      const byRef = await harness.computePaymentCommitment(ethers.keccak256(ethers.toUtf8Bytes('base:0xOTHER')), task, railUsdc, amt);
      const byTask = await harness.computePaymentCommitment(ref, ethers.keccak256(ethers.toUtf8Bytes('t2')), railUsdc, amt);
      const byAmt = await harness.computePaymentCommitment(ref, task, railUsdc, 2000n);

      expect(base).to.not.equal(byRail);
      expect(base).to.not.equal(byRef);
      expect(base).to.not.equal(byTask);
      expect(base).to.not.equal(byAmt);
    });
  });

  describe('encodeAITaskPublicValuesV2 (Phase 2 x402 binding)', function () {
    const v1Args = [
      1, 0, 1,
      ethers.keccak256(ethers.toUtf8Bytes('task-id')),
      ethers.keccak256(ethers.toUtf8Bytes('sender')),
      ethers.parseEther('0.95'),
      ethers.parseEther('0.05'),
      50,
      ethers.keccak256(ethers.toUtf8Bytes('output')),
      12345n, 1700000000n, 1n,
    ];

    it('appends a decodable paymentCommitment as the 13th field', async function () {
      const paymentCommitment = ethers.keccak256(ethers.toUtf8Bytes('pay-commit'));
      const result = await harness.encodeAITaskPublicValuesV2(...v1Args, paymentCommitment);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint8', 'uint8', 'uint8', 'bytes32', 'bytes32',
         'uint256', 'uint256', 'uint16', 'bytes32', 'uint64', 'uint64', 'uint64', 'bytes32'],
        result
      );
      expect(decoded[12]).to.equal(paymentCommitment);
      expect(decoded[5]).to.equal(ethers.parseEther('0.95'));
    });

    it('is a strict superset of v1 (v1 fields decode identically)', async function () {
      const v1 = await harness.encodeAITaskPublicValues(...v1Args);
      const v2 = await harness.encodeAITaskPublicValuesV2(...v1Args, ethers.ZeroHash);
      // v2 = v1 (12 head words) + one extra 32-byte word.
      expect(v2.startsWith(v1)).to.equal(true);
      expect((v2.length - v1.length)).to.equal(64); // 32 bytes hex
    });

    it('bytes32(0) commitment marks an unbound task', async function () {
      const result = await harness.encodeAITaskPublicValuesV2(...v1Args, ethers.ZeroHash);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint8', 'uint8', 'uint8', 'bytes32', 'bytes32',
         'uint256', 'uint256', 'uint16', 'bytes32', 'uint64', 'uint64', 'uint64', 'bytes32'],
        result
      );
      expect(decoded[12]).to.equal(ethers.ZeroHash);
    });
  });

  describe('computeComposedCallNullifier', function () {
    it('should include stateRoot and sourceBlock for replay protection', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('cc-task'));
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('state-root-1'));
      const sourceBlock = 54321n;
      const sender = '0x2222222222222222222222222222222222222222';
      const nonce = 7n;

      const result = await harness.computeComposedCallNullifier(
        taskId, stateRoot, sourceBlock, sender, nonce
      );
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'bytes32', 'uint256', 'address', 'uint64'],
          [taskId, stateRoot, sourceBlock, sender, nonce]
        )
      );
      expect(result).to.equal(expected);
    });

    it('should differ from standard computeNullifier', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('shared-task'));
      const sender = '0x3333333333333333333333333333333333333333';
      const nonce = 1n;

      const standard = await harness.computeNullifier(taskId, sender, nonce, 100n);
      const composed = await harness.computeComposedCallNullifier(
        taskId, ethers.ZeroHash, 100n, sender, nonce
      );
      expect(standard).to.not.equal(composed);
    });

    it('should differ by stateRoot', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('cc-root-test'));
      const sender = '0x4444444444444444444444444444444444444444';
      const root1 = ethers.keccak256(ethers.toUtf8Bytes('root-a'));
      const root2 = ethers.keccak256(ethers.toUtf8Bytes('root-b'));

      const n1 = await harness.computeComposedCallNullifier(taskId, root1, 100n, sender, 1n);
      const n2 = await harness.computeComposedCallNullifier(taskId, root2, 100n, sender, 1n);
      expect(n1).to.not.equal(n2);
    });
  });

  describe('encodeComposedCallPublicValues', function () {
    it('should produce decodable SP1-CC public values', async function () {
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes('state-root'));
      const sourceBlock = 54321n;
      const targetContract = '0x6666666666666666666666666666666666666666';
      const callResultHash = ethers.keccak256(ethers.toUtf8Bytes('result'));
      const taskIdHash = ethers.keccak256(ethers.toUtf8Bytes('task'));
      const timestamp = 1700000000n;

      const result = await harness.encodeComposedCallPublicValues(
        stateRoot, sourceBlock, targetContract, callResultHash, taskIdHash, timestamp
      );
      expect(result.length).to.be.greaterThan(2);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['bytes32', 'uint256', 'address', 'bytes32', 'bytes32', 'uint64'],
        result
      );
      expect(decoded[0]).to.equal(stateRoot);
      expect(decoded[1]).to.equal(sourceBlock);
      expect(decoded[2]).to.equal(targetContract);
      expect(decoded[3]).to.equal(callResultHash);
      expect(decoded[4]).to.equal(taskIdHash);
      expect(decoded[5]).to.equal(timestamp);
    });
  });

  describe('verifySP1', function () {
    let mockGateway;

    beforeEach(async function () {
      const GatewayFactory = await ethers.getContractFactory('MockSP1Gateway');
      mockGateway = await GatewayFactory.deploy();
      await mockGateway.waitForDeployment();
    });

    it('should pass in mock mode (gateway = address(0))', async function () {
      await harness.verifySP1(
        ethers.ZeroAddress,
        ethers.keccak256(ethers.toUtf8Bytes('vkey')),
        '0xabcd', '0x1234'
      );
    });

    it('should pass with valid gateway', async function () {
      await harness.verifySP1(
        await mockGateway.getAddress(),
        ethers.keccak256(ethers.toUtf8Bytes('vkey')),
        '0xabcd', '0x1234'
      );
    });

    it('should revert with SP1VerificationFailed when gateway reverts', async function () {
      await mockGateway.setRevert(true);
      await expect(
        harness.verifySP1(
          await mockGateway.getAddress(),
          ethers.keccak256(ethers.toUtf8Bytes('vkey')),
          '0xabcd', '0x1234'
        )
      ).to.be.reverted;
    });
  });

  describe('verifySP1WithHash', function () {
    let mockGateway;

    beforeEach(async function () {
      const GatewayFactory = await ethers.getContractFactory('MockSP1Gateway');
      mockGateway = await GatewayFactory.deploy();
      await mockGateway.waitForDeployment();
    });

    it('should return keccak256 of public values on success', async function () {
      const publicValues = '0xabcdef1234567890';
      const result = await harness.verifySP1WithHash(
        await mockGateway.getAddress(),
        ethers.keccak256(ethers.toUtf8Bytes('vkey')),
        publicValues, '0x1234'
      );
      expect(result).to.equal(ethers.keccak256(publicValues));
    });

    it('should work in mock mode and return correct hash', async function () {
      const publicValues = '0xdeadbeef';
      const result = await harness.verifySP1WithHash(
        ethers.ZeroAddress,
        ethers.keccak256(ethers.toUtf8Bytes('vkey')),
        publicValues, '0x1234'
      );
      expect(result).to.equal(ethers.keccak256(publicValues));
    });

    it('should revert when gateway rejects proof', async function () {
      await mockGateway.setRevert(true);
      await expect(
        harness.verifySP1WithHash(
          await mockGateway.getAddress(),
          ethers.keccak256(ethers.toUtf8Bytes('vkey')),
          '0xabcd', '0x1234'
        )
      ).to.be.reverted;
    });
  });

  describe('encodeCrossChainPayload', function () {
    it('should produce 160-byte ABI-encoded payload', async function () {
      const circuitId = ethers.keccak256(ethers.toUtf8Bytes('bridge-circuit'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('relay-null'));
      const pvHash = ethers.keccak256(ethers.toUtf8Bytes('public-values'));
      const verifier = '0x5555555555555555555555555555555555555555';
      const timestamp = 1700000000n;

      const result = await harness.encodeCrossChainPayload(
        circuitId, nullifier, pvHash, verifier, timestamp
      );

      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(2);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['bytes32', 'bytes32', 'bytes32', 'address', 'uint256'],
        result
      );
      expect(decoded[0]).to.equal(circuitId);
      expect(decoded[1]).to.equal(nullifier);
      expect(decoded[2]).to.equal(pvHash);
      expect(decoded[3]).to.equal(verifier);
      expect(decoded[4]).to.equal(timestamp);
    });

    it('should handle zero address verifier', async function () {
      const result = await harness.encodeCrossChainPayload(
        ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroAddress, 0n
      );
      expect(result.length).to.be.greaterThan(2);
    });
  });
});
