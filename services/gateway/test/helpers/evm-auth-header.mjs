/**
 * Test fixture: an EIP-3009-shaped x402 payment header (unsigned) for a mock
 * facilitator. The gateway refuses EVM payment headers that do not decode to
 * a complete authorization (from, to, value, validBefore, bytes32 nonce,
 * signature), so fixtures carry one.
 * Same label → same header (replay tests resend identical bytes). Each label
 * gets its own nonce. `to` defaults to the test gateway's X402_PAY_TO.
 */
import crypto from 'node:crypto';

export const FIXTURE_FROM = `0x${'5a'.repeat(20)}`;
export const FIXTURE_PAY_TO = '0x7000000000000000000000000000000000000001';
// One validBefore per test process, an hour out, so a label still maps to the
// same bytes and the gateway's validity window accepts it.
const VALID_BEFORE = String(Math.floor(Date.now() / 1000) + 3600);

let seq = 0;

// No label: a fresh authorization per call. Pass a label to resend the same bytes.
export function evmAuthHeader(label = `PAYMENT-BLOB-${++seq}`, { value = '1000000000000', version = 1, from = FIXTURE_FROM, to = process.env.X402_PAY_TO || FIXTURE_PAY_TO } = {}) {
  const nonce = `0x${crypto.createHash('sha256').update(`chit402-fixture:${label}`).digest('hex')}`;
  const authorization = { from, to, value, validAfter: '0', validBefore: VALID_BEFORE, nonce };
  const body = version === 2
    ? { x402Version: 2, label, payload: { signature: `0x${'00'.repeat(65)}`, authorization } }
    : { x402Version: 1, label, payload: { signature: `0x${'00'.repeat(65)}`, authorization } };
  return Buffer.from(JSON.stringify(body)).toString('base64');
}
