/**
 * Durable payer binding store, one record per task_id.
 *
 * Private storage only. Each task has at most two files in the store dir:
 *   <task_id>.job.json      the job row: leaf_hash and row_hash captured at
 *                           append time, status, attempts, next_at, reason.
 *   <task_id>.binding.json  the sealed binding, written once with O_EXCL.
 *
 * A sealed binding is never replaced. A second seal for the same task returns
 * the stored record when the leaf_hash matches and refuses `leaf_conflict`
 * when it does not. A job row for a task never changes its leaf_hash.
 */
import fs from 'node:fs';
import path from 'node:path';

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const HEX32 = /^[0-9a-f]{64}$/;
export const JOB_STATUSES = Object.freeze(['pending', 'signed', 'failed', 'skipped']);

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function safeTaskId(taskId) {
  const id = String(taskId ?? '');
  if (!TASK_ID.test(id) || id.includes('..')) throw coded('task id not storable', 'binding_task_id');
  return id;
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw coded('binding store unreadable', 'binding_store_unreadable');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw coded('binding store row unreadable', 'binding_store_unreadable');
  }
}

function fsyncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* best effort on platforms without dir fsync */
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function writeFileSynced(file, text, flag) {
  const fd = fs.openSync(file, flag, 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Store dir: RECEIPT_PAYER_BINDING_DIR, else <agentsDir>/payer-bindings when
 * the task store is persistent, else null (no durable store, no binding).
 */
export function payerBindingStoreDir({ env = process.env, persist = false, agentsDir = null } = {}) {
  const explicit = String(env.RECEIPT_PAYER_BINDING_DIR || '').trim();
  if (explicit) return explicit;
  return persist && agentsDir ? path.join(agentsDir, 'payer-bindings') : null;
}

/**
 * @param {string|null} dir
 */
export function openPayerBindingStore(dir) {
  if (!dir) return null;
  let ready = false;
  function ensureDir() {
    if (ready) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    ready = true;
  }
  const jobFile = (id) => path.join(dir, `${id}.job.json`);
  const bindingFile = (id) => path.join(dir, `${id}.binding.json`);

  function writeJob(id, row) {
    ensureDir();
    const tmp = path.join(dir, `.${id}.job.${process.pid}.${Date.now()}.tmp`);
    writeFileSynced(tmp, `${JSON.stringify(row)}\n`, 'wx');
    fs.renameSync(tmp, jobFile(id));
    fsyncDir(dir);
  }

  return {
    dir,

    /** Sealed binding record or null. */
    getBinding(taskId) {
      return readJson(bindingFile(safeTaskId(taskId)));
    },

    /** Job row or null. */
    getJob(taskId) {
      return readJson(jobFile(safeTaskId(taskId)));
    },

    /**
     * Record the job for a fresh append. The leaf_hash given here is the one
     * actually appended for this task; it can never change afterwards.
     * @returns {{ created: boolean, job: object }}
     */
    createJob(taskId, { leaf_hash, row_hash, status = 'pending', reason = null, now = Date.now() }) {
      const id = safeTaskId(taskId);
      if (status !== 'skipped' && !HEX32.test(String(leaf_hash || ''))) throw coded('leaf hash shape', 'binding_leaf_shape');
      const existing = readJson(jobFile(id));
      if (existing) {
        if (existing.leaf_hash !== (leaf_hash ?? null)) throw coded('task already has a different leaf', 'leaf_conflict');
        return { created: false, job: existing };
      }
      const sealed = readJson(bindingFile(id));
      if (sealed && sealed.leaf_hash !== leaf_hash) throw coded('task already has a different leaf', 'leaf_conflict');
      if (!JOB_STATUSES.includes(status)) throw coded('job status', 'binding_job_status');
      const job = {
        task_id: id,
        leaf_hash: leaf_hash ?? null,
        row_hash: typeof row_hash === 'string' ? row_hash : null,
        status,
        reason,
        attempts: 0,
        next_at: now,
        created_at: now,
      };
      writeJob(id, job);
      return { created: true, job };
    },

    /** Update status fields of an existing job. leaf_hash and row_hash stay. */
    updateJob(taskId, patch) {
      const id = safeTaskId(taskId);
      const existing = readJson(jobFile(id));
      if (!existing) throw coded('no job for task', 'binding_job_missing');
      const next = {
        ...existing,
        status: patch.status ?? existing.status,
        reason: patch.reason !== undefined ? patch.reason : existing.reason,
        attempts: patch.attempts ?? existing.attempts,
        next_at: patch.next_at ?? existing.next_at,
      };
      if (!JOB_STATUSES.includes(next.status)) throw coded('job status', 'binding_job_status');
      writeJob(id, next);
      return next;
    },

    /**
     * Seal a signed binding. Write-once.
     * @returns {{ created: boolean, record: object }}
     */
    seal(taskId, record) {
      const id = safeTaskId(taskId);
      if (!HEX32.test(String(record?.leaf_hash || ''))) throw coded('leaf hash shape', 'binding_leaf_shape');
      ensureDir();
      const existing = readJson(bindingFile(id));
      if (existing) {
        if (existing.leaf_hash !== record.leaf_hash) throw coded('task already has a different leaf', 'leaf_conflict');
        return { created: false, record: existing };
      }
      try {
        writeFileSynced(bindingFile(id), `${JSON.stringify(record)}\n`, 'wx');
      } catch (err) {
        if (err?.code === 'EEXIST') {
          const raced = readJson(bindingFile(id));
          if (raced && raced.leaf_hash === record.leaf_hash) return { created: false, record: raced };
          throw coded('task already has a different leaf', 'leaf_conflict');
        }
        throw err;
      }
      fsyncDir(dir);
      return { created: true, record };
    },

    /** Task ids with a pending job, oldest first. */
    listPending() {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        return [];
      }
      const rows = [];
      for (const name of names) {
        if (!name.endsWith('.job.json') || name.startsWith('.')) continue;
        let row = null;
        try {
          row = readJson(path.join(dir, name));
        } catch {
          row = null;
        }
        if (row?.status === 'pending') rows.push(row);
      }
      rows.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
      return rows;
    },
  };
}
