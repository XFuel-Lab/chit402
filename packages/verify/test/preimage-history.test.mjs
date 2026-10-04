/**
 * xfuel-verify recomputes published preimages and checks the issuer key window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
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
const { verifyReceipt } = await import('../dist/index.js');

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
