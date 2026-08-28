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
   */
  append(receipt, { payer = null, agentId = null } = {}) {
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
    const entry = {
      task_id: taskId,
      payment_ref: paymentRef,
      payer: payer || null,
      agent_id: id,
      collected: true,
      rail: String(payment.rail || 'usdc'),
      amount: amountOf(payment),
      collected_at: payment.collected_at || new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: route.model || null,
      hub: hubOf(route),
    };
    this._index(entry);
    return { ok: true, entry };
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
      if (e.collected !== true) continue;
      const rail = String(e.rail || '').toLowerCase();
      if (UNMETERED_RAILS.has(rail)) continue;
      rows.push(e);
    }
    return rows;
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
      if (e.collected !== true) continue;
      const rail = String(e.rail || '').toLowerCase();
      if (UNMETERED_RAILS.has(rail)) continue;
      try {
        sum += BigInt(String(e.amount ?? '0').trim() || '0');
      } catch {
        /* skip malformed */
      }
    }
    return sum;
  }
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
 * }} deps
 */
export function recordCollectedSpend(receipt, { ledger, registry, payer = null, agentId = null } = {}) {
  if (!ledger || !registry || typeof registry.allocate !== 'function') {
    return { ok: false, reason: 'ledger and registry.allocate required', code: 'misconfigured' };
  }
  const q = receiptQualifiesForLedger(receipt);
  if (!q.ok) return { ok: false, reason: q.reason, code: 'not_qualifying' };

  const existing = ledger.findByRef(receipt.payment.ref) || ledger.findByTask(receipt.task_id);
  if (existing) {
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
