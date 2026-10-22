/**
 * Signed receipt version windows (chit402-verify, redesign step 3).
 *
 * GET /.well-known/version-windows.json serves the exact bytes of
 * packages/verify/version-windows.json from this checkout. The verifier
 * does not fetch it (it enforces its bundled, sha-pinned copy); the route
 * publishes the signed document so anyone can compare it with the package.
 *
 * Served only when the signature verifies: ES256 JWS with typ
 * chit402-version-windows+jwt and the production kid, payload schema
 * chit402.version_windows.v1 and body_sha256 equal to sha256(JCS(document
 * without issuer_signature)), checked against the production public key in
 * packages/verify/issuer-history.snapshot.json (the issuer history the
 * verifier bundles). Anything else, including a test-signed copy from a PR
 * build, is 404, so it is never announced.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const VERSION_WINDOWS_PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const TYP = 'chit402-version-windows+jwt';
const SCHEMA = 'chit402.version_windows.v1';
const DEFAULT_PATH = new URL('../../../packages/verify/version-windows.json', import.meta.url);
const DEFAULT_HISTORY = new URL('../../../packages/verify/issuer-history.snapshot.json', import.meta.url);

/**
 * JCS (RFC 8785) for the value types this document uses: objects, arrays,
 * strings, booleans, null and safe integers. Any other number throws, so
 * the caller fails closed instead of hashing a form that may differ.
 */
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('non-integer number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  throw new Error('unsupported value');
}

/** Production public JWKs for the version windows kid, from an issuer history file. */
export function productionKeys(historyPath = DEFAULT_HISTORY) {
  try {
    const history = JSON.parse(readFileSync(historyPath, 'utf8'));
    return (history.entries || [])
      .filter((e) => e && e.kid === VERSION_WINDOWS_PRODUCTION_KID && e.jwk && e.jwk.kty === 'EC' && e.jwk.crv === 'P-256')
      .map((e) => e.jwk);
  } catch {
    return [];
  }
}

/** True when `doc` carries a valid production signature over its body. */
export function hasProductionSignature(doc, keys) {
  const sig = doc?.issuer_signature;
  if (!sig || typeof sig.jws !== 'string' || sig.kid !== VERSION_WINDOWS_PRODUCTION_KID) return false;
  const parts = sig.jws.split('.');
  if (parts.length !== 3) return false;
  let header;
  let payload;
  let bodyHash;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const { issuer_signature: _omit, ...body } = doc;
    bodyHash = createHash('sha256').update(canonical(body)).digest('hex');
  } catch {
    return false;
  }
  if (header?.alg !== 'ES256' || header?.typ !== TYP || header?.kid !== VERSION_WINDOWS_PRODUCTION_KID) return false;
  if (payload?.schema !== SCHEMA || payload?.body_sha256 !== bodyHash) return false;
  const signature = Buffer.from(parts[2], 'base64url');
  if (signature.length !== 64) return false;
  for (const jwk of keys) {
    try {
      const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
      if (verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, signature)) return true;
    } catch {
      // try the next key
    }
  }
  return false;
}

/** Bytes to serve, or null when absent, unreadable or not production-signed. */
export function versionWindowsBytes(path = DEFAULT_PATH, { keys = productionKeys() } = {}) {
  let bytes;
  try {
    bytes = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let doc;
  try {
    doc = JSON.parse(bytes);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schema !== SCHEMA) return null;
  return hasProductionSignature(doc, keys) ? bytes : null;
}
