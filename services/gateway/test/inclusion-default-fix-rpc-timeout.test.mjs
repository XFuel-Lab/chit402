/**
 * Part B follow-up for PR #527: block-time reads are bounded, and a prior
 * tracker row's block time is not carried onto a different tx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RECEIPT_LOG_BOOT = '0';

const { jsonRpc, fetchBaseBlockTimestamp } = await import('../src/receipt-anchor-clock.js');
const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');

function hungServer() {
  const sockets = new Set();
  const server = http.createServer(() => { /* never answers */ });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
    }));
  });
}

test('jsonRpc aborts a hung block-time read', { timeout: 10_000 }, async () => {
  const srv = await hungServer();
  const started = Date.now();
  try {
    await assert.rejects(() => jsonRpc(srv.url, 'eth_getTransactionReceipt', ['0x01'], { timeoutMs: 150 }));
    assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started} ms`);
    await assert.rejects(() => fetchBaseBlockTimestamp('0x01', srv.url, {
      call: (u, m, p) => jsonRpc(u, m, p, { timeoutMs: 150 }),
    }));
    assert.ok(Date.now() - started < 4_000);
  } finally {
    await srv.close();
  }
});

test('_commitAnchored does not move block_ts onto a different tx', () => {
  const tree = new ReceiptMerkleTree();
  tree.dir = mkdtempSync(path.join(tmpdir(), 'doc-527-bts-'));
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const root = 'aa'.repeat(32);
  const from = '0x1111111111111111111111111111111111111111';
  tree.anchorState.base[root] = {
    status: 'anchored', tx: `0x${'01'.repeat(32)}`, from, chain_id: 8453, nonce: 3, receipt_confirmed: true, block_ts: 1_791_541_437,
  };
  const txB = `0x${'02'.repeat(32)}`;
  const intent = { root, from, to: from, tx: txB, nonce: 4, day: '2026-10-09', status: 'broadcast' };
  const out = tree._commitAnchored(intent, { receiptOk: true, receiptStatus: '0x1', tx: txB, root, from, to: from, nonce: 4 });
  assert.ok(out);
  assert.equal(tree.anchorState.base[root].tx, txB);
  assert.equal(tree.anchorState.base[root].block_ts, undefined);
  assert.equal(tree.anchorState.base[root].nonce, 4);
  fs.rmSync(tree.dir, { recursive: true, force: true });
});
