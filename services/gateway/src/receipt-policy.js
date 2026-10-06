/**
 * Terms a v11 receipt was issued under. The signed `policy` object is the
 * authority for that receipt. `/.well-known/receipt-policy-history.json`
 * announces later versions. It does not rewrite a receipt.
 *
 * policy_hash is SHA-256 of the RFC 8785 bytes of the terms, the same
 * canonicalizer as snapshot_hash. policy_hash is not inside that preimage.
 *
 * PR #486 names the same digest on the receipt-log bundle index as
 * retention_policy { id, sha256 }. This module is the source. #486 still
 * reads RECEIPT_LOG_RETENTION_POLICY_ID and RECEIPT_LOG_RETENTION_POLICY_SHA256
 * and does not hash this object. Boot refuses those vars when they disagree.
 */
import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';

export const RECEIPT_POLICY_HISTORY_SCHEMA = 'chit402.receipt_policy_history.v1';
export const RECEIPT_POLICY_RETENTION_MODE = 'compliance';

const DEV_TERMS = Object.freeze({
  policy_id: 'chit402.receipt-policy',
  policy_version: '1',
  dispute_window_seconds: 86400,
  retention_days: 365,
  retention_mode: RECEIPT_POLICY_RETENTION_MODE,
  max_cumulative_spend: null,
});

const REQUIRED = [
  'RECEIPT_POLICY_ID',
  'RECEIPT_POLICY_VERSION',
  'RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS',
  'RECEIPT_POLICY_RETENTION_DAYS',
  'RECEIPT_POLICY_RETENTION_MODE',
];

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function positiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Terms covered by policy_hash. Key set is fixed. max_cumulative_spend is
 * null when the policy sets no spend cap. A session grant stays on
 * session.max_cumulative_spend and is not copied here, so one policy_hash
 * can match the receipt-log retention_policy.sha256.
 * @param {object} input
 */
export function receiptPolicyTerms(input) {
  const spend = input?.max_cumulative_spend;
  return {
    policy_id: String(input.policy_id),
    policy_version: String(input.policy_version),
    dispute_window_seconds: Number(input.dispute_window_seconds),
    retention_days: Number(input.retention_days),
    retention_mode: String(input.retention_mode),
    max_cumulative_spend: spend == null || spend === '' ? null : String(spend),
  };
}

/** SHA-256 hex of the RFC 8785 terms. policy_hash is not an input. */
export function receiptPolicyHash(terms) {
  return sha256Hex(jcsRfc8785(receiptPolicyTerms(terms)));
}

export function receiptPolicyClaim(terms) {
  const body = receiptPolicyTerms(terms);
  return { ...body, policy_hash: receiptPolicyHash(body) };
}

/**
 * #486 bundle-index field. id is policy_id. sha256 is policy_hash.
 * @param {object} [terms]
 */
export function receiptPolicyRetentionClaim(terms = readReceiptPolicyTerms()) {
  const claim = receiptPolicyClaim(terms);
  return { id: claim.policy_id, sha256: claim.policy_hash };
}

function explicitTerms(env) {
  return REQUIRED.some((key) => env[key] != null && String(env[key]).trim() !== '');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ terms: object, source: 'env'|'default', problems: string[] }}
 */
export function readReceiptPolicyConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const problems = [];
  const useEnv = explicitTerms(env) || production;
  if (!useEnv) {
    const spend = env.RECEIPT_POLICY_MAX_CUMULATIVE_SPEND;
    return {
      terms: receiptPolicyTerms({
        ...DEV_TERMS,
        max_cumulative_spend: spend == null || String(spend).trim() === '' ? null : String(spend).trim(),
      }),
      source: 'default',
      problems: [],
    };
  }
  const policyId = String(env.RECEIPT_POLICY_ID || '').trim();
  const policyVersion = String(env.RECEIPT_POLICY_VERSION || '').trim();
  const dispute = positiveInt(env.RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS);
  const retentionDays = positiveInt(env.RECEIPT_POLICY_RETENTION_DAYS);
  const mode = String(env.RECEIPT_POLICY_RETENTION_MODE || '').trim();
  if (!policyId) problems.push('RECEIPT_POLICY_ID');
  if (!policyVersion) problems.push('RECEIPT_POLICY_VERSION');
  if (dispute == null) problems.push('RECEIPT_POLICY_DISPUTE_WINDOW_SECONDS');
  if (retentionDays == null) problems.push('RECEIPT_POLICY_RETENTION_DAYS');
  if (mode !== RECEIPT_POLICY_RETENTION_MODE) problems.push('RECEIPT_POLICY_RETENTION_MODE=compliance');
  const spendRaw = env.RECEIPT_POLICY_MAX_CUMULATIVE_SPEND;
  const spend = spendRaw == null || String(spendRaw).trim() === '' ? null : String(spendRaw).trim();
  if (spend != null && !/^[0-9]+$/.test(spend)) problems.push('RECEIPT_POLICY_MAX_CUMULATIVE_SPEND');
  const terms = receiptPolicyTerms({
    policy_id: policyId || DEV_TERMS.policy_id,
    policy_version: policyVersion || DEV_TERMS.policy_version,
    dispute_window_seconds: dispute ?? DEV_TERMS.dispute_window_seconds,
    retention_days: retentionDays ?? DEV_TERMS.retention_days,
    retention_mode: mode || DEV_TERMS.retention_mode,
    max_cumulative_spend: spend,
  });
  return { terms, source: 'env', problems };
}

export function readReceiptPolicyTerms(env = process.env) {
  const cfg = readReceiptPolicyConfig(env);
  if (cfg.problems.length) {
    throw new Error(`receipt policy config is incomplete: ${cfg.problems.join(', ')}`);
  }
  return cfg.terms;
}

/**
 * Production refuses to boot without the terms. A partial env fails in any
 * environment. RECEIPT_LOG_RETENTION_POLICY_* must equal this policy when set.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertReceiptPolicyBoot(env = process.env) {
  const cfg = readReceiptPolicyConfig(env);
  if (cfg.problems.length) {
    throw new Error(`receipt policy config is incomplete: ${cfg.problems.join(', ')}`);
  }
  const claim = receiptPolicyRetentionClaim(cfg.terms);
  const id = String(env.RECEIPT_LOG_RETENTION_POLICY_ID || '').trim();
  const sha = String(env.RECEIPT_LOG_RETENTION_POLICY_SHA256 || '').trim().toLowerCase();
  if (id || sha) {
    if (!id || !sha || id !== claim.id || sha !== claim.sha256) {
      throw new Error('RECEIPT_LOG_RETENTION_POLICY_ID and RECEIPT_LOG_RETENTION_POLICY_SHA256 must match policy_id and policy_hash');
    }
  }
  observeReceiptPolicy(env);
  return claim;
}

/** Signed v11 policy object, including policy_hash. */
export function signedReceiptPolicy(env = process.env) {
  return receiptPolicyClaim(readReceiptPolicyTerms(env));
}

/**
 * Recompute policy_hash and require the signed object.
 * @param {object|null|undefined} policy
 */
export function verifyReceiptPolicyClaim(policy) {
  if (!policy || typeof policy !== 'object') return { ok: false, reason: 'policy_missing' };
  const terms = receiptPolicyTerms(policy);
  for (const key of ['policy_id', 'policy_version', 'retention_mode']) {
    if (!terms[key]) return { ok: false, reason: 'policy_incomplete' };
  }
  if (terms.retention_mode !== RECEIPT_POLICY_RETENTION_MODE) {
    return { ok: false, reason: 'policy_retention_mode' };
  }
  if (!Number.isInteger(terms.dispute_window_seconds) || terms.dispute_window_seconds < 1) {
    return { ok: false, reason: 'policy_incomplete' };
  }
  if (!Number.isInteger(terms.retention_days) || terms.retention_days < 1) {
    return { ok: false, reason: 'policy_incomplete' };
  }
  if (terms.max_cumulative_spend != null && !/^[0-9]+$/.test(terms.max_cumulative_spend)) {
    return { ok: false, reason: 'policy_incomplete' };
  }
  const expected = receiptPolicyHash(terms);
  if (policy.policy_hash !== expected) return { ok: false, reason: 'policy_hash_mismatch' };
  return { ok: true, policy_hash: expected };
}

const policyHistory = [];

export function resetReceiptPolicyHistory() {
  policyHistory.length = 0;
}

function historyDocument() {
  return {
    schema: RECEIPT_POLICY_HISTORY_SCHEMA,
    entries: policyHistory.map((row) => ({ ...row, terms: { ...row.terms } })),
  };
}

/**
 * Append the current terms when policy_version or policy_hash changes.
 * Earlier rows stay. The receipt's signed policy still governs that receipt.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [effectiveFrom]
 */
export function observeReceiptPolicy(env = process.env, effectiveFrom = null) {
  const claim = signedReceiptPolicy(env);
  const terms = receiptPolicyTerms(claim);
  const last = policyHistory[policyHistory.length - 1];
  if (!last || last.policy_hash !== claim.policy_hash || last.policy_version !== claim.policy_version) {
    policyHistory.push({
      policy_version: claim.policy_version,
      policy_hash: claim.policy_hash,
      terms,
      effective_from: effectiveFrom || env.RECEIPT_POLICY_EFFECTIVE_FROM || new Date().toISOString(),
    });
  }
  return historyDocument();
}

export function receiptPolicyHistoryDocument(env = process.env) {
  return observeReceiptPolicy(env);
}

/**
 * @param {import('express').Response} res
 */
export function writeReceiptPolicyHistory(res, env = process.env) {
  const doc = receiptPolicyHistoryDocument(env);
  const body = jcsRfc8785(doc);
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('X-Chit-Hash-Alg', 'sha256');
  res.set('X-Chit-Policy-Hash', doc.entries.length ? doc.entries[doc.entries.length - 1].policy_hash : '');
  res.send(body);
}
