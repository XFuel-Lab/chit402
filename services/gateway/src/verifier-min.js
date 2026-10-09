/**
 * Advisory minimum verifier. Unsigned. Never a trust input.
 * Older @xfuel/verify releases may print VERIFIED for versions they do not
 * understand. 0.3.5 is the first release that fails those closed.
 */
export const VERIFIER_MIN = '0.3.5';
export const VERIFIER_MIN_HEADER = 'X-Chit-Verifier-Min';
export const VERIFIER_MIN_NOTE = 'Receipts issued after 2026-10-08 require @xfuel/verify >= 0.3.5. Older versions may print VERIFIED for formats they do not understand. This hint is unsigned and is not checked.';

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
