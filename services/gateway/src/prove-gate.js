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

/** How long a reachability result is trusted before another probe is kicked off. */
const PROBE_TTL_MS = 60_000;

/** @type {{at:number, reachable:boolean|null, inFlight:boolean}} */
let _probe = { at: 0, reachable: null, inFlight: false };

/** Test seam — forget any probed state. */
export function resetProverProbe() {
  _probe = { at: 0, reachable: null, inFlight: false };
}

/**
 * Refresh the cached prover reachability, in the background.
 *
 * Deliberately not awaited by `/health`. `healthCheck()` allows 5s per endpoint,
 * and a prover scaled to zero is exactly when it will burn all of it — blocking
 * on the probe would turn "proofs are off" into "the gateway looks down", which
 * is a worse failure than the one being reported on.
 *
 * @param {{healthCheck?: Function}|null} prover
 * @returns {Promise<void>|null} the in-flight probe, for tests
 */
export function refreshProverProbe(prover, { ttlMs = PROBE_TTL_MS, now = Date.now() } = {}) {
  if (!prover || typeof prover.healthCheck !== 'function') {
    // `at: 0`, not `now` — nothing was asked, so there is no check to timestamp.
    _probe = { at: 0, reachable: null, inFlight: false };
    return null;
  }
  if (_probe.inFlight) return null;
  if (_probe.at && now - _probe.at < ttlMs) return null;

  _probe = { ..._probe, inFlight: true };
  return Promise.resolve()
    .then(() => prover.healthCheck())
    .then((ok) => { _probe = { at: Date.now(), reachable: !!ok, inFlight: false }; })
    .catch(() => { _probe = { at: Date.now(), reachable: false, inFlight: false }; });
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
 * Two things this used to get wrong, both of which read as confident claims:
 *
 * `prover_configured` is what its name says — a URL is set — and was being
 * reported as though it meant a prover was answering. The ECS service was scaled
 * to zero on 2026-08-13 and this endpoint did not change. Reachability is now a
 * separate, probed field, and `null` honestly means "not yet checked" rather
 * than borrowing confidence from the config.
 *
 * The note claimed a proof for *every settled task*. Tier-2 is threshold-gated
 * (`VI_TIER2_MIN_COGS` / `VI_TIER2_MIN_USDC`) and, under ADR 0009, opt-in and
 * separately priced — a proof costs a fixed ~$0.050 against $0.0094 of fee on a
 * median call, so bundling one into every task would lose money on every task.
 *
 * @param {boolean} proverConfigured  is an SP1 prover client initialised?
 * @param {object} [opts]
 * @param {object} [opts.tier2]  threshold + price descriptor for the Tier-2 gate
 */
export function proofAvailability(proverConfigured, { tier2 = null } = {}) {
  const allow = parseKeys(process.env.PROVER_ALLOW_KEYS);
  const enabled = process.env.PROVER_ENABLED !== 'false';
  const gated = !enabled || allow.length > 0;
  const reachable = _probe.reachable;

  // Only claim the proof path is open once something has actually answered.
  const settlement = !proverConfigured || reachable === false
    ? 'unavailable'
    : reachable === null
      ? 'unknown'
      : gated ? 'allow_listed' : 'open';

  let note;
  if (!proverConfigured) {
    note = 'No SP1 prover is configured, so Tier-2 settlement proofs are not being generated. '
      + 'Inference and signed receipts are unaffected.';
  } else if (reachable === false) {
    note = 'An SP1 prover is configured but did not answer its health check, so Tier-2 proofs '
      + 'are not being generated right now. Inference and signed receipts are unaffected.';
  } else if (reachable === null) {
    note = 'An SP1 prover is configured; reachability has not been probed yet, so whether '
      + 'Tier-2 proofs can be produced is unconfirmed.';
  } else if (gated) {
    note = proveGatedReason();
  } else {
    note = 'Tier-2 SP1 settlement proofs are available. They are not produced for every task: '
      + 'a task must clear the Tier-2 threshold, and under ADR 0009 a proof is opt-in and '
      + 'charged separately because its cost is fixed per proof.';
  }

  return {
    // Tier-0 is unconditional: a settled task always returns a signed receipt.
    signed_receipts: 'always',
    settlement_proof: settlement,
    prover_configured: !!proverConfigured,
    // null = not probed yet. Distinct from false, which means it was asked and did not answer.
    prover_reachable: reachable,
    prover_checked_at: _probe.at ? new Date(_probe.at).toISOString() : null,
    allow_list_size: allow.length,
    ...(tier2 ? { tier2 } : {}),
    note,
  };
}

export default {
  proveAllowedForKey,
  proveGatedReason,
  proofAvailability,
  refreshProverProbe,
  resetProverProbe,
};
