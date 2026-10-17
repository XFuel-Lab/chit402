/**
 * Durable public-attestation outbox and store (verifier 0.4.6).
 *
 * One row per task_id and at most one live row per normalized payment ref
 * (`base:` + lowercase hash). States: pending, signed, failed, skipped.
 * A signed row is never replaced: a second, different JWS for the same task
 * is refused and alerted, and the first is kept. Rows are never pruned.
 *
 * Durability (S1, S2): every change is written and fsynced, off the event
 * loop, before memory changes. A JWS is served only after it is durable. If
 * a write fails, memory keeps the prior state, the task is held (no re-sign
 * until restart, so no second JWS can appear) and an alert is raised.
 *
 * Layout under `dir` (file names are sha256 of the task id or ref):
 *   pending/<k>.json      queued rows, rewritten atomically (tmp, fsync, rename)
 *   done/<kk>/<k>.json    terminal rows, created once (tmp, fsync, link)
 *   refs/<kk>/<k>.json    payment ref claims, created once
 *
 * Memory (S4): only pending rows, a due-time heap over them, and a bounded
 * LRU of served results. Terminal rows live on disk. A tick costs O(due),
 * boot reads only pending/, and memory does not grow with the receipt count.
 *
 * This module imports no signer. The GET receipt route reads attestations
 * only through `servedAttestation`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_ATTESTATION_STATES = Object.freeze(['pending', 'signed', 'failed', 'skipped']);
export const PUBLIC_ATTESTATION_CACHE_DEFAULT = 5000;

function flagOn(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/** Issuance (worker) flag. Default off. */
export function publicAttestationSignEnabled(env = process.env) {
  return flagOn(env.PUBLIC_ATTESTATION_SIGN);
}

/** Serve flag. Default off. Turned on only after 0.4.6 is published and rows are stored. */
export function publicAttestationServeEnabled(env = process.env) {
  return flagOn(env.PUBLIC_ATTESTATION_SERVE);
}

/**
 * Whether the worker may run. Signing needs a durable store: without one,
 * pending rows and the one-per-ref claims are lost on restart and a task
 * or a payment could be attested twice.
 */
export function publicAttestationSignDecision({ env = process.env, dir = null } = {}) {
  if (!publicAttestationSignEnabled(env)) return { on: false, reason: 'flag_off' };
  if (!dir) return { on: false, reason: 'no_durable_store' };
  return { on: true, reason: null };
}

function keyOf(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseRow(text) {
  if (typeof text !== 'string') return null;
  try {
    const row = JSON.parse(text);
    if (!row?.task_id || !PUBLIC_ATTESTATION_STATES.includes(row.state)) return null;
    return row;
  } catch {
    return null;
  }
}

async function fsyncDir(dir) {
  // Directory fsync makes the rename or link durable. Not supported everywhere.
  let handle = null;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch {
    /* best effort */
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeTmp(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = await fsp.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => {});
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  await handle.close();
  return tmp;
}

/** Async disk backend. Every write is fsynced before it resolves. */
export function diskBackend() {
  return {
    async read(file) {
      try {
        return await fsp.readFile(file, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    async writeAtomic(file, data) {
      const tmp = await writeTmp(file, data);
      try {
        await fsp.rename(tmp, file);
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        throw err;
      }
      await fsyncDir(path.dirname(file));
    },
    /** Create once. Never a torn file: the full tmp is linked into place. */
    async createExclusive(file, data) {
      const tmp = await writeTmp(file, data);
      try {
        await fsp.link(tmp, file);
      } catch (err) {
        if (err?.code === 'EEXIST') return { created: false, existing: await this.read(file) };
        throw err;
      } finally {
        await fsp.unlink(tmp).catch(() => {});
      }
      await fsyncDir(path.dirname(file));
      return { created: true };
    },
    async unlink(file) {
      try {
        await fsp.unlink(file);
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    },
    /** Boot only: the pending rows. */
    listSync(dir) {
      try {
        return fs.readdirSync(dir).map((name) => path.join(dir, name));
      } catch {
        return [];
      }
    },
    readSync(file) {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

/** In-memory backend with the same semantics. Used when persistence is off and in tests. */
export function memoryBackend(files = new Map()) {
  return {
    files,
    async read(file) {
      return files.has(file) ? files.get(file) : null;
    },
    async writeAtomic(file, data) {
      files.set(file, data);
    },
    async createExclusive(file, data) {
      if (files.has(file)) return { created: false, existing: files.get(file) };
      files.set(file, data);
      return { created: true };
    },
    async unlink(file) {
      files.delete(file);
    },
    listSync(dir) {
      const prefix = `${dir}${path.sep}`;
      return [...files.keys()].filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes(path.sep));
    },
    readSync(file) {
      return files.has(file) ? files.get(file) : null;
    },
  };
}

/** Min-heap of { at, id }. */
class DueHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0] || null;
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].at <= a[i].at) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].at < a[m].at) m = l;
        if (r < a.length && a[r].at < a[m].at) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class PublicAttestationStore {
  /**
   * @param {{ dir?: string|null, alert?: (event: object) => void, backend?: object, cacheSize?: number }} [opts]
   */
  constructor({ dir = null, alert = () => {}, backend = null, cacheSize = PUBLIC_ATTESTATION_CACHE_DEFAULT } = {}) {
    this.dir = dir || '/mem/public-attestations';
    this.backend = backend || (dir ? diskBackend() : memoryBackend());
    this.alert = alert;
    this.cacheSize = Math.max(1, Number(cacheSize) || PUBLIC_ATTESTATION_CACHE_DEFAULT);
    /** @type {Map<string, object>} pending rows only */
    this.pending = new Map();
    this.heap = new DueHeap();
    /** ids currently in the heap (each pending id at most once) */
    this.scheduled = new Set();
    /** ids whose last write failed: never re-signed or re-written until restart */
    this.held = new Set();
    /** LRU: id -> served result for terminal or absent rows */
    this.cache = new Map();
    this.locks = new Map();
    this.totals = { signed: 0, failed: 0, skipped: 0, persist_failed: 0 };
    this.load();
  }

  _pendingFile(id) {
    return path.join(this.dir, 'pending', `${keyOf(id)}.json`);
  }

  _doneFile(id) {
    const k = keyOf(id);
    return path.join(this.dir, 'done', k.slice(0, 2), `${k}.json`);
  }

  _refFile(ref) {
    const k = keyOf(ref);
    return path.join(this.dir, 'refs', k.slice(0, 2), `${k}.json`);
  }

  /** Boot: read pending rows only. A pending row whose terminal row exists is stale. */
  load() {
    this.pending.clear();
    this.heap = new DueHeap();
    this.scheduled.clear();
    for (const file of this.backend.listSync(path.join(this.dir, 'pending'))) {
      if (!file.endsWith('.json')) continue; // a .tmp from a crash mid-write
      const row = parseRow(this.backend.readSync(file));
      if (!row || row.state !== 'pending') continue;
      if (this.backend.readSync(this._doneFile(row.task_id)) != null) continue;
      this.pending.set(row.task_id, row);
      this._schedule(row.task_id, Number(row.next_at || 0));
    }
  }

  async _locked(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chain = prev.then(() => gate);
    this.locks.set(key, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  _schedule(id, at) {
    if (this.scheduled.has(id) || this.held.has(id)) return;
    this.scheduled.add(id);
    this.heap.push({ at, id });
  }

  _cacheSet(id, value) {
    this.cache.delete(id);
    this.cache.set(id, value);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
  }

  _persistFailed(id, op, err) {
    this.held.add(id);
    this.totals.persist_failed += 1;
    this.alert({ event: 'public_attestation_persist_failed', task_id: id, op, error: String(err?.code || err?.message || err).slice(0, 80) });
  }

  async _readDone(id) {
    return parseRow(await this.backend.read(this._doneFile(id)));
  }

  /** Pending row from memory, else the terminal row from disk, else null. */
  async get(taskId) {
    const id = String(taskId);
    return this.pending.get(id) || await this._readDone(id);
  }

  async taskForRef(ref) {
    const text = await this.backend.read(this._refFile(ref));
    try {
      return text ? JSON.parse(text).task_id || null : null;
    } catch {
      return null;
    }
  }

  /** A ref claim is live while its holder is pending or signed. */
  async _refHolderLive(holder) {
    if (this.pending.has(holder)) return true;
    const done = await this._readDone(holder);
    return done?.state === 'signed';
  }

  /**
   * Queue one task. A task already present is a no-op. A ref already held
   * by another live task is skipped (`duplicate_ref`) and alerted.
   */
  async enqueue({ taskId, ref, now = Date.now() }) {
    const id = String(taskId);
    return this._locked(`t:${id}`, async () => {
      if (this.held.has(id)) return { ok: false, reason: 'held' };
      const existing = this.pending.get(id) || await this._readDone(id);
      if (existing) return { ok: true, duplicate: true, row: existing };
      const createdAt = new Date(now).toISOString();
      const run = async () => {
        let claimed = false;
        if (ref) {
          const refFile = this._refFile(ref);
          const claim = JSON.stringify({ task_id: id, ref });
          const made = await this.backend.createExclusive(refFile, claim);
          if (made.created) {
            claimed = true;
          } else {
            let holder = null;
            try {
              holder = JSON.parse(made.existing || '{}').task_id || null;
            } catch {
              holder = null;
            }
            if (holder && holder !== id && await this._refHolderLive(holder)) {
              const row = { task_id: id, ref, state: 'skipped', reason: 'duplicate_ref', attempts: 0, created_at: createdAt };
              await this.backend.createExclusive(this._doneFile(id), JSON.stringify(row));
              this.totals.skipped += 1;
              this._cacheSet(id, null);
              this.alert({ event: 'public_attestation_duplicate_ref', task_id: id, held_by: holder });
              return { ok: false, reason: 'duplicate_ref', row };
            }
            // Ours, or a stale claim (holder failed, skipped, or crashed before its row).
            await this.backend.writeAtomic(refFile, claim);
            claimed = true;
          }
        }
        const row = {
          task_id: id,
          ref: ref || null,
          state: 'pending',
          attempts: 0,
          next_at: now,
          last_error: null,
          created_at: createdAt,
        };
        try {
          await this.backend.writeAtomic(this._pendingFile(id), JSON.stringify(row));
        } catch (err) {
          if (claimed) await this.backend.unlink(this._refFile(ref)).catch(() => {});
          throw err;
        }
        // Durable. Only now does memory change.
        this.pending.set(id, row);
        this.cache.delete(id);
        this._schedule(id, now);
        return { ok: true, duplicate: false, row };
      };
      try {
        return ref ? await this._locked(`r:${ref}`, run) : await run();
      } catch (err) {
        this.totals.persist_failed += 1;
        this.alert({ event: 'public_attestation_persist_failed', task_id: id, op: 'enqueue', error: String(err?.code || err?.message || err).slice(0, 80) });
        return { ok: false, reason: 'persist_failed' };
      }
    });
  }

  /**
   * Pending rows due now, oldest first, at most `limit`. They leave the due
   * heap; the caller must settle each one (retry, signed, failed, skipped)
   * or hand it back with `reschedule`.
   */
  due(now = Date.now(), limit = Infinity) {
    const out = [];
    while (out.length < limit) {
      const top = this.heap.peek();
      if (!top || top.at > now) break;
      this.heap.pop();
      this.scheduled.delete(top.id);
      const row = this.pending.get(top.id);
      if (!row || this.held.has(top.id)) continue;
      out.push(row);
    }
    return out;
  }

  /** True when a pending row is due now (the heap top only). */
  hasDue(now = Date.now()) {
    const top = this.heap.peek();
    return Boolean(top && top.at <= now);
  }

  reschedule(taskId, at) {
    const id = String(taskId);
    if (this.pending.has(id)) this._schedule(id, at);
  }

  /** Terminal transition: the terminal row is durable before memory or the ref changes. */
  async _finish(id, build, { releaseRef }) {
    const row = this.pending.get(id);
    if (!row) return { ok: false, reason: 'no_row' };
    const next = build(row);
    const made = await this.backend.createExclusive(this._doneFile(id), JSON.stringify(next));
    const stored = made.created ? next : parseRow(made.existing);
    this.pending.delete(id);
    this.scheduled.delete(id);
    await this.backend.unlink(this._pendingFile(id)).catch(() => {});
    if (releaseRef && stored?.state !== 'signed' && row.ref) {
      // Under the ref lock, so a concurrent enqueue that takes over the claim
      // can never have its new claim removed here.
      await this._locked(`r:${row.ref}`, async () => {
        if ((await this.taskForRef(row.ref)) === id) await this.backend.unlink(this._refFile(row.ref)).catch(() => {});
      });
    }
    this._cacheSet(id, stored?.state === 'signed' && typeof stored.jws === 'string' ? { jws: stored.jws } : null);
    return { ok: true, created: made.created, stored };
  }

  /**
   * Compare-and-set to signed. Identical bytes are a no-op. Different bytes
   * for a signed task are refused, alerted, and the first JWS is kept.
   */
  async markSigned(taskId, { jws, kid, now = Date.now() }) {
    const id = String(taskId);
    return this._locked(`t:${id}`, async () => {
      if (this.held.has(id)) return { ok: false, reason: 'held' };
      if (!this.pending.has(id)) {
        const done = await this._readDone(id);
        if (done?.state === 'signed') {
          if (done.jws === jws) return { ok: true, duplicate: true };
          this.alert({ event: 'public_attestation_conflict', task_id: id });
          return { ok: false, reason: 'conflict' };
        }
        return { ok: false, reason: done?.state || 'no_row' };
      }
      let out;
      try {
        out = await this._finish(id, (row) => ({
          ...row,
          state: 'signed',
          jws,
          kid: kid || null,
          signed_at: new Date(now).toISOString(),
          last_error: null,
        }), { releaseRef: false });
      } catch (err) {
        // Memory stays pending; the JWS is not served. No re-sign until restart.
        this._persistFailed(id, 'markSigned', err);
        return { ok: false, reason: 'persist_failed' };
      }
      if (out.created) {
        this.totals.signed += 1;
        return { ok: true, duplicate: false };
      }
      if (out.stored?.state === 'signed' && out.stored.jws === jws) return { ok: true, duplicate: true };
      this.alert({ event: 'public_attestation_conflict', task_id: id });
      return { ok: false, reason: 'conflict' };
    });
  }

  async markRetry(taskId, { error, nextAt }) {
    const id = String(taskId);
    return this._locked(`t:${id}`, async () => {
      const row = this.pending.get(id);
      if (!row || this.held.has(id)) return { ok: false };
      const next = {
        ...row,
        attempts: Number(row.attempts || 0) + 1,
        last_error: String(error || 'error').slice(0, 80),
        next_at: nextAt,
      };
      try {
        await this.backend.writeAtomic(this._pendingFile(id), JSON.stringify(next));
      } catch (err) {
        this._persistFailed(id, 'markRetry', err);
        return { ok: false, reason: 'persist_failed' };
      }
      this.pending.set(id, next);
      this._schedule(id, nextAt);
      return { ok: true };
    });
  }

  async markFailed(taskId, { error }) {
    const id = String(taskId);
    return this._locked(`t:${id}`, async () => {
      if (!this.pending.has(id) || this.held.has(id)) return { ok: false };
      const reason = String(error || 'error').slice(0, 80);
      try {
        const out = await this._finish(id, (row) => ({
          ...row,
          state: 'failed',
          attempts: Number(row.attempts || 0) + 1,
          last_error: reason,
        }), { releaseRef: true });
        if (out.created) this.totals.failed += 1;
      } catch (err) {
        this._persistFailed(id, 'markFailed', err);
        return { ok: false, reason: 'persist_failed' };
      }
      this.alert({ event: 'public_attestation_failed', task_id: id, reason });
      return { ok: true };
    });
  }

  async markSkipped(taskId, { reason }) {
    const id = String(taskId);
    return this._locked(`t:${id}`, async () => {
      if (!this.pending.has(id) || this.held.has(id)) return { ok: false };
      try {
        const out = await this._finish(id, (row) => ({
          ...row,
          state: 'skipped',
          reason: String(reason || 'ineligible').slice(0, 80),
        }), { releaseRef: true });
        if (out.created) this.totals.skipped += 1;
      } catch (err) {
        this._persistFailed(id, 'markSkipped', err);
        return { ok: false, reason: 'persist_failed' };
      }
      return { ok: true };
    });
  }

  /**
   * The public field, read only. `{ jws }` when signed, `{ status: 'pending' }`
   * while queued, null otherwise (failed, skipped, unknown: the 0.4.5 shell).
   * Only durable state is ever returned.
   */
  async servedAttestation(taskId) {
    const id = String(taskId);
    if (this.pending.has(id)) return { status: 'pending' };
    if (this.cache.has(id)) {
      const hit = this.cache.get(id);
      this._cacheSet(id, hit);
      return hit;
    }
    const done = await this._readDone(id);
    // A change may have landed while the read was in flight. It wins.
    if (this.pending.has(id)) return { status: 'pending' };
    if (this.cache.has(id)) return this.cache.get(id);
    const served = done?.state === 'signed' && typeof done.jws === 'string' ? { jws: done.jws } : null;
    this._cacheSet(id, served);
    return served;
  }

  counts() {
    return {
      pending: this.pending.size,
      held: this.held.size,
      scheduled: this.scheduled.size,
      cache: this.cache.size,
      ...this.totals,
    };
  }
}

let active = null;

export function configurePublicAttestationStore(opts = {}) {
  active = new PublicAttestationStore(opts);
  return active;
}

export function getPublicAttestationStore() {
  return active;
}

export function _resetPublicAttestationStoreForTest() {
  active = null;
}
