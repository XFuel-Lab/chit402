/**
 * covered_by names a later anchored head when the inclusion head is not
 * anchored. It is omitted when that head is itself anchored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  ReceiptMerkleTree,
  rootOf,
  verifyInclusion,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');

function hex(buf) {
  return Buffer.from(buf).toString('hex');
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

test('a pending head reports covered_by and an anchored head does not', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_LOG_BOOT = '0';
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = mkdtempSync(join(tmpdir(), 'chit-covered-'));
    for (const id of ['a', 'b', 'c']) tree.appendReceipt(id, `r${id}`, { publish: false });
    const pending = await tree.publishHead({ force: true, now: '2026-10-08T05:00:00.000Z' });
    assert.equal(pending.tree_size, 4);
    assert.notEqual(pending.anchor_status, 'anchored');

    process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
    for (const id of ['d', 'e']) tree.appendReceipt(id, `r${id}`, { publish: false });
    const mid = await tree.publishHead({
      force: true,
      now: '2026-10-08T06:00:00.000Z',
      nonce: 4,
      blockTimestamp: Math.floor(Date.parse('2026-10-08T06:00:00.000Z') / 1000),
      sleep: async () => {},
      lookup: async (intent) => ({
        receiptOk: true,
        receiptStatus: '0x1',
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async (args) => args.hash,
    });
    assert.equal(mid.anchor_status, 'anchored');
    assert.equal(mid.tree_size, 6);

    for (const id of ['f', 'g']) tree.appendReceipt(id, `r${id}`, { publish: false });
    const baseTx = `0x${'cd'.repeat(32)}`;
    const solanaSignature = 'covered-by-solana-signature';
    const laterRoot = hex(rootOf(tree.leaves));
    const later = signHead({
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      epoch: tree.epoch,
      prev_epoch_root: tree.prevEpochRoot,
      prev_epoch_size: tree.prevEpochSize,
      prev_root: mid.root,
      tree_size: tree.leaves.length,
      root: laterRoot,
      anchor_status: 'anchored',
      anchor_tx: baseTx,
      anchor_from: `0x${'11'.repeat(20)}`,
      published_at: '2026-10-08T07:00:00.000Z',
      anchors: {
        base: {
          status: 'anchored',
          tx: baseTx,
          chain_id: 8453,
          from: `0x${'11'.repeat(20)}`,
        },
        solana: {
          status: 'anchored',
          signature: solanaSignature,
          slot: 381234567,
          cluster: 'devnet',
        },
      },
    });
    tree.heads.push(later);
    tree.appendReceipt('h', 'rh', { publish: false });

    const early = tree.inclusion('a', { treeSize: pending.tree_size });
    assert.equal(early.status, 'included');
    assert.equal(early.anchor_status, 'pending');
    assert.equal(early.tree_size, 4);
    assert.equal(early.root, pending.root);
    assert.equal(early.head.anchored, false);
    assert.equal(verifyInclusion(
      tree.leaves[early.leaf_index],
      early.leaf_index,
      early.tree_size,
      early.root,
      early.proof,
    ), true);
    assert.deepEqual(early.covered_by, {
      epoch: tree.epoch,
      tree_size: later.tree_size,
      root: laterRoot,
      anchors: {
        base: { tx: baseTx },
        solana: { signature: solanaSignature, slot: 381234567 },
      },
    });

    const anchored = tree.inclusion('a');
    assert.equal(anchored.status, 'anchored');
    assert.equal(anchored.tree_size, later.tree_size);
    assert.equal(anchored.root, laterRoot);
    assert.equal(Object.hasOwn(anchored, 'covered_by'), false);

    const selected = tree.inclusion('a', { treeSize: mid.tree_size });
    assert.equal(selected.status, 'anchored');
    assert.equal(Object.hasOwn(selected, 'covered_by'), false);

    const past = tree.inclusion('h');
    assert.equal(past.status, 'pending_anchor');
    assert.equal(past.head.anchored, true);
    assert.equal(Object.hasOwn(past, 'covered_by'), false);

    const decoy = 'ee'.repeat(32);
    tree.quarantinedHeads.push({
      epoch: tree.epoch,
      tree_size: later.tree_size,
      prefix_size: 4,
      root: decoy,
    });
    const still = tree.inclusion('a', { treeSize: pending.tree_size });
    assert.equal(still.covered_by.root, laterRoot);
    assert.equal(JSON.stringify(still).includes(decoy), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    resetReceiptMerkleTree();
  }
});
