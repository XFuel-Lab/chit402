import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, keccak256 } from 'ethers';
import {
  COMMIT_DOMAIN,
  hashCommitment,
  kidToBytes32,
  legacyInclusionProof,
  legacyUniverseId,
  merkleRoot,
  universeId,
  verifyLegacyInclusion,
  LEGACY_UNIVERSE_ID,
} from './issuer-root.mjs';

test('legacy merkle matches the gateway fixture', () => {
  const vectors = JSON.parse(readFileSync(new URL('../test/fixtures/legacy-merkle-vectors.json', import.meta.url)));
  assert.equal(vectors.leaf_rule, 'sha256(0x00 || payload_hash bytes)');
  assert.equal(vectors.node_rule, 'sha256(0x01 || left || right)');
  assert.equal(vectors.sort, 'payload_hash bytes ascending');
  assert.equal(vectors.odd, 'duplicate last node when a level has more than one node and an odd count');
  assert.equal(vectors.universe_id, LEGACY_UNIVERSE_ID.slice(2));
  assert.equal(legacyUniverseId(), `0x${vectors.universe_id}`);
  assert.equal(
    universeId({
      book_id: vectors.universe.book_id,
      window_id: vectors.universe.window_id,
      predicate_hash: vectors.predicate_hash,
    }),
    `0x${vectors.universe_id}`,
  );
  for (const row of vectors.cases) {
    const sorted = row.sorted.map((hex) => `0x${hex}`);
    assert.equal(merkleRoot(sorted), row.root);
    assert.equal(merkleRoot(row.payload_hashes.map((hex) => `0x${hex}`)), row.root);
    for (const item of row.proofs) {
      const proof = legacyInclusionProof(sorted, item.index);
      assert.deepEqual(
        proof,
        item.proof.map((step) => ({ hash: step.hash, position: step.position })),
      );
      assert.equal(verifyLegacyInclusion(`0x${item.payload_hash}`, item.proof, row.root), true);
    }
  }
});

test('public genesis kid decodes to 32 bytes', () => {
  assert.equal(
    kidToBytes32('IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q'),
    '0x22f169982faf3e1918fefd2f89db2b5954fdbb3944e5758a66000439e253ab54',
  );
});

test('universe id is sha256 of the sorted JCS object', () => {
  const id = universeId({
    book_id: 'book-1',
    window_id: 'legacy_receipts_pre_v11',
    predicate_hash: '0xabc',
  });
  assert.equal(id.length, 66);
  const jcs =
    '{"book_id":"book-1","predicate_hash":"0xabc","schema":"chit402.universe.v1","window_id":"legacy_receipts_pre_v11"}';
  const expect = `0x${createHash('sha256').update(jcs).digest('hex')}`;
  assert.equal(id, expect);
});

test('hashCommitment matches cast abi-encode + keccak', () => {
  const prev = `0x${'ab'.repeat(32)}`;
  const registry = '0x1111111111111111111111111111111111111111';
  const kid = `0x${'44'.repeat(32)}`;
  const snapshot = `0x${'cd'.repeat(32)}`;
  const universe = `0x${'55'.repeat(32)}`;
  const uhash = `0x${'66'.repeat(32)}`;
  const js = hashCommitment({
    prevRootHash: prev,
    rootSeq: 1n,
    chainId: 84532n,
    registry,
    blockNumber: 99n,
    histVersion: 1n,
    histSnapshot: snapshot,
    guardianSeq: 1n,
    guardianSetHash: `0x${'11'.repeat(32)}`,
    ops: [{ kind: 1, kid, timestamp: 1788511925n, reasonCode: 0 }],
    freezes: [{ universeId: universe, universeHash: uhash, enumeratedCount: 3n }],
  });

  const setHash = `0x${'11'.repeat(32)}`;
  const opsHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(['tuple(uint8,bytes32,uint64,uint8)[]'], [[[1, kid, 1788511925, 0]]]),
  );
  const freezeHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(['tuple(bytes32,bytes32,uint64)[]'], [[[universe, uhash, 3]]]),
  );
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'tuple(bytes32,uint64,uint256,address,uint64,uint64,bytes32,uint64,bytes32,bytes32,bytes32)'],
    [COMMIT_DOMAIN, [prev, 1, 84532, registry, 99, 1, snapshot, 1, setHash, opsHash, freezeHash]],
  );
  assert.equal(keccak256(encoded), js);

  const castOps = execFileSync(
    'cast',
    ['abi-encode', 'f((uint8,bytes32,uint64,uint8)[])', `[(1,${kid},1788511925,0)]`],
    { encoding: 'utf8' },
  ).trim();
  const castFreezes = execFileSync(
    'cast',
    ['abi-encode', 'f((bytes32,bytes32,uint64)[])', `[(${universe},${uhash},3)]`],
    { encoding: 'utf8' },
  ).trim();
  const castOpsHash = execFileSync('cast', ['keccak', castOps], { encoding: 'utf8' }).trim();
  const castFreezeHash = execFileSync('cast', ['keccak', castFreezes], { encoding: 'utf8' }).trim();
  const castEncoded = execFileSync(
    'cast',
    [
      'abi-encode',
      'f(bytes32,(bytes32,uint64,uint256,address,uint64,uint64,bytes32,uint64,bytes32,bytes32,bytes32))',
      COMMIT_DOMAIN,
      `(${prev},1,84532,${registry},99,1,${snapshot},1,${setHash},${castOpsHash},${castFreezeHash})`,
    ],
    { encoding: 'utf8' },
  ).trim();
  const castHash = execFileSync('cast', ['keccak', castEncoded], { encoding: 'utf8' }).trim();
  assert.equal(castHash, js);
});
