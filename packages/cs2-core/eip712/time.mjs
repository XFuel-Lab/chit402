/**
 * hourStart and expiry share one unit: unix seconds.
 * An hour boundary is 3600 of those seconds. Nothing converts between units.
 */

export const TIME_UNIT = 'unix-seconds';
export const HOUR_SECONDS = 3600n;

/** True when expiry is still after this hourStart. Both values are unix seconds. */
export function expiryAllows(hourStart, expiry) {
  if (typeof hourStart !== 'bigint' || typeof expiry !== 'bigint') return false;
  return expiry > hourStart;
}
