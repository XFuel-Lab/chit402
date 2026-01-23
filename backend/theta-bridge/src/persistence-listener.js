import { WebSocket } from 'ws';
import config from './config.js';
import logger from './logger.js';
import { storeReverseBurnEvent } from './redis-client.js';

/**
 * Persistence Chain Burn Event Listener
 * Monitors Persistence chain for ibcTFUEL burn events (reverse-burn loop)
 * 
 * NOTE: This is a PLACEHOLDER implementation using Cosmos SDK WebSocket pattern
 * In production, this would connect to Persistence chain's Tendermint WebSocket
 * and subscribe to burn events via the specific module (e.g., token factory)
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

        // Subscribe to burn events
        // Cosmos SDK WebSocket subscription format
        const subscribeMessage = {
          jsonrpc: '2.0',
          method: 'subscribe',
          id: '1',
          params: {
            query: `tm.event='Tx' AND burn_ibcTFUEL.action='burn'`
          }
        };

        this.ws.send(JSON.stringify(subscribeMessage));
        logger.info('Subscribed to Persistence burn events');
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
   * @returns {Promise<void>}
   */
  async pollForBurnEvents() {
    try {
      // NOTE: This is a PLACEHOLDER for actual Persistence RPC query
      // In production, this would query the Persistence chain for burn events
      // using CosmJS or direct RPC calls to the Tendermint node
      
      logger.debug('Polling for Persistence burn events (PLACEHOLDER)');

      // Example of what production code would look like:
      /*
      const client = await CosmWasmClient.connect(config.persistence.rpcUrl);
      const latestBlock = await client.getHeight();
      
      // Query events from last processed block to current
      const events = await client.searchTx({
        tags: [
          { key: 'message.action', value: 'burn_ibcTFUEL' }
        ]
      }, {
        minHeight: this.lastBlockHeight + 1,
        maxHeight: latestBlock
      });

      for (const event of events) {
        await this.handleBurnEvent(event);
      }

      this.lastBlockHeight = latestBlock;
      */

      // For now, just log that polling is active
      logger.debug({ lastBlockHeight: this.lastBlockHeight }, 'Burn event poll completed');
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
        amount: burnData.amount,
        txHash: burnData.txHash,
        blockHeight: burnData.blockHeight
      }, 'Persistence burn event detected');

      // Mark as processed
      this.processedEvents.add(eventId);

      // Store event in Redis for processing
      await storeReverseBurnEvent(burnData);

      // The yield-unwrapper will pick up this event and process it
      logger.info({ eventId }, 'Burn event queued for yield unwrapping');
    } catch (error) {
      logger.error({ err: error, eventData }, 'Error handling burn event');
    }
  }

  /**
   * Parse burn event from Persistence chain format
   * @param {Object} eventData - Raw event data
   * @returns {Object|null} Parsed burn data
   */
  parseBurnEvent(eventData) {
    try {
      // NOTE: This is a PLACEHOLDER parser
      // Actual format depends on Persistence chain's event structure
      // Typically: { type, attributes: [{key, value}], tx_hash, height }

      // Example parsing for Cosmos SDK event format:
      const attributes = eventData.value?.TxResult?.result?.events?.find(
        e => e.type === 'burn_ibcTFUEL'
      )?.attributes || [];

      const getValue = (key) => {
        const attr = attributes.find(a => a.key === key);
        return attr ? Buffer.from(attr.value, 'base64').toString() : null;
      };

      const burner = getValue('burner');
      const amount = getValue('amount');
      const ibcUSDCYield = getValue('ibc_usdc_yield'); // Yield earned in ibcUSDC

      if (!burner || !amount || !ibcUSDCYield) {
        logger.warn({ eventData }, 'Missing required burn event fields');
        return null;
      }

      return {
        burner,
        amount, // Amount of ibcTFUEL burned
        ibcUSDCYield, // ibcUSDC yield to unwrap
        txHash: eventData.value?.TxResult?.hash || eventData.tx_hash,
        blockHeight: eventData.value?.TxResult?.height || eventData.height,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error({ err: error, eventData }, 'Error parsing burn event');
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




