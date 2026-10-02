/**
 * Payload v9 signs tree_head_hash and tolerance. v8 receipts still verify.
 * Tampering the unsigned outer copy fails. The pair is read from the JWS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  decodeReceiptClaims,
  stampCoveringTreeHead,
  verifyIssuerForHtml,
} from '../src/receipt.js';
import { generateKeyPairSync } from 'node:crypto';
import { verifyAnchorClock } from '../src/receipt-anchor-clock.js';
import { clockToleranceBinding, trustedHeadBindingJwk } from '../src/receipt-head-binding.js';
import {
  getReceiptMerkleTree,
  inclusionProof,
  resetReceiptMerkleTree,
  rootOf,
  verifyInclusion,
} from '../src/receipt-merkle.js';

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
    proven: true,
    receiptBinding: {
      verdict: 'ok',
      tree_head_hash: 'ab'.repeat(32),
      tolerance: clockToleranceBinding(),
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_rpc');
});

test('a published head that is not the signed prefix is not a tree_head_mismatch', async () => {
  const result = await verifyAnchorClock({
    head: { root: 'cd'.repeat(32), published_at: '2026-01-01T00:00:00.000Z' },
    enabled: false,
    proven: null,
    receiptBinding: {
      verdict: 'ok',
      tree_head_hash: 'ab'.repeat(32),
      tolerance: clockToleranceBinding(),
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_rpc');
});

function prefixThrough(tree, taskId) {
  const index = tree.byTask.get(String(taskId));
  const slice = tree.leaves.slice(0, index + 1);
  return {
    index,
    leaf: tree.leaves[index],
    tree_size: index + 1,
    root: rootOf(slice).toString('hex'),
    proof: inclusionProof(slice, index),
  };
}

test('v9 signs the prefix root that includes this receipt, not the prior head', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevSolRpc = process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  resetReceiptMerkleTree();
  try {
    const tree = getReceiptMerkleTree();
    tree.appendReceipt('earlier-than-receipt', 'h0');
    const prior = await tree.publishHead({ force: true });
    const taskId = 'xfuel-covering-head';
    tree.appendReceipt(taskId, 'row-1');
    assert.equal(tree.latestHead().root, prior.root);
    assert.notEqual(tree.prefixRoot(taskId), prior.root);

    const receipt = buildReceipt(paidTask({ taskId }), { signingSecret: 'head-bind-secret' });
    const claims = decodeReceiptClaims(receipt);
    const prefix = prefixThrough(tree, taskId);
    assert.equal(claims.tree_head_hash, prefix.root);
    assert.notEqual(claims.tree_head_hash, prior.root);
    assert.equal(
      verifyInclusion(prefix.leaf, prefix.index, prefix.tree_size, claims.tree_head_hash, prefix.proof),
      true,
    );
    const priorProof = inclusionProof(tree.leaves.slice(0, prior.tree_size), prefix.index);
    assert.equal(priorProof, null);
    assert.equal(
      verifyInclusion(prefix.leaf, prefix.index, prior.tree_size, prior.root, prefix.proof),
      false,
    );

    tree.appendReceipt('after-receipt', 'h2');
    const later = await tree.publishHead({ force: true });
    assert.notEqual(later.root, claims.tree_head_hash);
    const laterSlice = tree.leaves.slice(0, later.tree_size);
    const laterProof = inclusionProof(laterSlice, prefix.index);
    assert.equal(
      verifyInclusion(prefix.leaf, prefix.index, later.tree_size, later.root, laterProof),
      true,
    );
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
    if (prevSolRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = prevSolRpc;
    resetReceiptMerkleTree();
  }
});

test('a signature taken before the append is restamped onto the covering prefix', () => {
  resetReceiptMerkleTree();
  try {
    const tree = getReceiptMerkleTree();
    tree.appendReceipt('prior-leaf', 'h0');
    const taskId = 'xfuel-restamp-head';
    const early = buildReceipt(paidTask({ taskId }), { signingSecret: 'head-bind-secret' });
    assert.equal(decodeReceiptClaims(early).tree_head_hash, null);
    tree.appendReceipt(taskId, 'row-restamp');
    stampCoveringTreeHead(early);
    const claims = decodeReceiptClaims(early);
    const prefix = prefixThrough(tree, taskId);
    assert.equal(claims.tree_head_hash, prefix.root);
    assert.equal(early.tree_head_hash, prefix.root);
    assert.equal(verifyIssuerForHtml(early).verified, true);
    assert.equal(
      verifyInclusion(prefix.leaf, prefix.index, prefix.tree_size, claims.tree_head_hash, prefix.proof),
      true,
    );
  } finally {
    resetReceiptMerkleTree();
  }
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
