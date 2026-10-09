/**
 * Delta follow-up for PR #527 @683e6ad3: the deadline clamp must not shrink
 * uncapped lookups (_lookupIntent, boot reconcile) to 0 ms.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RECEIPT_LOG_BOOT = '0';

const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');

const from = '0x1111111111111111111111111111111111111111';
const intent = { tx: `0x${'01'.repeat(32)}`, root: 'aa'.repeat(32), from, to: from, nonce: 1 };
const receipt = (i) => ({ receiptOk: true, receiptStatus: '0x1', tx: i.tx, root: i.root, from: i.from, to: i.to, nonce: i.nonce });
// A lookup that settles on a later macrotask, like any real RPC.
const slow = (ms) => (i) => new Promise((resolve) => setTimeout(() => resolve(receipt(i)), ms));
const hung = () => new Promise(() => {});

async function elapsed(fn) {
  const t0 = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t0 }; } catch (err) { return { ok: false, ms: Date.now() - t0, code: err?.code || err?.message }; }
}

test('uncapped lookups keep the full per-call budget', async () => {
  const tree = new ReceiptMerkleTree();
  for (const run of [
    () => tree._boundedLookup(intent, slow(25), null),
    () => tree._boundedLookup(intent, slow(25), null, undefined),
    () => tree._boundedLookup(intent, slow(25), null, null),
    () => tree._lookupIntent(intent, slow(25), null),
  ]) {
    const r = await elapsed(run);
    assert.equal(r.ok, true, `uncapped lookup failed with ${r.code}`);
  }
});

test('a cap is clamped to at least 1 ms and at most the budget', async () => {
  const tree = new ReceiptMerkleTree();
  tree.anchorRpcTimeoutMs = 300;
  for (const cap of [0, -5, 0.4]) {
    const r = await elapsed(() => tree._boundedLookup(intent, hung, null, cap));
    assert.equal(r.code, 'rpc_timeout');
    assert.ok(r.ms < 100, `cap ${cap} took ${r.ms} ms`);
  }
  const big = await elapsed(() => tree._boundedLookup(intent, hung, null, 1e12));
  assert.equal(big.code, 'rpc_timeout');
  assert.ok(big.ms >= 290 && big.ms < 1_000, `huge cap took ${big.ms} ms`);
  const mid = await elapsed(() => tree._boundedLookup(intent, hung, null, 120));
  assert.ok(mid.ms >= 110 && mid.ms < 290, `cap 120 took ${mid.ms} ms`);
});

test('boot reconcile keeps an anchored intent anchored with a real async lookup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'doc-527-cap-'));
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    for (let i = 0; i < 4; i += 1) tree.appendReceipt(`c-${i}`, `row-${i}`, { publish: false });
    const head = await tree.publishHead({ force: true, now: new Date().toISOString(), nonce: 3, send: async (a) => a.hash, lookup: slow(5), sleep: async () => {} });
    assert.ok(['anchored', 'unconfirmed', 'broadcast'].includes(head.anchors.base.status));
    const t2 = new ReceiptMerkleTree();
    t2.load(dir);
    await t2.reconcileAnchorIntents({ lookup: slow(20) });
    const latest = t2._latestBaseIntents();
    assert.ok(latest.length >= 1);
    for (const row of latest) assert.notEqual(row.status, 'blocked', `intent blocked: ${row.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
