/**
 * Binds an agent owner key to a registered agent_id.
 * The registered agent wallet and the key itself both sign the bind message.
 * Sessions opened with that key are the only path into that agent's book.
 * The receipt issuer key is not used here.
 */
import { ethers } from 'ethers';

export function agentBindMessage(agentId, publicKey) {
  return `Chit402 agent key bind v1\nagent_id:${agentId}\npubkey:${publicKey}`;
}

export class AgentOwnerKeyStore {
  constructor() {
    this.byAgent = new Map();
  }

  get(agentId) {
    return this.byAgent.get(Number(agentId)) || null;
  }

  /**
   * @param {{ agentId: number|string, publicKey: string, walletSignature: string, keySignature: string, agentWallet: string }} input
   */
  bind({ agentId, publicKey, walletSignature, keySignature, agentWallet }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) return { ok: false };
    if (!publicKey || !walletSignature || !keySignature || !agentWallet) return { ok: false };
    const message = agentBindMessage(id, publicKey);
    let wallet;
    let key;
    try {
      wallet = ethers.verifyMessage(message, walletSignature);
      key = ethers.verifyMessage(message, keySignature);
    } catch {
      return { ok: false };
    }
    if (wallet.toLowerCase() !== String(agentWallet).toLowerCase()) return { ok: false };
    if (key.toLowerCase() !== String(publicKey).toLowerCase()) return { ok: false };
    const row = {
      agentId: id,
      publicKey: key.toLowerCase(),
      boundAt: Date.now(),
    };
    this.byAgent.set(id, row);
    return { ok: true, row };
  }
}
