/**
 * Theta Inference Circuit — Hardhat Tests (36 tests)
 *
 * Run: npx hardhat test circuits/theta-inference/test/ThetaInferenceCircuit.test.cjs
 *
 * Covers:
 *   - Service catalog (3 tests)
 *   - Intent submission (4 tests)
 *   - Intent lifecycle: complete → settle → fail (4 tests)
 *   - Fee mechanics and revenue splitter (2 tests)
 *   - Industry simulation: media AI, enterprise BI, healthcare (3 tests)
 *   - Edge cases and access control (2 tests)
 *   - Preset hooks & GPU tiers (5 tests)
 *   - One-click human flow simulation (3 tests)
 *   - Agent/M2M direct call simulation (2 tests)
 *   - Storefront polish: new presets, live pricing, full catalog (8 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ThetaInferenceCircuit', function () {
  let circuit, splitter;
  let admin, relayer, user, user2;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('THETA_INFERENCE_CIRCUIT'));
  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('llm-prompt-hash'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('llm-response-hash'));
  const MOCK_MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes('llama-3.1-70b-v1'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);

  // ServiceType enum mirrors contract
  const ServiceType = {
    LLM_INFERENCE: 0,
    IMAGE_GENERATION: 1,
    SPEECH_TO_TEXT: 2,
    VOICE_CLONING: 3,
    RAG_QUERY: 4,
    VIDEO_PROCESSING: 5,
    OBJECT_DETECTION: 6,
  };

  beforeEach(async function () {
    [admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const CircuitFactory = await ethers.getContractFactory('ThetaInferenceCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress // Mock ZK verifier
    );
    await circuit.waitForDeployment();

    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SERVICE CATALOG
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Service Catalog', function () {
    it('should register an LLM inference service', async function () {
      const tx = await circuit.registerService(
        ServiceType.LLM_INFERENCE,
        'llama-3.1-70b',
        ethers.parseEther('0.01'),
        5000 // 5s max latency
      );
      const receipt = await tx.wait();

      expect(await circuit.serviceCount()).to.equal(1n);

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'ServiceRegistered'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(event);
      expect(parsed.args.serviceType).to.equal(BigInt(ServiceType.LLM_INFERENCE));
      expect(parsed.args.modelName).to.equal('llama-3.1-70b');
    });

    it('should register all 7 service types', async function () {
      const serviceConfigs = [
        [ServiceType.LLM_INFERENCE, 'llama-3.1-70b', '0.01', 5000],
        [ServiceType.IMAGE_GENERATION, 'flux-schnell', '0.05', 10000],
        [ServiceType.SPEECH_TO_TEXT, 'whisper-large-v3', '0.005', 8000],
        [ServiceType.VOICE_CLONING, 'voice-clone-v1', '0.02', 12000],
        [ServiceType.RAG_QUERY, 'llama-rag-70b', '0.008', 6000],
        [ServiceType.VIDEO_PROCESSING, 'theta-transcode-v2', '0.1', 60000],
        [ServiceType.OBJECT_DETECTION, 'yolov8-xlarge', '0.003', 2000],
      ];

      for (const [type, name, price, latency] of serviceConfigs) {
        await circuit.registerService(type, name, ethers.parseEther(price), latency);
      }

      expect(await circuit.serviceCount()).to.equal(7n);
    });

    it('should update service pricing and deactivate', async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'test-model',
        ethers.parseEther('0.01'), 5000
      );
      const serviceId = await circuit.serviceIds(0);

      await circuit.updateService(serviceId, ethers.parseEther('0.02'), false);

      const svc = await circuit.getService(serviceId);
      expect(svc.pricePerCall).to.equal(ethers.parseEther('0.02'));
      expect(svc.active).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  INTENT SUBMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Intent Submission', function () {
    let serviceId;

    beforeEach(async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'llama-3.1-70b',
        ethers.parseEther('0.01'), 5000
      );
      serviceId = await circuit.serviceIds(0);
    });

    it('should submit an intent with proper fee deduction', async function () {
      const payment = ethers.parseEther('1.0');
      const expectedFee = ethers.parseEther('0.005'); // 0.5%

      const splitterAddr = await splitter.getAddress();
      const splitterBefore = await ethers.provider.getBalance(splitterAddr);

      const tx = await circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: payment });
      const receipt = await tx.wait();

      const splitterAfter = await ethers.provider.getBalance(splitterAddr);
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);

      expect(await circuit.intentCount()).to.equal(1n);
      expect(await circuit.totalVolume()).to.equal(payment);

      // Check InferenceIntentSubmitted event
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(event);
      expect(parsed.args.circuitId).to.equal(CIRCUIT_ID);
    });

    it('should reject payment below service price', async function () {
      await expect(
        circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: 100 })
      ).to.be.reverted;
    });

    it('should reject intent for inactive service', async function () {
      await circuit.updateService(serviceId, ethers.parseEther('0.01'), false);

      await expect(
        circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: ethers.parseEther('0.01') })
      ).to.be.reverted;
    });

    it('should track per-type call and volume metrics', async function () {
      await circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: ethers.parseEther('0.5') });
      await circuit.connect(user2).submitIntent(serviceId, MOCK_INPUT, { value: ethers.parseEther('0.3') });

      const [calls, volume] = await circuit.getTypeStats(ServiceType.LLM_INFERENCE);
      expect(calls).to.equal(2n);
      expect(volume).to.equal(ethers.parseEther('0.8'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  INTENT LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Intent Lifecycle', function () {
    let serviceId, intentId;

    beforeEach(async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'llama-3.1-70b',
        ethers.parseEther('0.01'), 5000
      );
      serviceId = await circuit.serviceIds(0);

      const tx = await circuit.connect(user).submitIntent(
        serviceId, MOCK_INPUT, { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      intentId = circuit.interface.parseLog(event).args.intentId;
    });

    it('should complete → settle an intent', async function () {
      // Complete
      await circuit.connect(relayer).completeIntent(
        intentId, MOCK_OUTPUT, MOCK_MODEL_HASH, 1200
      );

      let intent = await circuit.getIntent(intentId);
      expect(intent.status).to.equal(3); // Completed (enum index 3)
      expect(intent.outputHash).to.equal(MOCK_OUTPUT);
      expect(intent.latencyMs).to.equal(1200n);

      // Settle with ZK proof
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('theta-inf-null-1'));
      await circuit.connect(relayer).settleIntent(
        intentId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      intent = await circuit.getIntent(intentId);
      expect(intent.status).to.equal(5); // Settled (enum index 5)
      expect(intent.proofNullifier).to.equal(nullifier);
    });

    it('should reject settling without completion', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('theta-inf-null-2'));
      await expect(
        circuit.connect(relayer).settleIntent(
          intentId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });

    it('should reject duplicate nullifiers', async function () {
      await circuit.connect(relayer).completeIntent(
        intentId, MOCK_OUTPUT, MOCK_MODEL_HASH, 1200
      );

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('theta-inf-null-dup'));
      await circuit.connect(relayer).settleIntent(
        intentId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      // Submit + complete another intent
      const tx2 = await circuit.connect(user).submitIntent(
        serviceId, MOCK_INPUT, { value: ethers.parseEther('1.0') }
      );
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      const intentId2 = circuit.interface.parseLog(event2).args.intentId;

      await circuit.connect(relayer).completeIntent(
        intentId2, MOCK_OUTPUT, MOCK_MODEL_HASH, 1000
      );

      // Same nullifier should be rejected
      await expect(
        circuit.connect(relayer).settleIntent(
          intentId2, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });

    it('should fail an intent and refund requester', async function () {
      const userBefore = await ethers.provider.getBalance(user.address);

      await circuit.connect(relayer).failIntent(intentId, 'EdgeCloud API timeout');

      const intent = await circuit.getIntent(intentId);
      expect(intent.status).to.equal(4); // Failed (enum index 4)

      const userAfter = await ethers.provider.getBalance(user.address);
      expect(userAfter).to.be.gt(userBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  FEE MECHANICS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fee Mechanics', function () {
    it('should update fee BPS within allowed range', async function () {
      await circuit.setFee(25); // 0.25%
      expect(await circuit.feeBps()).to.equal(25);
    });

    it('should reject fee outside range', async function () {
      await expect(circuit.setFee(5)).to.be.reverted;  // Below 0.1%
      await expect(circuit.setFee(200)).to.be.reverted; // Above 1%
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  INDUSTRY SIMULATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Industry Simulations', function () {
    it('should simulate Media AI workflow (video + image + STT)', async function () {
      // Register media services
      await circuit.registerService(ServiceType.VIDEO_PROCESSING, 'theta-transcode-v2', ethers.parseEther('0.1'), 60000);
      await circuit.registerService(ServiceType.IMAGE_GENERATION, 'flux-schnell', ethers.parseEther('0.05'), 10000);
      await circuit.registerService(ServiceType.SPEECH_TO_TEXT, 'whisper-large-v3', ethers.parseEther('0.005'), 8000);

      const videoSvcId = await circuit.serviceIds(0);
      const imageSvcId = await circuit.serviceIds(1);
      const sttSvcId = await circuit.serviceIds(2);

      // Submit all three intents (media pipeline)
      const videoInput = ethers.keccak256(ethers.toUtf8Bytes('raw-video-data'));
      const imageInput = ethers.keccak256(ethers.toUtf8Bytes('thumbnail-prompt'));
      const audioInput = ethers.keccak256(ethers.toUtf8Bytes('audio-track'));

      await circuit.connect(user).submitIntent(videoSvcId, videoInput, { value: ethers.parseEther('0.1') });
      await circuit.connect(user).submitIntent(imageSvcId, imageInput, { value: ethers.parseEther('0.05') });
      await circuit.connect(user).submitIntent(sttSvcId, audioInput, { value: ethers.parseEther('0.005') });

      const [intents, volume] = await circuit.getStats();
      expect(intents).to.equal(3n);
      expect(volume).to.equal(ethers.parseEther('0.155'));
    });

    it('should simulate Enterprise BI workflow (LLM + RAG)', async function () {
      await circuit.registerService(ServiceType.LLM_INFERENCE, 'llama-3.1-405b', ethers.parseEther('0.05'), 15000);
      await circuit.registerService(ServiceType.RAG_QUERY, 'llama-rag-70b', ethers.parseEther('0.008'), 6000);

      const llmSvcId = await circuit.serviceIds(0);
      const ragSvcId = await circuit.serviceIds(1);

      // 5 LLM queries + 5 RAG queries from enterprise user
      for (let i = 0; i < 5; i++) {
        const input = ethers.keccak256(ethers.toUtf8Bytes(`bi-query-${i}`));
        await circuit.connect(user).submitIntent(llmSvcId, input, { value: ethers.parseEther('0.05') });
        await circuit.connect(user).submitIntent(ragSvcId, input, { value: ethers.parseEther('0.008') });
      }

      expect(await circuit.intentCount()).to.equal(10n);

      const [llmCalls] = await circuit.getTypeStats(ServiceType.LLM_INFERENCE);
      const [ragCalls] = await circuit.getTypeStats(ServiceType.RAG_QUERY);
      expect(llmCalls).to.equal(5n);
      expect(ragCalls).to.equal(5n);
    });

    it('should simulate Healthcare workflow (STT + Object Detection)', async function () {
      await circuit.registerService(ServiceType.SPEECH_TO_TEXT, 'whisper-medical', ethers.parseEther('0.01'), 8000);
      await circuit.registerService(ServiceType.OBJECT_DETECTION, 'medical-vision-v2', ethers.parseEther('0.02'), 3000);

      const sttSvcId = await circuit.serviceIds(0);
      const detSvcId = await circuit.serviceIds(1);

      // Transcribe + analyze medical images
      const audioInput = ethers.keccak256(ethers.toUtf8Bytes('patient-audio'));
      const imageInput = ethers.keccak256(ethers.toUtf8Bytes('xray-scan'));

      await circuit.connect(user).submitIntent(sttSvcId, audioInput, { value: ethers.parseEther('0.01') });
      await circuit.connect(user).submitIntent(detSvcId, imageInput, { value: ethers.parseEther('0.02') });

      const [sttCalls] = await circuit.getTypeStats(ServiceType.SPEECH_TO_TEXT);
      const [detCalls] = await circuit.getTypeStats(ServiceType.OBJECT_DETECTION);
      expect(sttCalls).to.equal(1n);
      expect(detCalls).to.equal(1n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Access Control', function () {
    it('should reject non-operator service registration', async function () {
      await expect(
        circuit.connect(user).registerService(
          ServiceType.LLM_INFERENCE, 'unauthorized', ethers.parseEther('0.01'), 5000
        )
      ).to.be.reverted;
    });

    it('should reject non-relayer settlement', async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'test', ethers.parseEther('0.01'), 5000
      );
      const serviceId = await circuit.serviceIds(0);

      const tx = await circuit.connect(user).submitIntent(
        serviceId, MOCK_INPUT, { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      const intentId = circuit.interface.parseLog(event).args.intentId;

      await circuit.connect(relayer).completeIntent(
        intentId, MOCK_OUTPUT, MOCK_MODEL_HASH, 1000
      );

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('null-auth'));
      await expect(
        circuit.connect(user).settleIntent(
          intentId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRESET HOOKS & GPU TIERS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Preset Hooks & GPU Tiers', function () {
    it('should register a preset hook', async function () {
      const tx = await circuit.registerPreset(
        'Quick Llama 3.1',
        ServiceType.LLM_INFERENCE,
        'llama-3.1-8b',
        0, // GpuTier.RTX_4090
        'Hello, summarize the latest AI research.'
      );
      const receipt = await tx.wait();

      expect(await circuit.presetCount()).to.equal(1n);

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PresetRegistered'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(event);
      expect(parsed.args.name).to.equal('Quick Llama 3.1');
      expect(parsed.args.defaultGpu).to.equal(0n); // RTX_4090
    });

    it('should return correct GPU price multipliers', async function () {
      const rtx = await circuit.getGpuMultiplier(0); // RTX_4090
      const a100 = await circuit.getGpuMultiplier(1); // A100
      const h100 = await circuit.getGpuMultiplier(2); // H100

      expect(rtx).to.equal(10000n);  // 1x
      expect(a100).to.equal(25000n); // 2.5x
      expect(h100).to.equal(50000n); // 5x
    });

    it('should calculate effective price with GPU multiplier', async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'llama-3.1-70b',
        ethers.parseEther('0.01'), 5000
      );
      const serviceId = await circuit.serviceIds(0);

      const priceRtx = await circuit.getEffectivePrice(serviceId, 0);
      const priceA100 = await circuit.getEffectivePrice(serviceId, 1);
      const priceH100 = await circuit.getEffectivePrice(serviceId, 2);

      expect(priceRtx).to.equal(ethers.parseEther('0.01'));   // 1x
      expect(priceA100).to.equal(ethers.parseEther('0.025')); // 2.5x
      expect(priceH100).to.equal(ethers.parseEther('0.05'));   // 5x
    });

    it('should update GPU multiplier within allowed range', async function () {
      await circuit.setGpuMultiplier(2, 60000); // H100 → 6x
      expect(await circuit.getGpuMultiplier(2)).to.equal(60000n);
    });

    it('should reject GPU multiplier outside range', async function () {
      await expect(circuit.setGpuMultiplier(0, 1000)).to.be.reverted;   // Below 0.5x
      await expect(circuit.setGpuMultiplier(0, 300000)).to.be.reverted; // Above 20x
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ONE-CLICK PRESET INTENT FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  describe('One-Click Preset Intent Flow', function () {
    let serviceId, presetId;

    beforeEach(async function () {
      await circuit.registerService(
        ServiceType.LLM_INFERENCE, 'llama-3.1-8b',
        ethers.parseEther('0.01'), 5000
      );
      serviceId = await circuit.serviceIds(0);

      const tx = await circuit.registerPreset(
        'Quick Llama 3.1',
        ServiceType.LLM_INFERENCE,
        'llama-3.1-8b',
        0, // RTX_4090
        'Hello, summarize the latest AI research.'
      );
      await tx.wait();
      presetId = await circuit.presetIds(0);
    });

    it('should submit preset intent with RTX 4090 (1x price)', async function () {
      const payment = ethers.parseEther('0.01'); // base price * 1x

      const tx = await circuit.connect(user).submitPresetIntent(
        presetId, 0, serviceId, MOCK_INPUT, { value: payment }
      );
      const receipt = await tx.wait();

      expect(await circuit.intentCount()).to.equal(1n);

      // Check both events were emitted
      const inferenceEvent = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      expect(inferenceEvent).to.not.be.undefined;

      const presetEvent = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'PresetIntentSubmitted'; }
        catch { return false; }
      });
      expect(presetEvent).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(presetEvent);
      expect(parsed.args.presetId).to.equal(presetId);
      expect(parsed.args.gpuTier).to.equal(0n); // RTX_4090
    });

    it('should submit "Need Bigger GPU" preset with H100 (5x price)', async function () {
      // Register H100 preset
      const tx2 = await circuit.registerPreset(
        'Need Bigger GPU',
        ServiceType.LLM_INFERENCE,
        'llama-3.1-405b',
        2, // H100
        'Analyze complex dataset.'
      );
      await tx2.wait();
      const bigPresetId = await circuit.presetIds(1);

      const h100Price = ethers.parseEther('0.05'); // 0.01 * 5x

      const tx = await circuit.connect(user).submitPresetIntent(
        bigPresetId, 2, serviceId, MOCK_INPUT, { value: h100Price }
      );
      await tx.wait();

      expect(await circuit.intentCount()).to.equal(1n);
      expect(await circuit.totalVolume()).to.equal(h100Price);
    });

    it('should reject preset intent with insufficient payment for GPU tier', async function () {
      // RTX_4090 needs 0.01 ETH, but H100 needs 0.05 ETH
      await expect(
        circuit.connect(user).submitPresetIntent(
          presetId, 2, serviceId, MOCK_INPUT,
          { value: ethers.parseEther('0.01') } // Too low for H100
        )
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  AGENT / M2M DIRECT CALL SIMULATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Agent / M2M Direct Calls', function () {
    let serviceId, presetId;

    beforeEach(async function () {
      await circuit.registerService(
        ServiceType.RAG_QUERY, 'llama-rag-70b',
        ethers.parseEther('0.008'), 6000
      );
      serviceId = await circuit.serviceIds(0);

      const tx = await circuit.registerPreset(
        'Enterprise RAG',
        ServiceType.RAG_QUERY,
        'llama-rag-70b',
        1, // A100
        'Query knowledge base.'
      );
      await tx.wait();
      presetId = await circuit.presetIds(0);
    });

    it('should process agent intent: Enterprise RAG on A100', async function () {
      const a100Price = ethers.parseEther('0.02'); // 0.008 * 2.5x

      const agentInput = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
        preset: 'ENTERPRISE_RAG',
        gpu_tier: 'A100',
        prompt: 'Query compliance data for Q4 2025.',
        sender: user.address,
      })));

      const tx = await circuit.connect(user).submitPresetIntent(
        presetId, 1, serviceId, agentInput, { value: a100Price }
      );
      const receipt = await tx.wait();

      // Verify full lifecycle is triggered
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(event);
      expect(parsed.args.circuitId).to.equal(CIRCUIT_ID);

      // Complete + settle (simulating handler flow)
      const intentId = parsed.args.intentId;
      await circuit.connect(relayer).completeIntent(
        intentId, MOCK_OUTPUT, MOCK_MODEL_HASH, 850
      );

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('agent-rag-null'));
      await circuit.connect(relayer).settleIntent(
        intentId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      const intent = await circuit.getIntent(intentId);
      expect(intent.status).to.equal(5); // Settled
    });

    it('should handle batch agent intents across GPU tiers', async function () {
      // Simulate an agent submitting 3 intents with different GPU tiers
      const tiers = [0, 1, 2]; // RTX_4090, A100, H100
      const prices = ['0.008', '0.02', '0.04']; // 1x, 2.5x, 5x of 0.008

      for (let i = 0; i < 3; i++) {
        const input = ethers.keccak256(ethers.toUtf8Bytes(`agent-batch-${i}`));
        await circuit.connect(user).submitPresetIntent(
          presetId, tiers[i], serviceId, input,
          { value: ethers.parseEther(prices[i]) }
        );
      }

      expect(await circuit.intentCount()).to.equal(3n);
      const [ragCalls] = await circuit.getTypeStats(ServiceType.RAG_QUERY);
      expect(ragCalls).to.equal(3n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  STOREFRONT POLISH — New Presets, Live Pricing, Full Catalog
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Storefront Polish — 8 New Presets', function () {
    let llmServiceId, imageServiceId, sttServiceId, videoServiceId, detServiceId, ragServiceId;

    beforeEach(async function () {
      await circuit.registerService(ServiceType.LLM_INFERENCE, 'llama-3.1-8b', ethers.parseEther('0.01'), 5000);
      await circuit.registerService(ServiceType.IMAGE_GENERATION, 'flux-dev', ethers.parseEther('0.05'), 10000);
      await circuit.registerService(ServiceType.SPEECH_TO_TEXT, 'whisper-large-v3', ethers.parseEther('0.005'), 8000);
      await circuit.registerService(ServiceType.VIDEO_PROCESSING, 'theta-transcode-v2', ethers.parseEther('0.1'), 60000);
      await circuit.registerService(ServiceType.OBJECT_DETECTION, 'yolov8-xlarge', ethers.parseEther('0.003'), 2000);
      await circuit.registerService(ServiceType.RAG_QUERY, 'llama-rag-70b', ethers.parseEther('0.008'), 6000);

      llmServiceId = await circuit.serviceIds(0);
      imageServiceId = await circuit.serviceIds(1);
      sttServiceId = await circuit.serviceIds(2);
      videoServiceId = await circuit.serviceIds(3);
      detServiceId = await circuit.serviceIds(4);
      ragServiceId = await circuit.serviceIds(5);
    });

    it('should register Transcribe+Summarize preset and submit intent', async function () {
      const tx = await circuit.registerPreset('Transcribe+Summarize', ServiceType.SPEECH_TO_TEXT, 'whisper-large-v3', 1, '');
      await tx.wait();
      const presetId = await circuit.presetIds(0);
      const a100Price = ethers.parseEther('0.0125'); // 0.005 * 2.5x
      await circuit.connect(user).submitPresetIntent(presetId, 1, sttServiceId, MOCK_INPUT, { value: a100Price });
      expect(await circuit.intentCount()).to.equal(1n);
    });

    it('should register Video Transcode preset on RTX 4090', async function () {
      const tx = await circuit.registerPreset('Video Transcode', ServiceType.VIDEO_PROCESSING, 'theta-transcode-v2', 0, '');
      await tx.wait();
      const presetId = await circuit.presetIds(0);
      await circuit.connect(user).submitPresetIntent(presetId, 0, videoServiceId, MOCK_INPUT, { value: ethers.parseEther('0.1') });
      const [videoCalls] = await circuit.getTypeStats(ServiceType.VIDEO_PROCESSING);
      expect(videoCalls).to.equal(1n);
    });

    it('should register NFT DRM Guard preset on A100', async function () {
      const tx = await circuit.registerPreset('NFT DRM Guard', ServiceType.VIDEO_PROCESSING, 'theta-drm-v1', 1, '');
      await tx.wait();
      const presetId = await circuit.presetIds(0);
      const a100Price = ethers.parseEther('0.25'); // 0.1 * 2.5x
      await circuit.connect(user).submitPresetIntent(presetId, 1, videoServiceId, MOCK_INPUT, { value: a100Price });
      expect(await circuit.intentCount()).to.equal(1n);
    });

    it('should register Jupyter Notebook preset', async function () {
      const tx = await circuit.registerPreset('Jupyter Notebook', ServiceType.LLM_INFERENCE, 'llama-3.1-8b', 0, 'Launch Jupyter');
      await tx.wait();
      const preset = await circuit.getPreset(await circuit.presetIds(0));
      expect(preset.name).to.equal('Jupyter Notebook');
      expect(preset.defaultGpu).to.equal(0n);
    });

    it('should register Object Detector preset and return effective price', async function () {
      await circuit.registerPreset('Object Detector', ServiceType.OBJECT_DETECTION, 'yolov8', 0, '');
      const price = await circuit.getEffectivePrice(detServiceId, 0);
      expect(price).to.equal(ethers.parseEther('0.003'));
      const h100Price = await circuit.getEffectivePrice(detServiceId, 2);
      expect(h100Price).to.equal(ethers.parseEther('0.015'));
    });

    it('should register AI Agent Builder preset on H100', async function () {
      const tx = await circuit.registerPreset('AI Agent Builder', ServiceType.RAG_QUERY, 'llama-rag-70b', 2, 'Monitor DeFi');
      await tx.wait();
      const presetId = await circuit.presetIds(0);
      const h100Price = ethers.parseEther('0.04'); // 0.008 * 5x
      await circuit.connect(user).submitPresetIntent(presetId, 2, ragServiceId, MOCK_INPUT, { value: h100Price });
      expect(await circuit.intentCount()).to.equal(1n);
    });

    it('should register HD Image Pro preset on H100', async function () {
      const tx = await circuit.registerPreset('HD Image Pro', ServiceType.IMAGE_GENERATION, 'flux-dev', 2, 'Photorealistic portrait');
      await tx.wait();
      const presetId = await circuit.presetIds(0);
      const h100Price = ethers.parseEther('0.25'); // 0.05 * 5x
      await circuit.connect(user).submitPresetIntent(presetId, 2, imageServiceId, MOCK_INPUT, { value: h100Price });
      expect(await circuit.intentCount()).to.equal(1n);
    });

    it('should register GPU Training Job and verify live pricing across all tiers', async function () {
      await circuit.registerPreset('GPU Training Job', ServiceType.LLM_INFERENCE, 'llama-3.1-70b', 2, 'Fine-tune');

      const priceRtx = await circuit.getEffectivePrice(llmServiceId, 0);
      const priceA100 = await circuit.getEffectivePrice(llmServiceId, 1);
      const priceH100 = await circuit.getEffectivePrice(llmServiceId, 2);

      expect(priceRtx).to.equal(ethers.parseEther('0.01'));
      expect(priceA100).to.equal(ethers.parseEther('0.025'));
      expect(priceH100).to.equal(ethers.parseEther('0.05'));

      expect(await circuit.presetCount()).to.equal(1n);
    });
  });
});
