/**
 * Cross-process challenge store. One file, exclusive lock, compare-and-set.
 * Records outlive the authorization window. A crashed claim becomes `unknown`
 * and is never auto-released.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ChallengeStore } from './x402-adapter.js';

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function withFileLock(lockPath, fn) {
  const start = Date.now();
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > 5000) fs.unlinkSync(lockPath);
      } catch { /* raced */ }
      if (Date.now() - start > 4000) {
        const timeout = new Error('x402 challenge store lock timeout');
        timeout.code = 'x402_unavailable';
        throw timeout;
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

function readState(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    const wrapped = new Error('x402 challenge store unreadable');
    wrapped.code = 'x402_unavailable';
    wrapped.cause = err;
    throw wrapped;
  }
}

function writeState(file, state) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

export class DurableChallengeStore {
  constructor(file, { ttlMs } = {}) {
    if (!file) throw new Error('challenge store path required');
    this.file = file;
    this.lockPath = `${file}.lock`;
    this.ttlMs = ttlMs;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) writeState(file, { map: [], spent: [], authSpent: [], txSpent: [], pending: [] });
    // Fail closed if the file cannot be parsed.
    readState(file);
  }

  _with(fn) {
    return withFileLock(this.lockPath, () => {
      const inner = new ChallengeStore({ ttlMs: this.ttlMs });
      const raw = readState(this.file);
      if (raw) inner.loadState(raw);
      const result = fn(inner);
      writeState(this.file, inner.dumpState());
      return result;
    });
  }

  put(nonce, data) { return this._with((s) => s.put(nonce, data)); }
  get(nonce) { return this._with((s) => s.get(nonce)); }
  patch(nonce, fields) { return this._with((s) => s.patch(nonce, fields)); }
  isSpent(nonce) { return this._with((s) => s.isSpent(nonce)); }
  markSpent(nonce, meta) { return this._with((s) => s.markSpent(nonce, meta)); }
  claim(nonce, owner, leaseMs) { return this._with((s) => s.claim(nonce, owner, leaseMs)); }
  release(nonce, owner) { return this._with((s) => s.release(nonce, owner)); }
  markUnknown(nonce) { return this._with((s) => s.markUnknown(nonce)); }
  isAuthSpent(key) { return this._with((s) => s.isAuthSpent(key)); }
  markAuthSpent(key, ref) { return this._with((s) => s.markAuthSpent(key, ref)); }
  isTxSpent(key) { return this._with((s) => s.isTxSpent(key)); }
  markTxSpent(key) { return this._with((s) => s.markTxSpent(key)); }
  recordPending(row) { return this._with((s) => s.recordPending(row)); }
  listPending() { return this._with((s) => s.listPending()); }
  updatePending(id, fields) { return this._with((s) => s.updatePending(id, fields)); }
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
 * @param {string} file
 */
export function openDurableChallengeStore(file) {
  try {
    const store = new DurableChallengeStore(file);
    setActiveChallengeStore(store);
    return store;
  } catch (err) {
    markChallengeStoreFailed();
    throw err;
  }
}
