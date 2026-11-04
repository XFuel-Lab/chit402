/**
 * One range check for a 64-byte P-256 r‖s.
 * r is in [1, n−1]. s is in [1, n/2]. RevokeByKey and the key possession
 * signature use this, and the line codec calls it for σ.
 */

import { bytesToBig } from '../ecdsa/bytes.js';
import { P256 } from '../ecdsa/curves.js';

const P256_N = P256.order;
const P256_HALF_N = P256_N >> 1n;

export function checkSigma(sigma64) {
  if (!(sigma64 instanceof Uint8Array) || sigma64.length !== 64) return { ok: false, reason: 'bad_sigma' };
  const r = bytesToBig(sigma64.subarray(0, 32));
  const s = bytesToBig(sigma64.subarray(32, 64));
  if (r < 1n || r >= P256_N) return { ok: false, reason: 'bad_sigma' };
  if (s < 1n || s > P256_HALF_N) return { ok: false, reason: 'bad_sigma' };
  return { ok: true };
}
