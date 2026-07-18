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
