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

/** JWS typ of the 0.4.6 public receipt attestation. Only public-attestation.ts accepts it. */
export const PUBLIC_RECEIPT_TYP = 'chit402-public-receipt+jwt';

/**
 * Expected JWS `typ` per issuer-signed document slot.
 *
 * Every issuer document is signed by the same key, so the protected `typ`
 * header is what separates them. A slot accepts only its own typ.
 *
 * Receipts: `chit402-receipt+jwt` since payload v5. Receipts issued before
 * that used the generic `JWT` typ, which the receipt slot still accepts.
 * No issued receipt lacks a typ; an untyped issuer JWS (for example an x402
 * offer or receipt extension signed before those had their own typ) is
 * refused. verifyReceipt still requires the signed payload to name this receipt.
 */
export const ISSUER_JWS_TYP = {
  receipt: ['chit402-receipt+jwt', 'JWT'],
  treeHead: ['chit402-tree-head+jwt'],
  treeEpoch: ['chit402-tree-epoch+jwt'],
  issuerHistory: ['chit402-issuer-history+jwt'],
  refusal: ['chit402-refusal+jwt'],
  freeze: ['chit402-freeze+jwt'],
  anchorWallets: ['chit402-anchor-wallets+jwt'],
  x402Offer: ['chit402-x402-offer+jwt'],
  x402Receipt: ['chit402-x402-receipt+jwt'],
} as const satisfies Record<string, readonly (string | null)[]>;

export type IssuerJwsTyp = string | null;

export interface VerifyIssuerJwsOptions {
  /**
   * Accepted `typ` values for this slot (`null` accepts a header with no typ).
   * Any other typ is `typ_mismatch`. When omitted, only the public
   * attestation typ is refused (pre-0.4.8 behaviour for direct callers).
   */
  expectTyp?: readonly IssuerJwsTyp[];
}

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
  options: VerifyIssuerJwsOptions = {},
): { valid: boolean; payload?: Record<string, unknown>; reason?: string } {
  if (!jws || typeof jws !== 'string') {
    return { valid: false, reason: 'invalid_jws' };
  }
  const parts = jws.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed_jws' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string; typ?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'json_parse_error' };
  }
  // A public attestation is never a receipt, head, epoch, refusal, or history
  // document. Its payload is tagged, not JSON, so it also fails the parse below.
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    return { valid: false, reason: 'json_parse_error' };
  }
  if (header.typ === PUBLIC_RECEIPT_TYP) {
    return { valid: false, reason: 'typ_mismatch' };
  }
  if (options.expectTyp) {
    // No issuer signer sets crit or b64. An unencoded or critical-extension
    // JWS is not one of ours, so a typed slot refuses it (RFC 7515 §4.1.11).
    const raw = header as Record<string, unknown>;
    if (raw.crit !== undefined || raw.b64 !== undefined) {
      return { valid: false, reason: 'unsupported_header' };
    }
    const typ = header.typ === undefined ? null : header.typ;
    if (typeof typ !== 'string' && typ !== null) return { valid: false, reason: 'typ_mismatch' };
    if (!options.expectTyp.includes(typ)) return { valid: false, reason: 'typ_mismatch' };
  }
  try {
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
