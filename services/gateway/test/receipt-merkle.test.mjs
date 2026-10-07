/**
 * RFC 6962-style receipt tree: inclusion, consistency, signed head, pending anchor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  ReceiptMerkleTree,
  leafHash,
  verifyInclusion,
  verifyConsistency,
  verifyTreeHead,
  anchorCalldata,
  describeAnchor,
  renderInclusionSection,
  resetReceiptMerkleTree,
  publicLogWitness,
} = await import('../src/receipt-merkle.js');

test('inclusion proof verifies and a flipped step does not', async () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('r1', 'h1');
  tree.appendReceipt('r2', 'h2');
  tree.appendReceipt('r3', 'h3');
  const inc = tree.inclusion('r2');
  assert.equal(inc.leaf_index > 0, true);
  assert.equal(inc.tree_size, 4);
  const leaf = tree.leaves[inc.leaf_index];
  assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, inc.proof), true);
  const bad = inc.proof.map((step, i) => (i === 0 ? { ...step, hash: 'ab'.repeat(32) } : step));
  assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, bad), false);
  assert.equal(leafHash(Buffer.from('r2|h2')).toString('hex'), leaf.toString('hex'));
});

test('consistency proof binds the old root and the new root', () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('a', '1');
  const m = tree.leaves.length;
  const oldRoot = tree.inclusion('a').root;
  tree.appendReceipt('b', '2');
  tree.appendReceipt('c', '3');
  const n = tree.leaves.length;
  const proof = tree.consistency(m, n);
  assert.equal(verifyConsistency(m, n, proof.first_root, proof.second_root, proof.proof), true);
  assert.equal(proof.first_root, oldRoot);
  assert.equal(verifyConsistency(m, n, proof.first_root, 'ff'.repeat(32), proof.proof), false);
  assert.equal(verifyConsistency(n, n, proof.second_root, proof.second_root, []), true);
});

test('signed tree head stays pending anchor without a house key', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevFrom = process.env.RECEIPT_ANCHOR_FROM;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_ANCHOR_FROM = '0x1111111111111111111111111111111111111111';
  try {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('solo', 'hh');
    const head = await tree.publishHead({ force: true });
    assert.equal(head.schema, 'chit402.tree_head.v2');
    assert.equal(head.payload_version, 2);
    assert.equal(head.epoch, 1);
    assert.equal(head.prev_epoch_root, null);
    assert.equal(head.prev_root, '0'.repeat(64));
    assert.equal(head.anchor_status, 'pending');
    assert.equal(head.anchor.tx, null);
    assert.equal(head.anchor.from, process.env.RECEIPT_ANCHOR_FROM);
    assert.equal(anchorCalldata(head.root), `0x${head.root}`);
    assert.equal(verifyTreeHead(head).valid, true);
    const pending = await describeAnchor(head.root);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.reason, 'no_key');
    const inc = tree.inclusion('solo');
    assert.match(renderInclusionSection(inc), /pending anchor/);
    assert.match(renderInclusionSection({ ...inc, anchor_tx: '0xabc', root: inc.root }), /anchored in Base tx 0xabc/);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevFrom == null) delete process.env.RECEIPT_ANCHOR_FROM;
    else process.env.RECEIPT_ANCHOR_FROM = prevFrom;
    if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
    if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = prevSolRpc;
    resetReceiptMerkleTree();
  }
});

test('a sender hash is stored on the head, and a failed send stays pending', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  try {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('anchored-row', 'hh');
    process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
    const head = await tree.publishHead({
      force: true,
      send: async () => '0x' + 'cd'.repeat(32),
    });
    assert.equal(head.anchor_status, 'broadcast');
    assert.equal(head.anchor.reason, 'unconfirmed');
    assert.equal(head.anchor.tx, '0x' + 'cd'.repeat(32));
    assert.match(head.anchor.from, /^0x[0-9a-fA-F]{40}$/);
    assert.match(renderInclusionSection(tree.inclusion('anchored-row')), /pending anchor/);
    const failed = await tree.publishHead({
      force: true,
      send: async () => { throw new Error('rpc down'); },
    });
    assert.equal(failed.anchor_status, 'pending');
    assert.match(failed.anchor.reason, /rpc down/);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
    if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = prevSolRpc;
    resetReceiptMerkleTree();
  }
});

test('the same task is not appended twice', () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('once', 'z');
  const size = tree.leaves.length;
  tree.appendReceipt('once', 'z');
  assert.equal(tree.leaves.length, size);
});

test('a receipt only in the current epoch has no carry-forward result', async () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('solo', 'hh');
  assert.equal(tree.carryForwardFor('solo'), null);
  const html = renderInclusionSection(tree.inclusion('solo'));
  assert.equal(html.includes('VERIFIED_CARRIED_FORWARD'), false);
  assert.match(html, /Inclusion/);
});

test('a leaf carried into a later epoch renders the dated status', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  try {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('carried', 'row');
    await tree.publishHead({ force: true, now: '2026-10-03T11:33:37.000Z' });
    tree.closedEpochs.push({
      epoch: 1,
      status: 'closed',
      leaves: tree.leaves.map((row) => Buffer.from(row)),
      byTask: new Map(tree.byTask),
      heads: tree.heads.slice(),
      meta: tree.meta.map((row) => ({ ...row })),
      prevEpochRoot: null,
      prevEpochSize: 0,
    });
    tree.epoch = 2;
    tree.leaves = [];
    tree.meta = [];
    tree.byTask = new Map();
    tree.heads = [];
    tree._epochOpened = false;
    tree.ensureGenesis();
    tree._push('carried', Buffer.from('carried|row'), 'receipt');
    await tree.publishHead({ force: true, now: '2026-10-05T11:22:57.000Z' });
    const carry = tree.carryForwardFor('carried');
    assert.equal(carry.status, 'VERIFIED_CARRIED_FORWARD', carry.reason);
    assert.equal(carry.issued_at, '2026-10-03T11:33:37.000Z');
    assert.equal(carry.issued_epoch, 1);
    assert.equal(carry.logged_at, '2026-10-05T11:22:57.000Z');
    assert.equal(carry.logged_epoch, 2);
    assert.equal(typeof carry.leaf_index, 'number');
    const witness = publicLogWitness(tree, 'carried');
    const html = renderInclusionSection(witness.inclusion, witness.carry_forward);
    assert.match(html, /VERIFIED_CARRIED_FORWARD/);
    assert.match(html, /2026-10-03T11:33:37\.000Z/);
    assert.match(html, /2026-10-05T11:22:57\.000Z/);
    assert.match(html, /Issued epoch/);
    assert.equal(html.includes('valid'), false);

    const dup = Buffer.from(tree.leaves[carry.leaf_index]);
    tree.leaves.push(dup);
    await tree.publishHead({ force: true, now: '2026-10-06T00:00:00.000Z' });
    const replay = tree.carryForwardFor('carried');
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, 'inclusion_failed');
    const failedHtml = renderInclusionSection(null, { status: 'failed', error: replay.reason });
    assert.match(failedHtml, /inclusion_failed/);
    assert.equal(failedHtml.includes('VERIFIED_CARRIED_FORWARD'), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
    if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = prevSolRpc;
    resetReceiptMerkleTree();
  }
});
