/**
 * Explicit act on a book row.
 * open, spend, transfer, refund, correction, refusal.
 * The signed book_chain carries it. The payment JWS does not change.
 */

export const BOOK_ACTS = Object.freeze([
  'open',
  'spend',
  'transfer',
  'refund',
  'correction',
  'refusal',
]);

/**
 * @param {object} entry
 * @returns {'open'|'spend'|'transfer'|'refund'|'correction'|'refusal'}
 */
export function actOf(entry) {
  const explicit = entry?.act;
  if (BOOK_ACTS.includes(explicit)) return explicit;
  const event = String(entry?.event || entry?.evidence || '');
  if (event === 'policy_blocked') return 'refusal';
  if (event === 'inflow_correction') return 'correction';
  if (event === 'refund_owed' || entry?.refund_status === 'owed') return 'refund';
  if (event === 'a2a_escrow' || event === 'inflow_claimed' || entry?.inflow_claim) return 'transfer';
  if (event.startsWith('board_')) return 'open';
  return 'spend';
}
