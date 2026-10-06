/**
 * v11 receipt policy terms. The vector is the one verifier PR #484 should pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { jcsRfc8785 } from '../src/offer-receipt.js';
import {
  assertReceiptPolicyBoot,
  observeReceiptPolicy,
  receiptPolicyHash,
  receiptPolicyHistoryDocument,
  receiptPolicyRetentionClaim,
  receiptPolicyTerms,
  resetReceiptPolicyHistory,
  signedReceiptPolicy,
  verifyReceiptPolicyClaim,
  writeReceiptPolicyHistory,
  RECEIPT_POLICY_HISTORY_SCHEMA,
} from '../src/receipt-policy.js';

const TERMS = receiptPolicyTerms({
  policy_id: 'chit402.receipt-policy',
  policy_version: '1',
  dispute_window_seconds: 86400,
  retention_days: 365,
  retention_mode: 'compliance',
  max_cumulative_spend: null,
});
const PREIMAGE = '{"dispute_window_seconds":86400,"max_cumulative_spend":null,"policy_id":"chit402.receipt-policy","policy_version":"1","retention_days":365,"retention_mode":"compliance"}';
const POLICY_HASH = '48a69e8a154e670ad67663feead6a6b7d9e0de6a8f733c49b108bf5d124502a8';

const PROD = {
  NODE_ENV: 'production',
  RECEIPT_POLICY_ID: 'chit402.receipt-policy',
  RECEIPT_POLICY_VERSION: '1',
  RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS: '86400',
  RECEIPT_POLICY_RETENTION_DAYS: '365',
  RECEIPT_POLICY_RETENTION_MODE: 'compliance',
  RECEIPT_POLICY_EFFECTIVE_FROM: '2026-10-06T00:00:00.000Z',
};

test('policy_hash vector is SHA-256 of the RFC 8785 terms', () => {
  assert.equal(jcsRfc8785(TERMS), PREIMAGE);
  assert.equal(receiptPolicyHash(TERMS), POLICY_HASH);
  assert.equal(crypto.createHash('sha256').update(PREIMAGE, 'utf8').digest('hex'), POLICY_HASH);
  const claim = signedReceiptPolicy({ ...PROD });
  assert.equal(claim.policy_hash, POLICY_HASH);
  assert.equal(Object.hasOwn(claim, 'policy_hash'), true);
  assert.equal(jcsRfc8785(TERMS).includes('policy_hash'), false);
  const capped = receiptPolicyHash({ ...TERMS, max_cumulative_spend: '2000' });
  assert.equal(capped, 'ecf4cdabe9b755e4776167429dcffb73e1f275994cda68f0e32d776cac925601');
  assert.notEqual(capped, POLICY_HASH);
});

test('production boot fails closed without terms and when the log hash disagrees', () => {
  resetReceiptPolicyHistory();
  assert.throws(() => assertReceiptPolicyBoot({ NODE_ENV: 'production' }), /incomplete/);
  assert.throws(
    () => assertReceiptPolicyBoot({ ...PROD, RECEIPT_POLICY_RETENTION_MODE: 'governance' }),
    /compliance/,
  );
  assert.throws(
    () => assertReceiptPolicyBoot({
      ...PROD,
      RECEIPT_LOG_RETENTION_POLICY_ID: 'other',
      RECEIPT_LOG_RETENTION_POLICY_SHA256: 'ab'.repeat(32),
    }),
    /must match/,
  );
  const claim = assertReceiptPolicyBoot({
    ...PROD,
    RECEIPT_LOG_RETENTION_POLICY_ID: 'chit402.receipt-policy',
    RECEIPT_LOG_RETENTION_POLICY_SHA256: POLICY_HASH,
  });
  assert.deepEqual(claim, { id: 'chit402.receipt-policy', sha256: POLICY_HASH });
  assert.deepEqual(receiptPolicyRetentionClaim(TERMS), claim);
});

test('policy history appends a version and keeps the earlier row', () => {
  resetReceiptPolicyHistory();
  const first = observeReceiptPolicy(PROD);
  assert.equal(first.schema, RECEIPT_POLICY_HISTORY_SCHEMA);
  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].policy_hash, POLICY_HASH);
  assert.equal(first.entries[0].effective_from, '2026-10-06T00:00:00.000Z');
  assert.deepEqual(first.entries[0].terms, TERMS);
  const again = observeReceiptPolicy(PROD);
  assert.equal(again.entries.length, 1);
  const next = observeReceiptPolicy({
    ...PROD,
    RECEIPT_POLICY_VERSION: '2',
    RECEIPT_POLICY_EFFECTIVE_FROM: '2026-10-07T00:00:00.000Z',
  });
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries[0].policy_hash, POLICY_HASH);
  assert.equal(next.entries[0].terms.policy_version, '1');
  assert.equal(next.entries[1].policy_version, '2');
  assert.notEqual(next.entries[1].policy_hash, POLICY_HASH);
  assert.equal(receiptPolicyHistoryDocument({
    ...PROD,
    RECEIPT_POLICY_VERSION: '2',
    RECEIPT_POLICY_EFFECTIVE_FROM: '2026-10-07T00:00:00.000Z',
  }).entries.length, 2);
});

test('the well-known policy history is the RFC 8785 document', () => {
  resetReceiptPolicyHistory();
  const res = {
    headers: {},
    body: '',
    set(name, value) { this.headers[name.toLowerCase()] = value; },
    send(body) { this.body = body; },
  };
  writeReceiptPolicyHistory(res, PROD);
  const parsed = JSON.parse(res.body);
  assert.equal(res.body, jcsRfc8785(parsed));
  assert.equal(parsed.entries[0].policy_hash, POLICY_HASH);
  assert.equal(res.headers['x-chit-policy-hash'], POLICY_HASH);
  const tampered = signedReceiptPolicy(PROD);
  tampered.dispute_window_seconds = 1;
  assert.equal(verifyReceiptPolicyClaim(tampered).reason, 'policy_hash_mismatch');
});
