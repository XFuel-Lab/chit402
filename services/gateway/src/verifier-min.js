/**
 * Advisory minimum verifier. Unsigned. Never a trust input.
 * 0.4.8 is the first release that checks the typ of each issuer-JWS slot
 * and requires a receipt signature to cover the receipt.
 */
export const VERIFIER_MIN = '0.4.8';
export const VERIFIER_MIN_HEADER = 'X-Chit-Verifier-Min';
export const VERIFIER_MIN_NOTE = 'Use @xfuel/verify 0.4.8 or later. Older versions may print VERIFIED for documents they should refuse. This hint is unsigned and is not checked.';

export function withVerifierAdvisory(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { ...body, verifier_min: VERIFIER_MIN };
}

export function receiptPolicyAdvisory() {
  return {
    schema: 'chit402.receipt_policy_advisory.v1',
    verifier_min: VERIFIER_MIN,
    note: VERIFIER_MIN_NOTE,
    unsigned: true,
  };
}
