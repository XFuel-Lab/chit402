/**
 * GET /receipt can run after the paid task is registered and before
 * writeSettleBookRow. That response must not freeze a null claim_id.
 * bookSpend (buildReceipt once the book id exists) re-signs, and the
 * receipt verifies.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt, decodeReceiptClaims, verifyIssuerForHtml } = await import('../src/receipt.js');
const { recordSettleBookRow } = await import('../src/usage-settled.js');

let server;
let base;
let app;

before(async () => {
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
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('GET /receipt before writeSettleBookRow does not freeze a null claim_id', async () => {
  const taskId = 'xfuel-claim-race';
  const paymentRef = 'base:0x' + 'cd'.repeat(32);
  const payer = '0x1111111111111111111111111111111111111111';
  const task = {
    taskId,
    status: 'processing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef,
      amount: '2000',
      modelId: 'theta/qwen3',
    },
    meta: {
      payerWallet: payer,
      provider: 'theta-edgecloud',
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
  };
  getAIListener().activeTasks.set(taskId, task);

  const earlyRes = await fetch(`${base}/receipt/${taskId}?format=json`);
  assert.equal(earlyRes.status, 200);
  const early = await earlyRes.json();
  const earlyClaims = decodeReceiptClaims(early);
  assert.equal(earlyClaims.payment.ref, paymentRef);
  assert.equal(earlyClaims.claim_id, null);
  assert.equal(verifyIssuerForHtml(early).reason, 'claim_id_missing');
  assert.equal(task.issuerSignature, undefined, 'a paid null claim_id is not persisted');
  // An older process may already have stored that signature. It must not stay frozen.
  task.issuerSignature = early.issuer_signature;

  const { usageSettled, agentRegistry } = app.locals.__test;
  const settled = recordSettleBookRow({
    taskId,
    paymentRef,
    amount: '2000',
    payer,
    model: 'theta/qwen3',
    ledger: usageSettled,
    registry: agentRegistry,
  });
  assert.equal(settled.ok, true, settled.reason);
  assert.ok(settled.agent_id);

  // bookSpend stamps the seat, then buildReceipt signs.
  task.meta.agentId = settled.agent_id;
  const booked = buildReceipt(task, {
    baseUrl: base,
    agentId: settled.agent_id,
    persistSignature: true,
  });
  const bookedClaims = decodeReceiptClaims(booked);
  assert.equal(bookedClaims.claim_id, String(settled.agent_id));
  assert.equal(bookedClaims.payment.ref, paymentRef);
  assert.equal(verifyIssuerForHtml(booked).verified, true, verifyIssuerForHtml(booked).reason);
  assert.equal(task.issuerSignature.jws, booked.issuer_signature.jws);

  const again = await (await fetch(`${base}/receipt/${taskId}?format=json`)).json();
  const againClaims = decodeReceiptClaims(again);
  assert.equal(againClaims.claim_id, String(settled.agent_id));
  assert.equal(verifyIssuerForHtml(again).verified, true, verifyIssuerForHtml(again).reason);

  // A later build that does not repeat the seat must not replace it with null.
  delete task.meta.agentId;
  delete task.meta.agent_id;
  const kept = buildReceipt(task, { baseUrl: base, persistSignature: true });
  assert.equal(decodeReceiptClaims(kept).claim_id, String(settled.agent_id));
  assert.equal(verifyIssuerForHtml(kept).verified, true);
});
