/**
 * Binds a refusal or v11 receipt to the client request that produced it.
 *
 * request_digest is SHA-256 of the RFC 8785 bytes of this object, with no
 * trailing newline. Every key is present. Absent idempotency_key and nonce
 * are null.
 *
 *   body_commitment   lowercase hex HMAC-SHA256(HKDF subkey "v11/body", raw body)
 *   idempotency_key   client Idempotency-Key, or null
 *   method            uppercase HTTP method
 *   nonce             client nonce, or null
 *   path              request path, beginning with /
 *
 * The body is not in the preimage. Neither is the salt, and neither is an
 * unsalted SHA-256 of the body. A stranger who guesses the prompt cannot
 * confirm it from the public preimage. The salt is 32 bytes, disclosed only
 * to the principal (response header X-Chit-Request-Salt, Cache-Control
 * private, no-store). It is not a JWS claim and not a field of request_preimage.
 *
 * Every salt read and write goes through SaltStore. The salt is not an
 * enumerable property of the request. Idempotency remembers the receipt id
 * and the digest, scoped by payer, and does not remember the salt.
 *
 * Already-signed documents keep the preimage they were signed with. Verifiers
 * hash that published text. This module does not rebuild or re-sign them.
 * A caller-supplied body_sha256 is ignored so it cannot be published.
 *
 * A session intent_id is a separate signed field, not part of this object.
 */
import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';
import { getSaltStore } from './salt-store.js';
import { hkdfSubkey, commitHmac, V11_LABEL_BODY } from './v11-seal.js';

const SALT_RE = /^[0-9a-f]{64}$/;
const SALT_ID = Symbol('chit402.saltReceiptId');

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function bodyBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(JSON.stringify(body), 'utf8');
}

function bindingError(message) {
  const err = new Error(message);
  err.code = 'request_unbound';
  return err;
}

function principalOf(request) {
  if (!request || typeof request !== 'object') return '';
  const payer = request.payer || request.payer_wallet || request.principal || '';
  return payer == null ? '' : String(payer);
}

function slotKey(principal, key) {
  return `${principal}\0${String(key)}`;
}

/**
 * Receipt id whose SaltStore row holds this holder's salt.
 * @param {object} holder
 * @returns {string|null}
 */
export function saltReceiptId(holder) {
  if (!holder || typeof holder !== 'object') return null;
  const id = holder[SALT_ID];
  return typeof id === 'string' && id ? id : null;
}

/**
 * @param {object} holder
 * @param {string} receiptId
 */
export function bindSaltReceipt(holder, receiptId) {
  if (!holder || typeof holder !== 'object' || !receiptId) return;
  Object.defineProperty(holder, SALT_ID, {
    value: String(receiptId),
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

function newReceiptId() {
  return `salt-${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * True when the store still has this request's salt. Does not mint one.
 * @param {object} request
 */
export function saltRecoverable(request) {
  if (!request || typeof request !== 'object') return false;
  if (typeof request.salt === 'string' && SALT_RE.test(request.salt)) return true;
  const direct = saltReceiptId(request);
  if (direct && getSaltStore().get(direct)) return true;
  const key = request.idempotency_key;
  if (key != null && key !== '') {
    const prev = idempotency.get(slotKey(principalOf(request), key));
    if (prev?.receiptId && getSaltStore().get(prev.receiptId)) return true;
  }
  return false;
}

/**
 * Salt already chosen for this request, from SaltStore only.
 * An enumerable `request.salt` is not read back after ensureRequestSalt.
 * @param {object} request
 * @returns {string|null}
 */
export function requestSalt(request) {
  if (!request || typeof request !== 'object') return null;
  const id = saltReceiptId(request);
  if (id) {
    const got = getSaltStore().get(id);
    if (got) return got.toString('hex');
  }
  const key = request.idempotency_key;
  if (key != null && key !== '') {
    const prev = idempotency.get(slotKey(principalOf(request), key));
    if (prev?.receiptId) {
      const got = getSaltStore().get(prev.receiptId);
      if (got) return got.toString('hex');
    }
  }
  return null;
}

/**
 * One salt per request object. A replay of the same payer and idempotency
 * key reuses the SaltStore row from the first claim. Does not set an
 * enumerable `request.salt`. When the store no longer has the salt (process
 * restart), returns null and does not mint a replacement.
 * @param {object} request
 * @returns {string|null}
 */
export function ensureRequestSalt(request) {
  if (!request || typeof request !== 'object') throw bindingError('request_digest needs a request object');
  const pinned = typeof request.salt === 'string' && SALT_RE.test(request.salt) ? request.salt : null;
  if (Object.prototype.hasOwnProperty.call(request, 'salt')) delete request.salt;
  if (pinned) {
    const id = saltReceiptId(request) || newReceiptId();
    getSaltStore().put(id, Buffer.from(pinned, 'hex'));
    bindSaltReceipt(request, id);
    return pinned;
  }
  const existing = requestSalt(request);
  if (existing) {
    const id = saltReceiptId(request) || idempotency.get(slotKey(principalOf(request), request.idempotency_key || ''))?.receiptId;
    if (id) bindSaltReceipt(request, id);
    return existing;
  }
  const key = request.idempotency_key;
  if (key != null && key !== '') {
    const prev = idempotency.get(slotKey(principalOf(request), key));
    if (prev?.receiptId) {
      bindSaltReceipt(request, prev.receiptId);
      const got = getSaltStore().get(prev.receiptId);
      if (got) return got.toString('hex');
      return null;
    }
  }
  const salt = crypto.randomBytes(32);
  const id = saltReceiptId(request) || newReceiptId();
  getSaltStore().put(id, salt);
  bindSaltReceipt(request, id);
  return salt.toString('hex');
}

/**
 * Move this holder's salt onto `receiptId` so the public id and the store key match.
 * @param {object} holder
 * @param {string} receiptId
 */
export function rebindRequestSalt(holder, receiptId) {
  const salt = requestSalt(holder);
  if (!salt || !receiptId) return null;
  const next = String(receiptId);
  const prev = saltReceiptId(holder);
  getSaltStore().put(next, Buffer.from(salt, 'hex'));
  if (prev && prev !== next) getSaltStore().delete(prev);
  for (const slot of idempotency.values()) {
    if (prev && slot.receiptId === prev) slot.receiptId = next;
  }
  bindSaltReceipt(holder, next);
  if (Object.prototype.hasOwnProperty.call(holder, 'salt')) delete holder.salt;
  return salt;
}

/**
 * Pin a salt on `holder` under `receiptId`. Deletes any enumerable salt field.
 * @param {object} holder
 * @param {string} saltHex
 * @param {string} [receiptId]
 */
export function adoptSalt(holder, saltHex, receiptId) {
  if (!SALT_RE.test(String(saltHex || ''))) throw bindingError('request salt is not 32 bytes');
  const id = receiptId || saltReceiptId(holder) || newReceiptId();
  getSaltStore().put(id, Buffer.from(saltHex, 'hex'));
  if (holder && typeof holder === 'object') {
    bindSaltReceipt(holder, id);
    if (Object.prototype.hasOwnProperty.call(holder, 'salt')) delete holder.salt;
  }
  return id;
}

/**
 * Remember a salt receipt id on `target` without adding an enumerable field.
 * @param {object} target
 * @param {object|string|null} source
 */
export function bindRequestSalt(target, source) {
  if (typeof source === 'string' && SALT_RE.test(source)) {
    return adoptSalt(target, source);
  }
  const id = saltReceiptId(source) || (source && typeof source === 'object' ? saltReceiptId(source.request) : null);
  const salt = requestSalt(source) || (source && typeof source === 'object' ? requestSalt(source.request) : null);
  if (target && typeof target === 'object' && id && salt) {
    getSaltStore().put(id, Buffer.from(salt, 'hex'));
    bindSaltReceipt(target, id);
  }
  return salt || null;
}

/**
 * Disclose the salt to the principal who just received this response.
 * Sets Cache-Control: private, no-store. Public GET of the receipt does not call this.
 * @param {object} res
 * @param {...object} holders
 */
export function applyRequestSaltHeader(res, ...holders) {
  if (!res || typeof res.setHeader !== 'function') return;
  for (const holder of holders) {
    if (!holder || typeof holder !== 'object') continue;
    const salt = requestSalt(holder)
      || (holder.receipt_id ? saltFromId(holder.receipt_id) : null)
      || (holder.refusal_id ? saltFromId(holder.refusal_id) : null)
      || requestSalt(holder.request)
      || requestSalt(holder.refusal);
    if (!salt) continue;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Chit-Request-Salt', salt);
    return;
  }
}

function saltFromId(id) {
  const got = getSaltStore().get(String(id));
  return got ? got.toString('hex') : null;
}

/**
 * HMAC-SHA256(HKDF subkey v11/body, raw body). Lowercase hex.
 * Does not lowercase or otherwise normalize the salt.
 * @param {string} saltHex
 * @param {Buffer|string|object|null} body
 */
export function bodyCommitmentHex(saltHex, body) {
  const salt = String(saltHex || '');
  if (!SALT_RE.test(salt)) throw bindingError('request salt is not 32 bytes');
  const sub = hkdfSubkey(Buffer.from(salt, 'hex'), V11_LABEL_BODY);
  return commitHmac(sub, bodyBytes(body));
}

/**
 * @param {object} request
 * @returns {{ body_commitment: string, idempotency_key: string|null, method: string, nonce: string|null, path: string }}
 */
export function requestDigestPreimage(request = {}) {
  const method = String(request.method || '').trim().toUpperCase();
  const path = String(request.path || '').trim();
  if (!method || !path.startsWith('/')) throw bindingError('request_digest needs an HTTP method and a path');
  if (request.body == null && request.rawBody == null) {
    throw bindingError('request_digest needs the raw request body');
  }
  const salt = ensureRequestSalt(request);
  if (!salt) throw bindingError('request salt is gone');
  const commitment = bodyCommitmentHex(salt, request.rawBody != null ? request.rawBody : request.body);
  if (!/^[0-9a-f]{64}$/.test(commitment)) throw bindingError('request body commitment is not hmac-sha256');
  const idem = request.idempotency_key == null || request.idempotency_key === ''
    ? null
    : String(request.idempotency_key);
  const nonce = request.nonce == null || request.nonce === '' ? null : String(request.nonce);
  return {
    body_commitment: commitment,
    idempotency_key: idem,
    method,
    nonce,
    path,
  };
}

/** RFC 8785 text hashed into request_digest. */
export function requestDigestCanonical(request) {
  return jcsRfc8785(requestDigestPreimage(request));
}

/** Lowercase hex SHA-256 of {@link requestDigestCanonical}. */
export function requestDigest(request) {
  return sha256Hex(Buffer.from(requestDigestCanonical(request), 'utf8'));
}

/** Hash the published preimage bytes. Does not parse or rewrite them. */
export function requestDigestOfPreimage(preimageUtf8) {
  if (typeof preimageUtf8 !== 'string' || preimageUtf8 === '') return null;
  return sha256Hex(Buffer.from(preimageUtf8, 'utf8'));
}

const BINDING_HTTP_CODES = new Set(['idempotency_conflict', 'intent_id_required', 'request_unbound']);

/** True for the three request-binding failures the HTTP layer must not swallow. */
export function isRequestBindingError(err) {
  return !!err && BINDING_HTTP_CODES.has(err.code);
}

/**
 * Keep the exact bytes express parsed, so the body commitment is the wire body.
 * JSON.stringify of the parsed object drops trailing whitespace.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {Buffer} buf
 */
export function captureRawRequestBody(req, _res, buf) {
  req.rawBody = Buffer.from(buf);
}

/**
 * The client request a refusal binds. `body` is the raw bytes when the
 * JSON parser captured them.
 * @param {object} req
 * @param {string} path
 */
export function clientRequestForRefusal(req, path) {
  const headers = req?.headers || {};
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const idem = headers['idempotency-key'] || headers['x-idempotency-key'] || body.idempotency_key || null;
  const nonce = headers['x-xfuel-nonce'] || (body.nonce != null && body.nonce !== '' ? body.nonce : null);
  const intent = headers['x-xfuel-intent'] || body.intent_id || body.intent || null;
  const sessionPayer = req?.session?.payer_wallet || req?.boundSession?.payer_wallet || null;
  const payer = sessionPayer || null;
  return {
    method: req?.method || 'POST',
    path: path && String(path).startsWith('/') ? String(path) : '/v1/chat/completions',
    body: req?.rawBody != null ? req.rawBody : JSON.stringify(req?.body ?? {}),
    idempotency_key: idem ? String(idem) : null,
    nonce: nonce != null ? String(nonce) : null,
    intent_id: intent ? String(intent).trim() : null,
    intent_supplied: !!(intent && String(intent).trim()),
    ...(payer ? { payer: String(payer) } : {}),
  };
}

export function requestDigestMatches(digest, preimageUtf8) {
  const got = requestDigestOfPreimage(preimageUtf8);
  return typeof digest === 'string' && got === digest;
}

const idempotency = new Map();

export function resetIdempotencyStore() {
  idempotency.clear();
}

/**
 * Same payer, same idempotency key, and same digest may proceed.
 * A different digest throws and does not return the earlier refusal or receipt.
 * The slot stores the receipt id, not the salt. A different principal is a different slot.
 * The third argument may be a salt hex (legacy callers) or
 * `{ principal, receiptId }`. A salt hex is resolved to a receipt id and not stored.
 * @param {string|null|undefined} key
 * @param {string} digest
 * @param {string|{ principal?: string, receiptId?: string|null }|null} [saltOrOpts]
 */
export function claimIdempotency(key, digest, saltOrOpts = null) {
  if (key == null || key === '') return { replay: false };
  let principal = '';
  let receiptId = null;
  if (saltOrOpts && typeof saltOrOpts === 'object') {
    principal = saltOrOpts.principal ? String(saltOrOpts.principal) : '';
    receiptId = saltOrOpts.receiptId || null;
  } else if (typeof saltOrOpts === 'string' && SALT_RE.test(saltOrOpts)) {
    receiptId = getSaltStore().receiptIdForSalt(saltOrOpts);
  }
  const id = slotKey(principal, key);
  const prev = idempotency.get(id);
  if (!prev) {
    idempotency.set(id, { digest, principal, receiptId });
    return { replay: false, receiptId };
  }
  if (prev.digest !== digest) {
    const err = new Error('idempotency key was already used for a different request');
    err.code = 'idempotency_conflict';
    throw err;
  }
  if (receiptId && !prev.receiptId) prev.receiptId = receiptId;
  return { replay: true, receiptId: prev.receiptId || receiptId };
}

/**
 * A stored refusal does not answer a different request.
 * When the salt is gone, the digest is not recomputed and the stored
 * refusal still matches: a restart must not turn into idempotency_conflict.
 * @param {{ request_digest?: string }|null|undefined} refusal
 * @param {object} request
 */
export function refusalMatchesRequest(refusal, request) {
  if (!refusal || typeof refusal.request_digest !== 'string') return false;
  if (!saltRecoverable(request)) return true;
  try {
    return refusal.request_digest === requestDigest(request);
  } catch (err) {
    if (err?.code === 'request_unbound') return true;
    throw err;
  }
}
