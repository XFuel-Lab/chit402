/**
 * RFC 6979 deterministic ECDSA nonce (HMAC-SHA256).
 * qlen is 256 for both P-256 and secp256k1.
 */

import { createHmac } from 'node:crypto';
import { bytesToBig } from '../cs2-core/ecdsa/bytes.js';

function hmac(key, parts) {
  const mac = createHmac('sha256', key);
  for (const part of parts) mac.update(part);
  return new Uint8Array(mac.digest());
}

function concat(parts) {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function int2octets(value) {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bits2int(bits) {
  return bytesToBig(bits.subarray(0, 32));
}

function bits2octets(bits, order) {
  let z = bits2int(bits);
  if (z >= order) z -= order;
  return int2octets(z);
}

export function rfc6979Nonce(messageHash, privateKey, order) {
  const x = privateKey.length === 32 ? privateKey : int2octets(bytesToBig(privateKey));
  const h1 = bits2octets(messageHash, order);
  let V = new Uint8Array(32).fill(0x01);
  let K = new Uint8Array(32).fill(0x00);
  K = hmac(K, [V, Uint8Array.of(0x00), x, h1]);
  V = hmac(K, [V]);
  K = hmac(K, [V, Uint8Array.of(0x01), x, h1]);
  V = hmac(K, [V]);
  for (let round = 0; round < 64; round += 1) {
    V = hmac(K, [V]);
    const k = bits2int(V);
    if (k >= 1n && k < order) return k;
    K = hmac(K, [V, Uint8Array.of(0x00)]);
    V = hmac(K, [V]);
  }
  return null;
}
