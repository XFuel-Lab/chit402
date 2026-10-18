/**
 * Gateway paths outside verifyJws apply the canonical compact JWS rule:
 * public attestation self-verify and the claim decoders behind shells, HTML
 * and OG meta. A JWS the verifier would refuse as malformed_jws shows no claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { verifyPublicAttestationJws, PUBLIC_RECEIPT_TYP, PUBLIC_RECEIPT_PREFIX } = await import('../src/public-attestation.js');
const { decodeJwsPayload } = await import('../src/receipt-shell.js');
const { decodeReceiptClaims, receiptSlotRefusal } = await import('../src/receipt.js');
const { buildReceiptOgMeta } = await import('../src/receipt-og-meta.js');
const { isCanonicalCompactEs256, MAX_COMPACT_JWS_LENGTH } = await import('../src/jws-canonical.js');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function signCompact(header, payloadText) {
  const input = `${b64(header)}.${b64(payloadText)}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function trailingBits(s) {
  const v = `${s.slice(0, -1)}${ALPHABET[ALPHABET.indexOf(s.at(-1)) | 1]}`;
  assert.notEqual(v, s);
  assert.deepEqual(Buffer.from(v, 'base64url'), Buffer.from(s, 'base64url'));
  return v;
}
function attacks(jws) {
  const [h, p, s] = jws.split('.');
  return {
    'signature trailing bits': `${h}.${p}.${trailingBits(s)}`,
    'signature with == padding': `${h}.${p}.${s}==`,
    'signature with a junk character': `${h}.${p}.${s.slice(0, 10)}*${s.slice(10)}`,
    'header with == padding': `${h}==.${p}.${s}`,
  };
}

test('verifyPublicAttestationJws refuses non-canonical spellings', () => {
  const jws = signCompact({ alg: 'ES256', typ: PUBLIC_RECEIPT_TYP, kid: 'k' }, `${PUBLIC_RECEIPT_PREFIX}{"task_id":"t"}`);
  assert.equal(verifyPublicAttestationJws(jws, jwk), true);
  for (const [name, v] of Object.entries(attacks(jws))) {
    assert.equal(verifyPublicAttestationJws(v, jwk), false, name);
  }
});

const receiptClaims = {
  task_id: 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  payment: { rail: 'usdc', gross_amount: '2000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payee: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334', ref: `base:0x${'cd'.repeat(32)}` },
};

test('display decoders show no claims from a non-canonical receipt JWS', () => {
  const jws = signCompact({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: 'k' }, JSON.stringify(receiptClaims));
  assert.deepEqual(decodeJwsPayload(jws), receiptClaims);
  assert.ok(decodeReceiptClaims({ issuer_signature: { jws } }));
  assert.equal(receiptSlotRefusal(jws), null);
  const bare = { task_id: receiptClaims.task_id };
  const noJws = buildReceiptOgMeta({ ...bare, issuer_signature: {} });
  assert.notDeepEqual(buildReceiptOgMeta({ ...bare, issuer_signature: { jws } }), noJws);
  for (const [name, v] of Object.entries(attacks(jws))) {
    assert.equal(decodeJwsPayload(v), null, name);
    assert.equal(decodeReceiptClaims({ issuer_signature: { jws: v } }), null, name);
    assert.equal(receiptSlotRefusal(v), 'malformed_jws', name);
    assert.deepEqual(buildReceiptOgMeta({ ...bare, issuer_signature: { jws: v } }), noJws, name);
  }
});

test('compact JWS over the length cap is refused', () => {
  const big = signCompact({ alg: 'ES256', typ: 'chit402-receipt+jwt' }, 'x'.repeat(60000));
  assert.ok(big.length > MAX_COMPACT_JWS_LENGTH);
  assert.equal(isCanonicalCompactEs256(big), false);
  assert.equal(decodeJwsPayload(big), null);
});
