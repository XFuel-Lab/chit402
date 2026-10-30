/**
 * Hex and integer parsing for the seller signer.
 * Wire hex is lowercase. A 0x prefix is accepted on input and is not written
 * on raw byte output. Nothing here formats an error from the input.
 */

import { bytesToHex, hexToBytes, bytesToBig } from '../cs2-core/ecdsa/bytes.js';

export { bytesToHex, hexToBytes, bytesToBig };

export function normalizeHex(value, width) {
  if (value instanceof Uint8Array) {
    if (value.length !== width) return null;
    return bytesToHex(value);
  }
  if (typeof value !== 'string') return null;
  const body = (value.startsWith('0x') || value.startsWith('0X')) ? value.slice(2) : value;
  if (body.length !== width * 2 || !/^[0-9a-fA-F]+$/.test(body)) return null;
  return body.toLowerCase();
}

export function isZeroHex(hex) {
  if (typeof hex !== 'string' || hex.length === 0) return false;
  for (let i = 0; i < hex.length; i += 1) {
    if (hex[i] !== '0') return false;
  }
  return true;
}

export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 20-byte address as lowercase hex, no prefix. Accepts 0x and mixed case. */
export function addressHex(value) {
  return normalizeHex(value, 20);
}

export function sameAddress(a, b) {
  const left = typeof a === 'string' && a.length === 40 ? a : addressHex(a);
  const right = typeof b === 'string' && b.length === 40 ? b : addressHex(b);
  if (!left || !right) return false;
  return sameHex(left, right);
}

const UINT256_MAX = (1n << 256n) - 1n;

export function parseUint(value, bits) {
  const max = bits >= 256 ? UINT256_MAX : (1n << BigInt(bits)) - 1n;
  let n = null;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    n = BigInt(value);
  } else if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) return null;
    n = BigInt(value);
  }
  if (n == null || n < 0n || n > max) return null;
  return n;
}

export function parseQuantity(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== 'string') return null;
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    try { return BigInt(value); } catch { return null; }
  }
  return parseUint(value, 256);
}

/** Private or nonce scalar in [1, order). */
export function parseScalar(value, order) {
  let n = null;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    n = BigInt(value);
  } else if (value instanceof Uint8Array) {
    if (value.length !== 32) return null;
    n = bytesToBig(value);
  } else if (typeof value === 'string') {
    const body = (value.startsWith('0x') || value.startsWith('0X')) ? value.slice(2) : value;
    if (body.length === 0 || body.length > 64 || !/^[0-9a-fA-F]+$/.test(body)) return null;
    n = BigInt(`0x${body}`);
  }
  if (n == null || n <= 0n || n >= order) return null;
  return n;
}
