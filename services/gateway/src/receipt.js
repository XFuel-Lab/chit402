import crypto from 'crypto';
import { verifyMessage, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { computePaymentCommitment, computeInferenceBinding } from './payment-binding.js';
import { resolveModelCommitment } from './model-commitment.js';
import { selectTier } from './tier-policy.js';
import { verifyAttestation, attestationNonce } from './tee-attestation.js';
import { buildSpotCheckRecord } from './spotcheck.js';
import { signJws, verifyJws, verifyJwsWithJwks, getIssuerPublicKeyJwk } from './issuer-key.js';

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

/** USDC atomic scale — payment.gross_amount and provider_cogs.actual share this unit. */
export const USDC_ATOMIC_DECIMALS = 6;

const PROOF_SCOPE_NOTE =
  'The SP1 proof attests settlement metadata (correct fee split, payment binding) ' +
  'and a commitment to the output hash — anchored on-chain with a single-use ' +
  'nullifier. It does NOT attest that the provider computed the model correctly ' +
  '(that is Tier-2 proof-of-inference, roadmap).';

/** Normalize task timestamps to Unix seconds (JSON + JWS `iat`). */
export function toUnixSeconds(ts) {
  if (ts == null || ts === '') return null;
  if (typeof ts === 'string' && Number.isNaN(Number(ts))) {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Absolute JWKS URL for isolated sandboxes; relative only when base is unknown. */
export function buildJwksUri(baseUrl = '') {
  const path = '/.well-known/jwks.json';
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  return base ? `${base}${path}` : path;
}

/** Decode signed claims from issuer_signature.jws (no signature check). */
export function decodeReceiptClaims(receipt) {
  const jws = receipt?.issuer_signature?.jws;
  if (!jws || typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Merge envelope metadata with JWS claims for display, HMAC verify, and legacy callers.
 * Signed fields are taken from the JWS payload — never trust top-level copies on slim receipts.
 */
export function mergeReceiptView(receipt) {
  if (receipt?.payment) return receipt;

  const claims = decodeReceiptClaims(receipt);
  if (!claims) {
    const paymentMeta = receipt.payment_meta || {};
    const routeMeta = receipt.route_meta || {};
    return {
      ...receipt,
      payment: {
        rail: 'usdc',
        ref: null,
        gross_amount: '0',
        net_amount: '0',
        fee_amount: '0',
        fee_bps: 50,
        protocol_fee_bps: 50,
        explorer_url: paymentMeta.explorer_url ?? null,
        tier2_proof: paymentMeta.tier2_proof ?? null,
        floor_applied: paymentMeta.floor_applied ?? null,
        basis: paymentMeta.basis ?? null,
        collected: paymentMeta.collected ?? false,
        collects_on: paymentMeta.collects_on ?? 'this_request',
      },
      route: {
        message_type: routeMeta.message_type ?? null,
        chain_id: routeMeta.chain_id ?? null,
        model: null,
        provider: null,
        model_commitment: routeMeta.model_commitment ?? null,
      },
      output: receipt.output?.hash ? receipt.output : null,
      caller_binding: null,
      proof: receipt.proof || {},
    };
  }

  const paymentMeta = receipt.payment_meta || {};
  const routeMeta = receipt.route_meta || {};

  return {
    ...receipt,
    payment: {
      rail: claims.payment?.rail ?? null,
      ref: claims.payment?.ref ?? null,
      gross_amount: claims.payment?.gross_amount ?? null,
      net_amount: claims.payment?.net_amount ?? null,
      fee_amount: claims.payment?.fee_amount ?? null,
      fee_bps: claims.payment?.protocol_fee_bps ?? null,
      protocol_fee_bps: claims.payment?.protocol_fee_bps ?? null,
      platform_fee: claims.payment?.platform_fee ?? null,
      platform_fee_bps: claims.payment?.platform_fee_bps ?? null,
      explorer_url: paymentMeta.explorer_url ?? explorerUrlForRef(claims.payment?.ref),
      tier2_proof: paymentMeta.tier2_proof ?? null,
      floor_applied: paymentMeta.floor_applied ?? null,
      basis: paymentMeta.basis ?? null,
      collected: paymentMeta.collected ?? !!claims.payment?.ref,
      collects_on: paymentMeta.collects_on ?? 'this_request',
    },
    route: {
      message_type: routeMeta.message_type ?? null,
      chain_id: routeMeta.chain_id ?? null,
      model: claims.route?.model ?? null,
      provider: claims.route?.provider ?? null,
      model_commitment: routeMeta.model_commitment ?? (
        claims.route?.model_commitment
          ? { commitment: claims.route.model_commitment }
          : null
      ),
    },
    output: claims.output?.hash
      ? { hash: claims.output.hash, kind: receipt.output?.kind ?? 'committed' }
      : null,
    caller_binding: claims.caller_binding ?? null,
    provider_cogs: claims.provider_cogs?.actual != null && receipt.provider_cogs
      ? { ...receipt.provider_cogs, actual: claims.provider_cogs.actual }
      : receipt.provider_cogs ?? null,
  };
}

/** Machine-readable proof scope flags (JSON). Prose lives on HTML only. */
export function proofScopeOf(task, vi, outcome) {
  const tier = vi?.tier || proofTierOf(task);
  const hasProof = !!task.sp1Proof?.proof;
  const nullifier = task.sp1Proof?.nullifier || null;
  const settlementProof = hasSettlementProof(task);
  return {
    system: task.intent?.proofSystem || 'sp1',
    tier,
    zkp_tier: tier,
    outcome,
    has_proof: hasProof,
    nullifier,
    nullifier_enforced: !!(nullifier && settlementProof),
    proving_time_ms: task.sp1Proof?.provingTimeMs || null,
    attestation_scope: {
      settlement_metadata: hasProof || tier === 'settlement',
      output_hash_commitment: true,
      payment_binding: true,
      model_computation: tier === 'inference',
      on_chain_nullifier: !!(nullifier && settlementProof),
    },
  };
}

/** Block-explorer base per EVM network used in `payment_ref` ("<network>:<txHash>"). */
const EXPLORERS = {
  'base-sepolia': 'https://sepolia.basescan.org/tx/',
  base: 'https://basescan.org/tx/',
};

/**
 * Normalize a task ID from a URL path for storage/lookup.
 * Converts `chit-<uuid>` to `xfuel-<uuid>` so paths like /receipt/chit-<uuid>
 * resolve to the same stored task. Stored task_id always uses the xfuel- prefix.
 *
 * @param {string} taskId - task ID from URL path (may have chit- or xfuel- prefix)
 * @returns {string} normalized task ID with xfuel- prefix (or unchanged if no recognized prefix)
 */
export function normalizeTaskIdForLookup(taskId) {
  if (!taskId || typeof taskId !== 'string') return taskId;
  if (taskId.startsWith('chit-')) {
    return 'xfuel-' + taskId.slice(5);
  }
  return taskId;
}

/**
 * Determine the preferred task ID path prefix based on the request hostname.
 * When Host is api.chit402.com, prefer 'chit-' prefix in URLs; otherwise 'xfuel-'.
 *
 * @param {string|null} reqHost - request Host header (may include port)
 * @returns {'chit-'|'xfuel-'} preferred prefix for receipt URLs
 */
export function preferredPathPrefix(reqHost) {
  if (!reqHost || typeof reqHost !== 'string') return 'xfuel-';
  const host = reqHost.toLowerCase().split(':')[0];
  if (host === 'api.chit402.com') return 'chit-';
  return 'xfuel-';
}

/**
 * Convert a stored task ID to display form with the preferred prefix.
 * Stored IDs use xfuel-<uuid>; display may use chit-<uuid> on chit402.com.
 *
 * @param {string} storedTaskId - stored task ID (xfuel-<uuid> or legacy format)
 * @param {'chit-'|'xfuel-'} preferredPrefix - preferred prefix for display
 * @returns {string} task ID with preferred prefix (or unchanged if not xfuel- prefixed)
 */
export function taskIdWithPreferredPrefix(storedTaskId, preferredPrefix) {
  if (!storedTaskId || typeof storedTaskId !== 'string') return storedTaskId;
  if (preferredPrefix === 'chit-' && storedTaskId.startsWith('xfuel-')) {
    return 'chit-' + storedTaskId.slice(6);
  }
  return storedTaskId;
}

/**
 * Canonical, shareable proof link for a task: the public `/receipt/:taskId` page.
 * Absolute when a base URL is known, otherwise a root-relative path. This is the
 * single `verify_url` threaded consistently across every surface (M2M API,
 * OpenAI gateway, SDK, MCP) so an agent always gets one link it can share.
 *
 * @param {string} baseUrl - base URL for absolute links (e.g. 'https://api.xfuel.app')
 * @param {string} taskId - stored task ID (xfuel-<uuid>)
 * @param {{ reqHost?: string }} [opts] - options for host-aware prefix selection
 * @returns {string} verify URL with appropriate prefix based on host
 */
export function buildVerifyUrl(baseUrl, taskId, { reqHost = null } = {}) {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const prefix = preferredPathPrefix(reqHost);
  const displayId = taskIdWithPreferredPrefix(taskId, prefix);
  return `${base}/receipt/${displayId}`;
}

/**
 * Resolve the public base URL for building absolute links.
 *
 * Priority:
 *   1. If the request Host matches an allowed public host, use that host
 *      (enables serving receipts from multiple domains with correct URLs)
 *   2. Else use the explicitly configured canonical URL (PUBLIC_BASE_URL)
 *   3. Else derive from the request's protocol + host
 *   4. Else return '' (relative URLs)
 *
 * @param {object} req - Express request object
 * @param {string|null} configuredBase - PUBLIC_BASE_URL fallback
 * @param {string[]} [allowedHosts] - PUBLIC_HOSTS list (lowercase hostnames)
 */
export function baseUrlFromReq(req, configuredBase, allowedHosts = []) {
  const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
  const reqHostLower = reqHost ? reqHost.toLowerCase().split(':')[0] : null;

  if (reqHostLower && Array.isArray(allowedHosts) && allowedHosts.length > 0) {
    if (allowedHosts.includes(reqHostLower)) {
      const proto = req.protocol || 'https';
      return `${proto}://${reqHost}`;
    }
  }

  if (configuredBase) return String(configuredBase).replace(/\/$/, '');
  return reqHost ? `${req.protocol}://${reqHost}` : '';
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

/** True when no Tier-2 SP1 proof was scheduled for this task (signed receipt only). */
export function proofNotExpected(task) {
  if (task?.intent?.proveAllowed === false) return true;
  if (task?.sp1Proof?.skipped) return true;
  return false;
}

export function proofOutcomeOf(task) {
  if (task?.sp1Proof?.error) return 'regenerable';
  if (hasSettlementProof(task)) return 'valid';
  if (task?.status === 'failed') return 'invalid';
  if (proofNotExpected(task)) return 'not_applicable';
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
 * Canonical signed claims as a self-describing object.
 * 
 * Payload version 5: Object-based claims (not array). All standard JWT libraries
 * (jose, pyjwt, jsonwebtoken) can parse and verify these claims without external
 * field-order metadata. The signed_fields list is embedded in the payload itself
 * for self-containment.
 * 
 * @param {object} receipt
 * @param {{ iat?: number|null }} [opts]
 * @returns {object} JWT claims object
 */
export function canonicalSignedClaims(receipt, { iat = null } = {}) {
  const view = mergeReceiptView(receipt);
  const issuedAt = iat ?? toUnixSeconds(receipt.created_at) ?? Math.floor(Date.now() / 1000);
  return {
    task_id: view.task_id,
    iss: 'chit402',
    iat: issuedAt,
    payment: {
      rail: view.payment?.rail ?? null,
      ref: view.payment?.ref ?? null,
      gross_amount: view.payment?.gross_amount ?? null,
      net_amount: view.payment?.net_amount ?? null,
      fee_amount: view.payment?.fee_amount ?? null,
      protocol_fee_bps: view.payment?.protocol_fee_bps ?? view.payment?.fee_bps ?? null,
      platform_fee: view.payment?.platform_fee ?? null,
      platform_fee_bps: view.payment?.platform_fee_bps ?? null,
    },
    provider_cogs: {
      actual: view.provider_cogs?.actual ?? null,
    },
    route: {
      model: view.route?.model ?? null,
      model_commitment: view.route?.model_commitment?.commitment ?? null,
      provider: view.route?.provider ?? null,
    },
    output: {
      hash: view.output?.hash ?? null,
    },
    binding: {
      expected_commitment: view.binding?.expected_commitment ?? null,
    },
    caller_binding: {
      payer_wallet: view.caller_binding?.payer_wallet ?? null,
      agent_pubkey: view.caller_binding?.agent_pubkey ?? null,
      api_key_hash: view.caller_binding?.api_key_hash ?? null,
    },
    payload_version: 5,
  };
}

/**
 * Canonical, order-stable serialization of the tamper-critical fields a receipt signature
 * covers (PBR — the "signed receipt", Tier-1). Anyone can recompute this from the public
 * receipt and verify the HMAC. Keep this list + order in lockstep with the SDK verifier.
 *
 * @deprecated Use canonicalSignedClaims() for standard JWT verification.
 * This legacy array format is kept only for HMAC backward compatibility.
 */
export function canonicalSignedPayload(receipt) {
  const view = mergeReceiptView(receipt);
  return JSON.stringify([
    view.task_id,
    view.payment?.rail ?? null,
    view.payment?.ref ?? null,
    view.payment?.gross_amount ?? null,
    view.payment?.net_amount ?? null,
    view.payment?.fee_amount ?? null,
    view.payment?.protocol_fee_bps ?? view.payment?.fee_bps ?? null,
    view.payment?.platform_fee ?? null,
    view.payment?.platform_fee_bps ?? null,
    view.provider_cogs?.actual ?? null,
    view.route?.model ?? null,
    view.route?.model_commitment?.commitment ?? null,
    view.route?.provider ?? null,
    view.output?.hash ?? null,
    view.binding?.expected_commitment ?? null,
    view.caller_binding?.payer_wallet ?? null,
    view.caller_binding?.agent_pubkey ?? null,
    view.caller_binding?.api_key_hash ?? null,
  ]);
}

/**
 * HMAC-SHA256 signature over the canonical signed payload.
 * 
 * NOTE: HMAC signatures are retained for internal/compat use only. The primary
 * public verification path is the ES256 issuer_signature with JWKS.
 * 
 * @param {object} receipt
 * @param {string} secret
 * @param {{ role?: string }} [opts] - role defaults to 'attestor' (not 'primary' — ES256 is primary)
 */
function signReceiptPayload(receipt, secret, { role = 'attestor' } = {}) {
  const value = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  return {
    alg: 'HMAC-SHA256',
    payload_version: 5,
    value: `sha256=${value}`,
    role,
    signed_fields: [
      'task_id', 'payment.rail', 'payment.ref', 'payment.gross_amount',
      'payment.net_amount', 'payment.fee_amount', 'payment.protocol_fee_bps',
      'payment.platform_fee', 'payment.platform_fee_bps', 'provider_cogs.actual',
      'route.model', 'route.model_commitment.commitment', 'route.provider',
      'output.hash', 'binding.expected_commitment',
      'caller_binding.payer_wallet', 'caller_binding.agent_pubkey', 'caller_binding.api_key_hash',
    ],
  };
}

/** Public HMAC block — omits internal signed_fields list (verify uses canonical payload). */
function publicHmacAttestation(attestation) {
  if (!attestation) return null;
  const { signed_fields: _omit, ...rest } = attestation;
  return rest;
}

/**
 * ES256 issuer signature as a compact JWS.
 * 
 * This is the PRIMARY public verification path. Any agent can verify this signature
 * against the JWKS at /.well-known/jwks.json without needing a shared secret.
 * 
 * The JWS payload is a self-describing object (not an array), so standard JWT
 * libraries (jose, pyjwt, jsonwebtoken) can parse and verify it directly.
 * 
 * Header: { alg: 'ES256', typ: 'chit402-receipt+jwt', kid }
 * Payload: Object with named claims (task_id, payment, route, etc.)
 * 
 * @param {object} receipt
 * @param {{ baseUrl?: string, iat?: number|null }} [opts]
 * @returns {{ alg: string, payload_version: number, jws: string, kid: string }}
 */
function signReceiptEcdsa(receipt, { baseUrl = '', iat = null } = {}) {
  const claims = canonicalSignedClaims(receipt, { iat });
  const jwksUri = buildJwksUri(baseUrl);
  const { jws, kid } = signJws(claims, {
    jku: jwksUri.startsWith('http') ? jwksUri : null,
  });
  return {
    alg: 'ES256',
    payload_version: 5,
    jws,
    kid,
  };
}

/**
 * Verify a receipt HMAC against a single secret.
 * @param {object} receipt
 * @param {string} secret
 * @param {{ sigField?: string }} [opts] - which signature field to check ('signature' or 'co_signature')
 * @returns {{ checked: boolean, valid: boolean|null, expected?: string, recomputed?: string, reason?: string }}
 */
export function verifyReceiptHmac(receipt, secret, { sigField = 'signature' } = {}) {
  if (!secret || typeof secret !== 'string') {
    return { checked: false, valid: null, reason: 'no_verify_key' };
  }
  const sigObj = receipt?.[sigField];
  const sig = sigObj?.value;
  if (!sig) return { checked: false, valid: null, reason: 'no_signature' };
  const digest = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  const recomputed = `sha256=${digest}`;
  const a = Buffer.from(String(sig).toLowerCase());
  const b = Buffer.from(recomputed.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { checked: true, valid, expected: String(sig), recomputed, role: sigObj?.role || null };
}

/**
 * Verify a receipt against multiple secrets (replaceable signer).
 * Returns valid if ANY secret verifies EITHER the hmac_attestation or co_attestation.
 * This is the offline verify path for when XFuel disappears — the co-signer's
 * key still works. See docs/VERIFY_ALGORITHM.md.
 *
 * @param {object} receipt
 * @param {string[]} secrets - array of secrets to try (primary, co-signer, etc.)
 * @returns {{ checked: boolean, valid: boolean, validatedBy?: string, reason?: string }}
 */
export function verifyReceiptMultiKey(receipt, secrets) {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    return { checked: false, valid: false, reason: 'no_verify_keys' };
  }
  const sigFields = ['hmac_attestation', 'co_attestation'].filter(f => receipt?.[f]?.value);
  if (sigFields.length === 0) {
    return { checked: false, valid: false, reason: 'no_signature' };
  }
  for (const secret of secrets) {
    if (!secret || typeof secret !== 'string') continue;
    for (const field of sigFields) {
      const result = verifyReceiptHmac(receipt, secret, { sigField: field });
      if (result.valid) {
        return { checked: true, valid: true, validatedBy: field };
      }
    }
  }
  return { checked: true, valid: false, reason: 'all_keys_failed' };
}

/**
 * Verify a receipt's ES256 issuer signature (compact JWS) against a JWK.
 * This is the public-key verification path — no shared secret required.
 *
 * Verification steps:
 *   1. GET /receipt/:taskId?format=json → receipt.issuer_signature.jws
 *   2. GET /.well-known/jwks.json → find key matching issuer_signature.kid
 *   3. Verify the compact JWS against the JWKS public key
 *   4. Optionally validate that the JWS claims match the receipt
 *
 * @param {object} receipt - Receipt JSON with issuer_signature.jws
 * @param {object} jwk - JWK public key { kty: 'EC', crv: 'P-256', x, y }
 * @param {{ validateClaims?: boolean }} [opts] - Whether to validate claims match receipt
 * @returns {{ checked: boolean, valid: boolean, kid?: string, payload?: object, reason?: string }}
 */
export function verifyReceiptEcdsa(receipt, jwk, { validateClaims = true } = {}) {
  const sig = receipt?.issuer_signature;
  if (!sig || !sig.jws) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (sig.alg !== 'ES256') {
    return { checked: false, valid: false, reason: `unsupported_alg: ${sig.alg}` };
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return { checked: false, valid: false, reason: 'invalid_jwk' };
  }
  if (sig.kid && jwk.kid && sig.kid !== jwk.kid) {
    return { checked: false, valid: false, reason: 'kid_mismatch' };
  }

  const result = verifyJws(sig.jws, jwk);
  if (!result.valid) {
    return { checked: true, valid: false, reason: result.reason };
  }

  if (validateClaims && result.payload) {
    const view = mergeReceiptView(receipt);
    if (result.payload.task_id !== view.task_id) {
      return { checked: true, valid: false, reason: 'task_id_mismatch' };
    }
    const signedBinding = result.payload.caller_binding || {};
    const receiptBinding = view.caller_binding || {};
    if ((signedBinding.payer_wallet ?? null) !== (receiptBinding.payer_wallet ?? null)
      || (signedBinding.agent_pubkey ?? null) !== (receiptBinding.agent_pubkey ?? null)
      || (signedBinding.api_key_hash ?? null) !== (receiptBinding.api_key_hash ?? null)) {
      return { checked: true, valid: false, reason: 'caller_binding_mismatch' };
    }
  }

  return { checked: true, valid: true, kid: sig.kid, payload: result.payload };
}

/**
 * Verify a receipt's ES256 issuer signature against a JWKS (key set).
 * Finds the matching key by kid and verifies.
 *
 * @param {object} receipt - Receipt JSON with issuer_signature.jws
 * @param {{ keys: object[] }} jwks - JWKS with keys array
 * @param {{ validateClaims?: boolean }} [opts] - Whether to validate claims match receipt
 * @returns {{ checked: boolean, valid: boolean, kid?: string, payload?: object, reason?: string }}
 */
export function verifyReceiptEcdsaWithJwks(receipt, jwks, { validateClaims = true } = {}) {
  const sig = receipt?.issuer_signature;
  if (!sig || !sig.jws) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return { checked: false, valid: false, reason: 'empty_jwks' };
  }

  const jwsResult = verifyJwsWithJwks(sig.jws, jwks);
  if (!jwsResult.valid) {
    return { checked: jwsResult.reason === 'signature_invalid', valid: false, reason: jwsResult.reason };
  }

  if (validateClaims && jwsResult.payload) {
    const view = mergeReceiptView(receipt);
    if (jwsResult.payload.task_id !== view.task_id) {
      return { checked: true, valid: false, reason: 'task_id_mismatch' };
    }
    const signedBinding = jwsResult.payload.caller_binding || {};
    const receiptBinding = view.caller_binding || {};
    if ((signedBinding.payer_wallet ?? null) !== (receiptBinding.payer_wallet ?? null)
      || (signedBinding.agent_pubkey ?? null) !== (receiptBinding.agent_pubkey ?? null)
      || (signedBinding.api_key_hash ?? null) !== (receiptBinding.api_key_hash ?? null)) {
      return { checked: true, valid: false, reason: 'caller_binding_mismatch' };
    }
  }

  return { checked: true, valid: true, kid: jwsResult.kid, payload: jwsResult.payload };
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
      ? 'Buyer paid Chit; provider saw gateway-pooled credentials, not the end-customer identity. Does not encrypt prompts — use a confidential/TEE route for content privacy.'
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
    currency: c.currency || 'USDC',
    // Atomic USDC integers — same scale as payment.gross_amount (6 decimals; 2000 = $0.002).
    decimals: USDC_ATOMIC_DECIMALS,
    unit: 'atomic_usdc',
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

/**
 * Caller identity binding (who paid).
 * 
 * Returns the actual wallet address that sent the USDC payment, the agent's public key
 * if registered, and a hash of the API key used (for attribution without exposure).
 * 
 * IMPORTANT: This MUST return real identities (wallet addresses, pubkeys) or null.
 * Never return symbolic labels like "openai-gateway" — those are not verifiable identities.
 * Use null when the identity is unknown or not settled on-chain.
 * 
 * @param {object} task
 * @returns {{ payer_wallet: string|null, agent_pubkey: string|null, api_key_hash: string|null }}
 */
export function callerBindingOf(task, opts = {}) {
  // Extract actual payer wallet from x402 settlement data or explicit opts.
  // opts.payerWallet is wired from the settlement/payment-binding path in buildReceipt.
  let payerWallet = null;
  if (isValidEvmAddress(opts.payerWallet)) {
    try { payerWallet = getAddress(opts.payerWallet); } catch { payerWallet = null; }
  }
  if (!payerWallet) payerWallet = extractPayerWallet(task);

  // Agent public key from registration (if task was from a registered agent)
  // MUST be a valid address/pubkey — never a symbolic label like "openai-gateway"
  const rawAgentPubkey = task?.meta?.agentPubkey
    || task?.meta?.agent_pubkey
    || task?.intent?.agentPubkey
    || opts.agentPubkey
    || null;
  const agentPubkey = (rawAgentPubkey && !isSymbolicLabel(rawAgentPubkey)) ? rawAgentPubkey : null;

  const agentIdRaw = task?.meta?.agentId
    || task?.meta?.agent_id
    || opts.agentId
    || null;
  const agentId = agentIdRaw != null && Number.isFinite(Number(agentIdRaw)) ? Number(agentIdRaw) : null;

  // API key hash for attribution (never the raw key)
  const apiKeyHash = task?.meta?.apiKeyHash
    || task?.meta?.api_key_hash
    || opts.apiKeyHash
    || null;

  return {
    payer_wallet: payerWallet,
    agent_pubkey: agentPubkey,
    agent_id: agentId,
    api_key_hash: apiKeyHash,
  };
}

/**
 * Extract the actual payer wallet address from task settlement data.
 * Returns a valid EVM address (0x...) or null. Never returns symbolic labels.
 * 
 * @param {object} task
 * @returns {string|null} Checksummed EVM address or null
 */
function extractPayerWallet(task) {
  // Priority: explicit sender from x402 settlement > agent wallet > null
  const candidates = [
    task?.meta?.payerAddress,
    task?.meta?.payer_address,
    task?.meta?.payerWallet,
    task?.meta?.payer,
    task?.meta?.senderAddress,
    task?.meta?.sender_address,
    task?.intent?.payerAddress,
    task?.intent?.senderAddress,
    task?.intent?.payer,
    task?.x402?.sender,
    task?.x402?.payer,
    task?.meta?.agentWallet,
    task?.meta?.agent_wallet,
  ];

  for (const candidate of candidates) {
    if (isValidEvmAddress(candidate)) {
      try {
        return getAddress(candidate);
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Check if a string looks like a valid EVM address.
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidEvmAddress(value) {
  if (!value || typeof value !== 'string') return false;
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Check if a value is a symbolic/internal label that must NOT appear in public receipts.
 * These are internal identifiers, vendor names, or gateway labels — never verifiable identities.
 * @param {unknown} value
 * @returns {boolean}
 */
function isSymbolicLabel(value) {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  const blocklist = [
    'openai-gateway', 'openai', 'anthropic', 'openrouter', 'together',
    'fireworks', 'groq', 'mistral', 'cohere', 'perplexity', 'deepseek',
    'gateway', 'xfuel-gateway', 'chit402-gateway', 'internal', 'system',
  ];
  return blocklist.some(label => lower === label || lower.includes(label + '-') || lower.startsWith(label));
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
 * @param {object} [opts]   { baseUrl, signingSecret, coSignerSecret, reqHost, apiKeyHash, agentId, agentPubkey, payerWallet }
 *                          signingSecret enables the Tier-1 signed receipt (HMAC over the payment-bound tuple).
 *                          coSignerSecret adds a second attestor (replaceable signer) so
 *                          treasuries can verify even if XFuel disappears.
 *                          reqHost enables host-aware URL prefix selection (chit- on api.chit402.com).
 *                          apiKeyHash, agentId, agentPubkey, payerWallet enable caller binding for
 *                          entitlement verification (who is entitled to this receipt).
 */
export function buildReceipt(task, { baseUrl = '', signingSecret = null, coSignerSecret = null, viPolicy = null, reqHost = null, apiKeyHash = null, agentId = null, agentPubkey = null, payerWallet = null } = {}) {
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

  const prefix = preferredPathPrefix(reqHost);
  const displayTaskId = taskIdWithPreferredPrefix(task.taskId, prefix);
  const createdAt = toUnixSeconds(task.createdAt);
  const updatedAt = toUnixSeconds(task.updatedAt);

  const routeProvider = (() => {
    const fromResult = task.result?.provider || task.result?.routedTo || task.routedTo || null;
    if (task.result?.mock) return fromResult || 'mock';
    if (fromResult) return fromResult;
    if (task.status !== 'completed' && !providerCogs) return null;
    return providerCogs?.provider || task.meta?.provider || null;
  })();

  const routeModel = task.result?.model || task.intent?.model || task.intent?.modelId || null;

  // Full draft used for signing — signed fields are stripped from the public JSON envelope.
  const draft = {
    schema: 'xfuel.receipt.v4',
    task_id: task.taskId,
    status: task.status,
    proof_outcome: outcome,
    verify_url: buildVerifyUrl(base, task.taskId, { reqHost }),
    created_at: createdAt,
    updated_at: updatedAt,
    route: {
      message_type: task.intent?.type || null,
      model: routeModel,
      model_commitment: modelCommitment,
      provider: routeProvider,
      chain_id: task.meta?.chain || task.intent?.chainId || null,
    },
    payment: {
      rail: paymentRail,
      ref: paymentRef,
      explorer_url: explorerUrlForRef(paymentRef),
      gross_amount: task.intent?.amount || '0',
      fee_amount: task.feeAmount || '0',
      net_amount: task.netAmount || '0',
      fee_bps: feeBps,
      protocol_fee_bps: feeBps,
      platform_fee_bps: pricing?.fee_bps ?? null,
      platform_fee: pricing?.platform_fee != null ? String(pricing.platform_fee) : null,
      tier2_proof: pricing?.tier2_proof && pricing.tier2_proof !== '0' ? String(pricing.tier2_proof) : null,
      floor_applied: pricing?.floor_applied ?? null,
      basis: pricing?.basis ?? null,
      collected: !!paymentRef,
      collects_on: rollingFronted ? 'next_request' : 'this_request',
    },
    provider_cogs: providerCogs,
    usage,
    proof: proofScopeOf(task, vi, outcome),
    verified_inference: vi,
    binding: verifyBinding(task),
    privacy: privacyOf(task),
    lineage: lineageOf(task),
    handoff: handoffOf(task),
    output: output ? { hash: output.value, kind: output.kind } : null,
    caller_binding: callerBindingOf(task, { apiKeyHash, agentId, agentPubkey, payerWallet }),
    links: base
      ? {
          self: `${base}/receipt/${displayTaskId}`,
          json: `${base}/receipt/${displayTaskId}?format=json`,
          status: `${base}/task-status?task_id=${task.taskId}`,
          proof: `${base}/prove-result?task_id=${task.taskId}`,
        }
      : {
          self: `/receipt/${displayTaskId}`,
          json: `/receipt/${displayTaskId}?format=json`,
          status: `/task-status?task_id=${task.taskId}`,
          proof: `/prove-result?task_id=${task.taskId}`,
        },
  };

  const jwks_uri = buildJwksUri(base);
  const issuer_signature = signReceiptEcdsa(draft, { baseUrl: base, iat: createdAt });
  const hmacRaw = signingSecret
    ? signReceiptPayload(draft, signingSecret, { role: 'attestor' })
    : null;
  const coRaw = coSignerSecret
    ? signReceiptPayload(draft, coSignerSecret, { role: 'co_attestor' })
    : null;

  // Slim envelope: signed payment/route/output/caller fields live only in issuer_signature.jws.
  // Inactive extension blocks are omitted entirely (not null).
  const envelope = {
    schema: draft.schema,
    task_id: draft.task_id,
    status: draft.status,
    proof_outcome: draft.proof_outcome,
    verify_url: draft.verify_url,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
    verification: {
      source_of_truth: 'issuer_signature.jws',
      jwks_uri,
    },
    route_meta: {
      message_type: draft.route.message_type,
      chain_id: draft.route.chain_id,
      model_commitment: draft.route.model_commitment,
    },
    payment_meta: {
      explorer_url: draft.payment.explorer_url,
      tier2_proof: draft.payment.tier2_proof,
      floor_applied: draft.payment.floor_applied,
      basis: draft.payment.basis,
      collected: draft.payment.collected,
      collects_on: draft.payment.collects_on,
    },
    proof: draft.proof,
    links: draft.links,
    issuer_signature,
  };

  if (draft.provider_cogs) envelope.provider_cogs = draft.provider_cogs;
  if (draft.usage) envelope.usage = draft.usage;
  if (draft.verified_inference) envelope.verified_inference = draft.verified_inference;
  if (draft.binding) envelope.binding = draft.binding;
  if (draft.privacy) envelope.privacy = draft.privacy;
  if (draft.lineage) envelope.lineage = draft.lineage;
  if (draft.handoff) envelope.handoff = draft.handoff;
  if (draft.output) envelope.output = { kind: draft.output.kind };
  if (hmacRaw) envelope.hmac_attestation = publicHmacAttestation(hmacRaw);
  if (coRaw) envelope.co_attestation = publicHmacAttestation(coRaw);

  return envelope;
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

/**
 * Rewrite the internal `xfuel-` prefix to `chit-` for human-readable display.
 * The underlying id and URL path remain unchanged; this is display-only.
 */
function displayTaskId(taskId) {
  if (!taskId || typeof taskId !== 'string') return taskId || '';
  return taskId.startsWith('xfuel-') ? 'chit-' + taskId.slice(6) : taskId;
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
  if (outcome === 'not_applicable') return '<span class="badge ok">Signed</span>';
  if (outcome === 'regenerable') return '<span class="badge pending">Signed</span>';
  return '<span class="badge bad">Invalid</span>';
}

function bindingCopy(view) {
  const p = view.payment;
  const payerWallet = view.caller_binding?.payer_wallet ?? null;
  if (payerWallet) {
    return `Payer wallet ${payerWallet} is bound in the issuer-signed receipt (caller_binding.payer_wallet). Buyer settlement is USDC on Base.`;
  }
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

/**
 * Server-side verification of issuer signature for honest HTML display.
 * Uses module-scope ESM imports (verifyJws, getIssuerPublicKeyJwk).
 * Returns verification result; never throws.
 */
function verifyIssuerForHtml(receipt) {
  const sig = receipt?.issuer_signature;
  if (!sig || !sig.jws || sig.alg !== 'ES256') {
    return { verified: false, reason: 'no_issuer_signature' };
  }
  try {
    const jwk = getIssuerPublicKeyJwk();
    if (!jwk || jwk.kid !== sig.kid) {
      return { verified: false, reason: 'kid_mismatch' };
    }
    const result = verifyJws(sig.jws, jwk);
    if (!result.valid) {
      return { verified: false, reason: result.reason || 'signature_invalid' };
    }
    if (result.payload?.task_id !== mergeReceiptView(receipt).task_id) {
      return { verified: false, reason: 'task_id_mismatch' };
    }
    return { verified: true, reason: 'verified' };
  } catch {
    return { verified: false, reason: 'verification_error' };
  }
}

/** Render a clean, standalone, shareable HTML receipt page. */
export function renderReceiptHtml(receipt) {
  const view = mergeReceiptView(receipt);
  const p = view.payment;
  const pr = view.proof;
  const b = view.binding;
  const title = 'Chit402';
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
    ? `${row('Tokens', `${esc(usage.total_tokens ?? '—')} <span class="muted">(${esc(usage.prompt_tokens ?? 0)}→${esc(usage.completion_tokens ?? 0)})</span>`)}`
    : '';

  const issuerSig = receipt.issuer_signature;
  const issuerVerified = verifyIssuerForHtml(receipt);
  const jwksUri = receipt.verification?.jwks_uri || null;
  const jwksUrl = jwksUri?.startsWith('http')
    ? jwksUri
    : (() => {
      if (!jwksUri) return null;
      const selfUrl = receipt.links?.self;
      if (selfUrl && selfUrl.startsWith('http')) {
        try {
          return new URL(jwksUri, selfUrl.replace(/\/receipt\/.*$/, '')).href;
        } catch {
          return jwksUri;
        }
      }
      return jwksUri;
    })();

  const bindingBlock = b
    ? `<section class="card">
        <h2>Payment binding <span class="scope">independent re-derivation</span></h2>
        ${row('In proof', b.in_proof ? '<span class="badge ok">yes</span>' : '<span class="badge pending">server-attested</span>')}
        ${row('Rail / amount', `${esc((b.rail || '').toUpperCase())} · ${esc(b.amount)}`)}
        ${row('Expected commitment', `<code>${esc(shortHash(b.expected_commitment, 12, 10))}</code>`)}
        ${row('Recomputed commitment', `<code>${esc(shortHash(b.recomputed_commitment, 12, 10))}</code>`)}
        ${row('Match', b.matches ? '<span class="badge ok">✓ matches</span>' : '<span class="badge bad">✗ mismatch</span>')}
      </section>`
    : (view.caller_binding?.payer_wallet
        ? `<section class="card">
            <h2>Payment binding <span class="scope">signed caller binding</span></h2>
            ${row('Payer wallet', `<code>${esc(view.caller_binding.payer_wallet)}</code>`)}
            <p class="muted" style="margin:8px 0 0;font-size:12px">${esc(bindingCopy(view))}</p>
          </section>`
        : `<section class="card">
            <h2>Payment binding</h2>
            <p class="muted">${esc(bindingCopy(view))}</p>
          </section>`);

  const cogs = view.provider_cogs;
  const cogsProvider = cogs?.provider || view.route?.provider;
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

  const ho = receipt.handoff;
  const handoffBlock = ho
    ? `<section class="card">
        <h2>Handoff <span class="scope">wallet-move delegation</span></h2>
        ${row('Status', ho.status === 'complete'
          ? '<span class="badge ok">complete</span>'
          : '<span class="badge pending">pending destination ack</span>')}
        ${row('Origin', ho.origin?.address ? `<code>${esc(shortHash(ho.origin.address, 10, 8))}</code>` : '<span class="muted">—</span>')}
        ${row('Destination', ho.origin?.dest_address ? `<code>${esc(shortHash(ho.origin.dest_address, 10, 8))}</code>` : '<span class="muted">—</span>')}
        ${row('Delegated at', ho.origin?.created_at ? esc(new Date(ho.origin.created_at).toISOString()) : '<span class="muted">—</span>')}
        ${ho.dest?.address ? row('Acknowledged by', `<code>${esc(shortHash(ho.dest.address, 10, 8))}</code>`) : ''}
        ${ho.dest?.created_at ? row('Acknowledged at', esc(new Date(ho.dest.created_at).toISOString())) : ''}
        <p class="muted" style="margin:8px 0 0;font-size:12px">Origin signature delegates receipt possession to destination. Verify against JSON.</p>
      </section>`
    : '';

  const outputRow = view.output
    ? row(view.output.kind === 'committed' ? 'Output commitment' : 'Output hash (SHA-256)', `<code>${esc(shortHash(view.output.hash, 12, 10))}</code>`)
    : '';

  const mc = view.route.model_commitment;
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
  .card.secondary { background: #0f1318; border-color: #1a2028; }
  .card.secondary h2 { font-size: 11px; color: #5b6370; }
  .scope { text-transform: none; letter-spacing: 0; font-weight: 400; color: #6b7488; font-size: 11px; margin-left: 6px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-top: 1px solid #1b2231; }
  .row:first-of-type { border-top: 0; }
  .row.compact { padding: 4px 0; font-size: 13px; }
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
  .share-row { display: flex; align-items: center; gap: 10px; margin: 16px 0 8px; }
  .copy-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; background: #1a2332; border: 1px solid #2a3346; border-radius: 8px; color: #aab2c0; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
  .copy-btn:hover { background: #222d3f; border-color: #3a4a5f; color: #cfd6e4; }
  .copy-btn:active { transform: scale(0.98); }
  .copy-btn.copied { background: #10331f; border-color: #1d5a37; color: #6ee7a8; }
  .copy-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
  footer { margin-top: 28px; font-size: 12px; color: #6b7488; text-align: center; }
  footer a { color: #7a869c; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">Chit402</div>
      <div>${badge(pr.outcome, b ? b.matches : undefined)}</div>
    </header>

    <div class="share-row">
      <button class="copy-btn" id="copyLink" type="button" title="Copy receipt link">
        <svg id="copyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <svg id="checkIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>
        <span id="copyText">Copy link</span>
      </button>
    </div>

    <h1>Task</h1>
    <div class="taskid">${esc(displayTaskId(receipt.task_id))}</div>

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
      <h2>Verification</h2>
      ${row('Issuer signature', issuerVerified.verified
        ? '<span class="badge ok">verified</span>'
        : (issuerSig?.jws ? '<span class="badge bad">not verified</span>' : '<span class="muted">unsigned</span>'))}
      ${issuerSig?.alg ? row('Algorithm', `<code>${esc(issuerSig.alg)}</code>`) : ''}
      ${issuerSig?.kid ? row('Key ID', `<code>${esc(shortHash(issuerSig.kid, 8, 6))}</code>`) : ''}
      ${jwksUrl ? row('JWKS', `<a href="${esc(jwksUrl)}" target="_blank" rel="noopener">${esc(jwksUri)} ↗</a>`) : ''}
      ${receipt.hmac_attestation?.value ? row('HMAC attestation', `<span class="badge pending">${esc(receipt.hmac_attestation.alg || 'HMAC-SHA256')}</span> <span class="muted">secondary</span>`) : ''}
      ${row('On-chain SP1', pr.has_proof ? '<span class="badge ok">yes</span>' : '<span class="muted">not on this call</span>')}
      ${pr.nullifier ? row('Nullifier', `<code>${esc(shortHash(pr.nullifier, 12, 10))}</code>`) : ''}
      ${pr.proving_time_ms != null ? row('Proving time', `${esc(pr.proving_time_ms)} ms`) : ''}
      ${pr.has_proof ? `<div class="scopebox">${esc(PROOF_SCOPE_NOTE)}</div>` : `<p class="muted" style="margin:8px 0 0;font-size:12px">${esc(proofWhyMissing(view))}</p>`}
    </section>

    <section class="card secondary">
      <h2>Route details</h2>
      ${row('Status', esc(view.status))}
      ${row('Model', esc(view.route.model) || '<span class="muted">—</span>')}
      ${row('Provider', esc(view.route.provider) || '<span class="muted">—</span>')}
      ${usageRows}
      ${outputRow}
      ${modelCommitmentRow}
      ${view.route.chain_id ? row('Chain', esc(view.route.chain_id)) : ''}
      ${view.route.message_type ? row('Type', esc(view.route.message_type)) : ''}
    </section>

    ${bindingBlock}
    ${cogsBlock}
    ${privacyBlock}
    ${lineageBlock}
    ${handoffBlock}

    <footer>
      Machine-readable: <a href="${esc(receipt.links.json)}">JSON</a> ·
      <a href="${esc(receipt.links.proof)}">proof</a> ·
      <a href="${esc(receipt.links.status)}">status</a><br />
      ES256 signed receipt · payload v${esc(receipt.issuer_signature?.payload_version || 5)} · verify via <a href="${esc(jwksUrl || '/.well-known/jwks.json')}">JWKS</a><br />
      XFuel Lab
    </footer>
  </div>
  <script>
    (function() {
      var btn = document.getElementById('copyLink');
      var copyIcon = document.getElementById('copyIcon');
      var checkIcon = document.getElementById('checkIcon');
      var copyText = document.getElementById('copyText');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var url = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }
        function fallbackCopy() {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); showCopied(); } catch(e) {}
          document.body.removeChild(ta);
        }
        function showCopied() {
          btn.classList.add('copied');
          copyIcon.style.display = 'none';
          checkIcon.style.display = 'block';
          copyText.textContent = 'Copied!';
          setTimeout(function() {
            btn.classList.remove('copied');
            copyIcon.style.display = 'block';
            checkIcon.style.display = 'none';
            copyText.textContent = 'Copy link';
          }, 2000);
        }
      });
    })();
  </script>
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
<title>Chit402 · not found</title>
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
    <div class="brand">Chit402</div>
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
  const view = mergeReceiptView(receipt);
  const defaultPolicy = {
    max_fee_bps: 100,
    allowed_rails: ['usdc', 'tfuel', 'unmetered'],
    private_spend_ok: true,
    notes: 'Default XFuel audit policy — override via AUDITOR_POLICY_JSON on gateway',
  };
  const pol = policy || defaultPolicy;
  const feeBps = Number(view.payment?.fee_bps ?? 0);
  const rail = (view.payment?.rail || '').toLowerCase();
  const checks = {
    fee_bps_within_cap: feeBps <= Number(pol.max_fee_bps ?? 100),
    rail_allowed: Array.isArray(pol.allowed_rails)
      ? pol.allowed_rails.map((r) => String(r).toLowerCase()).includes(rail)
      : true,
    binding_ok: view.binding == null ? null : !!view.binding.matches,
    privacy_vendor_blind: view.privacy?.mode === 'vendor_blind',
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
      rail: view.payment?.rail || null,
      gross_amount: view.payment?.gross_amount || null,
      fee_amount: view.payment?.fee_amount || null,
      net_amount: view.payment?.net_amount || null,
      fee_bps: view.payment?.fee_bps ?? null,
      payment_ref: view.payment?.ref || null,
      explorer_url: view.payment?.explorer_url || null,
    },
    route_summary: {
      message_type: view.route?.message_type || null,
      model: view.route?.model || null,
      provider: view.route?.provider || null,
      chain_id: view.route?.chain_id || null,
      model_commitment: view.route?.model_commitment?.commitment || null,
    },
    proof_summary: {
      tier: view.proof?.tier || null,
      zkp_tier: view.proof?.zkp_tier || null,
      has_proof: !!view.proof?.has_proof,
      nullifier: view.proof?.nullifier || null,
      nullifier_enforced: !!view.proof?.nullifier_enforced,
      attestation_scope: view.proof?.attestation_scope || null,
    },
    binding: view.binding
      ? {
          matches: receipt.binding.matches,
          in_proof: receipt.binding.in_proof,
          expected_commitment: receipt.binding.expected_commitment,
          recomputed_commitment: receipt.binding.recomputed_commitment,
        }
      : null,
    privacy: receipt.privacy || null,
    lineage: receipt.lineage || null,
    output_hash: view.output?.hash || null,
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
<title>Chit402 auditor export</title>
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
    <div class="brand">Chit402<span>·</span>auditor export</div>
    <p class="muted">Selective disclosure — policy + totals only. No prompts or raw outputs.</p>
    <p><span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'in policy' : 'policy check failed'}</span></p>
    <section class="card">
      <h2>Task</h2>
      ${row('Task id', `<code>${esc(displayTaskId(e.task_id))}</code>`)}
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

// ─── Receipt Handoff (wallet-move delegation) ───────────────────────────────
// Enables proving possession transfer: origin holder delegates to a dest wallet,
// dest wallet acknowledges. Both signatures are stored on the receipt and verifiable
// by any agent from the JSON against the two public keys.

/**
 * Build the canonical message the ORIGIN holder signs to delegate possession.
 * EIP-191 personal_sign over: "chit.handoff.origin|<taskId>|<destAddress>|<timestamp>"
 * @param {string} taskId
 * @param {string} destAddress - checksummed destination wallet address
 * @param {number} timestamp - Unix timestamp (seconds)
 */
export function canonicalOriginHandoffMessage(taskId, destAddress, timestamp) {
  return `chit.handoff.origin|${taskId}|${getAddress(destAddress)}|${timestamp}`;
}

/**
 * Build the canonical message the DESTINATION wallet signs to acknowledge.
 * EIP-191 personal_sign over: "chit.handoff.dest.ack|<taskId>|<originAddress>|<timestamp>"
 * @param {string} taskId
 * @param {string} originAddress - checksummed origin wallet address
 * @param {number} timestamp - Unix timestamp (seconds)
 */
export function canonicalDestAckMessage(taskId, originAddress, timestamp) {
  return `chit.handoff.dest.ack|${taskId}|${getAddress(originAddress)}|${timestamp}`;
}

/**
 * Verify an origin delegation signature.
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.originAddress - claimed origin address
 * @param {string} params.destAddress - destination address in the delegation
 * @param {number} params.timestamp - Unix timestamp
 * @param {string} params.signature - EIP-191 personal_sign signature
 * @returns {{ valid: boolean, recoveredAddress?: string, reason?: string }}
 */
export function verifyOriginHandoff({ taskId, originAddress, destAddress, timestamp, signature }) {
  if (!taskId || !originAddress || !destAddress || !timestamp || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  try {
    const message = canonicalOriginHandoffMessage(taskId, destAddress, timestamp);
    const recovered = verifyMessage(message, signature);
    const normalizedOrigin = getAddress(originAddress);
    const normalizedRecovered = getAddress(recovered);
    if (normalizedRecovered.toLowerCase() !== normalizedOrigin.toLowerCase()) {
      return { valid: false, recoveredAddress: normalizedRecovered, reason: 'signer_mismatch' };
    }
    return { valid: true, recoveredAddress: normalizedRecovered };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Verify a destination acknowledgment signature.
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.originAddress - origin address from the delegation
 * @param {string} params.destAddress - claimed destination address
 * @param {number} params.timestamp - Unix timestamp
 * @param {string} params.signature - EIP-191 personal_sign signature
 * @returns {{ valid: boolean, recoveredAddress?: string, reason?: string }}
 */
export function verifyDestAck({ taskId, originAddress, destAddress, timestamp, signature }) {
  if (!taskId || !originAddress || !destAddress || !timestamp || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  try {
    const message = canonicalDestAckMessage(taskId, originAddress, timestamp);
    const recovered = verifyMessage(message, signature);
    const normalizedDest = getAddress(destAddress);
    const normalizedRecovered = getAddress(recovered);
    if (normalizedRecovered.toLowerCase() !== normalizedDest.toLowerCase()) {
      return { valid: false, recoveredAddress: normalizedRecovered, reason: 'signer_mismatch' };
    }
    return { valid: true, recoveredAddress: normalizedRecovered };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Extract handoff block from task metadata (if present).
 * Returns null if no handoff, or a structured block with origin/dest info.
 * @param {object} task
 */
export function handoffOf(task) {
  const h = task?.handoff || task?.meta?.handoff;
  if (!h || typeof h !== 'object') return null;
  if (!h.origin) return null;

  const result = {
    origin: {
      address: h.origin.address || null,
      dest_address: h.origin.destAddress || h.origin.dest_address || null,
      timestamp: h.origin.timestamp || null,
      signature: h.origin.signature || null,
      created_at: h.origin.createdAt || h.origin.created_at || null,
    },
    dest: null,
    status: 'pending_dest_ack',
  };

  if (h.dest && h.dest.address) {
    result.dest = {
      address: h.dest.address || null,
      timestamp: h.dest.timestamp || null,
      signature: h.dest.signature || null,
      created_at: h.dest.createdAt || h.dest.created_at || null,
    };
    result.status = 'complete';
  }

  return result;
}

/**
 * Verify a receipt's compact JWS token against a JWK (public key).
 * Primary agent verification path — decode the JWS and verify.
 *
 * @param {object} receipt - Receipt JSON with issuer_signature.jws
 * @param {object} jwk - JWK public key { kty: 'EC', crv: 'P-256', x, y }
 * @returns {{ checked: boolean, valid: boolean, payload?: object, kid?: string, reason?: string }}
 */
export function verifyReceiptJws(receipt, jwk) {
  const sig = receipt?.issuer_signature;
  if (!sig || !sig.jws) {
    return { checked: false, valid: false, reason: 'no_jws' };
  }
  const result = verifyJws(sig.jws, jwk);
  return { checked: true, ...result };
}

/**
 * Verify a receipt's compact JWS token against a JWKS (key set).
 * Finds the matching key by kid from the JWS header and verifies.
 *
 * @param {object} receipt - Receipt JSON with issuer_signature.jws
 * @param {{ keys: object[] }} jwks - JWKS with keys array
 * @returns {{ checked: boolean, valid: boolean, payload?: object, kid?: string, reason?: string }}
 */
export function verifyReceiptJwsWithJwks(receipt, jwks) {
  const sig = receipt?.issuer_signature;
  if (!sig || !sig.jws) {
    return { checked: false, valid: false, reason: 'no_jws' };
  }
  const result = verifyJwsWithJwks(sig.jws, jwks);
  return { checked: true, ...result };
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
  normalizeTaskIdForLookup,
  preferredPathPrefix,
  taskIdWithPreferredPrefix,
  privacyOf,
  lineageOf,
  decodeReceiptClaims,
  mergeReceiptView,
  toUnixSeconds,
  buildJwksUri,
  proofScopeOf,
  callerBindingOf,
  verifyReceiptHmac,
  verifyReceiptMultiKey,
  verifyReceiptEcdsa,
  verifyReceiptEcdsaWithJwks,
  verifyReceiptJws,
  verifyReceiptJwsWithJwks,
  canonicalSignedPayload,
  canonicalSignedClaims,
  canonicalOriginHandoffMessage,
  canonicalDestAckMessage,
  verifyOriginHandoff,
  verifyDestAck,
  handoffOf,
};
