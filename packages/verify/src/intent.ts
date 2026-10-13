/**
 * Optional v12 intent block and freeze-time pins.
 *
 * The receipt carries hashes, not a comparator version and not a projection
 * spec version. The verifier selects the comparator and the projection spec
 * by SHA-256 of their frozen documents. A label such as "latest" is not read.
 *
 * v12 issuer_history is { head_hash, entry_count }. cap_row_hash is not a
 * v12 field. Not-assessable records and price observations are not receipt
 * fields.
 */
import { createHash } from 'node:crypto';
import { verifyIssuerJws, type Es256Jwk } from './jws.js';

export const V12_PAYLOAD_VERSION = 12;
export const INTENT_SCHEMA = 'chit402.intent.v1';
export const INTENT_VIOLATION = 'intent_violation';
export const INTENT_MISMATCH = 'intent_mismatch';
export const INTENT_MISSING = 'intent_missing';
export const COMPARATOR_UNPINNED = 'comparator_unpinned';
export const SPEC_DIGEST_MISMATCH = 'spec_digest_mismatch';

/**
 * Frozen spend comparator. Identified by the hash of these bytes.
 * The receipt does not name a version of this document.
 */
export const SPEND_COMPARATOR = Object.freeze({
  schema: 'chit402.comparator.v1',
  relation: 'spend_lte_max',
  expiry: 'issued_at_lte_expiry',
  uses: 'use_index_lte_use_count',
  subject: 'payer_and_payee_exact',
  amount: 'canonical_integer_atomic',
});

/**
 * Frozen projection of an intent into a receipt. The digest is what the
 * receipt signs. cap_row_hash is listed under absent so a later cap row
 * cannot reuse this slot.
 */
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

const FROZEN_COMPARATORS = Object.freeze([SPEND_COMPARATOR]);
const FROZEN_SPECS = Object.freeze([INTENT_PROJECTION_SPEC]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;

/** Signed intent members. Anything else is not part of intent_hash. */
export const INTENT_SIGNED_KEYS = Object.freeze([
  'asset',
  'chain',
  'comparator_pin',
  'expiry',
  'external_ref_hash',
  'iat',
  'intent_id',
  'iss',
  'max_amount',
  'payee',
  'payer',
  'schema',
  'spec_digest',
  'use_count',
]);

const INTENT_OPTIONAL = new Set(['external_ref_hash']);

export interface V12HistoryPin {
  head_hash: string;
  entry_count: number;
}

export interface IntentCheck {
  ok: boolean;
  reason: string | null;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function rfc8785String(str: string): string {
  return JSON.stringify(str);
}

/** RFC 8785 for the intent alphabet. Undefined members are omitted. */
export function intentCanonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value as number)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (type === 'string') return rfc8785String(value as string);
  if (Array.isArray(value)) return `[${value.map((item) => intentCanonicalJson(item)).join(',')}]`;
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const pairs: string[] = [];
    for (const key of keys) {
      if (obj[key] !== undefined) pairs.push(`${rfc8785String(key)}:${intentCanonicalJson(obj[key])}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

export function digestOf(value: unknown): string {
  return sha256Utf8(intentCanonicalJson(value));
}

export function comparatorPin(): string {
  return digestOf(SPEND_COMPARATOR);
}

export function specDigest(): string {
  return digestOf(INTENT_PROJECTION_SPEC);
}

function frozenComparator(pin: string): Record<string, unknown> | null {
  for (const doc of FROZEN_COMPARATORS) {
    if (digestOf(doc) === pin) return doc as unknown as Record<string, unknown>;
  }
  return null;
}

function frozenSpec(digest: string): typeof INTENT_PROJECTION_SPEC | null {
  for (const doc of FROZEN_SPECS) {
    if (digestOf(doc) === digest) return doc;
  }
  return null;
}

function sameMembers(actual: string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const want = [...expected].sort();
  const got = [...actual].sort();
  return want.every((key, index) => key === got[index]);
}

export function readV12HistoryPin(claims: unknown): V12HistoryPin | null {
  if (!isPlain(claims)) return null;
  const pin = claims.issuer_history;
  if (!isPlain(pin)) return null;
  if (!sameMembers(Object.keys(pin), INTENT_PROJECTION_SPEC.history_pin)) return null;
  if (typeof pin.head_hash !== 'string' || !HEX64.test(pin.head_hash)) return null;
  if (!isJsonInteger(pin.entry_count) || pin.entry_count < 1) return null;
  return { head_hash: pin.head_hash, entry_count: pin.entry_count };
}

/**
 * True when signed claims are a v12 receipt. A payload_version of 12
 * without this shape stays unsupported_version, which is what verifiers
 * through 0.3.6 return for every 12.
 */
export function isV12ClaimShape(claims: unknown): boolean {
  if (!isPlain(claims)) return false;
  if (Object.prototype.hasOwnProperty.call(claims, 'v')) return false;
  if (Object.prototype.hasOwnProperty.call(claims, 'cap_row_hash')) return false;
  if (!isJsonInteger(claims.payload_version) || claims.payload_version !== V12_PAYLOAD_VERSION) {
    return false;
  }
  if (!readV12HistoryPin(claims)) return false;
  if (!Object.prototype.hasOwnProperty.call(claims, 'intent')) return true;
  return intentBlockShape(claims.intent);
}

function intentBlockShape(value: unknown): boolean {
  if (!isPlain(value)) return false;
  if (!sameMembers(Object.keys(value), INTENT_PROJECTION_SPEC.receipt_fields)) return false;
  if (typeof value.intent_id !== 'string' || !UUID.test(value.intent_id)) return false;
  if (typeof value.intent_hash !== 'string' || !HEX64.test(value.intent_hash)) return false;
  if (typeof value.spec_digest !== 'string' || !HEX64.test(value.spec_digest)) return false;
  if (typeof value.comparator_pin !== 'string' || !HEX64.test(value.comparator_pin)) return false;
  if (!isJsonInteger(value.use_index) || value.use_index < 1) return false;
  return true;
}

export function matchV12HistoryPin(
  pin: V12HistoryPin,
  doc: unknown,
): IntentCheck {
  if (!isPlain(doc) || !Array.isArray(doc.entries)) {
    return { ok: false, reason: 'issuer_history_pin_mismatch' };
  }
  if (doc.entries.length !== pin.entry_count) {
    return { ok: false, reason: 'issuer_history_pin_mismatch' };
  }
  const last = doc.entries[doc.entries.length - 1] as { entry_hash?: unknown } | undefined;
  const head = last && typeof last.entry_hash === 'string' ? last.entry_hash : null;
  if (head !== pin.head_hash) return { ok: false, reason: 'issuer_history_pin_mismatch' };
  if (doc.head_hash != null && doc.head_hash !== pin.head_hash) {
    return { ok: false, reason: 'issuer_history_pin_mismatch' };
  }
  return { ok: true, reason: null };
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function atomic(value: unknown): bigint | null {
  if (typeof value !== 'string' || !ATOMIC.test(value)) return null;
  return BigInt(value);
}

function party(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
  if (value !== value.trim() || /\s/.test(value)) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  return value;
}

function jwkForKid(jwks: { keys?: Es256Jwk[] } | null | undefined, kid: string | null): Es256Jwk | null {
  const keys = jwks?.keys || [];
  if (kid) {
    const match = keys.find((key) => key && key.kid === kid);
    if (match) return match;
  }
  if (keys.length === 1) return keys[0];
  return null;
}

function signedIntentMembers(payload: Record<string, unknown>): Record<string, unknown> | null {
  const signed: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (!INTENT_SIGNED_KEYS.includes(key)) return null;
    if (INTENT_OPTIONAL.has(key) && payload[key] === undefined) continue;
    signed[key] = payload[key];
  }
  for (const key of INTENT_SIGNED_KEYS) {
    if (INTENT_OPTIONAL.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(signed, key)) return null;
  }
  return signed;
}

/**
 * intent_hash is SHA-256 of the JCS bytes that were signed. The hash is
 * not taken over the signature, the outer wrapper, or any unsigned field.
 */
export function intentHashOfPayloadText(payloadText: string): string {
  return sha256Utf8(payloadText);
}

export function checkReceiptIntent(
  claims: Record<string, unknown> | null | undefined,
  intentDoc: unknown,
  jwks?: { keys?: Es256Jwk[] } | null,
): IntentCheck {
  if (!claims || !Object.prototype.hasOwnProperty.call(claims, 'intent')) {
    return { ok: true, reason: null };
  }
  const block = claims.intent;
  if (!intentBlockShape(block)) return { ok: false, reason: INTENT_MISMATCH };
  const intent = block as Record<string, unknown>;
  if (!intentDoc || !isPlain(intentDoc)) return { ok: false, reason: INTENT_MISSING };

  const signature = intentDoc.issuer_signature;
  const jws = isPlain(signature) && typeof signature.jws === 'string' ? signature.jws : null;
  if (!jws) return { ok: false, reason: INTENT_MISMATCH };
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts[1]) return { ok: false, reason: INTENT_MISMATCH };

  let payloadText: string;
  let payload: Record<string, unknown>;
  try {
    payloadText = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadText) as unknown;
    if (!isPlain(parsed)) return { ok: false, reason: INTENT_MISMATCH };
    payload = parsed;
  } catch {
    return { ok: false, reason: INTENT_MISMATCH };
  }

  const headerKid = (() => {
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { kid?: unknown };
      return typeof header.kid === 'string' ? header.kid : null;
    } catch {
      return null;
    }
  })();
  const jwk = jwkForKid(jwks, headerKid);
  if (!jwk) return { ok: false, reason: INTENT_MISMATCH };
  const verified = verifyIssuerJws(jws, jwk);
  if (!verified.valid || !verified.payload) return { ok: false, reason: INTENT_MISMATCH };

  const signed = signedIntentMembers(payload);
  if (!signed) return { ok: false, reason: INTENT_MISMATCH };
  let canonical: string;
  try {
    canonical = intentCanonicalJson(signed);
  } catch {
    return { ok: false, reason: INTENT_MISMATCH };
  }
  if (canonical !== payloadText) return { ok: false, reason: INTENT_MISMATCH };
  const hash = intentHashOfPayloadText(payloadText);
  if (hash !== intent.intent_hash) return { ok: false, reason: INTENT_MISMATCH };
  if (signed.intent_id !== intent.intent_id) return { ok: false, reason: INTENT_MISMATCH };
  if (signed.schema !== INTENT_SCHEMA || signed.iss !== 'chit402') {
    return { ok: false, reason: INTENT_MISMATCH };
  }
  if (typeof intentDoc.intent_hash === 'string' && intentDoc.intent_hash !== hash) {
    return { ok: false, reason: INTENT_MISMATCH };
  }
  if (typeof intentDoc.intent_id === 'string' && intentDoc.intent_id !== signed.intent_id) {
    return { ok: false, reason: INTENT_MISMATCH };
  }

  const spec = frozenSpec(String(intent.spec_digest));
  if (!spec || signed.spec_digest !== intent.spec_digest) {
    return { ok: false, reason: SPEC_DIGEST_MISMATCH };
  }
  const comparator = frozenComparator(String(intent.comparator_pin));
  if (!comparator || signed.comparator_pin !== intent.comparator_pin) {
    return { ok: false, reason: COMPARATOR_UNPINNED };
  }

  const wantPayer = party(signed.payer);
  const wantPayee = party(signed.payee);
  const caller = isPlain(claims.caller_binding) ? claims.caller_binding : null;
  const payment = isPlain(claims.payment) ? claims.payment : null;
  const gotPayer = party(caller?.payer_wallet);
  const gotPayee = party(payment?.payee);
  if (!wantPayer || !wantPayee || gotPayer !== wantPayer || gotPayee !== wantPayee) {
    return { ok: false, reason: INTENT_MISMATCH };
  }

  if (comparator.relation !== 'spend_lte_max') {
    return { ok: false, reason: COMPARATOR_UNPINNED };
  }
  const max = atomic(signed.max_amount);
  const gross = atomic(payment?.gross_amount);
  const settled = payment && Object.prototype.hasOwnProperty.call(payment, 'settled_amount')
    ? atomic(payment.settled_amount)
    : gross;
  if (max == null || gross == null || settled == null || gross > max || settled > max) {
    return { ok: false, reason: INTENT_VIOLATION };
  }
  const issued = parseTime(claims.iat);
  const expiry = parseTime(signed.expiry);
  if (issued == null || expiry == null || issued > expiry) {
    return { ok: false, reason: INTENT_VIOLATION };
  }
  const useCount = signed.use_count;
  const useIndex = intent.use_index;
  if (!isJsonInteger(useCount) || useCount < 1 || !isJsonInteger(useIndex) || useIndex > useCount) {
    return { ok: false, reason: INTENT_VIOLATION };
  }
  if (typeof signed.external_ref_hash === 'string' && !HEX64.test(signed.external_ref_hash)) {
    return { ok: false, reason: INTENT_MISMATCH };
  }
  return { ok: true, reason: null };
}
