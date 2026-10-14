/**
 * chit402.public.v1 — a derived signed statement, not the receipt.
 *
 * One record per receipt. Signed once, by the background job, with the
 * same issuer key that signs receipts. A GET does not import this module's
 * signer. Existing receipt bytes, leaves, heads, and anchors are not rewritten.
 *
 * payment_tx is absent (Christopher, D1). Option B salts are not implemented.
 * v12 leaf commitment is not this record. v10 and v11 bind the existing leaf
 * by the issuer signature over leaf_hash (issuer_asserted).
 */
import crypto from 'node:crypto';
import { signJws, getIssuerKid } from './issuer-key.js';
import {
  getPublicRecordBytes,
  putPublicRecordBytes,
  publicRecordJobEnabled,
} from './public-record-store.js';

/** Same names the public shell treats as private. Kept here so signing does not load the renderer. */
const PRIVATE_KEYS = [
  'payer_wallet',
  'agent_id',
  'book_id',
  'book_seq',
  'output_hash',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'request_digest',
];

function decodeJwsPayload(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export const PUBLIC_RECORD_SCHEMA = 'chit402.public.v1';
export const PUBLIC_RECORD_TYP = 'chit402.public+jws';

/**
 * Keys that may appear in the signed payload. This is the public shell
 * card minus payment_tx, plus the two binding hashes and the signature time.
 * The compact JWS is the stored record. These are the payload keys.
 */
export const PUBLIC_RECORD_ALLOWLIST = Object.freeze([
  'schema',
  'receipt_id',
  'payload_version',
  'full_receipt_sha256',
  'leaf_hash',
  'log_id',
  'asset',
  'chain',
  'pay_to',
  'amount_gross',
  'amount_settled',
  'issued_at',
  'public_signed_at',
  'kid',
]);

const ALLOWED = new Set(PUBLIC_RECORD_ALLOWLIST);
/** Shell private keys, plus names the public card must not grow into. */
const PRIVATE = new Set([
  ...PRIVATE_KEYS,
  'claim_id',
  'caller_binding',
  'intent',
  'route',
  'usage',
  'output',
  'payment_tx',
  'task_id',
  'salt',
  'salts',
  'commitments',
]);

export function fullReceiptSha256(compactJws) {
  return crypto.createHash('sha256').update(Buffer.from(String(compactJws), 'utf8')).digest('hex');
}

function isJsonInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function minuteIso(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

/** Signed payment object, or null. The outer quote is not a payment. */
function signedPayment(claims) {
  const payment = claims?.payment;
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return null;
  return payment;
}

function signedText(value) {
  if (value == null || value === '') return null;
  return String(value);
}

export function receiptIdOf(receipt) {
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  const signed = typeof claims.task_id === 'string' && claims.task_id ? claims.task_id : null;
  const outer = receipt?.task_id || receipt?.receipt_id || null;
  if (signed && outer && signed !== outer) return null;
  return signed;
}

export function receiptVersionOf(receipt) {
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  if (isJsonInteger(claims.v)) return claims.v;
  if (isJsonInteger(claims.payload_version)) return claims.payload_version;
  return null;
}

export function isRefusalReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.schema === 'chit402.refusal.v1') return true;
  if (receipt.refusal_id && receipt.charged === false) return true;
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  return claims.schema === 'chit402.refusal.v1';
}

/**
 * Throws when the payload is not exactly the allowlist.
 * A private shell key, including payment_tx, is a hard failure.
 */
export function assertPublicRecordAllowlist(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const err = new Error('public_record_payload');
    err.code = 'public_record_payload';
    throw err;
  }
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (PRIVATE.has(key) || !ALLOWED.has(key)) {
      const err = new Error(`public_field_rejected:${key}`);
      err.code = 'public_field_rejected';
      err.field = key;
      throw err;
    }
  }
  for (const key of PUBLIC_RECORD_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      const err = new Error(`public_field_missing:${key}`);
      err.code = 'public_field_missing';
      err.field = key;
      throw err;
    }
  }
  if (payload.schema !== PUBLIC_RECORD_SCHEMA) {
    const err = new Error('public_record_schema');
    err.code = 'public_record_schema';
    throw err;
  }
}

export function buildPublicRecordPayload(receipt, {
  leafHash = null,
  logId = null,
  signedAt = new Date(),
} = {}) {
  const jws = receipt?.issuer_signature?.jws;
  if (typeof jws !== 'string' || jws.split('.').length !== 3) {
    const err = new Error('public_record_needs_jws');
    err.code = 'public_record_needs_jws';
    throw err;
  }
  const claims = decodeJwsPayload(jws) || {};
  const payment = signedPayment(claims);
  if (!payment) {
    const err = new Error('public_record_payment_missing');
    err.code = 'public_record_payment_missing';
    throw err;
  }
  const outerId = receipt?.task_id || receipt?.receipt_id || null;
  const signedId = typeof claims.task_id === 'string' && claims.task_id ? claims.task_id : null;
  if (!signedId || (outerId && outerId !== signedId)) {
    const err = new Error('public_record_id_mismatch');
    err.code = 'public_record_id_mismatch';
    throw err;
  }
  const leaf = leafHash == null || leafHash === '' ? null : String(leafHash);
  const payload = {
    schema: PUBLIC_RECORD_SCHEMA,
    receipt_id: signedId,
    payload_version: receiptVersionOf(receipt),
    full_receipt_sha256: fullReceiptSha256(jws),
    leaf_hash: leaf,
    log_id: leaf ? (logId == null ? null : String(logId)) : null,
    asset: signedText(payment.asset),
    chain: signedText(payment.network),
    pay_to: signedText(payment.payee),
    amount_gross: signedText(payment.gross_amount),
    amount_settled: signedText(payment.settled_amount),
    issued_at: minuteIso(claims.iat ?? null),
    public_signed_at: new Date(signedAt).toISOString(),
    kid: getIssuerKid(),
  };
  assertPublicRecordAllowlist(payload);
  return payload;
}

/** Compact JWS. The payload kid is the receipt issuer kid. */
export function signPublicRecordPayload(payload) {
  assertPublicRecordAllowlist(payload);
  const { jws, kid } = signJws(payload, { typ: PUBLIC_RECORD_TYP });
  if (payload.kid !== kid) {
    const err = new Error('public_record_kid');
    err.code = 'public_record_kid';
    throw err;
  }
  const header = JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString('utf8'));
  if (header.alg !== 'ES256' || header.typ !== PUBLIC_RECORD_TYP || header.kid !== kid) {
    const err = new Error('public_record_header');
    err.code = 'public_record_header';
    throw err;
  }
  return jws;
}

/**
 * Sign one receipt if no record is stored. A second call returns the first bytes.
 * Refusals are not signed. The caller supplies the existing log leaf; this
 * function does not append to the log and does not re-sign the receipt.
 */
export function signPublicRecordOnce(receipt, {
  leafHash = null,
  logId = null,
  signedAt = new Date(),
} = {}) {
  if (isRefusalReceipt(receipt)) {
    return { created: false, skipped: 'refusal', bytes: null };
  }
  const id = receiptIdOf(receipt);
  if (!id) {
    const err = new Error('public_record_needs_id');
    err.code = 'public_record_needs_id';
    throw err;
  }
  const existing = getPublicRecordBytes(id);
  if (existing) return { created: false, skipped: null, bytes: existing };
  const payload = buildPublicRecordPayload(receipt, { leafHash, logId, signedAt });
  const jws = signPublicRecordPayload(payload);
  const bytes = Buffer.from(jws, 'utf8');
  const wrote = putPublicRecordBytes(id, bytes);
  if (!wrote) {
    return { created: false, skipped: null, bytes: getPublicRecordBytes(id) };
  }
  return { created: true, skipped: null, bytes };
}

export function signMissingPublicRecords(items, { signedAt = new Date() } = {}) {
  const signed = [];
  for (const item of items || []) {
    const receipt = item?.receipt || item;
    if (!receipt || isRefusalReceipt(receipt)) continue;
    const id = receiptIdOf(receipt);
    if (!id || getPublicRecordBytes(id)) continue;
    const result = signPublicRecordOnce(receipt, {
      leafHash: item?.leafHash ?? item?.leaf_hash ?? null,
      logId: item?.logId ?? item?.log_id ?? null,
      signedAt,
    });
    if (result.created) signed.push(id);
  }
  return signed;
}

/**
 * One pass over tasks that already carry an issuer JWS.
 * A thrown inclusion lookup skips that receipt for this pass.
 * It does not store a null leaf in place of an unread one.
 */
export function inputsFromTasks(tasks, leafOf) {
  const items = [];
  for (const task of tasks || []) {
    const receipt = receiptFromTask(task);
    if (!receipt || isRefusalReceipt(receipt)) continue;
    let leafHash = null;
    let logId = null;
    if (typeof leafOf === 'function') {
      try {
        const leaf = leafOf(receipt) || {};
        if (leaf.skip) continue;
        leafHash = leaf.leafHash ?? null;
        logId = leaf.logId ?? null;
      } catch {
        continue;
      }
    }
    // A live pass waits for the log. Signing a null leaf here would freeze
    // the record as pre-log. The backfill script can still pass null on purpose.
    if (!leafHash) continue;
    items.push({ receipt, leafHash, logId });
  }
  return items;
}

export function receiptFromTask(task) {
  if (!task || typeof task !== 'object') return null;
  if (task.issuer_signature?.jws && (task.task_id || task.receipt_id)) return task;
  const jws = task.issuerSignature?.jws || task.issuer_signature?.jws || task.receipt?.issuer_signature?.jws;
  if (!jws) return null;
  if (task.receipt?.issuer_signature?.jws) return task.receipt;
  return {
    task_id: task.taskId || task.task_id,
    created_at: task.createdAt || task.created_at || null,
    issuer_signature: task.issuerSignature || task.issuer_signature || { jws },
    payment: {
      asset: task.meta?.paymentAsset || null,
      network: task.meta?.chain || null,
      payee: task.meta?.payTo || null,
      ref: task.intent?.paymentRef || null,
      gross_amount: task.intent?.amount ?? null,
      settled_amount: task.intent?.amount ?? null,
    },
  };
}

export function leafFromTree(tree, receipt) {
  const id = receiptIdOf(receipt);
  if (!id || !tree || typeof tree.inclusion !== 'function') {
    return { leafHash: null, logId: null };
  }
  const inclusion = tree.inclusion(id);
  if (!inclusion?.leaf) return { leafHash: null, logId: null };
  const epoch = inclusion.epoch;
  return {
    leafHash: String(inclusion.leaf),
    logId: epoch == null ? 'chit402.receipt-log' : `epoch:${epoch}`,
  };
}

/**
 * Background pass. Unref'd so a test process is not kept alive.
 * PUBLIC_RECORD_JOB defaults off. The HTTP handler never calls this.
 */
export function startPublicRecordJob({ list, intervalMs = 60_000 } = {}) {
  const tick = () => {
    try {
      const items = typeof list === 'function' ? list() : [];
      signMissingPublicRecords(items);
    } catch {
      // A pass that cannot list receipts signs nothing. The error is not the receipt.
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

export function publicRecordJobFlagEnabled(env = process.env) {
  return publicRecordJobEnabled(env);
}
