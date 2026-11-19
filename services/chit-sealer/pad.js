/**
 * Pad one close's log leaves to k·N.
 *
 * Phase 0 tier is N = 128. Real leaves and random 32-byte decoys share
 * one path, then the batch is sorted by leaf hash. An empty hour and a
 * full hour both come out with k·N leaves. The real count is not returned.
 */

import { leafHash } from '../../packages/cs2-core/merkle/index.js';

export const TIER_N = 128;

function compareBytes(a, b) {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * @param {Uint8Array[]} real preimages already accepted
 * @param {number} count k·N, the only size this batch may have
 * @param {(n: number) => Uint8Array | null} randomBytes
 */
export function padLeaves(real, count, randomBytes) {
  if (!Array.isArray(real)) return { ok: false, reason: 'bad_type' };
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, reason: 'size_cap' };
  if (real.length > count) return { ok: false, reason: 'tier_exceeded' };
  const entries = [];
  for (let i = 0; i < real.length; i += 1) entries.push(real[i]);
  const need = count - real.length;
  for (let i = 0; i < need; i += 1) {
    const decoy = randomBytes(32);
    if (!(decoy instanceof Uint8Array) || decoy.length !== 32) {
      return { ok: false, reason: 'bad_random' };
    }
    entries.push(decoy);
  }
  const keyed = [];
  for (let i = 0; i < entries.length; i += 1) {
    const hash = leafHash(entries[i]);
    if (!hash.ok) return { ok: false, reason: hash.reason };
    keyed.push({ bytes: entries[i], hash: hash.hash });
  }
  keyed.sort((a, b) => compareBytes(a.hash, b.hash));
  const leaves = keyed.map((entry) => entry.bytes);
  return { ok: true, leaves, count: leaves.length };
}
