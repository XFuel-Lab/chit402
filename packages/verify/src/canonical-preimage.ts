/**
 * SHA-256 of the stored JCS canonical object.
 * The bytes are not rebuilt here. The caller passes the stored string.
 */
import { createHash } from 'node:crypto';
import { jcsCanonicalize } from './jcs.js';

/** Payment receipts at this version sign payload_hash and issuer_history. */
export const CANONICAL_PAYLOAD_VERSION = 10;

const CHIT402_JCS_V1_ESCAPING = 'UTF-8, no trailing newline. Object keys sorted by UTF-16 code unit. Every code unit U+0000 through U+001F is \\u00xx lowercase hex, including U+0008, U+0009, U+000A, U+000C, and U+000D. U+0022 is \\". U+005C is \\\\. Other UTF-16 code units are copied, so U+1F600 is the four UTF-8 bytes f0 9f 98 80. Solidus is not escaped.';

type CanonRule = {
  canonicalize: (value: unknown) => string;
  string_escaping: string;
};

/**
 * One entry per accepted `jcs` label. Verdict and recompute both go through
 * this map, so a new rule is one entry.
 *
 * TODO: Christopher has the decision pending on true RFC 8785. No gateway
 * emits those bytes. RFC 8785 writes U+0008/0009/000A/000C/000D as
 * `\b` `\t` `\n` `\f` `\r`. Adding it later is this one entry:
 *   RFC8785: { canonicalize: rfc8785Canonicalize, string_escaping: '...' },
 */
const CANONICALIZERS: Record<string, CanonRule> = {
  'chit402-jcs-v1': {
    canonicalize: jcsCanonicalize,
    string_escaping: CHIT402_JCS_V1_ESCAPING,
  },
};

/**
 * What payload v11 signs in `canonicalization` today.
 * Gateway head `cursor/gateway-v11-issuer-root-5306` (`485c5d8`).
 */
export const V11_CANONICALIZATION = {
  hash_alg: 'sha-256',
  jcs: 'chit402-jcs-v1',
  string_escaping: CHIT402_JCS_V1_ESCAPING,
} as const;

export function v11CanonicalizationVerdict(value: unknown): { ok: boolean; reason: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'canonicalization_missing' };
  }
  const row = value as { hash_alg?: unknown; jcs?: unknown; string_escaping?: unknown };
  if (row.hash_alg !== V11_CANONICALIZATION.hash_alg) {
    return { ok: false, reason: 'canonicalization_hash_alg' };
  }
  const rule = typeof row.jcs === 'string' ? CANONICALIZERS[row.jcs] : undefined;
  if (!rule) return { ok: false, reason: 'canonicalization_jcs' };
  if (row.string_escaping !== rule.string_escaping) {
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
  return sha256Utf8(rule.canonicalize(body));
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
