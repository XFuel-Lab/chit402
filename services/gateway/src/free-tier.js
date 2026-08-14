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
 * The demo key is one bucket for everyone, so `FREE_TIER_DAILY_COGS_USD` bounds
 * public exposure *through the demo key*. It does not bound exposure across many
 * keys — N keys is N ceilings — so a second, network-wide ceiling
 * (`FREE_TIER_DAILY_COGS_TOTAL_USD`) caps the total. A request must clear both.
 * The global counter is the one to look at before advertising a free tier.
 */

const USDC_SCALE = 1_000_000;

/** $10/key/day. ~100 agent-shaped GLM-5.2 calls, or ~1,100 short completions. */
const DEFAULT_DAILY_USD = 10;

/**
 * $50/day across every free caller.
 *
 * The per-key ceiling is not a budget — it is a budget *per key*, and keys are
 * free to mint. Without this, total subsidy is unbounded by construction and the
 * honest answer to "what can the free tier cost us in a day" is "everything".
 */
const DEFAULT_DAILY_TOTAL_USD = 50;

/** @type {Map<string, { day: string, spent: bigint }>} */
const buckets = new Map();

/**
 * Network-wide spend, tracked outside `buckets` on purpose.
 *
 * Keeping it separate is what makes the cap non-bypassable: eviction and pruning
 * discard per-caller counters, and if the global total lived in that map it would
 * be discarded with them.
 *
 * @type {{ day: string, spent: bigint }}
 */
let globalSpend = null;

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

/**
 * Network-wide ceiling in USDC base units. `0n` disables it.
 *
 * Same parsing contract as `dailyLimitBaseUnits`: unset keeps the default, an
 * explicit `0` opts out, unparseable keeps the default and complains.
 */
export function dailyTotalLimitBaseUnits() {
  const raw = process.env.FREE_TIER_DAILY_COGS_TOTAL_USD;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return BigInt(DEFAULT_DAILY_TOTAL_USD * USDC_SCALE);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    logger.warn(
      { value: raw, using: DEFAULT_DAILY_TOTAL_USD },
      'free-tier: FREE_TIER_DAILY_COGS_TOTAL_USD is not a number; keeping the default ceiling',
    );
    return BigInt(DEFAULT_DAILY_TOTAL_USD * USDC_SCALE);
  }
  if (n === 0) return 0n;
  return BigInt(Math.round(n * USDC_SCALE));
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function readGlobal(now) {
  const day = utcDay(now);
  if (!globalSpend || globalSpend.day !== day) globalSpend = { day, spent: 0n };
  return globalSpend;
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
 * A request must clear **both** ceilings. `scope` names which one refused, so the
 * caller can say "you are out" versus "the network is out" — different problems
 * with different answers, and conflating them would tell a caller who has spent
 * nothing that they are over their limit.
 *
 * @returns {{ allowed: boolean, enforced: boolean, spent: bigint, limit: bigint,
 *   globalSpent: bigint, globalLimit: bigint, scope: 'key'|'global'|null,
 *   retryAfterSec: number, resetAt: string }}
 */
export function checkFreeAllowance(bucketId, now = Date.now()) {
  const limit = dailyLimitBaseUnits();
  const globalLimit = dailyTotalLimitBaseUnits();
  const spent = limit === 0n ? 0n : readBucket(bucketId, now).spent;
  const globalSpent = globalLimit === 0n ? 0n : readGlobal(now).spent;
  const resetMs = msUntilReset(now);

  const keyOk = limit === 0n || spent < limit;
  const globalOk = globalLimit === 0n || globalSpent < globalLimit;

  return {
    allowed: keyOk && globalOk,
    enforced: limit !== 0n || globalLimit !== 0n,
    spent,
    limit,
    globalSpent,
    globalLimit,
    scope: keyOk ? (globalOk ? null : 'global') : 'key',
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
  const add = typeof amount === 'bigint' ? amount : BigInt(amount || 0);
  if (add <= 0n) return readBucket(bucketId, now).spent;

  if (buckets.size >= MAX_BUCKETS && !buckets.has(bucketId)) pruneStale(now);

  // Recorded even when both ceilings are disabled. The subsidy being *visible*
  // is half the point of this module, and `/health` reporting $0.00 of COGS
  // while uncapped would be the same blind spot it was written to remove.
  readGlobal(now).spent += add;
  const bucket = readBucket(bucketId, now);
  bucket.spent += add;
  return bucket.spent;
}

/**
 * Make room in the bucket map without handing out a free reset.
 *
 * The previous version cleared the whole map once every bucket was from today,
 * which made the cap a subsidy bypass rather than a memory guard: churn
 * MAX_BUCKETS distinct keys and every real counter — including the churner's own
 * — went back to zero, repeatable indefinitely.
 *
 * Two changes close that. Eviction is **lowest-spend first**, so churned buckets
 * (which have spent almost nothing) go and accumulated counters stay. And the
 * network-wide total lives outside this map, so no amount of eviction reduces it;
 * a caller who forces eviction still cannot spend past the global ceiling.
 */
function pruneStale(now) {
  const day = utcDay(now);
  for (const [id, b] of buckets) {
    if (b.day !== day) buckets.delete(id);
  }
  if (buckets.size < MAX_BUCKETS) return;

  const bySpend = [...buckets.entries()].sort((a, b) => (a[1].spent < b[1].spent ? -1 : a[1].spent > b[1].spent ? 1 : 0));
  const evict = Math.max(1, Math.floor(bySpend.length / 2));
  for (let i = 0; i < evict; i++) buckets.delete(bySpend[i][0]);

  logger.warn(
    { size: buckets.size, evicted: evict, globalSpentUsd: usd(readGlobal(now).spent) },
    'free-tier: bucket cap hit, evicted lowest-spend counters (global ceiling unaffected)',
  );
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
  const globalLimit = dailyTotalLimitBaseUnits();
  const day = utcDay(now);
  let keys = 0;
  let exhausted = 0;
  for (const b of buckets.values()) {
    if (b.day !== day) continue;
    keys += 1;
    if (limit !== 0n && b.spent >= limit) exhausted += 1;
  }
  // Read the global counter rather than summing buckets: eviction discards
  // buckets, so a sum would under-report exactly when it matters most.
  const total = readGlobal(now).spent;

  const notes = [];
  if (limit === 0n) notes.push('FREE_TIER_DAILY_COGS_USD=0 — no per-key ceiling.');
  if (globalLimit === 0n) notes.push('FREE_TIER_DAILY_COGS_TOTAL_USD=0 — total subsidy is uncapped.');
  notes.push('COGS is measured and burned whether or not a ceiling is enforced.');
  notes.push('In-memory: a restart clears the day.');

  return {
    enforced: limit !== 0n || globalLimit !== 0n,
    daily_limit_usd: limit === 0n ? null : usd(limit),
    daily_total_limit_usd: globalLimit === 0n ? null : usd(globalLimit),
    window: 'utc-day',
    resets_at: new Date(now + msUntilReset(now)).toISOString(),
    callers_today: keys,
    cogs_today_usd: usd(total),
    total_exhausted: globalLimit !== 0n && total >= globalLimit,
    callers_exhausted: exhausted,
    note: notes.join(' '),
  };
}

/** Tests / hot reload. */
export function resetFreeTier() {
  buckets.clear();
  globalSpend = null;
}
