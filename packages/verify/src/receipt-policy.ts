/**
 * Signed v11 receipt policy. The receipt's own terms govern.
 * `/.well-known/receipt-policy-history.json` only announces later versions.
 *
 * Gateway `receipt-policy.js` on cursor/gateway-v11-issuer-root-5306 (`cc04584`).
 * policy_hash is SHA-256 of the RFC 8785 bytes of the six terms. The hash
 * field is not part of that preimage. entry_hash stays on chit402-jcs-v1.
 */
import { createHash } from 'node:crypto';
import { rfc8785Canonicalize } from './jcs.js';

export const RECEIPT_POLICY_HISTORY_SCHEMA = 'chit402.receipt_policy_history.v1';
export const RECEIPT_POLICY_RETENTION_MODE = 'compliance';

/** Dev-default terms. policy_hash is not included. */
export const RECEIPT_POLICY_VECTOR_PREIMAGE = '{"dispute_window_seconds":86400,"max_cumulative_spend":null,"policy_id":"chit402.receipt-policy","policy_version":"1","retention_days":365,"retention_mode":"compliance"}';
export const RECEIPT_POLICY_VECTOR_HASH = '48a69e8a154e670ad67663feead6a6b7d9e0de6a8f733c49b108bf5d124502a8';
/** Same terms with max_cumulative_spend "2000". */
export const RECEIPT_POLICY_CAPPED_HASH = 'ecf4cdabe9b755e4776167429dcffb73e1f275994cda68f0e32d776cac925601';

export interface ReceiptPolicyTerms {
  policy_id: string;
  policy_version: string;
  dispute_window_seconds: number;
  retention_days: number;
  retention_mode: string;
  max_cumulative_spend: string | null;
}

export interface ReceiptPolicyClaim extends ReceiptPolicyTerms {
  policy_hash: string;
}

export type PolicyHistoryStatus = 'not_checked' | 'listed' | 'not_listed' | 'not_effective' | 'missing';

const POLICY_TERM_KEYS = [
  'dispute_window_seconds',
  'max_cumulative_spend',
  'policy_id',
  'policy_version',
  'retention_days',
  'retention_mode',
] as const;

const POLICY_OBJECT_KEYS = new Set<string>([...POLICY_TERM_KEYS, 'policy_hash']);

export interface PolicyCheck {
  checked: boolean;
  ok: boolean;
  reason: string | null;
  terms: ReceiptPolicyTerms | null;
  policy_hash: string | null;
  /** Informational. A missing announcement does not fail the receipt. */
  history: PolicyHistoryStatus;
}

export function uncheckedPolicy(): PolicyCheck {
  return {
    checked: false,
    ok: true,
    reason: null,
    terms: null,
    policy_hash: null,
    history: 'not_checked',
  };
}

function isPolicyTerms(value: ReceiptPolicyTerms): boolean {
  return value.policy_id.length > 0 && value.policy_version.length > 0;
}

/** The six hashed fields, copied only after the object has already passed the type check. */
export function receiptPolicyTerms(input: unknown): ReceiptPolicyTerms | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (typeof row.policy_id !== 'string' || typeof row.policy_version !== 'string') return null;
  if (typeof row.dispute_window_seconds !== 'number' || typeof row.retention_days !== 'number') return null;
  if (typeof row.retention_mode !== 'string') return null;
  if (row.max_cumulative_spend !== null && typeof row.max_cumulative_spend !== 'string') return null;
  return {
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    dispute_window_seconds: row.dispute_window_seconds,
    retention_days: row.retention_days,
    retention_mode: row.retention_mode,
    max_cumulative_spend: row.max_cumulative_spend,
  };
}

/** SHA-256 hex of the RFC 8785 terms. policy_hash is not an input. */
export function receiptPolicyHash(terms: ReceiptPolicyTerms): string {
  return createHash('sha256').update(rfc8785Canonicalize(terms), 'utf8').digest('hex');
}

export function verifyReceiptPolicyClaim(policy: unknown): { ok: boolean; reason: string | null; terms: ReceiptPolicyTerms | null; policy_hash: string | null } {
  if (policy == null) {
    return { ok: false, reason: 'POLICY_ABSENT', terms: null, policy_hash: null };
  }
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    return { ok: false, reason: 'policy_type', terms: null, policy_hash: null };
  }
  const raw = policy as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((key) => !POLICY_OBJECT_KEYS.has(key)) || POLICY_TERM_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))) {
    return { ok: false, reason: 'policy_fields', terms: null, policy_hash: null };
  }
  if (!Object.prototype.hasOwnProperty.call(raw, 'policy_hash')) {
    return { ok: false, reason: 'policy_hash_missing', terms: null, policy_hash: null };
  }
  const terms = receiptPolicyTerms(raw);
  if (!terms || !isPolicyTerms(terms)) {
    return { ok: false, reason: 'policy_type', terms: null, policy_hash: null };
  }
  if (!Number.isInteger(terms.dispute_window_seconds) || terms.dispute_window_seconds < 1
    || !Number.isInteger(terms.retention_days) || terms.retention_days < 1) {
    return { ok: false, reason: 'policy_type', terms, policy_hash: null };
  }
  if (terms.max_cumulative_spend !== null && !/^[0-9]+$/.test(terms.max_cumulative_spend)) {
    return { ok: false, reason: 'policy_type', terms, policy_hash: null };
  }
  if (terms.retention_mode !== RECEIPT_POLICY_RETENTION_MODE) {
    return { ok: false, reason: 'policy_retention_mode', terms, policy_hash: null };
  }
  if (typeof raw.policy_hash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.policy_hash)) {
    return { ok: false, reason: 'policy_hash_mismatch', terms, policy_hash: null };
  }
  let expected: string;
  try {
    expected = receiptPolicyHash(terms);
  } catch {
    return { ok: false, reason: 'policy_type', terms, policy_hash: null };
  }
  if (raw.policy_hash !== expected) return { ok: false, reason: 'policy_hash_mismatch', terms, policy_hash: expected };
  return { ok: true, reason: null, terms, policy_hash: expected };
}

/** retention_days must be at least 365 and must cover the dispute window. */
export function policyRetentionFloor(terms: ReceiptPolicyTerms): { ok: boolean; reason: 'policy_retention_floor' | null } {
  const disputeDays = terms.dispute_window_seconds / 86400;
  if (terms.retention_days < 365 || terms.retention_days < disputeDays) {
    return { ok: false, reason: 'policy_retention_floor' };
  }
  return { ok: true, reason: null };
}

export function samePolicyTerms(left: ReceiptPolicyTerms, right: ReceiptPolicyTerms): boolean {
  return left.policy_id === right.policy_id
    && left.policy_version === right.policy_version
    && left.dispute_window_seconds === right.dispute_window_seconds
    && left.retention_days === right.retention_days
    && left.retention_mode === right.retention_mode
    && left.max_cumulative_spend === right.max_cumulative_spend;
}

/** Terms for a pinned version inside a receipt-policy history document. */
export function termsForPolicyVersion(doc: unknown, version: string): ReceiptPolicyTerms | null {
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { entries?: unknown }).entries)) return null;
  for (const row of (doc as { entries: unknown[] }).entries) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as { policy_version?: unknown; terms?: unknown };
    if (String(entry.policy_version ?? '') !== version) continue;
    return receiptPolicyTerms(entry.terms);
  }
  return null;
}

function issuedAtMs(issuedAt: unknown): number | null {
  if (typeof issuedAt === 'number' && Number.isFinite(issuedAt)) {
    return issuedAt > 1e12 ? issuedAt : issuedAt * 1000;
  }
  if (typeof issuedAt === 'string' && issuedAt) {
    const ms = Date.parse(issuedAt);
    if (Number.isFinite(ms)) return ms;
    const parsed = Number(issuedAt);
    if (Number.isFinite(parsed)) return parsed > 1e12 ? parsed : parsed * 1000;
  }
  return null;
}

/**
 * The hash must appear with effective_from at or before the receipt's issued time.
 * A document that is not a history is `missing`.
 */
export function matchPolicyHistory(
  doc: unknown,
  policyHash: string,
  issuedAt: unknown,
): { status: PolicyHistoryStatus; ok: boolean; reason: string | null } {
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { entries?: unknown }).entries)) {
    return { status: 'missing', ok: false, reason: 'policy_history_missing' };
  }
  const needle = policyHash.toLowerCase();
  const issued = issuedAtMs(issuedAt);
  let sawHash = false;
  for (const row of (doc as { entries: unknown[] }).entries) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as { policy_hash?: unknown; effective_from?: unknown };
    if (typeof entry.policy_hash !== 'string' || entry.policy_hash.toLowerCase() !== needle) continue;
    sawHash = true;
    const from = typeof entry.effective_from === 'string' ? Date.parse(entry.effective_from) : NaN;
    if (issued != null && Number.isFinite(from) && from <= issued) {
      return { status: 'listed', ok: true, reason: null };
    }
  }
  if (!sawHash) return { status: 'not_listed', ok: false, reason: 'policy_history_mismatch' };
  return { status: 'not_effective', ok: false, reason: 'policy_history_not_effective' };
}

export function policyHistoryUrlFromReceipt(receipt: { verification?: { jwks_uri?: string }; verify_url?: string }): string | null {
  const jwks = receipt.verification?.jwks_uri;
  if (jwks && jwks.includes('/.well-known/jwks.json')) {
    return jwks.replace('/.well-known/jwks.json', '/.well-known/receipt-policy-history.json');
  }
  if (receipt.verify_url) {
    try {
      const url = new URL(receipt.verify_url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return `${url.origin}/.well-known/receipt-policy-history.json`;
    } catch {
      return null;
    }
  }
  return null;
}
