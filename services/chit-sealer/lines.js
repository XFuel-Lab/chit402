/**
 * Core v13 lines for the sealer.
 *
 * A core line is algorithm 0x00 and 64 zero signature bytes, with a
 * seller key id of 32 zero bytes. A missing seller signature is accepted.
 * Any other sigma block or a non-zero seller key id is the line codec's
 * bad_sigma. The rest of a core line is checked by decoding a patched
 * copy (algorithm 0x01 and a low-S stand-in) so the codec's structural
 * rules apply. The bytes that are sealed are the original line.
 *
 * Payments above P_MAX are refused with one body and one status.
 * P_MAX itself is allowed. bind-v1 is not checked. Cap rows are not read.
 */

import {
  CONTENT_FIELDS,
  LAYOUT,
  decodeLine,
} from '../../packages/cs2-core/line/index.mjs';

/** 100 USDC in base units (USDC has 6 decimals). */
export const P_MAX = 100_000_000;

export const P_MAX_STATUS = 400;

export const P_MAX_BODY = Object.freeze({ error: 'payment_refused' });

const LOW_SIGMA = (() => {
  const bytes = new Uint8Array(64);
  bytes[31] = 1;
  bytes[63] = 1;
  return bytes;
})();

function sellerKeyOffset() {
  let at = LAYOUT.content;
  for (const [name, size] of CONTENT_FIELDS) {
    if (name === 'sellerKeyId') return at;
    at += size;
  }
  return -1;
}

const SELLER_KEY_AT = sellerKeyOffset();
const SELLER_KEY_LEN = 32;

function zeros(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) return false;
  for (let i = 0; i < length; i += 1) {
    if (bytes[offset + i] !== 0) return false;
  }
  return true;
}

function corePattern(line) {
  return zeros(line, LAYOUT.sigma, LAYOUT.sigmaBytes)
    && zeros(line, SELLER_KEY_AT, SELLER_KEY_LEN);
}

function patched(line) {
  const copy = new Uint8Array(line);
  copy[LAYOUT.sigma] = 1;
  copy.set(LOW_SIGMA, LAYOUT.sigma + 1);
  return copy;
}

export function paymentRefused() {
  return {
    ok: false,
    status: P_MAX_STATUS,
    reason: 'payment_refused',
    body: P_MAX_BODY,
  };
}

/**
 * Accept one core line. Non-core sigma is bad_sigma. A payment value
 * above P_MAX is payment_refused. The returned line is the original bytes.
 * @param {Uint8Array} line
 */
export function acceptCoreLine(line) {
  if (!(line instanceof Uint8Array)) return { ok: false, reason: 'bad_type' };
  if (line.length !== 1024) return { ok: false, reason: 'bad_length' };
  if (!corePattern(line)) return { ok: false, reason: 'bad_sigma' };
  const decoded = decodeLine(patched(line));
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const value = decoded.payment.value;
  if (typeof value !== 'bigint' || value < 0n) return { ok: false, reason: 'bad_uint' };
  if (value > BigInt(P_MAX)) return paymentRefused();
  return {
    ok: true,
    line,
    payment: decoded.payment,
    content: decoded.content,
  };
}
