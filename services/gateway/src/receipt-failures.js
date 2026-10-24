/**
 * Receipt-path failures for product review.
 * Rows are time, network, stage, reason, tx, outcome, request id.
 * Pre-settle refusals are day/network/reason counts, not rows.
 * Memory keeps 5,000 rows. The JSONL file rotates at 5 MB.
 * No payer, no payload, no header.
 *
 * Escrow-path refusals (fixed heads, quarantine list signing, payer binding)
 * use the same rows: stage `sign`, reason `<path>:<code>`, no tx, no request
 * id. The code is from a fixed list per path, else `other`, so a row can never
 * carry a payer, a salt, a key or free text. Per-reason counts are kept for
 * /health. Two payer binding skips mean the receipt is not a Base USDC paid
 * receipt at all (`no_payer`, `no_payment`): they are counted, not raised.
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
const REFUSAL_DAY_CAP = 30;

export const ESCROW_REFUSAL_PATHS = Object.freeze(['fixed_head', 'quarantine_sign', 'payer_binding']);
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
  payer_binding: new Set([
    ...LOG_READY_REASONS,
    'no_claims', 'no_payer', 'no_payment', 'asset', 'no_payment_ref', 'network', 'amount',
    'field_range', 'signer_unavailable', 'salt_source', 'signer_error', 'leaf_conflict',
    'leaf_mismatch', 'holder_claims_missing', 'task_id_mismatch', 'store_write', 'store_error',
    'no_store', 'no_log', 'not_in_log', 'no_epoch', 'internal',
  ]),
};
/** Payer binding skips for receipts that are not Base USDC paid receipts: counted, no row. */
const ESCROW_NOT_APPLICABLE = new Set(['payer_binding:no_payer', 'payer_binding:no_payment']);
const ESCROW_ROW_REASON = /^(fixed_head|quarantine_sign|payer_binding):([a-z_]+)$/;

const rows = [];
const refusalCounts = new Map();
const escrowCounts = new Map();
let total = 0;
let loaded = false;

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
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = shape(JSON.parse(line));
      if (row) {
        parsed.push(row);
        countEscrowRow(row);
      }
    } catch { /* skip a torn line */ }
  }
  total += parsed.length;
  rows.push(...parsed.slice(-RECEIPT_FAILURE_ROW_CAP));
}

function rotateFile(file) {
  const backup = `${file}.1`;
  try { rmSync(backup, { force: true }); } catch { /* nothing to replace */ }
  try { renameSync(file, backup); } catch { /* the live file may already be gone */ }
}

function appendLimited(file, row) {
  const line = `${JSON.stringify(row)}\n`;
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
  return {
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
    rows.push(row);
    total += 1;
    if (rows.length > RECEIPT_FAILURE_ROW_CAP) {
      rows.splice(0, rows.length - RECEIPT_FAILURE_ROW_CAP);
    }
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

function bumpEscrow(key) {
  escrowCounts.set(key, (escrowCounts.get(key) || 0) + 1);
}

function countEscrowRow(row) {
  if (row.stage !== 'sign') return;
  const m = ESCROW_ROW_REASON.exec(row.reason);
  if (!m) return;
  bumpEscrow(`${m[1]}:${escrowReason(m[1], m[2])}`);
}

/**
 * Operator alert for a refusal in the fixed-head, quarantine list signing or
 * payer binding path. Writes one receipt-failure row (so the /health
 * receipt_failures count and GET /v1/ops/receipt-failures show it) and bumps
 * the per-reason count. Never throws.
 * @param {{ path: string, reason: string, outcome?: 'refused'|'pending' }} input
 * @returns {object|null} the row, or null (not-applicable skip, bad path)
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
    const row = shape({
      stage: 'sign',
      reason: key,
      outcome: outcome === 'pending' ? 'pending' : 'refused',
      network: null,
      tx: null,
      time: new Date().toISOString(),
    });
    if (!row) return null;
    rows.push(row);
    total += 1;
    bumpEscrow(key);
    if (rows.length > RECEIPT_FAILURE_ROW_CAP) {
      rows.splice(0, rows.length - RECEIPT_FAILURE_ROW_CAP);
    }
    const file = storeFile();
    if (file) appendLimited(file, row);
    return row;
  } catch {
    return null;
  }
}

/**
 * Per-reason escrow refusal counts for /health: path -> reason -> count.
 * Codes only. Null when there are none, so a clean boot adds no key.
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
  return rows.filter((row) => {
    if (!since) return true;
    const at = Date.parse(row.time);
    return Number.isFinite(at) && Number.isFinite(cut) && at >= cut;
  }).map((row) => ({ ...row }));
}

export function receiptFailureCount() {
  loadFile();
  return total;
}

export function resetReceiptFailuresForTests() {
  rows.length = 0;
  refusalCounts.clear();
  escrowCounts.clear();
  total = 0;
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
