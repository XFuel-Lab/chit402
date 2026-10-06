/**
 * Stored canonical object for a receipt or refusal.
 *
 * The preimage is the exact UTF-8 JCS (RFC 8785) bytes of the public claims,
 * without `payload_hash`. SHA-256 of those bytes is `payload_hash`, and that
 * digest is inside the signed JWS. The bytes are kept at issuance and served
 * unchanged. A read path must not rebuild them from the receipt.
 *
 * Field set is the allowlist below. Wire order is JCS: object keys sorted by
 * UTF-16 code unit, no insignificant whitespace. The same canonicalization
 * issuer-history entry hashes already use.
 *
 * Private inputs stay out: prompts, output text, API keys, private JWKs,
 * weight shards, and book-row bodies. Hashes of those inputs may appear.
 * That is the same exclusion as the per-field preimage block.
 */
import crypto from 'crypto';
import { jcsCanonicalize } from './offer-receipt.js';

/**
 * New payment receipts while ISSUER_ROOT_ENABLED is off. v9 head binding
 * still verifies. v11 is selected at sign time when the issuer root is on;
 * this constant stays 10 so a disabled process keeps today's payload.
 */
export const CANONICAL_PAYLOAD_VERSION = 10;

export const CANONICAL_HASH_ALG = 'sha256';
export const CANONICAL_ENCODING = 'jcs-rfc8785';

/**
 * Signed into payload v11 (and issuer-root refusals). The envelope and
 * response headers already name the algorithm; this is the copy inside the
 * JWS. string_escaping is what jcsCanonicalize actually does.
 */
export const V11_CANONICALIZATION = Object.freeze({
  hash_alg: 'sha-256',
  jcs: 'RFC8785',
  string_escaping: 'UTF-8, no trailing newline. Object keys sorted by UTF-16 code unit. U+0000 through U+001F escaped as \\u00xx lowercase hex. U+0022 escaped as \\". U+005C escaped as \\\\. Other code units copied. Solidus is not escaped.',
});

/**
 * Keys allowed in a payment-receipt canonical object.
 * `payload_hash` is not in this list: it is the hash of the object.
 * `openrouter` is included only when the claim is present.
 */
export const RECEIPT_CANONICAL_FIELDS = Object.freeze([
  'action',
  'agent_pubkey',
  'binding',
  'caller_binding',
  'canonicalization',
  'claim_id',
  'delegation_hash',
  'dispute_window',
  'fulfillment',
  'iat',
  'iss',
  'issuance_commitment',
  'issuer_history',
  'issuer_history_snapshot',
  'issuer_root',
  'kind',
  'openrouter',
  'output',
  'parent_receipt_id',
  'payload_version',
  'payment',
  'provider_cogs',
  'route',
  'session',
  'session_act',
  'session_expiry',
  'settlement',
  'target_agent',
  'task_id',
  'tolerance',
  'tree_head_hash',
]);

/** Keys allowed in a refusal canonical object. `payload_hash` is excluded. */
export const REFUSAL_CANONICAL_FIELDS = Object.freeze([
  'agent_id',
  'amount_charged',
  'amount_requested',
  'anchor',
  'asset',
  'attempt_index',
  'book_id',
  'book_row',
  'cap_atomic',
  'canonicalization',
  'chain_id',
  'charged',
  'hub',
  'intent_id',
  'issued_at',
  'issuer_history',
  'issuer_history_snapshot',
  'issuer_root',
  'kind',
  'model',
  'nonce',
  'payload_version',
  'period_start',
  'policy_key',
  'reason',
  'refusal_code',
  'refusal_id',
  'schema',
  'spent_atomic',
  'task_id',
]);

/** Extra keys a foreign-payout JWS adds on top of the receipt allowlist. */
export const FOREIGN_CANONICAL_FIELDS = Object.freeze([
  ...RECEIPT_CANONICAL_FIELDS,
  'agent_record_entry',
  'amount',
  'chain',
  'payee',
  'payer',
  'payment_ref',
  'schema',
  'tx',
]);

const PRIVATE_KEYS = new Set([
  'prompt',
  'prompts',
  'messages',
  'completion',
  'output_text',
  'api_key',
  'apikey',
  'secret',
  'private_key',
  'privatekey',
  'seed',
  'deliverable',
]);

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {unknown} value
 * @param {string} [path]
 */
export function assertPublicCanonical(value, path = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicCanonical(item, `${path}[${index}]`));
    return;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (obj.kty && obj.d) {
    throw new Error(`canonical object contains a private JWK at ${path || 'root'}`);
  }
  for (const [key, child] of Object.entries(obj)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) {
      throw new Error(`canonical object contains private field ${path}${key}`);
    }
    assertPublicCanonical(child, `${path}${key}.`);
  }
}

/**
 * Copy allowlisted keys. A key that is not allowlisted throws, so a new
 * signed field cannot land in the hash until the list is updated.
 * Absent keys are omitted. `payload_hash` is never copied.
 * @param {object} claims
 * @param {readonly string[]} allowed
 */
export function lockCanonicalFields(claims, allowed) {
  if (!claims || typeof claims !== 'object') {
    throw new Error('canonical object is not an object');
  }
  const allow = new Set(allowed);
  const extra = Object.keys(claims).filter((key) => key !== 'payload_hash' && !allow.has(key));
  if (extra.length) {
    throw new Error(`canonical object has unlocked fields: ${extra.sort().join(',')}`);
  }
  const body = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(claims, key) && claims[key] !== undefined) {
      body[key] = claims[key];
    }
  }
  assertPublicCanonical(body);
  return body;
}

/**
 * JCS bytes and the SHA-256 that the JWS will carry as `payload_hash`.
 * @param {object} claims claims without a trusted payload_hash
 * @param {readonly string[]} allowed
 */
export function sealCanonicalObject(claims, allowed) {
  const body = lockCanonicalFields(claims, allowed);
  const preimage = jcsCanonicalize(body);
  const payload_hash = sha256Hex(preimage);
  return {
    preimage,
    payload_hash,
    hash_alg: CANONICAL_HASH_ALG,
    encoding: CANONICAL_ENCODING,
    claims: { ...body, payload_hash },
  };
}

/**
 * Re-hash claims that already carry `payload_hash` (tree-head restamp).
 * The allowlist is the keys already signed, minus the hash.
 * @param {object} claims
 */
export function resealSignedClaims(claims) {
  if (!claims || typeof claims !== 'object') throw new Error('canonical object is not an object');
  const { payload_hash: _drop, ...body } = claims;
  return sealCanonicalObject(body, Object.keys(body));
}

/**
 * Stored bytes, or null when this document was issued without them.
 * Does not decode the JWS and does not canonicalize again.
 * @param {object|null|undefined} source receipt, refusal, or issuer_signature
 * @returns {{ bytes: string, hash: string, alg: string, encoding: string } | { corrupt: true } | null}
 */
export function storedCanonicalPreimage(source) {
  if (!source || typeof source !== 'object') return null;
  const sig = source.issuer_signature && typeof source.issuer_signature === 'object'
    ? source.issuer_signature
    : source;
  const text = typeof sig.canonical_preimage === 'string'
    ? sig.canonical_preimage
    : (typeof source.canonical_preimage === 'string' ? source.canonical_preimage : null);
  if (text == null) return null;
  const hash = sha256Hex(text);
  const stamped = sig.payload_hash || source.payload_hash || null;
  if (stamped && stamped !== hash) return { corrupt: true };
  return {
    bytes: text,
    hash,
    alg: sig.hash_alg || CANONICAL_HASH_ALG,
    encoding: CANONICAL_ENCODING,
  };
}

/**
 * Write the stored bytes. `?meta=1` describes the algorithm without the body.
 * The default body is the stored canonical object, so SHA-256 of the body
 * equals `payload_hash`.
 * @param {import('express').Response} res
 * @param {object|null|undefined} source
 * @param {{ meta?: unknown }} [query]
 */
export function writeCanonicalPreimage(res, source, query = {}) {
  const stored = storedCanonicalPreimage(source);
  if (!stored) {
    return res.status(404).json({
      error: 'preimage_unavailable',
      reason: 'The canonical object was not stored with this document. It is not rebuilt at read time.',
    });
  }
  if (stored.corrupt) {
    return res.status(404).json({
      error: 'preimage_unavailable',
      reason: 'The stored canonical object does not match its payload hash.',
    });
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.set('X-Chit-Hash-Alg', stored.alg);
  res.set('X-Chit-Payload-Hash', stored.hash);
  res.set('X-Chit-Canonicalization', stored.encoding);
  if (String(query.meta || '') === '1') {
    return res.json({
      alg: stored.alg,
      encoding: stored.encoding,
      hash: stored.hash,
      canonicalization: 'JCS (RFC 8785), UTF-8, no trailing newline. Object keys are sorted by UTF-16 code unit.',
      note: 'The response without meta=1 is the stored canonical object. SHA-256 of those exact bytes is hash, which is payload_hash inside the JWS.',
    });
  }
  res.type('application/json; charset=utf-8');
  return res.send(Buffer.from(stored.bytes, 'utf8'));
}

/**
 * Unsigned pointer on the preimages block. The bytes themselves stay on the
 * stored signature and at GET /preimage.
 * @param {object|null|undefined} receipt
 */
export function canonicalObjectDescriptor(receipt) {
  const stored = storedCanonicalPreimage(receipt);
  if (!stored || stored.corrupt) {
    return {
      available: false,
      alg: CANONICAL_HASH_ALG,
      encoding: CANONICAL_ENCODING,
      reason: stored?.corrupt
        ? 'The stored canonical object does not match its payload hash.'
        : 'The canonical object was not stored with this document. It is not rebuilt at read time.',
    };
  }
  return {
    available: true,
    alg: stored.alg,
    encoding: stored.encoding,
    hash: stored.hash,
    rule: 'SHA-256 of the stored UTF-8 JCS bytes. payload_hash inside the JWS is that digest. The GET /preimage body is those bytes.',
  };
}
