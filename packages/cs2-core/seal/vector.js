/**
 * Deterministic seal used by vectors and tests. Not part of the
 * package root.
 */

import { sealFromSeed } from './core.js';

export function sealLineWithSeed(line, bookPk, recoveryPk, seed) {
  return sealFromSeed(line, bookPk, recoveryPk, seed);
}
