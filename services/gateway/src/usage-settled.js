/**
 * UsageSettled — append-only record of collected USDC receipts.
 *
 * Dedup on payment.ref and task_id. Demo / unmetered / collected:false
 * write nothing. Collected /v1 and /a2a-message settles append here
 * immediately (hub, model, amount + bookable agent_id) — do not wait
 * for POST /v1/agents/register.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { paymentRefIndexKey } from './payment-ref.js';
import { bookFulfillmentRowOf } from './fulfillment-receipt.js';
import { bookRowHash, signBookSeq, analyzeSeq } from './book-seq.js';
import { actOf } from './book-act.js';
import { refusalAnchorOrUnavailable } from './refusal-anchor.js';
import { issueRefusalReceipt } from './refusal-receipt.js';
import { bodyCommitmentHex, claimIdempotency, isRequestBindingError, requestDigest, requestSalt, refusalMatchesRequest, saltReceiptId, saltRecoverable } from './request-binding.js';
import { scrubLedgerRow } from './v11-seal.js';
import { summarizeSupersession, supersessionForRow } from './supersession-fork.js';
import {
  ClaimSettlementStore,
  shouldCloseClaim,
  CLAIM_ALREADY_SETTLED,
} from './claim-settlement.js';

export { CLAIM_ALREADY_SETTLED };

/** Optional async hook when a new book row is indexed (not on load/replay). */
let bookRowWrittenHook = null;
export function setBookRowWrittenHook(fn) {
  bookRowWrittenHook = typeof fn === 'function' ? fn : null;
}

/**
 * After a new book row is indexed (and the merkle hook has appended the leaf).
 * Receives the receipt object that was appended, so a v9 signature can bind
 * the prefix root that now includes that leaf.
 */
let receiptBoundHook = null;
export function setReceiptBoundHook(fn) {
  receiptBoundHook = typeof fn === 'function' ? fn : null;
}

function emitBookRowWritten(entry) {
  if (bookRowWrittenHook) {
    try {
      bookRowWrittenHook(entry);
    } catch (err) {
      logger.warn({ err: err.message, taskId: entry?.task_id }, 'book row written hook failed');
    }
  }
}

function emitReceiptBound(receipt, entry) {
  if (!receiptBoundHook) return;
  try {
    receiptBoundHook(receipt, entry);
  } catch (err) {
    logger.warn({ err: err.message, taskId: entry?.task_id }, 'receipt bound hook failed');
  }
}

const UNMETERED_RAILS = new Set(['unmetered', 'demo', 'free']);

/** Book/export evidence — never treat missing possession proof as zero payment. */
export const BOOK_EVIDENCE = {
  COLLECTED: 'collected',
  /** On-chain verified spend recorded via POST book/ingest — Chit did not execute the hop. */
  FOREIGN_INGEST: 'foreign_ingest',
  RECORDED_BY_SETTLE: 'RECORDED_BY_SETTLE',
  ARRIVAL_UNVERIFIED: 'ARRIVAL_UNVERIFIED',
  INFLOW_CLAIMED: 'inflow_claimed',
  UNVERIFIED: 'UNVERIFIED',
  POLICY_BLOCKED: 'policy_blocked',
  /** A2A escrow / machine dispute phase row — exportable, non-spend. */
  A2A_ESCROW: 'a2a_escrow',
  /**
   * Board stamp ($0.002). On the book, not debited from prepaid budget.
   * board_bid, board_pick, and board_close are the bid-board book rows.
   */
  BOARD_STAMP: 'board_stamp',
  /** Board publish / takedown audit. Non-spend. The note stays on the board store. */
  BOARD_POST: 'board_post',
  /** Board comment audit. Non-spend. The text stays on the board store. */
  BOARD_COMMENT: 'board_comment',
  /** Ops hide (and later ops actions). Audit only. */
  BOARD_OPS: 'board_ops',
  /** Bid stamp's sibling audit row. Non-spend. */
  BOARD_BID: 'board_bid',
  /** Poster awarded a bid. Free. Non-spend. */
  BOARD_PICK: 'board_pick',
  /** Payout receipt landed on a book. The USDC moved payee-direct, so it is not prepaid spend. */
  BOARD_CLOSE: 'board_close',
  /** Settled USDC, nothing served. Visible on the book; excluded from spend totals. */
  REFUND_OWED: 'refund_owed',
  /**
   * The $0.002 ingest stamp. Its own row so the stamp tx is signed with the
   * book id. Not prepaid spend.
   */
  INGEST_STAMP: 'ingest_stamp',
  /** OpenRouter Broadcast report. Visible on the book; Chit did not settle it. */
  OPENROUTER_REPORTED: 'openrouter_reported',
};

/** Arrival sub-state on settle-time rows (recorder ≠ arrival). */
export const ARRIVAL_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  UNVERIFIED: 'unverified',
};

/** Treasury settlement outcome on collect / register replay. */
export const SETTLEMENT_STATUS = {
  SETTLED: 'settled',
  IDEMPOTENT_REPLAY: 'idempotent_replay',
};

/**
 * Record an idempotent replay audit event on the canonical ledger row.
 * Does not double-count amounts — replay_events are evidence only.
 * @param {object} entry — existing ledger row (mutated in place)
 */
export function noteIdempotentReplay(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!Array.isArray(entry.replay_events)) entry.replay_events = [];
  entry.replay_events.push({
    at: new Date().toISOString(),
    settlement_status: SETTLEMENT_STATUS.IDEMPOTENT_REPLAY,
    replay_of: entry.task_id,
  });
  return entry;
}

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
  if (entry.refund_status === 'owed' || entry.evidence === BOOK_EVIDENCE.REFUND_OWED) {
    return BOOK_EVIDENCE.REFUND_OWED;
  }
  if (entry.event === 'inflow_correction' || entry.evidence === 'inflow_correction') {
    return 'inflow_correction';
  }
  if (entry.event === 'policy_blocked' || entry.evidence === BOOK_EVIDENCE.POLICY_BLOCKED) {
    return BOOK_EVIDENCE.POLICY_BLOCKED;
  }
  if (entry.event === 'a2a_escrow' || entry.evidence === BOOK_EVIDENCE.A2A_ESCROW) {
    return BOOK_EVIDENCE.A2A_ESCROW;
  }
  if (entry.event === 'ingest_stamp' || entry.evidence === BOOK_EVIDENCE.INGEST_STAMP) {
    return BOOK_EVIDENCE.INGEST_STAMP;
  }
  if (entry.event === 'board_stamp' || entry.evidence === BOOK_EVIDENCE.BOARD_STAMP) {
    return BOOK_EVIDENCE.BOARD_STAMP;
  }
  if (entry.event === 'board_post' || entry.evidence === BOOK_EVIDENCE.BOARD_POST) {
    return BOOK_EVIDENCE.BOARD_POST;
  }
  if (entry.event === 'board_comment' || entry.evidence === BOOK_EVIDENCE.BOARD_COMMENT) {
    return BOOK_EVIDENCE.BOARD_COMMENT;
  }
  if (entry.event === 'board_ops' || entry.evidence === BOOK_EVIDENCE.BOARD_OPS) {
    return BOOK_EVIDENCE.BOARD_OPS;
  }
  if (entry.event === 'board_bid' || entry.evidence === BOOK_EVIDENCE.BOARD_BID) {
    return BOOK_EVIDENCE.BOARD_BID;
  }
  if (entry.event === 'board_pick' || entry.evidence === BOOK_EVIDENCE.BOARD_PICK) {
    return BOOK_EVIDENCE.BOARD_PICK;
  }
  if (entry.event === 'board_close' || entry.evidence === BOOK_EVIDENCE.BOARD_CLOSE) {
    return BOOK_EVIDENCE.BOARD_CLOSE;
  }
  if (entry.evidence === BOOK_EVIDENCE.UNVERIFIED) {
    return BOOK_EVIDENCE.UNVERIFIED;
  }
  if (entry.evidence === BOOK_EVIDENCE.OPENROUTER_REPORTED
    || entry.source === 'openrouter_broadcast'
    || String(entry.rail || '').toLowerCase() === 'reported') {
    return BOOK_EVIDENCE.OPENROUTER_REPORTED;
  }
  if (entry.evidence === BOOK_EVIDENCE.FOREIGN_INGEST || entry.source === 'foreign_ingest') {
    return BOOK_EVIDENCE.FOREIGN_INGEST;
  }
  if (entry.inflow_claim && typeof entry.inflow_claim === 'object') {
    return BOOK_EVIDENCE.INFLOW_CLAIMED;
  }
  const ref = entry.payment_ref != null ? String(entry.payment_ref).trim() : '';
  if (!ref) return BOOK_EVIDENCE.UNVERIFIED;
  const amount = entry.amount;
  if (amount == null || String(amount).trim() === '') return BOOK_EVIDENCE.UNVERIFIED;
  if (hasArrivalEvidence(entry)) return BOOK_EVIDENCE.COLLECTED;
  // A paid call that already finished is collected even when the row was
  // left as arrival-pending. Chit never writes a separate ingress receipt.
  if (entry.recorded_by === 'settle' && entry.fulfillment_closed === true) {
    return BOOK_EVIDENCE.COLLECTED;
  }
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
  if (evidence !== BOOK_EVIDENCE.COLLECTED && evidence !== BOOK_EVIDENCE.FOREIGN_INGEST) {
    return false;
  }
  const rail = String(entry.rail || '').toLowerCase();
  if (UNMETERED_RAILS.has(rail)) return false;
  return entry.collected === true;
}

/**
 * True when a row counts toward prepaid_ceiling / daily / hourly caps.
 * Nano raw is not USDC atomic — summing it would exhaust any ceiling — so
 * a nano row is recorded on the book and omitted from the USDC spent total.
 */
export function entryQualifiesForCap(entry) {
  const railEarly = String(entry?.rail || '').toLowerCase();
  if (railEarly === 'nano' || railEarly === 'reported') return false;
  const evidence = deriveEvidence(entry);
  if (evidence === BOOK_EVIDENCE.POLICY_BLOCKED || evidence === BOOK_EVIDENCE.UNVERIFIED
    || evidence === BOOK_EVIDENCE.A2A_ESCROW || evidence === BOOK_EVIDENCE.REFUND_OWED
    || evidence === BOOK_EVIDENCE.OPENROUTER_REPORTED
    || evidence === BOOK_EVIDENCE.INGEST_STAMP
    || evidence === BOOK_EVIDENCE.BOARD_STAMP
    || evidence === BOOK_EVIDENCE.BOARD_POST
    || evidence === BOOK_EVIDENCE.BOARD_COMMENT
    || evidence === BOOK_EVIDENCE.BOARD_OPS
    || evidence === BOOK_EVIDENCE.BOARD_BID
    || evidence === BOOK_EVIDENCE.BOARD_PICK
    || evidence === BOOK_EVIDENCE.BOARD_CLOSE) {
    return false;
  }
  if (evidence === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED) return false;
  if (evidence === BOOK_EVIDENCE.INFLOW_CLAIMED || evidence === BOOK_EVIDENCE.COLLECTED
    || evidence === BOOK_EVIDENCE.FOREIGN_INGEST
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

/**
 * True when a ledger row is shown on the possession book and on exports.
 * Demo, unmetered, and collected:false spend rows stay off the book.
 * Policy blocks, inflow, refunds, board, and A2A rows stay on.
 * @param {object} entry
 */
export function entryVisibleOnBook(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.event === 'inflow_correction' || deriveEvidence(entry) === 'inflow_correction') return true;
  if (entry.event === 'policy_blocked' || deriveEvidence(entry) === BOOK_EVIDENCE.POLICY_BLOCKED) return true;
  if (entry.event === 'a2a_escrow' || deriveEvidence(entry) === BOOK_EVIDENCE.A2A_ESCROW) return true;
  const boardEvidence = deriveEvidence(entry);
  if (boardEvidence === BOOK_EVIDENCE.INGEST_STAMP) return true;
  if (boardEvidence === BOOK_EVIDENCE.BOARD_STAMP
    || boardEvidence === BOOK_EVIDENCE.BOARD_POST
    || boardEvidence === BOOK_EVIDENCE.BOARD_COMMENT
    || boardEvidence === BOOK_EVIDENCE.BOARD_OPS
    || boardEvidence === BOOK_EVIDENCE.BOARD_BID
    || boardEvidence === BOOK_EVIDENCE.BOARD_PICK
    || boardEvidence === BOOK_EVIDENCE.BOARD_CLOSE) return true;
  if (deriveEvidence(entry) === BOOK_EVIDENCE.UNVERIFIED) return true;
  if (deriveEvidence(entry) === BOOK_EVIDENCE.RECORDED_BY_SETTLE
    || deriveEvidence(entry) === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED
    || deriveEvidence(entry) === BOOK_EVIDENCE.INFLOW_CLAIMED
    || deriveEvidence(entry) === BOOK_EVIDENCE.REFUND_OWED
    || deriveEvidence(entry) === BOOK_EVIDENCE.OPENROUTER_REPORTED) return true;
  if (entry.collected !== true) return false;
  const rail = String(entry.rail || '').toLowerCase();
  if (UNMETERED_RAILS.has(rail)) return false;
  return true;
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
  const reported = rail === 'reported'
    || receipt.source === 'openrouter_broadcast'
    || receipt.kind === 'openrouter_broadcast';
  if (UNMETERED_RAILS.has(rail)) {
    return { ok: false, reason: 'demo/unmetered receipt does not qualify' };
  }
  if (!reported && payment.collected !== true) {
    return { ok: false, reason: 'receipt is not collected' };
  }
  if (!payment.ref) {
    return { ok: false, reason: 'payment.ref required' };
  }
  if (!receipt.task_id) {
    return { ok: false, reason: 'task_id required' };
  }
  if (reported) {
    if (rail !== 'reported') {
      return { ok: false, reason: 'openrouter broadcast requires payment.rail reported' };
    }
    return { ok: true };
  }
  if (rail && rail !== 'usdc' && rail !== 'solana' && !rail.startsWith('solana') && rail !== 'nano') {
    return { ok: false, reason: `rail ${rail} does not qualify` };
  }
  return { ok: true };
}

function receiptLookupChain(chain) {
  if (chain == null || chain === '') return null;
  const raw = Array.isArray(chain) ? chain[0] : chain;
  const n = String(raw ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n === 'eip155:8453' || n === 'base') return 'base';
  if (n === 'eip155:84532' || n === 'base-sepolia') return 'base-sepolia';
  return n;
}

function hexPaymentId(id) {
  if (typeof id !== 'string' || !/^0x[0-9a-fA-F]+$/i.test(id)) return null;
  return `0x${id.slice(2).toLowerCase()}`;
}

function splitPaymentRef(ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const colon = raw.indexOf(':');
  const hasPrefix = colon > 0 && colon < raw.length - 1;
  const chain = hasPrefix ? raw.slice(0, colon).toLowerCase() : null;
  const id = hasPrefix ? raw.slice(colon + 1) : raw;
  return { chain, id, idLower: hexPaymentId(id), raw };
}

function samePaymentId(a, b) {
  if (a === b) return true;
  const left = hexPaymentId(a);
  const right = hexPaymentId(b);
  return left != null && left === right;
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
    this.refCollisionCount = 0;
    this.byTask = new Map();
    /** refusal_id → ledger row. Public GET /refusal/:id. */
    this.byRefusal = new Map();
    this.claims = new ClaimSettlementStore({
      file: this.dir ? path.join(this.dir, 'claim-settlements.json') : null,
    });
    /** Next seq to assign, per agent_id. */
    this._nextSeq = new Map();
    /** Highest seq seen, per agent_id. The reload tip is this seq, not file order. */
    this._tipSeq = new Map();
    /** Last row hash per agent_id. The hash of the highest seq, not the last line. */
    this._lastRowHash = new Map();
    /** Fork notes that a reload must not resolve by keeping the last line. */
    this._forks = new Map();

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
    this._indexingLoad = true;
    this.refCollisionCount = 0;
    try {
      const text = fs.readFileSync(this._file(), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        this._index(row, { persist: false, notify: false });
      }
      if (this.refCollisionCount > 0) {
        logger.warn(
          { count: this.refCollisionCount },
          'usage-settled: normalized payment_ref collisions kept',
        );
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'usage-settled: load failed');
      }
    } finally {
      this._indexingLoad = false;
    }
  }

  _stampSeq(row) {
    const id = Number(row?.agent_id);
    if (!Number.isInteger(id) || id < 1) return;
    if (!row.act) row.act = actOf(row);
    const successor = row.event === 'inflow_correction' || row.corrects || row.parent_ref;
    if (!row.authority && successor) {
      row.authority = {
        subject_wallet: row.subject_wallet || row.payer || null,
        subject_handle: row.subject_handle || (Number.isInteger(id) ? `agent:${id}` : null),
        writer: 'gateway',
        issuer: 'chit402',
      };
    }
    if (row.seq != null && row.seq !== '') {
      const seq = Number(row.seq);
      const tip = this._tipSeq.get(id) || 0;
      if (!row.prev_hash && Number.isInteger(seq) && seq === tip + 1) {
        row.prev_hash = this._lastRowHash.get(id) || null;
      }
      if (!row.row_hash) row.row_hash = bookRowHash(row);
      if (Number.isInteger(seq) && seq > tip) {
        this._tipSeq.set(id, seq);
        this._nextSeq.set(id, seq + 1);
        if (row.row_hash) this._lastRowHash.set(id, row.row_hash);
      } else if (Number.isInteger(seq) && seq === tip && tip > 0) {
        this._noteFork(id, { kind: 'duplicate_seq', seq, task_id: row.task_id || null });
      }
      if (!row.book_chain) row.book_chain = signBookSeq(row);
      return;
    }
    const seq = this._nextSeq.get(id) || 1;
    row.seq = seq;
    row.prev_hash = this._lastRowHash.get(id) || null;
    row.row_hash = bookRowHash(row);
    row.book_chain = signBookSeq(row);
    this._nextSeq.set(id, seq + 1);
    this._tipSeq.set(id, seq);
    this._lastRowHash.set(id, row.row_hash);
    try {
      this._issueRefusal(row, { rethrowBinding: true });
    } catch (err) {
      if (!isRequestBindingError(err)) throw err;
      this._nextSeq.set(id, seq);
      this._tipSeq.set(id, seq - 1);
      if (row.prev_hash) this._lastRowHash.set(id, row.prev_hash);
      else this._lastRowHash.delete(id);
      delete row.seq;
      delete row.prev_hash;
      delete row.row_hash;
      delete row.book_chain;
      throw err;
    }
  }

  _noteFork(agentId, info) {
    const id = Number(agentId);
    const list = this._forks.get(id) || [];
    list.push(info);
    this._forks.set(id, list);
    logger.warn({ agentId: id, ...info }, 'book chain fork');
  }

  /**
   * Fresh policy_blocked rows get one signed refusal. A reload already has
   * seq, so it does not mint a new nonce. Signing failure still keeps the row.
   * @param {object} row
   */
  _issueRefusal(row, { rethrowBinding = false } = {}) {
    const blocked = row?.event === 'policy_blocked' || row?.evidence === 'policy_blocked';
    if (!blocked || row.refusal) return;
    try {
      row.refusal = issueRefusalReceipt(row);
    } catch (err) {
      if (rethrowBinding && isRequestBindingError(err)) throw err;
      logger.warn({ err: err.message, task_id: row.task_id }, 'refusal receipt not signed');
    }
  }

  /**
   * Gap check for one book. Includes every indexed row, not only the visible window.
   * @param {number|string} agentId
   */
  _rowsForAgent(agentId) {
    const id = Number(agentId);
    if (!Number.isInteger(id)) return [];
    return this.entries.filter((e) => Number(e.agent_id) === id);
  }

  seqReport(agentId) {
    const id = Number(agentId);
    const rows = this._rowsForAgent(id).filter((e) => e.seq != null);
    const analysis = analyzeSeq(rows);
    const duplicateRows = this._forks.get(id) || [];
    const forked = analysis.forked || duplicateRows.length > 0;
    return {
      schema: 'chit402.book_seq_report.v1',
      book_id: id,
      ...analysis,
      forked,
      status: forked ? 'FORKED' : analysis.status,
      gapless: analysis.gapless && duplicateRows.length === 0,
      duplicate_rows: duplicateRows,
      supersession: summarizeSupersession(this._rowsForAgent(id)),
    };
  }

  /**
   * Unsigned supersession report for one row. Scans the whole book so a
   * short page cannot hide a second successor. Null when the task is absent.
   * @param {string} taskId
   */
  supersessionOf(taskId) {
    const row = this.findByTask(String(taskId));
    if (!row) return null;
    return supersessionForRow(row, this._rowsForAgent(row.agent_id));
  }

  _index(row, { persist = true, notify = true } = {}) {
    this._stampSeq(row);
    this.entries.push(row);
    if (row.payment_ref) {
      const raw = String(row.payment_ref);
      const norm = paymentRefIndexKey(raw);
      const key = norm || raw;
      const prior = this.byRef.get(key);
      if (prior && prior !== row) {
        if (this._indexingLoad) this.refCollisionCount += 1;
        this._noteFork(row.agent_id, {
          kind: 'duplicate_payment_ref',
          payment_ref: key,
          task_id: row.task_id || null,
        });
      } else if (!prior) {
        this.byRef.set(key, row);
      }
      if (raw !== key && !this.byRef.has(raw)) this.byRef.set(raw, row);
    }
    if (row.task_id) {
      const key = String(row.task_id);
      const prior = this.byTask.get(key);
      if (prior && prior !== row) {
        this._noteFork(row.agent_id, {
          kind: 'duplicate_task_id',
          task_id: key,
        });
      } else if (!prior) {
        this.byTask.set(key, row);
      }
    }
    if (row.refusal?.refusal_id) this.byRefusal.set(String(row.refusal.refusal_id), row);
    if (notify) emitBookRowWritten(row);
    if (persist && this.persist) this._persistRow(row);
  }

  _persistRow(row) {
    if (!this.persist) return;
    try {
      let body_commitment = null;
      const salt = requestSalt(row?.request);
      const body = row?.request?.rawBody != null ? row.request.rawBody : row?.request?.body;
      if (salt && body != null) {
        try {
          body_commitment = bodyCommitmentHex(salt, body);
        } catch {
          body_commitment = null;
        }
      }
      const request_digest = row?.refusal?.request_digest || row?.request_digest || null;
      fs.appendFileSync(this._file(), `${JSON.stringify(scrubLedgerRow(row, { body_commitment, request_digest }))}\n`);
    } catch (err) {
      logger.warn({ err: err.message }, 'usage-settled: append failed');
    }
  }

  findByRef(paymentRef) {
    const raw = String(paymentRef);
    const direct = this.byRef.get(raw);
    if (direct) return direct;
    const norm = paymentRefIndexKey(raw);
    return norm ? (this.byRef.get(norm) || null) : null;
  }

  /** Extra dedupe alias (tx + log index). Not a stored receipt field. */
  aliasRef(alias, paymentRef) {
    if (!alias) return false;
    const row = this.findByRef(paymentRef);
    if (!row) return false;
    const prior = this.byRef.get(String(alias));
    if (prior && prior !== row) return false;
    this.byRef.set(String(alias), row);
    return true;
  }

  /**
   * Find a book row from a tx the caller has, not a task id.
   * Matches `base:<tx>` and a bare hash. Hex is case-insensitive.
   * `chain` (short name or `eip155:8453`) limits the prefix. A bare query
   * with no chain also matches `base:<tx>`.
   * @param {string} tx
   * @param {{ chain?: string|null }} [opts]
   * @returns {object|null}
   */
  findByPaymentQuery(tx, { chain = null } = {}) {
    const query = splitPaymentRef(tx);
    if (!query) return null;
    const chainFilter = receiptLookupChain(chain);
    if (chainFilter && query.chain && chainFilter !== query.chain) return null;
    const wantedChain = chainFilter || query.chain || null;

    const exact = [];
    const push = (ref) => {
      if (ref && !exact.includes(ref)) exact.push(ref);
    };
    if (wantedChain) {
      push(`${wantedChain}:${query.id}`);
      if (query.idLower) push(`${wantedChain}:${query.idLower}`);
    }
    push(query.id);
    if (query.idLower) push(query.idLower);
    if (!wantedChain && query.idLower) push(`base:${query.idLower}`);
    if (!wantedChain) push(`base:${query.id}`);
    push(query.raw);

    for (const ref of exact) {
      const hit = this.findByRef(ref);
      if (!hit) continue;
      if (wantedChain) {
        const parts = splitPaymentRef(hit.payment_ref);
        if (parts?.chain && parts.chain !== wantedChain) continue;
      }
      return hit;
    }

    for (const row of this.entries) {
      const parts = splitPaymentRef(row?.payment_ref);
      if (!parts) continue;
      if (wantedChain && parts.chain && parts.chain !== wantedChain) continue;
      if (!samePaymentId(parts.id, query.id)) continue;
      return row;
    }
    return null;
  }

  findByTask(taskId) {
    return this.byTask.get(String(taskId)) || null;
  }

  /**
   * Policy refusal by refusal_id, or by the policy_blocked task_id.
   * @param {string} id
   */
  findByRefusal(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const byId = this.byRefusal.get(key);
    if (byId?.refusal) return byId;
    const byTask = this.byTask.get(key);
    if (byTask?.refusal) return byTask;
    return null;
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
    if (this.findByRef(paymentRef)) {
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
    if (receipt.fulfillment && typeof receipt.fulfillment === 'object') {
      entry.fulfillment = receipt.fulfillment;
      entry.job_kind = receipt.fulfillment.intent?.job_kind ?? null;
    } else if (receipt.route?.job_kind) {
      entry.job_kind = receipt.route.job_kind;
    }
    const reportedRow = String(payment.rail || '').toLowerCase() === 'reported'
      || receipt.source === 'openrouter_broadcast'
      || receipt.kind === 'openrouter_broadcast';
    if (reportedRow) {
      entry.collected = false;
      entry.evidence = BOOK_EVIDENCE.OPENROUTER_REPORTED;
      entry.source = 'openrouter_broadcast';
      entry.job_kind = entry.job_kind || 'openrouter_broadcast';
      if (receipt.public_receipt && typeof receipt.public_receipt === 'object') {
        entry.receipt_snapshot = receipt.public_receipt;
      }
    }
    if (receipt.foreign_x402 === true) {
      entry.foreign_x402 = true;
      entry.source = receipt.source || 'foreign_ingest';
      entry.evidence = BOOK_EVIDENCE.FOREIGN_INGEST;
      if (payment.chain) entry.chain = payment.chain;
      if (payment.amount_xno) entry.amount_xno = payment.amount_xno;
      if (payment.amount_raw) entry.amount_raw = payment.amount_raw;
      if (payment.usd_estimate) entry.usd_estimate = payment.usd_estimate;
      if (payment.block_hash) entry.block_hash = payment.block_hash;
      if (payment.explorer_url) entry.explorer_url = payment.explorer_url;
      entry.receipt_snapshot = {
        schema: receipt.schema,
        task_id: receipt.task_id,
        status: receipt.status,
        proof_outcome: receipt.proof_outcome,
        foreign_x402: true,
        source: entry.source,
        payment: receipt.payment,
        route: receipt.route,
        ...(receipt.caller_binding ? { caller_binding: receipt.caller_binding } : {}),
        ...(receipt.claim_id ? { claim_id: String(receipt.claim_id) } : {}),
        fulfillment: receipt.fulfillment || null,
        signature: receipt.signature || null,
        stamp: receipt.stamp || null,
        ...(receipt.issuer_signature ? { issuer_signature: receipt.issuer_signature } : {}),
        ...(receipt.verification ? { verification: receipt.verification } : {}),
      };
    }
    // Append the leaf before persisting so the covering prefix can be signed
    // into the snapshot that is written.
    this._index(entry, { persist: false, notify: true });
    emitReceiptBound(receipt, entry);
    this._persistRow(entry);
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
    const n = entry.inflow_corrections.length;
    const correctionRow = {
      task_id: `${entry.task_id}:correction:${n}`,
      payment_ref: null,
      payer: null,
      agent_id: id,
      collected: false,
      evidence: 'inflow_correction',
      event: 'inflow_correction',
      corrects: entry.task_id,
      supersedes: entry.task_id,
      parent_ref: entry.task_id,
      bucket: correction.bucket ? String(correction.bucket) : (entry.bucket || null),
      amount: correction.allocation != null ? String(correction.allocation) : (entry.amount || null),
      reason: correction.reason || null,
      subject_handle: correction.subject_handle || null,
      subject_wallet: correction.subject_wallet || entry.payer || null,
      payer: correction.subject_wallet || entry.payer || null,
      inflow_correction: correction,
      rail: null,
      collected_at: correction.as_of || new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: entry.model || null,
      hub: entry.hub || null,
    };
    this._index(correctionRow);
    return { ok: true, entry, correction, correction_row: correctionRow };
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
   *   policyKey?: string|null,
   *   spentAtomic?: string|null,
   *   capAtomic?: string|null,
   *   periodStart?: string|null,
   *   amountRequested?: string|null,
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
    policyKey = null,
    spentAtomic = null,
    capAtomic = null,
    periodStart = null,
    anchor = null,
    amountRequested = null,
    request = null,
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
        if (request && existing.refusal) {
          try {
            if (existing.refusal.request_digest && !refusalMatchesRequest(existing.refusal, request)) {
              return {
                ok: false,
                reason: 'idempotency key was already used for a different request',
                code: 'idempotency_conflict',
              };
            }
            if (request.idempotency_key && saltRecoverable(request)) {
              claimIdempotency(request.idempotency_key, requestDigest(request), {
                principal: request.payer || '',
                receiptId: saltReceiptId(request),
              });
            }
          } catch (err) {
            if (err.code === 'idempotency_conflict') {
              return { ok: false, reason: err.message, code: err.code };
            }
            throw err;
          }
        }
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
      amount_requested: amountRequested != null && String(amountRequested).trim() !== ''
        ? String(amountRequested)
        : null,
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: model || null,
      hub: hub || null,
      parent_ref: null,
      intent_id: intentId || null,
      attempt_index: attemptIndex != null ? Number(attemptIndex) : null,
      policy_key: policyKey || null,
      spent_atomic: spentAtomic != null ? String(spentAtomic) : null,
      cap_atomic: capAtomic != null ? String(capAtomic) : null,
      period_start: periodStart || null,
      anchor: refusalAnchorOrUnavailable(anchor),
      request: request && typeof request === 'object' ? request : null,
      intent_supplied: request?.intent_supplied === true,
    };
    try {
      this._index(entry);
    } catch (err) {
      if (isRequestBindingError(err)) {
        return { ok: false, reason: err.message, code: err.code };
      }
      throw err;
    }
    return { ok: true, entry, duplicate: false };
  }

  /**
   * Append an exportable A2A escrow phase row (non-spend audit).
   * @param {{
   *   agentId: number,
   *   jobId: string,
   *   phase: string,
   *   job: object,
   *   verifyUrl?: string|null,
   *   meterUnits?: string|null,
   *   challengeIndex?: number|null,
   * }} row
   */
  recordA2aEscrowEvent({
    agentId,
    jobId,
    phase,
    job,
    verifyUrl = null,
    meterUnits = null,
    challengeIndex = null,
  }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id', code: 'invalid_agent' };
    }
    const tid = `a2aesc-${String(jobId).replace(/[^a-zA-Z0-9-]/g, '')}-${String(phase)}-${crypto.randomBytes(4).toString('hex')}`;
    if (this.byTask.has(tid)) {
      return { ok: true, entry: this.byTask.get(tid), duplicate: true };
    }
    const entry = {
      task_id: tid,
      payment_ref: job?.task_id ? `a2a_job:${job.task_id}` : null,
      payer: null,
      agent_id: id,
      collected: false,
      evidence: BOOK_EVIDENCE.A2A_ESCROW,
      event: 'a2a_escrow',
      a2a_escrow: {
        job_id: jobId,
        phase: String(phase),
        job_spec_hash: job?.job_spec_hash || null,
        amount: job?.amount || null,
        counterparty_agent_id: job?.counterparty_agent_id ?? null,
        fulfillment_receipt_id: job?.fulfillment_receipt_id || null,
        output_commitment: job?.output_commitment || null,
        escrow_id: job?.escrow_id || null,
        meter_units: meterUnits != null ? String(meterUnits) : null,
        challenge_index: challengeIndex != null ? Number(challengeIndex) : null,
        verify_url: verifyUrl || null,
      },
      rail: null,
      amount: null,
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: null,
      hub: null,
      parent_ref: job?.task_id || null,
    };
    this._index(entry);
    return { ok: true, entry, duplicate: false };
  }

  /**
   * The ingest stamp tx as its own book row. book_chain signs book_id and payment_ref.
   * Does not debit prepaid budget.
   * @param {{
   *   agentId: number,
   *   taskId: string,
   *   paymentRef: string,
   *   amount?: string|null,
   *   payer?: string|null,
   *   parentRef?: string|null,
   * }} row
   */
  recordIngestStamp({
    agentId,
    taskId,
    paymentRef,
    amount = null,
    payer = null,
    parentRef = null,
  }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id', code: 'invalid_agent' };
    }
    const tid = String(taskId || '').trim();
    if (!tid) return { ok: false, reason: 'task_id required', code: 'task_required' };
    const ref = paymentRef != null && String(paymentRef).trim() ? String(paymentRef).trim() : null;
    if (!ref) return { ok: false, reason: 'payment_ref required', code: 'ref_required' };
    if (this.byTask.has(tid)) {
      return { ok: true, entry: this.byTask.get(tid), duplicate: true };
    }
    if (this.findByRef(ref)) {
      return { ok: false, reason: 'duplicate payment.ref', code: 'duplicate_ref' };
    }
    const entry = {
      task_id: tid,
      payment_ref: ref,
      payer: payer || null,
      agent_id: id,
      collected: false,
      evidence: BOOK_EVIDENCE.INGEST_STAMP,
      event: 'ingest_stamp',
      rail: 'usdc',
      amount: amount != null ? String(amount) : null,
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: null,
      hub: null,
      parent_ref: parentRef || null,
    };
    this._index(entry);
    return { ok: true, entry, duplicate: false };
  }

  /**
   * Append a board audit row. Kinds: board_stamp, board_post, board_comment, board_ops,
   * board_bid, board_pick, board_close.
   * None of these debit prepaid budget (evidence is excluded from caps).
   * @param {{
   *   agentId: number,
   *   kind: string,
   *   taskId: string,
   *   paymentRef?: string|null,
   *   amount?: string|null,
   *   collected?: boolean,
   *   rail?: string|null,
   *   parentRef?: string|null,
   *   board?: object,
   *   payer?: string|null,
   *   fulfillment?: object|null,
   * }} row
   */
  recordBoardEvent({
    agentId,
    kind,
    taskId,
    paymentRef = null,
    amount = null,
    collected = false,
    rail = null,
    parentRef = null,
    board = {},
    payer = null,
    fulfillment = null,
  }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id', code: 'invalid_agent' };
    }
    const event = String(kind || '');
    if (event !== 'board_stamp' && event !== 'board_post' && event !== 'board_comment' && event !== 'board_ops'
      && event !== 'board_bid' && event !== 'board_pick' && event !== 'board_close') {
      return { ok: false, reason: 'unsupported board kind', code: 'invalid_kind' };
    }
    const tid = String(taskId || '').trim();
    if (!tid) return { ok: false, reason: 'task_id required', code: 'task_required' };
    if (this.byTask.has(tid)) {
      return { ok: true, entry: this.byTask.get(tid), duplicate: true };
    }
    const ref = paymentRef != null && String(paymentRef).trim() ? String(paymentRef).trim() : null;
    if (ref && this.findByRef(ref)) {
      return { ok: false, reason: 'duplicate payment.ref', code: 'duplicate_ref' };
    }
    const entry = {
      task_id: tid,
      payment_ref: ref,
      payer: payer || null,
      agent_id: id,
      collected: collected === true,
      evidence: event,
      event,
      board: board && typeof board === 'object' ? board : {},
      rail: rail || null,
      amount: amount != null ? String(amount) : null,
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: null,
      hub: null,
      parent_ref: parentRef || null,
    };
    if (fulfillment && typeof fulfillment === 'object') {
      entry.fulfillment = fulfillment;
      entry.job_kind = fulfillment.intent?.job_kind || null;
    }
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
   * Every row for one agent, newest first, split into book-visible rows
   * and rows the book policy omits. No limit. scanComplete is false when
   * the agent id is not a real book.
   * @param {number|string} agentId
   */
  collectVisible(agentId) {
    const id = Number(agentId);
    const rows = [];
    let omittedByPolicy = 0;
    let agentRowCount = 0;
    if (!Number.isInteger(id) || id < 1) {
      return { rows, omittedByPolicy, agentRowCount, scanComplete: false };
    }
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (Number(e.agent_id) !== id) continue;
      agentRowCount += 1;
      if (!entryVisibleOnBook(e)) {
        omittedByPolicy += 1;
        continue;
      }
      rows.push(e);
    }
    return { rows, omittedByPolicy, agentRowCount, scanComplete: true };
  }

  /**
   * Last-N collected rows for one agent_id. Newest first.
   * Demo / unmetered / collected:false never qualify.
   * @param {number|string} agentId
   * @param {{ limit?: number }} [opts]
   */
  listByAgent(agentId, { limit = 50 } = {}) {
    const n = clampBookLimit(limit);
    return this.collectVisible(agentId).rows.slice(0, n);
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
  issuanceCommitment = null,
  disputeWindow = null,
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
    if (issuanceCommitment) result.entry.issuance_commitment = issuanceCommitment;
    if (disputeWindow) result.entry.dispute_window = disputeWindow;
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
 * A settle-time row whose upstream served nothing. Stays on the book so ops can
 * see the payer, amount, and payment ref, and drops out of spend totals.
 * @param {UsageSettledLedger} ledger
 * @param {{ taskId: string, amount?: string|null, payer?: string|null, paymentRef?: string|null }} row
 */
export function markRefundOwed(ledger, { taskId, amount = null, payer = null, paymentRef = null } = {}) {
  if (!ledger || typeof ledger.findByTask !== 'function' || !taskId) {
    return { ok: false, reason: 'ledger and taskId required', code: 'invalid_refund' };
  }
  const entry = ledger.findByTask(String(taskId));
  if (!entry) return { ok: false, reason: 'row not found', code: 'not_found' };
  entry.refund_status = 'owed';
  entry.collected = false;
  entry.evidence = BOOK_EVIDENCE.REFUND_OWED;
  if (amount != null && String(amount) !== '') entry.amount = String(amount);
  if (payer && !entry.payer) entry.payer = payer;
  if (paymentRef && !entry.payment_ref) entry.payment_ref = String(paymentRef);
  entry.refund = {
    refund_status: 'owed',
    amount: entry.amount ?? (amount != null ? String(amount) : null),
    payer: payer || entry.payer || null,
    payment_ref: entry.payment_ref || (paymentRef != null ? String(paymentRef) : null),
  };
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
 *   closeSettle?: boolean,
 *   noteReplay?: boolean,
 * }} deps
 * `closeSettle` is the response-side write of the same paid call that already
 * appended a settle-time row. That close is the first collect, not a replay,
 * and it promotes the row to collected so a finished Chit payment can be cited.
 * `noteReplay: false` skips another replay_events entry when this request's
 * settle write already recorded one.
 * `singleUseClaim: true` closes `receipt.claim_id` once. A different receipt
 * for that id returns `claim_already_settled`. The same task and payment ref
 * stays on the idempotent path above and returns the existing row.
 */
/**
 * Undo a close this call just wrote. A persist failure puts the row back so
 * memory and disk stay settled together.
 * @returns {{ ok: false, reason: string, code: string }|null}
 */
function rollbackClaimClose(ledger, closed, receipt) {
  if (!closed?.ok || closed.idempotent || !ledger?.claims) return null;
  const released = ledger.claims.release(receipt.claim_id, {
    taskId: receipt.task_id,
    paymentRef: receipt.payment.ref,
  });
  if (released) return null;
  return {
    ok: false,
    reason: 'claim close could not be rolled back',
    code: 'claim_persist_failed',
  };
}

export function recordCollectedSpend(receipt, {
  ledger,
  registry,
  payer = null,
  agentId = null,
  parentRef = null,
  intentId = null,
  attemptIndex = null,
  closeSettle = false,
  noteReplay = true,
  singleUseClaim = undefined,
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
    // Paid /v1 writes the book row at x402 settle (before inference), then
    // records the same task_id + payment.ref again when the response is built.
    // That second write is this call finishing. It is not a client replay of
    // its own payment — replay_of must not point at this task_id.
    const closingOwnSettle = closeSettle === true
      && String(existing.task_id) === String(receipt.task_id)
      && existing.recorded_by === 'settle'
      && existing.fulfillment_closed !== true;
    if (closingOwnSettle) {
      existing.fulfillment_closed = true;
      // The paid call finished. A Chit settle never grows a separate ingress
      // receipt, so this close is what makes the row citable. A refund-owed
      // row stays unusable for posts and confirms.
      if (existing.refund_status !== 'owed' && existing.evidence !== BOOK_EVIDENCE.REFUND_OWED) {
        existing.arrival_status = ARRIVAL_STATUS.CONFIRMED;
        existing.evidence = BOOK_EVIDENCE.COLLECTED;
      }
      const identity = typeof registry.get === 'function' ? registry.get(existing.agent_id) : null;
      return {
        ok: true,
        entry: existing,
        agent_id: existing.agent_id,
        session: identity?.session || null,
        duplicate: true,
        idempotent_replay: false,
        settlement_status: SETTLEMENT_STATUS.SETTLED,
        replay_of: null,
      };
    }
    if (noteReplay !== false) noteIdempotentReplay(existing);
    const identity = typeof registry.get === 'function' ? registry.get(existing.agent_id) : null;
    return {
      ok: true,
      entry: existing,
      agent_id: existing.agent_id,
      session: identity?.session || null,
      duplicate: true,
      idempotent_replay: true,
      settlement_status: SETTLEMENT_STATUS.IDEMPOTENT_REPLAY,
      replay_of: existing.task_id,
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
  let closed = null;
  if (shouldCloseClaim(receipt, identity.agent_id, singleUseClaim) && ledger.claims) {
    closed = ledger.claims.settleSync({
      claimId: receipt.claim_id,
      taskId: receipt.task_id,
      paymentRef: receipt.payment.ref,
      receipt,
    });
    if (!closed.ok) {
      return {
        ok: false,
        reason: closed.reason,
        code: closed.code,
        receipt: closed.receipt ?? null,
      };
    }
  }
  let credited;
  try {
    credited = ledger.append(receipt, {
      payer,
      agentId: identity.agent_id,
      parentRef,
      intentId,
      attemptIndex,
    });
  } catch (err) {
    const stuck = rollbackClaimClose(ledger, closed, receipt);
    if (stuck) throw Object.assign(new Error(stuck.reason), { code: stuck.code, cause: err });
    throw err;
  }
  if (!credited.ok) {
    const stuck = rollbackClaimClose(ledger, closed, receipt);
    if (stuck) return stuck;
    return { ok: false, reason: credited.reason, code: credited.code };
  }
  return {
    ok: true,
    entry: credited.entry,
    agent_id: identity.agent_id,
    session: identity.session,
    duplicate: false,
    idempotent_replay: false,
    settlement_status: SETTLEMENT_STATUS.SETTLED,
    replay_of: null,
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
