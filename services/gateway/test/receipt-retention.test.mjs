/**
 * A stored receipt older than TASK_STORE_RETENTION_MS must still resolve.
 *
 * gcPersisted used to unlink every snapshot whose updatedAt/createdAt was older
 * than 30 days. The public house receipt chit-1e57cdd7 (Base tx 2026-09-01)
 * 404'd that way while GET /receipt/by-tx still redirected off the usage ledger.
 * Pre-v9 payloads are not a reason to drop the row.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-receipt-retention-'));
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.TASK_STORE_RETENTION_MS = String(30 * 24 * 3600 * 1000);

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt, decodeReceiptClaims } = await import('../src/receipt.js');
const { signJws } = await import('../src/issuer-key.js');

const UUID = '1e57cdd7-4fde-4525-bea3-5ffd1d1d909e';
const STORED_ID = `xfuel-${UUID}`;
const PUBLIC_ID = `chit-${UUID}`;
const TX = `0x${'cd'.repeat(32)}`;
const PAYMENT_REF = `base:${TX}`;
const RETENTION_MS = 30 * 24 * 3600 * 1000;

let server;
let base;

function preV9Task() {
  const old = Date.now() - 40 * 24 * 3600 * 1000;
  return {
    taskId: STORED_ID,
    status: 'completed',
    createdAt: old,
    updatedAt: old,
    intent: {
      type: 'inference_request',
      model: 'openai/gpt-4o-mini',
      chainId: 'base',
      amount: '2000',
      paymentRail: 'usdc',
      paymentRef: PAYMENT_REF,
      proofSystem: 'sp1',
    },
    feeAmount: '10',
    netAmount: '1990',
    feeBps: 50,
    meta: { chain: 'base', provider: 'openrouter' },
    result: { provider: 'openrouter', outputHash: `0x${'ab'.repeat(32)}` },
  };
}

/** Sign once, then restamp the same claims as payload v7 (no head binding, no claim_id). */
function cachePreV9Signature(task) {
  const signed = buildReceipt(task, {
    baseUrl: 'https://api.chit402.com',
    persistSignature: true,
  });
  const claims = decodeReceiptClaims(signed);
  assert.ok(claims, 'draft signature decodes');
  const legacy = { ...claims, payload_version: 7 };
  delete legacy.claim_id;
  delete legacy.tree_head_hash;
  delete legacy.tolerance;
  const { jws, kid } = signJws(legacy);
  task.issuerSignature = {
    alg: 'ES256',
    payload_version: 7,
    jws,
    kid,
  };
  return task;
}

before(async () => {
  await initAIListener();
  const store = getAIListener().activeTasks;
  const task = cachePreV9Signature(preV9Task());
  store.set(STORED_ID, task);
  // Hot-map eviction retains the file. GC then used to unlink it.
  assert.equal(store.delete(STORED_ID), true);
  assert.equal(store.size, 0);
  const removed = store.gcPersisted(RETENTION_MS);
  assert.equal(removed, 0, 'a public receipt is not pruned');
  assert.ok(fs.existsSync(store._fileFor(STORED_ID)), 'snapshot file still on disk');
  const rehydrated = store.get(STORED_ID);
  assert.equal(rehydrated?.issuerSignature?.payload_version, 7);

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
  getAIListener().activeTasks.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('GET /receipt/:id serves a pre-v9 receipt older than retention', async () => {
  for (const id of [PUBLIC_ID, STORED_ID]) {
    const res = await fetch(`${base}/receipt/${id}?format=json`);
    assert.equal(res.status, 200, id);
    const body = await res.json();
    assert.equal(body.task_id, STORED_ID);
    assert.equal(body.issuer_signature.payload_version, 7);
    assert.equal(body.payment.ref, PAYMENT_REF);
    const claims = decodeReceiptClaims(body);
    assert.equal(claims.payload_version, 7);
    assert.equal(Object.prototype.hasOwnProperty.call(claims, 'tree_head_hash'), false);
  }
});

test('GET /receipt/by-tx redirects to the retained pre-v9 receipt', async () => {
  const res = await fetch(
    `${base}/receipt/by-tx?tx=${TX}&format=json`,
    { redirect: 'manual' },
  );
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.ok(location?.includes(`/receipt/${STORED_ID}`), location);
  const followed = await fetch(location);
  assert.equal(followed.status, 200);
  const body = await followed.json();
  assert.equal(body.task_id, STORED_ID);
  assert.equal(body.issuer_signature.payload_version, 7);
  assert.equal(body.payment.ref, PAYMENT_REF);
});
