import crypto from 'crypto';
import { computePaymentCommitment, computeInferenceBinding } from './payment-binding.js';
import { resolveModelCommitment } from './model-commitment.js';
import { selectTier } from './tier-policy.js';
import { verifyAttestation, attestationNonce } from './tee-attestation.js';
import { buildSpotCheckRecord } from './spotcheck.js';

/**
 * Public verifiable-receipt builder + renderer.
 *
 * Turns a settled (or in-flight) listener task into a shareable, no-auth receipt:
 *   - a machine-readable JSON object (`buildReceipt`)
 *   - a clean standalone HTML page (`renderReceiptHtml`)
 *
 * PUBLIC-SAFE by design: it never exposes the raw proof bytes, private keys, or the
 * raw model output — only a hash commitment of the output, proof presence/nullifier,
 * payment rail/ref, and an INDEPENDENT re-derivation of the x402 payment-binding
 * commitment (so anyone can confirm "paid + proven" without trusting the server).
 *
 * Honest proof scope: the SP1 proof attests settlement metadata + a commitment to the
 * output hash — NOT that a black-box provider computed the model correctly. That is
 * stated on the receipt so we never overclaim (see docs/POSITIONING.md §2).
 */

const PROOF_SCOPE_NOTE =
  'The SP1 proof attests settlement metadata (correct fee split, payment binding) ' +
  'and a commitment to the output hash — anchored on-chain with a single-use ' +
  'nullifier. It does NOT attest that the provider computed the model correctly ' +
  '(that is Tier-2 proof-of-inference, roadmap).';

/** Block-explorer base per EVM network used in `payment_ref` ("<network>:<txHash>"). */
const EXPLORERS = {
  'base-sepolia': 'https://sepolia.basescan.org/tx/',
  base: 'https://basescan.org/tx/',
};

/**
 * Canonical, shareable proof link for a task: the public `/receipt/:taskId` page.
 * Absolute when a base URL is known, otherwise a root-relative path. This is the
 * single `verify_url` threaded consistently across every surface (M2M API,
 * OpenAI gateway, SDK, MCP) so an agent always gets one link it can share.
 */
export function buildVerifyUrl(baseUrl, taskId) {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  return `${base}/receipt/${taskId}`;
}

/**
 * Resolve the public base URL for building absolute links. Prefers an explicitly
 * configured canonical URL (PUBLIC_BASE_URL — correct behind a proxy/CDN), else
 * derives it from the request's protocol + host. Returns '' if neither is known.
 */
export function baseUrlFromReq(req, configuredBase) {
  if (configuredBase) return String(configuredBase).replace(/\/$/, '');
  const host = typeof req?.get === 'function' ? req.get('host') : null;
  return host ? `${req.protocol}://${host}` : '';
}

/** Build an explorer URL from a `payment_ref` like "base-sepolia:0xabc…", or null. */
export function explorerUrlForRef(paymentRef) {
  if (!paymentRef || typeof paymentRef !== 'string') return null;
  const idx = paymentRef.indexOf(':');
  if (idx < 0) return null;
  const network = paymentRef.slice(0, idx);
  const tx = paymentRef.slice(idx + 1);
  const base = EXPLORERS[network];
  if (!base || !/^0x[0-9a-fA-F]{6,}$/.test(tx)) return null;
  return base + tx;
}

/**
 * Coarse assurance tier for a task (RECEIPT_SCHEMA_V2 §5). Honest by construction:
 *   - 'signed'     : Tier-1 signed receipt, no on-chain proof
 *   - 'settlement' : Tier-2 SP1 settlement proof present
 *   - 'inference'  : Tier-3 verified inference (TEE/ZK) — reserved for Phase 4/5
 * PBR model-binding does NOT upgrade the tier (that needs a real inference check); it is
 * reported separately via `binding.covers`.
 */
export function proofTierOf(task) {
  if (task.verifiedInference?.tier) return task.verifiedInference.tier;
  if (task.verifiedInference?.mechanism) return 'inference';
  if (task.sp1Proof?.proof && !task.sp1Proof?.error) return 'settlement';
  return 'signed';
}

/**
 * Resolve the Verified Inference (Tier-3) block for a task under a policy (Phase 4).
 * Returns null when the tier engine is disabled. Additive: when present, it drives `proof.tier`
 * and adds a `verified_inference` block (mechanism + honest attestation/spot-check summaries).
 * @param {object} task
 * @param {object} viPolicy  config.verifiedInference (see config.js)
 * @param {object} [ctx]     { modelCommitment, outputHash }
 */
export function verifiedInferenceOf(task, viPolicy, ctx = {}) {
  if (!viPolicy || !viPolicy.enabled) return null;

  const sel = selectTier(task, viPolicy);
  const block = {
    tier: sel.tier,
    mechanism: sel.mechanism,
    reason: sel.reason,
    degraded: sel.degraded,
    attestation: null,
    spot_check: null,
  };

  // T3a — verify a provider-supplied attestation envelope (honest trust label).
  const envelope = task.attestation || task.meta?.attestation || null;
  if (sel.mechanism === 'tee' && envelope) {
    const modelRoot = ctx.modelCommitment || null;
    const res = verifyAttestation(envelope, {
      policy: viPolicy.tee || {},
      expectedModelRoot: modelRoot,
      expectedNonce: modelRoot ? attestationNonce(task.taskId, modelRoot) : undefined,
    });
    block.attestation = {
      verified: res.verified,
      vendor: res.vendor,
      method: res.method,
      trust: res.trust,
      measurement: res.measurement,
      model_root: res.model_root,
      reasons: res.reasons,
    };
  }

  // T3b — verifiable spot-check decision (deep check is orchestrated off the hot path).
  if (sel.mechanism === 'zk-spotcheck' && viPolicy.spotcheck?.rateBps) {
    block.spot_check = buildSpotCheckRecord({
      taskId: task.taskId,
      seed: viPolicy.spotcheck.seed,
      rateBps: viPolicy.spotcheck.rateBps,
      method: 'reexec-compare',
      observedOutputHash: task.spotCheckObservedHash || null,
      expectedOutputHash: ctx.outputHash || null,
    });
  }

  return block;
}

/** Map task/proof state to a coarse ProofOutcome (mirrors /task-status). */
/** True only when settlement proof bytes are present — a placeholder or skip is not "valid". */
export function hasSettlementProof(task) {
  const p = task?.sp1Proof;
  return !!(p && p.proof && !p.error && !p.skipped);
}

export function proofOutcomeOf(task) {
  if (task?.sp1Proof?.error) return 'regenerable';
  if (hasSettlementProof(task)) return 'valid';
  if (task?.status === 'failed') return 'invalid';
  return 'pending';
}

/**
 * Independently re-derive the x402 payment-binding commitment and compare it with
 * the one stored on the proof. This is the "binding verification" a third party can
 * trust: it recomputes keccak256(paymentRefHash, taskIdHash, rail, amount) locally.
 */
function verifyBinding(task) {
  const binding = task.sp1Proof?.paymentBinding;
  if (!binding) return null;

  const rail = task.intent?.paymentRail || binding.rail;
  const paymentRef = task.intent?.paymentRef || null;
  const amount = binding.amount ?? task.netAmount ?? task.intent?.amount ?? '0';

  // PBR: when the binding covers model + inference, re-derive the superset commitment
  // (payment + model authenticity + output); otherwise the payment-only commitment.
  const covers = Array.isArray(binding.covers) ? binding.covers : ['payment', 'settlement'];
  const bindsInference =
    covers.includes('inference') || !!(binding.model_commitment && binding.output_hash);

  let recomputed = null;
  try {
    if (bindsInference) {
      ({ commitment: recomputed } = computeInferenceBinding({
        paymentRef, taskId: task.taskId, rail, amount,
        modelCommitment: binding.model_commitment,
        outputHash: binding.output_hash,
      }));
    } else {
      ({ commitment: recomputed } = computePaymentCommitment({
        paymentRef, taskId: task.taskId, rail, amount,
      }));
    }
  } catch {
    recomputed = null;
  }

  const expected = binding.commitment || null;
  return {
    present: true,
    in_proof: !!binding.in_proof,
    rail: binding.rail || rail || null,
    amount: String(amount),
    covers,
    model_commitment: binding.model_commitment || null,
    output_hash: binding.output_hash || null,
    expected_commitment: expected,
    recomputed_commitment: recomputed,
    matches: !!(expected && recomputed && expected.toLowerCase() === recomputed.toLowerCase()),
  };
}

/**
 * Resolve the PoMA model-authenticity commitment for a task (Phase 1). Prefers a value
 * stamped by the serving path (`task.meta.modelCommitment`), else resolves the served model
 * slug against the local registry config. Returns null when PoMA is not configured — the
 * receipt then simply omits the commitment (backward-compatible).
 */
function modelCommitmentOf(task) {
  const stamped = task.meta?.modelCommitment || task.modelCommitment;
  if (stamped) {
    return {
      commitment: stamped.commitment || stamped,
      model_id: stamped.modelId || null,
      version: stamped.version ?? null,
      scheme: stamped.scheme ?? 0,
    };
  }
  const model = task.intent?.model || task.intent?.modelId || null;
  const resolved = model ? resolveModelCommitment(model) : null;
  if (!resolved) return null;
  return {
    commitment: resolved.commitment,
    model_id: resolved.modelId,
    version: resolved.version,
    scheme: resolved.scheme,
  };
}

const HASH32 = /^0x[0-9a-fA-F]{64}$/;

function committedHash(value) {
  return typeof value === 'string' && HASH32.test(value) ? value : null;
}

/**
 * One output commitment, same bytes the /v1 path and /task-status already store
 * (`keccak256` of the acting output). Do not SHA-256 the whole `result` object
 * when `result.outputHash` is present — that was two hashes for one task.
 */
function outputHashOf(task) {
  const explicit = committedHash(
    task.outputHash
    || task.meta?.outputHash
    || task.sp1Proof?.outputHash
    || task.result?.outputHash
    || task.result?.content_hash,
  );
  if (explicit) return { value: explicit, kind: 'committed' };
  if (task.result == null) return null;

  // Fallback only when the pipeline did not store a 32-byte commitment.
  // Hash the acting output, not the `{ provider, outputHash, usage }` envelope.
  const result = task.result;
  const acting = typeof result === 'string'
    ? result
    : (result.tool_calls
      ? JSON.stringify({ content: result.content || null, tool_calls: result.tool_calls })
      : (result.content != null ? String(result.content) : null));
  const serialized = acting != null ? acting : JSON.stringify(result);
  const digest = '0x' + crypto.createHash('sha256').update(serialized).digest('hex');
  return { value: digest, kind: 'sha256_of_output' };
}

/**
 * Canonical, order-stable serialization of the tamper-critical fields a receipt signature
 * covers (PBR — the "signed receipt", Tier-1). Anyone can recompute this from the public
 * receipt and verify the HMAC. Keep this list + order in lockstep with the SDK verifier.
 *
 * Payload version 2 adds `route.provider` so the attested compute source is tamper-evident
 * (required once multi-provider routing is live). Older verifiers that omit the field will
 * not validate new signatures — see docs/RECEIPT_SCHEMA_V2.md.
 */
export function canonicalSignedPayload(receipt) {
  return JSON.stringify([
    receipt.task_id,
    receipt.payment?.rail ?? null,
    receipt.payment?.ref ?? null,
    receipt.payment?.gross_amount ?? null,
    receipt.payment?.net_amount ?? null,
    receipt.payment?.fee_amount ?? null,
    receipt.payment?.protocol_fee_bps ?? receipt.payment?.fee_bps ?? null,
    receipt.payment?.platform_fee ?? null,
    receipt.payment?.platform_fee_bps ?? null,
    receipt.provider_cogs?.actual ?? null,
    receipt.route?.model ?? null,
    receipt.route?.model_commitment?.commitment ?? null,
    receipt.route?.provider ?? null,
    receipt.output?.hash ?? null,
    receipt.binding?.expected_commitment ?? null,
  ]);
}

/** HMAC-SHA256 signature over the canonical signed payload. */
function signReceiptPayload(receipt, secret) {
  const value = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  return {
    alg: 'HMAC-SHA256',
    payload_version: 3,
    value: `sha256=${value}`,
    signed_fields: [
      'task_id', 'payment.rail', 'payment.ref', 'payment.gross_amount',
      'payment.net_amount', 'payment.fee_amount', 'payment.protocol_fee_bps',
      'payment.platform_fee', 'payment.platform_fee_bps', 'provider_cogs.actual',
      'route.model', 'route.model_commitment.commitment', 'route.provider',
      'output.hash', 'binding.expected_commitment',
    ],
  };
}

/**
 * Verify a receipt HMAC. Needs the verify key, not a signing helper.
 * @param {object} receipt
 * @param {string} secret
 * @returns {{ checked: boolean, valid: boolean|null, expected?: string, recomputed?: string, reason?: string }}
 */
export function verifyReceiptHmac(receipt, secret) {
  if (!secret || typeof secret !== 'string') {
    return { checked: false, valid: null, reason: 'no_verify_key' };
  }
  const sig = receipt?.signature?.value;
  if (!sig) return { checked: false, valid: null, reason: 'no_signature' };
  const digest = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  const recomputed = `sha256=${digest}`;
  const a = Buffer.from(String(sig).toLowerCase());
  const b = Buffer.from(recomputed.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { checked: true, valid, expected: String(sig), recomputed };
}

/**
 * Private Spend privacy block on the public receipt.
 * @returns {{ mode: string, trust: string, notes: string } | null}
 */
export function privacyOf(task) {
  const mode = task?.meta?.privacyMode
    || (task?.meta?.privateSpend ? 'vendor_blind' : null)
    || (task?.meta?.provider === 'confidential' || task?.meta?.provider === 'phala'
      ? 'content_tee'
      : null);
  if (!mode) return null;
  const notes =
    mode === 'vendor_blind'
      ? 'Buyer paid XFuel; provider saw gateway-pooled credentials, not the end-customer identity. Does not encrypt prompts — use a confidential/TEE route for content privacy.'
      : mode === 'content_tee'
        ? 'Routed via a confidential/TEE-class provider tier (attested content path when configured). Settlement privacy is separate — see Private Spend.'
        : 'Privacy mode recorded on task.';
  return {
    mode,
    trust: mode === 'content_tee' ? 'tee_provider' : 'gateway',
    notes,
  };
}

/** Multi-hop / A2A receipt lineage (Sprint 3). */
export function lineageOf(task) {
  const parent = task?.meta?.parentTaskId || task?.intent?.parentTaskId || null;
  const a2a = task?.meta?.a2aMessageId || task?.intent?.a2aMessageId || null;
  const correlation = task?.meta?.correlationId || task?.intent?.correlationId || null;
  if (!parent && !a2a && !correlation) return null;
  const chain = [];
  if (parent) chain.push(parent);
  if (task?.taskId) chain.push(task.taskId);
  return {
    parent_task_id: parent,
    a2a_message_id: a2a,
    correlation_id: correlation,
    receipt_chain: chain.length > 1 ? chain : (parent ? [parent, task.taskId] : null),
  };
}

/**
 * Provider COGS from prepaid float (ADR 0005). Separate from buyer payment.rail.
 * @returns {object|null}
 */
export function providerCogsOf(task) {
  const c = task?.meta?.providerCogs || task?.providerCogs || null;
  if (!c || typeof c !== 'object') return null;
  return {
    provider: c.provider || null,
    float_id: c.float_id || c.floatId || null,
    currency: c.currency || null,
    estimated: c.estimated != null ? String(c.estimated) : null,
    actual: c.actual != null ? String(c.actual) : null,
    // Whether `actual` is real tokens at the provider's published rate
    // ('measured') or the bps fallback ('estimated'), which is a share of our own
    // price rather than of the work. Dropping this made the two indistinguishable
    // on the receipt, which is the one place the difference is load-bearing.
    basis: c.basis || null,
    usd_mark: c.usd_mark != null ? String(c.usd_mark) : (c.usdMark != null ? String(c.usdMark) : null),
    below_low_water: !!c.below_low_water || !!c.belowLowWater,
  };
}

/** Token counts from the served call — never prompts or raw output. */
export function usageOf(task) {
  const u = task?.usage || task?.result?.usage || null;
  if (!u || typeof u !== 'object') return null;
  const prompt = Number(u.prompt_tokens);
  const completion = Number(u.completion_tokens);
  const total = Number(u.total_tokens);
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null;
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(completion) ? completion : null,
    total_tokens: Number.isFinite(total)
      ? total
      : (Number.isFinite(prompt) && Number.isFinite(completion) ? prompt + completion : null),
    source: u.source || u.xfuel_source || null,
  };
}

/**
 * Build the public receipt JSON for a task.
 * @param {object} task     Listener task (from aiListener.activeTasks).
 * @param {object} [opts]   { baseUrl, signingSecret } — signingSecret enables the Tier-1
 *                          signed receipt (HMAC over the payment-bound tuple). Omit to keep
 *                          the receipt byte-compatible with the unsigned form.
 */
export function buildReceipt(task, { baseUrl = '', signingSecret = null, viPolicy = null } = {}) {
  const outcome = proofOutcomeOf(task);
  const feeBps = task.feeBps || 50;
  // Buyer default is USDC (ADR 0002). Legacy tfuel rail only when explicitly set.
  const paymentRail = task.intent?.paymentRail || 'usdc';
  const paymentRef = task.intent?.paymentRef || null;
  const output = outputHashOf(task);
  const modelCommitment = modelCommitmentOf(task);
  const vi = verifiedInferenceOf(task, viPolicy, {
    modelCommitment: modelCommitment?.commitment || null,
    outputHash: output?.value || null,
  });
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const providerCogs = providerCogsOf(task);
  const pricing = task.meta?.pricing || null;
  const usage = usageOf(task);
  const rollingFronted = !!(task.meta?.rolling?.fronted && !paymentRef && paymentRail === 'usdc');

  const receipt = {
    schema: 'xfuel.receipt.v3',
    task_id: task.taskId,
    status: task.status,
    proof_outcome: outcome,
    verify_url: buildVerifyUrl(base, task.taskId),
    created_at: task.createdAt || null,
    updated_at: task.updatedAt || null,
    route: {
      message_type: task.intent?.type || null,
      // The model that served, falling back to what was asked for. A receipt
      // attesting `xfuel/auto` names an XFuel alias, not a model anyone can check.
      model: task.result?.model || task.intent?.model || task.intent?.modelId || null,
      model_commitment: modelCommitment,
      // Prefer actual compute source over float-book label (float can say
      // theta-edgecloud while result is still mock / another tier).
      provider: (() => {
        const fromResult = task.result?.provider || task.result?.routedTo || task.routedTo || null;
        if (task.result?.mock) return fromResult || 'mock';
        if (fromResult) return fromResult;
        // Nothing served, so there is no compute source to name. `meta.provider`
        // carries the float default, and attesting it on a failed task would
        // credit a provider that never ran.
        if (task.status !== 'completed' && !providerCogs) return null;
        // A COGS record is evidence of a real burn against that float, so it
        // outranks the treasury default label.
        return providerCogs?.provider || task.meta?.provider || null;
      })(),
      chain_id: task.meta?.chain || task.intent?.chainId || null,
    },
    payment: {
      rail: paymentRail,
      ref: paymentRef,
      explorer_url: explorerUrlForRef(paymentRef),
      gross_amount: task.intent?.amount || '0',
      fee_amount: task.feeAmount || '0',
      net_amount: task.netAmount || '0',
      // Protocol split of gross (ADR 0001). Kept as `fee_bps` for older clients.
      fee_bps: feeBps,
      protocol_fee_bps: feeBps,
      // Cost-plus platform fee (ADR 0009). Signed separately so a buyer can
      // recompute max(floor, cogs × 1.10) without confusing it with the 50 bps split.
      platform_fee_bps: pricing?.fee_bps ?? null,
      platform_fee: pricing?.platform_fee != null ? String(pricing.platform_fee) : null,
      tier2_proof: pricing?.tier2_proof && pricing.tier2_proof !== '0' ? String(pricing.tier2_proof) : null,
      floor_applied: pricing?.floor_applied ?? null,
      basis: pricing?.basis ?? null,
      collected: !!paymentRef,
      collects_on: rollingFronted ? 'next_request' : 'this_request',
    },
    // ADR 0005 — provider COGS from prepaid float (not a second buyer rail).
    provider_cogs: providerCogs,
    usage,
    proof: {
      system: task.intent?.proofSystem || 'sp1',
      tier: vi?.tier || proofTierOf(task),
      outcome,
      has_proof: !!task.sp1Proof?.proof,
      nullifier: task.sp1Proof?.nullifier || null,
      proving_time_ms: task.sp1Proof?.provingTimeMs || null,
      attests: PROOF_SCOPE_NOTE,
    },
    verified_inference: vi,
    binding: verifyBinding(task),
    // Private Spend v0 — vendor-blind mode (gateway-trusted). Never claim prompt privacy here.
    privacy: privacyOf(task),
    // Multi-hop / A2A lineage (additive; null when single-hop)
    lineage: lineageOf(task),
    output: output ? { hash: output.value, kind: output.kind } : null,
    links: base
      ? {
          self: `${base}/receipt/${task.taskId}`,
          json: `${base}/receipt/${task.taskId}?format=json`,
          status: `${base}/task-status?task_id=${task.taskId}`,
          proof: `${base}/prove-result?task_id=${task.taskId}`,
        }
      : {
          self: `/receipt/${task.taskId}`,
          json: `/receipt/${task.taskId}?format=json`,
          status: `/task-status?task_id=${task.taskId}`,
          proof: `/prove-result?task_id=${task.taskId}`,
        },
  };

  if (signingSecret) receipt.signature = signReceiptPayload(receipt, signingSecret);
  return receipt;
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortHash(h, head = 10, tail = 8) {
  if (!h || typeof h !== 'string') return '—';
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

function row(label, valueHtml) {
  return `<div class="row"><span class="k">${esc(label)}</span><span class="v">${valueHtml}</span></div>`;
}

/** USDC 6dp integer string → partner-readable dollars. Tiny COGS keeps extra decimals. */
function formatUsdc(units) {
  if (units == null || units === '') return null;
  const n = Number(units);
  if (!Number.isFinite(n)) return String(units);
  const usd = n / 1e6;
  if (usd === 0) return '$0';
  if (Math.abs(usd) >= 0.01) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function usdcCell(units) {
  const pretty = formatUsdc(units);
  if (pretty == null) return '<span class="muted">—</span>';
  return `${esc(pretty)} <span class="muted">${esc(units)}</span>`;
}

function badge(outcome, bindingMatches) {
  if (outcome === 'valid') {
    const bind = bindingMatches === false ? ' · binding mismatch' : bindingMatches ? ' · binding verified' : '';
    return `<span class="badge ok">Proven${esc(bind)}</span>`;
  }
  if (outcome === 'pending') return '<span class="badge pending">Proof pending</span>';
  if (outcome === 'regenerable') return '<span class="badge pending">Signed</span>';
  return '<span class="badge bad">Invalid</span>';
}

function bindingCopy(receipt) {
  const p = receipt.payment;
  if (p?.rail === 'unmetered') {
    return 'Nothing settled — this was the free path. The receipt attests which model and provider ran, not a dollar.';
  }
  if (p?.collects_on === 'next_request' || (p?.rail === 'usdc' && !p?.ref && p?.collected === false)) {
    return 'No payment to bind yet. Rolling settlement collects this call’s measured bill on the next request; the settlement ref and explorer link appear on the receipt that pays it.';
  }
  if (p?.rail === 'tfuel') {
    return 'No x402 payment binding on this task (legacy TFUEL rail).';
  }
  return 'Payment binding was not recorded on this task. Buyer settlement is still USDC on Base.';
}

function proofWhyMissing(receipt) {
  const pr = receipt.proof;
  if (pr?.has_proof) return '';
  const cogs = formatUsdc(receipt.provider_cogs?.actual);
  const bits = [
    'On-chain SP1 proofs are opt-in ($0.08) or automatic above $2.00 of provider cost.',
    cogs ? `This call cost ${cogs} to serve.` : null,
    'The signed receipt above does not depend on the prover.',
  ].filter(Boolean);
  return bits.join(' ');
}

/** Render a clean, standalone, shareable HTML receipt page. */
export function renderReceiptHtml(receipt) {
  const p = receipt.payment;
  const pr = receipt.proof;
  const b = receipt.binding;
  const title = `XFuel receipt · ${receipt.task_id}`;
  const desc = p.rail === 'unmetered'
    ? `${pr.outcome === 'valid' ? 'Proven' : 'Signed'} · UNMETERED · not charged`
    : `${pr.outcome === 'valid' ? 'Proven' : 'Signed'} receipt · ${p.rail.toUpperCase()} · verify_url`;

  const refHtml = p.ref
    ? (p.explorer_url
        ? `<a href="${esc(p.explorer_url)}" target="_blank" rel="noopener">${esc(shortHash(p.ref, 16, 8))} ↗</a>`
        : `<code>${esc(shortHash(p.ref, 16, 8))}</code>`)
    : (p.collects_on === 'next_request'
        ? '<span class="badge pending">pending — next request</span>'
        : '<span class="muted">—</span>');

  const usage = receipt.usage;
  const usageRows = usage
    ? `${row('Prompt tokens', esc(usage.prompt_tokens ?? '—'))}
      ${row('Completion tokens', esc(usage.completion_tokens ?? '—'))}
      ${usage.total_tokens != null ? row('Total tokens', esc(usage.total_tokens)) : ''}`
    : '';

  const bindingBlock = b
    ? `<section class="card">
        <h2>Payment binding <span class="scope">independent re-derivation</span></h2>
        ${row('In proof', b.in_proof ? '<span class="badge ok">yes</span>' : '<span class="badge pending">server-attested</span>')}
        ${row('Rail / amount', `${esc((b.rail || '').toUpperCase())} · ${esc(b.amount)}`)}
        ${row('Expected commitment', `<code>${esc(shortHash(b.expected_commitment, 12, 10))}</code>`)}
        ${row('Recomputed commitment', `<code>${esc(shortHash(b.recomputed_commitment, 12, 10))}</code>`)}
        ${row('Match', b.matches ? '<span class="badge ok">✓ matches</span>' : '<span class="badge bad">✗ mismatch</span>')}
      </section>`
    : `<section class="card">
        <h2>Payment binding</h2>
        <p class="muted">${esc(bindingCopy(receipt))}</p>
      </section>`;

  const cogs = receipt.provider_cogs;
  const cogsProvider = cogs?.provider || receipt.route?.provider;
  const cogsBlock = cogs
    ? `<section class="card">
        <h2>Provider cost <span class="scope">what we paid to serve this</span></h2>
        ${row('Provider', esc(cogsProvider) || '<span class="muted">—</span>')}
        ${cogs.float_id ? row('Float', esc(cogs.float_id)) : ''}
        ${row('Measured cost', usdcCell(cogs.actual))}
        ${cogs.estimated != null && cogs.estimated !== cogs.actual ? row('Quoted estimate', usdcCell(cogs.estimated)) : ''}
        ${cogs.basis ? row('Basis', esc(cogs.basis)) : ''}
        ${cogs.below_low_water ? row('Float', '<span class="badge pending">at/below low water — refill</span>') : ''}
        <p class="muted" style="margin:8px 0 0;font-size:12px">You pay USDC on Base. We burn a prepaid provider float — not a second buyer rail.</p>
      </section>`
    : '';

  const privacy = receipt.privacy;
  const privacyBlock = privacy
    ? `<section class="card">
        <h2>Privacy <span class="scope">${esc(privacy.mode)}</span></h2>
        ${row('Mode', esc(privacy.mode))}
        ${row('Trust', esc(privacy.trust || 'gateway'))}
        <p class="scopebox">${esc(privacy.notes || '')}</p>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Machine-readable: <a href="?format=json">?format=json</a></p>
      </section>`
    : '';

  const lin = receipt.lineage;
  const lineageBlock = lin
    ? `<section class="card">
        <h2>Lineage <span class="scope">multi-hop / A2A</span></h2>
        ${row('Parent task', lin.parent_task_id ? `<code>${esc(shortHash(lin.parent_task_id, 12, 8))}</code>` : '<span class="muted">—</span>')}
        ${row('A2A message', lin.a2a_message_id ? `<code>${esc(shortHash(lin.a2a_message_id, 12, 8))}</code>` : '<span class="muted">—</span>')}
        ${row('Correlation', lin.correlation_id ? `<code>${esc(lin.correlation_id)}</code>` : '<span class="muted">—</span>')}
        ${row('Chain', lin.receipt_chain ? `<code>${esc(lin.receipt_chain.join(' → '))}</code>` : '<span class="muted">—</span>')}
      </section>`
    : '';

  const outputRow = receipt.output
    ? row(receipt.output.kind === 'committed' ? 'Output commitment' : 'Output hash (SHA-256)', `<code>${esc(shortHash(receipt.output.hash, 12, 10))}</code>`)
    : '';

  const mc = receipt.route.model_commitment;
  const modelCommitmentRow = mc && mc.commitment
    ? row('Model commitment <span class="scope">PoMA</span>',
        `<code>${esc(shortHash(mc.commitment, 12, 10))}</code>${mc.version != null ? ` <span class="muted">v${esc(mc.version)}</span>` : ''}`)
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .brand { font-weight: 700; letter-spacing: .3px; font-size: 18px; }
  .brand span { color: #6ea8fe; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; color: #aab2c0; }
  .taskid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #cfd6e4; word-break: break-all; }
  .card { background: #131824; border: 1px solid #222a3a; border-radius: 12px; padding: 18px 20px; margin: 14px 0; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: #8b95a7; margin: 0 0 12px; font-weight: 600; }
  .scope { text-transform: none; letter-spacing: 0; font-weight: 400; color: #6b7488; font-size: 11px; margin-left: 6px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-top: 1px solid #1b2231; }
  .row:first-of-type { border-top: 0; }
  .k { color: #8b95a7; }
  .v { text-align: right; word-break: break-word; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #0e1420; padding: 2px 6px; border-radius: 6px; color: #cbd3e1; }
  a { color: #6ea8fe; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: #6b7488; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.ok { background: #10331f; color: #6ee7a8; border: 1px solid #1d5a37; }
  .badge.pending { background: #2a2410; color: #f3d27a; border: 1px solid #5a4d1d; }
  .badge.warn { background: #33260f; color: #f0b866; border: 1px solid #5a411d; }
  .badge.bad { background: #331414; color: #f08c8c; border: 1px solid #5a1d1d; }
  .scopebox { font-size: 12.5px; color: #8b95a7; border-left: 2px solid #2a3346; padding: 4px 0 4px 12px; margin-top: 6px; }
  footer { margin-top: 28px; font-size: 12px; color: #6b7488; text-align: center; }
  footer a { color: #7a869c; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">XFuel<span>·</span>receipt</div>
      <div>${badge(pr.outcome, b ? b.matches : undefined)}</div>
    </header>

    <h1>Task</h1>
    <div class="taskid">${esc(receipt.task_id)}</div>

    <section class="card">
      <h2>Route</h2>
      ${row('Status', esc(receipt.status))}
      ${row('Type', esc(receipt.route.message_type) || '<span class="muted">—</span>')}
      ${row('Model', esc(receipt.route.model) || '<span class="muted">—</span>')}
      ${modelCommitmentRow}
      ${row('Provider', esc(receipt.route.provider) || '<span class="muted">—</span>')}
      ${row('Chain', esc(receipt.route.chain_id) || '<span class="muted">—</span>')}
      ${usageRows}
      ${outputRow}
    </section>

    <section class="card">
      <h2>Payment</h2>
      ${row('Rail', `<span class="badge ${p.rail === 'usdc' ? 'ok' : 'pending'}">${esc(p.rail.toUpperCase())}</span>`)}
      ${row('Settlement', p.collected ? '<span class="badge ok">collected</span>' : (p.collects_on === 'next_request' ? '<span class="badge pending">bill pending</span>' : '<span class="muted">not collected</span>'))}
      ${row('Settlement ref', refHtml)}
      ${p.rail === 'unmetered'
        ? row('Price', '<span class="muted">not charged</span> <span class="muted">unmetered /v1</span>')
        : row('Price', usdcCell(p.gross_amount))}
      ${p.basis ? row('Basis', `${esc(p.basis)}${p.floor_applied ? ' · floor applied' : ''}`) : ''}
      ${p.platform_fee != null ? row('Platform fee (10%)', usdcCell(p.platform_fee)) : ''}
      ${row('Protocol fee', `${usdcCell(p.fee_amount)} <span class="muted">(${esc(p.protocol_fee_bps ?? p.fee_bps)} bps)</span>`)}
    </section>

    <section class="card">
      <h2>Proof</h2>
      ${row('Signed receipt', receipt.signature?.value ? `<span class="badge ok">${esc(receipt.signature.alg || 'HMAC-SHA256')}</span>` : '<span class="muted">unsigned</span>')}
      ${row('On-chain SP1', pr.has_proof ? '<span class="badge ok">yes</span>' : '<span class="muted">not on this call</span>')}
      ${pr.nullifier ? row('Nullifier', `<code>${esc(shortHash(pr.nullifier, 12, 10))}</code>`) : ''}
      ${pr.proving_time_ms != null ? row('Proving time', `${esc(pr.proving_time_ms)} ms`) : ''}
      ${pr.has_proof ? `<div class="scopebox">${esc(pr.attests)}</div>` : `<p class="muted" style="margin:8px 0 0;font-size:12px">${esc(proofWhyMissing(receipt))}</p>`}
    </section>

    ${bindingBlock}
    ${cogsBlock}
    ${privacyBlock}
    ${lineageBlock}

    <footer>
      Machine-readable: <a href="${esc(receipt.links.json)}">JSON</a> ·
      <a href="${esc(receipt.links.proof)}">proof</a> ·
      <a href="${esc(receipt.links.status)}">status</a><br />
      ${receipt.signature?.value ? `Signed ${esc(receipt.signature.alg)} · payload v${esc(receipt.signature.payload_version)} · ` : ''}
      Signed receipt for routed AI compute — model, hub, and cost. HMAC by default; SP1 on demand.
    </footer>
  </div>
</body>
</html>`;
}

/** Minimal standalone HTML for an unknown/expired task id. */
export function renderReceiptNotFound(taskId) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>XFuel receipt · not found</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 80px 20px; text-align: center; }
  .brand { font-weight: 700; font-size: 18px; margin-bottom: 24px; }
  .brand span { color: #6ea8fe; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0e1420; padding: 2px 6px; border-radius: 6px; color: #cbd3e1; word-break: break-all; }
  .muted { color: #8b95a7; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">XFuel<span>·</span>receipt</div>
    <h1>Receipt not found</h1>
    <p class="muted">No task with id <code>${esc(taskId)}</code> is known to this node.
    Settled receipts are persisted and remain resolvable; check the id, or the
    receipt may have passed its retention window.</p>
  </div>
</body>
</html>`;
}

/**
 * Selective disclosure for auditors (Sprint 4).
 * Policy + totals + binding + privacy/lineage — never prompts, raw outputs, or proof bytes.
 *
 * @param {object} receipt  full public receipt from buildReceipt
 * @param {{ policy?: object }} [opts]
 */
export function buildAuditorExport(receipt, { policy = null } = {}) {
  if (!receipt || !receipt.task_id) {
    throw new Error('buildAuditorExport: receipt with task_id required');
  }
  const defaultPolicy = {
    max_fee_bps: 100,
    allowed_rails: ['usdc', 'tfuel', 'unmetered'],
    private_spend_ok: true,
    notes: 'Default XFuel audit policy — override via AUDITOR_POLICY_JSON on gateway',
  };
  const pol = policy || defaultPolicy;
  const feeBps = Number(receipt.payment?.fee_bps ?? 0);
  const rail = (receipt.payment?.rail || '').toLowerCase();
  const checks = {
    fee_bps_within_cap: feeBps <= Number(pol.max_fee_bps ?? 100),
    rail_allowed: Array.isArray(pol.allowed_rails)
      ? pol.allowed_rails.map((r) => String(r).toLowerCase()).includes(rail)
      : true,
    binding_ok: receipt.binding == null ? null : !!receipt.binding.matches,
    privacy_vendor_blind: receipt.privacy?.mode === 'vendor_blind',
  };
  const in_policy = Object.values(checks).every((v) => v === true || v === null);

  return {
    schema: 'xfuel.auditor_export.v1',
    generated_at: new Date().toISOString(),
    task_id: receipt.task_id,
    status: receipt.status,
    proof_outcome: receipt.proof_outcome,
    verify_url: receipt.verify_url,
    policy: pol,
    checks,
    in_policy,
    totals: {
      rail: receipt.payment?.rail || null,
      gross_amount: receipt.payment?.gross_amount || null,
      fee_amount: receipt.payment?.fee_amount || null,
      net_amount: receipt.payment?.net_amount || null,
      fee_bps: receipt.payment?.fee_bps ?? null,
      payment_ref: receipt.payment?.ref || null,
      explorer_url: receipt.payment?.explorer_url || null,
    },
    route_summary: {
      message_type: receipt.route?.message_type || null,
      model: receipt.route?.model || null,
      provider: receipt.route?.provider || null,
      chain_id: receipt.route?.chain_id || null,
      // model commitment hash only — no weights / prompts
      model_commitment: receipt.route?.model_commitment?.commitment || null,
    },
    proof_summary: {
      tier: receipt.proof?.tier || null,
      has_proof: !!receipt.proof?.has_proof,
      nullifier: receipt.proof?.nullifier || null,
      attests: receipt.proof?.attests || null,
    },
    binding: receipt.binding
      ? {
          matches: receipt.binding.matches,
          in_proof: receipt.binding.in_proof,
          expected_commitment: receipt.binding.expected_commitment,
          recomputed_commitment: receipt.binding.recomputed_commitment,
        }
      : null,
    privacy: receipt.privacy || null,
    lineage: receipt.lineage || null,
    output_hash: receipt.output?.hash || null,
    redacted: [
      'prompts',
      'messages',
      'raw_model_output',
      'proof_bytes',
      'api_keys',
      'provider_credentials',
    ],
    links: {
      full_json: receipt.links?.json || null,
      self: receipt.links?.self || null,
    },
  };
}

/** Minimal HTML for auditor export (no prompt/content surfaces). */
export function renderAuditorHtml(exportDoc) {
  const e = exportDoc;
  const ok = e.in_policy;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>XFuel auditor export · ${esc(shortHash(e.task_id, 12, 6))}</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  .brand { font-weight: 700; } .brand span { color: #6ea8fe; }
  .card { background: #131824; border: 1px solid #222a3a; border-radius: 12px; padding: 18px 20px; margin: 14px 0; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: #8b95a7; margin: 0 0 12px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-top: 1px solid #1b2231; }
  .row:first-of-type { border-top: 0; }
  .k { color: #8b95a7; } .v { text-align: right; word-break: break-word; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: #0e1420; padding: 2px 6px; border-radius: 6px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .ok { background: #10331f; color: #6ee7a8; } .bad { background: #331414; color: #f08c8c; }
  .muted { color: #6b7488; font-size: 13px; }
  a { color: #6ea8fe; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">XFuel<span>·</span>auditor export</div>
    <p class="muted">Selective disclosure — policy + totals only. No prompts or raw outputs.</p>
    <p><span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'in policy' : 'policy check failed'}</span></p>
    <section class="card">
      <h2>Task</h2>
      ${row('Task id', `<code>${esc(e.task_id)}</code>`)}
      ${row('Status', esc(e.status))}
      ${row('Proof outcome', esc(e.proof_outcome))}
    </section>
    <section class="card">
      <h2>Totals</h2>
      ${row('Rail', esc(e.totals?.rail))}
      ${row('Gross', esc(e.totals?.gross_amount))}
      ${row('Fee', `${esc(e.totals?.fee_amount)} (${esc(e.totals?.fee_bps)} bps)`)}
      ${row('Net', esc(e.totals?.net_amount))}
      ${row('Payment ref', e.totals?.payment_ref ? `<code>${esc(shortHash(e.totals.payment_ref, 16, 8))}</code>` : '—')}
    </section>
    <section class="card">
      <h2>Checks</h2>
      ${row('Fee within cap', String(e.checks?.fee_bps_within_cap))}
      ${row('Rail allowed', String(e.checks?.rail_allowed))}
      ${row('Binding ok', String(e.checks?.binding_ok))}
      ${row('Vendor-blind', String(e.checks?.privacy_vendor_blind))}
    </section>
    <p class="muted">Redacted: ${(e.redacted || []).join(', ')}. Full machine JSON: <a href="?format=auditor">?format=auditor</a> · full receipt <a href="?format=json">?format=json</a></p>
  </div>
</body>
</html>`;
}

export default {
  buildReceipt,
  buildAuditorExport,
  renderReceiptHtml,
  renderAuditorHtml,
  renderReceiptNotFound,
  explorerUrlForRef,
  buildVerifyUrl,
  baseUrlFromReq,
  privacyOf,
  lineageOf,
  verifyReceiptHmac,
};
