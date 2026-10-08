/**
 * Binds a refusal or v11 receipt to the client request that produced it.
 *
 * request_digest is SHA-256 of the RFC 8785 bytes of this object, with no
 * trailing newline. Every key is present. Absent idempotency_key and nonce
 * are null.
 *
 *   body_commitment   lowercase hex HMAC-SHA256(salt, raw body bytes)
 *   idempotency_key   client Idempotency-Key, or null
 *   method            uppercase HTTP method
 *   nonce             client nonce, or null
 *   path              request path, beginning with /
 *
 * The body is not in the preimage. Neither is the salt, and neither is an
 * unsalted SHA-256 of the body. A stranger who guesses the prompt cannot
 * confirm it from the public preimage. The salt is 32 bytes, disclosed only
 * to the principal (response header X-Chit-Request-Salt). It is not a JWS
 * claim and not a field of request_preimage.
 *
 * Already-signed documents keep the preimage they were signed with. Verifiers
 * hash that published text. This module does not rebuild or re-sign them.
 * A caller-supplied body_sha256 is ignored so it cannot be published.
 *
 * A session intent_id is a separate signed field, not part of this object.
 */
import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';

const SALT_RE = /^[0-9a-f]{64}$/;
const salts = new WeakMap();

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function bodyBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

function bindingError(message) {
  const err = new Error(message);
  err.code = 'request_unbound';
  return err;
}

/**
 * Salt already chosen for this request object, or a caller-pinned salt.
 * Not copied onto public receipts.
 * @param {object} request
 * @returns {string|null}
 */
export function requestSalt(request) {
  if (!request || typeof request !== 'object') return null;
  const cached = salts.get(request);
  if (cached) return cached;
  const raw = request.salt;
  if (typeof raw === 'string' && SALT_RE.test(raw)) return raw;
  return null;
}

/**
 * One salt per request object. A replay of the same idempotency key reuses
 * the salt from the first claim so the digest stays stable. Mutates `request`
 * so a second requestDigest(sameObject) matches the first.
 * @param {object} request
 * @returns {string}
 */
export function ensureRequestSalt(request) {
  if (!request || typeof request !== 'object') throw bindingError('request_digest needs a request object');
  const existing = requestSalt(request);
  if (existing) {
    salts.set(request, existing);
    if (request.salt !== existing) request.salt = existing;
    return existing;
  }
  const key = request.idempotency_key;
  if (key != null && key !== '') {
    const prev = idempotency.get(String(key));
    if (prev?.salt && SALT_RE.test(prev.salt)) {
      request.salt = prev.salt;
      salts.set(request, prev.salt);
      return prev.salt;
    }
  }
  const salt = crypto.randomBytes(32).toString('hex');
  request.salt = salt;
  salts.set(request, salt);
  return salt;
}

/**
 * Remember a salt on `target` without adding an enumerable field.
 * Public JSON.stringify of a receipt must not show it.
 * @param {object} target
 * @param {object|string|null} source
 */
export function bindRequestSalt(target, source) {
  const salt = typeof source === 'string' && SALT_RE.test(source) ? source : requestSalt(source);
  if (target && typeof target === 'object' && salt) salts.set(target, salt);
  return salt || null;
}

/**
 * Disclose the salt to the principal who just received this response.
 * Public GET of the receipt does not call this.
 * @param {object} res
 * @param {...object} holders
 */
export function applyRequestSaltHeader(res, ...holders) {
  if (!res || typeof res.setHeader !== 'function') return;
  for (const holder of holders) {
    if (!holder || typeof holder !== 'object') continue;
    const salt = requestSalt(holder) || requestSalt(holder.request) || requestSalt(holder.refusal);
    if (!salt) continue;
    res.setHeader('X-Chit-Request-Salt', salt);
    return;
  }
}

/**
 * HMAC-SHA256(key = 32-byte salt, message = raw body). Lowercase hex.
 * @param {string} saltHex
 * @param {Buffer|string|object|null} body
 */
export function bodyCommitmentHex(saltHex, body) {
  const salt = String(saltHex || '').trim().toLowerCase();
  if (!SALT_RE.test(salt)) throw bindingError('request salt is not 32 bytes');
  return crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(bodyBytes(body)).digest('hex');
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
  return {
    method: req?.method || 'POST',
    path: path && String(path).startsWith('/') ? String(path) : '/v1/chat/completions',
    body: req?.rawBody != null ? req.rawBody : JSON.stringify(req?.body ?? {}),
    idempotency_key: idem ? String(idem) : null,
    nonce: nonce != null ? String(nonce) : null,
    intent_id: intent ? String(intent).trim() : null,
    intent_supplied: !!(intent && String(intent).trim()),
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
 * Same idempotency key and same digest may proceed. A different digest
 * throws and does not return the earlier refusal or receipt.
 * @param {string|null|undefined} key
 * @param {string} digest
 */
export function claimIdempotency(key, digest, salt = null) {
  if (key == null || key === '') return { replay: false };
  const id = String(key);
  const prev = idempotency.get(id);
  const storedSalt = typeof salt === 'string' && SALT_RE.test(salt) ? salt : null;
  if (!prev) {
    idempotency.set(id, { digest, salt: storedSalt });
    return { replay: false };
  }
  if (prev.digest !== digest) {
    const err = new Error('idempotency key was already used for a different request');
    err.code = 'idempotency_conflict';
    throw err;
  }
  return { replay: true };
}

/**
 * A stored refusal does not answer a different request.
 * @param {{ request_digest?: string }|null|undefined} refusal
 * @param {object} request
 */
export function refusalMatchesRequest(refusal, request) {
  if (!refusal || typeof refusal.request_digest !== 'string') return false;
  return refusal.request_digest === requestDigest(request);
}
