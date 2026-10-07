/**
 * Three sources. A chit402 origin is self_asserted. One copy is not independent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { assessIndependence, isChit402Origin } = await import('../dist/key-independence.js');
const { assessGuardian } = await import('../dist/guardian.js');
const { verifyReceipt } = await import('../dist/index.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { V11_CANONICALIZATION, recomputeV11PayloadHash } = await import('../dist/canonical-preimage.js');
const { issuerHistoryEntryHash, embedEntriesSnapshotHash } = await import('../dist/issuer-history.js');
const { generateKeyPairSync, sign } = await import('node:crypto');

const kid = 'kid-1';
const entry = {
  kid,
  not_before: '2026-01-01T00:00:00.000Z',
  not_after: null,
  revoked_at: null,
  status: 'active',
};
const doc = { schema: 'chit402.issuer_history.v1', entries: [entry] };
const registry = {
  kid,
  notBefore: Math.floor(Date.parse(entry.not_before) / 1000),
  notAfter: null,
  revokedAt: null,
  thumbprint: null,
  status: 'active',
};

test('a chit402 history alone is self_asserted and one copy is not independent', () => {
  assert.equal(isChit402Origin('https://api.chit402.com/.well-known/issuer-history.json'), true);
  assert.equal(isChit402Origin('https://example.com/history.json'), false);
  const onlyHost = assessIndependence({ kid, snapshot: doc, snapshotFromChit402: true });
  assert.equal(onlyHost.verdict, 'self_asserted');
  assert.notEqual(onlyHost.verdict, 'independent');
  const onlyCommit = assessIndependence({ kid, commit: doc });
  assert.equal(onlyCommit.verdict, 'not_independent');
  const onlyRegistry = assessIndependence({ kid, registry });
  assert.equal(onlyRegistry.verdict, 'not_independent');
});

test('commit and registry together are independent, and a mismatch fails by name', () => {
  const agreed = assessIndependence({ kid, commit: doc, registry, snapshot: doc, snapshotFromChit402: true });
  assert.equal(agreed.verdict, 'independent');
  const drifted = {
    ...doc,
    entries: [{ ...entry, not_before: '2020-01-01T00:00:00.000Z' }],
  };
  const named = assessIndependence({ kid, commit: doc, snapshot: drifted });
  assert.equal(named.verdict, 'disagree');
  assert.equal(named.reason, 'commit_snapshot_disagree');
  const reg = assessIndependence({
    kid,
    commit: doc,
    registry: { ...registry, notBefore: 1 },
  });
  assert.equal(reg.reason, 'commit_registry_disagree');
  const snap = assessIndependence({ kid, snapshot: drifted, registry });
  assert.equal(snap.reason, 'snapshot_registry_disagree');
});

test('guardian retirement, a signing guardian, and an unordered set fail by name', () => {
  assert.equal(assessGuardian({
    signingKid: kid,
    iat: 2_000,
    retirements: [{ kid, blockNumber: 10, blockTimestamp: 1_500 }],
  }).reason, 'KEY_RETIRED');
  assert.equal(assessGuardian({
    signingKid: kid,
    iat: 1_000,
    retirements: [{ kid, blockNumber: 10, blockTimestamp: 1_500 }],
  }).ok, true);
  assert.equal(assessGuardian({
    signingKid: kid,
    iat: 2_000,
    historyGuardians: [kid],
  }).reason, 'signing_key_is_guardian');
  assert.equal(assessGuardian({
    signingKid: 'other',
    iat: 2_000,
    historySets: [{ guardians: ['g1'], blockNumber: 4 }],
    chainSets: [],
  }).reason, 'guardian_set_unordered');
  assert.equal(assessGuardian({
    signingKid: 'other',
    iat: 2_000,
    historySets: [{ guardians: ['g1'], blockNumber: 4 }],
    chainSets: [{ guardians: ['g1'], blockNumber: 4 }],
  }).ok, true);
});

function signV11(policy) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig', kid: '' };
  jwk.kid = jwkThumbprint(jwk);
  const row = {
    kid: jwk.kid,
    jwk,
    alg: 'ES256',
    not_before: '2000-01-01',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'issuer',
    prev_hash: null,
  };
  row.entry_hash = issuerHistoryEntryHash(row);
  const pinHash = embedEntriesSnapshotHash([row]);
  const claims = {
    schema: 'xfuel.receipt.v4',
    payload_version: 11,
    iat: 1790443652,
    iss: 'chit402',
    task_id: 'xfuel-independence',
    tree_head_hash: 'ab'.repeat(32),
    tolerance: { base: 300, solana: 150 },
    canonicalization: V11_CANONICALIZATION,
    issuer_history: { hash: pinHash, version: 1, seq: 1 },
    issuer_history_snapshot: {
      schema: 'chit402.issuer_history_embed.v1',
      version: 1,
      seq: 1,
      head_hash: row.entry_hash,
      snapshot_hash: pinHash,
      entries: [row],
    },
    issuer_root: {
      chain_id: 'eip155:84532',
      kid: jwk.kid,
      registry: '0x1111111111111111111111111111111111111111',
      root_hash: `0x${'ab'.repeat(32)}`,
      root_seq: 1,
    },
    policy,
  };
  claims.payload_hash = recomputeV11PayloadHash(claims);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    kid: jwk.kid,
    receipt: {
      task_id: claims.task_id,
      status: 'completed',
      issuer_signature: { alg: 'ES256', kid: jwk.kid, issuer_jwk: jwk, jws: `${header}.${payload}.${signature}` },
    },
  };
}

const POLICY = {
  policy_id: 'chit402.receipt-policy',
  policy_version: '1',
  dispute_window_seconds: 86400,
  retention_days: 365,
  retention_mode: 'compliance',
  max_cumulative_spend: null,
  policy_hash: '48a69e8a154e670ad67663feead6a6b7d9e0de6a8f733c49b108bf5d124502a8',
};

test('a guardian-retired key fails KEY_RETIRED on the receipt', async () => {
  const signed = signV11(POLICY);
  const result = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    guardian: { retirements: [{ kid: signed.kid, blockNumber: 9, blockTimestamp: 1_700_000_000 }] },
  });
  assert.equal(result.overall, 'failed');
  assert.match(result.errors.join(' '), /KEY_RETIRED/);
});

test('policy pin mismatch and the retention floor fail a v11 receipt', async () => {
  const signed = signV11(POLICY);
  const pinned = await verifyReceipt(signed.receipt, {
    trustedKids: [signed.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
    policyVersion: '9',
    policyHistory: { entries: [] },
  });
  assert.equal(pinned.overall, 'failed');
  assert.match(pinned.errors.join(' '), /policy_pin_mismatch/);

  const short = { ...POLICY, retention_days: 30 };
  delete short.policy_hash;
  const { receiptPolicyHash, receiptPolicyTerms } = await import('../dist/receipt-policy.js');
  short.policy_hash = receiptPolicyHash(receiptPolicyTerms(short));
  const floored = signV11(short);
  const floor = await verifyReceipt(floored.receipt, {
    trustedKids: [floored.kid],
    issuerRoot: { pin: null },
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(floor.overall, 'failed');
  assert.match(floor.errors.join(' '), /policy_retention_floor/);
});
