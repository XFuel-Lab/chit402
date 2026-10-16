/**
 * Cross-process challenge store. One file, exclusive lock, compare-and-set.
 * Records outlive the authorization window. A crashed claim becomes `unknown`
 * and is never auto-released.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ChallengeStore } from './x402-adapter.js';

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function unavailable(message, cause) {
  const wrapped = new Error(message);
  wrapped.code = 'x402_unavailable';
  if (cause) wrapped.cause = cause;
  return wrapped;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and we cannot signal it.
    return err.code !== 'ESRCH';
  }
}

function readLockPid(lockPath) {
  try {
    const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

/**
 * A live holder keeps the lock. A dead pid is renamed aside before anyone
 * else creates a new lock, so a slow holder is never preempted.
 */
// A holder that never wrote its pid (crash between open and write) is stale
// once the lock is older than this. A live holder writes its pid immediately.
const PIDLESS_LOCK_STALE_MS = 10000;

function lockAgeMs(lockPath) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

function reclaimDeadLock(lockPath) {
  const pid = readLockPid(lockPath);
  // withFileLock is synchronous, so this process never waits on its own lock:
  // our pid in the file is a previous incarnation (systemd or container restart).
  const stale = pid == null
    ? lockAgeMs(lockPath) > PIDLESS_LOCK_STALE_MS
    : (pid === process.pid || !pidAlive(pid));
  if (!stale) return false;
  const grave = `${lockPath}.dead.${process.pid}.${Date.now()}`;
  try {
    fs.renameSync(lockPath, grave);
  } catch {
    return false;
  }
  try {
    const movedText = fs.readFileSync(grave, 'utf8').trim();
    fs.unlinkSync(grave);
    return pid == null ? movedText === '' || !Number.isInteger(Number(movedText)) : Number(movedText) === pid;
  } catch {
    try { fs.unlinkSync(grave); } catch { /* gone */ }
    return false;
  }
}

function withFileLock(lockPath, fn, lockWaitMs = 4000) {
  const start = Date.now();
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      try { fs.fsyncSync(fd); } catch { /* best effort */ }
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      reclaimDeadLock(lockPath);
      if (Date.now() - start > lockWaitMs) {
        throw unavailable('x402 challenge store lock timeout');
      }
      sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* raced */ }
  }
}

function isPairList(value) {
  return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.length === 2);
}

/**
 * A missing file is the only empty store. Empty, truncated, or the wrong
 * shape is corrupt: callers must not treat it as a fresh spent-set.
 */
function validState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  if (!isPairList(raw.map)) return false;
  if (!Array.isArray(raw.spent)) return false;
  if (!isPairList(raw.authSpent)) return false;
  if (!Array.isArray(raw.txSpent)) return false;
  if (!isPairList(raw.txFacts)) return false;
  if (raw.txReserved != null && !isPairList(raw.txReserved)) return false;
  if (raw.authReserved != null && !isPairList(raw.authReserved)) return false;
  if (!Array.isArray(raw.pending)) return false;
  return true;
}

function readState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw unavailable('x402 challenge store unreadable', err);
  }
  if (!String(text).trim()) {
    throw unavailable('x402 challenge store unreadable', new Error('empty challenge store'));
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw unavailable('x402 challenge store unreadable', err);
  }
  if (!validState(parsed)) {
    throw unavailable('x402 challenge store unreadable', new Error('challenge store shape'));
  }
  return parsed;
}

function writeState(file, state) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* directory fsync is best effort */ }
}

const EMPTY_STATE = {
  map: [], spent: [], authSpent: [], txSpent: [], txFacts: [], txReserved: [], authReserved: [], pending: [], late: [], lateLedger: [],
};

export class DurableChallengeStore {
  constructor(file, { ttlMs, lockWaitMs, createIfMissing = true } = {}) {
    if (!file) throw new Error('challenge store path required');
    this.file = file;
    this.lockPath = `${file}.lock`;
    this.durableReserve = true;
    this.ttlMs = ttlMs;
    this.lockWaitMs = Number.isFinite(Number(lockWaitMs)) && Number(lockWaitMs) >= 0
      ? Number(lockWaitMs)
      : 4000;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      // Boot refuses a missing file. A vanished volume must not look like a
      // fresh spent-set. Direct construction may still create one.
      if (!createIfMissing) {
        throw unavailable('x402 challenge store missing; refusing a fresh spent-set', new Error(file));
      }
      writeState(file, EMPTY_STATE);
    }
    // Fail closed if the file cannot be parsed. Do not replace it.
    readState(file);
  }

  _with(fn) {
    return withFileLock(this.lockPath, () => {
      const inner = new ChallengeStore({ ttlMs: this.ttlMs });
      const raw = readState(this.file);
      // ENOENT after open is a lost store, not a fresh one. Do not write.
      if (!raw) throw unavailable('x402 challenge store unreadable', new Error('missing challenge store'));
      inner.loadState(raw);
      const result = fn(inner);
      writeState(this.file, inner.dumpState());
      return result;
    }, this.lockWaitMs);
  }

  put(nonce, data) { return this._with((s) => s.put(nonce, data)); }
  get(nonce) { return this._with((s) => s.get(nonce)); }
  patch(nonce, fields) { return this._with((s) => s.patch(nonce, fields)); }
  isSpent(nonce) { return this._with((s) => s.isSpent(nonce)); }
  replayRecord(nonce) { return this._with((s) => s.replayRecord(nonce)); }
  markSpent(nonce, meta) { return this._with((s) => s.markSpent(nonce, meta)); }
  claim(nonce, owner, leaseMs) { return this._with((s) => s.claim(nonce, owner, leaseMs)); }
  release(nonce, owner) { return this._with((s) => s.release(nonce, owner)); }
  markUnknown(nonce) { return this._with((s) => s.markUnknown(nonce)); }
  isAuthSpent(key) { return this._with((s) => s.isAuthSpent(key)); }
  markAuthSpent(key, ref) { return this._with((s) => s.markAuthSpent(key, ref)); }
  isTxSpent(key) { return this._with((s) => s.isTxSpent(key)); }
  markTxSpent(key, facts) { return this._with((s) => s.markTxSpent(key, facts)); }
  reserveTx(key, authKey, owner, leaseMs) {
    return this._with((s) => s.reserveTx(key, authKey, owner, leaseMs));
  }
  releaseTx(key, authKey, owner) {
    return this._with((s) => s.releaseTx(key, authKey, owner));
  }
  txFactsOf(key) { return this._with((s) => s.txFactsOf(key)); }
  recordPending(row) { return this._with(async (s) => await s.recordPending(row)); }
  listPending() { return this._with((s) => s.listPending()); }
  updatePending(id, fields) { return this._with((s) => s.updatePending(id, fields)); }
  markSubmitted(nonce) { return this._with((s) => s.markSubmitted(nonce)); }
  revertSubmitted(nonce, owner) { return this._with((s) => s.revertSubmitted(nonce, owner)); }
  putLate(row) { return this._with((s) => s.putLate(row)); }
  getLate(id) { return this._with((s) => s.getLate(id)); }
  findLate(query) { return this._with((s) => s.findLate(query)); }
  casLate(id, from, to, patch) { return this._with((s) => s.casLate(id, from, to, patch)); }
  abortLate(id) { return this._with((s) => s.abortLate(id)); }
  listLate() { return this._with((s) => s.listLate()); }
  appendLateLedger(row) { return this._with((s) => s.appendLateLedger(row)); }
  listLateLedger() { return this._with((s) => s.listLateLedger()); }
  pruneLate(now, maxAge) { return this._with((s) => s.pruneLate(now, maxAge)); }
}

let activeStore = null;
let storeFailed = false;

export function setActiveChallengeStore(store) {
  activeStore = store || null;
  storeFailed = false;
}

export function getActiveChallengeStore() {
  return activeStore;
}

export function challengeStoreFailed() {
  return storeFailed;
}

export function markChallengeStoreFailed() {
  storeFailed = true;
  activeStore = null;
}

/**
 * Open the durable store. A load failure refuses x402 rather than running unbound.
 * Boot passes createIfMissing false: a missing file is not a fresh spent-set.
 * @param {string} file
 * @param {{ createIfMissing?: boolean }} [opts]
 */
export function openDurableChallengeStore(file, { createIfMissing = false } = {}) {
  try {
    const store = new DurableChallengeStore(file, { createIfMissing });
    setActiveChallengeStore(store);
    return store;
  } catch (err) {
    markChallengeStoreFailed();
    throw err;
  }
}

/**
 * Durable challenge store plan for boot. Anything other than an exact
 * NODE_ENV of test or development is treated as production.
 */
export function challengeStorePlan({ nodeEnv, configured } = {}) {
  const devOrTest = nodeEnv === 'test' || nodeEnv === 'development';
  return {
    required: !devOrTest,
    storePath: configured || (devOrTest ? null : 'data/x402-challenges.json'),
  };
}

function pm2FileInstances() {
  try {
    const eco = createRequire(import.meta.url)('../ecosystem.config.cjs');
    const n = Number(eco?.apps?.[0]?.instances);
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

export function instanceCount(env = process.env) {
  const raw = env.INSTANCES ?? env.PM2_INSTANCES ?? env.WEB_CONCURRENCY;
  const fromEnv = Number(raw);
  const envCount = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : 1;
  return Math.max(envCount, pm2FileInstances());
}

export function storeReservesDurably(store) {
  return !!(store && store.durableReserve === true && typeof store.reserveTx === 'function');
}

/**
 * More than one process is refused unless the active store reserves a
 * transfer inside one file lock. An in-memory reserveTx does not count.
 */
export function assertReserveTxInstances(store, env = process.env) {
  const count = instanceCount(env);
  const nodeIndex = Number(env.NODE_APP_INSTANCE);
  const multi = count > 1 || (Number.isInteger(nodeIndex) && nodeIndex > 0);
  if (!multi) return;
  if (storeReservesDurably(store)) return;
  const err = new Error('instances>1 refused: challenge store has no atomic reserveTx');
  err.code = 'instances_refused';
  throw err;
}
