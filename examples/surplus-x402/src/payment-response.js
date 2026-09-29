import { decodePaymentResponseHeader } from '@x402/fetch';

export class PaymentResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentResponseError';
  }
}

/**
 * Decode the x402 `PAYMENT-RESPONSE` header.
 * Settlement JSON is `{ success, transaction, network, payer }` (base64).
 * `tx` is accepted as an alias for `transaction`.
 */
export function decodeSettlementHeader(header) {
  if (header == null || String(header).trim() === '') {
    throw new PaymentResponseError('PAYMENT-RESPONSE header is missing');
  }

  const raw = String(header).trim();
  let decoded;
  try {
    decoded = decodePaymentResponseHeader(raw);
  } catch {
    throw new PaymentResponseError('PAYMENT-RESPONSE is not valid base64 JSON');
  }

  if (!decoded || typeof decoded !== 'object') {
    throw new PaymentResponseError('PAYMENT-RESPONSE is not a settlement object');
  }
  if (decoded.success === false) {
    const reason = decoded.errorReason || decoded.error || 'settlement failed';
    throw new PaymentResponseError(`PAYMENT-RESPONSE settlement failed: ${reason}`);
  }

  const tx = stringField(decoded.transaction) || stringField(decoded.tx);
  const network = stringField(decoded.network);
  const payer = stringField(decoded.payer);
  if (!tx || !network || !payer) {
    throw new PaymentResponseError(
      'PAYMENT-RESPONSE is missing tx hash, network, or payer',
    );
  }

  return {
    tx,
    network,
    payer,
    amount: stringField(decoded.amount) || undefined,
    raw: decoded,
  };
}

export function settlementHeaderFrom(headers) {
  const bag = headers && typeof headers.get === 'function' ? headers : new Headers(headers || {});
  return bag.get('payment-response') || bag.get('x-payment-response');
}

function stringField(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}
