/**
 * Advisory minimum verifier. Unsigned. Never a trust input.
 * Older @xfuel/verify releases may print VERIFIED for versions they do not
 * understand. 0.3.5 is the first release that fails those closed.
 */
// 0.4.9 is the first release that verifies the v1-pinned receipts.
// 0.4.8 is not a safe minimum: it reports those receipts as invalid.
export const VERIFIER_MIN = '0.4.9';
export const VERIFIER_MIN_HEADER = 'X-Chit-Verifier-Min';
const VERIFIER_MIN_SENTENCE = `Receipts issued after 2026-10-08 require @xfuel/verify >= ${VERIFIER_MIN}. Older versions may print VERIFIED for formats they do not understand.`;
export const VERIFIER_MIN_NOTE = `${VERIFIER_MIN_SENTENCE} This hint is unsigned and is not checked.`;
/** Same sentence for HTML pages, already escaped. */
export const VERIFIER_MIN_HTML_HINT = `${VERIFIER_MIN_SENTENCE.replace('>=', '&gt;=')} This hint is unsigned.`;

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
