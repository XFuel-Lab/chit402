/**
 * Stranger-side receipt lane. Freeze is recomputed. A stamped freeze bit
 * is not trusted. Signature verification is unchanged.
 *
 * Design by Turbo on 1F916 (post 6579, comments 88201 and 88403).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  verifyReceipt,
  buildReceiptLane,
  deriveSettledBy,
  receiptLaneDecision,
} = await import('../dist/index.js');

const ROOT_A = 'a'.repeat(64);
const ROOT_B = 'b'.repeat(64);

const changedAnchors = {
  anchor_at_binding: {
    root: ROOT_A,
    tree_size: 2,
    anchor_tx: '0xbind',
    solana_signature: null,
  },
  anchor_current: {
    root: ROOT_B,
    tree_size: 6,
    anchor_tx: '0xlater',
    solana_signature: null,
  },
};

test('settled + anchor_changed does not freeze', () => {
  const lane = buildReceiptLane({
    entry: {
      seq: 12,
      evidence: 'collected',
      payment_ref: 'base:0xabc',
      collected: true,
    },
    anchorAtBinding: changedAnchors.anchor_at_binding,
    anchorCurrent: changedAnchors.anchor_current,
  });
  assert.equal(lane.settled_by, 'receipt');
  assert.equal(lane.settled, true);
  assert.equal(lane.anchor_changed_since_binding, true);
  assert.equal(lane.freeze, false);
  assert.equal(lane.reason, null);
  assert.equal(lane.signed, false);
});

test('unsettled + anchor_changed freezes the receipt lane', () => {
  const lane = buildReceiptLane({
    entry: {
      book_seq: 12,
      evidence: 'RECORDED_BY_SETTLE',
      payment_ref: 'base:0xabc',
      collected: false,
    },
    anchorAtBinding: changedAnchors.anchor_at_binding,
    anchorCurrent: changedAnchors.anchor_current,
  });
  assert.equal(lane.settled_by, 'receipt');
  assert.equal(lane.settled, false);
  assert.equal(lane.anchor_changed_since_binding, true);
  assert.equal(lane.freeze, true);
  assert.equal(lane.reason, 'unsettled_anchor_changed');
});

test('settled_by is observed_transfer or receipt, and unknown stays null', () => {
  assert.equal(
    deriveSettledBy(
      { payment: { ref: 'base:0xabc', collected: true } },
      { payer: { checked: true, valid: true } },
    ),
    'observed_transfer',
  );
  assert.equal(
    deriveSettledBy({
      payment_ref: 'solana:sig',
      ingress_receipt: { ref: 'solana:sig' },
    }),
    'observed_transfer',
  );
  assert.equal(
    deriveSettledBy({ evidence: 'collected', payment_ref: 'base:0xabc', collected: true }),
    'receipt',
  );
  assert.equal(deriveSettledBy({ evidence: 'policy_blocked' }), null);
  assert.equal(
    deriveSettledBy(
      { payment: { ref: 'base:0xabc', collected: true } },
      { issuerAssertsSettlement: false },
    ),
    null,
  );
});

test('anchor_changed alone does not freeze', () => {
  assert.equal(receiptLaneDecision({
    book_seq: 3,
    settled_by: 'receipt',
    settled: true,
    anchor_changed_since_binding: true,
  }).freeze, false);
  assert.equal(receiptLaneDecision({
    book_seq: 3,
    settled_by: 'observed_transfer',
    settled: false,
    anchor_changed_since_binding: true,
  }).freeze, false);
});

test('a v8 receipt still verifies when the unsigned lane is attached', async () => {
  const live = JSON.parse(readFileSync(new URL('./fixtures/chit-4d6e8331.json', import.meta.url), 'utf8'));
  const before = await verifyReceipt(live, {});
  assert.equal(before.overall, 'verified');
  assert.equal(before.issuer_signature.payload?.payload_version, 8);
  assert.equal(before.receipt_lane.signed, false);
  assert.equal(before.receipt_lane.settled_by, 'receipt');
  assert.equal(before.receipt_lane.settled, true);
  assert.equal(before.receipt_lane.freeze, false);

  const stamped = {
    ...live,
    book_seq: 12,
    book_chain: { seq: 12 },
    receipt_lane: {
      ...changedAnchors,
      freeze: true,
      anchor_changed_since_binding: true,
      settled_by: 'observed_transfer',
      reason: 'unsettled_anchor_changed',
    },
  };
  const after = await verifyReceipt(stamped, {});
  assert.equal(after.overall, 'verified');
  assert.equal(after.issuer_signature.valid, true);
  assert.equal(stamped.issuer_signature.payload_version, 8);
  assert.equal(after.receipt_lane.settled_by, 'receipt');
  assert.equal(after.receipt_lane.settled, true);
  assert.equal(after.receipt_lane.anchor_changed_since_binding, true);
  assert.equal(after.receipt_lane.freeze, false);
  assert.equal(after.receipt_lane.book_seq, 12);
});
