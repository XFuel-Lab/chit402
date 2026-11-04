/**
 * PayTo-control signature field: uint16 big-endian length, then the bytes.
 *
 * An EOA signature is 65 bytes (r‖s‖v). ERC-1271 signatures are longer and
 * are not verified here. Any inner length other than 65 is refused.
 */

import { refuse } from './reasons.mjs';

export const SIGNATURE_LENGTH_PREFIX_BYTES = 2;
export const EOA_SIGNATURE_BYTES = 65;

export function encodeSignatureField(signature) {
  if (!(signature instanceof Uint8Array)) return null;
  if (signature.length > 0xffff) return null;
  const out = new Uint8Array(SIGNATURE_LENGTH_PREFIX_BYTES + signature.length);
  out[0] = (signature.length >> 8) & 0xff;
  out[1] = signature.length & 0xff;
  out.set(signature, SIGNATURE_LENGTH_PREFIX_BYTES);
  return out;
}

/**
 * Read a length-prefixed signature and accept only the EOA width.
 * A raw 65-byte signature, a short field, or any other inner length
 * (including a future ERC-1271 blob) is refused. No contract call is made.
 */
export function readSignatureField(field) {
  if (!(field instanceof Uint8Array) || field.length < SIGNATURE_LENGTH_PREFIX_BYTES) {
    return refuse('bad_signature');
  }
  const length = (field[0] << 8) | field[1];
  if (field.length !== SIGNATURE_LENGTH_PREFIX_BYTES + length) return refuse('bad_signature');
  if (length !== EOA_SIGNATURE_BYTES) return refuse('bad_signature');
  return { ok: true, bytes: field.subarray(SIGNATURE_LENGTH_PREFIX_BYTES) };
}
