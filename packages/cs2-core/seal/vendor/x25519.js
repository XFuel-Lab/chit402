/**
 * X25519 (RFC 7748). Vendored for the browser. Hash-pinned in ./PINS.json.
 * No Node-only crypto.
 *
 * The Montgomery ladder clamps the scalar (RFC 7748 §5) and masks bit 255
 * of the u-coordinate. The all-zero shared secret is rejected by the caller.
 */

const P = (1n << 255n) - 19n;
const A24 = 121665n;

function fe(n) {
  const r = n % P;
  return r >= 0n ? r : r + P;
}

function leToBig(bytes) {
  let x = 0n;
  for (let i = 0; i < bytes.length; i += 1) x |= BigInt(bytes[i]) << BigInt(8 * i);
  return x;
}

function bigToLe(x, n) {
  const out = new Uint8Array(n);
  let v = x;
  for (let i = 0; i < n; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function cswap(swap, x, y) {
  const mask = -swap;
  const t = mask & (x ^ y);
  return [x ^ t, y ^ t];
}

function invert(z) {
  let result = 1n;
  let base = fe(z);
  let exp = P - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = fe(result * base);
    base = fe(base * base);
    exp >>= 1n;
  }
  return result;
}

/** u = 9, the RFC 7748 base point. */
export const X25519_BASE = (() => {
  const u = new Uint8Array(32);
  u[0] = 9;
  return u;
})();

/**
 * @param {Uint8Array} scalar 32 bytes, clamped inside
 * @param {Uint8Array} uCoord 32 bytes
 * @returns {Uint8Array | null}
 */
export function x25519(scalar, uCoord) {
  if (!(scalar instanceof Uint8Array) || scalar.length !== 32) return null;
  if (!(uCoord instanceof Uint8Array) || uCoord.length !== 32) return null;
  const k = scalar.slice();
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  const uBytes = uCoord.slice();
  uBytes[31] &= 127;
  const u = leToBig(uBytes);

  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;
  for (let t = 254; t >= 0; t -= 1) {
    const kt = BigInt((k[t >>> 3] >>> (t & 7)) & 1);
    swap ^= kt;
    [x2, x3] = cswap(swap, x2, x3);
    [z2, z3] = cswap(swap, z2, z3);
    swap = kt;
    const a = fe(x2 + z2);
    const aa = fe(a * a);
    const b = fe(x2 - z2);
    const bb = fe(b * b);
    const e = fe(aa - bb);
    const c = fe(x3 + z3);
    const d = fe(x3 - z3);
    const da = fe(d * a);
    const cb = fe(c * b);
    const sum = fe(da + cb);
    const diff = fe(da - cb);
    x3 = fe(sum * sum);
    z3 = fe(u * diff * diff);
    x2 = fe(aa * bb);
    z2 = fe(e * fe(aa + (A24 * e)));
  }
  [x2, x3] = cswap(swap, x2, x3);
  [z2, z3] = cswap(swap, z2, z3);
  k.fill(0);
  return bigToLe(fe(x2 * invert(z2)), 32);
}

/** Public key of a 32-byte scalar. */
export function x25519Public(scalar) {
  return x25519(scalar, X25519_BASE);
}
