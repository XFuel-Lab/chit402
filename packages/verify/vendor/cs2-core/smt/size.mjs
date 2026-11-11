/**
 * Tree sizes and indexes in this module are safe integers, capped at
 * 2^53 − 1. That cap is an implementation limit, not a wire field.
 * Nothing here is read from a vector file. Arithmetic on a size or an
 * index is division and remainder, not a 32-bit shift, so a value at or
 * above 2^31 stays exact.
 */

export const MAX_SMT_ENTRIES = Number.MAX_SAFE_INTEGER;

/**
 * @param {number} value
 * @returns {{ok: true, size: number} | {ok: false, reason: 'bad_size'}}
 */
export function acceptSize(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    return { ok: false, reason: 'bad_size' };
  }
  if (value > MAX_SMT_ENTRIES) return { ok: false, reason: 'bad_size' };
  return { ok: true, size: value };
}

/**
 * Eight-byte big-endian index. Used for dummy-key derivation and as the
 * size/index path that must not wrap at 2^32.
 * @param {number} index
 */
export function indexBytes(index) {
  const checked = acceptSize(index);
  if (!checked.ok) return checked;
  const out = new Uint8Array(8);
  let x = index;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = x % 256;
    x = Math.floor(x / 256);
  }
  return { ok: true, bytes: out };
}
