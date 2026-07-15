/**
 * XFuel Protocol — Energy Grid Handler
 *
 * Off-chain handler for the EnergyGrid circuit.
 * Integrates with CoreListener to process energy attestation intents,
 * coordinate metering data, and generate SP1 proofs for on-chain settlement.
 *
 * Supported intent types:
 *   - energy_attest:  Submit ZK-proven energy production data
 *   - energy_trade:   Create or fill a P2P energy trade
 *   - energy_carbon:  Query carbon credit balance
 *
 * Architecture:
 *   1. CoreListener receives EVM event (EnergyAttested / TradeSettled)
 *   2. EnergyHandler.onIntent() routes to appropriate sub-handler
 *   3. Off-chain agent reads smart meter data (via Daylight/Glow API)
 *   4. SP1 prover generates proof of metered energy production
 *   5. EnergyHandler.onProofReady() submits attestation on-chain
 */

export class EnergyHandler {
  constructor(config = {}) {
    this.circuitId = 'energy-grid';
    this.contractName = 'EnergyGrid';

    // Metering API configuration
    this.meterApiEndpoint = config.meterApiEndpoint || 'https://api.godaylight.com/v1';
    this.glowApiEndpoint = config.glowApiEndpoint || 'https://api.glowlabs.org/v1';

    // SP1 prover
    this.proverEndpoint = config.proverEndpoint || 'http://localhost:8080';

    // State
    this.activeTasks = new Map();
  }

  async onIntent(intent) {
    const { type, payload, metadata } = intent;

    switch (type) {
      case 'energy_attest':
        return this._handleAttestation(payload, metadata);
      case 'energy_trade':
        return this._handleTrade(payload, metadata);
      case 'energy_carbon':
        return this._handleCarbonQuery(payload, metadata);
      default:
        console.warn(`[EnergyHandler] Unknown intent type: ${type}`);
        return { status: 'unsupported', type };
    }
  }

  async _handleAttestation(payload, metadata) {
    const { nodeId, kwhProduced, periodStart, periodEnd, meterHash } = payload;

    const taskId = `energy-attest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTasks.set(taskId, {
      type: 'attest',
      nodeId,
      kwhProduced,
      periodStart,
      periodEnd,
      meterHash,
      status: 'proving',
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'proving',
      taskId,
      circuit: this.circuitId,
      message: `Energy attestation for node ${nodeId}: ${kwhProduced} kWh queued for ZK proof`,
    };
  }

  async _handleTrade(payload, metadata) {
    const { action, tradeId, sellerNodeId, kwhAmount, pricePerKwh } = payload;

    const taskId = `energy-trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTasks.set(taskId, {
      type: 'trade',
      action, tradeId, sellerNodeId, kwhAmount, pricePerKwh,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'accepted',
      taskId,
      circuit: this.circuitId,
      message: `Energy trade ${action} queued`,
    };
  }

  async _handleCarbonQuery(payload, metadata) {
    const { ownerAddress } = payload;
    return {
      status: 'query',
      circuit: this.circuitId,
      message: `Carbon credit query for ${ownerAddress}`,
    };
  }

  async onProofReady({ taskId, proof, publicValues, nullifier }) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`[EnergyHandler] Unknown task: ${taskId}`);
      return { status: 'error', message: 'Task not found' };
    }

    task.status = 'proof_ready';
    task.proof = proof;
    task.nullifier = nullifier;

    return {
      status: 'ready',
      taskId,
      circuit: this.circuitId,
      contractCall: {
        method: 'attestEnergy',
        args: [task.nodeId, task.kwhProduced, task.periodStart, task.periodEnd,
               task.meterHash, proof, publicValues, nullifier],
      },
    };
  }

  getStatus() {
    return {
      circuit: this.circuitId,
      contract: this.contractName,
      activeTasks: this.activeTasks.size,
      meterApi: this.meterApiEndpoint,
      ready: true,
    };
  }
}
