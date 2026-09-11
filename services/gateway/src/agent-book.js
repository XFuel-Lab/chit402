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
import { clampBookLimit, BOOK_MAX_LIMIT, deriveEvidence, BOOK_EVIDENCE, entryQualifiesForTotals } from './usage-settled.js';
import { DEFAULT_FLOOR_UNITS } from './pricing.js';
import { buildVerifyUrl, explorerUrlForRef } from './receipt.js';

export { clampBookLimit, BOOK_DEFAULT_LIMIT, BOOK_MAX_LIMIT } from './usage-settled.js';
export { deriveEvidence, BOOK_EVIDENCE } from './usage-settled.js';

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
  const evidence = deriveEvidence(entry);
  const isBlocked = evidence === BOOK_EVIDENCE.POLICY_BLOCKED;
  const isUnverified = evidence === BOOK_EVIDENCE.UNVERIFIED;
  const isArrivalUnverified = evidence === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED;
  const isRecordedBySettle = evidence === BOOK_EVIDENCE.RECORDED_BY_SETTLE;
  const isInflow = evidence === BOOK_EVIDENCE.INFLOW_CLAIMED;
  const hideAmount = isUnverified || isArrivalUnverified;
  const row = {
    task_id: entry.task_id,
    evidence,
    payment: {
      ref: entry.payment_ref ?? null,
      rail: entry.rail ?? null,
      amount: hideAmount ? null : (entry.amount ?? null),
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
  if (entry.intent_id) {
    row.intent_id = entry.intent_id;
  }
  if (entry.attempt_index != null) {
    row.attempt_index = entry.attempt_index;
  }
  if (entry.payer) {
    row.payer_wallet = entry.payer;
  }
  if (entry.replay_events?.length) {
    row.replay_events = entry.replay_events;
    row.replay_count = entry.replay_events.length;
  }
  if (isRecordedBySettle) {
    row.recorded_by = 'settle';
    row.arrival_status = entry.arrival_status || 'pending';
    if (entry.ingress_receipt) row.ingress_receipt = entry.ingress_receipt;
  }
  if (isArrivalUnverified) {
    row.arrival_status = 'unverified';
    row.omission_rule = 'no_ingress_receipt_at_cutoff';
  }
  if (isInflow && entry.inflow_claim) {
    row.inflow_claim = entry.inflow_claim;
    row.bucket = entry.bucket || entry.inflow_claim.bucket;
    if (entry.inflow_corrections?.length) {
      row.inflow_corrections = entry.inflow_corrections;
    }
  }
  if (isBlocked) {
    row.event = 'policy_blocked';
    row.policy_code = entry.policy_code || 'policy_blocked';
    row.reason = entry.reason || null;
    row.collected = false;
    if (entry.policy_key) row.policy_key = entry.policy_key;
    if (entry.spent_atomic != null) row.spent_atomic = String(entry.spent_atomic);
    if (entry.cap_atomic != null) row.cap_atomic = String(entry.cap_atomic);
    if (entry.period_start) row.period_start = entry.period_start;
  } else if (hideAmount) {
    row.collected = false;
  } else if (isRecordedBySettle) {
    row.collected = false;
  } else {
    row.collected = true;
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
  let count = 0;
  for (const e of entries) {
    if (!entryQualifiesForTotals(e)) continue;
    count += 1;
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
    count,
    usdc_sum: usdcSum.toString(),
    by_rail,
  };
}

/**
 * Group book rows by intent_id for treasury view.
 * @param {object[]} entries — raw ledger entries
 */
export function groupEntriesByIntent(entries) {
  const intents = {};
  for (const e of entries) {
    const id = e.intent_id;
    if (!id) continue;
    if (!intents[id]) {
      intents[id] = { intent_id: id, attempts: [], collected_count: 0, blocked_count: 0 };
    }
    const attempt = {
      task_id: e.task_id,
      attempt_index: e.attempt_index ?? null,
      evidence: deriveEvidence(e),
      collected: e.collected === true && deriveEvidence(e) === BOOK_EVIDENCE.COLLECTED,
      event: e.event || null,
      amount: (deriveEvidence(e) === BOOK_EVIDENCE.UNVERIFIED
        || deriveEvidence(e) === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED) ? null : (e.amount ?? null),
      policy_code: e.policy_code || null,
      policy_key: e.policy_key || null,
      spent_atomic: e.spent_atomic != null ? String(e.spent_atomic) : null,
      cap_atomic: e.cap_atomic != null ? String(e.cap_atomic) : null,
      period_start: e.period_start || null,
    };
    intents[id].attempts.push(attempt);
    if (deriveEvidence(e) === BOOK_EVIDENCE.POLICY_BLOCKED) intents[id].blocked_count += 1;
    else if (deriveEvidence(e) === BOOK_EVIDENCE.COLLECTED
      || deriveEvidence(e) === BOOK_EVIDENCE.INFLOW_CLAIMED) intents[id].collected_count += 1;
  }
  return intents;
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
  const intents = groupEntriesByIntent(entries);
  const body = {
    agent_id: Number(agentId),
    limit,
    entries: entries.map(rowOf),
    totals: totalsOf(entries),
    intents: Object.keys(intents).length > 0 ? intents : undefined,
    window: caps.window,
    cap: caps.cap,
    spent: caps.spent,
    remaining: caps.remaining,
  };
  if (extra.session) {
    body.allowance = packAllowance(agentId, caps.remaining, extra.session);
    body.private_spend = {
      enabled: true,
      mode: 'vendor_blind',
      trust: 'gateway',
      note: 'Gateway-trusted vendor blind — not prompt confidentiality.',
    };
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
      intent_id: lineage.intent_id || null,
      intent_attempts: (lineage.intent_attempts || []).map(rowOf),
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

/**
 * Build CSV export of collected book rows for accounting / audit.
 * @param {object[]} entries — raw ledger entries
 * @param {number} agentId
 * @param {string} baseUrl — gateway public base for verify_url
 */
export function buildBookExportCsv(entries, agentId, baseUrl) {
  const header = 'task_id,evidence,collected_at,hub,model,amount,payment_ref,rail,bucket,payer_wallet,intent_id,attempt_index,policy_code,reason,policy_key,spent_atomic,cap_atomic,period_start,replay_count,verify_url,explorer_url';
  const lines = [header];
  for (const e of entries) {
    const row = rowOf(e);
    const verifyUrl = buildVerifyUrl(baseUrl, row.task_id);
    const explorerUrl = explorerUrlForRef(row.payment.ref) || '';
    const cols = [
      row.task_id,
      row.evidence,
      row.collected_at || '',
      row.route?.hub || '',
      row.route?.model || '',
      row.payment.amount ?? '',
      row.payment.ref || '',
      row.payment.rail || '',
      row.bucket || '',
      row.payer_wallet || '',
      row.intent_id || '',
      row.attempt_index ?? '',
      row.policy_code || '',
      row.reason || '',
      row.policy_key || '',
      row.spent_atomic ?? '',
      row.cap_atomic ?? '',
      row.period_start || '',
      row.replay_count ?? '',
      verifyUrl,
      explorerUrl,
    ].map(csvEscape);
    lines.push(cols.join(','));
  }
  return lines.join('\n');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build JSON audit pack for a book slice.
 * @param {object[]} entries
 * @param {number} agentId
 * @param {string} baseUrl
 * @param {{ policy?: object|null, totals?: object }} [opts]
 */
export function buildBookAuditPack(entries, agentId, baseUrl, { policy = null, totals = null } = {}) {
  const rows = entries.map((e) => {
    const row = rowOf(e);
    return {
      task_id: row.task_id,
      evidence: row.evidence,
      collected_at: row.collected_at,
      hub: row.route?.hub || null,
      model: row.route?.model || null,
      amount: row.payment.amount,
      payment_ref: row.payment.ref,
      rail: row.payment.rail,
      bucket: row.bucket || null,
      payer_wallet: row.payer_wallet || null,
      intent_id: row.intent_id || null,
      attempt_index: row.attempt_index ?? null,
      replay_count: row.replay_count ?? null,
      replay_events: row.replay_events || null,
      arrival_status: row.arrival_status || null,
      omission_rule: row.omission_rule || null,
      ingress_receipt: row.ingress_receipt || null,
      inflow_claim: row.inflow_claim || null,
      inflow_corrections: row.inflow_corrections || null,
      policy_code: row.policy_code || null,
      reason: row.reason || null,
      policy_key: row.policy_key || null,
      spent_atomic: row.spent_atomic ?? null,
      cap_atomic: row.cap_atomic ?? null,
      period_start: row.period_start || null,
      verify_url: buildVerifyUrl(baseUrl, row.task_id),
      auditor_url: `${buildVerifyUrl(baseUrl, row.task_id)}?format=auditor`,
      explorer_url: explorerUrlForRef(row.payment.ref),
    };
  });
  return {
    schema: 'chit402.book_audit.v1',
    agent_id: Number(agentId),
    exported_at: new Date().toISOString(),
    row_count: rows.length,
    totals: totals || totalsOf(entries),
    policy: policy || null,
    rows,
    attestation_note:
      'On-chain attestation is payment.ref + verify_url + issuer JWS on each receipt. '
      + 'Rows with evidence=UNVERIFIED lack proven payer/payment.ref/amount — never treat as zero payment. '
      + 'RECORDED_BY_SETTLE rows show the recorder claim at settle cutoff; promote to collected with ingress_receipt. '
      + 'ARRIVAL_UNVERIFIED rows are explicit omission at cutoff (no ingress_receipt) — visible, amount null, excluded from totals. '
      + 'inflow_claimed rows carry a signed bucket/allocation (no payment.ref) — corrections are append-only. '
      + 'Verify offline; no separate attestation chain in v1.',
  };
}

/**
 * Print-friendly HTML for audit pack (Print to PDF).
 * @param {object} pack — from buildBookAuditPack
 */
export function renderBookAuditHtml(pack) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = (pack.rows || []).map((r) => `
    <tr>
      <td>${esc(r.evidence)}</td>
      <td>${esc(r.collected_at)}</td>
      <td>${esc(r.hub)}</td>
      <td><code>${esc(r.model)}</code></td>
      <td style="text-align:right;font-family:monospace">${esc(r.amount)}</td>
      <td><a href="${esc(r.explorer_url || '#')}">${esc(r.payment_ref)}</a></td>
      <td><a href="${esc(r.verify_url)}">receipt</a> · <a href="${esc(r.auditor_url)}">auditor</a></td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Book audit — agent ${esc(pack.agent_id)}</title>
<style>
  @media print { body { margin: 0.5in; } }
  body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; max-width: 900px; margin: 2rem auto; }
  h1 { font-size: 1.25rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border-bottom: 1px solid #ddd; padding: 0.4rem 0.5rem; text-align: left; }
  th { font-size: 0.75rem; text-transform: uppercase; color: #666; }
  .meta { color: #666; font-size: 0.85rem; margin: 0.5rem 0 1rem; }
  .note { background: #f5f5f5; padding: 0.75rem; border-radius: 4px; font-size: 0.85rem; margin-top: 1.5rem; }
</style>
</head><body>
<h1>Chit402 book audit — agent ${esc(pack.agent_id)}</h1>
<p class="meta">Exported ${esc(pack.exported_at)} · ${esc(pack.row_count)} rows · schema ${esc(pack.schema)}</p>
<table>
  <thead><tr><th>Evidence</th><th>Time</th><th>Hub</th><th>Model</th><th>Amount (µUSDC)</th><th>Payment</th><th>Links</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="note">${esc(pack.attestation_note)}</p>
</body></html>`;
}

/**
 * Possession-gated book export (CSV, JSON audit pack, or print HTML).
 *
 * @param {number|string} agentId
 * @param {{ session?: string|null, proof?: string|null, limit?: number, format?: string }} claim
 * @param {{ ledger, verify, registry?, policyStore?, baseUrl? }} deps
 */
export function exportAgentBook(agentId, claim = {}, { ledger, verify, registry, policyStore, baseUrl } = {}) {
  const window = clampBookLimit(claim.limit ?? BOOK_MAX_LIMIT);
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

  const format = String(claim.format || 'csv').toLowerCase();
  const entries = ledger.listByAgent(id, { limit: window });
  const policy = typeof policyStore?.get === 'function' ? policyStore.get(id) : null;
  const pubBase = baseUrl || '';

  if (format === 'json') {
    return {
      status: 200,
      contentType: 'application/json',
      body: buildBookAuditPack(entries, id, pubBase, { policy, totals: totalsOf(entries) }),
    };
  }
  if (format === 'html') {
    const pack = buildBookAuditPack(entries, id, pubBase, { policy, totals: totalsOf(entries) });
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: renderBookAuditHtml(pack),
    };
  }
  // default: csv
  return {
    status: 200,
    contentType: 'text/csv; charset=utf-8',
    filename: `chit402-book-${id}.csv`,
    body: buildBookExportCsv(entries, id, pubBase),
  };
}
