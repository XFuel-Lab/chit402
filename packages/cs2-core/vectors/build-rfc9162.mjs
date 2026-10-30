/**
 * Deterministic RFC 9162 vector generator.
 * d_i = SHA-256("chit402-rfc9162-vector-v1" || uint32be(i)).
 * Run: node packages/cs2-core/vectors/build-rfc9162.mjs
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EMPTY_ROOT_HEX,
  MAX_PROOF_HASHES,
  MAX_TREE_SIZE,
  consistencyProof,
  inclusionProof,
  leafHash,
  mth,
  verifyConsistency,
  verifyInclusion,
} from '../merkle/index.js';

export const VECTOR_LEAF_DOMAIN = 'chit402-rfc9162-vector-v1';

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

const RFC6962_ROOTS_HEX = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

function vectorLeaf(i) {
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(i);
  return new Uint8Array(
    createHash('sha256').update(VECTOR_LEAF_DOMAIN, 'utf8').update(idx).digest(),
  );
}

function vectorEntries(n) {
  const entries = [];
  for (let i = 0; i < n; i += 1) entries.push(vectorLeaf(i));
  return entries;
}

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function must(result, what) {
  if (!result.ok) throw new Error(`${what}:${result.reason}`);
  return result;
}

function flipHex(value) {
  const digit = value[0] === '0' ? '1' : '0';
  return digit + value.slice(1);
}

function build() {
  const pool = vectorEntries(300);
  const roots = [];
  for (let n = 0; n <= 300; n += 1) {
    const hash = must(mth(pool.slice(0, n)), `root ${n}`);
    roots.push({ n, root: hex(hash.hash) });
  }

  const inclusion = [];
  for (let n = 1; n <= 64; n += 1) {
    const entries = pool.slice(0, n);
    const root = hex(must(mth(entries), `incl-root ${n}`).hash);
    for (let index = 0; index < n; index += 1) {
      const proof = must(inclusionProof(entries, index), `incl ${n}:${index}`);
      inclusion.push({
        n,
        index,
        leaf_hash: hex(must(leafHash(entries[index]), 'leaf').hash),
        root,
        proof: proof.proof,
      });
    }
  }
  for (const n of [128, 256, 300]) {
    const entries = pool.slice(0, n);
    const root = hex(must(mth(entries), `incl-root ${n}`).hash);
    const indexes = [0, 1, n >> 1, n - 1];
    for (const index of indexes) {
      const proof = must(inclusionProof(entries, index), `incl ${n}:${index}`);
      inclusion.push({
        n,
        index,
        leaf_hash: hex(must(leafHash(entries[index]), 'leaf').hash),
        root,
        proof: proof.proof,
      });
    }
  }

  const consistency = [];
  for (let n = 0; n <= 64; n += 1) {
    const entries = pool.slice(0, n);
    const newRoot = hex(must(mth(entries), `cons-new ${n}`).hash);
    for (let m = 0; m <= n; m += 1) {
      const oldRoot = hex(must(mth(entries.slice(0, m)), `cons-old ${m}`).hash);
      const proof = must(consistencyProof(entries, m, n), `cons ${m}:${n}`);
      consistency.push({ m, n, old_root: oldRoot, new_root: newRoot, proof: proof.proof });
    }
  }

  const base = pool.slice(0, 7);
  const baseRoot = hex(must(mth(base), 'neg-root').hash);
  const baseLeaf = hex(must(leafHash(base[3]), 'neg-leaf').hash);
  const baseProof = must(inclusionProof(base, 3), 'neg-proof').proof;
  const cons = must(consistencyProof(base, 3, 7), 'neg-cons');
  const old3 = hex(must(mth(base.slice(0, 3)), 'neg-old').hash);
  const empty = EMPTY_ROOT_HEX;
  const flippedProof = baseProof.slice();
  flippedProof[0] = flipHex(flippedProof[0]);
  const longProof = baseProof.concat([baseProof[0]]);
  const shortProof = baseProof.slice(0, -1);
  const reordered = [cons.proof[1], cons.proof[0], ...cons.proof.slice(2)];

  const negative = [
    {
      id: 'incl-index-ge-size',
      op: 'verifyInclusion',
      reason: 'index_out_of_range',
      leaf: baseLeaf,
      index: 7,
      tree_size: 7,
      root: baseRoot,
      proof: baseProof,
    },
    {
      id: 'incl-short',
      op: 'verifyInclusion',
      reason: 'proof_too_short',
      leaf: baseLeaf,
      index: 3,
      tree_size: 7,
      root: baseRoot,
      proof: shortProof,
    },
    {
      id: 'incl-long',
      op: 'verifyInclusion',
      reason: 'proof_too_long',
      leaf: baseLeaf,
      index: 3,
      tree_size: 7,
      root: baseRoot,
      proof: longProof,
    },
    {
      id: 'incl-flipped',
      op: 'verifyInclusion',
      reason: 'root_mismatch',
      leaf: baseLeaf,
      index: 3,
      tree_size: 7,
      root: baseRoot,
      proof: flippedProof,
    },
    {
      id: 'incl-wrong-root',
      op: 'verifyInclusion',
      reason: 'root_mismatch',
      leaf: baseLeaf,
      index: 3,
      tree_size: 7,
      root: flipHex(baseRoot),
      proof: baseProof,
    },
    {
      id: 'incl-uppercase',
      op: 'verifyInclusion',
      reason: 'bad_hex',
      leaf: baseLeaf.toUpperCase(),
      index: 3,
      tree_size: 7,
      root: baseRoot,
      proof: baseProof,
    },
    {
      id: 'incl-0x',
      op: 'verifyInclusion',
      reason: 'bad_hex',
      leaf: `0x${baseLeaf}`,
      index: 3,
      tree_size: 7,
      root: baseRoot,
      proof: baseProof,
    },
    {
      id: 'cons-m-gt-n',
      op: 'verifyConsistency',
      reason: 'm_gt_n',
      m: 4,
      n: 3,
      old_root: empty,
      new_root: empty,
      proof: [],
    },
    {
      id: 'cons-genesis-nonempty',
      op: 'verifyConsistency',
      reason: 'proof_not_empty',
      m: 0,
      n: 7,
      old_root: empty,
      new_root: baseRoot,
      proof: [baseRoot],
    },
    {
      id: 'cons-equal-nonempty',
      op: 'verifyConsistency',
      reason: 'proof_not_empty',
      m: 7,
      n: 7,
      old_root: baseRoot,
      new_root: baseRoot,
      proof: [baseRoot],
    },
    {
      id: 'cons-truncated',
      op: 'verifyConsistency',
      reason: 'proof_too_short',
      m: 3,
      n: 7,
      old_root: old3,
      new_root: baseRoot,
      proof: cons.proof.slice(0, -1),
    },
    {
      id: 'cons-extended',
      op: 'verifyConsistency',
      reason: 'proof_too_long',
      m: 3,
      n: 7,
      old_root: old3,
      new_root: baseRoot,
      proof: cons.proof.concat([cons.proof[0]]),
    },
    {
      id: 'cons-reordered',
      op: 'verifyConsistency',
      reason: 'root_mismatch',
      m: 3,
      n: 7,
      old_root: old3,
      new_root: baseRoot,
      proof: reordered,
    },
    {
      id: 'cons-flipped',
      op: 'verifyConsistency',
      reason: 'root_mismatch',
      m: 3,
      n: 7,
      old_root: old3,
      new_root: baseRoot,
      proof: [flipHex(cons.proof[0]), ...cons.proof.slice(1)],
    },
    {
      id: 'incl-proof-cap',
      op: 'verifyInclusion',
      reason: 'proof_too_long',
      leaf: baseLeaf,
      index: 0,
      tree_size: 1,
      root: baseLeaf,
      proof: Array.from({ length: MAX_PROOF_HASHES + 1 }, () => baseLeaf),
    },
    {
      id: 'cons-proof-cap',
      op: 'verifyConsistency',
      reason: 'proof_too_long',
      m: 1,
      n: 2,
      old_root: baseLeaf,
      new_root: baseRoot,
      proof: Array.from({ length: MAX_PROOF_HASHES + 1 }, () => baseLeaf),
    },
    {
      id: 'cons-genesis-n0-wrong-new-root',
      op: 'verifyConsistency',
      reason: 'root_mismatch',
      m: 0,
      n: 0,
      old_root: EMPTY_ROOT_HEX,
      new_root: baseRoot,
      proof: [],
    },
  ];

  for (const row of negative) {
    const verdict = row.op === 'verifyInclusion'
      ? verifyInclusion(row.leaf, row.index, row.tree_size, row.root, row.proof)
      : verifyConsistency(row.m, row.n, row.old_root, row.new_root, row.proof);
    if (verdict.ok || verdict.reason !== row.reason) {
      throw new Error(`${row.id}: expected ${row.reason}, got ${verdict.ok ? 'ok' : verdict.reason}`);
    }
  }

  return {
    schema: 'chit402.cs2.rfc9162.v1',
    rfc: '9162',
    hash: 'SHA-256',
    leaf_rule: 'SHA-256(0x00 || d)',
    node_rule: 'SHA-256(0x01 || left || right)',
    empty_root: EMPTY_ROOT_HEX,
    split: 'largest power of two strictly less than n',
    hash_encoding: 'lowercase-hex-64',
    vector_leaf_domain: VECTOR_LEAF_DOMAIN,
    vector_leaf_rule: 'd_i = SHA-256(domain || uint32be(i))',
    implementation_limits: {
      note: 'Not part of the RFC 9162 wire format. This JS implementation refuses a tree size that is not a safe integer (above 2^53-1) and a proof longer than 64 hashes.',
      max_tree_size: MAX_TREE_SIZE,
      max_proof_hashes: MAX_PROOF_HASHES,
    },
    genesis: 'm = 0 yields an empty proof; the old root is the empty root',
    equal_size: 'm = n yields an empty proof; the roots must be equal',
    rfc6962_reference: {
      leaves_hex: RFC6962_LEAVES_HEX,
      roots_n1_to_8: RFC6962_ROOTS_HEX,
    },
    counts: {
      roots: roots.length,
      inclusion: inclusion.length,
      consistency: consistency.length,
      negative: negative.length,
    },
    roots,
    inclusion,
    consistency,
    negative,
  };
}

export function renderRfc9162Json() {
  return `${JSON.stringify(build(), null, 2)}\n`;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const out = new URL('./rfc9162.json', import.meta.url);
  writeFileSync(out, renderRfc9162Json());
}
