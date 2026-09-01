/**
 * Possession-gated last-N spend pack for one agent_id.
 *
 * Not a public index. Demo / unmetered / collected:false never appear.
 * Verify only: the injected verify function decides possession. This
 * module does not hold or name a signing secret.
 *
 * Cap window: prepaid_ceiling — spent is the sum of all collected amounts
 * for this agent_id; remaining = max(0, Y − spent) when budget Y is set.
 * Null/absent Y = unlimited. Raising Y lifts the ceiling; spent does not reset.
 */

import crypto from 'crypto';
import { clampBookLimit } from './usage-settled.js';
import { DEFAULT_FLOOR_UNITS } from './pricing.js';

export { clampBookLimit, BOOK_DEFAULT_LIMIT, BOOK_MAX_LIMIT } from './usage-settled.js';

export const BOOK_HMAC_PREFIX = 'xfuel-book';
export const ALLOWANCE_HMAC_PREFIX = 'xfuel-allowance';
/** Cap spend window id — prepaid ceiling on collected sum (not calendar-month). */
export const CAP_WINDOW = 'prepaid_ceiling';
/** Hop floor in USDC atomic units ($0.002). */
export const DOOR_FLOOR_UNITS = BigInt(DEFAULT_FLOOR_UNITS);

/** Canonical HMAC payload: agent_id + window. */
export function bookHmacPayload(agentId, window) {
  return `${BOOK_HMAC_PREFIX}:${Number(agentId)}:${Number(window)}`;
}

/**
 * Canonical HMAC payload for remaining-allowance (verify only).
 * Unlimited remaining is encoded as `-`.
 */
export function allowanceHmacPayload(agentId, remaining, asOf) {
  const rem = remaining == null ? '-' : String(remaining);
  return `${ALLOWANCE_HMAC_PREFIX}:${Number(agentId)}:${rem}:${String(asOf)}`;
}

/**
 * Verify a remaining-allowance HMAC. Receipt-verify style: checked/valid only.
 * Key is the possession session — no new signing secret.
 * @param {{ agentId: number, remaining: string|null, asOf: string, signature: string }} claim
 * @param {string} session
 */
export function verifyAllowanceHmac(claim, session) {
  if (!session || typeof session !== 'string') {
    return { checked: false, valid: null, reason: 'no_verify_key' };
  }
  const sig = claim?.signature;
  if (!sig) return { checked: false, valid: null, reason: 'no_signature' };
  const digest = crypto
    .createHmac('sha256', session)
    .update(allowanceHmacPayload(claim.agentId, claim.remaining, claim.asOf))
    .digest('hex');
  const recomputed = `sha256=${digest}`;
  const a = Buffer.from(String(sig).toLowerCase());
  const b = Buffer.from(recomputed.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { checked: true, valid, expected: String(sig), recomputed };
}

function addAmount(acc, v) {
  try {
    return acc + BigInt(String(v ?? '0').trim() || '0');
  } catch {
    return acc;
  }
}

function rowOf(entry) {
  const row = {
    task_id: entry.task_id,
    payment: {
      ref: entry.payment_ref,
      rail: entry.rail,
      amount: entry.amount ?? null,
    },
    collected_at: entry.collected_at || entry.recorded_at || null,
  };
  if (entry.model || entry.hub) {
    row.route = {};
    if (entry.model) row.route.model = entry.model;
    if (entry.hub) row.route.hub = entry.hub;
  }
  if (entry.parent_ref) {
    row.parent_ref = entry.parent_ref;
  }
  return row;
}

/**
 * Totals for the returned window: count, USDC sum, by rail.
 * @param {object[]} entries
 */
export function totalsOf(entries) {
  const byRail = {};
  let usdcSum = 0n;
  for (const e of entries) {
    const rail = String(e.rail || 'usdc').toLowerCase();
    if (!byRail[rail]) byRail[rail] = { count: 0, amount: 0n };
    byRail[rail].count += 1;
    byRail[rail].amount = addAmount(byRail[rail].amount, e.amount);
    usdcSum = addAmount(usdcSum, e.amount);
  }
  const by_rail = {};
  for (const [rail, v] of Object.entries(byRail)) {
    by_rail[rail] = { count: v.count, amount: v.amount.toString() };
  }
  return {
    count: entries.length,
    usdc_sum: usdcSum.toString(),
    by_rail,
  };
}

/**
 * Cap / spent / remaining for one agent under prepaid_ceiling.
 * @param {{ budget?: string|null }} identity
 * @param {bigint} spent
 */
export function capViewOf(identity, spent) {
  const spentStr = spent.toString();
  const raw = identity?.budget;
  if (raw == null || raw === '') {
    return {
      window: CAP_WINDOW,
      cap: null,
      spent: spentStr,
      remaining: null,
    };
  }
  let cap;
  try {
    cap = BigInt(String(raw).trim());
  } catch {
    return {
      window: CAP_WINDOW,
      cap: null,
      spent: spentStr,
      remaining: null,
    };
  }
  const remaining = cap > spent ? cap - spent : 0n;
  return {
    window: CAP_WINDOW,
    cap: cap.toString(),
    spent: spentStr,
    remaining: remaining.toString(),
  };
}

function packAllowance(agentId, remaining, session) {
  const as_of = new Date().toISOString();
  const digest = crypto
    .createHmac('sha256', session)
    .update(allowanceHmacPayload(agentId, remaining, as_of))
    .digest('hex');
  return {
    agent_id: Number(agentId),
    remaining: remaining == null ? null : String(remaining),
    as_of,
    signature: {
      alg: 'HMAC-SHA256',
      value: `sha256=${digest}`,
    },
  };
}

/**
 * @param {object[]} entries
 * @param {number} agentId
 * @param {number} limit
 * @param {{
 *   identity?: object|null,
 *   spent?: bigint,
 *   session?: string|null,
 * }} [extra]
 */
export function packBook(entries, agentId, limit, extra = {}) {
  const spent = extra.spent != null ? extra.spent : 0n;
  const caps = capViewOf(extra.identity || null, spent);
  const body = {
    agent_id: Number(agentId),
    limit,
    entries: entries.map(rowOf),
    totals: totalsOf(entries),
    window: caps.window,
    cap: caps.cap,
    spent: caps.spent,
    remaining: caps.remaining,
  };
  if (extra.session) {
    body.allowance = packAllowance(agentId, caps.remaining, extra.session);
  }
  return body;
}

/**
 * Extract a possession claim from a request. Query-string secrets are ignored.
 * @param {object} req
 */
export function claimFromRequest(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const headers = req.headers || {};
  const session = body.session || headers['x-xfuel-session'] || null;
  const proof = body.proof || body.hmac || headers['x-xfuel-book-proof'] || null;
  const limit = body.limit ?? req.query?.limit;
  const hasBudget = Object.prototype.hasOwnProperty.call(body, 'budget')
    || Object.prototype.hasOwnProperty.call(body, 'cap')
    || Object.prototype.hasOwnProperty.call(body, 'Y');
  let budget;
  if (hasBudget) {
    budget = body.budget !== undefined ? body.budget
      : (body.cap !== undefined ? body.cap : body.Y);
  }
  return {
    session: session ? String(session) : null,
    proof: proof ? String(proof) : null,
    limit,
    budget: hasBudget ? budget : undefined,
  };
}

/**
 * Resolve a bookable agent from session header/body (possession).
 * @param {object} req
 * @param {{ getBySession?: Function }} registry
 */
export function resolveBookableAgent(req, registry) {
  if (!registry || typeof registry.getBySession !== 'function') return null;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const headers = req.headers || {};
  const session = body.session || headers['x-xfuel-session'] || null;
  if (!session) return null;
  return registry.getBySession(String(session));
}

/**
 * True when remaining is known and below the $0.002 hop floor.
 * @param {string|null|undefined} remaining
 */
export function remainingBlocksDoor(remaining) {
  if (remaining == null || remaining === '') return false;
  try {
    return BigInt(String(remaining)) < DOOR_FLOOR_UNITS;
  } catch {
    return false;
  }
}

/**
 * Read the house book for one agent_id.
 *
 * Unauth (no proof) → 401 empty. Wrong proof / unknown agent → 403 empty.
 * Does not leak whether the agent_id exists.
 *
 * @param {number|string} agentId
 * @param {{ session?: string|null, proof?: string|null, limit?: number }} claim
 * @param {{
 *   ledger: { listByAgent: Function, sumCollectedByAgent?: Function },
 *   verify: (claim: object) => { checked: boolean, valid: boolean|null },
 *   registry?: { get: Function },
 * }} deps
 */
export function readAgentBook(agentId, claim = {}, { ledger, verify, registry } = {}) {
  const window = clampBookLimit(claim.limit);
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }

  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !ledger) {
    return { status: 403, body: null };
  }

  const checked = verify({ agentId: id, window, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }

  const entries = ledger.listByAgent(id, { limit: window });
  const identity = typeof registry?.get === 'function' ? registry.get(id) : null;
  const spent = typeof ledger.sumCollectedByAgent === 'function'
    ? ledger.sumCollectedByAgent(id)
    : 0n;
  const sessionKey = session || identity?.session || null;
  return {
    status: 200,
    body: packBook(entries, id, window, { identity, spent, session: sessionKey }),
  };
}

/**
 * Possession-gated set of budget Y on an existing agent_id.
 * Null/empty clears (unlimited). Absent budget in claim → no-op (caller reads).
 *
 * @param {number|string} agentId
 * @param {{ session?: string|null, proof?: string|null, budget?: * }} claim
 * @param {{
 *   registry: { get: Function, setBudget: Function },
 *   verify: Function,
 * }} deps
 */
export function setAgentBudget(agentId, claim = {}, { registry, verify } = {}) {
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }
  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !registry || typeof registry.setBudget !== 'function') {
    return { status: 403, body: null };
  }
  const window = clampBookLimit(claim.limit);
  const checked = verify({ agentId: id, window, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }
  const result = registry.setBudget(id, claim.budget);
  if (!result.ok) {
    return { status: 403, body: null };
  }
  return { status: 200, identity: result.identity };
}

/**
 * Query lineage for a task. Possession-gated: only if the task belongs to the agent_id.
 *
 * @param {number|string} agentId
 * @param {string} taskId
 * @param {{ session?: string|null, proof?: string|null }} claim
 * @param {{
 *   ledger: { findByTask: Function, lineageOf: Function },
 *   verify: Function,
 * }} deps
 */
export function queryLineage(agentId, taskId, claim = {}, { ledger, verify } = {}) {
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }

  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !ledger) {
    return { status: 403, body: null };
  }

  const window = clampBookLimit(50);
  const checked = verify({ agentId: id, window, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }

  const entry = ledger.findByTask(String(taskId));
  if (!entry || entry.agent_id !== id) {
    return { status: 403, body: null };
  }

  const lineage = ledger.lineageOf(String(taskId));
  return {
    status: 200,
    body: {
      agent_id: id,
      task_id: String(taskId),
      self: lineage.self ? rowOf(lineage.self) : null,
      ancestors: lineage.ancestors.map(rowOf),
      descendants: lineage.descendants.map(rowOf),
      root: lineage.root ? rowOf(lineage.root) : null,
      depth: lineage.ancestors.length,
    },
  };
}

/**
 * Possession verifier bound to a registry. Uses the session issued at register.
 * HMAC is over agent_id + window. Verify only.
 *
 * @param {{ get: (id: number) => object|null }} registry
 */
export function bindBookVerifier(registry) {
  const filler = crypto.randomBytes(32);
  return function verify(claim) {
    const identity = registry.get(claim.agentId);
    const key = identity?.session || filler;
    if (claim.session) {
      const a = Buffer.from(String(claim.session));
      const b = Buffer.from(String(key));
      const valid = !!identity && a.length === b.length && crypto.timingSafeEqual(a, b);
      return { checked: true, valid };
    }
    if (claim.proof) {
      const digest = crypto
        .createHmac('sha256', key)
        .update(bookHmacPayload(claim.agentId, claim.window))
        .digest('hex');
      const expected = `sha256=${digest}`;
      const a = Buffer.from(String(claim.proof).toLowerCase());
      const b = Buffer.from(expected.toLowerCase());
      const valid = !!identity && a.length === b.length && crypto.timingSafeEqual(a, b);
      return { checked: true, valid };
    }
    return { checked: false, valid: null };
  };
}
