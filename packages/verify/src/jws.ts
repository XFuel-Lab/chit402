/**
 * Compact JWS (ES256) verification for Chit402 receipts.
 *
 * A signature is only valid when the verifying key is trusted:
 *   - it is the JWKS entry for the JWS `kid` (caller-supplied file, or a JWKS
 *     fetched from an allowlisted issuer `jwks_uri`), or
 *   - its RFC 7638 thumbprint equals a pinned trusted kid.
 * The receipt's embedded `issuer_jwk` is not a trust root by itself.
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export interface Es256Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface ReceiptWithIssuerJwk {
  issuer_signature?: {
    kid?: string;
    jws?: string;
    issuer_jwk?: Es256Jwk;
  };
}

/**
 * Production issuer kid (RFC 7638 thumbprint of the api.chit402.com ES256 key).
 * Offline default pin. Override with `trustedKids` / `--trusted-kid`.
 */
export const DEFAULT_TRUSTED_ISSUER_KIDS = [
  'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q',
] as const;

/** Hosts whose published JWKS may be fetched and treated as a trust root. */
export const DEFAULT_TRUSTED_JWKS_HOSTS = ['api.chit402.com'] as const;

export const KEY_UNTRUSTED = 'key untrusted';

export function resolvePinnedIssuerJwk(receipt: ReceiptWithIssuerJwk): Es256Jwk | null {
  const jwk = receipt.issuer_signature?.issuer_jwk as Es256Jwk | undefined;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return null;
  const kid = receipt.issuer_signature?.kid;
  if (kid && jwk.kid && kid !== jwk.kid) return null;
  return jwk;
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url).
 * EC required members in lexicographic order: crv, kty, x, y.
 */
export function jwkThumbprint(jwk: Pick<Es256Jwk, 'kty' | 'crv' | 'x' | 'y'>): string {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return createHash('sha256').update(canonical).digest('base64url');
}

export function isEs256PublicJwk(jwk: Es256Jwk | null | undefined): jwk is Es256Jwk {
  return !!jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && !!jwk.x && !!jwk.y;
}

/** True when the key's RFC 7638 thumbprint is one of the pinned trusted kids. */
export function isPinnedTrustedJwk(
  jwk: Es256Jwk | null | undefined,
  trustedKids: readonly string[],
): boolean {
  if (!isEs256PublicJwk(jwk) || trustedKids.length === 0) return false;
  return trustedKids.includes(jwkThumbprint(jwk));
}

export function sameEs256Key(a: Es256Jwk, b: Es256Jwk): boolean {
  return a.x === b.x && a.y === b.y && a.crv === b.crv && a.kty === b.kty;
}

export function readJwsHeader(jws: string): { alg?: string; kid?: string; jku?: string } | null {
  const headerB64 = jws.split('.')[0];
  if (!headerB64) return null;
  try {
    return JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function jwksHostAllowed(uri: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:') return false;
    return hosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function verifyIssuerJws(
  jws: string,
  jwk: Es256Jwk,
): { valid: boolean; payload?: Record<string, unknown>; reason?: string } {
  if (!jws || typeof jws !== 'string') {
    return { valid: false, reason: 'invalid_jws' };
  }
  const parts = jws.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed_jws' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'json_parse_error' };
  }

  if (header.alg !== 'ES256') {
    return { valid: false, reason: `unsupported_alg: ${header.alg}` };
  }
  if (header.kid && jwk.kid && header.kid !== jwk.kid) {
    return { valid: false, reason: 'kid_mismatch' };
  }

  try {
    const publicKey: KeyObject = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk',
    });
    const signature = Buffer.from(signatureB64, 'base64url');
    const signingInput = `${headerB64}.${payloadB64}`;
    const valid = verify('sha256', Buffer.from(signingInput, 'utf8'), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, signature);
    return valid ? { valid: true, payload } : { valid: false, reason: 'signature_invalid' };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${(err as Error).message}` };
  }
}
