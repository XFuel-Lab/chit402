/**
 * Payer binding worker.
 *
 * Fed only by the book-row hook, after a fresh leaf append (no backfill).
 * The job keeps the leaf_hash that was actually appended for the task; at
 * sign time the leaf is re-derived from the log and must still match, or
 * the job fails with `leaf_mismatch`. One sign at a time, its own hourly cap
 * (cap kind `payer_binding`, separate from the receipt issuance cap),
 * bounded retries with backoff. Never runs on a read.
 *
 * Log lines carry the task id and a reason code only: never the payer, the
 * payer salt or the commitment.
 *
 * The binding is signed only by the key that signed the receipt (the holder
 * JWS header kid). When the active signer is another key, as after a key
 * rotation, the job is skipped with `kid_mismatch` and not retried.
 *
 * The owner view checks the same pairing at read time. A mutable stored JWS
 * (flag-off v10, issuer root off) can be re-signed under the active key after
 * its binding was sealed (tree-head restamp, or drop and re-sign). A sealed
 * binding whose kid is not the current receipt JWS header kid is shown as
 * `missing/kid_mismatch`, never as signed.
 *
 * Operator alerts: every refusal also writes a receipt-failure row
 * `payer_binding:<reason>` (code only, no task id), including
 * `payer_binding:kid_mismatch` when the active signer is not the receipt
 * key. The read-time `missing/kid_mismatch` in the owner view writes no
 * row. Skips for a receipt that
 * is not a Base mainnet USDC paid receipt (no_payer, no_payment, network,
 * asset, no_payment_ref) are counted only, with no row (receipt-failures.js).
 * `capped` (binding_cap backpressure) is not a refusal and raises nothing. A retried reason is raised
 * once, on the first attempt (outcome pending), and again if the job finally
 * fails (outcome refused), so a long backoff does not flood the log.
 */
import logger from './logger.js';
import { recordEscrowRefusal } from './receipt-failures.js';
import { peekIssuerSigner } from './issuer-signer-state.js';
import { decodeJwsClaims, leafRecordFor } from './public-attestation.js';
import { receiptLogSigningReady } from './receipt-merkle.js';
import { bindingInputsFromClaims, payerBindingFlagOn, signReceiptBinding } from './receipt-binding-eip712.js';
import { kidBytes32 } from './eip712-p256.js';

export const PAYER_BINDING_CAP_KIND = 'payer_binding';
export const PAYER_BINDING_DEFAULTS = Object.freeze({
  hourlyCap: 600,
  maxAttempts: 20,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
  tickMs: 15_000,
});

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/**
 * Hex of the leaf stored for a task in the open epoch, read straight from
 * the append result. Null when the task is not in the open epoch.
 */
export function appendedLeafHash(tree, taskId) {
  const index = tree?.byTask?.get?.(String(taskId));
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const stored = tree.leaves?.[index];
  return stored ? Buffer.from(stored).toString('hex') : null;
}

/**
 * The `kid` in a compact JWS protected header, or null. Only an ES256 header
 * counts: receipts are signed ES256, so any other alg is not a receipt key.
 */
export function jwsHeaderKid(jws) {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || header.alg !== 'ES256') return null;
    return typeof header.kid === 'string' && header.kid ? header.kid : null;
  } catch {
    return null;
  }
}

/**
 * True only when the sealed binding's signed kid is the bytes32 form of the
 * current receipt JWS header kid. Missing, malformed or different: false.
 */
export function bindingKidMatchesJws(binding, receiptJws) {
  const have = binding?.message?.kid;
  if (typeof have !== 'string' || !have) return false;
  const kid = jwsHeaderKid(receiptJws);
  if (!kid) return false;
  try {
    return kidBytes32(kid) === have;
  } catch {
    return false;
  }
}

/** True when the task already has a leaf (open or closed epoch). */
export function taskHasLeaf(tree, taskId) {
  if (!tree) return false;
  if (tree.byTask?.has?.(String(taskId))) return true;
  try {
    return Boolean(tree._findClosed?.(taskId));
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   store: ReturnType<import('./payer-binding-store.js').openPayerBindingStore>,
 *   tree: () => object,
 *   holderJws: (taskId: string) => string|null,
 *   signer?: () => object|null,
 *   ready?: (tree: object) => { ok: boolean, reason?: string },
 *   randomBytes?: (n: number) => Buffer,
 *   now?: () => number,
 *   env?: NodeJS.ProcessEnv,
 *   maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number, tickMs?: number,
 * }} deps
 */
export function createPayerBindingWorker(deps) {
  const env = deps.env || process.env;
  const cfg = {
    hourlyCap: positiveInt(env.RECEIPT_PAYER_BINDING_HOURLY_CAP, PAYER_BINDING_DEFAULTS.hourlyCap),
    maxAttempts: positiveInt(deps.maxAttempts, PAYER_BINDING_DEFAULTS.maxAttempts),
    baseDelayMs: positiveInt(deps.baseDelayMs, PAYER_BINDING_DEFAULTS.baseDelayMs),
    maxDelayMs: positiveInt(deps.maxDelayMs, PAYER_BINDING_DEFAULTS.maxDelayMs),
    tickMs: positiveInt(deps.tickMs, PAYER_BINDING_DEFAULTS.tickMs),
  };
  const store = deps.store;
  const now = deps.now || (() => Date.now());
  const signerOf = deps.signer || (() => peekIssuerSigner());
  const readyOf = deps.ready || ((tree) => receiptLogSigningReady(tree, env));
  const stats = { enqueued: 0, signed: 0, failed: 0, skipped: 0, retried: 0, capped: 0, refused_mismatch: 0, refused_kid: 0 };
  const cap = { windowStart: 0, used: 0 };
  let running = null;
  let interval = null;

  function capTake() {
    const t = now();
    if (t - cap.windowStart >= 3_600_000) {
      cap.windowStart = t;
      cap.used = 0;
    }
    if (cap.used >= cfg.hourlyCap) return { ok: false, retryAt: cap.windowStart + 3_600_000 };
    cap.used += 1;
    return { ok: true };
  }

  function note(level, code, taskId, reason) {
    logger[level]({ code, task_id: taskId, reason }, 'payer binding');
  }

  function alert(reason, outcome = 'refused') {
    recordEscrowRefusal({ path: 'payer_binding', reason, outcome });
  }

  function retryOrFail(job, reason) {
    const attempts = Number(job.attempts || 0) + 1;
    if (attempts >= cfg.maxAttempts) {
      store.updateJob(job.task_id, { status: 'failed', reason, attempts });
      stats.failed += 1;
      note('error', 'payer_binding_failed', job.task_id, reason);
      alert(reason);
      return 'failed';
    }
    if (attempts === 1) alert(reason, 'pending');
    const delay = Math.min(cfg.baseDelayMs * (2 ** (attempts - 1)), cfg.maxDelayMs);
    store.updateJob(job.task_id, { status: 'pending', reason, attempts, next_at: now() + delay });
    stats.retried += 1;
    note('warn', 'payer_binding_retry', job.task_id, reason);
    return 'retry';
  }

  function finalize(job, status, reason) {
    store.updateJob(job.task_id, { status, reason });
    if (status === 'failed') stats.failed += 1;
    if (status === 'skipped') stats.skipped += 1;
    note(status === 'failed' ? 'error' : 'info', `payer_binding_${status}`, job.task_id, reason);
    if (status === 'failed' || status === 'skipped') alert(reason);
    return status;
  }

  /**
   * Record a job for a leaf that was just appended. The caller passes the
   * hash read from the append result; nothing else may set it.
   * @returns {{ queued: boolean, reason?: string }}
   */
  function enqueueAppended({ taskId, rowHash, leafHash }) {
    if (!payerBindingFlagOn(env)) return { queued: false, reason: 'flag_off' };
    if (!store) return { queued: false, reason: 'no_store' };
    try {
      const { created } = store.createJob(taskId, { leaf_hash: leafHash, row_hash: rowHash, now: now() });
      if (created) stats.enqueued += 1;
      return { queued: created, reason: created ? undefined : 'exists' };
    } catch (err) {
      note('warn', 'payer_binding_refused', String(taskId), err?.code || 'store_error');
      alert(err?.code || 'store_error');
      return { queued: false, reason: err?.code || 'store_error' };
    }
  }

  async function processJob(job) {
    const taskId = job.task_id;
    const sealed = store.getBinding(taskId);
    if (sealed) {
      if (sealed.leaf_hash !== job.leaf_hash) {
        stats.refused_mismatch += 1;
        return finalize(job, 'failed', 'leaf_conflict');
      }
      // Stored bytes stand. Never re-signed.
      return finalize(job, 'signed', null);
    }
    const tree = deps.tree();
    const rec = leafRecordFor(tree, taskId, job.row_hash);
    if (!rec.ok) {
      if (rec.reason === 'leaf_mismatch') {
        stats.refused_mismatch += 1;
        return finalize(job, 'failed', 'leaf_mismatch');
      }
      return retryOrFail(job, rec.reason);
    }
    // M21: the leaf in the log for this task must be the leaf captured at append.
    if (rec.record.leaf_hash !== job.leaf_hash) {
      stats.refused_mismatch += 1;
      return finalize(job, 'failed', 'leaf_mismatch');
    }
    const holderJws = deps.holderJws(taskId);
    const claims = decodeJwsClaims(holderJws);
    if (!claims) return retryOrFail(job, 'holder_claims_missing');
    if (claims.task_id != null && String(claims.task_id) !== taskId) {
      return finalize(job, 'failed', 'task_id_mismatch');
    }
    const inputs = bindingInputsFromClaims(claims);
    if (!inputs.ok) return finalize(job, 'skipped', inputs.reason);
    const signer = signerOf();
    if (!signer) return retryOrFail(job, 'signer_unavailable');
    // A verifier checks the binding under the key that signed the receipt.
    // After a key rotation the active signer is another key, and a binding
    // it seals would read as invalid next to an honest receipt. Refuse, not
    // retried: the receipt's key will not come back as the active signer.
    // A holder JWS with no kid cannot be matched and is refused the same way.
    const receiptKid = jwsHeaderKid(holderJws);
    if (!receiptKid || receiptKid !== signer.kid) {
      stats.refused_kid += 1;
      return finalize(job, 'skipped', 'kid_mismatch');
    }
    const ready = readyOf(tree);
    if (!ready?.ok) return retryOrFail(job, ready?.reason || 'log_not_ready');
    const slot = capTake();
    if (!slot.ok) {
      stats.capped += 1;
      store.updateJob(taskId, { status: 'pending', reason: 'binding_cap', next_at: slot.retryAt });
      return 'capped';
    }
    const out = await signReceiptBinding({
      leafHash: job.leaf_hash,
      claims,
      ctx: {
        ready,
        logIdentity: tree?.logIdentity || null,
        kid: signer.kid,
        signer,
        randomBytes: deps.randomBytes,
      },
    });
    if (out.refused) {
      return out.retry ? retryOrFail(job, out.refused) : finalize(job, 'skipped', out.refused);
    }
    let sealedNow;
    try {
      sealedNow = store.seal(taskId, {
        ...out.record,
        epoch: rec.record.epoch,
        leaf_index: rec.record.leaf_index,
        bound_at: new Date(now()).toISOString(),
      });
    } catch (err) {
      if (err?.code === 'leaf_conflict') {
        stats.refused_mismatch += 1;
        return finalize(job, 'failed', 'leaf_conflict');
      }
      return retryOrFail(job, 'store_write');
    }
    if (sealedNow.created) stats.signed += 1;
    store.updateJob(taskId, { status: 'signed', reason: null });
    note('info', 'payer_binding_signed', taskId, null);
    return 'signed';
  }

  /** Run every due pending job once, one at a time. */
  async function tick() {
    if (running) return running;
    running = (async () => {
      const due = store ? store.listPending().filter((job) => Number(job.next_at || 0) <= now()) : [];
      const results = [];
      for (const job of due) {
        try {
          results.push(await processJob(job));
        } catch (err) {
          note('error', 'payer_binding_failed', job.task_id, err?.code || 'internal');
          alert('internal');
          results.push('error');
        }
      }
      return results;
    })().finally(() => { running = null; });
    return running;
  }

  return {
    enqueueAppended,
    tick,
    kick() {
      Promise.resolve().then(tick).catch(() => {});
    },
    start() {
      if (interval) return;
      interval = setInterval(() => { tick().catch(() => {}); }, cfg.tickMs);
      interval.unref?.();
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
    stats: () => ({ ...stats, cap_kind: PAYER_BINDING_CAP_KIND, cap_hour_used: cap.used, cap_hourly: cfg.hourlyCap }),
  };
}

/**
 * Owner-view status for a task. Reads only; never signs.
 * `receiptJws` is the receipt JWS served beside the binding. A sealed binding
 * is shown only when it was signed by that JWS's header kid.
 * @returns {{ status: 'signed', binding: object, payer_salt: string } | { status: 'pending' } | { status: 'missing', reason: string }}
 */
export function payerBindingView(store, taskId, receiptJws) {
  if (!store) return { status: 'missing', reason: 'not_bound' };
  let sealed = null;
  let job = null;
  try {
    sealed = store.getBinding(taskId);
    job = sealed ? null : store.getJob(taskId);
  } catch {
    return { status: 'missing', reason: 'store_unreadable' };
  }
  if (sealed?.binding && sealed?.payer_salt) {
    if (!bindingKidMatchesJws(sealed.binding, receiptJws)) return { status: 'missing', reason: 'kid_mismatch' };
    return { status: 'signed', binding: sealed.binding, payer_salt: sealed.payer_salt };
  }
  if (!job) return { status: 'missing', reason: 'not_bound' };
  if (job.status === 'pending') return { status: 'pending' };
  if (job.status === 'signed') return { status: 'missing', reason: 'binding_lost' };
  return { status: 'missing', reason: String(job.reason || job.status) };
}

export { bindingInputsFromClaims };
