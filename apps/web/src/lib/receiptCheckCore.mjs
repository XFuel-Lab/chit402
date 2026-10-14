/** Body for POST /v1/receipts/check. The only field is the pasted receipt. */
export function receiptCheckBody(input) {
  return { input };
}

const INPUT_ERROR_TITLE = "Couldn't read that input.";

function inputErrorView(status, payload) {
  const serverMessage = payload && typeof payload === 'object' && typeof payload.message === 'string'
    ? payload.message
    : '';
  const detail = serverMessage || (status === 413 ? 'Receipt input is too large.' : '');
  const lines = [INPUT_ERROR_TITLE];
  if (detail && detail !== INPUT_ERROR_TITLE) lines.push(detail);
  return { kind: 'input-error', overall: 'INPUT_ERROR', lines, error: null };
}

export function receiptCheckView(status, payload) {
  if (status === 400 || status === 413) return inputErrorView(status, payload);
  if (payload && typeof payload === 'object') {
    const row = payload;
    if (typeof row.overall === 'string' && Array.isArray(row.lines) && row.lines.every((line) => typeof line === 'string')) {
      return { kind: 'verdict', overall: row.overall, lines: row.lines, error: null };
    }
    if (status === 429) {
      return {
        kind: 'verdict',
        overall: 'COULD_NOT_CHECK',
        lines: ['COULD_NOT_CHECK', 'Too many requests — slow down.'],
        error: null,
      };
    }
    if (typeof row.message === 'string' && row.message) {
      return {
        kind: 'verdict',
        overall: 'COULD_NOT_CHECK',
        lines: ['COULD_NOT_CHECK', row.message],
        error: null,
      };
    }
  }
  return {
    kind: 'verdict',
    overall: 'COULD_NOT_CHECK',
    lines: ['COULD_NOT_CHECK', 'The check could not be completed.'],
    error: 'The check could not be completed.',
  };
}
