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

export type PolicyHistoryStatus = 'not_checked' | 'listed' | 'not_listed' | 'missing';

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

export function receiptPolicyTerms(input: unknown): ReceiptPolicyTerms | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const spend = row.max_cumulative_spend;
  return {
    policy_id: typeof row.policy_id === 'string' ? row.policy_id : String(row.policy_id ?? ''),
    policy_version: typeof row.policy_version === 'string' ? row.policy_version : String(row.policy_version ?? ''),
    dispute_window_seconds: Number(row.dispute_window_seconds),
    retention_days: Number(row.retention_days),
    retention_mode: typeof row.retention_mode === 'string' ? row.retention_mode : String(row.retention_mode ?? ''),
    max_cumulative_spend: spend == null || spend === '' ? null : String(spend),
  };
}

/** SHA-256 hex of the RFC 8785 terms. policy_hash is not an input. */
export function receiptPolicyHash(terms: ReceiptPolicyTerms): string {
  return createHash('sha256').update(rfc8785Canonicalize(terms), 'utf8').digest('hex');
}

export function verifyReceiptPolicyClaim(policy: unknown): { ok: boolean; reason: string | null; terms: ReceiptPolicyTerms | null; policy_hash: string | null } {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { ok: false, reason: 'policy_missing', terms: null, policy_hash: null };
  }
  const raw = policy as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(raw, 'policy_hash') || typeof raw.policy_hash !== 'string' || raw.policy_hash.length === 0) {
    return { ok: false, reason: 'policy_hash_missing', terms: null, policy_hash: null };
  }
  const terms = receiptPolicyTerms(policy);
  if (!terms) return { ok: false, reason: 'policy_incomplete', terms: null, policy_hash: null };
  if (!terms.policy_id || !terms.policy_version || !terms.retention_mode) {
    return { ok: false, reason: 'policy_incomplete', terms, policy_hash: null };
  }
  if (terms.retention_mode !== RECEIPT_POLICY_RETENTION_MODE) {
    return { ok: false, reason: 'policy_retention_mode', terms, policy_hash: null };
  }
  if (!Number.isInteger(terms.dispute_window_seconds) || terms.dispute_window_seconds < 1) {
    return { ok: false, reason: 'policy_incomplete', terms, policy_hash: null };
  }
  if (!Number.isInteger(terms.retention_days) || terms.retention_days < 1) {
    return { ok: false, reason: 'policy_incomplete', terms, policy_hash: null };
  }
  if (terms.max_cumulative_spend != null && !/^[0-9]+$/.test(terms.max_cumulative_spend)) {
    return { ok: false, reason: 'policy_incomplete', terms, policy_hash: null };
  }
  let expected: string;
  try {
    expected = receiptPolicyHash(terms);
  } catch {
    return { ok: false, reason: 'policy_incomplete', terms, policy_hash: null };
  }
  const signed = raw.policy_hash.replace(/^0x/i, '').toLowerCase();
  if (signed !== expected) return { ok: false, reason: 'policy_hash_mismatch', terms, policy_hash: expected };
  return { ok: true, reason: null, terms, policy_hash: expected };
}

export function policyHistoryListsHash(doc: unknown, policyHash: string): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const entries = (doc as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return false;
  const needle = policyHash.toLowerCase();
  return entries.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const hash = (row as { policy_hash?: unknown }).policy_hash;
    return typeof hash === 'string' && hash.replace(/^0x/i, '').toLowerCase() === needle;
  });
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
