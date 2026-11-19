/**
 * Store contract for one sigma per payment.
 * Production must pass one shared durable store into every seller instance.
 * claim, release, and has may be async. Only an explicit true from claim
 * is a take. Anything else, including a thrown error, is a refusal.
 * has(id) reports a live claim. Two stores mean the same payment can be
 * signed twice. The in-memory helper lives under testing/ and is not a default.
 */

export const STORE_FIELDS = Object.freeze(['claim', 'release', 'has']);
