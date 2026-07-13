import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  renderReceiptHtml,
  renderReceiptNotFound,
  explorerUrlForRef,
} from '../src/receipt.js';
import { computePaymentCommitment } from '../src/payment-binding.js';

const TASK_ID = 'task-abc123';

function usdcTask(over = {}) {
  const amount = '1000000';
  const netAmount = '995000';
  const paymentRef = 'base-sepolia:0x' + 'ab'.repeat(32);
  // A correctly-bound commitment (what the prover/backend would have stored).
  const { commitment, paymentRefHash } = computePaymentCommitment({
    paymentRef, taskId: TASK_ID, rail: 'usdc', amount: netAmount,
  });
  return {
    taskId: TASK_ID,
    status: 'completed',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:05.000Z',
    intent: {
      type: 'inference_request',
      model: 'llama-3-70b',
      chainId: 'theta',
      amount,
      paymentRail: 'usdc',
      paymentRef,
      proofSystem: 'sp1',
    },
    feeAmount: '5000',
    netAmount,
    feeBps: 50,
    result: 'ZK proofs let you verify a computation without redoing it.',
    meta: { chain: 'theta', provider: 'theta-edgecloud' },
    sp1Proof: {
      proof: '0xproofbytes',
      nullifier: '0x' + 'cd'.repeat(32),
      provingTimeMs: 264,
      paymentBinding: {
        version: 2, rail: 'usdc', commitment, payment_ref_hash: paymentRefHash,
        amount: netAmount, in_proof: false,
      },
    },
    ...over,
  };
}

test('explorerUrlForRef: base-sepolia, base, unknown, tfuel-null', () => {
  const tx = '0x' + 'ab'.repeat(32);
  assert.equal(explorerUrlForRef(`base-sepolia:${tx}`), `https://sepolia.basescan.org/tx/${tx}`);
  assert.equal(explorerUrlForRef(`base:${tx}`), `https://basescan.org/tx/${tx}`);
  assert.equal(explorerUrlForRef(`solana:${tx}`), null);
  assert.equal(explorerUrlForRef(null), null);
  assert.equal(explorerUrlForRef('base-sepolia:not-a-hash'), null);
});

test('buildReceipt: USDC task is proven, priced, and independently binding-verified', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api-testnet.xfuel.app' });
  assert.equal(r.task_id, TASK_ID);
  assert.equal(r.status, 'completed');
  assert.equal(r.proof_outcome, 'valid');

  assert.equal(r.route.model, 'llama-3-70b');
  assert.equal(r.route.provider, 'theta-edgecloud');

  assert.equal(r.payment.rail, 'usdc');
  assert.match(r.payment.explorer_url, /^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
  assert.equal(r.payment.net_amount, '995000');
  assert.equal(r.payment.fee_bps, 50);

  assert.equal(r.proof.system, 'sp1');
  assert.equal(r.proof.has_proof, true);
  assert.match(r.proof.attests, /does NOT attest/i);

  // The independent re-derivation must match the stored commitment.
  assert.ok(r.binding);
  assert.equal(r.binding.matches, true);
  assert.equal(r.binding.expected_commitment, r.binding.recomputed_commitment);
  assert.equal(r.binding.in_proof, false);

  // Output hash is a commitment (not the raw text).
  assert.equal(r.output.kind, 'sha256_of_output');
  assert.match(r.output.hash, /^0x[0-9a-f]{64}$/);

  // Absolute links when a baseUrl is provided.
  assert.equal(r.links.self, `https://api-testnet.xfuel.app/receipt/${TASK_ID}`);
  assert.equal(r.links.json, `https://api-testnet.xfuel.app/receipt/${TASK_ID}?format=json`);
});

test('buildReceipt: binding mismatch is detected (tampered commitment)', () => {
  const task = usdcTask();
  task.sp1Proof.paymentBinding.commitment = '0x' + '00'.repeat(32);
  const r = buildReceipt(task);
  assert.equal(r.binding.matches, false);
  assert.notEqual(r.binding.expected_commitment, r.binding.recomputed_commitment);
});

test('buildReceipt: TFUEL task has no binding and no explorer link', () => {
  const task = usdcTask({
    intent: { type: 'inference_request', amount: '1000000', paymentRail: 'tfuel', paymentRef: null, proofSystem: 'sp1' },
    sp1Proof: { proof: '0x', nullifier: '0xnull', provingTimeMs: 100 },
  });
  const r = buildReceipt(task);
  assert.equal(r.payment.rail, 'tfuel');
  assert.equal(r.payment.explorer_url, null);
  assert.equal(r.binding, null);
});

test('buildReceipt: pending task (no proof yet)', () => {
  const task = usdcTask({ status: 'routing', sp1Proof: null, result: null });
  const r = buildReceipt(task);
  assert.equal(r.proof_outcome, 'pending');
  assert.equal(r.proof.has_proof, false);
  assert.equal(r.output, null);
});

test('renderReceiptHtml: shareable page includes key fields + escapes hostile input', () => {
  const task = usdcTask({ intent: { ...usdcTask().intent, model: '<script>alert(1)</script>' } });
  const html = renderReceiptHtml(buildReceipt(task));
  assert.match(html, /<!doctype html>/i);
  assert.ok(html.includes(TASK_ID));
  assert.match(html, /Proven/);
  assert.match(html, /og:title/);
  // The injected script tag must be escaped, not rendered.
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderReceiptNotFound: escapes the task id', () => {
  const html = renderReceiptNotFound('<b>x</b>');
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});
