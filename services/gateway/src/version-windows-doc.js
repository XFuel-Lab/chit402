/**
 * Signed receipt version windows (chit402-verify, redesign step 3).
 *
 * GET /.well-known/version-windows.json serves the exact bytes of
 * packages/verify/version-windows.json from this checkout. The verifier
 * does not fetch it (it enforces its bundled, sha-pinned copy); the route
 * publishes the signed document so anyone can compare it with the package.
 * Served only when it carries the production issuer signature kid; a
 * test-signed copy (a PR build) is 404, so it is never announced.
 */
import { readFileSync } from 'node:fs';

export const VERSION_WINDOWS_PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const DEFAULT_PATH = new URL('../../../packages/verify/version-windows.json', import.meta.url);

/** Bytes to serve, or null when absent, unreadable or not production-signed. */
export function versionWindowsBytes(path = DEFAULT_PATH) {
  let bytes;
  try {
    bytes = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const doc = JSON.parse(bytes);
    if (doc?.schema !== 'chit402.version_windows.v1') return null;
    if (doc?.issuer_signature?.kid !== VERSION_WINDOWS_PRODUCTION_KID) return null;
    const header = JSON.parse(Buffer.from(String(doc.issuer_signature.jws || '').split('.')[0] || '', 'base64url').toString('utf8'));
    if (header?.kid !== VERSION_WINDOWS_PRODUCTION_KID || header?.typ !== 'chit402-version-windows+jwt') return null;
  } catch {
    return null;
  }
  return bytes;
}
