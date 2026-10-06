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
  verifyUnloggedSection,
  unloggedReasonForTask,
  verifyAnchoredRoot,
  leafHash,
  parseAnchorMemo,
  EPOCH1_GENESIS_DIGEST,
  EPOCH1_SIZE1_ROOT,
  EPOCH1_SIZE2_ROOT,
  EPOCH1_FINAL_ROOT,
  EPOCH2_OPENING_ROOT,
} = await import('../dist/index.js');

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

test('a v1 head may omit epoch, and a v2 head may not', () => {
  assert.equal(acceptTreeHeadSchema({ schema: 'chit402.tree_head.v1', payload_version: 1 }).ok, true);
  assert.equal(verifyEpochLink({ schema: 'chit402.tree_head.v1', payload_version: 1, root: 'ab'.repeat(32) }).ok, true);
  const v2 = verifyEpochLink({
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    root: 'ab'.repeat(32),
    tree_size: 4,
  });
  assert.equal(v2.ok, false);
  assert.equal(v2.reason, 'epoch_missing');
});

test('an epoch-1 inclusion root must be a pinned prefix', () => {
  const genesis = Buffer.from(JSON.stringify({
    schema: 'chit402.tree_genesis.v1',
    payload_version: 1,
    verifier_binary_build_digest: EPOCH1_GENESIS_DIGEST,
  }));
  const genesisLeaf = leafHash(genesis);
  assert.equal(genesisLeaf.toString('hex'), EPOCH1_SIZE1_ROOT);
  const size1 = verifyEpochInclusion({
    leaf: genesisLeaf,
    index: 0,
    treeSize: 1,
    root: EPOCH1_SIZE1_ROOT,
    proof: [],
    epoch: 1,
  });
  assert.equal(size1.ok, true);

  const leaf0 = leafHash(Buffer.from('{"schema":"chit402.tree_genesis.v1"}'));
  const leaf1 = leafHash(Buffer.from('xfuel-leaf|row'));
  const madeUp = nodeHash(leaf0, leaf1).toString('hex');
  const proof = [{ hash: leaf0.toString('hex'), position: 'left' }];
  const forged = verifyEpochInclusion({
    taskId: 'xfuel-leaf',
    rowHash: 'row',
    index: 1,
    treeSize: 2,
    root: madeUp,
    proof,
    epoch: 1,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.reason, 'epoch1_prefix');
  assert.notEqual(madeUp, EPOCH1_SIZE2_ROOT);

  const omitted = verifyEpochInclusion({
    leaf: leaf1,
    index: 1,
    treeSize: 2,
    root: madeUp,
    proof,
  });
  assert.equal(omitted.ok, false);
  assert.equal(omitted.reason, 'epoch1_prefix');

  const size3Leaf = leafHash(Buffer.from('size-3|row'));
  const size3 = verifyEpochInclusion({
    leaf: size3Leaf,
    index: 0,
    treeSize: 3,
    root: size3Leaf.toString('hex'),
    proof: [],
    epoch: 1,
  });
  assert.equal(size3.ok, false);
  assert.equal(size3.reason, 'epoch1_prefix');

  const other = verifyEpochInclusion({
    leaf: genesisLeaf,
    index: 0,
    treeSize: 5,
    root: EPOCH1_SIZE1_ROOT,
    proof: [],
    epoch: 1,
  });
  assert.equal(other.ok, false);
  assert.equal(other.reason, 'epoch1_prefix');
  assert.equal(EPOCH1_FINAL_ROOT, 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973');
  assert.equal(EPOCH1_SIZE2_ROOT, 'ecf9a330a9e82d45e0887807261276fad2fbfb394189bb8f7f35b0e9163c70ae');
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

test('epoch 1 at size 3 with a forged root does not verify', () => {
  const result = verifyEpochLink({
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 1,
    root: 'ab'.repeat(32),
    tree_size: 3,
    genesis_digest: '422cceb1be77114317043b0a00bc18cba6ca9cee34144cd23875c6dcf1b47368',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'epoch1_root');
});

test('verifyAnchoredRoot fails closed when a v2 head omits epoch', async () => {
  const taskId = 'task-v2';
  const rowHash = 'row';
  const leaf = leafHash(Buffer.from(`${taskId}|${rowHash}`));
  const root = leaf.toString('hex');
  const result = await verifyAnchoredRoot({
    receipt: { task_id: taskId, row_hash: rowHash },
    inclusion: {
      task_id: taskId,
      leaf_index: 0,
      tree_size: 1,
      root,
      leaf: leaf.toString('hex'),
      proof: [],
    },
    head: {
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      root,
      tree_size: 1,
      anchors: {
        base: { status: 'pending', tx: null },
        solana: { status: 'pending', signature: null },
      },
    },
  });
  assert.equal(result.overall, 'failed');
  assert.ok(result.errors.includes('epoch_missing'));
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

test('an unlogged list verifies by hash and a bad hash does not', () => {
  const rows = [
    { task_id: 'openai-old', agent_id: 4, reason: 'missing_row_hash' },
    { task_id: 'fork-149-a', agent_id: 149, reason: 'forked' },
  ];
  const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const section = { count: 2, hash, rows };
  assert.equal(verifyUnloggedSection(section).ok, true);
  const record = { payload_version: 2, unlogged: section };
  assert.equal(unloggedReasonForTask(record, 'fork-149-a').reason, 'forked');
  assert.equal(unloggedReasonForTask(record, 'missing'), null);
  assert.equal(unloggedReasonForTask({ payload_version: 1, unlogged: section }, 'fork-149-a'), null);
  const tampered = { ...section, rows: [{ ...rows[0], reason: 'forked' }, rows[1]] };
  assert.equal(verifyUnloggedSection(tampered).reason, 'unlogged_hash');
  assert.equal(unloggedReasonForTask({ payload_version: 2, unlogged: tampered }, 'openai-old'), null);
  assert.equal(EPOCH2_OPENING_ROOT, 'f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286');
  const empty = { count: 0, hash: createHash('sha256').update('[]').digest('hex'), rows: [] };
  const epoch1 = 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973';
  const baseRecord = {
    payload_version: 2,
    epochs: [{
      epoch: 1,
      status: 'closed',
      final_root: epoch1,
      final_size: 4,
      genesis_digest: EPOCH1_GENESIS_DIGEST,
      prev_epoch_root: null,
      prev_epoch_size: 0,
    }],
    orphans: [
      { root: '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9', chain: 'base_and_solana' },
      { root: null, root_prefix: 'd7f6c548', unrecoverable: true, chain: 'base_and_solana' },
      { root: EPOCH2_OPENING_ROOT, chain: 'base_and_solana' },
    ],
    unlogged: empty,
    issuer_signature: { jws: 'a.b.c' },
  };
  assert.equal(verifyEpochRecord(baseRecord, { verifySignature: () => true }).reason, 'orphan_ff950e72_missing');
  baseRecord.orphans.unshift({
    root: 'ff950e7204762565751e1c7a6bfbdb167c15452f26259a97f63a2c90b2f61ec3',
    chain: 'base',
    solana: 'absent',
  });
  assert.equal(verifyEpochRecord(baseRecord, { verifySignature: () => true }).ok, true);
  baseRecord.orphans[1].chain = 'base';
  assert.equal(verifyEpochRecord(baseRecord, { verifySignature: () => true }).reason, 'orphan_20d88791_chain');
});
