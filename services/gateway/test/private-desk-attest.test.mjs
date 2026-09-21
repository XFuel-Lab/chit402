import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrivacyProduct,
  resolvePrivateSpendContext,
  bodyForPrivacyPricing,
  attestPreflightError,
  attestProofGateError,
  privacyProductLabel,
  PRIVACY_PRODUCT_ATTEST,
  PRIVACY_PRODUCT_DESK,
} from '../src/private-desk-attest.js';
import { wantsSettlementProof } from '../src/x402-server.js';
import { quoteFromCogs } from '../src/pricing.js';
import { privacyOf, buildReceipt } from '../src/receipt.js';
import { finalizePaymentBindingForProof } from '../src/payment-binding.js';
import { buildPaymentBinding } from '../src/payment-binding.js';

test('parsePrivacyProduct: desk and attest wire ids', () => {
  assert.equal(parsePrivacyProduct({ xfuel: { privacy_product: 'private_desk' } }), PRIVACY_PRODUCT_DESK);
  assert.equal(parsePrivacyProduct({ privacy_product: 'private_attest' }), PRIVACY_PRODUCT_ATTEST);
  assert.equal(parsePrivacyProduct({}), null);
});

test('resolvePrivateSpendContext: explicit desk without global flag', () => {
  const ctx = resolvePrivateSpendContext(
    { body: { xfuel: { privacy_product: 'private_desk' } } },
    { privateSpendCfg: { enabled: false }, isPrivateSpendSession: () => false },
  );
  assert.equal(ctx.privateSpend, true);
  assert.equal(ctx.product, PRIVACY_PRODUCT_DESK);
  assert.equal(ctx.privateAttest, false);
});

test('resolvePrivateSpendContext: attest forces vendor blind + tier2 intent', () => {
  const ctx = resolvePrivateSpendContext(
    { body: { privacy_product: 'private_attest' } },
    { privateSpendCfg: { enabled: false }, isPrivateSpendSession: () => false },
  );
  assert.equal(ctx.privateAttest, true);
  assert.equal(ctx.product, PRIVACY_PRODUCT_ATTEST);
});

test('wantsSettlementProof: true for private_attest body', () => {
  assert.equal(wantsSettlementProof({ xfuel: { privacy_product: 'private_attest' } }), true);
  assert.equal(wantsSettlementProof({}), false);
});

test('bodyForPrivacyPricing injects settlement proof_tier for attest', () => {
  const body = bodyForPrivacyPricing({ model: 'theta/qwen3' }, { privateAttest: true });
  assert.equal(body.proof_tier, 'settlement');
});

test('quoteFromCogs itemizes tier2_proof for settlement / attest quotes', () => {
  const q = quoteFromCogs(1_000_000n, { tier2: true });
  assert.equal(q.tier2_proof, '100000');
  assert.equal(Number(q.tier2_proof) / 1_000_000, 0.1);
});

test('privacyOf: Private Desk label without ZK prompt-privacy claims', () => {
  const task = {
    meta: {
      privateSpend: true,
      privacyMode: 'vendor_blind',
      privacyProduct: 'private_desk',
    },
  };
  const p = privacyOf(task);
  assert.equal(p.label, 'Private Desk');
  assert.equal(p.mode, 'vendor_blind');
  assert.equal(p.attest, undefined);
  assert.match(p.notes, /not trustless/i);
  assert.match(p.notes, /Does not encrypt prompts/i);
  assert.doesNotMatch(p.notes, /prompts are private/i);
});

test('privacyOf: Private + Attest tier2 + proof-oriented copy', () => {
  const task = {
    meta: {
      privateSpend: true,
      privacyMode: 'vendor_blind',
      privacyProduct: 'private_attest',
      privacyAttest: 'tier2',
    },
  };
  const p = privacyOf(task);
  assert.equal(p.label, 'Private + Attest');
  assert.equal(p.attest, 'tier2');
  assert.match(p.notes, /in_proof/i);
});

test('buildReceipt privacy block uses product chrome', () => {
  const task = {
    taskId: 'desk-1',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '10000', modelId: 'm' },
    feeAmount: '50',
    netAmount: '9950',
    feeBps: 100,
    meta: {
      provider: 'pooled',
      privateSpend: true,
      privacyMode: 'vendor_blind',
      privacyProduct: 'private_desk',
    },
    sp1Proof: null,
  };
  const receipt = buildReceipt(task, { baseUrl: 'https://api.example' });
  assert.equal(receipt.privacy.label, 'Private Desk');
});

test('attestPreflightError: fail closed when prover missing', () => {
  const err = attestPreflightError(
    { privateAttest: true },
    { proverConfigured: false, apiKey: 'k' },
  );
  assert.equal(err.code, 'attest_prover_unavailable');
});

test('attestProofGateError: fail closed without in_proof', () => {
  const task = { sp1Proof: { proof: '0xabc', paymentBinding: { in_proof: false } } };
  const err = attestProofGateError(task, { privateAttest: true });
  assert.equal(err.code, 'attest_proof_incomplete');
});

test('attestProofGateError: ok when in_proof true', () => {
  const baseBinding = buildPaymentBinding({
    taskId: 't1',
    intent: { amount: '2000', paymentRef: 'base:0xabc', paymentRail: 'usdc' },
    meta: {},
  }, { proofBinding: true });
  const binding = finalizePaymentBindingForProof(baseBinding, {
    publicValuesVersion: 2,
    paymentCommitment: baseBinding.commitment,
  });
  const task = { sp1Proof: { proof: '0xabc', paymentBinding: binding } };
  assert.equal(attestProofGateError(task, { privateAttest: true }), null);
});

test('privacyProductLabel human names', () => {
  assert.equal(privacyProductLabel(PRIVACY_PRODUCT_DESK), 'Private Desk');
  assert.equal(privacyProductLabel(PRIVACY_PRODUCT_ATTEST), 'Private + Attest');
});
