import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { quoteFromCogs } from './pricing.js';

/**
 * Rolling settlement — charge the previous call's *measured* cost-plus bill
 * on the next request (ADR 0008).
 *
 * x402 `exact` needs a number before the work runs. Quoting `max_tokens` overcharges
 * agents by up to 15x. Invert the order: serve, measure provider COGS, price with
 * `quoteFromCogs`, and put that figure in the next 402. `exact` is then the right
 * scheme because the amount is already known.
 *
 * Durable: one JSON file per payer (same single-process model as task-store.js).
 * A restart must not forgive an invoice. The flag stays off until persist is on.
 */

const USDC_SCALE = 1_000_000;

/** Default ceiling on a single unpaid call. A median agent call is ~$0.21. */
const DEFAULT_MAX_UNSETTLED_USD = 1;

/** @type {Map<string, { pending: null | PendingCharge, settled: number, forgiven: number }>} */
const ledger = new Map();

let persistDir = null;
let persistEnabled = false;

/** Bound the map when payer ids churn (key rotation, scans). */
const MAX_PAYERS = 10_000;

/**
 * @typedef {object} PendingCharge
 * @property {string} amount    USDC base units owed for the call already served
 * @property {string|null} taskId
 * @property {string|null} model resolved model that served it
 * @property {object} usage     measured usage the charge was computed from
 * @property {string} [provider_cogs]
 * @property {string} [platform_fee]
 * @property {number} [fee_bps]
 * @property {string} [tier2_proof]
 * @property {boolean} [floor_applied]
 * @property {string} [basis]
 * @property {number} at        epoch ms the call was served
 * @property {number} attempts  failed settlement attempts so far
 */

/** Is rolling settlement on? Off unless explicitly enabled. */
export function rollingEnabled() {
  return String(process.env.X402_ROLLING_SETTLEMENT || '').toLowerCase() === 'true';
}

/**
 * Point the ledger at a directory. `persist: false` keeps the in-memory map
 * (tests / ephemeral CI). Call once at boot from createApp.
 */
export function configureRollingLedger({ dir = null, persist = false } = {}) {
  persistDir = persist && dir ? String(dir) : null;
  persistEnabled = !!persistDir;
  if (persistEnabled) {
    try {
      fs.mkdirSync(persistDir, { recursive: true });
    } catch (err) {
      logger.warn({ err: err.message, dir: persistDir }, 'rolling-settlement: mkdir failed; persistence disabled');
      persistEnabled = false;
      persistDir = null;
    }
  }
}

function payerFile(id) {
  return path.join(persistDir, `${encodeURIComponent(id)}.json`);
}

function persistPayer(id, rec) {
  if (!persistEnabled || !rec) return;
  try {
    const target = payerFile(id);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(rec));
    fs.renameSync(tmp, target);
  } catch (err) {
    logger.warn({ err: err.message, payer: id }, 'rolling-settlement: persist failed');
  }
}

function loadPayer(id) {
  if (!persistEnabled) return null;
  try {
    return JSON.parse(fs.readFileSync(payerFile(id), 'utf8'));
  } catch {
    return null;
  }
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
  const fromDisk = loadPayer(id);
  if (fromDisk) {
    ledger.set(id, fromDisk);
    return fromDisk;
  }
  const fresh = { pending: null, settled: 0, forgiven: 0 };
  if (ledger.size >= MAX_PAYERS) prune();
  ledger.set(id, fresh);
  return fresh;
}

function prune() {
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
  const existing = ledger.get(payerId);
  if (existing) return existing.pending || null;
  const fromDisk = loadPayer(payerId);
  if (fromDisk) {
    ledger.set(payerId, fromDisk);
    return fromDisk.pending || null;
  }
  return null;
}

/**
 * Record what a served call actually cost, to be collected next time.
 *
 * Prices with `quoteFromCogs` on measured provider COGS — never the rate card.
 * Pass `cogs` (bigint from `measureCogs`) and/or a precomputed `quote`.
 *
 * @param {string} payerId
 * @param {{cogs?:bigint|number|string, quote?:object, usage?:object, model?:string|null,
 *   taskId?:string|null, cfg?:object}} call
 * @returns {PendingCharge}
 */
export function recordPending(payerId, {
  cogs = null,
  quote = null,
  usage = {},
  model = null,
  taskId = null,
  cfg = {},
} = {}) {
  const billed = quote && quote.amount != null
    ? quote
    : quoteFromCogs(cogs ?? 0n, cfg);
  const rec = readPayer(payerId);
  if (rec.pending) {
    logger.warn(
      { payer: payerId, existing: rec.pending.amount, incoming: billed.amount },
      'rolling-settlement: second pending charge for one payer; keeping the larger',
    );
    if (BigInt(rec.pending.amount) >= BigInt(billed.amount)) return rec.pending;
  }
  rec.pending = {
    amount: String(billed.amount),
    taskId,
    model: model || null,
    usage: {
      prompt_tokens: Number(usage.prompt_tokens) || billed.prompt_tokens || 0,
      completion_tokens: Number(usage.completion_tokens) || billed.completion_tokens || 0,
    },
    provider_cogs: billed.provider_cogs != null ? String(billed.provider_cogs) : String(cogs ?? 0),
    platform_fee: billed.platform_fee != null ? String(billed.platform_fee) : null,
    fee_bps: billed.fee_bps ?? null,
    tier2_proof: billed.tier2_proof != null ? String(billed.tier2_proof) : '0',
    floor_applied: !!billed.floor_applied,
    basis: billed.basis || 'cost_plus',
    at: Date.now(),
    attempts: 0,
  };
  persistPayer(payerId, rec);
  return rec.pending;
}

/** Payment for the outstanding charge landed. Clears the debt. */
export function markSettled(payerId) {
  const rec = ledger.get(payerId) || loadPayer(payerId);
  if (!rec) return null;
  ledger.set(payerId, rec);
  const cleared = rec.pending;
  rec.pending = null;
  rec.settled = (rec.settled || 0) + 1;
  persistPayer(payerId, rec);
  return cleared;
}

/**
 * Settlement failed. The debt stays, so the next request is challenged again —
 * matching ZAN's `failed → settled` retry path rather than forgiving on error.
 */
export function markSettleFailed(payerId, reason = null) {
  const rec = ledger.get(payerId) || loadPayer(payerId);
  if (!rec?.pending) return null;
  ledger.set(payerId, rec);
  rec.pending.attempts += 1;
  persistPayer(payerId, rec);
  logger.warn(
    { payer: payerId, amount: rec.pending.amount, attempts: rec.pending.attempts, reason },
    'rolling-settlement: settlement failed; debt retained for the next request',
  );
  return rec.pending;
}

/**
 * Stamp a settled rolling payment onto the *owed* task, so the receipt for the
 * work that ran binds the USDC that paid for it — not the next request.
 */
export function applyPaymentToOwedTask(task, { paymentRef, settledAmount, protocolFeeBps = 50 } = {}) {
  if (!task) return null;
  task.intent = task.intent || {};
  task.intent.paymentRef = paymentRef;
  task.intent.paymentRail = 'usdc';
  task.intent.amount = String(settledAmount);
  let gross;
  try {
    gross = BigInt(settledAmount);
  } catch {
    return task;
  }
  const bps = BigInt(Math.min(Math.max(Number(protocolFeeBps) || 50, 50), 100));
  const fee = (gross * bps) / 10000n;
  task.feeAmount = fee.toString();
  task.netAmount = (gross - fee).toString();
  task.feeBps = Number(bps);
  task.meta = task.meta || {};
  task.meta.rolling = { ...(task.meta.rolling || {}), settled: true, paymentRef };
  return task;
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
 */
export function decideRolling({ pending, hasPayment, ceiling, maxUnsettled }) {
  if (pending) {
    return hasPayment
      ? { action: 'settle_then_serve', amount: pending.amount }
      : { action: 'settle_first', amount: pending.amount };
  }
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
 * Decide for a real request. `ceiling` is the cost-plus *estimate* of this call,
 * used only to size the exposure of a first free call (whale guard).
 *
 * @param {{payerId:string, hasPayment:boolean, ceiling:string|number|bigint}} input
 */
export function rollingDecision({ payerId, hasPayment = false, ceiling = '0' }) {
  const pending = getPending(payerId);
  let ceil;
  try {
    ceil = BigInt(ceiling);
  } catch {
    ceil = 0n;
  }
  return {
    ...decideRolling({
      pending,
      hasPayment,
      ceiling: ceil,
      maxUnsettled: maxUnsettledBaseUnits(),
    }),
    pending,
    ceiling: String(ceil),
  };
}

/** Base units → plain USD, for logs and `/health`. */
export function usd(baseUnits) {
  return (Number(baseUnits) / USDC_SCALE).toFixed(6);
}

/**
 * Outstanding-debt snapshot for `/health`.
 */
export function rollingStatus() {
  let unsettled = 0n;
  let owing = 0;
  let settled = 0;
  if (persistEnabled && persistDir) {
    try {
      for (const f of fs.readdirSync(persistDir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(persistDir, f), 'utf8'));
          const id = decodeURIComponent(f.replace(/\.json$/, ''));
          if (!ledger.has(id)) ledger.set(id, rec);
        } catch { /* skip */ }
      }
    } catch { /* dir missing */ }
  }
  for (const rec of ledger.values()) {
    settled += rec.settled || 0;
    if (!rec.pending) continue;
    owing += 1;
    unsettled += BigInt(rec.pending.amount);
  }
  return {
    enabled: rollingEnabled(),
    persist: persistEnabled,
    payers_tracked: ledger.size,
    payers_owing: owing,
    unsettled_usd: usd(unsettled),
    settled_calls: settled,
    max_unsettled_per_call_usd: usd(maxUnsettledBaseUnits()),
    note: rollingEnabled()
      ? (persistEnabled
        ? 'Each call settles the previous call\'s measured cost-plus bill. Pending charges survive restart.'
        : 'Each call settles the previous call\'s measured cost. In-memory: a restart forgives pending charges.')
      : 'Disabled — every call is quoted up front at max_tokens (X402_ROLLING_SETTLEMENT=true to enable).',
  };
}

/**
 * Tests / hot reload. `wipePersist: false` clears memory only so a restart can
 * be simulated against files still on disk.
 */
export function resetRollingSettlement({ wipePersist = true } = {}) {
  ledger.clear();
  if (wipePersist && persistEnabled && persistDir) {
    try {
      for (const f of fs.readdirSync(persistDir)) {
        if (f.endsWith('.json')) fs.unlinkSync(path.join(persistDir, f));
      }
    } catch { /* empty */ }
  }
}

export default {
  rollingEnabled,
  configureRollingLedger,
  maxUnsettledBaseUnits,
  payerBucket,
  getPending,
  recordPending,
  markSettled,
  markSettleFailed,
  applyPaymentToOwedTask,
  decideRolling,
  rollingDecision,
  rollingStatus,
  resetRollingSettlement,
  usd,
};
