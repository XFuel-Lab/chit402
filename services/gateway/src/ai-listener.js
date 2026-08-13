import { WebSocket } from 'ws';
import axios from 'axios';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { getSP1Prover } from './sp1-prover-client.js';
import { getZkGPTProver, isZkGPTProverConfigured } from './zkgpt-prover-client.js';
import { buildPaymentBinding } from './payment-binding.js';
import { proveGatedReason } from './prove-gate.js';
import { createTaskStore } from './task-store.js';
import { getFloatManager, normalizeProviderId } from './provider-float.js';
import { inferAkashML, akashmlApiKey } from './akashml-infer.js';
import { inferEdgeCloud, chatInputFromMessages, extractTextOutput } from './edgecloud-infer.js';
import { normalizeUsage } from './usage.js';
import { cacheNamespace } from './buyer-attr.js';
import { measureCogs } from './provider-rates.js';
import { getHubCatalog, resolveCatalogModel, requestShape } from './hub-catalog.js';

/**
 * AI Intent Listener — Osmosis/Akash IBC Event Monitor
 * 
 * Phase E: AI DePIN Bridge — Monitors Osmosis and Akash IBC events
 * for AI-related intents and routes them to Theta Edge Cloud for inference.
 * 
 * Responsibilities:
 * 1. Monitor Osmosis pool events (swap triggers, LP add/remove involving ibcTFUEL)
 * 2. Monitor Akash bid acceptance events (GPU lease bids via IBC)
 * 3. Parse AI intent messages (COMPUTE_BID, COMPUTE_RESULT, INFERENCE_REQUEST, etc.)
 * 4. Route AI tasks to Theta Edge Cloud for inference execution
 * 5. Collect 0.5% fee on task completion → FeeCollector.wasm
 * 6. Generate SP1 ZK proofs for cross-chain settlement verification
 * 
 * Event Flow:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Osmosis/Akash IBC Event → AI Listener → Theta Edge Inference      │
 * │   → SP1 ZK Proof → FeeCollector (0.5%) → Settlement                │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * AI Intent Message Types:
 * - COMPUTE_BID:       Agent requests GPU resources with ZK-verified escrow
 * - COMPUTE_RESULT:    Provider attests job completion with output hash
 * - INFERENCE_REQUEST: Route ML inference to optimal provider (Theta/Akash/TAO)
 * - CAPABILITY_QUERY:  Discover peer agent capabilities across chains
 * - DATA_ATTESTATION:  Certify dataset provenance on-chain
 * 
 * Fee Model:
 * - 0.5% of task settlement value collected on completion
 * - Fees routed to FeeCollector.wasm via CW20 transfer
 * - FeeCollector burns accumulated fees → SP1 FeeBurn proof → RevenueSplitter (30/30/25/15)
 */

// ─── AI Intent Types ────────────────────────────────────────────────────────

const AI_INTENT_TYPES = {
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
};

const TASK_STATUS = {
  PENDING: 'pending',
  ROUTED: 'routed',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  FEE_COLLECTED: 'fee_collected',
};

// ─── Fee Constants ──────────────────────────────────────────────────────────

// Must track server.js — a hardcode here made the two paths compute different
// fees for the same task whenever AI_TASK_FEE_BPS was configured.
const AI_TASK_FEE_BPS = Math.min(Math.max(parseInt(process.env.AI_TASK_FEE_BPS, 10) || 50, 50), 100);
const FEE_DENOMINATOR = 10000;
const MIN_TASK_AMOUNT = '10000'; // Minimum task value to process (avoid dust)

/**
 * May an inference request be answered with a synthetic result?
 *
 * Only ever for local development. On a deployed gateway a mock is worse than an
 * error: `/task-request` has already taken USDC by the time routing runs, so a
 * mock produces a signed, verifiable receipt attesting an inference that never
 * happened. Read at call time so tests can set it per-case.
 */
function mockInferenceAllowed() {
  return process.env.ALLOW_MOCK_INFERENCE === 'true';
}

// ─── AIListener Class ───────────────────────────────────────────────────────

class AIListener {
  constructor() {
    // WebSocket connections
    this.osmosisWs = null;
    this.akashWs = null;

    // State tracking
    this.isListening = false;
    this.reconnectAttempts = { osmosis: 0, akash: 0 };
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;

    // Event & task tracking
    this.processedEvents = new Set();
    // Durable, restart-safe task store (drop-in Map). Persists a public-safe snapshot
    // so the public verify_url receipt survives restarts + the ~1h terminal GC below.
    // Set TASK_STORE_PERSIST=false for a purely in-memory store. See task-store.js.
    this.activeTasks = createTaskStore(config.taskStore); // taskId → task data
    this.taskNonce = 0;
    this.lastBlockHeights = { osmosis: 0, akash: 0 };

    // Metrics
    this.metrics = {
      totalTasksReceived: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalFeesCollected: BigInt(0),
      totalInferenceRouted: 0,
      totalComputeBids: 0,
      uptimeStarted: null,
    };
  }

  // ─── Initialization ─────────────────────────────────────────────────────

  /**
   * Initialize the AI listener with Osmosis and Akash configurations
   * @returns {Promise<void>}
   */
  async init() {
    try {
      // Validate required configuration
      this._validateConfig();

      logger.info({
        osmosisRpc: config.osmosis?.rpcUrl,
        osmosisWs: config.osmosis?.wsUrl,
        akashRpc: config.akash?.rpcUrl,
        akashWs: config.akash?.wsUrl,
        feeCollector: config.osmosis?.feeCollectorContract,
        thetaEdgeUrl: config.aiListener?.thetaEdgeUrl,
        feeBps: AI_TASK_FEE_BPS,
      }, 'AI Listener initialized — Osmosis/Akash IBC event monitoring');

      this.metrics.uptimeStarted = Date.now();
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize AI Listener');
      throw error;
    }
  }

  /**
   * Validate that required config values are present
   * @private
   */
  _validateConfig() {
    const aiCfg = config.aiListener || {};
    const osmosisCfg = config.osmosis || {};
    const akashCfg = config.akash || {};

    if (!osmosisCfg.wsUrl && !akashCfg.wsUrl) {
      logger.warn(
        'Neither OSMOSIS_WS_URL nor AKASH_WS_URL configured — AI Listener will run in polling-only mode'
      );
    }

    if (!aiCfg.thetaEdgeUrl) {
      logger.warn(
        'THETA_EDGE_URL not configured — inference routing will use mock mode'
      );
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start listening for AI intent events on Osmosis and Akash
   * @returns {Promise<void>}
   */
  async startListening() {
    if (this.isListening) {
      logger.warn('AI Listener already running');
      return;
    }

    this.isListening = true;

    const cosmosEnabled = config.aiListener?.cosmosListeners === true;

    if (cosmosEnabled) {
      logger.info('Starting AI Intent Listener (Osmosis + Akash IBC)');

      // Connect to Osmosis WebSocket (pool events, IBC transfers)
      if (config.osmosis?.wsUrl) {
        await this.connectOsmosisWebSocket();
      }

      // Connect to Akash WebSocket (bid acceptance, lease events)
      if (config.akash?.wsUrl) {
        await this.connectAkashWebSocket();
      }

      // Start periodic polling as backup for both chains
      this.startPeriodicPolling();
    }

    // Task timeout watcher backs the task registry, which the M2M and OpenAI
    // surfaces both read — it runs whether or not the Cosmos sockets are up.
    this.startTaskTimeoutWatcher();

    logger.info(
      { cosmosListeners: cosmosEnabled },
      cosmosEnabled
        ? 'AI Intent Listener active — monitoring Osmosis + Akash IBC events'
        : 'AI Listener active — task registry only (Cosmos listeners disabled)'
    );
  }

  /**
   * Stop listening for events and clean up
   */
  stopListening() {
    this.isListening = false;

    if (this.osmosisWs) {
      this.osmosisWs.close();
      this.osmosisWs = null;
    }

    if (this.akashWs) {
      this.akashWs.close();
      this.akashWs = null;
    }

    // Clear interval timers
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    if (this._timeoutTimer) {
      clearInterval(this._timeoutTimer);
      this._timeoutTimer = null;
    }

    logger.info({
      metrics: this._serializeMetrics(),
    }, 'AI Listener stopped');
  }

  // ─── Osmosis WebSocket ──────────────────────────────────────────────────

  /**
   * Connect to Osmosis chain WebSocket for pool events and IBC AI intents
   * @returns {Promise<void>}
   */
  async connectOsmosisWebSocket() {
    try {
      const wsUrl = config.osmosis.wsUrl;
      logger.info({ wsUrl }, 'Connecting to Osmosis WebSocket');

      this.osmosisWs = new WebSocket(wsUrl);

      this.osmosisWs.on('open', () => {
        logger.info('Osmosis WebSocket connected');
        this.reconnectAttempts.osmosis = 0;

        // Subscribe to wasm events from ibcTFUEL-related contracts
        // 1. Pool swap events involving ibcTFUEL (Osmosis DEX triggers)
        const poolSubscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 'osmosis-pool-events',
          params: {
            query: [
              "tm.event='Tx'",
              config.osmosis.poolContract
                ? `wasm._contract_address='${config.osmosis.poolContract}'`
                : null,
              "wasm.action='swap'",
            ].filter(Boolean).join(' AND '),
          },
        };

        // 2. AI intent IBC messages (COMPUTE_BID, INFERENCE_REQUEST, etc.)
        const aiIntentSubscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 'osmosis-ai-intents',
          params: {
            query: [
              "tm.event='Tx'",
              "message.module='ibc'",
              "fungible_token_packet.receiver!=''"
            ].join(' AND '),
          },
        };

        this.osmosisWs.send(JSON.stringify(poolSubscription));
        this.osmosisWs.send(JSON.stringify(aiIntentSubscription));

        logger.info({
          poolContract: config.osmosis.poolContract || '(all pools)',
        }, 'Subscribed to Osmosis pool + AI intent events');
      });

      this.osmosisWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.result?.data) {
            await this._handleOsmosisEvent(message.id, message.result.data);
          }
        } catch (error) {
          logger.error({ err: error }, 'Error processing Osmosis WebSocket message');
        }
      });

      this.osmosisWs.on('error', (error) => {
        logger.error({ err: error }, 'Osmosis WebSocket error');
      });

      this.osmosisWs.on('close', () => {
        logger.warn('Osmosis WebSocket disconnected');
        if (this.isListening) {
          this._reconnect('osmosis', () => this.connectOsmosisWebSocket());
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to Osmosis WebSocket');
      if (this.isListening) {
        this._reconnect('osmosis', () => this.connectOsmosisWebSocket());
      }
    }
  }

  // ─── Akash WebSocket ────────────────────────────────────────────────────

  /**
   * Connect to Akash chain WebSocket for bid acceptance and lease events
   * @returns {Promise<void>}
   */
  async connectAkashWebSocket() {
    try {
      const wsUrl = config.akash.wsUrl;
      logger.info({ wsUrl }, 'Connecting to Akash WebSocket');

      this.akashWs = new WebSocket(wsUrl);

      this.akashWs.on('open', () => {
        logger.info('Akash WebSocket connected');
        this.reconnectAttempts.akash = 0;

        // Subscribe to bid acceptance events (GPU lease bids)
        const bidSubscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 'akash-bid-events',
          params: {
            query: "tm.event='Tx' AND message.action='/akash.market.v1beta4.MsgCreateBid'",
          },
        };

        // Subscribe to lease creation events
        const leaseSubscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 'akash-lease-events',
          params: {
            query: "tm.event='Tx' AND message.action='/akash.market.v1beta4.MsgCreateLease'",
          },
        };

        // Subscribe to IBC transfers targeting our relay address (AI task settlements)
        const ibcSubscription = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: 'akash-ibc-ai',
          params: {
            query: [
              "tm.event='Tx'",
              "message.module='ibc'",
              config.akash.relayAddress
                ? `transfer.recipient='${config.akash.relayAddress}'`
                : null,
            ].filter(Boolean).join(' AND '),
          },
        };

        this.akashWs.send(JSON.stringify(bidSubscription));
        this.akashWs.send(JSON.stringify(leaseSubscription));
        this.akashWs.send(JSON.stringify(ibcSubscription));

        logger.info('Subscribed to Akash bid/lease/IBC events');
      });

      this.akashWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.result?.data) {
            await this._handleAkashEvent(message.id, message.result.data);
          }
        } catch (error) {
          logger.error({ err: error }, 'Error processing Akash WebSocket message');
        }
      });

      this.akashWs.on('error', (error) => {
        logger.error({ err: error }, 'Akash WebSocket error');
      });

      this.akashWs.on('close', () => {
        logger.warn('Akash WebSocket disconnected');
        if (this.isListening) {
          this._reconnect('akash', () => this.connectAkashWebSocket());
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to Akash WebSocket');
      if (this.isListening) {
        this._reconnect('akash', () => this.connectAkashWebSocket());
      }
    }
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────

  /**
   * Handle Osmosis chain event (pool swaps, AI intents via IBC)
   * @param {string} subscriptionId - Subscription that received the event
   * @param {Object} eventData - Raw Tendermint event data
   * @returns {Promise<void>}
   * @private
   */
  async _handleOsmosisEvent(subscriptionId, eventData) {
    try {
      const txHash = eventData.value?.TxResult?.hash || 'unknown';
      const eventId = `osmosis-${txHash}`;

      if (this.processedEvents.has(eventId)) {
        return;
      }

      const events = eventData.value?.TxResult?.result?.events || [];
      const height = eventData.value?.TxResult?.height || 0;

      // Parse wasm events for AI intent messages in memo/attributes
      const aiIntent = this._parseAIIntentFromEvents(events, 'osmosis');

      if (aiIntent) {
        this.processedEvents.add(eventId);
        logger.info({
          eventId,
          intentType: aiIntent.type,
          amount: aiIntent.amount,
          sender: aiIntent.sender,
          height,
        }, 'Osmosis AI intent detected');

        await this._processAIIntent(aiIntent, {
          chain: 'osmosis',
          txHash,
          height,
        });
        return;
      }

      // Check for Osmosis pool events that trigger AI routing
      const poolEvent = this._parseOsmosisPoolEvent(events);

      if (poolEvent) {
        this.processedEvents.add(eventId);
        logger.info({
          eventId,
          poolId: poolEvent.poolId,
          tokenIn: poolEvent.tokenIn,
          tokenOut: poolEvent.tokenOut,
          amountIn: poolEvent.amountIn,
          height,
        }, 'Osmosis pool event detected — checking for AI route trigger');

        await this._handlePoolTrigger(poolEvent, {
          chain: 'osmosis',
          txHash,
          height,
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'Error handling Osmosis event');
    }
  }

  /**
   * Handle Akash chain event (bid acceptance, lease creation, IBC AI tasks)
   * @param {string} subscriptionId - Subscription that received the event
   * @param {Object} eventData - Raw Tendermint event data
   * @returns {Promise<void>}
   * @private
   */
  async _handleAkashEvent(subscriptionId, eventData) {
    try {
      const txHash = eventData.value?.TxResult?.hash || 'unknown';
      const eventId = `akash-${txHash}`;

      if (this.processedEvents.has(eventId)) {
        return;
      }

      const events = eventData.value?.TxResult?.result?.events || [];
      const height = eventData.value?.TxResult?.height || 0;

      // Parse bid acceptance events
      const bidEvent = this._parseAkashBidEvent(events);

      if (bidEvent) {
        this.processedEvents.add(eventId);
        this.metrics.totalComputeBids++;

        logger.info({
          eventId,
          owner: bidEvent.owner,
          provider: bidEvent.provider,
          dseq: bidEvent.dseq,
          price: bidEvent.price,
          height,
        }, 'Akash bid event detected — routing to Theta Edge for inference');

        await this._processAkashBid(bidEvent, {
          chain: 'akash',
          txHash,
          height,
        });
        return;
      }

      // Parse lease creation events (GPU lease activated)
      const leaseEvent = this._parseAkashLeaseEvent(events);

      if (leaseEvent) {
        this.processedEvents.add(eventId);
        logger.info({
          eventId,
          owner: leaseEvent.owner,
          provider: leaseEvent.provider,
          dseq: leaseEvent.dseq,
          height,
        }, 'Akash lease created — monitoring for completion');

        await this._monitorLeaseCompletion(leaseEvent, {
          chain: 'akash',
          txHash,
          height,
        });
        return;
      }

      // Parse IBC AI intent messages
      const aiIntent = this._parseAIIntentFromEvents(events, 'akash');

      if (aiIntent) {
        this.processedEvents.add(eventId);
        logger.info({
          eventId,
          intentType: aiIntent.type,
          amount: aiIntent.amount,
          sender: aiIntent.sender,
          height,
        }, 'Akash AI intent detected via IBC');

        await this._processAIIntent(aiIntent, {
          chain: 'akash',
          txHash,
          height,
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'Error handling Akash event');
    }
  }

  // ─── Event Parsers ──────────────────────────────────────────────────────

  /**
   * Parse AI intent from Cosmos SDK/wasm transaction events
   * Looks for wasm attributes or IBC memo fields containing AI intent data
   * @param {Array} events - Transaction events from TxResult
   * @param {string} chain - Source chain identifier
   * @returns {Object|null} Parsed AI intent or null
   * @private
   */
  _parseAIIntentFromEvents(events, chain) {
    try {
      // Look for wasm events with AI intent attributes
      for (const event of events) {
        if (event.type !== 'wasm') continue;

        const attrs = this._decodeAttributes(event.attributes);

        // Check for xfuel_ai_intent action
        const action = attrs.action;
        if (!action || !Object.values(AI_INTENT_TYPES).includes(action)) {
          continue;
        }

        return {
          type: action,
          sender: attrs.sender || null,
          recipient: attrs.recipient || null,
          amount: attrs.amount || '0',
          denom: attrs.denom || 'uosmo',
          thetaRecipient: attrs.theta_recipient || null,
          modelId: attrs.model_id || null,
          inputHash: attrs.input_hash || null,
          maxGpuHours: attrs.max_gpu_hours || null,
          nonce: attrs.nonce || null,
          memo: attrs.memo || null,
          chain,
        };
      }

      // Check IBC packet memo for embedded AI intent (Osmosis IBC memo convention)
      for (const event of events) {
        if (event.type !== 'recv_packet' && event.type !== 'send_packet') continue;

        const attrs = this._decodeAttributes(event.attributes);
        const packetData = attrs.packet_data;

        if (!packetData) continue;

        try {
          const parsed = JSON.parse(packetData);
          const memo = parsed.memo ? JSON.parse(parsed.memo) : null;

          if (memo?.xfuel_ai_intent) {
            const intent = memo.xfuel_ai_intent;
            return {
              type: intent.type || AI_INTENT_TYPES.INFERENCE_REQUEST,
              sender: parsed.sender || null,
              recipient: parsed.receiver || null,
              amount: parsed.amount || '0',
              denom: parsed.denom || 'uosmo',
              thetaRecipient: intent.theta_recipient || null,
              modelId: intent.model_id || null,
              inputHash: intent.input_hash || null,
              maxGpuHours: intent.max_gpu_hours || null,
              nonce: intent.nonce || null,
              memo: JSON.stringify(intent),
              chain,
            };
          }
        } catch {
          // Not a JSON memo — skip
        }
      }

      return null;
    } catch (error) {
      logger.error({ err: error }, 'Error parsing AI intent from events');
      return null;
    }
  }

  /**
   * Parse Osmosis pool swap event (ibcTFUEL pair triggers)
   * @param {Array} events - Transaction events
   * @returns {Object|null} Pool event data
   * @private
   */
  _parseOsmosisPoolEvent(events) {
    try {
      for (const event of events) {
        if (event.type !== 'wasm' && event.type !== 'token_swapped') continue;

        const attrs = this._decodeAttributes(event.attributes);
        const action = attrs.action || attrs.module;

        if (action !== 'swap' && event.type !== 'token_swapped') continue;

        const tokenIn = attrs.tokens_in || attrs.token_in || '';
        const tokenOut = attrs.tokens_out || attrs.token_out || '';

        // Only process swaps involving ibcTFUEL (our token)
        const ibcTFUELDenom = config.osmosis?.ibcTFUELDenom || 'ibc/TFUEL';
        if (!tokenIn.includes(ibcTFUELDenom) && !tokenOut.includes(ibcTFUELDenom)) {
          continue;
        }

        return {
          poolId: attrs.pool_id || 'unknown',
          sender: attrs.sender || attrs.acc_seq?.split('/')[0] || null,
          tokenIn,
          tokenOut,
          amountIn: attrs.tokens_in || '0',
          amountOut: attrs.tokens_out || '0',
        };
      }

      return null;
    } catch (error) {
      logger.error({ err: error }, 'Error parsing Osmosis pool event');
      return null;
    }
  }

  /**
   * Parse Akash bid creation/acceptance event
   * @param {Array} events - Transaction events
   * @returns {Object|null} Bid event data
   * @private
   */
  _parseAkashBidEvent(events) {
    try {
      for (const event of events) {
        if (event.type !== 'akash.market.v1beta4.EventBidCreated' &&
            event.type !== 'akash.market.v1beta4.EventBidClosed') {
          continue;
        }

        const attrs = this._decodeAttributes(event.attributes);

        return {
          eventType: event.type,
          owner: attrs.owner || null,
          provider: attrs.provider || null,
          dseq: attrs.dseq || null,
          gseq: attrs.gseq || '1',
          oseq: attrs.oseq || '1',
          price: attrs.price || '0',
          state: attrs.state || null,
        };
      }

      return null;
    } catch (error) {
      logger.error({ err: error }, 'Error parsing Akash bid event');
      return null;
    }
  }

  /**
   * Parse Akash lease creation event (GPU lease activated)
   * @param {Array} events - Transaction events
   * @returns {Object|null} Lease event data
   * @private
   */
  _parseAkashLeaseEvent(events) {
    try {
      for (const event of events) {
        if (event.type !== 'akash.market.v1beta4.EventLeaseCreated') {
          continue;
        }

        const attrs = this._decodeAttributes(event.attributes);

        return {
          owner: attrs.owner || null,
          provider: attrs.provider || null,
          dseq: attrs.dseq || null,
          gseq: attrs.gseq || '1',
          oseq: attrs.oseq || '1',
          price: attrs.price || '0',
        };
      }

      return null;
    } catch (error) {
      logger.error({ err: error }, 'Error parsing Akash lease event');
      return null;
    }
  }

  /**
   * Decode base64-encoded Cosmos event attributes
   * @param {Array} attributes - Event attributes
   * @returns {Object} Decoded key-value map
   * @private
   */
  _decodeAttributes(attributes) {
    const result = {};
    if (!Array.isArray(attributes)) return result;

    for (const attr of attributes) {
      try {
        const key = attr.key.includes('=')
          ? Buffer.from(attr.key, 'base64').toString()
          : attr.key;
        const value = attr.value
          ? (attr.value.includes('=')
              ? Buffer.from(attr.value, 'base64').toString()
              : attr.value)
          : '';
        result[key] = value;
      } catch {
        // Non-base64 encoded attribute — use raw value
        if (attr.key) result[attr.key] = attr.value || '';
      }
    }

    return result;
  }

  // ─── AI Task Processing ─────────────────────────────────────────────────

  /**
   * Process an AI intent message (COMPUTE_BID, INFERENCE_REQUEST, etc.)
   * Routes to Theta Edge Cloud, generates SP1 proof, collects fees
   * @param {Object} intent - Parsed AI intent data
   * @param {Object} meta - Chain metadata (chain, txHash, height)
   * @returns {Promise<void>}
   * @private
   */
  async _processAIIntent(intent, meta) {
    const taskId = `ai-task-${++this.taskNonce}-${Date.now()}`;
    this.metrics.totalTasksReceived++;

    const task = {
      taskId,
      intent,
      meta,
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      feeAmount: null,
      sp1Proof: null,
      result: null,
    };

    this.activeTasks.set(taskId, task);

    logger.info({
      taskId,
      intentType: intent.type,
      chain: meta.chain,
      sender: intent.sender,
      amount: intent.amount,
    }, 'Processing AI intent');

    try {
      // Step 1: Validate task amount meets minimum threshold
      if (BigInt(intent.amount || '0') < BigInt(MIN_TASK_AMOUNT)) {
        logger.warn({ taskId, amount: intent.amount }, 'Task amount below minimum threshold');
        task.status = TASK_STATUS.FAILED;
        task.updatedAt = Date.now();
        this.metrics.totalTasksFailed++;
        return;
      }

      // Step 2: Calculate fee (0.5% of task value)
      const taskAmount = BigInt(intent.amount);
      const feeAmount = (taskAmount * BigInt(AI_TASK_FEE_BPS)) / BigInt(FEE_DENOMINATOR);
      const netAmount = taskAmount - feeAmount;
      task.feeAmount = feeAmount.toString();
      // Persist net too — the SP1 guest recomputes fee/net from gross and asserts
      // they reconcile. Without this task.netAmount was undefined and the proof
      // request sent gross as net → guest "fee calculation mismatch" panic.
      task.netAmount = netAmount.toString();

      logger.info({
        taskId,
        grossAmount: taskAmount.toString(),
        feeAmount: feeAmount.toString(),
        netAmount: netAmount.toString(),
        feeBps: AI_TASK_FEE_BPS,
      }, 'Fee calculated for AI task');

      // Step 3: Route to appropriate handler based on intent type
      task.status = TASK_STATUS.ROUTED;
      task.updatedAt = Date.now();

      switch (intent.type) {
        case AI_INTENT_TYPES.COMPUTE_BID:
          await this._routeComputeBid(task, netAmount);
          break;

        case AI_INTENT_TYPES.INFERENCE_REQUEST:
          await this._routeInferenceRequest(task, netAmount);
          break;

        case AI_INTENT_TYPES.COMPUTE_RESULT:
          await this._handleComputeResult(task);
          break;

        case AI_INTENT_TYPES.CAPABILITY_QUERY:
          await this._handleCapabilityQuery(task);
          break;

        case AI_INTENT_TYPES.DATA_ATTESTATION:
          await this._handleDataAttestation(task, netAmount);
          break;

        default:
          logger.warn({ taskId, type: intent.type }, 'Unknown AI intent type');
          task.status = TASK_STATUS.FAILED;
          task.updatedAt = Date.now();
          this.metrics.totalTasksFailed++;
          return;
      }

      // Step 4: Generate SP1 ZK proof for settlement verification
      if (task.status === TASK_STATUS.COMPLETED) {
        await this._generateTaskProof(task);

        // Step 5: Collect fee via FeeCollector.wasm
        await this._collectFee(task, feeAmount);
      }
    } catch (error) {
      logger.error({ err: error, taskId }, 'Error processing AI intent');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  /**
   * Route compute bid to Theta Edge Cloud for GPU resource matching
   * @param {Object} task - Task data
   * @param {bigint} netAmount - Net amount after fee
   * @returns {Promise<void>}
   * @private
   */
  async _routeComputeBid(task, netAmount) {
    task.status = TASK_STATUS.EXECUTING;
    task.updatedAt = Date.now();

    try {
      const thetaEdgeUrl = config.aiListener?.thetaEdgeUrl;

      if (!thetaEdgeUrl) {
        // Mock mode — simulate compute bid routing
        logger.info({ taskId: task.taskId }, 'MOCK: Routing compute bid to Theta Edge (no THETA_EDGE_URL)');
        task.result = {
          mock: true,
          provider: 'theta-edge-mock',
          gpuType: 'A100',
          pricePerHour: '0.5',
          estimatedCompletion: Date.now() + 3600000,
        };
        task.status = TASK_STATUS.COMPLETED;
        task.updatedAt = Date.now();
        this.metrics.totalTasksCompleted++;
        return;
      }

      // Route to Theta Edge Cloud API
      const response = await axios.post(`${thetaEdgeUrl}/api/v1/compute/bid`, {
        model_id: task.intent.modelId,
        input_hash: task.intent.inputHash,
        max_gpu_hours: task.intent.maxGpuHours || '1',
        budget: netAmount.toString(),
        requester: task.intent.sender,
        theta_recipient: task.intent.thetaRecipient,
        source_chain: task.meta.chain,
        source_tx: task.meta.txHash,
      }, {
        timeout: config.aiListener?.routingTimeout || 30000,
        headers: { 'Content-Type': 'application/json' },
      });

      task.result = response.data;
      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;

      logger.info({
        taskId: task.taskId,
        provider: response.data.provider,
        jobId: response.data.job_id,
      }, 'Compute bid routed to Theta Edge successfully');
    } catch (error) {
      logger.error({ err: error, taskId: task.taskId }, 'Failed to route compute bid');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  /**
   * Route inference request to optimal provider (Theta Edge / Akash / TAO)
   * @param {Object} task - Task data
   * @param {bigint} netAmount - Net amount after fee
   * @returns {Promise<void>}
   * @private
   */
  async _routeInferenceRequest(task, netAmount) {
    task.status = TASK_STATUS.EXECUTING;
    task.updatedAt = Date.now();
    this.metrics.totalInferenceRouted++;

    // Only an explicit caller choice steers routing. `preferredProvider` also
    // carries the float default, which is a treasury setting — letting it pick
    // the hub sent every default request to a provider that could not serve it.
    const preferred = normalizeProviderId(
      task.meta?.requestedProvider ?? task.intent?.requestedProvider ?? null,
    );

    // Resolve the requested model against the live catalog before touching an
    // adapter. `xfuel/auto` and bare aliases are XFuel-side names that no hub
    // recognises — forwarding them raw makes the upstream 404 and drops the task
    // into mock, so a paying caller gets a signed receipt for a fake inference.
    const resolved = await this._resolveIntentModel(task, preferred);
    if (resolved?.error) {
      logger.warn(
        { taskId: task.taskId, requested: resolved.requested, reason: resolved.error },
        'Inference request names an unknown model; failing instead of serving a mock',
      );
      task.error = { code: resolved.error, message: `Unknown model '${resolved.requested}'`, hint: resolved.hint };
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
      return;
    }

    // The hub that actually serves the resolved model. An explicit
    // preferred_provider still wins, but absent one we no longer fall through to
    // a tier list that has never contained AkashML.
    const targetHub = preferred
      || (resolved?.hub === 'akash' ? 'akash-network' : null)
      || (resolved?.hub === 'theta' ? 'theta-edgecloud' : null);

    // Only the OpenAI-compatible hub carries tools. Theta's on-demand API has no
    // tools parameter and the generic router tiers drop it, so forwarding there
    // returns prose where the caller's loop expects a tool call — and bills for
    // it. Refuse instead, matching /v1's `tools_unsupported_on_hub`.
    if (Array.isArray(task.intent?.tools) && task.intent.tools.length && targetHub !== 'akash-network') {
      logger.warn(
        { taskId: task.taskId, hub: targetHub, model: resolved?.id },
        'Tool call requested on a hub that cannot serve tools; failing instead of returning prose',
      );
      task.error = {
        code: 'tools_unsupported_on_hub',
        message: `${resolved?.id || 'the routed model'} does not run on a hub that supports tools`,
        hint: 'Retry without `tools`, or name an AkashML model (see GET /v1/models).',
      };
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
      return;
    }

    // Prefer first-class adapters (AkashML / EdgeCloud). Avoids debiting one
    // float while another tier serves.
    if (targetHub === 'akash-network' && akashmlApiKey()) {
      try {
        if (await this._routeViaAkashML(task, netAmount, resolved)) {
          await this._reconcileProviderCogs(task);
          return;
        }
      } catch (err) {
        logger.warn({ err: err.message, taskId: task.taskId }, 'AkashML preferred route failed; falling through');
      }
    }
    if (targetHub === 'theta-edgecloud' && process.env.THETA_EDGECLOUD_API_KEY) {
      try {
        if (await this._routeViaEdgeCloud(task, netAmount, resolved)) {
          await this._reconcileProviderCogs(task);
          return;
        }
      } catch (err) {
        logger.warn({ err: err.message, taskId: task.taskId }, 'EdgeCloud preferred route failed; falling through');
      }
    }

    // Route through the provider-agnostic ComputeRouter (EdgeCloud → RapidAPI →
    // MCP → Akash → Render → OpenAI-compatible → Bedrock → Claude) by default.
    // This is a safe no-op for hash-only requests: the executors need raw input,
    // so a privacy-mode request (input_hash only) or any failure falls through
    // to the default THETA_EDGE_URL path below. Opt out with M2M_USE_FULL_ROUTER=false.
    if (process.env.M2M_USE_FULL_ROUTER !== 'false') {
      try {
        const handled = await this._routeInferenceViaFullRouter(task, netAmount);
        if (handled) {
          await this._reconcileProviderCogs(task);
          return;
        }
        // Declines for two different reasons — hash-only request (nothing to
        // execute) vs every tier unavailable. Saying "no raw input" for both
        // sends you hunting the wrong bug.
        logger.info(
          {
            taskId: task.taskId,
            reason: task.intent?.messages || task.intent?.input ? 'no_tier_available' : 'no_raw_input',
          },
          'Full router declined; using default path',
        );
      } catch (err) {
        logger.warn({ err: err.message, taskId: task.taskId }, 'Full router error; using default path');
      }
    }

    try {
      const thetaEdgeUrl = config.aiListener?.thetaEdgeUrl;

      if (!thetaEdgeUrl) {
        // Every real route declined. This used to fall through to a mock and mark
        // the task COMPLETED, which minted a correctly signed receipt for an
        // inference that never ran — and `/task-request` is the surface that took
        // the USDC. Failing is the honest outcome; the mock is opt-in for local
        // work only.
        if (!mockInferenceAllowed()) {
          logger.warn(
            { taskId: task.taskId, model: task.intent?.modelId },
            'No provider could serve this task; failing rather than returning a mock',
          );
          task.error = {
            code: 'no_provider_available',
            message: 'No configured provider could serve this request',
            hint: 'Check hub credentials (AKASHML_API_KEY / THETA_EDGECLOUD_API_KEY) or retry.',
          };
          task.status = TASK_STATUS.FAILED;
          task.updatedAt = Date.now();
          this.metrics.totalTasksFailed++;
          return;
        }
        logger.info({ taskId: task.taskId }, 'MOCK: Routing inference request (ALLOW_MOCK_INFERENCE)');
        task.result = {
          mock: true,
          provider: 'theta-edge-mock',
          outputHash: ethers.keccak256(ethers.toUtf8Bytes(`mock-output-${task.taskId}`)),
          inferenceTime: 1500,
          model: task.intent.modelId || 'default-llm',
        };
        task.status = TASK_STATUS.COMPLETED;
        task.updatedAt = Date.now();
        this.metrics.totalTasksCompleted++;
        await this._reconcileProviderCogs(task);
        return;
      }

      // Route to Theta Edge Cloud inference API
      const response = await axios.post(`${thetaEdgeUrl}/api/v1/inference/run`, {
        model_id: task.intent.modelId || 'default-llm',
        input_hash: task.intent.inputHash,
        budget: netAmount.toString(),
        requester: task.intent.sender,
        source_chain: task.meta.chain,
        source_tx: task.meta.txHash,
      }, {
        timeout: config.aiListener?.inferenceTimeout || 60000,
        headers: { 'Content-Type': 'application/json' },
      });

      task.result = {
        ...response.data,
        provider: response.data?.provider || 'theta-edgecloud',
      };
      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;
      await this._reconcileProviderCogs(task);

      logger.info({
        taskId: task.taskId,
        outputHash: response.data.output_hash,
        inferenceTime: response.data.inference_time_ms,
      }, 'Inference request completed on Theta Edge');
    } catch (error) {
      logger.error({ err: error, taskId: task.taskId }, 'Failed to route inference request');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  /**
   * Resolve intent.modelId against the live hub catalog, so the M2M path names
   * models exactly like /v1 does. Returns the serving hub and the hub-native
   * alias, or an error for ids no hub can serve.
   * @returns {Promise<{hub: string, alias: string, id: string, requested: string}
   *   | {error: string, requested: string, hint?: string} | null>}
   * @private
   */
  async _resolveIntentModel(task, preferredHub) {
    const requested = task.intent?.modelId || null;
    // Hash-only requests never reach an adapter; nothing to resolve.
    if (!task.intent?.messages && !task.intent?.input && !task.intent?.prompt) return null;
    try {
      const { models } = await getHubCatalog();
      // Tool-shaped work resolves `xfuel/auto` differently from a short
      // completion — the models diverge sharply on loops. See hub-catalog.js.
      const shape = requestShape(task.intent || {});

      // "Auto, but on this hub" — a named provider narrows the auto pick rather
      // than being ignored or overriding a concretely named model.
      const isAuto = !requested || ['xfuel/auto', 'auto', 'xfuel-auto'].includes(String(requested).trim());
      const hub = preferredHub === 'akash-network' ? 'akash'
        : preferredHub === 'theta-edgecloud' ? 'theta'
        : null;
      if (isAuto && hub) {
        // Reuse the catalog's evidence-led auto ordering, just restricted to the
        // named hub, rather than grabbing whichever model happens to be first.
        const scoped = resolveCatalogModel('xfuel/auto', models.filter((m) => m.hub === hub), { shape });
        if (scoped.ok) {
          return { hub: scoped.model.hub, alias: scoped.model.alias, id: scoped.model.id, requested: 'xfuel/auto' };
        }
      }

      const res = resolveCatalogModel(requested || 'xfuel/auto', models, { modality: 'chat', shape });
      if (!res.ok) return { error: res.reason, requested: res.requested, hint: res.hint };
      return { hub: res.model.hub, alias: res.model.alias, id: res.model.id, requested: res.requested };
    } catch (err) {
      // A catalog outage must not fail an otherwise payable task — fall through
      // to the adapters' own defaults.
      logger.warn({ err: err.message, taskId: task.taskId }, 'Hub catalog unavailable; routing on defaults');
      return null;
    }
  }

  /**
   * Direct AkashML chat inference.
   * @param {{alias: string, id: string}} [resolved] catalog resolution
   * @returns {Promise<boolean>}
   * @private
   */
  async _routeViaAkashML(task, netAmount, resolved) {
    const intent = task.intent || {};
    const messages = Array.isArray(intent.messages) ? intent.messages : null;
    const prompt = intent.input || intent.prompt || null;
    if (!messages && !prompt) return false;

    // Last-resort default only — the catalog resolution above normally decides.
    // GLM-5.2 is the one model that completes a multi-turn agent loop reliably
    // (6/6 against Llama 3.3 70B's 0/6); see docs/MODEL_QUALITY_EVAL.md.
    const model = resolved?.alias
      || intent.modelId
      || process.env.AKASHML_DEFAULT_MODEL
      || 'zai-org/GLM-5.2';
    // Strip hub prefix if a catalog id was passed (akash/zai-org/GLM-5.2).
    const nativeModel = model.startsWith('akash/') ? model.slice('akash/'.length) : model;
    const msgs = messages || [{ role: 'user', content: String(prompt) }];

    const result = await inferAkashML({
      model: nativeModel,
      messages: msgs,
      max_tokens: intent.maxTokens || 500,
      temperature: intent.temperature ?? 0.7,
      tools: intent.tools || null,
      tool_choice: intent.toolChoice || null,
      cacheNamespace: cacheNamespace(task.meta?.apiKeyHash),
    });
    if (!result.ok) {
      logger.warn({ taskId: task.taskId, reason: result.reason }, 'AkashML inference failed');
      return false;
    }

    task.usage = normalizeUsage(result.raw, { messages: msgs, output: result.output });
    task.result = {
      content: result.output,
      // A tool call is the answer, not a missing one — the caller needs it back
      // verbatim to run the next turn of the loop.
      tool_calls: result.toolCalls || null,
      finish_reason: result.finish_reason ?? null,
      // The hub-prefixed catalog id, which is what `/v1` receipts attest and what
      // `/v1/models` publishes — the same model must not be named two different
      // ways in a signed field. Falls back to the native alias off-catalog.
      model: resolved?.id || nativeModel,
      provider: 'akash-network',
      routedTo: 'akash-network',
      raw: result.raw,
      usage: task.usage,
      net_amount: netAmount.toString(),
      elapsed_ms: result.elapsed_ms,
    };
    task.status = TASK_STATUS.COMPLETED;
    task.updatedAt = Date.now();
    this.metrics.totalTasksCompleted++;
    logger.info({ taskId: task.taskId, model: nativeModel }, 'Inference completed via AkashML');
    return true;
  }

  /**
   * Direct Theta EdgeCloud chat inference.
   * @param {{alias: string, id: string}} [resolved] catalog resolution
   * @returns {Promise<boolean>}
   * @private
   */
  async _routeViaEdgeCloud(task, netAmount, resolved) {
    const intent = task.intent || {};
    const messages = Array.isArray(intent.messages) ? intent.messages : null;
    const prompt = intent.input || intent.prompt || null;
    if (!messages && !prompt) return false;

    let alias = resolved?.alias || intent.modelId || 'glm_5_2';
    if (alias.startsWith('theta/')) alias = alias.slice('theta/'.length);
    if (alias.startsWith('akash/')) return false; // wrong hub for this adapter
    // Drop org-style ids that aren't Theta aliases
    if (alias.includes('/')) alias = alias.split('/').pop().replace(/[-.]/g, '_').toLowerCase();

    const msgs = messages || [{ role: 'user', content: String(prompt) }];
    const result = await inferEdgeCloud({
      alias,
      prediction: 'completions',
      input: chatInputFromMessages({
        messages: msgs,
        max_tokens: intent.maxTokens || 500,
        temperature: intent.temperature ?? 0.7,
      }),
    });
    if (!result.ok) {
      logger.warn({ taskId: task.taskId, reason: result.reason, alias }, 'EdgeCloud preferred inference failed');
      return false;
    }

    const content = extractTextOutput(result.output);
    task.usage = normalizeUsage(result.raw, { messages: msgs, output: content });
    task.result = {
      content,
      model: resolved?.id || `theta/${alias}`,
      provider: 'theta-edgecloud',
      routedTo: 'theta-edgecloud',
      raw: result.raw,
      usage: task.usage,
      net_amount: netAmount.toString(),
      elapsed_ms: result.elapsed_ms,
    };
    task.status = TASK_STATUS.COMPLETED;
    task.updatedAt = Date.now();
    this.metrics.totalTasksCompleted++;
    logger.info({ taskId: task.taskId, alias }, 'Inference completed via preferred EdgeCloud');
    return true;
  }

  /**
   * Burn prepaid float COGS against the provider that actually served.
   * @private
   */
  async _reconcileProviderCogs(task) {
    const pending = task.meta?.pendingCogs;
    if (!pending || task.meta?.providerCogs) return;

    const estimated = pending.estimated || '0';
    if (pending.unconstrained && BigInt(estimated || '0') <= 0n) return;

    // Real tokens × the provider's published per-token rate, when both are
    // available. Falls back to the bps estimate — which is a share of our own
    // price, not of the work — and the record says which was used.
    let measured = null;
    try {
      const m = await measureCogs({
        // Served model first: the request may have asked for `xfuel/auto`, which
        // no rate row matches.
        modelId: task.result?.model || task.result?.routedModel || task.intent?.modelId,
        usage: task.usage,
      });
      if (m.basis === 'measured') measured = m.amount;
    } catch (err) {
      logger.warn({ err: err.message, taskId: task.taskId }, 'COGS measurement failed; using estimate');
    }

    try {
      const floatMgr = getFloatManager();
      const actual =
        task.result?.provider
        || task.result?.routedTo
        || task.result?._source
        || null;
      const { provider, record } = floatMgr.reconcileAfterServe({
        preferredProvider: pending.preferred_provider || task.meta?.preferredProvider,
        actualProvider: actual,
        estimated,
        measured,
      });
      if (record) {
        task.meta.providerCogs = record;
        task.meta.provider = provider || record.provider;
      } else if (provider) {
        task.meta.provider = provider;
      }

      if (measured !== null) this._warnIfBelowCost(task, provider, measured, pending.gross);
    } catch (err) {
      logger.error({ err: err.message, taskId: task.taskId }, 'Provider COGS reconcile failed');
    }
  }

  /**
   * Shout when a route was sold below what it cost us.
   *
   * Worth having permanently, not just while the model default is settled: our
   * rate card is deliberately decoupled from COGS, so nothing else in the system
   * would ever notice a provider repricing above our retail. It only fires on a
   * measured cost — an estimate is not evidence of a loss.
   * @private
   */
  _warnIfBelowCost(task, provider, measured, gross) {
    let grossUnits;
    try {
      grossUnits = BigInt(gross || '0');
    } catch {
      return;
    }
    if (grossUnits <= 0n || measured <= grossUnits) return;

    logger.warn({
      taskId: task.taskId,
      provider,
      model: task.intent?.modelId || null,
      gross: grossUnits.toString(),
      cogs: measured.toString(),
      loss: (measured - grossUnits).toString(),
      prompt_tokens: task.usage?.prompt_tokens ?? null,
      completion_tokens: task.usage?.completion_tokens ?? null,
    }, 'Task served below cost — provider COGS exceeded the settled price');
  }

  /**
   * Route an inference task through the provider-agnostic ComputeRouter
   * (EdgeCloud → RapidAPI → MCP → Akash → Render → OpenAI-compatible → Bedrock →
   * Claude). On by default; opt out with M2M_USE_FULL_ROUTER=false. The tier
   * executors run *real* inference, so they need raw input — not just an
   * input_hash. If the intent is hash-only (privacy
   * mode) or no tier produces output, returns false so the caller falls back to
   * the default THETA_EDGE_URL path. Never throws to the caller's happy path on
   * provider issues; returns false instead.
   *
   * @param {Object} task
   * @param {bigint} netAmount
   * @returns {Promise<boolean>} true if the task was completed here
   * @private
   */
  async _routeInferenceViaFullRouter(task, netAmount) {
    const intent = task.intent || {};
    const messages = Array.isArray(intent.messages) ? intent.messages : null;
    const prompt = intent.input || intent.prompt || null;
    if (!messages && !prompt) {
      // Hash-only request — the full router cannot execute without raw input.
      return false;
    }

    // Lazy, isolated import: only loaded when the flag is on. Keeps the M2M
    // server decoupled from the heavier inference handler at load time.
    const { ThetaInferenceHandler } = await import(
      '../../../packages/circuit-runtime/theta-inference/theta-inference-handler.js'
    );
    const { ComputeRouter } = await import(
      '../../../packages/circuit-runtime/theta-inference/compute-router.js'
    );

    if (!this._fullRouterHandler) {
      this._fullRouterHandler = new ThetaInferenceHandler({});
      if (typeof this._fullRouterHandler.resolveApiKeys === 'function') {
        await this._fullRouterHandler.resolveApiKeys().catch(() => {});
      }
    }

    const router = ComputeRouter.fromHandler(this._fullRouterHandler);
    const modelName = intent.modelId || 'default-llm';
    const requestBody = {
      model: modelName,
      messages: messages || undefined,
      prompt: prompt || undefined,
      max_tokens: intent.maxTokens,
      temperature: intent.temperature,
    };

    const preferred = normalizeProviderId(
      task.meta?.preferredProvider || intent.preferredProvider || null,
    );
    // Prefer EdgeCloud when named; do NOT prefer the SDL/lease Akash tier
    // (deliberately rejected — AkashML is the first-class path above).
    const preferTags = preferred === 'theta-edgecloud' ? ['edgecloud'] : undefined;

    // SERVICE_TYPES.LLM_INFERENCE === 0 (see theta-inference-handler.js).
    const routed = await router.route({
      serviceType: 0,
      requestBody,
      modelName,
      gpuName: 'default',
      preferTags,
    });
    if (!routed.result) {
      // All eligible tiers unavailable or returned no output → fall back.
      return false;
    }

    task.usage = normalizeUsage(routed.result?.raw ?? routed.result, {
      messages: messages || undefined,
      prompt: prompt || undefined,
      output: routed.result?.content ?? routed.result?.output,
    });
    task.result = {
      ...routed.result,
      provider: routed.result?._source || routed.source,
      routedTo: routed.source,
      usage: task.usage,
      net_amount: netAmount.toString(),
    };
    task.status = TASK_STATUS.COMPLETED;
    task.updatedAt = Date.now();
    this.metrics.totalTasksCompleted++;
    logger.info({ taskId: task.taskId, routedTo: routed.source }, 'Inference completed via 6-tier ComputeRouter');
    return true;
  }

  /**
   * Handle compute result attestation (provider reports job completion)
   * @param {Object} task - Task data
   * @returns {Promise<void>}
   * @private
   */
  async _handleComputeResult(task) {
    task.status = TASK_STATUS.EXECUTING;
    task.updatedAt = Date.now();

    try {
      // Validate output hash from the intent
      const outputHash = task.intent.inputHash; // COMPUTE_RESULT uses inputHash for output attestation

      if (!outputHash) {
        logger.warn({ taskId: task.taskId }, 'COMPUTE_RESULT missing output hash');
        task.status = TASK_STATUS.FAILED;
        task.updatedAt = Date.now();
        this.metrics.totalTasksFailed++;
        return;
      }

      task.result = {
        attestation: true,
        outputHash,
        attestedAt: Date.now(),
        chain: task.meta.chain,
      };

      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;

      logger.info({
        taskId: task.taskId,
        outputHash,
      }, 'Compute result attestation recorded');
    } catch (error) {
      logger.error({ err: error, taskId: task.taskId }, 'Failed to handle compute result');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  /**
   * Handle capability query (agent discovery across chains)
   * @param {Object} task - Task data
   * @returns {Promise<void>}
   * @private
   */
  async _handleCapabilityQuery(task) {
    try {
      // Return available capabilities across connected DePIN networks
      task.result = {
        capabilities: {
          theta_edge: {
            inference: true,
            gpu_types: ['A100', 'H100', 'RTX4090'],
            models: ['llama-3', 'stable-diffusion-xl', 'whisper-v3'],
            avg_latency_ms: 1500,
          },
          akash: {
            gpu_leases: true,
            regions: ['us-east', 'eu-west', 'ap-southeast'],
            min_lease_hours: 1,
          },
          osmosis: {
            settlement: true,
            pools: ['ibcTFUEL/OSMO', 'ibcTFUEL/WBTC', 'ibcTFUEL/AKT'],
          },
        },
        queriedAt: Date.now(),
      };

      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;

      logger.info({ taskId: task.taskId }, 'Capability query resolved');
    } catch (error) {
      logger.error({ err: error, taskId: task.taskId }, 'Failed to handle capability query');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  /**
   * Handle data attestation (certify dataset provenance on-chain)
   * @param {Object} task - Task data
   * @param {bigint} netAmount - Net amount after fee
   * @returns {Promise<void>}
   * @private
   */
  async _handleDataAttestation(task, netAmount) {
    task.status = TASK_STATUS.EXECUTING;
    task.updatedAt = Date.now();

    try {
      const dataHash = task.intent.inputHash;

      if (!dataHash) {
        logger.warn({ taskId: task.taskId }, 'DATA_ATTESTATION missing data hash');
        task.status = TASK_STATUS.FAILED;
        task.updatedAt = Date.now();
        this.metrics.totalTasksFailed++;
        return;
      }

      // Generate attestation commitment
      const attestationCommitment = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'address', 'uint256', 'uint256'],
          [
            dataHash,
            task.intent.sender || ethers.ZeroAddress,
            netAmount,
            Date.now(),
          ]
        )
      );

      task.result = {
        attestation: true,
        dataHash,
        commitment: attestationCommitment,
        attestedAt: Date.now(),
      };

      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;

      logger.info({
        taskId: task.taskId,
        dataHash,
        commitment: attestationCommitment,
      }, 'Data attestation recorded');
    } catch (error) {
      logger.error({ err: error, taskId: task.taskId }, 'Failed to handle data attestation');
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksFailed++;
    }
  }

  // ─── Akash-Specific Handlers ────────────────────────────────────────────

  /**
   * Process Akash bid event — route to Theta Edge for inference comparison
   * @param {Object} bidEvent - Parsed bid event
   * @param {Object} meta - Chain metadata
   * @returns {Promise<void>}
   * @private
   */
  async _processAkashBid(bidEvent, meta) {
    // Create an AI intent from the Akash bid for unified processing
    const syntheticIntent = {
      type: AI_INTENT_TYPES.COMPUTE_BID,
      sender: bidEvent.owner,
      recipient: bidEvent.provider,
      amount: bidEvent.price || '0',
      denom: 'uakt',
      thetaRecipient: null,
      modelId: null,
      inputHash: null,
      maxGpuHours: null,
      nonce: `${bidEvent.dseq}-${bidEvent.gseq}-${bidEvent.oseq}`,
      memo: JSON.stringify(bidEvent),
      chain: 'akash',
    };

    await this._processAIIntent(syntheticIntent, meta);
  }

  /**
   * Monitor Akash lease completion for settlement
   * @param {Object} leaseEvent - Parsed lease event
   * @param {Object} meta - Chain metadata
   * @returns {Promise<void>}
   * @private
   */
  async _monitorLeaseCompletion(leaseEvent, meta) {
    const taskId = `lease-${leaseEvent.dseq}-${leaseEvent.gseq}`;

    this.activeTasks.set(taskId, {
      taskId,
      intent: {
        type: 'lease_monitor',
        ...leaseEvent,
      },
      meta,
      status: TASK_STATUS.EXECUTING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      feeAmount: null,
      sp1Proof: null,
      result: null,
    });

    logger.info({
      taskId,
      owner: leaseEvent.owner,
      provider: leaseEvent.provider,
      dseq: leaseEvent.dseq,
    }, 'Akash lease monitoring started — will collect fee on completion');
  }

  /**
   * Handle Osmosis pool swap trigger — route ibcTFUEL swaps to AI if flagged
   * @param {Object} poolEvent - Parsed pool event
   * @param {Object} meta - Chain metadata
   * @returns {Promise<void>}
   * @private
   */
  async _handlePoolTrigger(poolEvent, meta) {
    // Check if the swap has an AI routing flag (e.g., large ibcTFUEL swap → AI compute)
    // This is a heuristic; in production, the frontend/agent sets a memo flag
    logger.debug({
      poolId: poolEvent.poolId,
      sender: poolEvent.sender,
      tokenIn: poolEvent.tokenIn,
    }, 'Osmosis pool trigger evaluated (no AI routing flag detected — logging only)');
  }

  // ─── SP1 Proof Generation ──────────────────────────────────────────────

  /**
   * Generate SP1 ZK proof for AI task settlement verification
   * Extends the SP1 prover circuit with AI task proof type
   * @param {Object} task - Completed task data
   * @returns {Promise<void>}
   * @private
   */
  async _generateTaskProof(task) {
    try {
      // Cost gate (Tier 1): the task always settles + gets a signed receipt, but
      // the expensive SP1 proof is optional. When the requesting key isn't
      // allowed to prove (public demo, prover scaled to zero), skip cleanly and
      // mark the task so /task-status reports an honest "gated" status.
      if (task.intent?.proveAllowed === false) {
        task.sp1Proof = {
          skipped: true,
          reason: 'proving_gated',
          note: proveGatedReason(),
          timestamp: Date.now(),
        };
        logger.info({ taskId: task.taskId }, 'SP1 proof gated (cost control); signed receipt only');
        return;
      }

      // The SP1 prover parses amount fields with U256::from_hex (expects a
      // 0x-prefixed, EVEN-length hex string). The backend tracks amounts as
      // decimal wei strings, so a raw value like "1000000" (odd length, decimal)
      // makes the prover's hex::decode fail → /prove returns 400 "Parse error"
      // before proving. Convert to even-length 0x-hex here (value-preserving).
      const toProverHex = (v) => {
        let h = BigInt(v || 0).toString(16);
        if (h.length % 2 === 1) h = '0' + h;
        return '0x' + h;
      };

      // Prepare AI task proof request (compatible with SP1 prover batch format)
      const proofRequest = {
        // Standard SP1 fields
        vault_address: ethers.ZeroAddress, // AI tasks don't use vaults
        net_amount: toProverHex(task.netAmount ?? task.intent.amount),
        block_number: parseInt(task.meta.height) || 0,
        merkle_root: ethers.keccak256(ethers.toUtf8Bytes(task.taskId)),
        identity_commitment: ethers.keccak256(
          ethers.toUtf8Bytes(task.intent.sender || 'anonymous')
        ),

        // AI-specific extensions
        ai_task: true,
        task_type: task.intent.type,
        task_id: task.taskId,
        source_chain: task.meta.chain,
        source_tx: task.meta.txHash,
        fee_amount: toProverHex(task.feeAmount),
        fee_bps: AI_TASK_FEE_BPS,
        output_hash: task.result?.outputHash || task.result?.commitment || null,
        completed_at: task.updatedAt,
        // The SP1 guest requires non-zero model_id_hash + input_hash for an
        // INFERENCE_REQUEST. modelId is required for inference; fall back to the
        // task-id hash for input_hash so an omitted input never zero-panics.
        model_id_hash: task.intent.modelId
          ? ethers.keccak256(ethers.toUtf8Bytes(String(task.intent.modelId)))
          : ethers.keccak256(ethers.toUtf8Bytes(task.taskId)),
        input_hash: task.intent.inputHash
          || ethers.keccak256(ethers.toUtf8Bytes(task.taskId)),
        // Phase 1: proof_system for routing (sp1 | zkgpt) — circuits use this for verifier choice
        proof_system: task.intent.proofSystem || 'sp1',
      };

      // Phase 2 (flag-gated): bind the x402 payment_ref into the proof. When enabled
      // for a USDC-settled task, thread the payment commitment to the prover so the
      // SP1 guest can commit it (v2 layout); null/no-op otherwise. Fully reversible.
      const paymentBinding = buildPaymentBinding(task, config.x402);
      if (paymentBinding) {
        proofRequest.payment_commitment = paymentBinding.commitment;
        proofRequest.payment_ref_hash = paymentBinding.payment_ref_hash;
        proofRequest.payment_rail = 1; // usdc discriminant (matches Solidity)
        proofRequest.payment_amount = paymentBinding.amount;
        logger.info({ taskId: task.taskId, commitment: paymentBinding.commitment.slice(0, 18) + '...' },
          'x402 proof binding: attached payment commitment to proof request');
      }

      const useZkGPT = (task.intent.proofSystem || 'sp1') === 'zkgpt';
      const zkGPTUrl = process.env.ZKGPT_PROVER_URL || '';
      const zkGPTProver = getZkGPTProver();

      logger.info(
        { taskId: task.taskId, useZkGPT, zkGPTConfigured: !!zkGPTProver, zkGPTUrlHint: zkGPTUrl ? `${zkGPTUrl.slice(0, 40)}...` : '(unset)' },
        'Proof generation: branch check'
      );

      let proofResult;
      if (useZkGPT && zkGPTProver) {
        logger.info({ taskId: task.taskId }, 'Generating zkGPT proof for AI task (Phase 1)');
        proofResult = await zkGPTProver.generateProof(proofRequest, true);
        task.sp1Proof = {
          proof: proofResult.proof,
          publicInputs: proofResult.publicInputs,
          publicValues: proofResult.publicValues ?? proofResult.publicInputs,
          nullifier: proofResult.nullifier,
          provingTimeMs: proofResult.provingTimeMs,
          timestamp: Date.now(),
          proofSystem: 'zkgpt',
          paymentBinding: paymentBinding || null,
        };
        logger.info({
          taskId: task.taskId,
          provingTimeMs: proofResult.provingTimeMs,
          nullifier: proofResult.nullifier?.slice(0, 18) + '...',
          proofLen: proofResult.proof?.length ?? 0,
        }, 'zkGPT proof generated for AI task');
      } else {
        if (useZkGPT && !isZkGPTProverConfigured()) {
          logger.warn(
            { taskId: task.taskId },
            'proof_system=zkgpt requested but ZKGPT_PROVER_URL not set; falling back to SP1'
          );
        }
        const sp1Prover = getSP1Prover();
        if (!sp1Prover) {
          logger.warn({ taskId: task.taskId }, 'SP1_PROVER_URL not set; skipping SP1 proof');
          task.sp1Proof = {
            error: 'SP1_PROVER_URL not set',
            timestamp: Date.now(),
            // The x402 payment binding is derived from the settlement (payment_ref +
            // task + rail + amount), not from the prover — surface it as server-attested
            // metadata (in_proof:false) even when no proof was generated, so the public
            // receipt can still verify "paid" against the on-chain settlement.
            paymentBinding: paymentBinding || null,
          };
        } else {
          logger.info({
            taskId: task.taskId,
            intentType: task.intent.type,
            amount: task.intent.amount,
          }, 'Generating SP1 ZK proof for AI task settlement');
          proofResult = await sp1Prover.generateProof(proofRequest, true);
          const bindingInProof =
            paymentBinding &&
            (proofResult.publicValuesVersion === 2 ||
              proofResult.aiPublicValuesAbi != null);
          task.sp1Proof = {
            proof: proofResult.proof,
            publicInputs: proofResult.publicInputs,
            nullifier: proofResult.nullifier,
            provingTimeMs: proofResult.provingTimeMs,
            timestamp: Date.now(),
            paymentBinding: paymentBinding
              ? { ...paymentBinding, in_proof: !!bindingInProof }
              : null,
            publicValuesVersion: proofResult.publicValuesVersion ?? null,
            aiPublicValuesAbi: proofResult.aiPublicValuesAbi ?? null,
          };
          logger.info({
            taskId: task.taskId,
            provingTimeMs: proofResult.provingTimeMs,
            nullifier: proofResult.nullifier,
          }, 'SP1 ZK proof generated for AI task');
        }
      }
    } catch (error) {
      // Proof generation failure is non-fatal for AI tasks — log and continue
      // The task is still completed; proof can be regenerated later
      const proverBody = error.response?.data;
      const errCode = error.code ?? error.response?.data?.code;
      const errMsg = error.message ?? String(error);
      logger.warn({
        taskId: task.taskId,
        status: error.response?.status,
        errorCode: errCode,
        errorMessage: errMsg,
        proverError: proverBody?.error ?? (typeof proverBody === 'string' ? proverBody : undefined),
        proverUrlHint: process.env.ZKGPT_PROVER_URL ? `${process.env.ZKGPT_PROVER_URL.replace(/\/$/, '').slice(0, 50)}...` : '(unset)',
      }, 'SP1 proof generation failed for AI task (non-fatal — task still completed)');

      const proverError = proverBody?.error ?? (typeof proverBody === 'string' ? proverBody : undefined);
      task.sp1Proof = {
        error: errMsg,
        prover_error: proverError ?? (errCode ? `${errCode}: ${errMsg}` : errMsg),
        prover_response: typeof proverBody === 'object' && proverBody !== null ? proverBody : undefined,
        timestamp: Date.now(),
        // Keep the settlement's payment binding on failed/regenerable proofs too
        // (server-attested; recomputed pure from the task). See buildPaymentBinding.
        paymentBinding: buildPaymentBinding(task, config.x402),
      };
    }
  }

  // ─── Fee Collection ─────────────────────────────────────────────────────

  /**
   * Collect 0.5% fee on task completion → FeeCollector.wasm
   * 
   * Fee routing:
   * 1. Fee amount calculated as 0.5% of task settlement value
   * 2. CW20 transfer to FeeCollector contract on Osmosis/Persistence
   * 3. FeeCollector accumulates → batch burns → SP1 FeeBurn proof → RevenueSplitter
   * 
   * @param {Object} task - Completed task data
   * @param {bigint} feeAmount - Fee amount to collect
   * @returns {Promise<void>}
   * @private
   */
  async _collectFee(task, feeAmount) {
    if (feeAmount <= BigInt(0)) {
      logger.debug({ taskId: task.taskId }, 'Zero fee — skipping collection');
      return;
    }

    try {
      const feeCollectorAddress = config.osmosis?.feeCollectorContract;

      if (!feeCollectorAddress) {
        // Mock mode — just log and track
        logger.info({
          taskId: task.taskId,
          feeAmount: feeAmount.toString(),
          mode: 'mock',
        }, 'MOCK: Fee collected for AI task (FeeCollector not configured)');

        this.metrics.totalFeesCollected += feeAmount;
        task.status = TASK_STATUS.FEE_COLLECTED;
        task.updatedAt = Date.now();
        return;
      }

      // Production: Send CW20 transfer to FeeCollector.wasm
      logger.info({
        taskId: task.taskId,
        feeAmount: feeAmount.toString(),
        feeCollector: feeCollectorAddress,
        chain: task.meta.chain,
      }, 'Collecting AI task fee via FeeCollector.wasm');

      /* Production implementation:
      const { SigningCosmWasmClient } = await import('@cosmjs/cosmwasm-stargate');
      const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
      const { GasPrice } = await import('@cosmjs/stargate');

      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
        config.osmosis.relayerMnemonic,
        { prefix: 'osmo' }
      );

      const [account] = await wallet.getAccounts();

      const client = await SigningCosmWasmClient.connectWithSigner(
        config.osmosis.rpcUrl,
        wallet,
        { gasPrice: GasPrice.fromString(config.osmosis.gasPrice || '0.025uosmo') }
      );

      // CW20 Send to FeeCollector (if fee is CW20 ibcTFUEL)
      const sendMsg = {
        send: {
          contract: feeCollectorAddress,
          amount: feeAmount.toString(),
          msg: Buffer.from(JSON.stringify({
            source: 'ai_task',
            task_id: task.taskId,
            task_type: task.intent.type,
            source_chain: task.meta.chain,
          })).toString('base64'),
        },
      };

      const result = await client.execute(
        account.address,
        config.osmosis.ibcTFUELContract,  // CW20 token contract
        sendMsg,
        'auto',
        `XFuel AI: Fee for task ${task.taskId}`
      );

      logger.info({
        taskId: task.taskId,
        feeAmount: feeAmount.toString(),
        txHash: result.transactionHash,
        gasUsed: result.gasUsed,
      }, 'AI task fee collected successfully via FeeCollector.wasm');
      */

      // Track metrics regardless of mode
      this.metrics.totalFeesCollected += feeAmount;
      task.status = TASK_STATUS.FEE_COLLECTED;
      task.updatedAt = Date.now();

      logger.info({
        taskId: task.taskId,
        feeAmount: feeAmount.toString(),
        totalFeesCollected: this.metrics.totalFeesCollected.toString(),
      }, 'AI task fee collection recorded (production CW20 transfer pending deployment)');
    } catch (error) {
      logger.error({
        err: error,
        taskId: task.taskId,
        feeAmount: feeAmount.toString(),
      }, 'Failed to collect AI task fee');

      // Fee collection failure is non-fatal — task is still completed
      // Fees can be reconciled later via periodic audit
    }
  }

  // ─── Polling & Reconnection ─────────────────────────────────────────────

  /**
   * Start periodic polling for Osmosis and Akash events as backup
   */
  startPeriodicPolling() {
    const pollInterval = config.aiListener?.pollInterval || 15000;

    this._pollTimer = setInterval(async () => {
      if (!this.isListening) return;

      try {
        await Promise.all([
          this._pollOsmosisEvents(),
          this._pollAkashEvents(),
        ]);
      } catch (error) {
        logger.error({ err: error }, 'Error in AI Listener periodic polling');
      }
    }, pollInterval);

    logger.info({ pollInterval }, 'AI Listener periodic polling started');
  }

  /**
   * Poll Osmosis chain for AI intent events via RPC
   * @returns {Promise<void>}
   * @private
   */
  async _pollOsmosisEvents() {
    if (!config.osmosis?.rpcUrl) return;

    try {
      logger.debug({
        rpcUrl: config.osmosis.rpcUrl,
        lastBlockHeight: this.lastBlockHeights.osmosis,
      }, 'Polling Osmosis for AI intent events');

      // TODO: Implement CosmJS RPC polling when mainnet contracts deployed
      // const { CosmWasmClient } = await import('@cosmjs/cosmwasm-stargate');
      // const client = await CosmWasmClient.connect(config.osmosis.rpcUrl);
      // ... query for AI intent events since lastBlockHeight

      logger.debug('Osmosis poll completed (mock mode)');
    } catch (error) {
      logger.error({ err: error }, 'Failed to poll Osmosis events');
    }
  }

  /**
   * Poll Akash chain for bid/lease events via RPC
   * @returns {Promise<void>}
   * @private
   */
  async _pollAkashEvents() {
    if (!config.akash?.rpcUrl) return;

    try {
      logger.debug({
        rpcUrl: config.akash.rpcUrl,
        lastBlockHeight: this.lastBlockHeights.akash,
      }, 'Polling Akash for bid/lease events');

      // TODO: Implement Akash RPC polling when IBC channels established
      // const client = await StargateClient.connect(config.akash.rpcUrl);
      // ... query for bid/lease events since lastBlockHeight

      logger.debug('Akash poll completed (mock mode)');
    } catch (error) {
      logger.error({ err: error }, 'Failed to poll Akash events');
    }
  }

  /**
   * Start task timeout watcher — fails tasks that exceed max execution time
   */
  startTaskTimeoutWatcher() {
    const timeoutMs = config.aiListener?.taskTimeoutMs || 300000; // 5 min default

    this._timeoutTimer = setInterval(() => {
      const now = Date.now();

      for (const [taskId, task] of this.activeTasks) {
        if (
          (task.status === TASK_STATUS.EXECUTING || task.status === TASK_STATUS.ROUTED) &&
          now - task.createdAt > timeoutMs
        ) {
          logger.warn({
            taskId,
            status: task.status,
            ageMs: now - task.createdAt,
            timeoutMs,
          }, 'AI task timed out');

          task.status = TASK_STATUS.FAILED;
          task.updatedAt = now;
          task.result = { error: 'Task execution timeout' };
          this.metrics.totalTasksFailed++;
        }

        // Clean up completed/failed tasks older than 1 hour
        if (
          (task.status === TASK_STATUS.COMPLETED ||
           task.status === TASK_STATUS.FAILED ||
           task.status === TASK_STATUS.FEE_COLLECTED) &&
          now - task.updatedAt > 3600000
        ) {
          this.activeTasks.delete(taskId);
        }
      }
    }, 30000); // Check every 30 seconds

    logger.info({ timeoutMs }, 'AI task timeout watcher started');
  }

  /**
   * Reconnect WebSocket with exponential backoff
   * @param {string} chain - Chain identifier ('osmosis' or 'akash')
   * @param {Function} connectFn - Reconnection function
   * @private
   */
  _reconnect(chain, connectFn) {
    if (this.reconnectAttempts[chain] >= this.maxReconnectAttempts) {
      logger.error({ chain }, 'Max reconnection attempts reached — switching to polling only');
      return;
    }

    this.reconnectAttempts[chain]++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts[chain] - 1);

    logger.info({
      chain,
      attempt: this.reconnectAttempts[chain],
      delay,
    }, 'Attempting WebSocket reconnection');

    setTimeout(() => connectFn(), delay);
  }

  // ─── Status & Metrics ───────────────────────────────────────────────────

  /**
   * Get listener status for health checks
   * @returns {Object} Current listener status
   */
  getStatus() {
    return {
      isListening: this.isListening,
      connections: {
        osmosis: {
          wsConnected: this.osmosisWs?.readyState === WebSocket.OPEN,
          reconnectAttempts: this.reconnectAttempts.osmosis,
          lastBlockHeight: this.lastBlockHeights.osmosis,
        },
        akash: {
          wsConnected: this.akashWs?.readyState === WebSocket.OPEN,
          reconnectAttempts: this.reconnectAttempts.akash,
          lastBlockHeight: this.lastBlockHeights.akash,
        },
      },
      tasks: {
        active: this.activeTasks.size,
        processedEvents: this.processedEvents.size,
      },
      metrics: this._serializeMetrics(),
    };
  }

  /**
   * Serialize metrics for JSON output (BigInt → string)
   * @returns {Object}
   * @private
   */
  _serializeMetrics() {
    return {
      totalTasksReceived: this.metrics.totalTasksReceived,
      totalTasksCompleted: this.metrics.totalTasksCompleted,
      totalTasksFailed: this.metrics.totalTasksFailed,
      totalFeesCollected: this.metrics.totalFeesCollected.toString(),
      totalInferenceRouted: this.metrics.totalInferenceRouted,
      totalComputeBids: this.metrics.totalComputeBids,
      uptimeMs: this.metrics.uptimeStarted
        ? Date.now() - this.metrics.uptimeStarted
        : 0,
    };
  }
}

// ─── Singleton Management ─────────────────────────────────────────────────

let aiListener = null;

/**
 * Initialize the AI Listener
 * @returns {Promise<AIListener>}
 */
export async function initAIListener() {
  if (!aiListener) {
    aiListener = new AIListener();
    await aiListener.init();
  }
  return aiListener;
}

/**
 * Get the AI Listener instance
 * @returns {AIListener}
 */
export function getAIListener() {
  if (!aiListener) {
    throw new Error('AI Listener not initialized. Call initAIListener() first.');
  }
  return aiListener;
}

export default AIListener;
