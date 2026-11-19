/**
 * Key algorithm registry for Chit Simple v13.
 *
 * One table. The line codec, the EIP-712 module, and the seller import it.
 * 0x01 is P-256, the only algorithm admitted at v13. 0x02 is secp256k1,
 * pinned so the byte cannot be reused, and rejected until a later release.
 * 0x00 and 0x03–0xFF are reserved and rejected. A missing keyAlg is rejected.
 */

import { bytesToBig, bigToBytes } from '../ecdsa/bytes.js';
import { P256, SECP256K1 } from '../ecdsa/curves.js';

export const KEY_ALG_P256 = 0x01;
export const KEY_ALG_SECP256K1 = 0x02;

export const ALG_REGISTRY = Object.freeze([
  Object.freeze({
    keyAlg: 0x01,
    curve: 'P-256',
    encoding: 'sec1-compressed',
    length: 33,
    launch: true,
  }),
  Object.freeze({
    keyAlg: 0x02,
    curve: 'secp256k1',
    encoding: 'sec1-compressed',
    length: 33,
    launch: false,
  }),
]);

export const LAUNCH_ALGS = Object.freeze(
  ALG_REGISTRY.filter((row) => row.launch === true).map((row) => row.keyAlg),
);

const CURVES = Object.freeze({
  'P-256': P256,
  secp256k1: SECP256K1,
});

function fail(reason) {
  return { ok: false, reason };
}

function mod(a, p) {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modPow(base, exp, p) {
  let result = 1n;
  let b = mod(base, p);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, p);
    b = mod(b * b, p);
    e >>= 1n;
  }
  return result;
}

function keyBytes(key) {
  if (key instanceof Uint8Array) return key;
  if (typeof key !== 'string') return null;
  if (key.startsWith('0X')) return null;
  const body = key.startsWith('0x') ? key.slice(2) : key;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function decompress(bytes, curve) {
  const x = bytesToBig(bytes.subarray(1));
  if (x >= curve.p) return null;
  const p = curve.p;
  const x2 = mod(x * x, p);
  const rhs = mod(mod(x2 * x, p) + mod(curve.a * x, p) + curve.b, p);
  let y;
  if (rhs === 0n) y = 0n;
  else {
    y = modPow(rhs, (p + 1n) / 4n, p);
    if (mod(y * y, p) !== rhs) return null;
  }
  const prefix = bytes[0];
  if ((y & 1n) !== (prefix === 0x03 ? 1n : 0n)) y = mod(p - y, p);
  if ((y & 1n) !== (prefix === 0x03 ? 1n : 0n)) return null;
  if (mod(y * y, p) !== rhs) return null;
  if (x === 0n && y === 0n) return null;
  return { x, y };
}

function uncompressed(point) {
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigToBytes(point.x, 32), 1);
  out.set(bigToBytes(point.y, 32), 33);
  return out;
}

/**
 * Admission and verify both use this. An off-curve key, a 65-byte key,
 * a 0x04 prefix, or an algorithm outside the v13 launch set never becomes
 * a keyHash.
 */
export function canonicalKey(keyAlg, key) {
  if (typeof keyAlg !== 'number' || !Number.isInteger(keyAlg) || keyAlg < 0 || keyAlg > 0xff) {
    return fail('bad_alg');
  }
  const row = ALG_REGISTRY.find((item) => item.keyAlg === keyAlg);
  if (!row || row.launch !== true) return fail('bad_alg');
  const bytes = keyBytes(key);
  if (!bytes || bytes.length !== row.length) return fail('bad_length');
  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) return fail('bad_length');
  const curve = CURVES[row.curve];
  const point = decompress(bytes, curve);
  if (!point) return fail('bad_key');
  return {
    ok: true,
    bytes,
    uncompressed: uncompressed(point),
    curve,
    keyAlg,
  };
}
