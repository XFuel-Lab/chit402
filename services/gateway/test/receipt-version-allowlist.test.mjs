/**
 * P-GW: every receipt builder's signed claims pass the verifier allowlist.
 * Gateway self-checks use the same exact JSON numbers. 12 is not 11.
 * ISSUER_ROOT stays off, so canonical claims stay payload_version 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.ISSUER_ROOT_ENABLED = 'false';
process.env.NODE_ENV = 'test';
const issuer = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.ISSUER_PRIVATE_KEY = Buffer.from(issuer.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';

const { signedClaimsOnAllowlist, classifySignedClaims } = await import('../../../packages/verify/dist/index.js');
const { isIssuerRootClaims, isV11Claims, isLegacyPayloadVersion, isJsonInteger } = await import('../src/receipt-version-allowlist.js');
const { buildV11SignedClaims, buildV11RefusalClaims, isV11Document } = await import('../src/v11-seal.js');
const { canonicalSignedClaims, activeReceiptPayloadVersion } = await import('../src/receipt.js');
const { VERIFIER_MIN, withVerifierAdvisory, receiptPolicyAdvisory } = await import('../src/verifier-min.js');

function fakeJws(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

test('P-GW builders emit allowlisted versions and junk is not treated as 11', () => {
  assert.equal(activeReceiptPayloadVersion(), 10);
  const legacy = canonicalSignedClaims({
    task_id: 'task-allowlist',
    created_at: 1,
    payment: { rail: 'usdc', ref: 'base:0xabc', gross_amount: '2000' },
  });
  assert.equal(legacy.payload_version, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'v'), false);
  assert.equal(signedClaimsOnAllowlist(legacy), true, JSON.stringify(classifySignedClaims(legacy, null)));

  const v11 = buildV11SignedClaims({
    payment: {
      ref: `base:0x${'ab'.repeat(32)}`,
      payee: `0x${'22'.repeat(20)}`,
      quoted_amount: '2000',
      bound_settled: '2000',
    },
    caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
    seq: 1,
  }, {
    kid: 'kid',
    salt: 'ab'.repeat(32),
    outputBytes: Buffer.from('ok'),
    receiptId: 'r1',
    requestDigest: '11'.repeat(32),
    issuedAt: '2026-09-26T17:27Z',
    agentId: 'agent-1',
    bookRef: 'cd'.repeat(16),
  });
  assert.equal(v11.v, 11);
  assert.equal(typeof v11.v, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(v11, 'payload_version'), false);
  assert.equal(signedClaimsOnAllowlist(v11), true);

  const refusal = buildV11RefusalClaims({
    cap_atomic: '1',
    spent_atomic: '1',
    period_start: '2026-10-01',
  }, {
    kid: 'kid',
    salt: 'ab'.repeat(32),
    requestDigest: '22'.repeat(32),
    bookRef: 'cd'.repeat(16),
    refusalId: 'refusal-1',
    issuedAt: '2026-09-26T17:27Z',
  });
  assert.equal(refusal.v, 11);
  assert.equal(signedClaimsOnAllowlist(refusal), true);

  const junk = [12, '11', 11.5, true, 10, 0, null];
  for (const version of junk) {
    assert.equal(isIssuerRootClaims({ payload_version: version, issuer_root: { seq: 1 } }), false, String(version));
    assert.equal(isV11Claims({ v: version }), false, String(version));
    assert.equal(signedClaimsOnAllowlist({ v: version, receipt_id: 'r' }), false);
    assert.equal(isV11Document({ issuer_signature: { jws: fakeJws({ v: version }) } }), false);
    assert.equal(isV11Document({ issuer_signature: { jws: fakeJws({ payload_version: version, issuer_root: {} }) } }), false);
  }
  assert.equal(isV11Claims({ v: 11 }), true);
  assert.equal(isIssuerRootClaims({ payload_version: 11, issuer_root: { seq: 1 } }), true);
  assert.equal(isIssuerRootClaims({ payload_version: 11 }), false);
  assert.equal(isLegacyPayloadVersion(10), true);
  assert.equal(isLegacyPayloadVersion(11), false);
  assert.equal(isLegacyPayloadVersion('10'), false);
  assert.equal(isJsonInteger(11.0), true);
  assert.equal(isV11Document({ issuer_signature: { jws: fakeJws({ v: 11 }) } }), true);
  assert.equal(isV11Document({ issuer_signature: { jws: fakeJws({ payload_version: 11 }) } }), true);
  assert.equal(Boolean(isV11Document({ v: 12 })), false);

  assert.equal(VERIFIER_MIN, '0.3.5');
  const advisory = receiptPolicyAdvisory();
  assert.equal(advisory.unsigned, true);
  assert.equal(advisory.verifier_min, '0.3.5');
  const body = { ok: true };
  const wrapped = withVerifierAdvisory(body);
  assert.equal(wrapped.verifier_min, '0.3.5');
  assert.equal(body.verifier_min, undefined);
});
