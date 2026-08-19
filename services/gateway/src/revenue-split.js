/**
 * revenue-split.js — token-light USDC revenue split (ADR 0001).
 *
 * XFuel earns fees in USDC on Base (x402). Per ADR 0001 the per-task hot path does
 * NO tokenomics: the fee simply lands at ONE address — a Splits v2 Split — which
 * fans the USDC out to the protocol buckets OFF the hot path (pull-flow, batched).
 * The Split's owner is the protocol Safe / veXF governance, so percentages are
 * adjustable on-chain without redeploying and without any bespoke Solidity.
 *
 * This module is the single source of truth for:
 *   1. the bucket definition (who gets what share of protocol revenue), and
 *   2. the deterministic Splits v2 `Split` config used to deploy/verify that Split.
 *
 * It is intentionally pure (no network, no keys) so it is unit-testable and can be
 * imported by the deploy tooling, the receipt/telemetry surfaces (transparency), and
 * tests alike.
 *
 * Buckets (token-light; XF value accrual is DOWNSTREAM treasury policy, not a per-task
 * rake). Defaults are illustrative and owner-adjustable — governance sets the real
 * values on the Split:
 *   - treasury : operations / runway
 *   - buyback  : USDC slice reserved for XF buyback-and-burn on Base (scheduled treasury op)
 *   - stakers  : optional veXF USDC yield — governance-set, not a fixed entitlement
 */

/** BPS scale — bucket allocations must sum to this. */
export const TOTAL_BPS = 10000;

/**
 * Bucket registry: key → { label, default bps, env var names }.
 * Order is stable and defines the on-chain recipients/allocations ordering.
 */
export const BUCKETS = [
  { key: 'treasury', label: 'Treasury / Ops', defaultBps: 4000, addrEnv: 'REVENUE_TREASURY_ADDRESS', bpsEnv: 'REVENUE_TREASURY_BPS' },
  { key: 'buyback',  label: 'XF Buyback-Burn (Base, post-TGE)', defaultBps: 3500, addrEnv: 'REVENUE_BUYBACK_ADDRESS', bpsEnv: 'REVENUE_BUYBACK_BPS' },
  { key: 'stakers',  label: 'veXF Stakers (optional USDC yield)', defaultBps: 2500, addrEnv: 'REVENUE_STAKERS_ADDRESS', bpsEnv: 'REVENUE_STAKERS_BPS' },
];

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function parseBps(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Resolve the configured split from an env-like object (defaults to process.env).
 * A single `REVENUE_SPLIT` JSON ({ treasury:{address,bps}, ... }) overrides the
 * per-bucket env vars when present.
 *
 * @param {Record<string,string>} [env=process.env]
 * @returns {{ buckets: Array<{key,label,address,bps}>, totalBps: number }}
 */
export function resolveSplit(env = process.env) {
  let json = null;
  if (env.REVENUE_SPLIT) {
    try { json = JSON.parse(env.REVENUE_SPLIT); } catch { json = null; }
  }

  const buckets = BUCKETS.map((b) => {
    const j = json && json[b.key] ? json[b.key] : null;
    const address = (j && j.address) || env[b.addrEnv] || null;
    const bps = j && j.bps != null ? parseBps(j.bps, b.defaultBps) : parseBps(env[b.bpsEnv], b.defaultBps);
    return { key: b.key, label: b.label, address: address || null, bps };
  });

  const totalBps = buckets.reduce((s, b) => s + b.bps, 0);
  return { buckets, totalBps };
}

/**
 * Validate a resolved split.
 * @param {ReturnType<typeof resolveSplit>} split
 * @param {{ requireAddresses?: boolean }} [opts]  when true, every non-zero bucket
 *        must have a valid 0x address (enforced before on-chain deployment).
 * @returns {string[]} list of human-readable errors (empty = valid)
 */
export function validateSplit(split, opts = {}) {
  const errors = [];
  if (!split || !Array.isArray(split.buckets)) {
    return ['split is empty'];
  }
  if (split.totalBps !== TOTAL_BPS) {
    errors.push(`bucket bps must sum to ${TOTAL_BPS}, got ${split.totalBps}`);
  }
  for (const b of split.buckets) {
    if (b.bps < 0) errors.push(`${b.key}: negative bps`);
    if (opts.requireAddresses && b.bps > 0 && !ADDR_RE.test(b.address || '')) {
      errors.push(`${b.key}: missing/invalid address (bps=${b.bps})`);
    }
  }
  return errors;
}

/**
 * Produce the Splits v2 `Split` struct config for deployment/verification.
 * Only buckets with bps > 0 AND a valid address are included as recipients.
 *
 * Splits v2 `SplitV2Lib.Split`:
 *   { recipients: address[], allocations: uint256[], totalAllocation: uint256, distributionIncentive: uint16 }
 * We use bps as allocations with totalAllocation = sum(allocations), so the on-chain
 * proportions equal our bucket bps exactly.
 *
 * @param {ReturnType<typeof resolveSplit>} split
 * @param {{ distributionIncentive?: number }} [opts]  distributor incentive (uint16), default 0
 * @returns {{ recipients: string[], allocations: number[], totalAllocation: number, distributionIncentive: number }}
 */
export function toSplitsV2Config(split, opts = {}) {
  const active = split.buckets.filter((b) => b.bps > 0 && ADDR_RE.test(b.address || ''));
  const recipients = active.map((b) => b.address);
  const allocations = active.map((b) => b.bps);
  const totalAllocation = allocations.reduce((s, a) => s + a, 0);
  return {
    recipients,
    allocations,
    totalAllocation,
    distributionIncentive: Number.isInteger(opts.distributionIncentive) ? opts.distributionIncentive : 0,
  };
}

/**
 * Split a gross USDC fee (smallest units, 6dp) into per-bucket amounts using integer
 * math, assigning any remainder (from flooring) to the last active bucket so the parts
 * always sum exactly to the input.
 *
 * @param {string|bigint|number} feeAmount  smallest-unit USDC
 * @param {ReturnType<typeof resolveSplit>} split
 * @returns {Array<{ key:string, label:string, address:string|null, bps:number, amount:string }>}
 */
export function splitFee(feeAmount, split) {
  const total = BigInt(feeAmount);
  const bpsTotal = BigInt(split.totalBps || TOTAL_BPS);
  const out = [];
  let assigned = 0n;
  for (let i = 0; i < split.buckets.length; i++) {
    const b = split.buckets[i];
    let amount;
    if (i === split.buckets.length - 1) {
      amount = total - assigned; // remainder → last bucket (exact sum)
    } else {
      amount = (total * BigInt(b.bps)) / bpsTotal;
      assigned += amount;
    }
    out.push({ key: b.key, label: b.label, address: b.address, bps: b.bps, amount: amount.toString() });
  }
  return out;
}

/**
 * Human-readable description for receipts / telemetry / transparency surfaces.
 * @param {ReturnType<typeof resolveSplit>} split
 */
export function describeSplit(split) {
  const live = [];
  const postTge = [];
  for (const b of split.buckets) {
    const row = { key: b.key, label: b.label, bps: b.bps, pct: b.bps / 100, address: b.address };
    if (b.address) live.push(row);
    else postTge.push({ key: b.key, label: b.label, bps: b.bps, pct: b.bps / 100, live: false });
  }
  return {
    model: 'usdc-base-splits-v2',
    note: 'Token-light: fee lands at one Splits v2 address on Base; buckets fan out off the hot path. XF buyback-burn is post-TGE treasury policy (ADR 0001), not a live split.',
    totalBps: split.totalBps,
    buckets: live,
    ...(postTge.length ? { post_tge: { live: false, buckets: postTge } } : {}),
  };
}
