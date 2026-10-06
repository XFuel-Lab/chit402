/**
 * Payload v11 canonicalization and the offline issuer-history embed.
 * The receipt is signed by the gateway on cursor/gateway-v11-issuer-root-5306.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { verifyReceipt } = await import('../dist/index.js');
const {
  v11CanonicalizationVerdict,
  recomputeV11PayloadHash,
  V11_CANONICALIZATION,
} = await import('../dist/canonical-preimage.js');

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
  assert.equal(
    v11CanonicalizationVerdict({ ...V11_CANONICALIZATION, jcs: 'chit402-jcs-v1' }).reason,
    'canonicalization_jcs',
  );
  assert.equal(v11CanonicalizationVerdict(null).reason, 'canonicalization_missing');
});

test('a gateway v11 receipt passes history offline when well-known returns 404', async () => {
  let fetched = 0;
  const result = await verifyReceipt(receiptWith(), {
    trustedKids: [fixture.receipt.issuer_signature.kid],
    fetchIssuerHistory: true,
    requirePreimages: false,
    fetchImpl: async () => {
      fetched += 1;
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    },
  });
  assert.ok(fetched >= 1);
  assert.equal(result.issuer_history.ok, true, result.issuer_history.reason || result.errors.join(' '));
  assert.doesNotMatch(result.errors.join(' '), /canonicalization_|payload_hash_mismatch|issuer_history_snapshot/);
});

test('the embed and a disagreeing live history fail', async () => {
  const live = JSON.parse(fixture.history_body);
  live.entries[0].not_before = '2030-01-01T00:00:00.000Z';
  const result = await verifyReceipt(receiptWith(), {
    trustedKids: [fixture.receipt.issuer_signature.kid],
    issuerHistory: live,
    requirePreimages: false,
  });
  assert.equal(result.issuer_history.ok, false);
  assert.equal(result.issuer_history.reason, 'history_snapshot_disagree');
  assert.equal(result.overall, 'failed');
});
