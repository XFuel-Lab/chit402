/**
 * A rejected broadcast is replaced at the same nonce with the newest root.
 * Inclusion at the earlier head names that replacement anchor in covered_by.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  ReceiptMerkleTree,
  rootOf,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function anchorIntentRows(dir) {
  return readFileSync(join(dir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.op === 'anchor_intent');
}

function signHead(claims) {
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-head+jwt' });
  return {
    ...claims,
    anchor: claims.anchors.base,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      payload_version: 2,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

test("a replaced head's covered_by names the replacement anchor", async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_LOG_BOOT = '0';
  try {
    const dir = mkdtempSync(join(tmpdir(), 'chit-replace-cover-'));
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    for (const id of ['a', 'b', 'c']) await tree.appendReceipt(id, `r${id}`, { publish: false });
    await tree.publishHead({
      force: true,
      now: '2026-10-08T05:00:00.000Z',
      nonce: 4,
      sleep: async () => {},
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    const first = tree.heads.at(-1);
    const firstRoot = hex(rootOf(tree.leaves));
    assert.equal(first.tree_size, 4);
    assert.equal(first.root, firstRoot);
    assert.notEqual(first.anchor_status, 'anchored');
    const rejected = anchorIntentRows(dir).find((row) => row.status === 'signed' && row.raw);
    assert.equal(rejected.nonce, 4);
    assert.equal(rejected.root, firstRoot);

    for (const id of ['d', 'e']) await tree.appendReceipt(id, `r${id}`, { publish: false });
    const replacementRoot = hex(rootOf(tree.leaves));
    assert.notEqual(replacementRoot, firstRoot);
    const sent = [];
    const replacement = await tree.publishHead({
      force: true,
      now: '2026-10-08T06:00:00.000Z',
      nonce: 4,
      blockTimestamp: Math.floor(Date.parse('2026-10-08T06:00:00.000Z') / 1000),
      sleep: async () => {},
      lookup: async (intent) => {
        if (intent.tx === rejected.tx) {
          return { rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce };
        }
        return {
          receiptOk: true,
          receiptStatus: '0x1',
          tx: intent.tx,
          root: intent.root,
          from: intent.from,
          to: intent.to,
          nonce: intent.nonce,
        };
      },
      send: async (args) => {
        sent.push(args);
        if (args.raw === rejected.raw) throw new Error('broadcast_rejected');
        return args.hash;
      },
    });
    assert.equal(replacement.anchor_status, 'anchored');
    assert.equal(replacement.tree_size, 6);
    assert.equal(replacement.root, replacementRoot);
    assert.equal(sent.at(-1).calldata, `0x${replacementRoot}`);
    assert.notEqual(sent.at(-1).calldata, `0x${firstRoot}`);
    assert.equal(anchorIntentRows(dir).some((row) => (
      row.root === firstRoot && row.nonce === 4 && row.status === 'superseded'
    )), true);

    const early = await tree.inclusion('a', { treeSize: first.tree_size });
    assert.equal(early.head.anchored, false);
    assert.equal(early.anchor_status, 'pending');
    assert.deepEqual(early.covered_by, {
      epoch: tree.epoch,
      tree_size: replacement.tree_size,
      root: replacementRoot,
      inclusion_url: `/v1/receipts/a/inclusion?tree_size=${replacement.tree_size}`,
      anchors: {
        base: { tx: replacement.anchor_tx },
      },
    });

    for (const id of ['f', 'g']) await tree.appendReceipt(id, `r${id}`, { publish: false });
    const laterRoot = hex(rootOf(tree.leaves));
    const laterTx = `0x${'cd'.repeat(32)}`;
    tree.heads.push(signHead({
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      epoch: tree.epoch,
      prev_epoch_root: tree.prevEpochRoot,
      prev_epoch_size: tree.prevEpochSize,
      prev_root: replacement.root,
      tree_size: tree.leaves.length,
      root: laterRoot,
      anchor_status: 'anchored',
      anchor_tx: laterTx,
      anchor_from: `0x${'11'.repeat(20)}`,
      published_at: '2026-10-08T07:00:00.000Z',
      anchors: {
        base: {
          status: 'anchored',
          tx: laterTx,
          chain_id: 8453,
          from: `0x${'11'.repeat(20)}`,
        },
      },
    }));
    const still = await tree.inclusion('a', { treeSize: first.tree_size });
    assert.equal(still.covered_by.root, replacementRoot);
    assert.equal(still.covered_by.tree_size, replacement.tree_size);
    assert.equal(still.covered_by.anchors.base.tx, replacement.anchor_tx);
    assert.notEqual(still.covered_by.anchors.base.tx, laterTx);

    const onReplacement = await tree.inclusion('a', { treeSize: replacement.tree_size });
    assert.equal(onReplacement.status, 'anchored');
    assert.equal(Object.hasOwn(onReplacement, 'covered_by'), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    resetReceiptMerkleTree();
  }
});
