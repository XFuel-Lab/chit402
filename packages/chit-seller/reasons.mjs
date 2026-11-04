/**
 * Refusal reasons for the seller signer.
 * A reason is a fixed string. It never contains a key, a signature,
 * or any byte of a payment payload.
 */

export const REASONS = Object.freeze([
  'bad_type',
  'bad_alg',
  'bad_key',
  'bad_hex',
  'bad_uint',
  'bad_length',
  'bad_sigma',
  'bad_signature',
  'bad_payment',
  'missing_block_hash',
  'unknown_block',
  'not_finalized',
  'reorged',
  'chain_unread',
  'chain_mismatch',
  'tx_mismatch',
  'payer_mismatch',
  'payee_mismatch',
  'price_mismatch',
  'nonce_mismatch',
  'token_mismatch',
  'ambiguous_transfer',
  'duplicate_sigma',
  'bad_hour',
  'contract_unpinned',
  'ambiguous_contract',
]);

const REASON_SET = new Set(REASONS);

export function isReason(reason) {
  return REASON_SET.has(reason);
}

/** @returns {{ ok: false, reason: string }} */
export function refuse(reason) {
  if (!REASON_SET.has(reason)) return { ok: false, reason: 'bad_payment' };
  return { ok: false, reason };
}

/**
 * Map a cs2 line-codec refusal onto a seller reason.
 * Unknown codec reasons collapse to bad_payment so a new codec string
 * cannot become an echo channel.
 */
export function fromCodec(result) {
  if (result && result.ok) return result;
  const reason = result && result.reason;
  if (reason === 'nonce_none') return refuse('nonce_mismatch');
  if (reason === 'bad_range' || reason === 'unknown_field') return refuse('bad_payment');
  if (isReason(reason)) return refuse(reason);
  return refuse('bad_payment');
}
