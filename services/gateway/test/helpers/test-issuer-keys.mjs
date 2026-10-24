/**
 * Known test issuer keys. Each private scalar is sha256 of a public seed
 * (TEST_ISSUER_KEY_SEEDS in src/production-process.js), so these are never
 * secrets. Only these keys can be opted out of the production check with
 * ISSUER_TEST_KEY=1. Use testIssuerKey(n) wherever a test needs a fresh,
 * distinct issuer key; n is 0..63.
 */
import { syntheticIssuerKey } from '../../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';

export function testIssuerKeySeed(n) {
  if (!Number.isInteger(n) || n < 0 || n > 63) throw new Error('test issuer key index is 0..63');
  return `chit402 test issuer key ${n}`;
}

/** { privateKey, publicKey, kid, publicJwk, env } where env is the base64 PKCS#8 PEM form ISSUER_PRIVATE_KEY takes. */
export function testIssuerKey(n) {
  const key = syntheticIssuerKey(testIssuerKeySeed(n));
  const env = Buffer.from(key.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64');
  return { ...key, env };
}

let next = 0;

/**
 * A distinct known test issuer key on each call in this process. There are 64
 * (the seeds in src/production-process.js); the 65th call throws instead of
 * silently reusing a key. A file that needs more must add seeds there.
 */
export function nextTestIssuerKey() {
  if (next >= 64) throw new Error('nextTestIssuerKey: all 64 known test issuer keys are used in this process; add seeds to TEST_ISSUER_KEY_SEEDS');
  const key = testIssuerKey(next);
  next += 1;
  return key;
}
