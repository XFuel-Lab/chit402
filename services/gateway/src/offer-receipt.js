/**
 * x402 Offer and Receipt extension (specs/extensions/extension-offer-and-receipt.md), JWS format.
 *
 * Spec: x402-foundation/x402 @ 6b6ee91, extension version 0.6. JWS only — the existing
 * ES256 issuer key signs both artifacts. EIP-712 is not used (it cannot cover the Solana
 * accepts[] entry without a secp256k1 payTo key).
 *
 * Signer authorization is did:web on the resourceUrl host:
 *   kid = did:web:<host>#<jwk-thumbprint>
 * served at GET /.well-known/did.json. Payloads are JCS (RFC 8785) before signing.
 * This module does not replace the chit402 receipt JWS (xfuel.receipt.v4 / JWKS).
 */
import { signJws, getIssuerPublicKeyJwk, getIssuerKid } from './issuer-key.js';

export const OFFER_RECEIPT_KEY = 'offer-receipt';

/**
 * chit402-jcs-v1. Objects, arrays, strings, finite numbers, booleans, null.
 * Undefined object members are omitted. Key order is UTF-16 code unit order.
 * Every code unit U+0000 through U+001F, including U+0008, U+0009, U+000A,
 * U+000C, and U+000D, is `\u00xx` lowercase. Payload versions through v10,
 * flag-off receipts, entry_hash, and the well-known issuer-history document
 * stay on this function. Payload v11 uses {@link jcsRfc8785}.
 * @param {unknown} value
 * @returns {string}
 */
export function jcsCanonicalize(value) {
  return jcsValue(value);
}

function jcsValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return String(value);
  }
  if (type === 'string') return jcsString(value);
  if (Array.isArray(value)) return `[${value.map(jcsValue).join(',')}]`;
  if (type === 'object') return jcsObject(value);
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

function jcsString(str) {
  let result = '"';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);
    if (code < 32) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (char === '"') {
      result += '\\"';
    } else if (char === '\\') {
      result += '\\\\';
    } else {
      result += char;
    }
  }
  return `${result}"`;
}

function jcsObject(obj) {
  const keys = Object.keys(obj).sort(utf16Compare);
  const pairs = [];
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) {
      pairs.push(`${jcsString(key)}:${jcsValue(value)}`);
    }
  }
  return `{${pairs.join(',')}}`;
}

/** UTF-16 code-unit order, the same comparison RFC 8785 requires. */
function utf16Compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * True RFC 8785 (JCS). String escaping and number serialization are
 * ECMAScript `JSON.stringify`: `\b` `\t` `\n` `\f` `\r` for U+0008, U+0009,
 * U+000A, U+000C, and U+000D, and lowercase `\u00xx` for the other C0
 * controls. Object keys are sorted by UTF-16 code unit before serialization,
 * because `JSON.stringify` enumerates integer-index keys first.
 * Lone surrogates and non-finite numbers are rejected.
 *
 * Used only for payload v11, refusal v2, the v11 issuer_history_snapshot
 * embed (it is inside that payload), and the issuer_root fingerprint.
 * @param {unknown} value
 * @returns {string}
 */
export function jcsRfc8785(value) {
  return rfc8785Value(value);
}

function assertWellFormedUtf16(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new Error('Cannot canonicalize a lone surrogate');
      }
      i += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new Error('Cannot canonicalize a lone surrogate');
    }
  }
}

function rfc8785String(str) {
  assertWellFormedUtf16(str);
  return JSON.stringify(str);
}

function rfc8785Value(value) {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (type === 'string') return rfc8785String(value);
  if (Array.isArray(value)) return `[${value.map(rfc8785Value).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).sort(utf16Compare);
    const pairs = [];
    for (const key of keys) {
      const child = value[key];
      if (child !== undefined) pairs.push(`${rfc8785String(key)}:${rfc8785Value(child)}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

/** Host of an absolute http(s) URL, or null. Default ports are stripped (URL.host). */
export function httpUrlHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host || null;
  } catch {
    return null;
  }
}

/** did:web identifier for a host (port colon percent-encoded, per the did:web method). */
export function didWebForHost(host) {
  return `did:web:${String(host).replace(':', '%3A')}`;
}

export const didWebFor = (url) => {
  const host = httpUrlHost(url);
  if (!host) return null;
  return didWebForHost(host);
};

const kidFor = (url) => {
  const did = didWebFor(url);
  if (!did) return null;
  return `${did}#${getIssuerKid()}`;
};

/**
 * Host for /.well-known/did.json. Uses the same URL.host normalization as signed
 * resourceUrl values, so a request to api.chit402.com and api.xfuel.app each
 * publish the DID that offers for that host name.
 * @param {import('express').Request|{ get?: Function, protocol?: string }} req
 */
export function didHostFromRequest(req) {
  const raw = typeof req?.get === 'function' ? req.get('host') : '';
  if (!raw) return 'localhost';
  const proto = req.protocol || 'https';
  try {
    return new URL(`${proto}://${raw}`).host;
  } catch {
    return raw;
  }
}

function sign(payload, resourceUrl) {
  const kid = kidFor(resourceUrl);
  if (!kid) throw new Error('offer-receipt: resourceUrl must be an absolute http(s) URL');
  const canonical = jcsCanonicalize(payload);
  // signJws JSON.stringifies the object. Parse the JCS text so key order and
  // number/string encoding are the canonical bytes (flat payloads round-trip).
  const parsed = JSON.parse(canonical);
  const { jws } = signJws(parsed, { typ: null, kid });
  const payloadB64 = jws.split('.')[1];
  const signed = Buffer.from(payloadB64, 'base64url').toString('utf8');
  if (signed !== canonical) {
    throw new Error('offer-receipt: signed payload bytes are not JCS');
  }
  return jws;
}

const OFFER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          format: { type: 'string', const: 'jws' },
          acceptIndex: { type: 'integer' },
          signature: { type: 'string', description: 'JWS compact serialization containing the offer payload' },
        },
        required: ['format', 'signature'],
      },
    },
  },
  required: ['offers'],
};

const RECEIPT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    receipt: {
      type: 'object',
      properties: {
        format: { type: 'string', const: 'jws' },
        signature: { type: 'string', description: 'JWS compact serialization containing the receipt payload' },
      },
      required: ['format', 'signature'],
    },
  },
  required: ['receipt'],
};

/**
 * extensions["offer-receipt"] for a 402 PaymentRequired body.
 * One signed offer per accepts[] entry. acceptIndex is unsigned.
 * validUntil is unix seconds; pass expiresAt in milliseconds (the 402 extra field).
 * @param {object[]} accepts
 * @param {string} resourceUrl
 * @param {{ expiresAtMs?: number|null }} [opts]
 * @returns {object|null} null when resourceUrl is not an absolute http(s) URL
 */
export function buildOfferExtension(accepts, resourceUrl, { expiresAtMs = null } = {}) {
  if (!httpUrlHost(resourceUrl)) return null;
  const validUntil = expiresAtMs ? Math.floor(Number(expiresAtMs) / 1000) : undefined;
  return {
    info: {
      offers: accepts.map((a, acceptIndex) => ({
        format: 'jws',
        acceptIndex,
        signature: sign({
          version: 1,
          resourceUrl,
          scheme: a.scheme,
          network: a.network,
          asset: a.asset,
          payTo: a.payTo,
          amount: a.amount,
          validUntil,
        }, resourceUrl),
      })),
    },
    schema: OFFER_SCHEMA,
  };
}

/**
 * extensions["offer-receipt"] for a SettlementResponse (PAYMENT-RESPONSE).
 * Returns null when network, resourceUrl, or payer is missing — the caller
 * still emits the legacy success/transaction/network/payer fields.
 */
export function buildReceiptExtension({ network, resourceUrl, payer, transaction = '', issuedAt = null }) {
  if (!network || !resourceUrl || !payer) return null;
  if (!httpUrlHost(resourceUrl)) return null;
  return {
    info: {
      receipt: {
        format: 'jws',
        signature: sign({
          version: 1,
          network,
          resourceUrl,
          payer,
          issuedAt: issuedAt ?? Math.floor(Date.now() / 1000),
          transaction: transaction || undefined,
        }, resourceUrl),
      },
    },
    schema: RECEIPT_SCHEMA,
  };
}

/** DID document for GET /.well-known/did.json. Same P-256 key as jwks.json. */
export function buildDidDocument(host) {
  const id = didWebForHost(host);
  const jwk = getIssuerPublicKeyJwk();
  const publicKeyJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const vm = `${id}#${getIssuerKid()}`;
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
    id,
    verificationMethod: [{
      id: vm,
      type: 'JsonWebKey2020',
      controller: id,
      publicKeyJwk,
    }],
    assertionMethod: [vm],
  };
}
