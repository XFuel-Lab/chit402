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

/**
 * Public-safe description of the proving tier's current availability.
 *
 * Scaling the prover to zero is the single largest fixed-cost saving available
 * (deploy/ecs/README.md), and it is safe precisely because inference and signed
 * receipts are unaffected. It is only safe if it is *visible*: without this, a
 * partner's proofs quietly come back `unavailable` and the first anyone hears of
 * it is a support ticket. Reports posture and reachability, never the key list.
 *
 * @param {boolean} proverConfigured  is an SP1 prover client initialised?
 */
export function proofAvailability(proverConfigured) {
  const allow = parseKeys(process.env.PROVER_ALLOW_KEYS);
  const enabled = process.env.PROVER_ENABLED !== 'false';
  const gated = !enabled || allow.length > 0;

  return {
    // Tier-0 is unconditional: a settled task always returns a signed receipt.
    signed_receipts: 'always',
    settlement_proof: !proverConfigured ? 'unavailable' : gated ? 'allow_listed' : 'open',
    prover_configured: !!proverConfigured,
    allow_list_size: allow.length,
    note: !proverConfigured
      ? 'No SP1 prover is reachable, so Tier-2 settlement proofs are not being generated. Inference and signed receipts are unaffected.'
      : gated
        ? proveGatedReason()
        : 'Tier-2 SP1 settlement proofs are generated for every settled task.',
  };
}

export default { proveAllowedForKey, proveGatedReason, proofAvailability };
