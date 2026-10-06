/**
 * xfuel-verify recomputes published preimages and checks the issuer key window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keccak256, solidityPacked, toUtf8Bytes } from 'ethers';

const {
  verifyPublishedPreimages,
  requiredPreimageFields,
} = await import('../dist/preimage.js');
const {
  verifyIssuerHistoryDocument,
  issuerKeyWindow,
  issuerHistoryEntryHash,
  checkReceiptIssuerHistory,
} = await import('../dist/issuer-history.js');
const { jwkThumbprint, DEFAULT_TRUSTED_ISSUER_KIDS } = await import('../dist/jws.js');
const { verifyReceipt, verifyCanonicalPreimageBytes } = await import('../dist/index.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { issuerHistoryDocumentHash } = await import('../dist/issuer-history.js');

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

test('a published row preimage must match, and a missing one fails closed', async () => {
  const line = '7|1|task-1||collected';
  const hash = sha256Hex(line);
  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: 'task-1',
    book_chain: { book_id: 7, task_id: 'task-1', seq: 1, prev_hash: null, event: 'collected', row_hash: hash },
    output: { hash: '0x' + '11'.repeat(32) },
    preimages: {
      fields: {
        'book_chain.row_hash': {
          alg: 'sha256',
          recomputable: true,
          preimage_utf8: line,
          hash,
        },
      },
      not_recomputable: [{ field: 'output.hash', reason: 'private' }],
    },
  };
  const ok = await verifyPublishedPreimages(receipt, { requirePreimages: true });
  assert.equal(ok.ok, true);

  receipt.preimages.fields['book_chain.row_hash'].preimage_utf8 = 'tampered';
  const bad = await verifyPublishedPreimages(receipt, { requirePreimages: true });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /preimage mismatch for book_chain.row_hash/);

  delete receipt.preimages;
  const missing = await verifyPublishedPreimages(
    { ...receipt, book_chain: { row_hash: hash } },
    { requirePreimages: true },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /preimage missing for book_chain.row_hash/);

  const legacy = await verifyPublishedPreimages(
    { book_chain: { row_hash: hash }, output: { hash: '0x' + '11'.repeat(32) } },
    { requirePreimages: false },
  );
  assert.equal(legacy.ok, true);
  assert.equal(legacy.checked, false);
  assert.deepEqual(requiredPreimageFields({ output: { hash: '0xabc' } }), []);
});

test('binding preimage is keccak256 of the packed bytes', async () => {
  const paymentRef = 'base:0x' + 'ab'.repeat(32);
  const taskId = 'xfuel-bind';
  const paymentRefHash = keccak256(toUtf8Bytes(paymentRef));
  const taskIdHash = keccak256(toUtf8Bytes(taskId));
  const packed = solidityPacked(
    ['bytes32', 'bytes32', 'uint8', 'uint256'],
    [paymentRefHash, taskIdHash, 1, 2000n],
  );
  const hash = keccak256(packed);
  const receipt = {
    task_id: taskId,
    payment: { ref: paymentRef },
    binding: { expected_commitment: hash },
    preimages: {
      fields: {
        'binding.expected_commitment': {
          alg: 'keccak256',
          preimage_hex: packed,
          hash,
        },
      },
    },
  };
  const result = await verifyPublishedPreimages(receipt);
  assert.equal(result.ok, true);
});

test('verifyReceipt fails closed on a mismatched preimage block', async () => {
  const receipt = {
    task_id: 'task-pre',
    status: 'completed',
    book_chain: { row_hash: 'aa'.repeat(32) },
    preimages: {
      fields: {
        'book_chain.row_hash': {
          alg: 'sha256',
          preimage_utf8: 'nope',
          hash: 'aa'.repeat(32),
        },
      },
    },
  };
  const result = await verifyReceipt(receipt);
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /preimage mismatch/);
});

test('issuer history rejects a kid revoked before issuance and warns when unreachable', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(jwk);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' };
  const entry = {
    kid,
    jwk: publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'revoked',
    revoked_at: '2026-09-20T00:00:00.000Z',
    reason: 'rotated',
    custody: 'The ES256 private key is the base64 PEM in the gateway process environment variable ISSUER_PRIVATE_KEY.',
    prev_hash: null,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 1,
    head_hash: entry.entry_hash,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const doc = {
    schema: 'chit402.issuer_history.v1',
    entries: [entry],
    head_hash: entry.entry_hash,
    issuer_signature: {
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid,
      issuer_jwk: publicJwk,
    },
  };
  assert.equal(verifyIssuerHistoryDocument(doc, { trustedKids: [kid] }).valid, true);
  const late = issuerKeyWindow(doc, kid, 1790962201);
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow(doc, kid, '2026-09-10T00:00:00.000Z');
  assert.equal(early.ok, true);

  const rewritten = structuredClone(doc);
  rewritten.entries[0].reason = 'silent rewrite';
  assert.equal(verifyIssuerHistoryDocument(rewritten, { trustedKids: [kid] }).valid, false);

  const unreachable = await checkReceiptIssuerHistory(
    { verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' } },
    {
      fetchHistory: true,
      strict: false,
      kid,
      issuedAt: 1790962201,
      fetchImpl: async () => { throw new Error('offline'); },
    },
  );
  assert.equal(unreachable.ok, true);
  assert.equal(unreachable.unreachable, true);
  assert.match(unreachable.warning, /unreachable/);

  const strict = await checkReceiptIssuerHistory(
    { verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' } },
    {
      fetchHistory: true,
      strict: true,
      kid,
      issuedAt: 1790962201,
      fetchImpl: async () => { throw new Error('offline'); },
    },
  );
  assert.equal(strict.ok, false);
  assert.match(strict.reason, /unreachable/);

  const receipt = {
    task_id: 'task-hist',
    status: 'completed',
    created_at: 1790962201,
    issuer_signature: { alg: 'ES256', kid, jws: doc.issuer_signature.jws },
  };
  const verified = await verifyReceipt(receipt, {
    issuerHistory: doc,
    trustedKids: [kid],
    requirePreimages: false,
  });
  assert.equal(verified.issuer_history.ok, false);
  assert.equal(verified.overall, 'failed');
  assert.match(verified.errors.join(' '), /kid_revoked_before_issuance/);
});

test('omitted trustedKids uses the production pin, same as a refusal', () => {
  const kid = DEFAULT_TRUSTED_ISSUER_KIDS[0];
  const publicJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: '_H7J9niXF2tez_MnF25pnrDN7iJ_VC9gBzYYW9gzSPk',
    y: 'jiorfRc9wtNaRmaFHsQaXNzcWteUA0RnpvD4SWdVl34',
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  const entry = {
    kid,
    jwk: publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'The ES256 private key is the base64 PEM in ISSUER_PRIVATE_KEY.',
    prev_hash: null,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ schema: 'chit402.issuer_history.v1' })).toString('base64url');
  const doc = {
    schema: 'chit402.issuer_history.v1',
    entries: [entry],
    head_hash: entry.entry_hash,
    issuer_signature: {
      jws: `${header}.${payload}.${'aa'.repeat(32)}`,
      kid,
      issuer_jwk: publicJwk,
    },
  };
  const omitted = verifyIssuerHistoryDocument(doc);
  assert.notEqual(omitted.reason, 'key untrusted');
  assert.match(omitted.reason || '', /signature_invalid|verification_error/);
  const disabled = verifyIssuerHistoryDocument(doc, { trustedKids: [] });
  assert.equal(disabled.reason, 'key untrusted');
});

function signedHistory({ kid, publicJwk, privateKey, notAfter, version, seq }) {
  const entry = {
    kid,
    jwk: publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: notAfter,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'The ES256 private key is the base64 PEM in ISSUER_PRIVATE_KEY.',
    prev_hash: null,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version,
    seq,
    entry_count: 1,
    head_hash: entry.entry_hash,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const doc = {
    schema: 'chit402.issuer_history.v1',
    version,
    seq,
    entries: [entry],
    head_hash: entry.entry_hash,
    issuer_signature: {
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid,
      issuer_jwk: publicJwk,
    },
  };
  const body = jcsCanonicalize(doc);
  return { doc, body, hash: sha256Hex(body) };
}

test('a pinned history hash is checked, and not_after comes from that snapshot', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(jwk);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' };
  const open = signedHistory({
    kid, publicJwk, privateKey, notAfter: null, version: 1, seq: 1,
  });
  const closed = signedHistory({
    kid, publicJwk, privateKey, notAfter: '2026-09-01T00:00:00Z', version: 2, seq: 2,
  });
  assert.equal(issuerHistoryDocumentHash(open.doc), open.hash);
  assert.equal(jcsCanonicalize(JSON.parse(open.body)), open.body);

  const issuedAt = '2026-09-26T17:27:32Z';
  const openWindow = await checkReceiptIssuerHistory(
    { verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' } },
    {
      document: open.doc,
      documentBytes: open.body,
      pin: { hash: open.hash, version: 1, seq: 1 },
      kid,
      issuedAt,
      trustedKids: [kid],
    },
  );
  assert.equal(openWindow.ok, true, openWindow.reason);

  const after = await checkReceiptIssuerHistory(
    { verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' } },
    {
      document: closed.doc,
      documentBytes: closed.body,
      pin: { hash: closed.hash, version: 2, seq: 2 },
      kid,
      issuedAt,
      trustedKids: [kid],
    },
  );
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'issued_after_not_after');

  const swapped = await checkReceiptIssuerHistory(
    { verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' } },
    {
      document: closed.doc,
      documentBytes: closed.body,
      pin: { hash: open.hash, version: 1, seq: 1 },
      kid,
      issuedAt,
      trustedKids: [kid],
    },
  );
  assert.equal(swapped.reason, 'issuer_history_pin_mismatch');

  let fetched = '';
  const missed = await checkReceiptIssuerHistory(
    { verify_url: 'https://api.chit402.com/receipt/example' },
    {
      fetchHistory: true,
      pin: { hash: open.hash, version: 1, seq: 1 },
      kid,
      issuedAt,
      fetchImpl: async (url) => {
        fetched = String(url);
        throw new Error('offline');
      },
    },
  );
  assert.match(fetched, /version=1/);
  assert.equal(missed.ok, false);
  assert.match(missed.reason, /unreachable/);

  const preimage = '{"task_id":"t"}';
  const digest = sha256Hex(preimage);
  assert.equal(verifyCanonicalPreimageBytes(preimage, digest).ok, true);
  assert.equal(verifyCanonicalPreimageBytes(`${preimage}\n`, digest).reason, 'payload_hash_mismatch');
});

function signReceiptClaims(payload) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const thumb = createHash('sha256').update(JSON.stringify({
    crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y,
  })).digest('base64url');
  const issuer_jwk = { ...jwkExport, kid: thumb, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: thumb };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    kid: thumb,
    issuer_jwk,
    jws: `${headerB64}.${payloadB64}.${signature}`,
  };
}

function headReceipt(claims) {
  const signed = signReceiptClaims(claims);
  return {
    task_id: claims.task_id,
    status: 'completed',
    payment: claims.payment,
    caller_binding: claims.caller_binding,
    tree_head_hash: claims.tree_head_hash,
    tolerance: claims.tolerance,
    issuer_signature: {
      alg: 'ES256',
      jws: signed.jws,
      kid: signed.kid,
      issuer_jwk: signed.issuer_jwk,
      payload_version: claims.payload_version,
    },
  };
}

const headClaims = {
  task_id: 'chit-canonical-fail',
  iss: 'chit402',
  iat: 1,
  payload_version: 9,
  tree_head_hash: 'ab'.repeat(32),
  tolerance: { base: 300, solana: 150 },
  payment: {
    rail: 'usdc',
    ref: 'base:0x' + '11'.repeat(32),
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payee: '0x2222222222222222222222222222222222222222',
    gross_amount: '2000',
    settled_amount: '2000',
  },
  caller_binding: { payer_wallet: '0x1111111111111111111111111111111111111111' },
};

test('a tampered canonical preimage fails the receipt and the CLI', async () => {
  const preimage = '{"task_id":"chit-canonical-fail"}';
  const payload_hash = sha256Hex(preimage);
  const receipt = headReceipt({ ...headClaims, payload_hash });
  receipt.issuer_signature.canonical_preimage = `${preimage}tampered`;
  const result = await verifyReceipt(receipt, {
    trustedKids: [receipt.issuer_signature.kid],
    skipIssuerHistory: true,
    requirePreimages: false,
  });
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /canonical preimage: payload_hash_mismatch/);

  const dir = mkdtempSync(join(tmpdir(), 'chit-preimage-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
  // fileURLToPath, not URL.pathname. On Windows pathname is "/C:/..." and
  // path.join turns that into "\C:\...", so node never starts and stdout is empty.
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  assert.equal(existsSync(cli), true, cli);
  const run = spawnSync(process.execPath, [
    cli,
    join(dir, 'receipt.json'),
    '--json',
    '--no-preimage',
    '--no-issuer-history',
    '--trusted-kid',
    receipt.issuer_signature.kid,
  ], { encoding: 'utf8' });
  const spawnDetail = `status=${run.status} stderr=${run.stderr || ''} stdout=${run.stdout || ''} cli=${cli}`;
  assert.equal(run.error ?? null, null, `${run.error?.code || 'spawn'} ${spawnDetail}`);
  assert.equal(typeof run.status, 'number', `CLI did not exit. ${spawnDetail}`);
  assert.notEqual(run.status, 0, spawnDetail);
  assert.match(String(run.stdout), /^\s*\{/, `CLI stdout is not JSON. ${spawnDetail}`);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.overall, 'failed');
  assert.match(parsed.errors.join(' '), /canonical preimage: payload_hash_mismatch/);
});

test('payload v10 without an issuer_history pin fails closed', async () => {
  const receipt = headReceipt({ ...headClaims, task_id: 'chit-v10-unpinned', payload_version: 10 });
  const result = await verifyReceipt(receipt, {
    trustedKids: [receipt.issuer_signature.kid],
  });
  assert.equal(result.issuer_signature.valid, true);
  assert.equal(result.issuer_history.checked, true);
  assert.equal(result.issuer_history.ok, false);
  assert.equal(result.issuer_history.reason, 'issuer_history_pin_missing');
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /issuer_history_pin_missing/);
});

test('v11 and issuer_root require a signed iat and ignore created_at', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(jwk);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' };
  const history = signedHistory({
    kid, publicJwk, privateKey, notAfter: null, version: 1, seq: 1,
  });
  const inside = '2026-09-10T00:00:00.000Z';
  const pin = { hash: history.hash, version: 1, seq: 1 };
  const signPayload = (payload) => {
    const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    return {
      task_id: payload.task_id,
      status: 'completed',
      schema: payload.schema,
      issuer_signature: {
        alg: 'ES256',
        jws: `${headerB64}.${payloadB64}.${signature}`,
        kid,
        issuer_jwk: publicJwk,
        payload_version: payload.payload_version,
      },
    };
  };

  const slipped = await verifyReceipt({
    ...signPayload({
      task_id: 'v11-no-iat',
      iss: 'chit402',
      payload_version: 11,
      schema: 'xfuel.receipt.v4',
      issuer_history: pin,
    }),
    created_at: inside,
  }, {
    trustedKids: [kid],
    issuerHistory: history.doc,
    issuerHistoryBytes: history.body,
    requirePreimages: false,
  });
  assert.equal(slipped.overall, 'failed');
  assert.match(slipped.errors.join(' '), /missing_signed_iat/);
  assert.equal(slipped.issuer_history.ok, false);
  assert.doesNotMatch(slipped.errors.join(' '), /issued_before_not_before|issued_after_not_after/);

  const withRoot = await verifyReceipt({
    ...signPayload({
      task_id: 'v10-root-no-iat',
      iss: 'chit402',
      payload_version: 10,
      schema: 'xfuel.receipt.v4',
      issuer_history: pin,
      issuer_root: {
        v: 1,
        chain_id: 'eip155:84532',
        registry: '0x1111111111111111111111111111111111111111',
        root_seq: 1,
        root_hash: `0x${'ab'.repeat(32)}`,
        kid,
      },
    }),
    created_at: inside,
  }, {
    trustedKids: [kid],
    issuerHistory: history.doc,
    issuerHistoryBytes: history.body,
    requirePreimages: false,
  });
  assert.match(withRoot.errors.join(' '), /missing_signed_iat/);
  assert.equal(withRoot.overall, 'failed');

  const legacy = await verifyReceipt({
    ...signPayload({
      task_id: 'v9-no-iat',
      iss: 'chit402',
      payload_version: 9,
      schema: 'xfuel.receipt.v4',
      tree_head_hash: 'ab'.repeat(32),
      tolerance: { base: 300, solana: 150 },
    }),
    created_at: inside,
  }, {
    trustedKids: [kid],
    issuerHistory: history.doc,
    requirePreimages: false,
  });
  assert.equal(legacy.issuer_history.ok, true);
  assert.doesNotMatch(legacy.errors.join(' '), /missing_signed_iat/);

  const signedEarly = await verifyReceipt({
    ...signPayload({
      task_id: 'v11-early-iat',
      iss: 'chit402',
      iat: '2020-01-01T00:00:00.000Z',
      payload_version: 11,
      schema: 'xfuel.receipt.v4',
      issuer_history: pin,
    }),
    created_at: inside,
  }, {
    trustedKids: [kid],
    issuerHistory: history.doc,
    issuerHistoryBytes: history.body,
    requirePreimages: false,
  });
  assert.equal(signedEarly.issuer_history.reason, 'issued_before_not_before');
  assert.doesNotMatch(signedEarly.errors.join(' '), /missing_signed_iat/);
});
