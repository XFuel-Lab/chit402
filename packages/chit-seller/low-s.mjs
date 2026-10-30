/**
 * Low-S check parameterized by the curve order.
 * Sigma uses P-256. The payTo registration uses secp256k1.
 * Neither path reads the other curve's order.
 */

import { bytesToBig } from '../cs2-core/ecdsa/bytes.js';

export function isLowS(sBytes, curve) {
  if (!sBytes || sBytes.length !== 32 || !curve || typeof curve.order !== 'bigint') return false;
  const s = bytesToBig(sBytes);
  if (s <= 0n || s >= curve.order) return false;
  const half = curve.order >> 1n;
  return s <= half;
}
