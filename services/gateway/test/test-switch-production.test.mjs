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
  'quarantine-list.js': {
    reason: 'refusal only: the quarantine signing guard refuses a production NODE_ENV (passed env or process env) and separately requires a known test or ephemeral key, so NODE_ENV can never turn signing on',
    lines: [
      "if (nodeEnvIsProduction(env.NODE_ENV ?? null)) return { ok: false, reason: 'production_env' };",
      "if (nodeEnvIsProduction(process.env.NODE_ENV ?? null)) return { ok: false, reason: 'production_env' };",
    ],
  },
  'x402-discovery.js': {
    reason: 'a description string, not a check',
    lines: ["description: 'HTTPS treasury desk endpoint. localhost/http allowed only in NODE_ENV=test.',"],
  },
};
const SHARED_CHECK_FILES = ['test-switch.js', 'issuer-key.js', 'salt-store.js', 'x402-durable-store.js'];

/**
 * JavaScript source with comments removed: block comments anywhere (also
 * inside a line or across lines, keeping the newlines) and `//` comments to
 * the end of the line. String and template literals are kept as they are, and
 * a backslash outside a string skips the next character (regex escapes), so
 * `'https://x'` or `/\/\//` is not read as a comment. Only for the scan below.
 */
function stripJsComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const body = end === -1 ? text.slice(i) : text.slice(i, end + 2);
      out += body.replace(/[^\n]/g, '');
      i += body.length;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && !(c !== '`' && text[j] === '\n')) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '\\') {
      out += text.slice(i, i + 2);
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * N4 (643): lines the comment stripper may have misread. A code line (one that
 * does not start with a comment marker) that mentions NODE_ENV must come out of
 * the stripper unchanged. If the stripper removed part of it, a regex or
 * template literal may have hidden code from the scan, so the line is flagged.
 * This is the union of the old prefix filter and the stripper.
 */
function strippedDisagrees(text) {
  const raw = text.split('\n');
  const stripped = stripJsComments(text).split('\n');
  const out = [];
  raw.forEach((line, i) => {
    const t = line.trim();
    if (!/NODE_ENV|\bnodeEnv\b/.test(t) || /^(\/\/|\/\*|\*)/.test(t)) return;
    if ((stripped[i] || '').trim() !== t) out.push(t);
  });
  return out;
}

test('N4 (643): a NODE_ENV gate hidden behind a regex or template literal is flagged', () => {
  const gate = "if (process.env.NODE_ENV === 'production') return { ok: true };";
  const evasions = [
    `/[//]/; ${gate}`,
    `/[/*]/; ${gate} /[*/]/`,
    `/'/; '/*'; ${gate} '*/'`,
    `\`\${'\`'}\`; '/*'; ${gate} '*/'`,
  ];
  for (const line of evasions) {
    const src = ['const a = 1;', line, 'const z = 2;'].join('\n');
    const keptByStripper = stripJsComments(src).split('\n').some((l) => /NODE_ENV/.test(l) && l.includes(gate));
    assert.ok(keptByStripper || strippedDisagrees(src).length === 1, `flagged: ${line}`);
  }
  // A plain gate, a comment-only line and a comment after code are not flagged by this rule.
  assert.deepEqual(strippedDisagrees([gate, '// NODE_ENV only a comment', ' * NODE_ENV in a block'].join('\n')), []);
});

test('the NODE_ENV scan strips comments inside lines, not only lines that start with one', () => {
  const src = [
    "/* c */ if (process.env.NODE_ENV === 'production') return { ok: true };",
    '// if (process.env.NODE_ENV) only a comment',
    '/**',
    ' * NODE_ENV in a block comment body',
    ' */',
    "const a = 1; // NODE_ENV trailing comment",
    "const b = /* NODE_ENV */ 2; const u = 'https://x/NODE_ENV';",
    "const r = /\\/\\//; const n = process.env.NODE_ENV; /* tail",
    'NODE_ENV still in the open block comment */ const z = 3;',
  ].join('\n');
  const kept = stripJsComments(src).split('\n').map((l) => l.trim()).filter((l) => /NODE_ENV/.test(l));
  assert.deepEqual(kept, [
    "if (process.env.NODE_ENV === 'production') return { ok: true };",
    "const b =  2; const u = 'https://x/NODE_ENV';",
    'const r = /\\/\\//; const n = process.env.NODE_ENV;',
  ]);
});

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
    const lines = stripJsComments(fs.readFileSync(u, 'utf8')).split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => /NODE_ENV|\bnodeEnv\b/.test(l));
    if (lines.length) readers.set(rel, lines);
  }
  for (const [rel, lines] of readers) {
    assert.ok(NODE_ENV_ALLOWLIST[rel], `${rel} reads NODE_ENV without the shared check:\n${lines.join('\n')}`);
  }
  for (const u of files) {
    const rel = u.pathname.slice(root.pathname.length);
    const odd = strippedDisagrees(fs.readFileSync(u, 'utf8'));
    assert.ok(odd.length === 0, `${rel}: NODE_ENV on a code line the comment stripper changed; put the comment on its own line:\n${odd.join('\n')}`);
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
  // The two allowlisted quarantine-list.js refusals are the first two statements of quarantineSignGuard.
  const guardLines = stripJsComments(read('quarantine-list.js')).split('\n').map((l) => l.trim());
  const at = guardLines.findIndex((l) => l.startsWith('export function quarantineSignGuard('));
  assert.ok(at !== -1, 'quarantine-list.js defines quarantineSignGuard');
  // N3 (643): nothing may follow the opening brace on the signature line.
  assert.ok(/\)\s*\{$/.test(guardLines[at]), `quarantineSignGuard: no code on the signature line; got:\n${guardLines[at]}`);
  const firstTwo = guardLines.slice(at + 1).filter(Boolean).slice(0, 2);
  assert.ok(
    firstTwo.length === 2 && firstTwo.every((l, k) => l === NODE_ENV_ALLOWLIST['quarantine-list.js'].lines[k]),
    `quarantineSignGuard must open with the two NODE_ENV refusals; got:\n${firstTwo.join('\n')}`,
  );
  for (const f of SHARED_CHECK_FILES) assert.ok(/isProductionProcess\(/.test(read(f)), `${f} must call isProductionProcess`);
  // Raw comparisons of NODE_ENV to a literal appear only where listed.
  const raw = /(?:NODE_ENV|\bnodeEnv)\s*(?:===|!==|==|!=)\s*['"]|['"](?:test|development|production)['"]\s*(?:===|!==)\s*(?:\w+\.)*(?:NODE_ENV|nodeEnv)\b/;
  for (const [rel, lines] of readers) {
    const hits = lines.filter((l) => raw.test(l));
    if (!hits.length) continue;
    assert.ok(['test-switch.js', 'logger.js', 'production-process.js'].includes(rel), `${rel} compares NODE_ENV to a literal:\n${hits.join('\n')}`);
  }
});

test('server boot: the x402 challenge store plan is built from the real NODE_ENV, with no nodeEnv or env override', () => {
  const src = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const at = src.indexOf('challengeStorePlan({');
  assert.ok(at !== -1, 'server.js calls challengeStorePlan({...})');
  assert.equal(src.indexOf('challengeStorePlan({', at + 1), -1, 'exactly one boot call');
  // Only the call itself, never the whole file, goes into an assertion message.
  const call = src.slice(at, src.indexOf('})', at) + 2);
  assert.ok(call.length < 300, 'the call is short');
  assert.ok(
    /^challengeStorePlan\(\{\s*nodeEnv: process\.env\.NODE_ENV,\s*configured: config\.x402\.challengeStorePath,\s*\}\)$/.test(call),
    `server.js boot call must pass nodeEnv: process.env.NODE_ENV and nothing else that changes the plan; got:\n${call}`,
  );
});

test('payer binding worker: the one start line is gated on !testSwitchesOn(), and that gate is off under NODE_ENV=test with a production-like key (source line plus gate; createApp is not booted)', () => {
  const src = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  // Only the matching lines go into an assertion message, never the whole file.
  // N2 (643): optional chaining counts too.
  const startLines = src.split('\n').filter((l) => /payerBindingWorker\??\.start\(/.test(l)).map((l) => l.trim());
  assert.ok(startLines.length === 1, `server.js must start the payer binding worker exactly once; found:\n${startLines.join('\n')}`);
  assert.ok(
    startLines[0] === 'if (payerBindingWorker && !testSwitchesOn()) payerBindingWorker.start();',
    `server.js: the payer binding worker start must be gated on !testSwitchesOn(); got:\n${startLines[0]}`,
  );
  // The gate the start uses: off (so the worker starts) under NODE_ENV=test with a production-like key.
  for (const [label, arrange] of [
    ['an unlisted issuer key', () => setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: throwawayKeyEnv() })],
    ['the production kid', () => setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_KID: PRODUCTION_ISSUER_KID })],
    ['a signer reporting the production kid', () => { setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1' }); _setIssuerSignerForTest(prodKidStub()); }],
  ]) {
    arrange();
    assert.ok(testSwitchesOn() === false, `${label}: the worker must start`);
    _setIssuerSignerForTest(null);
  }
  // And a plain test process with a known test key keeps the worker off.
  setEnv({ NODE_ENV: 'test', ISSUER_TEST_KEY: '1', ISSUER_PRIVATE_KEY: testIssuerKey(4).env });
  assert.ok(testSwitchesOn() === true, 'a known test key under NODE_ENV=test: the worker stays off');
});
