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
 * Two protections:
 *   - a **floor**, because settlement itself costs money (the x402 facilitator
 *     charges per settlement, so a sub-floor call nets negative however cheap
 *     the tokens were), and
 *   - a **ceiling quote**: the x402 `exact` scheme needs a price before the work
 *     runs, so output is quoted at `max_tokens`. The `upto` scheme would let us
 *     settle actual usage instead and refund the difference.
 */

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

export default {
  quoteTask, quoteUsage, rateCardFor, promptTokensFor, DEFAULT_RATE, DEFAULT_RATE_CARD, DEFAULT_FLOOR_UNITS,
};
