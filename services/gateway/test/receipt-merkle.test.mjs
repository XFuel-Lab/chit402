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
