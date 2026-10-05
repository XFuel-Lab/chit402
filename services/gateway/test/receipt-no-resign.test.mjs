/**
 * A stored receipt is not re-signed on read.
 * A v9 JWS with a stale covering head stays byte-identical through
 * GET /receipt/:id and GET /receipt/:id/preimage. /preimage is 404.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt, decodeReceiptClaims, stampCoveringTreeHead } = await import('../src/receipt.js');
const { signJws } = await import('../src/issuer-key.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');

const TASK_ID = 'xfuel-stale-v9-head';
const STALE_HEAD = 'ab'.repeat(32);

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
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      chain: 'base',
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
  };
}

before(async () => {
  resetReceiptMerkleTree();
  const tree = getReceiptMerkleTree();
  tree.appendReceipt(TASK_ID, 'row-stale-v9');
  const covering = tree.prefixRoot(TASK_ID);
  assert.ok(covering);
  assert.notEqual(covering, STALE_HEAD);

  const task = paidTask();
  const drafted = buildReceipt(task, {
    baseUrl: 'https://api.chit402.com',
    persistSignature: true,
    agentId: 4,
  });
  const claims = decodeReceiptClaims(drafted);
  const legacy = { ...claims, payload_version: 9, tree_head_hash: STALE_HEAD };
  delete legacy.issuer_history;
  delete legacy.payload_hash;
  const { jws, kid } = signJws(legacy);
  originalJws = jws;
  task.issuerSignature = {
    alg: 'ES256',
    payload_version: 9,
    jws,
    kid,
    issuer_jwk: drafted.issuer_signature.issuer_jwk,
  };
  assert.equal(stampCoveringTreeHead({
    task_id: TASK_ID,
    issuer_signature: task.issuerSignature,
  }).issuer_signature.jws, originalJws);

  await initAIListener();
  getAIListener().activeTasks.set(TASK_ID, task);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
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

test('GET /receipt and /preimage keep a stale-head v9 JWS byte-identical', async () => {
  const pre = await fetch(`${base}/receipt/${TASK_ID}/preimage`);
  assert.equal(pre.status, 404);
  const missing = await pre.json();
  assert.equal(missing.error, 'preimage_unavailable');

  const res = await fetch(`${base}/receipt/${TASK_ID}?format=json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.issuer_signature.jws, originalJws);
  assert.equal(body.issuer_signature.payload_version, 9);
  const claims = decodeReceiptClaims(body);
  assert.equal(claims.payload_version, 9);
  assert.equal(claims.tree_head_hash, STALE_HEAD);
  assert.equal(claims.issuer_history, undefined);
  assert.equal(claims.payload_hash, undefined);
  assert.equal(body.issuer_signature.canonical_preimage, undefined);

  const again = await fetch(`${base}/receipt/${TASK_ID}/preimage`);
  assert.equal(again.status, 404);
  const stored = getAIListener().activeTasks.get(TASK_ID);
  assert.equal(stored.issuerSignature.jws, originalJws);
  assert.equal(stored.issuerSignature.payload_version, 9);
});
