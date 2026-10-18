/**
 * A receipt that pins an earlier sealed issuer-history snapshot (v1) checks
 * against the current body (v2) only when that exact snapshot ships in the
 * package, verifies under the issuer key, and is extended by the current body.
 * Anything else keeps issuer_history_pin_mismatch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { jcsCanonicalize } = await import('../dist/jcs.js');
const {
  checkReceiptIssuerHistory,
  sealedSnapshotForPin,
  sealedSuccessorExtends,
  laterThanBundled,
  historyPrefixExtends,
  issuerHistoryEntryHash,
} = await import('../dist/issuer-history.js');
const { verifyReceipt } = await import('../dist/index.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const v1Bytes = read('./fixtures/issuer-history-v1-bundle.json');
const v2Bytes = read('../issuer-history.snapshot.json');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const V1_PIN = Object.freeze({ hash: sha256(v1Bytes), version: 1, seq: 1 });
const receiptRef = { verify_url: 'https://api.chit402.com/receipt/example' };
const ISSUED = '2026-10-08T05:32:21Z';

function check(opts) {
  return checkReceiptIssuerHistory(receiptRef, {
    document: JSON.parse(v2Bytes),
    documentBytes: v2Bytes,
    kid: PRODUCTION_KID,
    issuedAt: ISSUED,
    pin: V1_PIN,
    requirePin: true,
    ...opts,
  });
}

test('the shipped v1 snapshot is byte-identical to the v1 fixture', () => {
  assert.equal(read('../issuer-history.v1.snapshot.json'), v1Bytes);
  assert.equal(V1_PIN.hash, 'e20d606904df1fe71ab96d8f71100d50ce1a3686fa099b3af3d92b8d8b79f1e8');
});

test('a v1 pin checks against the current v2 body', async () => {
  const got = await check({});
  assert.equal(got.ok, true, got.reason);
  assert.equal(got.checked, true);
  assert.equal(got.document?.version, 2);
  assert.ok(sealedSnapshotForPin(V1_PIN, JSON.parse(v2Bytes)));
});

test('the exact v1 body still checks as before', async () => {
  const got = await check({ document: JSON.parse(v1Bytes), documentBytes: v1Bytes });
  assert.equal(got.ok, true, got.reason);
});

test('a pin that is not a shipped snapshot stays a mismatch', async () => {
  const flipped = V1_PIN.hash.slice(0, -1) + (V1_PIN.hash.endsWith('0') ? '1' : '0');
  for (const pin of [
    { ...V1_PIN, hash: flipped },
    { ...V1_PIN, version: 2 },
    { ...V1_PIN, seq: 2 },
    { hash: 'ab'.repeat(32), version: 1, seq: 1 },
  ]) {
    const got = await check({ pin });
    assert.equal(got.ok, false, JSON.stringify(pin));
    assert.match(got.reason, /^issuer_history_(pin|version|seq)_mismatch$/);
    assert.equal(got.document, null);
  }
});

test('an edited copy of v1 is not a later version', async () => {
  const edited = JSON.parse(v1Bytes);
  edited.not_before_note = `${edited.not_before_note} edited`;
  const got = await check({ document: edited, documentBytes: JSON.stringify(edited) });
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'issuer_history_pin_mismatch');
  const relabeled = JSON.parse(v2Bytes);
  relabeled.version = 1;
  relabeled.seq = 1;
  assert.equal(sealedSnapshotForPin(V1_PIN, relabeled), null);
});

test('the key window applies on the sealed path', async () => {
  const early = await check({ issuedAt: '2026-09-01T00:00:00Z' });
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'issued_before_not_before');
  const missing = await check({ issuedAt: null });
  assert.equal(missing.ok, false);
});

test('a current body that does not verify or extend v1 is refused', async () => {
  const bad = JSON.parse(v2Bytes);
  bad.entries[0].not_before = '2026-09-01T00:00:00Z';
  const badBytes = JSON.stringify(bad);
  const got = await check({ document: bad, documentBytes: badBytes });
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'issuer_history_pin_mismatch');
  assert.equal(sealedSnapshotForPin(V1_PIN, bad), null);
});

function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const e = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: e.crv, kty: e.kty, x: e.x, y: e.y })).digest('base64url');
  return { privateKey, kid, publicJwk: { kty: 'EC', crv: 'P-256', x: e.x, y: e.y, kid, alg: 'ES256', use: 'sig' } };
}
function signJws(claims, key, typ) {
  const input = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ, kid: key.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

test('another key cannot use the sealed path', async () => {
  const key = testKey();
  const body = {
    kid: key.kid, jwk: key.publicJwk, alg: 'ES256', not_before: '2026-09-04T08:52:05Z', not_after: null,
    status: 'active', revoked_at: null, reason: null, custody: 'test', prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = { schema: 'chit402.issuer_history.v1', payload_version: 1, entry_count: 1, head_hash: entry.entry_hash, version: 1, seq: 1 };
  const doc = JSON.parse(jcsCanonicalize({
    schema: 'chit402.issuer_history.v1', payload_version: 1, version: 1, seq: 1, entries: [entry], head_hash: entry.entry_hash,
    issuer_signature: { alg: 'ES256', typ: 'chit402-issuer-history+jwt', payload_version: 1, jws: signJws(claims, key, 'chit402-issuer-history+jwt'), kid: key.kid, issuer_jwk: key.publicJwk },
  }));
  const own = { trustedKids: [key.kid], jwks: { keys: [key.publicJwk] } };
  // The shipped v1 snapshot does not verify under this key, so a test-key
  // history cannot stand in for it.
  assert.equal(sealedSnapshotForPin(V1_PIN, doc, own), null);
  const got = await check({ document: doc, documentBytes: JSON.stringify(doc), kid: key.kid, ...own });
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'issuer_history_pin_mismatch');

  // A receipt signed by that key and pinning v1 is not verified.
  const receipt = {
    task_id: 'task-sealed-pin',
    payment: { rail: 'usdc', ref: `base:0x${'ab'.repeat(32)}`, gross_amount: '2000', settled_amount: '2000', payee: `0x${'22'.repeat(20)}` },
    issuer_signature: {
      alg: 'ES256', payload_version: 10, kid: key.kid,
      jws: signJws({
        task_id: 'task-sealed-pin', iss: 'chit402', iat: Math.floor(Date.parse(ISSUED) / 1000), payload_version: 10,
        payment: { rail: 'usdc', ref: `base:0x${'ab'.repeat(32)}`, gross_amount: '2000', settled_amount: '2000', payee: `0x${'22'.repeat(20)}` },
        issuer_history: V1_PIN,
      }, key, 'chit402-receipt+jwt'),
    },
  };
  const res = await verifyReceipt(receipt, { ...own, issuerHistory: JSON.parse(v2Bytes), issuerHistoryBytes: v2Bytes, fetchImpl: async () => new Response('nf', { status: 404 }) });
  assert.notEqual(res.overall, 'verified');
});

// A synthetic next release signed by a caller-trusted test key stands in for
// an issuer-published history. The production entries are copied unchanged.
function successor(baseBytes, key, version, seq) {
  const base = JSON.parse(baseBytes);
  const prev = base.entries[base.entries.length - 1].entry_hash;
  const body = {
    kid: key.kid, jwk: key.publicJwk, alg: 'ES256', not_before: '2026-10-16T00:00:00Z', not_after: null,
    status: 'active', revoked_at: null, reason: null, prev_hash: prev,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const entries = [...base.entries, entry];
  const claims = { schema: 'chit402.issuer_history.v1', payload_version: 1, entry_count: entries.length, head_hash: entry.entry_hash, version, seq };
  const doc = JSON.parse(jcsCanonicalize({
    ...base, version, seq, entries, head_hash: entry.entry_hash,
    issuer_signature: { alg: 'ES256', typ: 'chit402-issuer-history+jwt', payload_version: 1, jws: signJws(claims, key, 'chit402-issuer-history+jwt'), kid: key.kid, issuer_jwk: key.publicJwk },
  }));
  return { doc, bytes: JSON.stringify(doc) };
}

function trustWith(key) {
  const prod = JSON.parse(v2Bytes).entries[0].jwk;
  return { trustedKids: [PRODUCTION_KID, key.kid], jwks: { keys: [prod, key.publicJwk] } };
}

// The history signer must be the genesis key, which a test does not hold,
// so the full path cannot take a synthetic v3. The continuation rule is
// tested directly, and the signed path is tested for the refusals.
test('a v3 that appends one entry to v2 continues the v1 snapshot', () => {
  const key = testKey();
  const v1 = JSON.parse(v1Bytes);
  const { doc } = successor(v2Bytes, key, 3, 3);
  assert.equal(sealedSuccessorExtends(v1, doc), true);
  assert.equal(sealedSuccessorExtends(v1, JSON.parse(v2Bytes)), true);
  // Before this rule, the plain prefix check refused it.
  assert.equal(historyPrefixExtends(v1, doc), false);
});

test('a v3 that extends v1 but forks from v2 does not continue v1', async () => {
  const key = testKey();
  const v1 = JSON.parse(v1Bytes);
  const { doc, bytes } = successor(v1Bytes, key, 3, 3);
  assert.equal(historyPrefixExtends(v1, doc), true);
  assert.equal(sealedSuccessorExtends(v1, doc), false);
  const trust = trustWith(key);
  assert.equal(sealedSnapshotForPin(V1_PIN, doc, trust), null);
  const got = await check({ document: doc, documentBytes: bytes, ...trust });
  assert.equal(got.ok, false);
  assert.equal(got.reason, 'issuer_history_pin_mismatch');
});

test('a v3 that rewrites a v2 entry does not continue v1', () => {
  const key = testKey();
  const { doc } = successor(v2Bytes, key, 3, 3);
  doc.entries[0] = { ...doc.entries[0], entry_hash: 'ab'.repeat(32) };
  assert.equal(sealedSuccessorExtends(JSON.parse(v1Bytes), doc), false);
  const short = JSON.parse(v2Bytes);
  short.head_hash = 'cd'.repeat(32);
  short.entries = [];
  assert.equal(sealedSuccessorExtends(JSON.parse(v1Bytes), short), false);
});

test('the CLI history resolver refuses a v1 fork', async () => {
  const { resolveIssuerHistory } = await import('../dist/issuer-history.js');
  const key = testKey();
  const fork = successor(v1Bytes, key, 3, 3);
  const forked = await resolveIssuerHistory({ fileBytes: fork.bytes, ...trustWith(key), fetchImpl: async () => { throw new Error('no network'); } });
  assert.equal(forked.invalid, true);
  // The resolver's extension rule, which also applies to a fork the issuer
  // key did sign: it does not extend the bundled v2.
  assert.equal(historyPrefixExtends(JSON.parse(v2Bytes), fork.doc), false);
});

test('the CLI does not verify against a v1 fork history file', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'v1-fork-'));
  const forkPath = join(dir, 'history.json');
  writeFileSync(forkPath, successor(v1Bytes, testKey(), 3, 3).bytes);
  const receiptPath = fileURLToPath(new URL('./fixtures/chit-5d775d12.v7.json', import.meta.url));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = spawnSync(process.execPath, [cli, receiptPath, '--issuer-history', forkPath, '--json'], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, CHIT402_OFFLINE: '1' },
  });
  assert.notEqual(run.status, 0, run.stdout);
  assert.equal(JSON.parse(run.stdout).result, "invalid");
});

test('a history with the bundled v2 label and an extra entry is refused', () => {
  const key = testKey();
  const v1 = JSON.parse(v1Bytes);
  const v2 = JSON.parse(v2Bytes);
  const sameLabel = successor(v2Bytes, key, 2, 2).doc;
  assert.equal(sealedSuccessorExtends(v1, sameLabel), false);
  assert.equal(laterThanBundled(v2, sameLabel), false);
  // Higher version but same seq, or the reverse, is still not later.
  assert.equal(laterThanBundled(v2, successor(v2Bytes, key, 3, 2).doc), false);
  assert.equal(laterThanBundled(v2, successor(v2Bytes, key, 2, 3).doc), false);
  // The exact bundled document and a real v3 are fine.
  assert.equal(laterThanBundled(v2, v2), true);
  assert.equal(sealedSuccessorExtends(v1, successor(v2Bytes, key, 3, 3).doc), true);
});

test('the bundled entries under a lower label are refused', () => {
  const v1 = JSON.parse(v1Bytes);
  const v2 = JSON.parse(v2Bytes);
  for (const [version, seq] of [[1, 2], [2, 1], [1, 1]]) {
    const relabeled = { ...JSON.parse(v2Bytes), version, seq };
    assert.equal(laterThanBundled(v2, relabeled), false, `${version}/${seq}`);
    assert.equal(sealedSuccessorExtends(v1, relabeled), false, `${version}/${seq}`);
  }
  assert.equal(laterThanBundled(v2, { ...JSON.parse(v2Bytes), version: 3, seq: 3 }), true);
});
