/**
 * ERC-8004 Validation Registry adapter (Phase 3 — moat #2).
 *
 * Maps an XFuel PBR receipt (payment + model authenticity + output binding) to an ERC-8004
 * `validationResponse` verdict. XFuel acts as a **validator**: an agent opens a
 * `validationRequest` naming the XFuel validator address, and this module turns the settled
 * receipt into the answer (score 0..100 + evidence URI + commitment + tag).
 *
 * Pure + deterministic — no network, no keys. The gateway endpoint (POST /erc8004/validate)
 * and the SDK both build on this so the verdict is identical off-chain and in the SDK.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004 (Validation Registry). Score semantics:
 * 0 = failed, 100 = passed; the *tag* conveys the assurance tier (score stays binary so any
 * ERC-8004 consumer can gate payment on pass/fail without knowing XFuel tiers).
 */
import { keccak256, toUtf8Bytes } from 'ethers';
import { canonicalSignedPayload } from './receipt.js';

const REQUEST_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** True when a receipt is settled enough to be validated (has a delivered result). */
export function isReceiptValidatable(receipt) {
  if (!receipt) return false;
  if (receipt.proof_outcome === 'pending') return false;
  // must have produced an output commitment (i.e. work was actually delivered)
  return !!receipt.output?.hash;
}

/**
 * Derive the ERC-8004 verdict for a receipt.
 * @param {object} receipt  Output of buildReceipt().
 * @param {object} opts     { requestHash, agentId }
 * @returns {{
 *   eligible: boolean, reason?: string,
 *   request_hash: string, agent_id: string,
 *   response: number, tag: string,
 *   response_uri: string|null, response_hash: string,
 *   task_id: string, task_id_hash: string,
 *   tier: string, covers: string[], binding_matches: boolean|null
 * }}
 */
export function buildValidationRecord(receipt, { requestHash, agentId } = {}) {
  if (!REQUEST_HASH_RE.test(String(requestHash || ''))) {
    throw new Error('requestHash must be a 0x-prefixed 32-byte hex string (keccak256 of the request payload)');
  }
  const agent = String(agentId ?? '');
  if (!/^\d+$/.test(agent)) {
    throw new Error('agentId must be a non-negative integer (ERC-8004 Identity Registry id)');
  }

  const tier = receipt?.proof?.tier || 'signed';
  const covers = Array.isArray(receipt?.binding?.covers) ? receipt.binding.covers : [];
  const bindingMatches = receipt?.binding ? receipt.binding.matches : null;

  const base = {
    request_hash: requestHash,
    agent_id: agent,
    tier,
    covers,
    binding_matches: bindingMatches,
    task_id: receipt?.task_id || null,
    task_id_hash: receipt?.task_id ? keccak256(toUtf8Bytes(String(receipt.task_id))) : ('0x' + '0'.repeat(64)),
    response_uri: receipt?.verify_url || receipt?.links?.self || null,
    // Commitment to the evidence: the canonical payment-bound tuple (stable, third-party recomputable).
    response_hash: keccak256(toUtf8Bytes(canonicalSignedPayload(receipt || {}))),
  };

  if (!isReceiptValidatable(receipt)) {
    return { ...base, eligible: false, reason: 'task not settled / no delivered output', response: 0, tag: 'xfuel:pending' };
  }

  // Fail the verdict on a detected binding mismatch or an invalid proof; else pass.
  if (bindingMatches === false) {
    return { ...base, eligible: true, response: 0, tag: 'xfuel:binding-mismatch' };
  }
  if (receipt.proof_outcome === 'invalid') {
    return { ...base, eligible: true, response: 0, tag: 'xfuel:proof-invalid' };
  }

  const tag = covers.includes('inference') ? `xfuel:${tier}+pbr` : `xfuel:${tier}`;
  return { ...base, eligible: true, response: 100, tag };
}

export default { isReceiptValidatable, buildValidationRecord };
