/**
 * The tree genesis leaf names the published verifier source digest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { verifierBuildDigest } = await import('../src/verifier-digest.js');
const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');

test('genesis commits the published verifier digest', () => {
  const digest = verifierBuildDigest();
  assert.match(digest, /^[0-9a-f]{64}$/);
  const tree = new ReceiptMerkleTree();
  const genesis = JSON.parse(tree.genesisLeaf().bytes.toString('utf8'));
  assert.equal(genesis.schema, 'chit402.tree_genesis.v1');
  assert.equal(genesis.verifier_binary_build_digest, digest);
  tree.ensureGenesis();
  assert.equal(tree.inclusion('genesis').leaf_index, 0);
});
