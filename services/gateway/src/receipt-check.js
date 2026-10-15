/**
 * Free receipt check. Not an x402 route.
 *
 * Accepts a pasted receipt JSON document, a receipt id, or a receipt URL.
 * The verdict is `checkReceiptInput` from chit402-verify — the same path the
 * CLI prints. Counts are anonymous totals. The pasted input is not stored
 * and is not written to the log.
 */

import { randomBytes } from 'node:crypto';
import logger from './logger.js';
import { buildVerifyVerdict, humanVerdictLines, overallLine } from '../../../packages/verify/dist/verdict.js';
import {
  checkReceiptInput,
  classifyReceiptInput,
} from '../../../packages/verify/dist/check-input.js';
import {
  bucketRows,
  clampStatsHours,
  evaluateCheckAlert,
  hourStart,
  normalizeClient,
  openCheckStats,
  resultOfOverall,
  STATS_DEFAULT_HOURS,
} from './receipt-check-stats.js';
import {
  buildFeedbackIssue,
  feedbackEnabled,
  feedbackToken,
  FEEDBACK_TOKEN_ENV,
  fileFeedbackIssue,
  prepareFeedback,
} from './receipt-feedback.js';

export const RECEIPT_CHECK_PATH = '/v1/receipts/check';
export const RECEIPT_FEEDBACK_PATH = '/v1/receipts/feedback';
export const RECEIPT_CHECK_STATS_PATH = '/v1/receipts/check/stats';
export const RECEIPT_CHECK_MAX_BYTES = 65_536;
export const RECEIPT_CHECK_WINDOW_MS = 60_000;
export const RECEIPT_CHECK_MAX_HITS = 30;
export const RECEIPT_CHECK_ACCEPTED = ['receipt JSON', 'a chit- id', 'a verify link'];
export const RECEIPT_CHECK_EXAMPLE = 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
export const RECEIPT_CHECK_INPUT_HINT = 'Paste receipt JSON, a chit- id, or a verify link.';

const ENVELOPE_BYTES = 64;
const LIMITER_MAX_KEYS = 50_000;
const HOUR_MS = 3_600_000;

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

function requestId() {
  return `chk_${randomBytes(8).toString('hex')}`;
}

export function hintForOverall(overall, verdict) {
  if (overall === 'VERIFIED') return null;
  const step = verdict && typeof verdict.next_step === 'string' ? verdict.next_step.trim() : '';
  if (step) return step;
  if (overall === 'NOT_IN_LOG') return 'This receipt is not in the public log. The book row is unchanged.';
  if (overall === 'INVALID') return 'Paste the signed receipt from the owner view and check it again.';
  if (overall === 'COULD_NOT_CHECK') return 'Try this check again.';
  return RECEIPT_CHECK_INPUT_HINT;
}

function oneLine(value, max) {
  if (value == null) return null;
  const text = String(value).replace(/[\r\n\u0000]/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function receiptFacts(input, kind, verdict) {
  const facts = {
    receipt_id: oneLine(verdict?.receipt_id, 80),
    receipt_version: verdict?.payload_version ?? null,
    issuer: null,
    chain: null,
  };
  if (kind === 'id' && !facts.receipt_id) facts.receipt_id = oneLine(input, 80);
  if (kind !== 'json') return facts;
  let doc;
  try {
    doc = JSON.parse(input);
  } catch {
    return facts;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return facts;
  if (!facts.receipt_id) facts.receipt_id = oneLine(doc.task_id || doc.receipt_id, 80);
  if (facts.receipt_version == null && Number.isInteger(doc.payload_version)) {
    facts.receipt_version = doc.payload_version;
  }
  facts.issuer = oneLine(doc.issuer_signature?.kid || doc.verification?.issuer_jwk_pin, 80);
  const chain = doc.chain || doc.payment?.network || doc.payment_meta?.network || doc.route_meta?.chain_id;
  facts.chain = oneLine(chain, 32);
  return facts;
}

function publicReport({ kind, bytes, client, overall, verdict, facts }) {
  const checks = verdict?.checks && typeof verdict.checks === 'object' ? { ...verdict.checks } : null;
  return {
    result_code: overall || null,
    reason: verdict?.reason || null,
    checks,
    input_kind: kind || 'other',
    input_bytes: bytes,
    receipt_id: facts?.receipt_id || null,
    receipt_version: facts?.receipt_version ?? null,
    issuer: facts?.issuer || null,
    chain: facts?.chain || null,
    client,
  };
}

/**
 * Fields safe to log. The pasted receipt is not one of them.
 * @param {{ overall?: string, status?: number, request_id?: string, reason?: string, client?: string }} record
 */
export function receiptCheckLogFields(record) {
  const fields = {
    overall: record.overall || null,
    status: record.status ?? null,
  };
  if (record.request_id) fields.request_id = record.request_id;
  if (record.reason) fields.reason = record.reason;
  if (record.client) fields.client = record.client;
  return fields;
}

function defaultLog(record) {
  logger.info(receiptCheckLogFields(record), 'receipt check');
}

function rateLimit(res, limiter, ip) {
  const retry = Math.max(1, Math.ceil(limiter.resetMs(ip) / 1000));
  res.set('Retry-After', String(retry));
  res.set('Cache-Control', 'private, no-store');
  return res.status(429).json({
    error: 'rate_limit_exceeded',
    message: 'Too many requests — slow down.',
    hint: 'Wait, then try the check again.',
    request_id: requestId(),
  });
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   windowMs?: number,
 *   maxHits?: number,
 *   maxBytes?: number,
 *   check?: typeof checkReceiptInput,
 *   log?: (record: object) => void,
 *   stats?: ReturnType<typeof openCheckStats>,
 *   feedbackToken?: string,
 *   githubFetch?: typeof fetch,
 *   now?: () => number,
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
  const stats = options.stats || openCheckStats(':memory:');
  const now = options.now || Date.now;
  const enabled = feedbackEnabled(options);
  if (!enabled) logger.info({ env: FEEDBACK_TOKEN_ENV }, 'receipt feedback unavailable');
  app.locals.receiptCheck = state;

  function envelope(extra) {
    return { feedback_enabled: enabled, ...extra };
  }

  app.post(RECEIPT_CHECK_PATH, async (req, res) => {
    const id = requestId();
    const client = normalizeClient(req.body?.client);
    try {
      const ip = clientIp(req);
      if (!limiter.allow(ip)) return rateLimit(res, limiter, ip);

      const rawLen = req.rawBody ? req.rawBody.length : 0;
      const input = typeof req.body?.input === 'string' ? req.body.input : '';
      const bytes = Buffer.byteLength(input);
      const kind = classifyReceiptInput(input);
      if (rawLen > maxBytes + ENVELOPE_BYTES || bytes > maxBytes) {
        log(receiptCheckLogFields({ overall: null, status: 413, request_id: id, client }));
        res.set('Cache-Control', 'private, no-store');
        state.counts.rejected += 1;
        return res.status(413).json(envelope({
          error: 'payload_too_large',
          message: 'Receipt input is too large.',
          hint: 'Paste a shorter receipt, or a chit- id, or a verify link.',
          accepted: RECEIPT_CHECK_ACCEPTED,
          example: RECEIPT_CHECK_EXAMPLE,
          request_id: id,
          report: publicReport({ kind, bytes, client, overall: null, verdict: null, facts: {} }),
        }));
      }

      if (kind !== 'json' && kind !== 'url' && kind !== 'id') {
        log(receiptCheckLogFields({ overall: null, status: 400, request_id: id, client }));
        res.set('Cache-Control', 'private, no-store');
        state.counts.rejected += 1;
        return res.status(400).json(envelope({
          error: 'receipt_required',
          message: 'Paste a receipt, a receipt id, or a receipt URL.',
          hint: RECEIPT_CHECK_INPUT_HINT,
          accepted: RECEIPT_CHECK_ACCEPTED,
          example: RECEIPT_CHECK_EXAMPLE,
          request_id: id,
          report: publicReport({ kind, bytes, client, overall: null, verdict: null, facts: {} }),
        }));
      }

      if (kind === 'json') {
        try {
          const parsed = JSON.parse(input);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            log(receiptCheckLogFields({ overall: null, status: 400, request_id: id, client }));
            res.set('Cache-Control', 'private, no-store');
            state.counts.rejected += 1;
            return res.status(400).json(envelope({
              error: 'receipt_required',
              message: 'Paste a receipt, a receipt id, or a receipt URL.',
              hint: RECEIPT_CHECK_INPUT_HINT,
              accepted: RECEIPT_CHECK_ACCEPTED,
              example: RECEIPT_CHECK_EXAMPLE,
              request_id: id,
              report: publicReport({ kind, bytes, client, overall: null, verdict: null, facts: {} }),
            }));
          }
        } catch {
          log(receiptCheckLogFields({ overall: null, status: 400, request_id: id, client }));
          res.set('Cache-Control', 'private, no-store');
          state.counts.rejected += 1;
          return res.status(400).json(envelope({
            error: 'invalid_json',
            message: 'Receipt JSON did not parse.',
            hint: RECEIPT_CHECK_INPUT_HINT,
            accepted: RECEIPT_CHECK_ACCEPTED,
            example: RECEIPT_CHECK_EXAMPLE,
            request_id: id,
            report: publicReport({ kind, bytes, client, overall: null, verdict: null, facts: {} }),
          }));
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
      const facts = receiptFacts(input, kind, verdict);
      const hint = hintForOverall(overall, verdict);
      const bucket = countBucket(verdict.result);
      state.counts[bucket] += 1;
      try {
        stats.record({
          at: now(),
          result: resultOfOverall(overall),
          reason: verdict.reason || 'none',
          client,
        });
      } catch (err) {
        logger.error({ err: err.message, request_id: id }, 'receipt check stats');
      }
      log(receiptCheckLogFields({
        overall,
        status: 200,
        request_id: id,
        reason: verdict.reason || null,
        client,
      }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json(envelope({
        overall,
        lines,
        verdict,
        hint,
        request_id: id,
        report: publicReport({ kind, bytes, client, overall, verdict, facts }),
      }));
    } catch {
      log(receiptCheckLogFields({ overall: null, status: 500, request_id: id, client }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(500).json({ error: 'internal', message: 'Internal server error', request_id: id });
    } finally {
      dropRequestBody(req);
    }
  });

  app.post(RECEIPT_FEEDBACK_PATH, async (req, res) => {
    const id = requestId();
    try {
      const ip = clientIp(req);
      if (!limiter.allow(ip)) return rateLimit(res, limiter, ip);
      const token = feedbackToken(options);
      if (!token) {
        log(receiptCheckLogFields({ overall: null, status: 503, request_id: id }));
        res.set('Cache-Control', 'private, no-store');
        return res.status(503).json({ error: 'feedback_unavailable', message: 'Feedback is off.', request_id: id });
      }
      const prepared = prepareFeedback(req.body, { timestamp: new Date(now()).toISOString() });
      if (!prepared.ok) {
        res.set('Cache-Control', 'private, no-store');
        return res.status(prepared.status).json({
          error: prepared.error,
          message: prepared.message,
          request_id: id,
        });
      }
      if (!prepared.record.request_id) prepared.record.request_id = id;
      const issue = buildFeedbackIssue(prepared.record);
      await fileFeedbackIssue(issue, token, options.githubFetch || globalThis.fetch);
      log(receiptCheckLogFields({
        overall: prepared.record.result_code,
        status: 202,
        request_id: prepared.record.request_id || id,
        client: prepared.record.client,
      }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(202).json({ ok: true, request_id: prepared.record.request_id || id });
    } catch {
      log(receiptCheckLogFields({ overall: null, status: 502, request_id: id }));
      res.set('Cache-Control', 'private, no-store');
      return res.status(502).json({ error: 'feedback_failed', message: 'Feedback was not filed.', request_id: id });
    } finally {
      dropRequestBody(req);
    }
  });

  app.get(RECEIPT_CHECK_STATS_PATH, (req, res) => {
    const ip = clientIp(req);
    if (!limiter.allow(ip)) return rateLimit(res, limiter, ip);
    const hours = req.query.hours == null || req.query.hours === ''
      ? STATS_DEFAULT_HOURS
      : clampStatsHours(req.query.hours);
    if (hours == null) {
      res.set('Cache-Control', 'private, no-store');
      return res.status(400).json({ error: 'bad_hours', message: 'hours must be a positive number.' });
    }
    const at = now();
    const end = hourStart(at);
    const start = end - (hours - 1) * HOUR_MS;
    let windowRows = [];
    let alertRows = [];
    try {
      windowRows = stats.rowsBetween(start, end);
      alertRows = stats.rowsBetween(end - 336 * HOUR_MS, end);
    } catch (err) {
      logger.error({ err: err.message }, 'receipt check stats read');
      res.set('Cache-Control', 'private, no-store');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    }
    res.set('Cache-Control', 'public, max-age=30');
    return res.status(200).json({
      hours,
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      buckets: bucketRows(windowRows),
      alert: evaluateCheckAlert(alertRows, at),
    });
  });

  return state;
}
