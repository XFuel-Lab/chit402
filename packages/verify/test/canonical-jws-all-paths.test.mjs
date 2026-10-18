/**
 * Every place that reads a compact JWS or raw ES256 signature applies the
 * canonical rule: public attestation, the legacy detached signature, the pin
 * self-signature, and the claim decoders used for display.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

const { jwkThumbprint, isCanonicalCompactEs256, MAX_COMPACT_JWS_LENGTH } = await import('../dist/jws.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { parsePublicAttestation } = await import('../dist/public-attestation.js');
const { decodeJwsPayload: payerDecode } = await import('../dist/payer.js');
const { decodeJwsPayload: shellDecode } = await import('../dist/shell.js');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ej = publicKey.export({ format: 'jwk' });
const kid = jwkThumbprint(ej);

function signCompact(header, payloadText) {
  const input = `${b64(header)}.${b64(payloadText)}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

/** A 64-byte signature is 86 chars, so the last char has 2 unused bits. */
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

const claims = {
  attested_at: '2026-10-17T18:30:00.000Z',
  iss: 'chit402',
  issued_at: '2026-10-17T18:29:00.000Z',
  log: { epoch: 1, leaf_hash: 'ab'.repeat(32), leaf_index: 1 },
  payment: {
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', gross_amount: '2000',
    payee: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334', rail: 'usdc',
    ref: `base:0x${'cd'.repeat(32)}`, settled_amount: '2000',
  },
  task_id: 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
};

test('public attestation: canonical parses, non-canonical spellings are invalid_jws', () => {
  const jws = signCompact({ alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid }, `chit402.public_receipt.v1\n${jcsCanonicalize(claims)}`);
  const ok = parsePublicAttestation(jws);
  assert.equal(ok.ok, true, ok.reason);
  for (const [name, v] of Object.entries(attacks(jws))) {
    const r = parsePublicAttestation(v);
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'invalid_jws', name);
  }
});

test('display decoders return no claims for a non-canonical JWS', () => {
  const jws = signCompact({ alg: 'ES256', typ: 'chit402-receipt+jwt' }, JSON.stringify({ task_id: 't', n: 1 }));
  assert.deepEqual(payerDecode(jws), { task_id: 't', n: 1 });
  assert.deepEqual(shellDecode(jws), { task_id: 't', n: 1 });
  for (const [name, v] of Object.entries(attacks(jws))) {
    assert.equal(payerDecode(v), null, name);
    assert.equal(shellDecode(v), null, name);
  }
});

test('compact JWS longer than the cap is refused before decoding', () => {
  assert.equal(MAX_COMPACT_JWS_LENGTH, 65536);
  const big = signCompact({ alg: 'ES256', typ: 'chit402-receipt+jwt' }, 'x'.repeat(60000));
  assert.ok(big.length > MAX_COMPACT_JWS_LENGTH);
  assert.equal(isCanonicalCompactEs256(big), false);
  assert.equal(payerDecode(big), null);
});

const lib = await import('../dist/index.js');
const { verifyRegistrationSignature, registrationPreimage } = await import('../dist/issuer-pin.js');
const jwk = { kty: 'EC', crv: 'P-256', x: ej.x, y: ej.y };
const rawSig = (msg) => sign('sha256', Buffer.from(msg, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
function sigAttacks(s) {
  return {
    'trailing bits': trailingBits(s),
    '== padding': `${s}==`,
    'junk character': `${s.slice(0, 10)}*${s.slice(10)}`,
  };
}

test('legacy detached issuer_signature.value must be canonical', () => {
  const receipt = { task_id: 'xfuel-legacy-1', amount: '1', issuer_signature: { alg: 'ES256', kid, value: '' } };
  receipt.issuer_signature.value = rawSig(lib.canonicalIssuerPayload(receipt));
  assert.equal(lib.verifyIssuerSignature(receipt, jwk).valid, true);
  for (const [name, v] of Object.entries(sigAttacks(receipt.issuer_signature.value))) {
    const r = lib.verifyIssuerSignature({ ...receipt, issuer_signature: { ...receipt.issuer_signature, value: v } }, jwk);
    assert.equal(r.valid, false, name);
    assert.equal(r.reason, 'malformed_signature', name);
  }
});

test('pin self_signature must be canonical', () => {
  const pinJwk = { ...jwk, kid };
  const createdAt = '2026-10-01T00:00:00.000Z';
  const self = rawSig(registrationPreimage({ kid, createdAt, jwk: pinJwk }));
  const pin = { jwk: pinJwk, created_at: createdAt, self_signature: self };
  assert.equal(verifyRegistrationSignature(pin).ok, true);
  for (const [name, v] of Object.entries(sigAttacks(self))) {
    assert.equal(verifyRegistrationSignature({ ...pin, self_signature: v }).ok, false, name);
  }
});
