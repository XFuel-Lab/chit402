/**
 * Gateway CI hook for the v13 RFC 9162 module. Discovery picks this file up
 * with the rest of test/*.test.mjs, so no workflow edit is required.
 * Covers the empty root, the RFC 6962 n=1..8 pins, the shared vector file,
 * and the live consistency-proof format pin.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consistencyProof as liveConsistencyProof } from '../src/receipt-merkle.js';
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  mth,
  verifyConsistency,
  verifyInclusion,
} from '../../../packages/cs2-core/merkle/index.js';
import { renderRfc9162Json } from '../../../packages/cs2-core/vectors/build-rfc9162.mjs';

const EMPTY_ROOT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const LIVE_EMPTY_ROOT = '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d';
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

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
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

test('cs2 rfc9162 vectors verify (gateway CI hook)', () => {
  const empty = mth([]);
  assert.equal(empty.ok, true);
  assert.equal(hex(empty.hash), EMPTY_ROOT);
  assert.notEqual(hex(empty.hash), LIVE_EMPTY_ROOT);

  const golden = RFC6962_LEAVES_HEX.map(fromHex);
  for (let n = 1; n <= 8; n += 1) {
    const got = mth(golden.slice(0, n));
    assert.equal(got.ok, true, `n=${n}`);
    assert.equal(hex(got.hash), RFC6962_ROOTS[n - 1], `n=${n}`);
  }

  const vectorUrl = new URL('../../../packages/cs2-core/vectors/rfc9162.json', import.meta.url);
  const committed = readFileSync(vectorUrl, 'utf8');
  assert.equal(renderRfc9162Json(), committed);
  const doc = JSON.parse(committed);
  assert.equal(doc.schema, 'chit402.cs2.rfc9162.v1');
  assert.equal(doc.empty_root, EMPTY_ROOT);
  assert.match(doc.implementation_limits.note, /Not part of the RFC 9162 wire format/);
  const bySize = new Map();
  const entriesFor = (n) => {
    if (!bySize.has(n)) {
      const entries = [];
      for (let i = 0; i < n; i += 1) {
        const idx = Buffer.alloc(4);
        idx.writeUInt32BE(i);
        entries.push(new Uint8Array(createHash('sha256').update(doc.vector_leaf_domain, 'utf8').update(idx).digest()));
      }
      bySize.set(n, entries);
    }
    return bySize.get(n);
  };
  for (const row of doc.roots) {
    assert.equal(hex(mth(entriesFor(row.n)).hash), row.root, `root ${row.n}`);
  }
  for (const row of doc.inclusion) {
    const verdict = verifyInclusion(row.leaf_hash, row.index, row.n, row.root, row.proof);
    assert.equal(verdict.ok, true, `incl ${row.n}:${row.index}`);
    const again = inclusionProof(entriesFor(row.n), row.index);
    assert.deepEqual(again.proof, row.proof, `incl proof ${row.n}:${row.index}`);
  }
  for (const row of doc.consistency) {
    const verdict = verifyConsistency(row.m, row.n, row.old_root, row.new_root, row.proof);
    assert.equal(verdict.ok, true, `cons ${row.m},${row.n}`);
    const again = consistencyProof(entriesFor(row.n), row.m, row.n);
    assert.deepEqual(again.proof, row.proof, `cons proof ${row.m},${row.n}`);
  }
  for (const row of doc.negative) {
    const verdict = row.op === 'verifyInclusion'
      ? verifyInclusion(row.leaf, row.index, row.tree_size, row.root, row.proof)
      : verifyConsistency(row.m, row.n, row.old_root, row.new_root, row.proof);
    assert.equal(verdict.ok, false, row.id);
    assert.equal(verdict.reason, row.reason, row.id);
  }

  let differed = 0;
  for (let n = 1; n <= 40; n += 1) {
    const entries = [];
    for (let i = 0; i < n; i += 1) entries.push(localLeaf(i));
    const liveLeaves = entries.map((leaf) => Buffer.from(leafHash(leaf).hash));
    for (let m = 1; m < n; m += 1) {
      const ours = consistencyProof(entries, m, n);
      const live = liveConsistencyProof(liveLeaves, m, n);
      const same = ours.proof.length === live.length && ours.proof.every((h, i) => h === live[i]);
      if (same) continue;
      differed += 1;
      const oldRoot = hex(mth(entries.slice(0, m)).hash);
      const newRoot = hex(mth(entries).hash);
      const verdict = verifyConsistency(m, n, oldRoot, newRoot, live);
      assert.equal(verdict.ok, false, `${m},${n}`);
    }
  }
  assert.equal(differed, 780);
});
