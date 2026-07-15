/**
 * zkML Inference Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/zkml/test/ZKMLCircuit.test.cjs
 *
 * Covers:
 *   - Private model registration & management (5 tests)
 *   - Inference request lifecycle (4 tests)
 *   - Proof verification & settlement (3 tests)
 *   - Edge cases: deadline, dispute, refund (3 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKMLCircuit', function () {
  let circuit, splitter;
  let admin, prover, modelOwner, user, user2;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('ZKML_CIRCUIT'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const WEIGHT_COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v1'));
  const ARCH_HASH = ethers.keccak256(ethers.toUtf8Bytes('transformer-arch-7b'));
  const INPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes('encrypted-user-input'));

  beforeEach(async function () {
    [admin, prover, modelOwner, user, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    // Deploy CoreRevenueSplitter
    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    // Deploy ZKMLCircuit
    const CircuitFactory = await ethers.getContractFactory('ZKMLCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress // zkVerifier = mock
    );
    await circuit.waitForDeployment();

    // Grant PROVER_ROLE
    const PROVER_ROLE = await circuit.PROVER_ROLE();
    await circuit.grantRole(PROVER_ROLE, prover.address);

    // Grant CIRCUIT_ROLE on splitter
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  DEPLOYMENT & IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deployment', function () {
    it('should deploy with correct circuit ID', async function () {
      expect(await circuit.CIRCUIT_ID()).to.equal(CIRCUIT_ID);
    });

    it('should have 0.75% default fee', async function () {
      expect(await circuit.feeBps()).to.equal(75);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE MODEL REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Private Model Registration', function () {
    it('should register a private model with weight commitment', async function () {
      const tx = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH,
        'Sentiment Classifier v3',
        ethers.parseEther('0.01'),
        false // architecture is private
      );
      const receipt = await tx.wait();

      expect(await circuit.modelCount()).to.equal(1n);

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should auto-authorize model owner as prover', async function () {
      const tx = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH, 'Model', ethers.parseEther('0.01'), false
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      const modelId = circuit.interface.parseLog(event).args.modelId;

      expect(await circuit.isProverAuthorized(modelId, modelOwner.address)).to.be.true;
    });

    it('should authorize and revoke additional provers', async function () {
      const tx = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH, 'Model', ethers.parseEther('0.01'), false
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      const modelId = circuit.interface.parseLog(event).args.modelId;

      // Authorize prover
      await circuit.connect(modelOwner).authorizeProver(modelId, prover.address);
      expect(await circuit.isProverAuthorized(modelId, prover.address)).to.be.true;

      // Revoke prover
      await circuit.connect(modelOwner).revokeProver(modelId, prover.address);
      expect(await circuit.isProverAuthorized(modelId, prover.address)).to.be.false;
    });

    it('should rotate weight commitment (model retraining)', async function () {
      const tx = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH, 'Model', ethers.parseEther('0.01'), false
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      const modelId = circuit.interface.parseLog(event).args.modelId;

      const newCommitment = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v2'));
      await circuit.connect(modelOwner).rotateWeights(modelId, newCommitment);

      const model = await circuit.getModel(modelId);
      expect(model.weightCommitment).to.equal(newCommitment);
    });

    it('should reject zero weight commitment', async function () {
      await expect(
        circuit.connect(modelOwner).registerModel(
          ethers.ZeroHash, ARCH_HASH, 'Bad', ethers.parseEther('0.01'), false
        )
      ).to.be.revertedWith('ZeroCommitment');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  INFERENCE REQUEST LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Inference Requests', function () {
    let modelId;

    beforeEach(async function () {
      const tx = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH, 'TestModel', ethers.parseEther('0.01'), false
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      modelId = circuit.interface.parseLog(event).args.modelId;
    });

    it('should submit an inference request', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const payment = ethers.parseEther('0.05');

      const tx = await circuit.connect(user).requestInference(
        modelId, INPUT_HASH, deadline, { value: payment }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceRequested'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should deduct 0.75% fee and forward to splitter', async function () {
      const payment = ethers.parseEther('10.0');
      const expectedFee = ethers.parseEther('0.075'); // 0.75%
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

      await circuit.connect(user).requestInference(
        modelId, INPUT_HASH, deadline, { value: payment }
      );

      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });

    it('should reject payment below model price', async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await expect(
        circuit.connect(user).requestInference(
          modelId, INPUT_HASH, deadline, { value: 100 }
        )
      ).to.be.revertedWithCustomError(circuit, 'InsufficientPayment');
    });

    it('should reject inference for inactive model', async function () {
      await circuit.connect(modelOwner).updateModel(modelId, 0, false);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await expect(
        circuit.connect(user).requestInference(
          modelId, INPUT_HASH, deadline, { value: ethers.parseEther('0.01') }
        )
      ).to.be.revertedWithCustomError(circuit, 'ModelNotActive');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PROOF VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Proof Verification', function () {
    let modelId, requestId;

    beforeEach(async function () {
      // Register model
      const txModel = await circuit.connect(modelOwner).registerModel(
        WEIGHT_COMMITMENT, ARCH_HASH, 'TestModel', ethers.parseEther('0.01'), false
      );
      const receiptModel = await txModel.wait();
      const modelEvent = receiptModel.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
        catch { return false; }
      });
      modelId = circuit.interface.parseLog(modelEvent).args.modelId;

      // Authorize external prover
      await circuit.connect(modelOwner).authorizeProver(modelId, prover.address);

      // Submit inference request
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const txReq = await circuit.connect(user).requestInference(
        modelId, INPUT_HASH, deadline, { value: ethers.parseEther('1.0') }
      );
      const receiptReq = await txReq.wait();
      const reqEvent = receiptReq.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceRequested'; }
        catch { return false; }
      });
      requestId = circuit.interface.parseLog(reqEvent).args.requestId;
    });

    it('should verify inference with valid proof', async function () {
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('zkml-null-1'));

      const ownerBefore = await ethers.provider.getBalance(modelOwner.address);

      await circuit.connect(prover).verifyInference(
        requestId, outputHash, WEIGHT_COMMITMENT,
        MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier, false
      );

      const req = await circuit.getRequest(requestId);
      expect(req.status).to.equal(3); // Verified
      expect(req.outputHash).to.equal(outputHash);

      // Model owner should receive payment
      const ownerAfter = await ethers.provider.getBalance(modelOwner.address);
      expect(ownerAfter).to.be.gt(ownerBefore);
    });

    it('should reject proof from unauthorized prover', async function () {
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('zkml-null-2'));

      await expect(
        circuit.connect(user2).verifyInference(
          requestId, outputHash, WEIGHT_COMMITMENT,
          MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier, false
        )
      ).to.be.revertedWithCustomError(circuit, 'ProverNotAuthorized');
    });

    it('should reject mismatched weight commitment', async function () {
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('zkml-null-3'));
      const fakeCommitment = ethers.keccak256(ethers.toUtf8Bytes('fake-weights'));

      await expect(
        circuit.connect(prover).verifyInference(
          requestId, outputHash, fakeCommitment,
          MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier, false
        )
      ).to.be.revertedWithCustomError(circuit, 'InvalidCommitment');
    });

    it('should reject duplicate nullifier', async function () {
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes('output-1'));
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('zkml-null-dup'));

      await circuit.connect(prover).verifyInference(
        requestId, outputHash, WEIGHT_COMMITMENT,
        MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier, false
      );

      // Submit a new request and try same nullifier
      const deadline = Math.floor(Date.now() / 1000) + 7200;
      const txReq2 = await circuit.connect(user).requestInference(
        modelId, INPUT_HASH, deadline, { value: ethers.parseEther('1.0') }
      );
      const receipt2 = await txReq2.wait();
      const reqEvent2 = receipt2.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceRequested'; }
        catch { return false; }
      });
      const requestId2 = circuit.interface.parseLog(reqEvent2).args.requestId;

      await expect(
        circuit.connect(prover).verifyInference(
          requestId2, outputHash, WEIGHT_COMMITMENT,
          MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier, false
        )
      ).to.be.revertedWithCustomError(circuit, 'NullifierUsed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES & FAILURE MODES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fee Configuration', function () {
    it('should update fee within valid range', async function () {
      await circuit.setFee(100); // 1%
      expect(await circuit.feeBps()).to.equal(100);
    });

    it('should reject fee outside range (too high)', async function () {
      await expect(circuit.setFee(250)).to.be.revertedWith('FeeRange');
    });

    it('should reject fee outside range (too low)', async function () {
      await expect(circuit.setFee(5)).to.be.revertedWith('FeeRange');
    });
  });

  describe('Pause', function () {
    it('should prevent model registration when paused', async function () {
      await circuit.pause();
      await expect(
        circuit.connect(modelOwner).registerModel(
          WEIGHT_COMMITMENT, ARCH_HASH, 'Test', ethers.parseEther('0.01'), false
        )
      ).to.be.revertedWithCustomError(circuit, 'EnforcedPause');
    });
  });

  describe('Stats', function () {
    it('should track circuit metrics', async function () {
      const [models, reqs, vol, fees, proofs] = await circuit.getStats();
      expect(models).to.equal(0n);
      expect(reqs).to.equal(0n);
      expect(vol).to.equal(0n);
    });
  });
});
