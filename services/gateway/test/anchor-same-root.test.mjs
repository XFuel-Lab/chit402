/**
 * A failed, dropped, or replaced Base anchor keeps that tree-head root
 * queued until the receipt confirms. A later root is not substituted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ReceiptMerkleTree, rootOf } = await import('../src/receipt-merkle.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-same-root-'));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function anchorIntentRows(dir) {
  return fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.op === 'anchor_intent');
}

function rawFor(dir, root) {
  return anchorIntentRows(dir).some((row) => row.root === root && row.raw);
}

async function withKey(fn) {
  const prev = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  try {
    await fn();
  } finally {
    if (prev == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prev;
  }
}

function treeAt(dir) {
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  return tree;
}

test('a failed, dropped, or replaced anchor resends the same root until it confirms', async () => {
  await withKey(async () => {
    const failedDir = tmp();
    const failed = treeAt(failedDir);
    await failed.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      sleep: async () => {},
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    const failedRoot = hex(rootOf(failed.leaves));
    const firstRaw = anchorIntentRows(failedDir).find((row) => row.raw);
    failed.appendReceipt('row-2', 'hash-2', { publish: false });
    const failedLater = hex(rootOf(failed.leaves));
    const failedSends = [];
    await failed.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async (intent) => ({ rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        failedSends.push(args.calldata);
        if (args.raw === firstRaw.raw) throw new Error('broadcast_rejected');
        return args.hash;
      },
    });
    assert.notEqual(failedRoot, failedLater);
    assert.deepEqual(failedSends, [`0x${failedRoot}`, `0x${failedRoot}`]);
    assert.equal(rawFor(failedDir, failedLater), false);
    assert.equal(anchorIntentRows(failedDir).some((row) => (
      row.root === failedRoot && row.nonce === 4 && row.status === 'superseded'
    )), true);

    const droppedDir = tmp();
    const dropped = treeAt(droppedDir);
    const droppedSends = [];
    await dropped.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async (intent) => ({ rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        droppedSends.push(args);
        return args.hash;
      },
    });
    const droppedRoot = hex(rootOf(dropped.leaves));
    dropped.appendReceipt('row-2', 'hash-2', { publish: false });
    const droppedLater = hex(rootOf(dropped.leaves));
    const resent = [];
    await dropped.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async (intent) => ({ rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        resent.push(args);
        return args.hash;
      },
    });
    assert.equal(resent.length, 1);
    assert.equal(resent[0].raw, droppedSends[0].raw);
    assert.equal(resent[0].calldata, `0x${droppedRoot}`);
    assert.notEqual(droppedRoot, droppedLater);
    assert.equal(rawFor(droppedDir, droppedLater), false);

    const replacedDir = tmp();
    const replaced = treeAt(replacedDir);
    await replaced.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async () => ({ replaced: true, reason: 'nonce_consumed' }),
      send: async (args) => args.hash,
    });
    const replacedRoot = hex(rootOf(replaced.leaves));
    replaced.appendReceipt('row-2', 'hash-2', { publish: false });
    const replacedLater = hex(rootOf(replaced.leaves));
    const held = [];
    await replaced.publishHead({
      force: true,
      now: '2026-10-06T12:10:00.000Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async (intent) => ({ rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        held.push(args.calldata);
        return args.hash;
      },
    });
    assert.notEqual(replacedRoot, replacedLater);
    assert.deepEqual(held, [`0x${replacedRoot}`]);
    assert.equal(rawFor(replacedDir, replacedLater), false);
    const confirmed = [];
    await replaced.publishHead({
      force: true,
      now: '2026-10-06T12:40:00.000Z',
      nonce: 4,
      sleep: async () => {},
      blockTimestamp: Math.floor(Date.parse('2026-10-06T12:40:00.000Z') / 1000),
      lookup: async (intent) => ({
        receiptOk: true,
        receiptStatus: '0x1',
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async (args) => {
        confirmed.push(args.calldata);
        assert.equal(anchorIntentRows(replacedDir).some((row) => (
          row.root === replacedRoot && row.status === 'anchored'
        )), true);
        return args.hash;
      },
    });
    assert.deepEqual(confirmed, [`0x${replacedLater}`]);
  });
});
