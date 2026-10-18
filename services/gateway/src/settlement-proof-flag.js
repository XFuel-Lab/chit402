/**
 * Server switch for the on-chain settlement proof add-on.
 *
 * SETTLEMENT_PROOF_ENABLED must be exactly the string 'true' to turn it on.
 * Unset, empty or any other value means off. Off means:
 *   - a request that asks for a settlement proof is refused before any quote,
 *     402 challenge, settle or receipt;
 *   - no settlement proof is requested from the prover;
 *   - payment_binding.in_proof is never set true.
 * Reopening is a config change and a restart.
 */
import { normalizeRequestedTier } from './tier-policy.js';

export const SETTLEMENT_PROOF_FLAG = 'SETTLEMENT_PROOF_ENABLED';
export const SETTLEMENT_PROOF_NOT_OFFERED = 'settlement_proof_not_offered';
export const SETTLEMENT_PROOF_NOT_OFFERED_MESSAGE = 'Tier-2 settlement proofs are temporarily unavailable.';

export function settlementProofEnabled(env = process.env) {
  return env?.[SETTLEMENT_PROOF_FLAG] === 'true';
}

/** Body asks for a settlement proof: proof_tier in any spelling we read, or Private + Attest. */
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
  return tiers.some((t) => t != null && normalizeRequestedTier(t)?.tier === 'settlement');
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
