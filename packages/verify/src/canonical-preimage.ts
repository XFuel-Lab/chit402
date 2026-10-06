/**
 * SHA-256 of the stored JCS canonical object.
 * The bytes are not rebuilt here. The caller passes the stored string.
 */
import { createHash } from 'node:crypto';
import { jcsCanonicalize } from './jcs.js';

/** Payment receipts at this version sign payload_hash and issuer_history. */
export const CANONICAL_PAYLOAD_VERSION = 10;

/**
 * Values payload v11 signs in `canonicalization`. `jcs` is `RFC8785` at the
 * gateway head `cursor/gateway-v11-issuer-root-5306` (`f9f16db`). An unknown
 * `hash_alg` or `jcs` fails closed. `chit402-jcs-v1` is not accepted.
 */
export const V11_CANONICALIZATION = {
  hash_alg: 'sha-256',
  jcs: 'RFC8785',
  string_escaping: 'UTF-8, no trailing newline. Object keys sorted by UTF-16 code unit. U+0000 through U+001F escaped as \\u00xx lowercase hex. U+0022 escaped as \\". U+005C escaped as \\\\. Other code units copied. Solidus is not escaped.',
} as const;

export function v11CanonicalizationVerdict(value: unknown): { ok: boolean; reason: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'canonicalization_missing' };
  }
  const row = value as { hash_alg?: unknown; jcs?: unknown; string_escaping?: unknown };
  if (row.hash_alg !== V11_CANONICALIZATION.hash_alg) {
    return { ok: false, reason: 'canonicalization_hash_alg' };
  }
  if (row.jcs !== V11_CANONICALIZATION.jcs) {
    return { ok: false, reason: 'canonicalization_jcs' };
  }
  if (row.string_escaping !== V11_CANONICALIZATION.string_escaping) {
    return { ok: false, reason: 'canonicalization_string_escaping' };
  }
  return { ok: true, reason: null };
}

/** SHA-256 of JCS(claims without payload_hash). The declared rule is sha-256 / RFC8785. */
export function recomputeV11PayloadHash(claims: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (key === 'payload_hash' || value === undefined) continue;
    body[key] = value;
  }
  return sha256Utf8(jcsCanonicalize(body));
}

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
