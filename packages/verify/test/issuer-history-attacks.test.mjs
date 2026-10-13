/**
 * Issuer-history attacks. A sealed chain is a prefix. Skipping the kid
 * window is not VERIFIED. Payload v10 pins the document hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { jcsCanonicalize } = await import('../dist/jcs.js');
const {
  issuerHistoryEntryHash,
  issuerKeyWindow,
  verifyIssuerHistoryDocument,
  checkReceiptIssuerHistory,
  readIssuerHistoryPin,
  issuerHistoryDocumentHash,
} = await import('../dist/issuer-history.js');
const { verifyReceipt } = await import('../dist/index.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const payer = `0x${'11'.repeat(20)}`;
const payee = `0x${'22'.repeat(20)}`;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function entryFor(key, { notBefore, prev = null, custody = 'test custody', status = 'active' }) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: notBefore,
    not_after: null,
    status,
    revoked_at: null,
    reason: null,
    custody,
    prev_hash: prev,
  };
  return { ...body, entry_hash: issuerHistoryEntryHash(body) };
}

function historyOf(entries, signer) {
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: head,
    version: 1,
    seq: 1,
  };
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 1,
    seq: 1,
    entries,
    head_hash: head,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: signClaims(claims, signer, 'chit402-issuer-history+jwt'),
      kid: signer.kid,
      issuer_jwk: signer.publicJwk,
    },
  };
  const bytes = jcsCanonicalize(doc);
  const parsed = JSON.parse(bytes);
  assert.equal(issuerHistoryDocumentHash(parsed), sha256(bytes));
  return { doc: parsed, bytes, hash: sha256(bytes), head };
}

function paymentClaims(version, extra = {}) {
  return {
    task_id: `task-history-${version}`,
    iss: 'chit402',
    iat: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    payload_version: version,
    payment: {
      rail: 'usdc',
      ref: `base:0x${'ab'.repeat(32)}`,
      gross_amount: '2000',
      settled_amount: '2000',
      payee,
    },
    caller_binding: { payer_wallet: payer },
    tree_head_hash: 'ab'.repeat(32),
    tolerance: { base: 300, solana: 150 },
    ...extra,
  };
}

function receiptFor(key, claims) {
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      kid: key.kid,
      jws: signClaims(claims, key, 'chit402-receipt+jwt'),
      issuer_jwk: key.publicJwk,
      payload_version: claims.payload_version,
    },
  };
}

function runCli(args) {
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { ...proc, text: `${proc.stdout || ''}\n${proc.stderr || ''}` };
}

function bareVerified(text) {
  return text.split('\n').some((line) => line === '  Overall: VERIFIED');
}

test('history version 1 still matches a payload v10 document pin', async () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/public/issuer-history-v1.json', import.meta.url));
  const bytes = readFileSync(fixturePath, 'utf8');
  const doc = JSON.parse(bytes);
  const hash = sha256(bytes);
  assert.equal(issuerHistoryDocumentHash(doc), hash);
  assert.equal(doc.version, 1);
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0].entry_hash, '3d8259fb043f8ac80c924ea89d508f0a898f70bd0335658ef47370d5757e27a6');
  const pin = readIssuerHistoryPin({ issuer_history: { hash, version: 1, seq: 1 } });
  const checked = await checkReceiptIssuerHistory({
    verify_url: 'https://api.chit402.com/receipt/chit-5d775d12',
  }, {
    document: doc,
    documentBytes: bytes,
    fetchHistory: false,
    kid: PRODUCTION_KID,
    issuedAt: '2026-09-26T17:27:32Z',
    pin,
    requirePin: true,
    trustedKids: [PRODUCTION_KID],
  });
  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.checked, true);

  const edited = `${bytes.slice(0, -1)} `;
  const editedDoc = JSON.parse(bytes);
  editedDoc.not_before_note = `${editedDoc.not_before_note} edited`;
  const editedBytes = JSON.stringify(editedDoc);
  const moved = await checkReceiptIssuerHistory({
    verify_url: 'https://api.chit402.com/receipt/chit-5d775d12',
  }, {
    document: JSON.parse(editedBytes),
    documentBytes: editedBytes,
    fetchHistory: false,
    kid: PRODUCTION_KID,
    issuedAt: '2026-09-26T17:27:32Z',
    pin,
    requirePin: true,
    trustedKids: [PRODUCTION_KID],
  });
  assert.equal(moved.ok, false);
  assert.equal(moved.reason, 'issuer_history_pin_mismatch');
  assert.equal(edited.includes('unused'), false);
});

test('an edited genesis entry is rejected', () => {
  const key = issuerKey();
  const genesis = entryFor(key, { notBefore: '2026-09-04T08:52:05Z' });
  const pinned = historyOf([genesis], key);
  const signed = verifyIssuerHistoryDocument(pinned.doc, { trustedKids: [key.kid] });
  assert.equal(signed.valid, true, signed.reason);

  const forged = structuredClone(pinned.doc);
  forged.entries[0].custody = 'edited genesis';
  const broken = verifyIssuerHistoryDocument(forged, { trustedKids: [key.kid] });
  assert.equal(broken.valid, false);
  assert.equal(broken.reason, 'entry_hash_mismatch');
});

test('a payload v10 receipt verifies only against the exact history file', async () => {
  const key = issuerKey();
  const genesis = entryFor(key, { notBefore: '2026-09-04T08:52:05Z' });
  const v1 = historyOf([genesis], key);
  const added = entryFor(issuerKey(), { notBefore: '2026-12-01T00:00:00Z', prev: genesis.entry_hash });
  const later = historyOf([genesis, added], key);
  const receipt = receiptFor(key, paymentClaims(10, {
    issuer_history: { hash: v1.hash, version: 1, seq: 1 },
  }));
  const opts = { jwks: { keys: [key.publicJwk] }, trustedKids: [key.kid] };
  const exact = await verifyReceipt(receipt, { ...opts, issuerHistory: v1.doc, issuerHistoryBytes: v1.bytes });
  assert.equal(exact.overall, 'verified', exact.errors.join('; '));
  const moved = await verifyReceipt(receipt, { ...opts, issuerHistory: later.doc, issuerHistoryBytes: later.bytes });
  assert.equal(moved.overall, 'failed');
  assert.equal(moved.issuer_history.reason, 'issuer_history_pin_mismatch');
});

test('a new key that inherits an older window is rejected', () => {
  const first = issuerKey();
  const second = issuerKey();
  const genesis = entryFor(first, { notBefore: '2026-09-04T08:52:05Z' });
  const copied = entryFor(second, { notBefore: '2026-09-04T08:52:05Z', prev: genesis.entry_hash });
  const history = historyOf([genesis, copied], first);
  const result = verifyIssuerHistoryDocument(history.doc, { trustedKids: [first.kid] });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'inherited_key_window');
});

test('a history signed only by the key it introduces is rejected, and genesis is not', () => {
  const first = issuerKey();
  const second = issuerKey();
  const genesis = entryFor(first, { notBefore: '2026-09-04T08:52:05Z' });
  const added = entryFor(second, { notBefore: '2026-11-01T00:00:00Z', prev: genesis.entry_hash });
  const introduced = historyOf([genesis, added], second);
  const rejected = verifyIssuerHistoryDocument(introduced.doc, {
    jwks: { keys: [first.publicJwk, second.publicJwk] },
    trustedKids: [second.kid],
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, 'introduced_key_signature');

  const alone = historyOf([entryFor(second, { notBefore: '2026-11-01T00:00:00Z' })], second);
  const allowed = verifyIssuerHistoryDocument(alone.doc, { trustedKids: [second.kid] });
  assert.equal(allowed.valid, true, allowed.reason);
});

test('the last entry for a kid is the window', () => {
  const key = issuerKey();
  const first = entryFor(key, { notBefore: '2026-01-01T00:00:00Z' });
  const retiredBody = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: '2026-05-01T00:00:00Z',
    not_after: '2026-06-01T00:00:00Z',
    status: 'retired',
    revoked_at: null,
    reason: 'rotated',
    custody: 'test custody',
    prev_hash: first.entry_hash,
  };
  const retired = { ...retiredBody, entry_hash: issuerHistoryEntryHash(retiredBody) };
  const retiredWindow = issuerKeyWindow({ entries: [first, retired] }, key.kid, '2026-07-01T00:00:00Z');
  assert.equal(retiredWindow.ok, false);
  assert.equal(retiredWindow.reason, 'issued_after_not_after');

  const revokedBody = {
    ...retiredBody,
    status: 'revoked',
    not_after: null,
    revoked_at: '2026-06-01T00:00:00Z',
    not_before: '2026-01-01T00:00:00Z',
    reason: 'compromised',
  };
  const revoked = { ...revokedBody, entry_hash: issuerHistoryEntryHash(revokedBody) };
  const late = issuerKeyWindow({ entries: [first, revoked] }, key.kid, '2026-09-01T00:00:00Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow({ entries: [first, revoked] }, key.kid, '2026-03-01T00:00:00Z');
  assert.equal(early.ok, true, early.reason);
});

test('a later active entry does not clear a revocation or a retire', () => {
  const key = issuerKey();
  const first = entryFor(key, { notBefore: '2026-01-01T00:00:00Z' });
  function next(prev, fields) {
    const body = {
      kid: key.kid,
      jwk: key.publicJwk,
      alg: 'ES256',
      not_before: fields.not_before,
      not_after: fields.not_after ?? null,
      status: fields.status,
      revoked_at: fields.revoked_at ?? null,
      reason: null,
      custody: 'test custody',
      prev_hash: prev.entry_hash,
    };
    return { ...body, entry_hash: issuerHistoryEntryHash(body) };
  }
  const revoked = next(first, {
    not_before: '2026-01-01T00:00:00Z',
    status: 'revoked',
    revoked_at: '2026-06-01T00:00:00Z',
  });
  const again = next(revoked, { not_before: '2026-01-01T00:00:00Z', status: 'active' });
  const entries = [first, revoked, again];
  const late = issuerKeyWindow({ entries }, key.kid, '2026-09-01T00:00:00Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow({ entries }, key.kid, '2026-03-01T00:00:00Z');
  assert.equal(early.ok, true, early.reason);
  const rejected = verifyIssuerHistoryDocument({
    schema: 'chit402.issuer_history.v1',
    entries,
    head_hash: again.entry_hash,
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, 'kid_status_regression');

  const retired = next(first, {
    not_before: '2026-01-01T00:00:00Z',
    not_after: '2026-06-01T00:00:00Z',
    status: 'retired',
  });
  const reactivated = next(retired, {
    not_before: '2026-01-01T00:00:00Z',
    not_after: '2027-01-01T00:00:00Z',
    status: 'active',
  });
  const afterRetire = issuerKeyWindow(
    { entries: [first, retired, reactivated] },
    key.kid,
    '2026-09-01T00:00:00Z',
  );
  assert.equal(afterRetire.ok, false);
  assert.equal(afterRetire.reason, 'issued_after_not_after');
  assert.equal(verifyIssuerHistoryDocument({
    schema: 'chit402.issuer_history.v1',
    entries: [first, retired, reactivated],
    head_hash: reactivated.entry_hash,
  }).reason, 'kid_status_regression');

  const revokedAfterRetire = next(retired, {
    not_before: '2026-01-01T00:00:00Z',
    status: 'revoked',
    revoked_at: '2026-06-01T00:00:00Z',
  });
  const tightened = verifyIssuerHistoryDocument({
    schema: 'chit402.issuer_history.v1',
    entries: [first, retired, revokedAfterRetire],
    head_hash: revokedAfterRetire.entry_hash,
  });
  assert.equal(tightened.reason, 'no_signature');
});

test('--no-issuer-history never prints bare VERIFIED', async () => {
  const key = issuerKey();
  const receipt = receiptFor(key, paymentClaims(8));
  const labeled = await verifyReceipt(receipt, {
    jwks: { keys: [key.publicJwk] },
    trustedKids: [key.kid],
    skipIssuerHistory: true,
    labelSkippedKeyWindow: true,
  });
  assert.equal(labeled.overall, 'verified_no_key_window');
  assert.equal(labeled.issuer_history.warning, 'key window skipped');
  const unlabeled = await verifyReceipt(receipt, {
    jwks: { keys: [key.publicJwk] },
    trustedKids: [key.kid],
    skipIssuerHistory: true,
  });
  assert.equal(unlabeled.overall, 'verified_no_key_window', unlabeled.errors.join('; '));

  const dir = mkdtempSync(join(tmpdir(), 'chit-history-downgrade-'));
  const receiptPath = join(dir, 'receipt.json');
  const jwksPath = join(dir, 'jwks.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(jwksPath, JSON.stringify({ keys: [key.publicJwk] }));
  const base = [receiptPath, '--jwks-file', jwksPath, '--trusted-kid', key.kid, '--no-issuer-history'];
  const text = runCli(base);
  assert.equal(text.status, 0, text.text);
  assert.equal(bareVerified(text.stdout), false, text.stdout);
  assert.match(text.stdout, /Overall: VERIFIED_NO_KEY_WINDOW/);
  const strict = runCli([...base, '--strict']);
  assert.equal(strict.status, 1, strict.text);
  assert.equal(bareVerified(strict.stdout), false, strict.stdout);
  assert.match(strict.stdout, /Overall: VERIFIED_NO_KEY_WINDOW/);
  const json = runCli([...base, '--json']);
  assert.equal(json.status, 0, json.text);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.overall, 'verified_no_key_window');
  assert.equal(bareVerified(json.stdout), false);
});
