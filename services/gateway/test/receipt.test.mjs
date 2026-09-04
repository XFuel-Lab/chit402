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
  mergeReceiptView,
  decodeReceiptClaims,
  toUnixSeconds,
  canonicalSignedPayload,
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

test('explorerUrlForRef: base-sepolia, base, solana, unknown', () => {
  const tx = '0x' + 'ab'.repeat(32);
  assert.equal(explorerUrlForRef(`base-sepolia:${tx}`), `https://sepolia.basescan.org/tx/${tx}`);
  assert.equal(explorerUrlForRef(`base:${tx}`), `https://basescan.org/tx/${tx}`);
  const solSig = '5'.repeat(87);
  assert.equal(explorerUrlForRef(`solana:${solSig}`), `https://solscan.io/tx/${solSig}`);
  assert.equal(explorerUrlForRef(null), null);
  assert.equal(explorerUrlForRef('base-sepolia:not-a-hash'), null);
  assert.equal(explorerUrlForRef(`solana:${tx}`), null, 'EVM hash is not a Solana signature');
});

test('buildReceipt: USDC task is proven, priced, and independently binding-verified', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api-testnet.xfuel.app' });
  const v = mergeReceiptView(r);
  assert.equal(r.task_id, TASK_ID);
  assert.equal(r.status, 'completed');
  assert.equal(r.proof_outcome, 'valid');
  assert.equal(r.verification?.source_of_truth, 'issuer_signature.jws');
  assert.equal(!r.payment, true, 'slim envelope omits unsigned top-level payment');

  assert.equal(v.route.model, 'llama-3-70b');
  assert.equal(v.route.provider, 'theta-edgecloud');

  assert.equal(v.payment.rail, 'usdc');
  assert.match(v.payment.explorer_url, /^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
  assert.equal(v.payment.net_amount, '995000');
  assert.equal(v.payment.fee_bps, 50);

  assert.equal(r.proof.system, 'sp1');
  assert.equal(r.proof.has_proof, true);
  assert.equal(r.proof.attestation_scope.model_computation, false);
  assert.equal(r.proof.nullifier_enforced, true);
  assert.equal(!('attests' in r.proof), true, 'JSON proof omits prose attests');

  // The independent re-derivation must match the stored commitment.
  assert.ok(r.binding);
  assert.equal(r.binding.matches, true);
  assert.equal(r.binding.expected_commitment, r.binding.recomputed_commitment);
  assert.equal(r.binding.in_proof, false);

  // Output hash is the stored keccak commitment, not SHA-256 of the result object.
  assert.equal(v.output.kind, 'committed');
  assert.equal(v.output.hash, '0x' + 'ab'.repeat(32));

  assert.equal(r.verification.jwks_uri, 'https://api-testnet.xfuel.app/.well-known/jwks.json');
  assert.equal(r.issuer_signature.jwks_uri, undefined, 'jwks_uri is canonical on verification only');

  const claims = decodeReceiptClaims(r);
  assert.equal(claims.iat, r.created_at, 'wrapper created_at matches JWS iat (seconds)');

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
  const v = mergeReceiptView(r);
  assert.equal(v.payment.rail, 'tfuel');
  assert.equal(v.payment.explorer_url, null);
  assert.equal(r.binding, undefined);
  assert.equal('binding' in r, false);
});

test('buildReceipt: mock compute wins over float provider label', () => {
  const task = usdcTask({
    meta: { chain: 'base', provider: 'theta-edgecloud', providerCogs: { provider: 'theta-edgecloud' } },
    result: { mock: true, provider: 'theta-edge-mock', outputHash: '0xabc' },
  });
  const r = buildReceipt(task);
  assert.equal(mergeReceiptView(r).route.provider, 'theta-edge-mock');
});

test('buildReceipt: pending task (no proof yet)', () => {
  const task = usdcTask({ status: 'routing', sp1Proof: null, result: null });
  const r = buildReceipt(task);
  assert.equal(r.proof_outcome, 'pending');
  assert.equal(r.proof.has_proof, false);
  assert.equal(mergeReceiptView(r).output, null);
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

test('renderReceiptHtml: title is "Chit402", xfuel- prefix becomes chit- in display', () => {
  const xfuelTask = {
    taskId: 'xfuel-247049dd-0075-4372-b7f7-508c62b9b587',
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '10000', model: 'theta/qwen3' },
  };
  const html = renderReceiptHtml(buildReceipt(xfuelTask));

  // Title must be just "Chit402" without task_id or "receipt"
  assert.match(html, /<title>Chit402<\/title>/);
  assert.match(html, /og:title.*content="Chit402"/);

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
  const v = mergeReceiptView(r);
  assert.equal(v.payment.ref, null);
  assert.equal(v.payment.collected, false);
  assert.equal(v.payment.collects_on, 'next_request');
  assert.equal(r.usage.prompt_tokens, 12);
  assert.equal(r.usage.completion_tokens, 8);
  assert.equal(r.proof.has_proof, false);
  assert.equal(r.binding, undefined);
  assert.equal('binding' in r, false);

  const html = renderReceiptHtml(r);
  assert.ok(!html.includes('legacy rail'));
  assert.match(html, /bill pending/);
  assert.match(html, /Tokens.*20|20.*\(12.*8\)/i, 'Tokens shown compactly');
  assert.match(html, /\$0\.000017/);
  assert.match(html, /not on this call/);
  assert.match(html, /ES256.*signed|verify.*JWKS/i);
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

test('buildReceipt: hmac_attestation is absent by default and valid HMAC when a secret is given', () => {
  const secret = 'test-receipt-secret';
  assert.equal(buildReceipt(usdcTask()).hmac_attestation, undefined);

  const r = buildReceipt(usdcTask(), { signingSecret: secret });
  assert.ok(r.hmac_attestation);
  assert.equal(r.hmac_attestation.alg, 'HMAC-SHA256');
  assert.equal(r.hmac_attestation.payload_version, 5);
  assert.equal(r.schema, 'xfuel.receipt.v4');
  assert.equal(r.hmac_attestation.signed_fields, undefined, 'public HMAC omits signed_fields');
  assert.equal(r.hmac_attestation.role, 'attestor');

  // Recompute the HMAC over the same canonical payload → must match.
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(canonicalSignedPayload(r)).digest('hex');
  assert.equal(r.hmac_attestation.value, expected);
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
  const v = mergeReceiptView(r);

  assert.equal(v.payment.protocol_fee_bps, 50);
  assert.equal(v.payment.platform_fee_bps, 1000);
  assert.equal(v.payment.platform_fee, quote.platform_fee);
  assert.equal(r.provider_cogs.actual, '10000');

  const recomputed = quoteFromCogs(r.provider_cogs.actual, { usdcFloor: '0' });
  assert.equal(recomputed.amount, v.payment.gross_amount);
});

test('proofOutcomeOf: skipped or gated tasks are not_applicable; in-flight stays pending', async () => {
  const { proofOutcomeOf } = await import('../src/receipt.js');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: null }), 'pending');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { skipped: true } }), 'not_applicable');
  assert.equal(proofOutcomeOf({ status: 'completed', intent: { proveAllowed: false } }), 'not_applicable');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: {} }), 'pending');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { proof: '0xab' } }), 'valid');
  assert.equal(proofOutcomeOf({ status: 'completed', sp1Proof: { error: 'nope' } }), 'regenerable');
  assert.equal(proofOutcomeOf({
    status: 'completed',
    kind: 'session_handoff',
    parentReceiptId: 'xfuel-parent',
    sp1Proof: null,
  }), 'not_applicable');
});

test('buildReceipt: child session handoff uses not_applicable proof outcome on outer envelope', async () => {
  const { issueSessionHandoffReceipt } = await import('../src/receipt.js');
  const parent = usdcTask({ taskId: 'xfuel-parent-proof-na' });
  const { receipt: child } = issueSessionHandoffReceipt(parent, {
    delegation_hash: '0x' + 'cd'.repeat(32),
    agent_pubkey: '0x' + 'ab'.repeat(20),
    payer_wallet: '0x' + '12'.repeat(20),
    session_expiry: Math.floor(Date.now() / 1000) + 3600,
    nonce: '0x' + 'ef'.repeat(32),
  }, { childTaskId: 'xfuel-child-proof-na' });
  assert.equal(child.proof_outcome, 'not_applicable');
  assert.equal(child.proof.outcome, 'not_applicable');
  assert.equal(child.proof.has_proof, false);
});

test('buildReceipt: signed-tier receipt without SP1 uses not_applicable proof outcome', () => {
  const task = usdcTask({
    intent: { ...usdcTask().intent, proveAllowed: false },
    sp1Proof: { skipped: true, reason: 'proving_gated' },
  });
  const r = buildReceipt(task);
  assert.equal(r.proof_outcome, 'not_applicable');
  assert.equal(r.proof.outcome, 'not_applicable');
  assert.equal(r.proof.has_proof, false);
  assert.equal(r.proof.tier, 'signed');
});

test('renderReceiptHtml: caller_binding payer_wallet shows bound address, not "not recorded"', () => {
  const payer = '0x1234567890123456789012345678901234567890';
  const base = usdcTask();
  const task = usdcTask({
    intent: { ...base.intent, proveAllowed: false },
    sp1Proof: { skipped: true, reason: 'proving_gated' },
  });
  const r = buildReceipt(task, { payerWallet: payer });
  const html = renderReceiptHtml(r);
  assert.ok(html.includes(payer), 'payer wallet should appear in HTML');
  assert.ok(!html.includes('Payment binding was not recorded'), 'stale unbound copy must not appear');
  assert.match(html, /signed caller binding/i);
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
  // Title is just "Chit402" (never includes task_id or "receipt")
  assert.match(html, /<title>Chit402<\/title>/);
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
  // Title is just "Chit402" (never includes task_id or "receipt")
  assert.match(html, /<title>Chit402<\/title>/);
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
  const v = mergeReceiptView(r);
  assert.equal(v.output.hash, hash);
  assert.equal(v.output.kind, 'committed');
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

test('buildReceipt: issuer_signature has ES256 alg, absolute JWKS uri, and compact JWS', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api.chit402.com' });
  assert.ok(r.issuer_signature, 'issuer_signature present');
  assert.equal(r.issuer_signature.alg, 'ES256');
  assert.equal(r.verification.jwks_uri, 'https://api.chit402.com/.well-known/jwks.json');
  assert.equal(r.issuer_signature.jwks_uri, undefined);
  assert.ok(r.issuer_signature.kid, 'kid present');
  assert.ok(r.issuer_signature.jws, 'compact JWS present');
  assert.equal(r.issuer_signature.payload_version, 5);
  
  // JWS should have 3 parts (header.payload.signature)
  const parts = r.issuer_signature.jws.split('.');
  assert.equal(parts.length, 3, 'JWS has header.payload.signature format');
  
  // Header should have typ: chit402-receipt+jwt
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256');
  assert.equal(header.typ, 'chit402-receipt+jwt');
  assert.equal(header.kid, r.issuer_signature.kid);
  assert.equal(header.jku, 'https://api.chit402.com/.well-known/jwks.json');
  
  // Payload should be an object with named claims (not an array)
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(typeof payload, 'object');
  assert.ok(!Array.isArray(payload), 'payload must be an object, not an array');
  assert.equal(payload.task_id, r.task_id);
  assert.equal(payload.iss, 'chit402');
  assert.ok(payload.iat, 'iat claim present');
  assert.equal(payload.payload_version, 5);
});

test('buildReceipt: omits inactive extension fields and documents provider_cogs units', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api-testnet.xfuel.app' });
  assert.equal('verified_inference' in r, false);
  assert.equal('privacy' in r, false);
  assert.equal('lineage' in r, false);
  assert.equal('handoff' in r, false);
  assert.ok(r.binding, 'active binding is retained');

  const withCogs = buildReceipt(usdcTask({
    meta: {
      providerCogs: {
        provider: 'theta-edgecloud',
        actual: '2000',
        basis: 'measured',
      },
    },
  }));
  assert.equal(withCogs.provider_cogs.decimals, 6);
  assert.equal(withCogs.provider_cogs.unit, 'atomic_usdc');
  assert.equal(withCogs.provider_cogs.actual, '2000');

  const claims = decodeReceiptClaims(withCogs);
  assert.equal(claims.provider_cogs.actual, '2000');
  assert.equal(claims.provider_cogs.decimals, 6);
  assert.equal(claims.provider_cogs.unit, 'atomic_usdc');
});

// ── Issuer signature verification correctness tests ─────────────────────────

test('renderReceiptHtml: valid issuer signature shows "verified" badge', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api.chit402.com' });
  assert.ok(r.issuer_signature?.jws, 'issuer_signature.jws must be present');
  const html = renderReceiptHtml(r);
  assert.match(html, /<span class="badge ok">verified<\/span>/, 'verified badge must appear for valid signature');
  assert.ok(!html.includes('badge bad">not verified'), 'must NOT show "not verified" badge for valid signature');
});

test('renderReceiptHtml: tampered receipt shows "not verified" badge (truthful)', () => {
  const r = buildReceipt(usdcTask(), { baseUrl: 'https://api.chit402.com' });
  assert.ok(r.issuer_signature?.jws, 'issuer_signature.jws must be present before tampering');
  
  // Tamper with a canonically signed field AFTER the signature was computed
  r.task_id = 'tampered-task-id';
  
  const html = renderReceiptHtml(r);
  assert.match(html, /<span class="badge bad">not verified<\/span>/, 'not verified badge must appear for tampered receipt');
  assert.ok(!html.includes('badge ok">verified'), 'must NOT show "verified" badge for tampered receipt');
});

test('renderReceiptHtml: receipt without issuer_signature shows "unsigned"', () => {
  const r = buildReceipt(usdcTask());
  delete r.issuer_signature;
  const html = renderReceiptHtml(r);
  assert.match(html, /<span class="muted">unsigned<\/span>/, 'unsigned badge must appear when no issuer_signature');
  assert.ok(!html.includes('badge ok">verified'), 'must NOT show verified badge when unsigned');
});

// ── Caller binding tests ─────────────────────────────────────────────────────

test('buildReceipt: caller_binding is present in JWS claims', () => {
  const r = buildReceipt(usdcTask());
  const binding = mergeReceiptView(r).caller_binding;
  assert.ok(binding, 'caller_binding must be present in JWS');
  assert.ok('payer_wallet' in binding, 'payer_wallet field present');
  assert.ok('agent_pubkey' in binding, 'agent_pubkey field present');
  assert.ok('api_key_hash' in binding, 'api_key_hash field present');
});

test('buildReceipt: caller_binding uses actual wallet address, never symbolic labels', () => {
  // Task with an actual payer address from x402 settlement
  const taskWithAddress = usdcTask({
    meta: {
      ...usdcTask().meta,
      payerAddress: '0x1234567890123456789012345678901234567890',
    },
  });
  const r = buildReceipt(taskWithAddress);
  assert.equal(mergeReceiptView(r).caller_binding.payer_wallet, '0x1234567890123456789012345678901234567890');
  
  // Task without an address should have null, not a label like "openai-gateway"
  const taskWithoutAddress = usdcTask();
  const r2 = buildReceipt(taskWithoutAddress);
  assert.equal(mergeReceiptView(r2).caller_binding.payer_wallet, null, 'payer_wallet should be null when no actual address, never a symbolic label');
});

test('buildReceipt: caller_binding.payer_wallet rejects non-address values', () => {
  // Task with a symbolic label (the bug we're fixing)
  const taskWithLabel = usdcTask({
    meta: {
      ...usdcTask().meta,
      payerAddress: 'openai-gateway',
    },
  });
  const r = buildReceipt(taskWithLabel);
  assert.equal(mergeReceiptView(r).caller_binding.payer_wallet, null, 'symbolic labels must be rejected');
  
  // Task with invalid address format
  const taskWithInvalid = usdcTask({
    meta: {
      ...usdcTask().meta,
      payerAddress: '0x123',
    },
  });
  const r2 = buildReceipt(taskWithInvalid);
  assert.equal(mergeReceiptView(r2).caller_binding.payer_wallet, null, 'invalid addresses must be rejected');
});

test('buildReceipt: caller_binding stamps Solana payer_wallet from settlement', () => {
  const solanaPayer = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
  const solSig = '5'.repeat(87);
  const task = usdcTask({
    intent: {
      ...usdcTask().intent,
      paymentRef: `solana:${solSig}`,
    },
    meta: {
      ...usdcTask().meta,
      payerWallet: solanaPayer,
      chain: 'solana',
    },
  });
  const r = buildReceipt(task, { payerWallet: solanaPayer, persistSignature: true });
  const view = mergeReceiptView(r);
  assert.equal(view.caller_binding.payer_wallet, solanaPayer);
  assert.equal(view.payment.network, 'solana');
  assert.equal(view.payment.explorer_url, `https://solscan.io/tx/${solSig}`);
  const claims = decodeReceiptClaims(r);
  assert.equal(claims.caller_binding.payer_wallet, solanaPayer);
});

test('buildReceipt: caller_binding includes agent_pubkey when present', () => {
  const taskWithAgent = usdcTask({
    meta: {
      ...usdcTask().meta,
      agentPubkey: '0xagentpubkey123',
      apiKeyHash: 'sha256=abcdef',
    },
  });
  const r = buildReceipt(taskWithAgent);
  const binding = mergeReceiptView(r).caller_binding;
  assert.equal(binding.agent_pubkey, '0xagentpubkey123');
  assert.equal(binding.api_key_hash, 'sha256=abcdef');
});

test('buildReceipt: caller_binding.agent_pubkey rejects symbolic labels', () => {
  // Vendor/gateway labels must NEVER appear in agent_pubkey — only real pubkeys or null
  const symbolicLabels = ['openai-gateway', 'openai', 'anthropic', 'openrouter', 'gateway', 'internal'];
  
  for (const label of symbolicLabels) {
    const taskWithLabel = usdcTask({
      meta: {
        ...usdcTask().meta,
        agentPubkey: label,
      },
    });
    const r = buildReceipt(taskWithLabel);
    assert.equal(mergeReceiptView(r).caller_binding.agent_pubkey, null, `symbolic label "${label}" must be rejected for agent_pubkey`);
  }
});
