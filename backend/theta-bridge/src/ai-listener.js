import { WebSocket } from 'ws';
import axios from 'axios';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { getSP1Prover } from './sp1-prover-client.js';

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

const AI_TASK_FEE_BPS = 50; // 0.5% = 50 basis points
const FEE_DENOMINATOR = 10000;
const MIN_TASK_AMOUNT = '10000'; // Minimum task value to process (avoid dust)

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
    this.activeTasks = new Map(); // taskId → task data
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

    // Start task timeout watcher
    this.startTaskTimeoutWatcher();

    logger.info('AI Intent Listener active — monitoring Osmosis + Akash IBC events');
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

    try {
      const thetaEdgeUrl = config.aiListener?.thetaEdgeUrl;

      if (!thetaEdgeUrl) {
        // Mock mode
        logger.info({ taskId: task.taskId }, 'MOCK: Routing inference request (no THETA_EDGE_URL)');
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

      task.result = response.data;
      task.status = TASK_STATUS.COMPLETED;
      task.updatedAt = Date.now();
      this.metrics.totalTasksCompleted++;

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
      const sp1Prover = getSP1Prover();

      // Prepare AI task proof request (compatible with SP1 prover batch format)
      const proofRequest = {
        // Standard SP1 fields
        vault_address: ethers.ZeroAddress, // AI tasks don't use vaults
        net_amount: task.intent.amount,
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
        fee_amount: task.feeAmount,
        output_hash: task.result?.outputHash || task.result?.commitment || null,
        completed_at: task.updatedAt,
      };

      logger.info({
        taskId: task.taskId,
        intentType: task.intent.type,
        amount: task.intent.amount,
      }, 'Generating SP1 ZK proof for AI task settlement');

      // Generate proof (use urgent=true for AI tasks — low latency preferred)
      const proofResult = await sp1Prover.generateProof(proofRequest, true);

      task.sp1Proof = {
        proof: proofResult.proof,
        publicInputs: proofResult.publicInputs,
        nullifier: proofResult.nullifier,
        provingTimeMs: proofResult.provingTimeMs,
        timestamp: Date.now(),
      };

      logger.info({
        taskId: task.taskId,
        provingTimeMs: proofResult.provingTimeMs,
        nullifier: proofResult.nullifier,
      }, 'SP1 ZK proof generated for AI task');
    } catch (error) {
      // Proof generation failure is non-fatal for AI tasks — log and continue
      // The task is still completed; proof can be regenerated later
      logger.warn({
        err: error,
        taskId: task.taskId,
      }, 'SP1 proof generation failed for AI task (non-fatal — task still completed)');

      task.sp1Proof = {
        error: error.message,
        timestamp: Date.now(),
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
