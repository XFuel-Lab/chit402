/**
 * Receipt-path failures for product review.
 * Rows are time, network, stage, reason, tx, outcome, request id.
 * Pre-settle refusals are day/network/reason counts, not rows.
 * Memory keeps 5,000 rows. The JSONL file rotates at 5 MB.
 * No payer, no payload, no header.
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

const rows = [];
const refusalCounts = new Map();
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
      if (row) parsed.push(row);
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
