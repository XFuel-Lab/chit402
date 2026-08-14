import logger from './logger.js';
import { quoteUsage, quoteTask } from './pricing.js';

/**
 * Rolling settlement — charge the previous call's *actual* cost on the next call.
 *
 * Why: the x402 `exact` scheme needs a price before the work runs, so `quoteTask`
 * quotes output at `max_tokens`. Agents ask for a big ceiling and use a fraction
 * of it, which overcharges by up to 3.8x on agent traffic (docs/KNOWN_ISSUES.md).
 * The protocol-level fix is the `upto` scheme, which needs x402 v1→v2 and Permit2
 * — a multi-day breaking migration (docs/X402_SCHEME_MIGRATION.md).
 *
 * This is the cheap fix for the same problem, and it needs no facilitator change
 * at all. Invert the order instead of changing the scheme: serve the call, measure
 * what it actually cost, and put that exact figure in the 402 on the caller's
 * *next* request. Every charge after the first is measured rather than estimated,
 * and `exact` is the right scheme for a figure that is already known.
 *
 * The price of the trick is bad debt: the last call before a caller goes away is
 * never paid. That is bounded at one call per payer and doubles as the free
 * allowance ADR 0006 already commits to, so it costs nothing we were not already
 * spending — but only if a single unpaid call cannot be large. A fresh payer whose
 * first request is a 200k-token job would otherwise be a free 200k-token job, so
 * a first call whose *ceiling* exceeds `X402_ROLLING_MAX_UNSETTLED_USD` is sent
 * down the ordinary prepay path instead. Rolling settlement for normal traffic,
 * prepay for whales.
 *
 * Scope and honesty, matching free-tier.js: in memory, per payer, single-process
 * by design (`instances: 1`). **A restart forgives every pending charge.** That is
 * acceptable for a subsidy guard and not acceptable for billing at volume, which
 * is why this is off by default and why the durable-ledger question is called out
 * in ADR 0008 rather than hidden.
 */

const USDC_SCALE = 1_000_000;

/** Default ceiling on a single unpaid call. A median agent call is ~$0.21. */
const DEFAULT_MAX_UNSETTLED_USD = 1;

/** @type {Map<string, { pending: null | PendingCharge, settled: number, forgiven: number }>} */
const ledger = new Map();

/** Bound the map when payer ids churn (key rotation, scans). */
const MAX_PAYERS = 10_000;

/**
 * @typedef {object} PendingCharge
 * @property {string} amount    USDC base units owed for the call already served
 * @property {string|null} taskId
 * @property {string|null} model resolved model that served it
 * @property {object} usage     measured usage the charge was computed from
 * @property {number} at        epoch ms the call was served
 * @property {number} attempts  failed settlement attempts so far
 */

/** Is rolling settlement on? Off unless explicitly enabled. */
export function rollingEnabled() {
  return String(process.env.X402_ROLLING_SETTLEMENT || '').toLowerCase() === 'true';
}

/**
 * Most we will front on one unpaid call, in USDC base units.
 *
 * Read per call so a test can change it without re-importing. `0` disables the
 * guard entirely, which means any first call is served free however large — an
 * explicit choice, not a default.
 */
export function maxUnsettledBaseUnits() {
  const raw = process.env.X402_ROLLING_MAX_UNSETTLED_USD;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return BigInt(DEFAULT_MAX_UNSETTLED_USD * USDC_SCALE);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { value: raw, using: DEFAULT_MAX_UNSETTLED_USD },
      'rolling-settlement: X402_ROLLING_MAX_UNSETTLED_USD is not a number; keeping the default',
    );
    return BigInt(DEFAULT_MAX_UNSETTLED_USD * USDC_SCALE);
  }
  return BigInt(Math.round(n * USDC_SCALE));
}

/**
 * Who owes for a call.
 *
 * Keyed on the API-key hash rather than the paying wallet, because the first call
 * of a session has no payment header and therefore no wallet to key on — the debt
 * has to be recorded against something that exists before any payment does.
 * A caller who rotates keys resets their one free call, which is the same
 * exposure the free tier already accepts.
 */
export function payerBucket(req, apiKeyHash) {
  if (apiKeyHash) return `key:${apiKeyHash}`;
  if (req?.ip) return `ip:${req.ip}`;
  return 'anon';
}

function readPayer(id) {
  const existing = ledger.get(id);
  if (existing) return existing;
  const fresh = { pending: null, settled: 0, forgiven: 0 };
  if (ledger.size >= MAX_PAYERS) prune();
  ledger.set(id, fresh);
  return fresh;
}

function prune() {
  // Drop payers with nothing outstanding first — they cost us nothing to forget.
  for (const [id, rec] of ledger) {
    if (!rec.pending) ledger.delete(id);
  }
  if (ledger.size >= MAX_PAYERS) {
    logger.warn({ size: ledger.size }, 'rolling-settlement: payer cap hit with all debts pending; clearing');
    ledger.clear();
  }
}

/** The charge this payer owes for their previous call, if any. */
export function getPending(payerId) {
  return ledger.get(payerId)?.pending || null;
}

/**
 * Record what a served call actually cost, to be collected next time.
 *
 * @param {string} payerId
 * @param {{usage:object, model:string|null, taskId?:string|null, cfg?:object}} call
 * @returns {PendingCharge}
 */
export function recordPending(payerId, { usage, model, taskId = null, cfg = {} } = {}) {
  const quote = quoteUsage(usage || {}, model, cfg);
  const rec = readPayer(payerId);
  // A payer should never have two pending charges: we refuse to serve while one
  // is outstanding, so reaching here with one already set means the caller served
  // work it should have gated. Keep the larger figure rather than lose the debt.
  if (rec.pending) {
    logger.warn(
      { payer: payerId, existing: rec.pending.amount, incoming: quote.amount },
      'rolling-settlement: second pending charge for one payer; keeping the larger',
    );
    if (BigInt(rec.pending.amount) >= BigInt(quote.amount)) return rec.pending;
  }
  rec.pending = {
    amount: quote.amount,
    taskId,
    model: model || null,
    usage: {
      prompt_tokens: quote.prompt_tokens,
      completion_tokens: quote.completion_tokens,
    },
    at: Date.now(),
    attempts: 0,
  };
  return rec.pending;
}

/** Payment for the outstanding charge landed. Clears the debt. */
export function markSettled(payerId) {
  const rec = ledger.get(payerId);
  if (!rec) return null;
  const cleared = rec.pending;
  rec.pending = null;
  rec.settled += 1;
  return cleared;
}

/**
 * Settlement failed. The debt stays, so the next request is challenged again —
 * matching ZAN's `failed → settled` retry path rather than forgiving on error.
 */
export function markSettleFailed(payerId, reason = null) {
  const rec = ledger.get(payerId);
  if (!rec?.pending) return null;
  rec.pending.attempts += 1;
  logger.warn(
    { payer: payerId, amount: rec.pending.amount, attempts: rec.pending.attempts, reason },
    'rolling-settlement: settlement failed; debt retained for the next request',
  );
  return rec.pending;
}

/**
 * What to do with an incoming request under rolling settlement.
 *
 * Pure given its inputs so the ordering rules can be tested without a ledger or
 * a facilitator.
 *
 * @param {{pending:PendingCharge|null, hasPayment:boolean, ceiling:bigint,
 *   maxUnsettled:bigint}} input
 * @returns {{action:'serve_free'|'prepay'|'settle_first'|'settle_then_serve',
 *   amount?:string, reason?:string}}
 *   - `serve_free`        nothing owed and the call is small enough to front
 *   - `prepay`            nothing owed but too large to front — use the ceiling quote
 *   - `settle_first`      a debt is owed and no payment came with this request → 402
 *   - `settle_then_serve` a debt is owed and payment is present → settle, then serve
 */
export function decideRolling({ pending, hasPayment, ceiling, maxUnsettled }) {
  if (pending) {
    return hasPayment
      ? { action: 'settle_then_serve', amount: pending.amount }
      : { action: 'settle_first', amount: pending.amount };
  }
  // A payment arriving with nothing outstanding is not an error — a client may
  // prepay, or a restart may have forgiven the debt it was paying. Take it.
  if (hasPayment) return { action: 'settle_then_serve', amount: '0' };
  if (maxUnsettled > 0n && ceiling > maxUnsettled) {
    return {
      action: 'prepay',
      reason: 'first_call_exceeds_unsettled_ceiling',
    };
  }
  return { action: 'serve_free' };
}

/**
 * Decide for a real request. Wraps `decideRolling` with the ledger lookup and the
 * ceiling estimate, which is only used to size the exposure of a *free* call.
 *
 * @param {{payerId:string, priceBody:object, hasPayment:boolean, cfg?:object}} input
 */
export function rollingDecision({ payerId, priceBody = {}, hasPayment = false, cfg = {} }) {
  const pending = getPending(payerId);
  const ceilingQuote = quoteTask(priceBody, cfg);
  return {
    ...decideRolling({
      pending,
      hasPayment,
      ceiling: BigInt(ceilingQuote.amount),
      maxUnsettled: maxUnsettledBaseUnits(),
    }),
    pending,
    ceiling: ceilingQuote.amount,
  };
}

/** Base units → plain USD, for logs and `/health`. */
export function usd(baseUnits) {
  return (Number(baseUnits) / USDC_SCALE).toFixed(6);
}

/**
 * Outstanding-debt snapshot for `/health`.
 *
 * `unsettled_usd` is money we have spent COGS on and not collected. It should sit
 * near (payers x one small call); a number that climbs is the signal that
 * settlement is failing rather than that traffic is growing.
 */
export function rollingStatus() {
  let unsettled = 0n;
  let owing = 0;
  let settled = 0;
  for (const rec of ledger.values()) {
    settled += rec.settled;
    if (!rec.pending) continue;
    owing += 1;
    unsettled += BigInt(rec.pending.amount);
  }
  return {
    enabled: rollingEnabled(),
    payers_tracked: ledger.size,
    payers_owing: owing,
    unsettled_usd: usd(unsettled),
    settled_calls: settled,
    max_unsettled_per_call_usd: usd(maxUnsettledBaseUnits()),
    note: rollingEnabled()
      ? 'Each call settles the previous call\'s measured cost. In-memory: a restart forgives pending charges.'
      : 'Disabled — every call is quoted up front at max_tokens (X402_ROLLING_SETTLEMENT=true to enable).',
  };
}

/** Tests / hot reload. */
export function resetRollingSettlement() {
  ledger.clear();
}

export default {
  rollingEnabled,
  maxUnsettledBaseUnits,
  payerBucket,
  getPending,
  recordPending,
  markSettled,
  markSettleFailed,
  decideRolling,
  rollingDecision,
  rollingStatus,
  resetRollingSettlement,
  usd,
};
