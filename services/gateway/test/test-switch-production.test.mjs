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
const { challengeStorePlan } = await import('../src/x402-durable-store.js');

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
  // assert.ok(re.test(src)), not assert.match: a failing match would carry the whole file in the error.
  assert.ok(/if \(publicAttestationWorker && !testSwitchesOn\(\)\) publicAttestationWorker\.start\(\);/.test(read('server.js')), 'server.js: the attestation worker start must use !testSwitchesOn()');
  assert.ok(/const production = isProductionProcess\(env\);/.test(read('receipt-policy.js')), 'receipt-policy.js must use isProductionProcess(env)');
  assert.ok(/const production = isProductionProcess\(env\);/.test(read('x402-facilitator.js')), 'x402-facilitator.js must use isProductionProcess(env)');
});

test('x402 challenge store: development or test with a production-like key requires the durable store (shared check)', () => {
  setEnv({ NODE_ENV: 'development' });
  for (const nodeEnv of ['development', 'test']) {
    assert.deepEqual(challengeStorePlan({ nodeEnv, configured: null, env: { NODE_ENV: nodeEnv } }), { required: false, storePath: null }, nodeEnv);
    assert.deepEqual(challengeStorePlan({ nodeEnv, configured: null, env: { NODE_ENV: nodeEnv, ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: testIssuerKey(3).env } }), { required: false, storePath: null }, `${nodeEnv}: a known test key`);
    for (const extra of [{ ISSUER_PRIVATE_KEY: throwawayKeyEnv() }, { ISSUER_KID: PRODUCTION_ISSUER_KID }, { ISSUER_SIGNER: 'kms' }, { ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: throwawayKeyEnv() }]) {
      const plan = challengeStorePlan({ nodeEnv, configured: null, env: { NODE_ENV: nodeEnv, ...extra } });
      assert.deepEqual(plan, { required: true, storePath: 'data/x402-challenges.json' }, `${nodeEnv} + ${Object.keys(extra).join(',')}`);
    }
  }
  // The boot call passes only nodeEnv: process.env is read.
  setEnv({ NODE_ENV: 'development', ISSUER_PRIVATE_KEY: throwawayKeyEnv() });
  assert.equal(challengeStorePlan({ nodeEnv: 'development', configured: null }).required, true, 'process.env with a live key');
  setEnv({ NODE_ENV: 'development' });
  _setIssuerSignerForTest(prodKidStub());
  assert.equal(challengeStorePlan({ nodeEnv: 'development', configured: null }).required, true, 'a signer reporting the production kid');
  _setIssuerSignerForTest(null);
  assert.equal(challengeStorePlan({ nodeEnv: 'development', configured: '/x/y.json' }).storePath, '/x/y.json');
});

/**
 * Every NODE_ENV read in services/gateway/src, line by line. Each code line
 * that mentions NODE_ENV (or a nodeEnv taken from it) must be listed here
 * exactly (trimmed), as many times as it appears in that file, with the
 * reason it is not a NODE_ENV-only production gate. Any new line, in any
 * form, fails this test until someone reviews it and lists it, including in
 * a file that already has listed lines.
 */
const NODE_ENV_ALLOWLIST = {
  'production-process.js': {
    reason: 'the shared production check itself',
    lines: [
      'export function nodeEnvIsProduction(nodeEnv) {',
      "const env = nodeEnv == null ? '' : String(nodeEnv).trim();",
      'export function isProductionProcess(env = process.env, { nodeEnv } = {}) {',
      'const node = nodeEnv === undefined ? e.NODE_ENV : nodeEnv;',
    ],
  },
  'test-switch.js': {
    reason: 'testSwitchesOn: NODE_ENV=test AND not isProductionProcess',
    lines: ["return env?.NODE_ENV === 'test' && !isProductionProcess(env);"],
  },
  'issuer-key.js': {
    reason: 'passes NODE_ENV into isProductionProcess',
    lines: [
      'export function isProductionIssuerEnv(nodeEnv = process.env.NODE_ENV) {',
      'return isProductionProcess(process.env, { nodeEnv });',
    ],
  },
  'salt-store.js': {
    reason: 'passes NODE_ENV into isProductionProcess',
    lines: [
      'export function isProductionEnv(nodeEnv = process.env.NODE_ENV) {',
      'return isProductionProcess(process.env, { nodeEnv });',
      'export function saltStoreAllowsV11Issuance({ nodeEnv, issuerRootEnabled, store, allowEphemeral } = {}) {',
      "if (!isProductionEnv(nodeEnv) || ephemeral) return { ok: true, reason: null };",
      'nodeEnv: env.NODE_ENV,',
    ],
  },
  'x402-durable-store.js': {
    reason: 'challengeStorePlan passes nodeEnv into isProductionProcess',
    lines: [
      'export function challengeStorePlan({ nodeEnv, configured, env = process.env } = {}) {',
      'const required = isProductionProcess(env, { nodeEnv: nodeEnv ?? null });',
    ],
  },
  'server.js': {
    reason: 'the boot call passes the real NODE_ENV to challengeStorePlan, which applies the shared check',
    lines: ['nodeEnv: process.env.NODE_ENV,'],
  },
  'config.js': {
    reason: 'exposes service.nodeEnv for the logger only; not a gate',
    lines: ["nodeEnv: process.env.NODE_ENV || 'development',"],
  },
  'logger.js': {
    reason: 'pino-pretty transport in development only; cosmetic, not a gate',
    lines: ["transport: config.service.nodeEnv === 'development' ? {"],
  },
  'x402-discovery.js': {
    reason: 'a description string, not a check',
    lines: ["description: 'HTTPS treasury desk endpoint. localhost/http allowed only in NODE_ENV=test.',"],
  },
};
const SHARED_CHECK_FILES = ['test-switch.js', 'issuer-key.js', 'salt-store.js', 'x402-durable-store.js'];

test('every NODE_ENV read in services/gateway/src uses the shared check or is allowlisted with a reason', () => {
  const root = new URL('../src/', import.meta.url);
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(ent.name + (ent.isDirectory() ? '/' : ''), dir);
      if (ent.isDirectory()) walk(u);
      else if (/\.(c|m)?js$/.test(ent.name)) files.push(u);
    }
  };
  walk(root);
  assert.ok(files.length > 50, 'scanned the whole src tree');
  const readers = new Map();
  for (const u of files) {
    const rel = u.pathname.slice(root.pathname.length);
    const lines = fs.readFileSync(u, 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => /NODE_ENV|\bnodeEnv\b/.test(l));
    if (lines.length) readers.set(rel, lines);
  }
  for (const [rel, lines] of readers) {
    assert.ok(NODE_ENV_ALLOWLIST[rel], `${rel} reads NODE_ENV without the shared check:\n${lines.join('\n')}`);
  }
  for (const rel of Object.keys(NODE_ENV_ALLOWLIST)) assert.ok(readers.has(rel), `${rel} is allowlisted but no longer reads NODE_ENV; drop it`);
  // Line level: the multiset of trimmed NODE_ENV lines per file must equal the listed one.
  for (const [rel, lines] of readers) {
    const allowed = [...NODE_ENV_ALLOWLIST[rel].lines];
    const extra = [];
    for (const raw of lines) {
      const at = allowed.indexOf(raw.trim());
      if (at === -1) extra.push(raw.trim());
      else allowed.splice(at, 1);
    }
    assert.ok(extra.length === 0, `${rel}: NODE_ENV line(s) not on the allowlist (use the shared check, or review and list them):\n${extra.join('\n')}`);
    assert.ok(allowed.length === 0, `${rel}: allowlisted NODE_ENV line(s) no longer present; drop them:\n${allowed.join('\n')}`);
  }
  const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
  for (const f of SHARED_CHECK_FILES) assert.ok(/isProductionProcess\(/.test(read(f)), `${f} must call isProductionProcess`);
  // Raw comparisons of NODE_ENV to a literal appear only where listed.
  const raw = /(?:NODE_ENV|\bnodeEnv)\s*(?:===|!==|==|!=)\s*['"]|['"](?:test|development|production)['"]\s*(?:===|!==)\s*(?:\w+\.)*(?:NODE_ENV|nodeEnv)\b/;
  for (const [rel, lines] of readers) {
    const hits = lines.filter((l) => raw.test(l));
    if (!hits.length) continue;
    assert.ok(['test-switch.js', 'logger.js', 'production-process.js'].includes(rel), `${rel} compares NODE_ENV to a literal:\n${hits.join('\n')}`);
  }
});
