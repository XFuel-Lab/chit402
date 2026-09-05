/**
 * Compact JWS (ES256) verification for Chit402 receipts.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';

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

export function resolvePinnedIssuerJwk(receipt: ReceiptWithIssuerJwk): Es256Jwk | null {
  const jwk = receipt.issuer_signature?.issuer_jwk as Es256Jwk | undefined;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null;
  const kid = receipt.issuer_signature?.kid;
  if (kid && jwk.kid && kid !== jwk.kid) return null;
  return jwk;
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
