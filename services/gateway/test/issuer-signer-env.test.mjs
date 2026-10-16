/**
 * Env signer stays the default. Header, payload, and JWKS match the
 * pre-change encoding for a fixed P-256 key. NODE_ENV=test. No network.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const PEM_B64 = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ3Y5M0Z0aERHUi9aWXJtNXcKMG9VTTU1NFFQd0Uzd0lhbTZyeXk0V3ZMeDMyaFJBTkNBQVNMTmRhWWtCb0NjWFlYNm9ObWdnalNQTVVlTkZLVgpQSVB4MlRmNlQrZzdKQlZ1SmdJRStsaW5yQ1JDVDFXVnliZnpJL20vbk9MaC80NFZlZnZ4d0duSAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
const GOLDEN_INPUT = 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImNoaXQ0MDItcmVjZWlwdCtqd3QiLCJraWQiOiJTbnRtZVdlaUpuQVFhTEZuRWFrV2NTZERXT2JJbVpfMjZ6UVdVNkJpcjBFIn0.eyJ0YXNrX2lkIjoiZ29sZGVuLWZpeGVkIiwiaXNzIjoiY2hpdDQwMiIsIm4iOjF9';
const GOLDEN_JWKS = '{"keys":[{"kty":"EC","crv":"P-256","x":"izXWmJAaAnF2F-qDZoII0jzFHjRSlTyD8dk3-k_oOyQ","y":"FW4mAgT6WKesJEJPVZXJt_Mj-b-c4uH_jhV5-_HAacc","kid":"SntmeWeiJnAQaLFnEakWcSdDWObImZ_26zQWU6Bir0E","alg":"ES256","use":"sig"}]}';
const PAYLOAD = { task_id: 'golden-fixed', iss: 'chit402', n: 1 };

const saved = {
  ISSUER_PRIVATE_KEY: process.env.ISSUER_PRIVATE_KEY,
  ISSUER_KID: process.env.ISSUER_KID,
  ISSUER_SIGNER: process.env.ISSUER_SIGNER,
  ISSUER_SIGNER_LOW_S: process.env.ISSUER_SIGNER_LOW_S,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

after(() => {
  restoreEnv();
});

const { signJws, signJwsAsync, getJwks, getIssuerKid, _resetIssuerKey } = await import('../src/issuer-key.js');
const { initIssuerSigner, _setIssuerSignerForTest } = await import('../src/issuer-signer.js');

function useFixedKey() {
  process.env.NODE_ENV = 'test';
  process.env.ISSUER_PRIVATE_KEY = PEM_B64;
  delete process.env.ISSUER_KID;
  delete process.env.ISSUER_SIGNER;
  delete process.env.ISSUER_SIGNER_LOW_S;
  _resetIssuerKey();
  _setIssuerSignerForTest(null);
}

function signingInput(jws) {
  return jws.split('.').slice(0, 2).join('.');
}

test('unset ISSUER_SIGNER keeps the golden signing input and JWKS', async () => {
  useFixedKey();
  const sync = signJws(PAYLOAD);
  const asyncSig = await signJwsAsync(PAYLOAD);
  assert.equal(signingInput(sync.jws), GOLDEN_INPUT);
  assert.equal(signingInput(asyncSig.jws), GOLDEN_INPUT);
  assert.equal(sync.kid, 'SntmeWeiJnAQaLFnEakWcSdDWObImZ_26zQWU6Bir0E');
  assert.equal(asyncSig.kid, sync.kid);
  assert.equal(getIssuerKid(), sync.kid);
  assert.equal(JSON.stringify(getJwks()), GOLDEN_JWKS);
  const jwk = getJwks().keys[0];
  for (const jws of [sync.jws, asyncSig.jws]) {
    const [h, p, s] = jws.split('.');
    const ok = crypto.verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    assert.equal(ok, true);
  }
});

test('a stubbed crypto.sign makes sync and async JWS byte-identical', async () => {
  useFixedKey();
  const fixed = Buffer.alloc(64, 3);
  fixed[63] = 1;
  const orig = crypto.sign;
  crypto.sign = () => Buffer.from(fixed);
  try {
    _resetIssuerKey();
    const sync = signJws(PAYLOAD);
    _resetIssuerKey();
    const asyncSig = await signJwsAsync(PAYLOAD);
    const golden = `${GOLDEN_INPUT}.${fixed.toString('base64url')}`;
    assert.equal(sync.jws, golden);
    assert.equal(asyncSig.jws, golden);
  } finally {
    crypto.sign = orig;
    _resetIssuerKey();
  }
});

test('ISSUER_SIGNER=env matches the unset path', async () => {
  useFixedKey();
  process.env.ISSUER_SIGNER = 'env';
  _resetIssuerKey();
  const signer = await initIssuerSigner();
  assert.equal(signer.kind, 'env');
  assert.equal(signingInput((await signJwsAsync(PAYLOAD)).jws), GOLDEN_INPUT);
  assert.equal(JSON.stringify(getJwks()), GOLDEN_JWKS);
});

test('an unknown ISSUER_SIGNER refuses to boot', async () => {
  useFixedKey();
  process.env.ISSUER_SIGNER = 'hsm';
  _resetIssuerKey();
  await assert.rejects(async () => await initIssuerSigner(), (err) => err.code === 'issuer_signer_unknown');
});

test('low-S stays off unless ISSUER_SIGNER_LOW_S=true', async () => {
  useFixedKey();
  const high = Buffer.alloc(64, 0);
  high[31] = 2;
  const order = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  const highS = (order - 5n).toString(16).padStart(64, '0');
  Buffer.from(highS, 'hex').copy(high, 32);
  const orig = crypto.sign;
  crypto.sign = () => Buffer.from(high);
  try {
    _resetIssuerKey();
    const plain = signJws(PAYLOAD);
    assert.equal(plain.jws.split('.')[2], high.toString('base64url'));
    process.env.ISSUER_SIGNER_LOW_S = 'true';
    _resetIssuerKey();
    const lowered = await signJwsAsync(PAYLOAD);
    const sig = Buffer.from(lowered.jws.split('.')[2], 'base64url');
    const s = BigInt(`0x${sig.subarray(32).toString('hex')}`);
    assert.equal(s, 5n);
  } finally {
    crypto.sign = orig;
    delete process.env.ISSUER_SIGNER_LOW_S;
    _resetIssuerKey();
  }
});
