/**
 * Nonce source for seller signatures.
 * Production uses RFC 6979. Tests may install a hook from this file.
 * The package root does not export the hook.
 */

import { bigToBytes } from '../cs2-core/ecdsa/bytes.js';
import { rfc6979Nonce } from './rfc6979.mjs';

let hook = null;

export function setNonceHookForTests(fn) {
  hook = typeof fn === 'function' ? fn : null;
}

export function nonceFor(digest, scalar, order) {
  if (hook) {
    const k = hook(digest, scalar, order);
    if (typeof k !== 'bigint' || k <= 0n || k >= order) return null;
    return k;
  }
  if (!(digest instanceof Uint8Array) || digest.length !== 32) return null;
  const x = typeof scalar === 'bigint' ? bigToBytes(scalar, 32) : scalar;
  return rfc6979Nonce(digest, x, order);
}
