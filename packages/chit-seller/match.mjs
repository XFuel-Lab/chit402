/**
 * The call authorization against the payment this read observed.
 * Sigma is refused unless payer, payee, price and nonce all match (DS-82).
 * An observed settle is the triple (txHash, log index, value), never the
 * transaction hash on its own (DS-92). One transaction can carry several
 * Transfers to the same payee; the log index picks one of them.
 */

import { refuse } from './reasons.mjs';
import { isZeroHex, normalizeHex, parseUint, sameAddress, sameHex } from './hex.mjs';

/**
 * @param {object} authorization payer, payee, price, nonce, token
 * @param {object} observed the transfer and AuthorizationUsed this read bound
 */
export function matchAuthorization(authorization, observed) {
  if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return refuse('bad_type');
  }
  if (observed === null || typeof observed !== 'object') return refuse('bad_payment');
  if (!sameAddress(observed.payer, authorization.payer)) return refuse('payer_mismatch');
  if (!sameAddress(observed.authorizer, authorization.payer)) return refuse('payer_mismatch');
  if (!sameAddress(observed.payee, authorization.payee)) return refuse('payee_mismatch');
  const price = parseUint(authorization.price, 256);
  if (price == null) return refuse('bad_payment');
  if (observed.price !== price) return refuse('price_mismatch');
  const nonce = normalizeHex(authorization.nonce, 32);
  if (!nonce || isZeroHex(nonce) || !sameHex(observed.nonce, nonce)) return refuse('nonce_mismatch');
  if (!sameAddress(observed.token, authorization.token)) return refuse('token_mismatch');
  return { ok: true, price };
}

/**
 * The observed-settle triple is (txHash, log index, value). Value is the
 * price check in matchAuthorization. This binds the hash and the log index
 * to the transfer the read actually returned.
 */
export function matchObservedSettle(requested, observed) {
  if (!requested || !observed) return refuse('tx_mismatch');
  const txHash = normalizeHex(requested.txHash, 32);
  if (!txHash || !sameHex(observed.txHash, txHash)) return refuse('tx_mismatch');
  const wantIndex = parseUint(requested.localLogIndex, 16);
  if (wantIndex == null || observed.localLogIndex !== Number(wantIndex)) return refuse('tx_mismatch');
  return { ok: true };
}

/**
 * DS-92: a settle observed by transaction hash alone is ambiguous.
 * The log index and the value have to be present before any chain read.
 */
export function requireObservedTriple(payment, authorization) {
  if (payment === null || typeof payment !== 'object' || Array.isArray(payment)) return refuse('bad_type');
  if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return refuse('bad_type');
  }
  if (payment.txHash == null || payment.localLogIndex == null || authorization.price == null) {
    return refuse('ambiguous_transfer');
  }
  return { ok: true };
}
