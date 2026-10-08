/**
 * v11 receipt seal.
 *
 * The signed JWS payload is exactly V11_SIGNED_FIELDS. RFC 8785 (JCS) bytes
 * are the payload segment. payload_hash is SHA-256 of those bytes and is
 * stored beside the signature, not inside the payload.
 *
 * One random 32-byte salt per receipt. HKDF-SHA256 (empty salt, info = the
 * label UTF-8, L = 32) derives a subkey. The commitment is
 * HMAC-SHA256(subkey, message), lowercase hex.
 *
 *   v11/output      raw output bytes
 *   v11/accounting  JCS {internal_breakdown, per_call_cost, floor, margin}
 *   v11/routing     JCS {provider, model} on every product
 *   v11/refusal     JCS {cap, spent, period_start, book_ref}
 *   v11/body        raw request body, inside request_digest
 *
 * issued_at is minute precision UTC, `YYYY-MM-DDTHH:MMZ`.
 * book_ref is a random 128-bit id. The sequential book id stays in the
 * server map and is not a v11 field.
 *
 * amount_gross is the quoted price. amount_settled is settled_amount: the
 * amount transferred by the bound payment (>= the quoted price). The gateway
 * binds settled_amount to the payer's signed authorization value, not the
 * server quote.
 */

import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';

export const V11_LABEL_OUTPUT = 'v11/output';
export const V11_LABEL_ACCOUNTING = 'v11/accounting';
export const V11_LABEL_ROUTING = 'v11/routing';
export const V11_LABEL_REFUSAL = 'v11/refusal';
export const V11_LABEL_BODY = 'v11/body';

export const V11_SIGNED_FIELDS = Object.freeze([
  'v',
  'receipt_id',
  'iss',
  'kid',
  'issued_at',
  'asset',
  'chain',
  'pay_to',
  'amount_gross',
  'amount_settled',
  'payment_tx',
  'payer',
  'book_ref',
  'seq',
  'request_digest',
  'output_commitment',
  'accounting_commitment',
  'routing_commitment',
  'product',
  'proof_tier',
  'covers',
]);

export const V11_REFUSAL_FIELDS = Object.freeze([
  'v',
  'refusal_id',
  'iss',
  'kid',
  'issued_at',
  'reason',
  'request_digest',
  'refusal_commitment',
]);

/** Keys that must not appear anywhere on a public v11 document. */
export const V11_DISALLOWED_KEYS = Object.freeze([
  'internal_breakdown',
  'provider',
  'model',
  'cap',
  'spent',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'output_hash',
  'claim_id',
  'book_id',
  'agent_id',
  'token_count',
]);

const HEX64 = /^[0-9a-f]{64}$/;
const bookRefs = new Map();

/**
 * @param {Buffer} ikm 32-byte receipt salt
 * @param {string} label
 * @returns {Buffer}
 */
export function hkdfSubkey(ikm, label) {
  const key = Buffer.isBuffer(ikm) ? ikm : Buffer.from(String(ikm), 'hex');
  if (key.length !== 32) throw new Error('hkdf ikm must be 32 bytes');
  return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from(label, 'utf8'), 32));
}

/**
 * @param {Buffer} subkey
 * @param {Buffer|string} message
 * @returns {string}
 */
export function commitHmac(subkey, message) {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8');
  return crypto.createHmac('sha256', subkey).update(bytes).digest('hex');
}

/**
 * @param {Buffer|string} salt
 * @param {string} label
 * @param {Buffer|string} message
 */
export function v11Commit(salt, label, message) {
  return commitHmac(hkdfSubkey(salt, label), message);
}

/**
 * Truncate to the UTC minute. `YYYY-MM-DDTHH:MMZ`.
 * @param {Date|string|number} [when]
 */
export function minuteIssuedAt(when = new Date()) {
  const date = when instanceof Date ? when : new Date(when);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new Error('issued_at is not a time');
  return new Date(ms).toISOString().slice(0, 16) + 'Z';
}

/**
 * Stable opaque id for an internal book key. The key itself is never returned.
 * @param {string|number} internalId
 */
export function bookRefForInternal(internalId) {
  const key = String(internalId);
  const existing = bookRefs.get(key);
  if (existing) return existing;
  const ref = crypto.randomBytes(16).toString('hex');
  bookRefs.set(key, ref);
  return ref;
}

export function resetBookRefs() {
  bookRefs.clear();
}

/**
 * @param {object} claims
 * @param {readonly string[]} fields
 */
export function assertExactFields(claims, fields) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('v11 claims must be an object');
  }
  const keys = Object.keys(claims);
  const allowed = new Set(fields);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`v11 disallowed field ${key}`);
  }
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(claims, key)) {
      throw new Error(`v11 missing field ${key}`);
    }
  }
}

export function assertV11Allowlist(claims) {
  assertExactFields(claims, V11_SIGNED_FIELDS);
  if (claims.v !== 11) throw new Error('v11 field v must be 11');
  for (const key of ['output_commitment', 'accounting_commitment', 'routing_commitment', 'request_digest']) {
    if (!HEX64.test(claims[key])) throw new Error(`v11 ${key} must be 64 lowercase hex`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(claims.issued_at)) {
    throw new Error('v11 issued_at must be minute precision UTC');
  }
  if (!/^[0-9a-f]{32}$/.test(String(claims.book_ref || ''))) throw new Error('v11 book_ref must be 16 bytes');
  if (!Array.isArray(claims.covers) || claims.covers.length !== 1 || claims.covers[0] !== 'payment') {
    throw new Error('v11 covers must be ["payment"]');
  }
}

export function assertV11RefusalAllowlist(claims) {
  assertExactFields(claims, V11_REFUSAL_FIELDS);
  if (claims.v !== 11) throw new Error('v11 refusal v must be 11');
  if (claims.reason !== 'cap_exceeded') throw new Error('v11 refusal reason must be cap_exceeded');
  for (const key of ['request_digest', 'refusal_commitment']) {
    if (!HEX64.test(claims[key])) throw new Error(`v11 ${key} must be 64 lowercase hex`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(claims.issued_at)) {
    throw new Error('v11 issued_at must be minute precision UTC');
  }
}

/**
 * Walk public JSON. A disallowed key is a build error.
 * @param {unknown} value
 * @param {string} [path]
 */
export function assertNoDisallowedPublic(value, path = '') {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoDisallowedPublic(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('ISSUER_PRIVATE_KEY')) {
      throw new Error(`v11 disallowed custody text at ${path || 'value'}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (V11_DISALLOWED_KEYS.includes(key)) throw new Error(`v11 disallowed field ${key}`);
    if (key === 'salt' || key === 'rawBody' || key === 'request_preimage') {
      throw new Error(`v11 disallowed field ${key}`);
    }
    assertNoDisallowedPublic(child, path ? `${path}.${key}` : key);
  }
}

function chainOf(ref) {
  const text = String(ref || '');
  const prefix = text.includes(':') ? text.slice(0, text.indexOf(':')) : '';
  if (prefix === 'base' || prefix === 'solana') return prefix;
  return null;
}

function txOf(ref) {
  const text = String(ref || '');
  const i = text.indexOf(':');
  if (i < 0) return null;
  return text.slice(i + 1) || null;
}

function amountString(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function productOf(view) {
  const privacy = view?.meta?.privacyProduct || view?.privacy?.product || view?.privacy_product || null;
  if (privacy) return String(privacy);
  return 'completions';
}

function seqOf(view) {
  const raw = view?.seq ?? view?.meta?.seq ?? view?.meta?.bookView?.seq ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function proofTierOf(view) {
  const tier = view?.proof?.tier ?? view?.proof_tier ?? view?.meta?.proofTier ?? null;
  return Number.isInteger(tier) ? tier : null;
}

/**
 * Bytes the output commitment covers. Not stored on the receipt.
 * @param {object} task
 * @returns {Buffer}
 */
export function outputBytesOf(task) {
  const result = task?.result;
  if (result == null) return Buffer.alloc(0);
  if (typeof result === 'string') return Buffer.from(result, 'utf8');
  if (result.content != null) return Buffer.from(String(result.content), 'utf8');
  if (typeof result.output === 'string') return Buffer.from(result.output, 'utf8');
  if (result.output != null) return Buffer.from(JSON.stringify(result.output), 'utf8');
  return Buffer.alloc(0);
}

/**
 * Accounting opening. Stays inside the commitment.
 * @param {object} view
 */
export function accountingOpening(view) {
  const accounting = view?.payment?.accounting || view?.meta?.pricing || {};
  const breakdown = accounting.internal_breakdown ?? view?.payment?.accounting?.internal_breakdown ?? null;
  return {
    internal_breakdown: breakdown,
    per_call_cost: accounting.per_call_cost ?? view?.provider_cogs?.actual ?? null,
    floor: accounting.floor ?? view?.payment?.floor_applied ?? null,
    margin: accounting.margin ?? breakdown?.route_margin_amount ?? null,
  };
}

/**
 * @param {object} view
 */
export function routingOpening(view) {
  return {
    provider: view?.route?.provider ?? view?.meta?.provider ?? view?.result?.provider ?? null,
    model: view?.route?.model ?? view?.intent?.modelId ?? view?.result?.model ?? null,
  };
}

/**
 * @param {{ cap: unknown, spent: unknown, period_start: unknown, book_ref: string }} opening
 */
export function refusalOpening(opening) {
  return {
    cap: opening.cap == null ? null : String(opening.cap),
    spent: opening.spent == null ? null : String(opening.spent),
    period_start: opening.period_start == null ? null : String(opening.period_start),
    book_ref: opening.book_ref,
  };
}

/**
 * @param {object} view fat draft
 * @param {{ kid: string, salt: Buffer|string, outputBytes: Buffer, receiptId: string, requestDigest: string, issuedAt?: string }} ctx
 */
export function buildV11SignedClaims(view, ctx) {
  const payment = view?.payment || {};
  const ref = payment.ref ?? view?.intent?.paymentRef ?? null;
  const internalBook = view?.meta?.agentId ?? view?.meta?.agent_id ?? view?.claim_id ?? view?.task_id ?? ctx.receiptId;
  const claims = {
    v: 11,
    receipt_id: ctx.receiptId,
    iss: 'chit402',
    kid: ctx.kid,
    issued_at: ctx.issuedAt || minuteIssuedAt(view?.created_at ? new Date(Number(view.created_at) * 1000) : new Date()),
    asset: payment.asset ?? view?.meta?.paymentAsset ?? 'USDC',
    chain: chainOf(ref),
    pay_to: payment.payee ?? view?.meta?.payTo ?? null,
    amount_gross: amountString(payment.gross_amount ?? view?.intent?.amount ?? null),
    // settled_amount: the amount transferred by the bound payment (>= the quoted price).
    // Bound to the payer's signed authorization value, not the server quote.
    amount_settled: amountString(
      Object.prototype.hasOwnProperty.call(payment, 'settled_amount')
        ? payment.settled_amount
        : (payment.gross_amount ?? view?.intent?.amount ?? null),
    ),
    payment_tx: txOf(ref),
    payer: view?.caller_binding?.payer_wallet ?? view?.meta?.payerWallet ?? null,
    book_ref: bookRefForInternal(internalBook),
    seq: seqOf(view),
    request_digest: ctx.requestDigest,
    output_commitment: v11Commit(ctx.salt, V11_LABEL_OUTPUT, ctx.outputBytes || Buffer.alloc(0)),
    accounting_commitment: v11Commit(ctx.salt, V11_LABEL_ACCOUNTING, jcsRfc8785(accountingOpening(view))),
    routing_commitment: v11Commit(ctx.salt, V11_LABEL_ROUTING, jcsRfc8785(routingOpening(view))),
    product: productOf(view),
    proof_tier: proofTierOf(view),
    covers: ['payment'],
  };
  assertV11Allowlist(claims);
  return claims;
}

/**
 * @param {{ claims: object, jws: string, kid: string, verifyUrl?: string|null }} parts
 */
export function publicV11Receipt(parts) {
  assertV11Allowlist(parts.claims);
  const doc = {
    ...parts.claims,
    issuer_signature: {
      alg: 'ES256',
      kid: parts.kid,
      jws: parts.jws,
    },
    verify_url: parts.verifyUrl || null,
  };
  assertNoDisallowedPublic(doc);
  return doc;
}

/**
 * @param {object} row ledger row
 * @param {{ kid: string, salt: Buffer|string, requestDigest: string, bookRef: string, refusalId: string, issuedAt: string }} ctx
 */
export function buildV11RefusalClaims(row, ctx) {
  const claims = {
    v: 11,
    refusal_id: ctx.refusalId,
    iss: 'chit402',
    kid: ctx.kid,
    issued_at: ctx.issuedAt,
    reason: 'cap_exceeded',
    request_digest: ctx.requestDigest,
    refusal_commitment: v11Commit(ctx.salt, V11_LABEL_REFUSAL, jcsRfc8785(refusalOpening({
      cap: row?.cap_atomic ?? null,
      spent: row?.spent_atomic ?? null,
      period_start: row?.period_start ?? null,
      book_ref: ctx.bookRef,
    }))),
  };
  assertV11RefusalAllowlist(claims);
  return claims;
}

/**
 * @param {{ claims: object, jws: string, kid: string, verifyUrl?: string|null }} parts
 */
export function publicV11Refusal(parts) {
  assertV11RefusalAllowlist(parts.claims);
  const doc = {
    ...parts.claims,
    issuer_signature: {
      alg: 'ES256',
      kid: parts.kid,
      jws: parts.jws,
    },
    verify_url: parts.verifyUrl ?? null,
  };
  assertNoDisallowedPublic(doc);
  return doc;
}

export function isV11Document(doc) {
  return !!doc && typeof doc === 'object' && (doc.v === 11 || doc?.issuer_signature && v11PayloadVersion(doc) === 11);
}

function v11PayloadVersion(doc) {
  const jws = doc?.issuer_signature?.jws;
  if (!jws || typeof jws !== 'string') return null;
  try {
    const payload = JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
    if (payload?.v === 11) return 11;
    const n = Number(payload?.payload_version);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Public HTML. No token counts, model, provider, or economics. */
export function renderV11ReceiptHtml(receipt) {
  const id = esc(receipt.receipt_id || receipt.refusal_id || '');
  const when = esc(receipt.issued_at || '');
  const verify = esc(receipt.verify_url || '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chit402 receipt</title></head><body>`
    + `<h1>Chit402 receipt</h1>`
    + `<p>Receipt ${id}</p>`
    + `<p>Issued ${when}</p>`
    + (verify ? `<p><a href="${verify}">Verify</a></p>` : '')
    + `</body></html>`;
}

const TASK_DROP = new Set([
  'salt', 'rawBody', 'raw_body', 'messages', 'prompt', 'content', 'text', 'tool_calls',
]);

/**
 * Snapshot written to the task data dir. Drops prompt, salt, and plaintext output.
 * @param {object} task
 */
export function scrubTaskForDisk(task) {
  const copy = JSON.parse(JSON.stringify(task, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  if (copy.request && typeof copy.request === 'object') {
    copy.request = {
      method: copy.request.method || null,
      path: copy.request.path || null,
      idempotency_key: copy.request.idempotency_key ?? null,
      nonce: copy.request.nonce ?? null,
    };
  }
  if (copy.result && typeof copy.result === 'object') {
    delete copy.result.content;
    delete copy.result.output;
    delete copy.result.text;
    delete copy.result.tool_calls;
  } else if (typeof copy.result === 'string') {
    delete copy.result;
  }
  if (copy.intent && typeof copy.intent === 'object') {
    delete copy.intent.prompt;
    delete copy.intent.messages;
    delete copy.intent.input;
  }
  delete copy.messages;
  stripSensitive(copy, TASK_DROP);
  return copy;
}

/**
 * Ledger line. The request column is the commitment and the digest.
 * @param {object} row
 * @param {{ body_commitment?: string|null, request_digest?: string|null }} [binding]
 */
export function scrubLedgerRow(row, binding = {}) {
  const copy = JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const digest = binding.request_digest || copy.refusal?.request_digest || copy.request_digest || null;
  const commitment = binding.body_commitment || null;
  if (copy.request && typeof copy.request === 'object') {
    copy.request = {};
    if (commitment) copy.request.body_commitment = commitment;
    if (digest) copy.request.request_digest = digest;
  }
  stripSensitive(copy, new Set(['salt', 'rawBody', 'raw_body', 'messages', 'prompt', 'content', 'text']));
  return copy;
}

function stripSensitive(value, drop) {
  if (Array.isArray(value)) {
    for (const item of value) stripSensitive(item, drop);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (drop.has(key) || key === 'salt' || key.toLowerCase() === 'x-chit-request-salt') {
      delete value[key];
      continue;
    }
    stripSensitive(value[key], drop);
  }
}
