/**
 * UsageSettled — append-only record of collected USDC receipts.
 *
 * Dedup on payment.ref and task_id. Demo / unmetered / collected:false
 * write nothing. Collected /v1 and /a2a-message settles append here
 * immediately (hub, model, amount + bookable agent_id) — do not wait
 * for POST /v1/agents/register.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const UNMETERED_RAILS = new Set(['unmetered', 'demo', 'free']);

/** Book/export evidence — never treat missing possession proof as zero payment. */
export const BOOK_EVIDENCE = {
  COLLECTED: 'collected',
  RECORDED_BY_SETTLE: 'RECORDED_BY_SETTLE',
  ARRIVAL_UNVERIFIED: 'ARRIVAL_UNVERIFIED',
  INFLOW_CLAIMED: 'inflow_claimed',
  UNVERIFIED: 'UNVERIFIED',
  POLICY_BLOCKED: 'policy_blocked',
};

/** Arrival sub-state on settle-time rows (recorder ≠ arrival). */
export const ARRIVAL_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  UNVERIFIED: 'unverified',
};

/**
 * True when a ledger row carries ingress / arrival evidence.
 * @param {object} entry
 */
export function hasArrivalEvidence(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.arrival_status === ARRIVAL_STATUS.CONFIRMED) return true;
  const ingress = entry.ingress_receipt;
  if (!ingress || typeof ingress !== 'object') return false;
  const ref = ingress.ref != null ? String(ingress.ref).trim() : '';
  return !!ref;
}

/**
 * Derive export evidence for one ledger row.
 * Recorder-accepted-by-cutoff ≠ arrival-complete — silence must not read as exclusion.
 * @param {object} entry
 * @returns {string}
 */
export function deriveEvidence(entry) {
  if (!entry || typeof entry !== 'object') return BOOK_EVIDENCE.UNVERIFIED;
  if (entry.event === 'policy_blocked' || entry.evidence === BOOK_EVIDENCE.POLICY_BLOCKED) {
    return BOOK_EVIDENCE.POLICY_BLOCKED;
  }
  if (entry.evidence === BOOK_EVIDENCE.UNVERIFIED) {
    return BOOK_EVIDENCE.UNVERIFIED;
  }
  if (entry.inflow_claim && typeof entry.inflow_claim === 'object') {
    return BOOK_EVIDENCE.INFLOW_CLAIMED;
  }
  const ref = entry.payment_ref != null ? String(entry.payment_ref).trim() : '';
  if (!ref) return BOOK_EVIDENCE.UNVERIFIED;
  const amount = entry.amount;
  if (amount == null || String(amount).trim() === '') return BOOK_EVIDENCE.UNVERIFIED;
  if (hasArrivalEvidence(entry)) return BOOK_EVIDENCE.COLLECTED;
  if (entry.arrival_status === ARRIVAL_STATUS.UNVERIFIED) {
    return BOOK_EVIDENCE.ARRIVAL_UNVERIFIED;
  }
  if (entry.recorded_by === 'settle') {
    return BOOK_EVIDENCE.RECORDED_BY_SETTLE;
  }
  return BOOK_EVIDENCE.COLLECTED;
}

/** True when a row may be summed in cap/totals (proven collected USDC). */
export function entryQualifiesForTotals(entry) {
  const evidence = deriveEvidence(entry);
  if (evidence === BOOK_EVIDENCE.INFLOW_CLAIMED) {
    const rail = String(entry.rail || 'usdc').toLowerCase();
    if (UNMETERED_RAILS.has(rail)) return false;
    return entry.collected === true;
  }
  if (evidence !== BOOK_EVIDENCE.COLLECTED) return false;
  const rail = String(entry.rail || '').toLowerCase();
  if (UNMETERED_RAILS.has(rail)) return false;
  return entry.collected === true;
}

/** True when a row counts toward prepaid_ceiling / daily / hourly caps. */
export function entryQualifiesForCap(entry) {
  const evidence = deriveEvidence(entry);
  if (evidence === BOOK_EVIDENCE.POLICY_BLOCKED || evidence === BOOK_EVIDENCE.UNVERIFIED) {
    return false;
  }
  if (evidence === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED) return false;
  if (evidence === BOOK_EVIDENCE.INFLOW_CLAIMED || evidence === BOOK_EVIDENCE.COLLECTED
    || evidence === BOOK_EVIDENCE.RECORDED_BY_SETTLE) {
    const rail = String(entry.rail || 'usdc').toLowerCase();
    if (UNMETERED_RAILS.has(rail)) return false;
    return entry.collected === true;
  }
  return false;
}

export const BOOK_DEFAULT_LIMIT = 50;
export const BOOK_MAX_LIMIT = 200;

/** Default 50, hard max 200. Non-positive / non-numeric → default. */
export function clampBookLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return BOOK_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), BOOK_MAX_LIMIT);
}

function amountOf(payment) {
  if (payment.gross_amount != null && payment.gross_amount !== '') {
    return String(payment.gross_amount);
  }
  if (payment.net_amount != null && payment.net_amount !== '') {
    return String(payment.net_amount);
  }
  return null;
}

/** Hub for the book: explicit route.hub, else model prefix, else provider. */
export function hubOf(route = {}) {
  if (route.hub) return String(route.hub);
  const model = route.model != null ? String(route.model) : '';
  if (model.includes('/')) return model.split('/')[0] || null;
  if (route.provider) return String(route.provider);
  return null;
}

/**
 * True only for a collected USDC (or Solana USDC) receipt that may be ledgered.
 * @param {object} receipt
 */
export function receiptQualifiesForLedger(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, reason: 'receipt required' };
  }
  const payment = receipt.payment || {};
  const rail = String(payment.rail || '').toLowerCase();
  if (UNMETERED_RAILS.has(rail)) {
    return { ok: false, reason: 'demo/unmetered receipt does not qualify' };
  }
  if (payment.collected !== true) {
    return { ok: false, reason: 'receipt is not collected' };
  }
  if (!payment.ref) {
    return { ok: false, reason: 'payment.ref required' };
  }
  if (!receipt.task_id) {
    return { ok: false, reason: 'task_id required' };
  }
  if (rail && rail !== 'usdc' && rail !== 'solana' && !rail.startsWith('solana')) {
    return { ok: false, reason: `rail ${rail} does not qualify` };
  }
  return { ok: true };
}

export class UsageSettledLedger {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {object[]} */
    this.entries = [];
    this.byRef = new Map();
    this.byTask = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'usage-settled: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'usage-settled.jsonl');
  }

  _load() {
    try {
      const text = fs.readFileSync(this._file(), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        this._index(row, { persist: false });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'usage-settled: load failed');
      }
    }
  }

  _index(row, { persist = true } = {}) {
    this.entries.push(row);
    if (row.payment_ref) this.byRef.set(String(row.payment_ref), row);
    if (row.task_id) this.byTask.set(String(row.task_id), row);
    if (persist && this.persist) {
      try {
        fs.appendFileSync(this._file(), `${JSON.stringify(row)}\n`);
      } catch (err) {
        logger.warn({ err: err.message }, 'usage-settled: append failed');
      }
    }
  }

  findByRef(paymentRef) {
    return this.byRef.get(String(paymentRef)) || null;
  }

  findByTask(taskId) {
    return this.byTask.get(String(taskId)) || null;
  }

  /**
   * Append a collected receipt. Returns { ok, entry } or { ok:false, reason, code }.
   * Non-qualifying receipts are refused and write nothing.
   * Prefer a positive agent_id so GET|POST book can list the row.
   * @param {object} receipt
   * @param {{
   *   payer?: string|null,
   *   agentId?: number|null,
   *   parentRef?: string|null,
   *   intentId?: string|null,
   *   attemptIndex?: number|null,
   * }} [opts]
   */
  append(receipt, {
    payer = null,
    agentId = null,
    parentRef = null,
    intentId = null,
    attemptIndex = null,
  } = {}) {
    const q = receiptQualifiesForLedger(receipt);
    if (!q.ok) return { ok: false, reason: q.reason, code: 'not_qualifying' };

    const taskId = String(receipt.task_id);
    const paymentRef = String(receipt.payment.ref);
    if (this.byRef.has(paymentRef)) {
      return { ok: false, reason: 'duplicate payment.ref', code: 'duplicate_ref' };
    }
    if (this.byTask.has(taskId)) {
      return { ok: false, reason: 'duplicate task_id', code: 'duplicate_task' };
    }

    const payment = receipt.payment || {};
    const route = receipt.route || {};
    const id = agentId != null ? Number(agentId) : null;
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'agent_id required for a bookable row', code: 'invalid_agent' };
    }
    const ingress = payment.ingress_receipt || payment.arrival_receipt || null;
    const arrivalConfirmed = ingress && (ingress.ref || ingress.confirmed_at);
    const entry = {
      task_id: taskId,
      payment_ref: paymentRef,
      payer: payer || null,
      agent_id: id,
      collected: true,
      evidence: BOOK_EVIDENCE.COLLECTED,
      arrival_status: arrivalConfirmed ? ARRIVAL_STATUS.CONFIRMED : null,
      ingress_receipt: arrivalConfirmed ? ingress : null,
      rail: String(payment.rail || 'usdc'),
      amount: amountOf(payment),
      collected_at: payment.collected_at || new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: route.model || null,
      hub: hubOf(route),
      parent_ref: parentRef || null,
      intent_id: intentId || null,
      attempt_index: attemptIndex != null ? Number(attemptIndex) : null,
    };
    this._index(entry);
    return { ok: true, entry };
  }

  /**
   * Promote a settle-time row when ingress / arrival evidence arrives.
   * @param {object} entry — existing ledger row (mutated in place)
   * @param {object|null} ingressReceipt
   */
  _applyArrival(entry, ingressReceipt) {
    if (!entry || !ingressReceipt || typeof ingressReceipt !== 'object') return;
    entry.ingress_receipt = ingressReceipt;
    entry.arrival_status = ARRIVAL_STATUS.CONFIRMED;
    entry.evidence = BOOK_EVIDENCE.COLLECTED;
  }

  /**
   * Append an unaffiliated inflow row (no payment.ref). Settle-time signed allocation claim.
   * @param {{
   *   agentId: number,
   *   taskId: string,
   *   bucket: string,
   *   allocation: string,
   *   inflowClaim: object,
   *   model?: string|null,
   *   hub?: string|null,
   *   intentId?: string|null,
   *   attemptIndex?: number|null,
   * }} row
   */
  appendInflow({
    agentId,
    taskId,
    bucket,
    allocation,
    inflowClaim,
    model = null,
    hub = null,
    intentId = null,
    attemptIndex = null,
  }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id', code: 'invalid_agent' };
    }
    const tid = String(taskId || '').trim();
    if (!tid) {
      return { ok: false, reason: 'task_id required', code: 'task_required' };
    }
    if (this.byTask.has(tid)) {
      return { ok: false, reason: 'duplicate task_id', code: 'duplicate_task' };
    }
    const alloc = String(allocation || '').trim();
    if (!alloc) {
      return { ok: false, reason: 'allocation required', code: 'invalid_allocation' };
    }
    const entry = {
      task_id: tid,
      payment_ref: null,
      payer: null,
      agent_id: id,
      collected: true,
      evidence: BOOK_EVIDENCE.INFLOW_CLAIMED,
      recorded_by: 'inflow',
      inflow_claim: inflowClaim,
      inflow_corrections: [],
      bucket: String(bucket || 'patron'),
      amount: alloc,
      rail: 'usdc',
      collected_at: inflowClaim?.as_of || new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: model || null,
      hub: hub || null,
      parent_ref: null,
      intent_id: intentId || null,
      attempt_index: attemptIndex != null ? Number(attemptIndex) : null,
    };
    this._index(entry);
    return { ok: true, entry };
  }

  /**
   * Append-only correction to an inflow row. Never mutates the original claim.
   * @param {string} taskId
   * @param {number} agentId
   * @param {object} correction
   */
  appendInflowCorrection(taskId, agentId, correction) {
    const entry = this.findByTask(String(taskId));
    const id = Number(agentId);
    if (!entry || Number(entry.agent_id) !== id) {
      return { ok: false, reason: 'inflow row not found', code: 'not_found' };
    }
    if (!entry.inflow_claim) {
      return { ok: false, reason: 'not an inflow row', code: 'not_inflow' };
    }
    if (!Array.isArray(entry.inflow_corrections)) entry.inflow_corrections = [];
    entry.inflow_corrections.push(correction);
    if (correction.bucket) entry.bucket = String(correction.bucket);
    if (correction.allocation) entry.amount = String(correction.allocation);
    return { ok: true, entry, correction };
  }

  /**
   * Record a policy-blocked hop (no USDC collected). Visible on GET book.
   * @param {{
   *   agentId: number,
   *   taskId: string,
   *   policyCode: string,
   *   reason: string,
   *   model?: string|null,
   *   hub?: string|null,
   *   intentId?: string|null,
   *   attemptIndex?: number|null,
   * }} row
   */
  recordPolicyBlocked({
    agentId,
    taskId,
    policyCode,
    reason,
    model = null,
    hub = null,
    intentId = null,
    attemptIndex = null,
  }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id', code: 'invalid_agent' };
    }
    const tid = String(taskId || '').trim();
    if (!tid) {
      return { ok: false, reason: 'task_id required', code: 'task_required' };
    }
    if (this.byTask.has(tid)) {
      const existing = this.byTask.get(tid);
      if (existing?.event === 'policy_blocked') {
        return { ok: true, entry: existing, duplicate: true };
      }
      return { ok: false, reason: 'duplicate task_id', code: 'duplicate_task' };
    }
    const entry = {
      task_id: tid,
      payment_ref: null,
      payer: null,
      agent_id: id,
      collected: false,
      evidence: BOOK_EVIDENCE.POLICY_BLOCKED,
      event: 'policy_blocked',
      policy_code: String(policyCode || 'policy_blocked'),
      reason: String(reason || 'policy blocked'),
      rail: null,
      amount: null,
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: model || null,
      hub: hub || null,
      parent_ref: null,
      intent_id: intentId || null,
      attempt_index: attemptIndex != null ? Number(attemptIndex) : null,
    };
    this._index(entry);
    return { ok: true, entry, duplicate: false };
  }

  /** Count book rows (collected + policy_blocked) for one intent under an agent. */
  countAttemptsForIntent(intentId, agentId) {
    const id = Number(agentId);
    const intent = String(intentId || '').trim();
    if (!intent || !Number.isInteger(id) || id < 1) return 0;
    let count = 0;
    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (e.intent_id !== intent) continue;
      if (e.collected === true || e.event === 'policy_blocked') count += 1;
    }
    return count;
  }

  /**
   * All rows sharing an intent_id for one agent (newest last).
   * @param {string} intentId
   * @param {number|string} agentId
   */
  intentAttempts(intentId, agentId) {
    const id = Number(agentId);
    const intent = String(intentId || '').trim();
    const rows = [];
    if (!intent || !Number.isInteger(id) || id < 1) return rows;
    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (e.intent_id !== intent) continue;
      if (e.collected === true || e.event === 'policy_blocked') rows.push(e);
    }
    return rows;
  }

  /**
   * Last-N collected rows for one agent_id. Newest first.
   * Demo / unmetered / collected:false never qualify.
   * @param {number|string} agentId
   * @param {{ limit?: number }} [opts]
   */
  listByAgent(agentId, { limit = 50 } = {}) {
    const id = Number(agentId);
    const n = clampBookLimit(limit);
    const rows = [];
    if (!Number.isInteger(id) || id < 1) return rows;
    for (let i = this.entries.length - 1; i >= 0 && rows.length < n; i--) {
      const e = this.entries[i];
      if (Number(e.agent_id) !== id) continue;
      if (e.event === 'policy_blocked' || deriveEvidence(e) === BOOK_EVIDENCE.POLICY_BLOCKED) {
        rows.push(e);
        continue;
      }
      if (deriveEvidence(e) === BOOK_EVIDENCE.UNVERIFIED) {
        rows.push(e);
        continue;
      }
      if (deriveEvidence(e) === BOOK_EVIDENCE.RECORDED_BY_SETTLE
        || deriveEvidence(e) === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED
        || deriveEvidence(e) === BOOK_EVIDENCE.INFLOW_CLAIMED) {
        rows.push(e);
        continue;
      }
      if (e.collected !== true) continue;
      const rail = String(e.rail || '').toLowerCase();
      if (UNMETERED_RAILS.has(rail)) continue;
      rows.push(e);
    }
    return rows;
  }

  /**
   * Walk lineage for a task: ancestors (via parent_ref) and descendants.
   * Returns { ancestors: [...], descendants: [...], root, self, depth }.
   * A2A disputes need this: A→B→inference is one row-chain.
   * @param {string} taskId
   * @returns {{ ancestors: object[], descendants: object[], root: object|null, self: object|null, depth: number }}
   */
  lineageOf(taskId) {
    const self = this.findByTask(taskId);
    if (!self) {
      return {
        ancestors: [],
        descendants: [],
        root: null,
        self: null,
        depth: 0,
        intent_id: null,
        intent_attempts: [],
      };
    }

    const ancestors = [];
    let current = self;
    while (current?.parent_ref) {
      const parent = this.findByRef(current.parent_ref) || this.findByTask(current.parent_ref);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    const root = ancestors.length > 0 ? ancestors[ancestors.length - 1] : self;

    const descendants = [];
    const selfRef = self.payment_ref;
    const selfTaskId = self.task_id;
    for (const e of this.entries) {
      if (e.parent_ref === selfRef || e.parent_ref === selfTaskId) {
        descendants.push(e);
      }
    }

    let intent_attempts = [];
    if (self.intent_id) {
      intent_attempts = this.intentAttempts(self.intent_id, self.agent_id);
    }

    return {
      ancestors,
      descendants,
      root,
      self,
      depth: ancestors.length,
      intent_id: self.intent_id || null,
      intent_attempts,
    };
  }

  /**
   * Prepaid-ceiling spent: sum of all collected amounts for one agent_id.
   * Demo / unmetered / collected:false never count. Not last-N limited.
   * @param {number|string} agentId
   * @returns {bigint}
   */
  sumCollectedByAgent(agentId) {
    const id = Number(agentId);
    let sum = 0n;
    if (!Number.isInteger(id) || id < 1) return sum;
    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (!entryQualifiesForCap(e)) continue;
      try {
        sum += BigInt(String(e.amount).trim());
      } catch {
        /* skip malformed */
      }
    }
    return sum;
  }

  /**
   * Sum of collected amounts for one agent_id today (UTC midnight to now).
   * For daily cap enforcement.
   * @param {number|string} agentId
   * @returns {bigint}
   */
  sumCollectedByAgentToday(agentId) {
    const id = Number(agentId);
    let sum = 0n;
    if (!Number.isInteger(id) || id < 1) return sum;

    const now = new Date();
    const todayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0, 0, 0, 0,
    ));

    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (!entryQualifiesForCap(e)) continue;

      const collectedAt = new Date(e.collected_at || e.recorded_at);
      if (collectedAt < todayStart) continue;

      try {
        sum += BigInt(String(e.amount).trim());
      } catch {
        /* skip malformed */
      }
    }
    return sum;
  }

  /**
   * Sum of collected amounts for one agent_id in the current clock hour (UTC).
   * For hourly cap enforcement.
   * @param {number|string} agentId
   * @returns {bigint}
   */
  sumCollectedByAgentThisHour(agentId) {
    const id = Number(agentId);
    let sum = 0n;
    if (!Number.isInteger(id) || id < 1) return sum;

    const now = new Date();
    const hourStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0, 0, 0,
    ));

    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (!entryQualifiesForCap(e)) continue;

      const collectedAt = new Date(e.collected_at || e.recorded_at);
      if (collectedAt < hourStart) continue;

      try {
        sum += BigInt(String(e.amount).trim());
      } catch {
        /* skip malformed */
      }
    }
    return sum;
  }

  /**
   * True when any collected row for agent_id lacks payment_ref (audit integrity gap).
   * @param {number|string} agentId
   * @returns {{ has_gap: boolean, task_id?: string }}
   */
  hasIntegrityGapForAgent(agentId) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) return { has_gap: false };

    for (const e of this.entries) {
      if (Number(e.agent_id) !== id) continue;
      if (deriveEvidence(e) === BOOK_EVIDENCE.UNVERIFIED) {
        return { has_gap: true, task_id: e.task_id || null };
      }
    }
    return { has_gap: false };
  }
}

/**
 * Write a book/ledger row at x402 settle time (before inference completes).
 * Stable task_id bound to payment.ref; payer_wallet stored when present.
 * Idempotent on payment.ref / task_id via recordCollectedSpend.
 *
 * @param {{
 *   taskId: string,
 *   paymentRef: string,
 *   amount?: string|null,
 *   payer?: string|null,
 *   model?: string|null,
 *   hub?: string|null,
 *   rail?: string|null,
 *   ledger: UsageSettledLedger,
 *   registry: { allocate: Function, get: Function },
 *   agentId?: number|string|null,
 *   parentRef?: string|null,
 *   intentId?: string|null,
 *   attemptIndex?: number|null,
 * }} row
 */
export function recordSettleBookRow({
  taskId,
  paymentRef,
  amount = null,
  payer = null,
  model = null,
  hub = null,
  rail = 'usdc',
  ledger,
  registry,
  agentId = null,
  parentRef = null,
  intentId = null,
  attemptIndex = null,
} = {}) {
  if (!taskId || !paymentRef) {
    return { ok: false, reason: 'taskId and paymentRef required', code: 'invalid_settle_row' };
  }
  const receipt = {
    task_id: String(taskId),
    payment: {
      rail: String(rail || 'usdc'),
      ref: String(paymentRef),
      collected: true,
      gross_amount: amount != null ? String(amount) : null,
      collected_at: new Date().toISOString(),
    },
    route: {
      model: model || null,
      hub: hub || (model && String(model).includes('/') ? String(model).split('/')[0] : null),
    },
  };
  const result = recordCollectedSpend(receipt, {
    ledger,
    registry,
    payer,
    agentId,
    parentRef,
    intentId,
    attemptIndex,
  });
  if (!result.ok) return result;
  if (result.entry && !result.duplicate) {
    result.entry.recorded_by = 'settle';
    result.entry.evidence = BOOK_EVIDENCE.RECORDED_BY_SETTLE;
    result.entry.arrival_status = ARRIVAL_STATUS.PENDING;
    result.entry.ingress_receipt = null;
  }
  return result;
}

/**
 * Mark a settle-time row as arrival-unverified at cutoff (explicit omission).
 * Silence must not read as exclusion — row stays visible with ARRIVAL_UNVERIFIED.
 * @param {UsageSettledLedger} ledger
 * @param {string} taskId
 * @param {number} agentId
 */
export function markArrivalUnverified(ledger, taskId, agentId) {
  const entry = ledger.findByTask(String(taskId));
  const id = Number(agentId);
  if (!entry || Number(entry.agent_id) !== id) {
    return { ok: false, reason: 'row not found', code: 'not_found' };
  }
  if (entry.recorded_by !== 'settle') {
    return { ok: false, reason: 'not a settle-time row', code: 'not_settle_row' };
  }
  if (hasArrivalEvidence(entry)) {
    return { ok: false, reason: 'arrival already confirmed', code: 'already_confirmed' };
  }
  entry.arrival_status = ARRIVAL_STATUS.UNVERIFIED;
  entry.evidence = BOOK_EVIDENCE.ARRIVAL_UNVERIFIED;
  return { ok: true, entry };
}

/**
 * Record a collected /v1 or /a2a-message settle into UsageSettled.
 * Allocates agent_id + session up front so GET|POST book can read the row
 * without POST /v1/agents/register. Idempotent on payment.ref / task_id.
 *
 * @param {object} receipt
 * @param {{
 *   ledger: UsageSettledLedger,
 *   registry: { allocate: Function, get: Function },
 *   payer?: string|null,
 *   agentId?: number|string|null,
 *   parentRef?: string|null,
 *   intentId?: string|null,
 *   attemptIndex?: number|null,
 * }} deps
 */
export function recordCollectedSpend(receipt, {
  ledger,
  registry,
  payer = null,
  agentId = null,
  parentRef = null,
  intentId = null,
  attemptIndex = null,
} = {}) {
  if (!ledger || !registry || typeof registry.allocate !== 'function') {
    return { ok: false, reason: 'ledger and registry.allocate required', code: 'misconfigured' };
  }
  const q = receiptQualifiesForLedger(receipt);
  if (!q.ok) return { ok: false, reason: q.reason, code: 'not_qualifying' };

  const existing = ledger.findByRef(receipt.payment.ref) || ledger.findByTask(receipt.task_id);
  if (existing) {
    const payment = receipt.payment || {};
    const ingress = payment.ingress_receipt || payment.arrival_receipt || null;
    if (ingress) {
      ledger._applyArrival(existing, ingress);
    }
    const identity = typeof registry.get === 'function' ? registry.get(existing.agent_id) : null;
    return {
      ok: true,
      entry: existing,
      agent_id: existing.agent_id,
      session: identity?.session || null,
      duplicate: true,
    };
  }

  // Reuse a bookable agent_id when the caller presents possession (session).
  // Do not re-allocate an existing live book row.
  let identity = null;
  if (agentId != null && typeof registry.get === 'function') {
    identity = registry.get(agentId);
  }
  if (!identity) {
    identity = registry.allocate({
      taskId: receipt.task_id,
      paymentRef: receipt.payment.ref,
    });
  }
  const credited = ledger.append(receipt, {
    payer,
    agentId: identity.agent_id,
    parentRef,
    intentId,
    attemptIndex,
  });
  if (!credited.ok) {
    return { ok: false, reason: credited.reason, code: credited.code };
  }
  return {
    ok: true,
    entry: credited.entry,
    agent_id: identity.agent_id,
    session: identity.session,
    duplicate: false,
  };
}

let _ledger = null;

export function getUsageSettledLedger(opts) {
  if (!_ledger) _ledger = new UsageSettledLedger(opts);
  return _ledger;
}

export function resetUsageSettledLedger() {
  _ledger = null;
}
