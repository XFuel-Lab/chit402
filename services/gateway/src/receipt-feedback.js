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

export function gatewayCommit(env = process.env) {
  const value = String(env[GATEWAY_COMMIT_ENV] || '').trim();
  if (/^[0-9a-f]{7,64}$/i.test(value)) return value.toLowerCase();
  return `${GATEWAY_COMMIT_ENV} unset`;
}

export function stripUrlsAndEmails(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted]')
    .replace(/\bwww\.\S+/gi, '[redacted]');
}

function oneLine(value, max) {
  return String(value ?? '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max);
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
    .map((name) => `- ${name}: ${record.checks[name]}`)
    .join('\n');
  const pasted = record.attach && record.receipt
    ? record.receipt.replace(/```/g, '\'\'\'')
    : 'omitted';
  const body = [
    '## Result',
    `result_code: ${record.result_code}`,
    `reason: ${record.reason}`,
    '',
    '## Checks',
    checks,
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
    title: `Receipt check feedback (${record.result_code})`,
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
