/**
 * Server switch for the on-chain settlement proof add-on.
 *
 * SETTLEMENT_PROOF_ENABLED must be exactly the string 'true' to ask for it.
 * Unset, empty or any other value means off. Off means:
 *   - a request that asks for a settlement proof is refused before any quote,
 *     402 challenge, settle or receipt;
 *   - no settlement proof is requested from the prover;
 *   - payment_binding.in_proof is never set true.
 *
 * Reopening is NOT a config change. The env var alone cannot turn the add-on
 * on: SETTLEMENT_TIER_CLAIMS_SIGNED below must also be true, and it is a code
 * constant. Change it only in the same release that ships both of:
 *   - proof.tier and payment_binding.in_proof signed into the issuer claims
 *     under a new payload version, so neither can change without breaking the
 *     signature;
 *   - an offline verifier rule: tier 'settlement' requires in_proof true and a
 *     matching non-zero v2 payment commitment, and anything else fails.
 * Until then SETTLEMENT_PROOF_ENABLED=true logs a warning and stays off.
 */
import { normalizeRequestedTier } from './tier-policy.js';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';

export const SETTLEMENT_PROOF_FLAG = 'SETTLEMENT_PROOF_ENABLED';
export const SETTLEMENT_PROOF_NOT_OFFERED = 'settlement_proof_not_offered';
export const SETTLEMENT_PROOF_NOT_OFFERED_MESSAGE = 'Tier-2 settlement proofs are temporarily unavailable. Retry without proof_tier.';

/**
 * Code guard for the add-on (see the header). Not read from the environment.
 * Flip to true only with signed tier/in_proof claims and the verifier rule.
 */
export const SETTLEMENT_TIER_CLAIMS_SIGNED = false;

// Tests exercise the flag-on paths; nothing outside NODE_ENV=test can do this.
let _testOverride = false;
export function _allowSettlementProofForTests(on = true) {
  if (!testSwitchesOn()) {
    throw new Error('_allowSettlementProofForTests is test-only');
  }
  _testOverride = !!on;
}

let _warned = false;

/** The env var asks for the add-on (exactly 'true'). Not the same as enabled. */
export function settlementProofRequestedByEnv(env = process.env) {
  return env?.[SETTLEMENT_PROOF_FLAG] === 'true';
}

export function settlementProofEnabled(env = process.env) {
  if (!settlementProofRequestedByEnv(env)) return false;
  if (SETTLEMENT_TIER_CLAIMS_SIGNED || (_testOverride && testSwitchesOn())) return true;
  if (!_warned) {
    _warned = true;
    logger.warn(
      { flag: SETTLEMENT_PROOF_FLAG },
      'SETTLEMENT_PROOF_ENABLED=true is ignored: the settlement proof add-on stays off until '
        + 'proof.tier and payment_binding.in_proof are signed and the offline verifier enforces them '
        + '(SETTLEMENT_TIER_CLAIMS_SIGNED in settlement-proof-flag.js)',
    );
  }
  return false;
}

/** Log the guard once at boot, so the warning does not wait for the first request. */
export function warnIfSettlementProofIgnored(env = process.env) {
  settlementProofEnabled(env);
}

/**
 * Body asks for a settlement proof: proof_tier in any spelling we read, or Private + Attest.
 * proof_tier 'inference' (and its tee / zk-* aliases) counts too: with no Tier-3
 * mechanism the tier engine falls back to 'settlement', and it is a proof request.
 */
export function requestsSettlementProof(body) {
  if (!body || typeof body !== 'object') return false;
  const xf = body.xfuel && typeof body.xfuel === 'object' ? body.xfuel : {};
  // Same fields as parsePrivacyProduct (private-desk-attest.js).
  const product = xf.privacy_product ?? xf.privacyProduct ?? body.privacy_product ?? body.privacy?.product ?? null;
  if (product != null && String(product).trim().toLowerCase() === 'private_attest') return true;
  // Every proof_tier spelling the gateway reads (x402-server.js, openai-gateway.js).
  const tiers = [
    body.proof_tier, body.proofTier, body.intent?.proofTier, body.intent?.proof_tier,
    xf.proof_tier, xf.proofTier,
  ];
  return tiers.some((t) => {
    if (t == null) return false;
    const tier = normalizeRequestedTier(t)?.tier;
    return tier === 'settlement' || tier === 'inference';
  });
}

export function settlementProofRefusalBody() {
  return {
    error: {
      code: SETTLEMENT_PROOF_NOT_OFFERED,
      message: SETTLEMENT_PROOF_NOT_OFFERED_MESSAGE,
    },
  };
}

/** Express middleware. Mount before any payment, quote or 402 handling. */
export function refuseSettlementProofWhenOff(req, res, next) {
  if (settlementProofEnabled() || !requestsSettlementProof(req.body)) return next();
  return res.status(400).json(settlementProofRefusalBody());
}
