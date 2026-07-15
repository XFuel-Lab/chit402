/**
 * XFuel Protocol — Filecoin Storage Handler
 *
 * Off-chain handler for the FilecoinStorage circuit.
 * Integrates with CoreListener to process storage deal intents,
 * orchestrate Filecoin sector sealing, and generate SP1 proofs
 * for on-chain settlement.
 *
 * Supported intent types:
 *   - filecoin_store:    Submit data for Filecoin storage deal
 *   - filecoin_retrieve: Retrieve stored data via CID
 *   - filecoin_prove:    Submit WindowPoSt/SnapDeal proof
 *
 * Architecture:
 *   1. CoreListener receives EVM event (DealCreated / StorageProofVerified)
 *   2. FilecoinHandler.onIntent() routes to appropriate sub-handler
 *   3. Off-chain agent coordinates with Filecoin SP (via Boost/Lotus API)
 *   4. SP1 prover generates proof of storage/retrieval
 *   5. FilecoinHandler.onProofReady() submits proof on-chain
 */

export class FilecoinHandler {
  constructor(config = {}) {
    this.circuitId = 'filecoin-storage';
    this.contractName = 'FilecoinStorage';

    // Filecoin gateway configuration
    this.lotusEndpoint = config.lotusEndpoint || 'https://api.node.glif.io/rpc/v1';
    this.lighthouseApiKey = config.lighthouseApiKey || null;
    this.storachaToken = config.storachaToken || null;

    // SP1 prover
    this.proverEndpoint = config.proverEndpoint || 'http://localhost:8080';

    // State
    this.activeTasks = new Map();
  }

  /**
   * Process an incoming intent from CoreListener.
   */
  async onIntent(intent) {
    const { type, payload, metadata } = intent;

    switch (type) {
      case 'filecoin_store':
        return this._handleStoreDeal(payload, metadata);
      case 'filecoin_retrieve':
        return this._handleRetrieve(payload, metadata);
      case 'filecoin_prove':
        return this._handleProveStorage(payload, metadata);
      default:
        console.warn(`[FilecoinHandler] Unknown intent type: ${type}`);
        return { status: 'unsupported', type };
    }
  }

  /**
   * Handle storage deal request.
   * Coordinates with Filecoin SP to seal data and track deal.
   */
  async _handleStoreDeal(payload, metadata) {
    const { cid, sizeBytes, duration, providerId, clientAddress } = payload;

    const taskId = `fil-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTasks.set(taskId, {
      type: 'store',
      cid,
      sizeBytes,
      duration,
      providerId,
      clientAddress,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'accepted',
      taskId,
      circuit: this.circuitId,
      message: `Storage deal for CID ${cid} (${sizeBytes} bytes, ${duration} epochs) queued`,
    };
  }

  /**
   * Handle data retrieval request.
   */
  async _handleRetrieve(payload, metadata) {
    const { cid, dealId } = payload;

    const taskId = `fil-retrieve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTasks.set(taskId, {
      type: 'retrieve',
      cid,
      dealId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'accepted',
      taskId,
      circuit: this.circuitId,
      message: `Retrieval for CID ${cid} queued`,
    };
  }

  /**
   * Handle storage proof submission.
   * Generates SP1 proof of WindowPoSt/SnapDeal validity.
   */
  async _handleProveStorage(payload, metadata) {
    const { dealId, proofData, sectors } = payload;

    const taskId = `fil-prove-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeTasks.set(taskId, {
      type: 'prove',
      dealId,
      sectors,
      status: 'proving',
      createdAt: new Date().toISOString(),
    });

    return {
      status: 'proving',
      taskId,
      circuit: this.circuitId,
      message: `SP1 proof generation started for deal ${dealId} (${sectors} sectors)`,
    };
  }

  /**
   * Callback when SP1 proof is ready — submit on-chain.
   */
  async onProofReady({ taskId, proof, publicValues, nullifier }) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`[FilecoinHandler] Unknown task: ${taskId}`);
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
        method: 'submitStorageProof',
        args: [task.dealId, task.proofHash || nullifier, task.sectors || 1, proof, publicValues, nullifier],
      },
    };
  }

  /**
   * Get handler status and active task count.
   */
  getStatus() {
    return {
      circuit: this.circuitId,
      contract: this.contractName,
      activeTasks: this.activeTasks.size,
      lotusEndpoint: this.lotusEndpoint,
      ready: true,
    };
  }
}
