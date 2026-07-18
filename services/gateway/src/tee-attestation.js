/**
 * Verified Inference — TEE attestation verifier (Phase 4, T3a). Pluggable.
 *
 * Verifies an attestation ENVELOPE against a policy and binds it to the task:
 *   - measurement (MRENCLAVE / binary+model measurement) ∈ allowed set,
 *   - model_root == the task's PoMA commitment (the enclave loaded the committed model),
 *   - nonce binds the attestation to the task (anti-replay),
 *   - signature verified by the configured attestor.
 *
 * Attestors (honest about the trust root):
 *   - 'dev'       : real secp256k1 (EIP-191 personal_sign) by a pinned signer address. This is
 *                   SOFTWARE trust — a stand-in until a hardware host is wired. Labeled as such.
 *   - vendor slots ('nvidia-cc', 'sgx-dcap', …): registerAttestor() to add real quote
 *                   verification when the host exists. Unregistered vendors → verified=false.
 *
 * No hidden trust: the result records `method` and `trust` ('hardware' | 'software' | 'none').
 * See docs/VERIFIED_INFERENCE_TIERS.md.
 */
import { keccak256, toUtf8Bytes, getBytes, verifyMessage } from 'ethers';

const ZERO32 = '0x' + '0'.repeat(64);

/** Registry of vendor attestors: vendor → (envelope, ctx) => { verified, method, trust, reasons }. */
const _attestors = new Map();

/** Register a real vendor attestor (e.g. NVIDIA CC quote verifier) when a host is available. */
export function registerAttestor(vendor, verifyFn) {
  _attestors.set(String(vendor).toLowerCase(), verifyFn);
}

/** Canonical, order-stable message the attestor signs (dev) / that binds the envelope. */
export function canonicalAttestation(envelope) {
  const quote = envelope?.quote ? String(envelope.quote) : '';
  const quoteHash = quote ? keccak256(isHexBytes(quote) ? getBytes(quote) : toUtf8Bytes(quote)) : ZERO32;
  return JSON.stringify([
    String(envelope?.vendor || '').toLowerCase(),
    envelope?.measurement || ZERO32,
    envelope?.model_root || ZERO32,
    envelope?.nonce || ZERO32,
    quoteHash,
  ]);
}

function isHexBytes(s) {
  return typeof s === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(s) && s.length % 2 === 0;
}

/** Compute the expected nonce that binds an attestation to a task (keccak of taskId + model root). */
export function attestationNonce(taskId, modelRoot) {
  return keccak256(toUtf8Bytes(`${String(taskId)}|${modelRoot || ZERO32}`));
}

/** Built-in 'dev' attestor: verify a secp256k1 personal_sign over the canonical attestation. */
function verifyDevAttestor(envelope, ctx) {
  const reasons = [];
  const allowedSigners = (ctx.policy?.allowedSigners || []).map((a) => String(a).toLowerCase());
  if (!envelope.signature) {
    return { verified: false, method: 'dev-secp256k1', trust: 'software', reasons: ['missing signature'] };
  }
  let recovered = null;
  try {
    recovered = verifyMessage(canonicalAttestation(envelope), envelope.signature);
  } catch (e) {
    return { verified: false, method: 'dev-secp256k1', trust: 'software', reasons: [`bad signature: ${e.message}`] };
  }
  if (allowedSigners.length > 0 && !allowedSigners.includes(recovered.toLowerCase())) {
    reasons.push('signer not in allowedSigners');
  }
  if (envelope.signer && envelope.signer.toLowerCase() !== recovered.toLowerCase()) {
    reasons.push('envelope.signer mismatch');
  }
  return {
    verified: reasons.length === 0,
    method: 'dev-secp256k1',
    trust: 'software',
    signer: recovered,
    reasons,
  };
}

/**
 * Verify an attestation envelope for a task.
 * @param {object} envelope { vendor, measurement, model_root, nonce, quote, signature, signer }
 * @param {object} ctx      { policy, expectedModelRoot, expectedNonce }
 *   policy: { allowedVendors[], allowedMeasurements[], allowedSigners[], requireModelRootMatch }
 * @returns {{ verified, vendor, method, trust, measurement, model_root, reasons[] }}
 */
export function verifyAttestation(envelope, ctx = {}) {
  const policy = ctx.policy || {};
  const reasons = [];
  if (!envelope || typeof envelope !== 'object') {
    return { verified: false, vendor: null, method: 'none', trust: 'none', reasons: ['no attestation envelope'] };
  }
  const vendor = String(envelope.vendor || '').toLowerCase();

  const allowedVendors = (policy.allowedVendors || ['dev']).map((v) => String(v).toLowerCase());
  if (!allowedVendors.includes(vendor)) reasons.push(`vendor '${vendor}' not allowed`);

  const allowedMeasurements = (policy.allowedMeasurements || []).map((m) => String(m).toLowerCase());
  if (allowedMeasurements.length > 0 && !allowedMeasurements.includes(String(envelope.measurement || '').toLowerCase())) {
    reasons.push('measurement not in allowed set');
  }

  if (ctx.expectedModelRoot && (envelope.model_root || '').toLowerCase() !== String(ctx.expectedModelRoot).toLowerCase()) {
    reasons.push('model_root != task PoMA commitment');
  } else if (policy.requireModelRootMatch && !ctx.expectedModelRoot) {
    reasons.push('model_root match required but no expected commitment provided');
  }

  if (ctx.expectedNonce && (envelope.nonce || '').toLowerCase() !== String(ctx.expectedNonce).toLowerCase()) {
    reasons.push('nonce mismatch (attestation not bound to this task)');
  }

  // Signature / quote verification via the vendor attestor.
  let sig = { verified: false, method: 'none', trust: 'none', reasons: ['no attestor for vendor'] };
  if (vendor === 'dev') {
    sig = verifyDevAttestor(envelope, { policy });
  } else if (_attestors.has(vendor)) {
    try {
      sig = _attestors.get(vendor)(envelope, { policy, ...ctx }) || sig;
    } catch (e) {
      sig = { verified: false, method: `${vendor}-quote`, trust: 'none', reasons: [`attestor error: ${e.message}`] };
    }
  } else {
    sig = { verified: false, method: `${vendor}-quote`, trust: 'none', reasons: ['vendor verifier not wired'] };
  }
  reasons.push(...(sig.reasons || []));

  return {
    verified: reasons.length === 0 && sig.verified,
    vendor,
    method: sig.method,
    trust: sig.trust,
    signer: sig.signer || null,
    measurement: envelope.measurement || null,
    model_root: envelope.model_root || null,
    reasons,
  };
}

export default { verifyAttestation, canonicalAttestation, attestationNonce, registerAttestor };
