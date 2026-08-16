/**
 * Provider Float Manager v0 — prepaid COGS inventory (ADR 0005).
 *
 * Buyer rail stays USDC/x402 on Base. Provider COGS burn against env-backed
 * floats (Theta USDC-preferred, AkashML ACT/USDC, Web2 credits). No hot-path FX.
 *
 * See docs/PROVIDER_FLOAT_TREASURY.md · docs/STRATEGY.md · ADR 0005.
 *
 * Env:
 *   PROVIDER_FLOATS_JSON={"theta-edgecloud":{"asset":"USDC","balance":"1000000","low_water":"100000","enabled":true},"akash-network":{"asset":"USDC","balance":"500000","low_water":"50000","enabled":true}}
 *   PROVIDER_COGS_BPS=7000   // FALLBACK ONLY — estimated COGS as bps of the USDC
 *                            // quote. Circular (a share of our own price, not of
 *                            // the work) and measured 1.65x–5.6x high. Both live
 *                            // hubs publish per-token rates, so this now applies
 *                            // only to a provider that publishes none, or when
 *                            // the catalog poll fails; see provider-rates.js.
 *   PROVIDER_FLOAT_DEFAULT=theta-edgecloud
 *   PROVIDER_FLOAT_ENFORCE=true  // when true, reject if no float can cover COGS
 */

import logger from './logger.js';

const DEFAULT_COGS_BPS = 7000;
const FLOATS_BPS_DENOM = 10000n;

/**
 * Map router / adapter source tags onto float ids used in PROVIDER_FLOATS_JSON.
 * @param {string|null|undefined} source
 * @returns {string|null}
 */
export function normalizeProviderId(source) {
  if (source == null || source === '') return null;
  const s = String(source).toLowerCase().trim();
  if (
    s === 'theta-edgecloud' || s === 'edgecloud' || s === 'theta'
    || s.startsWith('theta-edgecloud') || s.startsWith('theta-edge')
  ) {
    return 'theta-edgecloud';
  }
  if (
    s === 'akash-network' || s === 'akash' || s === 'akashml'
    || s.includes('akash')
  ) {
    return 'akash-network';
  }
  return String(source).trim();
}

/** @typedef {{ id: string, asset: string, balance: bigint, low_water: bigint, enabled: boolean }} Float */

function parseAmount(v, fallback = 0n) {
  if (v == null || v === '') return fallback;
  try {
    return BigInt(String(v).trim());
  } catch {
    return fallback;
  }
}

/**
 * Parse PROVIDER_FLOATS_JSON into a Map of mutable floats.
 * @param {string|null|undefined} raw
 * @returns {Map<string, Float>}
 */
export function parseFloatsJson(raw) {
  const map = new Map();
  if (!raw || !String(raw).trim()) return map;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err: err.message }, 'PROVIDER_FLOATS_JSON parse failed — no floats loaded');
    return map;
  }
  if (!obj || typeof obj !== 'object') return map;
  for (const [id, row] of Object.entries(obj)) {
    if (!row || typeof row !== 'object') continue;
    map.set(id, {
      id,
      asset: String(row.asset || 'USDC').toUpperCase(),
      balance: parseAmount(row.balance, 0n),
      low_water: parseAmount(row.low_water, 0n),
      enabled: row.enabled !== false,
    });
  }
  return map;
}

/**
 * Estimated provider COGS in the float's smallest units (USDC 6dp when asset=USDC).
 * @param {string|bigint|number} usdcQuoteAmount
 * @param {number} [cogsBps]
 */
export function estimateCogs(usdcQuoteAmount, cogsBps = DEFAULT_COGS_BPS) {
  const gross = parseAmount(usdcQuoteAmount, 0n);
  const bps = BigInt(Math.min(Math.max(Number(cogsBps) || DEFAULT_COGS_BPS, 0), Number(FLOATS_BPS_DENOM)));
  return (gross * bps) / FLOATS_BPS_DENOM;
}

export class ProviderFloatManager {
  /**
   * @param {object} [opts]
   * @param {string} [opts.floatsJson]
   * @param {number} [opts.cogsBps]
   * @param {string} [opts.defaultProvider]
   * @param {boolean} [opts.enforce]
   */
  constructor({
    floatsJson = process.env.PROVIDER_FLOATS_JSON,
    cogsBps = parseInt(process.env.PROVIDER_COGS_BPS, 10) || DEFAULT_COGS_BPS,
    defaultProvider = process.env.PROVIDER_FLOAT_DEFAULT || 'theta-edgecloud',
    enforce = process.env.PROVIDER_FLOAT_ENFORCE === 'true',
  } = {}) {
    this.floats = parseFloatsJson(floatsJson);
    this.cogsBps = cogsBps;
    this.defaultProvider = defaultProvider;
    this.enforce = enforce;
  }

  /** Whether any float is configured. */
  hasFloats() {
    return this.floats.size > 0;
  }

  list() {
    return [...this.floats.values()].map((f) => ({ ...f, balance: f.balance.toString(), low_water: f.low_water.toString() }));
  }

  get(id) {
    return this.floats.get(id) || null;
  }

  /**
   * Public-safe summary for /health and /task-quote (no secrets).
   */
  publicSummary() {
    const floats = this.list().map((f) => ({
      id: f.id,
      asset: f.asset,
      enabled: f.enabled,
      balance_ok: BigInt(f.balance) > 0n,
      above_low_water: BigInt(f.balance) > BigInt(f.low_water),
      // Expose balance only when explicitly allowed (ops dashboards).
      ...(process.env.PROVIDER_FLOAT_PUBLIC_BALANCES === 'true'
        ? { balance: f.balance, low_water: f.low_water }
        : {}),
    }));
    return {
      model: 'prepaid-float-cogs',
      adr: '0005',
      enforce: this.enforce,
      cogs_bps: this.cogsBps,
      default_provider: this.defaultProvider,
      floats,
      note: 'Buyer pays USDC on Base; provider COGS burn prepaid floats (no hot-path FX).',
    };
  }

  /**
   * Pick a float that can cover estimated COGS.
   * @param {string|bigint} usdcQuoteAmount
   * @param {string|null} [preferredProvider]
   * @param {{ estimatedCogs?: bigint|string|null }} [opts]
   *   When `estimatedCogs` is set (provider's published rate × tokens), that is
   *   the float check — not 70% of our own price, which under cost-plus is ~0.77×
   *   real COGS and would under-reserve.
   * @returns {{ ok: true, float: Float, estimated: bigint } | { ok: false, reason: string, estimated: bigint }}
   */
  selectForQuote(usdcQuoteAmount, preferredProvider = null, { estimatedCogs = null } = {}) {
    const estimated = estimatedCogs != null && estimatedCogs !== ''
      ? parseAmount(estimatedCogs, 0n)
      : estimateCogs(usdcQuoteAmount, this.cogsBps);
    if (!this.hasFloats()) {
      // No floats configured → allow (P0 manual / unconstrained demo).
      return { ok: true, float: null, estimated, unconstrained: true };
    }

    const order = [];
    const pref = preferredProvider || this.defaultProvider;
    if (pref && this.floats.has(pref)) order.push(pref);
    for (const id of this.floats.keys()) {
      if (!order.includes(id)) order.push(id);
    }

    for (const id of order) {
      const f = this.floats.get(id);
      if (!f?.enabled) continue;
      if (f.balance >= estimated) {
        return { ok: true, float: f, estimated };
      }
    }

    if (!this.enforce) {
      logger.warn(
        { estimated: estimated.toString(), preferred: pref },
        'No float covers COGS — PROVIDER_FLOAT_ENFORCE=false, allowing',
      );
      return { ok: true, float: this.floats.get(pref) || null, estimated, soft: true };
    }

    return { ok: false, reason: 'provider_float_exhausted', estimated };
  }

  /**
   * Burn estimated COGS from a float (call after payment accepted).
   * @param {string} floatId
   * @param {bigint|string} amount
   * @returns {{ burned: string, balance: string, below_low_water: boolean } | null}
   */
  burn(floatId, amount) {
    const f = this.floats.get(floatId);
    if (!f) return null;
    const amt = parseAmount(amount, 0n);
    if (amt <= 0n) {
      return { burned: '0', balance: f.balance.toString(), below_low_water: f.balance <= f.low_water };
    }
    if (f.balance < amt) {
      if (this.enforce) {
        throw new Error(`float ${floatId} insufficient: have ${f.balance} need ${amt}`);
      }
      // Soft: drain to zero
      const burned = f.balance;
      f.balance = 0n;
      logger.warn({ floatId, burned: burned.toString() }, 'Float drained (soft enforce)');
      return { burned: burned.toString(), balance: '0', below_low_water: true };
    }
    f.balance -= amt;
    const below = f.balance <= f.low_water;
    if (below) {
      logger.warn(
        { floatId, balance: f.balance.toString(), low_water: f.low_water.toString() },
        'Provider float at or below low_water — refill from treasury',
      );
    }
    return { burned: amt.toString(), balance: f.balance.toString(), below_low_water: below };
  }

  /**
   * Build receipt/meta provider_cogs block after a successful select+burn.
   */
  buildCogsRecord({ provider, float, estimated, actual, burnResult, basis = 'estimated' }) {
    if (!float && !provider) return null;
    const asset = float?.asset || 'USDC';
    const act = actual != null ? parseAmount(actual, estimated).toString() : estimated.toString();
    return {
      provider: provider || float?.id || null,
      float_id: float?.id || null,
      currency: asset,
      estimated: estimated.toString(),
      actual: act,
      // 'measured' → real tokens × the provider's published per-token rate.
      // 'estimated' → the bps fallback, which is a guess about our own price
      // rather than about the work. Label it so nobody reads one as the other.
      basis,
      // USD mark: when asset is USDC, same as actual; otherwise ops fill later.
      usd_mark: asset === 'USDC' ? act : null,
      below_low_water: !!burnResult?.below_low_water,
    };
  }

  /**
   * Burn COGS against the provider that actually served (post-inference).
   * Preferred id is only a fallback when the result has no provider tag.
   *
   * @param {object} opts
   * @param {string|null} [opts.preferredProvider]
   * @param {string|null} [opts.actualProvider]  result.provider / routedTo / hub adapter id
   * @param {bigint|string|number} opts.estimated
   * @param {bigint|string|null} [opts.measured]  real cost from tokens × published rate
   *   (see provider-rates.js). When present this is what burns — the estimate is a
   *   percentage of our own price and was measured 1.65x–5.6x too high.
   * @returns {{ provider: string|null, record: object|null, burnResult: object|null }}
   */
  reconcileAfterServe({ preferredProvider = null, actualProvider = null, estimated, measured = null }) {
    const est = parseAmount(estimated, 0n);
    const providerId =
      normalizeProviderId(actualProvider)
      || normalizeProviderId(preferredProvider)
      || normalizeProviderId(this.defaultProvider);

    if (!providerId) {
      return { provider: null, record: null, burnResult: null };
    }

    const float = this.floats.get(providerId) || null;
    const hasMeasured = measured !== null && measured !== undefined;
    const toBurn = hasMeasured ? parseAmount(measured, est) : est;

    let burnResult = null;
    if (float && toBurn > 0n) {
      burnResult = this.burn(providerId, toBurn);
    }

    const record = this.buildCogsRecord({
      provider: providerId,
      float,
      estimated: est,
      actual: burnResult?.burned || toBurn,
      burnResult,
      basis: hasMeasured ? 'measured' : 'estimated',
    });
    return { provider: providerId, record, burnResult };
  }
}

let _singleton = null;

/**
 * Process-wide float manager. First call may pass opts (from config);
 * later calls reuse the same instance so burns persist for the process lifetime.
 */
export function getFloatManager(opts) {
  if (!_singleton) {
    _singleton = new ProviderFloatManager(opts);
  }
  return _singleton;
}

/** Force a fresh manager (tests or hot-reload of PROVIDER_FLOATS_JSON). */
export function resetFloatManager(opts) {
  _singleton = new ProviderFloatManager(opts);
  return _singleton;
}

/** Test helper — clear singleton. */
export function resetFloatManagerForTests() {
  _singleton = null;
}
