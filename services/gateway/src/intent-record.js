/**
 * Signed pre-action intent (chit402.intent.v1) and the optional v12
 * receipt block.
 *
 * v12 field list when an intent is bound:
 *   payload_version 12
 *   intent.intent_id, intent.intent_hash, intent.spec_digest,
 *   intent.comparator_pin, intent.use_index
 *   issuer_history.head_hash, issuer_history.entry_count
 *
 * cap_row_hash is not a field. A not-assessable record and a price
 * observation are separate record types and are not on this payload.
 *
 * CANONICAL_PAYLOAD_VERSION stays 10. This module mints a v12 receipt
 * only when RECEIPT_V12_MINT=true and NODE_ENV is test or development.
 * Production ignores the flag.
 *
 * intent_hash = SHA-256 of the RFC 8785 bytes that were signed. The
 * signature, merchant name, and raw external token are not in those bytes.
 * The external token is stored as external_ref_hash.
 */
import logger from './logger.js';
import crypto from 'node:crypto';
import { signJws, getIssuerKid, isProductionIssuerEnv } from './issuer-key.js';
import { currentIssuerHistory } from './issuer-history.js';
import { clockToleranceClaim } from './receipt-anchor-clock.js';
import { settleBoundPayment as settleBoundPaymentDefault } from './x402-settle.js';
import {
  SPEND_COMPARATOR,
  INTENT_PROJECTION_SPEC,
  jcsRfc8785,
  comparatorPin,
  specDigest,
  intentHash,
} from './intent-pins.js';

export {
  SPEND_COMPARATOR,
  INTENT_PROJECTION_SPEC,
  comparatorPin,
  specDigest,
  intentHash,
};

export const INTENT_SCHEMA = 'chit402.intent.v1';
export const V12_PAYLOAD_VERSION = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIXED = /^(chit|xfuel)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const HEX64 = /^[0-9a-f]{64}$/;

const SIGNED_REQUIRED = [
  'asset',
  'chain',
  'comparator_pin',
  'expiry',
  'iat',
  'intent_id',
  'iss',
  'max_amount',
  'payee',
  'payer',
  'schema',
  'spec_digest',
  'use_count',
];

/**
 * v12 id grammar. A bare lowercase uuid is the signed intent id (D2).
 * A chit- or xfuel- prefix is a lookup alias and is not copied into the
 * signed id. Uppercase, a double prefix, and trailing data do not parse.
 * @param {unknown} value
 * @returns {{ uuid: string, prefix: 'chit'|'xfuel'|null }|null}
 */
export function parseV12Uuid(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 80) return null;
  if (UUID.test(value)) return { uuid: value, prefix: null };
  const match = PREFIXED.exec(value);
  if (!match) return null;
  return { uuid: match[2], prefix: /** @type {'chit'|'xfuel'} */ (match[1]) };
}

// Hard-off until the v12 release: an env flip cannot enable minting without a deploy.
export const V12_MINT_COMPILED = false;

// POST /intent signs with the issuer key. This constant is the only switch.
// NODE_ENV and RECEIPT_V12_MINT cannot turn the route on.
export const INTENT_ISSUE_COMPILED = false;

export function intentIssueEnabled() {
  return INTENT_ISSUE_COMPILED === true;
}

export function v12MintEnabled(env = process.env) {
  if (!V12_MINT_COMPILED && String(env.NODE_ENV || '').trim() !== 'test') return false;
  if (isProductionIssuerEnv(env.NODE_ENV)) return false;
  return String(env.RECEIPT_V12_MINT || '').trim() === 'true';
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashExternalRef(token) {
  return sha256(String(token));
}

function party(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 128 || /\s/.test(text)) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(text)) return text.toLowerCase();
  return text;
}

function atomic(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value !== 'string' || !ATOMIC.test(value)) return null;
  return value;
}

function iso(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function hidden(status, error) {
  return { ok: false, status, error };
}

/**
 * @param {object} input
 * @param {number} [nowMs]
 */
export function buildIntentClaims(input, nowMs = Date.now()) {
  const payer = party(input.payer);
  const payee = party(input.payee);
  const maxAmount = atomic(input.max_amount);
  const expiry = iso(input.expiry);
  const useCount = input.use_count;
  if (!payer || !payee || !maxAmount || !expiry) return { ok: false, status: 400, error: 'invalid_intent' };
  if (typeof useCount !== 'number' || !Number.isInteger(useCount) || useCount < 1) {
    return { ok: false, status: 400, error: 'invalid_intent' };
  }
  const claims = {
    schema: INTENT_SCHEMA,
    intent_id: crypto.randomUUID(),
    payer,
    payee,
    asset: typeof input.asset === 'string' && input.asset ? input.asset : 'USDC',
    chain: typeof input.chain === 'string' && input.chain ? input.chain : 'eip155:8453',
    max_amount: maxAmount,
    expiry,
    use_count: useCount,
    iat: new Date(nowMs).toISOString(),
    iss: 'chit402',
    spec_digest: specDigest(),
    comparator_pin: comparatorPin(),
  };
  if (input.external_ref != null && input.external_ref !== '') {
    claims.external_ref_hash = hashExternalRef(input.external_ref);
  } else if (typeof input.external_ref_hash === 'string' && HEX64.test(input.external_ref_hash)) {
    claims.external_ref_hash = input.external_ref_hash;
  }
  for (const key of SIGNED_REQUIRED) {
    if (claims[key] == null) return { ok: false, status: 400, error: 'invalid_intent' };
  }
  return { ok: true, claims };
}

/**
 * Issue a signed intent. The raw external token and any merchant name are
 * not stored. The caller receives the JWS. Public GET does not.
 * @param {ReturnType<import('./intent-store.js').openIntentStore>} store
 * @param {object} input
 */
export function issueIntent(store, input) {
  if (input && (Object.prototype.hasOwnProperty.call(input, 'merchant')
    || Object.prototype.hasOwnProperty.call(input, 'merchant_name')
    || Object.prototype.hasOwnProperty.call(input, 'cap_row_hash'))) {
    return hidden(400, 'invalid_intent');
  }
  const built = buildIntentClaims(input);
  if (!built.ok) return built;
  const canonical = jcsRfc8785(built.claims);
  const hash = sha256(canonical);
  const { jws, kid } = signJws(built.claims, {
    typ: 'chit402-intent+jwt',
    payloadUtf8: canonical,
  });
  const record = {
    schema: INTENT_SCHEMA,
    intent_id: built.claims.intent_id,
    intent_hash: hash,
    claims: built.claims,
    issuer_signature: { alg: 'ES256', kid, jws },
  };
  try {
    store.putGrant({
      intentId: built.claims.intent_id,
      useCount: built.claims.use_count,
      record,
    });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) return hidden(409, 'intent_exists');
    throw err;
  }
  return { ok: true, status: 201, body: holderIntent(record) };
}

function holderIntent(record) {
  return {
    schema: INTENT_SCHEMA,
    intent_id: record.intent_id,
    intent_hash: record.intent_hash,
    claims: record.claims,
    issuer_signature: record.issuer_signature,
  };
}

/**
 * Public shell after a receipt exists. Amount, payee, merchant, and the
 * external token are not copied here. The receipt already signs the spend
 * amount and the payee. This shell adds only the hashes the receipt signs.
 * @param {object} record
 * @param {{ receiptId: string, useIndex: number }} link
 */
export function publicIntentShell(record, link) {
  return {
    schema: INTENT_SCHEMA,
    intent_id: record.intent_id,
    intent_hash: record.intent_hash,
    spec_digest: record.claims.spec_digest,
    comparator_pin: record.claims.comparator_pin,
    receipt_id: link.receiptId,
    use_index: link.useIndex,
  };
}

function signedHistoryEntryCount(doc) {
  const jws = doc?.issuer_signature?.jws;
  if (typeof jws !== 'string') return null;
  const part = jws.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number.isInteger(payload.entry_count) ? payload.entry_count : null;
  } catch {
    return null;
  }
}

/**
 * v12 pin. entry_count is the signed claim inside the history JWS. The
 * outer snapshot does not repeat it as a separate whole-document hash.
 */
export function v12HistoryPin(record = currentIssuerHistory()) {
  const doc = JSON.parse(record.body);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  if (typeof doc.head_hash !== 'string' || !HEX64.test(doc.head_hash)) {
    throw new Error('issuer history has no head_hash');
  }
  if (entries.length < 1 || entries[entries.length - 1]?.entry_hash !== doc.head_hash) {
    throw new Error('issuer history head_hash is not the last entry');
  }
  const signedCount = signedHistoryEntryCount(doc);
  if (signedCount == null || signedCount !== entries.length) {
    throw new Error('issuer history entry_count does not match entries');
  }
  return { head_hash: doc.head_hash, entry_count: signedCount };
}

function decodeIntent(record) {
  const jws = record?.issuer_signature?.jws;
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  const text = Buffer.from(parts[1], 'base64url').toString('utf8');
  let claims;
  try {
    claims = JSON.parse(text);
  } catch {
    return null;
  }
  if (sha256(text) !== record.intent_hash) return null;
  if (jcsRfc8785(claims) !== text) return null;
  return claims;
}

/**
 * Confirm a #520 payment. The request body does not supply the amount,
 * the payer, or the payee. Those come from the confirmed transfer.
 * @param {object} claims
 * @param {object} input
 * @param {{ settleBoundPayment?: Function, cfg?: object, store?: object }} [deps]
 */
async function confirmIntentPayment(claims, input, deps = {}) {
  const header = typeof input?.payment_header === 'string'
    ? input.payment_header
    : (typeof input?.paymentHeader === 'string' ? input.paymentHeader : '');
  const nonce = typeof input?.nonce === 'string' ? input.nonce : '';
  if (!header || !nonce) return hidden(402, 'challenge_required');
  if (!deps.cfg) return hidden(503, 'gateway_not_configured');
  const run = deps.settleBoundPayment || settleBoundPaymentDefault;
  const decision = await run({
    taskId: claims.intent_id,
    cfg: deps.cfg,
    amount: null,
    expectedPayer: claims.payer,
    payTo: claims.payee,
    paymentHeader: header,
    nonce,
    store: deps.store || null,
    deferBook: true,
  });
  if (!decision || decision.kind !== 'settled' || decision.confirmed !== true) {
    const code = decision?.code || decision?.reason || 'settle_unconfirmed';
    if (code === 'payer_mismatch' || code === 'challenge_mismatch') return hidden(409, 'intent_mismatch');
    if (code === 'payment_replayed') return hidden(409, 'payment_replayed');
    return hidden(402, 'intent_violation');
  }
  const release = () => { if (typeof decision.releaseClaim === 'function') decision.releaseClaim(); };
  // A transfer #520 already booked (idempotent replay) backs another receipt.
  // It never backs a v12 intent receipt.
  if (decision.replay === true) {
    release();
    return hidden(409, 'payment_replayed');
  }
  const amount = atomic(decision.settledAmount);
  const payer = party(decision.payerWallet);
  const payee = party(decision.payTo);
  const paymentRef = typeof decision.paymentRef === 'string' ? decision.paymentRef : '';
  if (!amount || !payer || !payee || !paymentRef) {
    release();
    return hidden(402, 'intent_violation');
  }
  if (payer !== claims.payer || payee !== claims.payee) {
    if (typeof decision.releaseClaim === 'function') decision.releaseClaim();
    return hidden(409, 'intent_mismatch');
  }
  if (BigInt(amount) > BigInt(claims.max_amount)) {
    if (typeof decision.releaseClaim === 'function') decision.releaseClaim();
    return hidden(409, 'intent_violation');
  }
  return {
    ok: true,
    amount,
    payer,
    payee,
    paymentRef,
    bookSpent: typeof decision.bookSpent === 'function' ? decision.bookSpent : () => {},
    releaseClaim: typeof decision.releaseClaim === 'function' ? decision.releaseClaim : () => {},
  };
}

/**
 * @param {ReturnType<import('./intent-store.js').openIntentStore>} store
 * @param {object} input
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ settleBoundPayment?: Function, cfg?: object, store?: object }} [deps]
 */
// One settle per intent at a time. The exhausted check, #520 booking and the
// use commit run under this lock, so the loser of the last use is refused
// before settleBoundPayment and never books a transfer without a receipt.
// We run a single instance today. A multi-instance deploy also needs the use
// reserved in the store before booking.
const settleLocks = new Map();
async function withIntentLock(key, fn) {
  const prev = settleLocks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => mine);
  settleLocks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (settleLocks.get(key) === tail) settleLocks.delete(key);
  }
}

export async function settleIntent(store, input, env = process.env, deps = {}) {
  if (!v12MintEnabled(env)) return hidden(403, 'v12_mint_disabled');
  const parsed = parseV12Uuid(input?.intent_id ?? input?.intentId);
  if (!parsed) return hidden(404, 'not_found');
  return withIntentLock(parsed.uuid, () => settleIntentLocked(store, input, env, deps, parsed));
}

async function settleIntentLocked(store, input, env, deps, parsed) {
  const grant = store.getGrant(parsed.uuid);
  if (!grant) return hidden(404, 'not_found');
  const claims = decodeIntent(grant.record);
  if (!claims || claims.intent_id !== parsed.uuid) return hidden(409, 'intent_mismatch');

  const issued = new Date().toISOString();
  if (Date.parse(issued) > Date.parse(claims.expiry)) return hidden(409, 'intent_violation');
  // Refuse an exhausted intent before #520 books the transfer. Booking runs
  // before the commit, so a late refusal would keep the payment with no receipt.
  if (!(Number(grant.usesRemaining) > 0)) return hidden(409, 'intent_violation');

  const payment = await confirmIntentPayment(claims, input, deps);
  if (!payment.ok) return payment;

  let pin;
  try {
    pin = v12HistoryPin();
  } catch {
    payment.releaseClaim();
    return hidden(500, 'internal');
  }

  try {
    payment.bookSpent();
  } catch (err) {
    // Book before the receipt commit. A failed book leaves no receipt and
    // does not take a use.
    logger.error({ intentId: parsed.uuid, paymentRef: payment.paymentRef, err: err?.message }, 'intent settle: #520 book failed before commit');
    payment.releaseClaim();
    return hidden(500, 'payment_book_failed');
  }

  let settled;
  try {
    settled = store.consumeAndRecord(parsed.uuid, (useIndex) => buildV12Receipt({
      claims,
      intentHash: grant.record.intent_hash,
      amount: payment.amount,
      payer: payment.payer,
      payee: payment.payee,
      paymentRef: payment.paymentRef,
      issued,
      useIndex,
      pin,
      kid: getIssuerKid(),
    }), { tx: payment.paymentRef, amount: payment.amount });
  } catch (err) {
    logger.error({ intentId: parsed.uuid, paymentRef: payment.paymentRef, reason: 'booked_unreceipted', err: err?.message }, 'intent settle: #520 booked the transfer but the receipt did not commit');
    return hidden(500, 'internal');
  }
  if (!settled.ok) {
    // The transfer is booked spent in #520 and no receipt exists. Ops refunds or reissues.
    logger.error({ intentId: parsed.uuid, paymentRef: payment.paymentRef, reason: 'booked_unreceipted', code: settled.reason || 'intent_violation' }, 'intent settle: #520 booked the transfer but the receipt did not commit');
    return hidden(409, settled.reason || 'intent_violation');
  }
  return {
    ok: true,
    status: 200,
    body: {
      intent_id: parsed.uuid,
      use_index: settled.useIndex,
      receipt: settled.receipt,
    },
  };
}

/**
 * One v12 receipt. The intent block is optional at the schema level; this
 * path includes it because a settle is a bound spend. cap_row_hash is not
 * written. The leaf body is not touched.
 */
export function buildV12Receipt({
  claims,
  intentHash: hash,
  amount,
  payer,
  payee,
  paymentRef,
  issued,
  useIndex,
  pin,
  kid,
}) {
  const taskId = `chit-${crypto.randomUUID()}`;
  const payload = {
    task_id: taskId,
    iss: 'chit402',
    iat: issued,
    payload_version: V12_PAYLOAD_VERSION,
    payment: {
      rail: 'usdc',
      asset: claims.asset,
      gross_amount: amount,
      payee,
      ref: paymentRef,
    },
    caller_binding: { payer_wallet: payer },
    tree_head_hash: null,
    tolerance: clockToleranceClaim(),
    issuer_history: { head_hash: pin.head_hash, entry_count: pin.entry_count },
    intent: {
      comparator_pin: claims.comparator_pin,
      intent_hash: hash,
      intent_id: claims.intent_id,
      spec_digest: claims.spec_digest,
      use_index: useIndex,
    },
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'cap_row_hash')) {
    throw new Error('cap_row_hash is not a v12 field');
  }
  const canonical = jcsRfc8785(payload);
  const { jws, kid: signedKid } = signJws(payload, {
    typ: 'chit402-receipt+jwt',
    payloadUtf8: canonical,
    kid,
  });
  return {
    task_id: taskId,
    iss: payload.iss,
    iat: payload.iat,
    payload_version: V12_PAYLOAD_VERSION,
    payment: payload.payment,
    caller_binding: payload.caller_binding,
    tree_head_hash: payload.tree_head_hash,
    tolerance: payload.tolerance,
    issuer_history: payload.issuer_history,
    intent: payload.intent,
    issuer_signature: {
      alg: 'ES256',
      kid: signedKid,
      jws,
      payload_version: V12_PAYLOAD_VERSION,
    },
  };
}

export function receiptHasDisallowedPlaintext(receipt, secrets) {
  const text = JSON.stringify(receipt);
  return secrets.some((secret) => secret && text.includes(secret));
}
