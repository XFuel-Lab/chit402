/**
 * B3: a GET returns the stored issuer JWS. It does not sign a second one.
 * A flag-off v10 tree-head restamp still re-signs when a write asks for it.
 * That second signature must not be produced by GET /receipt, /preimage,
 * /og.png, or the owner view.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'false';
process.env.X402_ENABLED = 'false';
process.env.ISSUER_ROOT_ENABLED = 'false';
process.env.OWNER_VIEW_AUDIENCES = '127.0.0.1';

const payer = Wallet.createRandom();
const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt, decodeReceiptClaims, stampCoveringTreeHead } = await import('../src/receipt.js');
const { verifyJwsWithJwks, getJwks } = await import('../src/issuer-key.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');

const TASK_ID = 'xfuel-b3-stored-jws';

let server;
let base;
let originalJws;

function paidTask() {
  return {
    taskId: TASK_ID,
    status: 'completed',
    createdAt: '2026-09-26T17:27:32.000Z',
    updatedAt: '2026-09-26T17:27:32.000Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'cd'.repeat(32)}`,
      amount: '2000',
      modelId: 'theta/qwen3',
    },
    meta: {
      payerWallet: payer.address,
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      chain: 'base',
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
  };
}

before(async () => {
  resetReceiptMerkleTree();
  const task = paidTask();
  const drafted = buildReceipt(task, {
    baseUrl: 'https://api.chit402.com',
    persistSignature: true,
    agentId: 4,
  });
  originalJws = drafted.issuer_signature.jws;
  const claims = decodeReceiptClaims(drafted);
  assert.equal(claims.payload_version, 10);
  assert.equal(claims.tree_head_hash ?? null, null);

  getReceiptMerkleTree().appendReceipt(TASK_ID, 'row-b3');
  const restamped = stampCoveringTreeHead({
    task_id: TASK_ID,
    issuer_signature: { ...drafted.issuer_signature },
  });
  assert.notEqual(restamped.issuer_signature.jws, originalJws);
  assert.equal(verifyJwsWithJwks(originalJws, getJwks()).valid, true);
  assert.equal(verifyJwsWithJwks(restamped.issuer_signature.jws, getJwks()).valid, true);

  task.issuerSignature = drafted.issuer_signature;
  await initAIListener();
  getAIListener().activeTasks.set(TASK_ID, task);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { getAIListener().activeTasks.destroy(); } catch { /* listener may already be down */ }
  resetReceiptMerkleTree();
});

function storedJws() {
  return getAIListener().activeTasks.get(TASK_ID).issuerSignature.jws;
}

test('GET /receipt, /preimage, and /og.png keep the stored JWS', async () => {
  const page = await fetch(`${base}/receipt/${TASK_ID}?format=json`);
  assert.equal(page.status, 200);
  assert.equal(storedJws(), originalJws);

  const pre = await fetch(`${base}/receipt/${TASK_ID}/preimage`);
  assert.equal(pre.status, 200);
  assert.equal(storedJws(), originalJws);

  const og = await fetch(`${base}/receipt/${TASK_ID}/og.png`);
  assert.equal(og.status, 200);
  assert.equal(storedJws(), originalJws);
  assert.equal(decodeReceiptClaims({ issuer_signature: { jws: storedJws() } }).tree_head_hash ?? null, null);
});

test('the owner view returns that same stored JWS', async () => {
  const issued = await fetch(`${base}/v1/receipts/owner/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: { payer: true } }),
  });
  assert.equal(issued.status, 200, await issued.clone().text());
  const body = await issued.json();
  const signature = await payer.signTypedData(
    body.typed_data.domain,
    body.typed_data.types,
    body.typed_data.message,
  );
  const opened = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: body.challenge,
      signature,
      signer: payer.address,
      kind: 'evm',
    }),
  });
  assert.equal(opened.status, 200, await opened.clone().text());
  const token = (await opened.json()).token;
  const owner = await fetch(`${base}/v1/receipts/${TASK_ID}/owner`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(owner.status, 200, await owner.clone().text());
  const view = await owner.json();
  assert.equal(view.jws, originalJws);
  assert.equal(storedJws(), originalJws);
});
