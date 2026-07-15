/**
 * XFuel Protocol — Solana AI Bridge Handler
 *
 * Off-chain handler for the SolanaAIBridge Circuit.
 * Coordinates EVM↔Solana cross-chain AI task routing via Wormhole/CCIP.
 *
 * Research ties (2026):
 *   - Render: 5,600 RTX 5090 nodes on Solana; Burn-Mint Equilibrium.
 *   - io.net: 1M+ pooled GPUs; 750K inferences; IO token staking.
 *   - Grass: 8.5M MAU; ZK provenance rollup on Solana.
 *   - SendAI: Solana-native AI agent framework.
 *   - Wormhole: Guardian-attested VAAs for cross-chain messages.
 */
const SOLANA_CIRCUIT_ID = 'solana-ai-bridge';
const SOLANA_EVENTS = {
  ProviderRegistered: 'ProviderRegistered(bytes32,bytes32,address,string,bytes32)',
  TaskSubmitted: 'TaskSubmitted(bytes32,bytes32,address,bytes32,uint256)',
  TaskBridged: 'TaskBridged(bytes32,bytes32,uint16)',
  TaskSettled: 'TaskSettled(bytes32,bytes32,bytes32,uint256,bytes32)',
};

class SolanaHandler {
  constructor(config = {}) {
    this.config = config;
    this.providerCache = new Map();
    this.stats = { intentsReceived: 0, bridgesTriggered: 0, proofsGenerated: 0 };
    this.wormholeEndpoint = config.wormholeEndpoint || 'https://wormhole-v2-mainnet-api.certus.one';
  }

  async onIntent(intent, ctx) {
    this.stats.intentsReceived++;
    const { type, data } = intent;
    switch (type) {
      case 'solana_gpu_task':
      case 'solana_data_task':
      case 'solana_agent_task':
        return this._handleBridgeTask(data, ctx);
      case 'provider_registration':
        this.providerCache.set(data.providerId, data);
        return { handled: true, action: 'provider_cached' };
      default:
        return { handled: false, reason: `Unknown: ${type}` };
    }
  }

  async onProofReady(proofResult, proofRequest) {
    if (!proofResult.success) return { action: 'fail', reason: proofResult.error };
    this.stats.proofsGenerated++;
    return {
      action: 'settle', target: 'SolanaAIBridge', method: 'settleTask',
      args: [proofRequest.taskId, proofResult.resultHash, proofResult.qualityScore,
             proofResult.proof, proofResult.publicValues, proofResult.nullifier],
    };
  }

  async _handleBridgeTask(data, ctx) {
    this.stats.bridgesTriggered++;
    return {
      handled: true, action: 'generate_proof',
      proofRequest: {
        circuitId: SOLANA_CIRCUIT_ID, taskId: data.taskId,
        proofType: 'solana_computation', programId: 'xfuel-solana-bridge-v1',
        proverConfig: { providerId: data.providerId, taskHash: data.taskHash,
                        solanaProgram: data.solanaProgram, wormholeVAA: data.wormholeVAA },
      },
    };
  }

  getInterface() {
    return { id: SOLANA_CIRCUIT_ID, name: 'Solana AI Bridge',
             description: 'EVM↔Solana bridge for GPU, data, and agent AI tasks',
             events: Object.keys(SOLANA_EVENTS), version: '1.0.0' };
  }
  getTopics() { return Object.values(SOLANA_EVENTS); }
  getStats() { return { ...this.stats, cachedProviders: this.providerCache.size }; }
}

export { SolanaHandler, SOLANA_CIRCUIT_ID, SOLANA_EVENTS };
