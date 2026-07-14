import express from 'express';
import config, { validateConfig } from './config.js';
import logger, { logStartup, logShutdown } from './logger.js';
import { initRedis, closeRedis, getPendingVaults, getReverseBurnStats } from './redis-client.js';
import { initProvider, getProvider } from './provider.js';
import { initSP1Prover } from './sp1-prover-client.js';
import { initRefundManager, getRefundManager } from './refund-manager.js';
import { initListener, getListener } from './listener.js';
import { initPersistenceListener, getPersistenceListener } from './persistence-listener.js';
import { initAIListener, getAIListener } from './ai-listener.js';
import { initYieldUnwrapper, getYieldUnwrapper } from './yield-unwrapper.js';

/**
 * Main service orchestrator for Theta-Persistence ZK Bridge
 */
class BridgeService {
  constructor() {
    this.app = express();
    this.server = null;
    this.isRunning = false;
  }

  /**
   * Initialize all components
   * @returns {Promise<void>}
   */
  async init() {
    try {
      logStartup();

      // Validate configuration
      validateConfig();
      logger.info('Configuration validated');

      // Initialize Redis
      await initRedis();

      // Initialize multi-RPC provider
      initProvider();

      // Initialize SP1 ZK prover client
      await initSP1Prover();

      // Initialize refund manager
      await initRefundManager();

      // Initialize deposit listener (forward flow: Theta -> Persistence)
      await initListener();

      // Initialize reverse-burn components (if configured)
      if (config.yield.revenueSplitterAddress) {
        logger.info('Initializing reverse-burn loop components');

        // Initialize Persistence burn event listener
        await initPersistenceListener();

        // Initialize yield unwrapper
        await initYieldUnwrapper();

        logger.info('Reverse-burn loop components initialized');
      } else {
        logger.warn('Reverse-burn loop disabled: REVENUE_SPLITTER_ADDRESS not configured');
      }

      // Initialize AI Listener (Phase E: Osmosis/Akash AI DePIN Bridge)
      if (config.aiListener?.enabled) {
        logger.info('Initializing AI Listener (Osmosis/Akash IBC event monitoring)');
        await initAIListener();
        logger.info('AI Listener initialized');
      } else {
        logger.info('AI Listener disabled: AI_LISTENER_ENABLED not set to true');
      }

      // Set up HTTP server for health checks and monitoring
      this.setupHttpServer();

      logger.info('All components initialized successfully');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize bridge service');
      throw error;
    }
  }

  /**
   * Set up HTTP server for health checks and API
   */
  setupHttpServer() {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const provider = getProvider();
        const refundManager = getRefundManager();
        const listener = getListener();

        // Check RPC health
        const rpcStatus = await provider.getHealthStatus();
        const blockNumber = await provider.getBlockNumber();

        // Check relayer balance
        const relayerBalance = await refundManager.getRelayerBalance();

        // Get listener status
        const listenerStatus = listener.getStatus();

        // Get pending vaults
        const pendingVaults = await getPendingVaults();

        // Get reverse-burn stats (if enabled)
        const reverseBurnEnabled = config.yield.revenueSplitterAddress ? true : false;
        let reverseBurnStats = null;
        let persistenceListenerStatus = null;
        let yieldUnwrapperStatus = null;

        if (reverseBurnEnabled) {
          try {
            const persistenceListener = getPersistenceListener();
            persistenceListenerStatus = persistenceListener.getStatus();

            const yieldUnwrapper = getYieldUnwrapper();
            yieldUnwrapperStatus = yieldUnwrapper.getStatus();

            reverseBurnStats = await getReverseBurnStats();
          } catch (error) {
            logger.warn({ err: error }, 'Error getting reverse-burn stats');
          }
        }

        // Get AI Listener status (if enabled)
        let aiListenerStatus = null;
        if (config.aiListener?.enabled) {
          try {
            const aiListenerInstance = getAIListener();
            aiListenerStatus = aiListenerInstance.getStatus();
          } catch (error) {
            logger.warn({ err: error }, 'Error getting AI Listener stats');
          }
        }

        res.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          components: {
            rpc: {
              status: 'connected',
              currentBlock: blockNumber,
              endpoints: rpcStatus
            },
            redis: {
              status: 'connected'
            },
            listener: listenerStatus,
            refundManager: {
              relayerBalance,
              pendingRefunds: refundManager.getPendingRefunds().length
            },
            reverseBurn: reverseBurnEnabled ? {
              enabled: true,
              persistenceListener: persistenceListenerStatus,
              yieldUnwrapper: yieldUnwrapperStatus,
              stats: reverseBurnStats
            } : {
              enabled: false
            },
            aiListener: aiListenerStatus ? {
              enabled: true,
              ...aiListenerStatus
            } : {
              enabled: false
            }
          },
          stats: {
            pendingVaults: pendingVaults.length
          }
        });
      } catch (error) {
        logger.error({ err: error }, 'Health check failed');
        res.status(503).json({
          status: 'unhealthy',
          error: error.message
        });
      }
    });

    // Status endpoint
    this.app.get('/status', async (req, res) => {
      try {
        const listener = getListener();
        const refundManager = getRefundManager();
        const pendingVaults = await getPendingVaults();

        res.json({
          isRunning: this.isRunning,
          listener: listener.getStatus(),
          pendingVaults: pendingVaults.length,
          pendingRefunds: refundManager.getPendingRefunds().length
        });
      } catch (error) {
        logger.error({ err: error }, 'Status check failed');
        res.status(500).json({
          error: error.message
        });
      }
    });

    // Get pending vaults
    this.app.get('/api/vaults/pending', async (req, res) => {
      try {
        const vaults = await getPendingVaults();
        res.json({ vaults });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get pending vaults');
        res.status(500).json({
          error: error.message
        });
      }
    });

    // Get RPC health
    this.app.get('/api/rpc/health', async (req, res) => {
      try {
        const provider = getProvider();
        const status = await provider.getHealthStatus();
        res.json({ endpoints: status });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get RPC health');
        res.status(500).json({
          error: error.message
        });
      }
    });

    // Trigger manual refund (admin endpoint - should be protected in production)
    this.app.post('/api/refund/:vaultAddress', async (req, res) => {
      try {
        const { vaultAddress } = req.params;
        const refundManager = getRefundManager();
        
        logger.info({ vault: vaultAddress }, 'Manual refund requested');
        
        const txHash = await refundManager.processRefund(vaultAddress, 'manual_trigger');
        
        if (txHash) {
          res.json({
            success: true,
            txHash
          });
        } else {
          res.status(400).json({
            success: false,
            message: 'Refund could not be processed'
          });
        }
      } catch (error) {
        logger.error({ err: error }, 'Manual refund failed');
        res.status(500).json({
          error: error.message
        });
      }
    });

    logger.info({ port: config.service.port }, 'HTTP server configured');
  }

  /**
   * Start the bridge service
   * @returns {Promise<void>}
   */
  async start() {
    try {
      if (this.isRunning) {
        logger.warn('Service already running');
        return;
      }

      // Start HTTP server
      await new Promise((resolve) => {
        this.server = this.app.listen(config.service.port, () => {
          logger.info({ port: config.service.port }, 'HTTP server started');
          resolve();
        });
      });

      // Start deposit listener
      const listener = getListener();
      await listener.startListening();

      // Start reverse-burn components (if enabled)
      if (config.yield.revenueSplitterAddress) {
        logger.info('Starting reverse-burn loop');

        // Start Persistence listener
        const persistenceListener = getPersistenceListener();
        await persistenceListener.startListening();

        // Start yield unwrapper
        const yieldUnwrapper = getYieldUnwrapper();
        await yieldUnwrapper.startProcessing();

        logger.info('Reverse-burn loop started');
      }

      // Start AI Listener (if enabled)
      if (config.aiListener?.enabled) {
        logger.info('Starting AI Listener (Osmosis/Akash IBC)');
        const aiListenerInstance = getAIListener();
        await aiListenerInstance.startListening();
        logger.info('AI Listener started');
      }

      this.isRunning = true;

      logger.info('Theta-Persistence ZK Bridge service is running');
    } catch (error) {
      logger.error({ err: error }, 'Failed to start bridge service');
      throw error;
    }
  }

  /**
   * Stop the bridge service
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      logShutdown();

      this.isRunning = false;

      // Stop listener
      const listener = getListener();
      listener.stopListening();

      // Stop reverse-burn components (if enabled)
      if (config.yield.revenueSplitterAddress) {
        try {
          const persistenceListener = getPersistenceListener();
          persistenceListener.stopListening();

          const yieldUnwrapper = getYieldUnwrapper();
          yieldUnwrapper.stopProcessing();

          logger.info('Reverse-burn loop stopped');
        } catch (error) {
          logger.warn({ err: error }, 'Error stopping reverse-burn components');
        }
      }

      // Stop AI Listener (if enabled)
      if (config.aiListener?.enabled) {
        try {
          const aiListenerInstance = getAIListener();
          aiListenerInstance.stopListening();
          logger.info('AI Listener stopped');
        } catch (error) {
          logger.warn({ err: error }, 'Error stopping AI Listener');
        }
      }

      // Close HTTP server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
        logger.info('HTTP server stopped');
      }

      // Close Redis
      await closeRedis();

      logger.info('Bridge service stopped');
    } catch (error) {
      logger.error({ err: error }, 'Error stopping bridge service');
      throw error;
    }
  }

  /**
   * Handle graceful shutdown
   */
  setupGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received shutdown signal');
        
        try {
          await this.stop();
          process.exit(0);
        } catch (error) {
          logger.error({ err: error }, 'Error during shutdown');
          process.exit(1);
        }
      });
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error({ err: error }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, 'Unhandled rejection');
      process.exit(1);
    });
  }
}

// Create service instance
const bridgeService = new BridgeService();

/**
 * Main entry point
 */
async function main() {
  try {
    // Setup graceful shutdown
    bridgeService.setupGracefulShutdown();

    // Initialize and start service
    await bridgeService.init();
    await bridgeService.start();

    logger.info('Service ready to process deposits');
  } catch (error) {
    logger.error({ err: error }, 'Fatal error starting service');
    process.exit(1);
  }
}

// Start the service
main();

export default bridgeService;

