/**
 * Phase 3 — ERC-8004 validation verdict tests.
 *
 * Validates buildValidationRecord: score/tag mapping, eligibility gating, evidence commitment,
 * and input validation. Parity with the SDK receiptToValidationVerdict is enforced by shape
 * (both mirror this module) and by the SDK's own tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toUtf8Bytes } from 'ethers';
import { buildValidationRecord, isReceiptValidatable } from '../src/erc8004.js';

const REQ = '0x' + '11'.repeat(32);

function settledReceipt(over = {}) {
  return {
    task_id: 'task-erc-1',
    proof_outcome: 'valid',
    proof: { tier: 'settlement' },
    binding: { covers: ['payment', 'settlement'], matches: true },
    output: { hash: '0x' + 'cd'.repeat(32) },
    verify_url: 'https://api.xfuel.app/receipt/task-erc-1',
    payment: { rail: 'usdc', ref: 'base:0xabc', net_amount: '995000', fee_amount: '5000' },
    route: { model: 'llama-3-70b:q4_k_m' },
    ...over,
  };
}

test('buildValidationRecord: settled + matching → response 100, tag xfuel:settlement', () => {
  const v = buildValidationRecord(settledReceipt(), { requestHash: REQ, agentId: 42 });
  assert.equal(v.eligible, true);
  assert.equal(v.response, 100);
  assert.equal(v.tag, 'xfuel:settlement');
  assert.equal(v.agent_id, '42');
  assert.equal(v.response_uri, 'https://api.xfuel.app/receipt/task-erc-1');
  assert.equal(v.task_id_hash, keccak256(toUtf8Bytes('task-erc-1')));
  assert.match(v.response_hash, /^0x[0-9a-f]{64}$/);
});

test('buildValidationRecord: PBR coverage tags xfuel:<tier>+pbr', () => {
  const r = settledReceipt();
  r.binding.covers = ['payment', 'settlement', 'model', 'inference'];
  const v = buildValidationRecord(r, { requestHash: REQ, agentId: 1 });
  assert.equal(v.tag, 'xfuel:settlement+pbr');
});

test('buildValidationRecord: binding mismatch → response 0', () => {
  const r = settledReceipt();
  r.binding.matches = false;
  const v = buildValidationRecord(r, { requestHash: REQ, agentId: 1 });
  assert.equal(v.response, 0);
  assert.equal(v.tag, 'xfuel:binding-mismatch');
});

test('buildValidationRecord: invalid proof → response 0', () => {
  const v = buildValidationRecord(settledReceipt({ proof_outcome: 'invalid' }), { requestHash: REQ, agentId: 1 });
  assert.equal(v.response, 0);
  assert.equal(v.tag, 'xfuel:proof-invalid');
});

test('buildValidationRecord: signed tier (no proof) still passes with xfuel:signed', () => {
  const v = buildValidationRecord(
    settledReceipt({ proof: { tier: 'signed' }, binding: null }),
    { requestHash: REQ, agentId: 1 },
  );
  assert.equal(v.response, 100);
  assert.equal(v.tag, 'xfuel:signed');
  assert.equal(v.binding_matches, null);
});

test('buildValidationRecord: ineligible when no delivered output', () => {
  const v = buildValidationRecord(
    settledReceipt({ output: null, proof_outcome: 'pending' }),
    { requestHash: REQ, agentId: 1 },
  );
  assert.equal(v.eligible, false);
  assert.equal(v.tag, 'xfuel:pending');
  assert.equal(isReceiptValidatable(settledReceipt({ output: null })), false);
});

test('buildValidationRecord: rejects bad requestHash / agentId', () => {
  assert.throws(() => buildValidationRecord(settledReceipt(), { requestHash: '0xabc', agentId: 1 }), /requestHash/);
  assert.throws(() => buildValidationRecord(settledReceipt(), { requestHash: REQ, agentId: 'x' }), /agentId/);
});
