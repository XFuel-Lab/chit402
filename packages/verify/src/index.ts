/**
 * @xfuel/verify — Offline verification for XFuel receipts.
 *
 * Verify payment binding and output commitment WITHOUT calling the XFuel API.
 * Third parties use this to confirm:
 *   1. The receipt's payment binding matches on-chain settlement
 *   2. The output hash commitment is correct
 *   3. (Optional) The SP1 nullifier is anchored on-chain
 *
 * See docs/specs/RECEIPT_V2_SEMANTICS.md for the verification algorithm.
 */

import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
import {
  computePaymentCommitment,
  computeInferenceBinding,
  type PaymentCommitmentInput,
  type InferenceBindingInput,
} from './binding.js';

export {
  computePaymentCommitment,
  computeInferenceBinding,
  type PaymentCommitmentInput,
  type InferenceBindingInput,
};

/** ZKVerifierSP1 contract on Base mainnet. */
export const ZK_VERIFIER_ADDRESS = '0x9373499645292715a2275A78eD65B14215C41c06';

/** Default Base mainnet RPC. */
export const BASE_RPC_URL = 'https://mainnet.base.org';

/** Base Sepolia testnet RPC. */
export const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

/** Minimal ABI for nullifier check. */
const ZK_VERIFIER_ABI = [
  'function usedNullifiers(bytes32) view returns (bool)',
];

/** XFuel receipt (v2/v3 compatible). */
export interface XFuelReceipt {
  schema?: string;
  task_id: string;
  status: string;
  proof_outcome?: string;
  verify_url?: string;
  route?: {
    model?: string;
    provider?: string;
    model_commitment?: {
      commitment?: string;
    } | null;
  };
  payment?: {
    rail?: string;
    ref?: string | null;
    gross_amount?: string;
    net_amount?: string;
  };
  output?: {
    hash?: string;
    kind?: string;
  } | null;
  proof?: {
    tier?: string;
    has_proof?: boolean;
    nullifier?: string | null;
  };
  binding?: {
    expected_commitment?: string;
    recomputed_commitment?: string;
    matches?: boolean;
    covers?: string[];
    model_commitment?: string | null;
    output_hash?: string | null;
    amount?: string;
    rail?: string;
  } | null;
  signature?: {
    alg?: string;
    value?: string;
  };
}

export interface BindingVerification {
  verified: boolean;
  expected: string | null;
  recomputed: string | null;
  matches: boolean;
  covers: string[];
  reason?: string;
}

export interface NullifierVerification {
  verified: boolean;
  nullifier: string | null;
  anchored: boolean | null;
  reason?: string;
}

export interface ReceiptVerification {
  receipt_id: string;
  binding: BindingVerification;
  nullifier: NullifierVerification;
  output_hash: string | null;
  hub: string | null;
  model: string | null;
  amount_usdc: string | null;
  tx: string | null;
  overall: 'verified' | 'partial' | 'failed';
  errors: string[];
}

/**
 * Verify a receipt's payment binding locally (no network required).
 *
 * This recomputes the commitment from the receipt's fields and compares
 * it to the stored `binding.expected_commitment`.
 */
export function verifyBinding(receipt: XFuelReceipt): BindingVerification {
  const binding = receipt.binding;
  if (!binding) {
    return {
      verified: false,
      expected: null,
      recomputed: null,
      matches: false,
      covers: [],
      reason: 'No binding present on receipt (may be unmetered or TFUEL rail)',
    };
  }

  const paymentRef = receipt.payment?.ref ?? null;
  const taskId = receipt.task_id;
  const rail = (binding.rail || receipt.payment?.rail || 'usdc') as 'usdc' | 'tfuel';
  const amount = binding.amount || receipt.payment?.net_amount || '0';
  const covers = binding.covers || ['payment', 'settlement'];

  // Determine if this is a PBR (includes model + output)
  const bindsInference = covers.includes('inference') ||
    !!(binding.model_commitment && binding.output_hash);

  let recomputed: string;
  try {
    if (bindsInference) {
      const result = computeInferenceBinding({
        paymentRef,
        taskId,
        rail,
        amount,
        modelCommitment: binding.model_commitment,
        outputHash: binding.output_hash,
      });
      recomputed = result.commitment;
    } else {
      const result = computePaymentCommitment({
        paymentRef,
        taskId,
        rail,
        amount,
      });
      recomputed = result.commitment;
    }
  } catch (err) {
    return {
      verified: false,
      expected: binding.expected_commitment || null,
      recomputed: null,
      matches: false,
      covers,
      reason: `Failed to recompute commitment: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const expected = binding.expected_commitment || null;
  const matches = !!(
    expected &&
    recomputed &&
    expected.toLowerCase() === recomputed.toLowerCase()
  );

  return {
    verified: true,
    expected,
    recomputed,
    matches,
    covers,
    reason: matches ? undefined : 'Commitment mismatch — receipt may be tampered',
  };
}

/**
 * Verify a receipt's nullifier is anchored on-chain.
 *
 * Requires network access to the Base RPC.
 */
export async function verifyNullifier(
  receipt: XFuelReceipt,
  options: { rpcUrl?: string; verifierAddress?: string } = {},
): Promise<NullifierVerification> {
  const nullifier = receipt.proof?.nullifier ?? null;

  if (!nullifier) {
    return {
      verified: false,
      nullifier: null,
      anchored: null,
      reason: 'No nullifier present (Tier-1 receipt or proof pending)',
    };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(nullifier)) {
    return {
      verified: false,
      nullifier,
      anchored: null,
      reason: 'Invalid nullifier format',
    };
  }

  const rpcUrl = options.rpcUrl || BASE_RPC_URL;
  const verifierAddress = options.verifierAddress || ZK_VERIFIER_ADDRESS;

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const contract = new Contract(verifierAddress, ZK_VERIFIER_ABI, provider);
    const isUsed: boolean = await contract.usedNullifiers(nullifier);

    return {
      verified: true,
      nullifier,
      anchored: isUsed,
      reason: isUsed ? undefined : 'Nullifier not found on-chain (proof may not be submitted yet)',
    };
  } catch (err) {
    return {
      verified: false,
      nullifier,
      anchored: null,
      reason: `Chain query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Canonical signed payload for HMAC verification.
 * Matches services/gateway/src/receipt.js:canonicalSignedPayload
 */
export function canonicalSignedPayload(receipt: XFuelReceipt): string {
  return JSON.stringify([
    receipt.task_id ?? null,
    receipt.payment?.rail ?? null,
    receipt.payment?.ref ?? null,
    receipt.payment?.gross_amount ?? null,
    receipt.payment?.net_amount ?? null,
    // fee_amount not directly available, use null
    null,
    // protocol_fee_bps
    null,
    // platform_fee
    null,
    // platform_fee_bps
    null,
    // provider_cogs.actual
    null,
    receipt.route?.model ?? null,
    receipt.route?.model_commitment?.commitment ?? null,
    receipt.route?.provider ?? null,
    receipt.output?.hash ?? null,
    receipt.binding?.expected_commitment ?? null,
  ]);
}

/**
 * Hash the canonical payload (for ERC-8004 response_hash).
 */
export function hashCanonicalPayload(receipt: XFuelReceipt): string {
  return keccak256(toUtf8Bytes(canonicalSignedPayload(receipt)));
}

/**
 * Full receipt verification — binding + optional nullifier check.
 *
 * @param receipt The XFuel receipt JSON
 * @param options.checkNullifier Whether to verify nullifier on-chain (requires network)
 * @param options.rpcUrl RPC URL for on-chain checks
 */
export async function verifyReceipt(
  receipt: XFuelReceipt,
  options: {
    checkNullifier?: boolean;
    rpcUrl?: string;
    verifierAddress?: string;
  } = {},
): Promise<ReceiptVerification> {
  const errors: string[] = [];

  // Verify binding locally
  const binding = verifyBinding(receipt);
  if (!binding.matches && binding.expected) {
    errors.push('Payment binding mismatch');
  }

  // Verify nullifier on-chain if requested
  let nullifier: NullifierVerification;
  if (options.checkNullifier && receipt.proof?.nullifier) {
    nullifier = await verifyNullifier(receipt, {
      rpcUrl: options.rpcUrl,
      verifierAddress: options.verifierAddress,
    });
    if (nullifier.verified && nullifier.anchored === false) {
      errors.push('Nullifier not anchored on-chain');
    }
  } else {
    nullifier = {
      verified: false,
      nullifier: receipt.proof?.nullifier ?? null,
      anchored: null,
      reason: options.checkNullifier
        ? 'No nullifier present'
        : 'On-chain check not requested',
    };
  }

  // Extract frozen fields
  const hub = receipt.route?.provider ?? null;
  const model = receipt.route?.model ?? null;
  const amount_usdc = receipt.payment?.gross_amount ?? null;
  const tx = receipt.payment?.ref ?? null;
  const output_hash = receipt.output?.hash ?? null;

  // Determine overall status
  let overall: 'verified' | 'partial' | 'failed';
  if (binding.matches && (!options.checkNullifier || nullifier.anchored)) {
    overall = 'verified';
  } else if (binding.matches || (nullifier.verified && nullifier.anchored)) {
    overall = 'partial';
  } else if (!binding.expected && !receipt.proof?.nullifier) {
    // No binding to verify (unmetered/demo) — not a failure
    overall = 'partial';
  } else {
    overall = 'failed';
  }

  return {
    receipt_id: receipt.task_id,
    binding,
    nullifier,
    output_hash,
    hub,
    model,
    amount_usdc,
    tx,
    overall,
    errors,
  };
}

export default {
  verifyBinding,
  verifyNullifier,
  verifyReceipt,
  computePaymentCommitment,
  computeInferenceBinding,
  canonicalSignedPayload,
  hashCanonicalPayload,
  ZK_VERIFIER_ADDRESS,
  BASE_RPC_URL,
  BASE_SEPOLIA_RPC_URL,
};
