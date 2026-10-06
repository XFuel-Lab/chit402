/**
 * --rpc witness check. The contract call is injected. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { verifyAnchoredRoot, verifyConsistency } = await import('../dist/anchor-witness.js');

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
    fetchBaseTx: async () => ({ hash: head.anchor_tx, input: `0x${root}`, chainId: 8453 }),
  });
  assert.equal(extended.witness.valid, true, extended.witness.reason);
});
