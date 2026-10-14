/**
 * A route that opts in keeps one response for a challenge, in memory only.
 * The durable store records the task id and a hash. It does not record the
 * response or the model output. After a restart, or after the copy expires,
 * a replay has nothing to serve and fails closed.
 */
import crypto from 'node:crypto';
import { getActiveChallengeStore } from './x402-durable-store.js';
import { challengeStore as defaultStore } from './x402-adapter.js';

/** Same order of magnitude as the challenge TTL. Clients resend inside this window. */
export const REPLAY_BYTES_TTL_MS = 120_000;
/** Larger responses are not kept. The replay then fails closed. */
export const REPLAY_BYTES_MAX = 256 * 1024;
/** How long a duplicate waits for the winner to finish writing the response. */
export const REPLAY_WAITER_MS = 60_000;

export const REPLAY_WAIT_TIMEOUT = Object.freeze({ timeout: true });

const defaults = {
  ttlMs: REPLAY_BYTES_TTL_MS,
  maxBytes: REPLAY_BYTES_MAX,
  waiterMs: REPLAY_WAITER_MS,
};

const memory = new Map();
const waiters = new Map();
let limits = { ...defaults };
let fulfillmentRuns = 0;

function keyOf(nonce) {
  return String(nonce);
}

export function setReplayLimitsForTests(next = null) {
  limits = next ? { ...defaults, ...next } : { ...defaults };
}

export function replayWaiterMs() {
  return limits.waiterMs;
}

export function notePaidFulfillment() {
  fulfillmentRuns += 1;
}

export function paidFulfillmentRuns() {
  return fulfillmentRuns;
}

export function resetPaidFulfillmentRuns() {
  fulfillmentRuns = 0;
}

export function activeReplayStore() {
  return getActiveChallengeStore() || defaultStore;
}

function liveMemory(key) {
  const row = memory.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return row;
}

/** True when this process can still serve the original bytes, or the winner is writing them. */
export function replayBytesReady(nonce) {
  if (!nonce) return false;
  const key = keyOf(nonce);
  if (liveMemory(key)) return true;
  const waiter = waiters.get(key);
  return !!(waiter && !waiter.done);
}

/** Registered when an opted-in challenge is claimed, before any settle await. */
export function armServedReceipt(nonce) {
  if (!nonce) return;
  const key = keyOf(nonce);
  if (waiters.has(key) || memory.has(key)) return;
  let resolve = () => {};
  const promise = new Promise((done) => { resolve = done; });
  waiters.set(key, { promise, resolve, done: false });
}

function responseHash(bytes) {
  return crypto.createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function persistMeta(nonce, meta, store) {
  try {
    store?.patch?.(nonce, { servedReceipt: meta });
  } catch { /* the hash is an audit mark; serving never reads it back */ }
}

/**
 * Remember the response in this process. Persist only task_id and responseHash.
 * @returns {object|null} the in-memory copy, or null when the body was not kept
 */
export function commitServedReceipt(nonce, payload, store = activeReplayStore()) {
  if (!nonce || payload?.bytes == null) return null;
  const key = keyOf(nonce);
  const bytes = String(payload.bytes);
  const meta = {
    taskId: payload.taskId || null,
    responseHash: responseHash(bytes),
  };
  persistMeta(nonce, meta, store);
  const kept = Buffer.byteLength(bytes, 'utf8') <= limits.maxBytes;
  const stored = kept
    ? {
      bytes,
      signature: payload.signature || null,
      taskId: meta.taskId,
      responseHash: meta.responseHash,
      status: payload.status || 200,
      headers: payload.headers || {},
      expiresAt: Date.now() + limits.ttlMs,
    }
    : null;
  if (stored) memory.set(key, stored);
  else memory.delete(key);
  const waiter = waiters.get(key);
  if (waiter && !waiter.done) {
    waiter.done = true;
    waiter.resolve(stored);
  }
  return stored;
}

export function abortServedReceipt(nonce) {
  if (!nonce) return;
  const waiter = waiters.get(keyOf(nonce));
  if (waiter && !waiter.done) {
    waiter.done = true;
    waiter.resolve(null);
  }
}

/** Drop the in-memory copies. The durable hash stays. A later replay fails closed. */
export function clearReplayMemory() {
  memory.clear();
  for (const waiter of waiters.values()) {
    if (!waiter.done) {
      waiter.done = true;
      waiter.resolve(null);
    }
  }
  waiters.clear();
}

/**
 * The in-memory response, or the in-process waiter if the winner is still writing.
 * Never reads response bytes from the store.
 * @returns {Promise<object|null|{timedOut:true}>}
 */
export async function takeServedReceipt(nonce, store = activeReplayStore()) {
  if (!nonce) return null;
  void store;
  const key = keyOf(nonce);
  const cached = liveMemory(key);
  if (cached) return cached;
  const waiter = waiters.get(key);
  if (!waiter) return null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(REPLAY_WAIT_TIMEOUT), limits.waiterMs);
  });
  try {
    const stored = await Promise.race([waiter.promise, timeout]);
    if (stored === REPLAY_WAIT_TIMEOUT) return { timedOut: true };
    if (stored?.bytes && liveMemory(key)) return stored;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
