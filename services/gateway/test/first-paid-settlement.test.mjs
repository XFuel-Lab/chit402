/**
 * A fresh paid /v1 call must report settlement_status settled.
 * The settle-time book row is written before the response is labeled;
 * that same-call close is not an idempotent replay of itself.
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
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'true';
process.env.TASK_STORE_PERSIST = 'false';
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;

const { url: facUrl, close: closeFac } = await startMockFacilitator({
  txRef: '0xfirstpaidsettlementtx00000000000000000000000000000000000001',
});
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;
let app;

const chatBody = {
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'ping' }],
  max_tokens: 16,
};

before(async () => {
  resetHubCatalogCache();
  await initAIListener();
  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await closeFac();
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function paidChat() {
  const challenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(challenge.status, 402);
  const challengeBody = await challenge.json();
  const nonce = challengeBody.accepts[0].extra.nonce;
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
  return { status: res.status, body };
}

test('first paid call is settled; a repeat of the same payment is a replay', async () => {
  const first = await paidChat();
  assert.equal(first.status, 200, JSON.stringify(first.body?.error || first.body));
  const xfuel = first.body.xfuel;
  assert.equal(xfuel.payment.collected, true);
  assert.equal(xfuel.settlement_status, 'settled');
  assert.equal(xfuel.idempotent_replay, false);
  assert.equal(xfuel.replay_of, null);
  assert.equal(xfuel.usage_settled.settlement_status, 'settled');
  assert.equal(xfuel.usage_settled.idempotent_replay, false);

  const taskId = xfuel.task_id;
  const auditor = await fetch(`${base}/receipt/${taskId}?format=auditor`);
  assert.equal(auditor.status, 200);
  const exp = await auditor.json();
  assert.equal(exp.checks.fee_bps_within_cap, true);
  assert.equal(exp.checks.rail_allowed, true);
  assert.equal(exp.checks.binding_ok, 'no_policy');
  assert.equal(exp.in_policy, true);

  const html = await fetch(`${base}/receipt/${taskId}?format=auditor&view=html`);
  const page = await html.text();
  assert.match(page, /in policy/);
  assert.doesNotMatch(page, /policy check failed/);

  const ledger = app.locals.__test.usageSettled;
  const row = ledger.findByTask(taskId);
  assert.ok(row);
  assert.equal(row.replay_events, undefined);

  const second = await paidChat();
  assert.equal(second.status, 200, JSON.stringify(second.body?.error || second.body));
  assert.notEqual(second.body.xfuel.task_id, taskId);
  assert.equal(second.body.xfuel.settlement_status, 'idempotent_replay');
  assert.equal(second.body.xfuel.idempotent_replay, true);
  assert.equal(second.body.xfuel.replay_of, taskId);
  assert.equal(ledger.entries.filter((e) => e.payment_ref === xfuel.payment.ref).length, 1);
  assert.equal(row.replay_events.length, 1);
  assert.equal(row.replay_events[0].replay_of, taskId);
});
