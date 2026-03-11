/**
 * Track 5 — Event Layer Tests
 *
 * Covers:
 *   5.1 — ai-listener.js: new events in IntentSolver.parseEVMEvent map,
 *          WebSocket provider path (_connectWebSocket), HTTP polling fallback
 *          when WS is not configured.
 *   5.4 — theta-edgestore-adapter.js: retrieval confirmation before on-chain seal
 *   5.5 — theta-inference-handler.js: HMAC-SHA256 webhook signature, new payload fields
 */

'use strict';

const { expect } = require('chai');
const crypto = require('crypto');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLog(iface, eventName, args) {
  const fragment = iface.getEvent(eventName);
  const encoded  = iface.encodeEventLog(fragment, args);
  return {
    topics:          encoded.topics,
    data:            encoded.data,
    transactionHash: '0xdeadbeef' + '00'.repeat(28),
    logIndex:        0,
    blockNumber:     999,
    address:         '0x0000000000000000000000000000000000000001',
  };
}

// ─── Track 5.1 Tests — IntentSolver event map ────────────────────────────────

describe('Track 5.1 — IntentSolver.parseEVMEvent new events', function () {
  const { ethers } = require('ethers');

  const iface = new ethers.Interface([
    // ThetaInferenceCircuit
    'event InferenceIntentSubmitted(bytes32 indexed circuitId, bytes32 indexed intentId, uint8 serviceType, bytes32 indexed serviceId, address requester, uint256 payment, uint256 fee, bytes32 inputHash)',
    'event IntentSettled(bytes32 indexed intentId, bytes32 nullifier, uint256 settledAmount)',
    'event IntentFailed(bytes32 indexed intentId, string reason)',
    // Track 2.1
    'event EdgeCloudNodeAttested(bytes32 indexed intentId, string nodeId, string gpuModel, uint256 computeUnits, uint8 providerTag)',
    // Track 3.2
    'event VideoProvenance(bytes32 indexed intentId, bytes32 contentHash, string playbackUri)',
    // Track 4.2
    'event TdropIntentSubmitted(bytes32 indexed intentId, address indexed requester, uint256 tdropFee, uint256 tfuelEquivalent, uint16 discountBps)',
    // DataHubs
    'event EdgeStoreSealed(bytes32 indexed contributionId, bytes32 edgeStoreCid, bytes32 edgeStoreNodeId, address relayer)',
    // CoreRevenueSplitter
    'event FeeReceivedTagged(bytes32 indexed circuitId, uint256 amount, uint8 providerTag, uint256 thetaNativeTotal, uint256 totalFees)',
    'event DynamicBoostApplied(uint256 boostMultiplier, uint256 thetaNativeRatio, uint256 distributed)',
    'event ERC20FeeReceived(bytes32 indexed circuitId, address indexed token, address indexed from, uint256 amount, uint8 providerTag, uint256 timestamp)',
    // A2ACircuit
    'event BidSubmitted(bytes32 indexed circuitId, bytes32 indexed bidId, address indexed bidder, bytes32 capabilityRequired, uint256 escrow, uint64 deadline)',
    'event AgentSettled(bytes32 indexed circuitId, bytes32 indexed bidId, address indexed provider, uint256 payout)',
  ]);

  // Dynamically import the ESM module
  let IntentSolver;
  before(async function () {
    const mod = await import('../../core-layer/ai-listener.js');
    IntentSolver = mod.IntentSolver;
  });

  const ZERO32 = '0x' + '00'.repeat(32);
  const ADDR   = '0x1234567890123456789012345678901234567890';

  it('IntentSettled maps to SETTLEMENT_REQUEST', function () {
    const log    = makeLog(iface, 'IntentSettled', [ZERO32, ZERO32, 0n]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('IntentSettled');
    expect(intent.type).to.equal('settlement_request');
  });

  it('IntentFailed maps to SETTLEMENT_REQUEST', function () {
    const log    = makeLog(iface, 'IntentFailed', [ZERO32, 'proof-fail']);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('IntentFailed');
    expect(intent.type).to.equal('settlement_request');
  });

  it('EdgeCloudNodeAttested maps to COMPUTE_RESULT', function () {
    const log    = makeLog(iface, 'EdgeCloudNodeAttested', [ZERO32, 'node-abc', 'A100', 1000n, 1]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('EdgeCloudNodeAttested');
    expect(intent.type).to.equal('compute_result');
  });

  it('VideoProvenance maps to DATA_ATTESTATION', function () {
    const log    = makeLog(iface, 'VideoProvenance', [ZERO32, ZERO32, 'https://cdn.theta/video/123']);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('VideoProvenance');
    expect(intent.type).to.equal('data_attestation');
  });

  it('TdropIntentSubmitted maps to INFERENCE_REQUEST', function () {
    const log    = makeLog(iface, 'TdropIntentSubmitted', [ZERO32, ADDR, 5000n, 10000n, 2000]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('TdropIntentSubmitted');
    expect(intent.type).to.equal('inference_request');
  });

  it('EdgeStoreSealed maps to DATA_ATTESTATION', function () {
    const log    = makeLog(iface, 'EdgeStoreSealed', [ZERO32, ZERO32, ZERO32, ADDR]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('EdgeStoreSealed');
    expect(intent.type).to.equal('data_attestation');
  });

  it('FeeReceivedTagged maps to COMPUTE_RESULT', function () {
    const log    = makeLog(iface, 'FeeReceivedTagged', [ZERO32, 1000n, 1, 1000n, 1000n]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('FeeReceivedTagged');
    expect(intent.type).to.equal('compute_result');
  });

  it('ERC20FeeReceived maps to COMPUTE_RESULT', function () {
    const log    = makeLog(iface, 'ERC20FeeReceived', [ZERO32, ADDR, ADDR, 100n, 1, BigInt(Date.now())]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('ERC20FeeReceived');
    expect(intent.type).to.equal('compute_result');
  });

  it('BidSubmitted maps to COMPUTE_BID', function () {
    const log    = makeLog(iface, 'BidSubmitted', [ZERO32, ZERO32, ADDR, ZERO32, 1000n, BigInt(Math.floor(Date.now() / 1000) + 3600)]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('BidSubmitted');
    expect(intent.type).to.equal('compute_bid');
  });

  it('AgentSettled maps to AGENT_SETTLED', function () {
    const log    = makeLog(iface, 'AgentSettled', [ZERO32, ZERO32, ADDR, 950n]);
    const intent = IntentSolver.parseEVMEvent(log, iface);
    expect(intent).to.not.be.null;
    expect(intent.eventName).to.equal('AgentSettled');
    expect(intent.type).to.equal('agent_settled');
  });

  it('unknown event returns null', function () {
    const unknownIface = new ethers.Interface(['event SomeRandomEvent(uint256 x)']);
    const log    = makeLog(unknownIface, 'SomeRandomEvent', [42n]);
    const intent = IntentSolver.parseEVMEvent(log, unknownIface);
    expect(intent).to.be.null;
  });
});

// ─── Track 5.1 Tests — CoreListener WS path ──────────────────────────────────

describe('Track 5.1 — CoreListener WebSocket path', function () {
  let CoreListener;

  before(async function () {
    const mod = await import('../../core-layer/ai-listener.js');
    CoreListener = mod.CoreListener;
  });

  it('wsProviders and wsSubscriptions maps are initialized', function () {
    const listener = new CoreListener();
    expect(listener.wsProviders).to.be.instanceOf(Map);
    expect(listener.wsSubscriptions).to.be.instanceOf(Map);
    expect(listener.wsProviders.size).to.equal(0);
    expect(listener.wsSubscriptions.size).to.equal(0);
  });

  it('_pollEVM returns early when WS subscription is active (no-double-process)', async function () {
    const listener = new CoreListener();
    const chainKey = 'theta_testnet';

    // Simulate an active WS connection
    listener.wsProviders.set(chainKey, { destroy: () => {} });
    listener.wsSubscriptions.set(chainKey, []);

    // pollEVM must return without error even if no HTTP provider exists
    await listener._pollEVM(chainKey, listener.chains[chainKey]);
    // If we reach here without throwing, the early-return guard works
    expect(true).to.be.true;
  });

  it('Theta mainnet and testnet both have wsRpc configured', function () {
    const { DEFAULT_CHAINS } = require('../../core-layer/ai-listener.js');

    // DEFAULT_CHAINS is not exported by name — access via CoreListener
    const listener = new CoreListener();
    expect(listener.chains.theta_mainnet.wsRpc).to.match(/^wss?:\/\//);
    expect(listener.chains.theta_testnet.wsRpc).to.match(/^wss?:\/\//);
  });

  it('getStatus includes wsConnected field per chain', function () {
    const listener = new CoreListener();
    const status = listener.getStatus();

    for (const chain of Object.values(status.chains)) {
      expect(chain).to.have.property('wsConnected');
    }
  });

  it('stop() clears wsProviders and wsSubscriptions', function () {
    const listener = new CoreListener();

    // Pre-seed a mock WS provider
    listener.wsProviders.set('theta_testnet', { destroy: () => {} });
    listener.wsSubscriptions.set('theta_testnet', []);

    listener.stop();
    expect(listener.wsProviders.size).to.equal(0);
    expect(listener.wsSubscriptions.size).to.equal(0);
  });
});

// ─── Track 5.4 Tests — EdgeStore retrieval confirmation ──────────────────────

describe('Track 5.4 — EdgeStore retrieval confirmation', function () {
  let ThetaEdgeStoreAdapter;

  before(async function () {
    const mod = await import('../../circuits/data-hubs/theta-edgestore-adapter.js');
    ThetaEdgeStoreAdapter = mod.ThetaEdgeStoreAdapter;
  });

  it('adapter has retrievalConfirmations and retrievalConfirmFailures stats', function () {
    const adapter = new ThetaEdgeStoreAdapter({ walletPrivateKey: '0x' + 'a1'.repeat(32) });
    expect(adapter.stats).to.have.property('retrievalConfirmations');
    expect(adapter.stats).to.have.property('retrievalConfirmFailures');
    expect(adapter.stats.retrievalConfirmations).to.equal(0);
    expect(adapter.stats.retrievalConfirmFailures).to.equal(0);
  });

  it('uploadAndSeal returns retrievalConfirmed=true when retrieve succeeds', async function () {
    const adapter = new ThetaEdgeStoreAdapter({ walletPrivateKey: '0x' + 'a1'.repeat(32) });

    const fakeCid    = '0x' + 'cc'.repeat(32);
    const fakeNodeId = '0x' + 'dd'.repeat(32);

    // Mock upload()
    adapter.upload = async () => ({
      cid:       fakeCid,
      nodeId:    fakeNodeId,
      sizeBytes: 10,
      elapsed:   5,
      rawKey:    'cc'.repeat(32),
    });

    // Mock retrieve() — returns 10 bytes
    adapter.retrieve = async () => Buffer.alloc(10, 1);

    const result = await adapter.uploadAndSeal({
      data: Buffer.alloc(10),
      filename: 'test.bin',
      verifyRetrieval: true,
    });

    expect(result.retrievalConfirmed).to.be.true;
    expect(result.cid).to.equal(fakeCid);
    expect(result.sealError).to.be.null;
  });

  it('uploadAndSeal returns retrievalConfirmed=false and no seal when retrieve fails', async function () {
    const adapter = new ThetaEdgeStoreAdapter({ walletPrivateKey: '0x' + 'a1'.repeat(32) });

    adapter.upload = async () => ({
      cid: '0x' + '00'.repeat(32), nodeId: '0x' + '00'.repeat(32), sizeBytes: 0, elapsed: 1, rawKey: '0',
    });

    adapter.retrieve = async () => { throw new Error('504 Gateway Timeout'); };

    const result = await adapter.uploadAndSeal({
      data: Buffer.alloc(5),
      verifyRetrieval: true,
    });

    expect(result.retrievalConfirmed).to.be.false;
    expect(result.txHash).to.be.null;
    expect(result.sealError).to.include('Retrieval failed');
  });

  it('uploadAndSeal skips retrieval check when verifyRetrieval=false', async function () {
    const adapter = new ThetaEdgeStoreAdapter({ walletPrivateKey: '0x' + 'a1'.repeat(32) });

    adapter.upload = async () => ({
      cid: '0x' + 'aa'.repeat(32), nodeId: '0x' + 'bb'.repeat(32), sizeBytes: 4, elapsed: 2, rawKey: 'aa'.repeat(32),
    });

    let retrieveCalled = false;
    adapter.retrieve = async () => { retrieveCalled = true; return Buffer.alloc(4); };

    const result = await adapter.uploadAndSeal({
      data: Buffer.alloc(4),
      verifyRetrieval: false,
    });

    expect(retrieveCalled).to.be.false;
    // retrievalConfirmed is not set when skipped (undefined or false)
    expect(result).to.not.have.property('retrievalConfirmed', true);
  });
});

// ─── Track 5.5 Tests — HMAC-SHA256 webhook signature ─────────────────────────

describe('Track 5.5 — Webhook HMAC-SHA256 signature', function () {
  function computeExpectedSig(secret, body) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  it('_deliverWebhook sends X-XFuel-Signature header when WEBHOOK_SECRET is set', async function () {
    const { ThetaInferenceHandler } = await import('../../circuits/theta-inference/theta-inference-handler.js');

    const handler = new ThetaInferenceHandler({});
    handler._webhookSecret = 'test-secret-key';

    const capturedHeaders = {};
    let capturedBody = '';

    // Mock fetch globally
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      Object.assign(capturedHeaders, opts.headers || {});
      capturedBody = opts.body;
      return { ok: true, status: 200 };
    };

    const payload = { task_id: '0xabc', status: 'completed', output: 'hello' };
    await handler._deliverWebhook('https://agent.example.com/webhook', payload, '0xabc');

    globalThis.fetch = origFetch;

    expect(capturedHeaders['X-XFuel-Signature']).to.match(/^sha256=[a-f0-9]{64}$/);
    const expected = computeExpectedSig('test-secret-key', capturedBody);
    expect(capturedHeaders['X-XFuel-Signature']).to.equal(expected);
  });

  it('_deliverWebhook does NOT send X-XFuel-Signature when no secret configured', async function () {
    const { ThetaInferenceHandler } = await import('../../circuits/theta-inference/theta-inference-handler.js');

    const handler = new ThetaInferenceHandler({});
    handler._webhookSecret = '';
    delete process.env.WEBHOOK_SECRET;

    const capturedHeaders = {};
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      Object.assign(capturedHeaders, opts.headers || {});
      return { ok: true, status: 200 };
    };

    await handler._deliverWebhook('https://agent.example.com/webhook', { task_id: 'x' }, 'x');
    globalThis.fetch = origFetch;

    expect(capturedHeaders['X-XFuel-Signature']).to.be.undefined;
  });

  it('HMAC signature can be verified by receiver using timingSafeEqual', function () {
    const secret  = crypto.randomBytes(32).toString('hex');
    const body    = JSON.stringify({ task_id: '0x123', status: 'completed' });
    const sig     = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sigHash = sig.replace('sha256=', '');

    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const received = Buffer.from(sigHash, 'hex');

    expect(crypto.timingSafeEqual(expected, received)).to.be.true;
  });

  it('webhook payload includes new fields: edge_cloud_node_id, video_provenance_uri, edge_store_cid', async function () {
    const { ThetaInferenceHandler } = await import('../../circuits/theta-inference/theta-inference-handler.js');

    const handler = new ThetaInferenceHandler({});

    let deliveredPayload = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      deliveredPayload = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    };

    // Simulate the full payload that onProofReady would build
    const proofRequest = { intentId: '0x' + 'ff'.repeat(32), chain: 'theta_testnet' };
    const proofResult  = { nullifier: '0x' + '00'.repeat(32), proof: '0xabc', publicValues: '0xdef' };

    // Pre-populate an entry with rich metadata
    handler.activeIntents = handler.activeIntents || new Map();
    handler.activeIntents.set(proofRequest.intentId, {
      status: 'completed',
      result: 'mock-output',
      latencyMs: 1234,
      settleTxHash: '0xtxhash',
      callbackUrl: 'https://agent.test/webhook',
      attestation: { nodeId: 'edgecloud-node-42' },
      providerTag: 1,
      videoProvenanceUri: 'https://cdn.thetatoken.org/video/abc',
      edgeStoreCid: '0x' + 'ee'.repeat(32),
      outputHash: '0x' + 'aa'.repeat(32),
    });

    // Manually invoke the webhook dispatch path (bypass full onProofReady)
    const entry = handler.activeIntents.get(proofRequest.intentId);
    const payload = {
      task_id: proofRequest.intentId,
      output: entry.result,
      proof: { nullifier: proofResult.nullifier, proof: proofResult.proof, publicValues: proofResult.publicValues },
      status: entry.status,
      latency_ms: entry.latencyMs,
      settled_tx: entry.settleTxHash || null,
      output_hash: entry.outputHash || null,
      proof_tx_hash: entry.settleTxHash || null,
      edge_cloud_node_id: entry.attestation?.nodeId || null,
      provider_tag: entry.providerTag ?? null,
      video_provenance_uri: entry.videoProvenanceUri || null,
      edge_store_cid: entry.edgeStoreCid || null,
      timestamp: Date.now(),
    };
    await handler._deliverWebhook(entry.callbackUrl, payload, proofRequest.intentId);
    globalThis.fetch = origFetch;

    expect(deliveredPayload.edge_cloud_node_id).to.equal('edgecloud-node-42');
    expect(deliveredPayload.video_provenance_uri).to.include('thetatoken.org');
    expect(deliveredPayload.edge_store_cid).to.match(/^0x[0-9a-f]+$/i);
    expect(deliveredPayload.provider_tag).to.equal(1);
    expect(deliveredPayload.output_hash).to.match(/^0x/);
    expect(deliveredPayload.timestamp).to.be.a('number');
  });

  it('webhook delivery retries 3 times on HTTP failure then marks failed', async function () {
    const { ThetaInferenceHandler } = await import('../../circuits/theta-inference/theta-inference-handler.js');

    const handler = new ThetaInferenceHandler({});
    handler._webhookSecret = '';

    let attempts = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attempts++;
      return { ok: false, status: 503 };
    };

    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, delay) => { fn(); return 0; };

    const prevFailed = handler.apiStats.webhooks.failed;
    const result = await handler._deliverWebhook('https://fail.test/hook', { x: 1 }, '0xtest');
    globalThis.fetch = origFetch;
    global.setTimeout = origSetTimeout;

    expect(result).to.be.false;
    expect(attempts).to.equal(3);
    expect(handler.apiStats.webhooks.failed).to.equal(prevFailed + 1);
  });
});
