/**
 * Unauthenticated payment settlement on `/task-request`.
 *
 * CDP-native buyers (Bankr, Bazaar) may send PAYMENT-SIGNATURE or X-PAYMENT
 * without an API key. This test suite verifies:
 *
 *   1. Unauth + no payment header → discovery 402 (v2)
 *   2. Unauth + PAYMENT-SIGNATURE → handshake runs, verifies, and settles
 *   3. Unauth + X-PAYMENT → same behavior as PAYMENT-SIGNATURE
 *   4. Keyed + no payment + no pending → still fronted (rolling settlement)
 *   5. Keyed rolling hasPayment sees PAYMENT-SIGNATURE (both v1 and v2)
 *   6. Malformed payment header fails closed with reason, not a fresh discovery
 *
 * Bankr incident (2026-08-21) regression tests:
 *   7. Unauth + PAYMENT-SIGNATURE + empty body → 400, settle NOT called
 *   8. Unauth + PAYMENT-SIGNATURE + invalid body → 400, settle NOT called
 *   9. Keyed + PAYMENT-SIGNATURE + empty body → 400, settle NOT called
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-unauth-pay-'));

process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.AKASHML_API_KEY = 'akml-test-key';
process.env.X402_ENABLED = 'true';
process.env.X402_ROLLING_SETTLEMENT = 'true';
process.env.X402_COST_PLUS = 'true';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.X402_USDC_PRICE_DEFAULT = '10000';
process.env.HUB_CATALOG_OFFLINE = 'false';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.PAYERS_LEDGER_DIR = path.join(tmp, 'payers');
process.env.M2M_API_KEYS = 'keyed-caller-1,keyed-caller-2';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

// Create a tracked mock facilitator that records settle calls (for regression tests)
// NOTE: facilitatorSettleCalls MUST be declared BEFORE createTrackedMockFacilitator() is called
// to avoid Temporal Dead Zone issues when the closure references it.
import http from 'node:http';
let facilitatorSettleCalls = [];  // Track settle calls for regression tests
function createTrackedMockFacilitator() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url || '';
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };

      if (req.method !== 'POST') return send(404, { error: 'not_found' });

      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad_json' }); }

      const isStandardX402 = !!parsed.paymentPayload;
      const payer = parsed.paymentPayload?.payload?.authorization?.from || '0xmockpayer';
      const network = parsed.paymentRequirements?.network || 'base-sepolia';
      const txRef = '0xmockpaymenttxref0000000000000000000000000000000000000000000000';

      if (url.endsWith('/verify')) {
        if (isStandardX402) {
          return send(200, { isValid: true, payer });
        }
        return send(200, { valid: true, txRef });
      }

      if (url.endsWith('/settle')) {
        // TRACK SETTLE CALLS - this is the critical regression test point
        facilitatorSettleCalls.push({ url, body: parsed, timestamp: Date.now() });
        if (isStandardX402) {
          return send(200, { success: true, transaction: txRef, network, payer });
        }
        return send(200, { settled: true, txRef });
      }

      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
const { url: facUrl, close: closeFac } = await createTrackedMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { resetRollingSettlement } = await import('../src/rolling-settlement.js');

const SERVED_TEXT = 'PONG from the stubbed provider';
const USAGE = { prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 };
const realFetch = globalThis.fetch;

const AKASH_MODELS = {
  data: [
    {
      id: 'zai-org/GLM-5.2',
      name: 'GLM 5.2',
      input_modalities: ['text'],
      pricing: { input: '0.0000014', output: '0.0000044' },
    },
  ],
};

let inferenceCalls = [];
let server;
let base;

function stubFetch(url, init) {
  const href = String(url);

  if (href.includes('api.akashml.com') && href.endsWith('/models')) {
    return Promise.resolve(new Response(JSON.stringify(AKASH_MODELS), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  if (href.includes('api.akashml.com') && href.includes('/chat/completions')) {
    inferenceCalls.push(JSON.parse(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      id: 'cmpl-stub',
      choices: [{ message: { role: 'assistant', content: SERVED_TEXT }, finish_reason: 'stop' }],
      usage: USAGE,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }

  if (href.includes('thetaedgecloud.com')) {
    return Promise.resolve(new Response(JSON.stringify({ body: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  return realFetch(url, init);
}

const bodyOf = (over = {}) => ({
  message_type: 'inference_request',
  chain_id: 'base',
  amount: '10000',
  sender: '0x0000000000000000000000000000000000000001',
  model_id: 'akash/zai-org/GLM-5.2',
  messages: [{ role: 'user', content: 'Reply with one word.' }],
  max_tokens: 32,
  ...over,
});

const post = (over = {}, headers = {}) => realFetch(`${base}/task-request`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(bodyOf(over)),
});

async function waitComplete(taskId) {
  let status;
  let receipt;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 50));
    status = await (await realFetch(`${base}/task-status?task_id=${taskId}`, {
      headers: { 'x-api-key': 'keyed-caller-1' },
    })).json();
    if (['completed', 'failed', 'fee_collected'].includes(status.status)) {
      receipt = await (await realFetch(`${base}/receipt/${taskId}?format=json`)).json();
      if (receipt.provider_cogs?.actual || receipt.payment?.platform_fee != null) break;
    }
  }
  return { status, receipt };
}

before(async () => {
  globalThis.fetch = stubFetch;
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  await closeFac();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('unauth + no payment header → discovery 402 (v2)', async () => {
  resetRollingSettlement();
  const res = await post();
  assert.equal(res.status, 402, 'unauthenticated caller without payment header gets 402');
  const body = await res.json();
  assert.equal(body.x402Version, 2, 'challenge is x402 v2');
  assert.ok(body.accepts, 'challenge has accepts array');
  assert.ok(body.accepts[0]?.extra?.nonce, 'challenge has nonce for retry');
});

test('unauth + PAYMENT-SIGNATURE → handshake runs and settles (CDP Bankr case)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202, `v2 PAYMENT-SIGNATURE must settle, got ${JSON.stringify(paid)}`);
  assert.ok(paid.task_id, 'paid call returns a task_id');

  const { status } = await waitComplete(paid.task_id);
  assert.ok(['completed', 'fee_collected'].includes(status.status), `task must complete after paid settlement, got ${status.status}`);
  assert.equal(inferenceCalls.length, 1, 'provider was called');
});

test('unauth + X-PAYMENT → same behavior as PAYMENT-SIGNATURE (XFuel SDK case)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'x-payment': 'V1-PAYMENT-BLOB',
    'x-payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202, `v1 X-PAYMENT must settle, got ${JSON.stringify(paid)}`);
  assert.ok(paid.task_id, 'paid call returns a task_id');

  const { status } = await waitComplete(paid.task_id);
  assert.ok(['completed', 'fee_collected'].includes(status.status), `task must complete after paid settlement, got ${status.status}`);
  assert.equal(inferenceCalls.length, 1, 'provider was called');
});

test('keyed + no payment + no pending → still fronted (rolling settlement)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const res = await post({}, { 'x-api-key': 'keyed-caller-1' });
  const body = await res.json();

  assert.equal(res.status, 202, `keyed caller without payment should be fronted, got ${JSON.stringify(body)}`);
  assert.ok(body.task_id, 'keyed call returns a task_id');
  assert.equal(body.rolling?.this_call_billed_on, 'next_request', 'first keyed call is fronted');

  const { status } = await waitComplete(body.task_id);
  assert.ok(['completed', 'fee_collected'].includes(status.status), `task must complete, got ${status.status}`);
  assert.equal(inferenceCalls.length, 1, 'provider was called');
});

test('keyed rolling hasPayment sees PAYMENT-SIGNATURE (v2)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const firstRes = await post({}, { 'x-api-key': 'keyed-caller-2' });
  assert.equal(firstRes.status, 202);
  const first = await firstRes.json();
  await waitComplete(first.task_id);

  const secondRes = await post({}, { 'x-api-key': 'keyed-caller-2' });
  assert.equal(secondRes.status, 402);
  const challenge = await secondRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'x-api-key': 'keyed-caller-2',
    'payment-signature': 'V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202, `keyed caller with PAYMENT-SIGNATURE must settle, got ${JSON.stringify(paid)}`);
  assert.ok(paid.rolling?.pays_previous_task, 'rolling settlement pays the previous task');
});

test('keyed rolling hasPayment sees X-PAYMENT (v1)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const firstRes = await post({}, { 'x-api-key': 'keyed-caller-1' });
  assert.equal(firstRes.status, 202);
  const first = await firstRes.json();
  await waitComplete(first.task_id);

  const secondRes = await post({}, { 'x-api-key': 'keyed-caller-1' });
  assert.equal(secondRes.status, 402);
  const challenge = await secondRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'x-api-key': 'keyed-caller-1',
    'x-payment': 'V1-PAYMENT-BLOB',
    'x-payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202, `keyed caller with X-PAYMENT must settle, got ${JSON.stringify(paid)}`);
  assert.ok(paid.rolling?.pays_previous_task, 'rolling settlement pays the previous task');
});

test('payment header prevents discovery 402 early return (handshake runs)', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402, 'no payment → discovery 402');
  const challenge = await challengeRes.json();
  assert.ok(challenge.accepts, 'discovery response has accepts');
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.notEqual(paidRes.status, 401, 'payment header must not result in 401 unauthorized');
  assert.ok(
    paidRes.status === 202 || !paid.accepts,
    'paid call must not return a fresh discovery challenge (either settles or fails with reason)',
  );
});

test('unauth first paid call collects for the current request, not fronted', async () => {
  resetRollingSettlement();
  inferenceCalls = [];

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const paidRes = await post({}, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202);
  assert.equal(paid.rolling?.this_call_billed_on, 'this_request', 'unauth paid call collects immediately');
  assert.equal(inferenceCalls.length, 1, 'provider was called for paid unauth');
});

// ════════════════════════════════════════════════════════════════════════════
// Bankr incident regression tests (2026-08-21):
// Never settle USDC unless the request body is valid and we are prepared to fulfill.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Helper to POST with a raw body (not using bodyOf helper).
 * Used for testing empty/invalid body scenarios.
 */
const postRaw = (body, headers = {}) => realFetch(`${base}/task-request`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...headers,
  },
  body: body != null ? JSON.stringify(body) : undefined,
});

test('REGRESSION: unauth + PAYMENT-SIGNATURE + empty body → 400 WITHOUT settle (Bankr incident)', async () => {
  resetRollingSettlement();
  facilitatorSettleCalls = [];
  const settleCountBefore = facilitatorSettleCalls.length;

  // First, get a valid nonce from a discovery challenge
  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  // Now send the request with a payment header but EMPTY body
  const res = await postRaw({}, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const body = await res.json();

  // CRITICAL: Must be 400 (validation error), NOT 202 (accepted)
  assert.equal(res.status, 400, `empty body must return 400, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body.error, 'validation_error', 'error code must be validation_error');
  assert.ok(Array.isArray(body.details), 'details must be an array of validation errors');
  assert.ok(body.details.length > 0, 'must have at least one validation error');

  // CRITICAL: Facilitator settle must NOT have been called
  const settleCountAfter = facilitatorSettleCalls.length;
  assert.equal(
    settleCountAfter,
    settleCountBefore,
    `facilitator settle must NOT be called for empty body; settle calls: ${settleCountAfter - settleCountBefore}`
  );
});

test('REGRESSION: unauth + X-PAYMENT + empty body → 400 WITHOUT settle (v1 variant)', async () => {
  resetRollingSettlement();
  facilitatorSettleCalls = [];
  const settleCountBefore = facilitatorSettleCalls.length;

  // First, get a valid nonce from a discovery challenge
  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  // Now send the request with a v1 payment header but EMPTY body
  const res = await postRaw({}, {
    'x-payment': 'V1-PAYMENT-BLOB',
    'x-payment-nonce': nonce,
  });
  const body = await res.json();

  assert.equal(res.status, 400, `empty body must return 400, got ${res.status}`);
  assert.equal(body.error, 'validation_error');

  const settleCountAfter = facilitatorSettleCalls.length;
  assert.equal(settleCountAfter, settleCountBefore, 'facilitator settle must NOT be called');
});

test('REGRESSION: unauth + PAYMENT-SIGNATURE + missing required fields → 400 WITHOUT settle', async () => {
  resetRollingSettlement();
  facilitatorSettleCalls = [];
  const settleCountBefore = facilitatorSettleCalls.length;

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  // Invalid body: has message_type but missing chain_id, amount, sender
  const invalidBody = {
    message_type: 'inference_request',
    model_id: 'akash/zai-org/GLM-5.2',
    // missing: chain_id, amount, sender
  };

  const res = await postRaw(invalidBody, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const body = await res.json();

  assert.equal(res.status, 400, `invalid body must return 400, got ${res.status}`);
  assert.equal(body.error, 'validation_error');
  assert.ok(body.details.some(d => d.includes('chain_id')), 'must report missing chain_id');
  assert.ok(body.details.some(d => d.includes('amount')), 'must report missing amount');
  assert.ok(body.details.some(d => d.includes('sender')), 'must report missing sender');

  const settleCountAfter = facilitatorSettleCalls.length;
  assert.equal(settleCountAfter, settleCountBefore, 'facilitator settle must NOT be called');
});

test('REGRESSION: keyed + PAYMENT-SIGNATURE + empty body → 400 WITHOUT settle', async () => {
  resetRollingSettlement();
  facilitatorSettleCalls = [];
  const settleCountBefore = facilitatorSettleCalls.length;

  // A keyed caller with payment header + empty body should still get 400
  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const res = await postRaw({}, {
    'x-api-key': 'keyed-caller-1',
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const body = await res.json();

  assert.equal(res.status, 400, `keyed caller with empty body must return 400, got ${res.status}`);
  assert.equal(body.error, 'validation_error');

  const settleCountAfter = facilitatorSettleCalls.length;
  assert.equal(settleCountAfter, settleCountBefore, 'facilitator settle must NOT be called');
});

test('REGRESSION: unauth + no payment + empty body → discovery 402 (unchanged)', async () => {
  resetRollingSettlement();

  // No payment header, empty body → should get discovery 402, NOT 400
  const res = await postRaw({});
  const body = await res.json();

  assert.equal(res.status, 402, 'unauth + no payment + empty body must return discovery 402');
  assert.equal(body.x402Version, 2, 'challenge is x402 v2');
  assert.ok(body.accepts, 'challenge has accepts array');
});

test('REGRESSION: valid body + payment header → handshake still runs (positive case)', async () => {
  resetRollingSettlement();
  facilitatorSettleCalls = [];
  inferenceCalls = [];
  const settleCountBefore = facilitatorSettleCalls.length;

  const challengeRes = await post();
  assert.equal(challengeRes.status, 402);
  const challenge = await challengeRes.json();
  const nonce = challenge.accepts[0].extra.nonce;

  // Valid body with all required fields
  const paidRes = await post({}, {
    'payment-signature': 'CDP-V2-PAYMENT-BLOB',
    'payment-nonce': nonce,
  });
  const paid = await paidRes.json();

  assert.equal(paidRes.status, 202, `valid body must settle and accept, got ${paidRes.status}`);
  assert.ok(paid.task_id, 'paid call returns a task_id');

  // Settle SHOULD be called for valid body
  const settleCountAfter = facilitatorSettleCalls.length;
  assert.ok(
    settleCountAfter > settleCountBefore,
    'facilitator settle SHOULD be called for valid body'
  );

  // And inference should run
  await waitComplete(paid.task_id);
  assert.equal(inferenceCalls.length, 1, 'provider was called');
});
