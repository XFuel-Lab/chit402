/**
 * A fresh paid /v1 call must report settlement_status settled.
 * The settle-time book row is written before the response is labeled;
 * that same-call close is not an idempotent replay of itself.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

import { evmAuthHeader } from './helpers/evm-auth-header.mjs';
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

const { url: facUrl, close: closeFac, server: facServer } = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { paidFulfillmentRuns, resetPaidFulfillmentRuns } = await import('../src/paid-response-replay.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { buildAuditorExport, renderAuditorHtml } = await import('../src/receipt.js');
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
  app = await createApp();
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

async function paidChat(reuseNonce = null, paymentHeader = evmAuthHeader('PAYMENT-BLOB')) {
  let nonce = reuseNonce;
  if (!nonce) {
    const challenge = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
    assert.equal(challenge.status, 402);
    const challengeBody = await challenge.json();
    nonce = challengeBody.accepts[0].extra.nonce;
  }
  const headers = {
    'content-type': 'application/json',
    'x-payment-nonce': nonce,
  };
  if (paymentHeader != null) headers['x-payment'] = paymentHeader;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(chatBody),
  });
  const raw = await res.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  return { status: res.status, raw, body, nonce };
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
  const shell = await (await fetch(`${base}/receipt/${taskId}?format=auditor`)).json();
  assert.equal(shell.schema, 'chit402.receipt_shell.v1');
  const exp = buildAuditorExport(xfuel);
  assert.equal(exp.checks.fee_bps_within_cap, true);
  assert.equal(exp.checks.rail_allowed, true);
  assert.equal(exp.checks.binding_ok, 'no_policy');
  assert.equal(exp.in_policy, true);

  const page = renderAuditorHtml(exp);
  assert.match(page, /in policy/);
  assert.doesNotMatch(page, /policy check failed/);

  const ledger = app.locals.__test.usageSettled;
  const row = ledger.findByTask(taskId);
  assert.ok(row);
  assert.equal(row.replay_events, undefined);

  const second = await paidChat(first.nonce);
  assert.equal(second.status, 200, second.raw);
  assert.equal(second.raw, first.raw);
  assert.equal(second.body.xfuel.task_id, taskId);
  assert.equal(second.body.xfuel.issuer_signature.jws, xfuel.issuer_signature.jws);
  assert.equal(ledger.entries.filter((e) => e.payment_ref === xfuel.payment.ref).length, 1);
  assert.equal(row.replay_events, undefined);
});

test('a replay without the original payment proof is 409 and leaks no wallet or tx', async () => {
  const first = await paidChat();
  assert.equal(first.status, 200, first.raw);
  const tx = String(first.body.xfuel.payment.ref).split(':').slice(1).join(':');
  const payer = first.body.xfuel.caller_binding?.payer_wallet
    || first.body.xfuel.payment?.payer
    || first.body.xfuel.payment?.payer_wallet;
  assert.ok(tx, 'receipt has a transaction');
  assert.ok(payer, 'receipt has a payer');
  const forged = Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
    payload: {
      signature: `0x${'22'.repeat(65)}`,
      authorization: { from: payer, to: '0xtreasury', value: '2000', nonce: '0x' + 'cd'.repeat(32) },
    },
  }), 'utf8').toString('base64');
  const cases = [
    ['missing header', null],
    ['garbage header', 'not-a-payment'],
    ['forged authorization', forged],
  ];
  for (const [label, header] of cases) {
    const replay = await paidChat(first.nonce, header);
    assert.equal(replay.status, 409, `${label}: ${replay.raw}`);
    assert.equal(replay.body?.error?.code, 'payment_replayed', label);
    assert.equal(replay.raw.includes(tx), false, label);
    assert.equal(replay.raw.includes(payer), false, label);
    assert.equal(replay.raw.includes(first.body.xfuel.task_id), false, label);
  }
});

test('20 concurrent copies of one challenge settle once and return one receipt', async () => {
  const probe = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(probe.status, 402);
  const nonce = (await probe.json()).accepts[0].extra.nonce;
  const settlesBefore = facServer.settleCount;
  resetPaidFulfillmentRuns();
  const results = await Promise.all(Array.from({ length: 20 }, async () => await paidChat(nonce)));
  assert.equal(facServer.settleCount - settlesBefore, 1);
  assert.equal(paidFulfillmentRuns(), 1);
  assert.equal(results.length, 20);
  for (const result of results) {
    assert.equal(result.status, 200, result.raw);
    assert.equal(result.raw, results[0].raw);
  }
  const taskIds = new Set(results.map((result) => result.body.xfuel.task_id));
  assert.equal(taskIds.size, 1);
});
