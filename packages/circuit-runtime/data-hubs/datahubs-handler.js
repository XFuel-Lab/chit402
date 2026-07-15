/**
 * XFuel Protocol — Data Ownership Hubs Handler
 *
 * Off-chain handler for the DataHubs Circuit.
 * Plugs into CoreListener to coordinate data contribution and validation pipelines.
 *
 * Track 3.1 addition: Theta EdgeStore integration.
 *   When a DataContributed event fires, the handler uploads the raw data to
 *   Theta EdgeStore and seals the on-chain contribution with the returned CID.
 *   This replaces the temporary keccak dataCommitment with a permanent,
 *   content-addressed, decentralised storage reference.
 *
 * Research ties (Vana + Grass, 2026):
 *   - Vana: DataDAOs, VRC-20 tokens, three-layer architecture.
 *   - Grass: 90-100TB/day scraping, ZK provenance rollup, $33M annualized revenue.
 *   - Theta EdgeStore: decentralised blob storage, wallet-signed auth, 24h tokens.
 */

import { ThetaEdgeStoreAdapter } from './theta-edgestore-adapter.js';

const DATAHUBS_CIRCUIT_ID = 'data-hubs';
const DATAHUBS_EVENTS = {
  HubCreated:            'HubCreated(bytes32,bytes32,address,string,string)',
  DataContributed:       'DataContributed(bytes32,bytes32,bytes32,address,bytes32)',
  ContributionValidated: 'ContributionValidated(bytes32,uint256,bytes32)',
  AccessGranted:         'AccessGranted(bytes32,bytes32,address,uint256)',
  EdgeStoreSealed:       'EdgeStoreSealed(bytes32,bytes32,bytes32,address)',
};

class DataHubsHandler {
  constructor(config = {}) {
    this.config = config;
    this.hubCache = new Map();
    this.stats = {
      intentsReceived: 0,
      validationsTriggered: 0,
      proofsGenerated: 0,
      edgeStoreUploads: 0,
      edgeStoreFailures: 0,
      onChainSeals: 0,
    };

    // Theta EdgeStore adapter — initialised lazily on first use
    this._edgeStore = null;
    this._edgeStoreEnabled = !!(
      config.edgeStoreWalletKey || process.env.THETA_EDGESTORE_WALLET_KEY
    );
  }

  // ─── EdgeStore adapter (lazy init) ─────────────────────────────────────────

  _getEdgeStore(contract = null) {
    if (!this._edgeStore) {
      this._edgeStore = new ThetaEdgeStoreAdapter({
        walletPrivateKey: this.config.edgeStoreWalletKey || process.env.THETA_EDGESTORE_WALLET_KEY,
        contract: contract || this.config.contract || null,
        apiTimeout: this.config.apiTimeout || 60000,
        logger: this.config.logger || console,
      });
    }
    // Re-attach contract if provided (may be set after construction)
    if (contract && !this._edgeStore.contract) {
      this._edgeStore.contract = contract;
    }
    return this._edgeStore;
  }

  // ─── Intent router ─────────────────────────────────────────────────────────

  async onIntent(intent, ctx) {
    this.stats.intentsReceived++;
    const { type, data } = intent;
    switch (type) {
      case 'data_contribution':
        return this._handleContribution(data, ctx);
      case 'data_validation':
        return this._handleValidation(data, ctx);
      case 'hub_creation':
        this.hubCache.set(data.hubId, data);
        return { handled: true, action: 'hub_cached' };
      default:
        return { handled: false, reason: `Unknown: ${type}` };
    }
  }

  // ─── Contribution handler (Track 3.1 — EdgeStore upload + on-chain seal) ───

  /**
   * Handle a data_contribution intent.
   *
   * Flow:
   *   1. Contribution is already on-chain (submitted via DataHubs.contributeData()).
   *      The off-chain raw data is provided in data.rawData (Buffer or base64 string).
   *   2. Upload raw data to Theta EdgeStore.
   *   3. Call DataHubs.attachEdgeStoreCid() to seal the CID on-chain.
   *   4. Return the CID for downstream validation/proof generation.
   *
   * If EdgeStore is not configured, the handler falls through gracefully —
   * the contribution remains valid with the original keccak commitment.
   */
  async _handleContribution(data, ctx) {
    const { contributionId, rawData, filename = 'contribution.bin' } = data;

    if (!contributionId) {
      return { handled: false, reason: 'Missing contributionId' };
    }

    // EdgeStore upload (skip if not configured)
    if (!this._edgeStoreEnabled || !rawData) {
      console.log(`[DataHubs] EdgeStore skipped | contrib=${contributionId?.slice(0, 18)}... | reason=${!this._edgeStoreEnabled ? 'no key' : 'no rawData'}`);
      return { handled: true, action: 'contribution_received', edgeStore: null };
    }

    this.stats.edgeStoreUploads++;

    try {
      const edgeStore = this._getEdgeStore(ctx.contract);
      const rawBuf    = typeof rawData === 'string' ? Buffer.from(rawData, 'base64') : rawData;

      const { cid, nodeId, sizeBytes, txHash, sealError } = await edgeStore.uploadAndSeal({
        data: rawBuf,
        filename,
        contributionId,
        gasLimit: this.config.gasLimit || 150000,
      });

      if (txHash) this.stats.onChainSeals++;
      if (sealError) this.stats.edgeStoreFailures++;

      console.log(`[DataHubs] EdgeStore sealed | contrib=${contributionId.slice(0, 18)}... | cid=${cid.slice(0, 18)}... | bytes=${sizeBytes} | seal=${txHash?.slice(0, 18) || 'failed'}`);

      return {
        handled: true,
        action: 'contribution_sealed',
        edgeStore: { cid, nodeId, sizeBytes, txHash, sealError },
      };
    } catch (err) {
      this.stats.edgeStoreFailures++;
      console.error(`[DataHubs] EdgeStore upload failed (non-fatal): ${err.message?.slice(0, 120)}`);
      return {
        handled: true,
        action: 'contribution_received',
        edgeStore: null,
        edgeStoreError: err.message,
      };
    }
  }

  // ─── Validation handler ─────────────────────────────────────────────────────

  async _handleValidation(data, ctx) {
    this.stats.validationsTriggered++;
    return {
      handled: true, action: 'generate_proof',
      proofRequest: {
        circuitId: DATAHUBS_CIRCUIT_ID,
        contributionId: data.contributionId,
        proofType: 'data_provenance',
        programId: 'xfuel-datahubs-v1',
        proverConfig: {
          dataCommitment: data.dataCommitment,
          provenanceHash: data.provenanceHash,
          sourceConfig: data.sourceConfig,
          // Pass EdgeStore CID into proof public values when available
          edgeStoreCid: data.edgeStoreCid || null,
        },
      },
    };
  }

  // ─── Proof settlement ──────────────────────────────────────────────────────

  async onProofReady(proofResult, proofRequest) {
    if (!proofResult.success) return { action: 'fail', reason: proofResult.error };
    this.stats.proofsGenerated++;
    return {
      action: 'settle', target: 'DataHubs', method: 'validateContribution',
      args: [
        proofRequest.contributionId,
        proofResult.qualityScore,
        proofResult.proof,
        proofResult.publicValues,
        proofResult.nullifier,
      ],
    };
  }

  // ─── Metadata ─────────────────────────────────────────────────────────────

  getInterface() {
    return {
      id: DATAHUBS_CIRCUIT_ID,
      name: 'Data Ownership Hubs',
      description: 'ZK-verified data contribution and tokenized access with Theta EdgeStore',
      events: Object.keys(DATAHUBS_EVENTS),
      version: '1.1.0',
      features: {
        edgeStore: this._edgeStoreEnabled,
      },
    };
  }

  getTopics() { return Object.values(DATAHUBS_EVENTS); }

  getStats() {
    return {
      ...this.stats,
      cachedHubs: this.hubCache.size,
      edgeStore: this._edgeStore?.getStats() || null,
    };
  }
}

export { DataHubsHandler, DATAHUBS_CIRCUIT_ID, DATAHUBS_EVENTS };
