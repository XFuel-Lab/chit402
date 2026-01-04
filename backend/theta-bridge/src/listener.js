import { ethers } from 'ethers';
import { readFile } from 'fs/promises';
import { getProvider } from './provider.js';
import { getVaultMapping, updateVaultStatus, markVaultCompleted } from './redis-client.js';
import { getProver } from './prover.js';
import { getRefundManager } from './refund-manager.js';
import config from './config.js';
import logger, { logDepositEvent, logProofGenerated } from './logger.js';

/**
 * Event Listener for DepositReceived events
 * Monitors SubVault deposits and processes them through the bridge
 */
class DepositListener {
  constructor() {
    this.vaultFactoryContract = null;
    this.isListening = false;
    this.processedEvents = new Set(); // Prevent duplicate processing
    this.lastProcessedBlock = 0;
  }

  /**
   * Initialize the listener
   * @returns {Promise<void>}
   */
  async init() {
    try {
      const provider = getProvider();

      // Load VaultFactory ABI (to check isVault)
      const vaultFactoryAbi = JSON.parse(
        await readFile(config.contracts.vaultFactoryAbiPath, 'utf8')
      );

      this.vaultFactoryContract = new ethers.Contract(
        config.contracts.vaultFactoryAddress,
        vaultFactoryAbi,
        provider.getProvider()
      );

      // Get current block number
      this.lastProcessedBlock = await provider.getBlockNumber();

      logger.info({
        factoryAddress: config.contracts.vaultFactoryAddress,
        startBlock: this.lastProcessedBlock
      }, 'Deposit listener initialized');
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize deposit listener');
      throw error;
    }
  }

  /**
   * Start listening for DepositReceived events
   * @returns {Promise<void>}
   */
  async startListening() {
    if (this.isListening) {
      logger.warn('Listener already running');
      return;
    }

    this.isListening = true;
    logger.info('Starting deposit event listener');

    // Listen for real-time events
    await this.listenForEvents();

    // Also periodically scan for missed events
    this.startPeriodicScan();
  }

  /**
   * Listen for real-time events
   * @returns {Promise<void>}
   */
  async listenForEvents() {
    try {
      const provider = getProvider();
      const subVaultAbi = JSON.parse(
        await readFile(config.contracts.subVaultAbiPath, 'utf8')
      );

      // Create an interface to parse events
      const iface = new ethers.Interface(subVaultAbi);

      // Listen for logs matching DepositReceived event signature
      const depositEventTopic = ethers.id('DepositReceived(address,address,uint256,uint256,uint256)');

      logger.info({ topic: depositEventTopic }, 'Listening for DepositReceived events');

      // Set up event listener on the provider
      const activeProvider = provider.getProvider();
      
      activeProvider.on({
        topics: [depositEventTopic]
      }, async (log) => {
        try {
          // Parse the event
          const parsedLog = iface.parseLog({
            topics: log.topics,
            data: log.data
          });

          if (parsedLog && parsedLog.name === 'DepositReceived') {
            await this.handleDepositEvent(log, parsedLog);
          }
        } catch (error) {
          logger.error({ err: error, log }, 'Error handling event');
        }
      });

      logger.info('Real-time event listener active');
    } catch (error) {
      logger.error({ err: error }, 'Failed to set up event listener');
      throw error;
    }
  }

  /**
   * Start periodic scan for missed events
   */
  startPeriodicScan() {
    // Scan every 30 seconds for any missed events
    setInterval(async () => {
      if (!this.isListening) return;

      try {
        await this.scanForMissedEvents();
      } catch (error) {
        logger.error({ err: error }, 'Error in periodic scan');
      }
    }, 30000); // 30 seconds

    logger.info('Periodic event scanner started');
  }

  /**
   * Scan for missed events
   * @returns {Promise<void>}
   */
  async scanForMissedEvents() {
    try {
      const provider = getProvider();
      const currentBlock = await provider.getBlockNumber();

      // Don't scan if we're already up to date
      if (currentBlock <= this.lastProcessedBlock) {
        return;
      }

      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = currentBlock;

      logger.debug({
        fromBlock,
        toBlock
      }, 'Scanning for missed events');

      // Query logs
      const subVaultAbi = JSON.parse(
        await readFile(config.contracts.subVaultAbiPath, 'utf8')
      );
      const iface = new ethers.Interface(subVaultAbi);
      const depositEventTopic = ethers.id('DepositReceived(address,address,uint256,uint256,uint256)');

      const logs = await provider.executeWithRetry(async (p) => {
        return await p.getLogs({
          fromBlock,
          toBlock,
          topics: [depositEventTopic]
        });
      });

      logger.info({ count: logs.length, fromBlock, toBlock }, 'Found events in scan');

      for (const log of logs) {
        const parsedLog = iface.parseLog({
          topics: log.topics,
          data: log.data
        });

        if (parsedLog && parsedLog.name === 'DepositReceived') {
          await this.handleDepositEvent(log, parsedLog);
        }
      }

      this.lastProcessedBlock = toBlock;
    } catch (error) {
      logger.error({ err: error }, 'Failed to scan for missed events');
    }
  }

  /**
   * Handle a DepositReceived event
   * @param {Object} log - Raw log object
   * @param {Object} parsedLog - Parsed event data
   * @returns {Promise<void>}
   */
  async handleDepositEvent(log, parsedLog) {
    try {
      // Create event ID to prevent duplicate processing
      const eventId = `${log.transactionHash}-${log.logIndex}`;

      if (this.processedEvents.has(eventId)) {
        logger.debug({ eventId }, 'Event already processed, skipping');
        return;
      }

      // Extract event data
      const vaultAddress = parsedLog.args.vault;
      const sender = parsedLog.args.sender;
      const grossAmount = parsedLog.args.grossAmount;
      const feeAmount = parsedLog.args.feeAmount;
      const netAmount = parsedLog.args.netAmount;

      // Verify this is a valid vault deployed by our factory
      const isVault = await this.vaultFactoryContract.isVault(vaultAddress);
      if (!isVault) {
        logger.warn({ vault: vaultAddress }, 'Event from non-factory vault, ignoring');
        return;
      }

      // Log the event
      logDepositEvent({
        vault: vaultAddress,
        sender,
        grossAmount,
        feeAmount,
        netAmount,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash
      });

      // Mark as processing
      this.processedEvents.add(eventId);

      // Process the deposit
      await this.processDeposit({
        vault: vaultAddress,
        sender,
        grossAmount,
        feeAmount,
        netAmount,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex
      });
    } catch (error) {
      logger.error({ err: error, log }, 'Error processing deposit event');
    }
  }

  /**
   * Process a deposit through the bridge
   * @param {Object} depositData - Deposit event data
   * @returns {Promise<void>}
   */
  async processDeposit(depositData) {
    try {
      logger.info({ vault: depositData.vault }, 'Processing deposit');

      // Step 1: Check if we have a mapping for this vault
      const mapping = await getVaultMapping(depositData.vault);

      if (!mapping) {
        logger.warn({
          vault: depositData.vault
        }, 'No mapping found for vault - initiating refund');

        const refundManager = getRefundManager();
        await refundManager.checkAndRefund(depositData.vault);
        return;
      }

      // Step 2: Check if mapping is expired
      const age = Date.now() - mapping.timestamp;
      if (age > config.expiry.milliseconds) {
        logger.warn({
          vault: depositData.vault,
          ageMinutes: Math.floor(age / 60000)
        }, 'Mapping expired - initiating refund');

        const refundManager = getRefundManager();
        await refundManager.checkAndRefund(depositData.vault);
        return;
      }

      // Step 3: Update status to processing
      await updateVaultStatus(depositData.vault, 'processing');

      // Step 4: Wait for confirmations
      await this.waitForConfirmations(depositData.transactionHash);

      // Step 5: Get block and transaction data for proof
      const provider = getProvider();
      const [block, tx] = await Promise.all([
        provider.getBlock(depositData.blockNumber),
        provider.getTransaction(depositData.transactionHash)
      ]);

      // Step 6: Generate ZK proof
      logger.info({ vault: depositData.vault }, 'Generating ZK proof');
      
      const prover = getProver();
      const proof = await prover.generateProof(
        depositData,
        {
          number: block.number,
          hash: block.hash,
          timestamp: block.timestamp
        },
        {
          hash: tx.hash,
          index: tx.index || 0
        }
      );

      // Step 7: Generate proof hash
      const proofHash = prover.generateProofHash(proof);
      
      logProofGenerated(depositData.vault, proofHash);

      // Step 8: Queue for Persistence minter (Phase 3)
      await this.queueForPersistence(depositData, mapping, proof);

      // Step 9: Mark as completed
      await markVaultCompleted(depositData.vault, proofHash);

      logger.info({
        vault: depositData.vault,
        keplrAddr: mapping.keplrAddr,
        netAmount: ethers.formatEther(depositData.netAmount),
        proofHash
      }, 'Deposit processed successfully');
    } catch (error) {
      logger.error({
        err: error,
        vault: depositData.vault
      }, 'Failed to process deposit');

      // Update status to failed
      await updateVaultStatus(depositData.vault, 'failed');
    }
  }

  /**
   * Wait for required confirmations
   * @param {string} txHash - Transaction hash
   * @returns {Promise<void>}
   */
  async waitForConfirmations(txHash) {
    const provider = getProvider();
    
    logger.info({
      txHash,
      confirmations: config.theta.requiredConfirmations
    }, 'Waiting for confirmations');

    await provider.waitForTransaction(txHash, config.theta.requiredConfirmations);

    logger.info({ txHash }, 'Confirmations received');
  }

  /**
   * Queue proof for Persistence minter contract (Phase 3 integration)
   * @param {Object} depositData - Deposit data
   * @param {Object} mapping - Vault mapping
   * @param {Object} proof - ZK proof
   * @returns {Promise<void>}
   */
  async queueForPersistence(depositData, mapping, proof) {
    // This is a placeholder for Phase 3 integration
    // In production, this would submit the proof to the Persistence chain
    // to mint ibcTFUEL tokens to the user's Keplr address

    logger.info({
      vault: depositData.vault,
      keplrAddr: mapping.keplrAddr,
      netAmount: ethers.formatEther(depositData.netAmount),
      persistenceRpc: config.persistence.rpcUrl,
      minterContract: config.persistence.minterContract
    }, 'Proof queued for Persistence minter (Phase 3 placeholder)');

    // TODO: Phase 3 - Implement Persistence chain submission
    // - Connect to Persistence RPC
    // - Submit proof to minter contract
    // - Mint ibcTFUEL to user's Keplr address
    // - Store submission transaction hash
  }

  /**
   * Stop listening for events
   */
  stopListening() {
    this.isListening = false;
    logger.info('Deposit event listener stopped');
  }

  /**
   * Get listener status
   * @returns {Object}
   */
  getStatus() {
    return {
      isListening: this.isListening,
      lastProcessedBlock: this.lastProcessedBlock,
      processedEventCount: this.processedEvents.size
    };
  }
}

// Create singleton instance
let depositListener = null;

/**
 * Initialize the deposit listener
 * @returns {Promise<DepositListener>}
 */
export async function initListener() {
  if (!depositListener) {
    depositListener = new DepositListener();
    await depositListener.init();
  }
  return depositListener;
}

/**
 * Get the deposit listener instance
 * @returns {DepositListener}
 */
export function getListener() {
  if (!depositListener) {
    throw new Error('Listener not initialized. Call initListener() first.');
  }
  return depositListener;
}

export default DepositListener;

