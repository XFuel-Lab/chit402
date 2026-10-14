/**
 * The first confirmed settlement of a challenge owns one response.
 * A same-challenge replay serves those bytes. It does not run the handler
 * again and it does not sign a second receipt.
 */
import { getActiveChallengeStore } from './x402-durable-store.js';
import { challengeStore as defaultStore } from './x402-adapter.js';

const memory = new Map();
const waiters = new Map();
let fulfillmentRuns = 0;

function keyOf(nonce) {
  return String(nonce);
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

/** Registered when a challenge is claimed, before any settle await. */
export function armServedReceipt(nonce) {
  if (!nonce) return;
  const key = keyOf(nonce);
  if (waiters.has(key) || memory.has(key)) return;
  let resolve = () => {};
  const promise = new Promise((done) => { resolve = done; });
  waiters.set(key, { promise, resolve, done: false });
}

export function commitServedReceipt(nonce, payload, store = activeReplayStore()) {
  if (!nonce || !payload?.bytes) return null;
  const key = keyOf(nonce);
  const stored = {
    bytes: String(payload.bytes),
    signature: payload.signature || null,
    taskId: payload.taskId || null,
    status: payload.status || 200,
    headers: payload.headers || {},
  };
  memory.set(key, stored);
  try {
    store?.patch?.(nonce, { servedReceipt: stored });
  } catch { /* the in-process copy still serves this process */ }
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

function fromStore(nonce, store) {
  const rec = store?.replayRecord?.(nonce);
  const stored = rec?.servedReceipt;
  if (!stored?.bytes) return null;
  memory.set(keyOf(nonce), stored);
  return stored;
}

/** The stored response, or the in-process waiter if the winner is still fulfilling. */
export async function takeServedReceipt(nonce, store = activeReplayStore()) {
  if (!nonce) return null;
  const key = keyOf(nonce);
  if (memory.has(key)) return memory.get(key);
  const persisted = fromStore(nonce, store);
  if (persisted) return persisted;
  const waiter = waiters.get(key);
  if (waiter) {
    const stored = await waiter.promise;
    if (stored?.bytes) return stored;
  }
  return fromStore(nonce, store);
}
