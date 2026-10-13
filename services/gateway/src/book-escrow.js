/**
 * Book Escrow Helper — ledger escrow beside the possession-gated book.
 *
 * v1 does NOT use an on-chain escrow contract. The hold signal is a collected x402
 * receipt already on the book (USDC moved at payment time). Release verifies
 * settlement + output hash / proof tier when required. Clawback ties into the
 * dispute primitive — outcome stand vs refund is ledger adjudication, not chain claw.
 *
 * Does NOT verify that a closed-weight model ran. Proofs verify settlement metadata.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { persistFailed } from './persist-error.js';
import { CLAIM_TYPES, fileAndAdjudicate, OUTCOME_TYPES } from './book-dispute.js';

export const ESCROW_ACTIONS = {
  OPEN: 'open',
  RELEASE: 'release',
  CLAWBACK: 'clawback',
  STATUS: 'status',
};

export const ESCROW_STATUS = {
  OPEN: 'open',
  RELEASED: 'released',
  CLAWED_BACK: 'clawed_back',
  EXPIRED: 'expired',
};

export const PROOF_TIERS = ['settlement', 'inference'];

const TIER_RANK = { settlement: 1, inference: 2 };

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeHash(value) {
  const s = String(value || '').toLowerCase().replace(/^0x/, '');
  return s;
}

function tierMeets(required, actual) {
  if (!required) return { met: true, reason: 'no tier required' };
  const req = String(required).toLowerCase();
  const act = String(actual || '').toLowerCase();
  if (!PROOF_TIERS.includes(req)) {
    return { met: false, reason: `unknown required tier: ${required}` };
  }
  const reqRank = TIER_RANK[req] || 0;
  const actRank = TIER_RANK[act] || 0;
  if (actRank >= reqRank) {
    return { met: true, reason: `tier ${act || 'none'} meets ${req}` };
  }
  return { met: false, reason: `tier ${act || 'none'} below required ${req}` };
}

export class BookEscrowStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} escrowId → escrow */
    this.escrows = new Map();
    /** @type {Map<string, string>} taskId → escrowId */
    this.byTask = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        throw err?.code === 'persist_failed' ? err : persistFailed(err, 'book-escrow: mkdir failed');
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-escrows.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const e of data.escrows || []) {
        this.escrows.set(e.escrow_id, e);
        if (e.task_id) this.byTask.set(String(e.task_id), e.escrow_id);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'book-escrow: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ escrows: [...this.escrows.values()] }));
      fs.renameSync(tmp, target);
    } catch (err) {
      throw err?.code === 'persist_failed' ? err : persistFailed(err, 'book-escrow: save failed');
    }
  }

  get(escrowId) {
    return this.escrows.get(String(escrowId)) || null;
  }

  getByTask(taskId) {
    const id = this.byTask.get(String(taskId));
    return id ? this.escrows.get(id) : null;
  }

  listByAgent(agentId) {
    const id = Number(agentId);
    return [...this.escrows.values()].filter(e => e.agent_id === id);
  }

  _touchExpiry(escrow) {
    if (escrow.status !== ESCROW_STATUS.OPEN) return escrow;
    if (!escrow.expires_at) return escrow;
    if (Date.now() >= Date.parse(escrow.expires_at)) {
      escrow.status = ESCROW_STATUS.EXPIRED;
      escrow.closed_at = new Date().toISOString();
      escrow.close_reason = 'expired';
      this._save();
    }
    return escrow;
  }
}

/**
 * Verify release conditions against receipt + ledger entry.
 * @param {object} escrow
 * @param {object|null} receipt
 * @param {object|null} entry
 */
export function verifyEscrowRelease(escrow, receipt, entry) {
  const checks = {
    ledger_hold: { checked: false, valid: null, reason: null },
    output_hash: { checked: false, valid: null, reason: null },
    proof_tier: { checked: false, valid: null, reason: null },
  };

  checks.ledger_hold.checked = true;
  if (!entry || !entry.collected) {
    checks.ledger_hold.valid = false;
    checks.ledger_hold.reason = 'no collected ledger entry';
    return { ok: false, checks, reason: checks.ledger_hold.reason };
  }
  checks.ledger_hold.valid = true;
  checks.ledger_hold.reason = `payment_ref ${entry.payment_ref}`;

  const requiredHash = escrow.required?.output_hash;
  if (requiredHash) {
    checks.output_hash.checked = true;
    const actual = receipt?.output?.hash;
    if (!actual) {
      checks.output_hash.valid = false;
      checks.output_hash.reason = 'receipt output hash missing';
      return { ok: false, checks, reason: checks.output_hash.reason };
    }
    const match = normalizeHash(actual) === normalizeHash(requiredHash);
    checks.output_hash.valid = match;
    checks.output_hash.reason = match ? 'hash matches' : 'hash mismatch';
    if (!match) {
      return { ok: false, checks, reason: checks.output_hash.reason };
    }
  }

  const requiredTier = escrow.required?.proof_tier;
  if (requiredTier) {
    checks.proof_tier.checked = true;
    const actualTier = receipt?.proof?.tier
      || receipt?.proof?.zkp_tier
      || receipt?.verified_inference?.tier
      || null;
    const tierCheck = tierMeets(requiredTier, actualTier);
    checks.proof_tier.valid = tierCheck.met;
    checks.proof_tier.reason = tierCheck.reason;
    if (!tierCheck.met) {
      return { ok: false, checks, reason: checks.proof_tier.reason };
    }
  }

  return { ok: true, checks };
}

/**
 * Handle escrow actions (state machine).
 *
 * @param {{
 *   action: string,
 *   agent_id: number,
 *   escrow_id?: string,
 *   task_id?: string,
 *   amount?: string,
 *   expires_at?: string,
 *   required?: { output_hash?: string, proof_tier?: string },
 *   claim_type?: string,
 *   evidence?: object,
 * }} input
 * @param {{
 *   store: BookEscrowStore,
 *   ledger: { findByTask: Function, entries?: object[] },
 *   disputes: import('./book-dispute.js').BookDisputeStore,
 *   loadReceipt?: Function,
 *   verifyReceipt?: Function,
 *   baseUrl?: string,
 * }} deps
 */
export async function handleEscrowAction(input, deps = {}) {
  const { store, ledger, disputes, loadReceipt, verifyReceipt, baseUrl = '' } = deps;
  const action = String(input.action || '').toLowerCase();

  if (!Object.values(ESCROW_ACTIONS).includes(action)) {
    return { ok: false, reason: `invalid action: ${input.action}` };
  }

  if (action === ESCROW_ACTIONS.STATUS) {
    let escrow = null;
    if (input.escrow_id) {
      escrow = store.get(input.escrow_id);
    } else if (input.task_id) {
      escrow = store.getByTask(input.task_id);
    } else {
      return { ok: false, reason: 'escrow_id or task_id required for status' };
    }
    if (!escrow || escrow.agent_id !== Number(input.agent_id)) {
      return { ok: false, reason: 'escrow not found' };
    }
    escrow = store._touchExpiry(escrow);
    return { ok: true, escrow: packEscrowView(escrow, baseUrl) };
  }

  if (action === ESCROW_ACTIONS.OPEN) {
    const taskId = input.task_id ? String(input.task_id) : null;
    if (!taskId) {
      return { ok: false, reason: 'task_id required for open' };
    }

    const required = input.required || {};
    if (!required.output_hash && !required.proof_tier) {
      return { ok: false, reason: 'required.output_hash and/or required.proof_tier required' };
    }
    if (required.proof_tier && !PROOF_TIERS.includes(String(required.proof_tier).toLowerCase())) {
      return { ok: false, reason: `invalid proof_tier: ${required.proof_tier}` };
    }

    const existing = store.getByTask(taskId);
    if (existing && existing.status === ESCROW_STATUS.OPEN) {
      return { ok: false, reason: 'escrow already open for this task', existing };
    }

    const entry = ledger?.findByTask(taskId);
    if (!entry) {
      return { ok: false, reason: 'task not on book — pay via x402 first' };
    }
    if (Number(entry.agent_id) !== Number(input.agent_id)) {
      return { ok: false, reason: 'task not owned by this agent' };
    }
    if (!entry.collected) {
      return { ok: false, reason: 'ledger entry not collected' };
    }

    if (input.amount != null && String(input.amount) !== String(entry.amount || '')) {
      return { ok: false, reason: 'amount does not match ledger entry' };
    }

    let expiresAt = input.expires_at ? String(input.expires_at) : null;
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return { ok: false, reason: 'invalid expires_at' };
    }
    if (!expiresAt) {
      expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MS).toISOString();
    }

    const escrowId = `escrow-${crypto.randomBytes(8).toString('hex')}`;
    const escrow = {
      escrow_id: escrowId,
      agent_id: Number(input.agent_id),
      task_id: taskId,
      amount: String(input.amount ?? entry.amount ?? '0'),
      status: ESCROW_STATUS.OPEN,
      hold: {
        kind: 'ledger',
        payment_ref: entry.payment_ref,
        rail: entry.rail || 'usdc',
        note: 'Funds already settled via x402 at payment time — ledger escrow, not on-chain hold.',
      },
      required: {
        ...(required.output_hash ? { output_hash: String(required.output_hash) } : {}),
        ...(required.proof_tier ? { proof_tier: String(required.proof_tier).toLowerCase() } : {}),
      },
      expires_at: expiresAt,
      opened_at: new Date().toISOString(),
      closed_at: null,
      close_reason: null,
      verification: null,
      dispute_id: null,
      refund_instruction: null,
    };

    store.escrows.set(escrowId, escrow);
    store.byTask.set(taskId, escrowId);
    store._save();

    return { ok: true, escrow: packEscrowView(escrow, baseUrl) };
  }

  const escrowId = input.escrow_id
    || (input.task_id ? store.byTask.get(String(input.task_id)) : null);
  if (!escrowId) {
    return { ok: false, reason: 'escrow_id or task_id required' };
  }

  let escrow = store.get(escrowId);
  if (!escrow || escrow.agent_id !== Number(input.agent_id)) {
    return { ok: false, reason: 'escrow not found' };
  }
  escrow = store._touchExpiry(escrow);

  if (escrow.status !== ESCROW_STATUS.OPEN) {
    return { ok: false, reason: `escrow not open (status: ${escrow.status})`, escrow: packEscrowView(escrow, baseUrl) };
  }

  if (action === ESCROW_ACTIONS.RELEASE) {
    const entry = ledger?.findByTask(escrow.task_id);
    let receipt = null;
    if (loadReceipt) {
      try {
        receipt = await loadReceipt(escrow.task_id);
      } catch {
        receipt = null;
      }
    }

    const verification = verifyEscrowRelease(escrow, receipt, entry);
    if (!verification.ok) {
      return {
        ok: false,
        reason: verification.reason,
        checks: verification.checks,
        escrow: packEscrowView(escrow, baseUrl),
        disclaimer: releaseDisclaimer(),
      };
    }

    if (receipt && verifyReceipt) {
      try {
        const sig = verifyReceipt(receipt);
        verification.checks.receipt_signature = {
          checked: true,
          valid: sig?.valid === true,
          reason: sig?.reason || (sig?.valid ? 'valid' : 'invalid'),
        };
      } catch (err) {
        verification.checks.receipt_signature = {
          checked: true,
          valid: false,
          reason: err.message,
        };
      }
    }

    escrow.status = ESCROW_STATUS.RELEASED;
    escrow.closed_at = new Date().toISOString();
    escrow.close_reason = 'principal_release';
    escrow.verification = verification.checks;
    store._save();

    return {
      ok: true,
      escrow: packEscrowView(escrow, baseUrl),
      checks: verification.checks,
      disclaimer: releaseDisclaimer(),
    };
  }

  if (action === ESCROW_ACTIONS.CLAWBACK) {
    const claimType = input.claim_type || CLAIM_TYPES.OUTPUT_MISSING;
    if (!Object.values(CLAIM_TYPES).includes(claimType)) {
      return { ok: false, reason: `invalid claim_type: ${claimType}` };
    }

    const disputeResult = await fileAndAdjudicate({
      agent_id: input.agent_id,
      task_id: escrow.task_id,
      claim_type: claimType,
      evidence: input.evidence || {},
    }, { disputes, ledger, loadReceipt, verifyReceipt });

    let refundInstruction = null;
    if (disputeResult.ok && disputeResult.dispute) {
      escrow.dispute_id = disputeResult.dispute.dispute_id;
      const outcome = disputeResult.dispute.outcome;
      if (outcome === OUTCOME_TYPES.REFUND || outcome === OUTCOME_TYPES.PARTIAL) {
        refundInstruction = {
          kind: 'ledger_adjudication',
          outcome,
          amount: disputeResult.dispute.outcome_amount,
          note: 'Ledger escrow: USDC already moved at x402 payment. Refund requires treasury/float credit — not automatic on-chain claw in v1.',
        };
      } else if (outcome === OUTCOME_TYPES.STAND) {
        refundInstruction = {
          kind: 'stand',
          outcome,
          note: 'Dispute adjudication: charge stands. No refund instruction.',
        };
      } else {
        refundInstruction = {
          kind: 'pending',
          outcome,
          note: 'Dispute pending manual review.',
        };
      }
    }

    escrow.status = ESCROW_STATUS.CLAWED_BACK;
    escrow.closed_at = new Date().toISOString();
    escrow.close_reason = `clawback:${claimType}`;
    escrow.refund_instruction = refundInstruction;
    store._save();

    return {
      ok: true,
      escrow: packEscrowView(escrow, baseUrl),
      dispute: disputeResult.dispute || null,
      checks: disputeResult.checks || null,
      disclaimer: clawbackDisclaimer(),
    };
  }

  return { ok: false, reason: 'unhandled action' };
}

function releaseDisclaimer() {
  return 'Release verifies settlement metadata (payment binding, output hash, proof tier). '
    + 'It does not prove a closed-weight model ran the requested computation.';
}

function clawbackDisclaimer() {
  return 'Clawback runs ledger dispute adjudication against the collected receipt. '
    + 'v1 ledger escrow does not pull USDC back on-chain automatically.';
}

function packEscrowView(escrow, baseUrl) {
  const verifyUrl = baseUrl
    ? `${String(baseUrl).replace(/\/$/, '')}/receipt/${escrow.task_id}`
    : null;
  return {
    ...escrow,
    verify_url: verifyUrl,
    ledger_escrow: true,
  };
}

let _escrowStore = null;

export function getBookEscrowStore(opts) {
  if (!_escrowStore) _escrowStore = new BookEscrowStore(opts);
  return _escrowStore;
}

export function resetBookEscrowStore() {
  _escrowStore = null;
}

export default {
  BookEscrowStore,
  ESCROW_ACTIONS,
  ESCROW_STATUS,
  PROOF_TIERS,
  verifyEscrowRelease,
  handleEscrowAction,
  getBookEscrowStore,
  resetBookEscrowStore,
};
