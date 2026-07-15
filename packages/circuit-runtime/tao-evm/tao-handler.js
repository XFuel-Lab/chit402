/**
 * TAO EVM Circuit — Off-Chain Handler
 *
 * Plugs into CoreListener (ai-listener.js) to handle TAO EVM circuit events.
 * Routes AI marketplace tasks across chains via the TAOCircuit contract.
 *
 * Research ties:
 *   Per Bittensor EVM docs (2026): Chain ID 964, precompiles at 0x805 (staking),
 *   SubnetPrecompile, MetagraphPrecompile. RPC: lite.chain.opentensor.ai.
 *   Per Hyperlane: dispatch() for cross-chain task routing.
 *
 * Usage:
 *   import { TAOHandler } from './tao-handler.js';
 *   import { CoreListener } from '../../../core-layer/ai-listener.js';
 *
 *   const listener = new CoreListener(config);
 *   const taoHandler = new TAOHandler(taoConfig);
 *   listener.registerCircuit('tao-evm', taoHandler, ['bittensor', 'theta_mainnet']);
 *   await listener.start();
 */

import { ethers } from 'ethers';

const TAO_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('TAO_EVM_CIRCUIT'));

// Event signatures for TAOCircuit.sol
const TAO_EVENTS = [
  'event TaskRouted(bytes32 indexed circuitId, bytes32 indexed taskId, uint8 taskType, address indexed requester, uint256 amount, uint256 fee, uint32 destDomain, uint256 subnetId)',
  'event TaskBridged(bytes32 indexed taskId, bytes32 bridgeMessageId, uint32 destDomain)',
  'event TaskSettled(bytes32 indexed taskId, bytes32 outputHash, bytes32 nullifier, uint256 settledAmount)',
];

class TAOHandler {
  constructor(config = {}) {
    this.contractAddress = config.contractAddress || null;
    this.iface = new ethers.Interface(TAO_EVENTS);
    this.pendingTasks = new Map();
    this.log = config.logger || console;

    // Theta routing hook — per research/theta-integration.md §5.2
    this.thetaRouterAddress = config.thetaRouterAddress || null;
    this.thetaInferencePrice = config.thetaInferencePrice || 0;
    this.thetaRoutingEnabled = config.thetaRoutingEnabled || false;
    this.thetaRoutedCount = 0;
  }

  /**
   * Called by CoreListener when a matching intent is detected.
   * @param {Object} intent - Parsed AI intent.
   * @param {Object} ctx - Context with chain info and proof generation helper.
   */
  async onIntent(intent, ctx) {
    this.log.info?.(`[TAOHandler] Received intent: ${intent.type} on ${ctx.chain}`);

    switch (intent.type) {
      case 'inference_request':
        return this._handleInference(intent, ctx);
      case 'compute_bid':
        return this._handleComputeBid(intent, ctx);
      case 'data_attestation':
        return this._handleDataAttestation(intent, ctx);
      default:
        this.log.debug?.(`[TAOHandler] Unhandled intent type: ${intent.type}`);
    }
  }

  /**
   * Called when an SP1 proof is ready for a task in this circuit.
   */
  async onProofReady(proofResult, proofRequest) {
    this.log.info?.(`[TAOHandler] Proof ready for task, nullifier: ${proofResult.nullifier}`);

    const task = this.pendingTasks.get(proofRequest.taskId);
    if (task) {
      task.proof = proofResult;
      task.status = 'proof_ready';
      // In production, call TAOCircuit.settleTask() on-chain here
    }
  }

  async _handleInference(intent, ctx) {
    const taskId = intent.args?.taskId || `tao-${Date.now()}`;

    this.pendingTasks.set(taskId, {
      taskId,
      type: 'inference_request',
      chain: ctx.chain,
      status: 'processing',
      createdAt: Date.now(),
    });

    // Theta routing decision — per research/theta-integration.md §5.2
    // Compare Bittensor subnet cost vs Theta EdgeCloud cost; route to cheaper.
    if (this.thetaRoutingEnabled && this.thetaRouterAddress) {
      const shouldRouteToTheta = await this._evaluateThetaRoute(intent);
      if (shouldRouteToTheta) {
        this.log.info?.(`[TAOHandler] Routing ${taskId} to Theta EdgeCloud (cheaper)`);
        this.thetaRoutedCount++;
        this.pendingTasks.get(taskId).routedTo = 'theta';
      }
    }

    // Trigger SP1 proof generation
    if (ctx.generateProof) {
      const proofReq = {
        taskId,
        programVKey: '0x' + '00'.repeat(32),
        inputHash: intent.args?.inputHash || '0x' + '00'.repeat(32),
      };
      await ctx.generateProof(proofReq);
    }
  }

  /**
   * Evaluate whether to route an inference task to Theta EdgeCloud.
   * Compares estimated costs and latency between Bittensor and Theta.
   */
  async _evaluateThetaRoute(intent) {
    if (!this.thetaInferencePrice) return false;

    const bittensorEstimate = intent.args?.estimatedCost || Infinity;
    return this.thetaInferencePrice < bittensorEstimate;
  }

  async _handleComputeBid(intent, ctx) {
    this.log.info?.(`[TAOHandler] Compute bid from ${intent.args?.requester || 'unknown'}`);
  }

  async _handleDataAttestation(intent, ctx) {
    this.log.info?.(`[TAOHandler] Data attestation on ${ctx.chain}`);
  }

  /**
   * Returns the contract ABI interface for log parsing.
   */
  getInterface() {
    return this.iface;
  }

  /**
   * Returns the event topics for this circuit (for log filtering).
   */
  getTopics() {
    return [this.iface.getEvent('TaskRouted').topicHash];
  }
}

export { TAOHandler, TAO_CIRCUIT_ID, TAO_EVENTS };
export default TAOHandler;
