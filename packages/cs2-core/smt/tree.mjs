/**
 * Depth-256 sparse Merkle tree for Chit Simple state.
 *
 * Rule 6 domains come from the line module and are not redefined here:
 *   leaf  = stateLeaf(key, value) = H(0x00 ‖ "chit402-state-v1" ‖ key ‖ H(value))
 *   node  = stateNode(left, right) = H(0x01 ‖ left ‖ right)
 *   empty = emptyHash(d), and past that module's depth cap the same
 *           recurrence: blank(d+1) = node(blank(d), blank(d)), blank(0) = H(0x02 ‖ "empty").
 *
 * A compressed proof is 32 bytes of bitmap plus the non-empty siblings
 * (SIMPLE §S5). Bit depth of the key (0 = MSB, the root) is set when that
 * level's sibling is not the blank hash of the child height. Siblings are
 * stored in increasing depth, root toward the leaf. A set bit whose sibling
 * is blank is not a canonical proof.
 *
 * Key bits are read from single bytes. Tree sizes and indexes go through
 * acceptSize / indexBytes and are not shifted as 32-bit words.
 */

import { emptyHash, stateLeaf, stateNode } from '../line/index.mjs';
import { bytesToHex, equalBytes } from '../ecdsa/bytes.js';
import { acceptSize } from './size.mjs';

export const DEPTH = 256;
export const PROOF_BITMAP_BYTES = 32;

const BLANK = new Array(DEPTH + 1);

function blankBytes(height) {
  const cached = BLANK[height];
  if (cached) return cached;
  if (height <= 64) {
    const hashed = emptyHash(height);
    if (!hashed.ok) return null;
    BLANK[height] = hashed.bytes;
    return BLANK[height];
  }
  const child = blankBytes(height - 1);
  if (!child) return null;
  const node = stateNode(child, child);
  if (!node.ok) return null;
  BLANK[height] = node.bytes;
  return BLANK[height];
}

/**
 * Blank subtree hash at `height`. height 0 is the empty leaf placeholder.
 * height 256 is the root of an empty tree. Above 256 is refused.
 * @param {number} height
 */
export function blankHash(height) {
  const checked = acceptSize(height);
  if (!checked.ok) return { ok: false, reason: 'bad_depth' };
  if (height > DEPTH) return { ok: false, reason: 'bad_depth' };
  const bytes = blankBytes(height);
  if (!bytes) return { ok: false, reason: 'bad_depth' };
  return { ok: true, bytes: bytes.slice() };
}

export function emptyRoot() {
  const bytes = blankBytes(DEPTH);
  return { ok: true, bytes: bytes.slice() };
}

function keyBit(key, depth) {
  const byteIndex = Math.floor(depth / 8);
  const bitInByte = depth % 8;
  const mask = Math.floor(128 / (2 ** bitInByte));
  return Math.floor(key[byteIndex] / mask) % 2;
}

function setBit(bitmap, depth) {
  const byteIndex = Math.floor(depth / 8);
  const bitInByte = depth % 8;
  const mask = Math.floor(128 / (2 ** bitInByte));
  bitmap[byteIndex] += mask;
}

function bitSet(bitmap, depth) {
  const byteIndex = Math.floor(depth / 8);
  const bitInByte = depth % 8;
  const mask = Math.floor(128 / (2 ** bitInByte));
  return Math.floor(bitmap[byteIndex] / mask) % 2 === 1;
}

function leafHash(key, value) {
  const hashed = stateLeaf(key, value);
  if (!hashed.ok) return null;
  return hashed.bytes;
}

function nodeHash(left, right) {
  const hashed = stateNode(left, right);
  if (!hashed.ok) return null;
  return hashed.bytes;
}

function makeLeaf(key, value) {
  const hash = leafHash(key, value);
  if (!hash) return null;
  return { hash, key, value, left: null, right: null };
}

/**
 * Insert a 32-byte key. Pure: the previous trie is not mutated.
 * @param {object | null} node
 * @param {Uint8Array} key
 * @param {Uint8Array} value
 * @param {number} depth
 */
function insert(node, key, value, depth) {
  if (depth === DEPTH) return makeLeaf(key, value);
  const bit = keyBit(key, depth);
  const childHeight = 255 - depth;
  const previous = node == null ? null : (bit === 0 ? node.left : node.right);
  const child = insert(previous, key, value, depth + 1);
  if (!child) return null;
  const left = bit === 0 ? child : (node ? node.left : null);
  const right = bit === 1 ? child : (node ? node.right : null);
  const leftHash = left ? left.hash : blankBytes(childHeight);
  const rightHash = right ? right.hash : blankBytes(childHeight);
  const hash = nodeHash(leftHash, rightHash);
  if (!hash) return null;
  return { hash, key: null, value: null, left, right };
}

export function createTree() {
  return { leaves: new Map(), trie: null, epoch: null };
}

export function rootBytes(tree) {
  if (!tree.trie) return blankBytes(DEPTH).slice();
  return tree.trie.hash.slice();
}

export function entryCount(tree) {
  return tree.leaves.size;
}

function copyBytes(bytes) {
  return new Uint8Array(bytes);
}

/**
 * Put one leaf. A second put of the same key replaces the value (one slot
 * per key). The previous tree object is left unchanged.
 */
export function putLeaf(tree, key, value, opts = {}) {
  if (!(key instanceof Uint8Array) || key.length !== 32) return { ok: false, reason: 'bad_key' };
  if (!(value instanceof Uint8Array)) return { ok: false, reason: 'bad_value' };
  const hex = bytesToHex(key);
  const existed = tree.leaves.has(hex);
  const nextCount = existed ? tree.leaves.size : tree.leaves.size + 1;
  const sized = acceptSize(nextCount);
  if (!sized.ok) return sized;
  const trie = insert(tree.trie, copyBytes(key), copyBytes(value), 0);
  if (!trie) return { ok: false, reason: 'bad_value' };
  const leaves = new Map(tree.leaves);
  leaves.set(hex, {
    key: copyBytes(key),
    value: copyBytes(value),
    dummy: opts.dummy === true,
  });
  return {
    ok: true,
    tree: { leaves, trie, epoch: tree.epoch },
  };
}

export function hasLeaf(tree, key) {
  return tree.leaves.has(bytesToHex(key));
}

export function getLeaf(tree, key) {
  const found = tree.leaves.get(bytesToHex(key));
  if (!found) return null;
  return { key: found.key, value: found.value.slice(), dummy: found.dummy };
}

/**
 * Compressed inclusion or absence proof.
 * @returns {{ok: true, present: boolean, value: Uint8Array | null, proof: Uint8Array, siblings: number} | {ok: false, reason: string}}
 */
export function prove(tree, key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) return { ok: false, reason: 'bad_key' };
  const bitmap = new Uint8Array(PROOF_BITMAP_BYTES);
  const kept = [];
  let node = tree.trie;
  for (let depth = 0; depth < DEPTH; depth += 1) {
    const bit = keyBit(key, depth);
    const childHeight = 255 - depth;
    const blank = blankBytes(childHeight);
    let siblingHash = blank;
    if (node) {
      const sibling = bit === 0 ? node.right : node.left;
      siblingHash = sibling ? sibling.hash : blank;
      node = bit === 0 ? node.left : node.right;
    } else {
      node = null;
    }
    if (!equalBytes(siblingHash, blank)) {
      setBit(bitmap, depth);
      kept.push(siblingHash);
    }
  }
  const proof = new Uint8Array(PROOF_BITMAP_BYTES + kept.length * 32);
  proof.set(bitmap, 0);
  for (let i = 0; i < kept.length; i += 1) proof.set(kept[i], PROOF_BITMAP_BYTES + i * 32);
  const found = tree.leaves.get(bytesToHex(key));
  return {
    ok: true,
    present: Boolean(found),
    value: found ? found.value.slice() : null,
    proof,
    siblings: kept.length,
  };
}

function popcount(bitmap) {
  let n = 0;
  for (let depth = 0; depth < DEPTH; depth += 1) {
    if (bitSet(bitmap, depth)) n += 1;
  }
  return n;
}

/**
 * Verify a compressed proof of `value` (or absence, when value is null)
 * under `root`.
 */
export function verifyProof(key, value, proof, root) {
  if (!(key instanceof Uint8Array) || key.length !== 32) return { ok: false, reason: 'bad_key' };
  if (value !== null && !(value instanceof Uint8Array)) return { ok: false, reason: 'bad_value' };
  if (!(proof instanceof Uint8Array)) return { ok: false, reason: 'bad_proof' };
  if (!(root instanceof Uint8Array) || root.length !== 32) return { ok: false, reason: 'bad_proof' };
  if (proof.length < PROOF_BITMAP_BYTES) return { ok: false, reason: 'bad_proof' };
  const rest = proof.length - PROOF_BITMAP_BYTES;
  if (rest % 32 !== 0) return { ok: false, reason: 'bad_proof' };
  const bitmap = proof.subarray(0, PROOF_BITMAP_BYTES);
  const listed = rest / 32;
  if (listed !== popcount(bitmap)) return { ok: false, reason: 'bad_proof' };
  if (listed > DEPTH) return { ok: false, reason: 'bad_proof' };

  const byDepth = new Array(DEPTH);
  let cursor = 0;
  for (let depth = 0; depth < DEPTH; depth += 1) {
    const blank = blankBytes(255 - depth);
    if (bitSet(bitmap, depth)) {
      const start = PROOF_BITMAP_BYTES + cursor * 32;
      const sibling = proof.subarray(start, start + 32);
      cursor += 1;
      if (equalBytes(sibling, blank)) return { ok: false, reason: 'bad_proof' };
      byDepth[depth] = sibling;
    } else {
      byDepth[depth] = blank;
    }
  }

  let hash = value === null ? blankBytes(0) : leafHash(key, value);
  if (!hash) return { ok: false, reason: 'bad_value' };
  for (let depth = DEPTH - 1; depth >= 0; depth -= 1) {
    const sibling = byDepth[depth];
    const bit = keyBit(key, depth);
    hash = bit === 0 ? nodeHash(hash, sibling) : nodeHash(sibling, hash);
    if (!hash) return { ok: false, reason: 'bad_proof' };
  }
  if (!equalBytes(hash, root)) return { ok: false, reason: 'bad_proof' };
  return { ok: true };
}

/**
 * Rebuild a trie from a leaf map. Used when dummy keys are re-drawn.
 * @param {Map<string, {key: Uint8Array, value: Uint8Array, dummy: boolean}>} leaves
 * @param {object | null} epoch
 */
export function treeFromLeaves(leaves, epoch) {
  const sized = acceptSize(leaves.size);
  if (!sized.ok) return sized;
  let trie = null;
  for (const entry of leaves.values()) {
    trie = insert(trie, entry.key, entry.value, 0);
    if (!trie) return { ok: false, reason: 'bad_value' };
  }
  return { ok: true, tree: { leaves, trie, epoch } };
}
