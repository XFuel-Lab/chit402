/**
 * Payload v12 pins issuer history by chain head. A later snapshot verifies
 * when it extends that head. The gateway still issues payload version 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { jcsCanonicalize } = await import('../dist/jcs.js');
const {
  issuerHistoryEntryHash,
  issuerHistoryDocumentHash,
  issuerKeyWindow,
  verifyIssuerHistoryDocument,
} = await import('../dist/issuer-history.js');
const { verifyReceipt, verifyReceiptUpToV10 } = await import('../dist/index.js');

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

function entryFor(key, { notBefore, prev = null, custody = 'test custody' }) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: notBefore,
    not_after: null,
    status: 'active',
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

test('an edited genesis does not extend a v12 head pin', async () => {
  const key = issuerKey();
  const genesis = entryFor(key, { notBefore: '2026-09-04T08:52:05Z' });
  const pinned = historyOf([genesis], key);
  const replaced = entryFor(key, { notBefore: '2026-09-04T08:52:05Z', custody: 'rewritten genesis' });
  const other = historyOf([replaced], key);
  const receipt = receiptFor(key, paymentClaims(12, {
    issuer_history: { head_hash: pinned.head, entry_count: 1 },
  }));
  const extended = await verifyReceipt(receipt, {
    jwks: { keys: [key.publicJwk] },
    trustedKids: [key.kid],
    issuerHistory: other.doc,
    issuerHistoryBytes: other.bytes,
  });
  assert.equal(extended.overall, 'failed');
  assert.equal(extended.issuer_history.reason, 'issuer_history_not_extension');
});

test('a payload v12 head pin accepts a later snapshot that extends it', async () => {
  const first = issuerKey();
  const second = issuerKey();
  const genesis = entryFor(first, { notBefore: '2026-09-04T08:52:05Z' });
  const v1 = historyOf([genesis], first);
  const added = entryFor(second, { notBefore: '2026-11-01T00:00:00Z', prev: genesis.entry_hash });
  const v2 = historyOf([genesis, added], first);
  const receipt = receiptFor(first, paymentClaims(12, {
    issuer_history: { head_hash: v1.head, entry_count: 1 },
  }));
  const opts = { jwks: { keys: [first.publicJwk] }, trustedKids: [first.kid] };
  const exact = await verifyReceipt(receipt, { ...opts, issuerHistory: v1.doc, issuerHistoryBytes: v1.bytes });
  assert.equal(exact.overall, 'verified', exact.errors.join('; '));
  assert.equal(exact.issuer_history.ok, true, exact.issuer_history.reason);
  const later = await verifyReceipt(receipt, { ...opts, issuerHistory: v2.doc, issuerHistoryBytes: v2.bytes });
  assert.equal(later.overall, 'verified', later.errors.join('; '));
  assert.equal(later.issuer_history.ok, true, later.issuer_history.reason);

  const capped = await verifyReceiptUpToV10(receipt, opts);
  assert.equal(capped.overall, 'failed');
  assert.equal(capped.errors[0], 'unsupported_version');
});

test('a payload v12 receipt with a document pin or no pin fails closed', async () => {
  const key = issuerKey();
  const genesis = entryFor(key, { notBefore: '2026-09-04T08:52:05Z' });
  const history = historyOf([genesis], key);
  const opts = {
    jwks: { keys: [key.publicJwk] },
    trustedKids: [key.kid],
    issuerHistory: history.doc,
    issuerHistoryBytes: history.bytes,
  };
  const shaped = receiptFor(key, paymentClaims(12, {
    issuer_history: { hash: history.hash, version: 1, seq: 1 },
  }));
  const shape = await verifyReceipt(shaped, opts);
  assert.equal(shape.overall, 'failed');
  assert.equal(shape.errors[0], 'unsupported_version');

  const missing = receiptFor(key, paymentClaims(12));
  const absent = await verifyReceipt(missing, opts);
  assert.equal(absent.overall, 'failed');
  assert.equal(absent.errors[0], 'unsupported_version');

  const both = receiptFor(key, paymentClaims(12, {
    issuer_history: { hash: history.hash, version: 1, seq: 1, head_hash: history.head, entry_count: 1 },
  }));
  const conflict = await verifyReceipt(both, opts);
  assert.equal(conflict.overall, 'failed');
  assert.equal(conflict.errors[0], 'unsupported_version');
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

function bareVerified(text) {
  return text.split('\n').some((line) => line.trim() === 'Overall: VERIFIED');
}

function runCli(args) {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  return {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    text: `${proc.stdout || ''}\n${proc.stderr || ''}`,
  };
}

test('payload v12 --no-issuer-history is VERIFIED_NO_KEY_WINDOW and exits non-zero', async () => {
  const key = issuerKey();
  const receipt = receiptFor(key, paymentClaims(12, {
    issuer_history: { head_hash: 'ab'.repeat(32), entry_count: 1 },
  }));
  const opts = { jwks: { keys: [key.publicJwk] }, trustedKids: [key.kid], skipIssuerHistory: true };
  const skipped = await verifyReceipt(receipt, opts);
  assert.equal(skipped.overall, 'verified_no_key_window', skipped.errors.join('; '));
  assert.equal(skipped.issuer_history.warning, 'key window skipped');

  const older = await verifyReceipt(receiptFor(key, paymentClaims(10)), opts);
  assert.equal(older.overall, 'verified', older.errors.join('; '));

  const dir = mkdtempSync(join(tmpdir(), 'chit-v12-skip-'));
  const receiptPath = join(dir, 'receipt.json');
  const jwksPath = join(dir, 'jwks.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(jwksPath, JSON.stringify({ keys: [key.publicJwk] }));
  const base = [
    receiptPath,
    '--jwks-file', jwksPath,
    '--trusted-kid', key.kid,
    '--no-issuer-history',
    '--no-preimage',
  ];
  const text = runCli(base);
  assert.equal(text.status, 1, text.text);
  assert.equal(bareVerified(text.stdout), false, text.stdout);
  assert.match(text.stdout, /Overall: VERIFIED_NO_KEY_WINDOW/);
  const opted = runCli([...base, '--accept-no-key-window']);
  assert.equal(opted.status, 0, opted.text);
  assert.equal(bareVerified(opted.stdout), false, opted.stdout);
  assert.match(opted.stdout, /Overall: VERIFIED_NO_KEY_WINDOW/);
  const json = runCli([...base, '--json']);
  assert.equal(json.status, 1, json.text);
  assert.equal(JSON.parse(json.stdout).overall, 'verified_no_key_window');
  assert.equal(bareVerified(json.stdout), false);
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
  assert.equal(verifyIssuerHistoryDocument({
    schema: 'chit402.issuer_history.v1',
    entries,
    head_hash: again.entry_hash,
  }).reason, 'kid_status_regression');

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
});
