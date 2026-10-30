/**
 * Strict DER ECDSA → 64-byte r||s, then low-S.
 * The order comes from the curve argument. This file does not embed
 * either curve's order.
 */

import { bigToBytes, bytesToBig } from './bytes.js';

function derError() {
  const err = new Error('invalid DER signature');
  err.code = 'der_invalid';
  return err;
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(value || []);
}

/**
 * Definite, minimal DER length. Long form is rejected when short form would
 * do, and when the length bytes themselves have a leading zero.
 */
function readLength(buf, offset) {
  if (offset >= buf.length) throw derError();
  const first = buf[offset];
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 2) throw derError();
  if (offset + 1 + count > buf.length) throw derError();
  if (buf[offset + 1] === 0x00) throw derError();
  let length = 0;
  for (let i = 0; i < count; i += 1) length = (length << 8) | buf[offset + 1 + i];
  if (length < 0x80) throw derError();
  return { length, next: offset + 1 + count };
}

function readScalar(buf, offset, end, order) {
  if (offset >= end || buf[offset] !== 0x02) throw derError();
  const { length, next } = readLength(buf, offset + 1);
  if (length < 1) throw derError();
  const start = next;
  const last = start + length;
  if (last > end) throw derError();
  if ((buf[start] & 0x80) !== 0) throw derError();
  if (buf[start] === 0x00) {
    if (length === 1 || (buf[start + 1] & 0x80) === 0) throw derError();
  }
  let i = start;
  while (i < last - 1 && buf[i] === 0x00) i += 1;
  const raw = buf.subarray(i, last);
  if (raw.length > 32) throw derError();
  const value = bytesToBig(buf.subarray(start, last));
  if (value === 0n || value >= order) throw derError();
  return { out: bigToBytes(value, 32), value, next: last };
}

/**
 * SEQUENCE { INTEGER r, INTEGER s } → 64-byte r||s.
 * r and s must lie in [1, curve.order).
 * @param {Uint8Array} der
 * @param {{ order: bigint }} curve
 * @returns {Uint8Array}
 */
export function derToRaw(der, curve) {
  if (!curve || typeof curve.order !== 'bigint') throw derError();
  const buf = asBuffer(der);
  if (buf.length < 8 || buf[0] !== 0x30) throw derError();
  const { length, next } = readLength(buf, 1);
  if (next + length !== buf.length) throw derError();
  const r = readScalar(buf, next, buf.length, curve.order);
  const s = readScalar(buf, r.next, buf.length, curve.order);
  if (s.next !== buf.length) throw derError();
  const out = new Uint8Array(64);
  out.set(r.out, 0);
  out.set(s.out, 32);
  return out;
}

/**
 * EIP-2 low-S. s > order/2 becomes order - s. r is unchanged.
 * s == order/2 stays (the order is odd, so order/2 means floor).
 * @param {Uint8Array} sig64
 * @param {{ order: bigint }} curve
 * @returns {Uint8Array}
 */
export function lowS(sig64, curve) {
  if (!curve || typeof curve.order !== 'bigint') throw derError();
  const sig = asBuffer(sig64);
  if (sig.length !== 64) throw derError();
  const order = curve.order;
  const s = bytesToBig(sig.subarray(32));
  if (s === 0n || s >= order) throw derError();
  const half = order >> 1n;
  if (s <= half) return new Uint8Array(sig);
  const out = new Uint8Array(sig);
  out.set(bigToBytes(order - s, 32), 32);
  return out;
}

/**
 * Strict DER then low-S on the curve's own order.
 * @param {Uint8Array} der
 * @param {{ order: bigint }} curve
 * @returns {Uint8Array}
 */
export function normalizeDer(der, curve) {
  return lowS(derToRaw(der, curve), curve);
}
