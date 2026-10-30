/**
 * RFC 9162 wire-format tests. The reference below is a direct transcription
 * of the RFC definitions and imports nothing from the module.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRfc9162Json } from '../vectors/build-rfc9162.mjs';
import {
  EMPTY_ROOT_HEX,
  MAX_TREE_SIZE,
  consistencyProof,
  inclusionProof,
  leafHash,
  mth,
  verifyConsistency,
  verifyInclusion,
} from './index.js';

const EMPTY_ROOT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const LIVE_EMPTY_ROOT = '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d';
const LIVE_MERKLE_SHA = '967961647bb3cd25afd7a9029509b9b40ad50270441e82a907d37dddb13bae84';
const LIVE_MERKLE_TEST_SHA = '68131b954f7c6eef42f3afc5978fe3fc0e2e8f87a8947afe7aad2c9dd9610834';

const RFC6962_LEAVES_HEX = [
  '',
  '00',
  '10',
  '2021',
  '3031',
  '40414243',
  '5051525354555657',
  '606162636465666768696a6b6c6d6e6f',
];
const RFC6962_ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

/** Pinned by the forgery sweep. Update only when the proof shape changes. */
const FORGERY_ATTEMPTS = 887;

function refSha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function refHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function refLeaf(data) {
  const out = new Uint8Array(1 + data.length);
  out[0] = 0x00;
  out.set(data, 1);
  return refSha256(out);
}

function refNode(left, right) {
  const out = new Uint8Array(1 + left.length + right.length);
  out[0] = 0x01;
  out.set(left, 1);
  out.set(right, 1 + left.length);
  return refSha256(out);
}

function refK(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function refMth(entries) {
  const n = entries.length;
  if (n === 0) return refSha256(new Uint8Array(0));
  if (n === 1) return refLeaf(entries[0]);
  const k = refK(n);
  return refNode(refMth(entries.slice(0, k)), refMth(entries.slice(k)));
}

function refPath(entries, index) {
  const n = entries.length;
  if (n === 1) return [];
  const k = refK(n);
  if (index < k) {
    return refPath(entries.slice(0, k), index).concat([refHex(refMth(entries.slice(k)))]);
  }
  return refPath(entries.slice(k), index - k).concat([refHex(refMth(entries.slice(0, k)))]);
}

function refSubproof(entries, m, known) {
  const n = entries.length;
  if (m === n) return known ? [] : [refHex(refMth(entries))];
  const k = refK(n);
  if (m <= k) {
    return refSubproof(entries.slice(0, k), m, known).concat([refHex(refMth(entries.slice(k)))]);
  }
  return refSubproof(entries.slice(k), m - k, false).concat([refHex(refMth(entries.slice(0, k)))]);
}

function fromHex(value) {
  if (value.length === 0) return new Uint8Array(0);
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function localLeaf(i) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, i);
  return bytes;
}

function localEntries(n) {
  const entries = [];
  for (let i = 0; i < n; i += 1) entries.push(localLeaf(i));
  return entries;
}

function goldenEntries(n) {
  return RFC6962_LEAVES_HEX.slice(0, n).map(fromHex);
}

function flipHex(value) {
  const digit = value[0] === '0' ? '1' : '0';
  return digit + value.slice(1);
}

function loadVectors() {
  return JSON.parse(readFileSync(new URL('../vectors/rfc9162.json', import.meta.url), 'utf8'));
}

test('mth: empty tree is SHA-256("")', () => {
  const got = mth([]);
  assert.equal(got.ok, true);
  assert.equal(refHex(got.hash), EMPTY_ROOT);
  assert.equal(EMPTY_ROOT_HEX, EMPTY_ROOT);
  assert.notEqual(refHex(got.hash), LIVE_EMPTY_ROOT);
  assert.equal(refHex(refMth([])), EMPTY_ROOT);
});

test('mth: RFC 6962 reference leaves n=1..8 match the pinned roots', () => {
  const entries = goldenEntries(8);
  for (let n = 1; n <= 8; n += 1) {
    const prefix = entries.slice(0, n);
    const got = mth(prefix);
    assert.equal(got.ok, true, `module n=${n}`);
    assert.equal(refHex(got.hash), RFC6962_ROOTS[n - 1], `module n=${n}`);
    assert.equal(refHex(refMth(prefix)), RFC6962_ROOTS[n - 1], `reference n=${n}`);
  }
});

test('mth: n=0..300 match an independent in-test reference', () => {
  for (let n = 0; n <= 300; n += 1) {
    const entries = localEntries(n);
    const got = mth(entries);
    assert.equal(got.ok, true, `n=${n}`);
    assert.equal(refHex(got.hash), refHex(refMth(entries)), `n=${n}`);
  }
});

test('vectors: rfc9162.json regenerates byte-identically', () => {
  const rendered = renderRfc9162Json();
  const onDisk = readFileSync(new URL('../vectors/rfc9162.json', import.meta.url), 'utf8');
  assert.equal(rendered, onDisk);
});

test('vectors: every MTH, inclusion and consistency case in rfc9162.json verifies through the module', () => {
  const doc = loadVectors();
  assert.equal(doc.schema, 'chit402.cs2.rfc9162.v1');
  assert.equal(doc.empty_root, EMPTY_ROOT);
  assert.equal(doc.implementation_limits.max_tree_size, Number.MAX_SAFE_INTEGER);
  assert.equal(doc.implementation_limits.max_proof_hashes, 64);
  assert.match(doc.implementation_limits.note, /Not part of the RFC 9162 wire format/);
  assert.equal(MAX_TREE_SIZE, Number.MAX_SAFE_INTEGER);
  assert.equal(doc.roots.length, 301);
  for (const row of doc.roots) {
    const entries = [];
    for (let i = 0; i < row.n; i += 1) {
      const idx = Buffer.alloc(4);
      idx.writeUInt32BE(i);
      entries.push(new Uint8Array(
        createHash('sha256').update(doc.vector_leaf_domain, 'utf8').update(idx).digest(),
      ));
    }
    const got = mth(entries);
    assert.equal(got.ok, true, `root n=${row.n}`);
    assert.equal(refHex(got.hash), row.root, `root n=${row.n}`);
  }
  for (const row of doc.inclusion) {
    const verdict = verifyInclusion(row.leaf_hash, row.index, row.n, row.root, row.proof);
    assert.equal(verdict.ok, true, `incl ${row.n}:${row.index} ${verdict.reason || ''}`);
  }
  for (const row of doc.consistency) {
    const verdict = verifyConsistency(row.m, row.n, row.old_root, row.new_root, row.proof);
    assert.equal(verdict.ok, true, `cons ${row.m},${row.n} ${verdict.reason || ''}`);
  }
  for (const row of doc.negative) {
    const verdict = row.op === 'verifyInclusion'
      ? verifyInclusion(row.leaf, row.index, row.tree_size, row.root, row.proof)
      : verifyConsistency(row.m, row.n, row.old_root, row.new_root, row.proof);
    assert.equal(verdict.ok, false, row.id);
    assert.equal(verdict.reason, row.reason, row.id);
  }
  for (let n = 1; n <= 8; n += 1) {
    const got = mth(goldenEntries(n));
    assert.equal(refHex(got.hash), doc.rfc6962_reference.roots_n1_to_8[n - 1]);
  }
});

test('inclusion: every (i, n) for n <= 64 round-trips and matches the reference PATH', () => {
  for (let n = 1; n <= 64; n += 1) {
    const entries = localEntries(n);
    const root = refHex(mth(entries).hash);
    for (let index = 0; index < n; index += 1) {
      const proof = inclusionProof(entries, index);
      assert.equal(proof.ok, true, `${n}:${index}`);
      assert.deepEqual(proof.proof, refPath(entries, index), `${n}:${index}`);
      const leaf = refHex(leafHash(entries[index]).hash);
      const verdict = verifyInclusion(leaf, index, n, root, proof.proof);
      assert.equal(verdict.ok, true, `${n}:${index} ${verdict.reason || ''}`);
    }
  }
});

test('inclusion: index >= size, short proof, long proof, flipped bit and wrong root are refused with their reasons', () => {
  const entries = localEntries(7);
  const index = 3;
  const root = refHex(mth(entries).hash);
  const leaf = refHex(leafHash(entries[index]).hash);
  const proof = inclusionProof(entries, index).proof;
  assert.ok(proof.length >= 2);

  const outOfRange = verifyInclusion(leaf, 7, 7, root, proof);
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.reason, 'index_out_of_range');

  const short = verifyInclusion(leaf, index, 7, root, proof.slice(0, -1));
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'proof_too_short');

  const long = verifyInclusion(leaf, index, 7, root, proof.concat([proof[0]]));
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'proof_too_long');

  const flipped = proof.slice();
  flipped[0] = flipHex(flipped[0]);
  const bit = verifyInclusion(leaf, index, 7, root, flipped);
  assert.equal(bit.ok, false);
  assert.equal(bit.reason, 'root_mismatch');

  const wrong = verifyInclusion(leaf, index, 7, flipHex(root), proof);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'root_mismatch');

  const overCap = Array.from({ length: 65 }, () => leaf);
  const capped = verifyInclusion(leaf, 0, 1, leaf, overCap);
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'proof_too_long');
});

test('consistency: every (m, n) with 0 <= m <= n <= 64 matches the reference SUBPROOF and verifies', () => {
  for (let n = 0; n <= 64; n += 1) {
    const entries = localEntries(n);
    const newRoot = refHex(mth(entries).hash);
    for (let m = 0; m <= n; m += 1) {
      const proof = consistencyProof(entries, m, n);
      assert.equal(proof.ok, true, `${m},${n} ${proof.reason || ''}`);
      const expected = (m === 0 || m === n) ? [] : refSubproof(entries.slice(0, n), m, true);
      assert.deepEqual(proof.proof, expected, `${m},${n}`);
      const oldRoot = refHex(mth(entries.slice(0, m)).hash);
      const verdict = verifyConsistency(m, n, oldRoot, newRoot, proof.proof);
      assert.equal(verdict.ok, true, `${m},${n} ${verdict.reason || ''}`);
    }
  }
});

test('consistency: genesis m=0 takes an empty proof for any n; a non-empty proof is refused', () => {
  for (const n of [0, 1, 2, 7, 8, 64]) {
    const entries = localEntries(n);
    const proof = consistencyProof(entries, 0, n);
    assert.equal(proof.ok, true);
    assert.deepEqual(proof.proof, []);
    const newRoot = refHex(mth(entries).hash);
    const ok = verifyConsistency(0, n, EMPTY_ROOT, newRoot, []);
    assert.equal(ok.ok, true, `n=${n} ${ok.reason || ''}`);
    const refused = verifyConsistency(0, n, EMPTY_ROOT, newRoot, [newRoot]);
    assert.equal(refused.ok, false, `n=${n}`);
    assert.equal(refused.reason, 'proof_not_empty');
  }
  const wrongOld = verifyConsistency(0, 4, LIVE_EMPTY_ROOT, EMPTY_ROOT, []);
  assert.equal(wrongOld.ok, false);
  assert.equal(wrongOld.reason, 'root_mismatch');
  const wrongNew = verifyConsistency(0, 0, EMPTY_ROOT, LIVE_EMPTY_ROOT, []);
  assert.equal(wrongNew.ok, false);
  assert.equal(wrongNew.reason, 'root_mismatch');
  const bothEmpty = verifyConsistency(0, 0, EMPTY_ROOT, EMPTY_ROOT, []);
  assert.equal(bothEmpty.ok, true);
});

test('consistency: m=n takes an empty proof with equal roots; a non-empty proof or unequal roots are refused', () => {
  for (const n of [0, 1, 2, 7, 8, 64]) {
    const entries = localEntries(n);
    const proof = consistencyProof(entries, n, n);
    assert.deepEqual(proof.proof, []);
    const root = refHex(mth(entries).hash);
    const ok = verifyConsistency(n, n, root, root, []);
    assert.equal(ok.ok, true, `n=${n}`);
    const nonempty = verifyConsistency(n, n, root, root, [root]);
    assert.equal(nonempty.ok, false);
    assert.equal(nonempty.reason, 'proof_not_empty');
    if (n > 0) {
      const unequal = verifyConsistency(n, n, root, EMPTY_ROOT, []);
      assert.equal(unequal.ok, false);
      assert.equal(unequal.reason, 'root_mismatch');
    }
  }
});

test('consistency: m > n, truncated, extended, reordered and bit-flipped proofs are refused', () => {
  const entries = localEntries(7);
  const proof = consistencyProof(entries, 3, 7);
  assert.equal(proof.ok, true);
  assert.ok(proof.proof.length >= 2);
  const oldRoot = refHex(mth(entries.slice(0, 3)).hash);
  const newRoot = refHex(mth(entries).hash);

  const inverted = verifyConsistency(4, 3, oldRoot, newRoot, []);
  assert.equal(inverted.ok, false);
  assert.equal(inverted.reason, 'm_gt_n');

  const truncated = verifyConsistency(3, 7, oldRoot, newRoot, proof.proof.slice(0, -1));
  assert.equal(truncated.ok, false);
  assert.equal(truncated.reason, 'proof_too_short');

  const extended = verifyConsistency(3, 7, oldRoot, newRoot, proof.proof.concat([proof.proof[0]]));
  assert.equal(extended.ok, false);
  assert.equal(extended.reason, 'proof_too_long');

  const reorderedProof = [proof.proof[1], proof.proof[0], ...proof.proof.slice(2)];
  assert.notEqual(reorderedProof[0], proof.proof[0]);
  const reordered = verifyConsistency(3, 7, oldRoot, newRoot, reorderedProof);
  assert.equal(reordered.ok, false);
  assert.equal(reordered.reason, 'root_mismatch');

  const flippedProof = proof.proof.slice();
  flippedProof[0] = flipHex(flippedProof[0]);
  const flipped = verifyConsistency(3, 7, oldRoot, newRoot, flippedProof);
  assert.equal(flipped.ok, false);
  assert.equal(flipped.reason, 'root_mismatch');

  const wrongOld = verifyConsistency(3, 7, EMPTY_ROOT, newRoot, proof.proof);
  assert.equal(wrongOld.ok, false);
  assert.equal(wrongOld.reason, 'root_mismatch');

  const wrongNew = verifyConsistency(3, 7, oldRoot, EMPTY_ROOT, proof.proof);
  assert.equal(wrongNew.ok, false);
  assert.equal(wrongNew.reason, 'root_mismatch');

  const overCap = Array.from({ length: 65 }, () => oldRoot);
  const capped = verifyConsistency(1, 2, oldRoot, newRoot, overCap);
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'proof_too_long');
});

test('consistency: power-of-two m prepends the old root (RFC 2.1.4.2) — cases m in {1,2,4,8,16,32}', () => {
  const entries = localEntries(64);
  const newRoot = refHex(mth(entries).hash);
  for (const m of [1, 2, 4, 8, 16, 32]) {
    const proof = consistencyProof(entries, m, 64);
    assert.equal(proof.ok, true, `m=${m}`);
    assert.deepEqual(proof.proof, refSubproof(entries, m, true), `m=${m}`);
    const oldRoot = refHex(mth(entries.slice(0, m)).hash);
    assert.notEqual(proof.proof[0], oldRoot, `proof must omit the old root so the verifier prepends it, m=${m}`);
    const verdict = verifyConsistency(m, 64, oldRoot, newRoot, proof.proof);
    assert.equal(verdict.ok, true, `m=${m} ${verdict.reason || ''}`);
    const doubled = verifyConsistency(m, 64, oldRoot, newRoot, [oldRoot, ...proof.proof]);
    assert.equal(doubled.ok, false, `m=${m}`);
  }
});

test('format pin: proofs from main\'s receipt-merkle consistencyProof are refused for every pair where they differ from SUBPROOF', async () => {
  const { consistencyProof: liveConsistencyProof } = await import('../../../services/gateway/src/receipt-merkle.js');
  let differed = 0;
  let refused = 0;
  for (let n = 1; n <= 40; n += 1) {
    const entries = localEntries(n);
    const liveLeaves = entries.map((leaf) => Buffer.from(leafHash(leaf).hash));
    for (let m = 1; m < n; m += 1) {
      const ours = consistencyProof(entries, m, n);
      assert.equal(ours.ok, true);
      const live = liveConsistencyProof(liveLeaves, m, n);
      const same = ours.proof.length === live.length && ours.proof.every((h, i) => h === live[i]);
      if (same) continue;
      differed += 1;
      const oldRoot = refHex(mth(entries.slice(0, m)).hash);
      const newRoot = refHex(mth(entries).hash);
      const verdict = verifyConsistency(m, n, oldRoot, newRoot, live);
      assert.equal(verdict.ok, false, `${m},${n}`);
      refused += 1;
    }
  }
  assert.ok(differed >= 1, 'at least one live proof differs from SUBPROOF');
  assert.equal(refused, differed);
  assert.equal(differed, 780);
});

test('forgery sweep: random-free exhaustive single-element substitutions for n <= 16 are all refused', () => {
  let attempts = 0;
  for (let n = 1; n <= 16; n += 1) {
    const entries = localEntries(n);
    const root = refHex(mth(entries).hash);
    for (let index = 0; index < n; index += 1) {
      const proof = inclusionProof(entries, index).proof;
      const leaf = refHex(leafHash(entries[index]).hash);
      for (let j = 0; j < proof.length; j += 1) {
        const forged = proof.slice();
        forged[j] = flipHex(forged[j]);
        assert.notEqual(forged[j], proof[j]);
        const verdict = verifyInclusion(leaf, index, n, root, forged);
        assert.equal(verdict.ok, false, `incl ${n}:${index}:${j}`);
        attempts += 1;
      }
    }
    const newRoot = root;
    for (let m = 0; m <= n; m += 1) {
      const proof = consistencyProof(entries, m, n).proof;
      const oldRoot = refHex(mth(entries.slice(0, m)).hash);
      for (let j = 0; j < proof.length; j += 1) {
        const forged = proof.slice();
        forged[j] = flipHex(forged[j]);
        const verdict = verifyConsistency(m, n, oldRoot, newRoot, forged);
        assert.equal(verdict.ok, false, `cons ${m},${n}:${j}`);
        attempts += 1;
      }
    }
  }
  assert.equal(attempts, FORGERY_ATTEMPTS, `forgery attempts ${attempts}`);
});

test('input: uppercase, 0x-prefixed, 63/65-char and non-hex hashes are refused; non-integer, negative and unsafe sizes are refused', () => {
  const entries = localEntries(2);
  const root = refHex(mth(entries).hash);
  const leaf = refHex(leafHash(entries[0]).hash);
  const proof = inclusionProof(entries, 0).proof;

  const upper = verifyInclusion(leaf.toUpperCase(), 0, 2, root, proof);
  assert.equal(upper.ok, false);
  assert.equal(upper.reason, 'bad_hex');

  const prefixed = verifyInclusion(`0x${leaf}`, 0, 2, root, proof);
  assert.equal(prefixed.ok, false);
  assert.equal(prefixed.reason, 'bad_hex');

  const short63 = verifyInclusion(`${'a'.repeat(63)}`, 0, 2, root, proof);
  assert.equal(short63.ok, false);
  assert.equal(short63.reason, 'bad_proof_element');

  const long65 = verifyInclusion(`${'a'.repeat(65)}`, 0, 2, root, proof);
  assert.equal(long65.ok, false);
  assert.equal(long65.reason, 'bad_proof_element');

  const even31 = verifyInclusion('ab'.repeat(31), 0, 2, root, proof);
  assert.equal(even31.ok, false);
  assert.equal(even31.reason, 'bad_proof_element');

  const nonHex = verifyInclusion(`${'g'.repeat(64)}`, 0, 2, root, proof);
  assert.equal(nonHex.ok, false);
  assert.equal(nonHex.reason, 'bad_hex');

  const badElement = proof.slice();
  badElement[0] = 'zz'.repeat(32);
  if (proof.length === 0) badElement.push('zz'.repeat(32));
  const elem = verifyInclusion(leaf, 0, 2, root, badElement);
  assert.equal(elem.ok, false);
  assert.equal(elem.reason, 'bad_hex');

  assert.equal(verifyInclusion(leaf, 0, 1.5, root, proof).reason, 'bad_size');
  assert.equal(verifyInclusion(leaf, 0, -1, root, proof).reason, 'bad_size');
  assert.equal(verifyInclusion(leaf, 0, Number.MAX_SAFE_INTEGER + 1, root, []).reason, 'bad_size');
  assert.equal(verifyConsistency(1.5, 2, root, root, []).reason, 'bad_size');
  assert.equal(verifyConsistency(-1, 2, root, root, []).reason, 'bad_size');
  assert.equal(verifyConsistency(Number.MAX_SAFE_INTEGER + 1, 2, root, root, []).reason, 'bad_size');
  const cap = Number.MAX_SAFE_INTEGER;
  assert.equal(verifyInclusion(leaf, 0, cap, root, []).reason, 'proof_too_short');
  assert.equal(verifyInclusion(leaf, 0, cap + 1, root, []).reason, 'bad_size');
  assert.equal(verifyConsistency(cap, cap, EMPTY_ROOT, EMPTY_ROOT, []).ok, true);
  assert.equal(verifyConsistency(1, cap, EMPTY_ROOT, root, []).reason, 'proof_too_short');
  assert.equal(verifyConsistency(cap + 1, cap + 1, EMPTY_ROOT, EMPTY_ROOT, []).reason, 'bad_size');
  assert.equal(verifyInclusion(leaf, -0, 2, root, proof).reason, 'bad_index');
  assert.equal(verifyConsistency(-0, 2, root, root, []).reason, 'bad_size');
  assert.equal(mth('nope').reason, 'bad_type');
  assert.equal(leafHash('nope').reason, 'bad_leaf');
});

test('vectors: every row matches the in-test reference on the vector leaves', () => {
  const doc = loadVectors();
  const pool = [];
  for (let i = 0; i < 300; i += 1) {
    const idx = Buffer.alloc(4);
    idx.writeUInt32BE(i);
    pool.push(new Uint8Array(createHash('sha256').update(doc.vector_leaf_domain, 'utf8').update(idx).digest()));
  }
  for (const row of doc.roots) {
    assert.equal(refHex(refMth(pool.slice(0, row.n))), row.root, `root ${row.n}`);
  }
  for (const row of doc.inclusion) {
    const entries = pool.slice(0, row.n);
    assert.equal(refHex(refLeaf(entries[row.index])), row.leaf_hash, `leaf ${row.n}:${row.index}`);
    assert.deepEqual(refPath(entries, row.index), row.proof, `incl ${row.n}:${row.index}`);
    assert.equal(refHex(refMth(entries)), row.root, `incl root ${row.n}:${row.index}`);
  }
  for (const row of doc.consistency) {
    const entries = pool.slice(0, row.n);
    const expected = (row.m === 0 || row.m === row.n) ? [] : refSubproof(entries, row.m, true);
    assert.deepEqual(expected, row.proof, `cons ${row.m},${row.n}`);
    assert.equal(refHex(refMth(entries.slice(0, row.m))), row.old_root, `old ${row.m},${row.n}`);
    assert.equal(refHex(refMth(entries)), row.new_root, `new ${row.m},${row.n}`);
  }
});

test('source scan: merkle module imports only node:crypto and its own files', () => {
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/from 'node:crypto'/.test(src), 'imports node:crypto');
  assert.ok(/^(?![\s\S]*\bimport\b[\s\S]*\bimport\b)[\s\S]*$/.test(src), 'a single import');
  assert.ok(/^(?:(?!from ')[\s\S])*from 'node:crypto';(?:(?!from ')[\s\S])*$/.test(src), 'the only from-clause is node:crypto');
  assert.ok(/^(?![\s\S]*receipt-merkle)[\s\S]*$/.test(src), 'no receipt-merkle');
  assert.ok(/^(?![\s\S]*fetch\()[\s\S]*$/.test(src), 'no fetch');
  assert.ok(/^(?![\s\S]*node:http)[\s\S]*$/.test(src), 'no node:http');
  assert.ok(/^(?![\s\S]*node:https)[\s\S]*$/.test(src), 'no node:https');
  assert.ok(/^(?![\s\S]*node:net)[\s\S]*$/.test(src), 'no node:net');
  assert.ok(/^(?![\s\S]*process\.env)[\s\S]*$/.test(src), 'no process.env');
});

test('source scan: receipt-merkle.js and its test are byte-identical to 7207bf46', () => {
  const live = createHash('sha256')
    .update(readFileSync(new URL('../../../services/gateway/src/receipt-merkle.js', import.meta.url)))
    .digest('hex');
  const liveTest = createHash('sha256')
    .update(readFileSync(new URL('../../../services/gateway/test/receipt-merkle.test.mjs', import.meta.url)))
    .digest('hex');
  assert.equal(live, LIVE_MERKLE_SHA);
  assert.equal(liveTest, LIVE_MERKLE_TEST_SHA);
});
