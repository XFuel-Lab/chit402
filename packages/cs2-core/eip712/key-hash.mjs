/**
 * keyHash = SHA-256(keyAlg byte || key).
 *
 * The key is whatever canonicalKey accepts for that algorithm. At v13 that
 * is a 33-byte compressed P-256 point. This is the only function that
 * computes a keyHash.
 */

import { createHash } from 'node:crypto';
import { bytesToHex, hexToBytes } from '../ecdsa/bytes.js';
import { canonicalKey } from './registry.mjs';

/** Public T4 vector key. Tooling must not register it or sign with it. */
export const DENIED_KEY_HASHES = Object.freeze([
  '70703a0707c1ba660d772d3b613966bf84599afa8059b29636a613fefbfa9390',
]);

export function deniedKeyHash(hex) {
  const body = String(hex ?? '').toLowerCase().replace(/^0x/, '');
  return DENIED_KEY_HASHES.includes(body);
}

export function keyHash(keyAlg, key) {
  const canon = canonicalKey(keyAlg, key);
  if (!canon.ok) return canon;
  const hash = createHash('sha256');
  hash.update(Uint8Array.of(keyAlg & 0xff));
  hash.update(canon.bytes);
  const bytes = new Uint8Array(hash.digest());
  return { ok: true, bytes, hex: bytesToHex(bytes) };
}

/** Text form is 0x and 64 lowercase hex characters. Nothing else parses. */
export function parseKeyHash(text) {
  if (typeof text !== 'string' || text.length !== 66 || !text.startsWith('0x')) return null;
  const body = text.slice(2);
  if (body !== body.toLowerCase() || !/^[0-9a-f]{64}$/.test(body)) return null;
  return hexToBytes(body);
}

/** Binary form is 32 raw bytes. The text form is never a normalized guess. */
export function formatKeyHash(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
  return `0x${bytesToHex(bytes)}`;
}

function entryHex(item) {
  if (item instanceof Uint8Array) {
    if (item.length !== 32) return null;
    return bytesToHex(item);
  }
  if (typeof item !== 'string') return null;
  const parsed = parseKeyHash(item);
  if (!parsed) return null;
  return bytesToHex(parsed);
}

/** A revoked keyHash stays dead. A byte entry matches. An unreadable entry fails closed. */
export function tombstoned(list, keyHashHex) {
  if (list == null) return false;
  const want = String(keyHashHex).toLowerCase().replace(/^0x/, '');
  if (want.length !== 64 || !/^[0-9a-f]+$/.test(want)) return false;
  if (list instanceof Uint8Array) {
    const hex = entryHex(list);
    if (!hex) return true;
    return hex === want;
  }
  const items = list instanceof Set || Array.isArray(list) ? list : null;
  if (!items) return true;
  for (const item of items) {
    const hex = entryHex(item);
    if (!hex) return true;
    if (hex === want) return true;
  }
  return false;
}
