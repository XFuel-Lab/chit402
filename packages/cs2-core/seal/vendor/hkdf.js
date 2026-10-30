/**
 * HMAC-SHA256 and HKDF-SHA256 (RFC 2104, RFC 5869).
 * Vendored for the browser. Hash-pinned in ./PINS.json.
 * No Node-only crypto.
 */

import { sha256 } from './sha256.js';

const BLOCK = 64;

function concat(parts) {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** @param {Uint8Array} key @param {...Uint8Array} parts */
export function hmacSha256(key, ...parts) {
  let k = key;
  if (k.length > BLOCK) k = sha256(k);
  const block = new Uint8Array(BLOCK);
  block.set(k, 0);
  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i += 1) {
    ipad[i] = block[i] ^ 0x36;
    opad[i] = block[i] ^ 0x5c;
  }
  return sha256(opad, sha256(ipad, concat(parts)));
}

/** Empty salt becomes HashLen zero bytes, as RFC 5869 requires. */
export function hkdfExtract(salt, ikm) {
  const s = salt.length === 0 ? new Uint8Array(32) : salt;
  return hmacSha256(s, ikm);
}

/** @param {Uint8Array} prk @param {Uint8Array} info @param {number} length */
export function hkdfExpand(prk, info, length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 255 * 32) return null;
  const rounds = Math.ceil(length / 32);
  const out = new Uint8Array(rounds * 32);
  let prev = new Uint8Array(0);
  for (let i = 1; i <= rounds; i += 1) {
    prev = hmacSha256(prk, prev, info, Uint8Array.of(i));
    out.set(prev, (i - 1) * 32);
  }
  return out.subarray(0, length);
}
