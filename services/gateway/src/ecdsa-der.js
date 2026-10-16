/**
 * Strict DER ECDSA signatures to the 64-byte JOSE form (r || s), plus low-S.
 * P-256 only. Rejects non-minimal lengths, trailing bytes, negatives, and
 * scalars that are 0 or not in the field order.
 */

const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const HALF_N = N >> 1n;

function derError() {
  const err = new Error('invalid DER signature');
  err.code = 'der_invalid';
  return err;
}

/**
 * Definite, minimal DER length. Long form is rejected when short form would do,
 * and when the length bytes themselves have a leading zero.
 * @param {Buffer} buf
 * @param {number} offset
 */
function readLength(buf, offset) {
  if (offset >= buf.length) throw derError();
  const first = buf[offset];
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  // Indefinite (0x80) and lengths that need more than two bytes are not P-256 DER.
  if (count === 0 || count > 2) throw derError();
  if (offset + 1 + count > buf.length) throw derError();
  if (buf[offset + 1] === 0x00) throw derError();
  let length = 0;
  for (let i = 0; i < count; i += 1) length = (length << 8) | buf[offset + 1 + i];
  // Long form of a length that fits in short form is not minimal.
  if (length < 0x80) throw derError();
  return { length, next: offset + 1 + count };
}

/**
 * One positive INTEGER. Leading 0x00 is only the sign byte, and only when the
 * next byte has its high bit set. The value is then left-padded to 32 bytes.
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} end
 */
function readScalar(buf, offset, end) {
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
  const hex = buf.subarray(start, last).toString('hex');
  const value = BigInt(`0x${hex}`);
  if (value === 0n || value >= N) throw derError();
  const out = Buffer.alloc(32);
  raw.copy(out, 32 - raw.length);
  return { out, value, next: last };
}

/**
 * SEQUENCE { INTEGER r, INTEGER s } → 64-byte r || s.
 * @param {Buffer | Uint8Array} der
 * @returns {Buffer}
 */
export function derToJose(der) {
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der || []);
  if (buf.length < 8 || buf[0] !== 0x30) throw derError();
  const { length, next } = readLength(buf, 1);
  if (next + length !== buf.length) throw derError();
  const r = readScalar(buf, next, buf.length);
  const s = readScalar(buf, r.next, buf.length);
  if (s.next !== buf.length) throw derError();
  return Buffer.concat([r.out, s.out]);
}

/**
 * If s > n/2, replace s with n - s. r is unchanged.
 * @param {Buffer | Uint8Array} sig64
 * @returns {Buffer}
 */
export function lowS(sig64) {
  const sig = Buffer.isBuffer(sig64) ? sig64 : Buffer.from(sig64 || []);
  if (sig.length !== 64) throw derError();
  const s = BigInt(`0x${sig.subarray(32).toString('hex')}`);
  if (s === 0n || s >= N) throw derError();
  if (s <= HALF_N) return Buffer.from(sig);
  const next = (N - s).toString(16).padStart(64, '0');
  const out = Buffer.from(sig);
  Buffer.from(next, 'hex').copy(out, 32);
  return out;
}

export const P256_ORDER = N;
export const P256_HALF_ORDER = HALF_N;
