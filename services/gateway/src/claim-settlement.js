/**
 * Single-use claim close.
 *
 * A claim_id is open until the first receipt settles it. The transition is
 * open → settled, and it does not move back. A second receipt with a different
 * task or payment is `claim_already_settled`. The same task_id and payment ref
 * returns the stored receipt.
 *
 * The gateway ledger is a JSON file, not a SQL database. The commit is still
 * one critical section: concurrent callers queue on `settle`, and the map
 * update (plus the atomic rename when a file is set) finishes before the next
 * caller reads. There is no check-then-write gap between those two steps.
 *
 * The book seat signed on a payment receipt is the agent id. Many receipts
 * share that seat. This store is the close of a settlement claim, not a second
 * copy of the book. `recordCollectedSpend` consults it when `singleUseClaim`
 * is set, or when the receipt's claim_id is not that seat.
 */

import fs from 'fs';
import path from 'path';

export const CLAIM_ALREADY_SETTLED = 'claim_already_settled';

/** Non-empty claim id. Book seats and free-form settlement ids both qualify. */
export function settlementClaimId(value) {
  if (value == null || typeof value === 'object') return null;
  const text = String(value).trim();
  return text ? text : null;
}

export class ClaimSettlementStore {
  /**
   * @param {{ file?: string|null }} [opts]
   */
  constructor({ file = null } = {}) {
    this.file = file ? String(file) : null;
    /** @type {Map<string, { claim_id: string, state: 'settled', task_id: string, payment_ref: string, receipt: object|null }>} */
    this.rows = new Map();
    this._chain = Promise.resolve();
    /** Test hook. Awaited inside the lock, before the read-and-write. */
    this.beforeWrite = null;
    if (this.file) this._load();
  }

  /**
   * Queue a close. Concurrent calls cannot both observe `open`.
   * @param {{ claimId: unknown, taskId: unknown, paymentRef: unknown, receipt?: object|null }} input
   */
  settle(input) {
    const run = this._chain.then(() => this._commit(input));
    this._chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Synchronous close for the ledger path. Same commit as `settle`.
   * Callers must not await between their own check and this call.
   */
  settleSync(input) {
    return this._commitSync(input);
  }

  async _commit(input) {
    if (typeof this.beforeWrite === 'function') await this.beforeWrite();
    return this._commitSync(input);
  }

  _commitSync({ claimId, taskId, paymentRef, receipt = null } = {}) {
    const id = settlementClaimId(claimId);
    const task = taskId == null ? '' : String(taskId).trim();
    const ref = paymentRef == null ? '' : String(paymentRef).trim();
    if (!id || !task || !ref) {
      return {
        ok: false,
        code: 'invalid_claim',
        reason: 'claim_id, task_id, and payment ref are required',
      };
    }

    const existing = this.rows.get(id);
    if (existing) {
      if (existing.state === 'settled' && existing.task_id === task && existing.payment_ref === ref) {
        return {
          ok: true,
          idempotent: true,
          state: 'settled',
          receipt: existing.receipt,
          row: existing,
        };
      }
      return {
        ok: false,
        code: CLAIM_ALREADY_SETTLED,
        reason: 'claim_id is already settled',
        state: existing.state,
        receipt: existing.receipt,
        row: existing,
      };
    }

    const row = {
      claim_id: id,
      state: 'settled',
      task_id: task,
      payment_ref: ref,
      receipt: receipt ?? null,
    };
    this.rows.set(id, row);
    try {
      this._persist();
    } catch (err) {
      this.rows.delete(id);
      return { ok: false, code: 'claim_persist_failed', reason: err.message };
    }
    return { ok: true, idempotent: false, state: 'settled', receipt: row.receipt, row };
  }

  /**
   * Drop a close that this task just wrote, when the book append did not stick.
   * Does not reopen a claim closed by a different receipt.
   * @param {unknown} claimId
   * @param {{ taskId?: unknown, paymentRef?: unknown }} [match]
   * @returns {boolean}
   */
  release(claimId, { taskId, paymentRef } = {}) {
    const id = settlementClaimId(claimId);
    const row = id ? this.rows.get(id) : null;
    if (!row) return false;
    if (String(row.task_id) !== String(taskId) || String(row.payment_ref) !== String(paymentRef)) {
      return false;
    }
    this.rows.delete(id);
    try {
      this._persist();
    } catch (err) {
      this.rows.set(id, row);
      return false;
    }
    return true;
  }

  _persist() {
    if (!this.file) return;
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const body = JSON.stringify({ claims: [...this.rows.values()] });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file);
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
    for (const row of claims) {
      const id = settlementClaimId(row?.claim_id);
      if (!id || row.state !== 'settled' || !row.task_id || !row.payment_ref) continue;
      if (this.rows.has(id)) continue;
      this.rows.set(id, {
        claim_id: id,
        state: 'settled',
        task_id: String(row.task_id),
        payment_ref: String(row.payment_ref),
        receipt: row.receipt ?? null,
      });
    }
  }
}

/**
 * True when this receipt must close its claim_id once.
 * The book seat (claim_id === agent_id) is shared by every receipt in the book,
 * so a second spend is not a second close. `singleUseClaim: true` closes even
 * that seat. `singleUseClaim: false` never closes.
 */
export function shouldCloseClaim(receipt, agentId, singleUseClaim) {
  if (singleUseClaim === false) return false;
  const claimKey = settlementClaimId(receipt?.claim_id);
  if (!claimKey) return false;
  if (singleUseClaim === true) return true;
  const seat = settlementClaimId(agentId);
  return !seat || claimKey !== seat;
}
