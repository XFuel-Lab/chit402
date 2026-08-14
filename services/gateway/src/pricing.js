/**
 * Request-aware task pricing.
 *
 * A flat price cannot work here. A median production agent call carries ~68,000
 * input tokens against a ~750-token chat prompt, so one price for both either
 * loses money on the agent or gouges the ping. Measured against AkashML's rate,
 * the old flat $0.01 returned about $0.00006 of contribution on a median agent
 * call and lost money outright on a heavy one. See docs/KNOWN_ISSUES.md.
 *
 * The model here is a **rate card we own**, not a markup on our cost. Cost per
 * task in this market falls ~5-10x a year; a cost-plus price would deflate with
 * it, so the card is set independently and repriced deliberately.
 *
 * **`quoteFromCogs` deliberately reverses that**, behind `X402_COST_PLUS`. The
 * rate card wins on deflation and loses on everything else: it sells at ~2.1x
 * COGS on the one number every buyer compares, it needs a per-model row for a
 * catalogue spanning 38x, and a buyer cannot check it. Cost-plus is a ~47% price
 * cut, needs no rows at all, and is the only shape our own receipt can prove —
 * `provider_cogs.actual` is already signed, so a stated percentage of it makes
 * the whole bill auditable from the receipt. Both live here on purpose; see
 * ADR 0009 for the decision and the deflation exposure it accepts.
 *
 * Two protections:
 *   - a **floor**, because settlement itself costs money (the x402 facilitator
 *     charges per settlement, so a sub-floor call nets negative however cheap
 *     the tokens were), and
 *   - a **ceiling quote**: the x402 `exact` scheme needs a price before the work
 *     runs, so output is quoted at `max_tokens`. The `upto` scheme would let us
 *     settle actual usage instead and refund the difference.
 */

import logger from './logger.js';
import { estimateTokens, messagesToText } from './usage.js';

/** USDC has 6 decimals; rate-card entries are base units per 1,000,000 tokens. */
const PER_MILLION = 1_000_000;

/** $0.01. Below this a settled task cannot cover its own facilitator fee. */
export const DEFAULT_FLOOR_UNITS = 10_000;

/**
 * Retail rate card, base units per million tokens. Deliberately above COGS
 * (AkashML Llama 3.3 70B costs $0.13/$0.40 per million) and set so a median
 * agent call lands near $0.02 — the median priced x402 route.
 */
export const DEFAULT_RATE = { in: 300_000, out: 900_000 };

/**
 * Per-family rows for models the default row cannot cover.
 *
 * One retail price across the whole catalogue only works while the catalogue is
 * priced within one band, and it is not: AkashML spans $0.037/M to $1.40/M
 * input, a 38x range. Charging the default for GLM-5.2 lost $0.075 on every
 * median agent call — the model we route to by default was the single
 * loss-making row in the catalogue (`scripts/dev/_margin_check.mjs`).
 *
 * This is not cost-plus. The card is still ours and does not track COGS as it
 * drifts; tiers exist because a frontier-class model is a different product from
 * a small one, not because we recompute a markup.
 *
 * Only models whose COGS we have actually measured appear here. Both hubs serve
 * GLM-5.2 and both are dear: $0.096 on AkashML, $0.106 on Theta, against $0.021
 * for everything else.
 *
 * Agent-shaped `xfuel/auto` requests resolve to `akash/zai-org/GLM-5.2`, so this
 * row prices the default agent route — the difference between charging for the
 * model we serve and losing $0.075 on every median agent call. Short completions
 * resolve to Llama and stay on the default row. See docs/MODEL_QUALITY_EVAL.md.
 *
 * **These rows only bite if the caller is priced on the *resolved* id.** `quoteTask`
 * matches `model_id` verbatim and `xfuel/auto` matches nothing here, so the alias
 * has to be resolved before pricing — `resolvePricingModel` in x402-server.js.
 * Skipping that step quoted every alias request at the default rate and put the
 * default agent route back 4.7x underwater.
 */
export const DEFAULT_RATE_CARD = Object.freeze({
  'zai-org/GLM-5.2': { in: 3_000_000, out: 9_000_000 },
  'theta/glm_5_2': { in: 3_000_000, out: 9_000_000 },
});

/** Hub prefixes the catalog adds, stripped before matching so one row covers both spellings. */
const HUB_PREFIXES = ['akash/', 'theta/', 'xfuel/'];

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const positive = (v) => (Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Resolve the rate for a model. Longest-prefix match, so `akash/` can be priced
 * as a family without listing every model.
 * @returns {{in:number,out:number}}
 */
export function rateCardFor(model, cfg = {}) {
  const card = { ...(parseJsonEnv('X402_USDC_RATE_CARD') || {}), ...(cfg.rateCard || {}) };
  const fallback = {
    in: positive(card.default?.in) ?? DEFAULT_RATE.in,
    out: positive(card.default?.out) ?? DEFAULT_RATE.out,
  };
  if (!model) return fallback;

  // Match the id as given and with the hub prefix removed, so a row keyed on the
  // native id also prices the catalog id (`akash/zai-org/GLM-5.2`).
  const raw = String(model);
  const hub = HUB_PREFIXES.find((p) => raw.startsWith(p));
  const candidates = hub ? [raw, raw.slice(hub.length)] : [raw];

  const longestMatch = (rows) => {
    let best = null;
    for (const k of Object.keys(rows)) {
      if (k === 'default') continue;
      if (candidates.some((key) => key === k || key.startsWith(`${k}/`))) {
        if (!best || k.length > best.length) best = k;
      }
    }
    return best;
  };

  // A configured row always wins, however specific a built-in row looks — the
  // built-ins are a floor against selling a known-dear model at the cheap rate,
  // not an override of what the operator asked for.
  const source = longestMatch(card) ? card : DEFAULT_RATE_CARD;
  const best = longestMatch(source);
  if (!best) return fallback;
  return {
    in: positive(source[best]?.in) ?? fallback.in,
    out: positive(source[best]?.out) ?? fallback.out,
  };
}

/** Prompt token count for a request, from messages or a raw prompt. */
export function promptTokensFor(body = {}) {
  if (Array.isArray(body.messages) && body.messages.length) {
    return estimateTokens(messagesToText(body.messages));
  }
  const prompt = body.input ?? body.prompt ?? null;
  return prompt ? estimateTokens(String(prompt)) : 0;
}

/**
 * Quote a task in USDC base units.
 *
 * @param {object} body request body (`model_id`, `messages`/`prompt`, `max_tokens`)
 * @param {object} [cfg]
 * @param {Object<string,string>} [cfg.usdcPrices] explicit per-model flat prices — when a
 *   model is listed here that price wins, so a hand-negotiated rate stays hand-negotiated
 * @param {string|number} [cfg.usdcFloor] override the floor
 * @param {Object} [cfg.rateCard]
 * @returns {{amount:string, basis:'model_price'|'metered', floor_applied:boolean,
 *   prompt_tokens:number, max_output_tokens:number, rate:{in:number,out:number}}}
 */
export function quoteTask(body = {}, cfg = {}) {
  const model = body.model_id || body.model || null;
  const floor = Math.max(0, Number(cfg.usdcFloor ?? process.env.X402_USDC_FLOOR ?? DEFAULT_FLOOR_UNITS) || 0);

  const explicit = model && cfg.usdcPrices && cfg.usdcPrices[model] != null
    ? cfg.usdcPrices[model]
    : null;
  if (explicit != null) {
    return {
      amount: String(explicit),
      basis: 'model_price',
      floor_applied: false,
      prompt_tokens: 0,
      max_output_tokens: 0,
      rate: rateCardFor(model, cfg),
    };
  }

  const rate = rateCardFor(model, cfg);
  const promptTokens = promptTokensFor(body);
  // No prompt to measure (a bare compute bid, or a privacy-mode request carrying
  // only an input hash) — there is nothing to meter, so the floor is the price.
  const maxOutput = Math.max(0, Number(body.max_tokens ?? body.maxTokens ?? 0) || 0);

  const metered = Math.ceil((promptTokens * rate.in) / PER_MILLION)
    + Math.ceil((maxOutput * rate.out) / PER_MILLION);
  const amount = Math.max(floor, metered);

  return {
    amount: String(amount),
    basis: 'metered',
    floor_applied: amount === floor && metered < floor,
    prompt_tokens: promptTokens,
    max_output_tokens: maxOutput,
    rate,
  };
}

/**
 * Price an inference that has already run, from its measured usage.
 *
 * `quoteTask` has to guess output before the work runs, so it quotes `max_tokens`
 * and overcharges whenever a completion stops short — measured at up to 3.8x on
 * agent traffic, since agents ask for a large ceiling and use a fraction of it.
 * This function has no such problem: it prices what the provider actually billed.
 *
 * The catch is ordering, not arithmetic. An exact price that only exists *after*
 * the work is done cannot be put in a 402 challenge for that same work, which is
 * why this is only usable under rolling settlement (ADR 0008) — the charge lands
 * on the caller's next request.
 *
 * The floor still applies: settlement costs a facilitator fee per payment, so a
 * sub-floor charge nets negative however small the call was.
 *
 * @param {{prompt_tokens?:number, completion_tokens?:number}} usage from `normalizeUsage`
 * @param {string|null} model resolved model id — must be the model that served,
 *   not the alias the caller asked for, or a GLM call prices as Llama
 * @param {object} [cfg] same shape as `quoteTask`'s cfg
 * @returns {{amount:string, basis:'measured', floor_applied:boolean,
 *   prompt_tokens:number, completion_tokens:number, rate:{in:number,out:number}}}
 */
export function quoteUsage(usage = {}, model = null, cfg = {}) {
  const rate = rateCardFor(model, cfg);
  const floor = Math.max(0, Number(cfg.usdcFloor ?? process.env.X402_USDC_FLOOR ?? DEFAULT_FLOOR_UNITS) || 0);

  const inTokens = Math.max(0, Number(usage.prompt_tokens) || 0);
  // Providers fold reasoning tokens into `completion_tokens`, so adding
  // `reasoning_tokens` on top would double-bill every reasoning model.
  const outTokens = Math.max(0, Number(usage.completion_tokens) || 0);

  const metered = Math.ceil((inTokens * rate.in) / PER_MILLION)
    + Math.ceil((outTokens * rate.out) / PER_MILLION);
  const amount = Math.max(floor, metered);

  return {
    amount: String(amount),
    basis: 'measured',
    floor_applied: amount === floor && metered < floor,
    prompt_tokens: inTokens,
    completion_tokens: outTokens,
    rate,
  };
}

/** Platform fee on measured provider cost, in basis points. 1000 = 10%. */
export const DEFAULT_PLATFORM_FEE_BPS = 1000;

/**
 * Is cost-plus pricing on? Off unless explicitly enabled.
 *
 * Off by default because switching pricing models is a commercial decision, not
 * a deploy — the same reason `X402_METER_V1` ships off.
 */
export function costPlusEnabled() {
  return String(process.env.X402_COST_PLUS || '').toLowerCase() === 'true';
}

/**
 * Platform fee in basis points.
 *
 * Read per call rather than at module load so a test can change it without
 * re-importing. Unparseable input keeps the default and complains, because a
 * typo here misprices every call rather than failing loudly.
 */
export function platformFeeBps(cfg = {}) {
  const raw = cfg.platformFeeBps ?? process.env.X402_PLATFORM_FEE_BPS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_PLATFORM_FEE_BPS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { value: raw, using: DEFAULT_PLATFORM_FEE_BPS },
      'pricing: X402_PLATFORM_FEE_BPS is not a number; keeping the default fee',
    );
    return DEFAULT_PLATFORM_FEE_BPS;
  }
  return Math.round(n);
}

/**
 * Flat charge for an opt-in Tier-2 SP1 settlement proof. $0.08.
 *
 * Flat because the cost is flat: measured 2026-08-14, a Succinct request costs a
 * fixed 0.341064 PROVE (≈$0.050) whose *variable* component is $8.6 × 10⁻¹² — the
 * circuit is byte-identical whether the job was $0.01 or $1.00, so a percentage
 * would undercharge small jobs and overcharge large ones for the same work.
 *
 * $0.08 is 1.6x measured cost. The headroom is not margin greed, it is FX: proof
 * cost is denominated in PROVE, which sits at its all-time low, and this price
 * breaks even up to roughly PROVE $0.235. Above that it needs revisiting.
 *
 * It cannot be amortised down yet. AI-task proofs are unbatchable until Guest v2
 * (see docs/KNOWN_ISSUES.md), so every proof is one full-price request.
 */
export const DEFAULT_TIER2_PROOF_UNITS = 80_000;

/** Flat Tier-2 surcharge in base units. `0n` gives proofs away. */
export function tier2ProofUnits(cfg = {}) {
  const raw = cfg.tier2ProofUnits ?? process.env.X402_TIER2_PROOF_UNITS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return BigInt(DEFAULT_TIER2_PROOF_UNITS);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { value: raw, using: DEFAULT_TIER2_PROOF_UNITS },
      'pricing: X402_TIER2_PROOF_UNITS is not a number; keeping the default proof price',
    );
    return BigInt(DEFAULT_TIER2_PROOF_UNITS);
  }
  return BigInt(Math.trunc(n));
}

/** Accept the bigint `costOfUsage` returns, or a number/string from JSON. */
function toBaseUnits(v) {
  try {
    const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0));
    return n > 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Price a call as provider cost plus a stated percentage.
 *
 * Takes COGS as an argument rather than fetching it, because the measured figure
 * is async (`measureCogs` needs the live catalogue) and every caller that wants
 * this already has it — `quoteTask`/`quoteUsage` are sync and turning them async
 * would ripple into x402-server.js for no gain.
 *
 * Two properties worth stating, because they are the argument for the whole
 * model. The charge is **cost-proportional**, so the 3,257x spread between our
 * cheapest and dearest call stops mattering and no per-model row is needed. And
 * it is **verifiable**: the receipt already signs `provider_cogs.actual`, so a
 * buyer can recompute this number from the receipt instead of trusting a price
 * list. No competitor attests COGS, so none can offer that.
 *
 * The floor still applies, for the same reason it does everywhere else: a
 * settlement costs a facilitator fee, so 10% of a tenth of a cent nets negative.
 * On small calls the floor *is* the price and the percentage never binds.
 *
 * @param {bigint|number|string} cogsBaseUnits measured or estimated provider
 *   cost in USDC base units — from `costOfUsage` / `measureCogs`
 * @param {object} [cfg]
 * @param {number} [cfg.platformFeeBps] override the fee
 * @param {string|number} [cfg.usdcFloor] override the floor
 * @param {boolean} [cfg.tier2] caller opted into an SP1 settlement proof
 * @param {number} [cfg.tier2ProofUnits] override the proof price
 * @returns {{amount:string, basis:'cost_plus', fee_bps:number,
 *   provider_cogs:string, platform_fee:string, tier2_proof:string,
 *   floor_applied:boolean}}
 */
export function quoteFromCogs(cogsBaseUnits, cfg = {}) {
  const floorNum = Math.max(
    0,
    Number(cfg.usdcFloor ?? process.env.X402_USDC_FLOOR ?? DEFAULT_FLOOR_UNITS) || 0,
  );
  const floor = BigInt(Math.trunc(floorNum));
  const bps = BigInt(platformFeeBps(cfg));
  const cogs = toBaseUnits(cogsBaseUnits);

  // Round the fee up. Truncating means we absorb the rounding on every call,
  // and at a $0.01 floor most calls are small enough for that to be the whole
  // margin.
  const fee = (cogs * bps + 9_999n) / 10_000n;
  const metered = cogs + fee;
  const inference = metered < floor ? floor : metered;

  // Added *after* the floor, never absorbed by it. A floor-priced call that asks
  // for a proof would otherwise buy a $0.050 proof inside a $0.01 payment.
  const proof = cfg.tier2 ? tier2ProofUnits(cfg) : 0n;

  return {
    amount: String(inference + proof),
    basis: 'cost_plus',
    fee_bps: Number(bps),
    provider_cogs: String(cogs),
    platform_fee: String(fee),
    tier2_proof: String(proof),
    floor_applied: metered < floor,
  };
}

/**
 * Refuse to run a configuration that loses money on every call.
 *
 * Cost-plus and the Tier-2 thresholds are only safe together. `VI_TIER2_MIN_USDC`
 * defaults to 10000 — the same value as the price floor — so on the settled-amount
 * basis essentially every paid call sits at the settlement floor. Combined with a
 * 10% fee that is $0.0094 collected against a $0.050 proof: a loss on every call,
 * from two settings that each look reasonable alone.
 *
 * Called once at startup. Warns rather than throws, because refusing to boot over
 * a pricing combination would take the gateway down for a revenue bug — but it
 * warns at `error` level, because it *is* one.
 *
 * @param {object} vi config.verifiedInference
 */
export function checkPricingConfig(vi = {}) {
  if (!costPlusEnabled()) return { ok: true, warnings: [] };

  const warnings = [];
  const proofCost = 50_000n; // measured, base units
  const feeOnMedian = 9_400n; // 10% of a median agent call's COGS

  const usingCogsGate = String(vi.tier2MinCogs ?? '').trim() !== '';
  const settlementOn = vi.available?.settlement !== false;

  if (settlementOn && !usingCogsGate && vi.enabled) {
    warnings.push(
      'X402_COST_PLUS is on while VI_TIER2_MIN_COGS is unset, so Tier-2 is gated on the settled '
      + `amount (VI_TIER2_MIN_USDC=${vi.tier2Min}). A proof costs ~${usdOf(proofCost)} against `
      + `~${usdOf(feeOnMedian)} of fee on a median call. Set VI_TIER2_MIN_COGS (2000000 while `
      + 'AI-task proofs are unbatchable) or this loses money on every proved call.',
    );
  }

  if (tier2ProofUnits() > 0n && tier2ProofUnits() < proofCost) {
    warnings.push(
      `X402_TIER2_PROOF_UNITS is ${usdOf(tier2ProofUnits())}, below the ~${usdOf(proofCost)} a `
      + 'Succinct request costs. Every opt-in proof is sold at a loss.',
    );
  }

  for (const w of warnings) logger.error({ pricing: 'cost_plus' }, w);
  return { ok: warnings.length === 0, warnings };
}

const usdOf = (units) => `$${(Number(units) / 1_000_000).toFixed(4)}`;

export default {
  quoteTask,
  quoteUsage,
  quoteFromCogs,
  costPlusEnabled,
  platformFeeBps,
  tier2ProofUnits,
  checkPricingConfig,
  rateCardFor,
  promptTokensFor,
  DEFAULT_RATE,
  DEFAULT_RATE_CARD,
  DEFAULT_FLOOR_UNITS,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_TIER2_PROOF_UNITS,
};
