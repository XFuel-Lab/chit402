/**
 * Payer-facing hint for a facilitator /verify refusal.
 * The facilitator string is mapped onto a fixed allowlist. Anything else,
 * including free text, is `unknown`. The raw string is never copied out.
 */

export const VERIFY_HINT_INPUT_MAX = 64;
export const VERIFY_HINT_CODE_MAX = 32;
export const VERIFY_HINT_MESSAGE_MAX = 80;

export const VERIFY_HINT_MESSAGES = Object.freeze({
  insufficient_funds: 'The paying account cannot cover this amount.',
  invalid_fee_payer: 'The fee payer on this payment is not accepted.',
  amount_mismatch: 'The signed amount does not match the quoted amount.',
  expired_authorization: 'The payment authorization has expired.',
  invalid_signature: 'The payment signature did not verify.',
  invalid_network: 'The payment network does not match the quote.',
  unknown: 'The facilitator refused this payment before settlement.',
});

export const VERIFY_HINT_CODES = Object.freeze(Object.keys(VERIFY_HINT_MESSAGES));

/** Exact facilitator identifiers that mean one allowlist code. Null prototype. */
const ALIASES = Object.freeze(Object.assign(Object.create(null), {
  insufficient_funds: 'insufficient_funds',
  insufficientfunds: 'insufficient_funds',
  invalid_fee_payer: 'invalid_fee_payer',
  invalidfeepayer: 'invalid_fee_payer',
  amount_mismatch: 'amount_mismatch',
  amountmismatch: 'amount_mismatch',
  expired_authorization: 'expired_authorization',
  expiredauthorization: 'expired_authorization',
  authorization_expired: 'expired_authorization',
  invalid_signature: 'invalid_signature',
  invalidsignature: 'invalid_signature',
  invalid_exact_evm_payload_signature: 'invalid_signature',
  invalid_exact_svm_payload_signature: 'invalid_signature',
  invalid_network: 'invalid_network',
  invalidnetwork: 'invalid_network',
  unknown: 'unknown',
}));

function hintFor(code, messages = VERIFY_HINT_MESSAGES) {
  const message = messages[code];
  if (typeof message !== 'string' || typeof code !== 'string') {
    return { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown };
  }
  if (code.length > VERIFY_HINT_CODE_MAX || message.length > VERIFY_HINT_MESSAGE_MAX) {
    return { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown };
  }
  return { code, message };
}

/**
 * A facilitator invalidReason short enough to inspect. Longer values, and
 * anything that is not a string, are dropped here so they are never stored
 * on the verify result. No prefix is kept.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function boundedInvalidReason(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > VERIFY_HINT_INPUT_MAX) return null;
  return raw;
}

/**
 * Map a facilitator invalidReason onto the allowlist.
 * Non-strings, over-long values, and any character outside an identifier
 * become `unknown`. The returned message is always the fixed sentence for
 * that code.
 * @param {unknown} raw
 * @returns {{ code: string, message: string }}
 */
export function verifyHint(raw) {
  const bounded = boundedInvalidReason(raw);
  const match = typeof bounded === 'string' ? /^[A-Za-z0-9_]+$/.exec(bounded) : null;
  if (match == null) return hintFor('unknown');
  const key = match[0].toLowerCase();
  const code = Object.hasOwn(ALIASES, key) ? ALIASES[key] : null;
  return hintFor(code || 'unknown');
}

/**
 * The code to store on an ops row. Null when the caller passed nothing.
 * A present value that is not an allowlist identifier is `unknown`.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function verifyHintCode(raw) {
  if (raw == null || raw === '') return null;
  return verifyHint(raw).code;
}

/**
 * Rebuild a hint from its code. A supplied message is ignored, so a caller
 * cannot substitute facilitator text. Null when the code is not on the list.
 * @param {unknown} hint
 * @param {Record<string, string>} [messages] test table. Production callers omit it.
 * @returns {{ code: string, message: string }|null}
 */
export function publicVerifyHint(hint, messages = VERIFY_HINT_MESSAGES) {
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return null;
  const code = hint.code;
  if (typeof code !== 'string' || !Object.hasOwn(messages, code)) return null;
  return hintFor(code, messages);
}
