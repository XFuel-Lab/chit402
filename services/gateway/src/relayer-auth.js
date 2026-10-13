/**
 * Relayer ECDSA auth. The signed message binds an audience and a nonce.
 * A nonce verifies once inside the timestamp window. A second presentation
 * is refused. A signature for a different audience does not recover here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyMessage } from 'ethers';
import { persistFailed } from './persist-error.js';

const MAX_AGE_SEC = 300;

export function relayerAudience(env = process.env) {
  const raw = env.M2M_RELAYER_AUDIENCE;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).trim();
}

export function relayerSignedMessage({ audience, method, path: reqPath, bodySha, timestamp, nonce }) {
  return `${audience}\n${method}\n${reqPath}\n${bodySha}\n${timestamp}\n${nonce}`;
}

export class RelayerNonceStore {
  /**
   * @param {{ file?: string|null }} [opts]
   */
  constructor({ file = null } = {}) {
    this.file = file || null;
    /** @type {Map<string, number>} nonce → expiry epoch ms */
    this.used = new Map();
    if (this.file) this._load();
  }

  _load() {
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw persistFailed(err, 'relayer nonce store unreadable');
    }
    if (!text.trim()) return;
    const parsed = JSON.parse(text);
    for (const [nonce, exp] of Object.entries(parsed.used || {})) {
      if (typeof nonce === 'string' && Number.isFinite(exp)) this.used.set(nonce, exp);
    }
  }

  _write() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const used = {};
    for (const [nonce, exp] of this.used) used[nonce] = exp;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ used }));
    fs.renameSync(tmp, this.file);
  }

  _gc(now = Date.now()) {
    for (const [nonce, exp] of this.used) {
      if (exp <= now) this.used.delete(nonce);
    }
  }

  /**
   * Mark `nonce` used until `expiresAtMs`. False when it was already used.
   * A file write failure rolls the mark back and throws `persist_failed`.
   * @param {string} nonce
   * @param {number} expiresAtMs
   */
  consume(nonce, expiresAtMs) {
    this._gc();
    if (!nonce || this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAtMs);
    if (!this.file) return true;
    try {
      this._write();
      return true;
    } catch (err) {
      this.used.delete(nonce);
      if (err?.code === 'persist_failed') throw err;
      throw persistFailed(err, 'relayer nonce store write failed');
    }
  }
}

let activeStore = new RelayerNonceStore();

export function relayerNonceStore() {
  return activeStore;
}

export function resetRelayerNonceStore(store = null) {
  activeStore = store || new RelayerNonceStore();
  return activeStore;
}

/**
 * @returns {boolean}
 */
export function verifyRelayerAuth({
  signature,
  timestamp,
  nonce,
  method,
  path: reqPath,
  bodySha,
  addresses,
  audience,
  nowMs = Date.now(),
  store = null,
} = {}) {
  if (!signature || timestamp == null || timestamp === '' || !nonce || !audience) return false;
  if (!addresses || typeof addresses.has !== 'function' || addresses.size === 0) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_AGE_SEC) return false;
  const message = relayerSignedMessage({
    audience,
    method,
    path: reqPath,
    bodySha,
    timestamp,
    nonce,
  });
  let recovered;
  try {
    recovered = verifyMessage(message, signature).toLowerCase();
  } catch {
    return false;
  }
  if (!addresses.has(recovered)) return false;
  const expiresAt = nowMs + Math.max(0, MAX_AGE_SEC - age) * 1000;
  const nonces = store || relayerNonceStore();
  return nonces.consume(String(nonce), expiresAt) === true;
}
