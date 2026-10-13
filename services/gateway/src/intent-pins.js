/**
 * Freeze-time pins for chit402.intent.v1.
 *
 * No gateway imports. The verifier package compares these digests from a
 * job that does not install gateway dependencies.
 *
 * Identified only by SHA-256 of RFC 8785 bytes. There is no version field.
 */
import crypto from 'node:crypto';

export const SPEND_COMPARATOR = Object.freeze({
  schema: 'chit402.comparator.v1',
  relation: 'spend_lte_max',
  expiry: 'issued_at_lte_expiry',
  uses: 'use_index_lte_use_count',
  subject: 'payer_and_payee_exact',
  amount: 'canonical_integer_atomic',
});

export const INTENT_PROJECTION_SPEC = Object.freeze({
  schema: 'chit402.projection_spec.v1',
  receipt_fields: Object.freeze([
    'comparator_pin',
    'intent_hash',
    'intent_id',
    'spec_digest',
    'use_index',
  ]),
  history_pin: Object.freeze(['entry_count', 'head_hash']),
  absent: Object.freeze(['cap_row_hash']),
});

function utf16Compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertWellFormedUtf16(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new Error('Cannot canonicalize a lone surrogate');
      }
      i += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new Error('Cannot canonicalize a lone surrogate');
    }
  }
}

function rfc8785String(str) {
  assertWellFormedUtf16(str);
  return JSON.stringify(str);
}

function rfc8785Value(value) {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (type === 'string') return rfc8785String(value);
  if (Array.isArray(value)) return `[${value.map(rfc8785Value).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).sort(utf16Compare);
    const pairs = [];
    for (const key of keys) {
      const child = value[key];
      if (child !== undefined) pairs.push(`${rfc8785String(key)}:${rfc8785Value(child)}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

/** True RFC 8785. Same string escaping as offer-receipt jcsRfc8785. */
export function jcsRfc8785(value) {
  return rfc8785Value(value);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function comparatorPin() {
  return sha256(jcsRfc8785(SPEND_COMPARATOR));
}

export function specDigest() {
  return sha256(jcsRfc8785(INTENT_PROJECTION_SPEC));
}

/**
 * Hash of the signed intent object only. Unsigned wrappers are not included.
 * @param {object} claims
 */
export function intentHash(claims) {
  return sha256(jcsRfc8785(claims));
}
