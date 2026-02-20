/**
 * XFuel Protocol -- Mapping and Sensor Handler
 *
 * Off-chain handler for the MappingSensor circuit.
 * Integrates with CoreListener to process geospatial data intents,
 * coordinate dashcam/sensor submissions, and generate SP1 proofs.
 *
 * Supported intent types:
 *   - mapping_submit:   Submit ZK-proven geospatial data
 *   - mapping_list:     List verified data on marketplace
 *   - mapping_coverage: Query coverage stats for a region
 */

export class MappingHandler {
  constructor(config = {}) {
    this.circuitId = 'mapping-sensor';
    this.contractName = 'MappingSensor';
    this.hivemapperApi = config.hivemapperApi || 'https://api.hivemapper.com/v1';
    this.dimoApi = config.dimoApi || 'https://api.dimo.zone/v1';
    this.proverEndpoint = config.proverEndpoint || 'http://localhost:8080';
    this.activeTasks = new Map();
  }

  async onIntent(intent) {
    const { type, payload, metadata } = intent;
    switch (type) {
      case 'mapping_submit':
        return this._handleSubmission(payload, metadata);
      case 'mapping_list':
        return this._handleListing(payload, metadata);
      case 'mapping_coverage':
        return this._handleCoverageQuery(payload, metadata);
      default:
        console.warn('[MappingHandler] Unknown intent type: ' + type);
        return { status: 'unsupported', type };
    }
  }

  async _handleSubmission(payload, metadata) {
    const { deviceId, dataHash, locationHash, dataSizeBytes, qualityScore } = payload;
    const taskId = 'map-submit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    this.activeTasks.set(taskId, {
      type: 'submit', deviceId, dataHash, locationHash, dataSizeBytes, qualityScore,
      status: 'proving', createdAt: new Date().toISOString(),
    });
    return {
      status: 'proving', taskId, circuit: this.circuitId,
      message: 'Geospatial data for device ' + deviceId + ' queued for ZK proof',
    };
  }

  async _handleListing(payload, metadata) {
    const { submissionId, price } = payload;
    const taskId = 'map-list-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    this.activeTasks.set(taskId, {
      type: 'list', submissionId, price, status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return { status: 'accepted', taskId, circuit: this.circuitId, message: 'Data listing queued' };
  }

  async _handleCoverageQuery(payload, metadata) {
    const { regionHash } = payload;
    return { status: 'query', circuit: this.circuitId, message: 'Coverage query for ' + regionHash };
  }

  async onProofReady({ taskId, proof, publicValues, nullifier }) {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn('[MappingHandler] Unknown task: ' + taskId);
      return { status: 'error', message: 'Task not found' };
    }
    task.status = 'proof_ready';
    task.proof = proof;
    task.nullifier = nullifier;
    return {
      status: 'ready', taskId, circuit: this.circuitId,
      contractCall: {
        method: 'submitData',
        args: [task.deviceId, task.dataHash, task.locationHash,
               task.dataSizeBytes, task.qualityScore, proof, publicValues, nullifier],
      },
    };
  }

  getStatus() {
    return {
      circuit: this.circuitId, contract: this.contractName,
      activeTasks: this.activeTasks.size, hivemapperApi: this.hivemapperApi, ready: true,
    };
  }
}
