/**
 * Public attestation worker (verifier 0.4.6).
 *
 * Runs after the log leaf exists, never on the paid path and never on a
 * read. One sign in flight at a time (a timed-out sign still counts until it
 * settles or passes a hard ceiling, after which its row is held and its late
 * result dropped), a per-minute rate cap, a sign timeout, bounded
 * retries with backoff, then `failed` plus an alert. It does not consume an
 * issuance-cap slot and never parks a late submission, so it cannot take a
 * slot from receipt signing.
 */
import { signJwsAsync } from './issuer-key.js';
import { peekIssuerSigner } from './issuer-signer-state.js';
import logger from './logger.js';
import {
  PUBLIC_RECEIPT_TYP,
  buildPublicClaims,
  decodeJwsClaims,
  leafRecordFor,
  normalizeBaseRef,
  publicAttestationEligibility,
  publicPayloadUtf8,
  verifyPublicAttestationJws,
} from './public-attestation.js';

export const PUBLIC_ATTESTATION_DEFAULTS = Object.freeze({
  ratePerMinute: 30,
  maxAttempts: 20,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
  signTimeoutMs: 3_000,
  tickMs: 15_000,
  // Hard ceiling for a sign that never settles: 10x the timeout. After it the
  // slot is released and that row is held, so its late result is never stored.
  signCeilingMs: 30_000,
});

const SIGN_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

async function defaultSign(payloadUtf8, { signal } = {}) {
  return await signJwsAsync(null, {
    typ: PUBLIC_RECEIPT_TYP,
    payloadUtf8,
    capKind: 'public_attestation',
    parkLate: false,
    signal,
  });
}

function defaultPublicJwk() {
  return peekIssuerSigner()?.publicJwk || null;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('sign timeout');
        err.code = 'sign_timeout';
        reject(err);
      }, ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{
 *   store: import('./public-attestation-store.js').PublicAttestationStore,
 *   tree: () => object,
 *   findEntry: (taskId: string) => object|null,
 *   holderJws: (taskId: string, entry: object|null) => string|null,
 *   sign?: (payloadUtf8: string) => Promise<{ jws: string, kid: string }>,
 *   publicJwk?: () => object|null,
 *   now?: () => number,
 *   alert?: (event: object) => void,
 *   env?: NodeJS.ProcessEnv,
 * }} deps
 */
export function createPublicAttestationWorker(deps) {
  const env = deps.env || process.env;
  const cfg = {
    ratePerMinute: positiveInt(env.PUBLIC_ATTESTATION_SIGNS_PER_MIN, PUBLIC_ATTESTATION_DEFAULTS.ratePerMinute),
    maxAttempts: positiveInt(deps.maxAttempts, PUBLIC_ATTESTATION_DEFAULTS.maxAttempts),
    baseDelayMs: positiveInt(deps.baseDelayMs, PUBLIC_ATTESTATION_DEFAULTS.baseDelayMs),
    maxDelayMs: positiveInt(deps.maxDelayMs, PUBLIC_ATTESTATION_DEFAULTS.maxDelayMs),
    signTimeoutMs: positiveInt(deps.signTimeoutMs, PUBLIC_ATTESTATION_DEFAULTS.signTimeoutMs),
    tickMs: positiveInt(deps.tickMs, PUBLIC_ATTESTATION_DEFAULTS.tickMs),
    signCeilingMs: 0,
  };
  // Never below the timeout: a sign is abandoned only after its wait is over.
  cfg.signCeilingMs = Math.max(
    positiveInt(deps.signCeilingMs, cfg.signTimeoutMs * 10),
    cfg.signTimeoutMs,
  );
  const sign = deps.sign || defaultSign;
  const publicJwk = deps.publicJwk || defaultPublicJwk;
  const now = deps.now || (() => Date.now());
  const alert = deps.alert || ((event) => logger.error(event, 'public attestation alert'));
  const store = deps.store;

  const stats = {
    signed: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    throttled: 0,
    timed_out: 0,
    waited_on_inflight: 0,
    released_after_ceiling: 0,
    sign_ms: Object.fromEntries([...SIGN_BUCKETS_MS.map((b) => [`le_${b}`, 0]), ['gt_10000', 0]]),
  };
  let tokens = cfg.ratePerMinute;
  let refilledAt = now();
  let running = false;
  // The sign promise still outstanding, even after its timeout fired. No new
  // sign starts until it settles, so at most one Sign is ever in flight (S3).
  let inflight = null;
  let inflightSince = 0;
  let inflightTask = null;
  // Tasks whose sign was abandoned at the ceiling. Their late results are
  // dropped, and the store holds the row so nothing else can sign it.
  const abandoned = new Set();
  let timer = null;
  let interval = null;

  function refill() {
    const t = now();
    const elapsed = t - refilledAt;
    if (elapsed <= 0) return;
    const add = (elapsed / 60_000) * cfg.ratePerMinute;
    if (add >= 1) {
      tokens = Math.min(cfg.ratePerMinute, tokens + Math.floor(add));
      refilledAt = t;
    }
  }

  function observe(ms) {
    const bucket = SIGN_BUCKETS_MS.find((b) => ms <= b);
    stats.sign_ms[bucket ? `le_${bucket}` : 'gt_10000'] += 1;
  }

  async function retryOrFail(row, error) {
    const attempts = Number(row.attempts || 0) + 1;
    if (attempts >= cfg.maxAttempts) {
      await store.markFailed(row.task_id, { error });
      stats.failed += 1;
      return;
    }
    const delay = Math.min(cfg.baseDelayMs * (2 ** (attempts - 1)), cfg.maxDelayMs);
    await store.markRetry(row.task_id, { error, nextAt: now() + delay });
    stats.retried += 1;
  }

  /** Start one sign. The timeout rejects the wait, not the sign; `inflight` holds until it settles. */
  function startSign(payload, taskId) {
    const controller = new AbortController();
    const attempt = Promise.resolve().then(() => sign(payload, { signal: controller.signal }));
    const tracked = attempt.then(() => {}, () => {}).finally(() => {
      if (inflight === tracked) inflight = null;
      if (inflightTask === taskId && inflight == null) inflightTask = null;
    });
    inflight = tracked;
    inflightSince = Date.now();
    inflightTask = taskId;
    const settledHere = () => {
      if (inflight === tracked) {
        inflight = null;
        inflightTask = null;
      }
    };
    return withTimeout(attempt, cfg.signTimeoutMs).then((value) => {
      settledHere(); // the sign itself finished: free the slot now
      return value;
    }, (err) => {
      if (err?.code === 'sign_timeout') {
        // The sign is still outstanding: the slot stays taken until it settles.
        stats.timed_out += 1;
        controller.abort(err);
      } else {
        settledHere();
      }
      throw err;
    });
  }

  async function processOne(row) {
    const entry = deps.findEntry(row.task_id);
    if (!entry) return retryOrFail(row, 'entry_missing');
    const holder = deps.holderJws(row.task_id, entry);
    if (!holder) return retryOrFail(row, 'holder_jws_missing');
    const claims = decodeJwsClaims(holder);
    const eligible = publicAttestationEligibility(entry, claims);
    if (!eligible.ok) {
      await store.markSkipped(row.task_id, { reason: eligible.reason });
      stats.skipped += 1;
      return;
    }
    if (row.ref && normalizeBaseRef(claims.payment.ref) !== row.ref) {
      await store.markSkipped(row.task_id, { reason: 'ref_mismatch' });
      stats.skipped += 1;
      return;
    }
    const leaf = leafRecordFor(deps.tree(), row.task_id, entry.row_hash || '');
    if (!leaf.ok) {
      if (leaf.reason === 'leaf_mismatch') {
        await store.markFailed(row.task_id, { error: 'leaf_mismatch' });
        stats.failed += 1;
        return;
      }
      return retryOrFail(row, leaf.reason);
    }
    const publicClaims = buildPublicClaims({ claims, leaf: leaf.record, attestedAt: now() });
    const payload = publicPayloadUtf8(publicClaims);
    const started = Date.now();
    let signed;
    try {
      signed = await startSign(payload, row.task_id);
    } finally {
      observe(Date.now() - started);
    }
    if (abandoned.has(row.task_id)) return; // released at the ceiling: never stored
    const jwk = publicJwk();
    if (!jwk || !verifyPublicAttestationJws(signed?.jws, jwk)) {
      await store.markFailed(row.task_id, { error: 'self_verify_failed' });
      stats.failed += 1;
      return;
    }
    const saved = await store.markSigned(row.task_id, { jws: signed.jws, kid: signed.kid, now: now() });
    if (saved.ok && !saved.duplicate) stats.signed += 1;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      refill();
      for (;;) {
        if (inflight) {
          const outstanding = Date.now() - inflightSince;
          if (outstanding < cfg.signCeilingMs) {
            // A timed-out sign is still outstanding. Wait for a later tick.
            stats.waited_on_inflight += 1;
            break;
          }
          // Past the hard ceiling: hold that row first, then free the slot.
          // Its late result is dropped and the held row cannot be signed
          // again until restart, so at most one sign can still be stored.
          const taskId = inflightTask;
          if (taskId) {
            abandoned.add(taskId);
            store.hold(taskId);
          }
          inflight = null;
          inflightTask = null;
          stats.released_after_ceiling += 1;
          alert({ event: 'public_attestation_sign_released', task_id: taskId, outstanding_ms: outstanding });
        }
        if (!store.hasDue(now())) break;
        if (tokens < 1) {
          stats.throttled += 1;
          break;
        }
        const [row] = store.due(now(), 1);
        if (!row) continue;
        tokens -= 1;
        try {
          await processOne(row);
        } catch (err) {
          await retryOrFail(row, err?.code || err?.message || 'sign_error').catch(() => {});
        }
      }
    } finally {
      running = false;
    }
  }

  function kick() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      tick().catch((err) => logger.warn({ err: err.message }, 'public attestation tick failed'));
    }, 0);
    timer.unref?.();
  }

  return {
    config: cfg,
    stats: () => ({ ...stats, sign_ms: { ...stats.sign_ms }, tokens, inflight: Boolean(inflight), abandoned: abandoned.size, rows: store.counts() }),
    /**
     * Queue a book row after its leaf append succeeded. Cheap: no sign here.
     * Rows that are plainly not collected native Base USDC are not queued.
     */
    async enqueue(entry) {
      if (!entry?.task_id || entry.collected !== true) return null;
      if (entry.foreign_x402 || entry.source) return null;
      const ref = normalizeBaseRef(entry.payment_ref);
      if (!ref) return null;
      const out = await store.enqueue({ taskId: String(entry.task_id), ref, now: now() });
      if (out.ok && !out.duplicate) kick();
      return out;
    },
    tick,
    kick,
    start() {
      if (interval) return;
      interval = setInterval(() => {
        tick().catch((err) => logger.warn({ err: err.message }, 'public attestation tick failed'));
      }, cfg.tickMs);
      interval.unref?.();
      kick();
    },
    stop() {
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
      interval = null;
      timer = null;
    },
  };
}
