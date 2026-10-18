/**
 * Advisory minimum verifier. Unsigned. Never a trust input.
 * Older chit402-verify releases may print VERIFIED for versions they do not
 * understand. VERIFIER_MIN is the only place the gateway names a version.
 */
// The first release that verifies the v1-pinned receipts. The release before
// it is not a safe minimum: it reports those receipts as invalid.
export const VERIFIER_MIN = '0.4.9';
export const VERIFIER_MIN_HEADER = 'X-Chit-Verifier-Min';
export const VERIFIER_UPGRADE_HINT = 'run npx chit402-verify@latest';
const VERIFIER_MIN_SENTENCE = `Receipts issued after 2026-10-08 need chit402-verify ${VERIFIER_MIN} or newer: ${VERIFIER_UPGRADE_HINT}. Older versions may print VERIFIED for formats they do not understand.`;
export const VERIFIER_MIN_NOTE = `${VERIFIER_MIN_SENTENCE} This hint is unsigned and is not checked.`;
/** Same sentence for HTML pages, already escaped. */
export const VERIFIER_MIN_HTML_HINT = `${VERIFIER_MIN_SENTENCE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} This hint is unsigned.`;

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
