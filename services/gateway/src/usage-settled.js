/**
 * UsageSettled — append-only record of collected USDC receipts.
 *
 * Dedup on payment.ref and task_id. Demo / unmetered / collected:false
 * write nothing.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const UNMETERED_RAILS = new Set(['unmetered', 'demo', 'free']);

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

    const entry = {
      task_id: taskId,
      payment_ref: paymentRef,
      payer: payer || null,
      agent_id: agentId != null ? Number(agentId) : null,
      collected: true,
      rail: String(receipt.payment.rail || 'usdc'),
      recorded_at: new Date().toISOString(),
    };
    this._index(entry);
    return { ok: true, entry };
  }
}

let _ledger = null;

export function getUsageSettledLedger(opts) {
  if (!_ledger) _ledger = new UsageSettledLedger(opts);
  return _ledger;
}

export function resetUsageSettledLedger() {
  _ledger = null;
}
