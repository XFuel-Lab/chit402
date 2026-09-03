import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  renderReceiptHtml,
  renderReceiptNotFound,
  explorerUrlForRef,
  buildVerifyUrl,
  baseUrlFromReq,
  normalizeTaskIdForLookup,
  preferredPathPrefix,
  taskIdWithPreferredPrefix,
} from '../src/receipt.js';
import { computePaymentCommitment, computeInferenceBinding } from '../src/payment-binding.js';
import crypto from 'crypto';

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
      chainId: 'base',
      amount,
      paymentRail: 'usdc',
      paymentRef,
      proofSystem: 'sp1',
    },
    feeAmount: '5000',
    netAmount,
    feeBps: 50,
    result: 'ZK proofs let you verify a computation without redoing it.',
    meta: { chain: 'base', provider: 'theta-edgecloud' },
    result: { provider: 'theta-edgecloud', outputHash: '0x' + 'ab'.repeat(32) },
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

  // Output hash is the stored keccak commitment, not SHA-256 of the result object.
  assert.equal(r.output.kind, 'committed');
  assert.equal(r.output.hash, '0x' + 'ab'.repeat(32));

  // Absolute links when a baseUrl is provided.
  assert.equal(r.links.self, `https://api-testnet.xfuel.app/receipt/${TASK_ID}`);
  assert.equal(r.links.json, `https://api-testnet.xfuel.app/receipt/${TASK_ID}?format=json`);
  // Canonical shareable verify_url is present and matches links.self.
  assert.equal(r.verify_url, `https://api-testnet.xfuel.app/receipt/${TASK_ID}`);
  assert.equal(r.verify_url, r.links.self);
});

test('buildVerifyUrl: absolute with base, relative without, trims trailing slash', () => {
  assert.equal(buildVerifyUrl('https://api-testnet.xfuel.app', TASK_ID), `https://api-testnet.xfuel.app/receipt/${TASK_ID}`);
  assert.equal(buildVerifyUrl('https://api-testnet.xfuel.app/', TASK_ID), `https://api-testnet.xfuel.app/receipt/${TASK_ID}`);
  assert.equal(buildVerifyUrl('', TASK_ID), `/receipt/${TASK_ID}`);
});

// ── Chit path alias tests ────────────────────────────────────────────────────

test('normalizeTaskIdForLookup: chit- prefix maps to xfuel-', () => {
  assert.equal(normalizeTaskIdForLookup('chit-247049dd-0075-4372-b7f7-508c62b9b587'), 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(normalizeTaskIdForLookup('xfuel-247049dd-0075-4372-b7f7-508c62b9b587'), 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(normalizeTaskIdForLookup('openai-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'openai-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(normalizeTaskIdForLookup('task-abc123'), 'task-abc123');
  assert.equal(normalizeTaskIdForLookup(null), null);
  assert.equal(normalizeTaskIdForLookup(''), '');
});

test('preferredPathPrefix: chit- on api.chit402.com, xfuel- otherwise', () => {
  assert.equal(preferredPathPrefix('api.chit402.com'), 'chit-');
  assert.equal(preferredPathPrefix('api.chit402.com:443'), 'chit-');
  assert.equal(preferredPathPrefix('API.CHIT402.COM'), 'chit-');
  assert.equal(preferredPathPrefix('api.xfuel.app'), 'xfuel-');
  assert.equal(preferredPathPrefix('api-testnet.xfuel.app'), 'xfuel-');
  assert.equal(preferredPathPrefix('localhost:3001'), 'xfuel-');
  assert.equal(preferredPathPrefix(null), 'xfuel-');
  assert.equal(preferredPathPrefix(''), 'xfuel-');
});

test('taskIdWithPreferredPrefix: swaps xfuel- to chit- when preferred', () => {
  assert.equal(taskIdWithPreferredPrefix('xfuel-247049dd-0075-4372-b7f7-508c62b9b587', 'chit-'), 'chit-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(taskIdWithPreferredPrefix('xfuel-247049dd-0075-4372-b7f7-508c62b9b587', 'xfuel-'), 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(taskIdWithPreferredPrefix('openai-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'chit-'), 'openai-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(taskIdWithPreferredPrefix('task-abc123', 'chit-'), 'task-abc123');
  assert.equal(taskIdWithPreferredPrefix(null, 'chit-'), null);
});

test('buildVerifyUrl: uses chit- prefix when reqHost is api.chit402.com', () => {
  const xfuelTaskId = 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587';
  assert.equal(
    buildVerifyUrl('https://api.chit402.com', xfuelTaskId, { reqHost: 'api.chit402.com' }),
    'https://api.chit402.com/receipt/chit-247049dd-0075-4372-b7f7-508c62b9b587'
  );
  assert.equal(
    buildVerifyUrl('https://api.xfuel.app', xfuelTaskId, { reqHost: 'api.xfuel.app' }),
    'https://api.xfuel.app/receipt/xfuel-247049dd-0075-4372-b7f7-508c62b9b587'
  );
  assert.equal(
    buildVerifyUrl('https://api-testnet.xfuel.app', xfuelTaskId, { reqHost: null }),
    'https://api-testnet.xfuel.app/receipt/xfuel-247049dd-0075-4372-b7f7-508c62b9b587'
  );
  assert.equal(
    buildVerifyUrl('https://api.chit402.com', xfuelTaskId),
    'https://api.chit402.com/receipt/xfuel-247049dd-0075-4372-b7f7-508c62b9b587'
  );
});

test('buildReceipt: uses chit- prefix in verify_url and links when reqHost is api.chit402.com', () => {
  const xfuelTask = {
    taskId: 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587',
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '10000', model: 'theta/qwen3' },
    result: { provider: 'theta-edgecloud' },
  };
  const r = buildReceipt(xfuelTask, { baseUrl: 'https://api.chit402.com', reqHost: 'api.chit402.com' });
  assert.equal(r.verify_url, 'https://api.chit402.com/receipt/chit-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(r.links.self, 'https://api.chit402.com/receipt/chit-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(r.links.json, 'https://api.chit402.com/receipt/chit-247049dd-0075-4372-b7f7-508c62b9b587?format=json');
  assert.equal(r.task_id, 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
});

test('buildReceipt: keeps xfuel- prefix when reqHost is api.xfuel.app', () => {
  const xfuelTask = {
    taskId: 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587',
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '10000', model: 'theta/qwen3' },
    result: { provider: 'theta-edgecloud' },
  };
  const r = buildReceipt(xfuelTask, { baseUrl: 'https://api.xfuel.app', reqHost: 'api.xfuel.app' });
  assert.equal(r.verify_url, 'https://api.xfuel.app/receipt/xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(r.links.self, 'https://api.xfuel.app/receipt/xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
  assert.equal(r.task_id, 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587');
});

test('baseUrlFromReq: prefers configured base, else derives from request', () => {
  const req = { protocol: 'http', get: (h) => (h === 'host' ? 'localhost:3002' : null) };
  assert.equal(baseUrlFromReq(req, 'https://api-testnet.xfuel.app'), 'https://api-testnet.xfuel.app');
  assert.equal(baseUrlFromReq(req, 'https://api-testnet.xfuel.app/'), 'https://api-testnet.xfuel.app');
  assert.equal(baseUrlFromReq(req, null), 'http://localhost:3002');
  assert.equal(baseUrlFromReq({}, null), '');
});

test('baseUrlFromReq: uses request host when it matches allowedHosts', () => {
  const chitReq = { protocol: 'https', get: (h) => (h === 'host' ? 'api.chit402.com' : null) };
  const xfuelReq = { protocol: 'https', get: (h) => (h === 'host' ? 'api.xfuel.app' : null) };
  const unknownReq = { protocol: 'https', get: (h) => (h === 'host' ? 'unknown.example.com' : null) };
  const allowedHosts = ['api.chit402.com', 'api.xfuel.app', 'api-testnet.xfuel.app'];

  // Request host in allowed list → use request host
  assert.equal(baseUrlFromReq(chitReq, 'https://api.xfuel.app', allowedHosts), 'https://api.chit402.com');
  assert.equal(baseUrlFromReq(xfuelReq, 'https://api.xfuel.app', allowedHosts), 'https://api.xfuel.app');

  // Request host NOT in allowed list → fall back to configured base
  assert.equal(baseUrlFromReq(unknownReq, 'https://api.xfuel.app', allowedHosts), 'https://api.xfuel.app');

  // No allowed hosts → fall back to configured base
  assert.equal(baseUrlFromReq(chitReq, 'https://api.xfuel.app', []), 'https://api.xfuel.app');
  assert.equal(baseUrlFromReq(chitReq, 'https://api.xfuel.app', null), 'https://api.xfuel.app');

  // Request host with port in allowed list → still matches (port stripped for comparison)
  const chitReqWithPort = { protocol: 'https', get: (h) => (h === 'host' ? 'api.chit402.com:443' : null) };
  assert.equal(baseUrlFromReq(chitReqWithPort, 'https://api.xfuel.app', allowedHosts), 'https://api.chit402.com:443');

  // Case-insensitive host matching
  const upperReq = { protocol: 'https', get: (h) => (h === 'host' ? 'API.CHIT402.COM' : null) };
  assert.equal(baseUrlFromReq(upperReq, 'https://api.xfuel.app', allowedHosts), 'https://API.CHIT402.COM');
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

test('buildReceipt: mock compute wins over float provider label', () => {
  const task = usdcTask({
    meta: { chain: 'base', provider: 'theta-edgecloud', providerCogs: { provider: 'theta-edgecloud' } },
    result: { mock: true, provider: 'theta-edge-mock', outputHash: '0xabc' },
  });
  const r = buildReceipt(task);
  assert.equal(r.route.provider, 'theta-edge-mock');
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

test('renderReceiptHtml: title is "Chit", xfuel- prefix becomes chit- in display', () => {
  const xfuelTask = {
    taskId: 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587',
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '10000', model: 'theta/qwen3' },
  };
  const html = renderReceiptHtml(buildReceipt(xfuelTask));

  // Title must be just "Chit" without task_id or "receipt"
  assert.match(html, /<title>Chit<\/title>/);
  assert.match(html, /og:title.*content="Chit"/);

  // The displayed task ID should have the xfuel- prefix rewritten to chit-
  assert.ok(html.includes('chit-247049dd-0075-4372-b7f7-508c62b9b587'), 'chit- prefix should be displayed');
  // Should NOT show "xfuel-" in the task display div (but may appear in links/URLs)
  assert.ok(!html.includes('class="taskid">xfuel-'), 'xfuel- prefix should not appear in display');
});

test('renderReceiptNotFound: escapes the task id', () => {
  const html = renderReceiptNotFound('<b>x</b>');
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('buildReceipt: rolling first call is pending, not a legacy rail, and carries usage', () => {
  const base = usdcTask();
  const task = usdcTask({
    sp1Proof: null,
    feeAmount: '0',
    netAmount: '0',
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, source: 'provider' },
    intent: { ...base.intent, paymentRef: null, amount: '10000' },
    result: { provider: 'akash-network', model: 'akash/meta-llama/Llama-3.3-70B-Instruct', outputHash: '0xabc' },
    meta: {
      chain: 'base',
      rolling: { fronted: true, recorded: true },
      pricing: { basis: 'cost_plus', floor_applied: true, platform_fee: '2', fee_bps: 1000 },
      providerCogs: {
        provider: 'akash-network',
        float_id: 'akash-network',
        currency: 'USDC',
        estimated: '20',
        actual: '17',
        basis: 'measured',
      },
    },
  });
  const r = buildReceipt(task, { signingSecret: 'test-receipt-secret' });
  assert.equal(r.payment.ref, null);
  assert.equal(r.payment.collected, false);
  assert.equal(r.payment.collects_on, 'next_request');
  assert.equal(r.usage.prompt_tokens, 12);
  assert.equal(r.usage.completion_tokens, 8);
  assert.equal(r.proof.has_proof, false);
  assert.equal(r.binding, null);

  const html = renderReceiptHtml(r);
  assert.ok(!html.includes('legacy rail'));
  assert.match(html, /bill pending/);
  assert.match(html, /Tokens.*20|20.*\(12.*8\)/i, 'Tokens shown compactly');
  assert.match(html, /\$0\.000017/);
  assert.match(html, /not on this call/);
  assert.match(html, /HMAC/);
  assert.match(html, /next request/);
});

// ── Phase 2 — Verified Inference fields (PoMA + PBR + signature) ────────────────

test('buildReceipt: proof.tier is "settlement" with a proof, "signed" without', () => {
  assert.equal(buildReceipt(usdcTask()).proof.tier, 'settlement');
  const pending = usdcTask({ status: 'routing', sp1Proof: null, result: null });
  assert.equal(buildReceipt(pending).proof.tier, 'signed');
});

test('buildReceipt: binding.covers reports payment/settlement by default', () => {
  const r = buildReceipt(usdcTask());
  assert.deepEqual(r.binding.covers, ['payment', 'settlement']);
});

test('buildReceipt: PBR binding (model + output) verifies via the superset commitment', () => {
  const MODEL_C = '0x' + 'ab'.repeat(32);
  const OUTPUT_H = '0x' + 'cd'.repeat(32);
  const netAmount = '995000';
  const paymentRef = 'base-sepolia:0x' + 'ab'.repeat(32);
  const { commitment } = computeInferenceBinding({
    paymentRef, taskId: TASK_ID, rail: 'usdc', amount: netAmount,
    modelCommitment: MODEL_C, outputHash: OUTPUT_H,
  });
  const task = usdcTask();
  task.sp1Proof.paymentBinding = {
    version: 2, rail: 'usdc', commitment, amount: netAmount, in_proof: false,
    model_commitment: MODEL_C, output_hash: OUTPUT_H,
    covers: ['payment', 'settlement', 'model', 'inference'],
  };
  const r = buildReceipt(task);
  assert.deepEqual(r.binding.covers, ['payment', 'settlement', 'model', 'inference']);
  assert.equal(r.binding.matches, true);
  assert.equal(r.binding.model_commitment, MODEL_C);
});

test('buildReceipt: signature is absent by default and valid HMAC when a secret is given', () => {
  const secret = 'test-receipt-secret';
  assert.equal(buildReceipt(usdcTask()).signature, undefined);

  const r = buildReceipt(usdcTask(), { signingSecret: secret });
  assert.ok(r.signature);
  assert.equal(r.signature.alg, 'HMAC-SHA256');
  assert.equal(r.signature.payload_version, 3);
  assert.equal(r.schema, 'xfuel.receipt.v3');
  assert.ok(r.signature.signed_fields.includes('provider_cogs.actual'));
  assert.ok(r.signature.signed_fields.includes('payment.platform_fee_bps'));

  // Recompute the HMAC over the same canonical payload → must match.
  const payload = JSON.stringify([
    r.task_id, r.payment?.rail ?? null, r.payment?.ref ?? null,
    r.payment?.gross_amount ?? null,
    r.payment?.net_amount ?? null, r.payment?.fee_amount ?? null,
    r.payment?.protocol_fee_bps ?? r.payment?.fee_bps ?? null,
    r.payment?.platform_fee ?? null, r.payment?.platform_fee_bps ?? null,
    r.provider_cogs?.actual ?? null,
    r.route?.model ?? null, r.route?.model_commitment?.commitment ?? null,
    r.route?.provider ?? null,
    r.output?.hash ?? null, r.binding?.expected_commitment ?? null,
  ]);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(r.signature.value, expected);
});

test('signed cost-plus fields recompute to gross', async () => {
  const { quoteFromCogs } = await import('../src/pricing.js');
  const quote = quoteFromCogs(10_000n, { usdcFloor: '0' });
  const base = usdcTask();
  const r = buildReceipt(usdcTask({
    intent: { ...base.intent, amount: quote.amount },
    meta: {
      ...base.meta,
      pricing: quote,
      providerCogs: { actual: quote.provider_cogs, basis: 'measured' },
    },
  }), { signingSecret: 'test-receipt-secret' });

  assert.equal(r.payment.protocol_fee_bps, 50);
  assert.equal(r.payment.platform_fee_bps, 1000);
  assert.equal(r.payment.platform_fee, quote.platform_fee);
  assert.equal(r.provider_cogs.actual, '10000');

  const recomputed = quoteFromCogs(r.provider_cogs.actual, { usdcFloor: '0' });
  assert.equal(recomputed.amount, r.payment.gross_amount);
});

test('proofOutcomeOf: a skip or empty proof object is pending, not valid', async () => {
  const { proofOutcomeOf } = await import('../src/receipt.js');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: null }), 'pending');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { skipped: true } }), 'pending');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: {} }), 'pending');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { proof: '0xab' } }), 'valid');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { error: 'nope' } }), 'regenerable');
});

test('renderReceiptHtml: unmetered /v1 does not print the $0.01 floor as a price', () => {
  const html = renderReceiptHtml(buildReceipt({
    taskId: 'xfuel-free',
    status: 'completed',
    intent: { paymentRail: 'unmetered', amount: '10000', model: 'xfuel/auto' },
    result: { provider: 'akash-network', usage: { prompt_tokens: 8, completion_tokens: 5 } },
    sp1Proof: null,
  }));
  assert.match(html, /not charged/);
  assert.match(html, /UNMETERED/);
  // Title is just "Chit" (never includes task_id or "receipt")
  assert.match(html, /<title>Chit<\/title>/);
  // xfuel- prefix becomes chit- in taskid div
  assert.ok(html.includes('class="taskid">chit-free<'));
  assert.doesNotMatch(html, /openai/i);
  assert.ok(!html.includes('$0.01'), html);
  assert.ok(!html.includes('>10000<'), html);
});

test('renderReceiptHtml: historical openai-* task ids still render (no prefix stripping)', () => {
  // Pre-cutover receipts were minted as openai-<uuid>. Lookup and chrome must
  // still work; we do not rename stored ids. Only xfuel- prefix is stripped.
  const taskId = 'openai-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const html = renderReceiptHtml(buildReceipt({
    taskId,
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '10000', model: 'theta/qwen3' },
    result: { provider: 'theta-edgecloud' },
    sp1Proof: null,
  }));
  // Title is just "Chit" (never includes task_id or "receipt")
  assert.match(html, /<title>Chit<\/title>/);
  // openai-* prefix is NOT stripped (only xfuel- is)
  assert.match(html, new RegExp(`class="taskid">${taskId}<`));
});

test('outputHashOf prefers result.outputHash over hashing the result envelope', async () => {
  const { buildReceipt } = await import('../src/receipt.js');
  const hash = '0x' + '11'.repeat(32);
  const r = buildReceipt({
    taskId: 'xfuel-hash-check',
    status: 'completed',
    intent: { paymentRail: 'unmetered', amount: '0' },
    result: { provider: 'theta-edgecloud', outputHash: hash, content_hash: hash, usage: { prompt_tokens: 3 } },
    sp1Proof: null,
  });
  assert.equal(r.output.hash, hash);
  assert.equal(r.output.kind, 'committed');
});

// ── Receipt HTML hierarchy tests (Chit polish) ──────────────────────────────

test('renderReceiptHtml: Payment section appears before Route details (de-emphasis)', () => {
  const html = renderReceiptHtml(buildReceipt(usdcTask()));
  const paymentIdx = html.indexOf('<h2>Payment</h2>');
  const routeIdx = html.indexOf('<h2>Route details</h2>');
  assert.ok(paymentIdx > 0, 'Payment section must exist');
  assert.ok(routeIdx > 0, 'Route details section must exist');
  assert.ok(paymentIdx < routeIdx, 'Payment must appear before Route details');
});

test('renderReceiptHtml: Route details has secondary class (de-emphasized)', () => {
  const html = renderReceiptHtml(buildReceipt(usdcTask()));
  assert.match(html, /class="card secondary"[^>]*>[\s\S]*?<h2>Route details<\/h2>/);
});

test('renderReceiptHtml: Verification section shows issuer signature with ES256 and JWKS link', () => {
  const task = usdcTask();
  const r = buildReceipt(task, { signingSecret: 'test-secret' });
  const html = renderReceiptHtml(r);
  
  assert.match(html, /<h2>Verification<\/h2>/, 'Verification section heading');
  assert.match(html, /Issuer signature/, 'Issuer signature row');
  assert.match(html, /ES256/, 'ES256 algorithm');
  assert.match(html, /Key ID/, 'Key ID row');
  assert.match(html, /\.well-known\/jwks\.json/, 'JWKS link');
});

test('renderReceiptHtml: Model and Provider are in Route details, not primary card', () => {
  const html = renderReceiptHtml(buildReceipt(usdcTask()));
  const routeDetailsStart = html.indexOf('Route details</h2>');
  const routeDetailsEnd = html.indexOf('</section>', routeDetailsStart);
  const routeSection = html.slice(routeDetailsStart, routeDetailsEnd);
  
  assert.ok(routeSection.includes('Model'), 'Model in Route details');
  assert.ok(routeSection.includes('Provider'), 'Provider in Route details');
});

test('renderReceiptHtml: JWKS link is absolute when receipt has base URL', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api.chit402.com' });
  const html = renderReceiptHtml(r);
  assert.match(html, /href="https:\/\/api\.chit402\.com\/\.well-known\/jwks\.json"/, 'Absolute JWKS URL');
});

test('renderReceiptHtml: tokens shown compactly (total with breakdown)', () => {
  const task = usdcTask();
  task.usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
  const html = renderReceiptHtml(buildReceipt(task));
  assert.match(html, /150/, 'Total tokens shown');
  assert.match(html, /100.*50|prompt.*completion/i, 'Token breakdown shown');
});

test('buildReceipt: issuer_signature has ES256 alg and JWKS uri', () => {
  const r = buildReceipt(usdcTask());
  assert.ok(r.issuer_signature, 'issuer_signature present');
  assert.equal(r.issuer_signature.alg, 'ES256');
  assert.equal(r.issuer_signature.jwks_uri, '/.well-known/jwks.json');
  assert.ok(r.issuer_signature.kid, 'kid present');
  assert.ok(r.issuer_signature.value, 'signature value present');
});
