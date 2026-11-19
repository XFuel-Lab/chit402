/**
 * Proof of possession over a PayToControl digest.
 *
 * The ECDSA input is SHA-256(d), d the 32-byte EIP-712 digest.
 * The signature is the second uint16-length-prefixed field, exactly 64 bytes,
 * r‖s, checked with checkSigma. The seller computes d locally and refuses a
 * caller-supplied digest.
 */

import { createHash } from 'node:crypto';
import { P256 } from '../ecdsa/curves.js';
import { yParityByTrial } from '../ecdsa/recover.js';
import { checkSigma } from './sigma-range.mjs';

export function possessionPreimage(digest) {
  if (!(digest instanceof Uint8Array) || digest.length !== 32) return null;
  return new Uint8Array(createHash('sha256').update(digest).digest());
}

export function verifyPossession(digest, uncompressedKey, signature) {
  const message = possessionPreimage(digest);
  if (!message) return { ok: false, reason: 'bad_length' };
  const range = checkSigma(signature);
  if (!range.ok) return range;
  try {
    const parity = yParityByTrial(message, signature, uncompressedKey, P256);
    if (parity !== 0 && parity !== 1) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
