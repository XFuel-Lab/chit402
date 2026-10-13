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
import crypto from 'node:crypto';
import { jcsRfc8785 } from './offer-receipt.js';
import { signJws, getIssuerKid, isProductionIssuerEnv } from './issuer-key.js';
import { currentIssuerHistory } from './issuer-history.js';
import { clockToleranceClaim } from './receipt-anchor-clock.js';

export const INTENT_SCHEMA = 'chit402.intent.v1';
export const V12_PAYLOAD_VERSION = 12;

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

export function v12MintEnabled(env = process.env) {
  if (isProductionIssuerEnv(env.NODE_ENV)) return false;
  return String(env.RECEIPT_V12_MINT || '').trim() === 'true';
}

export function comparatorPin() {
  return sha256(jcsRfc8785(SPEND_COMPARATOR));
}

export function specDigest() {
  return sha256(jcsRfc8785(INTENT_PROJECTION_SPEC));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Hash of the signed intent object only. Unsigned wrappers are not included.
 * @param {object} claims
 */
export function intentHash(claims) {
  return sha256(jcsRfc8785(claims));
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
 * @param {ReturnType<import('./intent-store.js').openIntentStore>} store
 * @param {object} input
 * @param {NodeJS.ProcessEnv} [env]
 */
export function settleIntent(store, input, env = process.env) {
  if (!v12MintEnabled(env)) return hidden(403, 'v12_mint_disabled');
  const parsed = parseV12Uuid(input?.intent_id ?? input?.intentId);
  if (!parsed) return hidden(404, 'not_found');
  const grant = store.getGrant(parsed.uuid);
  if (!grant) return hidden(404, 'not_found');
  const claims = decodeIntent(grant.record);
  if (!claims || claims.intent_id !== parsed.uuid) return hidden(409, 'intent_mismatch');

  const payer = party(input.payer);
  const payee = party(input.payee);
  const amount = atomic(input.amount);
  if (!payer || !payee || payer !== claims.payer || payee !== claims.payee) {
    return hidden(409, 'intent_mismatch');
  }
  if (!amount) return hidden(409, 'intent_violation');
  if (BigInt(amount) > BigInt(claims.max_amount)) return hidden(409, 'intent_violation');
  const nowMs = typeof input.now_ms === 'number' ? input.now_ms : Date.now();
  const issued = new Date(nowMs).toISOString();
  if (Date.parse(issued) > Date.parse(claims.expiry)) return hidden(409, 'intent_violation');

  let pin;
  try {
    pin = input.history_pin || v12HistoryPin();
  } catch {
    return hidden(500, 'internal');
  }

  let settled;
  try {
    settled = store.consumeAndRecord(parsed.uuid, (useIndex) => buildV12Receipt({
      claims,
      intentHash: grant.record.intent_hash,
      amount,
      payer,
      payee,
      issued,
      useIndex,
      pin,
      kid: getIssuerKid(),
    }));
  } catch {
    return hidden(500, 'internal');
  }
  if (!settled.ok) return hidden(409, 'intent_violation');
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
