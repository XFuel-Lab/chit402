import axios from 'axios';
import logger from './logger.js';

/**
 * SP1 Prover Client
 * Connects to the deployed SP1 prover ECS service
 * 
 * Phase 1: Supports batching (5-10 deposits per proof)
 * - Accumulates deposits into batches
 * - Automatically flushes when batch is full or timeout reached
 * - 11.6x speedup and 90% cost reduction vs single deposits
 */
class SP1ProverClient {
  constructor() {
    this.proverUrl = process.env.SP1_PROVER_URL || 'http://54.174.193.127:8080';
    this.timeout = parseInt(process.env.SP1_PROVER_TIMEOUT || '120000'); // 120s default
    this.retries = parseInt(process.env.SP1_PROVER_RETRIES || '3');
    this.fallbackToMock = process.env.SP1_PROVER_FALLBACK === 'true';
    
    // Phase 1: Batching configuration
    this.batchingEnabled = process.env.SP1_BATCHING_ENABLED !== 'false'; // Enabled by default
    this.batchSize = parseInt(process.env.SP1_BATCH_SIZE || '10'); // Target batch size (1-10)
    this.batchTimeoutMs = parseInt(process.env.SP1_BATCH_TIMEOUT_MS || '10000'); // Max wait time: 10s
    this.minBatchSize = parseInt(process.env.SP1_MIN_BATCH_SIZE || '5'); // Min batch before timeout flush
    
    // Batch queue
    this.batchQueue = [];
    this.batchTimer = null;
    this.pendingPromises = new Map(); // Map request ID to {resolve, reject}
    this.requestIdCounter = 0;
    
    logger.info(
      {
        batchingEnabled: this.batchingEnabled,
        batchSize: this.batchSize,
        batchTimeoutMs: this.batchTimeoutMs,
        minBatchSize: this.minBatchSize
      },
      'SP1ProverClient initialized with batching configuration'
    );
  }

  /**
   * Test connection to SP1 prover service
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.proverUrl}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      logger.error({ err: error, url: this.proverUrl }, 'SP1 prover health check failed');
      return false;
    }
  }

  /**
   * Generate SP1 proof for a deposit (with batching support)
   * @param {Object} request - Proof request
   * @param {boolean} urgent - If true, bypass batching and generate immediately
   * @returns {Promise<Object>} Proof response
   */
  async generateProof(request, urgent = false) {
    // Validate request
    if (!request.vault_address || !request.net_amount || !request.block_number) {
      throw new Error('Invalid proof request: missing required fields');
    }

    // If batching disabled or urgent, process immediately as single deposit
    if (!this.batchingEnabled || urgent) {
      return this._generateSingleProof(request);
    }

    // Add to batch queue and return promise that resolves when batch is processed
    return this._addToBatch(request);
  }

  /**
   * Add request to batch queue
   * @private
   * @param {Object} request - Proof request
   * @returns {Promise<Object>} Proof response
   */
  async _addToBatch(request) {
    const requestId = ++this.requestIdCounter;
    
    // Create promise that will be resolved when batch is processed
    const promise = new Promise((resolve, reject) => {
      this.pendingPromises.set(requestId, { resolve, reject });
    });

    // Add to queue
    this.batchQueue.push({ requestId, request });
    
    logger.debug(
      {
        requestId,
        queueSize: this.batchQueue.length,
        batchSize: this.batchSize,
        vault: request.vault_address
      },
      'Added deposit to batch queue'
    );

    // If batch is full, process immediately
    if (this.batchQueue.length >= this.batchSize) {
      logger.info(
        { batchSize: this.batchQueue.length },
        'Batch full, processing immediately'
      );
      this._processBatch();
    } else {
      // Start/reset timeout timer
      this._resetBatchTimer();
    }

    return promise;
  }

  /**
   * Reset batch timeout timer
   * @private
   */
  _resetBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      if (this.batchQueue.length >= this.minBatchSize) {
        logger.info(
          {
            queueSize: this.batchQueue.length,
            minBatchSize: this.minBatchSize,
            timeoutMs: this.batchTimeoutMs
          },
          'Batch timeout reached, processing partial batch'
        );
        this._processBatch();
      } else if (this.batchQueue.length > 0) {
        logger.warn(
          {
            queueSize: this.batchQueue.length,
            minBatchSize: this.minBatchSize
          },
          'Batch timeout but queue below min size, processing as single deposits'
        );
        // Process remaining requests as single deposits
        this._flushAsSingle();
      }
    }, this.batchTimeoutMs);
  }

  /**
   * Process current batch
   * @private
   */
  async _processBatch() {
    if (this.batchQueue.length === 0) return;

    // Clear timeout
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Extract batch (limit to configured batch size)
    const batch = this.batchQueue.splice(0, this.batchSize);
    const batchRequests = batch.map(item => item.request);
    const startTime = Date.now();

    logger.info(
      {
        batchSize: batch.length,
        vaults: batch.map(item => item.request.vault_address)
      },
      'Processing batch of deposits'
    );

    try {
      // Send batch request to prover
      const response = await axios.post(
        `${this.proverUrl}/prove`,
        batchRequests, // Array of requests
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      const elapsedTime = Date.now() - startTime;
      const batchSize = response.data.batch_size || batch.length;
      const effectiveTimePerDeposit = response.data.proving_time_ms / batchSize;

      logger.info(
        {
          batchSize,
          provingTime: response.data.proving_time_ms,
          totalTime: elapsedTime,
          effectiveTimePerDeposit: Math.round(effectiveTimePerDeposit),
          aggregatedNullifier: response.data.aggregated_nullifier
        },
        'Batch proof generated successfully'
      );

      // Resolve all promises in the batch
      batch.forEach((item, index) => {
        const pending = this.pendingPromises.get(item.requestId);
        if (pending) {
          // Return individual deposit result
          const publicInputs = response.data.public_inputs[index];
          pending.resolve({
            success: true,
            proof: response.data.proof, // Same proof for entire batch
            publicInputs,
            nullifier: response.data.aggregated_nullifier, // Batch aggregated nullifier
            batchSize,
            batchIndex: index,
            provingTimeMs: response.data.proving_time_ms,
            effectiveTimeMs: Math.round(effectiveTimePerDeposit),
            totalTimeMs: elapsedTime,
            timestamp: Date.now(),
            isBatch: true
          });
          this.pendingPromises.delete(item.requestId);
        }
      });
    } catch (error) {
      logger.error(
        {
          err: error.message,
          batchSize: batch.length
        },
        'Batch proof generation failed, falling back to single deposits'
      );

      // Fallback: Process each request individually
      for (const item of batch) {
        const pending = this.pendingPromises.get(item.requestId);
        if (pending) {
          try {
            const result = await this._generateSingleProof(item.request);
            pending.resolve(result);
          } catch (singleError) {
            pending.reject(singleError);
          }
          this.pendingPromises.delete(item.requestId);
        }
      }
    }

    // If more requests in queue, process next batch
    if (this.batchQueue.length > 0) {
      this._resetBatchTimer();
    }
  }

  /**
   * Flush remaining queue as single deposits
   * @private
   */
  async _flushAsSingle() {
    const remaining = this.batchQueue.splice(0);
    
    logger.info(
      { count: remaining.length },
      'Flushing remaining requests as single deposits'
    );

    for (const item of remaining) {
      const pending = this.pendingPromises.get(item.requestId);
      if (pending) {
        try {
          const result = await this._generateSingleProof(item.request);
          pending.resolve(result);
        } catch (error) {
          pending.reject(error);
        }
        this.pendingPromises.delete(item.requestId);
      }
    }
  }

  /**
   * Generate single SP1 proof (original logic)
   * @private
   * @param {Object} request - Proof request
   * @returns {Promise<Object>} Proof response
   */
  async _generateSingleProof(request) {
    const startTime = Date.now();
    let lastError = null;

    // Retry logic
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        logger.info(
          {
            vault: request.vault_address,
            block: request.block_number,
            attempt,
            maxRetries: this.retries
          },
          'Requesting SP1 proof generation (single deposit)'
        );

        const response = await axios.post(
          `${this.proverUrl}/prove`,
          request,
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: this.timeout
          }
        );

        const elapsedTime = Date.now() - startTime;

        logger.info(
          {
            vault: request.vault_address,
            block: request.block_number,
            provingTime: response.data.proving_time_ms,
            totalTime: elapsedTime,
            attempt
          },
          'SP1 proof generated successfully (single deposit)'
        );

        return {
          success: true,
          proof: response.data.proof,
          publicInputs: response.data.public_inputs,
          nullifier: response.data.nullifier || response.data.aggregated_nullifier,
          provingTimeMs: response.data.proving_time_ms,
          totalTimeMs: elapsedTime,
          attempt,
          timestamp: Date.now(),
          isBatch: false
        };
      } catch (error) {
        lastError = error;
        
        logger.warn(
          {
            err: error.message,
            vault: request.vault_address,
            attempt,
            maxRetries: this.retries
          },
          `SP1 proof generation failed (attempt ${attempt}/${this.retries})`
        );

        // If not the last attempt, wait before retrying
        if (attempt < this.retries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    // All retries failed
    if (this.fallbackToMock) {
      logger.warn(
        { vault: request.vault_address },
        'SP1 prover failed after all retries, falling back to MOCK mode'
      );
      return this.generateMockProof(request);
    }

    logger.error(
      {
        err: lastError,
        vault: request.vault_address,
        attempts: this.retries
      },
      'SP1 proof generation failed after all retries'
    );

    throw new Error(`SP1 proof generation failed: ${lastError.message}`);
  }

  /**
   * Generate mock proof (fallback mode)
   * @param {Object} request - Proof request
   * @returns {Object} Mock proof response
   */
  generateMockProof(request) {
    logger.warn('Generating MOCK SP1 proof - NOT FOR PRODUCTION');

    return {
      success: true,
      proof: Buffer.from('MOCK_SP1_PROOF_' + Date.now()).toString('base64'),
      publicInputs: {
        vault_address: request.vault_address,
        net_amount: request.net_amount,
        block_number: request.block_number,
        merkle_root: request.merkle_root,
        identity_commitment: request.identity_commitment
      },
      nullifier: '0x' + '0'.repeat(64),
      provingTimeMs: 100,
      totalTimeMs: 100,
      mock: true,
      isBatch: false,
      timestamp: Date.now()
    };
  }

  /**
   * Flush any pending batches (for graceful shutdown)
   * @returns {Promise<void>}
   */
  async flushBatches() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchQueue.length > 0) {
      logger.info(
        { queueSize: this.batchQueue.length },
        'Flushing pending batches on shutdown'
      );
      await this._processBatch();
    }
  }

  /**
   * Get batch queue stats
   * @returns {Object} Queue statistics
   */
  getBatchStats() {
    return {
      enabled: this.batchingEnabled,
      queueSize: this.batchQueue.length,
      pendingPromises: this.pendingPromises.size,
      batchSize: this.batchSize,
      minBatchSize: this.minBatchSize,
      batchTimeoutMs: this.batchTimeoutMs
    };
  }

  /**
   * Convert backend deposit data to SP1 proof request
   * @param {Object} depositData - Deposit event data
   * @param {Object} blockData - Block data
   * @returns {Object} SP1 proof request
   */
  prepareProofRequest(depositData, blockData) {
    return {
      vault_address: depositData.vault,
      gross_amount: depositData.grossAmount.toString(),
      fee_amount: depositData.feeAmount.toString(),
      net_amount: depositData.netAmount.toString(),
      block_number: parseInt(blockData.number),
      merkle_root: blockData.hash,
      identity_commitment: '0x' + '1'.repeat(64), // TODO: Integrate proper identity system
      identity_secret: '0x' + '2'.repeat(64),
      identity_nullifier: '0x' + '3'.repeat(64)
    };
  }
}

// Create singleton instance
let sp1ProverClient = null;

/**
 * Initialize the SP1 prover client
 * @returns {Promise<SP1ProverClient>}
 */
export async function initSP1Prover() {
  if (!sp1ProverClient) {
    sp1ProverClient = new SP1ProverClient();
    
    // Test connection
    const isHealthy = await sp1ProverClient.healthCheck();
    if (isHealthy) {
      logger.info({ url: sp1ProverClient.proverUrl }, 'SP1 prover client initialized successfully');
    } else {
      logger.warn({ url: sp1ProverClient.proverUrl }, 'SP1 prover service not reachable, will retry on proof requests');
    }
  }
  return sp1ProverClient;
}

/**
 * Get the SP1 prover client instance
 * @returns {SP1ProverClient}
 */
export function getSP1Prover() {
  if (!sp1ProverClient) {
    throw new Error('SP1 prover not initialized. Call initSP1Prover() first.');
  }
  return sp1ProverClient;
}

export default SP1ProverClient;
