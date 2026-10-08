/**
 * v11 receipt policy terms. The vector is the one verifier PR #484 should pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { jcsRfc8785 } from '../src/offer-receipt.js';
import {
  assertReceiptPolicyBoot,
  assertReceiptPolicyFloor,
  observeReceiptPolicy,
  receiptPolicyHash,
  receiptPolicyHistoryDocument,
  receiptPolicyRetentionClaim,
  receiptPolicyTerms,
  resetReceiptPolicyHistory,
  signedReceiptPolicy,
  verifyReceiptPolicyClaim,
  writeReceiptPolicyHistory,
  DEFAULT_ISSUANCE_DISPUTE_WINDOW_SECONDS,
  DISPUTE_RETENTION_MARGIN_SECONDS,
  RECEIPT_POLICY_HISTORY_SCHEMA,
  RETENTION_DAYS_FLOOR,
  RETENTION_FLOOR_DISPUTE_WINDOW_SECONDS,
} from '../src/receipt-policy.js';
import { DEFAULT_DISPUTE_WINDOW_SEC } from '../src/issuance-commitment.js';

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

const FLOOR_TERMS = receiptPolicyTerms({
  policy_id: 'chit402.receipt-policy',
  policy_version: '1',
  dispute_window_seconds: RETENTION_FLOOR_DISPUTE_WINDOW_SECONDS,
  retention_days: RETENTION_DAYS_FLOOR,
  retention_mode: 'compliance',
  max_cumulative_spend: null,
});
const FLOOR_PREIMAGE = '{"dispute_window_seconds":28944000,"max_cumulative_spend":null,"policy_id":"chit402.receipt-policy","policy_version":"1","retention_days":365,"retention_mode":"compliance"}';
const FLOOR_HASH = 'c3229215b3badbb0ba8515827f92390753553680cce1501124fe339b042d369c';

test('retention floor vector passes at 365 days and 335 days plus the 30 day margin', () => {
  assert.equal(DEFAULT_ISSUANCE_DISPUTE_WINDOW_SECONDS, DEFAULT_DISPUTE_WINDOW_SEC);
  assert.equal(RETENTION_FLOOR_DISPUTE_WINDOW_SECONDS, 335 * 86400);
  assert.equal(DISPUTE_RETENTION_MARGIN_SECONDS, 30 * 86400);
  assert.equal(
    FLOOR_TERMS.retention_days * 86400,
    FLOOR_TERMS.dispute_window_seconds + DISPUTE_RETENTION_MARGIN_SECONDS,
  );
  assert.equal(jcsRfc8785(FLOOR_TERMS), FLOOR_PREIMAGE);
  assert.equal(receiptPolicyHash(FLOOR_TERMS), FLOOR_HASH);
  assert.doesNotThrow(() => assertReceiptPolicyFloor(FLOOR_TERMS, {}));
  const env = {
    ...PROD,
    RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS: String(RETENTION_FLOOR_DISPUTE_WINDOW_SECONDS),
  };
  assert.equal(signedReceiptPolicy(env).policy_hash, FLOOR_HASH);
  assert.equal(assertReceiptPolicyBoot(env).sha256, FLOOR_HASH);
});

test('boot refuses retention under 365 days or shorter than the dispute window plus 30 days', () => {
  assert.throws(
    () => assertReceiptPolicyBoot({ ...PROD, RECEIPT_POLICY_RETENTION_DAYS: '364' }),
    /below 365/,
  );
  assert.throws(
    () => signedReceiptPolicy({ ...PROD, RECEIPT_POLICY_RETENTION_DAYS: '364' }),
    /below 365/,
  );
  assert.throws(
    () => assertReceiptPolicyBoot({
      ...PROD,
      RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS: String(RETENTION_FLOOR_DISPUTE_WINDOW_SECONDS + 1),
    }),
    /30 days/,
  );
  assert.throws(
    () => assertReceiptPolicyBoot({
      ...PROD,
      X402_ISSUANCE_DISPUTE_WINDOW_SEC: String(340 * 86400),
    }),
    /30 days/,
  );
  assert.equal(verifyReceiptPolicyClaim({
    ...FLOOR_TERMS,
    policy_hash: FLOOR_HASH,
  }).ok, true);
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
