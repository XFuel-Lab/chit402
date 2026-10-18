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
