/**
 * Receipt issuance cap. Off unless ISSUER_CAP_RECEIPTS_PER_HOUR or
 * ISSUER_CAP_RECEIPTS_PER_DAY is set. Counts receipt-kind signs only.
 * The sqlite update finishes before any signer await.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** @type {import('better-sqlite3').Database | null} */
let db = null;
let dbKey = '';
const raised = [];

function intEnv(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function capConfig(env = process.env) {
  const hour = intEnv(env.ISSUER_CAP_RECEIPTS_PER_HOUR);
  const day = intEnv(env.ISSUER_CAP_RECEIPTS_PER_DAY);
  let softPct = intEnv(env.ISSUER_CAP_SOFT_PCT);
  if (softPct == null) softPct = 80;
  if (softPct < 1) softPct = 1;
  if (softPct > 100) softPct = 100;
  return {
    hour,
    day,
    softPct,
    enabled: hour != null || day != null,
  };
}

export function capWindows(now = Date.now()) {
  const t = Number(now);
  const ms = Number.isFinite(t) ? t : Date.now();
  return {
    hour: Math.floor(ms / HOUR_MS) * HOUR_MS,
    day: Math.floor(ms / DAY_MS) * DAY_MS,
  };
}

export function resolveIssuanceCapPath(env = process.env) {
  const configured = String(env.ISSUER_CAP_DB || '').trim();
  if (configured) return configured;
  if (testSwitchesOn(env)) return ':memory:';
  return path.join(process.cwd(), '.data', 'issuer-sign-counts.sqlite');
}

function openDb(env = process.env) {
  const key = resolveIssuanceCapPath(env);
  if (db && dbKey === key) return db;
  if (db) {
    try { db.close(); } catch { /* replaced */ }
    db = null;
  }
  if (key !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(key)), { recursive: true });
  }
  const next = new Database(key);
  next.pragma('journal_mode = WAL');
  next.pragma('busy_timeout = 3000');
  next.exec(`
    CREATE TABLE IF NOT EXISTS issuer_sign_counts (
      window_start INTEGER NOT NULL,
      span TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (window_start, span)
    )
  `);
  db = next;
  dbKey = key;
  return db;
}

function readCount(database, windowStart, span) {
  const row = database.prepare(
    'SELECT count FROM issuer_sign_counts WHERE window_start = ? AND span = ?',
  ).get(windowStart, span);
  return row ? Number(row.count) : 0;
}

function bump(database, windowStart, span) {
  const row = database.prepare(`
    INSERT INTO issuer_sign_counts (window_start, span, count)
    VALUES (?, ?, 1)
    ON CONFLICT(window_start, span) DO UPDATE SET count = count + 1
    RETURNING count
  `).get(windowStart, span);
  return Number(row.count);
}

function atOrAbove(used, limit, pct) {
  if (limit == null) return false;
  return used * 100 >= limit * pct;
}

export function readCapUsage({ now = Date.now(), env = process.env } = {}) {
  const cfg = capConfig(env);
  if (!cfg.enabled) return { hour_used: 0, day_used: 0 };
  const database = openDb(env);
  const windows = capWindows(now);
  return {
    hour_used: readCount(database, windows.hour, 'hour'),
    day_used: readCount(database, windows.day, 'day'),
  };
}

export function capState(usage, cfg) {
  if (!cfg.enabled) return 'off';
  const hard = atOrAbove(usage.hour_used, cfg.hour, 100) || atOrAbove(usage.day_used, cfg.day, 100);
  if (hard) return 'hard';
  const soft = atOrAbove(usage.hour_used, cfg.hour, cfg.softPct)
    || atOrAbove(usage.day_used, cfg.day, cfg.softPct);
  if (soft) return 'soft';
  return 'open';
}

/**
 * Paid-route gate. At or above the soft threshold the caller returns 503
 * and does not issue a challenge or settle.
 */
export function capGate({ now = Date.now(), env = process.env } = {}) {
  const cfg = capConfig(env);
  const usage = readCapUsage({ now, env });
  const state = capState(usage, cfg);
  return {
    paused: state === 'soft' || state === 'hard',
    state,
    hour_used: usage.hour_used,
    day_used: usage.day_used,
  };
}

export function issuanceCapHealth({ now = Date.now(), env = process.env } = {}) {
  const gate = capGate({ now, env });
  return {
    hour_used: gate.hour_used,
    day_used: gate.day_used,
    state: gate.state,
  };
}

function capError() {
  const err = new Error('issuance cap reached');
  err.code = 'issuance_cap';
  return err;
}

/**
 * Reserve one receipt sign. Throws issuance_cap at 100% without incrementing.
 * The transaction does not await the signer.
 */
export function consumeReceiptSlot({ now = Date.now(), env = process.env } = {}) {
  const cfg = capConfig(env);
  if (!cfg.enabled) return { counted: false };
  const database = openDb(env);
  const windows = capWindows(now);
  const tx = database.transaction(() => {
    const hourUsed = readCount(database, windows.hour, 'hour');
    const dayUsed = readCount(database, windows.day, 'day');
    if (atOrAbove(hourUsed, cfg.hour, 100) || atOrAbove(dayUsed, cfg.day, 100)) {
      throw capError();
    }
    return {
      hour_used: bump(database, windows.hour, 'hour'),
      day_used: bump(database, windows.day, 'day'),
    };
  });
  return { counted: true, ...tx() };
}

function receiptIdOnly(receiptId) {
  if (receiptId == null) return null;
  const text = String(receiptId);
  if (!text || text.length > 200) return null;
  return text;
}

async function postCapAlert(receiptId, env = process.env) {
  const url = String(env.ALERT_WEBHOOK_URL || '').trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alert: 'issuance_cap', receipt_id: receiptId }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    logger.error({ alert: 'issuance_cap', receipt_id: receiptId }, 'issuance_cap alert post failed');
  }
}

/**
 * Hard-cap side effect. A late-issue row is the caller's durable path when
 * X402_LATE_ISSUE is on. Otherwise log the receipt id only and raise an alert.
 * @param {string|null} receiptId
 * @param {{ env?: NodeJS.ProcessEnv, park?: () => object|null }} [opts]
 */
export async function noteIssuanceCapLost(receiptId, { env = process.env, park = null } = {}) {
  const id = receiptIdOnly(receiptId);
  const lateOn = env.X402_LATE_ISSUE === '1' || env.X402_LATE_ISSUE === 'true';
  if (lateOn && typeof park === 'function') {
    const parked = park();
    if (parked) return { parked: true, lost: false };
  }
  const row = { alert: 'issuance_cap', receipt_id: id };
  raised.push(row);
  logger.error(row, 'issuance_cap_lost_receipt');
  void await postCapAlert(id, env);
  return { parked: false, lost: true };
}

export function capAlertsForTest() {
  return raised.slice();
}

export function resetIssuanceCapForTests() {
  raised.length = 0;
  if (db) {
    try { db.close(); } catch { /* test reset */ }
  }
  db = null;
  dbKey = '';
}
