import { ethers } from 'ethers';
import { readFile } from 'fs/promises';
import { getProvider } from './provider.js';
import { getVaultMapping, updateVaultStatus, markVaultCompleted } from './redis-client.js';
import { getSP1Prover } from './sp1-prover-client.js';
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

      // Step 0: Enforce 1 TFUEL max transaction limit (Phase B E2E testing)
      const maxTxLimit = ethers.parseEther('1.0'); // 1 TFUEL limit
      if (depositData.grossAmount > maxTxLimit) {
        logger.warn({
          vault: depositData.vault,
          grossAmount: ethers.formatEther(depositData.grossAmount),
          maxLimit: '1.0 TFUEL'
        }, 'Transaction exceeds 1 TFUEL limit - initiating refund');

        const refundManager = getRefundManager();
        await refundManager.checkAndRefund(depositData.vault);
        return;
      }

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

      // Step 6: Generate ZK proof using SP1
      logger.info({ vault: depositData.vault }, 'Generating SP1 ZK proof');
      
      const prover = getSP1Prover();
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
   * Now integrated with SP1 prover for ZK proof generation
   * @param {Object} depositData - Deposit data
   * @param {Object} mapping - Vault mapping
   * @param {Object} proof - Legacy proof object (unused, kept for backward compatibility)
   * @returns {Promise<void>}
   * 
   * NOTE: Despite the parameter name, production uses SP1 zkVM proofs (not Groth16).
   * The 'proof' parameter is a legacy artifact from Phase 0 and is not used in production.
   * SP1 proof generation happens within this function via sp1Prover.generateProof().
   */
  async queueForPersistence(depositData, mapping, proof) {
    try {
      // Step 1: Get SP1 prover client
      const sp1Prover = getSP1Prover();
      
      // Step 2: Prepare SP1 proof request from deposit data
      const provider = getProvider();
      const blockData = await provider.getBlock(depositData.blockNumber);
      
      const sp1Request = sp1Prover.prepareProofRequest(depositData, {
        number: blockData.number,
        hash: blockData.hash,
        timestamp: blockData.timestamp
      });
      
      logger.info({
        vault: depositData.vault,
        blockNumber: depositData.blockNumber,
        netAmount: ethers.formatEther(depositData.netAmount)
      }, 'Generating SP1 proof for deposit');
      
      // Step 3: Generate SP1 proof (batching enabled by default, urgent=false for normal flow)
      const sp1ProofResult = await sp1Prover.generateProof(sp1Request, false);
      
      logger.info({
        vault: depositData.vault,
        isBatch: sp1ProofResult.isBatch,
        batchSize: sp1ProofResult.batchSize,
        provingTimeMs: sp1ProofResult.provingTimeMs,
        effectiveTimeMs: sp1ProofResult.effectiveTimeMs
      }, 'SP1 proof generated successfully');
      
      // Step 4: Relay proof to Persistence ZKVerifier
      await this.relayProofToPersistence(depositData, mapping, proof, sp1ProofResult);
      
    } catch (error) {
      logger.error({
        err: error,
        vault: depositData.vault
      }, 'Failed to generate/relay SP1 proof');
      throw error;
    }
  }

  /**
   * Relay proof to Persistence chain ZKVerifier contract
   * Phase C Update: Handle successful mints post-governance approval
   * @param {Object} depositData - Deposit data
   * @param {Object} mapping - Vault mapping
   * @param {Object} groth16Proof - MISNOMER: Legacy parameter name from Phase 0 (unused in production)
   * @param {Object} sp1Proof - SP1 proof result (ACTUAL PRODUCTION PROOF USED)
   * @returns {Promise<void>}
   * 
   * IMPORTANT: Despite parameter naming, production exclusively uses sp1Proof.
   * The 'groth16Proof' parameter is kept for backward compatibility but is not used.
   * Phase 0 used Groth16/Circom, Phase B+ uses SP1 zkVM (RISC-V → STARK → Groth16 wrapper).
   */
  async relayProofToPersistence(depositData, mapping, groth16Proof, sp1Proof) {
    try {
      logger.info({
        vault: depositData.vault,
        keplrAddr: mapping.keplrAddr,
        netAmount: ethers.formatEther(depositData.netAmount),
        persistenceRpc: config.persistence.rpcUrl,
        minterContract: config.persistence.minterContract
      }, 'Relaying proof to Persistence ZKVerifier');

      // Prepare transaction payload for Persistence minter
      const mintPayload = {
        recipient: mapping.keplrAddr,
        amount: depositData.netAmount.toString(),
        vault: depositData.vault,
        blockNumber: depositData.blockNumber,
        txHash: depositData.transactionHash,
        groth16Proof: groth16Proof ? {
          proof: groth16Proof.proof || null,
          publicInputs: groth16Proof.publicInputs || []
        } : null,
        sp1Proof: {
          proof: sp1Proof.proof,
          publicInputs: sp1Proof.publicInputs,
          nullifier: sp1Proof.nullifier,
          isBatch: sp1Proof.isBatch,
          batchSize: sp1Proof.batchSize || 1
        },
        timestamp: Date.now()
      };

      // Phase C: Check if we're in whitelisted mode (post-governance approval)
      const isWhitelisted = config.persistence.whitelistApproved === true;
      
      if (!isWhitelisted) {
        // Pre-approval mode: Store as receipt (Phase A/B behavior)
        logger.info({
          vault: depositData.vault,
          phase: 'pre-approval'
        }, 'Whitelisting not yet approved - storing as receipt');
        
        await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'pending_whitelist');
        return;
      }
      
      // Phase C: Whitelisting approved - attempt real mint
      logger.info({
        vault: depositData.vault,
        phase: 'post-approval'
      }, 'Attempting live mint on Persistence (whitelisting approved)');

      try {
        // Dynamic import of CosmWasm client (only load if needed)
        const { SigningCosmWasmClient } = await import('@cosmjs/cosmwasm-stargate');
        const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
        const { GasPrice } = await import('@cosmjs/stargate');
        
        // Initialize wallet from mnemonic
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
          config.persistence.mnemonic,
          { prefix: 'persistence' }
        );
        
        const [account] = await wallet.getAccounts();
        
        // Connect to Persistence RPC
        const persistenceClient = await SigningCosmWasmClient.connectWithSigner(
          config.persistence.rpcUrl,
          wallet,
          {
            gasPrice: GasPrice.fromString(config.persistence.gasPrice || '0.025uxprt')
          }
        );
        
        // Prepare VerifyAndMint message for ZKVerifier contract
        const executeMsg = {
          verify_and_mint: {
            zk_proof: {
              proof: sp1Proof.proof,
              public_inputs: sp1Proof.publicInputs,
              nullifier: sp1Proof.nullifier
            },
            amount: depositData.netAmount.toString(),
            recipient: mapping.keplrAddr
          }
        };
        
        logger.info({
          contract: config.persistence.zkVerifierContract,
          sender: account.address,
          msg: executeMsg
        }, 'Executing VerifyAndMint on ZKVerifier');
        
        // Execute mint transaction
        const result = await persistenceClient.execute(
          account.address,
          config.persistence.zkVerifierContract,
          executeMsg,
          'auto', // Auto gas estimation
          'XFuel Bridge: Mint ibcTFUEL from Theta deposit' // Memo
        );
        
        logger.info({
          vault: depositData.vault,
          keplrAddr: mapping.keplrAddr,
          txHash: result.transactionHash,
          gasUsed: result.gasUsed,
          height: result.height
        }, '✅ Mint successful on Persistence!');
        
        // Store success receipt
        await this.storeProcessingReceipt(depositData, mapping, {
          ...mintPayload,
          persistenceTxHash: result.transactionHash,
          persistenceHeight: result.height,
          gasUsed: result.gasUsed
        }, 'mint_success');
        
        return;
        
      } catch (mintError) {
        // Handle mint errors
        const errorMsg = mintError.message || mintError.toString();
        
        // Check if it's a whitelisting issue (shouldn't happen post-approval, but handle gracefully)
        if (errorMsg.includes('not whitelisted') || 
            errorMsg.includes('unauthorized') ||
            errorMsg.includes('whitelist')) {
          
          logger.warn({
            vault: depositData.vault,
            error: errorMsg,
            phase: 'unexpected_whitelist_error'
          }, '⚠️  Whitelist error despite approval flag - storing as receipt');
          
          await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'whitelist_error');
          return;
        }
        
        // Check for proof validation errors
        if (errorMsg.includes('invalid proof') || 
            errorMsg.includes('proof verification failed')) {
          
          logger.error({
            vault: depositData.vault,
            error: errorMsg
          }, '❌ Proof validation failed on Persistence');
          
          await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'proof_invalid');
          throw new Error(`Proof validation failed: ${errorMsg}`);
        }
        
        // Check for mint cap exceeded
        if (errorMsg.includes('mint cap exceeded') || 
            errorMsg.includes('cap exceeded')) {
          
          logger.error({
            vault: depositData.vault,
            error: errorMsg
          }, '❌ Mint cap exceeded on Persistence');
          
          await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'cap_exceeded');
          
          // Trigger refund for user
          const refundManager = getRefundManager();
          await refundManager.checkAndRefund(depositData.vault);
          return;
        }
        
        // Check for paused contract
        if (errorMsg.includes('paused') || errorMsg.includes('contract paused')) {
          
          logger.warn({
            vault: depositData.vault,
            error: errorMsg
          }, '⚠️  Persistence contract is paused');
          
          await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'contract_paused');
          
          // Store for retry when contract is unpaused
          return;
        }
        
        // Unexpected error - rethrow
        logger.error({
          err: mintError,
          vault: depositData.vault,
          errorMessage: errorMsg
        }, 'Unexpected error during Persistence mint');
        
        await this.storeProcessingReceipt(depositData, mapping, mintPayload, 'mint_error');
        throw mintError;
      }
      
    } catch (error) {
      logger.error({
        err: error,
        vault: depositData.vault
      }, 'Failed to relay proof to Persistence');
      throw error;
    }
  }

  /**
   * Store processing receipt for all deposit processing phases
   * Phase C Update: Enhanced status tracking for successful mints
   * @param {Object} depositData - Deposit data
   * @param {Object} mapping - Vault mapping
   * @param {Object} mintPayload - Mint payload (with optional Persistence tx data)
   * @param {string} status - Receipt status (pending_whitelist, mint_success, mint_error, etc.)
   * @returns {Promise<void>}
   */
  async storeProcessingReceipt(depositData, mapping, mintPayload, status) {
    try {
      const receipt = {
        vault: depositData.vault,
        recipient: mapping.keplrAddr,
        amount: depositData.netAmount.toString(),
        blockNumber: depositData.blockNumber,
        txHash: depositData.transactionHash,
        status,
        mintPayload,
        timestamp: Date.now(),
        phase: status === 'mint_success' ? 'C' : (status === 'pending_whitelist' ? 'A' : 'B')
      };

      // Store in Redis with prefix for easy querying
      const { createClient } = await import('redis');
      const redisClient = createClient({ url: config.redis.url });
      await redisClient.connect();
      
      const receiptKey = `receipt:${depositData.vault}:${depositData.transactionHash}`;
      const ttl = status === 'mint_success' ? 86400 * 30 : 86400 * 7; // Keep success receipts for 30 days
      
      await redisClient.set(
        receiptKey,
        JSON.stringify(receipt),
        { EX: ttl }
      );
      
      // Also add to status-based index for easier querying
      await redisClient.sAdd(`receipts:${status}`, receiptKey);
      
      await redisClient.quit();
      
      logger.info({
        vault: depositData.vault,
        receiptId: receiptKey,
        status,
        ttlDays: ttl / 86400
      }, 'Processing receipt stored successfully');
      
    } catch (error) {
      logger.error({
        err: error,
        vault: depositData.vault
      }, 'Failed to store processing receipt');
      // Don't throw - receipt storage failure shouldn't break the flow
    }
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

