/**
 * A paid amount belongs to one route and one quoted price.
 * Fee and debt checks read the on-chain amount. The quote is the price
 * that amount was locked to, not a second source of "settled".
 */

export function canonicalPaidRoute(value) {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s) return '';
  try {
    if (s.includes('://')) {
      const path = new URL(s).pathname || '/';
      s = path;
    }
  } catch {
    /* keep the raw path */
  }
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

export function samePaidRoute(a, b) {
  const left = canonicalPaidRoute(a);
  const right = canonicalPaidRoute(b);
  return left !== '' && left === right;
}

/** Non-negative integer atomic units, or null. */
export function atomicUnits(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/** The route's price must be the price this challenge was quoted at. */
export function sameQuotedPrice(quoted, routePrice) {
  const left = atomicUnits(quoted);
  const right = atomicUnits(routePrice);
  return left != null && right != null && left === right;
}

/** On-chain transfer covers the quoted price. A larger quote does not. */
export function chainCoversPrice(chainAmount, quotedPrice) {
  const chain = atomicUnits(chainAmount);
  const quoted = atomicUnits(quotedPrice);
  return chain != null && quoted != null && chain >= quoted;
}
