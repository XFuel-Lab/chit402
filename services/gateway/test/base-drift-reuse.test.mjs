/** A Base tx the clock gate rejected for a re-published root is not reused forever; a fresh tx anchors the root. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');

test('drift-rejected prior Base tx is replaced by a fresh anchor on the next tick', async () => {
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_LOG_BOOT = '0';
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  const tree = new ReceiptMerkleTree();
  tree.dir = mkdtempSync(join(tmpdir(), 'drift-'));
  await tree.appendReceipt('a', 'ra', { publish: false });
  const sent = [];
  const send = async (a) => { sent.push(a.hash); return a.hash; };
  const lookup = async (i) => ({ receiptOk: true, receiptStatus: '0x1', tx: i.tx, root: i.root, from: i.from, to: i.to, nonce: i.nonce });
  const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
  const first = await tree.publishHead({ force: true, now: '2026-10-15T17:50:00Z', nonce: 4, sleep: async () => {}, send, lookup, blockTimestamp: sec('2026-10-15T17:50:25Z') });
  const oldTx = first.anchors.base.tx;
  const pub = async (iso, force = false) => await tree.publishHead({ force, recheckDaily: true, now: iso, nonce: 4 + sent.length, sleep: async () => {}, send, lookup,
    readBlockTs: async (tx) => (tx === oldTx ? sec('2026-10-15T17:50:25Z') : sec(iso) + 25) });
  const drifted = await pub('2026-10-16T00:00:30Z', true);
  assert.equal(drifted.anchors.base.reason, 'anchor_clock_drift');
  assert.equal(drifted.anchors.base.rejected_tx, oldTx);
  const next = await pub('2026-10-16T00:02:30Z');
  assert.equal(next.anchors.base.status, 'anchored');
  assert.notEqual(next.anchors.base.tx, oldTx);
  assert.equal(sent.length, 2);
  const again = await pub('2026-10-16T00:04:30Z');
  assert.equal(again.anchors.base.tx, next.anchors.base.tx);
  assert.equal(sent.length, 2, 'no further sends once anchored');
});
