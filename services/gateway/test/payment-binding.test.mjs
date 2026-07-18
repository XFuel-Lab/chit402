/**
 * Phase 2 x402 payment-binding tests.
 *
 * Validates the deterministic commitment + the flag/rail gating of
 * buildPaymentBinding. Parity with the Solidity SP1ProofHooks.computePaymentCommitment
 * is separately guarded by test/security/SP1ProofHooksHarness.test.cjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toUtf8Bytes, solidityPacked } from 'ethers';
import {
  PAYMENT_RAIL,
  computePaymentCommitment,
  computeInferenceBinding,
  buildPaymentBinding,
} from '../src/payment-binding.js';

const taskFixture = (over = {}) => ({
  taskId: 'task-abc',
  netAmount: '950000000000000000',
  intent: { paymentRail: 'usdc', paymentRef: 'base:0xdeadbeef', amount: '1000000000000000000' },
  ...over,
});

test('computePaymentCommitment matches the abi.encodePacked formula', () => {
  const paymentRef = 'base:0xdeadbeef';
  const taskId = 'task-abc';
  const amount = '950000000000000000';

  const { commitment, paymentRefHash, railDiscriminant } = computePaymentCommitment({
    paymentRef, taskId, rail: 'usdc', amount,
  });

  assert.equal(railDiscriminant, PAYMENT_RAIL.usdc);
  const expected = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [keccak256(toUtf8Bytes(paymentRef)), keccak256(toUtf8Bytes(taskId)), 1, BigInt(amount)],
    ),
  );
  assert.equal(commitment, expected);
  assert.equal(paymentRefHash, keccak256(toUtf8Bytes(paymentRef)));
});

test('computePaymentCommitment is deterministic and input-sensitive', () => {
  const base = computePaymentCommitment({ paymentRef: 'base:0x1', taskId: 't', rail: 'usdc', amount: '100' }).commitment;
  const same = computePaymentCommitment({ paymentRef: 'base:0x1', taskId: 't', rail: 'usdc', amount: '100' }).commitment;
  const byRef = computePaymentCommitment({ paymentRef: 'base:0x2', taskId: 't', rail: 'usdc', amount: '100' }).commitment;
  const byTask = computePaymentCommitment({ paymentRef: 'base:0x1', taskId: 't2', rail: 'usdc', amount: '100' }).commitment;
  const byRail = computePaymentCommitment({ paymentRef: 'base:0x1', taskId: 't', rail: 'tfuel', amount: '100' }).commitment;
  const byAmt = computePaymentCommitment({ paymentRef: 'base:0x1', taskId: 't', rail: 'usdc', amount: '200' }).commitment;

  assert.equal(base, same);
  for (const other of [byRef, byTask, byRail, byAmt]) assert.notEqual(base, other);
});

test('buildPaymentBinding returns null when the flag is off', () => {
  assert.equal(buildPaymentBinding(taskFixture(), { proofBinding: false }), null);
  assert.equal(buildPaymentBinding(taskFixture(), undefined), null);
});

test('buildPaymentBinding returns null for non-USDC or missing ref', () => {
  const cfg = { proofBinding: true };
  assert.equal(buildPaymentBinding(taskFixture({ intent: { paymentRail: 'tfuel', paymentRef: null } }), cfg), null);
  assert.equal(buildPaymentBinding(taskFixture({ intent: { paymentRail: 'usdc', paymentRef: null } }), cfg), null);
});

test('buildPaymentBinding produces a bound descriptor for USDC tasks', () => {
  const cfg = { proofBinding: true };
  const binding = buildPaymentBinding(taskFixture(), cfg);
  assert.ok(binding);
  assert.equal(binding.version, 2);
  assert.equal(binding.rail, 'usdc');
  assert.equal(binding.in_proof, false); // pending SP1 guest v2 activation
  assert.match(binding.commitment, /^0x[0-9a-f]{64}$/);
  assert.match(binding.payment_ref_hash, /^0x[0-9a-f]{64}$/);
  assert.equal(binding.amount, '950000000000000000');

  // Matches the standalone commitment for the same inputs.
  const direct = computePaymentCommitment({
    paymentRef: 'base:0xdeadbeef', taskId: 'task-abc', rail: 'usdc', amount: '950000000000000000',
  }).commitment;
  assert.equal(binding.commitment, direct);
  assert.deepEqual(binding.covers, ['payment', 'settlement']);
});

const MODEL_C = '0x' + 'ab'.repeat(32);
const OUTPUT_H = '0x' + 'cd'.repeat(32);

test('computeInferenceBinding matches the 6-field abi.encodePacked formula', () => {
  const paymentRef = 'base:0xdeadbeef';
  const taskId = 'task-abc';
  const amount = '950000000000000000';
  const { commitment } = computeInferenceBinding({
    paymentRef, taskId, rail: 'usdc', amount, modelCommitment: MODEL_C, outputHash: OUTPUT_H,
  });
  const expected = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256', 'bytes32', 'bytes32'],
      [keccak256(toUtf8Bytes(paymentRef)), keccak256(toUtf8Bytes(taskId)), 1, BigInt(amount), MODEL_C, OUTPUT_H],
    ),
  );
  assert.equal(commitment, expected);
  // superset differs from the payment-only commitment
  const paymentOnly = computePaymentCommitment({ paymentRef, taskId, rail: 'usdc', amount }).commitment;
  assert.notEqual(commitment, paymentOnly);
});

test('buildPaymentBinding upgrades to PBR when model commitment + output hash present', () => {
  const cfg = { proofBinding: true };
  const task = taskFixture({
    modelCommitment: MODEL_C,
    outputHash: OUTPUT_H,
  });
  const binding = buildPaymentBinding(task, cfg);
  assert.ok(binding);
  assert.deepEqual(binding.covers, ['payment', 'settlement', 'model', 'inference']);
  assert.equal(binding.model_commitment, MODEL_C);
  assert.equal(binding.output_hash, OUTPUT_H);
  const direct = computeInferenceBinding({
    paymentRef: 'base:0xdeadbeef', taskId: 'task-abc', rail: 'usdc', amount: '950000000000000000',
    modelCommitment: MODEL_C, outputHash: OUTPUT_H,
  }).commitment;
  assert.equal(binding.commitment, direct);
});
