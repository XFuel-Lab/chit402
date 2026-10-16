/** A Base anchor that stays dropped past 6x the stuck age is replaced at its nonce, not rebroadcast forever. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');

test('dropped anchor tx is surfaced, then replaced at the same nonce', async () => {
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_LOG_BOOT = '0';
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  const tree = new ReceiptMerkleTree();
  tree.dir = mkdtempSync(join(tmpdir(), 'chit-drop-'));
  const sent = [];
  const send = async (a) => { sent.push(a.raw); return a.hash; };
  const lookup = async (i) => ({ rebroadcast: true, missing: true, tx: i.tx, nonce: i.nonce });
  const t0 = Date.parse('2026-10-08T05:00:00Z');
  const tick = async (min, id) => {
    tree.appendReceipt(id, `r${id}`, { publish: false });
    await tree.publishHead({ force: true, now: new Date(t0 + min * 60e3).toISOString(), nonce: 4, sleep: async () => {}, send, lookup });
  };
  await tick(0, 'a');
  await tick(30, 'b');
  assert.equal(new Set(sent).size, 1, 'inside the window the same bytes are rebroadcast');
  assert.equal(tree.bundleStatus(new Date(t0 + 30 * 60e3)).last_error, 'prior_nonce_dropped');
  await tick(90, 'c');
  assert.ok(new Set(sent).size > 1, 'past 6x stuck age a bumped replacement is signed');
  assert.ok(tree.anchorIntents.some((r) => r.status === 'superseded' && r.nonce === 4));
});
