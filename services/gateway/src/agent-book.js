/**
 * Possession-gated last-N spend pack for one agent_id.
 *
 * Not a public index. Demo / unmetered / collected:false never appear.
 * Verify only: the injected verify function decides possession. This
 * module does not hold or name a signing secret.
 */

import crypto from 'crypto';
import { clampBookLimit } from './usage-settled.js';

export { clampBookLimit, BOOK_DEFAULT_LIMIT, BOOK_MAX_LIMIT } from './usage-settled.js';

export const BOOK_HMAC_PREFIX = 'xfuel-book';

/** Canonical HMAC payload: agent_id + window. */
export function bookHmacPayload(agentId, window) {
  return `${BOOK_HMAC_PREFIX}:${Number(agentId)}:${Number(window)}`;
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
 * @param {object[]} entries
 * @param {number} agentId
 * @param {number} limit
 */
export function packBook(entries, agentId, limit) {
  return {
    agent_id: Number(agentId),
    limit,
    entries: entries.map(rowOf),
    totals: totalsOf(entries),
  };
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
  return {
    session: session ? String(session) : null,
    proof: proof ? String(proof) : null,
    limit,
  };
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
 *   ledger: { listByAgent: Function },
 *   verify: (claim: object) => { checked: boolean, valid: boolean|null },
 * }} deps
 */
export function readAgentBook(agentId, claim = {}, { ledger, verify } = {}) {
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
  return { status: 200, body: packBook(entries, id, window) };
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
