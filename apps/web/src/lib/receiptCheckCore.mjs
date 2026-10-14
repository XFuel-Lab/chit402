/** Body for POST /v1/receipts/check. The only field is the pasted receipt. */
export function receiptCheckBody(input) {
  return { input };
}

export function receiptCheckView(status, payload) {
  if (payload && typeof payload === 'object') {
    const row = payload;
    if (typeof row.overall === 'string' && Array.isArray(row.lines) && row.lines.every((line) => typeof line === 'string')) {
      return { overall: row.overall, lines: row.lines, error: null };
    }
    if (status === 429) {
      return {
        overall: 'COULD_NOT_CHECK',
        lines: ['COULD_NOT_CHECK', 'Too many requests — slow down.'],
        error: null,
      };
    }
    if (status === 413) {
      return {
        overall: 'INVALID',
        lines: ['INVALID', 'Receipt input is too large.'],
        error: null,
      };
    }
    if (typeof row.message === 'string' && row.message) {
      const overall = status === 400 ? 'INVALID' : 'COULD_NOT_CHECK';
      return { overall, lines: [overall, row.message], error: null };
    }
  }
  return {
    overall: 'COULD_NOT_CHECK',
    lines: ['COULD_NOT_CHECK', 'The check could not be completed.'],
    error: 'The check could not be completed.',
  };
}
