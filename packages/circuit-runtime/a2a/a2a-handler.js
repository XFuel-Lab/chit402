/**
 * A2A Circuit — Off-Chain Handler
 *
 * Plugs into CoreListener (ai-listener.js) to handle A2A circuit events.
 * Manages agent discovery, bid relay, and micropayment channel coordination.
 *
 * Research ties:
 *   Per x402 protocol: HTTP 402-based micropayments for AI agent services.
 *   Adapted for on-chain escrow → service → ZK-proof claim.
 *   Per SP1 docs: Agent identity commitments verified in ZK for privacy.
 *
 * Usage:
 *   import { A2AHandler } from './a2a-handler.js';
 *   import { CoreListener } from '../../../core-layer/ai-listener.js';
 *
 *   const listener = new CoreListener(config);
 *   const a2aHandler = new A2AHandler(a2aConfig);
 *   listener.registerCircuit('a2a', a2aHandler);
 *   await listener.start();
 */

import { ethers } from 'ethers';

const A2A_CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('A2A_CIRCUIT'));

const A2A_EVENTS = [
  'event AgentRegistered(address indexed agent, bytes32 identityCommitment, bytes32[] capabilities)',
  'event BidSubmitted(bytes32 indexed circuitId, bytes32 indexed bidId, address indexed requester, bytes32 capabilityRequired, uint256 escrowAmount, uint64 deadline)',
  'event BidAccepted(bytes32 indexed bidId, address indexed provider, uint256 acceptedPrice)',
  'event BidSettled(bytes32 indexed bidId, bytes32 resultHash, bytes32 nullifier, uint256 paidAmount, uint256 fee)',
  'event BidSettledFairExchange(bytes32 indexed bidId, bytes32 resultHash, uint256 paidAmount, uint256 fee)',
  'event A2AMessageSent(bytes32 indexed circuitId, address indexed sender, address indexed recipient, bytes32 payloadHash, uint256 escrowAmount)',
  'event ChannelOpened(bytes32 indexed channelId, address indexed payer, address indexed payee, uint256 deposit, uint64 expiresAt)',
  'event ChannelClaimed(bytes32 indexed channelId, uint256 amount, bytes32 proofNullifier)',
];

class A2AHandler {
  constructor(config = {}) {
    this.contractAddress = config.contractAddress || null;
    this.iface = new ethers.Interface(A2A_EVENTS);

    // Local agent discovery cache
    this.agentCache = new Map();
    this.pendingBids = new Map();
    this.activeChannels = new Map();

    this.log = config.logger || console;
  }

  /**
   * Called by CoreListener when a matching intent is detected.
   */
  async onIntent(intent, ctx) {
    this.log.info?.(`[A2AHandler] Received intent: ${intent.type} on ${ctx.chain}`);

    switch (intent.type) {
      case 'compute_bid':
        return this._handleBid(intent, ctx);
      case 'capability_query':
        return this._handleCapabilityQuery(intent, ctx);
      case 'inference_request':
        return this._handleInferenceRelay(intent, ctx);
      default:
        this.log.debug?.(`[A2AHandler] Unhandled intent: ${intent.type}`);
    }
  }

  /**
   * Called when an SP1 proof is ready for a bid or channel settlement.
   */
  async onProofReady(proofResult, proofRequest) {
    this.log.info?.(`[A2AHandler] Proof ready, nullifier: ${proofResult.nullifier}`);

    const bid = this.pendingBids.get(proofRequest.bidId);
    if (bid) {
      bid.proof = proofResult;
      bid.status = 'proof_ready';
    }
  }

  async _handleBid(intent, ctx) {
    const bidId = intent.args?.bidId || `bid-${Date.now()}`;

    this.pendingBids.set(bidId, {
      bidId,
      requester: intent.args?.requester,
      chain: ctx.chain,
      status: 'received',
      createdAt: Date.now(),
    });

    // Auto-match with capable agents
    const capability = intent.args?.capabilityRequired;
    if (capability && this.agentCache.has(capability)) {
      const provider = this.agentCache.get(capability);
      this.log.info?.(`[A2AHandler] Auto-matched bid ${bidId} to provider ${provider}`);
    }

    this.log.info?.(`[A2AHandler] Bid ${bidId} received, awaiting provider acceptance`);
  }

  async _handleCapabilityQuery(intent, ctx) {
    this.log.info?.(`[A2AHandler] Capability query from ${intent.sender || 'unknown'}`);
  }

  async _handleInferenceRelay(intent, ctx) {
    // For A2A, inference requests may trigger agent-to-agent relay
    this.log.info?.(`[A2AHandler] Relaying inference via A2A on ${ctx.chain}`);

    if (ctx.generateProof) {
      const proofReq = {
        bidId: `a2a-relay-${Date.now()}`,
        programVKey: '0x' + '00'.repeat(32),
      };
      await ctx.generateProof(proofReq);
    }
  }

  /**
   * Update local agent cache from on-chain events.
   */
  updateAgentCache(agentAddress, capabilities) {
    for (const cap of capabilities) {
      this.agentCache.set(cap, agentAddress);
    }
  }

  getInterface() {
    return this.iface;
  }

  getTopics() {
    return [
      this.iface.getEvent('BidSubmitted').topicHash,
      this.iface.getEvent('A2AMessageSent').topicHash,
      this.iface.getEvent('BidSettledFairExchange').topicHash,
    ];
  }
}

export { A2AHandler, A2A_CIRCUIT_ID, A2A_EVENTS };
export default A2AHandler;
