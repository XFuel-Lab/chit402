/**
 * SHA-256 of the stored JCS canonical object.
 * The bytes are not rebuilt here. The caller passes the stored string.
 */
import { createHash } from 'node:crypto';
import { rfc8785Canonicalize } from './jcs.js';

/** Payment receipts at this version sign payload_hash and issuer_history. */
export const CANONICAL_PAYLOAD_VERSION = 10;

type CanonRule = {
  canonicalize: (value: unknown) => string;
};

/**
 * v11 and refusal v2. `chit402-jcs-v1` is not in this map: entry hashes and
 * payload versions through v10 call `jcsCanonicalize` directly.
 * Gateway head `cursor/gateway-v11-issuer-root-5306` (`72ac4d4`).
 */
const CANONICALIZERS: Record<string, CanonRule> = {
  RFC8785: { canonicalize: rfc8785Canonicalize },
};

/**
 * What payload v11 and refusal v2 sign in `canonicalization`.
 * There is no `string_escaping` field.
 */
export const V11_CANONICALIZATION = {
  hash_alg: 'sha-256',
  jcs: 'RFC8785',
} as const;

/** Same object. Refusal tests name the rule. */
export const RFC8785_CANONICALIZATION = V11_CANONICALIZATION;

export function v11CanonicalizationVerdict(value: unknown): { ok: boolean; reason: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'canonicalization_missing' };
  }
  const row = value as { hash_alg?: unknown; jcs?: unknown };
  if (row.hash_alg !== V11_CANONICALIZATION.hash_alg) {
    return { ok: false, reason: 'canonicalization_hash_alg' };
  }
  const rule = typeof row.jcs === 'string' ? CANONICALIZERS[row.jcs] : undefined;
  if (!rule) return { ok: false, reason: 'canonicalization_jcs' };
  if (Object.prototype.hasOwnProperty.call(row, 'string_escaping')) {
    return { ok: false, reason: 'canonicalization_string_escaping' };
  }
  return { ok: true, reason: null };
}

/** SHA-256 of the claims, without `payload_hash`, under the declared `jcs` rule. */
export function recomputeV11PayloadHash(claims: Record<string, unknown>): string | null {
  const declared = claims.canonicalization;
  const ruleName = declared && typeof declared === 'object'
    ? (declared as { jcs?: unknown }).jcs
    : undefined;
  const rule = typeof ruleName === 'string' ? CANONICALIZERS[ruleName] : undefined;
  if (!rule) return null;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (key === 'payload_hash' || value === undefined) continue;
    body[key] = value;
  }
  try {
    return sha256Utf8(rule.canonicalize(body));
  } catch {
    return null;
  }
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
