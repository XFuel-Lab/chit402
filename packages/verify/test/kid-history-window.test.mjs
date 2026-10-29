/**
 * One key window for receipts, tree heads, and epoch records.
 * Keys are generated in process. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

await import('./dist-built.mjs');

const {
  issuerHistoryEntryHash,
  issuerKeyWindow,
  checkReceiptIssuerHistory,
  epochHistoryKeyAllowed,
  resolveIssuerHistory,
  loadBundledIssuerHistory,
} = await import('../dist/issuer-history.js');
const { verifyTreeHeadTrust } = await import('../dist/anchor-trust.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { verifyReceipt } = await import('../dist/index.js');
const { verdictFromVerification } = await import('../dist/verdict.js');
const {
  parsePublicAttestation,
  publicReceiptPayload,
  verifyPublicAttestationTrust,
} = await import('../dist/public-attestation.js');
const { verifyPublicShell } = await import('../dist/check-input.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const BUNDLED_SHA = 'b5ecff74a0c5a493268c100ab164b641a5cb2bed8792d0526a997d9d5aa7b07d';
const V1_SHA = 'e20d606904df1fe71ab96d8f71100d50ce1a3686fa099b3af3d92b8d8b79f1e8';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const payer = `0x${'11'.repeat(20)}`;
const payee = `0x${'22'.repeat(20)}`;

const T0 = '2026-01-01T00:00:00.000Z';
const T0_BEFORE = '2025-12-31T23:59:59.999Z';
const T1 = '2026-06-01T00:00:00.000Z';
const T1_BEFORE = '2026-05-31T23:59:59.999Z';
const T1_AFTER = '2026-06-01T00:00:00.001Z';
const T2 = '2026-08-01T00:00:00.000Z';
const NEXT_START = '2026-07-01T00:00:00.000Z';
const GAP = '2026-06-15T00:00:00.000Z';
const NEXT_INSIDE = '2026-07-15T00:00:00.000Z';
const INSIDE = '2026-03-01T00:00:00.000Z';

function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Source scans compare LF text. A Windows checkout may store CRLF. */
function sourceText(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function historyFrom(signer, bodies, { version = 1, seq = 1 } = {}) {
  let prev = null;
  const entries = bodies.map((body) => {
    const full = { ...body, prev_hash: prev };
    const entryHash = issuerHistoryEntryHash(full);
    prev = entryHash;
    return { ...full, entry_hash: entryHash };
  });
  const headHash = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: headHash,
    version,
    seq,
  };
  const doc = {
    schema: 'chit402.issuer_history.v1',
    version,
    seq,
    entries,
    head_hash: headHash,
    issuer_signature: {
      jws: signClaims(claims, signer, 'chit402-issuer-history+jwt'),
      kid: signer.kid,
      issuer_jwk: signer.publicJwk,
    },
  };
  const bytes = jcsCanonicalize(doc);
  return { doc: JSON.parse(bytes), bytes };
}

function row(key, fields = {}) {
  return {
    kid: fields.kid ?? key.kid,
    jwk: fields.jwk ?? key.publicJwk,
    alg: 'ES256',
    not_before: fields.notBefore,
    not_after: fields.notAfter === undefined ? null : fields.notAfter,
    status: fields.status ?? 'active',
    revoked_at: fields.revokedAt === undefined ? null : fields.revokedAt,
    reason: null,
    custody: 'test',
  };
}

function sealHead(claims, key) {
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      jws: signClaims(claims, key, 'chit402-tree-head+jwt'),
      kid: key.kid,
    },
  };
}

function headFor(key, publishedAt, { omitTime = false } = {}) {
  const claims = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 1,
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  };
  if (!omitTime) claims.published_at = publishedAt;
  return sealHead(claims, key);
}

function assertResolver(doc, kid, time, ok, reason) {
  const got = issuerKeyWindow(doc, kid, time);
  assert.equal(got.ok, ok, `resolver ${reason}: ${JSON.stringify(got)}`);
  assert.equal(got.reason, ok ? null : reason);
}

async function assertReceipt(doc, signer, kid, time, ok, reason) {
  const got = await checkReceiptIssuerHistory({}, {
    document: doc,
    kid,
    issuedAt: time,
    trustedKids: [signer.kid],
    fetchHistory: false,
  });
  assert.equal(got.checked, true, got.reason);
  assert.equal(got.ok, ok, `receipt ${reason}: ${got.reason}`);
  assert.equal(got.reason, ok ? null : reason);
}

function assertHead(doc, signer, headKey, time, ok, reason, { omitTime = false, jwks = undefined } = {}) {
  const got = verifyTreeHeadTrust(headFor(headKey, time, { omitTime }), {
    trustedKids: [signer.kid],
    issuerHistory: doc,
    jwks,
  });
  assert.equal(got.ok, ok, got.message);
  if (ok) {
    assert.equal(got.reason, null);
    return;
  }
  if (reason === 'published_at_missing') {
    assert.equal(got.reason, 'published_at_missing', got.message);
    return;
  }
  assert.equal(got.reason, 'head_kid_window', got.message);
  assert.match(got.message, new RegExp(reason));
}

async function assertBoth(doc, signer, headKey, kid, time, ok, reason) {
  assertResolver(doc, kid, time, ok, reason);
  await assertReceipt(doc, signer, kid, time, ok, reason);
  assertHead(doc, signer, headKey, time, ok, reason);
}

function paymentClaims(iat, extra = {}) {
  return {
    task_id: 'task-history-window',
    iss: 'chit402',
    iat,
    payload_version: 8,
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

function receiptFor(key, claims, createdAt) {
  return {
    ...claims,
    created_at: createdAt,
    issuer_signature: {
      alg: 'ES256',
      kid: key.kid,
      jws: signClaims(claims, key, 'chit402-receipt+jwt'),
      issuer_jwk: key.publicJwk,
      payload_version: claims.payload_version,
    },
  };
}

function seconds(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

test('single active row: not_before is inclusive', async () => {
  const key = issuerKey();
  const doc = historyFrom(key, [row(key, { notBefore: T0 })]).doc;
  await assertBoth(doc, key, key, key.kid, INSIDE, true, null);
  await assertBoth(doc, key, key, key.kid, T0, true, null);
  await assertBoth(doc, key, key, key.kid, T0_BEFORE, false, 'issued_before_not_before');
});

test('active then retired: the folded window verifies inside and at not_after', async () => {
  const oldKey = issuerKey();
  const nextKey = issuerKey();
  const doc = historyFrom(oldKey, [
    row(oldKey, { notBefore: T0 }),
    row(oldKey, { notBefore: T0, notAfter: T1, status: 'retired' }),
    row(nextKey, { notBefore: NEXT_START }),
  ]).doc;
  await assertBoth(doc, oldKey, oldKey, oldKey.kid, INSIDE, true, null);
  await assertBoth(doc, oldKey, oldKey, oldKey.kid, T1, true, null);
  await assertBoth(doc, oldKey, oldKey, oldKey.kid, T1_AFTER, false, 'issued_after_not_after');
  await assertBoth(doc, oldKey, oldKey, oldKey.kid, GAP, false, 'issued_after_not_after');
  await assertBoth(doc, oldKey, nextKey, nextKey.kid, GAP, false, 'issued_before_not_before');
  await assertBoth(doc, oldKey, nextKey, nextKey.kid, NEXT_INSIDE, true, null);
  await assertBoth(doc, oldKey, oldKey, oldKey.kid, NEXT_INSIDE, false, 'issued_after_not_after');
  await assertBoth(doc, oldKey, nextKey, nextKey.kid, INSIDE, false, 'issued_before_not_before');
});

test('active then revoked: revoked_at is exclusive', async () => {
  const key = issuerKey();
  const doc = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, status: 'revoked', revokedAt: T1 }),
  ]).doc;
  await assertBoth(doc, key, key, key.kid, T1_BEFORE, true, null);
  await assertBoth(doc, key, key, key.kid, T1, false, 'kid_revoked_before_issuance');
  await assertBoth(doc, key, key, key.kid, '2026-06-02T00:00:00.000Z', false, 'kid_revoked_before_issuance');

  const bare = historyFrom(key, [
    row(key, { notBefore: T0, status: 'revoked', revokedAt: null }),
  ]).doc;
  await assertBoth(bare, key, key, key.kid, INSIDE, false, 'revoked_at_missing');
});

test('the earlier of revoked_at and not_after binds', async () => {
  const key = issuerKey();
  const notAfterFirst = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: '2026-05-01T00:00:00.000Z', status: 'revoked', revokedAt: T1 }),
  ]).doc;
  await assertBoth(notAfterFirst, key, key, key.kid, '2026-04-01T00:00:00.000Z', true, null);
  await assertBoth(notAfterFirst, key, key, key.kid, '2026-05-15T00:00:00.000Z', false, 'issued_after_not_after');

  const revokedFirst = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: '2026-07-01T00:00:00.000Z', status: 'revoked', revokedAt: '2026-05-01T00:00:00.000Z' }),
  ]).doc;
  await assertBoth(revokedFirst, key, key, key.kid, '2026-04-01T00:00:00.000Z', true, null);
  await assertBoth(revokedFirst, key, key, key.kid, '2026-05-15T00:00:00.000Z', false, 'kid_revoked_before_issuance');
});

test('a later row cannot widen not_after or revoked_at', async () => {
  const key = issuerKey();
  const retired = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
    row(key, { notBefore: T0, notAfter: T2, status: 'retired' }),
  ]).doc;
  await assertBoth(retired, key, key, key.kid, T1_BEFORE, true, null);
  await assertBoth(retired, key, key, key.kid, '2026-07-01T00:00:00.000Z', false, 'issued_after_not_after');

  // A second revoked row is not a valid history document. The resolver still
  // keeps the earlier revoked_at. The head path refuses the document itself.
  const revoked = {
    entries: [
      row(key, { notBefore: T0 }),
      row(key, { notBefore: T0, status: 'revoked', revokedAt: '2026-05-01T00:00:00.000Z' }),
      row(key, { notBefore: T0, status: 'revoked', revokedAt: T2 }),
    ],
  };
  assertResolver(revoked, key.kid, '2026-06-01T00:00:00.000Z', false, 'kid_revoked_before_issuance');
});

test('ambiguity is key identity, and identical rows fold', async () => {
  const key = issuerKey();
  const other = issuerKey();
  const twoLabels = historyFrom(key, [
    row(key, { kid: 'label-a', notBefore: T0 }),
    row(key, { kid: 'label-b', notBefore: '2026-03-01T00:00:00.000Z' }),
  ]).doc;
  await assertBoth(twoLabels, key, key, key.kid, '2026-04-01T00:00:00.000Z', false, 'kid_ambiguous');

  const twoKeys = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, jwk: other.publicJwk }),
  ]).doc;
  await assertBoth(twoKeys, key, key, key.kid, INSIDE, false, 'kid_ambiguous');

  const same = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0 }),
  ]).doc;
  await assertBoth(same, key, key, key.kid, INSIDE, true, null);
});

test('no matching row is kid_not_in_history and maps to exit 2', async () => {
  const key = issuerKey();
  const other = issuerKey();
  const packed = historyFrom(key, [row(key, { notBefore: T0 })]);
  assertResolver(packed.doc, other.kid, INSIDE, false, 'kid_not_in_history');
  await assertReceipt(packed.doc, key, other.kid, INSIDE, false, 'kid_not_in_history');
  assertHead(packed.doc, key, other, INSIDE, false, 'kid_not_in_history', { jwks: { keys: [other.publicJwk] } });

  const receipt = receiptFor(other, paymentClaims(seconds(INSIDE)), INSIDE);
  const result = await verifyReceipt(receipt, {
    jwks: { keys: [other.publicJwk, key.publicJwk] },
    trustedKids: [key.kid, other.kid],
    issuerHistory: packed.doc,
  });
  assert.equal(result.issuer_history.reason, 'kid_not_in_history', result.errors.join('; '));
  const mapped = verdictFromVerification({
    errors: [],
    issuer_signature: { valid: true, checked: true, key_trusted: true },
    issuer_history: { checked: true, ok: false, reason: 'kid_not_in_history', document: packed.doc },
    binding: { expected: null, matches: false },
    claim_mismatches: [],
    payer: { checked: true, valid: true, outcome: 'pass' },
  }, {
    version: 'test',
    payerRequired: true,
    logInclusion: 'pass',
    anchor: 'pass',
    history: {
      source: 'file',
      headHash: packed.doc.head_hash,
      entryCount: 1,
      asOf: null,
      invalid: false,
      reason: null,
      documentPresent: true,
    },
  });
  assert.equal(mapped.result, 'could_not_check');
  assert.equal(mapped.exit_code, 2);
  assert.equal(mapped.reason, 'kid_not_in_history');
  assert.equal(mapped.checks.key_window, 'could_not_check');
});

test('a missing receipt time stays issued_at_missing, and untimed heads use the folded window', async () => {
  const key = issuerKey();
  const open = historyFrom(key, [row(key, { notBefore: T0 })]).doc;
  const checked = await checkReceiptIssuerHistory({}, {
    document: open,
    kid: key.kid,
    issuedAt: null,
    trustedKids: [key.kid],
    fetchHistory: false,
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'issued_at_missing');
  const blank = await checkReceiptIssuerHistory({}, {
    document: open,
    kid: key.kid,
    issuedAt: '',
    trustedKids: [key.kid],
    fetchHistory: false,
  });
  assert.equal(blank.reason, 'issued_at_missing');

  assertHead(open, key, key, 'garbage', false, 'issued_at_missing');
  assertResolver(open, key.kid, 'garbage', false, 'issued_at_missing');

  assertHead(open, key, key, null, true, null, { omitTime: true });

  const future = historyFrom(key, [row(key, { notBefore: '2099-01-01T00:00:00.000Z' })]).doc;
  assertHead(future, key, key, null, false, 'issued_before_not_before', { omitTime: true });

  const retired = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
  ]).doc;
  assertHead(retired, key, key, null, false, 'published_at_missing', { omitTime: true });

  const revoked = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, status: 'revoked', revokedAt: T1 }),
  ]).doc;
  assertHead(revoked, key, key, null, false, 'published_at_missing', { omitTime: true });
});

test('an unparseable not_after refuses on both paths', async () => {
  const key = issuerKey();
  const doc = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: 'not-a-time', status: 'retired' }),
  ]).doc;
  await assertBoth(doc, key, key, key.kid, INSIDE, false, 'not_after_invalid');
});

test('the receipt window uses the signed iat, and a past window still verifies today', async () => {
  const key = issuerKey();
  const revokedAt = '2020-06-01T00:00:00.000Z';
  const doc = historyFrom(key, [
    row(key, { notBefore: '2019-01-01T00:00:00.000Z' }),
    row(key, { notBefore: '2019-01-01T00:00:00.000Z', status: 'revoked', revokedAt }),
  ]).doc;
  const before = '2020-01-01T00:00:00.000Z';
  const after = '2020-07-01T00:00:00.000Z';
  const opts = { jwks: { keys: [key.publicJwk] }, trustedKids: [key.kid], issuerHistory: doc };

  const good = await verifyReceipt(receiptFor(key, paymentClaims(seconds(before)), after), opts);
  assert.equal(good.issuer_history.ok, true, good.issuer_history.reason);
  assert.equal(good.issuer_history.reason, null);
  assert.equal(good.verdict.checks.key_window, 'pass');
  const verified = verdictFromVerification(good, {
    version: 'test',
    payerRequired: true,
    logInclusion: 'pass',
    anchor: 'pass',
    history: {
      source: 'file',
      headHash: doc.head_hash,
      entryCount: doc.entries.length,
      asOf: null,
      invalid: false,
      reason: null,
      documentPresent: true,
    },
  });
  // The library does not check the log, the anchor, or the payer. The shared
  // mapping is exit 0 once those checks pass. The history result is the one
  // verifyReceipt computed from the signed iat.
  const exit0 = verdictFromVerification({
    ...good,
    payer: { checked: true, valid: true, outcome: 'pass' },
  }, {
    version: 'test',
    payerRequired: true,
    logInclusion: 'pass',
    anchor: 'pass',
    history: {
      source: 'file',
      headHash: doc.head_hash,
      entryCount: doc.entries.length,
      asOf: null,
      invalid: false,
      reason: null,
      documentPresent: true,
    },
  });
  assert.equal(verified.checks.key_window, 'pass');
  assert.equal(exit0.result, 'verified');
  assert.equal(exit0.exit_code, 0);

  const bad = await verifyReceipt(receiptFor(key, paymentClaims(seconds(after)), before), opts);
  assert.equal(bad.issuer_history.reason, 'kid_revoked_before_issuance');
  assert.equal(bad.verdict.exit_code, 1);
  assert.equal(bad.verdict.reason, 'kid_revoked_before_issuance');

  await assertReceipt(doc, key, key.kid, before, true, null);
  assertHead(doc, key, key, before, true, null);
});

test('exit codes: multi-row verified maps to 0, revoked and ambiguous to 1', async () => {
  const key = issuerKey();
  const open = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
  ]).doc;
  const opts = { jwks: { keys: [key.publicJwk] }, trustedKids: [key.kid], issuerHistory: open };
  const good = await verifyReceipt(receiptFor(key, paymentClaims(seconds(INSIDE)), INSIDE), opts);
  assert.equal(good.verdict.checks.key_window, 'pass', good.issuer_history.reason);
  const mapped = verdictFromVerification({
    ...good,
    payer: { checked: true, valid: true, outcome: 'pass' },
  }, {
    version: 'test',
    payerRequired: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  assert.equal(mapped.exit_code, 0);
  assert.equal(mapped.result, 'verified');

  const revoked = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, status: 'revoked', revokedAt: T0 }),
  ]).doc;
  const late = await verifyReceipt(receiptFor(key, paymentClaims(seconds(INSIDE)), INSIDE), {
    ...opts,
    issuerHistory: revoked,
  });
  assert.equal(late.verdict.exit_code, 1);
  assert.equal(late.verdict.reason, 'kid_revoked_before_issuance');

  const ambiguous = historyFrom(key, [
    row(key, { kid: 'label-a', notBefore: T0 }),
    row(key, { kid: 'label-b', notBefore: '2026-02-01T00:00:00.000Z' }),
  ]).doc;
  const mixed = await verifyReceipt(receiptFor(key, paymentClaims(seconds('2026-04-01T00:00:00.000Z')), INSIDE), {
    ...opts,
    issuerHistory: ambiguous,
  });
  assert.equal(mixed.issuer_history.reason, 'kid_ambiguous');
  assert.equal(mixed.verdict.exit_code, 1);
  assert.equal(mixed.verdict.reason, 'kid_ambiguous');
});

test('production call sites reach the shared resolver', async () => {
  const key = issuerKey();
  const doc = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
  ]).doc;
  assertHead(doc, key, key, INSIDE, true, null);

  const labeled = historyFrom(key, [
    row(key, { kid: 'other-label', notBefore: T0 }),
  ]).doc;
  const found = await checkReceiptIssuerHistory({}, {
    document: labeled,
    kid: key.kid,
    issuedAt: INSIDE,
    trustedKids: [key.kid],
    fetchHistory: false,
  });
  assert.equal(found.ok, true, found.reason);
  assert.notEqual(found.reason, 'kid_not_in_history');

  const anchorSrc = sourceText('../src/anchor-trust.ts');
  const historySrc = sourceText('../src/issuer-history.ts');
  const verdictSrc = sourceText('../src/verdict.ts');
  assert.ok(
    /return issuerKeyWindow\(doc, kid, publishedAt, \{ allowUntimedOpen: true \}\);/.test(anchorSrc),
    'anchor-trust.ts returns the shared resolver for a head',
  );
  assert.ok(
    /function headHistoryWindow\(\s*doc: IssuerHistoryDocument,\s*kid: string,\s*publishedAt: unknown,\s*\): \{ ok: boolean; reason: string \| null \} \{\s*return issuerKeyWindow\(doc, kid, publishedAt, \{ allowUntimedOpen: true \}\);\s*\}/.test(anchorSrc),
    'headHistoryWindow body contains no .filter( and no matches.length',
  );
  assert.ok(
    /\.filter\(\(row\) => historyRowMatchesKid\(row, kid\)\)/.test(historySrc),
    'issuerKeyWindow filters with historyRowMatchesKid',
  );
  assert.ok(
    /function epochHistoryKeyAllowed[\s\S]*?return issuerKeyWindow\(/.test(historySrc),
    'epochHistoryKeyAllowed calls the shared resolver',
  );
  assert.ok(
    /const WINDOW_FAIL = new Set\(\[\n  'kid_ambiguous',/.test(verdictSrc),
    'kid_ambiguous is the first WINDOW_FAIL reason',
  );
  assert.ok(/const window = issuerKeyWindow\(doc, kid, issuedAt\);/.test(historySrc), 'receipt call site keeps its text');
  const nowHits = historySrc.match(/Date\.now\(\)/g) || [];
  assert.equal(nowHits.length, 1);
  assert.ok(/> Date\.now\(\)\)/.test(historySrc), 'untimed future not_before compares with Date.now()');
});

test('receipt and head paths agree on the inner reason', async () => {
  const key = issuerKey();
  const other = issuerKey();
  const next = issuerKey();
  const cases = [
    { name: 'active inside', rows: [row(key, { notBefore: T0 })], kid: key.kid, head: key, time: INSIDE, ok: true, reason: null, epoch: true },
    { name: 'active at not_before', rows: [row(key, { notBefore: T0 })], kid: key.kid, head: key, time: T0, ok: true, reason: null, epoch: true },
    { name: 'active before not_before', rows: [row(key, { notBefore: T0 })], kid: key.kid, head: key, time: T0_BEFORE, ok: false, reason: 'issued_before_not_before', epoch: false },
    { name: 'retired inside', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, notAfter: T1, status: 'retired' })], kid: key.kid, head: key, time: INSIDE, ok: true, reason: null, epoch: true },
    { name: 'retired at not_after', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, notAfter: T1, status: 'retired' })], kid: key.kid, head: key, time: T1, ok: true, reason: null, epoch: true },
    { name: 'retired after not_after', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, notAfter: T1, status: 'retired' })], kid: key.kid, head: key, time: T1_AFTER, ok: false, reason: 'issued_after_not_after', epoch: false },
    { name: 'revoked before stamp', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, status: 'revoked', revokedAt: T1 })], kid: key.kid, head: key, time: T1_BEFORE, ok: true, reason: null, epoch: false },
    { name: 'revoked at stamp', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, status: 'revoked', revokedAt: T1 })], kid: key.kid, head: key, time: T1, ok: false, reason: 'kid_revoked_before_issuance', epoch: false },
    { name: 'not_after binds first', rows: [row(key, { notBefore: T0, notAfter: '2026-04-01T00:00:00.000Z', status: 'revoked', revokedAt: T1 })], kid: key.kid, head: key, time: '2026-05-01T00:00:00.000Z', ok: false, reason: 'issued_after_not_after', epoch: false },
    { name: 'revoked_at binds first', rows: [row(key, { notBefore: T0, notAfter: T2, status: 'revoked', revokedAt: '2026-04-01T00:00:00.000Z' })], kid: key.kid, head: key, time: '2026-05-01T00:00:00.000Z', ok: false, reason: 'kid_revoked_before_issuance', epoch: false },
    { name: 'later not_after does not widen', rows: [row(key, { notBefore: T0, notAfter: T1, status: 'retired' }), row(key, { notBefore: T0, notAfter: T2, status: 'retired' })], kid: key.kid, head: key, time: '2026-07-01T00:00:00.000Z', ok: false, reason: 'issued_after_not_after', epoch: false },
    { name: 'two labels', rows: [row(key, { kid: 'label-a', notBefore: T0 }), row(key, { kid: 'label-b', notBefore: '2026-02-01T00:00:00.000Z' })], kid: key.kid, head: key, time: INSIDE, ok: false, reason: 'kid_ambiguous', epoch: false },
    { name: 'two keys', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0, jwk: other.publicJwk })], kid: key.kid, head: key, time: INSIDE, ok: false, reason: 'kid_ambiguous', epoch: false },
    { name: 'identical rows', rows: [row(key, { notBefore: T0 }), row(key, { notBefore: T0 })], kid: key.kid, head: key, time: INSIDE, ok: true, reason: null, epoch: true },
    { name: 'missing kid', rows: [row(key, { notBefore: T0 })], kid: other.kid, head: other, time: INSIDE, ok: false, reason: 'kid_not_in_history', epoch: false, jwks: { keys: [other.publicJwk] } },
    { name: 'bad not_after', rows: [row(key, { notBefore: T0, notAfter: 'nope', status: 'retired' })], kid: key.kid, head: key, time: INSIDE, ok: false, reason: 'not_after_invalid', epoch: false },
    { name: 'garbage time', rows: [row(key, { notBefore: T0 })], kid: key.kid, head: key, time: 'garbage', ok: false, reason: 'issued_at_missing', epoch: false },
    { name: 'next kid only', rows: [row(key, { notBefore: T0, notAfter: T1, status: 'retired' }), row(next, { notBefore: NEXT_START })], kid: next.kid, head: next, time: NEXT_INSIDE, ok: true, reason: null, epoch: true },
  ];
  assert.ok(cases.length >= 12);
  for (const item of cases) {
    const doc = historyFrom(key, item.rows).doc;
    const receipt = issuerKeyWindow(doc, item.kid, item.time);
    const head = verifyTreeHeadTrust(headFor(item.head, item.time), {
      trustedKids: [key.kid],
      issuerHistory: doc,
      jwks: item.jwks,
    });
    assert.equal(receipt.ok, item.ok, item.name);
    assert.equal(receipt.reason, item.ok ? null : item.reason, item.name);
    assert.equal(head.ok, item.ok, `${item.name} head ${head.message}`);
    if (item.ok) assert.equal(head.reason, null, item.name);
    else if (item.reason === 'published_at_missing') assert.equal(head.reason, 'published_at_missing', item.name);
    else {
      assert.equal(head.reason, 'head_kid_window', `${item.name} ${head.message}`);
      assert.match(head.message, new RegExp(item.reason));
    }
    assert.equal(receipt.ok, head.ok, item.name);
    if (!item.ok) assert.match(head.message, new RegExp(receipt.reason));
    assert.equal(epochHistoryKeyAllowed(doc, item.kid, item.time), item.epoch, `${item.name} epoch`);
  }
});

test('bundled, sealed, and file histories answer the same single-row window', async () => {
  const historySrc = sourceText('../src/issuer-history.ts');
  const bundledPath = fileURLToPath(new URL('../issuer-history.snapshot.json', import.meta.url));
  const v1Path = fileURLToPath(new URL('../issuer-history.v1.snapshot.json', import.meta.url));
  const bundledBytes = readFileSync(bundledPath);
  const v1Bytes = readFileSync(v1Path);
  assert.equal(sha256(bundledBytes), BUNDLED_SHA);
  assert.equal(sha256(v1Bytes), V1_SHA);
  assert.ok(new RegExp(V1_SHA).test(historySrc), 'sealed v1 hash stays pinned');
  const loaded = loadBundledIssuerHistory();
  assert.equal(sha256(loaded.bytes), BUNDLED_SHA);
  assert.equal(loaded.bytes, bundledBytes.toString('utf8'));

  const bundled = JSON.parse(bundledBytes.toString('utf8'));
  const sealed = JSON.parse(v1Bytes.toString('utf8'));
  const inside = '2026-10-01T00:00:00.000Z';
  const before = '2026-09-04T08:52:04.999Z';
  const edge = '2026-09-04T08:52:05.000Z';
  const memory = {
    inside: issuerKeyWindow(bundled, PRODUCTION_KID, inside),
    edge: issuerKeyWindow(bundled, PRODUCTION_KID, edge),
    before: issuerKeyWindow(bundled, PRODUCTION_KID, before),
  };
  assert.deepEqual(memory.inside, { ok: true, reason: null });
  assert.deepEqual(memory.edge, { ok: true, reason: null });
  assert.deepEqual(memory.before, { ok: false, reason: 'issued_before_not_before' });
  assert.deepEqual(issuerKeyWindow(sealed, PRODUCTION_KID, inside), memory.inside);
  assert.deepEqual(issuerKeyWindow(sealed, PRODUCTION_KID, before), memory.before);
  assert.deepEqual(issuerKeyWindow(loaded.document, PRODUCTION_KID, inside), memory.inside);

  const resolvedBundle = await resolveIssuerHistory({});
  assert.equal(resolvedBundle.source, 'bundled');
  assert.equal(resolvedBundle.invalid, false, resolvedBundle.reason);
  assert.deepEqual(issuerKeyWindow(resolvedBundle.document, PRODUCTION_KID, inside), memory.inside);
  const bundledReceipt = await checkReceiptIssuerHistory({}, {
    document: bundled,
    documentBytes: bundledBytes.toString('utf8'),
    kid: PRODUCTION_KID,
    issuedAt: inside,
    fetchHistory: false,
  });
  assert.equal(bundledReceipt.ok, true, bundledReceipt.reason);
  const sealedReceipt = await checkReceiptIssuerHistory({}, {
    document: sealed,
    documentBytes: v1Bytes.toString('utf8'),
    kid: PRODUCTION_KID,
    issuedAt: inside,
    fetchHistory: false,
  });
  assert.equal(sealedReceipt.ok, true, sealedReceipt.reason);

  const key = issuerKey();
  const single = historyFrom(key, [row(key, { notBefore: T0 })], { version: 1, seq: 1 });
  const fromFile = await resolveIssuerHistory({
    bundledOverride: { document: single.doc, bytes: single.bytes },
    fileBytes: single.bytes,
    trustedKids: [key.kid],
    receipt: {},
  });
  assert.equal(fromFile.source, 'file', fromFile.reason);
  assert.equal(fromFile.invalid, false, fromFile.reason);
  assert.deepEqual(issuerKeyWindow(fromFile.document, key.kid, INSIDE), issuerKeyWindow(single.doc, key.kid, INSIDE));
  assert.deepEqual(issuerKeyWindow(fromFile.document, key.kid, T0_BEFORE), { ok: false, reason: 'issued_before_not_before' });

  const extended = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
  ], { version: 2, seq: 2 });
  const retiredFile = await resolveIssuerHistory({
    bundledOverride: { document: single.doc, bytes: single.bytes },
    fileBytes: extended.bytes,
    trustedKids: [key.kid],
    receipt: {},
  });
  assert.equal(retiredFile.invalid, false, retiredFile.reason);
  assert.equal(retiredFile.source, 'file');
  await assertBoth(retiredFile.document, key, key, key.kid, INSIDE, true, null);
  await assertBoth(retiredFile.document, key, key, key.kid, T1, true, null);
  await assertBoth(retiredFile.document, key, key, key.kid, T1_AFTER, false, 'issued_after_not_after');
});

test('an open-ended retired row is refused only on the epoch path', async () => {
  const key = issuerKey();
  const open = historyFrom(key, [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: null, status: 'retired' }),
  ]).doc;
  assert.equal(epochHistoryKeyAllowed(open, key.kid, '2026-03-01T00:00:00.000Z'), false);
  assert.equal(epochHistoryKeyAllowed(open, key.kid, '2030-01-01T00:00:00.000Z'), false);
  await assertBoth(open, key, key, key.kid, '2026-03-01T00:00:00.000Z', true, null);
  await assertBoth(open, key, key, key.kid, '2030-01-01T00:00:00.000Z', true, null);

  const onlyRetired = historyFrom(key, [
    row(key, { notBefore: T0, notAfter: null, status: 'retired' }),
  ]).doc;
  assert.equal(epochHistoryKeyAllowed(onlyRetired, key.kid, '2026-03-01T00:00:00.000Z'), false);
  assert.equal(epochHistoryKeyAllowed(onlyRetired, key.kid, '2030-01-01T00:00:00.000Z'), false);

  const bounded = historyFrom(key, [
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
  ]).doc;
  assert.equal(epochHistoryKeyAllowed(bounded, key.kid, INSIDE), true);
  assert.equal(epochHistoryKeyAllowed(bounded, key.kid, T1), true);
  assert.equal(epochHistoryKeyAllowed(bounded, key.kid, T1_AFTER), false);

  const missingNotAfter = row(key, { notBefore: T0, status: 'retired' });
  delete missingNotAfter.not_after;
  const missing = {
    entries: [
      row(key, { notBefore: T0 }),
      missingNotAfter,
    ],
  };
  assert.equal(Object.prototype.hasOwnProperty.call(missingNotAfter, 'not_after'), false);
  assert.equal(epochHistoryKeyAllowed(missing, key.kid, '2026-03-01T00:00:00.000Z'), false);
  assert.equal(epochHistoryKeyAllowed(missing, key.kid, '2030-01-01T00:00:00.000Z'), false);

  const blank = {
    entries: [
      row(key, { notBefore: T0 }),
      row(key, { notBefore: T0, notAfter: '', status: 'retired' }),
    ],
  };
  assert.equal(epochHistoryKeyAllowed(blank, key.kid, '2026-03-01T00:00:00.000Z'), false);
  assert.equal(epochHistoryKeyAllowed(blank, key.kid, '2030-01-01T00:00:00.000Z'), false);
});

test('a later active row does not clear a retired not_after', () => {
  const key = issuerKey();
  const entries = [
    row(key, { notBefore: T0 }),
    row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
    row(key, { notBefore: T0, status: 'active' }),
  ];
  assertResolver({ entries }, key.kid, INSIDE, true, null);
  assertResolver({ entries }, key.kid, T1, true, null);
  assertResolver({ entries }, key.kid, T1_AFTER, false, 'issued_after_not_after');
  assert.equal(epochHistoryKeyAllowed({ entries }, key.kid, INSIDE), true);
  assert.equal(epochHistoryKeyAllowed({ entries }, key.kid, T1_AFTER), false);
});

test('epoch path uses the shared window and keeps its stricter revocation rule', () => {
  const key = issuerKey();
  const active = { entries: [row(key, { notBefore: T0 })] };
  assert.equal(epochHistoryKeyAllowed(active, key.kid, INSIDE), true);
  assert.equal(epochHistoryKeyAllowed(active, key.kid, T0), true);
  assert.equal(epochHistoryKeyAllowed(active, key.kid, T0_BEFORE), false);

  const retired = {
    entries: [
      row(key, { notBefore: T0 }),
      row(key, { notBefore: T0, notAfter: T1, status: 'retired' }),
    ],
  };
  assert.equal(epochHistoryKeyAllowed(retired, key.kid, INSIDE), true);
  assert.equal(epochHistoryKeyAllowed(retired, key.kid, T1), true);
  assert.equal(epochHistoryKeyAllowed(retired, key.kid, T1_AFTER), false);

  const revoked = {
    entries: [
      row(key, { notBefore: T0 }),
      row(key, { notBefore: T0, status: 'revoked', revokedAt: T1 }),
    ],
  };
  assert.equal(epochHistoryKeyAllowed(revoked, key.kid, T0_BEFORE), false);
  assert.equal(epochHistoryKeyAllowed(revoked, key.kid, T1_BEFORE), false);
  assert.equal(epochHistoryKeyAllowed(revoked, key.kid, T1), false);
  assert.equal(epochHistoryKeyAllowed(revoked, key.kid, T1_AFTER), false);

  const viaJwkKid = {
    entries: [row(key, { kid: 'other-label', notBefore: T0, jwk: { ...key.publicJwk, kid: 'lookup-kid' } })],
  };
  assert.equal(epochHistoryKeyAllowed(viaJwkKid, 'lookup-kid', INSIDE), true);
  assert.equal(epochHistoryKeyAllowed(viaJwkKid, key.kid, INSIDE), false);

  assert.equal(epochHistoryKeyAllowed(active, key.kid, null), false);
  assert.equal(epochHistoryKeyAllowed(active, key.kid, ''), false);
  assert.equal(epochHistoryKeyAllowed(active, key.kid, 'garbage'), false);
  assert.equal(epochHistoryKeyAllowed(null, key.kid, INSIDE), false);
  assert.equal(epochHistoryKeyAllowed(active, null, INSIDE), false);

  const jwk = { ...key.publicJwk, kid: 'name-a' };
  const twoNames = {
    entries: [
      row(key, { kid: 'name-a', notBefore: T0, jwk }),
      row(key, { kid: 'name-b', notBefore: T0, jwk }),
    ],
  };
  assert.equal(epochHistoryKeyAllowed(twoNames, 'name-a', INSIDE), false);
});

test('public attestation minute window follows the shared not_after', () => {
  const key = issuerKey();
  const attested = '2026-06-01T12:00:00.000Z';
  function history(notAfter) {
    return historyFrom(key, [
      row(key, { notBefore: '2020-01-01T00:00:00.000Z' }),
      row(key, { notBefore: '2020-01-01T00:00:00.000Z', notAfter, status: 'retired' }),
    ]).doc;
  }
  function jwsFor(at) {
    const claims = {
      attested_at: at,
      iss: 'chit402',
      issued_at: at,
      log: { epoch: 1, leaf_hash: 'ab'.repeat(32), leaf_index: 1 },
      payment: {
        asset: USDC,
        gross_amount: '2000',
        payee: `0x${'33'.repeat(20)}`,
        rail: 'usdc',
        ref: `base:0x${'cd'.repeat(32)}`,
        settled_amount: '2000',
      },
      task_id: 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    };
    const header = { alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid: key.kid };
    const payload = publicReceiptPayload(claims);
    const input = `${b64url(header)}.${b64url(payload)}`;
    const signature = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
  }
  const jws = jwsFor(attested);
  const parsed = parsePublicAttestation(jws);
  assert.equal(parsed.ok, true, parsed.detail);

  const straddling = history('2026-06-01T12:00:30.000Z');
  const refused = verifyPublicAttestationTrust(parsed, straddling);
  assert.equal(refused.ok, false);
  assert.equal(refused.check, 'key_window');

  const inside = history('2026-06-01T12:02:00.000Z');
  const passed = verifyPublicAttestationTrust(parsed, inside);
  assert.equal(passed.ok, true, passed.reason);

  return verifyPublicShell({
    schema: 'chit402.receipt_shell.v1',
    task_id: 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    receipt_id: 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    public_attestation: { jws },
  }, {
    history: straddling,
    version: 'test',
    origin: 'http://127.0.0.1:9',
  }).then((verdict) => {
    assert.equal(verdict.exit_code, 1);
    assert.equal(verdict.checks.signature, 'pass');
    assert.equal(verdict.checks.key_window, 'fail');
    assert.equal(verdict.reason, 'key_window');
  });
});
