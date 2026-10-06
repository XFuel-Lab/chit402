/**
 * Binds a refusal or v11 receipt to the client request that produced it.
 *
 * request_digest is SHA-256 of the RFC 8785 bytes of this object, with no
 * trailing newline. Every key is present. Absent idempotency_key and nonce
 * are null.
 *
 *   body_sha256       lowercase hex SHA-256 of the raw request body bytes
 *   idempotency_key   client Idempotency-Key, or null
 *   method            uppercase HTTP method
 *   nonce             client nonce, or null
 *   path              request path, beginning with /
 *
 * The body itself is not in the preimage. body_sha256 is. A session intent_id
 * is a separate signed field, not part of this object.
 */
import crypto from 'crypto';
import { jcsRfc8785 } from './offer-receipt.js';

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function bodyBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

/**
 * @param {object} request
 * @returns {{ body_sha256: string, idempotency_key: string|null, method: string, nonce: string|null, path: string }}
 */
export function requestDigestPreimage(request = {}) {
  const method = String(request.method || '').trim().toUpperCase();
  const path = String(request.path || '').trim();
  if (!method || !path.startsWith('/')) {
    const err = new Error('request_digest needs an HTTP method and a path');
    err.code = 'request_unbound';
    throw err;
  }
  const bodySha = request.body_sha256
    ? String(request.body_sha256).trim().toLowerCase().replace(/^0x/, '')
    : sha256Hex(bodyBytes(request.body));
  if (!/^[0-9a-f]{64}$/.test(bodySha)) {
    const err = new Error('request body hash is not sha-256');
    err.code = 'request_unbound';
    throw err;
  }
  const idem = request.idempotency_key == null || request.idempotency_key === ''
    ? null
    : String(request.idempotency_key);
  const nonce = request.nonce == null || request.nonce === '' ? null : String(request.nonce);
  return {
    body_sha256: bodySha,
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
export function claimIdempotency(key, digest) {
  if (key == null || key === '') return { replay: false };
  const id = String(key);
  const prev = idempotency.get(id);
  if (!prev) {
    idempotency.set(id, { digest });
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
