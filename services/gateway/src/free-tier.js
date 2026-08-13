import logger from './logger.js';

/**
 * Daily COGS ceiling for unmetered traffic.
 *
 * Why this exists: ADR 0006 commits to a signed receipt for anything we route,
 * paid or not, and `/v1` is unmetered by default. That is a deliberate funnel —
 * but every unmetered call still burns real provider COGS that nobody pays, and
 * before this module the gateway neither capped nor *measured* the subsidy. The
 * only brakes were the demo key's request-rate limit and the `max_tokens` cap,
 * neither of which knows what a call costs: 150 agent-shaped demo calls a day at
 * measured GLM-5.2 COGS is ~$14, while 150 short completions is ~$1.30. A
 * request-count limit cannot tell those apart. This one is denominated in money.
 *
 * Scope is per API-key hash per UTC day, in memory, matching the request rate
 * limiter (`RateLimiter` in server.js) — the gateway is single-process by design
 * (`instances: 1`, fork mode), so a shared counter is not required. Two honest
 * consequences: **a restart forgives the day's spend**, and the ceiling is
 * checked before a call but charged after it, so a key can overshoot by at most
 * one call. Both are acceptable for a spend guard and neither is acceptable for
 * billing, which is why this never touches the buyer's invoice.
 *
 * The demo key is one bucket for everyone, so `FREE_TIER_DAILY_COGS_USD` is also
 * the ceiling on total public exposure through the demo. That is the number to
 * look at before advertising a free tier.
 */

const USDC_SCALE = 1_000_000;

/** $10/key/day. ~100 agent-shaped GLM-5.2 calls, or ~1,100 short completions. */
const DEFAULT_DAILY_USD = 10;

/** @type {Map<string, { day: string, spent: bigint }>} */
const buckets = new Map();

/** Stop the bucket map growing without bound when keys churn (abuse, scans). */
const MAX_BUCKETS = 10_000;

/**
 * Ceiling in USDC base units. `0n` disables enforcement.
 *
 * Read per call rather than at module load so a test (or a future SIGHUP reload)
 * can change it without re-importing. Unset falls back to the default; an
 * explicit `0` opts out; anything unparseable keeps the default and complains,
 * because a typo must not silently uncap the subsidy.
 */
export function dailyLimitBaseUnits() {
  const raw = process.env.FREE_TIER_DAILY_COGS_USD;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return BigInt(DEFAULT_DAILY_USD * USDC_SCALE);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { value: raw, using: DEFAULT_DAILY_USD },
      'free-tier: FREE_TIER_DAILY_COGS_USD is not a number; keeping the default ceiling',
    );
    return BigInt(DEFAULT_DAILY_USD * USDC_SCALE);
  }
  if (n === 0) return 0n;
  return BigInt(Math.round(n * USDC_SCALE));
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight, when every bucket resets. */
function msUntilReset(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, next - now);
}

/**
 * Which allowance a request draws on.
 *
 * Keyed on the API-key hash so it follows the caller rather than their address.
 * An unattributed caller (open mode, no key) falls back to IP, which is weaker
 * but better than every anonymous request sharing one bucket.
 *
 * @param {{ headers?: object, ip?: string }} req
 * @param {string|null} apiKeyHash from `apiKeyHashFromReq`
 */
export function freeTierBucket(req, apiKeyHash) {
  if (apiKeyHash) return `key:${apiKeyHash}`;
  if (req?.ip) return `ip:${req.ip}`;
  return 'anon';
}

function readBucket(id, now) {
  const day = utcDay(now);
  const existing = buckets.get(id);
  if (existing && existing.day === day) return existing;
  const fresh = { day, spent: 0n };
  buckets.set(id, fresh);
  return fresh;
}

/**
 * Has this caller exhausted today's free allowance?
 *
 * Called *before* serving, so `spent` reflects prior calls only — this cannot
 * know what the pending call will cost.
 *
 * @returns {{ allowed: boolean, enforced: boolean, spent: bigint, limit: bigint,
 *   retryAfterSec: number, resetAt: string }}
 */
export function checkFreeAllowance(bucketId, now = Date.now()) {
  const limit = dailyLimitBaseUnits();
  const spent = limit === 0n ? 0n : readBucket(bucketId, now).spent;
  const resetMs = msUntilReset(now);
  return {
    allowed: limit === 0n || spent < limit,
    enforced: limit !== 0n,
    spent,
    limit,
    retryAfterSec: Math.ceil(resetMs / 1000),
    resetAt: new Date(now + resetMs).toISOString(),
  };
}

/**
 * Charge measured COGS against today's allowance.
 *
 * Only ever called for calls that were **not** paid for — a call that settles
 * over x402 pays its own COGS and must not consume anyone's free budget.
 *
 * @param {string} bucketId
 * @param {bigint} amount USDC base units, from `measureCogs`
 * @returns {bigint} the bucket's running total for today
 */
export function recordFreeSpend(bucketId, amount, now = Date.now()) {
  if (dailyLimitBaseUnits() === 0n) return 0n;
  const add = typeof amount === 'bigint' ? amount : BigInt(amount || 0);
  if (add <= 0n) return readBucket(bucketId, now).spent;

  if (buckets.size >= MAX_BUCKETS && !buckets.has(bucketId)) pruneStale(now);

  const bucket = readBucket(bucketId, now);
  bucket.spent += add;
  return bucket.spent;
}

function pruneStale(now) {
  const day = utcDay(now);
  for (const [id, b] of buckets) {
    if (b.day !== day) buckets.delete(id);
  }
  // Every bucket is from today and we are still at the cap: drop the map rather
  // than leak. Forgiving spend is the safe direction to fail here — the
  // alternative is unbounded memory from a key-churning caller.
  if (buckets.size >= MAX_BUCKETS) {
    logger.warn({ size: buckets.size }, 'free-tier: bucket cap hit, resetting counters');
    buckets.clear();
  }
}

/** Base units → a plain USD string, for logs and `/health`. */
export function usd(baseUnits) {
  return (Number(baseUnits) / USDC_SCALE).toFixed(6);
}

/**
 * Subsidy snapshot for `/health` — what we are giving away today.
 *
 * The point is that the number is visible at all: the free tier was previously
 * unmeasured, so "how much does the demo cost us a day" had no answer.
 */
export function freeTierStatus(now = Date.now()) {
  const limit = dailyLimitBaseUnits();
  const day = utcDay(now);
  let total = 0n;
  let keys = 0;
  let exhausted = 0;
  for (const b of buckets.values()) {
    if (b.day !== day) continue;
    keys += 1;
    total += b.spent;
    if (limit !== 0n && b.spent >= limit) exhausted += 1;
  }
  return {
    enforced: limit !== 0n,
    daily_limit_usd: limit === 0n ? null : usd(limit),
    window: 'utc-day',
    resets_at: new Date(now + msUntilReset(now)).toISOString(),
    callers_today: keys,
    cogs_today_usd: usd(total),
    callers_exhausted: exhausted,
    note: limit === 0n
      ? 'FREE_TIER_DAILY_COGS_USD=0 — unmetered calls are uncapped. COGS is still measured and burned.'
      : 'Unmetered calls burn real provider COGS against this ceiling. In-memory: a restart clears it.',
  };
}

/** Tests / hot reload. */
export function resetFreeTier() {
  buckets.clear();
}
