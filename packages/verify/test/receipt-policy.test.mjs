/**
 * v11 policy terms. Vector and field set match gateway cc04584.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const {
  receiptPolicyHash,
  receiptPolicyTerms,
  verifyReceiptPolicyClaim,
  RECEIPT_POLICY_VECTOR_PREIMAGE,
  RECEIPT_POLICY_VECTOR_HASH,
  RECEIPT_POLICY_CAPPED_HASH,
} = await import('../dist/receipt-policy.js');
const { rfc8785Canonicalize } = await import('../dist/jcs.js');
const { verifyReceipt } = await import('../dist/index.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { V11_CANONICALIZATION, recomputeV11PayloadHash } = await import('../dist/canonical-preimage.js');
const { issuerHistoryEntryHash, embedEntriesSnapshotHash } = await import('../dist/issuer-history.js');

const VECTOR = {
  policy_id: 'chit402.receipt-policy',
  policy_version: '1',
  dispute_window_seconds: 86400,
  retention_days: 365,
  retention_mode: 'compliance',
  max_cumulative_spend: null,
  policy_hash: RECEIPT_POLICY_VECTOR_HASH,
};

test('policy_hash vector is SHA-256 of the RFC 8785 terms', () => {
  assert.equal(rfc8785Canonicalize(receiptPolicyTerms(VECTOR)), RECEIPT_POLICY_VECTOR_PREIMAGE);
  assert.equal(
    createHash('sha256').update(RECEIPT_POLICY_VECTOR_PREIMAGE, 'utf8').digest('hex'),
    RECEIPT_POLICY_VECTOR_HASH,
  );
  assert.equal(receiptPolicyHash(receiptPolicyTerms(VECTOR)), RECEIPT_POLICY_VECTOR_HASH);
  const capped = receiptPolicyHash(receiptPolicyTerms({ ...VECTOR, max_cumulative_spend: '2000' }));
  assert.equal(capped, RECEIPT_POLICY_CAPPED_HASH);
  assert.equal(verifyReceiptPolicyClaim(VECTOR).ok, true);
  assert.equal(verifyReceiptPolicyClaim(null).reason, 'policy_missing');
  const { policy_hash, ...bare } = VECTOR;
  void policy_hash;
  assert.equal(verifyReceiptPolicyClaim(bare).reason, 'policy_hash_missing');
});

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig' };
  jwk.kid = jwkThumbprint(jwk);
  return jwk;
}

function signClaims(privateKey, kid, payload) {
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

function v11Receipt(policy) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signerJwk = publicJwk(publicKey);
  const entry = {
    kid: signerJwk.kid,
    jwk: signerJwk,
    alg: 'ES256',
    not_before: '2000-01-01',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'issuer',
    prev_hash: null,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  const pinHash = embedEntriesSnapshotHash([entry]);
  const claims = {
    schema: 'xfuel.receipt.v4',
    payload_version: 11,
    iat: 1790443652,
    iss: 'chit402',
    task_id: 'xfuel-policy',
    tree_head_hash: 'ab'.repeat(32),
    tolerance: { base: 300, solana: 150 },
    canonicalization: V11_CANONICALIZATION,
    issuer_history: { hash: pinHash, version: 1, seq: 1 },
    issuer_history_snapshot: {
      schema: 'chit402.issuer_history_embed.v1',
      version: 1,
      seq: 1,
      head_hash: entry.entry_hash,
      snapshot_hash: pinHash,
      entries: [entry],
    },
    issuer_root: {
      chain_id: 'eip155:84532',
      kid: signerJwk.kid,
      registry: '0x1111111111111111111111111111111111111111',
      root_hash: `0x${'ab'.repeat(32)}`,
      root_seq: 1,
    },
    policy,
  };
  claims.payload_hash = recomputeV11PayloadHash(claims);
  return {
    kid: signerJwk.kid,
    privateKey,
    claims,
    receipt: {
      task_id: claims.task_id,
      status: 'completed',
      verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' },
      issuer_signature: {
        alg: 'ES256',
        kid: signerJwk.kid,
        issuer_jwk: signerJwk,
        jws: signClaims(privateKey, signerJwk.kid, claims),
      },
    },
  };
}

function historyDoc(policyHash) {
  return {
    schema: 'chit402.receipt_policy_history.v1',
    entries: [{
      policy_version: '1',
      policy_hash: policyHash,
      terms: receiptPolicyTerms(VECTOR),
      effective_from: '2026-09-04T08:52:05.000Z',
    }],
  };
}

test('a v11 receipt fails closed without policy', async () => {
  const signed = v11Receipt(undefined);
  const result = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /policy_missing/);
});

test('changing one policy term fails the receipt', async () => {
  const signed = v11Receipt({ ...VECTOR, dispute_window_seconds: 3600 });
  const result = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    fetchPolicyHistory: true,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.policy.reason, 'policy_hash_mismatch');
  assert.match(result.errors.join(' '), /policy_hash_mismatch/);
});

test('swapping in a different valid policy fails the signed payload hash', async () => {
  const original = v11Receipt(VECTOR);
  const swapped = {
    ...original.claims,
    policy: {
      ...VECTOR,
      max_cumulative_spend: '2000',
      policy_hash: RECEIPT_POLICY_CAPPED_HASH,
    },
  };
  assert.equal(verifyReceiptPolicyClaim(swapped.policy).ok, true);
  assert.notEqual(recomputeV11PayloadHash(swapped), original.claims.payload_hash);
  swapped.payload_hash = original.claims.payload_hash;
  const receipt = {
    ...original.receipt,
    issuer_signature: {
      ...original.receipt.issuer_signature,
      jws: signClaims(original.privateKey, original.kid, swapped),
    },
  };
  const result = await verifyReceipt(receipt, {
    trustedKids: [original.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /payload_hash_mismatch/);
});

test('a missing policy history is partial and a listed hash is reported', async () => {
  const signed = v11Receipt(VECTOR);
  const missing = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    fetchPolicyHistory: true,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  assert.equal(missing.policy.ok, true);
  assert.equal(missing.policy.history, 'missing');
  assert.equal(missing.policy.terms.policy_id, 'chit402.receipt-policy');
  assert.equal(missing.policy.terms.dispute_window_seconds, 86400);
  assert.equal(missing.overall, 'partial');
  assert.doesNotMatch(missing.errors.join(' '), /policy_/);

  const listed = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    policyHistory: historyDoc(RECEIPT_POLICY_VECTOR_HASH),
  });
  assert.equal(listed.policy.history, 'listed');
  assert.equal(listed.policy.ok, true);
  assert.doesNotMatch(listed.errors.join(' '), /policy_/);

  const other = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    policyHistory: historyDoc(RECEIPT_POLICY_CAPPED_HASH),
  });
  assert.equal(other.policy.history, 'not_listed');
  assert.equal(other.policy.ok, true);
  assert.notEqual(other.overall, 'failed');
});

test('the CLI prints the signed policy terms', () => {
  const signed = v11Receipt(VECTOR);
  const dir = mkdtempSync(join(tmpdir(), 'chit-policy-'));
  const receiptPath = join(dir, 'receipt.json');
  const historyPath = join(dir, 'policy.json');
  writeFileSync(receiptPath, JSON.stringify(signed.receipt));
  writeFileSync(historyPath, JSON.stringify(historyDoc(RECEIPT_POLICY_VECTOR_HASH)));
  const cli = join(new URL('.', import.meta.url).pathname, '..', 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [
    cli,
    receiptPath,
    '--no-preimage',
    '--no-issuer-history',
    '--no-policy-history',
    '--trusted-kid',
    signed.kid,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Policy:        chit402\.receipt-policy/);
  assert.match(run.stdout, /Dispute window: 86400s/);
  assert.match(run.stdout, /Retention:     365 days, compliance/);
  assert.match(run.stdout, /Spend cap:     none/);
  assert.match(run.stdout, new RegExp(RECEIPT_POLICY_VECTOR_HASH));

  const announced = spawnSync(process.execPath, [
    cli,
    receiptPath,
    '--json',
    '--no-preimage',
    '--no-issuer-history',
    '--policy-history-file',
    historyPath,
    '--trusted-kid',
    signed.kid,
  ], { encoding: 'utf8' });
  assert.equal(announced.status, 0, announced.stderr);
  const parsed = JSON.parse(announced.stdout);
  assert.equal(parsed.policy.history, 'listed');
  assert.equal(parsed.policy.terms.retention_mode, 'compliance');
});
