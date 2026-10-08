/**
 * Inclusion proves against the newest anchored signed head.
 * A leaf past that head is pending_anchor. No network and no broadcast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  ReceiptMerkleTree,
  headAnchorFacts,
  verifyInclusion,
  verifyConsistency,
  renderInclusionSection,
  resetReceiptMerkleTree,
  getReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');

function receiptFor(intent) {
  return {
    receiptOk: true,
    receiptStatus: '0x1',
    tx: intent.tx,
    root: intent.root,
    from: intent.from,
    to: intent.to,
    nonce: intent.nonce,
  };
}

async function anchorAt(tree, now) {
  return tree.publishHead({
    force: true,
    now,
    nonce: 4,
    blockTimestamp: Math.floor(Date.parse(now) / 1000),
    lookup: async (intent) => receiptFor(intent),
    send: async (args) => args.hash,
  });
}

function withAnchorKey(fn) {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_LOG_BOOT = '0';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
      else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
      if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
      else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
      if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = prevSolRpc;
      if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
      else process.env.RECEIPT_LOG_BOOT = prevBoot;
      resetReceiptMerkleTree();
    });
}

test('epoch-2 style: anchored at 4, live at 5', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.dir = mkdtempSync(join(tmpdir(), 'chit-incl-'));
    tree.appendReceipt('leaf-a', 'ra', { publish: false });
    tree.appendReceipt('leaf-b', 'rb', { publish: false });
    tree.appendReceipt('leaf-c', 'rc', { publish: false });
    assert.equal(tree.leaves.length, 4);
    const head = await anchorAt(tree, '2026-10-08T05:32:00.000Z');
    assert.equal(head.tree_size, 4);
    assert.equal(head.anchor_status, 'anchored');
    assert.equal(headAnchorFacts(head).anchored, true);
    tree.appendReceipt('leaf-d', 'rd', { publish: false });
    assert.equal(tree.leaves.length, 5);

    for (const id of ['genesis', 'leaf-a', 'leaf-b', 'leaf-c']) {
      const inc = tree.inclusion(id);
      assert.equal(inc.status, 'anchored', id);
      assert.equal(inc.tree_size, 4, id);
      assert.equal(inc.live_tree_size, 5, id);
      assert.equal(inc.anchored_tree_size, 4, id);
      assert.equal(inc.root, head.root, id);
      assert.equal(inc.head.tree_size, 4, id);
      assert.equal(inc.head.root, head.root, id);
      assert.equal(inc.head.signature.jws, head.issuer_signature.jws, id);
      assert.equal(inc.head.anchor_tx, head.anchor_tx, id);
      assert.match(inc.head.anchor_chain, /base/, id);
      assert.equal(inc.anchor_status, 'anchored', id);
      const leaf = tree.leaves[inc.leaf_index];
      assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, inc.proof), true, id);
    }

    const pending = tree.inclusion('leaf-d');
    assert.equal(pending.status, 'pending_anchor');
    assert.equal(pending.proof, null);
    assert.equal(pending.anchored_tree_size, 4);
    assert.equal(pending.live_tree_size, 5);
    assert.equal(pending.leaf_index, 4);
    assert.equal(pending.anchor_status, 'pending');
    assert.equal(pending.head.root, head.root);
    assert.equal(pending.head.signature.jws, head.issuer_signature.jws);
    const html = renderInclusionSection(pending);
    assert.match(html, /PENDING/);
    assert.match(html, /pending_anchor/);
    assert.equal(/(?<!UN)VERIFIED/.test(html), false);

    const proof = tree.consistency(4, 5);
    assert.equal(verifyConsistency(4, 5, proof.first_root, proof.second_root, proof.proof), true);
    assert.equal(proof.first_root, head.root);
  });
});

test('an unanchored head is not presented as anchored', async () => {
  await withAnchorKey(async () => {
    delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('solo', 'hh', { publish: false });
    const head = await tree.publishHead({ force: true, now: '2026-10-08T06:00:00.000Z' });
    assert.equal(headAnchorFacts(head).anchored, false);
    const inc = tree.inclusion('solo', { treeSize: head.tree_size });
    assert.notEqual(inc.status, 'anchored');
    assert.equal(inc.anchor_status, 'pending');
    assert.equal(inc.head.anchored, false);
    assert.equal(inc.head.signature.jws, head.issuer_signature.jws);
  });
});

test('unsigned, mismatched, and out-of-range tree sizes are rejected', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.dir = mkdtempSync(join(tmpdir(), 'chit-incl-bad-'));
    tree.appendReceipt('leaf-a', 'ra', { publish: false });
    const head = await anchorAt(tree, '2026-10-08T05:32:00.000Z');
    const live = tree.leaves.length;

    assert.throws(() => tree.inclusion('leaf-a', { treeSize: live + 1 }), (err) => err.code === 'bad_tree_size');
    assert.throws(() => tree.inclusion('leaf-a', { treeSize: 0 }), (err) => err.code === 'bad_tree_size');
    assert.throws(() => tree.inclusion('missing', { treeSize: live + 3 }), (err) => err.code === 'bad_tree_size');

    tree.heads.push({
      tree_size: live,
      root: head.root,
      anchors: head.anchors,
    });
    const unsignedOnly = new ReceiptMerkleTree();
    unsignedOnly.appendReceipt('leaf-a', 'ra', { publish: false });
    unsignedOnly.heads.push({ tree_size: unsignedOnly.leaves.length, root: 'ab'.repeat(32) });
    assert.throws(
      () => unsignedOnly.inclusion('leaf-a', { treeSize: unsignedOnly.leaves.length }),
      (err) => err.code === 'head_rejected',
    );

    const forged = { ...head, issuer_signature: { ...head.issuer_signature, jws: `${head.issuer_signature.jws.slice(0, -4)}AAAA` } };
    const mismatchTree = new ReceiptMerkleTree();
    mismatchTree.appendReceipt('leaf-a', 'ra', { publish: false });
    mismatchTree.heads.push({ ...head, root: 'cd'.repeat(32), tree_size: mismatchTree.leaves.length });
    assert.throws(
      () => mismatchTree.inclusion('leaf-a', { treeSize: mismatchTree.leaves.length }),
      (err) => err.code === 'head_mismatch' || err.code === 'head_rejected',
    );
    assert.equal(forged.issuer_signature.jws.endsWith('AAAA'), true);

    assert.throws(() => tree.inclusion('leaf-a', { treeSize: 1 }), (err) => err.code === 'no_signed_head');
  });
});

test('a swapped index, sibling, or position fails', () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('leaf-a', 'ra');
  tree.appendReceipt('leaf-b', 'rb');
  const inc = tree.inclusion('leaf-b');
  const leaf = tree.leaves[inc.leaf_index];
  assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, inc.proof), true);
  assert.equal(verifyInclusion(leaf, inc.leaf_index === 0 ? 1 : 0, inc.tree_size, inc.root, inc.proof), false);
  const swappedSibling = inc.proof.map((step, i) => (i === 0 ? { ...step, hash: 'ab'.repeat(32) } : step));
  assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, swappedSibling), false);
  if (inc.proof.length > 0 && inc.proof[0].position) {
    const flipped = inc.proof.map((step, i) => (
      i === 0 ? { ...step, position: step.position === 'left' ? 'right' : 'left' } : step
    ));
    assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, flipped), false);
  }
});

test('GET /inclusion rejects a tree_size past the live tree', async () => {
  await withAnchorKey(async () => {
    resetReceiptMerkleTree();
    const tree = getReceiptMerkleTree();
    tree.appendReceipt('leaf-a', 'ra', { publish: false });
    const { createApp } = await import('../src/server.js');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const bad = await fetch(`${base}/v1/receipts/leaf-a/inclusion?tree_size=99`);
      const body = await bad.json();
      assert.equal(bad.status, 400);
      assert.equal(body.error, 'bad_tree_size');
      const junk = await fetch(`${base}/v1/receipts/leaf-a/inclusion?tree_size=nope`);
      assert.equal(junk.status, 400);
      assert.equal((await junk.json()).error, 'bad_tree_size');
      const zero = await fetch(`${base}/v1/receipts/leaf-a/inclusion?tree_size=0`);
      assert.equal(zero.status, 400);
      assert.equal((await zero.json()).error, 'bad_tree_size');
      const padded = await fetch(`${base}/v1/receipts/leaf-a/inclusion?tree_size=01`);
      assert.equal(padded.status, 400);
      assert.equal((await padded.json()).error, 'bad_tree_size');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

function parkClosed(tree, heads) {
  const closed = {
    epoch: tree.epoch,
    status: 'closed',
    leaves: tree.leaves.map((row) => Buffer.from(row)),
    byTask: new Map(tree.byTask),
    heads,
    meta: tree.meta.map((row) => ({ ...row })),
    prevEpochRoot: tree.prevEpochRoot,
    prevEpochSize: tree.prevEpochSize,
  };
  tree.closedEpochs.push(closed);
  tree.epoch += 1;
  tree.leaves = [];
  tree.meta = [];
  tree.byTask = new Map();
  tree.heads = [];
  tree.prevEpochRoot = null;
  tree.prevEpochSize = 0;
  return closed;
}

test('a closed epoch verifies against its pinned final head and rejects a different or newer head', async () => {
  await withAnchorKey(async () => {
    const tree = new ReceiptMerkleTree();
    tree.dir = mkdtempSync(join(tmpdir(), 'chit-incl-closed-'));
    tree.appendReceipt('leaf-a', 'ra', { publish: false });
    tree.appendReceipt('leaf-b', 'rb', { publish: false });
    tree.appendReceipt('leaf-c', 'rc', { publish: false });
    const daily = await anchorAt(tree, '2026-10-08T05:32:00.000Z');
    assert.equal(daily.tree_size, 4);
    tree.appendReceipt('leaf-d', 'rd', { publish: false });
    const pinned = await anchorAt(tree, '2026-10-08T12:00:00.000Z');
    assert.equal(pinned.tree_size, 5);
    assert.equal(headAnchorFacts(pinned).anchored, true);

    const epochNo = tree.epoch;
    parkClosed(tree, [daily]);
    tree.signedClosedEpochHead = (n) => (Number(n) === epochNo ? pinned : null);

    const late = tree.inclusion('leaf-d');
    assert.equal(late.status, 'anchored');
    assert.notEqual(late.status, 'pending_anchor');
    assert.equal(late.tree_size, pinned.tree_size);
    assert.equal(late.root, pinned.root);
    assert.equal(late.head.root, pinned.root);
    const lateLeaf = tree.closedEpochs[0].leaves[late.leaf_index];
    assert.equal(verifyInclusion(lateLeaf, late.leaf_index, late.tree_size, late.root, late.proof), true);

    const early = tree.inclusion('leaf-a');
    assert.equal(early.status, 'anchored');
    assert.equal(early.tree_size, pinned.tree_size);
    assert.equal(verifyInclusion(
      tree.closedEpochs[0].leaves[early.leaf_index],
      early.leaf_index,
      early.tree_size,
      early.root,
      early.proof,
    ), true);

    tree.signedClosedEpochHead = () => ({ ...pinned, root: 'cd'.repeat(32) });
    assert.throws(
      () => tree.inclusion('leaf-d'),
      (err) => err.code === 'head_mismatch' || err.code === 'head_rejected',
    );
    assert.throws(
      () => tree.inclusion('leaf-d', { treeSize: daily.tree_size }),
      (err) => err.code === 'head_mismatch' || err.code === 'head_rejected',
    );

    const newerTree = new ReceiptMerkleTree();
    newerTree.dir = mkdtempSync(join(tmpdir(), 'chit-incl-newer-'));
    newerTree.appendReceipt('leaf-a', 'ra', { publish: false });
    newerTree.appendReceipt('leaf-b', 'rb', { publish: false });
    newerTree.appendReceipt('leaf-c', 'rc', { publish: false });
    const older = await anchorAt(newerTree, '2026-10-08T05:32:00.000Z');
    newerTree.appendReceipt('leaf-d', 'rd', { publish: false });
    const finalHead = await anchorAt(newerTree, '2026-10-08T12:00:00.000Z');
    newerTree.appendReceipt('leaf-e', 're', { publish: false });
    const newer = await anchorAt(newerTree, '2026-10-09T12:00:00.000Z');
    assert.equal(newer.tree_size, finalHead.tree_size + 1);
    const newerEpoch = newerTree.epoch;
    parkClosed(newerTree, [older, newer]);
    newerTree.signedClosedEpochHead = (n) => (Number(n) === newerEpoch ? finalHead : null);
    assert.throws(
      () => newerTree.inclusion('leaf-e'),
      (err) => err.code === 'head_rejected',
    );
    assert.throws(
      () => newerTree.inclusion('leaf-d', { treeSize: newer.tree_size }),
      (err) => err.code === 'head_rejected',
    );

    const foreign = { ...finalHead, root: 'ab'.repeat(32) };
    newerTree.closedEpochs[0].heads = [older, foreign];
    assert.throws(
      () => newerTree.inclusion('leaf-d'),
      (err) => err.code === 'head_mismatch',
    );
  });
});

test('a pending leaf renders PENDING ahead of a carry-forward line', () => {
  const html = renderInclusionSection(
    {
      status: 'pending_anchor',
      anchored_tree_size: 4,
      live_tree_size: 5,
      leaf_index: 4,
    },
    {
      status: 'VERIFIED_CARRIED_FORWARD',
      issued_at: '2026-10-03T00:00:00.000Z',
      issued_epoch: 1,
      logged_at: '2026-10-08T00:00:00.000Z',
      logged_epoch: 2,
      leaf_index: 4,
    },
  );
  assert.match(html, /PENDING/);
  assert.equal(html.includes('VERIFIED'), false);
});
