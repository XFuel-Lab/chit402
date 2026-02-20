/**
 * Theta GPU Circuit — Hardhat Tests (Enhanced: 15 tests)
 *
 * Run: npx hardhat test circuits/theta-gpu/test/ThetaGPUCircuit.test.cjs
 *
 * Covers:
 *   - Model registry (3 tests)
 *   - Provider registration & staking (3 tests)
 *   - Job submission (3 tests)
 *   - Full job lifecycle: assign → complete → settle → fail (4 tests)
 *   - Subchain config & multi-job stress (2 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ThetaGPUCircuit', function () {
  let circuit, splitter;
  let admin, relayer, provider1, provider2, user, user2;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('THETA_GPU_CIRCUIT'));
  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('inference-input'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('inference-output'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);

  beforeEach(async function () {
    [admin, relayer, provider1, provider2, user, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CircuitFactory = await ethers.getContractFactory('ThetaGPUCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress
    );
    await circuit.waitForDeployment();

    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  MODEL REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Model Registry', function () {
    it('should register a model', async function () {
      const tx = await circuit.registerModel(
        'Llama 3.1 70B', 'text',
        ethers.parseEther('0.01'), ethers.parseEther('100')
      );
      const receipt = await tx.wait();
      expect(await circuit.modelCount()).to.equal(1n);

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'ModelRegistered'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should register multiple models with different categories', async function () {
      await circuit.registerModel('Llama 3.1', 'text', ethers.parseEther('0.01'), 0);
      await circuit.registerModel('FLUX.1', 'image', ethers.parseEther('0.05'), 0);
      await circuit.registerModel('Whisper', 'audio', ethers.parseEther('0.02'), 0);
      expect(await circuit.modelCount()).to.equal(3n);
    });

    it('should update model pricing and deactivate', async function () {
      await circuit.registerModel('TestModel', 'text', ethers.parseEther('0.01'), 0);
      const modelId = await circuit.modelIds(0);

      await circuit.updateModel(modelId, ethers.parseEther('0.02'), true);
      let model = await circuit.getModel(modelId);
      expect(model.pricePerInference).to.equal(ethers.parseEther('0.02'));

      await circuit.updateModel(modelId, ethers.parseEther('0.02'), false);
      model = await circuit.getModel(modelId);
      expect(model.active).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PROVIDER REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Provider Registration', function () {
    it('should register with stake and check initial reputation', async function () {
      await circuit.connect(provider1).registerProvider(
        'https://edgecloud.theta.tv/node/abc', [],
        { value: ethers.parseEther('100') }
      );

      const p = await circuit.getProvider(provider1.address);
      expect(p.active).to.be.true;
      expect(p.staked).to.equal(ethers.parseEther('100'));
      expect(p.reputation).to.equal(5000n); // 50% initial
    });

    it('should increase provider stake', async function () {
      await circuit.connect(provider1).registerProvider(
        'https://node1.com', [], { value: ethers.parseEther('50') }
      );
      await circuit.connect(provider1).addStake({ value: ethers.parseEther('50') });

      const p = await circuit.getProvider(provider1.address);
      expect(p.staked).to.equal(ethers.parseEther('100'));
    });

    it('should slash a provider and reduce stake', async function () {
      await circuit.connect(provider1).registerProvider(
        'https://node1.com', [], { value: ethers.parseEther('100') }
      );
      await circuit.slashProvider(
        provider1.address, ethers.parseEther('10'), 'Failed inference'
      );

      const p = await circuit.getProvider(provider1.address);
      expect(p.staked).to.equal(ethers.parseEther('90'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  JOB SUBMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Job Submission', function () {
    let modelId;

    beforeEach(async function () {
      await circuit.registerModel(
        'Llama 3.1 70B', 'text',
        ethers.parseEther('0.01'), ethers.parseEther('10')
      );
      modelId = await circuit.modelIds(0);
    });

    it('should submit a job with proper fee deduction', async function () {
      const payment = ethers.parseEther('1.0');
      const expectedFee = ethers.parseEther('0.005');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(user).submitJob(modelId, MOCK_INPUT, { value: payment });
      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());

      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
      expect(await circuit.jobCount()).to.equal(1n);
    });

    it('should reject payment below model price', async function () {
      await expect(
        circuit.connect(user).submitJob(modelId, MOCK_INPUT, { value: 100 })
      ).to.be.revertedWithCustomError(circuit, 'InsufficientPayment');
    });

    it('should reject job for inactive model', async function () {
      await circuit.updateModel(modelId, ethers.parseEther('0.01'), false);
      await expect(
        circuit.connect(user).submitJob(modelId, MOCK_INPUT, { value: ethers.parseEther('0.01') })
      ).to.be.revertedWithCustomError(circuit, 'ModelNotActive');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  FULL JOB LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Job Lifecycle', function () {
    let modelId, jobId;

    beforeEach(async function () {
      await circuit.registerModel(
        'Llama 3.1 70B', 'text',
        ethers.parseEther('0.01'), ethers.parseEther('10')
      );
      modelId = await circuit.modelIds(0);

      await circuit.connect(provider1).registerProvider(
        'https://node1.com', [modelId],
        { value: ethers.parseEther('100') }
      );

      const tx = await circuit.connect(user).submitJob(
        modelId, MOCK_INPUT, { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'GPUJobRouted'; }
        catch { return false; }
      });
      jobId = circuit.interface.parseLog(event).args.jobId;
    });

    it('should assign → complete → settle a job', async function () {
      await circuit.connect(relayer).assignJob(jobId, provider1.address);

      let job = await circuit.getJob(jobId);
      expect(job.status).to.equal(2); // Routed

      await circuit.connect(relayer).completeJob(jobId, MOCK_OUTPUT, 1500);
      job = await circuit.getJob(jobId);
      expect(job.status).to.equal(4); // Completed

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('gpu-null-1'));
      const provider1Before = await ethers.provider.getBalance(provider1.address);

      await circuit.connect(relayer).settleJob(
        jobId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      job = await circuit.getJob(jobId);
      expect(job.status).to.equal(6); // Settled
      const provider1After = await ethers.provider.getBalance(provider1.address);
      expect(provider1After).to.be.gt(provider1Before);
    });

    it('should fail a job, refund requester, and penalize reputation', async function () {
      await circuit.connect(relayer).assignJob(jobId, provider1.address);

      const userBefore = await ethers.provider.getBalance(user.address);
      await circuit.connect(relayer).failJob(jobId, 'Provider timeout');

      const job = await circuit.getJob(jobId);
      expect(job.status).to.equal(5); // Failed

      const userAfter = await ethers.provider.getBalance(user.address);
      expect(userAfter).to.be.gt(userBefore);

      const p = await circuit.getProvider(provider1.address);
      expect(p.jobsFailed).to.equal(1n);
      expect(p.reputation).to.be.lt(5000n);
    });

    it('should track model inference metrics', async function () {
      await circuit.connect(relayer).assignJob(jobId, provider1.address);
      await circuit.connect(relayer).completeJob(jobId, MOCK_OUTPUT, 2000);

      const model = await circuit.getModel(modelId);
      expect(model.totalInferences).to.equal(1n);
      expect(model.avgLatencyMs).to.equal(2000n);
      expect(await circuit.totalInferences()).to.equal(1n);
    });

    it('should reject assigning to provider with insufficient stake', async function () {
      // Register a low-stake provider
      await circuit.connect(provider2).registerProvider(
        'https://node2.com', [], { value: ethers.parseEther('1') }
      );

      // Model requires 10 ETH collateral
      await expect(
        circuit.connect(relayer).assignJob(jobId, provider2.address)
      ).to.be.revertedWithCustomError(circuit, 'InsufficientStake');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SUBCHAIN & MULTI-JOB STRESS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Subchain Configuration', function () {
    it('should set subchain config', async function () {
      await circuit.setSubchainConfig(1001, admin.address);
      expect(await circuit.subchainId()).to.equal(1001n);
      expect(await circuit.mainChainBridge()).to.equal(admin.address);
    });
  });

  describe('Multi-Job Stress', function () {
    it('should handle 10 jobs from multiple users', async function () {
      await circuit.registerModel(
        'StressModel', 'text', ethers.parseEther('0.001'), 0
      );
      const modelId = await circuit.modelIds(0);

      const tasks = [];
      for (let i = 0; i < 5; i++) {
        tasks.push(
          circuit.connect(user).submitJob(
            modelId,
            ethers.keccak256(ethers.toUtf8Bytes(`stress-in-${i}`)),
            { value: ethers.parseEther('0.01') }
          )
        );
        tasks.push(
          circuit.connect(user2).submitJob(
            modelId,
            ethers.keccak256(ethers.toUtf8Bytes(`stress-in-${i}-b`)),
            { value: ethers.parseEther('0.02') }
          )
        );
      }

      await Promise.all(tasks);

      const [jobCount, volume] = await circuit.getStats();
      expect(jobCount).to.equal(10n);
      expect(volume).to.equal(ethers.parseEther('0.15')); // 5*0.01 + 5*0.02
    });
  });
});
