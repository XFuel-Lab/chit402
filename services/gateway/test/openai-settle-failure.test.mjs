/**
 * Post-settle /v1 failures must never return a bare HTTP 500 without a receipt.
 * USDC that moved must yield xfuel.receipt.v4 with payment.collected true and a
 * public GET /receipt/:taskId — even when inference or hub routing fails.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'false';
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;

const { url: facUrl, close: closeFac } = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;

const chatBody = {
  model: 'theta/qwen3',
  messages: [{ role: 'user', content: 'hello after settle' }],
  max_tokens: 16,
};

before(async () => {
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
  await closeFac();
  await new Promise((resolve) => server.close(resolve));
});

async function issueV1Challenge() {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  return body.accepts[0].extra.nonce;
}

test('settle then hub failure returns receipt, not 500', async () => {
  const nonce = await issueV1Challenge();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': 'PAYMENT-BLOB',
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(chatBody),
  });

  assert.notEqual(res.status, 500, 'settled payment must not surface as bare 500');
  const body = await res.json();
  assert.ok(body.xfuel, 'response must include xfuel receipt block');
  assert.equal(body.xfuel.schema, 'xfuel.receipt.v4');
  assert.equal(body.xfuel.payment.collected, true);
  assert.ok(body.xfuel.payment.ref, 'receipt must name payment ref');
  assert.ok(body.task_id || body.xfuel.task_id, 'response must name task_id');
  const taskId = body.task_id || body.xfuel.task_id;

  const receiptRes = await fetch(`${base}/receipt/${taskId}?format=json`);
  assert.equal(receiptRes.status, 200);
  const publicReceipt = await receiptRes.json();
  assert.equal(publicReceipt.schema, 'xfuel.receipt.v4');
  assert.equal(publicReceipt.payment.collected, true);
  assert.equal(publicReceipt.payment.ref, body.xfuel.payment.ref);
});

test('settle then hub failure does not use payment processing failed', async () => {
  const nonce = await issueV1Challenge();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': 'PAYMENT-BLOB',
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(chatBody),
  });
  const body = await res.json();
  assert.notEqual(body.error?.message, 'payment processing failed');
});
