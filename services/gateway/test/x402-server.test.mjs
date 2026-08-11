import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRail,
  extractPaymentNonce,
  priceUSDC,
  runX402Handshake,
} from '../src/x402-server.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';
import { WebhookDispatcher } from '../src/webhooks.js';

// cfg override so the loop runs against the mock facilitator without env coupling.
function cfgFor(url, over = {}) {
  return {
    enabled: true,
    defaultRail: 'usdc',
    fallbackToTfuel: true,
    gatewayUrl: url,
    apiKey: 'testkey',
    payTo: '0xtreasury',
    network: 'base',
    asset: 'USDC',
    challengeTtlMs: 120000,
    usdcPriceDefault: '50000',
    usdcPrices: {},
    ...over,
  };
}

test('resolveRail: cfg default, explicit usdc/tfuel', () => {
  assert.equal(resolveRail({}, { defaultRail: 'usdc' }), 'usdc');
  assert.equal(resolveRail({}, { defaultRail: 'tfuel' }), 'tfuel');
  assert.equal(resolveRail({ payment: { rail: 'tfuel' } }, { defaultRail: 'usdc' }), 'tfuel');
  assert.equal(resolveRail({ payment: { rail: 'usdc' } }, { defaultRail: 'tfuel' }), 'usdc');
});

test('priceUSDC: model override, maxAmount cap, default', () => {
  const cfg = { usdcPriceDefault: '50000', usdcPrices: { 'llama-3-70b': '90000' } };
  assert.equal(priceUSDC({ model_id: 'llama-3-70b' }, cfg), '90000');
  assert.equal(priceUSDC({ model_id: 'unknown' }, cfg), '50000');
  assert.equal(priceUSDC({ payment: { maxAmount: '12345' }, model_id: 'llama-3-70b' }, cfg), '12345');
});

test('settled gross cannot be restated by the paid retry (receipt integrity)', async () => {
  // The exploit this guards: the buyer pays a $0.01 challenge, then declares a
  // $1.00 `amount` on the retry and mints a signed receipt claiming $1.00 gross.
  // Gross must come from the challenge the payment was bound to. See
  // docs/KNOWN_ISSUES.md — our own flagship demo did exactly this.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url, { usdcPriceDefault: '10000' });

    const challenge = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-integrity', cfg },
    );
    const accept = challenge.body.accepts[0];
    assert.equal(accept.maxAmountRequired, '10000', 'challenge priced at $0.01');

    const settled = await runX402Handshake({
      headers: { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': accept.extra.nonce },
      // Inflated declaration + a different maxAmount on the retry.
      body: { payment: { rail: 'usdc', maxAmount: '1000000' }, amount: '1000000' },
    }, { taskId: 'x402-integrity', cfg });

    assert.equal(settled.kind, 'settled');
    assert.equal(settled.settledAmount, '10000', 'gross is the bound challenge amount, not the declaration');
  } finally {
    await close();
  }
});

test('extractPaymentNonce: explicit header, json blob, base64 blob', () => {
  assert.equal(extractPaymentNonce({ headers: { 'x-payment-nonce': 'abc' } }), 'abc');
  assert.equal(extractPaymentNonce({ headers: { 'x-payment': JSON.stringify({ nonce: 'n1' }) } }), 'n1');
  const b64 = Buffer.from(JSON.stringify({ nonce: 'n2' }), 'utf8').toString('base64');
  assert.equal(extractPaymentNonce({ headers: { 'x-payment': b64 } }), 'n2');
  assert.equal(extractPaymentNonce({ headers: {} }), null);
});

test('full 402 loop against mock facilitator: challenge → settle → replay-rejected', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url);

    // Step 1: no X-PAYMENT → 402 challenge (bound to amount + payTo + nonce)
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-req-1', cfg });
    assert.equal(challenge.kind, 'challenge');
    const accept = challenge.body.accepts[0];
    assert.equal(challenge.body.x402Version, 1);
    assert.equal(accept.maxAmountRequired, '50000');
    assert.equal(accept.payTo, '0xtreasury');
    assert.equal(accept.network, 'base');
    const nonce = accept.extra.nonce;
    assert.match(nonce, /^[0-9a-f]{32}$/);

    // Step 2: retry with X-PAYMENT + nonce → verify + settle
    const reqPay = {
      headers: { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': nonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPay, { taskId: 'x402-req-1', cfg });
    assert.equal(settled.kind, 'settled');
    assert.match(settled.paymentRef, /^base:0x/);
    assert.equal(settled.settledAmount, '50000', 'settled gross comes from the bound challenge');

    // Step 3: replay the same nonce → rejected (spent)
    const replay = await runX402Handshake(reqPay, { taskId: 'x402-req-1', cfg });
    assert.equal(replay.kind, 'failed');
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('handshake surfaces facilitator rejection (→ caller falls back to TFUEL)', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const cfg = cfgFor(url);
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' } } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 't', cfg });
    const nonce = challenge.body.accepts[0].extra.nonce;
    const reqPay = { headers: { 'x-payment': 'BLOB', 'x-payment-nonce': nonce }, body: {} };
    const decision = await runX402Handshake(reqPay, { taskId: 't', cfg });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'mock_rejected');
  } finally {
    await close();
  }
});

test('gateway_not_configured is reported (→ caller returns 503)', async () => {
  const cfg = cfgFor(null, { gatewayUrl: null, apiKey: null });
  const reqPay = { headers: { 'x-payment': 'BLOB', 'x-payment-nonce': 'x' }, body: {} };
  const decision = await runX402Handshake(reqPay, { taskId: 't', cfg });
  assert.equal(decision.kind, 'failed');
  assert.equal(decision.reason, 'gateway_not_configured');
});

test('TaskSettled webhook payload includes payment_rail + payment_ref', () => {
  const dispatcher = new WebhookDispatcher({ subscribersFor: () => [] }, { activeTasks: new Map() });
  const payload = dispatcher.buildPayload({
    taskId: 't',
    status: 'completed',
    feeAmount: '1',
    netAmount: '2',
    intent: { type: 'inference_request', paymentRail: 'usdc', paymentRef: 'base:0xabc' },
  });
  assert.equal(payload.payment_rail, 'usdc');
  assert.equal(payload.payment_ref, 'base:0xabc');

  // TFUEL default when unset
  const tfuel = dispatcher.buildPayload({ taskId: 't2', status: 'completed', intent: { type: 'compute_bid' } });
  assert.equal(tfuel.payment_rail, 'tfuel');
  assert.equal(tfuel.payment_ref, null);
});
