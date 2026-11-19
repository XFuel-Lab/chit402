/**
 * Slot kind bytes. This is the only definition of these constants.
 * Kind 0x05 is the key slot (32-byte keyHash). Kind 0x06 is reserved
 * for the channel slot and is not accepted by the line codec yet.
 */

import { createHash } from 'node:crypto';
import { bytesToHex } from '../ecdsa/bytes.js';

export const KIND_PAYTO = 0x01;
export const KIND_KEY = 0x05;
export const KIND_CHANNEL = 0x06;
export const SLOT_DOMAIN = 'chit402-state-v1';

function chainBytes(chainId) {
  if (typeof chainId !== 'bigint' || chainId < 0n || chainId >= (1n << 64n)) return null;
  const out = new Uint8Array(8);
  let v = chainId;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** SMT key for kind 0x05. The id is the raw keyHash. The line codec accepts the same kind. */
export function keySlotKey(chainId, keyHashBytes) {
  if (!(keyHashBytes instanceof Uint8Array) || keyHashBytes.length !== 32) {
    return { ok: false, reason: 'bad_length' };
  }
  const chain = chainBytes(chainId);
  if (!chain) return { ok: false, reason: 'bad_uint' };
  const hash = createHash('sha256');
  hash.update(SLOT_DOMAIN);
  hash.update(Uint8Array.of(KIND_KEY));
  hash.update(chain);
  hash.update(keyHashBytes);
  const bytes = new Uint8Array(hash.digest());
  return { ok: true, bytes, hex: bytesToHex(bytes) };
}
