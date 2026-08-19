/**
 * Tier-1 receipt helpers that do not need ethers.
 *
 * HMAC verify lives here so a partner can check tamper-evidence without
 * importing `xfuel-sdk/onchain` (that entry hard-requires the ethers peer).
 * This is operator tamper-evidence, not a third-party settlement proof.
 * Keep the field list in lockstep with `canonicalSignedPayload` in
 * services/gateway/src/receipt.js.
 */

import { createHmac } from 'node:crypto';

export interface ReceiptSignatureCheck {
  /** Whether a signature was present to check. */
  checked: boolean;
  /** True if the recomputed HMAC matches; null when nothing was checked. */
  valid: boolean | null;
  expected?: string;
  recomputed?: string;
}

/**
 * Canonical, order-stable payload a receipt signature covers. MUST match
 * `canonicalSignedPayload` in services/gateway/src/receipt.js (same fields + order).
 * Payload version 3 signs gross, protocol fee, platform fee, and provider COGS
 * so a buyer can recompute `max(floor, cogs × 1.10)` against the USDC they sent.
 */
export function canonicalReceiptPayload(receipt: Record<string, unknown>): string {
  const r = receipt as {
    task_id?: string;
    payment?: {
      rail?: string;
      ref?: string;
      gross_amount?: string;
      net_amount?: string;
      fee_amount?: string;
      protocol_fee_bps?: number;
      fee_bps?: number;
      platform_fee?: string;
      platform_fee_bps?: number;
    };
    provider_cogs?: { actual?: string };
    route?: { model?: string; model_commitment?: { commitment?: string }; provider?: string };
    output?: { hash?: string };
    binding?: { expected_commitment?: string };
  };
  return JSON.stringify([
    r.task_id ?? null,
    r.payment?.rail ?? null,
    r.payment?.ref ?? null,
    r.payment?.gross_amount ?? null,
    r.payment?.net_amount ?? null,
    r.payment?.fee_amount ?? null,
    r.payment?.protocol_fee_bps ?? r.payment?.fee_bps ?? null,
    r.payment?.platform_fee ?? null,
    r.payment?.platform_fee_bps ?? null,
    r.provider_cogs?.actual ?? null,
    r.route?.model ?? null,
    r.route?.model_commitment?.commitment ?? null,
    r.route?.provider ?? null,
    r.output?.hash ?? null,
    r.binding?.expected_commitment ?? null,
  ]);
}

/**
 * Verify a receipt's Tier-1 HMAC signature (tamper-evidence over the payment-bound tuple).
 * Requires the shared signing secret (server `RECEIPT_SIGNING_SECRET`).
 */
export function verifyReceiptSignature(
  receipt: Record<string, unknown>,
  secret: string,
): ReceiptSignatureCheck {
  const sig = (receipt as { signature?: { value?: string } }).signature;
  if (!sig?.value) return { checked: false, valid: null };
  const digest = createHmac('sha256', secret).update(canonicalReceiptPayload(receipt), 'utf8').digest('hex');
  const recomputed = `sha256=${digest}`;
  return {
    checked: true,
    valid: recomputed.toLowerCase() === String(sig.value).toLowerCase(),
    expected: sig.value,
    recomputed,
  };
}
