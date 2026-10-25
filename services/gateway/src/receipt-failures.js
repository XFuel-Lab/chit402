/**
 * Receipt-path failures for product review.
 * Rows are time, network, stage, reason, tx, outcome, request id.
 * Pre-settle refusals are day/network/reason counts, not rows.
 * Memory keeps 5,000 rows. The JSONL file rotates at 5 MB.
 * No payer, no payload, no header.
 *
 * Escrow-path refusals (fixed heads, quarantine list signing, the production
 * quarantine list host signer, payer binding) use the same rows: stage `sign`, reason `<path>:<code>`, no tx, no request
 * id. The production host signer does not use this module's store: it
 * appends its one row through receipt-failure-host-append.js (existing
 * regular file only, no read, mkdir or rotation). The code is from a fixed list per path, else `other`, so a row can never
 * carry a payer, a salt, a key or free text. Per-reason counts are served
 * only on GET /v1/ops/receipt-failures (escrow_refusals), never on public
 * /health, where they would be a timing oracle on a known receipt's payment
 * rail. Alert rows are not added to the public receipt_failures total either,
 * so public /health carries no refusal number derived from these paths.
 * Payer binding skips for a receipt that is not a Base mainnet USDC
 * paid receipt (`no_payer`, `no_payment`, `network`, `asset`,
 * `no_payment_ref`) are routine: they are counted, not raised.
 *
 * Repeats are folded: one row per (path, reason, outcome) per 15 minutes.
 * The first refusal writes a row. Identical refusals inside the window only
 * bump the count; the next row after the window carries `repeat`, the number
 * of identical refusals folded since the previous row. So a refusal that
 * repeats every publish tick (fixed-head log_*) writes about 96 rows a day,
 * not 1,440. The per-reason counts still count every refusal.
 *
 * Alert rows have their own cap (RECEIPT_FAILURE_ALERT_ROW_CAP), kept apart
 * from the settle/confirm/sign/log/anchor rows, so a flood of alerts can
 * never push a real settle failure out of the ops export. Alert rows dropped
 * by that cap (live, or on reload) are counted; the ops route serves the
 * count as `alert_rows_dropped`.
 *
 * A fold still open when the gateway stops is written at shutdown
 * (flushEscrowAlertFolds), and again right before exit, after the drain or on
 * the forced exit, so its folded refusals survive a restart. Folds still open
 * at a crash, a SIGKILL, or a second signal during the drain (the handler is
 * process.once, so the second one exits with no flush) are lost.
 *
 * On reload, rows keep their file order across both lists, and an alert row
 * whose code is not on its path's list reads `<path>:other`, as its count.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PAYMENT_ERROR_CODES } from './x402-flags.js';
import { facilitatorNetwork } from './x402-facilitator.js';

const STAGES = new Set(['pre-check', 'settle', 'confirm', 'sign', 'log', 'anchor']);
const OUTCOMES = new Set(['refused', 'pending', 'recovered']);
const FIELDS = ['time', 'network', 'stage', 'reason', 'tx', 'outcome', 'request_id'];
const REFUSAL_REASONS = new Set(PAYMENT_ERROR_CODES);
const REFUSAL_NETWORKS = new Set(['base', 'base-sepolia', 'solana', 'solana-devnet']);

export const RECEIPT_FAILURE_ROW_CAP = 5000;
export const RECEIPT_FAILURE_FILE_BYTES = 5 * 1024 * 1024;
export const RECEIPT_FAILURE_ALERT_ROW_CAP = 1000;
export const ESCROW_ALERT_DEDUP_MS = 15 * 60 * 1000;
const REPEAT_MAX = 1_000_000_000;
const REFUSAL_DAY_CAP = 30;

export const ESCROW_REFUSAL_PATHS = Object.freeze(['fixed_head', 'quarantine_sign', 'quarantine_production_sign', 'payer_binding']);
const LOG_READY_REASONS = [
  'log_not_ready', 'log_not_durable', 'log_boot_disabled', 'fresh_genesis', 'pin_unverified',
  'log_lock_missing', 'log_lock_lost', 'log_lock_unavailable', 'log_locked', 'log_identity',
];
const ESCROW_REASONS = {
  fixed_head: new Set([
    ...LOG_READY_REASONS,
    'field_range', 'not_open_epoch', 'root_mismatch', 'quarantined', 'store_unreadable',
    'conflicting_root', 'signer_unavailable', 'signer_error', 'store_write', 'internal',
  ]),
  quarantine_sign: new Set([
    'production_env', 'kms_signer', 'production_kid', 'history_extra_malformed', 'production_key',
    'not_test_key', 'signer_accessor', 'no_public_key', 'no_kid', 'issuer_sign_invalid',
    'signer_changed', 'signer_mismatch',
  ]),
  // scripts/sign-quarantine-list-production.mjs (quarantine-list-production.js):
  // every refuse() code, plus `error` for a failure that is not a refusal.
  quarantine_production_sign: new Set([
    'usage', 'log_dir_env_unset', 'log_dir_unresolved', 'log_dir_mismatch', 'log_dir_symlink',
    'confirm_missing', 'list_hash_mismatch', 'not_production_process', 'no_production_keys',
    'list_not_canonical', 'list_not_unsigned_v1', 'list_dir_not_directory', 'later_version_exists',
    'v1_exists_different', 'no_signer', 'signer_accessor', 'no_public_key', 'issuer_sign_invalid',
    'not_production_key', 'kid_mismatch', 'signer_mismatch', 'verify_failed', 'list_build_failed',
    'list_not_build_output', 'list_dir_changed', 'write_mismatch', 'error',
  ]),
  payer_binding: new Set([
    ...LOG_READY_REASONS,
    'no_claims', 'no_payer', 'no_payment', 'asset', 'no_payment_ref', 'network', 'amount',
    'field_range', 'signer_unavailable', 'salt_source', 'signer_error', 'leaf_conflict',
    'leaf_mismatch', 'holder_claims_missing', 'task_id_mismatch', 'store_write', 'store_error',
    'no_store', 'no_log', 'not_in_log', 'no_epoch', 'internal',
    // The active signer's kid is not the receipt's kid (after a rotation): the
    // binding is not signed. Raised, not count-only.
    'kid_mismatch',
  ]),
};
/**
 * Payer binding skips for receipts that are not Base mainnet USDC paid
 * receipts: routine, and anyone can cause them (a testnet or non-USDC
 * payment), so they are counted with no row. `amount` and everything after
 * claim parsing still raise.
 */
const ESCROW_NOT_APPLICABLE = new Set([
  'payer_binding:no_payer', 'payer_binding:no_payment', 'payer_binding:network',
  'payer_binding:asset', 'payer_binding:no_payment_ref',
]);
// Codes may carry digits (quarantine_production_sign:list_not_unsigned_v1).
const ESCROW_ROW_REASON = /^(fixed_head|quarantine_sign|quarantine_production_sign|payer_binding):([a-z0-9_]+)$/;

const rows = [];
/** Escrow-path alert rows, capped on their own. */
const alertRows = [];
let seq = 0;
/** `<path>:<reason>|<outcome>` -> { at, folded } for the 15 minute fold. */
const lastAlert = new Map();
const systemClock = () => Date.now();
let alertClock = systemClock;
const refusalCounts = new Map();
const escrowCounts = new Map();
let total = 0;
let loaded = false;
/** Alert rows dropped from memory by RECEIPT_FAILURE_ALERT_ROW_CAP. */
let alertDropped = 0;

/**
 * RECEIPT_FAILURES_FILE is read once per process, on first use (loadFile).
 * Rows another process appends later, such as scripts/sign-quarantine-list.mjs
 * while the gateway runs, reach the gateway's ops route only
 * after a gateway restart. Two processes rotating the same file can also race
 * on the rename. The writer itself always appends.
 */
function storeFile() {
  const configured = process.env.RECEIPT_FAILURES_FILE;
  if (typeof configured !== 'string' || configured.trim() === '') return null;
  return configured.trim();
}

function loadFile() {
  if (loaded) return;
  loaded = true;
  const file = storeFile();
  if (!file) return;
  let size = 0;
  try { size = statSync(file).size; } catch { return; }
  if (size >= RECEIPT_FAILURE_FILE_BYTES) {
    rotateFile(file);
    return;
  }
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  const parsed = [];
  let plainCount = 0;
  let alertCount = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = shape(JSON.parse(line));
      if (row) {
        countEscrowRow(row);
        const alert = isAlertRow(row);
        if (alert) {
          normalizeAlertReason(row);
          alertCount += 1;
        } else {
          plainCount += 1;
        }
        parsed.push({ row, alert });
      }
    } catch { /* skip a torn line */ }
  }
  // Alert rows stay out of the public total (see recordEscrowRefusal).
  total += plainCount;
  // Each list keeps its newest rows under its own cap. Rows are stamped in
  // file order, so the export keeps the original interleaving of plain and
  // alert rows across a reload.
  const plainSkip = Math.max(0, plainCount - RECEIPT_FAILURE_ROW_CAP);
  const alertSkip = Math.max(0, alertCount - RECEIPT_FAILURE_ALERT_ROW_CAP);
  alertDropped += alertSkip;
  let plainSeen = 0;
  let alertSeen = 0;
  for (const { row, alert } of parsed) {
    if (alert) {
      alertSeen += 1;
      if (alertSeen > alertSkip) alertRows.push(stamp(row));
    } else {
      plainSeen += 1;
      if (plainSeen > plainSkip) rows.push(stamp(row));
    }
  }
}

/** A reloaded alert row reads `<path>:<listed code or other>`, as its count. */
function normalizeAlertReason(row) {
  const m = ESCROW_ROW_REASON.exec(row.reason);
  if (m) row.reason = `${m[1]}:${escrowReason(m[1], m[2])}`;
}

/** Insertion order across both row lists; not enumerable, so never exported. */
function stamp(row) {
  Object.defineProperty(row, 'seq', { value: seq += 1, enumerable: false });
  return row;
}

function isAlertRow(row) {
  return row.stage === 'sign' && ESCROW_ROW_REASON.test(row.reason);
}

/** @returns {number} rows dropped from the front of the list */
function pushCapped(list, row, cap) {
  list.push(stamp(row));
  if (list.length <= cap) return 0;
  const drop = list.length - cap;
  list.splice(0, drop);
  return drop;
}

function rotateFile(file) {
  const backup = `${file}.1`;
  try { rmSync(backup, { force: true }); } catch { /* nothing to replace */ }
  try { renameSync(file, backup); } catch { /* the live file may already be gone */ }
}

function appendLimited(file, row) {
  // Leading newline: a torn tail from a short write never glues two rows
  // together. Blank lines are skipped on reload.
  const line = `\n${JSON.stringify(row)}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  let size = 0;
  try { size = statSync(file).size; } catch { size = 0; }
  if (size >= RECEIPT_FAILURE_FILE_BYTES) rotateFile(file);
  appendFileSync(file, line);
}

function shape(input) {
  if (!input || typeof input !== 'object') return null;
  const stage = STAGES.has(input.stage) ? input.stage : null;
  const outcome = OUTCOMES.has(input.outcome) ? input.outcome : null;
  if (!stage || !outcome) return null;
  const tx = sanitizeTx(input.tx);
  const out = {
    time: typeof input.time === 'string' && input.time.length <= 40
      ? input.time
      : new Date().toISOString(),
    network: input.network ? String(input.network).slice(0, 80) : null,
    stage,
    reason: String(input.reason || 'unknown').slice(0, 80),
    tx,
    outcome,
    request_id: input.requestId || input.request_id
      ? String(input.requestId || input.request_id).slice(0, 80)
      : null,
  };
  // Folded identical alerts (escrow rows only); absent on every other row.
  if (Number.isSafeInteger(input.repeat) && input.repeat > 0) out.repeat = Math.min(input.repeat, REPEAT_MAX);
  return out;
}

function sanitizeTx(tx) {
  if (typeof tx !== 'string') return null;
  const text = tx.trim();
  if (!text || text.length > 200) return null;
  if (/payer|payload|authorization|bearer|secret/i.test(text)) return null;
  return text;
}

function refusalReason(reason) {
  const code = String(reason || '');
  return REFUSAL_REASONS.has(code) ? code : 'other';
}

function refusalNetwork(network) {
  const name = facilitatorNetwork(network);
  return REFUSAL_NETWORKS.has(name) ? name : 'other';
}

function dayKey(time) {
  const parsed = Date.parse(time);
  const when = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  return when.toISOString().slice(0, 10);
}

function pruneRefusalDays() {
  const days = [...new Set([...refusalCounts.keys()].map((key) => key.slice(0, 10)))].sort();
  if (days.length <= REFUSAL_DAY_CAP) return;
  const drop = new Set(days.slice(0, days.length - REFUSAL_DAY_CAP));
  for (const key of refusalCounts.keys()) {
    if (drop.has(key.slice(0, 10))) refusalCounts.delete(key);
  }
}

function recordPreSettleRefusal(input) {
  const day = dayKey(input.time || new Date().toISOString());
  const key = `${day}|${refusalNetwork(input.network)}|${refusalReason(input.reason)}`;
  refusalCounts.set(key, (refusalCounts.get(key) || 0) + 1);
  pruneRefusalDays();
  return null;
}

export function recordReceiptFailure(input = {}) {
  try {
    if (input?.preSettle === true || input?.stage === 'pre-check') {
      return recordPreSettleRefusal(input);
    }
    loadFile();
    const row = shape({ ...input, time: input.time || new Date().toISOString() });
    if (!row) return null;
    pushCapped(rows, row, RECEIPT_FAILURE_ROW_CAP);
    total += 1;
    const file = storeFile();
    if (file) appendLimited(file, row);
    return row;
  } catch {
    return null;
  }
}

function escrowReason(pathName, reason) {
  const allowed = ESCROW_REASONS[pathName];
  // A string code only: an object whose toString returns a listed code does not count.
  return allowed && typeof reason === 'string' && allowed.has(reason) ? reason : 'other';
}

function bumpEscrow(key, n = 1) {
  escrowCounts.set(key, (escrowCounts.get(key) || 0) + n);
}

function countEscrowRow(row) {
  if (row.stage !== 'sign') return;
  const m = ESCROW_ROW_REASON.exec(row.reason);
  if (!m) return;
  bumpEscrow(`${m[1]}:${escrowReason(m[1], m[2])}`, 1 + (row.repeat || 0));
}

/**
 * The alert row recordEscrowRefusal writes for (path, reason, outcome) at
 * `time`, with no state change: no count, no fold, no file. Null for an
 * unknown path or a count-only skip. Used by the host-only append
 * (receipt-failure-host-append.js), so a host row reloads exactly as a
 * gateway row.
 * @returns {object|null}
 */
export function escrowAlertRow({ path: pathName, reason, outcome = 'refused', time } = {}) {
  try {
    if (!ESCROW_REASONS[pathName]) return null;
    const key = `${pathName}:${escrowReason(pathName, reason)}`;
    if (ESCROW_NOT_APPLICABLE.has(key)) return null;
    return shape({
      stage: 'sign',
      reason: key,
      outcome: outcome === 'pending' ? 'pending' : 'refused',
      network: null,
      tx: null,
      time: typeof time === 'string' ? time : new Date().toISOString(),
      repeat: 0,
    });
  } catch {
    return null;
  }
}

/**
 * Operator alert for a refusal in the fixed-head, quarantine list signing or
 * payer binding path. Writes one receipt-failure row (shown on
 * GET /v1/ops/receipt-failures, not counted in the public /health
 * receipt_failures total) and bumps the per-reason count. Never throws.
 * @param {{ path: string, reason: string, outcome?: 'refused'|'pending' }} input
 * @returns {object|null} the row, or null (not-applicable skip, folded repeat, bad path)
 */
export function recordEscrowRefusal({ path: pathName, reason, outcome = 'refused' } = {}) {
  try {
    if (!ESCROW_REASONS[pathName]) return null;
    const key = `${pathName}:${escrowReason(pathName, reason)}`;
    if (ESCROW_NOT_APPLICABLE.has(key)) {
      bumpEscrow(key);
      return null;
    }
    loadFile();
    bumpEscrow(key);
    const rowOutcome = outcome === 'pending' ? 'pending' : 'refused';
    const nowMs = Number(alertClock());
    const at = Number.isFinite(nowMs) ? nowMs : Date.now();
    const foldKey = `${key}|${rowOutcome}`;
    const last = lastAlert.get(foldKey);
    // Inside the window: fold. A clock that steps back writes a fresh row.
    if (last && at >= last.at && at - last.at < ESCROW_ALERT_DEDUP_MS) {
      last.folded += 1;
      last.lastAt = at;
      return null;
    }
    lastAlert.set(foldKey, { at, folded: 0 });
    const row = shape({
      stage: 'sign',
      reason: key,
      outcome: rowOutcome,
      network: null,
      tx: null,
      time: new Date(at).toISOString(),
      repeat: last ? last.folded : 0,
    });
    if (!row) return null;
    alertDropped += pushCapped(alertRows, row, RECEIPT_FAILURE_ALERT_ROW_CAP);
    const file = storeFile();
    if (file) appendLimited(file, row);
    return row;
  } catch {
    return null;
  }
}

/**
 * Write every fold that is still open: one row per (path, reason, outcome)
 * with folded refusals since its last row. The row stands for the latest
 * folded refusal (its time) and carries `repeat` for the others, so a reload
 * counts exactly the refusals folded. The fold window restarts at that row.
 * Called on gateway shutdown. Never throws.
 * @returns {number} rows written
 */
export function flushEscrowAlertFolds() {
  let written = 0;
  try {
    for (const [foldKey, last] of [...lastAlert]) {
      if (!last || !(last.folded > 0)) continue;
      const split = foldKey.lastIndexOf('|');
      const at = Number.isFinite(last.lastAt) ? last.lastAt : last.at;
      lastAlert.set(foldKey, { at, folded: 0 });
      const row = shape({
        stage: 'sign',
        reason: foldKey.slice(0, split),
        outcome: foldKey.slice(split + 1),
        network: null,
        tx: null,
        time: new Date(at).toISOString(),
        repeat: last.folded - 1,
      });
      if (!row) continue;
      alertDropped += pushCapped(alertRows, row, RECEIPT_FAILURE_ALERT_ROW_CAP);
      written += 1;
      const file = storeFile();
      if (file) {
        try { appendLimited(file, row); } catch { /* the row stays in memory */ }
      }
    }
  } catch { /* never throws on shutdown */ }
  return written;
}

/** Alert rows dropped from memory by the alert cap since start (ops route only). */
export function alertRowsDropped() {
  loadFile();
  return alertDropped;
}

/**
 * Per-reason escrow refusal counts for the ops route: path -> reason -> count.
 * Codes only, including count-only skips. Null when there are none.
 */
export function escrowRefusalCounts() {
  loadFile();
  if (escrowCounts.size === 0) return null;
  const out = {};
  for (const [key, count] of [...escrowCounts].sort(([a], [b]) => a.localeCompare(b))) {
    const split = key.indexOf(':');
    const pathName = key.slice(0, split);
    const reason = key.slice(split + 1);
    if (!out[pathName]) out[pathName] = {};
    out[pathName][reason] = count;
  }
  return out;
}

export function listRefusalCounts({ since = null } = {}) {
  const sinceDay = since && Number.isFinite(Date.parse(since))
    ? new Date(Date.parse(since)).toISOString().slice(0, 10)
    : null;
  const out = [];
  for (const [key, count] of refusalCounts) {
    const day = key.slice(0, 10);
    const rest = key.slice(11);
    const split = rest.indexOf('|');
    if (split <= 0) continue;
    if (sinceDay && day < sinceDay) continue;
    out.push({
      day,
      network: rest.slice(0, split),
      reason: rest.slice(split + 1),
      count,
    });
  }
  out.sort((a, b) => a.day.localeCompare(b.day)
    || a.network.localeCompare(b.network)
    || a.reason.localeCompare(b.reason));
  return out;
}

export function listReceiptFailures({ since = null } = {}) {
  loadFile();
  const cut = since ? Date.parse(since) : NaN;
  const all = alertRows.length ? [...rows, ...alertRows].sort((a, b) => a.seq - b.seq) : rows;
  return all.filter((row) => {
    if (!since) return true;
    const at = Date.parse(row.time);
    return Number.isFinite(at) && Number.isFinite(cut) && at >= cut;
  }).map((row) => ({ ...row }));
}

export function receiptFailureCount() {
  loadFile();
  return total;
}

/** Test seam for the 15 minute fold. Reset by resetReceiptFailuresForTests. */
export function setEscrowAlertClockForTests(fn) {
  alertClock = typeof fn === 'function' ? fn : systemClock;
}

export function resetReceiptFailuresForTests() {
  rows.length = 0;
  alertRows.length = 0;
  lastAlert.clear();
  alertClock = systemClock;
  refusalCounts.clear();
  escrowCounts.clear();
  total = 0;
  alertDropped = 0;
  loaded = false;
}

export function receiptFailureCsv(list) {
  const lines = [FIELDS.join(',')];
  for (const row of list) {
    lines.push(FIELDS.map((key) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Read at request time. Never copied onto config and never logged. */
export function receiptFailuresToken() {
  const token = process.env.OPS_READ_TOKEN;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

/** Authorization: Bearer only. Other headers and the query string are ignored. */
export function extractReceiptFailuresToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  const value = auth.slice(7).trim();
  return value || null;
}

export function receiptFailuresAuth(provided) {
  const configured = receiptFailuresToken();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: 'disabled',
      message: 'OPS_READ_TOKEN is not configured; endpoint stays off.',
    };
  }
  if (!provided || !tokenMatches(provided, configured)) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Provide Authorization: Bearer.',
    };
  }
  return { ok: true };
}

function tokenMatches(provided, configured) {
  const a = createHash('sha256').update(String(provided), 'utf8').digest();
  const b = createHash('sha256').update(String(configured), 'utf8').digest();
  return timingSafeEqual(a, b);
}
