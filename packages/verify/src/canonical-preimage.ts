/**
 * SHA-256 of the stored JCS canonical object.
 * The bytes are not rebuilt here. The caller passes the stored string.
 */
import { createHash } from 'node:crypto';
import { FEATURE_FIRST_VERSION } from './version-registry.js';

/** Payment receipts at this version sign payload_hash and issuer_history. From the version registry. */
export const CANONICAL_PAYLOAD_VERSION: number = FEATURE_FIRST_VERSION.canonical_preimage;

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function verifyCanonicalPreimageBytes(
  bytes: string,
  payloadHash: unknown,
): { ok: boolean; hash: string; reason: string | null } {
  const hash = sha256Utf8(bytes);
  if (typeof payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    return { ok: false, hash, reason: 'payload_hash_missing' };
  }
  if (hash !== payloadHash) return { ok: false, hash, reason: 'payload_hash_mismatch' };
  return { ok: true, hash, reason: null };
}
