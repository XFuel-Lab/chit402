/** Body for POST /v1/receipts/check. client marks the site as web. */
export function receiptCheckBody(input) {
  return { input, client: 'web' };
}

const INPUT_ERROR_TITLE = "Couldn't read that input.";
const INPUT_HINT = 'Paste receipt JSON, a chit- id, or a verify link.';
const EXAMPLE = 'xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944';
const ACCEPTED = ['receipt JSON', 'a chit- id', 'a verify link'];

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function reportOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const checks = raw.checks && typeof raw.checks === 'object' ? { ...raw.checks } : null;
  return {
    result_code: stringOrNull(raw.result_code),
    reason: stringOrNull(raw.reason),
    checks,
    input_kind: stringOrNull(raw.input_kind),
    input_bytes: Number.isFinite(Number(raw.input_bytes)) ? Math.max(0, Math.floor(Number(raw.input_bytes))) : null,
    receipt_id: stringOrNull(raw.receipt_id),
    receipt_version: raw.receipt_version ?? null,
    issuer: stringOrNull(raw.issuer),
    chain: stringOrNull(raw.chain),
    client: raw.client === 'web' ? 'web' : 'api',
  };
}

function extras(payload) {
  const row = payload && typeof payload === 'object' ? payload : {};
  return {
    feedbackEnabled: row.feedback_enabled === true,
    requestId: stringOrNull(row.request_id),
    report: reportOf(row.report),
  };
}

function fallbackHint(overall, status) {
  if (status === 413) return 'Paste a shorter receipt, or a chit- id, or a verify link.';
  if (status === 429) return 'Wait, then try the check again.';
  if (overall === 'NOT_IN_LOG') return 'This receipt is not in the public log. The book row is unchanged.';
  if (overall === 'INVALID') return 'Paste the signed receipt from the owner view and check it again.';
  if (overall === 'INPUT_ERROR') return INPUT_HINT;
  if (overall === 'VERIFIED') return null;
  return 'Try this check again.';
}

function hintOf(payload, overall, status) {
  if (overall === 'VERIFIED') return null;
  const row = payload && typeof payload === 'object' ? payload : {};
  return stringOrNull(row.hint) || fallbackHint(overall, status);
}

function withoutHint(lines, hint) {
  if (!hint) return lines;
  return lines.filter((line) => line !== hint);
}

function acceptedOf(payload) {
  const row = payload && typeof payload === 'object' ? payload : {};
  if (Array.isArray(row.accepted)) {
    const items = row.accepted.filter((item) => typeof item === 'string' && item.trim());
    if (items.length) return items;
  }
  return ACCEPTED.slice();
}

function exampleOf(payload) {
  const row = payload && typeof payload === 'object' ? payload : {};
  return stringOrNull(row.example) || EXAMPLE;
}

function inputErrorView(status, payload) {
  const serverMessage = payload && typeof payload === 'object' && typeof payload.message === 'string'
    ? payload.message
    : '';
  const detail = serverMessage || (status === 413 ? 'Receipt input is too large.' : '');
  const lines = [INPUT_ERROR_TITLE];
  if (detail && detail !== INPUT_ERROR_TITLE) lines.push(detail);
  return {
    kind: 'input-error',
    overall: 'INPUT_ERROR',
    lines,
    error: null,
    hint: hintOf(payload, 'INPUT_ERROR', status),
    accepted: acceptedOf(payload),
    example: exampleOf(payload),
    ...extras(payload),
  };
}

export function receiptCheckView(status, payload) {
  if (status === 400 || status === 413) return inputErrorView(status, payload);
  if (payload && typeof payload === 'object') {
    const row = payload;
    if (typeof row.overall === 'string' && Array.isArray(row.lines) && row.lines.every((line) => typeof line === 'string')) {
      const hint = hintOf(row, row.overall, status);
      return {
        kind: 'verdict',
        overall: row.overall,
        lines: withoutHint(row.lines, hint),
        error: null,
        hint,
        accepted: null,
        example: null,
        ...extras(row),
      };
    }
    if (status === 429) {
      const hint = hintOf(row, 'COULD_NOT_CHECK', 429);
      return {
        kind: 'verdict',
        overall: 'COULD_NOT_CHECK',
        lines: withoutHint(['COULD_NOT_CHECK', 'Too many requests — slow down.'], hint),
        error: null,
        hint,
        accepted: null,
        example: null,
        ...extras(row),
      };
    }
    if (typeof row.message === 'string' && row.message) {
      const hint = hintOf(row, 'COULD_NOT_CHECK', status);
      return {
        kind: 'verdict',
        overall: 'COULD_NOT_CHECK',
        lines: withoutHint(['COULD_NOT_CHECK', row.message], hint),
        error: null,
        hint,
        accepted: null,
        example: null,
        ...extras(row),
      };
    }
  }
  const hint = fallbackHint('COULD_NOT_CHECK', status);
  return {
    kind: 'verdict',
    overall: 'COULD_NOT_CHECK',
    lines: ['COULD_NOT_CHECK', 'The check could not be completed.'],
    error: 'The check could not be completed.',
    hint,
    accepted: null,
    example: null,
    feedbackEnabled: false,
    requestId: null,
    report: null,
  };
}

/** Feedback body. The receipt is included only when attach is true. Contact is not a field. */
export function receiptFeedbackBody(fields) {
  const view = fields && fields.view ? fields.view : {};
  const report = view.report || {};
  const body = {
    expected: fields.expected,
    intent: fields.intent,
    note: fields.note || '',
    attach_receipt: fields.attach === true,
    result_code: view.overall || report.result_code || null,
    reason: report.reason || null,
    checks: report.checks || null,
    input_kind: report.input_kind || null,
    input_bytes: report.input_bytes ?? null,
    receipt_id: report.receipt_id || null,
    receipt_version: report.receipt_version ?? null,
    issuer: report.issuer || null,
    chain: report.chain || null,
    page: '/check',
    request_id: view.requestId || null,
    client: 'web',
  };
  if (fields.attach === true) body.receipt = typeof fields.receipt === 'string' ? fields.receipt : '';
  return body;
}
