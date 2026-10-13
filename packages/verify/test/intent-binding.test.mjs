/**
 * Bundle 2 verifier checks. A well-formed v12 receipt verifies. Spend above
 * the intent, after expiry, or past the use count exits non-zero with
 * intent_violation. A different payer or payee is intent_mismatch.
 * 0.3.5 and 0.3.6 allowlists do not include payload version 12.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const {
  verifyReceipt,
  classifySignedClaims,
  comparatorPin,
  specDigest,
  intentCanonicalJson,
  INTENT_PROJECTION_SPEC,
  SPEND_COMPARATOR,
} = await import('../dist/index.js');
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const exported = publicKey.export({ format: 'jwk' });
const kid = 'intent-b2-kid';
const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig', kid };
const jwks = { keys: [jwk] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-v12-'));
const jwksPath = path.join(dir, 'jwks.json');
fs.writeFileSync(jwksPath, JSON.stringify(jwks));

const PAYER = '0x1111111111111111111111111111111111111111';
const PAYEE = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const UUID = '6f1e2d3c-4b5a-6978-8a7b-6c5d4e3f2a1b';

function signText(payloadText, typ = 'chit402-receipt+jwt', headerKid = kid) {
  const headerBody = { alg: 'ES256', typ };
  if (headerKid) headerBody.kid = headerKid;
  const header = Buffer.from(JSON.stringify(headerBody)).toString('base64url');
  const body = Buffer.from(payloadText).toString('base64url');
  const input = `${header}.${body}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function intentClaims(overrides = {}) {
  return {
    schema: 'chit402.intent.v1',
    intent_id: UUID,
    payer: PAYER,
    payee: PAYEE,
    asset: 'USDC',
    chain: 'eip155:8453',
    max_amount: '5000',
    expiry: '2026-10-20T00:00:00.000Z',
    use_count: 1,
    iat: '2026-10-01T00:00:00.000Z',
    iss: 'chit402',
    spec_digest: specDigest(),
    comparator_pin: comparatorPin(),
    ...overrides,
  };
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function intentDocument(claims) {
  const text = intentCanonicalJson(claims);
  const jws = signText(text, 'chit402-intent+jwt');
  const hash = sha256(text);
  return {
    schema: 'chit402.intent.v1',
    intent_id: claims.intent_id,
    intent_hash: hash,
    issuer_signature: { alg: 'ES256', kid, jws },
    hash,
    claims,
  };
}

function receiptFor(intent, overrides = {}) {
  const claims = {
    task_id: `chit-${UUID}`,
    iss: 'chit402',
    iat: '2026-10-13T12:00:00.000Z',
    payload_version: 12,
    payment: {
      rail: 'usdc',
      asset: 'USDC',
      gross_amount: '5000',
      payee: PAYEE,
    },
    caller_binding: { payer_wallet: PAYER },
    tree_head_hash: null,
    tolerance: { base: 300, solana: 150 },
    issuer_history: { head_hash: HEAD, entry_count: 1 },
    intent: {
      comparator_pin: intent.claims.comparator_pin,
      intent_hash: intent.hash,
      intent_id: intent.claims.intent_id,
      spec_digest: intent.claims.spec_digest,
      use_index: 1,
    },
    ...overrides,
  };
  if (overrides.intent === null) delete claims.intent;
  const text = intentCanonicalJson(claims);
  const jws = signText(text);
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', kid, jws, payload_version: 12 },
  };
}

function historyEntry(overrides = {}) {
  const entry = {
    kid,
    jwk,
    alg: 'ES256',
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'test key',
    prev_hash: null,
    ...overrides,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  return entry;
}

function signedHistory(entries, extra = {}) {
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    entry_count: entries.length,
    head_hash: head,
  };
  return {
    schema: 'chit402.issuer_history.v1',
    version: 1,
    seq: entries.length,
    entries,
    head_hash: head,
    issuer_signature: {
      alg: 'ES256',
      kid,
      jws: signText(JSON.stringify(claims), 'chit402-issuer-history+jwt'),
    },
    ...extra,
  };
}

const FIRST = historyEntry();
const HEAD = FIRST.entry_hash;

function historyDoc(extra = {}) {
  return signedHistory([FIRST], extra);
}

const opts = { jwks, trustedKids: [kid] };

function classify036(claims) {
  const hasV = Object.prototype.hasOwnProperty.call(claims, 'v');
  const hasPv = Object.prototype.hasOwnProperty.call(claims, 'payload_version');
  if (hasV && hasPv) return 'unsupported_version';
  if (hasV) return claims.v === 11 ? 'ok' : 'unsupported_version';
  const version = claims.payload_version;
  const legacy = Number.isInteger(version) && version >= 1 && version <= 10;
  const root = Number.isInteger(version) && version === 11
    && claims.issuer_root != null
    && typeof claims.issuer_root === 'object';
  if (!legacy && !root) return 'unsupported_version';
  return 'ok';
}

test('frozen pins are content addresses, not version labels', async () => {
  assert.equal(specDigest(), sha256(intentCanonicalJson(INTENT_PROJECTION_SPEC)));
  assert.equal(comparatorPin(), sha256(intentCanonicalJson(SPEND_COMPARATOR)));
  assert.equal(Object.prototype.hasOwnProperty.call(SPEND_COMPARATOR, 'version'), false);
  assert.equal(INTENT_PROJECTION_SPEC.absent.includes('cap_row_hash'), true);
  const gateway = await import('../../../services/gateway/src/intent-pins.js');
  assert.equal(gateway.specDigest(), specDigest());
  assert.equal(gateway.comparatorPin(), comparatorPin());
  assert.equal(gateway.intentHash({ a: 1, b: 'x' }), sha256(intentCanonicalJson({ a: 1, b: 'x' })));
});

test('a bound spend within the intent verifies', async () => {
  const intent = intentDocument(intentClaims());
  const receipt = receiptFor(intent);
  const result = await verifyReceipt(receipt, { ...opts, intent, issuerHistory: historyDoc({ comment: 'ignored by the pin' }) });
  assert.equal(result.overall, 'verified', result.errors.join('; '));
  assert.equal(result.receipt_version, 12);
  assert.equal(classify036(JSON.parse(Buffer.from(receipt.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'))), 'unsupported_version');
  assert.equal(classifySignedClaims(JSON.parse(Buffer.from(receipt.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8')), null).ok, true);
});

test('v12 without an intent block still verifies and a junk 12 does not', async () => {
  const intent = intentDocument(intentClaims());
  const bare = receiptFor(intent, { intent: null });
  const ok = await verifyReceipt(bare, { ...opts, issuerHistory: historyDoc() });
  assert.equal(ok.overall, 'verified', ok.errors.join('; '));
  const junk = receiptFor(intent);
  const payload = JSON.parse(Buffer.from(junk.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  payload.issuer_history = { hash: HEAD, version: 1, seq: 1 };
  payload.cap_row_hash = HEAD;
  const decision = classifySignedClaims(payload, null);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, 'unsupported_version');
});

test('spend, expiry, and use count are intent_violation and exit 1', async () => {
  const cases = [
    { claims: intentClaims(), receipt: { payment: { rail: 'usdc', asset: 'USDC', gross_amount: '5001', payee: PAYEE } } },
    { claims: intentClaims({ expiry: '2026-10-01T00:00:00.000Z' }), receipt: {} },
    { claims: intentClaims({ use_count: 1 }), receipt: { intentUse: 2 } },
  ];
  for (const row of cases) {
    const intent = intentDocument(row.claims);
    const overrides = {};
    if (row.receipt.payment) overrides.payment = row.receipt.payment;
    if (row.receipt.intentUse) {
      overrides.intent = {
        comparator_pin: row.claims.comparator_pin,
        intent_hash: intent.hash,
        intent_id: row.claims.intent_id,
        spec_digest: row.claims.spec_digest,
        use_index: row.receipt.intentUse,
      };
    }
    const receipt = receiptFor(intent, overrides);
    const result = await verifyReceipt(receipt, { ...opts, intent });
    assert.equal(result.overall, 'failed', result.errors.join('; '));
    assert.equal(result.errors.includes('intent_violation'), true, result.errors.join('; '));
    const label = String(row.receipt.intentUse || row.claims.expiry || 'amount').replace(/[^A-Za-z0-9._-]+/g, '-');
    const receiptPath = path.join(dir, `bad-${label}.json`);
    const intentPath = path.join(dir, `bad-intent-${path.basename(receiptPath)}`);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    fs.writeFileSync(intentPath, JSON.stringify(intent));
    const proc = spawnSync(process.execPath, [cli, receiptPath, '--intent', intentPath, '--jwks-file', jwksPath, '--no-trusted-kid', '--json'], {
      encoding: 'utf8',
    });
    assert.notEqual(proc.status, 0, proc.stdout + proc.stderr);
    assert.match(proc.stdout, /intent_violation/);
  }
});

test('another payer or payee is intent_mismatch', async () => {
  const intent = intentDocument(intentClaims());
  const otherPayer = receiptFor(intent, { caller_binding: { payer_wallet: OTHER } });
  const otherPayee = receiptFor(intent, {
    payment: { rail: 'usdc', asset: 'USDC', gross_amount: '5000', payee: OTHER },
  });
  for (const receipt of [otherPayer, otherPayee]) {
    const result = await verifyReceipt(receipt, { ...opts, intent });
    assert.equal(result.overall, 'failed');
    assert.equal(result.errors.includes('intent_mismatch'), true, result.errors.join('; '));
    assert.equal(result.errors.includes('intent_violation'), false);
  }
});

test('a history pin is head_hash plus entry_count, not the whole document', async () => {
  const intent = intentDocument(intentClaims());
  const receipt = receiptFor(intent);
  const mismatch = await verifyReceipt(receipt, {
    ...opts,
    intent,
    issuerHistory: historyDoc({ entry_count: 2, entries: [{ entry_hash: HEAD }, { entry_hash: 'cd'.repeat(32) }] }),
  });
  assert.equal(mismatch.overall, 'failed');
  assert.match(mismatch.errors.join('; '), /entry_hash_mismatch/);
  const extendedNote = await verifyReceipt(receipt, {
    ...opts,
    intent,
    issuerHistory: historyDoc({ whole_document_hash: 'ff'.repeat(32) }),
  });
  assert.equal(extendedNote.overall, 'verified', extendedNote.errors.join('; '));

  const next = historyEntry({ prev_hash: FIRST.entry_hash, reason: 'append' });
  const extended = signedHistory([FIRST, next]);
  const prefix = await verifyReceipt(receipt, { ...opts, intent, issuerHistory: extended });
  assert.equal(prefix.overall, 'verified', prefix.errors.join('; '));

  const forkFirst = historyEntry({ reason: 'fork' });
  const forkNext = historyEntry({ prev_hash: forkFirst.entry_hash, reason: 'fork-append' });
  const fork = await verifyReceipt(receipt, {
    ...opts,
    intent,
    issuerHistory: signedHistory([forkFirst, forkNext]),
  });
  assert.equal(fork.overall, 'failed');
  assert.match(fork.errors.join('; '), /issuer_history_not_extension/);

  const closed = historyEntry({ not_after: '2026-02-01T00:00:00.000Z' });
  const closedReceipt = receiptFor(intent, {
    issuer_history: { head_hash: closed.entry_hash, entry_count: 1 },
  });
  const window = await verifyReceipt(closedReceipt, {
    ...opts,
    intent,
    issuerHistory: signedHistory([closed]),
  });
  assert.equal(window.overall, 'failed');
  assert.match(window.errors.join('; '), /issued_after_not_after/);
});

test('an unpinned comparator or spec digest fails closed', async () => {
  const moved = intentClaims({ comparator_pin: '11'.repeat(32) });
  const intent = intentDocument(moved);
  const receipt = receiptFor(intent);
  const result = await verifyReceipt(receipt, { ...opts, intent });
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors.includes('comparator_unpinned'), true, result.errors.join('; '));

  const specMoved = intentClaims({ spec_digest: '22'.repeat(32) });
  const specIntent = intentDocument(specMoved);
  const specReceipt = receiptFor(specIntent);
  const specResult = await verifyReceipt(specReceipt, { ...opts, intent: specIntent });
  assert.equal(specResult.errors.includes('spec_digest_mismatch'), true, specResult.errors.join('; '));
});

test('intent_hash covers signed bytes only', async () => {
  const claims = intentClaims({ merchant: 'Amex Merchant Plaza' });
  const intent = intentDocument(claims);
  const receipt = receiptFor(intent);
  const result = await verifyReceipt(receipt, { ...opts, intent });
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors.includes('intent_mismatch'), true, result.errors.join('; '));
});

test('an intent JWS with no kid does not fall back to the only JWKS key', async () => {
  const claims = intentClaims();
  const text = intentCanonicalJson(claims);
  const jws = signText(text, 'chit402-intent+jwt', null);
  const hash = sha256(text);
  const intent = {
    schema: 'chit402.intent.v1',
    intent_id: claims.intent_id,
    intent_hash: hash,
    hash,
    issuer_signature: { alg: 'ES256', kid, jws },
    claims,
  };
  const receipt = receiptFor(intent);
  const result = await verifyReceipt(receipt, { ...opts, intent, issuerHistory: historyDoc() });
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors.includes('intent_mismatch'), true, result.errors.join('; '));
});

test('CLI without the intent file does not pass a bound receipt', async () => {
  const intent = intentDocument(intentClaims());
  const receipt = receiptFor(intent);
  const receiptPath = path.join(dir, 'missing-intent.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const proc = spawnSync(process.execPath, [cli, receiptPath, '--jwks-file', jwksPath, '--no-trusted-kid', '--json'], {
    encoding: 'utf8',
  });
  assert.equal(proc.status, 1, proc.stdout + proc.stderr);
  assert.match(proc.stdout, /intent_missing/);
});
