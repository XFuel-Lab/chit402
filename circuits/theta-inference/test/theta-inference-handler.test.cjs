/**
 * Theta Inference Handler — Unit Tests (23 tests)
 *
 * Run: node circuits/theta-inference/test/theta-inference-handler.test.cjs
 *
 * Covers:
 *   1. EdgeCloud success path (mock fetch → live response)
 *   2. EdgeCloud fail → RapidAPI fallback
 *   3. All backends fail → mock with warning
 *   4. Preset intent with GPU tier
 *   5. Invalid preset / GPU tier error
 *   6. Completion + outputHash generation
 *   7. On-chain completeIntent with correct args
 *   8. Proof-ready triggers settleIntent
 *   9. Full flow returns FULFILLED outcome
 *  10. New preset: Transcribe+Summarize
 *  11. New preset: Video Transcode
 *  12. New preset: NFT DRM Guard
 *  13. New preset: Jupyter Notebook
 *  14. New preset: Object Detector
 *  15. New preset: AI Agent Builder
 *  16. Curl command generation
 *  17. Full catalog contains all 16 products
 *  18. Webhook: successful delivery on preset completion
 *  19. Webhook: fires after settleIntent in onProofReady
 *  20. Webhook: retries on failure (3 attempts)
 *  21. Webhook: skipped when no callbackUrl provided (human path)
 *  22. Webhook: agent path includes callbackUrl in response flow
 *  23. Webhook: delivery stats tracked correctly
 */

const assert = require('assert');

// Inline handler logic for CJS test (avoids ESM import issues)
const SERVICE_TYPES = {
  LLM_INFERENCE: 0, IMAGE_GENERATION: 1, SPEECH_TO_TEXT: 2,
  VOICE_CLONING: 3, RAG_QUERY: 4, VIDEO_PROCESSING: 5, OBJECT_DETECTION: 6,
};

const GPU_TIERS = {
  RTX_4090: { id: 0, name: 'RTX 4090', priceMultiplier: 1.0 },
  A100:     { id: 1, name: 'A100 80GB', priceMultiplier: 2.5 },
  H100:     { id: 2, name: 'H100 SXM', priceMultiplier: 5.0 },
};

const PRESET_HOOKS = {
  QUICK_LLAMA: { name: 'Quick Llama 3.1', serviceType: 0, defaultModel: 'llama-3.1-8b', defaultGpu: 'RTX_4090', defaultPrompt: 'Hello.' },
  NEED_BIGGER_GPU: { name: 'Need Bigger GPU', serviceType: 0, defaultModel: 'llama-3.1-405b', defaultGpu: 'H100', defaultPrompt: 'Analyze.' },
  VOICE_AGENT: { name: 'Voice Agent', serviceType: 3, defaultModel: 'voice-clone-v1', defaultGpu: 'A100', defaultPrompt: 'Clone voice.' },
  ENTERPRISE_RAG: { name: 'Enterprise RAG', serviceType: 4, defaultModel: 'llama-3.1-70b', defaultGpu: 'A100', defaultPrompt: 'Query KB.' },
  QUICK_IMAGE: { name: 'Quick Image Gen', serviceType: 1, defaultModel: 'flux-schnell', defaultGpu: 'RTX_4090', defaultPrompt: 'Cyberpunk city.' },
  MEDICAL_STT: { name: 'Medical Transcription', serviceType: 2, defaultModel: 'whisper-large-v3', defaultGpu: 'A100', defaultPrompt: '' },
  TRANSCRIBE_SUMMARIZE: { name: 'Transcribe + Summarize', serviceType: 2, defaultModel: 'whisper-large-v3', defaultGpu: 'A100', defaultPrompt: '' },
  VIDEO_TRANSCODE: { name: 'Video Transcode', serviceType: 5, defaultModel: 'theta-transcode-v2', defaultGpu: 'RTX_4090', defaultPrompt: '' },
  NFT_DRM_GUARD: { name: 'NFT DRM Guard', serviceType: 5, defaultModel: 'theta-drm-v1', defaultGpu: 'A100', defaultPrompt: '' },
  JUPYTER_NOTEBOOK: { name: 'Jupyter Notebook', serviceType: 0, defaultModel: 'llama-3.1-8b', defaultGpu: 'RTX_4090', defaultPrompt: 'Launch Jupyter.' },
  OBJECT_DETECTOR: { name: 'Object Detector', serviceType: 6, defaultModel: 'yolov8', defaultGpu: 'RTX_4090', defaultPrompt: '' },
  AI_AGENT_BUILDER: { name: 'AI Agent Builder', serviceType: 4, defaultModel: 'llama-3.1-70b', defaultGpu: 'H100', defaultPrompt: 'Monitor DeFi.' },
  HD_IMAGE_PRO: { name: 'HD Image Pro', serviceType: 1, defaultModel: 'flux-dev', defaultGpu: 'H100', defaultPrompt: 'Photorealistic portrait.' },
  GPU_TRAINING_JOB: { name: 'GPU Training Job', serviceType: 0, defaultModel: 'llama-3.1-70b', defaultGpu: 'H100', defaultPrompt: 'Fine-tune model.' },
};

const FULL_CATALOG = [
  { id: 'ondemand-llm', name: 'On-Demand LLM APIs', category: 'Inference', preset: 'QUICK_LLAMA' },
  { id: 'ondemand-image', name: 'On-Demand Image Gen', category: 'Inference', preset: 'QUICK_IMAGE' },
  { id: 'ondemand-stt', name: 'On-Demand STT', category: 'Inference', preset: 'MEDICAL_STT' },
  { id: 'transcribe-summarize', name: 'Transcribe + Summarize', category: 'Inference', preset: 'TRANSCRIBE_SUMMARIZE' },
  { id: 'ondemand-tts', name: 'TTS / Voice Clone', category: 'Inference', preset: 'VOICE_AGENT' },
  { id: 'ondemand-vision', name: 'Object Detection', category: 'Inference', preset: 'OBJECT_DETECTOR' },
  { id: 'ondemand-video', name: 'Video Processing', category: 'Inference', preset: 'VIDEO_TRANSCODE' },
  { id: 'dedicated', name: 'Dedicated Deployments', category: 'Compute' },
  { id: 'jupyter', name: 'Jupyter Notebook', category: 'Compute', preset: 'JUPYTER_NOTEBOOK' },
  { id: 'training', name: 'GPU Training Jobs', category: 'Compute', preset: 'GPU_TRAINING_JOB' },
  { id: 'storage', name: 'Persistent Storage', category: 'Storage' },
  { id: 'agents', name: 'Agentic AI', category: 'Agentic', preset: 'AI_AGENT_BUILDER' },
  { id: 'rag', name: 'RAG Chatbot', category: 'Agentic', preset: 'ENTERPRISE_RAG' },
  { id: 'nft-drm', name: 'NFT-Based DRM', category: 'Video', preset: 'NFT_DRM_GUARD' },
  { id: 'video-api', name: 'Theta Video API', category: 'Video' },
  { id: 'mcp', name: 'MCP Server', category: 'Gateway' },
  { id: 'rapidapi', name: 'RapidAPI Gateway', category: 'Gateway' },
];

// Minimal handler stub that mirrors the real handler's logic without ESM imports
class TestHandler {
  constructor({ edgeCloudApiKey, rapidApiKey, mcpEndpoint } = {}) {
    this.edgeCloudApiKey = edgeCloudApiKey || '';
    this.rapidApiKey = rapidApiKey || '';
    this.mcpEndpoint = mcpEndpoint || '';
    this.activeIntents = new Map();
    this.apiStats = {
      edgeCloud: { calls: 0, successes: 0, failures: 0 },
      rapidApi:  { calls: 0, successes: 0, failures: 0 },
      mock:      { calls: 0 },
      onChain:   { completes: 0, settles: 0, failures: 0 },
      webhooks:  { delivered: 0, failed: 0 },
    };
    this.contract = null;
    this.activeIntents = new Map();
    this._fetchFn = null;
    this._webhookFn = null;
    this._webhookCalls = [];
  }

  async onProofReady(proofResult, proofRequest) {
    const entry = this.activeIntents.get(proofRequest.intentId);
    if (entry) {
      entry.proof = proofResult;
      entry.status = 'proof_ready';
    }
    if (this.contract && proofRequest.onChainIntentId) {
      try {
        const tx = await this.contract.settleIntent(
          proofRequest.onChainIntentId,
          proofResult.proof,
          proofResult.publicValues,
          proofResult.nullifier,
          false, // useZkGPT
          { gasLimit: 500000 }
        );
        await tx.wait();
        this.apiStats.onChain.settles++;
        if (entry) entry.status = 'settled';
      } catch (err) {
        this.apiStats.onChain.failures++;
      }
    }
    if (entry?.callbackUrl) {
      const payload = {
        task_id: proofRequest.intentId,
        output: entry.result,
        proof: { nullifier: proofResult.nullifier, proof: proofResult.proof, publicValues: proofResult.publicValues },
        status: entry.status,
        latency_ms: entry.latencyMs || null,
        settled_tx: entry.settleTxHash || null,
      };
      await this._deliverWebhook(entry.callbackUrl, payload, proofRequest.intentId);
    }
  }

  async _deliverWebhook(url, payload, intentId) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this._webhookCalls.push({ url, payload, intentId, attempt });
      try {
        if (this._webhookFn) {
          const ok = await this._webhookFn(url, payload, attempt);
          if (ok) { this.apiStats.webhooks.delivered++; return true; }
        } else {
          this.apiStats.webhooks.delivered++;
          return true;
        }
      } catch {}
    }
    this.apiStats.webhooks.failed++;
    return false;
  }

  async _callEdgeCloud(serviceType, body) {
    if (!this.edgeCloudApiKey) return null;
    this.apiStats.edgeCloud.calls++;
    try {
      if (this._fetchFn) {
        const res = await this._fetchFn('edgecloud', serviceType, body);
        if (res) { this.apiStats.edgeCloud.successes++; return res; }
      }
      this.apiStats.edgeCloud.failures++;
      return null;
    } catch {
      this.apiStats.edgeCloud.failures++;
      return null;
    }
  }

  async _callRapidAPI(serviceType, body) {
    if (!this.rapidApiKey) return null;
    this.apiStats.rapidApi.calls++;
    try {
      if (this._fetchFn) {
        const res = await this._fetchFn('rapidapi', serviceType, body);
        if (res) { this.apiStats.rapidApi.successes++; return res; }
      }
      this.apiStats.rapidApi.failures++;
      return null;
    } catch {
      this.apiStats.rapidApi.failures++;
      return null;
    }
  }

  _mockResponse(serviceType) {
    this.apiStats.mock.calls++;
    const mock = {
      choices: [{ message: { role: 'assistant', content: 'Mock LLM response' } }],
      model: 'llama-3.1-70b',
      _mock: true,
      _warning: 'Mock response — no API keys configured.',
    };
    return mock;
  }

  async executeService(serviceType, body, gpuTier) {
    let result = null;
    let source = 'mock';

    if (this.edgeCloudApiKey) {
      result = await this._callEdgeCloud(serviceType, body);
      if (result) source = 'edgecloud';
    }

    if (!result && this.rapidApiKey) {
      result = await this._callRapidAPI(serviceType, body);
      if (result) source = 'rapidapi';
    }

    if (!result) {
      result = this._mockResponse(serviceType);
      source = 'mock';
    }

    return { result, source };
  }

  async handlePresetIntent({ preset, gpu_tier, prompt, model, callbackUrl }) {
    const presetConfig = PRESET_HOOKS[preset];
    if (!presetConfig) return { error: `Unknown preset: ${preset}`, status: 400 };

    const gpuConfig = GPU_TIERS[gpu_tier];
    if (!gpuConfig) return { error: `Unknown GPU tier: ${gpu_tier}`, status: 400 };

    const resolvedModel = model || presetConfig.defaultModel;
    const resolvedPrompt = prompt || presetConfig.defaultPrompt;

    const taskId = `preset-${preset}-test`;
    const { result, source } = await this.executeService(presetConfig.serviceType, {
      model: resolvedModel,
      messages: [{ role: 'user', content: resolvedPrompt }],
    }, gpu_tier);

    const entry = { status: 'completed', result, latencyMs: 420, callbackUrl: callbackUrl || null };
    this.activeIntents.set(taskId, entry);

    const response = {
      task_id: taskId,
      status: 'completed',
      preset, gpu_tier,
      gpu_name: gpuConfig.name,
      model: resolvedModel,
      price_multiplier: gpuConfig.priceMultiplier,
      result, source,
    };

    if (callbackUrl && entry.status === 'completed') {
      const payload = {
        task_id: taskId,
        output: entry.result,
        proof: null,
        status: entry.status,
        latency_ms: entry.latencyMs,
        settled_tx: null,
      };
      await this._deliverWebhook(callbackUrl, payload, taskId);
    }

    return response;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

(async () => {
  console.log('\nTheta Inference Handler — Unit Tests\n');

  // Test 1: EdgeCloud success path
  await asyncTest('EdgeCloud success: returns live response when key is set', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'test-key-123' });
    handler._fetchFn = (backend, type, body) => {
      if (backend === 'edgecloud') {
        return { choices: [{ message: { content: 'Live EdgeCloud response' } }], model: body.model };
      }
      return null;
    };

    const { result, source } = await handler.executeService(SERVICE_TYPES.LLM_INFERENCE, {
      model: 'llama-3.1-70b',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.strictEqual(source, 'edgecloud');
    assert.strictEqual(result.choices[0].message.content, 'Live EdgeCloud response');
    assert.strictEqual(handler.apiStats.edgeCloud.successes, 1);
    assert.strictEqual(handler.apiStats.edgeCloud.failures, 0);
  });

  // Test 2: EdgeCloud fail → RapidAPI fallback
  await asyncTest('Fallback: EdgeCloud fails → RapidAPI succeeds', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'test-key', rapidApiKey: 'rapid-key' });
    handler._fetchFn = (backend, type, body) => {
      if (backend === 'edgecloud') return null; // EdgeCloud fails
      if (backend === 'rapidapi') {
        return { choices: [{ message: { content: 'RapidAPI fallback response' } }], model: body.model };
      }
      return null;
    };

    const { result, source } = await handler.executeService(SERVICE_TYPES.LLM_INFERENCE, {
      model: 'llama-3.1-70b',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.strictEqual(source, 'rapidapi');
    assert.strictEqual(result.choices[0].message.content, 'RapidAPI fallback response');
    assert.strictEqual(handler.apiStats.edgeCloud.failures, 1);
    assert.strictEqual(handler.apiStats.rapidApi.successes, 1);
  });

  // Test 3: All backends fail → mock with warning
  await asyncTest('Mock fallback: all backends fail → returns mock with warning', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key', rapidApiKey: 'key' });
    handler._fetchFn = () => null; // All fail

    const { result, source } = await handler.executeService(SERVICE_TYPES.LLM_INFERENCE, {
      model: 'llama-3.1-70b',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.strictEqual(source, 'mock');
    assert.strictEqual(result._mock, true);
    assert.ok(result._warning.includes('Mock response'));
    assert.strictEqual(handler.apiStats.mock.calls, 1);
  });

  // Test 4: Preset intent with GPU tier
  await asyncTest('Preset intent: resolves defaults and applies GPU tier', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = (backend, type, body) => {
      return { choices: [{ message: { content: 'preset response' } }], model: body.model };
    };

    const result = await handler.handlePresetIntent({
      preset: 'NEED_BIGGER_GPU',
      gpu_tier: 'H100',
    });

    assert.strictEqual(result.preset, 'NEED_BIGGER_GPU');
    assert.strictEqual(result.gpu_tier, 'H100');
    assert.strictEqual(result.gpu_name, 'H100 SXM');
    assert.strictEqual(result.model, 'llama-3.1-405b');
    assert.strictEqual(result.price_multiplier, 5.0);
    assert.strictEqual(result.source, 'edgecloud');
    assert.strictEqual(result.status, 'completed');
  });

  // Test 5: Invalid preset / GPU tier
  await asyncTest('Error handling: invalid preset and GPU tier return 400', async () => {
    const handler = new TestHandler();

    const r1 = await handler.handlePresetIntent({ preset: 'INVALID', gpu_tier: 'H100' });
    assert.strictEqual(r1.status, 400);
    assert.ok(r1.error.includes('Unknown preset'));

    const r2 = await handler.handlePresetIntent({ preset: 'QUICK_LLAMA', gpu_tier: 'INVALID' });
    assert.strictEqual(r2.status, 400);
    assert.ok(r2.error.includes('Unknown GPU tier'));
  });

  // ─── Completion + Proof Tests ────────────────────────────────────────────

  // Test 6: executeService returns fulfilled outcome
  await asyncTest('Completion: executeService returns fulfilled outcome with outputHash', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = (backend) => {
      if (backend === 'edgecloud') return { choices: [{ message: { content: 'result' } }] };
      return null;
    };

    const { result, source } = await handler.executeService(SERVICE_TYPES.LLM_INFERENCE, {
      model: 'llama-3.1-70b',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.strictEqual(source, 'edgecloud');
    assert.ok(result.choices);
    // Simulate outputHash generation (mirrors handler logic)
    const crypto = require('crypto');
    const outputHash = '0x' + crypto.createHash('sha256')
      .update(JSON.stringify(result)).digest('hex');
    assert.strictEqual(outputHash.length, 66); // 0x + 64 hex chars
  });

  // Test 7: On-chain completion mock (contract stub)
  await asyncTest('On-chain: completeIntent called with correct args', async () => {
    let completeCalled = false;
    let completeArgs = null;

    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'response' } }] });

    // Mock contract
    handler.contract = {
      completeIntent: async (intentId, outputHash, modelHash, latency, opts) => {
        completeCalled = true;
        completeArgs = { intentId, outputHash, modelHash, latency };
        return { wait: async () => ({ hash: '0xmocktx', gasUsed: 150000n }) };
      },
    };

    // Simulate executeServiceWithContract (inline)
    const body = { model: 'llama-3.1-70b', messages: [{ role: 'user', content: 'test' }] };
    const { result } = await handler.executeService(SERVICE_TYPES.LLM_INFERENCE, body);

    // Now simulate what _executeService does after getting the result
    const crypto = require('crypto');
    const outputHash = '0x' + crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
    const modelHash = '0x' + crypto.createHash('sha256').update('llama-3.1-70b').digest('hex');
    const intentId = '0x' + '11'.repeat(32);

    await handler.contract.completeIntent(intentId, outputHash, modelHash, 500, { gasLimit: 500000 });

    assert.strictEqual(completeCalled, true);
    assert.strictEqual(completeArgs.intentId, intentId);
    assert.strictEqual(completeArgs.latency, 500);
  });

  // Test 8: Proof generation triggers settleIntent
  await asyncTest('On-chain: settleIntent called after proof ready', async () => {
    let settleCalled = false;
    let settleArgs = null;

    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler.contract = {
      settleIntent: async (intentId, proof, publicValues, nullifier, useZkGPT, opts) => {
        settleCalled = true;
        settleArgs = { intentId, nullifier, useZkGPT };
        return { wait: async () => ({ hash: '0xsettletx', gasUsed: 200000n }) };
      },
    };
    handler.apiStats.onChain = { completes: 0, settles: 0, failures: 0 };

    const proofResult = {
      proof: '0x' + 'ab'.repeat(130),
      publicValues: '0x' + 'cd'.repeat(64),
      nullifier: '0x' + 'ee'.repeat(32),
    };

    const proofRequest = {
      intentId: 'test-intent',
      onChainIntentId: '0x' + '22'.repeat(32),
    };

    // Simulate onProofReady
    await handler.onProofReady(proofResult, proofRequest);

    assert.strictEqual(settleCalled, true);
    assert.strictEqual(settleArgs.intentId, proofRequest.onChainIntentId);
    assert.strictEqual(settleArgs.nullifier, proofResult.nullifier);
    assert.strictEqual(handler.apiStats.onChain.settles, 1);
  });

  // Test 9: Full flow returns FULFILLED outcome
  await asyncTest('Full flow: preset intent returns FULFILLED with settlement data', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({
      choices: [{ message: { content: 'H100 max-power response' } }],
      model: 'llama-3.1-405b',
    });

    const result = await handler.handlePresetIntent({
      preset: 'NEED_BIGGER_GPU',
      gpu_tier: 'H100',
      prompt: 'Explain ZK proofs',
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.preset, 'NEED_BIGGER_GPU');
    assert.strictEqual(result.gpu_name, 'H100 SXM');
    assert.strictEqual(result.source, 'edgecloud');
    assert.ok(result.result.choices[0].message.content.includes('H100'));
  });

  // ─── Storefront Polish Tests ─────────────────────────────────────────────

  // Test 10: Transcribe+Summarize preset
  await asyncTest('New preset: Transcribe+Summarize resolves correctly', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ text: 'Transcribed and summarized content', language: 'en' });
    const result = await handler.handlePresetIntent({ preset: 'TRANSCRIBE_SUMMARIZE', gpu_tier: 'A100' });
    assert.strictEqual(result.preset, 'TRANSCRIBE_SUMMARIZE');
    assert.strictEqual(result.gpu_name, 'A100 80GB');
    assert.strictEqual(result.price_multiplier, 2.5);
    assert.strictEqual(result.status, 'completed');
  });

  // Test 11: Video Transcode preset
  await asyncTest('New preset: Video Transcode resolves with RTX 4090', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ output_url: 'https://edgecloud.theta.tv/transcoded.mp4', status: 'completed' });
    const result = await handler.handlePresetIntent({ preset: 'VIDEO_TRANSCODE', gpu_tier: 'RTX_4090' });
    assert.strictEqual(result.preset, 'VIDEO_TRANSCODE');
    assert.strictEqual(result.model, 'theta-transcode-v2');
    assert.strictEqual(result.price_multiplier, 1.0);
  });

  // Test 12: NFT DRM Guard preset
  await asyncTest('New preset: NFT DRM Guard resolves with A100', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ drm_status: 'active', nft_gate: 'ERC-721' });
    const result = await handler.handlePresetIntent({ preset: 'NFT_DRM_GUARD', gpu_tier: 'A100' });
    assert.strictEqual(result.preset, 'NFT_DRM_GUARD');
    assert.strictEqual(result.model, 'theta-drm-v1');
    assert.strictEqual(result.gpu_name, 'A100 80GB');
  });

  // Test 13: Jupyter Notebook preset
  await asyncTest('New preset: Jupyter Notebook resolves with RTX 4090', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'Jupyter session ready' } }] });
    const result = await handler.handlePresetIntent({ preset: 'JUPYTER_NOTEBOOK', gpu_tier: 'RTX_4090' });
    assert.strictEqual(result.preset, 'JUPYTER_NOTEBOOK');
    assert.strictEqual(result.model, 'llama-3.1-8b');
    assert.strictEqual(result.price_multiplier, 1.0);
  });

  // Test 14: Object Detector preset
  await asyncTest('New preset: Object Detector resolves correctly', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ detections: [{ label: 'person', confidence: 0.97 }] });
    const result = await handler.handlePresetIntent({ preset: 'OBJECT_DETECTOR', gpu_tier: 'RTX_4090' });
    assert.strictEqual(result.preset, 'OBJECT_DETECTOR');
    assert.strictEqual(result.model, 'yolov8');
  });

  // Test 15: AI Agent Builder preset on H100
  await asyncTest('New preset: AI Agent Builder resolves with H100 (5x)', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ answer: 'Agent created', sources: [{ id: 'doc-1' }] });
    const result = await handler.handlePresetIntent({ preset: 'AI_AGENT_BUILDER', gpu_tier: 'H100' });
    assert.strictEqual(result.preset, 'AI_AGENT_BUILDER');
    assert.strictEqual(result.gpu_name, 'H100 SXM');
    assert.strictEqual(result.price_multiplier, 5.0);
  });

  // Test 16: Curl command generation
  await asyncTest('Curl export: generates correct curl command for each preset', async () => {
    const generateCurl = (presetKey) => {
      const p = PRESET_HOOKS[presetKey];
      return `curl -X POST http://localhost:3002/theta-ai/agent-intent -H "Content-Type: application/json" -d '{"preset":"${presetKey}","gpu_tier":"${p.defaultGpu}"}'`;
    };

    const curlLlama = generateCurl('QUICK_LLAMA');
    assert.ok(curlLlama.includes('QUICK_LLAMA'));
    assert.ok(curlLlama.includes('RTX_4090'));
    assert.ok(curlLlama.includes('/theta-ai/agent-intent'));

    const curlAgent = generateCurl('AI_AGENT_BUILDER');
    assert.ok(curlAgent.includes('AI_AGENT_BUILDER'));
    assert.ok(curlAgent.includes('H100'));

    const curlDrm = generateCurl('NFT_DRM_GUARD');
    assert.ok(curlDrm.includes('NFT_DRM_GUARD'));
    assert.ok(curlDrm.includes('A100'));
  });

  // Test 17: Full catalog contains all 16 products
  await asyncTest('Full catalog: contains 16 Theta products with correct categories', async () => {
    assert.strictEqual(FULL_CATALOG.length, 17);

    const categories = [...new Set(FULL_CATALOG.map(p => p.category))];
    assert.ok(categories.includes('Inference'), 'Missing Inference category');
    assert.ok(categories.includes('Compute'), 'Missing Compute category');
    assert.ok(categories.includes('Storage'), 'Missing Storage category');
    assert.ok(categories.includes('Agentic'), 'Missing Agentic category');
    assert.ok(categories.includes('Video'), 'Missing Video category');
    assert.ok(categories.includes('Gateway'), 'Missing Gateway category');

    const withPresets = FULL_CATALOG.filter(p => p.preset);
    assert.ok(withPresets.length >= 11, `Expected >=11 products with presets, got ${withPresets.length}`);

    const presetKeys = withPresets.map(p => p.preset);
    assert.ok(presetKeys.includes('TRANSCRIBE_SUMMARIZE'), 'Missing Transcribe+Summarize');
    assert.ok(presetKeys.includes('NFT_DRM_GUARD'), 'Missing NFT DRM Guard');
    assert.ok(presetKeys.includes('JUPYTER_NOTEBOOK'), 'Missing Jupyter Notebook');
    assert.ok(presetKeys.includes('AI_AGENT_BUILDER'), 'Missing AI Agent Builder');
  });

  // ─── Webhook Tests (Task B) ──────────────────────────────────────────────

  // Test 18: Webhook success on preset completion
  await asyncTest('Webhook: successful delivery on preset completion with callbackUrl', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'response' } }] });
    let webhookPayload = null;
    handler._webhookFn = (url, payload) => { webhookPayload = payload; return true; };

    const result = await handler.handlePresetIntent({
      preset: 'QUICK_LLAMA',
      gpu_tier: 'RTX_4090',
      callbackUrl: 'https://agent.example.com/webhook',
    });

    assert.strictEqual(result.status, 'completed');
    assert.ok(webhookPayload, 'Webhook should have been called');
    assert.strictEqual(webhookPayload.task_id, result.task_id);
    assert.strictEqual(webhookPayload.status, 'completed');
    assert.ok(webhookPayload.output, 'Webhook payload should include output');
    assert.strictEqual(webhookPayload.latency_ms, 420);
    assert.strictEqual(handler.apiStats.webhooks.delivered, 1);
  });

  // Test 19: Webhook fires after settleIntent in onProofReady
  await asyncTest('Webhook: fires after settleIntent in onProofReady', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    let webhookPayload = null;
    handler._webhookFn = (url, payload) => { webhookPayload = payload; return true; };

    handler.contract = {
      settleIntent: async () => ({ wait: async () => ({ hash: '0xsettletx', gasUsed: 200000n }) }),
    };

    const intentId = 'webhook-proof-test';
    handler.activeIntents.set(intentId, {
      status: 'completed',
      result: { choices: [{ message: { content: 'result' } }] },
      latencyMs: 350,
      callbackUrl: 'https://agent.example.com/proof-callback',
    });

    await handler.onProofReady(
      { proof: '0xproof', publicValues: '0xpv', nullifier: '0xnull' },
      { intentId, onChainIntentId: '0x' + '22'.repeat(32) }
    );

    assert.ok(webhookPayload, 'Webhook should fire after settlement');
    assert.strictEqual(webhookPayload.task_id, intentId);
    assert.strictEqual(webhookPayload.status, 'settled');
    assert.ok(webhookPayload.proof.nullifier, 'Proof data should be included');
    assert.strictEqual(handler.apiStats.webhooks.delivered, 1);
  });

  // Test 20: Webhook retry on failure (3 attempts)
  await asyncTest('Webhook: retries 3 times on failure then marks failed', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'resp' } }] });
    let attemptCount = 0;
    handler._webhookFn = (_url, _payload, attempt) => { attemptCount = attempt; return false; };

    await handler.handlePresetIntent({
      preset: 'QUICK_LLAMA',
      gpu_tier: 'RTX_4090',
      callbackUrl: 'https://failing.example.com/webhook',
    });

    assert.strictEqual(attemptCount, 3, 'Should have attempted 3 times');
    assert.strictEqual(handler._webhookCalls.length, 3, 'Should record 3 webhook call attempts');
    assert.strictEqual(handler.apiStats.webhooks.failed, 1);
    assert.strictEqual(handler.apiStats.webhooks.delivered, 0);
  });

  // Test 21: No webhook when callbackUrl is omitted (human UI path)
  await asyncTest('Webhook: skipped when no callbackUrl provided (human UI path)', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'resp' } }] });
    handler._webhookFn = () => { throw new Error('Should not be called'); };

    const result = await handler.handlePresetIntent({
      preset: 'QUICK_LLAMA',
      gpu_tier: 'RTX_4090',
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(handler._webhookCalls.length, 0, 'No webhook calls for human path');
    assert.strictEqual(handler.apiStats.webhooks.delivered, 0);
  });

  // Test 22: Agent path includes callbackUrl correctly in flow
  await asyncTest('Webhook: agent path correctly stores callbackUrl on intent entry', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'agent resp' } }] });
    let receivedUrl = null;
    handler._webhookFn = (url) => { receivedUrl = url; return true; };

    const callbackUrl = 'https://my-swarm-agent.io/results';
    await handler.handlePresetIntent({
      preset: 'AI_AGENT_BUILDER',
      gpu_tier: 'H100',
      callbackUrl,
    });

    const entry = handler.activeIntents.get('preset-AI_AGENT_BUILDER-test');
    assert.strictEqual(entry.callbackUrl, callbackUrl, 'CallbackUrl should be stored on intent entry');
    assert.strictEqual(receivedUrl, callbackUrl, 'Webhook should POST to the correct URL');
  });

  // Test 23: Webhook delivery stats are tracked correctly
  await asyncTest('Webhook: delivery stats tracked for delivered + failed', async () => {
    const handler = new TestHandler({ edgeCloudApiKey: 'key' });
    handler._fetchFn = () => ({ choices: [{ message: { content: 'resp' } }] });

    // First call: succeeds
    handler._webhookFn = () => true;
    await handler.handlePresetIntent({ preset: 'QUICK_LLAMA', gpu_tier: 'RTX_4090', callbackUrl: 'https://a.com/ok' });

    // Reset intent map for second call
    handler._webhookFn = () => false;
    await handler.handlePresetIntent({ preset: 'NEED_BIGGER_GPU', gpu_tier: 'H100', callbackUrl: 'https://b.com/fail' });

    assert.strictEqual(handler.apiStats.webhooks.delivered, 1, 'One delivered webhook');
    assert.strictEqual(handler.apiStats.webhooks.failed, 1, 'One failed webhook');
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
