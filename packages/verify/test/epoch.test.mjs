/**
 * Epoch links and epoch-1 inclusion. v1 heads stay acceptable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const {
  acceptTreeHeadSchema,
  verifyEpochLink,
  verifyEpochRecord,
  verifyEpochInclusion,
  verifyAnchoredRoot,
  leafHash,
  parseAnchorMemo,
} = await import('../dist/index.js');

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

test('a v1 head is accepted and an epoch-1 inclusion proof verifies', () => {
  assert.equal(acceptTreeHeadSchema({ schema: 'chit402.tree_head.v1', payload_version: 1 }).ok, true);
  assert.equal(verifyEpochLink({ schema: 'chit402.tree_head.v1', payload_version: 1, root: 'ab'.repeat(32) }).ok, true);

  const leaf0 = leafHash(Buffer.from('{"schema":"chit402.tree_genesis.v1"}'));
  const leaf1 = leafHash(Buffer.from('xfuel-leaf|row'));
  const root = nodeHash(leaf0, leaf1).toString('hex');
  const proof = [{ hash: leaf0.toString('hex'), position: 'left' }];
  const result = verifyEpochInclusion({
    taskId: 'xfuel-leaf',
    rowHash: 'row',
    index: 1,
    treeSize: 2,
    root,
    proof,
    epoch: 1,
  });
  assert.equal(result.ok, true);

  const omitted = verifyEpochInclusion({
    leaf: leaf1,
    index: 1,
    treeSize: 2,
    root,
    proof,
  });
  assert.equal(omitted.ok, true);
});

test('epoch 2 must link to epoch 1 root and size', () => {
  const epoch1 = 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973';
  const record = {
    epochs: [
      { epoch: 1, status: 'closed', final_root: epoch1, final_size: 4, prev_epoch_root: null, prev_epoch_size: 0 },
      { epoch: 2, status: 'open', opening_root: 'f2'.repeat(32), opening_size: 1, prev_epoch_root: epoch1, prev_epoch_size: 4 },
    ],
    orphans: [{ root_prefix: 'd7f6c548' }],
  };
  assert.equal(verifyEpochRecord(record).ok, false);
  assert.equal(verifyEpochRecord(record).reason, 'epoch_signature_missing');
  assert.equal(verifyEpochLink(
    { schema: 'chit402.tree_head.v2', payload_version: 2, epoch: 2, prev_epoch_root: epoch1, prev_epoch_size: 4 },
    { root: epoch1, tree_size: 4 },
  ).ok, true);
  assert.equal(verifyEpochLink(
    { schema: 'chit402.tree_head.v2', payload_version: 2, epoch: 2, prev_epoch_root: 'ab'.repeat(32), prev_epoch_size: 4 },
    { root: epoch1, tree_size: 4 },
  ).reason, 'prev_epoch_root');

  const leaf = leafHash(Buffer.from('xfuel-leaf|row'));
  const root = leaf.toString('hex');
  const linked = verifyEpochInclusion({
    leaf,
    index: 0,
    treeSize: 1,
    root,
    proof: [],
    epoch: 2,
    prevEpochRoot: epoch1,
    prevEpochSize: 4,
    previous: { root: epoch1, tree_size: 4 },
  });
  assert.equal(linked.ok, true);
});

test('a forged epoch-1 root does not verify', () => {
  const forged = {
    epochs: [
      {
        epoch: 1,
        status: 'closed',
        final_root: 'ab'.repeat(32),
        final_size: 4,
        genesis_digest: '422cceb1be77114317043b0a00bc18cba6ca9cee34144cd23875c6dcf1b47368',
        prev_epoch_root: null,
        prev_epoch_size: 0,
      },
    ],
    orphans: [{ root_prefix: 'd7f6c548', root: null, unrecoverable: true }],
    issuer_signature: { jws: 'aaa.bbb.ccc' },
  };
  const result = verifyEpochRecord(forged, { verifySignature: () => true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'epoch1_root');
  assert.equal(verifyEpochLink({
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 1,
    root: 'ab'.repeat(32),
    tree_size: 4,
  }).reason, 'epoch1_root');
});

test('verifyAnchoredRoot refuses a head whose epoch record is missing', async () => {
  const result = await verifyAnchoredRoot({
    receipt: { task_id: 't', row_hash: 'r' },
    inclusion: {
      task_id: 't',
      leaf_index: 0,
      tree_size: 1,
      root: 'ab'.repeat(32),
      leaf: 'cd'.repeat(32),
      proof: [],
    },
    head: {
      root: 'ab'.repeat(32),
      tree_size: 1,
      epoch: 2,
      prev_epoch_root: 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973',
      prev_epoch_size: 4,
      anchors: {
        base: { status: 'pending', tx: null },
        solana: { status: 'pending', signature: null },
      },
    },
  });
  assert.equal(result.overall, 'failed');
  assert.ok(result.errors.includes('epoch_record_missing'));
});

test('v1 and v2 anchor memos both parse', () => {
  const root = 'ab'.repeat(32);
  const prev = '0'.repeat(64);
  const v1 = parseAnchorMemo(`chit402:root:v1:global:2026-10-05:${root}:${prev}`);
  assert.equal(v1.version, 1);
  assert.equal(v1.root, root);
  const bundle = 'cd'.repeat(32);
  const v2 = parseAnchorMemo(`chit402:root:v2:global:2026-10-06:${root}:${prev}:2:${'ef'.repeat(32)}:4:${bundle}`);
  assert.equal(v2.version, 2);
  assert.equal(v2.epoch, 2);
  assert.equal(v2.prev_epoch_size, 4);
  assert.equal(v2.bundle_index_hash, bundle);
  assert.equal(parseAnchorMemo('nope'), null);
});
