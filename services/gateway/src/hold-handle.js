/**
 * Public handle for a post-settle hold that has no late row.
 * The id is 16 random bytes. The replay store's recordPending id is not
 * used: that one is guessable and leaks a count. A retry of the same key
 * returns the same row. The public read is the id and the class only.
 */
import crypto from 'crypto';
import { lateVerifyUrl } from './late-issue.js';
import { getActiveChallengeStore } from './x402-durable-store.js';
import { challengeStore } from './x402-adapter.js';
import { decisionHoldResult } from './x402-flags.js';
import { renderHoldPage } from './receipt-shell.js';

export function holdStore(store) {
  return store || getActiveChallengeStore() || challengeStore;
}

/**
 * @returns {{ pendingId: string, verifyUrl: string|null }|null}
 */
export function openPostSettleHandle(store, { key, holdClass, cfg, code, paymentHash } = {}) {
  const active = holdStore(store);
  if (!active || typeof active.ensureHoldHandle !== 'function') return null;
  if (holdClass !== 'resolvable' && holdClass !== 'terminal') return null;
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) return null;
  try {
    const row = active.ensureHoldHandle({ key, holdClass, code, paymentHash });
    if (!row?.pending_id) return null;
    return {
      pendingId: row.pending_id,
      verifyUrl: lateVerifyUrl(cfg, row.pending_id),
      holdClass: row.hold_class,
      code: row.code || null,
    };
  } catch {
    return null;
  }
}

/**
 * Terminal stamp hold after a settle. The key is the payment ref, so a retry
 * of the same payment returns the same id. No ref means no handle: the
 * caller still gets the non-402 fallback.
 */
export function terminalHold(code, paymentRef, cfg) {
  const key = typeof paymentRef === 'string' && paymentRef ? `pay:${paymentRef}:${code}` : '';
  const opened = openPostSettleHandle(null, { key, holdClass: 'terminal', cfg });
  return decisionHoldResult({
    code,
    reason: code,
    holdClass: 'terminal',
    pendingId: opened?.pendingId || null,
    verifyUrl: opened?.verifyUrl || null,
  });
}

export function terminalStampHold(paymentRef, cfg) {
  return terminalHold('stamp_underpaid', paymentRef, cfg);
}

/** SHA-256 hex of the raw payment header. Empty when the header is absent. */
export function paymentHeaderDigest(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  return crypto.createHash('sha256').update(header, 'utf8').digest('hex');
}

/**
 * States that mean this nonce was claimed past issue. An issued challenge
 * has not been through /settle, so a throw there is not a refund.
 */
const CLAIMED_STAMP_STATES = new Set(['submitted', 'unknown', 'spent']);

function stampHoldHashMatches(stored, presented) {
  if (typeof stored !== 'string' || typeof presented !== 'string') return false;
  if (stored.length !== presented.length || stored.length === 0) return false;
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(presented));
}

/**
 * A stamp function threw after the caller had already sent a payment header.
 * Open or upgrade the settle-key handle only when this nonce was claimed
 * and the header matches the hash stored at claim (or on the late row, the
 * spent record, or an existing handle). The key uses the stored challenge
 * network. A store outage returns null. Anything else returns null so the
 * caller uses the 409 fallback, with no refund_owed.
 */
export function presentedStampHold(network, nonce, cfg = {}) {
  void network;
  try {
    return bindPresentedStampHold(nonce, cfg);
  } catch {
    return null; // store outage is the 409 fallback
  }
}

function bindPresentedStampHold(nonce, cfg) {
  const active = holdStore(cfg.store);
  if (!active || !nonce) return null;
  const spent = typeof active.isSpent === 'function' && active.isSpent(nonce);
  const challenge = spent
    ? (typeof active.replayRecord === 'function' ? active.replayRecord(nonce) : null)
    : (typeof active.get === 'function' ? active.get(nonce) : null);
  if (!challenge || !CLAIMED_STAMP_STATES.has(challenge.state)) return null;
  const net = challenge.network; // the stored challenge, not the caller's network
  const key = settleHoldKey(net, nonce);
  if (!key || key.length < 8) return null;
  const presented = cfg.paymentHash || paymentHeaderDigest(cfg.paymentHeader);
  const existing = typeof active.findHoldHandleByKey === 'function' ? active.findHoldHandleByKey(key) : null;
  const late = typeof active.findLate === 'function' ? active.findLate({ nonce }) : null;
  const bound = existing?.payment_hash
    || challenge.payment_hash
    || challenge.settlement?.paymentHash
    || late?.payment_hash
    || null;
  if (!stampHoldHashMatches(bound, presented)) return null;
  const opened = openPostSettleHandle(active, {
    key,
    holdClass: 'terminal',
    code: 'stamp_payment_required',
    cfg,
    paymentHash: presented,
  });
  if (!opened?.pendingId) return null;
  const held = decisionHoldResult({
    code: 'stamp_payment_required',
    reason: 'stamp_payment_required',
    holdClass: 'terminal',
    pendingId: opened.pendingId,
    verifyUrl: opened.verifyUrl,
  });
  return { ...held, error: 'stamp_payment_required', code: 'stamp_payment_required', message: 'Do not pay again.' };
}

/**
 * A refusal after a stamp was collected. The caller's code is kept even when
 * it is outside the closed payment set. No payment ref is the non-402 fallback.
 */
export function collectedStampHold(code, paymentRef, cfg) {
  const held = terminalHold(code, paymentRef, cfg);
  const publicCode = code || held.code;
  return {
    ...held,
    error: publicCode,
    code: publicCode,
    message: held.message || 'Do not pay again.',
  };
}

/**
 * Body of a hold page. JSON and HTML say the class and nothing about the payment.
 * @returns {{ json?: object, html?: string }}
 */
export function holdPagePayload(page) {
  if (page === 'refund_owed') {
    return {
      json: { status: 'refund_owed', message: 'refund owed, do not pay again' },
      html: renderHoldPage('refund_owed'),
    };
  }
  return { json: { status: 'pending' }, html: renderHoldPage('pending') };
}

export function settleHoldKey(network, nonce) {
  if (!nonce) return '';
  return `settle:${String(network || '')}:${String(nonce)}`;
}

const PENDING_LATE_STATES = new Set(['unknown', 'submitted', 'confirmed', 'issuing']);
const REFUND_LATE_STATES = new Set(['mismatch_hold', 'expired_unresolved']);

function pageForLateRow(row) {
  if (!row) return null;
  const signed = !!row.public_receipt?.issuer_signature?.jws;
  // State wins over the class. An issued, signed, or inline row is a receipt,
  // even when the hold was opened as resolvable.
  if (signed || row.state === 'issued' || row.inline === true) {
    const taskId = (row.inline === true && row.task_id)
      ? row.task_id
      : (row.receipt_id || row.task_id || `late-${row.pending_id}`);
    return { page: 'receipt', taskId };
  }
  if (REFUND_LATE_STATES.has(row.state)) return { page: 'refund_owed' };
  if (PENDING_LATE_STATES.has(row.state)) {
    return { page: row.hold_class === 'terminal' ? 'refund_owed' : 'pending' };
  }
  // not_settled means the chain showed no transfer. That is not a refund
  // claim, and it is not a pending receipt. The page matches an unknown id.
  return null;
}

/** Page class for /receipt/late-<id>, or null when the id is not a hold. */
export function holdPageForReceiptId(taskId, store = null) {
  const id = String(taskId || '');
  if (!id.startsWith('late-')) return null;
  const pendingId = id.slice(5);
  if (!/^[0-9a-f]{32}$/.test(pendingId)) return null;
  const active = holdStore(store);
  if (!active) return null;
  if (typeof active.getLate === 'function') {
    const row = active.getLate(pendingId);
    const latePage = pageForLateRow(row);
    if (latePage) return latePage;
  }
  if (typeof active.holdPageLink === 'function') {
    const link = active.holdPageLink(pendingId);
    if (link?.linked_pending_id && typeof active.getLate === 'function') {
      const linked = active.getLate(link.linked_pending_id);
      const linkedPage = pageForLateRow(linked);
      if (linkedPage) return linkedPage;
    }
    if (link?.linked_task_id) return { page: 'receipt', taskId: link.linked_task_id };
    if (link) return { page: link.hold_class === 'terminal' ? 'refund_owed' : 'pending' };
  }
  return null;
}
