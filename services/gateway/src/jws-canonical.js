/**
 * Canonical compact ES256 JWS: three segments in the base64url alphabet with
 * no padding, each re-encoding to the same text (zero trailing bits), and a
 * 64-byte raw R||S signature. Same rule as chit402-verify. Inputs longer than
 * MAX_COMPACT_JWS_LENGTH are refused before any decoding.
 */
export const MAX_COMPACT_JWS_LENGTH = 65536;

export function isCanonicalBase64url(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  return Buffer.from(segment, 'base64url').toString('base64url') === segment;
}

export function isCanonicalCompactEs256(jws) {
  if (typeof jws !== 'string' || jws.length > MAX_COMPACT_JWS_LENGTH) return false;
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts.every(isCanonicalBase64url)) return false;
  return Buffer.from(parts[2], 'base64url').length === 64;
}

/** A detached raw ES256 signature: canonical base64url of exactly 64 bytes. */
export function isCanonicalEs256Signature(value) {
  return isCanonicalBase64url(value) && Buffer.from(value, 'base64url').length === 64;
}
