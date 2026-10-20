/**
 * Test fixture: an EIP-3009-shaped x402 payment header (unsigned) for a mock
 * facilitator. The gateway refuses EVM payment headers that do not decode to
 * an authorization with a bytes32 nonce, so fixtures carry one.
 * Same label → same header (replay tests resend identical bytes). Each label
 * gets its own nonce.
 */
import crypto from 'node:crypto';

export function evmAuthHeader(label = 'PAYMENT-BLOB', { value = '1000000000000', version = 1 } = {}) {
  const nonce = `0x${crypto.createHash('sha256').update(`chit402-fixture:${label}`).digest('hex')}`;
  const authorization = { value, validAfter: '0', validBefore: '9999999999', nonce };
  const body = version === 2
    ? { x402Version: 2, label, payload: { signature: `0x${'00'.repeat(65)}`, authorization } }
    : { x402Version: 1, label, payload: { signature: `0x${'00'.repeat(65)}`, authorization } };
  return Buffer.from(JSON.stringify(body)).toString('base64');
}
