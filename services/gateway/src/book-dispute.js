/**
 * Book Dispute — MVP dispute primitive for possession-gated book.
 *
 * Buyer posts receipt + claim type: output missing / wrong model / double charge.
 * Recheck payment binding + output hash. Outcome is another row: refund, partial, or stand.
 * For A2A, lineage is the evidence pack.
 *
 * Not a courtroom. One flow a launchpad can point to for a ~$40 job disagreement.
 *
 * Claim types:
 *   output_missing — output was not delivered
 *   wrong_model    — model served ≠ model requested
 *   double_charge  — same payment ref charged twice
 *
 * Outcome types:
 *   refund  — full refund (amount credited back)
 *   partial — partial refund (split amount)
 *   stand   — dispute rejected, charge stands
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

export const CLAIM_TYPES = {
  OUTPUT_MISSING: 'output_missing',
  WRONG_MODEL: 'wrong_model',
  DOUBLE_CHARGE: 'double_charge',
};

export const OUTCOME_TYPES = {
  REFUND: 'refund',
  PARTIAL: 'partial',
  STAND: 'stand',
  PENDING: 'pending',
};

export class BookDisputeStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} disputeId → dispute object */
    this.disputes = new Map();
    /** @type {Map<string, string>} taskId → disputeId (for dedup) */
    this.byTask = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'book-dispute: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-disputes.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const d of data.disputes || []) {
        this.disputes.set(d.dispute_id, d);
        if (d.task_id) this.byTask.set(d.task_id, d.dispute_id);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'book-dispute: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      const disputes = [...this.disputes.values()];
      fs.writeFileSync(tmp, JSON.stringify({ disputes }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'book-dispute: save failed');
    }
  }

  /**
   * Get a dispute by ID.
   * @param {string} disputeId
   */
  get(disputeId) {
    return this.disputes.get(String(disputeId)) || null;
  }

  /**
   * Get a dispute by task_id.
   * @param {string} taskId
   */
  getByTask(taskId) {
    const disputeId = this.byTask.get(String(taskId));
    return disputeId ? this.disputes.get(disputeId) : null;
  }

  /**
   * List disputes for an agent.
   * @param {number|string} agentId
   */
  listByAgent(agentId) {
    const id = Number(agentId);
    return [...this.disputes.values()].filter(d => d.agent_id === id);
  }

  /**
   * File a dispute. Returns the dispute object.
   * @param {{
   *   agent_id: number,
   *   task_id: string,
   *   claim_type: string,
   *   evidence?: object,
   * }} claim
   */
  file(claim) {
    const { agent_id, task_id, claim_type, evidence = {} } = claim;

    if (!task_id) {
      return { ok: false, reason: 'task_id required' };
    }
    if (!claim_type || !Object.values(CLAIM_TYPES).includes(claim_type)) {
      return { ok: false, reason: `invalid claim_type: ${claim_type}` };
    }

    const existing = this.getByTask(task_id);
    if (existing) {
      return { ok: false, reason: 'dispute already filed for this task', existing };
    }

    const disputeId = `dispute-${crypto.randomBytes(8).toString('hex')}`;
    const dispute = {
      dispute_id: disputeId,
      agent_id: Number(agent_id),
      task_id: String(task_id),
      claim_type,
      evidence: evidence || {},
      outcome: OUTCOME_TYPES.PENDING,
      outcome_reason: null,
      outcome_amount: null,
      filed_at: new Date().toISOString(),
      resolved_at: null,
    };

    this.disputes.set(disputeId, dispute);
    this.byTask.set(String(task_id), disputeId);
    this._save();

    return { ok: true, dispute };
  }

  /**
   * Resolve a dispute with an outcome.
   * @param {string} disputeId
   * @param {{ outcome: string, reason?: string, amount?: string }} resolution
   */
  resolve(disputeId, { outcome, reason = null, amount = null } = {}) {
    const dispute = this.disputes.get(String(disputeId));
    if (!dispute) {
      return { ok: false, reason: 'dispute not found' };
    }
    if (dispute.outcome !== OUTCOME_TYPES.PENDING) {
      return { ok: false, reason: 'dispute already resolved' };
    }
    if (!Object.values(OUTCOME_TYPES).includes(outcome) || outcome === OUTCOME_TYPES.PENDING) {
      return { ok: false, reason: `invalid outcome: ${outcome}` };
    }

    dispute.outcome = outcome;
    dispute.outcome_reason = reason;
    dispute.outcome_amount = amount;
    dispute.resolved_at = new Date().toISOString();
    this._save();

    return { ok: true, dispute };
  }
}

/**
 * Recheck payment binding and output hash for a dispute.
 *
 * @param {object} dispute - The dispute object
 * @param {{
 *   ledger: { findByTask: Function, findByRef: Function },
 *   loadReceipt?: Function,
 *   verifyReceipt?: Function,
 * }} deps
 */
export async function recheckDispute(dispute, { ledger, loadReceipt, verifyReceipt } = {}) {
  const checks = {
    payment_binding: { checked: false, valid: null, reason: null },
    output_hash: { checked: false, valid: null, reason: null },
    model_match: { checked: false, valid: null, reason: null },
    duplicate: { checked: false, valid: null, reason: null },
  };

  const entry = ledger?.findByTask(dispute.task_id);
  if (!entry) {
    return {
      ok: false,
      reason: 'ledger entry not found',
      checks,
      suggested_outcome: OUTCOME_TYPES.STAND,
    };
  }

  let receipt = null;
  if (loadReceipt) {
    try {
      receipt = await loadReceipt(dispute.task_id);
    } catch {
      receipt = null;
    }
  }

  if (dispute.claim_type === CLAIM_TYPES.DOUBLE_CHARGE) {
    checks.duplicate.checked = true;
    const byRef = ledger.findByRef(entry.payment_ref);
    const allWithRef = [];
    for (const e of ledger.entries || []) {
      if (e.payment_ref === entry.payment_ref) allWithRef.push(e);
    }
    if (allWithRef.length > 1) {
      checks.duplicate.valid = false;
      checks.duplicate.reason = `payment_ref ${entry.payment_ref} appears ${allWithRef.length} times`;
      return {
        ok: true,
        checks,
        suggested_outcome: OUTCOME_TYPES.REFUND,
        refund_amount: entry.amount,
      };
    } else {
      checks.duplicate.valid = true;
      checks.duplicate.reason = 'no duplicate found';
    }
  }

  if (receipt && verifyReceipt) {
    checks.payment_binding.checked = true;
    try {
      const verification = verifyReceipt(receipt);
      checks.payment_binding.valid = verification?.valid === true;
      checks.payment_binding.reason = verification?.reason || (verification?.valid ? 'signature valid' : 'signature invalid');
    } catch (err) {
      checks.payment_binding.valid = false;
      checks.payment_binding.reason = err.message;
    }
  }

  if (dispute.claim_type === CLAIM_TYPES.OUTPUT_MISSING) {
    checks.output_hash.checked = true;
    if (receipt?.output?.hash) {
      checks.output_hash.valid = true;
      checks.output_hash.reason = 'output hash present';
    } else {
      checks.output_hash.valid = false;
      checks.output_hash.reason = 'output hash missing';
      return {
        ok: true,
        checks,
        suggested_outcome: OUTCOME_TYPES.REFUND,
        refund_amount: entry.amount,
      };
    }
  }

  if (dispute.claim_type === CLAIM_TYPES.WRONG_MODEL) {
    checks.model_match.checked = true;
    const requested = dispute.evidence?.requested_model;
    const served = entry.model || receipt?.route?.model;
    if (!requested) {
      checks.model_match.valid = null;
      checks.model_match.reason = 'requested_model not in evidence';
    } else if (!served) {
      checks.model_match.valid = false;
      checks.model_match.reason = 'served model unknown';
      return {
        ok: true,
        checks,
        suggested_outcome: OUTCOME_TYPES.PARTIAL,
        refund_amount: String(BigInt(entry.amount || '0') / 2n),
      };
    } else if (normalizeModel(requested) !== normalizeModel(served)) {
      checks.model_match.valid = false;
      checks.model_match.reason = `requested ${requested} ≠ served ${served}`;
      return {
        ok: true,
        checks,
        suggested_outcome: OUTCOME_TYPES.PARTIAL,
        refund_amount: String(BigInt(entry.amount || '0') / 2n),
      };
    } else {
      checks.model_match.valid = true;
      checks.model_match.reason = 'model matches';
    }
  }

  return {
    ok: true,
    checks,
    suggested_outcome: OUTCOME_TYPES.STAND,
    refund_amount: null,
  };
}

function normalizeModel(model) {
  return String(model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * File and auto-adjudicate a dispute.
 *
 * @param {{
 *   agent_id: number,
 *   task_id: string,
 *   claim_type: string,
 *   evidence?: object,
 * }} claim
 * @param {{
 *   disputes: BookDisputeStore,
 *   ledger: { findByTask: Function, findByRef: Function, entries?: object[] },
 *   loadReceipt?: Function,
 *   verifyReceipt?: Function,
 * }} deps
 */
export async function fileAndAdjudicate(claim, { disputes, ledger, loadReceipt, verifyReceipt } = {}) {
  const filed = disputes.file(claim);
  if (!filed.ok) {
    return filed;
  }

  const recheck = await recheckDispute(filed.dispute, { ledger, loadReceipt, verifyReceipt });

  if (recheck.suggested_outcome && recheck.suggested_outcome !== OUTCOME_TYPES.PENDING) {
    const resolved = disputes.resolve(filed.dispute.dispute_id, {
      outcome: recheck.suggested_outcome,
      reason: Object.entries(recheck.checks)
        .filter(([, v]) => v.checked)
        .map(([k, v]) => `${k}: ${v.reason}`)
        .join('; '),
      amount: recheck.refund_amount,
    });
    return {
      ok: true,
      dispute: resolved.dispute,
      checks: recheck.checks,
      auto_adjudicated: true,
    };
  }

  return {
    ok: true,
    dispute: filed.dispute,
    checks: recheck.checks,
    auto_adjudicated: false,
  };
}

let _disputeStore = null;

export function getBookDisputeStore(opts) {
  if (!_disputeStore) _disputeStore = new BookDisputeStore(opts);
  return _disputeStore;
}

export function resetBookDisputeStore() {
  _disputeStore = null;
}

export default {
  BookDisputeStore,
  CLAIM_TYPES,
  OUTCOME_TYPES,
  recheckDispute,
  fileAndAdjudicate,
  getBookDisputeStore,
  resetBookDisputeStore,
};
