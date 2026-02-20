/**
 * XFuel Protocol — zkML Inference Handler
 *
 * Off-chain handler for the zkML Inference Circuit.
 * Plugs into CoreListener to coordinate private ML inference with SP1 proofs.
 *
 * Architecture:
 *   1. Listens for InferenceRequested events from ZKMLCircuit.sol.
 *   2. Routes inference to the model's authorized prover (off-chain).
 *   3. The prover runs the model on private weights, generates an SP1 proof.
 *   4. Proof is submitted back to ZKMLCircuit for on-chain verification.
 *
 * Research ties:
 *   Per SP1 docs (2026):
 *     - Private inputs (model weights) are only known to the prover.
 *     - Public outputs (commitment, inputHash, outputHash) are verified on-chain.
 *     - Groth16 wrapping: ~260 bytes proof, ~270k gas verification.
 *     - RISC-V compilation allows arbitrary Rust ML inference code.
 */

const ZKML_CIRCUIT_ID = 'zkml';

const ZKML_EVENTS = {
  InferenceRequested: 'InferenceRequested(bytes32,bytes32,bytes32,address,bytes32,uint256,uint64)',
  InferenceVerified: 'InferenceVerified(bytes32,bytes32,bytes32,uint256)',
  InferenceFailed: 'InferenceFailed(bytes32,string)',
  PrivateModelRegistered: 'PrivateModelRegistered(bytes32,address,bytes32,string,uint256)',
};

class ZKMLHandler {
  constructor(config = {}) {
    this.config = config;

    // Model registry cache (modelId → { owner, commitment, provers })
    this.modelCache = new Map();

    // Active inference requests (requestId → { modelId, inputHash, requester, deadline })
    this.pendingInferences = new Map();

    // Proof generation stats
    this.stats = {
      requestsReceived: 0,
      proofsGenerated: 0,
      proofsFailed: 0,
      avgProvingTimeMs: 0,
    };

    this.proverEndpoint = config.proverEndpoint || 'http://localhost:9090/prove';
    this.maxProvingTimeMs = config.maxProvingTimeMs || 120_000; // 2 min default
  }

  /**
   * Handle an incoming intent from CoreListener.
   * Routes private inference requests to authorized provers.
   *
   * @param {Object} intent - Parsed AI intent from event.
   * @param {Object} ctx - Context with chain info, provider, signer.
   */
  async onIntent(intent, ctx) {
    this.stats.requestsReceived++;

    const { type, data, chain } = intent;

    switch (type) {
      case 'inference_request':
        return this._handleInferenceRequest(data, ctx);

      case 'model_registration':
        return this._handleModelRegistration(data, ctx);

      default:
        return { handled: false, reason: `Unknown intent type: ${type}` };
    }
  }

  /**
   * Handle proof completion callback from CoreListener.
   */
  async onProofReady(proofResult, proofRequest) {
    if (!proofResult.success) {
      this.stats.proofsFailed++;
      this.pendingInferences.delete(proofRequest.requestId);
      return { action: 'fail', reason: proofResult.error };
    }

    this.stats.proofsGenerated++;

    // Remove from pending
    const req = this.pendingInferences.get(proofRequest.requestId);
    this.pendingInferences.delete(proofRequest.requestId);

    // Update avg proving time
    const elapsed = proofResult.provingTimeMs || 0;
    this.stats.avgProvingTimeMs = (
      (this.stats.avgProvingTimeMs * (this.stats.proofsGenerated - 1) + elapsed)
      / this.stats.proofsGenerated
    );

    return {
      action: 'settle',
      target: 'ZKMLCircuit',
      method: 'verifyInference',
      args: [
        proofRequest.requestId,
        proofResult.outputHash,
        proofResult.weightCommitment,
        proofResult.proof,
        proofResult.publicValues,
        proofResult.nullifier,
      ],
    };
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  async _handleInferenceRequest(data, ctx) {
    const { requestId, modelId, inputHash, requester, deadline } = data;

    // Cache the pending request
    this.pendingInferences.set(requestId, {
      modelId,
      inputHash,
      requester,
      deadline,
      receivedAt: Date.now(),
    });

    // Look up model in cache
    const model = this.modelCache.get(modelId);

    return {
      handled: true,
      action: 'generate_proof',
      proofRequest: {
        circuitId: ZKML_CIRCUIT_ID,
        requestId,
        modelId,
        inputHash,
        // Per SP1 docs: private inputs are passed to the prover only
        proofType: 'zkml_inference',
        programId: 'xfuel-zkml-v1',
        // The prover needs:
        //   private: model weights (fetched from model owner's secure storage)
        //   public:  inputHash, weightCommitment, outputHash (computed during proving)
        proverConfig: {
          endpoint: this.proverEndpoint,
          maxTimeMs: this.maxProvingTimeMs,
          modelOwner: model?.owner || null,
          weightCommitment: model?.commitment || null,
        },
      },
    };
  }

  async _handleModelRegistration(data, _ctx) {
    const { modelId, owner, weightCommitment, description } = data;

    this.modelCache.set(modelId, {
      owner,
      commitment: weightCommitment,
      description,
      registeredAt: Date.now(),
    });

    return {
      handled: true,
      action: 'cache_updated',
      modelId,
    };
  }

  /**
   * Return circuit interface descriptor for CoreListener.
   */
  getInterface() {
    return {
      id: ZKML_CIRCUIT_ID,
      name: 'zkML Private Inference',
      description: 'Private ML model inference with SP1 ZK proofs',
      events: Object.keys(ZKML_EVENTS),
      version: '1.0.0',
    };
  }

  /**
   * Return event topics to subscribe for.
   */
  getTopics() {
    return Object.values(ZKML_EVENTS);
  }

  /**
   * Return handler stats.
   */
  getStats() {
    return {
      ...this.stats,
      pendingInferences: this.pendingInferences.size,
      cachedModels: this.modelCache.size,
    };
  }
}

export { ZKMLHandler, ZKML_CIRCUIT_ID, ZKML_EVENTS };
