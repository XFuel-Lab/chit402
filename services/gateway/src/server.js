import express from 'express';
import crypto from 'crypto';
import path from 'node:path';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { initAIListener, getAIListener } from './ai-listener.js';
import { getSP1Prover, initSP1Prover } from './sp1-prover-client.js';
import { getProvider } from './provider.js';
import { getWebhookRegistry, WebhookDispatcher, WEBHOOK_EVENTS } from './webhooks.js';
import { resolveRail, runX402Handshake, priceUSDCResolved, quoteResolved, resolvePricingModel, extractPaymentHeader } from './x402-server.js';
import { checkPricingConfig, tier2ProofUnits, promptTokensFor, quotedMaxOutputTokens } from './pricing.js';
import { estimateCogsFromRequest } from './provider-rates.js';
import { registerOpenAIRoutes } from './openai-gateway.js';
import { proveAllowedForKey, proofAvailability, refreshProverProbe } from './prove-gate.js';
import { getHubCatalog } from './hub-catalog.js';
import { startHealthProbes, healthSnapshot } from './provider-health.js';
import { freeTierStatus } from './free-tier.js';
import {
  rollingStatus,
  rollingEnabled,
  rollingDecision,
  payerBucket,
  markSettled,
  markSettleFailed,
  applyPaymentToOwedTask,
  configureRollingLedger,
} from './rolling-settlement.js';
import { buildReceipt, buildAuditorExport, renderReceiptHtml, renderAuditorHtml, renderReceiptNotFound, buildVerifyUrl, baseUrlFromReq, proofOutcomeOf } from './receipt.js';
import { buildValidationRecord } from './erc8004.js';
import { buildX402Manifest } from './x402-discovery.js';
import { buildPaymentChallenge } from './x402-adapter.js';
import { computeUsageStats, renderStatsHtml } from './telemetry.js';
import { resolveSplit, describeSplit } from './revenue-split.js';
import { apiKeyHashFromReq } from './buyer-attr.js';
import { getFloatManager } from './provider-float.js';

/**
 * XFuel M2M API Server — agent gateway for verifiable AI compute settlement.
 *
 * Endpoints:
 *   POST  /task-request    Submit an AI intent (COMPUTE_BID, INFERENCE_REQUEST, …)
 *   POST  /task-quote      Price a task (USDC via x402 default; legacy tfuel optional)
 *   GET   /prove-result    Retrieve ZK settlement proof for a completed task
 *   POST  /a2a-message     Send an A2A (Agent-to-Agent) message with optional escrow
 *   POST  /a2a-settle-fair-exchange  Settle an A2A bid via Fair Exchange (PAS signature)
 *   GET   /task-status     Query task status / ProofOutcome
 *   GET   /receipt/:taskId Public, no-auth verifiable receipt (HTML + ?format=json)
 *   PUT   /webhook         Register a webhook for TaskSettled events (HMAC-signed)
 *   GET   /webhook         List registered webhooks
 *   DELETE /webhook        Remove a registered webhook (by id or url)
 *   GET   /health          Health / metrics
 *
 * Settlement: USDC via x402 on Base → X402_PAY_TO / Splits v2 (token-light, ADR 0001).
 * Provider COGS: prepaid floats (ADR 0005) — no hot-path FX.
 * Proofs: Tier-1 signed receipt (default); Tier-2 SP1 on Base (on demand).
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

/** Allowed message types — sync with main.rs, ai-listener.js */
const MESSAGE_TYPES = {
  COMPUTE_BID:       'compute_bid',
  COMPUTE_RESULT:    'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY:  'capability_query',
  DATA_ATTESTATION:  'data_attestation',
};

/** Allowed chain IDs — sync with main.rs */
const CHAIN_IDS = {
  BASE:        'base',       // settlement home (USDC / x402); Per ADR 0002
  THETA:       'theta',      // legacy routing label; EdgeCloud is provider-only
  OSMOSIS:     'osmosis',
  AKASH:       'akash',
  BITTENSOR:   'bittensor',
  PERSISTENCE: 'persistence',
};

const VALID_MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPES));
const VALID_CHAIN_IDS     = new Set(Object.values(CHAIN_IDS));

/**
 * Validate a /task-request body BEFORE any payment settlement runs.
 *
 * Returns an array of validation error strings. Empty array means valid.
 * This function MUST be called before any x402 handshake/settlement code
 * to prevent charging for requests we will refuse to fulfill.
 *
 * @param {Object} body  The request body (or {} if empty/null)
 * @returns {string[]} Validation errors (empty if valid)
 */
function validateTaskRequestBody(body = {}) {
  const {
    message_type,
    chain_id,
    amount,
    sender,
    model_id,
    output_hash,
    input_hash,
    subnet_id,
    fee_bps,
    tools,
    max_tokens,
    proof_system,
    callback_url,
  } = body;

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
  // Same contract as /v1/chat/completions — a caller should not have to learn
  // two tool schemas to move from the free surface to the paid one.
  if (tools !== undefined && tools !== null
    && (!Array.isArray(tools) || tools.some((t) => t?.type !== 'function' || !t.function?.name))) {
    errors.push('tools must be an array of {type:"function", function:{name,...}}');
  }
  if (max_tokens !== undefined && max_tokens !== null
    && (!Number.isInteger(max_tokens) || max_tokens < 1)) {
    errors.push('max_tokens must be a positive integer');
  }
  const PROOF_SYSTEMS = new Set(['sp1', 'zkgpt']);
  if (proof_system !== undefined && proof_system !== null && proof_system !== '' && !PROOF_SYSTEMS.has(proof_system)) {
    errors.push(`proof_system must be one of: ${[...PROOF_SYSTEMS].join(', ')}`);
  }
  if (callback_url) {
    try {
      const u = new URL(callback_url);
      if (!/^https?:$/.test(u.protocol)) errors.push('callback_url must use http or https');
    } catch {
      errors.push('callback_url must be a valid absolute URL');
    }
  }

  return errors;
}

/**
 * Chains advertised on /health — only those actually served.
 * Keep CHAIN_IDS / VALID_CHAIN_IDS wide so inbound A2A still accepts legacy labels.
 * Akash is listed for AkashML compute; Osmosis only when Cosmos IBC listeners are on.
 */
function advertisedChains() {
  const out = [CHAIN_IDS.BASE, CHAIN_IDS.THETA, CHAIN_IDS.AKASH];
  if (config.aiListener?.cosmosListeners) {
    out.push(CHAIN_IDS.OSMOSIS);
  }
  return out;
}

/**
 * The threshold a task must clear before it gets a Tier-2 proof, and what one
 * costs if a caller asks for it.
 *
 * On `/health` so the gate is inspectable from outside. It is the difference
 * between "proofs are on" and "proofs are on for calls above $2.00", and that
 * distinction decides whether a partner sees a proof at all.
 */
function tier2Gate() {
  const vi = config.verifiedInference || {};
  const usd = (units) => (units == null || units === '' ? null : Number(units) / 1_000_000);
  const cogsGate = usd(vi.tier2MinCogs);

  return {
    basis: cogsGate !== null ? 'provider_cogs' : 'settled_amount',
    min_cogs_usd: cogsGate,
    min_amount_usd: usd(vi.tier2Min),
    opt_in_price_usd: Number(tier2ProofUnits()) / 1_000_000,
  };
}

// ─── /llms.txt — agent discoverability manifest ───────────────────────────────
// Served at GET /llms.txt (llmstxt.org convention). Keep concise; deep detail
// lives in the linked docs so agents can progressively disclose.

const LLMS_TXT = `# XFuel Protocol

> Swap one baseURL. Every call comes back with a public receipt that names the
> model, the hub, and the cost. /v1 is unmetered (demo key, rate-limited).
> USDC on Base is a separate paid door. This host is the public beta; paying
> it moves real USDC on Base mainnet. Canonical: api.xfuel.app.

## Start here (OpenAI-compatible — no wallet)

- POST /v1/chat/completions : OpenAI chat completions. Demo key: xfuel-demo.
- GET  /v1/models           : live catalog (Theta + Akash + xfuel/auto). Not OpenAI/Groq/Together.
- POST /v1/images/generations · POST /v1/audio/transcriptions (modality routes).
- Auth: "Authorization: Bearer <key>" or "X-API-Key: <key>".
- Point any OpenAI client's baseURL at this host + /v1. Receipt in x-xfuel-*
  headers and the "xfuel" body field (HMAC-signed; not an on-chain tx).
- proof_outcome may be pending on the chat body — poll GET /task-status.

## Paid door (USDC / x402)

- POST /task-request      : paid task. 402 without X-PAYMENT. Real USDC.
- Networks: Base mainnet (default, CDP facilitator) or Solana mainnet (PayAI).
  The 402 challenge lists both; your wallet picks the network.
- POST /task-quote        : forecast only (not an invoice).
- GET  /task-status       : status + proof outcome (also works for /v1 task ids).
- GET  /prove-result      : SP1 settlement proof when requested / above COGS gate.
- GET  /health            : status, demo limits, floats. Token buckets with null
  addresses are post-TGE, not live.
- GET  /stats             : public-safe usage.

## MCP

- npx xfuel-mcp  (stdio). First tool: chat_completions (= this /v1 path).
- submit_inference = POST /task-request (paid, 402 without a payer).
- pay_with_usdc is only listed if XFUEL_PAYER_PRIVATE_KEY is set.

## Discovery (x402 Bazaar)

- GET  /.well-known/x402  : paid resource is POST /task-request only. /v1 is not listed.

## SDK

- npm install xfuel-sdk — client.chatCompletions() is the free path.
- createMockPayer() is for a local mock facilitator only. This host rejects it.

## Docs

- Protocol map: AGENTS.md
- Agent Playbook: skills/AGENT_PLAYBOOK.md
- OpenAI gateway: docs/OPENAI_COMPATIBLE_GATEWAY.md
- Full REST API: docs/M2M_API.md
- Payments (x402): docs/payments-x402.md
`;

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
    // Garbage-collect stale buckets every 5 min. unref() so the timer never
    // keeps the process (or a test runner) alive on its own.
    this._gcTimer = setInterval(() => this._gc(), 5 * 60_000);
    if (typeof this._gcTimer.unref === 'function') this._gcTimer.unref();
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
 * The recovered address is checked against env `M2M_RELAYER_ADDRESSES`
 * (comma-separated, checksummed).
 */
const RELAYER_ADDRESSES = new Set(
  (process.env.M2M_RELAYER_ADDRESSES || '')
    .split(',')
    .map(a => a.trim().toLowerCase())
    .filter(Boolean)
);

// ─── Public Demo Mode ─────────────────────────────────────────────────────────
//
// Powers the hosted public-beta endpoint (api.xfuel.app). When
// M2M_DEMO_MODE=true, a single shared PUBLIC demo key is accepted so anything —
// the SDK, a plain OpenAI client — works out of the box. Demo requests get an
// aggressive per-IP dual window (per-minute + per-day) and the OpenAI gateway
// caps max_tokens (OPENAI_GATEWAY_MAX_TOKENS_CAP). Private keys in M2M_API_KEYS
// bypass the demo limits and use the normal limiter.
const DEMO_MODE         = process.env.M2M_DEMO_MODE === 'true';
const DEMO_API_KEY      = process.env.M2M_DEMO_API_KEY || 'xfuel-demo';
const DEMO_RATE_PER_MIN = parseInt(process.env.M2M_DEMO_RATE_PER_MIN, 10) || 15;
const DEMO_RATE_PER_DAY = parseInt(process.env.M2M_DEMO_RATE_PER_DAY, 10) || 150;

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
 * Pure fee calculation — mirrors calculate_task_fee() in main.rs.
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

  // Cost-plus and the Tier-2 thresholds are only solvent together; each looks
  // reasonable alone. Logged at error level rather than thrown — a pricing
  // combination should not take the gateway down, but it must not be quiet.
  checkPricingConfig(config.verifiedInference);

  // Payer ledger for rolling settlement. Same single-process JSON-on-disk model
  // as task-store — a restart must not forgive an invoice. The live flag stays
  // off until this persist path exists (ADR 0008).
  const payersDir = process.env.PAYERS_LEDGER_DIR
    || (config.taskStore?.dir ? path.join(config.taskStore.dir, '..', 'payers') : null);
  configureRollingLedger({
    dir: payersDir,
    persist: !!config.taskStore?.persist,
  });

  // AkashML publishes no capacity signal and serves all live inference, so
  // without this an outage there is discovered by failing a customer's call.
  // Opt-in (`PROVIDER_HEALTH_PROBE=true`) because it spends real money on
  // requests nobody asked for; passive observation runs regardless.
  startHealthProbes(() => getHubCatalog());

  // ── Proxy trust ──────────────────────────────────────────────────────────
  // Behind a TLS reverse proxy (Caddy/nginx), req.ip is the proxy's address
  // unless we trust the forwarded header. This is REQUIRED for correct per-IP
  // demo rate limiting — without it every demo user shares one IP bucket.
  // M2M_TRUST_PROXY: 'true' (trust all), a hop count, or a subnet string.
  const TRUST_PROXY = process.env.M2M_TRUST_PROXY;
  if (TRUST_PROXY) {
    app.set(
      'trust proxy',
      TRUST_PROXY === 'true' ? true : /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY,
    );
  }

  // ── Global middleware ────────────────────────────────────────────────────

  // Security headers (lightweight; avoids a helmet dependency). Hardens the
  // hosted public beta against MIME-sniffing, clickjacking and referrer leakage.
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  // ── CORS (opt-in) ──────────────────────────────────────────────────────────
  // Off by default. Set M2M_CORS_ORIGIN (e.g. '*' or a specific origin) to allow
  // browser-based agents / playgrounds to call the API (incl. the /v1 gateway).
  // Registered before body parsing so even 400/413/429 error responses carry
  // CORS headers and can be read by a browser client.
  const CORS_ORIGIN = process.env.M2M_CORS_ORIGIN;
  if (CORS_ORIGIN) {
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
      res.header('Vary', 'Origin');
      // v1 x402: X-PAYMENT, X-PAYMENT-NONCE; v2 x402: PAYMENT-SIGNATURE, PAYMENT-NONCE
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-PAYMENT, X-PAYMENT-NONCE, PAYMENT-SIGNATURE, PAYMENT-NONCE');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Expose-Headers', 'X-XFuel-Signature, x-xfuel-task-id, x-xfuel-provider, x-xfuel-compute-real, x-xfuel-payment-rail, x-xfuel-proof-status, x-xfuel-proof-url, x-xfuel-verify-url, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use(express.json({ limit: '1mb' }));

  // JSON body-parse errors → clean 4xx (otherwise they hit the 500 handler).
  // Malformed JSON = 400; oversized body (> 1mb limit above) = 413.
  app.use((err, _req, res, next) => {
    if (!err) return next();
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'Request body exceeds the 1mb limit.' });
    }
    return next(err);
  });

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

  // Demo key limiters: an aggressive per-IP dual window (minute + day). Only
  // consulted when a request presents the shared public demo key.
  const demoMinLimiter = new RateLimiter(60_000, DEMO_RATE_PER_MIN);
  const demoDayLimiter = new RateLimiter(24 * 60 * 60_000, DEMO_RATE_PER_DAY);

  function rateLimit(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    // Public demo key → strict per-IP minute + day windows.
    if (DEMO_MODE && apiKey && apiKey === DEMO_API_KEY) {
      const ipKey = `demo:${req.ip || 'anon'}`;
      const okMin = demoMinLimiter.allow(ipKey);
      const okDay = okMin && demoDayLimiter.allow(ipKey);
      const info = demoMinLimiter.info(ipKey);
      res.set('X-RateLimit-Limit', String(DEMO_RATE_PER_MIN));
      res.set('X-RateLimit-Remaining', String(info.remaining));
      res.set('X-RateLimit-Reset', String(Math.ceil(info.resetMs / 1000)));
      if (!okMin || !okDay) {
        const overInfo = okMin ? demoDayLimiter.info(ipKey) : info;
        res.set('Retry-After', Math.ceil(overInfo.resetMs / 1000).toString());
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: `Demo key limit reached (${DEMO_RATE_PER_MIN}/min, ${DEMO_RATE_PER_DAY}/day per IP). Use your own X-API-Key for higher limits.`,
          retryAfterMs: overInfo.resetMs,
        });
      }
      return next();
    }

    const key = apiKey || req.ip || 'anon';
    const allowed = rateLimiter.allow(key);
    const info = rateLimiter.info(key);
    res.set('X-RateLimit-Limit', String(rateLimiter.maxHits));
    res.set('X-RateLimit-Remaining', String(info.remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(info.resetMs / 1000)));
    if (!allowed) {
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

  function isAuthorised(req) {
    // Dev / open mode when no keys are configured
    if (AUTHORISED_KEYS.size === 0 && RELAYER_ADDRESSES.size === 0) return true;

    const apiKey = req.headers['x-api-key'];
    if (apiKey && AUTHORISED_KEYS.has(apiKey)) {
      req.authMethod = 'api_key';
      return true;
    }
    if (DEMO_MODE && apiKey && apiKey === DEMO_API_KEY) {
      req.authMethod = 'demo_key';
      req.isDemo = true;
      return true;
    }
    if (verifyRelayerSignature(req)) {
      req.authMethod = 'relayer_sig';
      return true;
    }
    return false;
  }

  function authenticate(req, res, next) {
    if (isAuthorised(req)) return next();
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Provide a valid X-API-Key header or X-Signature relayer authentication.',
    });
  }

  /** x402 v2 402 with PAYMENT-REQUIRED header (CDP Bazaar / validate require this). */
  function sendPaymentRequired(res, body, headers = {}) {
    const pr = headers['PAYMENT-REQUIRED']
      || Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
    res.set('PAYMENT-REQUIRED', pr);
    const exposed = res.get('Access-Control-Expose-Headers') || '';
    if (!/PAYMENT-REQUIRED/i.test(exposed)) {
      res.set('Access-Control-Expose-Headers', exposed
        ? `${exposed}, PAYMENT-REQUIRED`
        : 'PAYMENT-REQUIRED');
    }
    return res.status(402).json(body);
  }

  /** Public discovery 402 for CDP re-fetch / validate (no API key, never fulfills). */
  function publicTaskRequestChallenge(req) {
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
    const x = config.x402;
    const { body, headers } = buildPaymentChallenge({
      taskId: `x402-discovery-${req.id || Date.now()}`,
      maxAmountRequired: String(x.usdcPriceDefault || '10000'),
      network: x.network,
      payTo: x.payTo,
      baseUrl,
      // Dual-network (2026-08-22): include Solana accepts entry when solana.enabled.
      // Per Section 3.5 — mirrors runX402Handshake; fail closed when payTo missing.
      solana: x.solana?.enabled ? {
        enabled: true,
        payTo: x.solana.payTo,
        network: x.solana.network,
      } : undefined,
    });
    return { body, headers };
  }

  // Apply rate-limit + auth to API routes. /task-request is rate-limited but
  // NOT auth-gated: CDP Bazaar re-fetches the resource unauthenticated and
  // requires HTTP 402 (not 401). Fulfillment still requires a key below.
  app.use('/task-request',  rateLimit);
  app.use('/task-quote',    rateLimit, authenticate);
  app.use('/prove-result',  rateLimit, authenticate);
  app.use('/a2a-message',   rateLimit, authenticate);
  app.use('/a2a-settle-fair-exchange', rateLimit, authenticate);
  app.use('/task-status',   rateLimit, authenticate);
  app.use('/webhook',       rateLimit, authenticate);
  app.use('/erc8004/validate', rateLimit, authenticate);

  // GET /task-request — public x402 discovery probe (CDP validate uses GET or POST)
  app.get('/task-request', (req, res) => {
    const { body, headers } = publicTaskRequestChallenge(req);
    return sendPaymentRequired(res, body, headers);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /task-request — Submit an AI intent
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/task-request', async (req, res) => {
    // Check for payment header first — a CDP-native caller (Bankr, Bazaar) may
    // send PAYMENT-SIGNATURE or X-PAYMENT without an API key. If they have a
    // payment header, run the handshake; only return a discovery 402 if there
    // is no payment header AND no authorization. Per ADR 0008 rolling settlement:
    // keyed callers still get the fronted first call when no payment is present.
    const { header: paymentHeader } = extractPaymentHeader(req);
    const isAuth = isAuthorised(req);
    if (!isAuth && !paymentHeader) {
      // Unauthenticated + no payment header → discovery 402 (never free serve)
      const { body, headers } = publicTaskRequestChallenge(req);
      return sendPaymentRequired(res, body, headers);
    }

    // ════════════════════════════════════════════════════════════════════════
    // CRITICAL: Validate body BEFORE any payment settlement can run.
    //
    // Root cause of Bankr incident (2026-08-21): a CDP-native buyer sent
    // PAYMENT-SIGNATURE with an empty body. The gateway settled $0.01 USDC
    // before returning 400 validation_error. The fix: validation runs FIRST,
    // OUTSIDE the try block that contains settlement code, so an invalid body
    // returns 400 WITHOUT calling the facilitator settle endpoint.
    // ════════════════════════════════════════════════════════════════════════
    const validationErrors = validateTaskRequestBody(req.body || {});
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'validation_error', details: validationErrors });
    }

    try {
      const {
        message_type,       // required – one of MESSAGE_TYPES
        chain_id,           // required – destination chain (CHAIN_IDS)
        amount,             // required – gross task value (string)
        fee_bps,            // optional – override BPS (50-100), default 50
        sender,             // required – sender address / identifier
        model_id,           // optional – ML model hash (for INFERENCE_REQUEST)
        input_hash,         // optional – hash of input data
        input,              // optional – raw input/prompt; enables full 6-tier routing (M2M_USE_FULL_ROUTER)
        messages,           // optional – chat messages[]; enables full router (alt to input)
        tools,              // optional – OpenAI tool definitions, forwarded to the hub
        tool_choice,        // optional – 'auto' | 'none' | {type:'function',function:{name}}
        max_tokens,         // optional – output budget; the hub default is 500
        temperature,        // optional – sampling temperature
        output_hash,        // optional – hash of output (for COMPUTE_RESULT)
        theta_recipient,    // optional – Theta EVM address for settlement
        max_gpu_hours,      // optional – Akash GPU lease duration
        subnet_id,          // optional – Bittensor subnet UID (for TAO routing)
        ibc_channel,        // optional – explicit IBC channel override
        memo,               // optional – free-form memo
        proof_system,       // optional – inference proof system: 'sp1' | 'zkgpt' (Phase 1); default 'sp1'
        proof_tier,         // optional – requested assurance tier (Phase 4): signed|settlement|inference|tee|zk-spotcheck|zk-full
        callback_url,       // optional – per-task webhook; receives TaskSettled on completion
        callback_secret,    // optional – HMAC secret for this task's callback (else WEBHOOK_SECRET)
        parent_task_id,     // optional – prior task in a multi-hop / A2A receipt chain
        a2a_message_id,     // optional – link this task to an A2A message id
        correlation_id,     // optional – free-form swarm / session correlation
      } = req.body || {};

      // ── Payment rail (USDC via x402 default; legacy tfuel only if opted in) ─
      // Buyer settlement is USDC on Base (ADR 0002). TFUEL is not a buyer rail
      // for go-forward GTM — only when X402_FALLBACK_TFUEL or explicit rail.
      //
      // Rolling settlement (ADR 0008): charge the previous call's *measured*
      // cost-plus bill on this request. You pay for the last call; /task-quote
      // is a forecast of the next one.
      let paymentRail = config.x402?.defaultRail || 'usdc';
      let paymentRef = null;
      let settledAmount = null;
      let rollingMeta = null;
      let ceilingQuote = null;
      {
        const rail = resolveRail(req.body);
        if (rail === 'usdc' && config.x402.enabled) {
          if (rollingEnabled()) {
            const payerId = payerBucket(req, apiKeyHashFromReq(req));
            // Check both v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) headers.
            // PR 205 added PAYMENT-SIGNATURE support to the handshake, but rolling
            // hasPayment was still checking only X-PAYMENT — so a CDP-native buyer
            // looked like "no payment" and was fronted instead of settled.
            const hasPayment = !!paymentHeader;
            ceilingQuote = await quoteResolved(req.body);
            const decision = rollingDecision({
              payerId,
              hasPayment,
              ceiling: ceilingQuote.amount,
            });
            rollingMeta = { fronted: false, payerId, action: decision.action };

            if (decision.action === 'serve_free') {
              paymentRail = 'usdc';
              rollingMeta.fronted = true;
            } else {
              const handshakeTaskId = decision.pending?.taskId || `x402-${req.id}`;
              const handshakeAmount = decision.pending ? decision.amount : null;
              // Pass the public base URL for CDP Bazaar cataloging (absolute resource URLs)
              const handshakeBaseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
              const hs = await runX402Handshake(req, {
                taskId: handshakeTaskId,
                amount: handshakeAmount,
                baseUrl: handshakeBaseUrl,
              });
              if (hs.kind === 'challenge') {
                return sendPaymentRequired(res, hs.body);
              }
              if (hs.kind === 'settled') {
                if (decision.pending) {
                  const listener = getAIListener();
                  const owed = listener?.activeTasks?.get(decision.pending.taskId);
                  if (owed) {
                    applyPaymentToOwedTask(owed, {
                      paymentRef: hs.paymentRef,
                      settledAmount: hs.settledAmount,
                      protocolFeeBps: owed.feeBps || AI_TASK_FEE_BPS,
                    });
                    listener.activeTasks.set(owed.taskId, owed);
                  } else {
                    logger.warn(
                      { payerId, taskId: decision.pending.taskId, amount: hs.settledAmount },
                      'rolling-settlement: settled payment but owed task was gone',
                    );
                  }
                  markSettled(payerId);
                  paymentRail = 'usdc';
                  paymentRef = null;
                  settledAmount = null;
                  rollingMeta.fronted = true;
                  rollingMeta.settled_task_id = decision.pending.taskId;
                } else {
                  paymentRail = 'usdc';
                  paymentRef = hs.paymentRef;
                  settledAmount = hs.settledAmount;
                }
              } else {
                if (decision.pending) markSettleFailed(payerId, hs.reason);
                if (hs.reason === 'gateway_not_configured') {
                  return res.status(503).json({ error: 'x402_unavailable', reason: hs.reason });
                }
                if (config.x402.fallbackToTfuel) {
                  logger.warn({ reqId: req.id, reason: hs.reason }, 'x402 failed — legacy TFUEL fallback (opt-in)');
                  paymentRail = 'tfuel';
                  rollingMeta = null;
                } else {
                  return res.status(402).json({ error: 'payment_required', reason: hs.reason });
                }
              }
            }
          } else {
            // Pass the public base URL for CDP Bazaar cataloging (absolute resource URLs)
            const handshakeBaseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
            const decision = await runX402Handshake(req, { taskId: `x402-${req.id}`, baseUrl: handshakeBaseUrl });
            if (decision.kind === 'challenge') {
              return sendPaymentRequired(res, decision.body);
            }
            if (decision.kind === 'settled') {
              paymentRail = 'usdc';
              paymentRef = decision.paymentRef;
              settledAmount = decision.settledAmount || null;
            } else {
              if (decision.reason === 'gateway_not_configured') {
                return res.status(503).json({ error: 'x402_unavailable', reason: decision.reason });
              }
              if (config.x402.fallbackToTfuel) {
                logger.warn({ reqId: req.id, reason: decision.reason }, 'x402 failed — legacy TFUEL fallback (opt-in)');
                paymentRail = 'tfuel';
              } else {
                return res.status(402).json({ error: 'payment_required', reason: decision.reason });
              }
            }
          }
        } else if (rail === 'tfuel') {
          paymentRail = 'tfuel';
        }
      }

      // ── Authoritative gross ───────────────────────────────────────────
      // Gross is what was SETTLED, never what the caller declared. The buyer
      // authorizes against a bound 402 challenge, so the settled amount is the
      // only figure a receipt may attest — otherwise `amount` and the collected
      // payment are two independent numbers and a $0.01 payment can mint a $1.00
      // receipt. The declared `amount` remains authoritative only for rails with
      // no settlement to derive from (legacy TFUEL). See docs/KNOWN_ISSUES.md.
      //
      // A rolling-fronted call has not been paid yet: gross stays 0 until the
      // next request settles the measured bill onto this task_id.
      let grossAmount = String(amount);
      if (rollingMeta?.fronted) {
        grossAmount = '0';
      } else if (settledAmount) {
        if (settledAmount !== grossAmount) {
          logger.warn(
            { reqId: req.id, declared: grossAmount, settled: settledAmount },
            'task-request: declared amount diverges from settled x402 payment — '
            + 'receipt reports the settled amount',
          );
        }
        grossAmount = settledAmount;
      }

      // ── Provider float COGS gate (ADR 0005) ─────────────────────────────
      // Select/gate here, but burn AFTER inference against the provider that
      // actually served (see ai-listener reconcile). Burning preferred early
      // mis-attributes COGS when preferred_provider ≠ routed provider.
      const floatMgr = getFloatManager({
        floatsJson: config.providerFloats?.json,
        cogsBps: config.providerFloats?.cogsBps,
        defaultProvider: config.providerFloats?.defaultProvider,
        enforce: config.providerFloats?.enforce,
      }); // first call seeds singleton from config; burns persist in-process
      // Two different questions, and conflating them pinned every default
      // request to a hub it could not be served from. `requestedProvider` is
      // what the caller asked for and is the only thing allowed to steer
      // routing; the float default is a treasury choice about which COGS float
      // to debit, and must not decide where inference runs.
      const requestedProvider = req.body?.preferred_provider || req.body?.provider || null;
      const preferredProvider = requestedProvider
        || config.providerFloats?.defaultProvider
        || null;
      let estimatedCogs = null;
      try {
        const { body: priced, model } = await resolvePricingModel(req.body);
        const est = await estimateCogsFromRequest({
          modelId: model || priced?.model_id,
          promptTokens: promptTokensFor(priced),
          maxOutputTokens: quotedMaxOutputTokens(priced),
        });
        if (est.basis === 'estimated') estimatedCogs = est.amount;
      } catch {
        // Catalog down — selectForQuote falls back to bps of our price.
      }
      const usdcQuote = paymentRail === 'usdc'
        ? (settledAmount || ceilingQuote?.amount || await priceUSDCResolved(req.body) || grossAmount || config.x402?.usdcPriceDefault || '10000')
        : (grossAmount || '0');
      const floatPick = floatMgr.selectForQuote(usdcQuote, preferredProvider, { estimatedCogs });
      if (!floatPick.ok) {
        return res.status(503).json({
          error: 'provider_float_exhausted',
          reason: floatPick.reason,
          estimated_cogs: floatPick.estimated?.toString?.() || String(floatPick.estimated),
          note: 'Prepaid provider float cannot cover COGS. Refill from treasury (docs/PROVIDER_FLOAT_TREASURY.md).',
        });
      }
      // Pending COGS — filled in by reconcileAfterServe once a provider wins.
      const pendingCogs = {
        estimated: floatPick.estimated?.toString?.() || String(floatPick.estimated || '0'),
        // What the buyer actually pays, so the post-serve reconcile can compare it
        // to measured COGS and shout when a route is sold below cost.
        gross: String(usdcQuote || '0'),
        preferred_provider: preferredProvider,
        float_id: floatPick.float?.id || null,
        unconstrained: !!floatPick.unconstrained,
        soft: !!floatPick.soft,
      };

      // ── Fee calculation ───────────────────────────────────────────────

      const effectiveFeeBps = fee_bps || AI_TASK_FEE_BPS;
      const { feeAmount, netAmount, feeBps: appliedBps } =
        calculateTaskFee(grossAmount, effectiveFeeBps);

      // ── Build intent for ai-listener processing ───────────────────────

      const intent = {
        type:           message_type,
        sender,
        recipient:      theta_recipient || null,
        // Settled gross, not the caller's declaration — receipts, fee math, SP1
        // public values and assurance-tier floors all read this.
        amount:         grossAmount,
        denom:          chain_id === CHAIN_IDS.BITTENSOR ? 'vtao'
                          : chain_id === CHAIN_IDS.BASE ? 'usdc'
                          : 'uosmo',
        thetaRecipient: theta_recipient || null,
        modelId:        model_id || null,
        inputHash:      input_hash || null,
        input:          input || null, // raw prompt for full 6-tier router (optional; input_hash stays for privacy/proof)
        messages:       Array.isArray(messages) ? messages : null,
        // Tool definitions travel with the intent so the paid path can run the
        // same agent loop as /v1. They also decide how `xfuel/auto` resolves —
        // see requestShape() in hub-catalog.js.
        tools:          Array.isArray(tools) && tools.length ? tools : null,
        toolChoice:     tool_choice ?? null,
        // The quote already meters `max_tokens` (pricing.js), so not forwarding it
        // billed the caller's ceiling and then ran the adapter's own default.
        maxTokens:      max_tokens ?? null,
        temperature:    temperature ?? null,
        maxGpuHours:    max_gpu_hours || null,
        nonce:          null, // assigned by listener
        memo:           memo || null,
        chain:          chain_id,
        subnetId:       subnet_id || null,
        ibcChannel:     ibc_channel || null,
        outputHash:     output_hash || null,
        proofSystem:    proof_system || 'sp1', // Phase 1: 'sp1' | 'zkgpt' for inference
        proofTier:      proof_tier || null,    // Phase 4: requested assurance tier (signed|settlement|inference|tee|zk-spotcheck|zk-full)
        paymentRail,    // 'usdc' (x402) | legacy 'tfuel'
        paymentRef,     // x402 settlement ref (network:txRef) or null
        // Preferred compute provider (float id / hub) — float accounting.
        preferredProvider,
        // Caller's explicit hub choice, if any. Null means "route by model".
        requestedProvider,
        // Cost control: whether this request's API key may trigger a Tier-1 ZK
        // proof. When false, the task still settles + returns a signed receipt,
        // but the expensive SP1 proof is skipped (see prove-gate.js).
        proveAllowed:   proveAllowedForKey(req.headers['x-api-key']),
      };

      const meta = {
        chain:   chain_id,
        txHash:  `api-${req.id}`,
        height:  0,
        source:  'server.js',
        // Float attribution; actual provider + COGS filled after serve.
        preferredProvider,
        requestedProvider,
        provider: preferredProvider || null,
        pendingCogs,
        providerCogs: null,
        // Buyer attribution (hash only) for Private Spend /stats/me
        apiKeyHash: apiKeyHashFromReq(req),
        privateSpend: !!config.privateSpend?.enabled,
        privacyMode: config.privateSpend?.enabled ? 'vendor_blind' : null,
        // Multi-hop / A2A receipt lineage (Sprint 3)
        parentTaskId: parent_task_id || null,
        a2aMessageId: a2a_message_id || null,
        correlationId: correlation_id || null,
        rolling: rollingMeta,
        pricing: (!rollingMeta?.fronted && ceilingQuote) ? ceilingQuote : null,
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
        callbackUrl:    callback_url || null,
        callbackSecret: callback_secret || null,
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
        amount: grossAmount,
        feeAmount,
        netAmount,
        feeBps: appliedBps,
      }, 'Task request accepted');

      const verifyUrl = buildVerifyUrl(baseUrlFromReq(req, config.service.publicBaseUrl), effectiveTaskId);

      return res.status(202).json({
        task_id:       effectiveTaskId,
        status:        'accepted',
        message_type,
        chain_id,
        gross_amount:  grossAmount,
        fee_amount:    feeAmount,
        net_amount:    netAmount,
        fee_bps:       appliedBps,
        payment_rail:  paymentRail,
        payment_ref:   paymentRef,
        ...(rollingMeta ? {
          rolling: {
            this_call_billed_on: rollingMeta.fronted ? 'next_request' : 'this_request',
            pays_previous_task: rollingMeta.settled_task_id || null,
          },
        } : {}),
        // Canonical shareable proof link (public, no-auth). Same value as _links.receipt.
        verify_url:    verifyUrl,
        fee_info: {
          description: `${(appliedBps / 100).toFixed(1)}% protocol fee → USDC on Base (X402_PAY_TO / Splits v2; token-light, ADR 0001)`,
          collector:   process.env.X402_PAY_TO || 'X402_PAY_TO (protocol Safe / Splits v2)',
        },
        _links: {
          status:  `/task-status?task_id=${effectiveTaskId}`,
          proof:   `/prove-result?task_id=${effectiveTaskId}`,
          receipt: verifyUrl,   // public, no-auth, shareable
        },
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /task-request error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /task-quote — Price a task (USDC via x402). Includes float COGS status.
  // ═══════════════════════════════════════════════════════════════════════

  app.post('/task-quote', async (req, res) => {
    try {
      const { amount, preferred_provider, provider } = req.body || {};
      // The same engine that prices the 402 challenge, so the preview cannot
      // quote one pricing model while the challenge charges another. It also
      // resolves the alias, because `xfuel/auto` prices differently for agent
      // work than for a short completion.
      const quote = await quoteResolved(req.body);
      const usdcAmount = quote.amount;
      const floatMgr = getFloatManager({
        floatsJson: config.providerFloats?.json,
        cogsBps: config.providerFloats?.cogsBps,
        defaultProvider: config.providerFloats?.defaultProvider,
        enforce: config.providerFloats?.enforce,
      });
      const pref = preferred_provider || provider || floatMgr.defaultProvider || null;
      const floatPick = floatMgr.selectForQuote(usdcAmount, pref);
      return res.json({
        recommended: 'usdc',
        default_rail: config.x402.defaultRail || 'usdc',
        settlement_home: 'base',
        strategy: 'crypto-routing-machine',
        rails: {
          usdc: {
            rail: 'usdc',
            enabled: config.x402.enabled,
            asset: config.x402.asset,
            network: config.x402.network,
            decimals: 6,
            amount: usdcAmount,
            pay_to: config.x402.payTo,
            note: 'Buyer settlement: x402 USDC on Base. Submit /task-request with payment.rail="usdc".',
            // Show the working. A buyer who can see which inputs moved the price
            // can shrink the bill themselves — which is the point of the receipt.
            pricing: {
              basis: quote.basis,
              floor_applied: quote.floor_applied,
              prompt_tokens: quote.prompt_tokens,
              max_output_tokens: quote.max_output_tokens,
              rate_per_million: quote.rate,
              // Which model this price is for. `xfuel/auto` resolves differently
              // for agent work than for a short completion, and the two sit in
              // different rate-card rows, so the alias alone does not explain the
              // number.
              requested_model: quote.requested_model,
              priced_model: quote.priced_model,
              // Under cost-plus the buyer can rebuild the figure: rate_per_million
              // is the provider's, and the receipt signs the measured COGS to
              // check it against once the work has run.
              ...(quote.basis === 'cost_plus' ? {
                provider_cogs: quote.provider_cogs,
                platform_fee: quote.platform_fee,
                fee_bps: quote.fee_bps,
                ...(quote.tier2_proof && quote.tier2_proof !== '0'
                  ? { tier2_proof: quote.tier2_proof }
                  : {}),
              } : {}),
              note: quoteNote(quote),
            },
          },
          // Legacy buyer rail — not go-forward GTM. Prefer USDC; provider TFUEL is ops float only.
          tfuel: {
            rail: 'tfuel',
            legacy: true,
            deprecated: true,
            amount: amount || null,
            note: 'Legacy optional buyer rail only. Do not use for new integrations — provider TFUEL is prepaid float COGS, not settlement home (ADR 0002 / 0005).',
          },
        },
        provider_cogs: {
          estimated: floatPick.estimated?.toString?.() || String(floatPick.estimated),
          cogs_bps: floatMgr.cogsBps,
          float_ok: !!floatPick.ok,
          selected_provider: floatPick.float?.id || pref || null,
          soft: !!floatPick.soft,
          unconstrained: !!floatPick.unconstrained,
        },
        provider_floats: floatMgr.publicSummary(),
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /task-quote error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  /** Explain the number in the terms of the model that produced it. */
  function quoteNote(quote) {
    if (quote.basis === 'cost_plus') {
      const pct = (Number(quote.fee_bps || 0) / 100).toFixed(2).replace(/\.?0+$/, '');
      return `Provider cost plus ${pct}%. rate_per_million is the provider's own rate, `
        + 'not ours; provider_cogs is that rate applied to the prompt and the max_tokens '
        + 'ceiling. The receipt signs the measured COGS, so this is checkable after the '
        + 'fact. Lowering max_tokens lowers the quote.';
    }
    if (quote.basis === 'model_price') return 'Flat per-model price.';
    return 'Metered on prompt size + the max_tokens ceiling, with a floor. Output is quoted '
      + 'at the ceiling because the x402 exact scheme prices before the work runs; lowering '
      + 'max_tokens lowers the quote.';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /erc8004/validate — Turn an XFuel receipt into an ERC-8004 validation
  //   verdict. XFuel is a *validator*: an agent opens a validationRequest naming
  //   the XFuel validator address; this endpoint returns the ready-to-submit
  //   validationResponse (score + evidence + calldata). Non-custodial by default;
  //   set ERC8004_AUTO_SUBMIT=true (+ submitter key + adapter) to push on-chain.
  // ═══════════════════════════════════════════════════════════════════════

  const ERC8004_ADAPTER_ABI = [
    'function submitValidation(bytes32 requestHash, uint256 agentId, uint8 response, string responseURI, bytes32 responseHash, string tag, bytes32 taskIdHash) external',
  ];

  app.post('/erc8004/validate', async (req, res) => {
    try {
      const { task_id, request_hash, agent_id } = req.body || {};
      if (!task_id || !request_hash || agent_id === undefined || agent_id === null) {
        return res.status(400).json({
          error: 'validation_error',
          message: 'task_id, request_hash, and agent_id are required',
        });
      }

      const aiListener = getAIListener();
      const task = _findTask(aiListener, task_id);
      if (!task) {
        return res.status(404).json({ error: 'not_found', message: `Task ${task_id} not found` });
      }

      const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
      const receipt = buildReceipt(task, {
        baseUrl,
        signingSecret: config.receipts?.signingSecret,
        viPolicy: config.verifiedInference,
      });

      let record;
      try {
        record = buildValidationRecord(receipt, { requestHash: request_hash, agentId: agent_id });
      } catch (e) {
        return res.status(400).json({ error: 'validation_error', message: e.message });
      }

      if (!record.eligible) {
        return res.status(409).json({ error: 'not_validatable', message: record.reason, validation: record });
      }

      const validatorAddress = config.erc8004.validatorAddress;
      const adapterAddress = config.erc8004.adapterAddress;

      // Ready-to-submit call (adapter path): the agent/operator or XFuel can broadcast this.
      let submit = null;
      if (adapterAddress) {
        const iface = new ethers.Interface(ERC8004_ADAPTER_ABI);
        submit = {
          to: adapterAddress,
          method: 'submitValidation',
          args: [
            record.request_hash, record.agent_id, record.response,
            record.response_uri || '', record.response_hash, record.tag, record.task_id_hash,
          ],
          data: iface.encodeFunctionData('submitValidation', [
            record.request_hash, record.agent_id, record.response,
            record.response_uri || '', record.response_hash, record.tag, record.task_id_hash,
          ]),
        };
      }

      // Optional: XFuel pushes the verdict on-chain itself (custodial submitter key).
      let submitted = null;
      if (config.erc8004.autoSubmit && config.erc8004.submitterKey && adapterAddress && config.erc8004.rpcUrl) {
        try {
          const provider = new ethers.JsonRpcProvider(config.erc8004.rpcUrl);
          const wallet = new ethers.Wallet(config.erc8004.submitterKey, provider);
          const adapter = new ethers.Contract(adapterAddress, ERC8004_ADAPTER_ABI, wallet);
          const tx = await adapter.submitValidation(
            record.request_hash, record.agent_id, record.response,
            record.response_uri || '', record.response_hash, record.tag, record.task_id_hash,
          );
          submitted = { tx_hash: tx.hash };
        } catch (e) {
          logger.error({ err: e, reqId: req.id }, 'ERC-8004 auto-submit failed');
          submitted = { error: e.message };
        }
      }

      return res.json({
        validation: record,
        validator_address: validatorAddress,
        registry_address: config.erc8004.registryAddress,
        adapter_address: adapterAddress,
        submit,
        submitted,
        note: 'ERC-8004 score: 0=failed, 100=passed. The tag conveys the XFuel assurance tier. ' +
          'Submit `submit.data` from the XFuel validator address (or SUBMITTER_ROLE on the adapter).',
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /erc8004/validate error');
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
        proof_outcome:  proofOutcomeOf(task),
        verify_url:     buildVerifyUrl(baseUrlFromReq(req, config.service.publicBaseUrl), task.taskId),
        sp1_proof:      task.sp1Proof || null,
        // Phase 2 (flag-gated): x402 payment commitment bound into the proof.
        payment_binding: task.sp1Proof?.paymentBinding || null,
        fee: {
          gross_amount:  task.intent?.amount || '0',
          fee_amount:    task.feeAmount || feeAmount,
          net_amount:    netAmount,
          fee_bps:       feeBps,
          fee_collector: process.env.X402_PAY_TO || config.osmosis?.feeCollectorContract || '(not configured)',
          revenue_split: describeSplit(resolveSplit()),
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
        parent_task_id,     // optional – prior inference task in a receipt chain
        correlation_id,     // optional – swarm / session correlation
      } = req.body || {};

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
      // (mirrors _validate_escrow_for_msg_type in main.rs)
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

      // ── A2A relay fee (0.1% on escrow) ─────

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
        parentTaskId:    parent_task_id || null,
        correlationId:   correlation_id || null,
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
        relay_fee_info:  '0.1% on escrowed amount → USDC on Base (X402_PAY_TO / Splits v2)',
        nonce,
        ttl,
        timestamp:       a2aMessage.timestamp,
        parent_task_id:  parent_task_id || null,
        correlation_id:  correlation_id || null,
        _links: {
          status: `/task-status?message_id=${messageId}`,
        },
        next: {
          hint: 'Link a follow-on inference with parent_task_id + a2a_message_id on /task-request',
          a2a_message_id: messageId,
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
      const { bid_id, result_hash, v, r, s } = req.body || {};

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

        const proofOutcome = proofOutcomeOf(task);

        return res.json({
          task_id:        task.taskId,
          status:         task.status,
          proof_outcome:  proofOutcome,
          verify_url:     buildVerifyUrl(baseUrlFromReq(req, config.service.publicBaseUrl), task.taskId),
          proof_system:   task.intent?.proofSystem || 'sp1', // 'sp1' | 'zkgpt' — which prover ran; proof data is in sp1_proof for both
          message_type:   task.intent?.type,
          chain_id:       task.meta?.chain,
          gross_amount:   task.intent?.amount || '0',
          fee_amount:     task.feeAmount || '0',
          net_amount:     task.netAmount || '0',
          fee_bps:        task.feeBps || AI_TASK_FEE_BPS,
          payment_rail:   task.intent?.paymentRail || 'usdc',
          payment_ref:    task.intent?.paymentRef || null,
          // Phase 2 (flag-gated): x402 payment commitment bound into the proof.
          payment_binding: task.sp1Proof?.paymentBinding || null,
          result:         task.result || null,
          // A failed task used to return status:'failed' and nothing else, so a
          // caller could not tell an unknown model from an upstream outage.
          error:          task.error || null,
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
  // GET /receipt/:taskId — PUBLIC, no-auth verifiable receipt.
  //   • HTML by default (clean, shareable page for a browser / link unfurl)
  //   • JSON via `?format=json` or `Accept: application/json` (for agents)
  //   • Auditor selective disclosure via `?format=auditor` (policy + totals; no prompts)
  // Rate-limited (per-IP) but intentionally NOT behind authenticate — the whole
  // point is that anyone can independently verify "paid + proven". It exposes no
  // secrets (no proof bytes, no raw output, no keys) — see src/receipt.js.

  app.get('/receipt/:taskId', rateLimit, (req, res) => {
    try {
      const { taskId } = req.params;
      const aiListener = getAIListener();
      const task = _findTask(aiListener, taskId);
      const fmt = String(req.query.format || '').toLowerCase();
      const wantsAuditor = fmt === 'auditor' || fmt === 'audit';
      const wantsJson = wantsAuditor
        || fmt === 'json'
        || req.accepts(['html', 'json']) === 'json';

      if (!task) {
        if (wantsJson) {
          return res.status(404).json({ error: 'not_found', message: `Task ${taskId} not found`, task_id: taskId });
        }
        return res.status(404).type('html').send(renderReceiptNotFound(taskId));
      }

      const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
      const receipt = buildReceipt(task, {
        baseUrl,
        signingSecret: config.receipts?.signingSecret,
        viPolicy: config.verifiedInference,
      });

      if (wantsAuditor) {
        let policy = null;
        if (process.env.AUDITOR_POLICY_JSON) {
          try { policy = JSON.parse(process.env.AUDITOR_POLICY_JSON); } catch { /* use default */ }
        }
        const exportDoc = buildAuditorExport(receipt, { policy });
        if (String(req.query.view || '') === 'html') {
          return res.type('html').send(renderAuditorHtml(exportDoc));
        }
        return res.json(exportDoc);
      }

      if (wantsJson) return res.json(receipt);
      return res.type('html').send(renderReceiptHtml(receipt));
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /receipt error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /webhook — Register (or update) a webhook for settlement events
  // GET /webhook — List registered webhooks
  // DELETE /webhook — Remove a webhook by id or url
  // ═══════════════════════════════════════════════════════════════════════

  const webhooks = getWebhookRegistry();

  app.put('/webhook', (req, res) => {
    try {
      const { url, secret, events } = req.body || {};
      const hook = webhooks.register({ url, secret, events });
      logger.info({ reqId: req.id, id: hook.id, url: hook.url, events: hook.events }, 'Webhook registered');
      return res.status(200).json({
        status: 'registered',
        webhook: hook,
        supported_events: Object.values(WEBHOOK_EVENTS),
        signature_info: 'Deliveries include X-XFuel-Signature: sha256=<hmac> when a secret is set.',
      });
    } catch (err) {
      return res.status(400).json({ error: 'validation_error', message: err.message });
    }
  });

  app.get('/webhook', (_req, res) => {
    return res.json({ webhooks: webhooks.list(), supported_events: Object.values(WEBHOOK_EVENTS) });
  });

  app.delete('/webhook', (req, res) => {
    const id = req.query.id || req.body?.id;
    const url = req.query.url || req.body?.url;
    if (!id && !url) {
      return res.status(400).json({ error: 'validation_error', message: 'Provide id or url to delete' });
    }
    const removed = id ? webhooks.remove(id) : webhooks.removeByUrl(url);
    if (!removed) {
      return res.status(404).json({ error: 'not_found', message: 'No matching webhook' });
    }
    return res.json({ status: 'removed', webhook: removed });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /llms.txt — Agent-discoverability manifest (public, no auth)
  // Convention: https://llmstxt.org/ — a concise map for LLMs/agents.
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/llms.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8').send(LLMS_TXT);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /.well-known/x402 — x402 Bazaar discovery manifest (public, no auth)
  // Self-describes XFuel's USDC/x402-payable resource(s) in the bazaar shape so
  // agents, crawlers, and Bazaar tooling can discover + price XFuel with no
  // XFuel-specific integration. See docs/DISTRIBUTION.md and src/x402-discovery.js.
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/.well-known/x402', rateLimit, (req, res) => {
    try {
      const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
      res.json(buildX402Manifest(baseUrl));
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /.well-known/x402 error');
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

      // Not awaited: the result lands in time for a later call. See prove-gate.js.
      refreshProverProbe(getSP1Prover());

      return res.json({
        status:      'ok',
        server:      'xfuel-m2m-api',
        version:     '1.0.0',
        timestamp:   new Date().toISOString(),
        uptime_s:    Math.floor(process.uptime()),
        a2a_messages_total: _a2aMessages.size,
        webhooks_registered: getWebhookRegistry().list().length,
        ai_listener: aiStatus,
        // Whether Tier-2 proofs are actually being produced right now. The prover
        // is scaled to zero when idle to control cost, and that has to be legible
        // to a partner without asking us. The probe runs in the background and
        // this reports its last result, so a dead prover never slows /health.
        proofs: proofAvailability(!!getSP1Prover(), { tier2: tier2Gate() }),
        // Tier-1 is the whole product, and it degrades *silently*: with no signing
        // secret the receipt still renders and still looks authoritative, it just
        // carries no signature. Report it so a missed env var is visible from
        // outside instead of being discovered by a partner trying to verify.
        receipts: {
          tier1_signed: !!config.receipts?.signingSecret,
          ...(config.receipts?.signingSecret ? {} : {
            warning: 'RECEIPT_SIGNING_SECRET is not set — receipts are UNSIGNED and cannot be verified.',
          }),
        },
        // What the unmetered surface is costing us today. Receipts are free by
        // policy (ADR 0006); the compute behind them is not, and that subsidy was
        // previously neither capped nor measured anywhere.
        free_tier: freeTierStatus(),
        // Which models are actually serving. Theta's worker counts come free with
        // the catalogue poll; AkashML publishes nothing, so its half is observed
        // traffic plus the opt-in prober.
        provider_health: healthSnapshot(),
        // Money we have served COGS for and not yet collected. Under rolling
        // settlement (ADR 0008) every charge lands one call late, so a climbing
        // figure here means settlement is failing, not that traffic is growing.
        rolling_settlement: rollingStatus(),
        fee_config: {
          default_bps:    AI_TASK_FEE_BPS,
          min_bps:        MIN_FEE_BPS,
          max_bps:        MAX_FEE_BPS,
          min_task_amount: MIN_TASK_AMOUNT,
          a2a_relay_bps:  10,
          revenue_split:  describeSplit(resolveSplit()),
        },
        // ADR 0005 fingerprint — prepaid float COGS (buyer rail remains USDC).
        provider_floats: getFloatManager({
          floatsJson: config.providerFloats?.json,
          cogsBps: config.providerFloats?.cogsBps,
          defaultProvider: config.providerFloats?.defaultProvider,
          enforce: config.providerFloats?.enforce,
        }).publicSummary(), // ADR 0005 fingerprint
        chains: advertisedChains(),
        message_types: Object.values(MESSAGE_TYPES),
        demo: DEMO_MODE
          ? { enabled: true, rate_per_min: DEMO_RATE_PER_MIN, rate_per_day: DEMO_RATE_PER_DAY, note: 'Public demo key is rate-limited per IP. Bring your own X-API-Key for higher limits.' }
          : { enabled: false },
      });
    } catch (err) {
      return res.status(503).json({ status: 'error', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /stats — Aggregate, public-safe usage telemetry + tiny dashboard
  // Derived from the durable task snapshots, so numbers survive restarts and
  // reflect real historical activity. HTML by default (shareable dashboard),
  // JSON with ?format=json (or Accept: application/json). No secrets, no PII.
  // Short in-memory cache bounds disk IO. Public, rate-limited. See telemetry.js.
  // ═══════════════════════════════════════════════════════════════════════

  let _statsCache = { at: 0, data: null };
  const STATS_TTL_MS = 15_000;

  app.get('/stats', rateLimit, (req, res) => {
    try {
      const wantsJson =
        req.query.format === 'json' ||
        (req.headers.accept || '').includes('application/json');

      const now = Date.now();
      if (!_statsCache.data || now - _statsCache.at > STATS_TTL_MS) {
        let tasks = [];
        try {
          const store = getAIListener().activeTasks;
          tasks = typeof store.allSnapshots === 'function'
            ? store.allSnapshots()
            : [...store.values()];
        } catch { /* listener not initialised — report zeros */ }
        _statsCache = { at: now, data: computeUsageStats(tasks, { now }) };
      }

      if (wantsJson) return res.json(_statsCache.data);
      return res.type('html').send(renderStatsHtml(_statsCache.data));
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /stats error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // Buyer-only usage (Private Spend). Auth required — filters by apiKeyHash stamped on tasks.
  // Never returns other buyers' data. JSON only.
  app.get('/stats/me', rateLimit, authenticate, (req, res) => {
    try {
      const apiKeyHash = apiKeyHashFromReq(req);
      if (!apiKeyHash) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'X-API-Key or Authorization: Bearer required for buyer stats',
        });
      }
      let tasks = [];
      try {
        const store = getAIListener().activeTasks;
        tasks = typeof store.allSnapshots === 'function'
          ? store.allSnapshots()
          : [...store.values()];
      } catch { /* empty */ }
      const data = computeUsageStats(tasks, { now: Date.now(), apiKeyHash });
      data.private_spend = {
        enabled: !!config.privateSpend?.enabled,
        mode: config.privateSpend?.enabled ? 'vendor_blind' : null,
        trust: 'gateway',
      };
      return res.json(data);
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'GET /stats/me error');
      return res.status(500).json({ error: 'internal', message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OpenAI-compatible gateway (/v1/models, /v1/chat/completions)
  // Drop-in surface: point any OpenAI-compatible client's baseURL here.
  // Shares the rate-limit + auth middleware (accepts Authorization: Bearer).
  // ═══════════════════════════════════════════════════════════════════════

  registerOpenAIRoutes(app, { rateLimit, authenticate });

  // ── 404 fallback ────────────────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: 'Unknown endpoint. Available: POST /task-request, POST /task-quote, GET /prove-result, POST /a2a-message, POST /a2a-settle-fair-exchange, POST /erc8004/validate, GET /task-status, GET /receipt/:taskId, PUT|GET|DELETE /webhook, GET /health, GET /stats, GET /stats/me, GET /llms.txt, GET /.well-known/x402, GET /v1/models, GET /v1/models/:id, POST /v1/chat/completions, POST /v1/images/generations, POST /v1/audio/transcriptions',
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

  // Initialise the SP1 prover so /task-request tasks get settlement proofs.
  // Non-fatal + skipped when SP1_PROVER_URL/ZAN_PROVER_URL are unset (zkGPT-only
  // or proofless dev). The bridge entrypoint (index.js) inits its own instance.
  if (!getSP1Prover()) {
    try {
      await initSP1Prover();
    } catch (err) {
      logger.warn({ err }, 'SP1 prover init skipped (proofs disabled for M2M tasks)');
    }
  }

  const app = createApp();

  // Start the webhook dispatcher: watches activeTasks for terminal states
  // and delivers signed TaskSettled events to subscribers + per-task callbacks.
  try {
    const dispatcher = new WebhookDispatcher(getWebhookRegistry(), getAIListener());
    dispatcher.start();
  } catch (err) {
    logger.warn({ err }, 'Webhook dispatcher not started (AI listener unavailable)');
  }

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info({ port }, 'XFuel M2M API server started');

      if (AUTHORISED_KEYS.size === 0 && RELAYER_ADDRESSES.size === 0) {
        logger.warn(
          'M2M API is running in OPEN MODE (no M2M_API_KEYS or M2M_RELAYER_ADDRESSES configured). ' +
          'Set these env vars in production!'
        );
      }

      // Tier-1 signed receipts are the product. Missing the secret does not fail
      // anything loudly — receipts just come out unsigned, look complete, and fail
      // verification at the partner's end. Say so at boot.
      if (!config.receipts?.signingSecret) {
        logger.warn(
          'RECEIPT_SIGNING_SECRET is not set — receipts will be UNSIGNED. Tier-1 verifiability is ' +
          'off, and /receipt output cannot be verified by the SDK. Set it before serving partners.',
        );
      }

      resolve(server);
    });

    // Graceful shutdown: stop accepting new connections and drain in-flight
    // requests before exiting. Process managers (systemd/Docker) send SIGTERM;
    // Ctrl-C sends SIGINT. Force-exit after a timeout so we never hang a deploy.
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'Shutting down M2M API server…');
      // Flush any in-place task mutations to disk so the public verify_url receipt
      // reflects the latest state after a restart (best-effort; safe if unsupported).
      try {
        getAIListener()?.activeTasks?.flushAll?.();
      } catch (err) {
        logger.warn({ err: err.message }, 'task-store flush on shutdown failed');
      }
      const forceExit = setTimeout(() => {
        logger.warn('Forced shutdown after 10s drain timeout');
        process.exit(1);
      }, 10_000);
      if (typeof forceExit.unref === 'function') forceExit.unref();
      server.close((err) => {
        if (err) {
          logger.error({ err }, 'Error during server close');
          process.exit(1);
        }
        logger.info('HTTP server closed cleanly');
        process.exit(0);
      });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
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
