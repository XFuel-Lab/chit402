/**
 * Verified Inference — stochastic spot-check sampler (Phase 4, T3b).
 *
 * Decides — VERIFIABLY — whether a task is sampled for a deeper check:
 *
 *   draw    = keccak256(abi.encodePacked(seed, taskId))
 *   sampled = (uint256(draw) % 10000) < rateBps
 *
 * The `seed` is a per-epoch beacon revealed after the epoch, so the draw is unpredictable to
 * the provider up front but auditable afterwards — a provider can't dodge sampling. The deep
 * "check" itself is pluggable (re-execution / attestation compare now; the self-owned ZK proof
 * from Phase 5 later) with no change to this decision or the dispute record.
 *
 * Pure + deterministic. On a mismatch, the orchestrator slashes via contracts/core/ProviderStaking.sol.
 * See docs/VERIFIED_INFERENCE_TIERS.md.
 */
import { keccak256, toUtf8Bytes, solidityPacked, getBytes } from 'ethers';

const ZERO32 = '0x' + '0'.repeat(64);

function seedHash(seed) {
  if (!seed) return ZERO32;
  return /^0x[0-9a-fA-F]{64}$/.test(seed) ? seed : keccak256(toUtf8Bytes(String(seed)));
}

/**
 * Deterministic sampling decision for a task.
 * @param {string} taskId
 * @param {object} opts { seed, rateBps } rateBps ∈ [0,10000]
 * @returns {{ sampled, rate_bps, seed_hash, draw, draw_mod }}
 */
export function shouldSpotCheck(taskId, { seed, rateBps } = {}) {
  const rate = Math.max(0, Math.min(10000, Number(rateBps ?? 0) | 0));
  const sh = seedHash(seed);
  const draw = keccak256(solidityPacked(['bytes32', 'string'], [sh, String(taskId)]));
  const drawMod = Number(BigInt(draw) % 10000n);
  return {
    sampled: rate > 0 && drawMod < rate,
    rate_bps: rate,
    seed_hash: sh,
    draw,
    draw_mod: drawMod,
  };
}

/**
 * Build the spot-check record stamped on a receipt / used by the orchestrator.
 * @param {object} args { taskId, seed, rateBps, method, outcome, expectedOutputHash, observedOutputHash }
 *   method  : how the deep check runs ('reexec-compare' | 'attestation-compare' | 'zk-spotcheck')
 *   outcome : 'not-sampled' | 'pending' | 'pass' | 'mismatch' (set by the orchestrator)
 * @returns spot-check record
 */
export function buildSpotCheckRecord({
  taskId,
  seed,
  rateBps,
  method = 'reexec-compare',
  outcome,
  expectedOutputHash = null,
  observedOutputHash = null,
} = {}) {
  const decision = shouldSpotCheck(taskId, { seed, rateBps });
  let resolvedOutcome = outcome;
  if (!resolvedOutcome) {
    if (!decision.sampled) resolvedOutcome = 'not-sampled';
    else if (expectedOutputHash && observedOutputHash) {
      resolvedOutcome = expectedOutputHash.toLowerCase() === observedOutputHash.toLowerCase() ? 'pass' : 'mismatch';
    } else resolvedOutcome = 'pending';
  }
  return {
    sampled: decision.sampled,
    method,
    outcome: resolvedOutcome,
    rate_bps: decision.rate_bps,
    seed_hash: decision.seed_hash,
    draw: decision.draw,
    expected_output_hash: expectedOutputHash,
    observed_output_hash: observedOutputHash,
    // A mismatch is the slashable condition (orchestrator → ProviderStaking.slash).
    slashable: resolvedOutcome === 'mismatch',
  };
}

/** keccak256 of an output payload (hex passthrough, else utf8) — for compare checks. */
export function outputHashOf(output) {
  if (!output) return ZERO32;
  if (/^0x[0-9a-fA-F]+$/.test(output) && output.length % 2 === 0) return keccak256(getBytes(output));
  return keccak256(toUtf8Bytes(String(output)));
}

export default { shouldSpotCheck, buildSpotCheckRecord, outputHashOf };
