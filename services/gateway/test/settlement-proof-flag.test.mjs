/**
 * SETTLEMENT_PROOF_ENABLED gates the settlement proof add-on. Only the exact
 * string 'true' turns it on. Off: a request for a settlement proof is refused
 * before any 402, settle or receipt; no proof is requested; in_proof stays false.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'false';
delete process.env.SETTLEMENT_PROOF_ENABLED;

const fac = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = fac.url;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const flag = await import('../src/settlement-proof-flag.js');
// The add-on's code guard stays false; tests flip it to exercise the flag-on paths.
flag._allowSettlementProofForTests(true);
const { buildPaymentBinding, finalizePaymentBindingForProof } = await import('../src/payment-binding.js');
const { proveAllowedForKey, settlementProofAllowed } = await import('../src/prove-gate.js');

let server;
let base;
const chat = { model: 'theta/qwen3', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 };
const SETTLEMENT_BODIES = {
  'proof_tier': { ...chat, proof_tier: 'settlement' },
  'proofTier uppercase': { ...chat, proofTier: ' Settlement ' },
  'xfuel.proof_tier': { ...chat, xfuel: { proof_tier: 'settlement' } },
  'intent.proofTier': { ...chat, intent: { proofTier: 'settlement' } },
  'private_attest': { ...chat, xfuel: { privacy_product: 'private_attest' } },
};

before(async () => {
  resetHubCatalogCache();
  await initAIListener();
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
after(async () => {
  await fac.close();
  await new Promise((resolve) => server.close(resolve));
});
afterEach(() => { delete process.env.SETTLEMENT_PROOF_ENABLED; });

const post = (body, headers = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('only the exact string true turns the flag on', () => {
  assert.equal(flag.settlementProofEnabled({}), false);
  for (const v of ['', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', 'false']) {
    assert.equal(flag.settlementProofEnabled({ SETTLEMENT_PROOF_ENABLED: v }), false, JSON.stringify(v));
  }
  assert.equal(flag.settlementProofEnabled({ SETTLEMENT_PROOF_ENABLED: 'true' }), true);
});

test('flag off: a settlement request is refused before the 402, with no settle and no receipt', async () => {
  for (const value of [undefined, 'TRUE', '1', 'garbage']) {
    if (value === undefined) delete process.env.SETTLEMENT_PROOF_ENABLED;
    else process.env.SETTLEMENT_PROOF_ENABLED = value;
    for (const [name, body] of Object.entries(SETTLEMENT_BODIES)) {
      const res = await post(body);
      assert.equal(res.status, 400, `${name} (${value})`);
      assert.equal(res.headers.get('payment-required'), null, name);
      const json = await res.json();
      assert.deepEqual(json, { error: { code: 'settlement_proof_not_offered', message: 'Tier-2 settlement proofs are temporarily unavailable. Retry without proof_tier.' } });
    }
  }
  // A payment presented with the request is never verified or settled.
  delete process.env.SETTLEMENT_PROOF_ENABLED;
  const challenge = await post(chat);
  assert.equal(challenge.status, 402, 'a plain request still gets the normal challenge');
  const nonce = (await challenge.json()).accepts[0].extra.nonce;
  const settledBefore = fac.server.settleCount;
  const res = await post({ ...chat, proof_tier: 'settlement' }, { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': nonce });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, 'settlement_proof_not_offered');
  assert.equal(json.xfuel, undefined, 'no receipt');
  assert.equal(res.headers.get('x-xfuel-receipt-url'), null);
  assert.equal(fac.server.settleCount, settledBefore, 'no settle call');
});

test('flag on: the same request gets the existing 402 challenge', async () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const res = await post({ ...chat, proof_tier: 'settlement' });
  assert.equal(res.status, 402);
  const json = await res.json();
  assert.ok(json.accepts?.length, 'normal x402 challenge');
});

test('flag off: no proof is requested and in_proof cannot be set true', () => {
  const binding = buildPaymentBinding({
    taskId: 't1',
    intent: { amount: '2000', paymentRef: 'base:0xabc', paymentRail: 'usdc' },
    meta: {},
  }, { proofBinding: true });
  const proof = { publicValuesVersion: 2, paymentCommitment: binding.commitment };
  assert.equal(proveAllowedForKey(undefined), false);
  assert.equal(settlementProofAllowed({ proofTier: 'settlement' }), false);
  assert.equal(settlementProofAllowed({ cogs: 10n ** 9n, minCogs: '1' }), false);
  assert.equal(finalizePaymentBindingForProof(binding, proof).in_proof, false);

  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  assert.equal(finalizePaymentBindingForProof(binding, proof).in_proof, true, 'flag on keeps the old path');
  assert.equal(settlementProofAllowed({ proofTier: 'settlement' }), process.env.PROVER_ENABLED !== 'false');
});

const { verifyEscrowRelease } = await import('../src/book-escrow.js');

test('flag on: in_proof fails closed on a missing, zero or mismatched commitment and needs explicit v2', () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const binding = buildPaymentBinding({
    taskId: 't2',
    intent: { amount: '2000', paymentRef: 'base:0xabc', paymentRail: 'usdc' },
    meta: {},
  }, { proofBinding: true });
  const cases = {
    'no commitment echoed': { publicValuesVersion: 2 },
    'zero commitment': { publicValuesVersion: 2, paymentCommitment: `0x${'0'.repeat(64)}` },
    'other commitment': { publicValuesVersion: 2, paymentCommitment: `0x${'12'.repeat(32)}` },
    'ABI string only, no version': { aiPublicValuesAbi: '0xdeadbeef', paymentCommitment: binding.commitment },
    'version 1': { publicValuesVersion: 1, paymentCommitment: binding.commitment },
  };
  for (const [name, proof] of Object.entries(cases)) {
    assert.equal(finalizePaymentBindingForProof(binding, proof).in_proof, false, name);
  }
  assert.equal(finalizePaymentBindingForProof(binding, { publicValuesVersion: 2, paymentCommitment: binding.commitment }).in_proof, true);
});

test('escrow requiring the settlement tier is held while the flag is off', () => {
  const entry = { collected: true, amount: '2000' };
  const settlementReceipt = { proof: { tier: 'settlement' } };
  const inferenceReceipt = { proof: { tier: 'inference' } };
  const settlementEscrow = { required: { proof_tier: 'settlement' } };
  for (const value of [undefined, 'TRUE', '1']) {
    if (value === undefined) delete process.env.SETTLEMENT_PROOF_ENABLED;
    else process.env.SETTLEMENT_PROOF_ENABLED = value;
    for (const receipt of [settlementReceipt, inferenceReceipt]) {
      const r = verifyEscrowRelease(settlementEscrow, receipt, entry);
      assert.equal(r.ok, false, String(value));
      assert.equal(r.reason, 'settlement tier unavailable; escrow held');
    }
  }
  // Other requirements are unchanged.
  delete process.env.SETTLEMENT_PROOF_ENABLED;
  const inf = verifyEscrowRelease({ required: { proof_tier: 'inference' } }, inferenceReceipt, entry);
  assert.notEqual(inf.reason, 'settlement tier unavailable; escrow held');
  // Flag on: the existing tier check decides.
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  assert.equal(verifyEscrowRelease(settlementEscrow, settlementReceipt, entry).checks.proof_tier.valid, true);
});
