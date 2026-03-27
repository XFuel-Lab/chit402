import express from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { initAIListener, getAIListener } from './ai-listener.js';
import { getSP1Prover } from './sp1-prover-client.js';
import { getProvider } from './provider.js';

/**
 * XFuel AI DePIN — M2M API Server
 *
 * Standalone Express server exposing machine-to-machine (M2M) endpoints for
 * the AI DePIN module.  Pivoted from Persistence to Osmosis/Akash direct
 * with BTC-focused settlement.
 *
 * Endpoints:
 *   POST  /task-request    Submit an AI intent (COMPUTE_BID, INFERENCE_REQUEST, …)
 *   GET   /prove-result    Retrieve ZK settlement proof for a completed task
 *   POST  /a2a-message     Send an A2A (Agent-to-Agent) message with optional escrow
 *   POST  /a2a-settle-fair-exchange  Settle an A2A bid via Fair Exchange (PAS signature)
 *   GET   /task-status     Query task status / ProofOutcome
 *   GET   /health          Health / metrics
 *
 * Integrations:
 *   - ai-listener.js        → Task routing, fee calc, SP1 proof generation
 *   - AIVerifier.wasm        → RouteTask / SettleTask on Osmosis (CW20 fee sends)
 *   - AIDePINRouter.sol      → On-chain task routing + SP1 proof verification
 *   - TAOWrapper.sol         → Bittensor subnet inference via Substrate bridge
 *   - sp1-prover/main.rs     → validate_ai_task / validate_a2a_message circuits
 *   - FeeCollector.wasm      → CW20 fee accumulation → burn → RevenueSplitter
 *   - RevenueSplitter.sol    → 30/30/25/15 (BBB / LP / veXF / Treasury)
 *
 * Auth: API key header (`X-API-Key`) or relayer ECDSA signature (`X-Signature`).
 * Rate limiting: per-key sliding window (configurable).
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const AI_TASK_FEE_BPS = parseInt(process.env.AI_TASK_FEE_BPS) || 50;   // 0.5%
const MAX_FEE_BPS     = 100;  // 1.0%
const MIN_FEE_BPS     = 50;   // 0.5%
const FEE_DENOMINATOR = 10000;
const MIN_TASK_AMOUNT  = '10000'; // dust threshold (matches main.rs / ai-listener.js)
const MAX_TTL_SECONDS  = 86400;   // 24 h

/** Allowed message types — sync with AIDePINRouter.sol, main.rs, ai-listener.js */
const MESSAGE_TYPES = {
  COMPUTE_BID:       'compute_bid',
  COMPUTE_RESULT:    'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY:  'capability_query',
  DATA_ATTESTATION:  'data_attestation',
};

/** Allowed chain IDs — sync with AIDePINRouter.sol, main.rs */
const CHAIN_IDS = {
  THETA:       'theta',
  OSMOSIS:     'osmosis',
  AKASH:       'akash',
  BITTENSOR:   'bittensor',
  PERSISTENCE: 'persistence',
};

const VALID_MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPES));
const VALID_CHAIN_IDS     = new Set(Object.values(CHAIN_IDS));

// ─── In-Memory Rate Limiter ──────────────────────────────────────────────────

class RateLimiter {
  /**
   * @param {number} windowMs   Sliding window in ms
   * @param {number} maxHits    Max requests per window
   */
  constructor(windowMs = 60_000, maxHits = 60) {
    this.windowMs = windowMs;
    this.maxHits  = maxHits;
    /** @type {Map<string, number[]>} key → sorted timestamps */
    this.buckets  = new Map();
    // Garbage-collect stale buckets every 5 min
    this._gcTimer = setInterval(() => this._gc(), 5 * 60_000);
  }

  /**
   * Check and record a hit.
   * @param {string} key  identifier (e.g. API key or IP)
   * @returns {boolean} true if request is allowed
   */
  allow(key) {
    const now = Date.now();
    let hits = this.buckets.get(key);
    if (!hits) {
      hits = [];
      this.buckets.set(key, hits);
    }

    // Trim entries outside the window
    const cutoff = now - this.windowMs;
    while (hits.length && hits[0] <= cutoff) hits.shift();

    if (hits.length >= this.maxHits) return false;
    hits.push(now);
    return true;
  }

  /** @returns {{ remaining: number, resetMs: number }} */
  info(key) {
    const now = Date.now();
    const hits = this.buckets.get(key) || [];
    const cutoff = now - this.windowMs;
    const active = hits.filter(t => t > cutoff);
    return {
      remaining: Math.max(0, this.maxHits - active.length),
      resetMs: active.length ? active[0] + this.windowMs - now : 0,
    };
  }

  _gc() {
    const now = Date.now();
    for (const [key, hits] of this.buckets) {
      const cutoff = now - this.windowMs;
      const active = hits.filter(t => t > cutoff);
      if (active.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, active);
      }
    }
  }

  destroy() {
    clearInterval(this._gcTimer);
    this.buckets.clear();
  }
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────

/**
 * Authorised API keys stored in env as a comma-separated list.
 *
 * Example:
 *   M2M_API_KEYS=key-abc123,key-xyz789
 *
 * If the env var is empty or unset the server runs in *open mode* (dev only)
 * and logs a warning on startup.
 */
const AUTHORISED_KEYS = new Set(
  (process.env.M2M_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
);

/**
 * Verify an ECDSA signature from a relayer wallet.
 *
 * The client signs a message consisting of:
 *   keccak256(method + path + body_sha256 + timestamp)
 *
 * Header layout:
 *   X-Signature: <0x-hex-sig>
 *   X-Sig-Timestamp: <unix-epoch-seconds>
 *
 * The recovered address must hold RELAYER_ROLE in AIDePINRouter.  For now we
 * check it against env `M2M_RELAYER_ADDRESSES` (comma-separated, checksummed).
 */
const RELAYER_ADDRESSES = new Set(
  (process.env.M2M_RELAYER_ADDRESSES || '')
    .split(',')
    .map(a => a.trim().toLowerCase())
    .filter(Boolean)
);

function verifyRelayerSignature(req) {
  try {
    const sig       = req.headers['x-signature'];
    const timestamp = req.headers['x-sig-timestamp'];
    if (!sig || !timestamp) return false;

    // Reject stale signatures (> 5 min)
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > 300) return false;

    const bodySha = crypto
      .createHash('sha256')
      .update(JSON.stringify(req.body || ''))
      .digest('hex');

    const message = `${req.method}${req.path}${bodySha}${timestamp}`;
    const recovered = ethers.verifyMessage(message, sig).toLowerCase();

    return RELAYER_ADDRESSES.has(recovered);
  } catch {
    return false;
  }
}

// ─── Fee Calculation ─────────────────────────────────────────────────────────

/**
 * Pure fee calculation — mirrors calculate_task_fee() in main.rs,
 * calculateTaskFee() in AIDePINRouter.sol and TAOWrapper.sol.
 *
 * @param {string|bigint} grossAmount  Total task value
 * @param {number}        feeBps       Fee rate in BPS (50-100)
 * @returns {{ feeAmount: string, netAmount: string }}
 */
function calculateTaskFee(grossAmount, feeBps = AI_TASK_FEE_BPS) {
  const gross = BigInt(grossAmount);
  const bps   = BigInt(Math.min(Math.max(feeBps, MIN_FEE_BPS), MAX_FEE_BPS));
  const fee   = (gross * bps) / BigInt(FEE_DENOMINATOR);
  const net   = gross - fee;
  return {
    feeAmount: fee.toString(),
    netAmount: net.toString(),
    feeBps: Number(bps),
  };
}

// ─── Express App Factory ─────────────────────────────────────────────────────

/**
 * Build and return a configured Express app.
 * Called from `startServer()` or directly in tests.
 */
export function createApp() {
  const app = express();

  // ── Global middleware ────────────────────────────────────────────────────

  app.use(express.json({ limit: '1mb' }));

  // Request ID
  app.use((req, _res, next) => {
    req.id = crypto.randomUUID();
    next();
  });

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info({
        reqId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }, 'request');
    });
    next();
  });

  // ── Rate limiter ────────────────────────────────────────────────────────

  const rateLimiter = new RateLimiter(
    parseInt(process.env.M2M_RATE_WINDOW_MS) || 60_000,
    parseInt(process.env.M2M_RATE_MAX_HITS)  || 120,
  );

  function rateLimit(req, res, next) {
    const key = req.headers['x-api-key'] || req.ip || 'anon';
    if (!rateLimiter.allow(key)) {
      const info = rateLimiter.info(key);
      res.set('Retry-After', Math.ceil(info.resetMs / 1000).toString());
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests — slow down.',
        retryAfterMs: info.resetMs,
      });
    }
    next();
  }

  // ── Auth middleware ─────────────────────────────────────────────────────

  function authenticate(req, res, next) {
    // Dev / open mode when no keys are configured
    if (AUTHORISED_KEYS.size === 0 && RELAYER_ADDRESSES.size === 0) {
      return next();
    }

    // 1. API key
    const apiKey = req.headers['x-api-key'];
    if (apiKey && AUTHORISED_KEYS.has(apiKey)) {
      req.authMethod = 'api_key';
      return next();
    }

    // 2. Relayer ECDSA signature
    if (verifyRelayerSignature(req)) {
      req.authMethod = 'relayer_sig';
      return next();
    }

    return res.status(401).json({
      error: 'unauthorized',
      message: 'Provide a valid X-API-Key header or X-Signature relayer authentication.',
    });
  }

  // Apply rate-limit + auth to all API routes
  app.use('/task-request',  rateLimit, authenticate);
  app.use('/prove-result',  rateLimit, authenticate);
  app.use('/a2a-message',   rateLimit, authenticate);
  app.use('/a2a-settle-fair-exchange', rateLimit, authenticate);
  app.use('/task-status',   rateLimit, authenticate);

  // ═══════════════════════════════════════════════════════════════════════
  // POST /task-request — Submit an AI intent
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/task-request', async (req, res) => {
    try {
      const {
        message_type,       // required – one of MESSAGE_TYPES
        chain_id,           // required – destination chain (CHAIN_IDS)
        amount,             // required – gross task value (string)
        fee_bps,            // optional – override BPS (50-100), default 50
        sender,             // required – sender address / identifier
        model_id,           // optional – ML model hash (for INFERENCE_REQUEST)
        input_hash,         // optional – hash of input data
        output_hash,        // optional – hash of output (for COMPUTE_RESULT)
        theta_recipient,    // optional – Theta EVM address for settlement
        max_gpu_hours,      // optional – Akash GPU lease duration
        subnet_id,          // optional – Bittensor subnet UID (for TAO routing)
        ibc_channel,        // optional – explicit IBC channel override
        memo,               // optional – free-form memo
        proof_system,       // optional – inference proof system: 'sp1' | 'zkgpt' (Phase 1); default 'sp1'
      } = req.body;

      // ── Validation ────────────────────────────────────────────────────

      const errors = [];

      if (!message_type || !VALID_MESSAGE_TYPES.has(message_type)) {
        errors.push(
          `message_type is required and must be one of: ${[...VALID_MESSAGE_TYPES].join(', ')}`
        );
      }
      if (!chain_id || !VALID_CHAIN_IDS.has(chain_id)) {
        errors.push(
          `chain_id is required and must be one of: ${[...VALID_CHAIN_IDS].join(', ')}`
        );
      }
      if (!amount || BigInt(amount || 0) < BigInt(MIN_TASK_AMOUNT)) {
        errors.push(
          `amount is required and must be >= ${MIN_TASK_AMOUNT} (dust protection)`
        );
      }
      if (!sender) {
        errors.push('sender is required');
      }

      // Type-specific validation (mirrors main.rs validate_ai_task constraints)
      if (message_type === MESSAGE_TYPES.INFERENCE_REQUEST && !model_id) {
        errors.push('model_id is required for INFERENCE_REQUEST');
      }
      if (message_type === MESSAGE_TYPES.COMPUTE_RESULT && !output_hash) {
        errors.push('output_hash is required for COMPUTE_RESULT');
      }
      if (message_type === MESSAGE_TYPES.DATA_ATTESTATION && !input_hash) {
        errors.push('input_hash is required for DATA_ATTESTATION');
      }
      if (chain_id === CHAIN_IDS.BITTENSOR && !subnet_id && message_type !== MESSAGE_TYPES.CAPABILITY_QUERY) {
        errors.push('subnet_id is required for Bittensor routing (except CAPABILITY_QUERY)');
      }
      if (fee_bps !== undefined && (fee_bps < MIN_FEE_BPS || fee_bps > MAX_FEE_BPS)) {
        errors.push(`fee_bps must be between ${MIN_FEE_BPS} and ${MAX_FEE_BPS}`);
      }
      const PROOF_SYSTEMS = new Set(['sp1', 'zkgpt']);
      if (proof_system !== undefined && proof_system !== null && proof_system !== '' && !PROOF_SYSTEMS.has(proof_system)) {
        errors.push(`proof_system must be one of: ${[...PROOF_SYSTEMS].join(', ')}`);
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: 'validation_error', details: errors });
      }

      // ── Fee calculation ───────────────────────────────────────────────

      const effectiveFeeBps = fee_bps || AI_TASK_FEE_BPS;
      const { feeAmount, netAmount, feeBps: appliedBps } =
        calculateTaskFee(amount, effectiveFeeBps);

      // ── Build intent for ai-listener processing ───────────────────────

      const intent = {
        type:           message_type,
        sender,
        recipient:      theta_recipient || null,
        amount,
        denom:          chain_id === CHAIN_IDS.BITTENSOR ? 'vtao' : 'uosmo',
        thetaRecipient: theta_recipient || null,
        modelId:        model_id || null,
        inputHash:      input_hash || null,
        maxGpuHours:    max_gpu_hours || null,
        nonce:          null, // assigned by listener
        memo:           memo || null,
        chain:          chain_id,
        subnetId:       subnet_id || null,
        ibcChannel:     ibc_channel || null,
        outputHash:     output_hash || null,
        proofSystem:    proof_system || 'sp1', // Phase 1: 'sp1' | 'zkgpt' for inference
      };

      const meta = {
        chain:   chain_id,
        txHash:  `api-${req.id}`,
        height:  0,
        source:  'server.js',
      };

      // ── Route via AIListener ──────────────────────────────────────────

      const aiListener = getAIListener();
      const taskId = `m2m-task-${++_taskNonce}-${Date.now()}`;

      // Register the task in the listener's active tasks map so
      // /task-status and /prove-result can query it.
      const task = {
        taskId,
        intent,
        meta,
        status:     'pending',
        createdAt:  Date.now(),
        updatedAt:  Date.now(),
        feeAmount,
        netAmount,
        feeBps:     appliedBps,
        sp1Proof:   null,
        result:     null,
      };

      aiListener.activeTasks.set(taskId, task);

      // Fire-and-forget: process asynchronously (matches ai-listener flow)
      aiListener._processAIIntent(intent, meta).catch(err => {
        logger.error({ err, taskId }, 'Async AI intent processing failed');
      });

      // Update the task reference with the one the listener created
      // (the listener generates its own taskId inside _processAIIntent —
      //  we override so the caller can track it)
      const listenerTask = [...aiListener.activeTasks.values()]
        .find(t => t.meta?.txHash === meta.txHash && t.taskId !== taskId);

      const effectiveTaskId = listenerTask ? listenerTask.taskId : taskId;

      logger.info({
        reqId: req.id,
        taskId: effectiveTaskId,
        messageType: message_type,
        chainId: chain_id,
        amount,
        feeAmount,
        netAmount,
        feeBps: appliedBps,
      }, 'Task request accepted');

      return res.status(202).json({
        task_id:       effectiveTaskId,
        status:        'accepted',
        message_type,
        chain_id,
        gross_amount:  amount,
        fee_amount:    feeAmount,
        net_amount:    netAmount,
        fee_bps:       appliedBps,
        fee_info: {
          description: `${(appliedBps / 100).toFixed(1)}% protocol fee → RevenueSplitter (30% BBB / 30% LP / 25% veXF / 15% Treasury)`,
          collector:   'FeeCollector.wasm → CW20 Send → RevenueSplitter',
        },
        _links: {
          status: `/task-status?task_id=${effectiveTaskId}`,
          proof:  `/prove-result?task_id=${effectiveTaskId}`,
        },
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /task-request error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /prove-result — Retrieve ZK settlement proof for a completed task
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/prove-result', async (req, res) => {
    try {
      const { task_id } = req.query;

      if (!task_id) {
        return res.status(400).json({
          error: 'validation_error',
          message: 'task_id query parameter is required',
        });
      }

      const aiListener = getAIListener();
      const task = _findTask(aiListener, task_id);

      if (!task) {
        return res.status(404).json({
          error: 'not_found',
          message: `Task ${task_id} not found`,
        });
      }

      // Task must be completed or fee_collected before a proof is available
      if (!['completed', 'fee_collected'].includes(task.status)) {
        return res.status(409).json({
          error: 'task_not_settled',
          message: `Task is in "${task.status}" state — proof is only available after completion.`,
          task_id,
          status: task.status,
        });
      }

      // Fee breakdown (mirrors calculate_task_fee from main.rs)
      const gross    = BigInt(task.intent?.amount || task.feeAmount || '0');
      const feeBps   = task.feeBps || AI_TASK_FEE_BPS;
      const { feeAmount, netAmount } = calculateTaskFee(
        task.intent?.amount || '0',
        feeBps,
      );

      const proofPayload = {
        task_id:        task.taskId,
        status:         task.status,
        proof_outcome:  task.sp1Proof?.error ? 'regenerable' : 'valid',
        sp1_proof:      task.sp1Proof || null,
        fee: {
          gross_amount:  task.intent?.amount || '0',
          fee_amount:    task.feeAmount || feeAmount,
          net_amount:    netAmount,
          fee_bps:       feeBps,
          fee_collector: config.osmosis?.feeCollectorContract || '(not deployed)',
          revenue_split: {
            bbb_buyback_burn:  '30%',
            lp_provision:      '30%',
            vexf_stakers:      '25%',
            treasury:          '15%',
          },
        },
        result:         task.result || null,
        meta: {
          source_chain:  task.meta?.chain,
          source_tx:     task.meta?.txHash,
          block_height:  task.meta?.height,
          completed_at:  task.updatedAt,
        },
      };

      return res.json(proofPayload);
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /prove-result error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /a2a-message — Send an A2A (Agent-to-Agent) message with escrow
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/a2a-message', async (req, res) => {
    try {
      const {
        message_type,       // required – one of MESSAGE_TYPES
        sender_chain,       // required – origin chain
        recipient_chain,    // required – destination chain
        payload_hash,       // required – SHA-256 of payload
        escrow_amount,      // optional – escrowed TFUEL / AKT / TAO (string)
        ttl,                // required – time-to-live in seconds (1-86400)
        sender_address,     // required – sender agent address
        sender_identity,    // required – agent identity commitment (hex)
        recipient_address,  // optional – recipient agent address
        ibc_channel,        // optional – explicit IBC channel
      } = req.body;

      // ── Validation ────────────────────────────────────────────────────

      const errors = [];

      if (!message_type || !VALID_MESSAGE_TYPES.has(message_type)) {
        errors.push(
          `message_type must be one of: ${[...VALID_MESSAGE_TYPES].join(', ')}`
        );
      }
      if (!sender_chain || !VALID_CHAIN_IDS.has(sender_chain)) {
        errors.push(`sender_chain must be one of: ${[...VALID_CHAIN_IDS].join(', ')}`);
      }
      if (!recipient_chain || !VALID_CHAIN_IDS.has(recipient_chain)) {
        errors.push(`recipient_chain must be one of: ${[...VALID_CHAIN_IDS].join(', ')}`);
      }
      if (!payload_hash || payload_hash.length < 8) {
        errors.push('payload_hash is required (hex string, >= 8 chars)');
      }
      if (!ttl || ttl < 1 || ttl > MAX_TTL_SECONDS) {
        errors.push(`ttl is required and must be between 1 and ${MAX_TTL_SECONDS}`);
      }
      if (!sender_address) {
        errors.push('sender_address is required');
      }
      if (!sender_identity) {
        errors.push('sender_identity (agent identity commitment) is required');
      }

      // Escrow validation per message type
      // (mirrors _validateEscrowForMsgType in AIDePINRouter.sol / main.rs)
      const escrow = BigInt(escrow_amount || '0');
      if (message_type === MESSAGE_TYPES.COMPUTE_BID && escrow <= 0n) {
        errors.push('COMPUTE_BID requires a non-zero escrow_amount');
      }
      if (message_type === MESSAGE_TYPES.INFERENCE_REQUEST && escrow <= 0n) {
        errors.push('INFERENCE_REQUEST requires a non-zero escrow_amount (budget)');
      }
      if (message_type === MESSAGE_TYPES.CAPABILITY_QUERY && escrow > 0n) {
        errors.push('CAPABILITY_QUERY must have zero escrow_amount');
      }

      // Cross-chain messages require IBC channel (mirrors main.rs)
      if (sender_chain !== recipient_chain && !ibc_channel) {
        errors.push('ibc_channel is required for cross-chain A2A messages');
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: 'validation_error', details: errors });
      }

      // ── A2A relay fee (0.1% on escrow — matches AIDePINRouter) ─────

      let relayFee = '0';
      if (escrow > 0n) {
        relayFee = ((escrow * 10n) / 10000n).toString(); // 10 BPS
      }

      // ── Build message record ──────────────────────────────────────────

      const messageId = `a2a-${crypto.randomUUID()}`;
      const nonce     = ++_a2aNonce;

      const a2aMessage = {
        messageId,
        msgType:         message_type,
        senderChain:     sender_chain,
        recipientChain:  recipient_chain,
        payloadHash:     payload_hash,
        escrowAmount:    escrow.toString(),
        nonce,
        ttl,
        timestamp:       Math.floor(Date.now() / 1000),
        verified:        false,
        senderAddress:   sender_address,
        senderIdentity:  sender_identity,
        recipientAddress: recipient_address || null,
        ibcChannel:      ibc_channel || null,
        relayFee,
      };

      _a2aMessages.set(messageId, a2aMessage);

      // Fire-and-forget: generate SP1 A2AMessage proof asynchronously
      _generateA2AProof(a2aMessage).catch(err => {
        logger.error({ err, messageId }, 'A2A proof generation failed');
      });

      logger.info({
        reqId: req.id,
        messageId,
        msgType:        message_type,
        senderChain:    sender_chain,
        recipientChain: recipient_chain,
        escrow:         escrow.toString(),
        relayFee,
      }, 'A2A message accepted');

      return res.status(202).json({
        message_id:      messageId,
        status:          'accepted',
        message_type,
        sender_chain,
        recipient_chain,
        payload_hash,
        escrow_amount:   escrow.toString(),
        relay_fee:       relayFee,
        relay_fee_info:  '0.1% on escrowed amount → RevenueSplitter (30/30/25/15)',
        nonce,
        ttl,
        timestamp:       a2aMessage.timestamp,
        _links: {
          status: `/task-status?message_id=${messageId}`,
        },
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /a2a-message error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /a2a-settle-fair-exchange — Settle A2A bid via Fair Exchange (Phase 1 PAS)
  // ═══════════════════════════════════════════════════════════════════════

  const A2A_SETTLE_FE_ABI = [
    'function settleBidFairExchange(bytes32 bidId, bytes32 resultHash, uint8 v, bytes32 r, bytes32 s)',
  ];

  app.post('/a2a-settle-fair-exchange', async (req, res) => {
    try {
      const { bid_id, result_hash, v, r, s } = req.body;

      const errors = [];
      if (!bid_id || typeof bid_id !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(bid_id)) {
        errors.push('bid_id is required (0x-prefixed 32-byte hex)');
      }
      if (!result_hash || typeof result_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result_hash)) {
        errors.push('result_hash is required (0x-prefixed 32-byte hex)');
      }
      const vNum = v !== undefined && v !== null ? Number(v) : NaN;
      if (Number.isNaN(vNum) || vNum < 0 || vNum > 255) {
        errors.push('v is required (0–255)');
      }
      if (!r || typeof r !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(r)) {
        errors.push('r is required (0x-prefixed 32-byte hex)');
      }
      if (!s || typeof s !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(s)) {
        errors.push('s is required (0x-prefixed 32-byte hex)');
      }
      if (errors.length > 0) {
        return res.status(400).json({ error: 'validation_error', details: errors });
      }

      const a2aAddress = config.contracts?.a2aCircuitAddress;
      const relayerKey = config.relayer?.privateKey;

      if (!a2aAddress) {
        return res.status(503).json({
          error: 'service_unavailable',
          message: 'A2A_CIRCUIT_ADDRESS not configured; Fair Exchange settlement unavailable.',
        });
      }

      const bidId = bid_id;
      const resultHash = result_hash;
      const sig = { v: vNum, r, s };

      if (relayerKey) {
        try {
          const provider = getProvider();
          const signer = provider.getSigner(relayerKey);
          const contract = new ethers.Contract(a2aAddress, A2A_SETTLE_FE_ABI, signer);
          const tx = await contract.settleBidFairExchange(bidId, resultHash, sig.v, sig.r, sig.s);
          const receipt = await tx.wait(1).catch(() => null);
          return res.status(202).json({
            status: 'submitted',
            tx_hash: tx.hash,
            bid_id: bidId,
            result_hash: resultHash,
            confirmed: !!receipt,
            _links: { status: `/task-status?message_id=${bidId}` },
          });
        } catch (providerErr) {
          if (providerErr.message?.includes('Provider not initialized')) {
            const iface = new ethers.Interface(A2A_SETTLE_FE_ABI);
            const calldata = iface.encodeFunctionData('settleBidFairExchange', [bidId, resultHash, sig.v, sig.r, sig.s]);
            return res.status(200).json({
              status: 'calldata',
              message: 'Provider not initialized; submit calldata to A2ACircuit with your relayer.',
              contract: a2aAddress,
              calldata,
              bid_id: bidId,
              result_hash: resultHash,
            });
          }
          throw providerErr;
        }
      }

      const iface = new ethers.Interface(A2A_SETTLE_FE_ABI);
      const calldata = iface.encodeFunctionData('settleBidFairExchange', [bidId, resultHash, sig.v, sig.r, sig.s]);
      return res.status(200).json({
        status: 'calldata',
        message: 'Submit this calldata to A2ACircuit (relayer not configured).',
        contract: a2aAddress,
        calldata,
        bid_id: bidId,
        result_hash: resultHash,
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /a2a-settle-fair-exchange error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /task-status — Query task or A2A message status / ProofOutcome
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/task-status', async (req, res) => {
    try {
      const { task_id, message_id } = req.query;

      if (!task_id && !message_id) {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Either task_id or message_id query parameter is required',
        });
      }

      // ── Query a task ──────────────────────────────────────────────────

      if (task_id) {
        const aiListener = getAIListener();
        const task = _findTask(aiListener, task_id);

        if (!task) {
          return res.status(404).json({
            error: 'not_found',
            message: `Task ${task_id} not found`,
          });
        }

        // Map status to ProofOutcome (matches AIDePINRouter ProofOutcome enum)
        let proofOutcome = 'pending';
        if (task.sp1Proof && !task.sp1Proof.error) {
          proofOutcome = 'valid';   // ProofOutcome.Valid
        } else if (task.sp1Proof?.error) {
          proofOutcome = 'regenerable'; // ProofOutcome.Regenerable
        } else if (task.status === 'failed') {
          proofOutcome = 'invalid'; // ProofOutcome.Invalid
        }

        return res.json({
          task_id:        task.taskId,
          status:         task.status,
          proof_outcome:  proofOutcome,
          proof_system:   task.intent?.proofSystem || 'sp1', // 'sp1' | 'zkgpt' — which prover ran; proof data is in sp1_proof for both
          message_type:   task.intent?.type,
          chain_id:       task.meta?.chain,
          gross_amount:   task.intent?.amount || '0',
          fee_amount:     task.feeAmount || '0',
          net_amount:     task.netAmount || '0',
          fee_bps:        task.feeBps || AI_TASK_FEE_BPS,
          result:         task.result || null,
          sp1_proof:      task.sp1Proof ? {
            has_proof:      !!task.sp1Proof.proof,
            nullifier:      task.sp1Proof.nullifier || null,
            proving_time_ms: task.sp1Proof.provingTimeMs || null,
            error:          task.sp1Proof.error || null,
            prover_error:   task.sp1Proof.prover_error || null,
            prover_response: task.sp1Proof.prover_response || null,
          } : null,
          created_at:     task.createdAt,
          updated_at:     task.updatedAt,
        });
      }

      // ── Query an A2A message ──────────────────────────────────────────

      if (message_id) {
        const msg = _a2aMessages.get(message_id);

        if (!msg) {
          return res.status(404).json({
            error: 'not_found',
            message: `A2A message ${message_id} not found`,
          });
        }

        return res.json({
          message_id:      msg.messageId,
          status:          msg.verified ? 'verified' : 'pending',
          proof_outcome:   msg.verified ? 'valid' : 'pending',
          message_type:    msg.msgType,
          sender_chain:    msg.senderChain,
          recipient_chain: msg.recipientChain,
          payload_hash:    msg.payloadHash,
          escrow_amount:   msg.escrowAmount,
          relay_fee:       msg.relayFee,
          nonce:           msg.nonce,
          ttl:             msg.ttl,
          timestamp:       msg.timestamp,
          sp1_proof:       msg.sp1Proof || null,
        });
      }
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /task-status error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /health — Server health and aggregate metrics
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/health', async (_req, res) => {
    try {
      let aiStatus = null;
      try {
        const ai = getAIListener();
        aiStatus = ai.getStatus();
      } catch { /* not initialised */ }

      return res.json({
        status:      'ok',
        server:      'xfuel-m2m-api',
        version:     '1.0.0',
        timestamp:   new Date().toISOString(),
        uptime_s:    Math.floor(process.uptime()),
        a2a_messages_total: _a2aMessages.size,
        ai_listener: aiStatus,
        fee_config: {
          default_bps:    AI_TASK_FEE_BPS,
          min_bps:        MIN_FEE_BPS,
          max_bps:        MAX_FEE_BPS,
          min_task_amount: MIN_TASK_AMOUNT,
          a2a_relay_bps:  10,
          revenue_split:  '30% BBB / 30% LP / 25% veXF / 15% Treasury',
        },
        chains: Object.values(CHAIN_IDS),
        message_types: Object.values(MESSAGE_TYPES),
      });
    } catch (err) {
      return res.status(503).json({ status: 'error', message: err.message });
    }
  });

  // ── 404 fallback ────────────────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: 'Unknown endpoint. Available: POST /task-request, GET /prove-result, POST /a2a-message, GET /task-status, GET /health',
    });
  });

  // ── Global error handler ────────────────────────────────────────────────

  app.use((err, _req, res, _next) => {
    logger.error({ err }, 'Unhandled Express error');
    res.status(500).json({ error: 'internal', message: 'Internal server error' });
  });

  return app;
}

// ─── Internal State ──────────────────────────────────────────────────────────

let _taskNonce  = 0;
let _a2aNonce   = 0;

/** @type {Map<string, Object>} A2A message storage */
const _a2aMessages = new Map();

/**
 * Look up a task across the listener's active tasks map.
 * @param {Object}  aiListener  AIListener instance
 * @param {string}  taskId      task id to find
 * @returns {Object|null}
 */
function _findTask(aiListener, taskId) {
  return aiListener.activeTasks.get(taskId) || null;
}

/**
 * Generate an SP1 A2AMessage proof (async, non-blocking).
 * Mirrors validate_a2a_message() from sp1-prover/program/src/main.rs.
 *
 * @param {Object} msg  A2A message record
 */
async function _generateA2AProof(msg) {
  try {
    const sp1Prover = getSP1Prover();
    if (!sp1Prover) {
      msg.sp1Proof = { error: 'SP1_PROVER_URL not set', timestamp: Date.now() };
      return;
    }

    const proofRequest = {
      vault_address:       ethers.ZeroAddress,
      net_amount:          msg.escrowAmount,
      block_number:        0,
      merkle_root:         ethers.keccak256(ethers.toUtf8Bytes(msg.messageId)),
      identity_commitment: ethers.keccak256(ethers.toUtf8Bytes(msg.senderIdentity)),

      // A2A-specific extensions
      a2a_message:     true,
      msg_type:        msg.msgType,
      sender_chain:    msg.senderChain,
      recipient_chain: msg.recipientChain,
      payload_hash:    msg.payloadHash,
      escrow_amount:   msg.escrowAmount,
      nonce:           msg.nonce,
      ttl:             msg.ttl,
      timestamp:       msg.timestamp,
      ibc_channel:     msg.ibcChannel,
    };

    const result = await sp1Prover.generateProof(proofRequest, true);

    msg.sp1Proof = {
      proof:        result.proof,
      publicInputs: result.publicInputs,
      nullifier:    result.nullifier,
      provingTimeMs: result.provingTimeMs,
      timestamp:    Date.now(),
    };
    msg.verified = true;

    logger.info({
      messageId:    msg.messageId,
      provingTimeMs: result.provingTimeMs,
      nullifier:    result.nullifier,
    }, 'A2A message SP1 proof generated');
  } catch (err) {
    logger.warn({ err, messageId: msg.messageId }, 'A2A SP1 proof failed (non-fatal)');
    msg.sp1Proof = { error: err.message, timestamp: Date.now() };
  }
}

// ─── Server Bootstrap ────────────────────────────────────────────────────────

/**
 * Start the M2M API server.
 *
 * Initialises the AIListener (if not already running) and binds on
 * M2M_API_PORT (default 3002, separate from the bridge health port 3001).
 */
export async function startServer() {
  const port = parseInt(process.env.M2M_API_PORT) || 3002;

  // Ensure AIListener is initialised
  try {
    getAIListener();
  } catch {
    logger.info('Initialising AI Listener for M2M API…');
    await initAIListener();
    const ai = getAIListener();
    await ai.startListening();
  }

  const app = createApp();

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info({ port }, 'XFuel M2M API server started');

      if (AUTHORISED_KEYS.size === 0 && RELAYER_ADDRESSES.size === 0) {
        logger.warn(
          'M2M API is running in OPEN MODE (no M2M_API_KEYS or M2M_RELAYER_ADDRESSES configured). ' +
          'Set these env vars in production!'
        );
      }

      resolve(server);
    });
  });
}

// ── CLI entry-point ──────────────────────────────────────────────────────────

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') ||
   process.argv[1].endsWith('server'));

if (isMainModule) {
  startServer().catch((err) => {
    logger.error({ err }, 'Fatal: M2M API server failed to start');
    process.exit(1);
  });
}

export default createApp;
