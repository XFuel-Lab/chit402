/**
 * Append-only receipt-path failures for product review.
 * Rows are time, network, stage, reason, tx, outcome, request id.
 * No payer, no payload, no header.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const STAGES = new Set(['pre-check', 'settle', 'confirm', 'sign', 'log', 'anchor']);
const OUTCOMES = new Set(['refused', 'pending', 'recovered']);
const FIELDS = ['time', 'network', 'stage', 'reason', 'tx', 'outcome', 'request_id'];

const rows = [];

function storeFile() {
  const configured = process.env.RECEIPT_FAILURES_FILE;
  if (typeof configured !== 'string' || configured.trim() === '') return null;
  return configured.trim();
}

function loadFile() {
  const file = storeFile();
  if (!file || rows.length > 0) return;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const row = shape(parsed);
      if (row) rows.push(row);
    } catch { /* skip a torn line */ }
  }
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

export function recordReceiptFailure(input = {}) {
  try {
    loadFile();
    const row = shape({ ...input, time: input.time || new Date().toISOString() });
    if (!row) return null;
    rows.push(row);
    const file = storeFile();
    if (file) {
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(row)}\n`);
    }
    return row;
  } catch {
    return null;
  }
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
  return rows.length;
}

export function resetReceiptFailuresForTests() {
  rows.length = 0;
}

export function receiptFailureCsv(list) {
  const lines = [FIELDS.join(',')];
  for (const row of list) {
    lines.push(FIELDS.map((key) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function receiptFailuresToken() {
  const token = process.env.RECEIPT_FAILURES_TOKEN;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

export function extractReceiptFailuresToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  const header = req.headers?.['x-receipt-failures-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

export function receiptFailuresAuth(provided) {
  const configured = receiptFailuresToken();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: 'disabled',
      message: 'RECEIPT_FAILURES_TOKEN is not configured; endpoint stays off.',
    };
  }
  if (!provided || !safeEqual(provided, configured)) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Provide Authorization: Bearer or X-Receipt-Failures-Token.',
    };
  }
  return { ok: true };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
