/**
 * Hold-then-settle for a prepaid spend ceiling.
 *
 * A paid call reserves its worst-case cost before upstream runs. The ceiling
 * is settled spend plus open holds. The reservation is atomic under a
 * per-store lock (this process has no SQL transaction) and idempotent per
 * request id. Success consumes the hold at the actual cost and releases the
 * difference. Failure, upstream error, or timeout releases the whole hold.
 * A TTL expires a hold whose request never came back, so a crash cannot
 * strand the reservation forever.
 *
 * Two ceilings share this path:
 *   - agent prepaid budget Y (settled = ledger sum; open holds add on top)
 *   - session max_cumulative_spend (settled = consumed holds for that session)
 *
 * Flag: SPEND_HOLD_ENABLED (default off). TTL: SPEND_HOLD_TTL_MS (default 10 min).
 *
 * Worst-case amount is chosen by the caller. The gateway uses the x402 quote
 * (output priced at capped max_tokens, the exact-scheme charge) and raises it
 * to the hop floor when the quote is missing or lower. Streaming here buffers
 * the full completion before chunking, so that quote is known before upstream.
 * Consume then releases reserved − settled when settlement comes back lower.
 *
 * Payment receipts do not carry the hold id. The signed payload has no ceiling
 * field for it, and adding one would be a payload version bump.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

export const CEILING_EXCEEDED = 'CEILING_EXCEEDED';

/** Ten minutes. Longer than the 5 min task timeout, short enough to unstick a crash. */
export const DEFAULT_HOLD_TTL_MS = 10 * 60 * 1000;

const OPEN = 'open';
const CONSUMED = 'consumed';
const RELEASED = 'released';
const EXPIRED = 'expired';

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function spendHoldEnabled(env = process.env) {
  return env?.SPEND_HOLD_ENABLED === 'true';
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function spendHoldTtlMs(env = process.env) {
  const n = parseInt(env?.SPEND_HOLD_TTL_MS ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HOLD_TTL_MS;
  return n;
}

/**
 * Atomic USDC (6dp integer). Null when the value is not a non-negative integer.
 * @param {bigint | number | string | null | undefined} value
 * @returns {bigint | null}
 */
export function parseAtomic(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Worst-case reservation: the priced quote, or the hop floor when the quote
 * is missing or smaller. Never a negative.
 * @param {bigint | number | string | null | undefined} quoted
 * @param {bigint | number | string | null | undefined} floor
 * @returns {bigint | null}
 */
export function reservationAmount(quoted, floor) {
  const q = parseAtomic(quoted);
  const f = parseAtomic(floor);
  if (q == null && f == null) return null;
  if (q == null || q <= 0n) return f != null && f > 0n ? f : null;
  if (f == null) return q;
  return q > f ? q : f;
}

/**
 * Legs the store can reserve against. An unreadable cap is skipped (unlimited),
 * matching the book: null Y is not a ceiling.
 *
 * @param {{
 *   agentId?: number | string | null,
 *   budget?: string | number | bigint | null,
 *   settledByAgent?: () => bigint | string | number,
 *   session?: { delegation_hash?: string | null, max_cumulative_spend?: string | number | bigint | null } | null,
 * }} ctx
 */
export function ceilingLegsFromContext({
  agentId = null,
  budget = null,
  settledByAgent = null,
  session = null,
} = {}) {
  const legs = [];
  if (agentId != null && budget != null && String(budget).trim() !== '') {
    const cap = parseAtomic(budget);
    const id = Number(agentId);
    if (cap != null && Number.isInteger(id) && id >= 1) {
      legs.push({
        scope: 'agent',
        key: String(id),
        cap,
        settled: typeof settledByAgent === 'function' ? settledByAgent : (() => 0n),
      });
    }
  }
  const hash = session?.delegation_hash;
  const max = session?.max_cumulative_spend;
  if (hash && max != null && String(max).trim() !== '') {
    const cap = parseAtomic(max);
    if (cap != null) {
      legs.push({
        scope: 'session',
        key: String(hash).toLowerCase(),
        cap,
      });
    }
  }
  return legs;
}

/**
 * Typed refusal body. `remaining` and `requested` are atomic USDC strings.
 * @param {object} decision
 * @param {object} [extra]
 */
export function ceilingErrorBody(decision = {}, extra = {}) {
  const error = {
    message: 'Prepaid spend ceiling would be exceeded by this call',
    type: 'ceiling_exceeded',
    code: CEILING_EXCEEDED,
    remaining: decision.remaining ?? null,
    requested: decision.requested ?? null,
    ceiling: decision.ceiling ?? null,
    cap: decision.cap ?? null,
    spent: decision.spent ?? null,
    held: decision.held ?? null,
  };
  if (decision.ceiling === 'agent' && decision.scope_key != null) {
    error.agent_id = decision.scope_key;
  }
  if (decision.ceiling === 'session' && decision.scope_key != null) {
    error.delegation_hash = decision.scope_key;
  }
  return { error: { ...error, ...extra } };
}

function replaceFile(target, body) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, target);
    return;
  } catch {
    /* Windows rename will not replace an existing file. */
  }
  try {
    fs.rmSync(target, { force: true });
    fs.renameSync(tmp, target);
  } catch {
    try {
      fs.copyFileSync(tmp, target);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* leftover temp is harmless */ }
    }
  }
}

/**
 * In-memory hold store. Optional JSON file so a restart keeps consumed
 * session spend and still-open holds (those expire on the TTL).
 */
export class SpendHoldStore {
  /**
   * @param {{ dir?: string | null, persist?: boolean, ttlMs?: number, now?: () => number }} [opts]
   */
  constructor({ dir = null, persist = false, ttlMs = DEFAULT_HOLD_TTL_MS, now = null } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs >= 1 ? ttlMs : DEFAULT_HOLD_TTL_MS;
    this._now = typeof now === 'function' ? now : (() => Date.now());
    /** @type {Map<string, object>} request id → hold */
    this._byRequest = new Map();
    this._tail = Promise.resolve();
    /**
     * Test-only yield inside the lock, after the ceiling is read and before
     * the hold is written. Production leaves this null. A callback must not
     * call back into the store (the lock is not re-entrant).
     * @type {null | (() => Promise<void>)}
     */
    this.testYield = null;

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'spend-hold: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'spend-holds.json');
  }

  _load() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'spend-hold: load failed');
      }
      return;
    }
    for (const row of data.holds || []) {
      const hold = this._fromDisk(row);
      if (hold) this._byRequest.set(hold.request_id, hold);
    }
    this._expire(this._now());
  }

  _fromDisk(row) {
    if (!row?.request_id || !row?.id) return null;
    const reserved = parseAtomic(row.reserved);
    const consumed = parseAtomic(row.consumed_amount);
    if (reserved == null) return null;
    const legs = [];
    for (const leg of row.legs || []) {
      const cap = parseAtomic(leg?.cap);
      if (!leg?.scope || leg.key == null || cap == null) continue;
      legs.push({ scope: String(leg.scope), key: String(leg.key), cap });
    }
    return {
      id: String(row.id),
      request_id: String(row.request_id),
      reserved,
      consumed_amount: consumed ?? 0n,
      shortfall: parseAtomic(row.shortfall) ?? 0n,
      state: row.state || OPEN,
      legs,
      created_at: Number(row.created_at) || 0,
      expires_at: Number(row.expires_at) || 0,
      consumed_at: row.consumed_at || null,
      released_at: row.released_at || null,
    };
  }

  _save() {
    if (!this.persist) return;
    try {
      const body = JSON.stringify({
        holds: [...this._byRequest.values()].map((hold) => ({
          id: hold.id,
          request_id: hold.request_id,
          reserved: hold.reserved.toString(),
          consumed_amount: hold.consumed_amount.toString(),
          shortfall: (hold.shortfall || 0n).toString(),
          state: hold.state,
          legs: hold.legs.map((leg) => ({
            scope: leg.scope,
            key: leg.key,
            cap: leg.cap.toString(),
          })),
          created_at: hold.created_at,
          expires_at: hold.expires_at,
          consumed_at: hold.consumed_at || null,
          released_at: hold.released_at || null,
        })),
      });
      replaceFile(this._file(), body);
    } catch (err) {
      logger.warn({ err: err.message }, 'spend-hold: save failed');
    }
  }

  _lock(fn) {
    const run = this._tail.then(() => fn(), () => fn());
    this._tail = run.then(() => undefined, () => undefined);
    return run;
  }

  _public(hold) {
    if (!hold) return null;
    return {
      id: hold.id,
      request_id: hold.request_id,
      reserved: hold.reserved.toString(),
      consumed_amount: hold.state === CONSUMED ? hold.consumed_amount.toString() : null,
      released: hold.state === CONSUMED
        ? (hold.reserved - hold.consumed_amount).toString()
        : null,
      shortfall: hold.shortfall > 0n ? hold.shortfall.toString() : '0',
      state: hold.state,
      ceilings: hold.legs.map((leg) => ({
        scope: leg.scope,
        key: leg.key,
        cap: leg.cap.toString(),
      })),
      created_at: new Date(hold.created_at).toISOString(),
      expires_at: new Date(hold.expires_at).toISOString(),
      consumed_at: hold.consumed_at || null,
      released_at: hold.released_at || null,
    };
  }

  _expire(now) {
    let changed = false;
    for (const hold of this._byRequest.values()) {
      if (hold.state === OPEN && hold.expires_at <= now) {
        hold.state = EXPIRED;
        hold.released_at = new Date(now).toISOString();
        changed = true;
      }
    }
    if (changed) this._save();
    return changed;
  }

  _settled(leg) {
    if (typeof leg.settled === 'function') {
      try {
        const v = leg.settled();
        const parsed = parseAtomic(v);
        return parsed ?? 0n;
      } catch {
        return 0n;
      }
    }
    let sum = 0n;
    for (const hold of this._byRequest.values()) {
      if (hold.state !== CONSUMED) continue;
      if (!hold.legs.some((item) => item.scope === leg.scope && item.key === leg.key)) continue;
      sum += hold.consumed_amount;
    }
    return sum;
  }

  _openSum(scope, key, now) {
    let sum = 0n;
    for (const hold of this._byRequest.values()) {
      if (hold.state !== OPEN || hold.expires_at <= now) continue;
      if (!hold.legs.some((item) => item.scope === scope && item.key === key)) continue;
      sum += hold.reserved;
    }
    return sum;
  }

  /**
   * Open reservation still counting against one ceiling. Sweeps expired holds.
   * Sync so the book read can stay synchronous. Production reserve() does not
   * await inside the lock, so this cannot interleave with a commit.
   * @param {string} scope
   * @param {string | number} key
   * @param {number} [now]
   * @returns {bigint}
   */
  openReserved(scope, key, now = this._now()) {
    this._expire(now);
    return this._openSum(String(scope), String(key), now);
  }

  _verdict(ceilings, amount, now) {
    for (const leg of ceilings) {
      const settled = this._settled(leg);
      const held = this._openSum(leg.scope, leg.key, now);
      const committed = settled + held;
      const remaining = leg.cap > committed ? leg.cap - committed : 0n;
      if (committed + amount > leg.cap) {
        return {
          ok: false,
          code: CEILING_EXCEEDED,
          ceiling: leg.scope,
          scope_key: leg.key,
          cap: leg.cap.toString(),
          spent: settled.toString(),
          held: held.toString(),
          remaining: remaining.toString(),
          requested: amount.toString(),
        };
      }
    }
    return { ok: true };
  }

  _normalizeCeilings(ceilings) {
    const legs = [];
    for (const leg of ceilings || []) {
      const cap = parseAtomic(leg?.cap);
      if (!leg?.scope || leg.key == null || cap == null) continue;
      const key = leg.scope === 'session' ? String(leg.key).toLowerCase() : String(leg.key);
      legs.push({
        scope: String(leg.scope),
        key,
        cap,
        settled: typeof leg.settled === 'function' ? leg.settled : null,
      });
    }
    return legs;
  }

  _existingLive(requestId) {
    const existing = this._byRequest.get(String(requestId));
    if (!existing) return null;
    if (existing.state === OPEN || existing.state === CONSUMED) return existing;
    return null;
  }

  _commit(requestId, amount, ceilings, now) {
    const hold = {
      id: `hold_${crypto.randomUUID()}`,
      request_id: String(requestId),
      reserved: amount,
      consumed_amount: 0n,
      shortfall: 0n,
      state: OPEN,
      legs: ceilings.map((leg) => ({ scope: leg.scope, key: leg.key, cap: leg.cap })),
      created_at: now,
      expires_at: now + this.ttlMs,
      consumed_at: null,
      released_at: null,
    };
    this._byRequest.set(hold.request_id, hold);
    this._save();
    return { ok: true, hold: this._public(hold), idempotent: false };
  }

  /**
   * Read-only ceiling check. Does not reserve.
   * @param {{ ceilings: object[], amount: bigint | string | number, now?: number }} args
   */
  preview({ ceilings, amount, now = null } = {}) {
    return this._lock(() => {
      const at = now ?? this._now();
      this._expire(at);
      const requested = parseAtomic(amount);
      if (requested == null || requested <= 0n) {
        return { ok: false, code: 'invalid_amount', requested: amount == null ? null : String(amount) };
      }
      const legs = this._normalizeCeilings(ceilings);
      if (legs.length === 0) return { ok: true, unlimited: true, requested: requested.toString() };
      const verdict = this._verdict(legs, requested, at);
      if (!verdict.ok) return verdict;
      return { ok: true, requested: requested.toString() };
    });
  }

  /**
   * Reserve `amount` against every ceiling, or reserve none.
   * Same request id while the hold is open or consumed returns that hold.
   * A released or expired id may reserve again (the attempt is over).
   *
   * @param {{
   *   requestId: string,
   *   amount: bigint | string | number,
   *   ceilings: object[],
   *   now?: number,
   * }} args
   */
  reserve({ requestId, amount, ceilings, now = null } = {}) {
    return this._lock(async () => {
      const at = now ?? this._now();
      this._expire(at);
      if (!requestId) return { ok: false, code: 'request_id_required' };
      const live = this._existingLive(requestId);
      if (live) return { ok: true, hold: this._public(live), idempotent: true };

      const requested = parseAtomic(amount);
      if (requested == null || requested <= 0n) {
        return { ok: false, code: 'invalid_amount', requested: amount == null ? null : String(amount) };
      }
      const legs = this._normalizeCeilings(ceilings);
      if (legs.length === 0) return { ok: true, hold: null, unlimited: true };

      // Decide, then commit. The yield sits between them on purpose: the
      // store lock is what keeps a second caller from passing the same
      // check. Re-checking after the yield would hide a missing lock.
      const verdict = this._verdict(legs, requested, at);
      if (!verdict.ok) return verdict;
      if (typeof this.testYield === 'function') await this.testYield();
      return this._commit(requestId, requested, legs, at);
    });
  }

  /**
   * Settle the hold at `actual` and stop counting the reserved difference.
   * Idempotent once consumed. A missing or larger-than-reserved actual does
   * not raise the reservation; the extra is reported as `shortfall`.
   * @param {string} requestId
   * @param {bigint | string | number | null} [actual]
   * @param {number} [now]
   */
  consume(requestId, actual = null, now = null) {
    return this._lock(() => {
      const at = now ?? this._now();
      this._expire(at);
      const hold = this._byRequest.get(String(requestId || ''));
      if (!hold) return { ok: false, code: 'hold_not_found' };
      if (hold.state === CONSUMED) {
        return { ok: true, hold: this._public(hold), idempotent: true };
      }
      if (hold.state !== OPEN) {
        return { ok: false, code: 'hold_not_open', state: hold.state, hold: this._public(hold) };
      }
      const parsed = actual == null ? hold.reserved : parseAtomic(actual);
      const wanted = parsed == null ? hold.reserved : parsed;
      const applied = wanted > hold.reserved ? hold.reserved : wanted;
      hold.state = CONSUMED;
      hold.consumed_amount = applied;
      hold.shortfall = wanted > hold.reserved ? wanted - hold.reserved : 0n;
      hold.consumed_at = new Date(at).toISOString();
      this._save();
      return {
        ok: true,
        hold: this._public(hold),
        idempotent: false,
        released: (hold.reserved - applied).toString(),
        shortfall: hold.shortfall.toString(),
      };
    });
  }

  /**
   * Drop an open hold. Consumed holds stay (they are settled spend).
   * Released and expired are idempotent.
   * @param {string} requestId
   * @param {number} [now]
   */
  release(requestId, now = null) {
    return this._lock(() => {
      const at = now ?? this._now();
      this._expire(at);
      const hold = this._byRequest.get(String(requestId || ''));
      if (!hold) return { ok: false, code: 'hold_not_found' };
      if (hold.state === RELEASED || hold.state === EXPIRED || hold.state === CONSUMED) {
        return { ok: true, hold: this._public(hold), idempotent: true };
      }
      hold.state = RELEASED;
      hold.released_at = new Date(at).toISOString();
      this._save();
      return { ok: true, hold: this._public(hold), idempotent: false };
    });
  }

  /**
   * Expire open holds whose TTL has passed.
   * @param {number} [now]
   */
  expireDue(now = null) {
    return this._lock(() => {
      const at = now ?? this._now();
      this._expire(at);
      return { ok: true };
    });
  }
}

export default SpendHoldStore;
