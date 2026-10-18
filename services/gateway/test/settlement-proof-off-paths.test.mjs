/**
 * Follow-ups to the settlement proof add-on switch (SETTLEMENT_PROOF_ENABLED).
 * N2-1: no path reports tier 'settlement' without a verified settlement proof.
 * P1:   chain-intent and A2A paths request no SP1 proof and price no +$0.10 while off.
 * E1:   A2A escrow and settlement-tier escrow are refused at OPEN/FUND while off.
 * C1:   public pricing/health/receipt copy does not advertise the add-on while off.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.SETTLEMENT_PROOF_ENABLED;
process.env.HUB_CATALOG_OFFLINE = 'true';

// Local stand-in for the SP1 prover: counts /prove calls, never proves.
let proveCalls = 0;
const prover = http.createServer((req, res) => {
  if (req.method === 'POST') proveCalls += 1;
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(500, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'test prover never proves' }));
});
await new Promise((resolve) => prover.listen(0, '127.0.0.1', resolve));
process.env.SP1_PROVER_URL = `http://127.0.0.1:${prover.address().port}`;
process.env.SP1_PROVER_RETRIES = '1';
process.env.SP1_PROVER_TIMEOUT = '2000';
process.env.SP1_BATCHING_ENABLED = 'false';

const receipt = await import('../src/receipt.js');
const { computePaymentCommitment } = await import('../src/payment-binding.js');
const { initSP1Prover } = await import('../src/sp1-prover-client.js');
const listenerMod = await import('../src/ai-listener.js');
const { _generateA2AProof } = await import('../src/server.js');
const { wantsSettlementProof } = await import('../src/x402-server.js');
const { describePricing, publishedPrice } = await import('../src/pricing.js');
const { proofAvailability } = await import('../src/prove-gate.js');
const { attestPreflightError, attestProofGateError } = await import('../src/private-desk-attest.js');
const flag = await import('../src/settlement-proof-flag.js');

const Listener = listenerMod.default;
await initSP1Prover();

after(async () => { await new Promise((resolve) => prover.close(resolve)); });
afterEach(() => {
  delete process.env.SETTLEMENT_PROOF_ENABLED;
  delete process.env.X402_ROLLING_SETTLEMENT;
});

const TASK_ID = 'task-off-paths';
function task(over = {}) {
  const paymentRef = 'base-sepolia:0x' + 'ab'.repeat(32);
  const { commitment, paymentRefHash } = computePaymentCommitment({
    paymentRef, taskId: TASK_ID, rail: 'usdc', amount: '995000',
  });
  return {
    taskId: TASK_ID,
    status: 'completed',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:05.000Z',
    intent: { type: 'inference_request', amount: '1000000', paymentRail: 'usdc', paymentRef, proofSystem: 'sp1' },
    netAmount: '995000',
    feeAmount: '5000',
    meta: { chain: 'base', txHash: 'api-off', height: 0 },
    result: { provider: 'theta-edgecloud', outputHash: '0x' + 'ab'.repeat(32) },
    sp1Proof: null,
    _binding: { version: 2, rail: 'usdc', commitment, payment_ref_hash: paymentRefHash, amount: '995000' },
    ...over,
  };
}
const VI_ON = {
  enabled: true, tier2Min: '10000', tier3Min: '1000000000',
  available: { settlement: true, tee: false, 'zk-spotcheck': false, 'zk-full': false },
};

// ── N2-1 ────────────────────────────────────────────────────────────────────

test('N2-1: tier engine value floor cannot report settlement without a verified proof (flag off and on)', () => {
  for (const value of [undefined, 'true']) {
    if (value) process.env.SETTLEMENT_PROOF_ENABLED = value;
    const t = task();
    const vi = receipt.verifiedInferenceOf(t, VI_ON);
    assert.equal(vi.tier, 'signed', String(value));
    assert.equal(vi.degraded, true);
    const scope = receipt.proofScopeOf(t, vi, 'not_applicable');
    assert.equal(scope.tier, 'signed');
    assert.equal(scope.zkp_tier, 'signed');
    assert.equal(scope.nullifier_enforced, false);
  }
});

test('N2-1: proof_tier inference with no Tier-3 mechanism falls back to signed, not settlement', () => {
  const t = task({ intent: { ...task().intent, amount: '1', proofTier: 'inference' } });
  const vi = receipt.verifiedInferenceOf(t, VI_ON);
  assert.equal(vi.tier, 'signed');
  assert.equal(receipt.proofScopeOf(t, vi, 'not_applicable').tier, 'signed');
});

test('N2-1: proof bytes without in_proof, or a stored settlement tier, stay signed', () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const base = task();
  const bytesOnly = task({ sp1Proof: { proof: '0xproof', paymentBinding: { ...base._binding, in_proof: false } } });
  assert.equal(receipt.proofScopeOf(bytesOnly, receipt.verifiedInferenceOf(bytesOnly, VI_ON), 'valid').tier, 'signed');
  const stored = task({ verifiedInference: { tier: 'settlement' } });
  assert.equal(receipt.proofTierOf(stored), 'signed');
  assert.equal(receipt.proofScopeOf(stored, { tier: 'settlement' }, 'pending').tier, 'signed');
});

test('N2-1: a verified settlement proof still reports settlement when the flag is on', () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const base = task();
  const proven = task({ sp1Proof: { proof: '0xproof', nullifier: '0x' + 'cd'.repeat(32), paymentBinding: { ...base._binding, in_proof: true } } });
  const vi = receipt.verifiedInferenceOf(proven, VI_ON);
  assert.equal(vi.tier, 'settlement');
  assert.equal(receipt.proofScopeOf(proven, vi, 'valid').tier, 'settlement');
  delete process.env.SETTLEMENT_PROOF_ENABLED;
  assert.equal(receipt.proofScopeOf(proven, receipt.verifiedInferenceOf(proven, VI_ON), 'valid').tier, 'signed');
});

test('N2-1: proof_tier inference and its aliases are refused while off, accepted while on', () => {
  for (const t of ['inference', 'tee', 't3a', 'zk-spotcheck', 'spotcheck', 'zk-full', 'full', ' Inference ']) {
    assert.equal(flag.requestsSettlementProof({ proof_tier: t }), true, t);
    assert.equal(flag.requestsSettlementProof({ xfuel: { proofTier: t } }), true, t);
  }
  assert.equal(flag.requestsSettlementProof({ proof_tier: 'signed' }), false);
  assert.equal(flag.requestsSettlementProof({}), false);
  let status = null;
  const res = { status(s) { status = s; return this; }, json(b) { this.body = b; return this; } };
  let nexted = false;
  flag.refuseSettlementProofWhenOff({ body: { proof_tier: 'inference' } }, res, () => { nexted = true; });
  assert.equal(status, 400);
  assert.equal(res.body.error.code, 'settlement_proof_not_offered');
  assert.equal(res.body.error.message, 'Tier-2 settlement proofs are temporarily unavailable. Retry without proof_tier.');
  assert.equal(nexted, false);
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  flag.refuseSettlementProofWhenOff({ body: { proof_tier: 'inference' } }, res, () => { nexted = true; });
  assert.equal(nexted, true);
});

// ── P1 ──────────────────────────────────────────────────────────────────────

function chainTask() {
  // Chain-intent tasks carry no proveAllowed (undefined), unlike HTTP tasks.
  const t = task();
  t.intent = { ...t.intent, proofTier: 'settlement' };
  delete t.intent.proveAllowed;
  return t;
}

test('P1: chain-intent path requests no SP1 proof while off; control: flag on does call the prover', async () => {
  const listener = Object.create(Listener.prototype);
  const off = chainTask();
  const before = proveCalls;
  await listener._generateTaskProof(off);
  assert.equal(proveCalls, before, 'no /prove call while off');
  assert.equal(off.sp1Proof.skipped, true);
  assert.equal(off.sp1Proof.reason, 'settlement_proof_not_offered');
  assert.equal(receipt.proofOutcomeOf(off), 'not_applicable');

  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const on = chainTask();
  await listener._generateTaskProof(on);
  assert.ok(proveCalls > before, 'flag on reaches the prover (old path)');
  assert.ok(on.sp1Proof.error, 'test prover fails, as designed');
});

test('P1: A2A registration proof is skipped while off; control: flag on calls the prover', async () => {
  const msg = { messageId: 'a2a-1', escrowAmount: '0x00', senderIdentity: 'agent-1', msgType: 1, senderChain: 1, recipientChain: 1, payloadHash: '0x' + '11'.repeat(32) };
  const before = proveCalls;
  await _generateA2AProof(msg);
  assert.equal(proveCalls, before);
  assert.equal(msg.sp1Proof.skipped, true);
  assert.equal(msg.sp1Proof.reason, 'settlement_proof_not_offered');

  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const msg2 = { ...msg, messageId: 'a2a-2' };
  delete msg2.sp1Proof;
  await _generateA2AProof(msg2);
  assert.ok(proveCalls > before);
  assert.notEqual(msg2.sp1Proof?.reason, 'settlement_proof_not_offered');
});

test('P1: rolling settlement on the chain path does not price the +$0.10 add-on while off', async () => {
  process.env.X402_ROLLING_SETTLEMENT = 'true';
  const run = async () => {
    const listener = Object.create(Listener.prototype);
    listener.activeTasks = new Map();
    const t = chainTask();
    t.meta = { ...t.meta, rolling: { fronted: true, recorded: false, payerId: null } };
    t.usage = { prompt_tokens: 10, completion_tokens: 10 };
    try { await listener._reconcileProviderCogs(t); } catch { /* float reconcile is out of scope here */ }
    return t.meta.pricing;
  };
  const off = await run();
  assert.equal(off.tier2_proof, '0');
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const on = await run();
  assert.equal(on.tier2_proof, '100000', 'flag on keeps the old price');
});

test('P1: quote path never adds the surcharge while off (wantsSettlementProof)', () => {
  assert.equal(wantsSettlementProof({ proof_tier: 'settlement' }), false);
  assert.equal(wantsSettlementProof({ xfuel: { privacy_product: 'private_attest' } }), false);
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  assert.equal(wantsSettlementProof({ proof_tier: 'settlement' }), true);
});

test('P1: Private + Attest preflight refuses before settle while off', () => {
  const ctx = { privateAttest: true };
  const pre = attestPreflightError(ctx, { proverConfigured: true, apiKey: 'k' });
  assert.equal(pre.status, 400);
  assert.equal(pre.code, 'settlement_proof_not_offered');
  assert.equal(attestPreflightError({ privateAttest: false }, { proverConfigured: true }), null);
  assert.match(attestProofGateError({ sp1Proof: null }, ctx).message, /not currently offered/);
});

// ── C1 ──────────────────────────────────────────────────────────────────────

test('C1: public pricing does not publish the $0.10 add-on while off', () => {
  const off = describePricing();
  assert.equal(off.tier2_proof_usd, null);
  assert.doesNotMatch(off.description, /opt-in and charged flat/);
  assert.equal(publishedPrice('theta/qwen3', null).tier2_proof_usd, null);
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  assert.equal(describePricing().tier2_proof_usd, 0.1);
});

test('C1: proofAvailability never reports the settlement path as open while off', () => {
  const a = proofAvailability(true, { tier2: { opt_in_price_usd: null } });
  assert.equal(a.settlement_proof, 'unavailable');
  assert.match(a.note, /not currently offered/);
});

test('C1: receipt page without a proof does not advertise opt-in SP1 proofs while off', async () => {
  const t = task({ sp1Proof: { skipped: true, reason: 'settlement_proof_not_offered' } });
  const r = await receipt.buildReceipt(t, { baseUrl: 'https://api.chit402.com' });
  const html = receipt.renderReceiptHtml(r);
  assert.doesNotMatch(html, /On-chain SP1 proofs are opt-in/);
});

test('C1: listed agent-facing copy no longer advertises the add-on as live', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const banned = {
    'packages/mcp/src/tools.ts': [/Tier-1\/Tier-2 are live/, /'signed', 'settlement'\]/, /signed \+ settlement are live/, /only `settlement` adds the SP1 surcharge/, /Get ZK settlement proof/],
    'packages/mcp/src/server-card.ts': [/Optional Tier-2: fetch SP1/],
    'packages/mcp/package.json': [/settlement proofs\./],
    'packages/mcp/server.json': [/Fetch\/verify settlement proofs/],
    'services/gateway/src/x402-discovery.js': [/\/prove-result for SP1 proof when requested/],
    'apps/web/src/pages/Home.tsx': [/On-chain SP1 proof on demand/],
    'apps/web/src/pages/Docs.tsx': [/settlement proofs for high-value jobs/],
    'WHITEPAPER.md': [/on demand, live/, /\(on demand\)/],
    'packages/sdk/package.json': [/SP1 proofs\. Submit AI tasks, pay, prove, verify/],
    'packages/agent-skills/AGENT_PLAYBOOK.md': [/SP1 settlement proof is on demand/],
    'skills/chit402-receipt/SKILL.md': [/optional and cost extra/],
    'skills/chit402-receipt/references/verify-offline.md': [/optional Tier-2; extra cost and latency/],
    'packages/plugin-elizaos/README.md': [/not\*\* enabled on every call/],
  };
  for (const [file, patterns] of Object.entries(banned)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const re of patterns) assert.doesNotMatch(text, re, `${file}: ${re}`);
  }
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'services/gateway/public/specimens/tier2-in-proof-binding.json'), 'utf8'));
  assert.equal(spec.status, 'not_offered');
});
