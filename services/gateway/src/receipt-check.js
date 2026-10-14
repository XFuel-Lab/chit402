/**
 * Free receipt check. Not an x402 route.
 *
 * Accepts a pasted receipt JSON document, a receipt id, or a receipt URL.
 * The verdict is `checkReceiptInput` from chit402-verify — the same path the
 * CLI prints. Counts are anonymous totals. The pasted input is not stored
 * and is not written to the log.
 */

import logger from './logger.js';
import { buildVerifyVerdict, humanVerdictLines, overallLine } from '../../../packages/verify/dist/verdict.js';
import {
  checkReceiptInput,
  classifyReceiptInput,
} from '../../../packages/verify/dist/check-input.js';

export const RECEIPT_CHECK_PATH = '/v1/receipts/check';
export const RECEIPT_CHECK_MAX_BYTES = 65_536;
export const RECEIPT_CHECK_WINDOW_MS = 60_000;
export const RECEIPT_CHECK_MAX_HITS = 30;

const ENVELOPE_BYTES = 64;

const LIMITER_MAX_KEYS = 50_000;

export function createReceiptCheckLimiter(windowMs, maxHits, maxKeys = LIMITER_MAX_KEYS) {
  const buckets = new Map();
  let lastSweep = 0;
  function sweep(now) {
    if (now - lastSweep < windowMs && buckets.size < maxKeys) return;
    lastSweep = now;
    const cutoff = now - windowMs;
    for (const [k, hits] of buckets) {
      if (!hits.length || hits[hits.length - 1] <= cutoff) buckets.delete(k);
    }
  }
  return {
    get size() { return buckets.size; },
    windowMs,
    maxHits,
    allow(key, now = Date.now()) {
      sweep(now);
      // Still full after a sweep: fail closed for new keys rather than grow.
      if (!buckets.has(key) && buckets.size >= maxKeys) return false;
      const cutoff = now - windowMs;
      const hits = (buckets.get(key) || []).filter((stamp) => stamp > cutoff);
      if (hits.length >= maxHits) {
        buckets.set(key, hits);
        return false;
      }
      hits.push(now);
      buckets.set(key, hits);
      return true;
    },
    resetMs(key, now = Date.now()) {
      const hits = buckets.get(key) || [];
      if (!hits.length) return 0;
      return Math.max(0, hits[0] + windowMs - now);
    },
  };
}

function emptyCounts() {
  return { verified: 0, invalid: 0, could_not_check: 0, rejected: 0 };
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'anon';
}

function dropRequestBody(req) {
  req.body = undefined;
  req.rawBody = undefined;
}

function countBucket(result) {
  if (result === 'verified') return 'verified';
  if (result === 'invalid') return 'invalid';
  return 'could_not_check';
}

/**
 * Fields safe to log. The pasted receipt is not one of them.
 * @param {{ overall?: string, status?: number }} record
 */
export function receiptCheckLogFields(record) {
  return {
    overall: record.overall || null,
    status: record.status ?? null,
  };
}

function defaultLog(record) {
  logger.info(receiptCheckLogFields(record), 'receipt check');
}

function reject(res, status, error, message, state) {
  state.counts.rejected += 1;
  res.set('Cache-Control', 'private, no-store');
  return res.status(status).json({ error, message });
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   windowMs?: number,
 *   maxHits?: number,
 *   maxBytes?: number,
 *   check?: typeof checkReceiptInput,
 *   log?: (record: { overall?: string, status?: number }) => void,
 * }} [options]
 */
export function mountReceiptCheck(app, options = {}) {
  const maxBytes = options.maxBytes ?? RECEIPT_CHECK_MAX_BYTES;
  const limiter = createReceiptCheckLimiter(
    options.windowMs ?? RECEIPT_CHECK_WINDOW_MS,
    options.maxHits ?? RECEIPT_CHECK_MAX_HITS,
  );
  const state = { counts: emptyCounts() };
  const check = options.check || checkReceiptInput;
  const log = options.log || defaultLog;
  app.locals.receiptCheck = state;

  app.post(RECEIPT_CHECK_PATH, async (req, res) => {
    try {
      const ip = clientIp(req);
      if (!limiter.allow(ip)) {
        const retry = Math.max(1, Math.ceil(limiter.resetMs(ip) / 1000));
        res.set('Retry-After', String(retry));
        return reject(res, 429, 'rate_limit_exceeded', 'Too many requests — slow down.', state);
      }

      const rawLen = req.rawBody ? req.rawBody.length : 0;
      if (rawLen > maxBytes + ENVELOPE_BYTES) {
        return reject(res, 413, 'payload_too_large', 'Receipt input is too large.', state);
      }

      const input = typeof req.body?.input === 'string' ? req.body.input : '';
      if (Buffer.byteLength(input) > maxBytes) {
        return reject(res, 413, 'payload_too_large', 'Receipt input is too large.', state);
      }

      const kind = classifyReceiptInput(input);
      if (kind !== 'json' && kind !== 'url' && kind !== 'id') {
        return reject(
          res,
          400,
          'receipt_required',
          'Paste a receipt, a receipt id, or a receipt URL.',
          state,
        );
      }

      if (kind === 'json') {
        try {
          const parsed = JSON.parse(input);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return reject(res, 400, 'receipt_required', 'Paste a receipt, a receipt id, or a receipt URL.', state);
          }
        } catch {
          return reject(res, 400, 'invalid_json', 'Receipt JSON did not parse.', state);
        }
      }

      const outcome = await check(input, { publicInput: true });
      let overall;
      let lines;
      let verdict = outcome.verdict;
      const historyReadError = outcome.report === 'stderr'
        && /^Error reading issuer history\b/.test(String(outcome.message || ''));
      if (historyReadError) {
        verdict = buildVerifyVerdict({
          version: outcome.verdict?.verifier?.version || '0.4.1',
          absentReason: 'issuer_history_unavailable',
        });
        overall = 'COULD_NOT_CHECK';
        lines = humanVerdictLines(verdict);
      } else if (outcome.report === 'stderr') {
        overall = 'INVALID';
        lines = ['INVALID', outcome.message || 'The receipt does not match what the issuer signed.'];
        verdict = {
          ...outcome.verdict,
          result: 'invalid',
          exit_code: 1,
          reason: outcome.reason || 'unreadable',
          message: outcome.message || verdict.message,
          next_step: null,
        };
      } else {
        overall = overallLine(outcome.verdict);
        lines = outcome.lines;
      }
      const bucket = countBucket(verdict.result);
      state.counts[bucket] += 1;
      log(receiptCheckLogFields({ overall, status: 200 }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ overall, lines, verdict });
    } catch {
      log(receiptCheckLogFields({ overall: null, status: 500 }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    } finally {
      dropRequestBody(req);
    }
  });

  return state;
}
