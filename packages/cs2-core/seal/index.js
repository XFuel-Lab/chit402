/**
 * Chit Simple v13 line sealing (SIMPLE §S2, B3; DS-07, DS-08, DS-10, DS-22, DS-39).
 *
 * A fresh 32-byte dk encrypts the fixed 1,024-byte line under
 * ChaCha20-Poly1305 with a 12-byte zero nonce. dk is single-use, so the
 * nonce is not transmitted. The AAD is H("dk" ‖ dk), which commits the
 * ciphertext to that key.
 *
 * dk is then wrapped to exactly two HPKE recipient slots (RFC 9180 base
 * mode, X25519 / HKDF-SHA256 / ChaCha20-Poly1305). Slot 0 is the book key.
 * Slot 1 is the recovery key, or the fixed nothing-up-my-sleeve dummy
 * recipient when the caller passes no recovery key (DS-22). Each wrap's
 * AAD is the one-byte slot index, so the slots are not interchangeable.
 *
 * The sealed blob is always 1,200 bytes: 1,040 of line ciphertext and
 * two 80-byte slots (32-byte enc || 48-byte wrapped dk). There is no
 * length prefix. Q-H1 is closed: the AEAD stays ChaCha20-Poly1305.
 *
 * This module does not import the line codec. The caller passes a
 * 1,024-byte line and, for the leaf, the codec's C. SHA-256, X25519, and
 * the AEAD are vendored. Failures are { ok: false, reason } and do not
 * carry plaintext, keys, or lengths.
 */

import { openBase, sealBase } from './hpke.js';
import { aeadOpen, aeadSeal } from './vendor/chacha20poly1305.js';
import { sha256 } from './vendor/sha256.js';

export const SCHEMA = 'chit402.cs2.seal.v1';

/** Matches the line codec. Pinned again by the seal tests. */
export const LINE_BYTES = 1024;
export const HEADER_BYTE_0 = 0x63;
export const HEADER_BYTE_1 = 0x32;
export const USED_BYTES = 803;
export const TAG_BYTES = 16;
export const DK_BYTES = 32;
export const ENC_BYTES = 32;
export const LINE_CT_BYTES = LINE_BYTES + TAG_BYTES;
export const SLOT_BYTES = ENC_BYTES + DK_BYTES + TAG_BYTES;
export const SLOT_COUNT = 2;
export const SEALED_BYTES = LINE_CT_BYTES + (SLOT_COUNT * SLOT_BYTES);

const INFO = ascii('chit402-seal-v1');
const DK_LABEL = ascii('dk');
const LEAF_LABEL = ascii('line');
const DUMMY_LABEL = ascii('chit402-dummy-x25519-v1');
const ZERO_NONCE = new Uint8Array(12);

export const REASONS = Object.freeze([
  'bad_type',
  'bad_length',
  'bad_header',
  'bad_padding',
  'bad_key',
  'bad_random',
  'open_failed',
]);

const REASON_SET = new Set(REASONS);

function fail(reason) {
  if (!REASON_SET.has(reason)) {
    throw new Error('unknown reason');
  }
  return { ok: false, reason };
}

function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new Error('domain string must be ASCII');
    out[i] = code;
  }
  return out;
}

function isZero(bytes) {
  let acc = 0;
  for (let i = 0; i < bytes.length; i += 1) acc |= bytes[i];
  return acc === 0;
}

function copy32(value) {
  if (!(value instanceof Uint8Array)) return fail('bad_type');
  if (value.length !== 32) return fail('bad_key');
  return { ok: true, bytes: value.slice() };
}

function random32() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return null;
  const out = new Uint8Array(32);
  cryptoObj.getRandomValues(out);
  return out;
}

function dummyRecipient() {
  const pk = sha256(DUMMY_LABEL);
  pk[31] &= 0x7f;
  return pk;
}

/** Nothing-up-my-sleeve X25519 public key. The scalar is not known. */
export const DUMMY_RECIPIENT_PK = dummyRecipient();

function lineShape(line) {
  if (!(line instanceof Uint8Array)) return fail('bad_type');
  if (line.length !== LINE_BYTES) return fail('bad_length');
  if (line[0] !== HEADER_BYTE_0 || line[1] !== HEADER_BYTE_1) return fail('bad_header');
  for (let i = USED_BYTES; i < LINE_BYTES; i += 1) {
    if (line[i] !== 0) return fail('bad_padding');
  }
  return { ok: true };
}

/** H("dk" ‖ dk). This is the key-committing AAD (DS-07). */
export function dkCommitment(dk) {
  const key = copy32(dk);
  if (!key.ok) return key;
  const bytes = sha256(DK_LABEL, key.bytes);
  key.bytes.fill(0);
  return { ok: true, bytes };
}

/** H(ct ‖ slots). The sealed blob is that concatenation, so this is H(sealed). */
export function sealedCommitment(sealed) {
  if (!(sealed instanceof Uint8Array)) return fail('bad_type');
  if (sealed.length !== SEALED_BYTES) return fail('bad_length');
  return { ok: true, bytes: sha256(sealed) };
}

/**
 * Leaf H(0x00 ‖ "line" ‖ C ‖ H("dk" ‖ dk) ‖ H(ct ‖ slots)).
 * C is the line codec's 32-byte commitment. dk is wiped locally.
 * @param {Uint8Array} c
 * @param {Uint8Array} sealed
 * @param {Uint8Array} dk
 */
export function lineLeaf(c, sealed, dk) {
  const commit = copy32(c);
  if (!commit.ok) return commit;
  const ct = sealedCommitment(sealed);
  if (!ct.ok) return ct;
  const dkHash = dkCommitment(dk);
  if (!dkHash.ok) return dkHash;
  const bytes = sha256(Uint8Array.of(0x00), LEAF_LABEL, commit.bytes, dkHash.bytes, ct.bytes);
  return {
    ok: true,
    bytes,
    dkCommitment: dkHash.bytes,
    sealedCommitment: ct.bytes,
  };
}

function slotAad(slot) {
  return Uint8Array.of(slot);
}

function writeSlot(target, slot, pk, dk, esk) {
  const wrapped = sealBase(pk, INFO, slotAad(slot), dk, esk);
  if (!wrapped.ok) return wrapped;
  if (wrapped.enc.length !== ENC_BYTES || wrapped.ct.length !== DK_BYTES + TAG_BYTES) {
    return fail('open_failed');
  }
  const at = LINE_CT_BYTES + (slot * SLOT_BYTES);
  target.set(wrapped.enc, at);
  target.set(wrapped.ct, at + ENC_BYTES);
  return { ok: true };
}

function wipe(buf) {
  if (buf) buf.fill(0);
}

/**
 * Seal a 1,024-byte line to two slots.
 * recoveryPk omitted or null selects the dummy recipient.
 * seed.dk and seed.esk ([slot0, slot1]) make the output deterministic.
 * The result does not contain dk or the line.
 * @param {Uint8Array} line
 * @param {Uint8Array} bookPk
 * @param {Uint8Array | null | undefined} recoveryPk
 * @param {{ dk?: Uint8Array, esk?: [Uint8Array, Uint8Array] }} [seed]
 */
export function sealLine(line, bookPk, recoveryPk, seed) {
  const shape = lineShape(line);
  if (!shape.ok) return shape;
  const book = copy32(bookPk);
  if (!book.ok) return book;
  const held = [book.bytes];
  const release = () => {
    for (const buf of held) wipe(buf);
  };
  try {
    if (isZero(book.bytes)) return fail('bad_key');
    let recoveryBytes;
    if (recoveryPk === undefined || recoveryPk === null) {
      recoveryBytes = DUMMY_RECIPIENT_PK.slice();
    } else {
      const recovery = copy32(recoveryPk);
      if (!recovery.ok) return recovery;
      recoveryBytes = recovery.bytes;
    }
    held.push(recoveryBytes);
    if (isZero(recoveryBytes)) return fail('bad_key');
    const opts = seed === undefined ? {} : seed;
    if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) return fail('bad_type');
    let dk;
    if (opts.dk === undefined) {
      dk = random32();
      if (!dk) return fail('bad_random');
    } else {
      const given = copy32(opts.dk);
      if (!given.ok) return given;
      dk = given.bytes;
    }
    held.push(dk);
    if (isZero(dk)) return fail('bad_key');
    let esk0;
    let esk1;
    if (opts.esk === undefined) {
      esk0 = random32();
      esk1 = random32();
      held.push(esk0, esk1);
      if (!esk0 || !esk1) return fail('bad_random');
    } else {
      if (!Array.isArray(opts.esk) || opts.esk.length !== 2) return fail('bad_type');
      const a = copy32(opts.esk[0]);
      if (!a.ok) return a;
      held.push(a.bytes);
      const b = copy32(opts.esk[1]);
      if (!b.ok) return b;
      held.push(b.bytes);
      esk0 = a.bytes;
      esk1 = b.bytes;
    }
    const aad = sha256(DK_LABEL, dk);
    const lineCt = aeadSeal(dk, ZERO_NONCE, aad, line);
    if (!lineCt || lineCt.length !== LINE_CT_BYTES) return fail('open_failed');
    const sealed = new Uint8Array(SEALED_BYTES);
    sealed.set(lineCt, 0);
    const slot0 = writeSlot(sealed, 0, book.bytes, dk, esk0);
    if (!slot0.ok) return slot0;
    const slot1 = writeSlot(sealed, 1, recoveryBytes, dk, esk1);
    if (!slot1.ok) return slot1;
    const dkHash = sha256(DK_LABEL, dk);
    const ctHash = sha256(sealed);
    return {
      ok: true,
      sealed,
      dkCommitment: dkHash,
      sealedCommitment: ctHash,
    };
  } finally {
    release();
  }
}

function readSlot(sealed, slot) {
  const at = LINE_CT_BYTES + (slot * SLOT_BYTES);
  return {
    enc: sealed.subarray(at, at + ENC_BYTES),
    ct: sealed.subarray(at + ENC_BYTES, at + SLOT_BYTES),
  };
}

/**
 * Open one slot. slot is 0 (book) or 1 (recovery).
 * Cryptographic failure is always open_failed.
 * @param {Uint8Array} sealed
 * @param {Uint8Array} sk
 * @param {number} slot
 */
export function openLine(sealed, sk, slot) {
  if (!(sealed instanceof Uint8Array)) return fail('bad_type');
  if (sealed.length !== SEALED_BYTES) return fail('bad_length');
  if (slot !== 0 && slot !== 1) return fail('bad_type');
  const key = copy32(sk);
  if (!key.ok) return key;
  const { enc, ct } = readSlot(sealed, slot);
  const opened = openBase(enc, key.bytes, INFO, slotAad(slot), ct);
  key.bytes.fill(0);
  if (!opened.ok || opened.pt.length !== DK_BYTES) return fail('open_failed');
  const dk = opened.pt;
  try {
    const aad = sha256(DK_LABEL, dk);
    const lineCt = sealed.subarray(0, LINE_CT_BYTES);
    const pt = aeadOpen(dk, ZERO_NONCE, aad, lineCt);
    if (!pt) return fail('open_failed');
    const shape = lineShape(pt);
    if (!shape.ok) {
      pt.fill(0);
      return fail('open_failed');
    }
    return { ok: true, line: pt };
  } finally {
    dk.fill(0);
  }
}

/**
 * Try both slots. Both attempts always run. Failure does not say which
 * slot failed. On success, slot is 0 or 1.
 * @param {Uint8Array} sealed
 * @param {Uint8Array} sk
 */
export function openLineAny(sealed, sk) {
  const first = openLine(sealed, sk, 0);
  const second = openLine(sealed, sk, 1);
  if (first.ok && second.ok) {
    second.line.fill(0);
    return { ok: true, line: first.line, slot: 0 };
  }
  if (first.ok) return { ok: true, line: first.line, slot: 0 };
  if (second.ok) return { ok: true, line: second.line, slot: 1 };
  return fail('open_failed');
}
