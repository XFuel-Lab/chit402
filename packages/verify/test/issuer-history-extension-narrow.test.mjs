/**
 * Issuer-history extensions may only narrow the bundled snapshot.
 * Keys for heads, fixed heads, epoch records and legacy value signatures
 * come from the bundled rows or the pins. History documents are signed by
 * pinned keys only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const { jcsCanonicalize } = await import('../dist/jcs.js');
const {
  issuerHistoryEntryHash,
  issuerKeyWindow,
  resolveIssuerHistory,
  loadBundledIssuerHistory,
} = await import('../dist/issuer-history.js');
const { verifyTreeHeadTrust, PINNED_BASE_ANCHOR_WALLET } = await import('../dist/anchor-trust.js');
const { verifyReceipt, legacyReceiptFingerprint, canonicalIssuerPayload } = await import('../dist/index.js');
const { checkReceiptInput, epochRecordSignatureOk, fixedHeadOutcome, freshPublicLog } = await import('../dist/check-input.js');
const { leafHash } = await import('../dist/anchor-witness.js');
const { TEST_SNAPSHOT, parseLegacyAllowlistForTest } = await import('../dist/internal/test-seam.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const Eip = await import('../dist/eip712.js');

const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const SNAPSHOT_SHA256 = 'b5ecff74a0c5a493268c100ab164b641a5cb2bed8792d0526a997d9d5aa7b07d';
const V1_SNAPSHOT_SHA256 = 'e20d606904df1fe71ab96d8f71100d50ce1a3686fa099b3af3d92b8d8b79f1e8';
const LEGACY_ALLOWLIST_SHA256 = 'ee1498f90cc098b62fdd54dc4378b63d8951366dd9810295f9db8f964d10f3e9';
const HONEST_JSON = `{
  "result": "could_not_check",
  "exit_code": 2,
  "reason": "log_unreachable",
  "message": "The receipt log or anchor could not be fetched.",
  "next_step": "Fetch the log and the anchor again, then re-run.",
  "receipt_id": "xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96",
  "display_id": "xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96",
  "payload_version": 6,
  "checks": {
    "signature": "pass",
    "key_window": "pass",
    "payment_binding": "could_not_check",
    "log_inclusion": "could_not_check",
    "anchor": "could_not_check",
    "shape": "pass"
  },
  "history": {
    "source": "bundled",
    "head_hash": "349d7bb495bad55aaa25d05ee91134575e6e7d300795b37b41f4bcf29af80f0e",
    "entry_count": 1,
    "as_of": "2026-10-14"
  },
  "log": null,
  "verifier": {
    "name": "chit402-verify",
    "version": "0.5.0-pre.0"
  }
}
`;

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function b64(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const input = `${b64(header)}.${b64(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

function entryFor(key, fields) {
  const body = {
    kid: fields.kid || key.kid,
    jwk: fields.jwk || key.publicJwk,
    alg: 'ES256',
    not_before: fields.notBefore,
    not_after: fields.notAfter ?? null,
    status: fields.status || 'active',
    revoked_at: fields.revokedAt ?? null,
    reason: fields.reason ?? null,
    prev_hash: fields.prev ?? null,
  };
  if (fields.custody !== undefined) body.custody = fields.custody;
  return { ...body, entry_hash: issuerHistoryEntryHash(body) };
}

function historyOf(entries, signer, version, seq) {
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: head,
    version,
    seq,
  };
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version,
    seq,
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
  const bytes = JSON.stringify(doc);
  return { doc, bytes, head };
}

function asBundle(packed) {
  return { document: packed.doc, bytes: packed.bytes };
}

function bundlePair() {
  const k1 = issuerKey();
  const genesis = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z' });
  const bundled = historyOf([genesis], k1, 2, 2);
  return { k1, genesis, bundled };
}

function withEntry(base, entry, signer, version, seq) {
  return historyOf([...base.doc.entries, entry], signer, version, seq);
}

function productionDoc() {
  return loadBundledIssuerHistory().document;
}

function extendProduction(signer, extra, version, seq) {
  const base = structuredClone(productionDoc());
  const entries = [...base.entries, extra];
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: head,
    version,
    seq,
  };
  const doc = {
    ...base,
    version,
    seq,
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
  return { doc, bytes: JSON.stringify(doc), head };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function assertLoopback(url) {
  const host = new URL(String(url)).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`refusing non-loopback host ${host}`);
  }
}

function loopbackFetch(port, realFetch) {
  return async (url, init) => {
    const local = new URL(String(url));
    local.protocol = 'http:';
    local.hostname = '127.0.0.1';
    local.port = String(port);
    assertLoopback(local);
    return realFetch(local, init);
  };
}

function sealHead(body, key, { embed = true } = {}) {
  const claims = JSON.parse(JSON.stringify(body));
  const jws = signClaims(claims, key, 'chit402-tree-head+jwt');
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      jws,
      kid: key.kid,
      ...(embed ? { issuer_jwk: key.publicJwk } : {}),
    },
  };
}

function fixedHeadFor(claims, key) {
  const message = Eip.treeHeadMessageFromClaims(claims, key.kid);
  const { preimage } = Eip.typedDigest('TreeHead', message, Eip.EXPECTED_LOG_SALT);
  const raw = sign('sha256', preimage, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    schema: Eip.FIXED_HEAD_SCHEMA,
    digest_alg: Eip.EIP712_DIGEST_ALG,
    domain: { name: Eip.TREE_HEAD_DOMAIN_NAME, version: '1', chainId: Eip.EIP712_CHAIN_ID, salt: Eip.EXPECTED_LOG_SALT },
    types: Eip.TREE_HEAD_TYPE,
    message,
    r: `0x${raw.subarray(0, 32).toString('hex')}`,
    s: `0x${raw.subarray(32).toString('hex')}`,
  };
}

function receiptClaims(k1) {
  return {
    task_id: `task-narrow-${k1.kid.slice(0, 8)}`,
    iss: 'chit402',
    iat: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    payload_version: 8,
    payment: {
      rail: 'usdc',
      ref: `base:0x${'ab'.repeat(32)}`,
      gross_amount: '2000',
      settled_amount: '2000',
      payee: `0x${'22'.repeat(20)}`,
    },
    caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
  };
}

function writeReceipt(receipt) {
  const dir = tempDir('chit-narrow-receipt-');
  const path = join(dir, 'receipt.json');
  writeFileSync(path, JSON.stringify(receipt));
  return path;
}

function signedReceipt(key, claims) {
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

test('file: an extension adding a new kid row is refused (extension_adds_key)', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const extension = withEntry(bundled, added, k1, 3, 3);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'extension_adds_key');
  assert.equal(resolved.source, 'file');
});

test('live: an extension adding a new kid row is ignored and the bundled snapshot is used', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const extension = withEntry(bundled, added, k1, 3, 3);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(extension.bytes);
  });
  const port = await listen(server);
  try {
    const resolved = await resolveIssuerHistory({
      bundledOverride: asBundle(bundled),
      receipt: { verify_url: 'https://api.chit402.com/receipt/live-narrow' },
      fetchImpl: loopbackFetch(port, globalThis.fetch),
      trustedKids: [k1.kid],
    });
    assert.equal(resolved.invalid, false);
    assert.equal(resolved.source, 'bundled');
    assert.equal(resolved.document?.head_hash, bundled.doc.head_hash);
    assert.equal(resolved.entryCount, 1);
  } finally {
    server.close();
  }
});

test('an extension changing a bundled kid\'s JWK is refused (extension_changes_key)', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const swapped = issuerKey();
  const changed = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'revoked',
    revokedAt: '2026-11-01T00:00:00Z',
    jwk: swapped.publicJwk,
    kid: k1.kid,
  });
  const extension = withEntry(bundled, changed, k1, 3, 3);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'extension_changes_key');
});

test('an extension adding a contracts member or an unknown field is refused', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const retired = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2026-12-01T00:00:00Z',
  });
  const narrowing = withEntry(bundled, retired, k1, 3, 3);
  const withContracts = structuredClone(narrowing.doc);
  withContracts.contracts = { base: '0x0000000000000000000000000000000000000001' };
  const contracts = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: JSON.stringify(withContracts),
    trustedKids: [k1.kid],
  });
  assert.equal(contracts.invalid, true);
  assert.equal(contracts.reason, 'extension_adds_contract');

  const payload = Buffer.from(narrowing.doc.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8');
  const claims = JSON.parse(payload);
  claims.contracts = { solana: 'x' };
  const resigned = structuredClone(narrowing.doc);
  resigned.issuer_signature = {
    ...resigned.issuer_signature,
    jws: signClaims(claims, k1, 'chit402-issuer-history+jwt'),
  };
  const inPayload = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: JSON.stringify(resigned),
    trustedKids: [k1.kid],
  });
  assert.equal(inPayload.invalid, true);
  assert.equal(inPayload.reason, 'extension_adds_contract');

  const unknown = structuredClone(narrowing.doc);
  unknown.note = 'not-in-bundle';
  const extra = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: JSON.stringify(unknown),
    trustedKids: [k1.kid],
  });
  assert.equal(extra.invalid, true);
  assert.equal(extra.reason, 'extension_unknown_field');
});

test('a revoked or retired entry for a bundled kid is accepted and narrows the window', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const retired = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2026-11-01T00:00:00Z',
  });
  const retireDoc = withEntry(bundled, retired, k1, 3, 3);
  const retiredResolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: retireDoc.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(retiredResolved.invalid, false, retiredResolved.reason);
  assert.equal(retiredResolved.source, 'file');
  const late = issuerKeyWindow(retiredResolved.document, k1.kid, '2026-12-01T00:00:00Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'issued_after_not_after');
  const early = issuerKeyWindow(retiredResolved.document, k1.kid, '2026-10-01T00:00:00Z');
  assert.equal(early.ok, true, early.reason);

  const revoked = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'revoked',
    revokedAt: '2026-11-01T00:00:00Z',
  });
  const revokeDoc = withEntry(bundled, revoked, k1, 4, 4);
  const revokedResolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: revokeDoc.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(revokedResolved.invalid, false, revokedResolved.reason);
  const after = issuerKeyWindow(revokedResolved.document, k1.kid, '2026-12-01T00:00:00Z');
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'kid_revoked_before_issuance');
});

test('an extension signed by a kid revoked in the bundle is refused (issuer_history_signer_inactive)', async () => {
  const k1 = issuerKey();
  const active = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z' });
  const revoked = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: active.entry_hash,
    status: 'revoked',
    revokedAt: '2026-10-01T00:00:00Z',
  });
  const bundled = historyOf([active, revoked], k1, 4, 4);
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: revoked.entry_hash });
  const extension = historyOf([...bundled.doc.entries, added], k1, 5, 5);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'issuer_history_signer_inactive');
});

test('an extension signed by a kid retired in the bundle is refused', async () => {
  const k1 = issuerKey();
  const active = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z' });
  const retired = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: active.entry_hash,
    status: 'retired',
    notAfter: '2026-10-01T00:00:00Z',
  });
  const bundled = historyOf([active, retired], k1, 4, 4);
  const again = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: retired.entry_hash,
    status: 'revoked',
    revokedAt: '2026-10-15T00:00:00Z',
  });
  const extension = historyOf([...bundled.doc.entries, again], k1, 5, 5);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'issuer_history_signer_inactive');
});

test('un-revoke, earlier not_before and later not_after stay refused or ineffective', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const unrevoke = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'revoked',
    revokedAt: '2026-10-01T00:00:00Z',
  });
  const revokedDoc = withEntry(bundled, unrevoke, k1, 3, 3);
  const back = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: unrevoke.entry_hash,
    status: 'active',
  });
  const restored = historyOf([...revokedDoc.doc.entries, back], k1, 4, 4);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: restored.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'kid_status_regression');

  const earlier = entryFor(k1, {
    notBefore: '2026-01-01T00:00:00Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2026-12-01T00:00:00Z',
  });
  const widened = withEntry(bundled, earlier, k1, 3, 3);
  const moved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: widened.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(moved.invalid, true);
  assert.equal(moved.reason, 'kid_status_regression');

  const closed = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2026-10-01T00:00:00Z',
  });
  const closedDoc = withEntry(bundled, closed, k1, 3, 3);
  const later = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: closed.entry_hash,
    status: 'retired',
    notAfter: '2027-01-01T00:00:00Z',
  });
  const laterDoc = historyOf([...closedDoc.doc.entries, later], k1, 4, 4);
  const laterResolved = await resolveIssuerHistory({
    bundledOverride: asBundle(closedDoc),
    fileBytes: laterDoc.bytes,
    trustedKids: [k1.kid],
  });
  if (!laterResolved.invalid) {
    const window = issuerKeyWindow(laterResolved.document, k1.kid, '2026-11-01T00:00:00Z');
    assert.equal(window.ok, false);
    assert.equal(window.reason, 'issued_after_not_after');
  }
});

test('tree head signed by an extension-only kid is untrusted (head_key_untrusted)', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const extension = withEntry(bundled, added, k1, 3, 3);
  const headBody = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  };
  const head = sealHead(headBody, k2, { embed: false });
  const snap = { [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } } };
  const trusted = verifyTreeHeadTrust(head, { trustedKids: [k1.kid], issuerHistory: extension.doc, ...snap });
  assert.equal(trusted.ok, false);
  assert.equal(trusted.reason, 'head_key_untrusted');

  const control = verifyTreeHeadTrust(head, { trustedKids: [k1.kid], issuerHistory: bundled.doc, ...snap });
  assert.equal(control.ok, false);
  assert.equal(control.reason, 'head_key_untrusted');

  const revokedRow = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'revoked',
    revokedAt: '2026-10-01T00:00:00Z',
  });
  const b2 = historyOf([genesis, revokedRow], k1, 4, 4);
  const addedAfter = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: revokedRow.entry_hash });
  const e2 = historyOf([...b2.doc.entries, addedAfter], k1, 5, 5);
  const snap2 = { [TEST_SNAPSHOT]: { issuerHistory: { document: b2.doc, bytes: b2.bytes } } };
  const afterRevoke = verifyTreeHeadTrust(head, { trustedKids: [k1.kid], issuerHistory: e2.doc, ...snap2 });
  assert.equal(afterRevoke.ok, false);
  assert.equal(afterRevoke.reason, 'head_key_untrusted');

  const row = 'cd'.repeat(32);
  const task = 'xfuel-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const leaf = leafHash(Buffer.from(`${task}|${row}`)).toString('hex');
  const logHead = sealHead({ ...headBody, root: leaf, tree_size: 1 }, k2, { embed: false });
  const claims = receiptClaims(k1);
  claims.task_id = task;
  const receipt = signedReceipt(k1, claims);
  receipt.verify_url = 'https://api.chit402.com/receipt/live-head';
  const routes = new Map([
    ['/.well-known/issuer-history.json', extension.bytes],
    [`/v1/receipts/${task}/inclusion`, JSON.stringify({
      task_id: task, leaf_index: 0, tree_size: 1, root: leaf, row_hash: row, proof: [],
    })],
    ['/v1/receipts/tree/head?tree_size=1', JSON.stringify(logHead)],
  ]);
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const body = routes.get(req.url) || '';
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(body || '{}');
  });
  const port = await listen(server);
  const previous = globalThis.fetch;
  globalThis.fetch = loopbackFetch(port, previous);
  try {
    const outcome = await checkReceiptInput(writeReceipt(receipt), {
      trustedKids: [k1.kid],
      checkPayer: false,
      [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
    });
    assert.equal(outcome.verdict.reason, 'head_key_untrusted', `${outcome.verdict.reason} ${JSON.stringify(outcome.verdict.checks)} urls=${seen.join(' ')}`);
    assert.equal(outcome.verdict.exit_code, 1);
  } finally {
    globalThis.fetch = previous;
    server.close();
  }
});

test('fixed head whose key exists only in an extension row is refused', async () => {
  const signer = issuerKey();
  const k2 = issuerKey();
  const prod = productionDoc();
  const prev = prod.entries[prod.entries.length - 1].entry_hash;
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev });
  const extension = extendProduction(signer, added, 3, 3);
  const headBody = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    epoch: 2,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  };
  const head = sealHead(headBody, k2, { embed: false });
  head.fixed_head = fixedHeadFor(headBody, k2);
  const outcome = fixedHeadOutcome(head, extension.doc, [signer.kid, PRODUCTION_KID]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'key');

  const { k1, genesis, bundled } = bundlePair();
  const extra = entryFor(issuerKey(), { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const fileExt = withEntry(bundled, extra, k1, 3, 3);
  const receipt = signedReceipt(k1, receiptClaims(k1));
  const checked = await checkReceiptInput(writeReceipt(receipt), {
    issuerHistoryBytes: fileExt.bytes,
    trustedKids: [k1.kid],
    checkPayer: false,
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(checked.verdict.exit_code, 1);
  assert.equal(checked.verdict.reason, 'extension_adds_key');
});

test('epoch record signed by an extension-only kid is refused', async () => {
  const signer = issuerKey();
  const k2 = issuerKey();
  const prod = productionDoc();
  const prev = prod.entries[prod.entries.length - 1].entry_hash;
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev });
  const extension = extendProduction(signer, added, 3, 3);
  const claims = {
    schema: 'chit402.tree_epoch.v1',
    payload_version: 1,
    epochs: [{ epoch: 1 }],
    orphans: [],
    unlogged: null,
  };
  const jws = signClaims(claims, k2, 'chit402-tree-epoch+jwt');
  const record = { ...claims, issuer_signature: { jws, kid: k2.kid, issuer_jwk: k2.publicJwk } };
  assert.equal(epochRecordSignatureOk(record, jws, extension.doc, '2026-10-31T00:00:00.000Z'), false);

  const row = 'ef'.repeat(32);
  const task = 'xfuel-bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  const leaf = leafHash(Buffer.from(`${task}|${row}`)).toString('hex');
  const logHead = sealHead({
    schema: 'chit402.tree_head.v2',
    payload_version: 1,
    root: leaf,
    tree_size: 1,
    epoch: 2,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  }, k2, { embed: false });
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith('/v1/receipts/tree/epoch')) return send(record);
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(logHead);
    if (req.url.includes('/inclusion')) {
      return send({ task_id: task, leaf_index: 0, tree_size: 1, root: leaf, row_hash: row, proof: [] });
    }
    res.writeHead(404);
    res.end('{}');
  });
  const port = await listen(server);
  try {
    const fresh = await freshPublicLog(
      { verify_url: `http://127.0.0.1:${port}/receipt/${task}`, task_id: task },
      extension.doc,
      { trustedKids: [signer.kid, PRODUCTION_KID] },
    );
    assert.notEqual(fresh.logInclusion, 'pass');
    assert.notEqual(fresh.anchor, 'pass');
  } finally {
    server.close();
  }
});

function detachedReceipt(key) {
  const receipt = {
    task_id: 'xfuel-ccccccc1-dddd-4eee-8fff-000000000001',
    status: 'completed',
    created_at: '2026-10-22T12:00:00.000Z',
    payment: { rail: 'usdc', gross_amount: '1000' },
  };
  const value = sign('sha256', Buffer.from(canonicalIssuerPayload(receipt), 'utf8'), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  receipt.issuer_signature = { alg: 'ES256', value, kid: key.kid };
  return receipt;
}

function allowSnapshot(receipt) {
  const fp = legacyReceiptFingerprint(receipt);
  const bytes = JSON.stringify({
    schema: 'chit402.legacy_allowlist.v1',
    status: 'final',
    entries: [fp],
  });
  return parseLegacyAllowlistForTest(bytes, { unpinnedForTest: true });
}

test('detached value receipt on a test allowlist, signed by an extension-only kid, is untrusted', async () => {
  const signer = issuerKey();
  const k2 = issuerKey();
  const prod = productionDoc();
  const prev = prod.entries[prod.entries.length - 1].entry_hash;
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev });
  const extension = extendProduction(signer, added, 3, 3);
  const receipt = detachedReceipt(k2);
  const list = allowSnapshot(receipt);
  const result = await verifyReceipt(receipt, {
    issuerHistory: extension.doc,
    issuerHistoryBytes: extension.bytes,
    trustedKids: [PRODUCTION_KID, signer.kid],
    requirePreimages: false,
    checkPayer: false,
    [TEST_SNAPSHOT]: { legacyAllowlist: list },
  });
  assert.equal(result.issuer_signature.valid, false);
  assert.notEqual(result.issuer_signature.trust, 'pinned_kid');
  assert.notEqual(result.errors.includes('legacy_form_not_allowlisted'), true);
});

test('detached value receipt not on the allowlist is refused before key trust (legacy_form_not_allowlisted)', async () => {
  const signer = issuerKey();
  const k2 = issuerKey();
  const prod = productionDoc();
  const prev = prod.entries[prod.entries.length - 1].entry_hash;
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev });
  const extension = extendProduction(signer, added, 3, 3);
  const receipt = detachedReceipt(k2);
  const result = await verifyReceipt(receipt, {
    issuerHistory: extension.doc,
    issuerHistoryBytes: extension.bytes,
    trustedKids: [PRODUCTION_KID, signer.kid],
    requirePreimages: false,
    checkPayer: false,
  });
  assert.equal(result.errors.includes('legacy_form_not_allowlisted'), true);
  assert.equal(result.issuer_signature?.valid === true, false);
});

test('caller JWKS keys never sign an issuer-history document (resolve file, live, tree-head paths)', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const retired = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2026-12-01T00:00:00Z',
  });
  const narrowing = withEntry(bundled, retired, k1, 3, 3);
  const jwks = { keys: [k1.publicJwk] };
  const file = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: narrowing.bytes,
    trustedKids: [],
    jwks,
  });
  assert.equal(file.invalid, true);
  assert.notEqual(file.reason, null);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(narrowing.bytes);
  });
  const port = await listen(server);
  try {
    const live = await resolveIssuerHistory({
      bundledOverride: asBundle(bundled),
      receipt: { verify_url: 'https://api.chit402.com/receipt/jwks-live' },
      fetchImpl: loopbackFetch(port, globalThis.fetch),
      trustedKids: [],
      jwks,
    });
    assert.equal(live.source, 'bundled');
    assert.notEqual(live.document?.head_hash, narrowing.doc.head_hash);
  } finally {
    server.close();
  }

  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 1,
    published_at: '2026-10-01T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  }, k1, { embed: false });
  const trust = verifyTreeHeadTrust(head, {
    trustedKids: [],
    jwks,
    issuerHistory: bundled.doc,
  });
  assert.equal(trust.ok, false);
  assert.equal(trust.reason, 'issuer_history_invalid');
});

test('CLI: --issuer-history with an add-key extension exits with main\'s invalid-history code; a narrowing extension exits 0', async () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const house = JSON.parse(readFileSync(new URL('./fixtures/public/chit-1ebc5616.json', import.meta.url), 'utf8'));
  delete house.verify_url;
  if (house.verification) delete house.verification.jwks_uri;
  const dir = tempDir('chit-narrow-cli-');
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(house));
  const v1 = readFileSync(new URL('./fixtures/issuer-history-v1-bundle.json', import.meta.url));
  const v1Path = join(dir, 'v1.json');
  writeFileSync(v1Path, v1);
  const known = spawnSync(process.execPath, [cli, receiptPath, '--json', '--issuer-history', v1Path], { encoding: 'utf8' });
  assert.equal(known.status, 1, known.stdout);
  assert.equal(JSON.parse(known.stdout).reason, 'issuer_history_not_extension');

  const { k1, genesis, bundled } = bundlePair();
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const extension = withEntry(bundled, added, k1, 3, 3);
  const addPath = join(dir, 'add.json');
  writeFileSync(addPath, extension.bytes);
  const addedRun = spawnSync(process.execPath, [cli, receiptPath, '--json', '--issuer-history', addPath], { encoding: 'utf8' });
  assert.equal(addedRun.status, known.status, addedRun.stdout);

  const libraryReceipt = signedReceipt(k1, receiptClaims(k1));
  const refused = await checkReceiptInput(writeReceipt(libraryReceipt), {
    issuerHistoryBytes: extension.bytes,
    trustedKids: [k1.kid],
    checkPayer: false,
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(refused.verdict.exit_code, known.status);
  assert.equal(refused.verdict.reason, 'extension_adds_key');

  const retired = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    prev: genesis.entry_hash,
    status: 'retired',
    notAfter: '2027-01-01T00:00:00Z',
  });
  const narrowing = withEntry(bundled, retired, k1, 3, 3);
  const row = '11'.repeat(32);
  const task = 'xfuel-11111111-2222-4333-8444-555555555555';
  const leaf = leafHash(Buffer.from(`${task}|${row}`)).toString('hex');
  const root = leaf;
  const anchorTx = `0x${'ab'.repeat(32)}`;
  const payTx = `0x${'cd'.repeat(32)}`;
  const payee = `0x${'22'.repeat(20)}`;
  const payer = `0x${'11'.repeat(20)}`;
  const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const topic = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
  const headBody = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 1,
    published_at: '2026-10-01T00:00:00.000Z',
    anchors: {
      base: { status: 'anchored', tx: anchorTx, calldata: `0x${root}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET },
      solana: { status: 'pending' },
    },
  };
  const head = sealHead(headBody, k1);
  const claims = {
    task_id: task,
    payload_version: 8,
    iat: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
    payment: { rail: 'usdc', ref: `base:${payTx}`, asset: usdc, payee, gross_amount: '2000', settled_amount: '2000' },
    caller_binding: { payer_wallet: payer },
  };
  const holder = signedReceipt(k1, claims);
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const hash = msg.params?.[0];
        let result = null;
        if (msg.method === 'eth_chainId') result = '0x2105';
        else if (msg.method === 'eth_blockNumber') result = '0x80';
        else if (msg.method === 'eth_getTransactionByHash' && hash === anchorTx) {
          result = { hash: anchorTx, input: `0x${root}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(), blockNumber: '0x64', chainId: '0x2105' };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === anchorTx) {
          result = { transactionHash: anchorTx, status: '0x1', blockNumber: '0x64', from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === payTx) {
          result = {
            transactionHash: payTx,
            status: '0x1',
            blockNumber: '0x64',
            logs: [{ address: usdc, topics: [transfer, topic(payer), topic(payee)], data: `0x${(2000).toString(16).padStart(64, '0')}` }],
          };
        }
        send(200, { jsonrpc: '2.0', id: msg.id, result });
      });
      return;
    }
    if (req.url.includes('/inclusion')) {
      return send(200, { task_id: task, leaf_index: 0, tree_size: 1, root, row_hash: row, proof: [] });
    }
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, head);
    send(404, { error: 'not_found' });
  });
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  holder.verify_url = `${origin}/receipt/${task}`;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = loopbackFetch(port, previousFetch);
  const previousBase = process.env.BASE_RPC_URL;
  const previousSol = process.env.SOLANA_RPC_URL;
  process.env.BASE_RPC_URL = `${origin}/rpc`;
  process.env.SOLANA_RPC_URL = `${origin}/rpc`;
  try {
    const good = await checkReceiptInput(writeReceipt(holder), {
      issuerHistoryBytes: narrowing.bytes,
      trustedKids: [k1.kid],
      checkPayer: true,
      rpcUrl: `${origin}/rpc`,
      solanaRpcUrl: `${origin}/rpc`,
      [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
    });
    assert.equal(good.verdict.exit_code, 0, JSON.stringify(good.verdict));
    assert.equal(good.verdict.result, 'verified');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = previousBase;
    if (previousSol === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = previousSol;
    server.close();
  }
});

test('honest receipt --json output with no --issuer-history is byte-identical to the pinned main output', () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const house = JSON.parse(readFileSync(new URL('./fixtures/public/chit-1ebc5616.json', import.meta.url), 'utf8'));
  delete house.verify_url;
  if (house.verification) delete house.verification.jwks_uri;
  const dir = tempDir('honest-json-');
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(house));
  const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9', SOLANA_RPC_URL: 'http://127.0.0.1:9' };
  const run = spawnSync(process.execPath, [cli, receiptPath, '--json'], { encoding: 'utf8', env });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, HONEST_JSON);
});

test('source scan: CLI accepts only --issuer-history, --json and the existing help/version flags', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/--issuer-history <file>/.test(src), 'help names --issuer-history');
  assert.ok(/--json/.test(src), 'help names --json');
  assert.ok(/-h, --help/.test(src), 'help names help');
  assert.ok(/-V, --version/.test(src), 'help names version');
  assert.ok(/'--no-issuer-history': 'removed in 0\.4: the history check is always on'/.test(src), 'history check stays on');
  assert.ok(/else if \(arg === '--issuer-history' && argv\[i \+ 1\]\) \{\n\s+parsed\.issuerHistoryFile = argv\[\+\+i\];\n\s+\} else if \(!arg\.startsWith\('-'\) \|\| arg === '-'\)/.test(src), 'parser consumes only --issuer-history before positionals');
  assert.ok(/if \(arg === '--json' \|\| arg === '--help' \|\| arg === '-h' \|\| arg === '--version' \|\| arg === '-V'\) continue;/.test(src), 'removed-flag scan allows only json, help and version');
});

test('a non-loopback host is refused before any request', () => {
  assert.throws(() => assertLoopback('https://api.chit402.com/receipt/x'), /non-loopback/);
  assert.doesNotThrow(() => assertLoopback('http://127.0.0.1:9/receipt/x'));
});

test('an appended active row for a bundled kid is refused (extension_not_narrowing)', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const again = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z', prev: genesis.entry_hash, status: 'active' });
  const extension = withEntry(bundled, again, k1, 3, 3);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'extension_not_narrowing');
  assert.equal(resolved.source, 'file');
});

test('a later not_after on an active row is refused (extension_not_narrowing)', async () => {
  const k1 = issuerKey();
  const first = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z', notAfter: '2026-11-01T00:00:00Z' });
  const bundled = historyOf([first], k1, 2, 2);
  const later = entryFor(k1, {
    notBefore: '2026-09-04T08:52:05Z',
    notAfter: '2027-01-01T00:00:00Z',
    prev: first.entry_hash,
    status: 'active',
  });
  const extension = historyOf([first, later], k1, 3, 3);
  const resolved = await resolveIssuerHistory({
    bundledOverride: asBundle(bundled),
    fileBytes: extension.bytes,
    trustedKids: [k1.kid],
  });
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.reason, 'extension_not_narrowing');
});

test('a legacy history is not accepted by comparing the document to itself', async () => {
  const { k1, genesis, bundled } = bundlePair();
  const k2 = issuerKey();
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: genesis.entry_hash });
  const extension = withEntry(bundled, added, k1, 3, 3);
  const { pinnedLegacyHistory } = await import('../dist/index.js');
  const picked = pinnedLegacyHistory({
    issuerHistory: extension.doc,
    trustedKids: [k1.kid],
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(picked?.head_hash, bundled.doc.head_hash);
  assert.equal((picked?.entries || []).some((entry) => entry.kid === k2.kid), false);
});

test('anchor wallets ignore a history signed only by a caller JWKS key', async () => {
  const { compileAnchorWallets } = await import('../dist/anchor-trust.js');
  const signer = issuerKey();
  signer.publicJwk = { ...signer.publicJwk, kid: 'label-not-a-pin' };
  const wallet = `0x${'ab'.repeat(20)}`;
  const body = {
    kid: 'label-not-a-pin',
    jwk: signer.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 1,
    head_hash: entry.entry_hash,
    version: 1,
    seq: 1,
    anchor_wallets: { base: [wallet], solana: [] },
  };
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 1,
    seq: 1,
    entries: [entry],
    head_hash: entry.entry_hash,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: signClaims(claims, { ...signer, kid: 'label-not-a-pin' }, 'chit402-issuer-history+jwt'),
      kid: 'label-not-a-pin',
      issuer_jwk: signer.publicJwk,
    },
  };
  const compiled = compileAnchorWallets({
    jwks: { keys: [signer.publicJwk] },
    trustedKids: [PRODUCTION_KID],
    issuerHistory: doc,
  });
  assert.equal(compiled.sources.includes('issuer_history'), false);
  assert.equal(compiled.base.includes(wallet), false);
});

function forkOf(base, k1, k2) {
  const rewritten = entryFor(k1, { notBefore: '2026-12-01T00:00:00Z' });
  const added = entryFor(k2, { notBefore: '2026-12-15T00:00:00Z', prev: rewritten.entry_hash });
  return historyOf([rewritten, added], k1, 9, 9);
}

test('a fork history does not supply a tree-head key (head_key_untrusted)', () => {
  const { k1, bundled } = bundlePair();
  const k2 = issuerKey();
  const fork = forkOf(bundled, k1, k2);
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  }, k2, { embed: false });
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [k1.kid],
    issuerHistory: fork.doc,
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(trusted.ok, false);
  assert.equal(trusted.reason, 'head_key_untrusted');
  assert.equal(trusted.trust, null);
});

test('a fork history does not supply a fixed-head key (key)', () => {
  const prod = productionDoc();
  const k1 = { kid: prod.entries[0].kid, publicJwk: prod.entries[0].jwk, privateKey: null };
  const signer = issuerKey();
  const k2 = issuerKey();
  const rewritten = entryFor(k2, { notBefore: '2026-01-01T00:00:00Z', kid: prod.entries[0].kid, jwk: prod.entries[0].jwk });
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: rewritten.entry_hash });
  const fork = historyOf([rewritten, added], signer, 9, 9);
  const headBody = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    epoch: 2,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  };
  const head = sealHead(headBody, k2, { embed: false });
  head.fixed_head = fixedHeadFor(headBody, k2);
  const outcome = fixedHeadOutcome(head, fork.doc, [signer.kid, PRODUCTION_KID]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'key');
  void k1;
});

test('a fork history does not supply an epoch-record key', () => {
  const prod = productionDoc();
  const signer = issuerKey();
  const k2 = issuerKey();
  const rewritten = entryFor(k2, { notBefore: '2026-01-01T00:00:00Z', kid: prod.entries[0].kid, jwk: prod.entries[0].jwk });
  const added = entryFor(k2, { notBefore: '2026-10-30T00:00:00Z', prev: rewritten.entry_hash });
  const fork = historyOf([rewritten, added], signer, 9, 9);
  const claims = { schema: 'chit402.tree_epoch.v1', payload_version: 1, epochs: [{ epoch: 1 }], orphans: [], unlogged: null };
  const jws = signClaims(claims, k2, 'chit402-tree-epoch+jwt');
  const record = { ...claims, issuer_signature: { jws, kid: k2.kid } };
  assert.equal(epochRecordSignatureOk(record, jws, fork.doc, '2026-10-31T00:00:00.000Z'), false);
});

test('verifyReceipt ignores a fork window and a fork tree-head key', async () => {
  const { k1, bundled } = bundlePair();
  const k2 = issuerKey();
  const fork = forkOf(bundled, k1, k2);
  const claims = receiptClaims(k1);
  const receipt = signedReceipt(k1, claims);
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    published_at: '2026-10-31T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  }, k2, { embed: false });
  const result = await verifyReceipt(receipt, {
    issuerHistory: fork.doc,
    trustedKids: [k1.kid],
    requirePreimages: false,
    checkPayer: false,
    head,
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(result.issuer_history.ok, true, result.issuer_history.reason);
  assert.notEqual(result.issuer_history.reason, 'issued_before_not_before');
  assert.equal(result.errors.includes('head_key_untrusted'), true, result.errors.join('; '));
  assert.equal(result.verdict?.checks?.key_window, 'pass');
  assert.equal(result.verdict?.exit_code, 1);
});

test('a fork that would close the bundled window does not (head stays trusted)', () => {
  const { k1, bundled } = bundlePair();
  const closed = entryFor(k1, { notBefore: '2026-09-04T08:52:05Z', notAfter: '2026-09-05T00:00:00Z', status: 'retired' });
  const fork = historyOf([closed], k1, 9, 9);
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: 'ab'.repeat(32),
    tree_size: 5,
    published_at: '2026-10-01T00:00:00.000Z',
    anchors: { base: { status: 'pending' }, solana: { status: 'pending' } },
  }, k1);
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [k1.kid],
    issuerHistory: fork.doc,
    [TEST_SNAPSHOT]: { issuerHistory: { document: bundled.doc, bytes: bundled.bytes } },
  });
  assert.equal(trusted.ok, true, trusted.reason || trusted.message);
  assert.notEqual(trusted.reason, 'head_kid_window');
});

test('source scan: bundled snapshots and the legacy allowlist are byte-identical to 7207bf46', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sha = (name) => createHash('sha256')
    .update(readFileSync(join(root, name)).toString('utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  assert.ok(new RegExp(SNAPSHOT_SHA256).test(sha('issuer-history.snapshot.json')), 'issuer-history.snapshot.json');
  assert.ok(new RegExp(V1_SNAPSHOT_SHA256).test(sha('issuer-history.v1.snapshot.json')), 'issuer-history.v1.snapshot.json');
  assert.ok(new RegExp(LEGACY_ALLOWLIST_SHA256).test(sha('legacy-allowlist.json')), 'legacy-allowlist.json');
});
