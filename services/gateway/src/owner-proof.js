/**
 * Owner-proof hook for /book/ingest.
 * The shared wallet-proof verifier (EIP-712, ERC-1271, ERC-6492, Solana signMessage)
 * is owned by the owner-view change. Until that wires this hook, a proof is refused.
 * The registered-wallet path does not use the hook.
 */
import { sameEvmAddress } from './x402-flags.js';

/** @type {null | ((args: object) => Promise<{ ok: boolean, signer?: string, code?: string }>)} */
let ownerProofVerifier = null;

/** Single-use nonces. Consumed on first use, success or fail. 120s proofs. */
const usedNonces = new Map();

export function setOwnerProofVerifier(fn) {
  ownerProofVerifier = typeof fn === 'function' ? fn : null;
}

export function getOwnerProofVerifier() {
  return ownerProofVerifier;
}

export function resetOwnerProofNonces() {
  usedNonces.clear();
}

function sameSigner(a, b) {
  if (sameEvmAddress(a, b)) return true;
  return typeof a === 'string' && a === b;
}

/**
 * @param {{ agentId: number, paymentRef: string, payer: string, proof: object, now?: number }} args
 */
export async function verifyOwnerProof({ agentId, paymentRef, payer, proof, now = Date.now() } = {}) {
  if (!proof || typeof proof !== 'object') return { ok: false, code: 'owner_proof_required' };
  if (!ownerProofVerifier) return { ok: false, code: 'owner_proof_unavailable' };
  const nonce = proof.nonce != null ? String(proof.nonce) : '';
  const issuedAt = Number(proof.issued_at);
  if (!nonce || !Number.isFinite(issuedAt)) return { ok: false, code: 'owner_proof_required' };
  if (Math.abs(now - issuedAt) > 120_000) {
    usedNonces.set(nonce, now);
    return { ok: false, code: 'owner_proof_required' };
  }
  if (usedNonces.has(nonce)) return { ok: false, code: 'owner_proof_required' };
  usedNonces.set(nonce, now);
  let result;
  try {
    result = await ownerProofVerifier({
      agentId,
      paymentRef,
      payer,
      proof,
      domain: 'chit402/book-ingest/v1',
    });
  } catch {
    return { ok: false, code: 'owner_proof_required' };
  }
  if (!result?.ok || !result.signer || !sameSigner(result.signer, payer)) {
    return { ok: false, code: 'owner_proof_required' };
  }
  return { ok: true, signer: result.signer };
}

export function payerBoundToAgent(registry, agentId, payer) {
  if (!registry || payer == null) return false;
  const id = Number(agentId);
  const row = typeof registry.get === 'function' ? registry.get(id) : null;
  if (!row) return false;
  if (row.agentWallet && (sameEvmAddress(row.agentWallet, payer) || row.agentWallet === payer)) return true;
  if (typeof registry.getByWallet === 'function') {
    const byWallet = registry.getByWallet(payer);
    if (byWallet && Number(byWallet.agent_id) === id) return true;
  }
  if (Array.isArray(row.wallets)) {
    for (const w of row.wallets) {
      if (sameEvmAddress(w, payer) || w === payer) return true;
    }
  }
  return false;
}
