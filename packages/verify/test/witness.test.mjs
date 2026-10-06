/**
 * --rpc witness check. The contract call is injected. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { verifyAnchoredRoot, verifyConsistency } = await import('../dist/anchor-witness.js');
const runtimeCode = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/chit-log-witness.runtime.hex'), 'utf8').trim();

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function leafHash(bytes) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes)]));
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function fixture() {
  const taskId = 'task-1';
  const rowHash = 'row-hash-1';
  const leaf = leafHash(`${taskId}|${rowHash}`);
  const genesis = leafHash('genesis');
  const root = nodeHash(genesis, leaf).toString('hex');
  const receipt = { task_id: taskId, row_hash: rowHash };
  const inclusion = {
    task_id: taskId,
    leaf_index: 1,
    tree_size: 2,
    root,
    proof: [{ hash: genesis.toString('hex'), position: 'left' }],
  };
  const head = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 2,
    anchor_tx: '0x' + 'ab'.repeat(32),
    anchors: {
      base: { status: 'anchored', tx: '0x' + 'ab'.repeat(32), calldata: `0x${root}`, chain_id: 8453 },
      solana: { status: 'pending' },
    },
  };
  return { receipt, inclusion, head, root, genesis: genesis.toString('hex') };
}

test('without a witness address the contract is not checked and the run still verifies', async () => {
  const { receipt, inclusion, head } = fixture();
  const result = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    fetchSolanaTx: async () => null,
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${head.root}`, chainId: 8453 }),
    fetchWitnessCode: async () => runtimeCode,
  });
  assert.equal(result.witness.configured, false);
  assert.equal(result.witness.checked, false);
  assert.equal(result.overall, 'partial');
  assert.ok(result.does_not_prove.some((line) => /witness contract/i.test(line)));
});

test('a head that matches the contract is accepted, and a different root is not', async () => {
  const { receipt, inclusion, head, root } = fixture();
  const address = '0x' + '11'.repeat(20);
  const matched = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    witnessAddress: address,
    fetchWitness: async () => ({ epoch: 1, size: 2, root }),
    fetchWitnessCode: async () => runtimeCode,
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(matched.witness.valid, true);
  assert.equal(matched.witness.checked, true);
  assert.equal(matched.overall, 'partial');
  assert.ok(matched.proves.some((line) => line.includes(address)));

  const refused = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    witnessAddress: address,
    fetchWitness: async () => ({ epoch: 1, size: 2, root: 'ab'.repeat(32) }),
    fetchWitnessCode: async () => runtimeCode,
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(refused.witness.valid, false);
  assert.equal(refused.witness.reason, 'root_mismatch');
  assert.equal(refused.overall, 'failed');
});

test('a larger head needs an RFC consistency proof from the stored head', async () => {
  const { receipt, inclusion, head, root, genesis } = fixture();
  const address = '0x' + '22'.repeat(20);
  const missing = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    witnessAddress: address,
    fetchWitness: async () => ({ epoch: 1, size: 1, root: genesis }),
    fetchWitnessCode: async () => runtimeCode,
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(missing.witness.reason, 'witness_proof_required');
  assert.equal(missing.overall, 'failed');

  const proof = [leafHash('task-1|row-hash-1').toString('hex')];
  assert.equal(verifyConsistency(1, 2, genesis, root, proof), true);
  const extended = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    witnessAddress: address,
    consistency: {
      first_tree_size: 1,
      second_tree_size: 2,
      first_root: genesis,
      second_root: root,
      proof,
    },
    fetchWitness: async () => ({ epoch: 1, size: 1, root: genesis }),
    fetchWitnessCode: async () => runtimeCode,
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(extended.witness.valid, true, extended.witness.reason);
});

test('a contract whose code hash is not ChitLogWitness is not a witness', async () => {
  const { receipt, inclusion, head, root } = fixture();
  const result = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    witnessAddress: '0x' + '11'.repeat(20),
    fetchWitness: async () => ({ epoch: 1, size: 2, root }),
    fetchWitnessCode: async () => '0x1234',
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(result.witness.reason, 'witness_code');
  assert.equal(result.witness.valid, false);
  assert.equal(result.overall, 'failed');
});

test('consistency above 2^31 agrees with the safe integer fold', () => {
  const m = 2147483651;
  const n = 2147483656;
  const oldRoot = '66efa6095285abc11dba086420c33d7a5ac36361bff1c880a468b15c90002893';
  const newRoot = '8a7dacdbf7ccc03b1b16b371e75b220e9c2bd48f7360a96408c4fbd35778e333';
  const proof = [
    'b6dc386a95e0e1eb7afab12a9d5eb47518b76628b4a26d8449b0b88ce2453400',
    '437e86843ba8e36bc02680f08d56197df23b325971dc3218793d65a08c391ab1',
    '5d9b7a4d672258165cb7ad26afa29e6d7f9dc4a0a66747c6c0897e6bcc9e4cd8',
    '5274cdb016bfd8066395730837a4ed14d5e7b73e1ec45ae3e31a35fe0160fbf4',
    'd6c0dfd6e1b39f2524f750fffc90fc85df4a5a7afe2ef2e32c976d3db5ab2c24',
  ];
  assert.equal(verifyConsistency(m, n, oldRoot, newRoot, proof), true);
});
