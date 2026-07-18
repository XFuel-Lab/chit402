/**
 * Inference Prover Client (Verified Inference / Tier-3 seam)
 *
 * Mechanism-agnostic entry point for Tier-3 proving. Phase 0 of
 * docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md: new code should import from HERE,
 * not from the mechanism-specific `zkgpt-prover-client.js`. Today it delegates to the
 * existing HTTP prover client; as Tier-3 mechanisms land (TEE attestation, ZK
 * spot-check, full zkML) this module becomes the router across them.
 *
 * Configuration: set INFERENCE_PROVER_URL to the prover endpoint. The legacy
 * ZKGPT_PROVER_URL is still honored as a fallback for backward compatibility.
 */

import ZkGPTProverClient, {
  getZkGPTProver,
  isZkGPTProverConfigured,
  resolveInferenceProverUrl,
} from './zkgpt-prover-client.js';

/**
 * Get or create the inference prover client. Returns null when no prover URL is set.
 * @returns {ZkGPTProverClient | null}
 */
export function getInferenceProver() {
  return getZkGPTProver();
}

/**
 * Whether an inference prover is configured (INFERENCE_PROVER_URL or legacy ZKGPT_PROVER_URL).
 * @returns {boolean}
 */
export function isInferenceProverConfigured() {
  return isZkGPTProverConfigured();
}

export { resolveInferenceProverUrl };

/** Canonical class export for the inference prover client. */
export const InferenceProverClient = ZkGPTProverClient;

export default InferenceProverClient;
