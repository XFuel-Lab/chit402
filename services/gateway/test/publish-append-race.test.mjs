/**
 * A leaf appended while publishHead awaits the anchor send must not produce a
 * signed head whose tree_size is larger than the leaves its root covers.
 * No network and no broadcast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { ReceiptMerkleTree, resetReceiptMerkleTree, verifyTreeHead } = await import('../src/receipt-merkle.js');
const { readReceiptLog } = await import('../src/receipt-log-store.js');

function opts(now, hook) {
  return {
    force: true,
    now,
    nonce: 4,
    blockTimestamp: Math.floor(Date.parse(now) / 1000),
    lookup: async (i) => ({ receiptOk: true, receiptStatus: '0x1', tx: i.tx, root: i.root, from: i.from, to: i.to, nonce: i.nonce }),
    send: async (args) => { if (hook) hook(); return args.hash; },
  };
}

test('append during the anchor await keeps tree_size equal to the root size', async () => {
  const saved = { ...process.env };
  process.env.RECEIPT_LOG_BOOT = '0';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = mkdtempSync(join(tmpdir(), 'chit-race-'));
    for (const id of ['a', 'b', 'c']) tree.appendReceipt(id, `r${id}`, { publish: false });
    const h4 = await tree.publishHead(opts('2026-10-08T05:32:00.000Z'));
    assert.equal(h4.tree_size, 4);
    for (const id of ['d', 'e', 'f', 'g', 'h']) tree.appendReceipt(id, `r${id}`, { publish: false });
    const raced = await tree.publishHead(opts('2026-10-09T10:23:55.000Z', () => {
      tree.appendReceipt('late', 'rlate', { publish: false });
    }));
    assert.equal(tree.leaves.length, 10);
    assert.equal(raced.tree_size, 9, 'head size is the size the root was computed over');
    assert.equal(verifyTreeHead(raced).valid, true);
    // Default inclusion uses the newest anchored head and must not 400.
    assert.equal(tree.inclusion('b').status, 'anchored');
    assert.equal(tree.inclusion('late').status, 'pending_anchor');
    // A restart replays the journal and must not refuse the stored head.
    assert.doesNotThrow(() => readReceiptLog(tree.dir, { strict: true }));
  } finally {
    process.env = saved;
    resetReceiptMerkleTree();
  }
});
