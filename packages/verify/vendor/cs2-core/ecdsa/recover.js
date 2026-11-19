/**
 * ECDSA public-key recovery (SEC1 4.1.6) and y-parity by trial.
 * Recovery id 0 or 1 selects the least significant bit of R.y.
 * Typed transactions use that bit as signature_y_parity. recId 2 and 3
 * (x = r + n) are not used: for these curves that x is outside the
 * EIP-1559 y-parity range.
 */

import { bytesToBig, equalBytes, uncompressedPoint } from './bytes.js';

function mod(a, p) {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modMul(a, b, p) {
  return mod(a * b, p);
}

function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = modMul(result, b, m);
    b = modMul(b, b, m);
    e >>= 1n;
  }
  return result;
}

function modInv(a, m) {
  if (a === 0n) return null;
  const inv = modPow(a, m - 2n, m);
  if (modMul(inv, a, m) !== 1n) return null;
  return inv;
}

function modSqrt(a, p) {
  const aa = mod(a, p);
  if (aa === 0n) return 0n;
  const root = modPow(aa, (p + 1n) / 4n, p);
  if (modMul(root, root, p) !== aa) return null;
  return root;
}

function jacDouble(pt, curve) {
  if (!pt || pt.Z === 0n || pt.Y === 0n) return null;
  const p = curve.p;
  const yy = modMul(pt.Y, pt.Y, p);
  const s = modMul(4n, modMul(pt.X, yy, p), p);
  const m = mod(modMul(3n, modMul(pt.X, pt.X, p), p) + modMul(curve.a, modPow(pt.Z, 4n, p), p), p);
  const x3 = mod(modMul(m, m, p) - 2n * s, p);
  const y3 = mod(modMul(m, mod(s - x3, p), p) - modMul(8n, modMul(yy, yy, p), p), p);
  const z3 = modMul(2n, modMul(pt.Y, pt.Z, p), p);
  return { X: x3, Y: y3, Z: z3 };
}

function jacAddMixed(pt, aff, curve) {
  if (!aff) return pt;
  if (!pt || pt.Z === 0n) return { X: aff.x, Y: aff.y, Z: 1n };
  const p = curve.p;
  const z2 = modMul(pt.Z, pt.Z, p);
  const u2 = modMul(aff.x, z2, p);
  const s2 = modMul(aff.y, modMul(z2, pt.Z, p), p);
  const h = mod(u2 - pt.X, p);
  const r = mod(s2 - pt.Y, p);
  if (h === 0n) {
    if (r !== 0n) return null;
    return jacDouble(pt, curve);
  }
  const h2 = modMul(h, h, p);
  const h3 = modMul(h, h2, p);
  const u1h2 = modMul(pt.X, h2, p);
  const x3 = mod(modMul(r, r, p) - h3 - 2n * u1h2, p);
  const y3 = mod(modMul(r, mod(u1h2 - x3, p), p) - modMul(pt.Y, h3, p), p);
  const z3 = modMul(pt.Z, h, p);
  return { X: x3, Y: y3, Z: z3 };
}

function fromJac(pt, prime) {
  if (!pt || pt.Z === 0n) return null;
  const inv = modInv(pt.Z, prime);
  if (inv == null) return null;
  const z2 = modMul(inv, inv, prime);
  const z3 = modMul(z2, inv, prime);
  return { x: modMul(pt.X, z2, prime), y: modMul(pt.Y, z3, prime) };
}

export function pointMultiply(aff, k, curve) {
  if (!aff || k === 0n) return null;
  let n = mod(k, curve.order);
  if (n === 0n) return null;
  let acc = null;
  let base = { X: aff.x, Y: aff.y, Z: 1n };
  while (n > 0n) {
    if (n & 1n) {
      const aff = fromJac(base, curve.p);
      if (!aff) return null;
      acc = jacAddMixed(acc, aff, curve);
    }
    base = jacDouble(base, curve);
    if (!base && n > 1n) return null;
    n >>= 1n;
  }
  return fromJac(acc, curve.p);
}

function onCurve(pt, curve) {
  if (!pt) return false;
  const y2 = modMul(pt.y, pt.y, curve.p);
  const rhs = mod(modMul(pt.x, modMul(pt.x, pt.x, curve.p), curve.p) + modMul(curve.a, pt.x, curve.p) + curve.b, curve.p);
  return y2 === rhs;
}

function encodePoint(pt) {
  const out = new Uint8Array(65);
  out[0] = 0x04;
  const x = pt.x.toString(16).padStart(64, '0');
  const y = pt.y.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i += 1) {
    out[1 + i] = Number.parseInt(x.slice(i * 2, i * 2 + 2), 16);
    out[33 + i] = Number.parseInt(y.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Recover the 65-byte uncompressed public key, or null.
 * @param {Uint8Array} digest 32 bytes
 * @param {Uint8Array} rBytes 32 bytes
 * @param {Uint8Array} sBytes 32 bytes
 * @param {0|1} yParity
 * @param {{ p: bigint, a: bigint, b: bigint, order: bigint, G: { x: bigint, y: bigint } }} curve
 * @returns {Uint8Array | null}
 */
export function recoverPublicKey(digest, rBytes, sBytes, yParity, curve) {
  if (!curve?.order || !curve.G || (yParity !== 0 && yParity !== 1)) return null;
  if (digest?.length !== 32 || rBytes?.length !== 32 || sBytes?.length !== 32) return null;
  const r = bytesToBig(rBytes);
  const s = bytesToBig(sBytes);
  const n = curve.order;
  const p = curve.p;
  if (r <= 0n || r >= n || s <= 0n || s >= n || r >= p) return null;
  const rhs = mod(modMul(r, modMul(r, r, p), p) + modMul(curve.a, r, p) + curve.b, p);
  let y = modSqrt(rhs, p);
  if (y == null) return null;
  if (Number(y & 1n) !== yParity) y = mod(p - y, p);
  const R = { x: r, y };
  if (!onCurve(R, curve)) return null;
  const z = bytesToBig(digest) % n;
  const rInv = modInv(r, n);
  if (rInv == null) return null;
  const sR = pointMultiply(R, s, curve);
  if (!sR) return null;
  let sum = sR;
  if (z !== 0n) {
    const zG = pointMultiply(curve.G, z, curve);
    if (!zG) return null;
    const neg = { x: zG.x, y: mod(p - zG.y, p) };
    sum = fromJac(jacAddMixed({ X: sR.x, Y: sR.y, Z: 1n }, neg, curve), p);
    if (!sum) return null;
  }
  const Q = pointMultiply(sum, rInv, curve);
  if (!Q || !onCurve(Q, curve)) return null;
  return encodePoint(Q);
}

/**
 * Try y-parity 0 then 1. Exactly one must recover the known public key.
 * @param {Uint8Array} digest
 * @param {Uint8Array} sig64 low-S r||s
 * @param {Uint8Array} publicKey uncompressed point
 * @param {object} curve
 * @returns {0|1}
 */
export function yParityByTrial(digest, sig64, publicKey, curve) {
  if (!sig64 || sig64.length !== 64) {
    const err = new Error('signature must be 64 bytes');
    err.code = 'y_parity_unmatched';
    throw err;
  }
  const want = uncompressedPoint(publicKey);
  const r = sig64.subarray(0, 32);
  const s = sig64.subarray(32, 64);
  const hits = [];
  for (const bit of [0, 1]) {
    const got = recoverPublicKey(digest, r, s, bit, curve);
    if (got && equalBytes(got, want)) hits.push(bit);
  }
  if (hits.length !== 1) {
    const err = new Error('y parity unmatched');
    err.code = 'y_parity_unmatched';
    throw err;
  }
  return hits[0];
}
