/**
 * Store contract for one sigma per payment.
 * Production must pass one shared durable store into every seller instance.
 * claim(id) is atomic. release(id) undoes a claim that did not finish.
 * has(id) reports a live claim. Two stores mean the same payment can be
 * signed twice. The in-memory helper lives under testing/ and is not a default.
 */

export const STORE_FIELDS = Object.freeze(['claim', 'release', 'has']);
