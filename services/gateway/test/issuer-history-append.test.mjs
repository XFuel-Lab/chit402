/**
 * Sealed issuer-history entries are append-only. Old versions stay
 * fetchable. Unknown query parameters are rejected. Issuance stays at
 * payload version 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const {
  configureIssuerHistoryStore,
  currentIssuerHistory,
  issuerHistoryRecord,
  resetIssuerHistoryStore,
  writeIssuerHistory,
  sealExtendingIssuerHistory,
  retireOrRevokeIssuerKey,
  assertIssuerHistoryBoot,
  issuerHistoryNotes,
  currentHistoryPin,
  verifyIssuerHistory,
  issuerHistoryEntryHash,
  issuerKeyWindow,
  buildIssuerHistory,
} = await import('../src/issuer-history.js');
const { writeAnchorState } = await import('../src/receipt-log-store.js');
const {
  getIssuerPublicKeyJwk,
  getIssuerKid,
  computeJwkThumbprint,
  signJws,
  _resetIssuerKey,
} = await import('../src/issuer-key.js');
const { RECEIPT_PAYLOAD_VERSION, activeReceiptPayloadVersion } = await import('../src/receipt.js');

function freshKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const publicJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
    alg: 'ES256',
    use: 'sig',
  };
  publicJwk.kid = computeJwkThumbprint(publicJwk);
  return { privateKey, publicJwk };
}

function signWith(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(buf) { this.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf); return this; },
  };
}

function withHistory(fn) {
  const previousBefore = process.env.ISSUER_KEY_NOT_BEFORE;
  const previousExtra = process.env.ISSUER_HISTORY_EXTRA;
  process.env.ISSUER_KEY_NOT_BEFORE = '2020-01-01T00:00:00.000Z';
  delete process.env.ISSUER_HISTORY_EXTRA;
  resetIssuerHistoryStore();
  try {
    return fn();
  } finally {
    if (previousBefore == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
    else process.env.ISSUER_KEY_NOT_BEFORE = previousBefore;
    if (previousExtra == null) delete process.env.ISSUER_HISTORY_EXTRA;
    else process.env.ISSUER_HISTORY_EXTRA = previousExtra;
    resetIssuerHistoryStore();
  }
}

test('an extension seals the next version and version 1 bytes stay', () => withHistory(() => {
  const v1 = currentIssuerHistory();
  const newbie = freshKey();
  const v2 = sealExtendingIssuerHistory([{
    kid: newbie.publicJwk.kid,
    jwk: newbie.publicJwk,
    alg: 'ES256',
    not_before: '2021-06-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'appended test key',
  }]);
  assert.equal(v2.version, v1.version + 1);
  assert.notEqual(v2.body, v1.body);
  assert.equal(issuerHistoryRecord({ version: 1 }).body, v1.body);
  const served = mockRes();
  writeIssuerHistory(served, { version: '1' });
  assert.equal(served.statusCode, 200);
  assert.equal(served.body, v1.body);
  const parsed = JSON.parse(v2.body);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].entry_hash, JSON.parse(v1.body).entries[0].entry_hash);
  assert.equal(verifyIssuerHistory(parsed).valid, true);
}));

test('a new key that inherits the old window is refused', () => withHistory(() => {
  currentIssuerHistory();
  const newbie = freshKey();
  assert.throws(() => sealExtendingIssuerHistory([{
    kid: newbie.publicJwk.kid,
    jwk: newbie.publicJwk,
    alg: 'ES256',
    not_before: '2020-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    custody: 'copied window',
  }]), (err) => err.code === 'inherited_key_window');
  assert.equal(issuerHistoryRecord({ version: 1 }).version, 1);
}));

test('a history signed only by the key it introduces fails, and genesis does not', () => withHistory(() => {
  const genesis = buildIssuerHistory({ version: 1, seq: 1 });
  assert.equal(verifyIssuerHistory(genesis).valid, true);

  const v1 = currentIssuerHistory();
  const prefix = JSON.parse(v1.body).entries;
  const newbie = freshKey();
  const raw = {
    kid: newbie.publicJwk.kid,
    jwk: newbie.publicJwk,
    alg: 'ES256',
    not_before: '2022-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'introduced',
    prev_hash: prefix[prefix.length - 1].entry_hash,
  };
  const entry = { ...raw, entry_hash: issuerHistoryEntryHash(raw) };
  const entries = [...prefix, entry];
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: entry.entry_hash,
    version: 2,
    seq: 2,
  };
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 2,
    seq: 2,
    entries,
    head_hash: entry.entry_hash,
    issuer_signature: {
      alg: 'ES256',
      jws: signWith(newbie.privateKey, newbie.publicJwk.kid, claims),
      kid: newbie.publicJwk.kid,
      issuer_jwk: newbie.publicJwk,
    },
  };
  const rejected = verifyIssuerHistory(doc, { keys: [newbie.publicJwk, getIssuerPublicKeyJwk()] });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, 'introduced_key_signature');
  assert.equal(getIssuerKid(), getIssuerPublicKeyJwk().kid);
  assert.equal(typeof signJws, 'function');
}));

test('issuer-history rejects seq and unknown query parameters', () => withHistory(() => {
  const v1 = currentIssuerHistory();
  for (const query of [{ seq: '1' }, { foo: '1' }, { version: '1', seq: '1' }]) {
    const res = mockRes();
    writeIssuerHistory(res, query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.body.error, 'bad_query');
  }
  const ok = mockRes();
  writeIssuerHistory(ok, { version: '1' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, v1.body);
  const latest = mockRes();
  writeIssuerHistory(latest, {});
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.body, v1.body);
}));

test('issuance stays at payload version 10 and pins the document hash', () => withHistory(() => {
  const record = currentIssuerHistory();
  const issued = currentHistoryPin(10);
  assert.equal(typeof issued.hash, 'string');
  assert.equal(issued.version, record.version);
  assert.equal(issued.hash, record.hash);
  assert.equal(Object.hasOwn(issued, 'head_hash'), false);
  assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
  const previousRoot = process.env.ISSUER_ROOT_ENABLED;
  delete process.env.ISSUER_ROOT_ENABLED;
  try {
    assert.equal(activeReceiptPayloadVersion(), 10);
  } finally {
    if (previousRoot == null) delete process.env.ISSUER_ROOT_ENABLED;
    else process.env.ISSUER_ROOT_ENABLED = previousRoot;
  }
}));

function pemEnv(privateKey) {
  return Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
}

function swapProcessKey(privateKey) {
  const previousKey = process.env.ISSUER_PRIVATE_KEY;
  const previousKid = process.env.ISSUER_KID;
  process.env.ISSUER_PRIVATE_KEY = pemEnv(privateKey);
  delete process.env.ISSUER_KID;
  _resetIssuerKey();
  return () => {
    if (previousKey == null) delete process.env.ISSUER_PRIVATE_KEY;
    else process.env.ISSUER_PRIVATE_KEY = previousKey;
    if (previousKid == null) delete process.env.ISSUER_KID;
    else process.env.ISSUER_KID = previousKid;
    _resetIssuerKey();
  };
}

test('an in-memory log reseals when the process key changes', () => withHistory(() => {
  const previousFlag = process.env.ISSUER_HISTORY_TEST_ROTATION;
  process.env.ISSUER_HISTORY_TEST_ROTATION = 'true';
  const v1 = currentIssuerHistory();
  const kidA = JSON.parse(v1.body).entries.at(-1).kid;
  const next = freshKey();
  const restore = swapProcessKey(next.privateKey);
  try {
    const resealed = currentIssuerHistory();
    assert.equal(resealed.version, 1);
    const doc = JSON.parse(resealed.body);
    assert.equal(doc.entries.at(-1).kid, next.publicJwk.kid);
    assert.notEqual(doc.entries.at(-1).kid, kidA);
    assert.equal(issuerHistoryRecord({ version: 1 }).body, resealed.body);
    assert.equal(issuerHistoryRecord({ hash: v1.hash }), null);
  } finally {
    restore();
    if (previousFlag == null) delete process.env.ISSUER_HISTORY_TEST_ROTATION;
    else process.env.ISSUER_HISTORY_TEST_ROTATION = previousFlag;
  }
}));

test('a persisted log refuses a different process key and still serves version 1', () => withHistory(() => {
  const dir = mkdtempSync(join(tmpdir(), 'issuer-hist-'));
  const previousEnv = process.env.NODE_ENV;
  let restore = () => {};
  try {
    configureIssuerHistoryStore({ dir, persist: true });
    const v1 = currentIssuerHistory();
    const next = freshKey();
    restore = swapProcessKey(next.privateKey);
    process.env.NODE_ENV = 'production';
    process.env.ISSUER_KID = next.publicJwk.kid;
    _resetIssuerKey();
    assert.throws(() => currentIssuerHistory(), (err) => err.code === 'issuer_history_rewrite');
    assert.equal(issuerHistoryRecord({ version: 1 }).body, v1.body);
  } finally {
    if (previousEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    restore();
    configureIssuerHistoryStore({ dir: null, persist: false });
    rmSync(dir, { recursive: true, force: true });
  }
}));

test('a test process does not append a non-extending line when its key changes', () => withHistory(() => {
  const dir = mkdtempSync(join(tmpdir(), 'issuer-hist-'));
  const previousFlag = process.env.ISSUER_HISTORY_TEST_ROTATION;
  process.env.ISSUER_HISTORY_TEST_ROTATION = 'true';
  let restore = () => {};
  try {
    configureIssuerHistoryStore({ dir, persist: true });
    const v1 = currentIssuerHistory();
    const next = freshKey();
    restore = swapProcessKey(next.privateKey);
    const resealed = currentIssuerHistory();
    assert.equal(resealed.version, 1);
    assert.equal(JSON.parse(resealed.body).entries.at(-1).kid, next.publicJwk.kid);
    const lines = readFileSync(join(dir, 'issuer-history-versions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).body, v1.body);
  } finally {
    restore();
    if (previousFlag == null) delete process.env.ISSUER_HISTORY_TEST_ROTATION;
    else process.env.ISSUER_HISTORY_TEST_ROTATION = previousFlag;
    configureIssuerHistoryStore({ dir: null, persist: false });
    rmSync(dir, { recursive: true, force: true });
  }
}));

test('a retire or revoke appends and the last entry is the window', () => withHistory(() => {
  const kid = getIssuerKid();
  const retired = retireOrRevokeIssuerKey({
    status: 'retired',
    not_before: '2021-01-01T00:00:00.000Z',
    not_after: '2021-06-01T00:00:00.000Z',
    reason: 'rotated',
  });
  const retiredDoc = JSON.parse(retired.body);
  assert.equal(retiredDoc.entries.length, 2);
  assert.equal(retiredDoc.entries[1].status, 'retired');
  const afterEnd = issuerKeyWindow(retiredDoc, kid, '2021-07-01T00:00:00.000Z');
  assert.equal(afterEnd.ok, false);
  assert.equal(afterEnd.reason, 'issued_after_not_after');
  assert.throws(() => assertIssuerHistoryBoot(), (err) => err.code === 'issuer_key_not_active');

  resetIssuerHistoryStore();
  const revoked = retireOrRevokeIssuerKey({
    status: 'revoked',
    not_before: '2021-01-01T00:00:00.000Z',
    revoked_at: '2021-06-01T00:00:00.000Z',
    reason: 'compromised',
  });
  const revokedDoc = JSON.parse(revoked.body);
  const late = issuerKeyWindow(revokedDoc, kid, '2021-09-01T00:00:00.000Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow(revokedDoc, kid, '2021-01-01T00:00:00.000Z');
  assert.equal(early.ok, true, early.reason);
}));

test('truncating the history file cannot reissue a version', () => withHistory(() => {
  const dir = mkdtempSync(join(tmpdir(), 'issuer-hist-'));
  const logDir = mkdtempSync(join(tmpdir(), 'issuer-log-'));
  const previousLog = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_LOG_DIR = logDir;
  try {
    configureIssuerHistoryStore({ dir, persist: true });
    currentIssuerHistory();
    const newbie = freshKey();
    const v2 = sealExtendingIssuerHistory([{
      kid: newbie.publicJwk.kid,
      jwk: newbie.publicJwk,
      alg: 'ES256',
      not_before: '2021-06-01T00:00:00.000Z',
      status: 'active',
      custody: 'second key',
    }]);
    const file = join(dir, 'issuer-history-versions.jsonl');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, `${lines[0]}\n`);
    assert.throws(
      () => configureIssuerHistoryStore({ dir, persist: true }),
      (err) => err.code === 'issuer_history_truncated',
    );
    const anchor = JSON.parse(readFileSync(join(logDir, 'anchor-state.json'), 'utf8'));
    assert.equal(anchor.issuer_history.version, v2.version);
    assert.equal(anchor.issuer_history.head_hash, v2.head_hash);
    const side = JSON.parse(readFileSync(join(dir, 'issuer-history-high-water.json'), 'utf8'));
    assert.equal(side.version, v2.version);
    assert.equal(side.head_hash, v2.head_hash);
    writeAnchorState(logDir, { schema: 'chit402.receipt_anchor_state.v1', solana: { kept: true }, base: {} });
    const kept = JSON.parse(readFileSync(join(logDir, 'anchor-state.json'), 'utf8'));
    assert.equal(kept.issuer_history.version, v2.version);
    assert.equal(kept.issuer_history.head_hash, v2.head_hash);
    assert.equal(kept.solana.kept, true);
  } finally {
    if (previousLog == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = previousLog;
    configureIssuerHistoryStore({ dir: null, persist: false });
    rmSync(dir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
}));

test('the prod v1 to v2 rewrite is grandfathered and recorded', () => withHistory(() => {
  const dir = mkdtempSync(join(tmpdir(), 'issuer-hist-'));
  const from = '3d8259fb043f8ac80c924ea89d508f0a898f70bd0335658ef47370d5757e27a6';
  const to = '349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e';
  function line(version, head, entry) {
    const body = JSON.stringify({ entries: [{ kid: 'k', entry_hash: entry }], head_hash: head, version, seq: version });
    return JSON.stringify({ version, seq: version, hash: 'ab'.repeat(32), head_hash: head, fingerprint: entry, body });
  }
  writeFileSync(join(dir, 'issuer-history-versions.jsonl'), `${line(1, from, 'aa'.repeat(32))}\n${line(2, to, 'bb'.repeat(32))}\n`);
  try {
    configureIssuerHistoryStore({ dir, persist: true });
    const notes = issuerHistoryNotes();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'grandfathered_rewrite');
    assert.equal(notes[0].from_head, from);
    assert.equal(notes[0].to_head, to);
    assert.match(notes[0].note, /3d8259fb/);
    const stored = readFileSync(join(dir, 'issuer-history-notes.jsonl'), 'utf8');
    assert.match(stored, /grandfathered_rewrite/);
  } finally {
    configureIssuerHistoryStore({ dir: null, persist: false });
    rmSync(dir, { recursive: true, force: true });
  }
}));

test('the retire script is offline, two-person, and appends', () => withHistory(() => {
  const script = fileURLToPath(new URL('../scripts/retire-issuer-key.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'issuer-retire-'));
  const agents = join(dir, 'agents');
  const key = freshKey();
  const restore = swapProcessKey(key.privateKey);
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    TASK_STORE_PERSIST: 'true',
    TASK_STORE_DIR: join(dir, 'tasks'),
    AGENTS_DIR: agents,
    ISSUER_KEY_NOT_BEFORE: '2020-01-01T00:00:00.000Z',
    ISSUER_HISTORY_TEST_ROTATION: 'true',
  };
  delete baseEnv.ISSUER_HISTORY_EXTRA;
  delete baseEnv.ISSUER_KID;
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
  });
  try {
    const refused = run([
      '--status', 'revoked',
      '--not-before', '2021-01-01T00:00:00.000Z',
      '--revoked-at', '2021-06-01T00:00:00.000Z',
    ]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /ISSUER_HISTORY_OPERATOR/);

    const samePerson = run(
      ['--status', 'retired', '--not-before', '2021-01-01T00:00:00.000Z', '--confirm', 'YES'],
      { ISSUER_HISTORY_OPERATOR: 'alice', ISSUER_HISTORY_APPROVER: 'alice' },
    );
    assert.notEqual(samePerson.status, 0);

    const noConfirm = run(
      ['--status', 'retired', '--not-before', '2021-01-01T00:00:00.000Z'],
      { ISSUER_HISTORY_OPERATOR: 'alice', ISSUER_HISTORY_APPROVER: 'bob' },
    );
    assert.notEqual(noConfirm.status, 0);
    assert.match(noConfirm.stderr, /--confirm YES/);

    const retired = run([
      '--status', 'retired',
      '--not-before', '2021-01-01T00:00:00.000Z',
      '--not-after', '2021-06-01T00:00:00.000Z',
      '--reason', 'rotated',
      '--confirm', 'YES',
    ], { ISSUER_HISTORY_OPERATOR: 'alice', ISSUER_HISTORY_APPROVER: 'bob' });
    assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
    const printed = JSON.parse(retired.stdout);
    assert.equal(printed.status, 'retired');
    assert.equal(printed.entry_count, 2);
    assert.equal(printed.operator, 'alice');
    const lines = readFileSync(join(agents, 'issuer-history-versions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    configureIssuerHistoryStore({ dir: agents, persist: true });
    assert.throws(() => assertIssuerHistoryBoot(), (err) => err.code === 'issuer_key_not_active');
  } finally {
    restore();
    configureIssuerHistoryStore({ dir: null, persist: false });
    rmSync(dir, { recursive: true, force: true });
  }
}));
