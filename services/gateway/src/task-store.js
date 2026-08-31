import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * PersistentTaskStore — a durable, restart-safe task store.
 *
 * Why: tasks (and the public `verify_url` receipt built from them) used to live only
 * in an in-memory Map. A shared verify_url would 404 after a restart, or once a
 * settled task was garbage-collected (~1h after settling). Since verify_url is the
 * centerpiece of the "trust artifact" pitch, a broken link undermines the whole
 * value prop. This store fixes that without changing any call site.
 *
 * How: it subclasses Map, so `set/get/delete/values/entries/size/for..of` all keep
 * working. On top of that it:
 *   - write-throughs a JSON snapshot to disk on `set` (atomic tmp+rename),
 *   - periodically flushes in-place mutations (status → proof → fee_collected),
 *   - RETAINS the snapshot on `delete` (so the hot-map eviction no longer kills the
 *     receipt), and
 *   - lazily rehydrates from disk on a `get` miss — WITHOUT re-inserting into the hot
 *     map, so iteration (webhook dispatcher, GC, /health counts) stays "live tasks
 *     only" and terminal webhooks never re-fire.
 *
 * Durability model: single-node, one JSON file per task. Matches the Phase-1
 * single-process model; point `dir` at a shared volume or swap for Redis/Postgres
 * to scale horizontally. A long-TTL GC prunes old receipts.
 */

/** JSON.stringify that won't throw on BigInt task fields (serialized as strings). */
function safeStringify(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export class PersistentTaskStore extends Map {
  /**
   * @param {Object} [opts]
   * @param {string}  [opts.dir]          durable snapshot directory
   * @param {boolean} [opts.persist=true] false → behave as a plain in-memory Map
   * @param {number}  [opts.autoFlushMs]  periodic flush interval (0 → disabled)
   * @param {number}  [opts.retentionMs]  prune persisted receipts older than this
   */
  constructor({ dir, persist = true, autoFlushMs = 10000, retentionMs = 30 * 24 * 3600 * 1000 } = {}) {
    super();
    this.dir = dir || null;
    this.persist = !!(persist && this.dir);
    this.retentionMs = retentionMs;
    this._flushTimer = null;
    this._gcTimer = null;
    this._refIndex = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'task-store: mkdir failed; persistence disabled');
        this.persist = false;
      }
    }
    if (this.persist) {
      if (autoFlushMs > 0) {
        this._flushTimer = setInterval(() => this.flushAll(), autoFlushMs);
        this._flushTimer.unref?.();
      }
      // Hourly prune of receipts past retention. Cheap; unref'd so it never holds
      // the process open on its own.
      this._gcTimer = setInterval(() => this.gcPersisted(), 3600_000);
      this._gcTimer.unref?.();
      // Rebuild the payment ref index from persisted snapshots on startup.
      this._rebuildRefIndex();
    }
  }

  /**
   * Rebuild the payment ref → taskId index from persisted snapshots.
   * Called once on startup when persistence is enabled.
   */
  _rebuildRefIndex() {
    if (!this.persist) return;
    let files;
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        if (snap?.taskId) {
          this._indexPaymentRef(snap);
        }
      } catch {
        // Skip unreadable files.
      }
    }
    logger.info({ indexSize: this._refIndex.size }, 'task-store: rebuilt payment ref index');
  }

  /**
   * Index a task's payment ref(s) for reverse lookup.
   * Supports both `intent.paymentRef` and Solana tx signatures.
   */
  _indexPaymentRef(task) {
    if (!task?.taskId) return;
    const ref = task.intent?.paymentRef;
    if (ref && typeof ref === 'string') {
      // Index the full ref (network:txHash)
      this._refIndex.set(ref, task.taskId);
      // Also index just the tx hash/signature for Solana lookups
      const colonIdx = ref.indexOf(':');
      if (colonIdx > 0) {
        const txOnly = ref.slice(colonIdx + 1);
        if (txOnly) this._refIndex.set(txOnly, task.taskId);
      }
    }
  }

  _fileFor(taskId) {
    return path.join(this.dir, `${encodeURIComponent(taskId)}.json`);
  }

  _writeSnapshot(task) {
    if (!this.persist || !task || !task.taskId) return;
    try {
      const target = this._fileFor(task.taskId);
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, safeStringify(task));
      fs.renameSync(tmp, target); // atomic replace
    } catch (err) {
      logger.warn({ err: err.message, taskId: task.taskId }, 'task-store: snapshot write failed');
    }
  }

  _readSnapshot(taskId) {
    if (!this.persist) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this._fileFor(taskId), 'utf8'));
    } catch {
      return undefined; // unknown/expired task
    }
  }

  /** Write-through: keep the live reference, persist a snapshot, and index payment ref. */
  set(taskId, task) {
    super.set(taskId, task);
    this._writeSnapshot(task);
    this._indexPaymentRef(task);
    return this;
  }

  /** Live reference if active; else the durable snapshot (read-only), else undefined. */
  get(taskId) {
    const live = super.get(taskId);
    if (live !== undefined) return live;
    return this._readSnapshot(taskId);
  }

  /**
   * Look up a task by payment ref (tx signature or network:txHash).
   * Returns the task object or undefined if not found.
   * This enables receipt lookup by Solana tx signature when task ID is unknown.
   */
  getByPaymentRef(ref) {
    if (!ref || typeof ref !== 'string') return undefined;
    const taskId = this._refIndex.get(ref);
    if (taskId) return this.get(taskId);
    // Try scanning persisted snapshots if not in index (fallback for pre-index tasks)
    if (this.persist) {
      const task = this._scanForPaymentRef(ref);
      if (task) {
        this._indexPaymentRef(task);
        return task;
      }
    }
    return undefined;
  }

  /**
   * Scan persisted snapshots for a task with the given payment ref.
   * Expensive fallback for tasks created before the index existed.
   */
  _scanForPaymentRef(ref) {
    if (!this.persist) return undefined;
    let files;
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return undefined;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        const taskRef = snap?.intent?.paymentRef;
        if (!taskRef) continue;
        // Match full ref or just the tx part
        if (taskRef === ref) return snap;
        const colonIdx = taskRef.indexOf(':');
        if (colonIdx > 0 && taskRef.slice(colonIdx + 1) === ref) return snap;
      } catch {
        // Skip unreadable files.
      }
    }
    return undefined;
  }

  /**
   * Evict from the hot map but RETAIN the durable snapshot, so the receipt/verify_url
   * still resolves after the listener GCs a settled task. Flushes a final snapshot
   * first to capture any last mutation.
   */
  delete(taskId) {
    const live = super.get(taskId);
    if (live !== undefined) this._writeSnapshot(live);
    return super.delete(taskId);
  }

  /** Persist every live task (captures in-place status/proof mutations). */
  flushAll() {
    if (!this.persist) return;
    for (const task of super.values()) this._writeSnapshot(task);
  }

  /**
   * All known tasks for aggregation/telemetry: the union of durable snapshots on
   * disk and the live hot map, with the live copy winning (it's the freshest).
   * Restart-surviving — the basis for real usage stats. Read-only; never mutate the
   * returned objects (disk copies aren't tracked).
   * @returns {Array<Object>}
   */
  allSnapshots() {
    const byId = new Map();
    if (this.persist) {
      let files = [];
      try {
        files = fs.readdirSync(this.dir);
      } catch {
        files = [];
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
          if (snap && snap.taskId) byId.set(snap.taskId, snap);
        } catch {
          // Skip unreadable/partial files.
        }
      }
    }
    // Live entries override the on-disk snapshot (may hold newer in-place mutations).
    for (const [id, task] of super.entries()) byId.set(id, task);
    return [...byId.values()];
  }

  /**
   * Prune persisted receipts older than `maxAgeMs` (by updatedAt/createdAt).
   * @returns {number} files removed
   */
  gcPersisted(maxAgeMs = this.retentionMs) {
    if (!this.persist) return 0;
    let removed = 0;
    const now = Date.now();
    let files;
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(this.dir, f);
      try {
        const snap = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const ts = snap.updatedAt || snap.createdAt || 0;
        if (now - ts > maxAgeMs) {
          fs.unlinkSync(fp);
          removed++;
        }
      } catch {
        // Unreadable/partial file — leave it; a later flush may repair it.
      }
    }
    if (removed) logger.info({ removed, dir: this.dir }, 'task-store: pruned expired receipts');
    return removed;
  }

  /** Stop background timers (tests / graceful shutdown). */
  destroy() {
    if (this._flushTimer) clearInterval(this._flushTimer);
    if (this._gcTimer) clearInterval(this._gcTimer);
    this._flushTimer = null;
    this._gcTimer = null;
  }
}

/** Factory reading defaults from config.taskStore (overridable for tests). */
export function createTaskStore(opts = {}) {
  return new PersistentTaskStore(opts);
}

export default { PersistentTaskStore, createTaskStore };
