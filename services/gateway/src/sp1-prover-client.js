import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import logger from './logger.js';

/**
 * Resolve the prover endpoint configuration from env.
 *
 * Prover backends (SP1_PROVER, default `cuda`):
 *   cuda  → Theta EdgeCloud CUDA GPU (SP1_PROVER_URL primary; SP1_FALLBACK_URL fallback)
 *   zan   → ZAN PowerZebra HTTP endpoint (ZAN_PROVER_URL primary). The CUDA endpoint
 *           (SP1_PROVER_URL) is retained as an AUTOMATIC fallback so enabling ZAN is
 *           safe/reversible — if ZAN is unreachable, proving falls back to CUDA.
 *
 * ZAN is a drop-in: it must speak the same wire protocol (`/prove`, `/prove/binary`,
 * `/health`, `/metrics`) as the existing prover. Auth via ZAN_PROVER_API_KEY
 * (header name ZAN_PROVER_API_KEY_HEADER, default `x-api-key`).
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ mode:'cuda'|'zan', primaryUrl:string|null, fallbackUrl:string|null, zanUrl:string|null, degraded?:string }}
 */
export function resolveProverConfig(env = process.env) {
  const mode = (env.SP1_PROVER || 'cuda').toLowerCase();
  const cudaUrl = env.SP1_PROVER_URL || null;
  const explicitFallback = env.SP1_FALLBACK_URL || null;
  const zanUrl = env.ZAN_PROVER_URL || null;

  if (mode === 'zan') {
    if (zanUrl) {
      return {
        mode: 'zan',
        primaryUrl: zanUrl,
        // CUDA endpoint is the automatic fallback (reversible); else any explicit fallback.
        fallbackUrl: cudaUrl || explicitFallback,
        zanUrl,
      };
    }
    // Requested zan but not configured → degrade to CUDA (logged at construction).
    return { mode: 'cuda', primaryUrl: cudaUrl, fallbackUrl: explicitFallback, zanUrl: null, degraded: 'zan_url_missing' };
  }

  return { mode: 'cuda', primaryUrl: cudaUrl, fallbackUrl: explicitFallback, zanUrl: null };
}

/**
 * SP1 Prover Client
 * Primary: Theta EdgeCloud (CUDA GPU, paid in TFUEL) — or ZAN PowerZebra when SP1_PROVER=zan
 * Fallback: CUDA endpoint (when in zan mode) or Succinct Network (SP1_FALLBACK_URL, optional)
 * 
 * Supports batching (5-10 deposits per proof) with 11.6x speedup
 */
class SP1ProverClient {
  constructor() {
    const cfg = resolveProverConfig();
    if (!cfg.primaryUrl) {
      throw new Error(
        'No prover URL configured: set SP1_PROVER_URL, or SP1_PROVER=zan with ZAN_PROVER_URL',
      );
    }

    this.proverMode = cfg.mode;                       // 'cuda' (default) | 'zan'
    this.primaryUrl = cfg.primaryUrl;
    this.fallbackUrl = cfg.fallbackUrl || null;
    this.zanUrl = cfg.zanUrl;                          // set only when zan is active
    this.zanApiKey = process.env.ZAN_PROVER_API_KEY || null;
    this.zanApiKeyHeader = (process.env.ZAN_PROVER_API_KEY_HEADER || 'x-api-key').toLowerCase();
    if (cfg.degraded === 'zan_url_missing') {
      logger.warn('SP1_PROVER=zan requested but ZAN_PROVER_URL is not set — using CUDA path');
    }
    this.activeUrl = this.primaryUrl;
    this.timeout = parseInt(process.env.SP1_PROVER_TIMEOUT || '120000');
    this.retries = parseInt(process.env.SP1_PROVER_RETRIES || '3');
    this.fallbackToMock = process.env.SP1_PROVER_FALLBACK_MOCK === 'true';
    
    this.batchingEnabled = process.env.SP1_BATCHING_ENABLED !== 'false';
    this.batchSize = parseInt(process.env.SP1_BATCH_SIZE || '10');
    this.batchTimeoutMs = parseInt(process.env.SP1_BATCH_TIMEOUT_MS || '10000');
    this.minBatchSize = parseInt(process.env.SP1_MIN_BATCH_SIZE || '5');
    
    this.batchQueue = [];
    this.batchTimer = null;
    this.pendingPromises = new Map();
    this.requestIdCounter = 0;

    this._keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });
    this._keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });
    this._binarySupported = true;

    this._usingFallback = false;
    this._fallbackReason = null;
    this._lastSwitchTime = null;
    this._fallbackRecoveryTimer = null;
    this._primaryHealthInterval = null;
    this._consecutiveFailures = 0;
    this._fallbackActivatedAt = null;

    logger.info(
      {
        proverMode: this.proverMode,
        primaryUrl: this.primaryUrl,
        fallbackUrl: this.fallbackUrl || 'none',
        zanAuth: this.proverMode === 'zan' ? (this.zanApiKey ? 'configured' : 'none') : 'n/a',
        batchingEnabled: this.batchingEnabled,
        batchSize: this.batchSize,
        batchTimeoutMs: this.batchTimeoutMs,
        minBatchSize: this.minBatchSize
      },
      `SP1ProverClient initialized (primary: ${this.proverMode === 'zan' ? 'ZAN PowerZebra' : 'Theta EdgeCloud CUDA'})`
    );
  }

  /**
   * Auth headers for a given prover URL. Attaches the ZAN API key only when the
   * request targets the ZAN endpoint (CUDA/Succinct endpoints get no auth header).
   * @private
   * @param {string} url
   * @returns {Record<string,string>}
   */
  _authHeaders(url) {
    if (this.zanApiKey && this.zanUrl && url === this.zanUrl) {
      return { [this.zanApiKeyHeader]: this.zanApiKey };
    }
    return {};
  }

  /**
   * Test connection to SP1 prover endpoints (primary + fallback)
   * @returns {Promise<{primary: boolean, fallback: boolean}>}
   */
  async healthCheck() {
    const status = { primary: false, fallback: false };

    try {
      const resp = await axios.get(`${this.primaryUrl}/health`, { timeout: 5000, headers: this._authHeaders(this.primaryUrl) });
      status.primary = resp.status === 200;
    } catch (error) {
      logger.warn({ err: error.message, url: this.primaryUrl }, 'Primary prover health check failed');
    }

    if (this.fallbackUrl) {
      try {
        const resp = await axios.get(`${this.fallbackUrl}/health`, { timeout: 5000, headers: this._authHeaders(this.fallbackUrl) });
        status.fallback = resp.status === 200;
      } catch (error) {
        logger.warn({ err: error.message, url: this.fallbackUrl }, 'Fallback prover health check failed');
      }
    }

    this.activeUrl = status.primary ? this.primaryUrl : (status.fallback ? this.fallbackUrl : this.primaryUrl);

    logger.info(
      { ...status, activeUrl: this.activeUrl },
      'SP1 prover health check complete'
    );

    return status.primary || status.fallback;
  }

  /**
   * Generate SP1 proof for a deposit (with batching support)
   * @param {Object} request - Proof request
   * @param {boolean} urgent - If true, bypass batching and generate immediately
   * @returns {Promise<Object>} Proof response
   */
  async generateProof(request, urgent = false) {
    // Validate request. block_number 0 is valid (e.g. off-chain M2M tasks with no
    // source-chain height) — test for presence, not truthiness.
    if (!request.vault_address || !request.net_amount || request.block_number == null) {
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
      const batchPayload = { batch: true, deposits: batchRequests };

      let provingTimeMs, batchSize, proof, nullifiers, batchCommitment, elapsedTime, isBinaryResult;

      if (this._binarySupported) {
        try {
          const decoded = await this._postBinaryWithFallback(batchPayload);
          elapsedTime = Date.now() - startTime;
          provingTimeMs = decoded.proving_time_ms;
          batchSize = decoded.batch_size || batch.length;
          proof = decoded.proof_bytes.toString('base64');
          nullifiers = decoded.nullifiers.map(n => '0x' + n.toString('hex'));
          batchCommitment = '0x' + decoded.batch_commitment.toString('hex');
          isBinaryResult = true;
        } catch (binErr) {
          if (binErr.response?.status === 404) {
            this._binarySupported = false;
            logger.info('Binary batch endpoint not available, falling back to JSON');
          } else {
            logger.warn({ err: binErr.message }, 'Binary batch failed, falling back to JSON');
          }
        }
      }

      if (!isBinaryResult) {
        const response = await this._postWithFallback('/prove', batchPayload);
        elapsedTime = Date.now() - startTime;
        provingTimeMs = response.data.proving_time_ms;
        batchSize = response.data.batch_size || batch.length;
        proof = response.data.proof;
        nullifiers = response.data.nullifiers || [];
        batchCommitment = response.data.batch_commitment;
      }

      const effectiveTimePerDeposit = provingTimeMs / batchSize;

      logger.info(
        {
          batchSize,
          provingTime: provingTimeMs,
          totalTime: elapsedTime,
          effectiveTimePerDeposit: Math.round(effectiveTimePerDeposit),
          format: isBinaryResult ? 'binary' : 'json',
        },
        'Batch proof generated successfully'
      );

      batch.forEach((item, index) => {
        const pending = this.pendingPromises.get(item.requestId);
        if (pending) {
          pending.resolve({
            success: true,
            proof,
            publicInputs: {
              vault_address: item.request.vault_address,
              net_amount: item.request.net_amount,
              block_number: item.request.block_number,
              merkle_root: item.request.merkle_root,
              identity_commitment: item.request.identity_commitment,
            },
            nullifier: nullifiers[index] || nullifiers[0],
            batchCommitment,
            batchSize,
            batchIndex: index,
            provingTimeMs,
            effectiveTimeMs: Math.round(effectiveTimePerDeposit),
            totalTimeMs: elapsedTime,
            timestamp: Date.now(),
            isBatch: true,
            binaryTransfer: !!isBinaryResult,
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
   * POST to prover with automatic primary -> fallback failover.
   * Tries primaryUrl first; on connection/timeout error, retries on fallbackUrl.
   * @private
   */
  async _postWithFallback(path, body) {
    const urls = [this.primaryUrl];
    if (this.fallbackUrl) urls.push(this.fallbackUrl);

    let lastError = null;
    for (const url of urls) {
      try {
        const response = await axios.post(`${url}${path}`, body, {
          headers: { 'Content-Type': 'application/json', ...this._authHeaders(url) },
          timeout: this.timeout,
          httpAgent: this._keepAliveAgent,
          httpsAgent: this._keepAliveHttpsAgent,
        });
        if (url !== this.primaryUrl) {
          logger.warn({ url }, 'Proof served by FALLBACK prover');
        }
        return response;
      } catch (error) {
        lastError = error;
        const isConnectionError = error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT' ||
          error.message?.includes('timeout');

        if (isConnectionError && url === this.primaryUrl && this.fallbackUrl) {
          logger.warn(
            { err: error.message, primaryUrl: url, fallbackUrl: this.fallbackUrl },
            'Primary prover unreachable, trying fallback'
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Decode a bincode-serialized BinaryProofResponse from the Rust prover.
   * Wire format (bincode v1, little-endian):
   *   Vec<u8>  = u64 length + raw bytes
   *   bool     = 1 byte
   *   u32      = 4 bytes LE
   *   u64      = 8 bytes LE
   * Field order must match the Rust struct exactly.
   * @private
   */
  _decodeBinaryResponse(arrayBuffer) {
    const buf = Buffer.from(arrayBuffer);
    let offset = 0;

    const readU64 = () => {
      const val = buf.readBigUInt64LE(offset);
      offset += 8;
      return Number(val);
    };
    const readU32 = () => {
      const val = buf.readUInt32LE(offset);
      offset += 4;
      return val;
    };
    const readBool = () => {
      const val = buf.readUInt8(offset);
      offset += 1;
      return val !== 0;
    };
    const readBytes = () => {
      const len = readU64();
      const bytes = buf.subarray(offset, offset + len);
      offset += len;
      return Buffer.from(bytes);
    };
    const readVecBytes = () => {
      const count = readU64();
      const result = [];
      for (let i = 0; i < count; i++) {
        result.push(readBytes());
      }
      return result;
    };

    const proof_bytes = readBytes();
    const public_values = readBytes();
    const is_batch = readBool();
    const batch_size = readU32();
    const proving_time_ms = readU64();
    const nullifiers = readVecBytes();
    const batch_commitment = readBytes();

    return { proof_bytes, public_values, is_batch, batch_size, proving_time_ms, nullifiers, batch_commitment };
  }

  /**
   * POST to binary /prove/binary endpoint with primary -> fallback failover.
   * Sends JSON request, receives bincode binary response.
   * @private
   */
  async _postBinaryWithFallback(body) {
    const urls = [this.primaryUrl];
    if (this.fallbackUrl) urls.push(this.fallbackUrl);

    let lastError = null;
    for (const url of urls) {
      try {
        const response = await axios.post(`${url}/prove/binary`, body, {
          headers: { 'Content-Type': 'application/json', ...this._authHeaders(url) },
          responseType: 'arraybuffer',
          timeout: this.timeout,
          httpAgent: this._keepAliveAgent,
          httpsAgent: this._keepAliveHttpsAgent,
        });
        if (url !== this.primaryUrl) {
          logger.warn({ url }, 'Binary proof served by FALLBACK prover');
        }
        return this._decodeBinaryResponse(response.data);
      } catch (error) {
        lastError = error;
        const isConnectionError = error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT' ||
          error.message?.includes('timeout');

        if (isConnectionError && url === this.primaryUrl && this.fallbackUrl) {
          logger.warn(
            { err: error.message, primaryUrl: url, fallbackUrl: this.fallbackUrl },
            'Primary prover unreachable (binary), trying fallback'
          );
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Generate single SP1 proof with retry + primary/fallback failover
   * @private
   * @param {Object} request - Proof request
   * @returns {Promise<Object>} Proof response
   */
  async _generateSingleProof(request) {
    const startTime = Date.now();

    // Try binary endpoint first (much faster: no base64, no JSON overhead)
    if (this._binarySupported) {
      try {
        logger.info(
          { vault: request.vault_address, block: request.block_number },
          'Requesting SP1 proof generation (binary endpoint)'
        );

        const decoded = await this._postBinaryWithFallback(request);
        const elapsedTime = Date.now() - startTime;

        logger.info(
          {
            vault: request.vault_address,
            block: request.block_number,
            provingTime: decoded.proving_time_ms,
            totalTime: elapsedTime,
            proofBytes: decoded.proof_bytes.length,
            format: 'binary',
          },
          'Binary proof received successfully'
        );

        return {
          success: true,
          proof: decoded.proof_bytes.toString('base64'),
          publicInputs: {
            vault_address: request.vault_address,
            net_amount: request.net_amount,
            block_number: request.block_number,
            merkle_root: request.merkle_root,
            identity_commitment: request.identity_commitment,
          },
          nullifier: '0x' + decoded.nullifiers[0].toString('hex'),
          provingTimeMs: decoded.proving_time_ms,
          totalTimeMs: elapsedTime,
          attempt: 1,
          timestamp: Date.now(),
          isBatch: decoded.is_batch,
          binaryTransfer: true,
        };
      } catch (error) {
        const is404 = error.response?.status === 404;
        if (is404) {
          this._binarySupported = false;
          logger.info('Binary /prove/binary not available on server, falling back to JSON permanently');
        } else {
          logger.warn({ err: error.message }, 'Binary proof generation failed, falling back to JSON');
        }
      }
    }

    // JSON fallback (original path)
    return this._generateSingleProofJson(request, startTime);
  }

  /**
   * Original JSON-based proof generation with retry logic
   * @private
   */
  async _generateSingleProofJson(request, startTime) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        logger.info(
          {
            vault: request.vault_address,
            block: request.block_number,
            attempt,
            maxRetries: this.retries
          },
          'Requesting SP1 proof generation (JSON endpoint)'
        );

        const response = await this._postWithFallback('/prove', request);
        const elapsedTime = Date.now() - startTime;

        logger.info(
          {
            vault: request.vault_address,
            block: request.block_number,
            provingTime: response.data.proving_time_ms,
            totalTime: elapsedTime,
            attempt,
            format: 'json',
          },
          'SP1 proof generated successfully (JSON)'
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
          isBatch: false,
          publicValuesVersion: response.data.public_values_version ?? null,
          aiPublicValuesAbi: response.data.ai_public_values_abi ?? null,
          paymentCommitment: response.data.payment_commitment ?? null,
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

        if (attempt < this.retries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

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
      'SP1 proof generation failed after all retries (primary + fallback exhausted)'
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

  // =========================================================================
  // AUTO-FALLBACK MONITOR
  // =========================================================================

  /**
   * Start monitoring primary prover health every pingIntervalMs.
   * On failure (timeout >8s, 5xx, or connection error), switch to fallback
   * for fallbackDurationMs, then try primary again.
   */
  startFallbackMonitor(pingIntervalMs = 10000, fallbackDurationMs = 60000) {
    if (!this.fallbackUrl) {
      logger.info('No SP1_FALLBACK_URL configured, fallback monitor disabled');
      return;
    }
    if (this._primaryHealthInterval) return;

    this._fallbackDurationMs = fallbackDurationMs;

    const checkPrimary = async () => {
      if (this._usingFallback) return;

      try {
        const start = Date.now();
        const resp = await axios.get(`${this.primaryUrl}/healthz`, {
          timeout: 8000,
          headers: this._authHeaders(this.primaryUrl),
          httpAgent: this._keepAliveAgent,
          httpsAgent: this._keepAliveHttpsAgent,
        });
        const elapsed = Date.now() - start;

        if (resp.status >= 500) {
          this._consecutiveFailures++;
          logger.warn({ status: resp.status, elapsed }, 'Primary prover returned 5xx');
        } else if (elapsed > 8000) {
          this._consecutiveFailures++;
          logger.warn({ elapsed }, 'Primary prover response too slow (>8s)');
        } else {
          if (this._consecutiveFailures > 0) {
            logger.info({ elapsed }, 'Primary prover recovered');
          }
          this._consecutiveFailures = 0;
          return;
        }
      } catch (err) {
        this._consecutiveFailures++;
        logger.warn({ err: err.message, failures: this._consecutiveFailures }, 'Primary prover health check failed');
      }

      if (this._consecutiveFailures >= 2) {
        this._activateFallback('Health check failed (' + this._consecutiveFailures + ' consecutive failures)');
      }
    };

    checkPrimary();
    this._primaryHealthInterval = setInterval(checkPrimary, pingIntervalMs);
    logger.info({ pingIntervalMs, fallbackDurationMs, fallbackUrl: this.fallbackUrl }, 'Fallback monitor started');
  }

  stopFallbackMonitor() {
    if (this._primaryHealthInterval) {
      clearInterval(this._primaryHealthInterval);
      this._primaryHealthInterval = null;
    }
    if (this._fallbackRecoveryTimer) {
      clearTimeout(this._fallbackRecoveryTimer);
      this._fallbackRecoveryTimer = null;
    }
  }

  /** @private */
  _activateFallback(reason) {
    if (this._usingFallback) return;

    this._usingFallback = true;
    this._fallbackReason = reason;
    this._lastSwitchTime = new Date().toISOString();
    this._fallbackActivatedAt = Date.now();
    this.activeUrl = this.fallbackUrl;

    logger.warn(
      { reason, fallbackUrl: this.fallbackUrl, durationMs: this._fallbackDurationMs },
      'Fallback activated \u2014 using Succinct'
    );

    this._fallbackRecoveryTimer = setTimeout(() => {
      this._attemptPrimaryRecovery();
    }, this._fallbackDurationMs);
  }

  /** @private */
  async _attemptPrimaryRecovery() {
    try {
      const start = Date.now();
      const resp = await axios.get(`${this.primaryUrl}/healthz`, {
        timeout: 8000,
        headers: this._authHeaders(this.primaryUrl),
        httpAgent: this._keepAliveAgent,
        httpsAgent: this._keepAliveHttpsAgent,
      });
      const elapsed = Date.now() - start;

      if (resp.status < 500 && elapsed <= 8000) {
        this._usingFallback = false;
        this._fallbackReason = null;
        this._consecutiveFailures = 0;
        this._lastSwitchTime = new Date().toISOString();
        this.activeUrl = this.primaryUrl;

        logger.info(
          { elapsed, primaryUrl: this.primaryUrl },
          'Primary recovered \u2014 switching back from Succinct'
        );
        return;
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Primary still unreachable during recovery check');
    }

    logger.warn('Primary still down, extending fallback for another cycle');
    this._fallbackRecoveryTimer = setTimeout(() => {
      this._attemptPrimaryRecovery();
    }, this._fallbackDurationMs);
  }

  getFallbackStatus() {
    return {
      proverMode: this.proverMode,
      usingFallback: this._usingFallback,
      activeUrl: this.activeUrl,
      primaryUrl: this.primaryUrl,
      fallbackUrl: this.fallbackUrl,
      fallbackReason: this._fallbackReason,
      lastSwitchTime: this._lastSwitchTime,
      consecutiveFailures: this._consecutiveFailures,
      fallbackDurationMs: this._fallbackDurationMs || 60000,
      fallbackElapsedMs: this._fallbackActivatedAt ? Date.now() - this._fallbackActivatedAt : null,
    };
  }

  // =========================================================================
  // METRICS POLLING + DASHBOARD
  // =========================================================================

  /**
   * Start polling /metrics from the prover every intervalMs.
   * Stores last maxHistory readings for dashboard graphs.
   */
  startMetricsPolling(intervalMs = 5000, maxHistory = 360) {
    if (this._metricsInterval) return;
    this._metricsHistory = this._metricsHistory || [];
    this._maxHistory = maxHistory;

    const poll = async () => {
      try {
        const resp = await axios.get(`${this.activeUrl}/metrics`, {
          timeout: 5000,
          headers: this._authHeaders(this.activeUrl),
          httpAgent: this._keepAliveAgent,
          httpsAgent: this._keepAliveHttpsAgent,
        });
        const snapshot = { ...resp.data, timestamp: Date.now() };
        this._metricsHistory.push(snapshot);
        if (this._metricsHistory.length > this._maxHistory) {
          this._metricsHistory.shift();
        }
        logger.debug(
          {
            proofs: snapshot.proofs_served_total,
            avg_ms: snapshot.avg_prove_time_ms,
            last_ms: snapshot.last_prove_time_ms,
            errors: snapshot.errors_total,
            gpu: snapshot.gpu?.utilization_pct ?? 'n/a',
            queue: snapshot.current_queue_depth,
          },
          'Prover metrics'
        );
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to poll /metrics');
      }
    };

    poll();
    this._metricsInterval = setInterval(poll, intervalMs);
    logger.info({ intervalMs }, 'Metrics polling started');
  }

  stopMetricsPolling() {
    if (this._metricsInterval) {
      clearInterval(this._metricsInterval);
      this._metricsInterval = null;
      logger.info('Metrics polling stopped');
    }
  }

  getMetricsHistory() {
    return this._metricsHistory || [];
  }

  getLatestMetrics() {
    const h = this._metricsHistory || [];
    return h.length > 0 ? h[h.length - 1] : null;
  }

  /**
   * Start a lightweight dashboard HTTP server.
   * GET /           → Dashboard HTML (Chart.js live graphs)
   * GET /api/metrics → { current, history }
   */
  startDashboard(port = 9100) {
    const server = http.createServer((req, res) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      if (req.url === '/api/metrics') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({
          current: this.getLatestMetrics(),
          history: this.getMetricsHistory(),
          prover: { primaryUrl: this.primaryUrl, fallbackUrl: this.fallbackUrl, binarySupported: this._binarySupported },
          fallback: this.getFallbackStatus(),
          lastBenchmark: this._lastBenchmark || null,
        }));
        return;
      }

      if (req.url === '/api/benchmark' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = body ? JSON.parse(body) : {};
            const count = Math.min(parseInt(params.count) || 5, 20);
            logger.info({ count }, 'Dashboard benchmark triggered');
            const resp = await axios.post(`${this.activeUrl}/benchmark`, { count, skip_verify: params.skip_verify ?? false }, {
              timeout: count * 30000,
              headers: { 'Content-Type': 'application/json', ...this._authHeaders(this.activeUrl) },
              httpAgent: this._keepAliveAgent,
              httpsAgent: this._keepAliveHttpsAgent,
            });
            this._lastBenchmark = { ...resp.data, timestamp: Date.now() };
            res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
            res.end(JSON.stringify(this._lastBenchmark));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this._getDashboardHtml());
    });

    server.listen(port, () => {
      logger.info({ port, url: `http://localhost:${port}` }, 'SP1 Prover Dashboard started');
    });
    this._dashboardServer = server;
    return server;
  }

  _getDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SP1 Prover Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1117;color:#e1e4e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px}
h1{font-size:1.5rem;margin-bottom:4px;color:#58a6ff}
.subtitle{color:#8b949e;font-size:.85rem;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;text-align:center}
.card .label{font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.card .value{font-size:2rem;font-weight:700;margin:8px 0}
.card .unit{font-size:.8rem;color:#8b949e}
.ok{color:#3fb950}.warn{color:#d29922}.err{color:#f85149}.blue{color:#58a6ff}.purple{color:#bc8cff}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
@media(max-width:900px){.charts{grid-template-columns:1fr}}
.chart-box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px}
.chart-box h3{font-size:.85rem;color:#8b949e;margin-bottom:12px}
canvas{width:100%!important;height:200px!important}
.status-bar{display:flex;gap:16px;align-items:center;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font-size:.8rem;color:#8b949e;flex-wrap:wrap}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.dot.green{background:#3fb950}.dot.red{background:#f85149}
.bench-section{margin-top:24px}
.bench-section h2{font-size:1.1rem;color:#58a6ff;margin-bottom:12px}
.bench-controls{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.bench-controls label{font-size:.8rem;color:#8b949e}
.bench-controls input,.bench-controls select{background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:.85rem}
.bench-controls input[type=number]{width:60px}
.btn{background:#238636;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600}
.btn:hover{background:#2ea043}
.btn:disabled{background:#30363d;color:#8b949e;cursor:not-allowed}
.bench-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px}
.bench-stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;text-align:center}
.bench-stat .label{font-size:.7rem;color:#8b949e;text-transform:uppercase}
.bench-stat .val{font-size:1.4rem;font-weight:700;margin-top:4px}
#bench-log{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px;font-family:'Fira Code',monospace;font-size:.75rem;max-height:200px;overflow-y:auto;white-space:pre-wrap;color:#8b949e;margin-top:12px}
</style></head><body>
<h1>SP1 Prover Dashboard</h1>
<p class="subtitle">Real-time metrics from Theta EdgeCloud CUDA prover</p>

<div class="cards">
  <div class="card"><div class="label">Proofs Served</div><div class="value blue" id="v-proofs">-</div><div class="unit" id="v-breakdown">-</div></div>
  <div class="card"><div class="label">Avg Prove Time</div><div class="value ok" id="v-avg">-</div><div class="unit">ms (GPU)</div></div>
  <div class="card"><div class="label">Last Prove Time</div><div class="value purple" id="v-last">-</div><div class="unit">ms</div></div>
  <div class="card"><div class="label">Effective/Deposit</div><div class="value ok" id="v-eff">-</div><div class="unit" id="v-batch-info">ms</div></div>
  <div class="card"><div class="label">GPU Utilization</div><div class="value ok" id="v-gpu">-</div><div class="unit">%</div></div>
  <div class="card"><div class="label">GPU Memory</div><div class="value warn" id="v-mem">-</div><div class="unit" id="v-mem-detail">-</div></div>
  <div class="card"><div class="label">GPU Temp</div><div class="value" id="v-temp">-</div><div class="unit">\u00B0C</div></div>
  <div class="card"><div class="label">Uptime</div><div class="value blue" id="v-uptime">-</div><div class="unit" id="v-queue">Queue: 0</div></div>
</div>

<div class="charts">
  <div class="chart-box"><h3>Prove Time (ms)</h3><canvas id="chart-time"></canvas></div>
  <div class="chart-box"><h3>GPU Utilization (%)</h3><canvas id="chart-gpu"></canvas></div>
</div>

<div class="status-bar">
  <span><span class="dot green" id="dot-status"></span><span id="status-text">Connecting...</span></span>
  <span id="prover-url">-</span>
  <span id="last-update">-</span>
</div>

<div class="status-bar" id="fallback-bar" style="margin-top:8px;display:none">
  <span><span class="dot" id="dot-fb"></span><span id="fb-label">Primary</span></span>
  <span id="fb-reason">-</span>
  <span id="fb-switch-time">-</span>
</div>

<div class="bench-section">
  <h2>Benchmark</h2>
  <div class="bench-controls">
    <label>Proofs: <input type="number" id="bench-count" value="5" min="1" max="20"></label>
    <label>Batch: <input type="number" id="bench-batch" value="1" min="1" max="20"></label>
    <label><input type="checkbox" id="bench-skip-verify"> Skip verify</label>
    <button class="btn" id="bench-run" onclick="runBenchmark()">Run Benchmark</button>
    <span id="bench-status" style="color:#8b949e;font-size:.8rem"></span>
  </div>
  <div class="bench-stats" id="bench-stats" style="display:none">
    <div class="bench-stat"><div class="label">Min</div><div class="val ok" id="bs-min">-</div></div>
    <div class="bench-stat"><div class="label">Avg</div><div class="val blue" id="bs-avg">-</div></div>
    <div class="bench-stat"><div class="label">P50</div><div class="val purple" id="bs-p50">-</div></div>
    <div class="bench-stat"><div class="label">P95</div><div class="val warn" id="bs-p95">-</div></div>
    <div class="bench-stat"><div class="label">Max</div><div class="val err" id="bs-max">-</div></div>
    <div class="bench-stat"><div class="label">Throughput</div><div class="val ok" id="bs-tput">-</div></div>
  </div>
  <div class="charts">
    <div class="chart-box"><h3>Benchmark GPU Times (ms)</h3><canvas id="chart-bench"></canvas></div>
    <div class="chart-box"><h3>Distribution</h3><canvas id="chart-dist"></canvas></div>
  </div>
  <div id="bench-log"></div>
</div>

<script>
const MAX_PTS = 60;
const timeData = [], gpuData = [], labels = [];
const chartOpts = (color) => ({
  responsive:true, animation:{duration:0},
  scales:{x:{display:false},y:{grid:{color:'#21262d'},ticks:{color:'#8b949e'}}},
  plugins:{legend:{display:false}},
  elements:{point:{radius:0},line:{tension:.3,borderWidth:2,borderColor:color,fill:true,backgroundColor:color+'22'}}
});
const ctxTime = document.getElementById('chart-time').getContext('2d');
const ctxGpu = document.getElementById('chart-gpu').getContext('2d');
const chartTime = new Chart(ctxTime,{type:'line',data:{labels,datasets:[{data:timeData}]},options:chartOpts('#58a6ff')});
const chartGpu = new Chart(ctxGpu,{type:'line',data:{labels,datasets:[{data:gpuData}]},options:chartOpts('#3fb950')});

const benchData=[],benchLabels=[];
const ctxBench=document.getElementById('chart-bench').getContext('2d');
const chartBench=new Chart(ctxBench,{type:'bar',data:{labels:benchLabels,datasets:[{data:benchData,backgroundColor:'#58a6ff88',borderColor:'#58a6ff',borderWidth:1}]},options:{responsive:true,animation:{duration:200},scales:{x:{display:true,ticks:{color:'#8b949e'}},y:{grid:{color:'#21262d'},ticks:{color:'#8b949e'},title:{display:true,text:'ms',color:'#8b949e'}}},plugins:{legend:{display:false}}}});

const distData=[],distLabels=[];
const ctxDist=document.getElementById('chart-dist').getContext('2d');
const chartDist=new Chart(ctxDist,{type:'bar',data:{labels:distLabels,datasets:[{data:distData,backgroundColor:'#bc8cff88',borderColor:'#bc8cff',borderWidth:1}]},options:{responsive:true,animation:{duration:200},scales:{x:{title:{display:true,text:'ms range',color:'#8b949e'},ticks:{color:'#8b949e'}},y:{grid:{color:'#21262d'},ticks:{color:'#8b949e'},title:{display:true,text:'count',color:'#8b949e'}}},plugins:{legend:{display:false}}}});

function fmtUptime(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?h+'h '+m+'m':m>0?m+'m':s+'s'}

async function runBenchmark(){
  const btn=document.getElementById('bench-run');
  const status=document.getElementById('bench-status');
  const log=document.getElementById('bench-log');
  const count=parseInt(document.getElementById('bench-count').value)||5;
  const batchSz=parseInt(document.getElementById('bench-batch').value)||1;
  const skipVerify=document.getElementById('bench-skip-verify').checked;
  btn.disabled=true;
  status.textContent='Running '+count+' proofs (batch='+batchSz+')...';
  status.style.color='#d29922';
  log.textContent='Starting benchmark ('+count+' proofs, batch='+batchSz+', skip_verify='+skipVerify+')...\\n';
  try{
    const r=await fetch('/api/benchmark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count,batch_size:batchSz,skip_verify:skipVerify})});
    const d=await r.json();
    if(d.error){throw new Error(d.error)}
    const s=d.stats;
    const effPerDep=batchSz>1?Math.round(s.avg_ms/batchSz):s.avg_ms;
    document.getElementById('bench-stats').style.display='grid';
    document.getElementById('bs-min').textContent=s.min_ms+'ms';
    document.getElementById('bs-avg').textContent=s.avg_ms+'ms';
    document.getElementById('bs-p50').textContent=s.p50_ms+'ms';
    document.getElementById('bs-p95').textContent=s.p95_ms+'ms';
    document.getElementById('bs-max').textContent=s.max_ms+'ms';
    document.getElementById('bs-tput').textContent=effPerDep+'ms/dep';
    document.getElementById('bs-min').className='val '+(s.min_ms<1000?'ok':'warn');

    benchData.length=0;benchLabels.length=0;
    d.gpu_times_ms.forEach((t,i)=>{benchLabels.push('#'+(i+1));benchData.push(t)});
    chartBench.update();

    const bins={};const step=100;
    d.gpu_times_ms.forEach(t=>{const k=Math.floor(t/step)*step;bins[k]=(bins[k]||0)+1});
    distData.length=0;distLabels.length=0;
    Object.keys(bins).sort((a,b)=>a-b).forEach(k=>{distLabels.push(k+'-'+(+k+step));distData.push(bins[k])});
    chartDist.update();

    log.textContent+='Completed: '+d.succeeded+'/'+d.count+' proofs (batch='+batchSz+')\\n';
    log.textContent+='Wall time: '+d.wall_time_ms+'ms\\n';
    log.textContent+='GPU: min='+s.min_ms+' avg='+s.avg_ms+' p50='+s.p50_ms+' p95='+s.p95_ms+' max='+s.max_ms+'ms\\n';
    log.textContent+='Effective ms/deposit: '+effPerDep+'ms (batch='+batchSz+')\\n';
    log.textContent+='Sub-200ms/dep: '+(effPerDep<=200?'YES':'NO')+'\\n';
    log.textContent+='Throughput: '+d.throughput_proofs_per_sec+' proofs/sec\\n';
    d.gpu_times_ms.forEach((t,i)=>{log.textContent+='  #'+(i+1)+': '+t+'ms ('+Math.round(t/batchSz)+'ms/dep)\\n'});
    status.textContent='Done!';
    status.style.color='#3fb950';
  }catch(e){
    status.textContent='Error: '+e.message;
    status.style.color='#f85149';
    log.textContent+='ERROR: '+e.message+'\\n';
  }
  btn.disabled=false;
}

async function poll(){
  try{
    const r=await fetch('/api/metrics');
    const d=await r.json();
    if(!d.current)return;
    const c=d.current;
    document.getElementById('v-proofs').textContent=c.proofs_served_total;
    document.getElementById('v-breakdown').textContent='bin:'+c.binary_proofs+' json:'+c.json_proofs;
    document.getElementById('v-avg').textContent=c.avg_prove_time_ms;
    document.getElementById('v-last').textContent=c.last_prove_time_ms;
    if(c.effective_ms_per_deposit!==undefined){
      document.getElementById('v-eff').textContent=c.effective_ms_per_deposit;
      const bs=c.last_batch_size||1;
      document.getElementById('v-batch-info').textContent='ms (batch='+bs+', '+c.total_deposits+' deps)';
      document.getElementById('v-eff').className='value '+(c.effective_ms_per_deposit<=200?'ok':c.effective_ms_per_deposit<=500?'warn':'err');
    }
    document.getElementById('v-uptime').textContent=fmtUptime(c.uptime_seconds);
    document.getElementById('v-queue').textContent='Queue: '+c.current_queue_depth;
    if(c.gpu){
      document.getElementById('v-gpu').textContent=c.gpu.utilization_pct;
      document.getElementById('v-mem').textContent=Math.round(c.gpu.memory_used_mb/1024*10)/10;
      document.getElementById('v-mem-detail').textContent=c.gpu.memory_used_mb+'/'+c.gpu.memory_total_mb+' MB';
      document.getElementById('v-temp').textContent=c.gpu.temperature_c;
      document.getElementById('v-temp').className='value '+(c.gpu.temperature_c>80?'err':c.gpu.temperature_c>65?'warn':'ok');
    }
    const now=new Date().toLocaleTimeString();
    labels.push(now);timeData.push(c.last_prove_time_ms);gpuData.push(c.gpu?.utilization_pct??0);
    if(labels.length>MAX_PTS){labels.shift();timeData.shift();gpuData.shift()}
    chartTime.update();chartGpu.update();
    document.getElementById('dot-status').className='dot green';
    document.getElementById('status-text').textContent='Connected';
    document.getElementById('prover-url').textContent=d.prover?.primaryUrl||'';
    document.getElementById('last-update').textContent='Updated '+now;

    if(d.fallback){
      const fb=d.fallback;
      const bar=document.getElementById('fallback-bar');
      bar.style.display='flex';
      const dot=document.getElementById('dot-fb');
      const lbl=document.getElementById('fb-label');
      if(fb.usingFallback){
        dot.className='dot red';
        lbl.textContent='FALLBACK ACTIVE \\u2014 Succinct';
        lbl.style.color='#f85149';
        document.getElementById('fb-reason').textContent=fb.fallbackReason||'';
        const elapsed=fb.fallbackElapsedMs?Math.round(fb.fallbackElapsedMs/1000)+'s ago':'';
        document.getElementById('fb-switch-time').textContent='Switched: '+(fb.lastSwitchTime||'')+' ('+elapsed+')';
      }else{
        dot.className='dot green';
        lbl.textContent='Primary Active';
        lbl.style.color='#3fb950';
        document.getElementById('fb-reason').textContent=fb.fallbackUrl?'Fallback: '+fb.fallbackUrl:'No fallback configured';
        document.getElementById('fb-switch-time').textContent=fb.lastSwitchTime?'Last switch: '+fb.lastSwitchTime:'';
      }
    }
  }catch(e){
    document.getElementById('dot-status').className='dot red';
    document.getElementById('status-text').textContent='Disconnected';
  }
}
poll();setInterval(poll,5000);
<\/script></body></html>`;
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
      proverMode: this.proverMode,
      primaryUrl: this.primaryUrl,
      fallbackUrl: this.fallbackUrl,
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
 * Initialize the SP1 prover client (skipped if SP1_PROVER_URL not set; allows zkGPT-only dev).
 * @returns {Promise<SP1ProverClient | null>}
 */
export async function initSP1Prover() {
  const cfg = resolveProverConfig();
  if (!cfg.primaryUrl) {
    logger.info('No prover URL set (SP1_PROVER_URL / ZAN_PROVER_URL) — SP1 proof generation disabled (zkGPT-only or dev)');
    return null;
  }
  if (!sp1ProverClient) {
    sp1ProverClient = new SP1ProverClient();
    
    const isHealthy = await sp1ProverClient.healthCheck();
    if (isHealthy) {
      logger.info(
        { primaryUrl: sp1ProverClient.primaryUrl, fallbackUrl: sp1ProverClient.fallbackUrl },
        'SP1 prover client initialized successfully'
      );
      sp1ProverClient.startMetricsPolling();
      sp1ProverClient.startFallbackMonitor();
      const dashPort = parseInt(process.env.SP1_DASHBOARD_PORT || '9100');
      sp1ProverClient.startDashboard(dashPort);
    } else {
      logger.warn(
        { primaryUrl: sp1ProverClient.primaryUrl, fallbackUrl: sp1ProverClient.fallbackUrl },
        'SP1 prover service not reachable on any endpoint, will retry on proof requests'
      );
    }
  }
  return sp1ProverClient;
}

/**
 * Get the SP1 prover client instance (null if SP1_PROVER_URL was not set).
 * @returns {SP1ProverClient | null}
 */
export function getSP1Prover() {
  return sp1ProverClient ?? null;
}

export default SP1ProverClient;
