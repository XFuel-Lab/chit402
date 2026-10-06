/**
 * v11 policy terms. Vector and field set match gateway cc04584.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const vector = JSON.parse(readFileSync(join(fixtureDir, 'policy-vector.json'), 'utf8'));
const cappedVector = JSON.parse(readFileSync(join(fixtureDir, 'policy-vector-capped.json'), 'utf8'));

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

test('policy_hash fixtures match the gateway vectors', () => {
  assert.equal(vector.preimage, RECEIPT_POLICY_VECTOR_PREIMAGE);
  assert.equal(vector.policy_hash, RECEIPT_POLICY_VECTOR_HASH);
  assert.equal(cappedVector.policy_hash, RECEIPT_POLICY_CAPPED_HASH);
  assert.equal(rfc8785Canonicalize(vector.terms), vector.preimage);
  assert.equal(rfc8785Canonicalize(cappedVector.terms), cappedVector.preimage);
  assert.equal(createHash('sha256').update(vector.preimage, 'utf8').digest('hex'), vector.policy_hash);
  assert.equal(createHash('sha256').update(cappedVector.preimage, 'utf8').digest('hex'), cappedVector.policy_hash);
  assert.equal(receiptPolicyHash(vector.terms), vector.policy_hash);
  assert.equal(receiptPolicyHash(cappedVector.terms), cappedVector.policy_hash);
  assert.equal(verifyReceiptPolicyClaim({ ...vector.terms, policy_hash: vector.policy_hash }).ok, true);
  assert.equal(verifyReceiptPolicyClaim(null).reason, 'POLICY_ABSENT');
  const { policy_hash, ...bare } = VECTOR;
  void policy_hash;
  assert.equal(verifyReceiptPolicyClaim(bare).reason, 'policy_hash_missing');
  assert.equal(verifyReceiptPolicyClaim({ ...VECTOR, extra: true }).reason, 'policy_fields');
  assert.equal(verifyReceiptPolicyClaim({ ...VECTOR, dispute_window_seconds: '86400' }).reason, 'policy_type');
  assert.equal(verifyReceiptPolicyClaim({ ...VECTOR, max_cumulative_spend: 2000 }).reason, 'policy_type');
  assert.equal(verifyReceiptPolicyClaim({ ...VECTOR, retention_mode: 'governance' }).reason, 'policy_retention_mode');
  const { retention_days, ...missingField } = VECTOR;
  void retention_days;
  assert.equal(verifyReceiptPolicyClaim(missingField).reason, 'policy_fields');
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

test('a v11 receipt with no policy is POLICY_ABSENT and the other checks still run', async () => {
  const signed = v11Receipt(undefined);
  const result = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(result.issuer_signature.valid, true);
  assert.equal(result.policy.reason, 'POLICY_ABSENT');
  assert.equal(result.policy.history, 'not_checked');
  assert.equal(result.overall, 'partial');
  assert.doesNotMatch(result.errors.join(' '), /POLICY_ABSENT|policy_/);
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
  assert.equal(other.overall, 'failed');
  assert.match(other.errors.join(' '), /policy_history_mismatch/);

  const late = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    policyHistory: {
      schema: 'chit402.receipt_policy_history.v1',
      entries: [{
        policy_version: '1',
        policy_hash: RECEIPT_POLICY_VECTOR_HASH,
        terms: vector.terms,
        effective_from: '2030-01-01T00:00:00.000Z',
      }],
    },
  });
  assert.equal(late.policy.history, 'not_effective');
  assert.equal(late.overall, 'failed');
  assert.match(late.errors.join(' '), /policy_history_not_effective/);

  const unchecked = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(unchecked.policy.history, 'not_checked');
  assert.equal(unchecked.policy.ok, true);
  assert.equal(unchecked.policy.terms.dispute_window_seconds, 86400);
  assert.equal(unchecked.policy.terms.retention_days, 365);
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
    '--trusted-kid',
    signed.kid,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Policy history: not checked/);
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
  assert.equal(parsed.policy.terms.policy_id, 'chit402.receipt-policy');
  assert.equal(parsed.policy.terms.dispute_window_seconds, 86400);
  assert.equal(parsed.policy.terms.retention_days, 365);
  assert.equal(parsed.policy.terms.retention_mode, 'compliance');
  assert.equal(parsed.policy.terms.max_cumulative_spend, null);
  assert.equal(parsed.policy.policy_hash, RECEIPT_POLICY_VECTOR_HASH);
});
