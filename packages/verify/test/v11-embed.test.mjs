/**
 * Payload v11 canonicalization and the offline issuer-history embed.
 * The receipt is signed by the gateway on cursor/gateway-v11-issuer-root-5306 at 72ac4d4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateKeyPairSync, sign } from 'node:crypto';

const { verifyReceipt, verifyRefusal } = await import('../dist/index.js');
const { jcsCanonicalize, rfc8785Canonicalize } = await import('../dist/jcs.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const {
  v11CanonicalizationVerdict,
  recomputeV11PayloadHash,
  V11_CANONICALIZATION,
  RFC8785_CANONICALIZATION,
} = await import('../dist/canonical-preimage.js');
const {
  issuerHistoryEntryHash,
  embedEntriesSnapshotHash,
} = await import('../dist/issuer-history.js');

const fixture = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/v11-embed.gateway.json'),
  'utf8',
));

function claimsOf(receipt) {
  const payload = receipt.issuer_signature.jws.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function receiptWith(overrides = {}) {
  return {
    ...fixture.receipt,
    verification: {
      ...fixture.receipt.verification,
      jwks_uri: 'https://api.chit402.com/.well-known/jwks.json',
    },
    ...overrides,
  };
}

test('v11 canonicalization accepts only the gateway values and recomputes the preimage', () => {
  const claims = claimsOf(fixture.receipt);
  assert.equal(v11CanonicalizationVerdict(claims.canonicalization).ok, true);
  assert.equal(recomputeV11PayloadHash(claims), claims.payload_hash);
  assert.equal(
    v11CanonicalizationVerdict({ ...V11_CANONICALIZATION, hash_alg: 'sha-1' }).reason,
    'canonicalization_hash_alg',
  );
  assert.deepEqual(claims.canonicalization, V11_CANONICALIZATION);
  assert.equal(claims.canonicalization.jcs, 'RFC8785');
  assert.equal(
    v11CanonicalizationVerdict({ ...V11_CANONICALIZATION, jcs: 'chit402-jcs-v1' }).reason,
    'canonicalization_jcs',
  );
  assert.equal(
    v11CanonicalizationVerdict({ ...V11_CANONICALIZATION, jcs: 'not-a-rule' }).reason,
    'canonicalization_jcs',
  );
  assert.equal(
    v11CanonicalizationVerdict({ ...V11_CANONICALIZATION, string_escaping: 'other' }).reason,
    'canonicalization_string_escaping',
  );
  assert.equal(v11CanonicalizationVerdict(null).reason, 'canonicalization_missing');
});

test('tab and newline vector: chit402-jcs-v1 escapes controls, RFC 8785 does not', () => {
  const value = { s: '\t\n\u0001\u{1F600}' };
  const chit402 = Buffer.from(jcsCanonicalize(value), 'utf8').toString('hex');
  const rfc8785 = Buffer.from(rfc8785Canonicalize(value), 'utf8').toString('hex');
  assert.equal(chit402, '7b2273223a225c75303030395c75303030615c7530303031f09f9880227d');
  assert.equal(rfc8785, '7b2273223a225c745c6e5c7530303031f09f9880227d');
  assert.equal(rfc8785Canonicalize({ s: '\b\f\r' }), '{"s":"\\b\\f\\r"}');
  assert.equal(jcsCanonicalize({ s: '\b\f\r' }), '{"s":"\\u0008\\u000c\\u000d"}');
});

test('snapshot_hash is SHA-256 of the RFC 8785 entries array', () => {
  const preimage = '[{"alg":"ES256","custody":"env","entry_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","jwk":{"alg":"ES256","crv":"P-256","kid":"kid","kty":"EC","use":"sig","x":"x","y":"y"},"kid":"kid","not_after":null,"not_before":"2026-01-01T00:00:00.000Z","prev_hash":null,"reason":"line\\nbreak","revoked_at":null,"status":"active"}]';
  const entry = {
    alg: 'ES256',
    custody: 'env',
    entry_hash: 'a'.repeat(64),
    jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'kid', alg: 'ES256', use: 'sig' },
    kid: 'kid',
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: 'line\nbreak',
    prev_hash: null,
  };
  assert.equal(rfc8785Canonicalize([entry]), preimage);
  assert.equal(embedEntriesSnapshotHash([entry]), '5807995d545f994f774145bbc13de8102d9696b81f178eca800f08092f608d2d');
});

test('an unpinned gateway v11 embed is self-asserted when well-known returns 404', async () => {
  let fetched = 0;
  const result = await verifyReceipt(receiptWith(), {
    trustedKids: [fixture.receipt.issuer_signature.kid],
    issuerRoot: { pin: null },
    fetchIssuerHistory: true,
    requirePreimages: false,
    fetchImpl: async () => {
      fetched += 1;
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    },
  });
  assert.ok(fetched >= 1);
  assert.equal(result.issuer_history.reason, 'self_asserted', result.errors.join(' '));
  assert.equal(result.issuer_history.ok, false);
  assert.equal(result.overall, 'partial');
  assert.equal(result.root_checked, false);
  assert.doesNotMatch(result.errors.join(' '), /self_asserted|issuer_history_snapshot/);
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

/**
 * Reviewer's forgery shape: backdated not_before, a JWK that is not the
 * signing key, iat 2020-06-01, and one digest used as both snapshot_hash
 * and the issuer_history pin.
 */
function forgedV11({ snapshotHash }) {
  const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signerJwk = publicJwk(signer.publicKey);
  const otherJwk = publicJwk(other.publicKey);
  assert.notEqual(otherJwk.x, signerJwk.x);
  const entry = {
    kid: signerJwk.kid,
    jwk: otherJwk,
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
  const entries = [entry];
  const pinHash = snapshotHash || embedEntriesSnapshotHash(entries);
  const claims = {
    schema: 'xfuel.receipt.v4',
    payload_version: 11,
    iat: 1590969600,
    iss: 'chit402',
    task_id: 'xfuel-forged-embed',
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
      entries,
    },
    issuer_root: {
      chain_id: 'eip155:84532',
      kid: signerJwk.kid,
      registry: '0x1111111111111111111111111111111111111111',
      root_hash: `0x${'ab'.repeat(32)}`,
      root_seq: 1,
    },
    policy: {
      policy_id: 'chit402.receipt-policy',
      policy_version: '1',
      dispute_window_seconds: 86400,
      retention_days: 365,
      retention_mode: 'compliance',
      max_cumulative_spend: null,
      policy_hash: '48a69e8a154e670ad67663feead6a6b7d9e0de6a8f733c49b108bf5d124502a8',
    },
  };
  claims.payload_hash = recomputeV11PayloadHash(claims);
  return {
    signerJwk,
    otherJwk,
    entries,
    privateKey: signer.privateKey,
    receipt: {
      task_id: claims.task_id,
      status: 'completed',
      created_at: 1590969600,
      verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' },
      issuer_signature: {
        alg: 'ES256',
        kid: signerJwk.kid,
        issuer_jwk: signerJwk,
        jws: signClaims(signer.privateKey, signerJwk.kid, claims),
      },
    },
  };
}

const notFound = async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) });

test('the embed and a disagreeing live history fail', async () => {
  const forged = forgedV11({});
  const live = {
    schema: 'chit402.issuer_history.v1',
    version: 1,
    seq: 1,
    head_hash: forged.entries[0].entry_hash,
    entries: [{ ...forged.entries[0], not_before: '2030-01-01T00:00:00.000Z' }],
  };
  const result = await verifyReceipt(forged.receipt, {
    trustedKids: [forged.signerJwk.kid],
    issuerRoot: { pin: null },
    issuerHistory: live,
    requirePreimages: false,
  });
  assert.equal(result.issuer_history.ok, false);
  assert.equal(result.issuer_history.reason, 'history_snapshot_disagree');
  assert.equal(result.overall, 'failed');
});

test('a forged unpinned embed with an arbitrary snapshot digest does not verify', async () => {
  const arbitrary = 'ab'.repeat(32);
  const forged = forgedV11({ snapshotHash: arbitrary });
  assert.equal(forged.entries[0].not_before, '2000-01-01');
  assert.notEqual(forged.entries[0].jwk.x, forged.signerJwk.x);
  assert.notEqual(arbitrary, embedEntriesSnapshotHash(forged.entries));
  const result = await verifyReceipt(forged.receipt, {
    trustedKids: [forged.signerJwk.kid],
    issuerRoot: { pin: null },
    fetchIssuerHistory: true,
    requirePreimages: false,
    fetchImpl: notFound,
  });
  assert.notEqual(result.overall, 'verified');
  assert.equal(result.overall, 'failed');
  assert.equal(result.issuer_history.ok, false);
  assert.match(result.errors.join(' '), /issuer_history_snapshot_hash/);
  assert.equal(result.root_checked, false);
});

test('a consistent unpinned embed with no history document is self-asserted', async () => {
  const forged = forgedV11({});
  assert.equal(
    forged.receipt.issuer_signature.jws.split('.').length,
    3,
  );
  const claims = JSON.parse(Buffer.from(forged.receipt.issuer_signature.jws.split('.')[1], 'base64url').toString());
  assert.equal(claims.iat, 1590969600);
  assert.equal(claims.issuer_history.hash, embedEntriesSnapshotHash(forged.entries));
  const result = await verifyReceipt(forged.receipt, {
    trustedKids: [forged.signerJwk.kid],
    issuerRoot: { pin: null },
    fetchIssuerHistory: true,
    requirePreimages: false,
    fetchImpl: notFound,
  });
  assert.equal(result.issuer_history.reason, 'self_asserted');
  assert.equal(result.issuer_history.ok, false);
  assert.equal(result.overall, 'partial');
  assert.equal(result.root_checked, false);
  assert.doesNotMatch(result.errors.join(' '), /self_asserted|issuer_history_snapshot_hash/);
});

test('refusal v2 checks the label and the embed when those fields are present', () => {
  const forged = forgedV11({ snapshotHash: 'ab'.repeat(32) });
  const anchor = {
    status: 'UNAVAILABLE', rail: 'base', chain_id: null, block_number: null, block_hash: null, state_root: null,
  };
  const book_row = {
    task_id: 'xfuel-forged-embed', seq: 1, prev_hash: null, row_hash: 'cd'.repeat(32), event: 'policy_blocked',
  };
  const refusalClaims = {
    schema: 'chit402.refusal.v2',
    payload_version: 3,
    kind: 'refusal',
    refusal_id: 'rfs-forged',
    nonce: 'abc',
    issued_at: '2020-06-01T00:00:00.000Z',
    refusal_code: 'policy_blocked',
    agent_id: 4,
    book_id: 4,
    task_id: 'xfuel-forged-embed',
    charged: false,
    amount_charged: '0',
    amount_requested: '2000',
    chain_id: null,
    anchor,
    book_row,
    canonicalization: RFC8785_CANONICALIZATION,
    issuer_history: { hash: 'ab'.repeat(32), version: 1, seq: 1 },
    issuer_history_snapshot: {
      schema: 'chit402.issuer_history_embed.v1',
      version: 1,
      seq: 1,
      head_hash: forged.entries[0].entry_hash,
      snapshot_hash: 'ab'.repeat(32),
      entries: forged.entries,
    },
    issuer_root: {
      chain_id: 'eip155:84532',
      kid: forged.signerJwk.kid,
      registry: '0x1111111111111111111111111111111111111111',
      root_hash: `0x${'ab'.repeat(32)}`,
      root_seq: 1,
    },
  };
  refusalClaims.payload_hash = recomputeV11PayloadHash(refusalClaims);
  const doc = {
    ...refusalClaims,
    issuer_signature: {
      jws: signClaims(forged.privateKey, forged.signerJwk.kid, refusalClaims),
      kid: forged.signerJwk.kid,
      issuer_jwk: forged.signerJwk,
    },
  };
  const checked = verifyRefusal(doc, { trustedKids: [forged.signerJwk.kid] });
  assert.equal(checked.valid, false, checked.reason);
  assert.equal(checked.reason, 'issuer_history_snapshot_hash');

  const honestHash = embedEntriesSnapshotHash(forged.entries);
  const honest = {
    ...refusalClaims,
    canonicalization: RFC8785_CANONICALIZATION,
    issuer_history: { hash: honestHash, version: 1, seq: 1 },
    issuer_history_snapshot: {
      ...refusalClaims.issuer_history_snapshot,
      snapshot_hash: honestHash,
    },
  };
  delete honest.payload_hash;
  honest.payload_hash = recomputeV11PayloadHash(honest);
  const honestDoc = {
    ...honest,
    issuer_signature: {
      jws: signClaims(forged.privateKey, forged.signerJwk.kid, honest),
      kid: forged.signerJwk.kid,
      issuer_jwk: forged.signerJwk,
    },
  };
  const passed = verifyRefusal(honestDoc, { trustedKids: [forged.signerJwk.kid] });
  assert.equal(passed.valid, true, passed.reason);
  assert.equal(passed.schema, 'chit402.refusal.v2');
});
