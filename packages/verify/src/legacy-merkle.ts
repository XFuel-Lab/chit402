/**
 * Legacy receipt freeze tree.
 *
 * Contract branch `cursor/chit-issuer-root-contract` and gateway branch
 * `cursor/gateway-v11-issuer-root` were not in this repo when this was
 * written. Reconcile this encoding with those branches before mainnet.
 *
 *   leaf = SHA-256(0x00 || payload_hash)   // payload_hash is 32 raw bytes
 *   node = SHA-256(0x01 || left || right)
 *   payload_hash bytes are sorted ascending, then hashed
 *   when a level has an odd count greater than 1, the last node is duplicated
 *   a single leaf is the root (it is not paired with itself)
 *   empty root = SHA-256(0x00)
 *
 * Sort is on the payload hash, not the leaf hash. Vectors:
 * test/fixtures/legacy-merkle-vectors.json (byte-identical with #483 and #485).
 */

import { createHash } from 'node:crypto';

export const LEGACY_MERKLE_RECONCILE =
  'leaf = sha256(0x00 || payload_hash bytes), node = sha256(0x01 || left || right), '
  + 'payload hashes sorted ascending, odd levels duplicate the last node, '
  + 'empty root = sha256(0x00). Matches #483 and #485.';

/** SHA-256(0x00). The root of an empty legacy set. */
export const EMPTY_LEGACY_ROOT = createHash('sha256').update(Buffer.from([0x00])).digest();

export interface LegacyProofStep {
  hash: string;
  position: 'left' | 'right';
}

export interface LegacyInclusion {
  /** Position in the sorted leaf list. */
  index: number;
  leafCount: number;
  proof: LegacyProofStep[];
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

export function decodePayloadHash(payloadHash: string): Buffer | null {
  const hex = String(payloadHash || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

/** SHA-256(0x00 || payload_hash). */
export function legacyLeaf(payloadHash: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), payloadHash]));
}

/** SHA-256(0x01 || left || right). */
export function legacyNode(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function compareBytes(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** Payload hashes in ascending byte order. Equal hashes keep their order. */
export function sortedPayloadHashes(payloadHashes: Buffer[]): Buffer[] {
  return payloadHashes.map((hash, index) => ({ hash, index }))
    .sort((a, b) => compareBytes(a.hash, b.hash) || a.index - b.index)
    .map((row) => row.hash);
}

/** Leaf hashes in payload-hash order. The sort is not on the leaf hash. */
export function sortedLegacyLeaves(payloadHashes: Buffer[]): Buffer[] {
  return sortedPayloadHashes(payloadHashes).map((hash) => legacyLeaf(hash));
}

/**
 * Merkle root. Odd levels (count > 1) duplicate the last node, then pair
 * left-to-right. Parent nodes are not re-sorted. An empty set is SHA-256(0x00).
 */
export function legacyMerkleRoot(payloadHashes: Buffer[]): Buffer {
  if (payloadHashes.length === 0) return Buffer.from(EMPTY_LEGACY_ROOT);
  let level = sortedLegacyLeaves(payloadHashes);
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(Buffer.from(level[level.length - 1]));
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(legacyNode(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

export function legacyMerkleRootHex(payloadHashes: Buffer[]): string {
  return `0x${legacyMerkleRoot(payloadHashes).toString('hex')}`;
}

/**
 * Inclusion proof for one payload hash. `index` is its position in the
 * sorted leaf list, not its position in the input array.
 */
export function legacyInclusion(payloadHashes: Buffer[], payloadHash: Buffer): LegacyInclusion | null {
  const sorted = sortedPayloadHashes(payloadHashes);
  const index = sorted.findIndex((hash) => hash.equals(payloadHash));
  if (index < 0) return null;
  const leaves = sorted.map((hash) => legacyLeaf(hash));
  let level = leaves;
  let idx = index;
  const proof: LegacyProofStep[] = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(Buffer.from(level[level.length - 1]));
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push({
      hash: level[sibling].toString('hex'),
      position: sibling < idx ? 'left' : 'right',
    });
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(legacyNode(level[i], level[i + 1]));
    idx = Math.floor(idx / 2);
    level = next;
  }
  return { index, leafCount: payloadHashes.length, proof };
}

export function verifyLegacyInclusion(
  payloadHash: Buffer,
  index: number,
  leafCount: number,
  proof: LegacyProofStep[],
  rootHex: string,
): boolean {
  if (index < 0 || index >= leafCount || !Array.isArray(proof)) return false;
  let hash: Buffer = legacyLeaf(payloadHash);
  let idx = index;
  let width = leafCount;
  for (const step of proof) {
    if (!step || !/^[0-9a-fA-F]{64}$/.test(step.hash)) return false;
    if (width <= 1) return false;
    const sibling = Buffer.from(step.hash, 'hex');
    if (step.position === 'left') hash = legacyNode(sibling, hash);
    else if (step.position === 'right') hash = legacyNode(hash, sibling);
    else return false;
    if (width % 2 === 1) width += 1;
    width = Math.floor(width / 2);
    idx = Math.floor(idx / 2);
  }
  if (width !== 1) return false;
  const expected = rootHex.replace(/^0x/i, '').toLowerCase();
  return hash.toString('hex') === expected;
}
