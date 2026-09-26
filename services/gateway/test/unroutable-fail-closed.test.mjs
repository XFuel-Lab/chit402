/**
 * A paid x402 request for a model with no route must fail closed before settle.
 * An alias such as gpt-4o-mini resolves to the live gpt-oss row. If USDC already
 * moved and nothing was served, the receipt is failed with refund_status owed.
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
process.env.DOOR_METRICS_TOKEN = 'test-door-token';
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;

const { url: facUrl, server: facServer, close: closeFac } = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { mergeReceiptView } = await import('../src/receipt.js');

let server;
let base;

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

function postChat(body, headers = {}) {
  return fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('unknown model is 400 model_not_routable and never settles', async () => {
  const settlesBefore = facServer.settleCount;
  const verifiesBefore = facServer.verifyCount;
  const res = await postChat(
    {
      model: 'grok-9-ultra',
      messages: [{ role: 'user', content: 'charge me for nothing' }],
      max_tokens: 16,
    },
    { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': `0x${'ab'.repeat(32)}` },
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'model_not_routable');
  assert.equal(body.charged, false);
  assert.equal(body.xfuel, undefined);
  assert.ok(Array.isArray(body.available_models));
  assert.ok(body.available_models.includes('akash/openai/gpt-oss-120b'));
  assert.match(body.error.message, /No charge was made/);
  assert.equal(facServer.settleCount, settlesBefore);
  assert.equal(facServer.verifyCount, verifiesBefore);
});

test('specific models we do not serve 400 before verify/settle', async () => {
  const names = [
    'gpt-5',
    'o1',
    'o3',
    'o1-mini',
    'claude-opus-4',
    'claude-opus-4-20250514',
    'grok-4',
    'kimi-k2',
    'openai/gpt-5',
    'anthropic/claude-opus-4',
  ];
  for (const model of names) {
    const settlesBefore = facServer.settleCount;
    const verifiesBefore = facServer.verifyCount;
    const res = await postChat(
      {
        model,
        messages: [{ role: 'user', content: 'do not charge' }],
        max_tokens: 16,
      },
      { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': `0x${'cd'.repeat(32)}` },
    );
    assert.equal(res.status, 400, model);
    const body = await res.json();
    assert.equal(body.error.code, 'model_not_routable', model);
    assert.equal(body.charged, false, model);
    assert.ok(Array.isArray(body.available_models), model);
    assert.ok(body.available_models.includes('akash/openai/gpt-oss-120b'), model);
    assert.match(body.error.message, /No charge was made/, model);
    assert.equal(facServer.settleCount, settlesBefore, model);
    assert.equal(facServer.verifyCount, verifiesBefore, model);
  }
});

test('bare gpt and a stripped anthropic alias challenge before settle', async () => {
  const settlesBefore = facServer.settleCount;
  const verifiesBefore = facServer.verifyCount;
  for (const model of ['gpt', 'openai', 'anthropic/claude-3-5-sonnet']) {
    const res = await postChat({
      model,
      messages: [{ role: 'user', content: 'route me' }],
      max_tokens: 8,
    });
    assert.equal(res.status, 402, model);
  }
  assert.equal(facServer.settleCount, settlesBefore);
  assert.equal(facServer.verifyCount, verifiesBefore);
});

test('unauth unknown model is 400, not a 402 that invites payment', async () => {
  const settlesBefore = facServer.settleCount;
  const res = await postChat({
    model: 'totally-made-up',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'model_not_routable');
  assert.equal(body.charged, false);
  assert.equal(facServer.settleCount, settlesBefore);
});

test('gpt-4o-mini aliases to gpt-oss; a post-settle miss is refund owed', async () => {
  const probe = await postChat({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello after alias' }],
    max_tokens: 16,
  });
  assert.equal(probe.status, 402, 'a routable alias still challenges when unpaid');
  const challenge = await probe.json();
  const nonce = challenge.accepts[0].extra.nonce;

  const settlesBefore = facServer.settleCount;
  const res = await postChat(
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello after alias' }],
      max_tokens: 16,
    },
    { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': nonce },
  );
  assert.ok(facServer.settleCount > settlesBefore, 'alias is routable, so settle runs');
  assert.notEqual(res.status, 500);
  const body = await res.json();
  assert.equal(body.xfuel.status, 'failed');
  assert.equal(body.xfuel.proof_outcome, 'invalid');
  assert.equal(body.xfuel.payment.collected, false);
  assert.equal(body.xfuel.refund.refund_status, 'owed');
  assert.equal(body.xfuel.refund.payment_ref, body.xfuel.payment.ref);
  assert.ok(body.xfuel.refund.amount);
  const view = mergeReceiptView(body.xfuel);
  assert.equal(view.route.model, 'akash/openai/gpt-oss-120b');
  assert.equal(view.route.requested, 'gpt-4o-mini');
  assert.equal(view.route.requested_model, 'gpt-4o-mini');
  assert.notEqual(view.route.model, 'gpt-4o-mini');

  const taskId = body.task_id || body.xfuel.task_id;
  const receiptRes = await fetch(`${base}/receipt/${taskId}?format=json`);
  assert.equal(receiptRes.status, 200);
  const publicReceipt = await receiptRes.json();
  const publicView = mergeReceiptView(publicReceipt);
  assert.equal(publicReceipt.status, 'failed');
  assert.equal(publicReceipt.proof_outcome, 'invalid');
  assert.equal(publicView.route.model, 'akash/openai/gpt-oss-120b');
  assert.equal(publicView.route.requested, 'gpt-4o-mini');
  assert.equal(publicView.route.requested_model, 'gpt-4o-mini');
  assert.equal(publicReceipt.route_meta.requested_model, 'gpt-4o-mini');
  assert.equal(publicReceipt.refund.refund_status, 'owed');
  assert.equal(publicView.payment.collected, false);
  assert.equal(publicReceipt.refund.payer, body.xfuel.refund.payer);
  assert.equal(publicReceipt.refund.amount, body.xfuel.refund.amount);

  const statusRes = await fetch(`${base}/task-status?task_id=${encodeURIComponent(taskId)}`);
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.status, 'failed');
  assert.equal(status.proof_outcome, 'invalid');
  assert.equal(status.refund.refund_status, 'owed');
  assert.equal(status.refund.payment_ref, body.xfuel.payment.ref);

  const doorRes = await fetch(`${base}/v1/internal/door-metrics`, {
    headers: { authorization: 'Bearer test-door-token' },
  });
  assert.equal(doorRes.status, 200);
  const door = await doorRes.json();
  assert.ok(door.windows['24h'].refunds_owed >= 1);
});
