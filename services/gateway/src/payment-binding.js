/**
 * Phase 2 — x402 payment binding.
 *
 * Computes a deterministic *payment commitment* that binds an off-chain x402
 * settlement (`payment_ref` = "<network>:<txRef>") to the task it paid for. The
 * SP1 guest commits this value as the v2 `paymentCommitment` public value, so a
 * verified proof attests BOTH computation AND payment.
 *
 * This module is the byte-for-byte mirror of
 * `SP1ProofHooks.computePaymentCommitment(bytes32,bytes32,uint8,uint256)`:
 *
 *   keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount))
 *
 * Parity is guarded by test/security/SP1ProofHooksHarness.test.cjs
 * ("should match the backend JS formula (parity)").
 *
 * Flag-gated by `config.x402.proofBinding` (X402_PROOF_BINDING). Until the SP1
 * guest ships the v2 layout (new programVKey), the commitment is carried as
 * server-attested settlement metadata (`in_proof: false`); flip to `true` on
 * guest activation.
 */
import { keccak256, toUtf8Bytes, solidityPacked } from 'ethers';

/** Payment-rail discriminant — must match the Solidity `paymentRail` arg. */
export const PAYMENT_RAIL = Object.freeze({ usdc: 1, tfuel: 2 });

const ZERO32 = '0x' + '0'.repeat(64);

/**
 * Deterministic payment commitment. Mirrors SP1ProofHooks.computePaymentCommitment.
 * @param {object} p
 * @param {string} p.paymentRef  Settlement ref string ("<network>:<txRef>").
 * @param {string} p.taskId      Task id the settlement pays for.
 * @param {'usdc'|'tfuel'|number} p.rail  Rail name or discriminant.
 * @param {string|bigint} p.amount  Bound economic value (wei / smallest unit).
 * @returns {{ commitment: string, paymentRefHash: string, taskIdHash: string, railDiscriminant: number, amount: string }}
 */
export function computePaymentCommitment({ paymentRef, taskId, rail, amount }) {
  const railDiscriminant = typeof rail === 'number' ? rail : (PAYMENT_RAIL[rail] ?? 0);
  const paymentRefHash = paymentRef ? keccak256(toUtf8Bytes(String(paymentRef))) : ZERO32;
  const taskIdHash = keccak256(toUtf8Bytes(String(taskId)));
  const amt = BigInt(amount ?? 0);
  const commitment = keccak256(
    solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [paymentRefHash, taskIdHash, railDiscriminant, amt],
    ),
  );
  return { commitment, paymentRefHash, taskIdHash, railDiscriminant, amount: amt.toString() };
}

/**
 * Build the payment-binding descriptor for a task, or null when it does not apply.
 *
 * Applies only when: proof binding is enabled AND the task settled via USDC/x402
 * with a concrete payment_ref. TFUEL-rail tasks (or missing ref) are not bound in
 * Phase 2 and return null (proof attests computation only, as before).
 *
 * @param {object} task     Listener task (expects intent.paymentRail/paymentRef, taskId, netAmount).
 * @param {object} x402Cfg  config.x402
 * @returns {null | { version: 2, rail: 'usdc', commitment: string, payment_ref_hash: string, amount: string, in_proof: boolean }}
 */
export function buildPaymentBinding(task, x402Cfg) {
  if (!x402Cfg || !x402Cfg.proofBinding) return null;

  const rail = task?.intent?.paymentRail;
  const paymentRef = task?.intent?.paymentRef;
  if (rail !== 'usdc' || !paymentRef) return null;

  const amount = task.netAmount ?? task?.intent?.amount ?? '0';
  const { commitment, paymentRefHash } = computePaymentCommitment({
    paymentRef,
    taskId: task.taskId,
    rail,
    amount,
  });

  return {
    version: 2,
    rail: 'usdc',
    commitment,
    payment_ref_hash: paymentRefHash,
    amount: String(amount),
    // false until the SP1 guest commits the v2 layout (new programVKey). Until then
    // this is server-attested settlement metadata, not yet proven in-circuit.
    in_proof: false,
  };
}

export default { PAYMENT_RAIL, computePaymentCommitment, buildPaymentBinding };
