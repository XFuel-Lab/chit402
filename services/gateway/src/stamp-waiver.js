/**
 * Pilot waiver for the foreign-ingest stamp.
 *
 * Off unless an operator names keys. Empty STAMP_WAIVER_KEYS (the default)
 * means every submitter pays the $0.002 x402 stamp. A listed key receives
 * free stamps until STAMP_WAIVER_CAP (default 0, so a key listed without a
 * cap still pays). The house smoke key may be listed in that env on the box;
 * it is not hardcoded here.
 *
 * Counts are keyed by sha256(api key), not the key itself.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** @type {Map<string, number>} */
const counts = new Map();
let persistFile = null;

function keyId(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function load() {
  counts.clear();
  if (!persistFile) return;
  try {
    const raw = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
    const stored = raw?.counts && typeof raw.counts === 'object' ? raw.counts : {};
    for (const [id, n] of Object.entries(stored)) {
      const v = Number(n);
      if (typeof id === 'string' && Number.isInteger(v) && v >= 0) counts.set(id, v);
    }
  } catch {
    /* missing or corrupt file — start at zero */
  }
}

function save() {
  if (!persistFile) return;
  try {
    fs.mkdirSync(path.dirname(persistFile), { recursive: true });
    const body = JSON.stringify({ counts: Object.fromEntries(counts) });
    const tmp = `${persistFile}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, persistFile);
  } catch {
    /* cap accounting must not take down ingest */
  }
}

/**
 * @param {{ file?: string|null }} [opts]
 */
export function configureStampWaiverPersistence({ file = null } = {}) {
  persistFile = file ? String(file) : null;
  load();
}

export function resetStampWaiverStore() {
  counts.clear();
  save();
}

export function stampWaiverKeys(env = process.env) {
  return String(env.STAMP_WAIVER_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Free stamps per listed key. Unset or invalid → 0 (waiver grants nothing). */
export function stampWaiverCap(env = process.env) {
  const raw = env.STAMP_WAIVER_CAP;
  if (raw == null || String(raw).trim() === '') return 0;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

/**
 * @param {string|null|undefined} apiKey
 * @param {NodeJS.ProcessEnv} [env]
 */
export function peekStampWaiver(apiKey, env = process.env) {
  const key = apiKey != null ? String(apiKey).trim() : '';
  if (!key || !stampWaiverKeys(env).includes(key)) {
    return { eligible: false, reason: 'waiver_off' };
  }
  const cap = stampWaiverCap(env);
  const used = counts.get(keyId(key)) || 0;
  if (used >= cap) {
    return { eligible: false, reason: 'waiver_cap_exhausted', used, cap };
  }
  return { eligible: true, used, cap, remaining: cap - used };
}

/**
 * Record one free stamp. Call only after the book row is appended.
 * @param {string} apiKey
 */
export function commitStampWaiver(apiKey) {
  const id = keyId(String(apiKey).trim());
  const next = (counts.get(id) || 0) + 1;
  counts.set(id, next);
  save();
  return next;
}

export default {
  configureStampWaiverPersistence,
  resetStampWaiverStore,
  stampWaiverKeys,
  stampWaiverCap,
  peekStampWaiver,
  commitStampWaiver,
};
