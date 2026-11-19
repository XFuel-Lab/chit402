/**
 * Raw-digest ECDSA (no extra hash). Used to build vectors and to stand in
 * for KMS in tests. The checkpoint signer does not import this module.
 * k is caller-supplied so a test can be deterministic. s is returned low-S.
 */

import { bigToBytes, bytesToBig, concat } from './bytes.js';
import { pointMultiply } from './recover.js';

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return result;
}

function derInt(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0x00) i += 1;
  let body = bytes.subarray(i);
  if (body[0] & 0x80) body = concat([Uint8Array.of(0x00), body]);
  if (body.length >= 128) {
    const err = new Error('der integer too wide');
    err.code = 'der_invalid';
    throw err;
  }
  return concat([Uint8Array.of(0x02, body.length), body]);
}

function derSeq(r, s) {
  const body = concat([derInt(r), derInt(s)]);
  if (body.length >= 128) {
    const err = new Error('der sequence too wide');
    err.code = 'der_invalid';
    throw err;
  }
  return concat([Uint8Array.of(0x30, body.length), body]);
}

/**
 * @param {Uint8Array} digest 32 bytes, already the message integer
 * @param {bigint} d private scalar in [1, order)
 * @param {bigint} k nonce in [1, order)
 * @param {object} curve
 * @returns {{ r: Uint8Array, s: Uint8Array, yParity: 0|1, der: Uint8Array, raw: Uint8Array }}
 */
export function signRawDigest(digest, d, k, curve) {
  if (digest?.length !== 32) {
    const err = new Error('digest must be 32 bytes');
    err.code = 'bad_digest';
    throw err;
  }
  const n = curve.order;
  if (d <= 0n || d >= n || k <= 0n || k >= n) {
    const err = new Error('scalar out of range');
    err.code = 'bad_scalar';
    throw err;
  }
  const R = pointMultiply(curve.G, k, curve);
  if (!R || R.x <= 0n || R.x >= n) {
    const err = new Error('nonce produced no usable r');
    err.code = 'bad_nonce';
    throw err;
  }
  const r = R.x;
  const z = bytesToBig(digest) % n;
  const kInv = modPow(k, n - 2n, n);
  let s = mod(kInv * mod(z + mod(r * d, n), n), n);
  if (s === 0n) {
    const err = new Error('nonce produced no usable s');
    err.code = 'bad_nonce';
    throw err;
  }
  let yParity = Number(R.y & 1n);
  const half = n >> 1n;
  if (s > half) {
    s = n - s;
    yParity ^= 1;
  }
  const rBytes = bigToBytes(r, 32);
  const sBytes = bigToBytes(s, 32);
  const raw = concat([rBytes, sBytes]);
  return { r: rBytes, s: sBytes, yParity, der: derSeq(rBytes, sBytes), raw };
}

/** High-S DER of an existing low-S signature. r is unchanged. */
export function highSDer(raw64, curve) {
  const r = raw64.subarray(0, 32);
  const s = bytesToBig(raw64.subarray(32));
  const flipped = bigToBytes(curve.order - s, 32);
  return derSeq(r, flipped);
}

export function publicPoint(d, curve) {
  if (d <= 0n || d >= curve.order) {
    const err = new Error('scalar out of range');
    err.code = 'bad_scalar';
    throw err;
  }
  const Q = pointMultiply(curve.G, d, curve);
  if (!Q) {
    const err = new Error('scalar produced no point');
    err.code = 'bad_scalar';
    throw err;
  }
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigToBytes(Q.x, 32), 1);
  out.set(bigToBytes(Q.y, 32), 33);
  return out;
}
