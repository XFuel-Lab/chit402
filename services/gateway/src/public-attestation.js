/**
 * Public receipt attestation (verifier 0.4.6). Pure functions: claim
 * building, eligibility, leaf re-derivation, payload bytes, and an ES256
 * self-check. This module imports no signer and no store.
 *
 * The payload is the tag line `chit402.public_receipt.v1\n` plus the
 * RFC 8785 canonical claims. It is not JSON, so every verifier before
 * 0.4.6 rejects it. The claims are an exact allowlist. There is no
 * payload_version and no v: the version is the tag line.
 */
import crypto from 'node:crypto';
import { isCanonicalCompactEs256 } from './jws-canonical.js';

export const PUBLIC_RECEIPT_TAG = 'chit402.public_receipt.v1';
export const PUBLIC_RECEIPT_PREFIX = `${PUBLIC_RECEIPT_TAG}\n`;
export const PUBLIC_RECEIPT_TYP = 'chit402-public-receipt+jwt';
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Exact keys, sorted. Tests pin these lists. */
export const PUBLIC_CLAIM_KEYS = Object.freeze(['attested_at', 'iss', 'issued_at', 'log', 'payment', 'task_id']);
export const PUBLIC_PAYMENT_KEYS = Object.freeze(['asset', 'gross_amount', 'payee', 'rail', 'ref', 'settled_amount']);
export const PUBLIC_LOG_KEYS = Object.freeze(['epoch', 'leaf_hash', 'leaf_index']);

const TASK_ID = /^(chit|xfuel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[1-9][0-9]{0,77}$/;

/** RFC 8785 for the value types used here (strings, safe integers, objects). */
export function jcs(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('public claims allow safe integers only');
    return String(value);
  }
  if (type === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`;
  }
  throw new Error(`cannot canonicalize ${type}`);
}

/** Same minute rounding as the public shell's issued_at. */
export function minuteIso(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

/** `base:0x<64 hex>` in lowercase, or null. One attestation per normalized ref. */
export function normalizeBaseRef(ref) {
  const m = /^(?:base|eip155:8453):(0x[0-9a-fA-F]{64})$/.exec(String(ref || '').trim());
  return m ? `base:${m[1].toLowerCase()}` : null;
}

export function decodeJwsClaims(jws) {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * Collected Base USDC receipts only. Ledger facts come from the entry;
 * payment facts come from the signed holder claims. Anything else is
 * skipped, never attested: foreign, OpenRouter, late, refusal, inflow,
 * escrow, board stamp, policy block, a null or zero settled amount.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function publicAttestationEligibility(entry, claims) {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: 'no_entry' };
  if (entry.collected !== true) return { ok: false, reason: 'not_collected' };
  if (entry.evidence != null && entry.evidence !== 'collected') return { ok: false, reason: 'evidence' };
  if (entry.foreign_x402 || entry.source || entry.openrouter || entry.late || entry.refusal) {
    return { ok: false, reason: 'not_native' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'no_claims' };
  if (typeof claims.task_id !== 'string' || !TASK_ID.test(claims.task_id)) return { ok: false, reason: 'task_id' };
  if (String(entry.task_id || '') !== claims.task_id) return { ok: false, reason: 'task_id_mismatch' };
  if (claims.kind != null && claims.kind !== 'receipt' && claims.kind !== 'task') {
    return { ok: false, reason: 'kind' };
  }
  const pay = claims.payment;
  if (!pay || typeof pay !== 'object') return { ok: false, reason: 'no_payment' };
  if (pay.rail !== 'usdc') return { ok: false, reason: 'rail' };
  const ref = normalizeBaseRef(pay.ref);
  if (!ref) return { ok: false, reason: 'not_base' };
  if (entry.payment_ref != null && normalizeBaseRef(entry.payment_ref) !== ref) return { ok: false, reason: 'ref_mismatch' };
  if (typeof pay.asset !== 'string' || pay.asset.toLowerCase() !== BASE_USDC.toLowerCase()) return { ok: false, reason: 'asset' };
  if (typeof pay.payee !== 'string' || !EVM_ADDRESS.test(pay.payee)) return { ok: false, reason: 'payee' };
  if (pay.gross_amount == null || !AMOUNT.test(String(pay.gross_amount))) return { ok: false, reason: 'gross_amount' };
  if (pay.settled_amount == null || !AMOUNT.test(String(pay.settled_amount))) return { ok: false, reason: 'settled_amount' };
  if (minuteIso(claims.iat) == null) return { ok: false, reason: 'iat' };
  return { ok: true };
}

export function leafHashOf(taskId, rowHash) {
  return crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash || ''}`)]))
    .digest('hex');
}

/**
 * The leaf record, re-derived from the log. The stored leaf must equal
 * SHA256(0x00 || task_id|row_hash) for the ledger row hash. A mismatch is
 * `leaf_mismatch`: never signed.
 * @returns {{ ok: true, record: { epoch: number, leaf_index: number, leaf_hash: string } } | { ok: false, reason: string }}
 */
export function leafRecordFor(tree, taskId, rowHash) {
  if (!tree || typeof tree._locate !== 'function') return { ok: false, reason: 'no_log' };
  const epoch = tree._locate(taskId);
  const index = epoch?.byTask?.get?.(String(taskId));
  if (!epoch || !Number.isSafeInteger(index) || index < 0) return { ok: false, reason: 'not_in_log' };
  const stored = epoch.leaves?.[index];
  if (!stored) return { ok: false, reason: 'not_in_log' };
  const storedHex = Buffer.from(stored).toString('hex');
  const derived = leafHashOf(taskId, rowHash);
  if (storedHex !== derived) return { ok: false, reason: 'leaf_mismatch' };
  const epochNo = Number(epoch.epoch);
  if (!Number.isSafeInteger(epochNo) || epochNo < 1) return { ok: false, reason: 'no_epoch' };
  return { ok: true, record: { epoch: epochNo, leaf_index: index, leaf_hash: derived } };
}

/**
 * Claims from the signed holder claims and the leaf record only. No field
 * is read from the ledger row except through the leaf check.
 */
export function buildPublicClaims({ claims, leaf, attestedAt }) {
  const pay = claims.payment;
  const out = {
    attested_at: minuteIso(attestedAt),
    iss: 'chit402',
    issued_at: minuteIso(claims.iat),
    log: { epoch: leaf.epoch, leaf_hash: leaf.leaf_hash, leaf_index: leaf.leaf_index },
    payment: {
      asset: pay.asset,
      gross_amount: String(pay.gross_amount),
      payee: pay.payee,
      rail: 'usdc',
      ref: normalizeBaseRef(pay.ref),
      settled_amount: String(pay.settled_amount),
    },
    task_id: claims.task_id,
  };
  assertPublicClaims(out);
  return out;
}

function exact(obj, keys) {
  const got = Object.keys(obj || {}).sort();
  return got.length === keys.length && got.every((k, i) => k === keys[i]);
}

export function assertPublicClaims(claims) {
  if (!exact(claims, PUBLIC_CLAIM_KEYS)) throw new Error('public claims: keys');
  if (!exact(claims.payment, PUBLIC_PAYMENT_KEYS)) throw new Error('public claims: payment keys');
  if (!exact(claims.log, PUBLIC_LOG_KEYS)) throw new Error('public claims: log keys');
  if (!claims.issued_at || !claims.attested_at) throw new Error('public claims: times');
  if (Date.parse(claims.issued_at) > Date.parse(claims.attested_at)) throw new Error('public claims: issued after attested');
  if (!claims.payment.ref) throw new Error('public claims: ref');
}

export function publicPayloadUtf8(claims) {
  assertPublicClaims(claims);
  return `${PUBLIC_RECEIPT_PREFIX}${jcs(claims)}`;
}

/** ES256 check of a public attestation against a public JWK (self-verify). */
export function verifyPublicAttestationJws(jws, publicJwk) {
  if (!isCanonicalCompactEs256(jws)) return false;
  try {
    const [h, p, s] = String(jws).split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'ES256' || header.typ !== PUBLIC_RECEIPT_TYP) return false;
    if (!Buffer.from(p, 'base64url').toString('utf8').startsWith(PUBLIC_RECEIPT_PREFIX)) return false;
    const key = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y },
      format: 'jwk',
    });
    return crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  } catch {
    return false;
  }
}

/** Claims of a stored attestation (tag line stripped), or null. */
export function attestationClaims(jws) {
  try {
    const payload = Buffer.from(String(jws).split('.')[1] || '', 'base64url').toString('utf8');
    if (!payload.startsWith(PUBLIC_RECEIPT_PREFIX)) return null;
    return JSON.parse(payload.slice(PUBLIC_RECEIPT_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * Serve-time guard. A stored attestation is served only while the shell's
 * outer fields still equal the signed values. A later re-seal that moved an
 * amount would otherwise make an honest page check as claim_mismatch.
 * Returns null when it matches, else the first differing field.
 */
export function attestationShellDrift(jws, shell) {
  const claims = attestationClaims(jws);
  if (!claims) return 'claims';
  const strip = (id) => String(id || '').toLowerCase().replace(/^(chit|xfuel)-/, '');
  if (shell.task_id != null && strip(shell.task_id) !== strip(claims.task_id)) return 'task_id';
  const pay = claims.payment || {};
  const tx = String(pay.ref || '').replace(/^base:/, '');
  const pairs = [
    ['amount_gross', (v) => String(v) === pay.gross_amount],
    ['amount_settled', (v) => String(v) === pay.settled_amount],
    ['pay_to', (v) => String(v).toLowerCase() === String(pay.payee || '').toLowerCase()],
    ['payment_tx', (v) => String(v).toLowerCase().replace(/^base:/, '') === tx],
    ['issued_at', (v) => v === claims.issued_at],
  ];
  for (const [field, ok] of pairs) {
    if (shell[field] != null && !ok(shell[field])) return field;
  }
  const leaf = shell.inclusion?.leaf_hash;
  if (leaf != null && String(leaf).toLowerCase() !== claims.log?.leaf_hash) return 'leaf_hash';
  return null;
}
