/**
 * Public handle for a post-settle hold that has no late row.
 * The id is 16 random bytes. The replay store's recordPending id is not
 * used: that one is guessable and leaks a count. A retry of the same key
 * returns the same row. The public read is the id and the class only.
 */
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
export function openPostSettleHandle(store, { key, holdClass, cfg } = {}) {
  const active = holdStore(store);
  if (!active || typeof active.ensureHoldHandle !== 'function') return null;
  if (holdClass !== 'resolvable' && holdClass !== 'terminal') return null;
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) return null;
  try {
    const row = active.ensureHoldHandle({ key, holdClass });
    if (!row?.pending_id) return null;
    return { pendingId: row.pending_id, verifyUrl: lateVerifyUrl(cfg, row.pending_id) };
  } catch {
    return null;
  }
}

/**
 * Terminal stamp hold after a settle. The key is the payment ref, so a retry
 * of the same payment returns the same id. No ref means no handle: the
 * caller still gets the non-402 fallback.
 */
export function terminalStampHold(paymentRef, cfg) {
  const key = typeof paymentRef === 'string' && paymentRef ? `stamp:${paymentRef}` : '';
  const opened = openPostSettleHandle(null, { key, holdClass: 'terminal', cfg });
  return decisionHoldResult({
    code: 'stamp_underpaid',
    reason: 'stamp_underpaid',
    holdClass: 'terminal',
    pendingId: opened?.pendingId || null,
    verifyUrl: opened?.verifyUrl || null,
  });
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
    if (row && !row.public_receipt?.issuer_signature?.jws) {
      const refund = row.hold_class === 'terminal'
        || row.state === 'mismatch_hold'
        || row.state === 'expired_unresolved'
        || row.state === 'not_settled';
      return { page: refund ? 'refund_owed' : 'pending' };
    }
  }
  if (typeof active.getHoldHandle === 'function') {
    const handle = active.getHoldHandle(pendingId);
    if (!handle) return null;
    return { page: handle.hold_class === 'terminal' ? 'refund_owed' : 'pending' };
  }
  return null;
}
