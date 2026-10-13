/**
 * Sealed issuer-history entries are append-only. Old versions stay
 * fetchable. Unknown query parameters are rejected. Payload v12's pin
 * shape is available; issuance stays at payload version 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const {
  currentIssuerHistory,
  issuerHistoryRecord,
  resetIssuerHistoryStore,
  writeIssuerHistory,
  sealExtendingIssuerHistory,
  currentHistoryPin,
  verifyIssuerHistory,
  issuerHistoryEntryHash,
  buildIssuerHistory,
  HISTORY_HEAD_PAYLOAD_VERSION,
} = await import('../src/issuer-history.js');
const {
  getIssuerPublicKeyJwk,
  getIssuerKid,
  computeJwkThumbprint,
  signJws,
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

test('payload version 12 pins the chain head and issuance stays at 10', () => withHistory(() => {
  const record = currentIssuerHistory();
  const doc = JSON.parse(record.body);
  const head = currentHistoryPin(HISTORY_HEAD_PAYLOAD_VERSION);
  assert.equal(HISTORY_HEAD_PAYLOAD_VERSION, 12);
  assert.deepEqual(Object.keys(head).sort(), ['entry_count', 'head_hash']);
  assert.equal(head.head_hash, doc.head_hash);
  assert.equal(head.entry_count, doc.entries.length);
  const issued = currentHistoryPin(10);
  assert.equal(typeof issued.hash, 'string');
  assert.equal(issued.version, record.version);
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
