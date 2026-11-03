/**
 * State-slot kinds and key status for Chit Simple v13.
 *
 * Kind 0x05 is the key slot. Its id is the 32-byte keyHash. The slot key is
 * SHA-256("chit402-state-v1" ‖ 0x05 ‖ chainId ‖ keyHash). Kinds 0x06–0xFF
 * stay reserved. This file is the only definition of KIND_KEY.
 *
 * A tombstone carries a derived revokedAtBlock. It applies at that block and
 * after, and only when the block sits after the previous epoch's anchor and
 * at or before the anchor of the epoch that shows it. A bare tombstone is
 * an invalid record. It is not a revocation from block 0.
 *
 * Key status at block b needs two proofs under one stateRoot: the payTo slot
 * and the key slot. A missing proof is unproven.
 */

import { createHash } from 'node:crypto';
import { bytesToHex } from '../ecdsa/bytes.js';
import { keyHash } from './key-hash.mjs';
import { expiryAllows } from './time.mjs';

export const KIND_PAYTO = 0x01;
export const KIND_KEY = 0x05;
/** Channel slot. Reserved until its id width is specified. Not accepted by slotKey. */
export const KIND_CHANNEL = 0x06;
export const EXIT_UNPROVEN = 2;
export const SLOT_DOMAIN = 'chit402-state-v1';

export const KEY_STATUS_ACTIVE = 'active';
export const KEY_STATUS_UNPROVEN = 'unproven';
export const KEY_STATUS_INVALID = 'invalid';
export const KEY_STATUS_REVOKED = 'revoked';

function status(name, reason, exitCode) {
  if (name === KEY_STATUS_ACTIVE) return { ok: true, status: name };
  const out = { ok: false, status: name, reason };
  if (exitCode != null) out.exitCode = exitCode;
  return out;
}

function unproven(reason) {
  return status(KEY_STATUS_UNPROVEN, reason, EXIT_UNPROVEN);
}

function asBlock(value) {
  if (typeof value !== 'bigint' || value < 0n || value >= (1n << 64n)) return null;
  return value;
}

function chainBytes(chainId) {
  const parsed = asBlock(chainId);
  if (parsed == null) return null;
  const out = new Uint8Array(8);
  let v = parsed;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Proposed key-slot preimage. The line codec still rejects kind 0x05.
 * Rev 5 decides whether this id width lands in slotKey.
 */
export function keySlotKey(chainId, keyHashBytes) {
  if (!(keyHashBytes instanceof Uint8Array) || keyHashBytes.length !== 32) {
    return { ok: false, reason: 'bad_length' };
  }
  const chain = chainBytes(typeof chainId === 'bigint' ? chainId : null);
  if (!chain) return { ok: false, reason: 'bad_uint' };
  const hash = createHash('sha256');
  hash.update(SLOT_DOMAIN);
  hash.update(Uint8Array.of(KIND_KEY));
  hash.update(chain);
  hash.update(keyHashBytes);
  const bytes = new Uint8Array(hash.digest());
  return { ok: true, bytes, hex: bytesToHex(bytes) };
}

/**
 * A tombstone is valid only with a non-zero revokedAtBlock inside
 * (prevAnchorBlock, showAnchorBlock].
 */
export function checkTombstone(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return status(KEY_STATUS_INVALID, 'bare_tombstone');
  }
  if (!Object.hasOwn(entry, 'revokedAtBlock') || entry.revokedAtBlock == null) {
    return status(KEY_STATUS_INVALID, 'bare_tombstone');
  }
  const at = asBlock(entry.revokedAtBlock);
  const prev = asBlock(entry.prevAnchorBlock);
  const show = asBlock(entry.showAnchorBlock);
  if (at == null || at === 0n || prev == null || show == null) {
    return status(KEY_STATUS_INVALID, 'bare_tombstone');
  }
  if (!(prev < at && at <= show)) return status(KEY_STATUS_INVALID, 'bare_tombstone');
  return { ok: true, revokedAtBlock: at };
}

/** Forward-only. A block before revokedAtBlock is not covered. */
export function tombstoneCovers(entry, receiptBlock) {
  const checked = checkTombstone(entry);
  if (!checked.ok) return checked;
  const block = asBlock(receiptBlock);
  if (block == null) return status(KEY_STATUS_INVALID, 'bad_block');
  return {
    ok: true,
    applies: block >= checked.revokedAtBlock,
    revokedAtBlock: checked.revokedAtBlock,
  };
}

function proofPresent(proofs, name) {
  return proofs != null && proofs[name] === true;
}

/**
 * Admission block x is accepted only when the record is absent under the
 * previous epoch, present under this epoch, and anchor(e−1) < x ≤ anchor(e).
 * A missing proof is unproven, exit 2.
 */
export function checkAdmission(proof) {
  const absent = proof != null && (proof.absentAtPrev === true || proof.emptyAtPrev === true);
  if (!absent || proof.memberAtEpoch !== true) {
    return unproven('admission_unproven');
  }
  const prev = asBlock(proof.anchorPrev);
  const epoch = asBlock(proof.anchorEpoch);
  const block = asBlock(proof.block);
  if (prev == null || epoch == null || block == null) return unproven('admission_unproven');
  if (!(prev < block && block <= epoch)) return unproven('admission_bounds');
  return { ok: true, block };
}

/** Derive the key slot from the σ key. A bundle-supplied key that differs is unproven. */
export function deriveKeySlotKey({ sigmaKey, chainId, bundleKey } = {}) {
  const hashed = keyHash(0x01, sigmaKey);
  if (!hashed.ok) return unproven('bad_key');
  const slot = keySlotKey(typeof chainId === 'bigint' ? chainId : null, hashed.bytes);
  if (!slot.ok) return unproven(slot.reason);
  if (bundleKey != null) {
    const got = bundleKey instanceof Uint8Array ? bytesToHex(bundleKey) : String(bundleKey).toLowerCase().replace(/^0x/, '');
    if (got !== slot.hex) return unproven('bundle_key');
  }
  return { ...slot, keyHash: hashed.bytes };
}

/**
 * One key-slot leaf. Empty means no tombstone. A present leaf that does not
 * validate, or that holds more than one record, is unproven (exit 2).
 * A RevokeByKey copied into a payTo slot is not this leaf and is ignored.
 */
export function readKeyLeaf(leaf) {
  if (leaf == null || leaf.empty === true) return { ok: true, tombstone: null };
  const records = leaf.records;
  if (!Array.isArray(records)) return unproven('bad_leaf');
  if (records.length === 0) return { ok: true, tombstone: null };
  if (records.length > 1) return unproven('many_records');
  const one = records[0];
  if (one == null || one.payToCopy === true) return { ok: true, tombstone: null, ignored: true };
  if (one.decodeOk === false || one.signatureOk === false || one.keyHashOk === false) return unproven('bad_leaf');
  const checked = checkTombstone(one);
  if (!checked.ok) return unproven('bare_tombstone');
  const admission = checkAdmission(one.admission);
  if (!admission.ok) return admission;
  if (admission.block !== checked.revokedAtBlock) return unproven('admission_bounds');
  return { ok: true, tombstone: checked.revokedAtBlock };
}

function sameHash(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * Key status for k in payTo P at block b, from two proofs under one root.
 * Expiry is unix seconds and is compared only to hourStart.
 * A payTo Revoke blocks that keyHash in that slot forever.
 * RevokeByKey is read only from the key leaf.
 */
export function keyStatus(view) {
  if (view == null || typeof view !== 'object') return unproven('missing_proof');
  if (!proofPresent(view.proofs, 'payTo') || !proofPresent(view.proofs, 'key')) return unproven('missing_proof');
  if (view.stateRoot == null || (view.otherRoot != null && view.otherRoot !== view.stateRoot)) return unproven('root');
  const derived = deriveKeySlotKey({ sigmaKey: view.sigmaKey, chainId: view.chainId, bundleKey: view.bundleKey });
  if (!derived.ok) return derived;
  const leaf = readKeyLeaf(view.keyLeaf);
  if (!leaf.ok) return leaf;
  const block = asBlock(view.block);
  const hour = asBlock(view.hourStart);
  if (block == null || hour == null) return unproven('bad_block');
  const registration = view.registration;
  if (registration == null) return status(KEY_STATUS_INVALID, 'unregistered');
  const admission = checkAdmission(registration.admission);
  if (!admission.ok) return admission;
  const admitted = asBlock(registration.admissionBlock);
  const expiry = asBlock(registration.expiry);
  if (admitted == null || expiry == null || admitted !== admission.block) return unproven('admission_unproven');
  if (!expiryAllows(hour, expiry)) return status(KEY_STATUS_INVALID, 'expired');
  if (admitted > block) return status(KEY_STATUS_INVALID, 'inactive');
  if (view.slotRevoke != null && sameHash(view.slotRevoke.keyHash, registration.keyHash)) {
    if (view.rebinding === true) return status(KEY_STATUS_INVALID, 'slot_rebind');
    const slotAt = asBlock(view.slotRevoke.revokedAtBlock);
    if (slotAt != null && block >= slotAt) return status(KEY_STATUS_REVOKED, 'slot_revoke');
  }
  const tomb = leaf.tombstone;
  if (tomb != null) {
    if (admitted >= tomb) return status(KEY_STATUS_INVALID, 'admitted_after_tombstone');
    if (block >= tomb) return status(KEY_STATUS_REVOKED, 'key_tombstone');
  }
  return { ok: true, status: KEY_STATUS_ACTIVE, slotKey: derived.hex };
}
