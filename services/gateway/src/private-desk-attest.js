/**
 * Private Desk + Private + Attest product wiring (Phase 1–2).
 * See docs/adr/0010-private-desk-attest.md and docs/PRIVATE_SPEND_THESIS.md.
 */

import { proveAllowedForKey } from './prove-gate.js';

export const PRIVACY_PRODUCT_DESK = 'private_desk';
export const PRIVACY_PRODUCT_ATTEST = 'private_attest';

const VALID_PRODUCTS = new Set([PRIVACY_PRODUCT_DESK, PRIVACY_PRODUCT_ATTEST]);

/**
 * @param {object} body request JSON body
 * @returns {'private_desk'|'private_attest'|null}
 */
export function parsePrivacyProduct(body = {}) {
  const raw = body?.xfuel?.privacy_product
    ?? body?.xfuel?.privacyProduct
    ?? body?.privacy_product
    ?? body?.privacy?.product
    ?? null;
  if (raw == null || raw === '') return null;
  const norm = String(raw).trim().toLowerCase();
  if (!VALID_PRODUCTS.has(norm)) return null;
  return norm;
}

/** Human chrome for verify_url / receipts. */
export function privacyProductLabel(product) {
  if (product === PRIVACY_PRODUCT_ATTEST) return 'Private + Attest';
  if (product === PRIVACY_PRODUCT_DESK) return 'Private Desk';
  return null;
}

/**
 * Resolve vendor-blind Private Desk context for a paid hop.
 *
 * @param {object} req
 * @param {{ enabled?: boolean }} privateSpendCfg
 * @param {(req: object) => boolean} isPrivateSpendSession
 * @returns {{
 *   product: 'private_desk'|'private_attest'|null,
 *   privateSpend: boolean,
 *   privateAttest: boolean,
 * }}
 */
export function resolvePrivateSpendContext(req, { privateSpendCfg, isPrivateSpendSession }) {
  const parsed = parsePrivacyProduct(req?.body || {});
  const sessionOrFlag = !!privateSpendCfg?.enabled || !!isPrivateSpendSession(req);

  if (parsed === PRIVACY_PRODUCT_ATTEST) {
    return {
      product: PRIVACY_PRODUCT_ATTEST,
      privateSpend: true,
      privateAttest: true,
    };
  }
  if (parsed === PRIVACY_PRODUCT_DESK) {
    return {
      product: PRIVACY_PRODUCT_DESK,
      privateSpend: true,
      privateAttest: false,
    };
  }
  if (sessionOrFlag) {
    return {
      product: PRIVACY_PRODUCT_DESK,
      privateSpend: true,
      privateAttest: false,
    };
  }
  return { product: null, privateSpend: false, privateAttest: false };
}

/** Ensure x402 quotes include the Tier-2 flat when Attest is requested. */
export function bodyForPrivacyPricing(body = {}, privacyCtx) {
  if (!privacyCtx?.privateAttest) return body;
  const proofTier = body?.proof_tier ?? body?.proofTier ?? body?.xfuel?.proof_tier ?? null;
  if (proofTier) return body;
  return {
    ...body,
    proof_tier: 'settlement',
    xfuel: { ...(body.xfuel || {}), proof_tier: 'settlement' },
  };
}

/**
 * Fail closed before serving Attest when the prover cannot run.
 * @returns {null | { status: number, code: string, message: string }}
 */
export function attestPreflightError(privacyCtx, { proverConfigured, apiKey }) {
  if (!privacyCtx?.privateAttest) return null;
  if (!proverConfigured) {
    return {
      status: 503,
      code: 'attest_prover_unavailable',
      message: 'Private + Attest requires Tier-2 SP1 proving, but the prover is not configured. '
        + 'Retry as Private Desk (Tier-1 receipt only) or try again when proving is available.',
    };
  }
  if (!proveAllowedForKey(apiKey)) {
    return {
      status: 403,
      code: 'attest_prover_gated',
      message: 'Private + Attest proving is not enabled for this API key. '
        + 'Use Private Desk or an allow-listed key for Attest.',
    };
  }
  return null;
}

/**
 * After inference, block a successful Attest response without in-proof binding.
 * @returns {null | { status: number, code: string, message: string }}
 */
export function attestProofGateError(task, privacyCtx) {
  if (!privacyCtx?.privateAttest) return null;
  const binding = task?.sp1Proof?.paymentBinding;
  const hasProof = !!(task?.sp1Proof?.proof && !task?.sp1Proof?.error);
  if (!hasProof || !binding?.in_proof) {
    return {
      status: 503,
      code: 'attest_proof_incomplete',
      message: 'Private + Attest could not produce a Tier-2 SP1 proof with payment_binding.in_proof. '
        + 'No successful Attest receipt was issued.',
    };
  }
  return null;
}
