/**
 * Test-only switches stay off in a process that loaded a production or
 * unlisted issuer key, even under NODE_ENV=test, and the remaining
 * NODE_ENV-only production checks use the shared check.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { testIssuerKey } from './helpers/test-issuer-keys.mjs';

const { testSwitchesOn } = await import('../src/test-switch.js');
const { PRODUCTION_ISSUER_KID } = await import('../src/production-process.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const { resolveIssuanceCapPath } = await import('../src/issuance-cap.js');
const { validateWebhookUrl } = await import('../src/book-webhook.js');
const { _allowSettlementProofForTests, settlementProofEnabled } = await import('../src/settlement-proof-flag.js');
const { readReceiptPolicyConfig } = await import('../src/receipt-policy.js');
const { assertFacilitatorUrl } = await import('../src/x402-facilitator.js');

const KEYS = ['ISSUER_PRIVATE_KEY', 'ISSUER_KID', 'ISSUER_SIGNER', 'ISSUER_KMS_KEY_ID', 'ISSUER_TEST_KEY', 'NODE_ENV', 'ISSUER_CAP_DB'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(vars) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

afterEach(() => {
  _setIssuerSignerForTest(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setEnvKeep({ NODE_ENV: 'test' }, () => _allowSettlementProofForTests(false));
});

/** Run fn under vars, then put the saved env back. */
function setEnvKeep(vars, fn) {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  setEnv(vars);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function throwawayKeyEnv() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
}

/** Holds no key and never signs: it only reports the production kid. */
function prodKidStub() {
  return { kind: 'env', kid: PRODUCTION_ISSUER_KID, publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, async sign() { throw new Error('stub'); } };
}

/** Each production-like loadout, all under NODE_ENV=test. */
const PROD_LIKE = [
  ['an unlisted issuer key', () => setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: throwawayKeyEnv() })],
  ['a test key without the opt-out', () => setEnv({ NODE_ENV: 'test', ISSUER_PRIVATE_KEY: testIssuerKey(3).env })],
  ['a signer reporting the production kid', () => { setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1' }); _setIssuerSignerForTest(prodKidStub()); }],
  ['ISSUER_KID set to the production kid', () => setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_KID: PRODUCTION_ISSUER_KID })],
  ['ISSUER_SIGNER=kms', () => setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_SIGNER: 'kms', ISSUER_KMS_KEY_ID: 'alias/x' })],
];

test('test switches: on under NODE_ENV=test with no key or a known test key; off for every production-like loadout', () => {
  setEnv({ NODE_ENV: 'test' });
  assert.equal(testSwitchesOn(), true);
  setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: testIssuerKey(3).env });
  assert.equal(testSwitchesOn(), true);
  for (const nodeEnv of ['development', 'production', 'Test', ' test', undefined]) {
    setEnv(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv });
    assert.equal(testSwitchesOn(), false, String(nodeEnv));
  }
  for (const [label, load] of PROD_LIKE) {
    load();
    assert.equal(testSwitchesOn(), false, label);
    _setIssuerSignerForTest(null);
  }
});

test('issuance cap: the in-memory store is test-only and off once a production-like key is loaded', () => {
  setEnv({ NODE_ENV: 'test' });
  assert.equal(resolveIssuanceCapPath(process.env), ':memory:');
  for (const [label, load] of PROD_LIKE) {
    load();
    assert.notEqual(resolveIssuanceCapPath(process.env), ':memory:', label);
    _setIssuerSignerForTest(null);
  }
});

test('book webhook: http localhost is test-only and refused once a production-like key is loaded', () => {
  setEnv({ NODE_ENV: 'test' });
  assert.doesNotThrow(() => validateWebhookUrl('http://127.0.0.1:9/hook'));
  for (const [label, load] of PROD_LIKE) {
    load();
    assert.throws(() => validateWebhookUrl('http://127.0.0.1:9/hook'), /https/, label);
    _setIssuerSignerForTest(null);
  }
});

test('settlement proof: the test override cannot be set, and does not apply, once a production-like key is loaded', () => {
  setEnv({ NODE_ENV: 'test' });
  _allowSettlementProofForTests(true);
  assert.equal(settlementProofEnabled({ SETTLEMENT_PROOF_ENABLED: 'true' }), true);
  for (const [label, load] of PROD_LIKE) {
    load();
    assert.equal(settlementProofEnabled({ SETTLEMENT_PROOF_ENABLED: 'true' }), false, `${label}: an override set earlier no longer applies`);
    assert.throws(() => _allowSettlementProofForTests(true), /test-only/, label);
    _setIssuerSignerForTest(null);
  }
  setEnv({ NODE_ENV: 'test' });
});

test('receipt policy and facilitator URL: production is the shared check (unset NODE_ENV, or a production-like key)', () => {
  setEnv({ NODE_ENV: 'development' });
  assert.equal(readReceiptPolicyConfig({ NODE_ENV: 'development' }).source, 'default');
  assert.doesNotThrow(() => assertFacilitatorUrl('http://127.0.0.1:9/', { NODE_ENV: 'development' }));
  for (const env of [{}, { NODE_ENV: 'Production' }, { NODE_ENV: 'development', ISSUER_PRIVATE_KEY: throwawayKeyEnv() }, { NODE_ENV: 'development', ISSUER_KID: PRODUCTION_ISSUER_KID }]) {
    const label = JSON.stringify(Object.keys(env));
    assert.equal(readReceiptPolicyConfig(env).source, 'env', label);
    assert.throws(() => assertFacilitatorUrl('http://127.0.0.1:9/', env), (err) => err.code === 'facilitator_http_rejected', label);
  }
  _setIssuerSignerForTest(prodKidStub());
  assert.equal(readReceiptPolicyConfig({ NODE_ENV: 'development' }).source, 'env', 'a signer reporting the production kid');
});

test('late issue and server: no NODE_ENV-only test switch is left; each site uses testSwitchesOn', () => {
  const read = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  for (const f of ['late-issue.js', 'issuance-cap.js', 'settlement-proof-flag.js', 'book-webhook.js']) {
    const src = read(f);
    assert.equal(/NODE_ENV\s*(?:===|!==)\s*'test'/.test(src), false, f);
    assert.equal(/String\(env\.NODE_ENV \|\| ''\) === 'test'/.test(src), false, f);
  }
  assert.equal((read('late-issue.js').match(/testSwitchesOn\(\)/g) || []).length, 6);
  assert.match(read('server.js'), /if \(publicAttestationWorker && !testSwitchesOn\(\)\) publicAttestationWorker\.start\(\);/);
  assert.match(read('receipt-policy.js'), /const production = isProductionProcess\(env\);/);
  assert.match(read('x402-facilitator.js'), /const production = isProductionProcess\(env\);/);
});
