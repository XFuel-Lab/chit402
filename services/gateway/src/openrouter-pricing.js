/**
 * OpenRouter quotes.
 *
 * Default is bring-your-own-key. The caller pays OpenRouter. Chit charges
 * only the standard $0.002 receipt — no upstream COGS, no route margin.
 *
 * House-key resale (our key, cost-plus) is a separate quote, used only when
 * `OPENROUTER_HOUSE_RESALE_ENABLED` is on and the caller did not bring a key:
 *
 *   quote = upstream per-token cost (output at max_tokens, capped)
 *         + 1% route margin (fee_bps = 100)
 *         + the standard $0.002 receipt
 *
 * That receipt is added. It is not a floor that can replace a larger upstream
 * cost. The amount is never below upstream cost.
 */

import { quoteFromCogs, STAMP_FEE_UNITS } from './pricing.js';

/** Hard ceiling on output tokens used for the upfront x402 quote and the call. */
export const OPENROUTER_MAX_OUTPUT_TOKENS = 8192;

/** Standard receipt, USDC base units (6 decimals). $0.002. */
export const OPENROUTER_RECEIPT_UNITS = BigInt(STAMP_FEE_UNITS);

/**
 * Receipt label for a cost the caller paid OpenRouter. Not a Chit COGS figure.
 * The signed `provider_cogs.actual` stays empty on this path.
 */
export const OPENROUTER_CALLER_PAID_LABEL = 'paid-by-caller-to-OpenRouter';

export function isOpenRouterCatalogId(id) {
  return typeof id === 'string' && id.startsWith('openrouter/');
}

/**
 * Bound output tokens so an exact-scheme quote cannot be unbounded.
 * Omitted or non-positive input keeps the adapter default (500), still under the cap.
 * @param {number} [requested]
 * @returns {number}
 */
export function capOpenRouterOutputTokens(requested) {
  const fromEnv = parseInt(process.env.OPENROUTER_MAX_TOKENS_CAP, 10);
  const cap = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : OPENROUTER_MAX_OUTPUT_TOKENS;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return Math.min(500, cap);
  return Math.min(Math.trunc(n), cap);
}

/**
 * @param {bigint|number|string} cogsBaseUnits upstream cost in USDC base units
 * @param {object} [cfg] forwarded to quoteFromCogs (fee bps, tier-2). Floor is not applied.
 * @returns {object} cost-plus quote plus `receipt_fee`
 */
export function quoteOpenRouterFromCogs(cogsBaseUnits, cfg = {}) {
  const base = quoteFromCogs(cogsBaseUnits, {
    platformFeeBps: cfg.platformFeeBps,
    tier2: cfg.tier2,
    tier2ProofUnits: cfg.tier2ProofUnits,
    // Receipt is additive. A floor here would hide the three-part bill and,
    // if it were ever below COGS, would underquote the hub.
    usdcFloor: 0,
  });
  const cogs = BigInt(base.provider_cogs);
  const fee = BigInt(base.platform_fee);
  const proof = BigInt(base.tier2_proof || '0');
  const receipt = OPENROUTER_RECEIPT_UNITS;
  let amount = cogs + fee + receipt + proof;
  if (amount < cogs) amount = cogs;
  return {
    ...base,
    amount: String(amount),
    receipt_fee: String(receipt),
    floor_applied: false,
    basis: 'cost_plus',
  };
}

/**
 * BYOK quote: the $0.002 receipt only. Inference is not ours to sell.
 * @returns {object}
 */
export function quoteOpenRouterByok() {
  const receipt = OPENROUTER_RECEIPT_UNITS;
  return {
    amount: String(receipt),
    basis: 'byok_receipt',
    fee_bps: 0,
    provider_cogs: '0',
    platform_fee: '0',
    tier2_proof: '0',
    receipt_fee: String(receipt),
    floor_applied: false,
    paid_by: 'caller-to-openrouter',
    label: OPENROUTER_CALLER_PAID_LABEL,
  };
}
