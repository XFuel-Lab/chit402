import { WebSocket } from 'ws';
import config from './config.js';
import logger from './logger.js';
import { storeReverseBurnEvent } from './redis-client.js';

/**
 * Persistence Chain Burn Event Listener
 * Monitors Persistence chain for BurnForUnwrap events (reverse bridge)
 * 
 * Event Flow:
 * 1. User burns ibcTFUEL on Persistence → triggers BurnForUnwrap event
 * 2. This listener detects the event
 * 3. Event stored in Redis
 * 4. Backend calls unwrapFromBurn() on Theta VaultFactory
 * 5. User receives TFUEL on Theta
 * 
 * Event Structure (from persistence-minter contract):
 * {
 *   type: "wasm-BurnForUnwrap",
 *   attributes: [
 *     { key: "burner", value: "persistence1..." },
 *     { key: "theta_recipient", value: "0x..." },
 *     { key: "burn_amount", value: "100000000000000000" },
 *     { key: "fee_amount", value: "500000000000000" },
 *     { key: "nonce", value: "1" }
 *   ]
 * }
 */
class PersistenceListener {
  constructor() {
    this.ws = null;
    this.isListening = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.processedEvents = new Set();
    this.lastBlockHeight = 0;
  }

  /**
   * Initialize the listener
   * @returns {Promise<void>}
   */
  async init() {
    try {
      logger.info({
        rpcUrl: config.persistence.rpcUrl,
        wsUrl: config.persistence.wsUrl,
        burnEventTopic: config.persistence.burnEventTopic
      }, 'Persistence listener initialized');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize Persistence listener');
      throw error;
    }
  }

  /**
   * Start listening for burn events on Persistence chain
   * @returns {Promise<void>}
   */
  async startListening() {
    if (this.isListening) {
      logger.warn('Persistence listener already running');
      return;
    }

    this.isListening = true;
    logger.info('Starting Persistence burn event listener');

    // Connect to Persistence WebSocket
    await this.connectWebSocket();

    // Also start periodic polling as backup
    this.startPeriodicPolling();
  }

  /**
   * Connect to Persistence chain WebSocket
   * @returns {Promise<void>}
   */
  async connectWebSocket() {
    try {
      const wsUrl = config.persistence.wsUrl;
      
      logger.info({ wsUrl }, 'Connecting to Persistence WebSocket');

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.info('Persistence WebSocket connected');
        this.reconnectAttempts = 0;

        // Subscribe to BurnForUnwrap events from persistence-minter
        // Cosmos SDK WebSocket subscription format
        const subscribeMessage = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: '1',
          params: {
            query: `tm.event='Tx' AND wasm._contract_address='${config.persistence.minterContract}' AND wasm.action='burn_for_unwrap'`
          }
        };

        this.ws.send(JSON.stringify(subscribeMessage));
        logger.info({ 
          minterContract: config.persistence.minterContract 
        }, 'Subscribed to Persistence BurnForUnwrap events');
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.result && message.result.data) {
            await this.handleBurnEvent(message.result.data);
          }
        } catch (error) {
          logger.error({ err: error }, 'Error processing WebSocket message');
        }
      });

      this.ws.on('error', (error) => {
        logger.error({ err: error }, 'Persistence WebSocket error');
      });

      this.ws.on('close', () => {
        logger.warn('Persistence WebSocket disconnected');
        
        if (this.isListening) {
          this.reconnectWebSocket();
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to Persistence WebSocket');
      
      if (this.isListening) {
        this.reconnectWebSocket();
      }
    }
  }

  /**
   * Reconnect WebSocket with exponential backoff
   */
  async reconnectWebSocket() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, switching to polling only');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info({
      attempt: this.reconnectAttempts,
      delay
    }, 'Attempting to reconnect to Persistence WebSocket');

    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Start periodic polling as backup to WebSocket
   */
  startPeriodicPolling() {
    setInterval(async () => {
      if (!this.isListening) return;

      try {
        await this.pollForBurnEvents();
      } catch (error) {
        logger.error({ err: error }, 'Error in periodic polling');
      }
    }, config.persistence.pollInterval);

    logger.info('Periodic event polling started');
  }

  /**
   * Poll for burn events via RPC (backup method)
   * Uses CosmJS to query Persistence chain
   * @returns {Promise<void>}
   */
  async pollForBurnEvents() {
    try {
      logger.debug({ 
        minterContract: config.persistence.minterContract,
        lastBlockHeight: this.lastBlockHeight 
      }, 'Polling for BurnForUnwrap events');

      // TODO: Implement actual CosmJS polling when contracts are deployed
      // For mock testing, this is just a placeholder
      
      /* Production implementation:
      import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
      
      const client = await CosmWasmClient.connect(config.persistence.rpcUrl);
      const latestBlock = await client.getHeight();
      
      // Query wasm events for BurnForUnwrap
      const events = await client.searchTx({
        tags: [
          { key: 'wasm._contract_address', value: config.persistence.minterContract },
          { key: 'wasm.action', value: 'burn_for_unwrap' }
        ]
      }, {
        minHeight: this.lastBlockHeight + 1,
        maxHeight: latestBlock
      });

      for (const tx of events) {
        // Parse tx events
        const burnEvent = parseTxEvents(tx);
        if (burnEvent) {
          await this.handleBurnEvent(burnEvent);
        }
      }

      this.lastBlockHeight = latestBlock;
      */

      logger.debug({ lastBlockHeight: this.lastBlockHeight }, 'Burn event poll completed (mock mode)');
    } catch (error) {
      logger.error({ err: error }, 'Failed to poll for burn events');
    }
  }

  /**
   * Handle a burn event from Persistence chain
   * @param {Object} eventData - Burn event data
   * @returns {Promise<void>}
   */
  async handleBurnEvent(eventData) {
    try {
      // Create event ID to prevent duplicate processing
      const eventId = `${eventData.tx_hash || eventData.txHash}-${eventData.msg_index || 0}`;

      if (this.processedEvents.has(eventId)) {
        logger.debug({ eventId }, 'Burn event already processed, skipping');
        return;
      }

      // Parse burn event data
      // NOTE: Structure depends on actual Persistence chain event format
      const burnData = this.parseBurnEvent(eventData);

      if (!burnData) {
        logger.warn({ eventData }, 'Could not parse burn event');
        return;
      }

      logger.info({
        eventId,
        burner: burnData.burner,
        thetaRecipient: burnData.thetaRecipient,
        unwrapAmount: burnData.unwrapAmount,
        nonce: burnData.nonce,
        txHash: burnData.txHash,
        blockHeight: burnData.blockHeight
      }, 'BurnForUnwrap event detected - queuing for Theta unwrap');

      // Mark as processed
      this.processedEvents.add(eventId);

      // Store event in Redis for processing
      await storeReverseBurnEvent(burnData);

      logger.info({ 
        eventId,
        thetaRecipient: burnData.thetaRecipient,
        unwrapAmount: burnData.unwrapAmount 
      }, 'BurnForUnwrap event queued - will call VaultFactory.unwrapFromBurn()');
    } catch (error) {
      logger.error({ err: error, eventData }, 'Error handling burn event');
    }
  }

  /**
   * Parse burn event from Persistence chain format
   * @param {Object} eventData - Raw event data from Tendermint WebSocket
   * @returns {Object|null} Parsed burn data for reverse bridge
   */
  parseBurnEvent(eventData) {
    try {
      // Cosmos SDK WebSocket event structure:
      // { value: { TxResult: { result: { events: [...] }, hash, height } } }
      
      const events = eventData.value?.TxResult?.result?.events || [];
      const wasmEvent = events.find(e => 
        e.type === 'wasm' && 
        e.attributes.some(a => Buffer.from(a.key, 'base64').toString() === 'action' &&
                               Buffer.from(a.value, 'base64').toString() === 'burn_for_unwrap')
      );

      if (!wasmEvent) {
        return null;
      }

      // Extract attributes from wasm event
      const getValue = (key) => {
        const attr = wasmEvent.attributes.find(a => 
          Buffer.from(a.key, 'base64').toString() === key
        );
        return attr ? Buffer.from(attr.value, 'base64').toString() : null;
      };

      const burner = getValue('burner');
      const thetaRecipient = getValue('theta_recipient');
      const burnAmount = getValue('burn_amount');
      const feeAmount = getValue('fee_amount');
      const nonce = getValue('nonce');

      // Validate required fields
      if (!burner || !thetaRecipient || !burnAmount || !feeAmount || !nonce) {
        logger.warn({ 
          burner, thetaRecipient, burnAmount, feeAmount, nonce 
        }, 'Missing required BurnForUnwrap event fields');
        return null;
      }

      // Calculate unwrap amount (burn - fee = 99.5%)
      const unwrapAmount = (BigInt(burnAmount) - BigInt(feeAmount)).toString();

      logger.info({
        burner,
        thetaRecipient,
        burnAmount,
        feeAmount,
        unwrapAmount,
        nonce
      }, 'Parsed BurnForUnwrap event');

      return {
        burner,
        thetaRecipient,
        burnAmount,
        feeAmount,
        unwrapAmount, // Amount to unwrap on Theta (after 0.5% fee)
        nonce,
        txHash: eventData.value?.TxResult?.hash || eventData.tx_hash,
        blockHeight: eventData.value?.TxResult?.height || eventData.height,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error({ err: error, eventData }, 'Error parsing BurnForUnwrap event');
      return null;
    }
  }

  /**
   * Stop listening for events
   */
  stopListening() {
    this.isListening = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.info('Persistence burn event listener stopped');
  }

  /**
   * Get listener status
   * @returns {Object}
   */
  getStatus() {
    return {
      isListening: this.isListening,
      wsConnected: this.ws && this.ws.readyState === WebSocket.OPEN,
      reconnectAttempts: this.reconnectAttempts,
      lastBlockHeight: this.lastBlockHeight,
      processedEventCount: this.processedEvents.size
    };
  }
}

// Create singleton instance
let persistenceListener = null;

/**
 * Initialize the Persistence listener
 * @returns {Promise<PersistenceListener>}
 */
export async function initPersistenceListener() {
  if (!persistenceListener) {
    persistenceListener = new PersistenceListener();
    await persistenceListener.init();
  }
  return persistenceListener;
}

/**
 * Get the Persistence listener instance
 * @returns {PersistenceListener}
 */
export function getPersistenceListener() {
  if (!persistenceListener) {
    throw new Error('Persistence listener not initialized. Call initPersistenceListener() first.');
  }
  return persistenceListener;
}

export default PersistenceListener;




