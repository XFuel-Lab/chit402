/**
 * Verified Inference — tier selection policy (Phase 4).
 *
 * Pure, deterministic mapping of a task to an assurance TIER (+ Tier-3 MECHANISM), priced to
 * the value at risk. See docs/VERIFIED_INFERENCE_TIERS.md.
 *
 *   tier      : 'signed' | 'settlement' | 'inference'
 *   mechanism : (only when tier === 'inference') 'tee' | 'zk-spotcheck' | 'zk-full'
 *
 * Rules:
 *   1. A per-value floor is chosen from thresholds (bigger value → stronger floor).
 *   2. A task may REQUEST a higher tier (pay for more assurance) — never a lower one.
 *   3. If the resolved tier/mechanism isn't AVAILABLE on this node, degrade to the best
 *      available with an explicit reason (honest; never claims what it can't do).
 *
 * No network, no keys. The gateway calls this once per task; the SDK mirrors it so agents can
 * predict the tier before submitting.
 */

export const TIER_ORDER = Object.freeze(['signed', 'settlement', 'inference']);
export const MECHANISMS = Object.freeze(['tee', 'zk-spotcheck', 'zk-full']);

const tierRank = (t) => {
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? 0 : i;
};

/** Normalize a requested proof_tier hint to a canonical { tier, mechanism } or null. */
export function normalizeRequestedTier(requested) {
  if (!requested) return null;
  const r = String(requested).toLowerCase().trim();
  if (r === 'signed') return { tier: 'signed', mechanism: null };
  if (r === 'settlement') return { tier: 'settlement', mechanism: null };
  if (r === 'inference' || r === 'tee' || r === 't3a') return { tier: 'inference', mechanism: r === 'inference' ? null : 'tee' };
  if (r === 'zk-spotcheck' || r === 'spotcheck' || r === 't3b') return { tier: 'inference', mechanism: 'zk-spotcheck' };
  if (r === 'zk-full' || r === 'full' || r === 't3c') return { tier: 'inference', mechanism: 'zk-full' };
  return null;
}

/**
 * @typedef {object} TierPolicy
 * @property {boolean} enabled        When false → { tier:'settlement'|'signed' } by legacy rules only.
 * @property {string|bigint} tier2Min Value (USDC smallest unit) at/above which the floor is 'settlement'.
 * @property {string|bigint} tier3Min Value at/above which the floor is 'inference'.
 * @property {string|bigint} [tier2MinCogs] Provider COGS at/above which the floor is 'settlement'.
 * @property {string|bigint} [tier3MinCogs] Provider COGS at/above which the floor is 'inference'.
 * @property {string} defaultMechanism  Mechanism for an 'inference' floor ('tee' default).
 * @property {object} available       { settlement:boolean, tee:boolean, 'zk-spotcheck':boolean, 'zk-full':boolean }
 */

/** Read a threshold as bigint, treating unset/blank/unparseable as "not configured". */
function threshold(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  try {
    const n = BigInt(String(v).trim());
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

/** Measured provider cost for this task, if the caller supplied one. */
function cogsOf(task) {
  const raw =
    task?.cogs ??
    task?.providerCogs ??
    task?.provider_cogs?.actual ??
    task?.provider_cogs ??
    null;
  return threshold(raw);
}

/** Best available mechanism at or below a desired one, honoring availability. */
function resolveMechanism(desired, available) {
  const avail = available || {};
  const order = ['zk-full', 'zk-spotcheck', 'tee']; // strongest → weakest
  const start = order.indexOf(desired);
  const from = start < 0 ? order.length - 1 : start;
  for (let i = from; i < order.length; i++) {
    if (avail[order[i]]) return { mechanism: order[i], degraded: order[i] !== desired };
  }
  return { mechanism: null, degraded: true }; // no Tier-3 mechanism available
}

/**
 * Select the assurance tier for a task.
 * @param {object} task    { amount|netAmount, intent:{ amount, proofTier|proof_tier } }
 * @param {TierPolicy} policy
 * @returns {{ tier, mechanism, reason, floor, requested, degraded }}
 */
export function selectTier(task, policy) {
  const p = policy || {};
  const amount = BigInt(task?.intent?.amount ?? task?.amount ?? task?.netAmount ?? 0);
  const requestedRaw = task?.intent?.proofTier ?? task?.intent?.proof_tier ?? task?.proofTier ?? null;
  const requested = normalizeRequestedTier(requestedRaw);

  // Legacy behavior when the tier engine is disabled: settlement if provable, else signed.
  if (!p.enabled) {
    const tier = p.available?.settlement ? 'settlement' : 'signed';
    return { tier, mechanism: null, reason: 'tier engine disabled (legacy)', floor: tier, requested: requested?.tier ?? null, degraded: false };
  }

  // 1. Value-at-risk floor.
  //
  // Thresholds may be denominated in what the buyer pays OR in measured provider
  // COGS, and COGS wins when both are available. Pricing off the buyer's amount
  // makes the floor move whenever we reprice: cost-plus (ADR 0009) cuts prices
  // ~47%, which would silently pull calls below a fixed amount threshold and
  // downgrade assurance we had promised. COGS does not move when we reprice.
  //
  // It also keeps the proof affordable. A Tier-2 proof costs a fixed ~$0.050 per
  // Succinct request (measured 2026-08-14), so bundling one is only solvent when
  // the fee the call earns covers the amortised proof — and the fee is a
  // percentage of COGS. Expressing the gate in COGS makes that a direct
  // comparison instead of an inference through a price list.
  const cogs = cogsOf(task);
  const tier2MinCogs = threshold(p.tier2MinCogs);
  const tier3MinCogs = threshold(p.tier3MinCogs);
  const useCogs = cogs !== null && (tier2MinCogs !== null || tier3MinCogs !== null);

  const basis = useCogs ? cogs : amount;
  const tier2Min = useCogs ? tier2MinCogs : threshold(p.tier2Min);
  const tier3Min = useCogs ? tier3MinCogs : threshold(p.tier3Min);

  let floorTier = 'signed';
  if (tier3Min !== null && basis >= tier3Min) floorTier = 'inference';
  else if (tier2Min !== null && basis >= tier2Min) floorTier = 'settlement';

  // 2. Requested tier may raise (never lower) the floor.
  let targetTier = floorTier;
  let targetMechanism = floorTier === 'inference' ? (p.defaultMechanism || 'tee') : null;
  if (requested && tierRank(requested.tier) > tierRank(targetTier)) {
    targetTier = requested.tier;
    targetMechanism = requested.tier === 'inference' ? (requested.mechanism || p.defaultMechanism || 'tee') : null;
  } else if (requested && requested.tier === 'inference' && targetTier === 'inference' && requested.mechanism) {
    // same tier, but a specific stronger mechanism was requested
    targetMechanism = requested.mechanism;
  }

  // 3. Availability degrade.
  let reason = requested && tierRank(requested.tier) > tierRank(floorTier)
    ? 'requested tier above value floor'
    : `value-at-risk floor (${useCogs ? 'provider cogs' : 'settled amount'})`;
  let degraded = false;

  if (targetTier === 'settlement' && !p.available?.settlement) {
    targetTier = 'signed';
    reason = 'settlement unavailable — degraded to signed';
    degraded = true;
  }

  if (targetTier === 'inference') {
    const { mechanism, degraded: mDeg } = resolveMechanism(targetMechanism, p.available);
    if (!mechanism) {
      // no Tier-3 mechanism → fall back to settlement (or signed)
      targetTier = p.available?.settlement ? 'settlement' : 'signed';
      targetMechanism = null;
      reason = 'no Tier-3 mechanism available — degraded';
      degraded = true;
    } else {
      targetMechanism = mechanism;
      if (mDeg) {
        reason = `mechanism degraded to ${mechanism}`;
        degraded = true;
      }
    }
  }

  return {
    tier: targetTier,
    mechanism: targetMechanism,
    reason,
    floor: floorTier,
    requested: requested?.tier ?? null,
    degraded,
  };
}

export default { TIER_ORDER, MECHANISMS, normalizeRequestedTier, selectTier };
