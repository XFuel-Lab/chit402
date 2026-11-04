/**
 * Depth-256 compressed state proofs.
 * A set bit names a non-blank sibling. A clear bit is the blank subtree.
 * An absent slot is the blank hash of height 0, not an empty state leaf.
 */

export const STATE_DEPTH = 256;

type LineHashes = {
  emptyHash: (depth: number) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  stateLeaf: (key: Uint8Array, value: Uint8Array) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  stateNode: (left: Uint8Array, right: Uint8Array) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
};

type Trie = { hash: Uint8Array; left: Trie | null; right: Trie | null };

const BLANK: (Uint8Array | undefined)[] = new Array(STATE_DEPTH + 1);

function blankAt(line: LineHashes, height: number): Uint8Array | null {
  const cached = BLANK[height];
  if (cached) return cached;
  if (height <= 64) {
    const hashed = line.emptyHash(height);
    if (!hashed.ok) return null;
    BLANK[height] = hashed.bytes;
    return hashed.bytes;
  }
  const child = blankAt(line, height - 1);
  if (!child) return null;
  const node = line.stateNode(child, child);
  if (!node.ok) return null;
  BLANK[height] = node.bytes;
  return node.bytes;
}

export function blankHash(line: LineHashes, height: number): Uint8Array | null {
  if (!Number.isInteger(height) || height < 0 || height > STATE_DEPTH) return null;
  const bytes = blankAt(line, height);
  return bytes ? bytes.slice() : null;
}

function keyBit(key: Uint8Array, i: number): number {
  const byte = key[Math.floor(i / 8)] ?? 0;
  const bit = (byte >> (7 - (i % 8))) & 1;
  return bit;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function insert(line: LineHashes, node: Trie | null, key: Uint8Array, value: Uint8Array, depth: number): Trie | null {
  if (depth === STATE_DEPTH) {
    const hashed = line.stateLeaf(key, value);
    if (!hashed.ok) return null;
    return { hash: hashed.bytes, left: null, right: null };
  }
  const bit = keyBit(key, depth);
  const previous = node == null ? null : (bit === 0 ? node.left : node.right);
  const child = insert(line, previous, key, value, depth + 1);
  if (!child) return null;
  const left = bit === 0 ? child : (node ? node.left : null);
  const right = bit === 1 ? child : (node ? node.right : null);
  const blank = blankAt(line, 255 - depth);
  if (!blank) return null;
  const hashed = line.stateNode(left ? left.hash : blank, right ? right.hash : blank);
  if (!hashed.ok) return null;
  return { hash: hashed.bytes, left, right };
}

export function proveTree(
  line: LineHashes,
  leaves: { key: Uint8Array; value: Uint8Array }[],
): { ok: true; root: Uint8Array; proof: (key: Uint8Array) => Uint8Array } | { ok: false } {
  let trie: Trie | null = null;
  for (const leaf of leaves) {
    if (leaf.key.length !== 32) return { ok: false };
    trie = insert(line, trie, leaf.key, leaf.value, 0);
    if (!trie) return { ok: false };
  }
  const empty = blankAt(line, STATE_DEPTH);
  if (!empty) return { ok: false };
  const root = trie ? trie.hash : empty;
  const proof = (key: Uint8Array): Uint8Array => {
    const bitmap = new Uint8Array(32);
    const kept: Uint8Array[] = [];
    let node = trie;
    for (let depth = 0; depth < STATE_DEPTH; depth += 1) {
      const bit = keyBit(key, depth);
      const blank = blankAt(line, 255 - depth);
      if (!blank) return new Uint8Array();
      let siblingHash = blank;
      if (node) {
        const sibling = bit === 0 ? node.right : node.left;
        siblingHash = sibling ? sibling.hash : blank;
        node = bit === 0 ? node.left : node.right;
      }
      if (!sameBytes(siblingHash, blank)) {
        const index = Math.floor(depth / 8);
        bitmap[index] |= 1 << (7 - (depth % 8));
        kept.push(siblingHash);
      }
    }
    const out = new Uint8Array(32 + kept.length * 32);
    out.set(bitmap, 0);
    for (let i = 0; i < kept.length; i += 1) out.set(kept[i], 32 + i * 32);
    return out;
  };
  return { ok: true, root, proof };
}

export function verifyStateProof(
  line: LineHashes,
  leaf: Uint8Array,
  slotKeyBytes: Uint8Array,
  proof: Uint8Array,
  stateRoot: string,
): boolean {
  if (slotKeyBytes.length !== 32 || proof.length < 32 || (proof.length - 32) % 32 !== 0) return false;
  const bitmap = proof.subarray(0, 32);
  let listed = 0;
  for (let i = 0; i < STATE_DEPTH; i += 1) {
    if (keyBit(bitmap, i) === 1) listed += 1;
  }
  if (listed !== (proof.length - 32) / 32) return false;
  const siblings: Uint8Array[] = new Array(STATE_DEPTH);
  let cursor = 0;
  for (let i = 0; i < STATE_DEPTH; i += 1) {
    const blank = blankAt(line, 255 - i);
    if (!blank) return false;
    if (keyBit(bitmap, i) === 1) {
      const sibling = proof.subarray(32 + cursor * 32, 32 + (cursor + 1) * 32);
      if (!sibling || sibling.length !== 32) return false;
      if (sameBytes(sibling, blank)) return false;
      siblings[i] = sibling;
      cursor += 1;
    } else {
      siblings[i] = blank;
    }
  }
  let acc = leaf;
  for (let i = STATE_DEPTH - 1; i >= 0; i -= 1) {
    const sibling = siblings[i];
    const node = keyBit(slotKeyBytes, i) === 1 ? line.stateNode(sibling, acc) : line.stateNode(acc, sibling);
    if (!node.ok) return false;
    acc = node.bytes;
  }
  return bytesToHex(acc) === stateRoot.toLowerCase();
}
