import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentChallenge,
  verifyPayment,
  settlePayment,
  planA2ASettlement,
  isX402Enabled,
  defaultRail,
  fallbackToTfuel,
  priceTaskUSDC,
  ChallengeStore,
  buildBazaarExtension,
  BAZAAR_EXTENSION_KEY,
} from '../src/x402-adapter.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

test('buildPaymentChallenge produces a valid x402 accepts payload', () => {
  const { status, body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '1000000',
    network: 'base',
    payTo: '0xabc',
  });
  assert.equal(status, 402);
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);
  const a = body.accepts[0];
  assert.equal(a.scheme, 'exact');
  assert.equal(a.network, 'base');
  assert.equal(a.maxAmountRequired, '1000000');
  assert.equal(a.payTo, '0xabc');
  assert.equal(a.extra.taskId, 'task-1');
  assert.match(a.extra.nonce, /^[0-9a-f]{32}$/);
});

// ─── CDP Bazaar Extension Tests ─────────────────────────────────────────────

test('buildBazaarExtension: produces a spec-conformant bazaar extension', () => {
  const ext = buildBazaarExtension({ method: 'POST' });

  // Must have the bazaar key
  assert.ok(ext[BAZAAR_EXTENSION_KEY], 'bazaar extension key is present');

  const bazaar = ext[BAZAAR_EXTENSION_KEY];
  assert.ok(bazaar.info, 'info is present');
  assert.ok(bazaar.info.input, 'info.input is present');
  assert.ok(bazaar.info.output, 'info.output is present');

  // Per spec: info.input.type must be present
  assert.equal(bazaar.info.input.type, 'http', 'info.input.type is http');
  assert.equal(bazaar.info.input.method, 'POST', 'info.input.method is POST');

  // Per spec: info.output.type must be present when output is present
  assert.equal(bazaar.info.output.type, 'json', 'info.output.type is json');

  // Input schema should match /task-request body
  assert.ok(bazaar.info.input.inputSchema, 'inputSchema is present');
  assert.ok(bazaar.info.input.inputSchema.properties.message_type, 'inputSchema has message_type');
  assert.ok(bazaar.info.input.inputSchema.properties.sender, 'inputSchema has sender');
  assert.ok(bazaar.info.input.inputSchema.properties.model_id, 'inputSchema has model_id');

  // Output schema should describe the task-request response
  assert.ok(bazaar.info.output.schema, 'output schema is present');
  assert.ok(bazaar.info.output.schema.properties.task_id, 'output schema has task_id');
  assert.ok(bazaar.info.output.schema.properties.verify_url, 'output schema has verify_url');
});

test('buildPaymentChallenge: includes bazaar extension by default', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const a = body.accepts[0];
  assert.ok(a.extensions, 'extensions object is present');
  assert.ok(a.extensions[BAZAAR_EXTENSION_KEY], 'bazaar extension is present');

  const bazaar = a.extensions[BAZAAR_EXTENSION_KEY];
  assert.ok(bazaar.info.input.type, 'info.input.type is present');
  assert.ok(bazaar.info.output.type, 'info.output.type is present');
});

test('buildPaymentChallenge: uses absolute resource URL for bazaar cataloging', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-abc',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const a = body.accepts[0];

  // Resource URL must be absolute https:// (per spec)
  assert.equal(a.resource, 'https://api.xfuel.app/task-request',
    'resource is absolute URL pointing to /task-request');

  // routeTemplate is the catalog key — NOT per-task
  assert.equal(a.routeTemplate, 'https://api.xfuel.app/task-request',
    'routeTemplate is the stable catalog key');

  // Should NOT contain the taskId in the resource URL (that would create per-task catalog entries)
  assert.ok(!a.resource.includes('task-abc'), 'resource URL does not contain taskId');
});

test('buildPaymentChallenge: falls back to relative path when no baseUrl', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-xyz',
    maxAmountRequired: '50000',
  });

  const a = body.accepts[0];
  assert.equal(a.resource, '/task-request', 'resource is relative /task-request');
  assert.equal(a.routeTemplate, '/task-request', 'routeTemplate is relative');
});

test('buildPaymentChallenge: includes service metadata for bazaar', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const a = body.accepts[0];

  // Per spec: serviceName ≤32 chars
  assert.equal(a.serviceName, 'XFuel', 'serviceName is XFuel');
  assert.ok(a.serviceName.length <= 32, 'serviceName ≤32 chars');

  // Per spec: tags ≤5 items
  assert.ok(Array.isArray(a.tags), 'tags is an array');
  assert.ok(a.tags.length <= 5, 'tags ≤5 items');
  assert.ok(a.tags.includes('inference'), 'tags includes inference');
  assert.ok(a.tags.includes('x402'), 'tags includes x402');

  // Per spec: iconUrl must be absolute https://
  assert.ok(a.iconUrl.startsWith('https://'), 'iconUrl is absolute https');
});

test('buildPaymentChallenge: description mentions real USDC settlement', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    baseUrl: 'https://api.xfuel.app',
  });

  const a = body.accepts[0];

  // Description must explain the service (per spec) and mention it's real USDC
  assert.ok(a.description.includes('USDC'), 'description mentions USDC');
  assert.ok(a.description.includes('x402'), 'description mentions x402');
  assert.ok(a.description.includes('receipt'), 'description mentions receipt');
  assert.ok(a.description.includes('verify_url'), 'description mentions verify_url');
});

test('buildPaymentChallenge: can disable bazaar extension', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-1',
    maxAmountRequired: '50000',
    includeBazaar: false,
  });

  const a = body.accepts[0];
  assert.ok(!a.extensions, 'no extensions when includeBazaar=false');
});

test('buildPaymentChallenge requires taskId and amount', () => {
  assert.throws(() => buildPaymentChallenge({ maxAmountRequired: '1' }), /taskId is required/);
  assert.throws(() => buildPaymentChallenge({ taskId: 't' }), /maxAmountRequired is required/);
});

test('verifyPayment returns gateway_not_configured without env', async () => {
  // Pin the legacy gateway provider: these tests exercise the generic ZAN-style
  // /verify+/settle path (the mock speaks that protocol). The default 'x402'
  // facilitator path is covered hermetically in x402-facilitator.test.mjs. Pinning
  // keeps this file independent of the repo .env (config.js dotenv.config() would
  // otherwise leak X402_FACILITATOR_PROVIDER=x402 into the shared test process).
  const r = await verifyPayment('some-header', { provider: 'zan' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'gateway_not_configured');
});

test('verifyPayment flags missing header when gateway configured', async () => {
  const r = await verifyPayment('', { gatewayUrl: 'https://gw.example', apiKey: 'k' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'missing_payment_header');
});

test('planA2ASettlement maps to settleBidFairExchange', () => {
  const plan = planA2ASettlement({ taskId: 't', bidId: '0x1', resultHash: '0x2', txRef: 'base:0xtx' });
  assert.equal(plan.action, 'settleBidFairExchange');
  assert.equal(plan.bidId, '0x1');
  assert.equal(plan.paymentRef, 'base:0xtx');
});

test('isX402Enabled reflects env flag', () => {
  const prev = process.env.X402_ENABLED;
  process.env.X402_ENABLED = 'true';
  assert.equal(isX402Enabled(), true);
  process.env.X402_ENABLED = 'false';
  assert.equal(isX402Enabled(), false);
  if (prev === undefined) delete process.env.X402_ENABLED; else process.env.X402_ENABLED = prev;
});

test('defaultRail / fallbackToTfuel reflect env (usdc default)', () => {
  const prevRail = process.env.X402_DEFAULT_RAIL;
  const prevFb = process.env.X402_FALLBACK_TFUEL;
  delete process.env.X402_DEFAULT_RAIL;
  assert.equal(defaultRail(), 'usdc', 'defaults to usdc on Base (ADR 0002)');
  process.env.X402_DEFAULT_RAIL = 'tfuel';
  assert.equal(defaultRail(), 'tfuel');
  process.env.X402_DEFAULT_RAIL = 'usdc';
  assert.equal(defaultRail(), 'usdc');
  process.env.X402_FALLBACK_TFUEL = 'true';
  assert.equal(fallbackToTfuel(), true);
  if (prevRail === undefined) delete process.env.X402_DEFAULT_RAIL; else process.env.X402_DEFAULT_RAIL = prevRail;
  if (prevFb === undefined) delete process.env.X402_FALLBACK_TFUEL; else process.env.X402_FALLBACK_TFUEL = prevFb;
});

test('priceTaskUSDC: default, per-model override, explicit default', () => {
  assert.equal(priceTaskUSDC({ model: 'unknown' }), '10000'); // env default ($0.01)
  assert.equal(priceTaskUSDC({ model: 'llama-3-70b' }, { prices: { 'llama-3-70b': '50000' } }), '50000');
  assert.equal(priceTaskUSDC({}, { default: '123' }), '123');
  assert.equal(priceTaskUSDC({ serviceType: 0 }, { prices: { 'service:0': '777' } }), '777');
});

test('ChallengeStore: put/get, spend, replay, expiry', () => {
  const store = new ChallengeStore({ ttlMs: 60000 });
  const rec = store.put('n1', { taskId: 't', amount: '50000' });
  assert.equal(rec.nonce, 'n1');
  assert.equal(store.get('n1').amount, '50000');
  assert.equal(store.isSpent('n1'), false);
  store.markSpent('n1');
  assert.equal(store.isSpent('n1'), true);
  assert.equal(store.get('n1'), null, 'spent challenge is removed');

  const expired = new ChallengeStore({ ttlMs: -100 });
  expired.put('n2', { taskId: 't2', amount: '1' });
  assert.equal(expired.get('n2'), null, 'expired challenge not returned');
});

test('buildPaymentChallenge records into the store with nonce + expiry', () => {
  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    { taskId: 'task-x', maxAmountRequired: '50000', payTo: '0xtreasury' },
    { store }
  );
  const { nonce, expiresAt } = body.accepts[0].extra;
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.ok(expiresAt > Date.now());
  const stored = store.get(nonce);
  assert.equal(stored.amount, '50000');
  assert.equal(stored.payTo, '0xtreasury');
});

test('verify + settle against mock facilitator (happy path + replay)', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const store = new ChallengeStore();
    const { body } = buildPaymentChallenge(
      { taskId: 't', maxAmountRequired: '50000', payTo: '0xtreasury' },
      { store }
    );
    const nonce = body.accepts[0].extra.nonce;
    const opts = { provider: 'zan', gatewayUrl: url, apiKey: 'k', store, nonce };

    const v = await verifyPayment('X-PAYMENT-blob', opts);
    assert.equal(v.valid, true);
    assert.ok(v.txRef);

    const s = await settlePayment('X-PAYMENT-blob', opts);
    assert.equal(s.settled, true);
    assert.equal(store.isSpent(nonce), true);

    // Replay after settle is rejected
    const replay = await verifyPayment('X-PAYMENT-blob', opts);
    assert.equal(replay.valid, false);
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('verify rejects unknown/expired challenge before hitting gateway', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const store = new ChallengeStore();
    const r = await verifyPayment('X-PAYMENT-blob', {
      gatewayUrl: url, apiKey: 'k', store, nonce: 'deadbeef',
    });
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'challenge_expired_or_unknown');
  } finally {
    await close();
  }
});

test('verify surfaces facilitator rejection', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const r = await verifyPayment('X-PAYMENT-blob', { provider: 'zan', gatewayUrl: url, apiKey: 'k' });
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'mock_rejected');
  } finally {
    await close();
  }
});
