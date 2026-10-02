/**
 * Payload v9 signs tree_head_hash and tolerance. v8 receipts still verify.
 * Tampering the unsigned outer copy fails. The pair is read from the JWS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  decodeReceiptClaims,
  verifyIssuerForHtml,
} from '../src/receipt.js';
import { generateKeyPairSync } from 'node:crypto';
import { verifyAnchorClock } from '../src/receipt-anchor-clock.js';
import { clockToleranceBinding, trustedHeadBindingJwk } from '../src/receipt-head-binding.js';

function paidTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-head-bind',
    status: 'completed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      amount: '2000',
      modelId: 'theta/qwen3',
    },
    meta: {
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      agentId: 4,
      ...(over.meta || {}),
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
    ...over.task,
  };
}

test('a new receipt verifies with the head pair inside the signed claims', () => {
  const receipt = buildReceipt(paidTask(), { signingSecret: 'head-bind-secret' });
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.payload_version, 9);
  assert.equal(receipt.issuer_signature.payload_version, 9);
  assert.equal(receipt.hmac_attestation.payload_version, 8);
  assert.equal(Object.prototype.hasOwnProperty.call(claims, 'tree_head_hash'), true);
  assert.deepEqual(claims.tolerance, clockToleranceBinding());
  assert.equal(receipt.tree_head_hash, claims.tree_head_hash);
  assert.deepEqual(receipt.tolerance, claims.tolerance);

  const verified = verifyIssuerForHtml(receipt);
  assert.equal(verified.verified, true, verified.reason);
});

test('tampered outer tolerance or head hash fails, and the check does not adopt them', () => {
  const receipt = buildReceipt(paidTask({ taskId: 'xfuel-head-tamper' }), {
    signingSecret: 'head-bind-secret',
  });
  const claims = decodeReceiptClaims(receipt);
  const widened = { ...receipt, tolerance: { base: 999999, solana: 999999 } };
  const widenedCheck = verifyIssuerForHtml(widened);
  assert.equal(widenedCheck.verified, false);
  assert.equal(widenedCheck.reason, 'head_binding_mismatch');
  assert.deepEqual(decodeReceiptClaims(widened).tolerance, claims.tolerance);
  assert.notDeepEqual(widened.tolerance, claims.tolerance);

  const swapped = { ...receipt, tree_head_hash: 'f'.repeat(64) };
  const swappedCheck = verifyIssuerForHtml(swapped);
  assert.equal(swappedCheck.verified, false);
  assert.equal(swappedCheck.reason, 'head_binding_mismatch');
  assert.equal(decodeReceiptClaims(swapped).tree_head_hash, claims.tree_head_hash);
});

test('a later covering head is not a tree_head_mismatch', async () => {
  const head = {
    root: 'cd'.repeat(32),
    published_at: '2026-01-01T00:00:00.000Z',
    clock_tolerance_s: { base: 300, solana: 150 },
  };
  const result = await verifyAnchorClock({
    head,
    signedPayload: { published_at: head.published_at, clock_tolerance_s: { base: 300, solana: 150 } },
    enabled: false,
    receiptBinding: {
      verdict: 'ok',
      tree_head_hash: 'ab'.repeat(32),
      tolerance: clockToleranceBinding(),
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_rpc');
});

test('an unpinned key is reported as key untrusted, not a missing pair', async () => {
  const result = await verifyAnchorClock({
    head: { root: 'ab'.repeat(32), published_at: '2026-01-01T00:00:00.000Z' },
    enabled: true,
    receiptBinding: {
      verdict: 'missing',
      reason: 'key untrusted',
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'key untrusted');
});

test('an unpinned embedded issuer key is not a head-binding trust root', () => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const receipt = {
    issuer_signature: {
      issuer_jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256' },
    },
  };
  assert.equal(trustedHeadBindingJwk(receipt), null);
});
