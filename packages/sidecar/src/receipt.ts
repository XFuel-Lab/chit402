/**
 * XFuel Sidecar Receipt Builder
 *
 * Emits XFuel-shaped receipts for foreign OpenAI-compatible providers.
 * Same schema as api.xfuel.app — hub, model, amount, output_hash, payment binding.
 *
 * Per whitepaper: HMAC on a sidecar row means "this client recorded it."
 * The signature is tamper-evident but NOT merchant-attested unless the upstream
 * provider sends an x402 receipt or XFuel verifies the payment on-chain.
 */

import { createHmac, randomBytes, createHash } from 'node:crypto';

export const SIDECAR_RECEIPT_SCHEMA = 'xfuel.receipt.v3';
export const SIDECAR_RECEIPT_SCOPE = 'sidecar';

export interface SidecarReceiptPayment {
  rail: 'usdc' | 'uncollected';
  ref: string | null;
  gross_amount: string;
  net_amount: string;
  fee_amount: string;
  collected: boolean;
  payer?: string;
  payTo?: string;
  collected_at?: string;
}

export interface SidecarReceiptRoute {
  hub: string;
  model: string;
  provider: string;
  resource?: string;
}

export interface SidecarReceiptOutput {
  hash: string;
  kind: 'sha256' | 'keccak256';
}

export interface SidecarReceiptUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  source?: string;
}

export interface SidecarReceiptSignature {
  alg: 'HMAC-SHA256';
  scope: 'sidecar';
  payload_version: number;
  value: string;
  signed_fields: string[];
}

export interface SidecarReceipt {
  schema: typeof SIDECAR_RECEIPT_SCHEMA;
  task_id: string;
  status: 'completed' | 'failed';
  proof_outcome: 'signed';
  verify_url: string | null;
  sidecar: true;
  created_at: string;
  payment: SidecarReceiptPayment;
  route: SidecarReceiptRoute;
  output: SidecarReceiptOutput | null;
  usage: SidecarReceiptUsage | null;
  signature?: SidecarReceiptSignature;
}

export interface UsageParams {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface BuildReceiptParams {
  /** Upstream provider host (e.g. api.openrouter.ai, api.groq.com) */
  hub: string;
  /** Model ID as requested or returned */
  model: string;
  /** USDC amount in atomic units (6 decimals). '0' if uncollected. */
  amount: string;
  /** The output content to hash */
  output: string | null;
  /** Usage from the upstream response */
  usage?: UsageParams | null;
  /** x402 payment reference (network:txHash) or null for uncollected */
  paymentRef?: string | null;
  /** Payer address (from x402 payment) */
  payer?: string;
  /** PayTo address (from 402 challenge) */
  payTo?: string;
  /** HMAC signing secret (optional — omit for unsigned) */
  signingSecret?: string;
  /** XFuel API base URL for verify_url (default: https://api.xfuel.app) */
  xfuelBaseUrl?: string;
  /** Agent ID for ingest linking */
  agentId?: number | string;
}

/**
 * Generate a unique task ID for a sidecar receipt.
 * Format: sidecar-<timestamp-base36>-<random-hex>
 */
export function generateSidecarTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(6).toString('hex');
  return `sidecar-${ts}-${rand}`;
}

/**
 * Hash output content using SHA-256.
 * We use SHA-256 for consistency with the gateway's fallback path.
 */
export function hashOutput(content: string): string {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return `0x${digest}`;
}

/**
 * Canonical, order-stable payload the sidecar signature covers.
 * Subset of the gateway's canonicalSignedPayload — hub, model, amount, output hash.
 */
export function canonicalSidecarPayload(receipt: SidecarReceipt): string {
  return JSON.stringify([
    receipt.task_id,
    receipt.payment.rail,
    receipt.payment.ref,
    receipt.payment.gross_amount,
    receipt.route.hub,
    receipt.route.model,
    receipt.output?.hash ?? null,
    receipt.sidecar,
  ]);
}

/**
 * Sign a sidecar receipt with HMAC-SHA256.
 */
function signReceiptPayload(receipt: SidecarReceipt, secret: string): SidecarReceiptSignature {
  const payload = canonicalSidecarPayload(receipt);
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return {
    alg: 'HMAC-SHA256',
    scope: 'sidecar',
    payload_version: 1,
    value: `sha256=${digest}`,
    signed_fields: [
      'task_id',
      'payment.rail',
      'payment.ref',
      'payment.gross_amount',
      'route.hub',
      'route.model',
      'output.hash',
      'sidecar',
    ],
  };
}

/**
 * Verify a sidecar receipt HMAC.
 */
export function verifySidecarSignature(
  receipt: SidecarReceipt,
  secret: string
): { checked: boolean; valid: boolean | null; expected?: string; recomputed?: string } {
  const sig = receipt.signature;
  if (!sig?.value) return { checked: false, valid: null };
  const payload = canonicalSidecarPayload(receipt);
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const recomputed = `sha256=${digest}`;
  return {
    checked: true,
    valid: recomputed.toLowerCase() === sig.value.toLowerCase(),
    expected: sig.value,
    recomputed,
  };
}

/**
 * Build an XFuel-shaped receipt from a foreign provider response.
 * This is the sidecar's equivalent of the gateway's buildReceipt.
 */
export function buildSidecarReceipt(params: BuildReceiptParams): SidecarReceipt {
  const {
    hub,
    model,
    amount,
    output,
    usage,
    paymentRef,
    payer,
    payTo,
    signingSecret,
    xfuelBaseUrl = 'https://api.xfuel.app',
  } = params;

  const taskId = generateSidecarTaskId();
  const isCollected = !!paymentRef;
  const outputHash = output ? hashOutput(output) : null;

  const receipt: SidecarReceipt = {
    schema: SIDECAR_RECEIPT_SCHEMA,
    task_id: taskId,
    status: 'completed',
    proof_outcome: 'signed',
    verify_url: null, // Set after ingest
    sidecar: true,
    created_at: new Date().toISOString(),
    payment: {
      rail: isCollected ? 'usdc' : 'uncollected',
      ref: paymentRef || null,
      gross_amount: amount,
      net_amount: amount,
      fee_amount: '0',
      collected: isCollected,
      ...(payer && { payer }),
      ...(payTo && { payTo }),
      ...(isCollected && { collected_at: new Date().toISOString() }),
    },
    route: {
      hub,
      model,
      provider: hub,
      resource: `https://${hub}/v1/chat/completions`,
    },
    output: outputHash ? { hash: outputHash, kind: 'sha256' } : null,
    usage: usage
      ? {
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          total_tokens:
            (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) || null,
          source: 'upstream',
        }
      : null,
  };

  if (signingSecret) {
    receipt.signature = signReceiptPayload(receipt, signingSecret);
  }

  return receipt;
}

/**
 * Extract amount from upstream usage (provider-specific).
 * This is a best-effort extraction — accurate billing requires the provider's invoice.
 */
export interface UsageToAmountParams {
  provider: 'openrouter' | 'groq' | 'together' | 'unknown';
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Per-million token price for prompts (USDC atomic, 6 decimals) */
  promptPrice?: number;
  /** Per-million token price for completions (USDC atomic, 6 decimals) */
  completionPrice?: number;
}

export function estimateAmountFromUsage(params: UsageToAmountParams): string {
  const { usage, promptPrice = 0, completionPrice = 0 } = params;
  if (!usage) return '0';

  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;

  const promptCost = Math.floor((prompt / 1_000_000) * promptPrice);
  const completionCost = Math.floor((completion / 1_000_000) * completionPrice);

  return String(promptCost + completionCost);
}
