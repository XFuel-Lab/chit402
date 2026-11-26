/**
 * Single writer for closeHour.
 *
 * One close is in flight. A second call is sealer_busy and does not Sign
 * or send. The whole attempt is bounded by CHIT_SEALER_CLOSE_TIMEOUT_MS
 * (default 20000, clamped 1000–30000). A timeout or an unexpected throw
 * is sealer_unavailable. The log line is the code only.
 *
 * After a timeout the generation moves, so a late Sign cannot send, and
 * the slot is released so the next tick can recover. A per-call abort
 * fires with the timeout. This module does not install an interval and
 * is not called from startServer.
 */

import { closeHour } from './close.js';
import { clampBoundedTimeout } from './kms-secp256k1.js';

const SEALER_CLOSE_TIMEOUT_DEFAULT_MS = 20000;

let refusalLog = null;

/** Test sink. Unset uses the gateway logger and still logs only `{ code }`. */
export function setSealerRefusalLog(fn) {
  refusalLog = typeof fn === 'function' ? fn : null;
}

function defaultCloseLog(fields, msg) {
  import('../gateway/src/logger.js').then((mod) => {
    try { mod.default.error(fields, msg); } catch { /* the refusal is already returned */ }
  }, () => {});
}

function logCloseRefusal(log) {
  const fields = { code: 'sealer_unavailable' };
  const msg = 'sealer close refused';
  const sink = typeof log === 'function' ? log : (refusalLog || defaultCloseLog);
  try { sink(fields, msg); } catch { /* the caller still gets the named code */ }
}

function sealerRefused() {
  const err = new Error('sealer unavailable');
  err.code = 'sealer_unavailable';
  return err;
}

/** `CHIT_SEALER_CLOSE_TIMEOUT_MS`. Default 20000. Same clamp as checkpoint KMS. */
export function sealerCloseTimeoutMs(env) {
  const raw = env == null ? undefined : env.CHIT_SEALER_CLOSE_TIMEOUT_MS;
  return clampBoundedTimeout(raw, SEALER_CLOSE_TIMEOUT_DEFAULT_MS);
}

const slot = { busy: false, generation: 0 };

/** Drops the in-flight bit. A late send still sees the moved generation. */
export function resetSealerGuardForTest() {
  slot.generation += 1;
  slot.busy = false;
}

const GUARD_REASONS = new Set([
  'anchor_simulation_failed',
  'anchor_head_mismatch',
  'anchor_reverted',
  'anchor_quorum',
]);

/**
 * One in-flight sealer attempt. close, recover, and fee replacement share
 * this slot. A timeout aborts the call and moves the generation, then
 * releases the slot.
 * @param {(ctx: { signal: AbortSignal, stale: () => boolean }) => Promise<object>} fn
 * @param {{ env?: object, log?: Function }} [deps]
 */
export async function withSealerGuard(fn, deps = {}) {
  if (slot.busy) return { ok: false, reason: 'sealer_busy' };
  slot.busy = true;
  const generation = slot.generation;
  const env = deps && Object.prototype.hasOwnProperty.call(deps, 'env') ? deps.env : process.env;
  const log = deps && deps.log;
  const ms = sealerCloseTimeoutMs(env);
  const ac = new AbortController();
  let timedOut = false;
  let timer;

  function stale() {
    return timedOut || slot.generation !== generation || ac.signal.aborted;
  }

  const work = Promise.resolve().then(() => fn({ signal: ac.signal, stale }));
  const guarded = work.then(
    (value) => (stale() ? { ok: false, reason: 'sealer_unavailable' } : value),
    (err) => {
      logCloseRefusal(log);
      const code = err && err.code;
      if (typeof code === 'string' && GUARD_REASONS.has(code)) return { ok: false, reason: code };
      return { ok: false, reason: 'sealer_unavailable' };
    },
  );

  try {
    return await Promise.race([
      guarded,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          slot.generation += 1;
          ac.abort();
          logCloseRefusal(log);
          resolve({ ok: false, reason: 'sealer_unavailable' });
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    slot.busy = false;
  }
}

/**
 * The production close entry. closeHour is called from here only.
 * @param {object} sealer
 * @param {object} input
 * @param {{ env?: object, log?: Function }} [deps]
 */
export async function guardCloseHour(sealer, input, deps = {}) {
  return withSealerGuard(({ signal, stale }) => {
    const body = input || {};
    async function guardedSend(wire) {
      if (stale()) throw sealerRefused();
      const tx = await body.send(wire, { signal });
      if (stale()) throw sealerRefused();
      return tx;
    }
    const next = typeof body.send === 'function'
      ? { ...body, send: guardedSend, signal }
      : body;
    return closeHour(sealer, next);
  }, deps);
}
