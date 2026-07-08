/**
 * Prove-gate — cost control for ZK proof generation (Tier 1).
 *
 * Every settled task always returns a Tier-0 signed receipt (route, model, cost,
 * output hash). The expensive Tier-1 SP1 settlement proof is optional and gated
 * here so a public/live demo doesn't burn prover budget on every request.
 *
 * Decision inputs (env):
 *   PROVER_ENABLED       "false" → proving OFF for everyone EXCEPT allow-listed
 *                        keys. Anything else (unset/"true") → proving ON, still
 *                        subject to PROVER_ALLOW_KEYS if that list is non-empty.
 *   PROVER_ALLOW_KEYS    CSV of API keys permitted to trigger proofs. When
 *                        non-empty it is authoritative: ONLY these keys prove,
 *                        regardless of PROVER_ENABLED. When empty and
 *                        PROVER_ENABLED is not "false", all authenticated keys
 *                        may prove (legacy behavior).
 *
 * Typical live-demo config: PROVER_ENABLED=false + PROVER_ALLOW_KEYS=<team keys>
 * → the public sees signed receipts; only whitelisted partners spend prover time.
 * Pair with an ECS service scaled to desiredCount=0 (see deploy/ecs/README.md)
 * so the prover container also costs nothing while off.
 */

function parseKeys(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decide whether a request authenticated with `apiKey` may trigger a ZK proof.
 * @param {string|undefined|null} apiKey  the request's X-API-Key
 * @returns {boolean}
 */
export function proveAllowedForKey(apiKey) {
  const allow = parseKeys(process.env.PROVER_ALLOW_KEYS);
  const enabled = process.env.PROVER_ENABLED !== 'false';

  // An explicit allow-list is authoritative in both states.
  if (allow.length > 0) return !!apiKey && allow.includes(apiKey);

  // No allow-list → global switch decides.
  return enabled;
}

/** Human-readable reason for a receipt when proving was gated off. */
export function proveGatedReason() {
  const allow = parseKeys(process.env.PROVER_ALLOW_KEYS);
  if (process.env.PROVER_ENABLED === 'false') {
    return allow.length
      ? 'ZK proving is off for this key (allow-listed teams only). Signed receipt provided; on-chain proof available on request.'
      : 'ZK proving is currently disabled to control cost. Signed receipt provided; on-chain proof available on request.';
  }
  if (allow.length) {
    return 'ZK proving is restricted to allow-listed keys. Signed receipt provided; on-chain proof available on request.';
  }
  return 'ZK proving skipped.';
}

export default { proveAllowedForKey, proveGatedReason };
