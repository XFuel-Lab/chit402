/**
 * Epoch slot (DS-32) and padding to 1,024 entries (DS-21).
 *
 * The epoch slot is kind 0x04. Its key is slotKey from the line module.
 * Every hourly epoch stores a fresh 32-byte value, so the state root moves
 * even when no other slot changed. hourStart is a multiple of 3600, and the
 * next epoch is the previous hour plus 3600.
 *
 * Dummy keys fill the tree up to 1,024 leaves. They are re-drawn when the
 * caller changes the tier seed. Real slots, including the epoch slot, stay.
 */

import { createHash } from 'node:crypto';
import { KIND_EPOCH, slotKey } from '../line/index.mjs';
import { equalBytes } from '../ecdsa/bytes.js';
import { acceptSize, indexBytes } from './size.mjs';
import { fail } from './reasons.mjs';
import { decodeHistory } from './history.mjs';
import {
  entryCount,
  hasLeaf,
  putLeaf,
  treeFromLeaves,
} from './tree.mjs';

export const PAD_ENTRIES = 1024;
export const HOUR_SECONDS = 3600;

const DUMMY_KEY = new TextEncoder().encode('chit402-smt-dummy-v1');
const DUMMY_VAL = new TextEncoder().encode('chit402-smt-dummy-val-v1');

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function chainIdOf(value) {
  if (typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)) {
    return BigInt(value);
  }
  return null;
}

/**
 * Replace the epoch slot with fresh randomness. The first draw is epoch 0.
 * Later draws advance the epoch by 1 and the hour by 3600.
 */
export function drawEpoch(tree, spec) {
  if (!spec || typeof spec !== 'object') return fail('bad_type');
  const epochOk = acceptSize(spec.epoch);
  const hourOk = acceptSize(spec.hourStart);
  if (!epochOk.ok || !hourOk.ok) return fail('bad_epoch');
  if (spec.hourStart % HOUR_SECONDS !== 0) return fail('bad_epoch');
  if (!(spec.randomness instanceof Uint8Array) || spec.randomness.length !== 32) return fail('bad_random');
  const chainId = chainIdOf(spec.chainId);
  if (chainId === null) return fail('bad_epoch');
  if (tree.epoch) {
    if (chainId !== tree.epoch.chainId) return fail('bad_epoch');
    if (spec.epoch !== tree.epoch.epoch + 1) return fail('bad_epoch');
    const nextHour = tree.epoch.hourStart + HOUR_SECONDS;
    if (!Number.isSafeInteger(nextHour) || spec.hourStart !== nextHour) return fail('bad_epoch');
    if (equalBytes(spec.randomness, tree.epoch.value)) return fail('bad_random');
  } else if (spec.epoch !== 0) {
    return fail('bad_epoch');
  }
  const key = slotKey({ kind: KIND_EPOCH, chainId, id: new Uint8Array(0) });
  if (!key.ok) return key;
  const placed = putLeaf(tree, key.bytes, spec.randomness, { dummy: false });
  if (!placed.ok) return placed;
  const epoch = {
    chainId,
    epoch: spec.epoch,
    hourStart: spec.hourStart,
    value: new Uint8Array(spec.randomness),
  };
  return {
    ok: true,
    tree: { leaves: placed.tree.leaves, trie: placed.tree.trie, epoch },
    slotKey: key,
  };
}

/** Put a history under the slot key the line module derives for it. */
export function placeHistory(tree, historyBytes) {
  const decoded = decodeHistory(historyBytes);
  if (!decoded.ok) return decoded;
  const key = slotKey({ kind: decoded.kind, chainId: decoded.chainId, id: decoded.id });
  if (!key.ok) return key;
  const placed = putLeaf(tree, key.bytes, historyBytes, { dummy: false });
  if (!placed.ok) return placed;
  return {
    ok: true,
    tree: { leaves: placed.tree.leaves, trie: placed.tree.trie, epoch: tree.epoch },
    slotKey: key,
  };
}

function dummyBytes(seed, index, domain) {
  const encoded = indexBytes(index);
  if (!encoded.ok) return encoded;
  return { ok: true, bytes: sha256([domain, seed, encoded.bytes]) };
}

/**
 * Pad with random dummy keys until the tree has 1,024 leaves. A tree that
 * is already at or above the tier is unchanged. Dummy keys are skipped when
 * they collide with a leaf that is already there.
 */
export function padTo1024(tree, seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) return fail('bad_random');
  if (entryCount(tree) >= PAD_ENTRIES) return { ok: true, tree, added: 0 };
  let next = tree;
  let added = 0;
  let index = 0;
  while (entryCount(next) < PAD_ENTRIES) {
    const sized = acceptSize(index);
    if (!sized.ok) return sized;
    const key = dummyBytes(seed, index, DUMMY_KEY);
    const value = dummyBytes(seed, index, DUMMY_VAL);
    if (!key.ok) return key;
    if (!value.ok) return value;
    if (!hasLeaf(next, key.bytes)) {
      const placed = putLeaf(next, key.bytes, value.bytes, { dummy: true });
      if (!placed.ok) return placed;
      next = { leaves: placed.tree.leaves, trie: placed.tree.trie, epoch: next.epoch };
      added += 1;
    }
    index += 1;
    if (index > PAD_ENTRIES + 64) return fail('bad_padding');
  }
  return { ok: true, tree: next, added };
}

/** Drop dummy leaves and pad again from a new seed. Real slots stay. */
export function redrawDummies(tree, seed) {
  const leaves = new Map();
  for (const [hex, entry] of tree.leaves) {
    if (!entry.dummy) leaves.set(hex, entry);
  }
  const rebuilt = treeFromLeaves(leaves, tree.epoch);
  if (!rebuilt.ok) return rebuilt;
  return padTo1024(rebuilt.tree, seed);
}
