/**
 * Test-only ES256 key for synthetic fixtures. It is derived from a public
 * seed, so it is not a secret and must never be trusted outside tests.
 */
import { createECDH, createHash, createPrivateKey, createPublicKey } from 'node:crypto';

export const SYNTHETIC_KEY_SEED = 'chit402 synthetic receipt fixture key v1';

export function syntheticIssuerKey(seed = SYNTHETIC_KEY_SEED) {
  const d = createHash('sha256').update(seed, 'utf8').digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const x = point.subarray(1, 33).toString('base64url');
  const y = point.subarray(33, 65).toString('base64url');
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d: d.toString('base64url') }, format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x, y })).digest('base64url');
  const publicJwk = { kty: 'EC', crv: 'P-256', x, y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, publicKey: createPublicKey(privateKey), kid, publicJwk };
}

/** Base64 PKCS#8 PEM, the form ISSUER_PRIVATE_KEY takes. */
export function syntheticIssuerKeyEnv(seed = SYNTHETIC_KEY_SEED) {
  const pem = syntheticIssuerKey(seed).privateKey.export({ format: 'pem', type: 'pkcs8' });
  return Buffer.from(pem).toString('base64');
}
