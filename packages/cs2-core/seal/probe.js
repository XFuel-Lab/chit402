/**
 * Counters for the seal suite. Production code only increments them.
 * Reading them is for tests.
 */

let opens = 0;
let aeads = 0;

export function noteOpen() {
  opens += 1;
}

export function noteAead() {
  aeads += 1;
}

export function readOpenAttempts() {
  return opens;
}

export function readAeadCalls() {
  return aeads;
}

export function resetProbes() {
  opens = 0;
  aeads = 0;
}
