/**
 * Thrown when the gateway refuses a hold. append() and the before-hook
 * let this propagate. @x402/core runs before-hooks before the scheme
 * signs, and it does not catch a throw, so the payment is not signed.
 */
export class SpendHoldError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, body?: object }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'SpendHoldError';
    this.code = info.code || 'spend_hold_error';
    this.status = info.status || 0;
    this.body = info.body || null;
  }
}

export class SpendCapExceeded extends SpendHoldError {
  /**
   * @param {object} body Gateway ceiling body (`error.code` is CEILING_EXCEEDED).
   */
  constructor(body) {
    const error = body?.error || body || {};
    super(error.message || 'Prepaid spend ceiling would be exceeded by this payment', {
      code: 'CEILING_EXCEEDED',
      status: 409,
      body,
    });
    this.name = 'SpendCapExceeded';
    this.remaining = error.remaining ?? null;
    this.requested = error.requested ?? null;
  }
}
