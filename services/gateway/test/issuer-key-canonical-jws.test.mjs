/**
 * The gateway's own JWS verify refuses non-canonical base64url, the same
 * rule as chit402-verify.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyJws, verifyJwsWithJwks, isCanonicalCompactEs256 } from '../src/issuer-key.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const e = publicKey.export({ format: 'jwk' });
const jwk = { kty: 'EC', crv: 'P-256', x: e.x, y: e.y, kid: 'k1', alg: 'ES256' };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const input = `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ a: 1 })}`;
const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const jws = `${input}.${sig}`;

test('canonical JWS verifies in both gateway paths', () => {
  assert.equal(isCanonicalCompactEs256(jws), true);
  assert.equal(verifyJws(jws, jwk).valid, true);
  assert.equal(verifyJwsWithJwks(jws, { keys: [jwk] }).valid, true);
});

test('non-canonical spellings are malformed_jws in both gateway paths', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // 86-char signature: the last character has 4 unused bits.
  const trailing = `${sig.slice(0, -1)}${alphabet[alphabet.indexOf(sig.at(-1)) | 1]}`;
  assert.deepEqual(Buffer.from(trailing, 'base64url'), Buffer.from(sig, 'base64url'));
  for (const variant of [
    `${input}.${trailing}`,
    `${input}.${sig}==`,
    `${input}.${sig.slice(0, 5)}+${sig.slice(6)}`,
    `${input}.${sig.slice(0, 5)}*${sig.slice(5)}`,
    `${input}.${Buffer.from(sig, 'base64url').subarray(1).toString('base64url')}`,
  ]) {
    assert.equal(verifyJws(variant, jwk).reason, 'malformed_jws', variant.slice(-12));
    assert.equal(verifyJwsWithJwks(variant, { keys: [jwk] }).reason, 'malformed_jws', variant.slice(-12));
  }
});
