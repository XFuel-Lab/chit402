/**
 * Payment binding verification — recompute commitments locally.
 *
 * This module mirrors the binding logic from:
 * - services/gateway/src/payment-binding.js
 * - contracts/core/SP1ProofHooks.sol
 *
 * Third parties can verify a receipt's payment binding without trusting XFuel.
 */

import { keccak256, toUtf8Bytes, solidityPacked } from 'ethers';

/** Payment-rail discriminant — must match Solidity and gateway. */
export const PAYMENT_RAIL: Record<string, number> = {
  usdc: 1,
  tfuel: 2,
};

const ZERO32 = '0x' + '0'.repeat(64);

export interface PaymentCommitmentInput {
  paymentRef: string | null;
  taskId: string;
  rail: 'usdc' | 'tfuel' | number;
  amount: string | bigint;
}

export interface PaymentCommitmentResult {
  commitment: string;
  paymentRefHash: string;
  taskIdHash: string;
  railDiscriminant: number;
  amount: string;
}

/**
 * Compute the payment commitment. Mirrors SP1ProofHooks.computePaymentCommitment.
 *
 * ```solidity
 * keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount))
 * ```
 */
export function computePaymentCommitment(input: PaymentCommitmentInput): PaymentCommitmentResult {
  const railDiscriminant = typeof input.rail === 'number'
    ? input.rail
    : (PAYMENT_RAIL[input.rail] ?? 0);

  const paymentRefHash = input.paymentRef
    ? keccak256(toUtf8Bytes(String(input.paymentRef)))
    : ZERO32;

  const taskIdHash = keccak256(toUtf8Bytes(String(input.taskId)));
  const amt = BigInt(input.amount ?? 0);

  const commitment = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [paymentRefHash, taskIdHash, railDiscriminant, amt],
    ),
  );

  return {
    commitment,
    paymentRefHash,
    taskIdHash,
    railDiscriminant,
    amount: amt.toString(),
  };
}

export interface InferenceBindingInput extends PaymentCommitmentInput {
  modelCommitment?: string | null;
  outputHash?: string | null;
}

export interface InferenceBindingResult extends PaymentCommitmentResult {
  modelCommitment: string;
  outputHash: string;
}

/**
 * Compute the PBR (Payment-Bound Receipt) commitment. Mirrors
 * SP1ProofHooks.computeInferenceBindingCommitment.
 *
 * ```solidity
 * keccak256(abi.encodePacked(
 *   paymentRefHash, taskIdHash, rail, amount, modelCommitment, outputHash
 * ))
 * ```
 */
export function computeInferenceBinding(input: InferenceBindingInput): InferenceBindingResult {
  const railDiscriminant = typeof input.rail === 'number'
    ? input.rail
    : (PAYMENT_RAIL[input.rail] ?? 0);

  const paymentRefHash = input.paymentRef
    ? keccak256(toUtf8Bytes(String(input.paymentRef)))
    : ZERO32;

  const taskIdHash = keccak256(toUtf8Bytes(String(input.taskId)));
  const amt = BigInt(input.amount ?? 0);

  const isValid32 = (h: unknown): h is string =>
    typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);

  const modelCommitment = isValid32(input.modelCommitment) ? input.modelCommitment : ZERO32;
  const outputHash = isValid32(input.outputHash) ? input.outputHash : ZERO32;

  const commitment = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256', 'bytes32', 'bytes32'],
      [paymentRefHash, taskIdHash, railDiscriminant, amt, modelCommitment, outputHash],
    ),
  );

  return {
    commitment,
    paymentRefHash,
    taskIdHash,
    railDiscriminant,
    amount: amt.toString(),
    modelCommitment,
    outputHash,
  };
}
