/**
 * keyHash = SHA-256(keyAlg byte || key).
 *
 * keyAlg 0x01 is secp256k1. The key is 33-byte SEC1 compressed
 * (prefix 0x02 or 0x03). A 65-byte key, a 0x04 prefix, or any other
 * prefix is refused. This is the only function that computes a keyHash.
 */

import { createHash } from 'node:crypto';
import { bytesToHex } from '../ecdsa/bytes.js';

export const KEY_ALG_SECP256K1 = 0x01;

function fail(reason) {
  return { ok: false, reason };
}

function keyBytes(key) {
  if (key instanceof Uint8Array) return key;
  if (typeof key !== 'string') return null;
  const body = key.startsWith('0x') ? key.slice(2) : key;
  if (body.startsWith('0X') || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Admission and verify both use this. A bad encoding never becomes a keyHash. */
export function canonicalSecp256k1Key(keyAlg, key) {
  if (keyAlg !== KEY_ALG_SECP256K1) return fail('bad_alg');
  const bytes = keyBytes(key);
  if (!bytes) return fail('bad_length');
  if (bytes.length !== 33) return fail('bad_length');
  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) return fail('bad_length');
  return { ok: true, bytes };
}

export function keyHash(keyAlg, key) {
  const canon = canonicalSecp256k1Key(keyAlg, key);
  if (!canon.ok) return canon;
  const hash = createHash('sha256');
  hash.update(Uint8Array.of(keyAlg & 0xff));
  hash.update(canon.bytes);
  const bytes = new Uint8Array(hash.digest());
  return { ok: true, bytes, hex: bytesToHex(bytes) };
}

/** A revoked keyHash stays dead in every later slot. */
export function tombstoned(list, keyHashHex) {
  if (list == null) return false;
  const want = String(keyHashHex).toLowerCase().replace(/^0x/, '');
  if (want.length !== 64) return false;
  const items = list instanceof Set ? list : Array.isArray(list) ? list : null;
  if (!items) return false;
  for (const item of items) {
    if (String(item).toLowerCase().replace(/^0x/, '') === want) return true;
  }
  return false;
}
