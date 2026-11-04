/**
 * Ethereum address: the low 20 bytes of keccak256(X || Y).
 */

import { bytesToHex, uncompressedPoint } from './bytes.js';
import { keccak256 } from './keccak.js';

export function ethereumAddress(publicKey) {
  const point = uncompressedPoint(publicKey);
  const hash = keccak256(point.subarray(1));
  return `0x${bytesToHex(hash.subarray(12))}`;
}
