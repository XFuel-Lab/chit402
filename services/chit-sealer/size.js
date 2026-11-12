/**
 * Log size for the hourly sealer.
 *
 * Sizes and leaf indexes stay inside Number.MAX_SAFE_INTEGER (2^53 − 1).
 * That cap is an implementation limit, not a uint64 wire field. The anchor
 * still writes size as a uint64. Arithmetic is Math.floor and remainder.
 * Past the cap the close is refused. It is not wrapped.
 */

export const MAX_LOG_SIZE = Number.MAX_SAFE_INTEGER;

function bad() {
  return { ok: false, reason: 'size_cap' };
}

function natural(value) {
  if (typeof value !== 'number') return false;
  if (Object.is(value, -0)) return false;
  if (!Number.isSafeInteger(value) || value < 0) return false;
  return true;
}

/**
 * @param {number} prev current log size
 * @param {number} add leaves appended by this close
 * @returns {{ok: true, size: number} | {ok: false, reason: 'size_cap'}}
 */
export function addLogSize(prev, add) {
  if (!natural(prev) || !natural(add)) return bad();
  const next = Math.floor(prev) + Math.floor(add);
  if (!Number.isSafeInteger(next) || next > MAX_LOG_SIZE) return bad();
  return { ok: true, size: next };
}

/**
 * Leaf index. Same cap as the log size. Refuses a value that is not a
 * safe integer instead of truncating it.
 * @param {number} index
 */
export function leafIndex(index) {
  if (!natural(index)) return bad();
  return { ok: true, index: Math.floor(index) };
}
