import { createHash } from 'node:crypto';

/**
 * RFC 9162 §2.1 Merkle tree for Chit402 v13.
 * Leaf = SHA-256(0x00 || d). Node = SHA-256(0x01 || left || right).
 * Empty root = SHA-256(""). Inclusion is PATH (§2.1.3). Consistency is
 * SUBPROOF (§2.1.4), plus the v13 genesis rule (old size 0).
 * Wire hashes are lowercase 64-hex with no prefix. Bad input returns
 * { ok: false, reason } and never throws. This is not the live receipt log.
 *
 * Tree size uses safe-integer arithmetic and stops at 2^53-1. That cap is an
 * implementation limit of this module, not an RFC 9162 wire field. Shifts are
 * division, not bitwise ops, so sizes at and above 2^31 stay exact.
 */

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** Implementation limit: largest tree size this module will accept. Not a wire field. */
export const MAX_TREE_SIZE = Number.MAX_SAFE_INTEGER;

/** Implementation limit: longest proof this module will accept. Not a wire field. */
export const MAX_PROOF_HASHES = 64;

const EMPTY_ROOT = sha256(new Uint8Array(0));
export const EMPTY_ROOT_HEX = toHex(EMPTY_ROOT);

function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function toHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hashLeaf(data) {
  const out = new Uint8Array(1 + data.length);
  out[0] = LEAF_PREFIX;
  out.set(data, 1);
  return sha256(out);
}

function hashPair(left, right) {
  const out = new Uint8Array(1 + left.length + right.length);
  out[0] = NODE_PREFIX;
  out.set(left, 1);
  out.set(right, 1 + left.length);
  return sha256(out);
}

function largestPowerOfTwoLessThan(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function isPowerOfTwo(m) {
  if (m <= 0) return false;
  let x = m;
  while (x % 2 === 0) x = Math.floor(x / 2);
  return x === 1;
}

function lsb(x) {
  return x % 2 === 1;
}

function shr(x) {
  return Math.floor(x / 2);
}

function checkEntries(entries) {
  if (!Array.isArray(entries)) return { ok: false, reason: 'bad_type' };
  for (let i = 0; i < entries.length; i += 1) {
    if (!(entries[i] instanceof Uint8Array)) return { ok: false, reason: 'bad_leaf' };
  }
  return { ok: true, entries };
}

function checkSize(value) {
  // -0 is a safe integer and compares equal to 0; refuse it anyway.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    return { ok: false, reason: 'bad_size' };
  }
  if (value > MAX_TREE_SIZE) return { ok: false, reason: 'bad_size' };
  return { ok: true, size: value };
}

function checkIndex(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    return { ok: false, reason: 'bad_index' };
  }
  return { ok: true, index: value };
}

function parseWireHash(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'bad_hex' };
  if (!/^[0-9a-f]*$/.test(value)) return { ok: false, reason: 'bad_hex' };
  if (value.length % 2 !== 0) return { ok: false, reason: 'bad_proof_element' };
  const raw = Buffer.from(value, 'hex');
  if (raw.length !== 32) return { ok: false, reason: 'bad_proof_element' };
  return { ok: true, hash: new Uint8Array(raw) };
}

function parseProof(proof) {
  if (!Array.isArray(proof)) return { ok: false, reason: 'bad_type' };
  if (proof.length > MAX_PROOF_HASHES) return { ok: false, reason: 'proof_too_long' };
  const nodes = [];
  for (let i = 0; i < proof.length; i += 1) {
    const parsed = parseWireHash(proof[i]);
    if (!parsed.ok) return parsed;
    nodes.push(parsed.hash);
  }
  return { ok: true, nodes };
}

/**
 * @param {Uint8Array} data raw leaf bytes
 * @returns {{ok: true, hash: Uint8Array} | {ok: false, reason: string}}
 */
export function leafHash(data) {
  if (!(data instanceof Uint8Array)) return { ok: false, reason: 'bad_leaf' };
  return { ok: true, hash: hashLeaf(data) };
}

/**
 * @param {Uint8Array} left 32-byte hash
 * @param {Uint8Array} right 32-byte hash
 * @returns {{ok: true, hash: Uint8Array} | {ok: false, reason: string}}
 */
export function nodeHash(left, right) {
  if (!(left instanceof Uint8Array) || left.length !== 32) return { ok: false, reason: 'bad_length' };
  if (!(right instanceof Uint8Array) || right.length !== 32) return { ok: false, reason: 'bad_length' };
  return { ok: true, hash: hashPair(left, right) };
}

function mthRange(entries, start, end) {
  const n = end - start;
  if (n === 0) return { ok: true, hash: new Uint8Array(EMPTY_ROOT) };
  if (n === 1) return { ok: true, hash: hashLeaf(entries[start]) };
  const k = largestPowerOfTwoLessThan(n);
  const left = mthRange(entries, start, start + k);
  if (!left.ok) return left;
  const right = mthRange(entries, start + k, end);
  if (!right.ok) return right;
  return { ok: true, hash: hashPair(left.hash, right.hash) };
}

/**
 * Merkle Tree Hash of raw entries. RFC 9162 §2.1.1.
 * @param {Uint8Array[]} entries
 * @returns {{ok: true, hash: Uint8Array} | {ok: false, reason: string}}
 */
export function mth(entries) {
  const checked = checkEntries(entries);
  if (!checked.ok) return checked;
  return mthRange(checked.entries, 0, checked.entries.length);
}

function pathRange(entries, start, end, index) {
  const size = end - start;
  if (size === 1) return [];
  const k = largestPowerOfTwoLessThan(size);
  if (index - start < k) {
    const left = pathRange(entries, start, start + k, index);
    if (!Array.isArray(left)) return left;
    const right = mthRange(entries, start + k, end);
    if (!right.ok) return right;
    return left.concat([toHex(right.hash)]);
  }
  const right = pathRange(entries, start + k, end, index);
  if (!Array.isArray(right)) return right;
  const left = mthRange(entries, start, start + k);
  if (!left.ok) return left;
  return right.concat([toHex(left.hash)]);
}

/**
 * Inclusion proof PATH(index, entries). RFC 9162 §2.1.3.1.
 * @returns {{ok: true, proof: string[]} | {ok: false, reason: string}}
 */
export function inclusionProof(entries, index) {
  const checked = checkEntries(entries);
  if (!checked.ok) return checked;
  const idx = checkIndex(index);
  if (!idx.ok) return idx;
  if (idx.index >= checked.entries.length) return { ok: false, reason: 'index_out_of_range' };
  const proof = pathRange(checked.entries, 0, checked.entries.length, idx.index);
  if (!Array.isArray(proof)) return proof;
  return { ok: true, proof };
}

/**
 * Verify an inclusion proof. RFC 9162 §2.1.3.2.
 * `leaf` is the leaf hash SHA-256(0x00 || d), lowercase 64-hex.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyInclusion(leaf, index, treeSize, root, proof) {
  const leafH = parseWireHash(leaf);
  if (!leafH.ok) return leafH;
  const rootH = parseWireHash(root);
  if (!rootH.ok) return rootH;
  const size = checkSize(treeSize);
  if (!size.ok) return size;
  const idx = checkIndex(index);
  if (!idx.ok) return idx;
  if (idx.index >= size.size) return { ok: false, reason: 'index_out_of_range' };
  const parsed = parseProof(proof);
  if (!parsed.ok) return parsed;
  let fn = idx.index;
  let sn = size.size - 1;
  let r = leafH.hash;
  for (let i = 0; i < parsed.nodes.length; i += 1) {
    if (sn === 0) return { ok: false, reason: 'proof_too_long' };
    const p = parsed.nodes[i];
    if (lsb(fn) || fn === sn) {
      r = hashPair(p, r);
      if (!lsb(fn)) {
        while (!lsb(fn) && fn !== 0) {
          fn = shr(fn);
          sn = shr(sn);
        }
      }
    } else {
      r = hashPair(r, p);
    }
    fn = shr(fn);
    sn = shr(sn);
  }
  if (sn !== 0) return { ok: false, reason: 'proof_too_short' };
  if (!bytesEqual(r, rootH.hash)) return { ok: false, reason: 'root_mismatch' };
  return { ok: true };
}

function subproof(entries, start, end, m, known) {
  const size = end - start;
  if (m === size) {
    if (known) return [];
    const hash = mthRange(entries, start, end);
    if (!hash.ok) return hash;
    return [toHex(hash.hash)];
  }
  const k = largestPowerOfTwoLessThan(size);
  if (m <= k) {
    const left = subproof(entries, start, start + k, m, known);
    if (!Array.isArray(left)) return left;
    const right = mthRange(entries, start + k, end);
    if (!right.ok) return right;
    return left.concat([toHex(right.hash)]);
  }
  const right = subproof(entries, start + k, end, m - k, false);
  if (!Array.isArray(right)) return right;
  const left = mthRange(entries, start, start + k);
  if (!left.ok) return left;
  return right.concat([toHex(left.hash)]);
}

/**
 * Consistency proof SUBPROOF(m, D[n], true). RFC 9162 §2.1.4.1.
 * m = 0 and m = n return an empty proof (v13 genesis and equal size).
 * @returns {{ok: true, proof: string[]} | {ok: false, reason: string}}
 */
export function consistencyProof(entries, m, n) {
  const checked = checkEntries(entries);
  if (!checked.ok) return checked;
  const ms = checkSize(m);
  if (!ms.ok) return ms;
  const ns = checkSize(n);
  if (!ns.ok) return ns;
  if (ns.size > checked.entries.length) return { ok: false, reason: 'bad_size' };
  if (ms.size > ns.size) return { ok: false, reason: 'm_gt_n' };
  if (ms.size === 0 || ms.size === ns.size) return { ok: true, proof: [] };
  const built = subproof(checked.entries, 0, ns.size, ms.size, true);
  if (!Array.isArray(built)) return built;
  return { ok: true, proof: built };
}

/**
 * Verify a consistency proof. RFC 9162 §2.1.4.2, plus genesis:
 * m = 0 accepts only an empty proof and the empty-tree old root;
 * m = n accepts only an empty proof and equal roots.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyConsistency(m, n, oldRoot, newRoot, proof) {
  const ms = checkSize(m);
  if (!ms.ok) return ms;
  const ns = checkSize(n);
  if (!ns.ok) return ns;
  const oldH = parseWireHash(oldRoot);
  if (!oldH.ok) return oldH;
  const newH = parseWireHash(newRoot);
  if (!newH.ok) return newH;
  const parsed = parseProof(proof);
  if (!parsed.ok) return parsed;
  if (m > n) return { ok: false, reason: 'm_gt_n' };
  if (m === 0) {
    if (parsed.nodes.length !== 0) return { ok: false, reason: 'proof_not_empty' };
    if (!bytesEqual(oldH.hash, EMPTY_ROOT)) return { ok: false, reason: 'root_mismatch' };
    if (n === 0 && !bytesEqual(newH.hash, EMPTY_ROOT)) return { ok: false, reason: 'root_mismatch' };
    return { ok: true };
  }
  if (m === n) {
    if (parsed.nodes.length !== 0) return { ok: false, reason: 'proof_not_empty' };
    if (!bytesEqual(oldH.hash, newH.hash)) return { ok: false, reason: 'root_mismatch' };
    return { ok: true };
  }
  if (parsed.nodes.length === 0) return { ok: false, reason: 'proof_too_short' };
  const nodes = parsed.nodes.slice();
  if (isPowerOfTwo(m)) nodes.unshift(oldH.hash);
  let fn = m - 1;
  let sn = n - 1;
  while (lsb(fn)) {
    fn = shr(fn);
    sn = shr(sn);
  }
  let fr = nodes[0];
  let sr = nodes[0];
  for (let i = 1; i < nodes.length; i += 1) {
    if (sn === 0) return { ok: false, reason: 'proof_too_long' }; // past the new root
    const c = nodes[i];
    if (lsb(fn) || fn === sn) {
      fr = hashPair(c, fr);
      sr = hashPair(c, sr);
      if (!lsb(fn)) {
        while (!lsb(fn) && fn !== 0) {
          fn = shr(fn);
          sn = shr(sn);
        }
      }
    } else {
      sr = hashPair(sr, c);
    }
    fn = shr(fn);
    sn = shr(sn);
  }
  if (sn !== 0) return { ok: false, reason: 'proof_too_short' };
  if (!bytesEqual(fr, oldH.hash)) return { ok: false, reason: 'root_mismatch' };
  if (!bytesEqual(sr, newH.hash)) return { ok: false, reason: 'root_mismatch' };
  return { ok: true };
}
