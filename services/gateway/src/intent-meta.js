/**
 * Intent / retry metadata for possession book rows.
 *
 * N paid hops (retries/attempts) share one intent_id so treasury sees one
 * intent bill with many attempt rows. Prefer explicit client intent_id;
 * generate only when attempt/retry metadata is present without intent_id.
 */

import crypto from 'crypto';

/**
 * Parse attempt/retry index from header or body.
 * @param {object} headers
 * @param {object} body
 * @returns {number|null}
 */
export function parseAttemptIndex(headers = {}, body = {}) {
  const raw = headers['x-xfuel-attempt']
    ?? headers['x-xfuel-retry']
    ?? body.attempt_index
    ?? body.retry_index
    ?? body.attempt
    ?? body.retry
    ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Extract intent_id from header or body.
 * @param {object} headers
 * @param {object} body
 * @returns {string|null}
 */
export function parseIntentId(headers = {}, body = {}) {
  const raw = headers['x-xfuel-intent']
    ?? body.intent_id
    ?? body.intent
    ?? null;
  if (raw == null || raw === '') return null;
  return String(raw).trim() || null;
}

/**
 * @param {import('http').IncomingMessage|{ headers?: object, body?: object }} req
 */
export function extractIntentMeta(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const headers = req.headers || {};
  const intentId = parseIntentId(headers, body);
  const attemptIndex = parseAttemptIndex(headers, body);
  const hasAttemptMeta = attemptIndex != null
    || headers['x-xfuel-attempt'] != null
    || headers['x-xfuel-retry'] != null
    || Object.prototype.hasOwnProperty.call(body, 'attempt_index')
    || Object.prototype.hasOwnProperty.call(body, 'retry_index')
    || Object.prototype.hasOwnProperty.call(body, 'attempt')
    || Object.prototype.hasOwnProperty.call(body, 'retry');
  return { intentId, attemptIndex, hasAttemptMeta };
}

/**
 * Resolve intent_id and attempt_index for a book row.
 * Generates intent_id when attempt metadata exists but intent_id is absent.
 * Auto-increments attempt_index when intent_id is known but index is absent.
 *
 * @param {{ intentId?: string|null, attemptIndex?: number|null, hasAttemptMeta?: boolean }} meta
 * @param {{ countAttemptsForIntent?: (intentId: string, agentId: number) => number }} [ledger]
 * @param {number|null} [agentId]
 */
export function resolveIntentFields(meta = {}, ledger = null, agentId = null) {
  let intentId = meta.intentId || null;
  let attemptIndex = meta.attemptIndex ?? null;

  if (!intentId && meta.hasAttemptMeta) {
    intentId = `intent-${crypto.randomUUID()}`;
  }
  if (intentId == null) {
    return { intent_id: null, attempt_index: null };
  }

  if (attemptIndex == null && agentId != null && typeof ledger?.countAttemptsForIntent === 'function') {
    attemptIndex = ledger.countAttemptsForIntent(intentId, agentId);
  }
  if (attemptIndex == null && meta.hasAttemptMeta) {
    attemptIndex = 0;
  }

  return {
    intent_id: intentId,
    attempt_index: attemptIndex,
  };
}
