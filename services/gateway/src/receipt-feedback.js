/**
 * Receipt-check feedback filed as a GitHub issue.
 * The pasted receipt is included only when the caller opts in.
 * A contact address is not published: a public issue cannot keep it private.
 */
import { createRequire } from 'node:module';
import { verifierBuildDigest } from './verifier-digest.js';

const require = createRequire(import.meta.url);
const CHECK_NAMES = ['signature', 'key_window', 'payment_binding', 'log_inclusion', 'anchor', 'shape'];
const CHECK_STATES = new Set(['pass', 'fail', 'could_not_check']);
const EXPECTED = new Set(['verified', 'invalid', 'other']);
const ISSUE_URL = 'https://api.github.com/repos/XFuel-Lab/chit402/issues';
const LABEL_URL = 'https://api.github.com/repos/XFuel-Lab/chit402/labels';

export const FEEDBACK_NOTE_MAX = 1000;
export const FEEDBACK_INTENT_MAX = 200;
export const FEEDBACK_TOKEN_ENV = 'CHECK_FEEDBACK_GITHUB_TOKEN';
export const GATEWAY_COMMIT_ENV = 'GATEWAY_COMMIT';

export function feedbackToken(options = {}, env = process.env) {
  if (Object.prototype.hasOwnProperty.call(options, 'feedbackToken')) {
    return String(options.feedbackToken || '');
  }
  return String(env[FEEDBACK_TOKEN_ENV] || '');
}

export function feedbackEnabled(options = {}, env = process.env) {
  return feedbackToken(options, env).length > 0;
}

function verifierVersion() {
  try {
    const pkg = require('../../../packages/verify/package.json');
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Commit the running process was started from.
 * Deploy must export `GATEWAY_COMMIT=$(git rev-parse HEAD)` into the gateway
 * environment before restart. A missing value is recorded as
 * `GATEWAY_COMMIT unset`.
 */
export function gatewayCommit(env = process.env) {
  const value = String(env[GATEWAY_COMMIT_ENV] || '').trim();
  if (/^[0-9a-f]{7,64}$/i.test(value)) return value.toLowerCase();
  return `${GATEWAY_COMMIT_ENV} unset`;
}

export function stripUrlsAndEmails(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@\u200b?[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .replace(/\bwww\.\S+/gi, '[redacted]');
}

function oneLine(value, max) {
  return neutral(String(value ?? '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max));
}

/** No @mentions, #refs, HTML, images or links render from caller text. */
export function neutral(text) {
  return String(text)
    .replace(/@/g, '@\u200b')
    .replace(/#(?=\d)/g, '#\u200b')
    .replace(/[<>\[\]!`|]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fenced(text) {
  return ['~~~~text', String(text).replace(/~{3,}/g, '~~').replace(/`{3,}/g, "''"), '~~~~'].join('\n');
}

function checksOf(raw) {
  const out = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const name of CHECK_NAMES) {
    const state = source[name];
    out[name] = CHECK_STATES.has(state) ? state : 'unknown';
  }
  return out;
}

const REASON_CHECK = {
  signature_invalid: 'signature',
  'key untrusted': 'signature',
  signature_unchecked: 'signature',
  key_window: 'key_window',
  kid_not_in_history: 'key_window',
  kid_status_regression: 'key_window',
  kid_revoked_before_issuance: 'key_window',
  issued_before_not_before: 'key_window',
  issued_after_not_after: 'key_window',
  issued_at_missing: 'key_window',
  not_before_missing: 'key_window',
  not_after_invalid: 'key_window',
  revoked_at_missing: 'key_window',
  issuer_history_unavailable: 'key_window',
  issuer_history_invalid: 'key_window',
  issuer_history_pin_mismatch: 'key_window',
  issuer_history_pin_missing: 'key_window',
  issuer_history_version_mismatch: 'key_window',
  issuer_history_seq_mismatch: 'key_window',
  issuer_history_not_extension: 'key_window',
  payment_mismatch: 'payment_binding',
  claim_mismatch: 'payment_binding',
  binding_mismatch: 'payment_binding',
  not_in_log: 'log_inclusion',
  log_inclusion: 'log_inclusion',
  log_unreachable: 'log_inclusion',
  signed_receipt_unavailable: 'log_inclusion',
  pending: 'log_inclusion',
  pending_anchor: 'anchor',
  anchor: 'anchor',
  anchor_unreachable: 'anchor',
  id_mismatch: 'shape',
  id_prefix_version_mismatch: 'shape',
  version_mismatch: 'shape',
  payload_version_mismatch: 'shape',
  intent_on_legacy_version: 'shape',
  unsupported_version: 'shape',
};

function stateReason(state) {
  if (state === 'pass') return 'passed';
  if (state === 'fail') return 'failed';
  if (state === 'could_not_check') return 'could not check';
  return 'unknown';
}

/**
 * Non-input summary of one check. The pasted receipt is not a field.
 */
export function checkSummary({ overall, verdict, lines, facts, client, kind, bytes }) {
  const reason = verdict && typeof verdict.reason === 'string' ? verdict.reason.slice(0, 80) : null;
  const message = verdict && typeof verdict.message === 'string' ? verdict.message.slice(0, 300) : null;
  const owner = reason ? REASON_CHECK[reason] || null : null;
  const checks = {};
  for (const name of CHECK_NAMES) {
    const raw = verdict?.checks?.[name];
    const state = CHECK_STATES.has(raw) ? raw : 'unknown';
    const text = name === owner && (message || reason) ? (message || reason) : stateReason(state);
    checks[name] = { state, reason: text };
  }
  const safeLines = Array.isArray(lines)
    ? lines.filter((line) => typeof line === 'string').slice(0, 12).map((line) => line.slice(0, 300))
    : [];
  return {
    result_code: overall ? String(overall).slice(0, 32) : null,
    reason: reason || 'none',
    checks,
    lines: safeLines,
    input_kind: kind ? String(kind).slice(0, 16) : 'other',
    input_bytes: Number.isFinite(Number(bytes)) ? Math.max(0, Math.floor(Number(bytes))) : null,
    receipt_id: facts?.receipt_id || null,
    receipt_version: facts?.receipt_version ?? null,
    issuer: facts?.issuer || null,
    chain: facts?.chain || null,
    client: client === 'web' ? 'web' : 'api',
    verifier_version: verdict?.verifier?.version || verifierVersion(),
    build_digest: verifierBuildDigest() || 'unknown',
  };
}

export const UNVERIFIED_REPORT = 'unverified report';

function unverifiedChecks() {
  const checks = {};
  for (const name of CHECK_NAMES) checks[name] = { state: 'unknown', reason: UNVERIFIED_REPORT };
  return checks;
}

/** Server summary wins. A missing or expired id is an unverified report. */
export function withStoredReport(record, stored) {
  if (!stored) {
    return {
      ...record,
      report_status: UNVERIFIED_REPORT,
      result_code: UNVERIFIED_REPORT,
      reason: UNVERIFIED_REPORT,
      checks: unverifiedChecks(),
      lines: [UNVERIFIED_REPORT],
      input_kind: 'unverified',
      input_bytes: null,
      receipt_id: null,
      receipt_version: null,
      issuer: null,
      chain: null,
      client: 'unverified',
    };
  }
  return {
    ...record,
    report_status: 'server',
    result_code: stored.result_code || 'unknown',
    reason: stored.reason || 'none',
    checks: stored.checks,
    lines: Array.isArray(stored.lines) ? stored.lines : [],
    input_kind: stored.input_kind || 'unknown',
    input_bytes: stored.input_bytes ?? null,
    receipt_id: stored.receipt_id || null,
    receipt_version: stored.receipt_version ?? null,
    issuer: stored.issuer || null,
    chain: stored.chain || null,
    client: stored.client === 'web' ? 'web' : 'api',
    verifier_version: stored.verifier_version || record.verifier_version,
    build_digest: stored.build_digest || record.build_digest,
  };
}

export const REPORT_TTL_MS = 3_600_000;
export const REPORT_MAX = 2_000;

export function createCheckReports({ ttlMs = REPORT_TTL_MS, max = REPORT_MAX } = {}) {
  const map = new Map();
  return {
    get size() { return map.size; },
    put(id, summary, at) {
      if (!id || !summary || typeof summary !== 'object') return;
      const summaryCopy = { ...summary };
      delete summaryCopy.input;
      delete summaryCopy.receipt;
      delete summaryCopy.note;
      if (map.has(id)) map.delete(id);
      map.set(id, { at, summary: summaryCopy });
      for (const [key, row] of map) {
        if (at - row.at > ttlMs) map.delete(key);
      }
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get(id, at) {
      const row = map.get(id);
      if (!row) return null;
      if (at - row.at > ttlMs) {
        map.delete(id);
        return null;
      }
      return row.summary;
    },
    json() {
      return JSON.stringify([...map.values()].map((row) => row.summary));
    },
  };
}

function checkLine(name, entry) {
  if (entry && typeof entry === 'object') {
    const state = entry.state || 'unknown';
    const reason = entry.reason || 'unknown';
    return `- ${name}: ${state} — ${reason}`;
  }
  const state = typeof entry === 'string' && entry ? entry : 'unknown';
  return `- ${name}: ${state} — ${stateReason(state)}`;
}

/**
 * @returns {{ ok: true, record: object } | { ok: false, status: number, error: string, message: string }}
 */
export function prepareFeedback(body, extras = {}) {
  const row = body && typeof body === 'object' ? body : {};
  const expected = oneLine(row.expected, 16).toLowerCase();
  if (!EXPECTED.has(expected)) {
    return { ok: false, status: 400, error: 'expected_required', message: 'Choose verified, invalid, or other.' };
  }
  const intent = oneLine(row.intent, FEEDBACK_INTENT_MAX);
  if (!intent) {
    return { ok: false, status: 400, error: 'intent_required', message: 'Say what you were trying to do.' };
  }
  const note = oneLine(row.note, FEEDBACK_NOTE_MAX);
  if (typeof row.note === 'string' && row.note.length > FEEDBACK_NOTE_MAX) {
    return { ok: false, status: 400, error: 'note_too_long', message: 'The note is limited to 1000 characters.' };
  }
  const attach = row.attach_receipt === true;
  const receipt = attach && typeof row.receipt === 'string' ? row.receipt.slice(0, 65_536) : '';
  const checks = checksOf(row.checks);
  return {
    ok: true,
    record: {
      expected,
      intent: stripUrlsAndEmails(intent),
      note: stripUrlsAndEmails(note),
      attach,
      receipt,
      result_code: oneLine(row.result_code, 32) || 'unknown',
      reason: oneLine(row.reason, 64) || 'none',
      checks,
      input_kind: oneLine(row.input_kind, 16) || 'unknown',
      input_bytes: Number.isFinite(Number(row.input_bytes)) ? Math.max(0, Math.floor(Number(row.input_bytes))) : null,
      receipt_id: oneLine(row.receipt_id, 80) || null,
      receipt_version: oneLine(row.receipt_version, 16) || null,
      issuer: oneLine(row.issuer, 80) || null,
      chain: oneLine(row.chain, 32) || null,
      page: oneLine(row.page, 80) || '/check',
      request_id: oneLine(row.request_id, 48) || null,
      client: row.client === 'web' ? 'web' : 'api',
      verifier_version: extras.verifierVersion || verifierVersion(),
      build_digest: extras.buildDigest || verifierBuildDigest() || 'unknown',
      gateway_commit: extras.gatewayCommit || gatewayCommit(),
      timestamp: extras.timestamp || new Date().toISOString(),
    },
  };
}

export function buildFeedbackIssue(record) {
  const checks = CHECK_NAMES
    .map((name) => checkLine(name, record.checks[name]))
    .join('\n');
  const lineBlock = Array.isArray(record.lines) && record.lines.length
    ? record.lines.join('\n')
    : 'none';
  const pasted = record.attach && record.receipt
    ? fenced(record.receipt)
    : 'omitted';
  const reportHead = record.report_status === UNVERIFIED_REPORT
    ? ['## Report', UNVERIFIED_REPORT, '']
    : [];
  const body = [
    ...reportHead,
    '## Result',
    `result_code: ${record.result_code}`,
    `reason: ${record.reason}`,
    '',
    '## Checks',
    checks,
    '',
    '## Lines',
    lineBlock,
    '',
    '## Input',
    `kind: ${record.input_kind}`,
    `bytes: ${record.input_bytes == null ? 'unknown' : record.input_bytes}`,
    `receipt_id: ${record.receipt_id || 'none'}`,
    `receipt_version: ${record.receipt_version || 'none'}`,
    `issuer: ${record.issuer || 'none'}`,
    `chain: ${record.chain || 'none'}`,
    '',
    '## Expected',
    record.expected,
    '',
    '## Trying to do',
    record.intent,
    '',
    '## Note',
    record.note || 'none',
    '',
    '## Client',
    `client: ${record.client}`,
    `page: ${record.page}`,
    `request_id: ${record.request_id || 'none'}`,
    '',
    '## Verifier',
    'package: chit402-verify',
    `version: ${record.verifier_version}`,
    `build_digest: ${record.build_digest}`,
    '',
    '## Gateway',
    `commit: ${record.gateway_commit}`,
    `timestamp: ${record.timestamp}`,
    '',
    '## Pasted receipt',
    pasted,
    '',
  ].join('\n');
  return {
    title: `Receipt check feedback (${record.report_status === UNVERIFIED_REPORT ? UNVERIFIED_REPORT : record.result_code})`,
    body,
    labels: ['check-feedback'],
  };
}

function githubHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'chit402-receipt-check',
    'x-github-api-version': '2022-11-28',
  };
}

export async function fileFeedbackIssue(issue, token, fetchImpl = globalThis.fetch) {
  const headers = githubHeaders(token);
  const send = () => fetchImpl(ISSUE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(issue),
  });
  let res = await send();
  if (res.status === 422) {
    await fetchImpl(LABEL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'check-feedback',
        color: '1f6feb',
        description: 'Receipt check feedback',
      }),
    });
    res = await send();
  }
  if (!res.ok) {
    const error = new Error(`github ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res;
}
