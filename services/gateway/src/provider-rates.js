/**
 * What a provider actually charges us, per token.
 *
 * COGS used to be `gross × PROVIDER_COGS_BPS` — a flat 70% of *our own price*.
 * That is circular (raising our price raised our recorded cost), and measured
 * against real rates it was 1.65x to 5.6x too high. Float burns, receipt
 * `provider_cogs.actual`, and every margin figure inherited the error.
 *
 * Rates come from the live catalog rather than a constant: AkashML publishes
 * per-token prices on `/v1/models` and the table changes — cached-read rates
 * exist for some models and not others, and appeared on a model mid-research.
 * Anything hardcoded here would be wrong within a month.
 */

import { getHubCatalog } from './hub-catalog.js';
import logger from './logger.js';

/** USDC base units per whole USD (6dp). */
const USDC_SCALE = 1_000_000;

const numeric = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Per-token USD rates from a catalog row's `cost` block.
 *
 * AkashML uses the OpenAI-ish `{ input, output, input_cache_read }` shape with
 * decimal-string USD-per-token values. Theta uses its own integer-over-divisor
 * encoding — see `thetaRate`. Anything else returns null and the caller falls
 * back to the bps estimate rather than inventing a number.
 *
 * @param {object|null} catalogModel row from `getHubCatalog()`
 * @returns {{input:number, output:number, cachedInput:number|null}|null}
 */
export function rateForModel(catalogModel) {
  const cost = catalogModel?.cost;
  if (!cost || typeof cost !== 'object') return null;
  if (catalogModel.hub === 'theta') return thetaRate(cost);

  const input = numeric(cost.input ?? cost.input_per_token ?? cost.prompt);
  const output = numeric(cost.output ?? cost.output_per_token ?? cost.completion);
  if (input === null || output === null) return null;

  return {
    input,
    output,
    // Absent means the provider does not discount cached reads on this model —
    // not that reads are free. Keep it null so the caller bills them as fresh.
    cachedInput: numeric(cost.input_cache_read ?? cost.cache_read ?? cost.cached_input),
    // Flat per-call charge on top of tokens. Zero everywhere on AkashML today,
    // but the field exists, and a non-zero value would silently vanish from our
    // COGS on exactly the short calls where it hurts most.
    perRequest: numeric(cost.request ?? cost.per_request) ?? 0,
  };
}

/**
 * Theta's price, converted to the same USD-per-token basis as everyone else.
 *
 * Theta encodes price as an integer over `cost_divisor`, in the unit its
 * `instructions` field names. **The integers are US cents, and the API never
 * says so** — the currency is the one thing the self-describing metadata omits.
 * Two independent checks fix it: the diffusion models read `1` per image, which
 * is the $0.01/request Theta charges for the same models on RapidAPI, and GLM-5.2
 * reads `154`/`484` per 1M tokens against AkashML's $1.40/$4.40 for the identical
 * model — a 10% premium, not a 110x currency gap. TFUEL would be the natural
 * guess given Theta pays node rewards in it, and it is wrong.
 *
 * Per-image models return a flat `perRequest` and no token rate, which is why
 * `costOfUsage` has to handle a zero token rate rather than treating it as
 * missing data.
 */
function thetaRate(cost) {
  const CENTS_PER_USD = 100;
  const divisor = numeric(cost.cost_divisor) || 1;
  const input = numeric(cost.input);
  const output = numeric(cost.output);
  if (input === null || output === null) return null;

  const unit = String(cost.price_unit?.unit || '');
  if (!/token/i.test(unit)) {
    // Priced per artefact (image, video). `isPriceSplit` is false here and the
    // charge appears on whichever side is non-zero, so take the larger — summing
    // would double-charge ESRGAN, which carries 1 on both.
    return {
      input: 0,
      output: 0,
      cachedInput: null,
      perRequest: Math.max(input, output) / CENTS_PER_USD,
    };
  }

  return {
    input: input / CENTS_PER_USD / divisor,
    output: output / CENTS_PER_USD / divisor,
    // Theta publishes no cached-read rate on any service.
    cachedInput: null,
    perRequest: 0,
  };
}

/**
 * Cost of one inference in USDC base units.
 *
 * Cached prompt tokens are billed at the cached rate only when the provider
 * both reports them and publishes a rate. AkashML currently reports neither, so
 * in practice everything bills fresh — which is the honest, conservative
 * direction to be wrong in.
 *
 * @param {{prompt_tokens?:number, completion_tokens?:number, cached_prompt_tokens?:number|null}} usage
 * @param {{input:number, output:number, cachedInput:number|null}} rate
 * @returns {bigint} base units, rounded up — never under-report what we owe
 */
export function costOfUsage(usage, rate) {
  if (!usage || !rate) return 0n;
  const prompt = Math.max(0, Number(usage.prompt_tokens) || 0);
  const completion = Math.max(0, Number(usage.completion_tokens) || 0);

  const reportedCached = Number(usage.cached_prompt_tokens);
  const cached = rate.cachedInput !== null && Number.isFinite(reportedCached) && reportedCached > 0
    ? Math.min(reportedCached, prompt)
    : 0;
  const fresh = prompt - cached;

  const usd = fresh * rate.input
    + cached * (rate.cachedInput ?? rate.input)
    + completion * rate.output
    + (rate.perRequest || 0);

  return BigInt(Math.ceil(usd * USDC_SCALE));
}

/**
 * Look a model up in the live catalog by either the hub-prefixed id
 * (`akash/zai-org/GLM-5.2`) or the native alias.
 */
function findModel(models, modelId) {
  if (!modelId) return null;
  const id = String(modelId);
  return models.find((m) => m.id === id)
    || models.find((m) => m.alias === id)
    || models.find((m) => m.id === `akash/${id}`)
    || null;
}

/**
 * Measured COGS for a served inference.
 *
 * @param {object} opts
 * @param {string} opts.modelId  catalog id or native alias
 * @param {object} opts.usage    normalized usage (see usage.js)
 * @returns {Promise<{amount: bigint, basis: 'measured'|'no_rate'|'no_usage', rate: object|null}>}
 *   `measured` → billable from real tokens and published rates.
 *   Anything else → the caller should keep its bps estimate and say so.
 */
export async function measureCogs({ modelId, usage }) {
  if (!usage || !Number.isFinite(Number(usage.prompt_tokens))) {
    return { amount: 0n, basis: 'no_usage', rate: null };
  }
  let models = [];
  try {
    ({ models } = await getHubCatalog());
  } catch (err) {
    logger.warn({ err: err.message }, 'provider-rates: catalog unavailable, COGS falls back to estimate');
    return { amount: 0n, basis: 'no_rate', rate: null };
  }

  const rate = rateForModel(findModel(models, modelId));
  if (!rate) return { amount: 0n, basis: 'no_rate', rate: null };

  return { amount: costOfUsage(usage, rate), basis: 'measured', rate };
}

/**
 * Pre-inference COGS estimate, for the float capacity check at quote time.
 *
 * Still an estimate — output length is unknown until the model runs — but it is
 * an estimate of *the work*, priced at the provider's real rate, rather than a
 * percentage of what we charge. Output is bounded by `max_tokens`, matching how
 * the buyer's own quote is computed (see pricing.js).
 *
 * Returns the rate alongside the amount, matching `measureCogs`. Cost-plus
 * quotes publish the provider rate they were computed from, so a buyer can check
 * the arithmetic before paying rather than only auditing it afterwards.
 *
 * @returns {Promise<{amount: bigint, basis: 'estimated'|'no_rate', rate: object|null}>}
 */
export async function estimateCogsFromRequest({ modelId, promptTokens = 0, maxOutputTokens = 0 }) {
  let models = [];
  try {
    ({ models } = await getHubCatalog());
  } catch {
    return { amount: 0n, basis: 'no_rate', rate: null };
  }
  const rate = rateForModel(findModel(models, modelId));
  if (!rate) return { amount: 0n, basis: 'no_rate', rate: null };

  return {
    amount: costOfUsage(
      { prompt_tokens: promptTokens, completion_tokens: maxOutputTokens },
      rate,
    ),
    basis: 'estimated',
    rate,
  };
}

export default { rateForModel, costOfUsage, measureCogs, estimateCogsFromRequest };
