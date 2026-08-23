import crypto from 'crypto';
import logger from './logger.js';
import {
  verifyViaFacilitator,
  settleViaFacilitator,
  defaultFacilitatorUrlForNetwork,
  toCaip2Network,
  fromCaip2Network,
  usdcFor,
  isSolanaNetwork,
  isEvmNetwork,
  PAYAI_FACILITATOR_URL,
  PAYAI_DEFAULT_FEE_PAYER,
  SOLANA_NETWORKS,
} from './x402-facilitator.js';

export { toCaip2Network, fromCaip2Network, usdcFor, isSolanaNetwork, isEvmNetwork };

// ─── CDP Bazaar Discovery Extension ──────────────────────────────────────────
// Per https://docs.x402.org/extensions/bazaar: the bazaar extension makes a
// resource discoverable via CDP Bazaar / facilitator `/discovery/resources`.
// Cataloging requires:
//   1. Server advertises a spec-conformant bazaar extension on the 402
//   2. A paying client echoes that extension in the PaymentPayload
//   3. One successful settlement through the CDP Facilitator
//
// This file handles step 1 and persists the extension on the bound challenge
// so x402-facilitator.js can echo it on settle (step 2) even if the buyer
// SDK omits it. See docs/X402_ADAPTER.md.

/** Bazaar extension key per spec */
export const BAZAAR_EXTENSION_KEY = 'bazaar';

/** Example POST /task-request body advertised to Bazaar buyers (EVM/Base). */
export const TASK_REQUEST_BODY_EXAMPLE = {
  message_type: 'inference_request',
  chain_id: 'base',
  sender: '0xYourWalletAddress',
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 500,
  payment: { rail: 'usdc' },
};

/** Example POST /task-request body advertised to Solana/PayAI buyers. */
export const TASK_REQUEST_BODY_EXAMPLE_SOLANA = {
  message_type: 'inference_request',
  chain_id: 'base',  // Routing chain; payment network is separate (Solana)
  sender: 'YourSolanaWalletPubkey',  // Base58 Solana address
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 500,
  payment: { rail: 'usdc' },
};

/** JSON Schema for that body — lives on bazaar.schema, not on info.input. */
const TASK_REQUEST_BODY_SCHEMA = {
  type: 'object',
  properties: {
    message_type: {
      type: 'string',
      enum: ['inference_request'],
      description: 'Task type; only inference_request is supported via x402',
    },
    chain_id: {
      type: 'string',
      description: 'Settlement chain; "base" for USDC settlement',
    },
    amount: {
      type: 'string',
      description: 'Gross task value in USDC base units (6 decimals); min 10000 ($0.01)',
    },
    sender: {
      type: 'string',
      description: '0x address that owns/pays for the task',
    },
    model_id: {
      type: 'string',
      description: 'Model id from GET /v1/models; xfuel/auto routes automatically',
    },
    input_hash: {
      type: 'string',
      description: 'keccak256 of your input (optional; for proof binding)',
    },
    messages: {
      type: 'array',
      description: 'OpenAI-style chat messages array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
        required: ['role', 'content'],
      },
    },
    max_tokens: {
      type: 'integer',
      description: 'Output token budget (default 500)',
    },
    payment: {
      type: 'object',
      properties: {
        rail: { type: 'string', enum: ['usdc'], description: 'Payment rail; use "usdc"' },
      },
    },
  },
  required: ['message_type', 'chain_id', 'sender'],
};

const TASK_REQUEST_OUTPUT_EXAMPLE = {
  task_id: 'ai-task-12345',
  status: 'accepted',
  payment_rail: 'usdc',
  payment_ref: 'base:0x...',
  verify_url: 'https://api.xfuel.app/receipt/ai-task-12345',
  gross_amount: '50000',
  fee_amount: '250',
  net_amount: '49750',
};

/**
 * Build the bazaar discovery extension for XFuel's /task-request resource.
 *
 * Shape matches `@x402/extensions` `declareDiscoveryExtension({ method:'POST',
 * bodyType:'json', input, output })`: `info.input` is `{ type, method, bodyType,
 * body }` and a Draft 2020-12 `schema` validates that `info`. CDP rejects
 * declarations that put `inputSchema` on `info.input` (additionalProperties:
 * false) or omit `schema` entirely.
 *
 * @param {Object} opts
 * @param {string} [opts.method='POST']  HTTP method
 * @param {Object} [opts.exampleBody]    Custom example body (default: TASK_REQUEST_BODY_EXAMPLE)
 * @returns {Object} extensions object to spread into the 402 accepts entry
 */
export function buildBazaarExtension(opts = {}) {
  const method = opts.method || 'POST';
  const exampleBody = opts.exampleBody || TASK_REQUEST_BODY_EXAMPLE;

  return {
    [BAZAAR_EXTENSION_KEY]: {
      info: {
        input: {
          type: 'http',
          method,
          bodyType: 'json',
          body: exampleBody,
        },
        output: {
          type: 'json',
          example: TASK_REQUEST_OUTPUT_EXAMPLE,
        },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
              bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
              body: TASK_REQUEST_BODY_SCHEMA,
            },
            required: ['type', 'method', 'bodyType', 'body'],
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              example: { type: 'object' },
            },
            required: ['type'],
          },
        },
        required: ['input'],
      },
    },
  };
}

/** v1 discovery fallback: PaymentRequirements.outputSchema = bazaar info. */
export function v1OutputSchemaFromBazaar(extensions) {
  const info = extensions?.[BAZAAR_EXTENSION_KEY]?.info;
  if (!info?.input) return undefined;
  return { input: info.input, output: info.output };
}

/**
 * XFuel ⇄ ZAN x402 adapter.
 *
 * x402 is an agent-native payment protocol (machine-parseable HTTP 402
 * challenges, USDC settlement on Base/Solana, wallet-as-identity). This adapter
 * lets XFuel expose tasks as x402-priced resources so any x402-speaking agent
 * can pay in USDC, then maps a verified+settled payment to an XFuel task /
 * A2A settlement.
 *
 * Payment-rail strategy: USDC via x402 on Base is the DEFAULT (and go-forward)
 * buyer rail. Legacy TFUEL buyer fallback is opt-in only (X402_FALLBACK_TFUEL).
 * Provider TFUEL/ACT are prepaid float COGS (ADR 0005) — not settlement home.
 *
 * Settlement model: USDC lands in a Base treasury (X402_PAY_TO / Splits v2).
 * The payer is the AGENT's wallet (agent-side, pluggable); this module never
 * holds keys. See docs/STRATEGY.md · docs/PROVIDER_FLOAT_TREASURY.md.
 *
 * Status: adapter hardened (challenge binding, nonce/replay store, verify+settle,
 * pricing). Two facilitator protocols are supported via X402_FACILITATOR_PROVIDER:
 *   - 'x402' → the STANDARD x402 facilitator (e.g. Coinbase's public Base Sepolia
 *     reference at https://x402.org/facilitator, no API key) — see x402-facilitator.js.
 *   - 'zan'  → the bespoke ZAN gateway (default; also the shape the mock speaks).
 * Gated behind X402_ENABLED at the server layer.
 *
 * Env:
 *   X402_ENABLED=true
 *   X402_DEFAULT_RAIL=usdc|tfuel        (server default rail; default usdc)
 *   X402_FALLBACK_TFUEL=true            (usdc unavailable → fall back vs 503)
 *   X402_FACILITATOR_PROVIDER=x402|zan  (which facilitator protocol to speak)
 *   X402_FACILITATOR_URL=https://...    (standard facilitator; default public ref)
 *   X402_FACILITATOR_API_KEY=...        (optional; not needed for the public testnet)
 *   ZAN_X402_GATEWAY_URL=https://...    (ZAN facilitator; verify + settle)
 *   ZAN_X402_API_KEY=...
 *   X402_PAY_TO=0x...                   (Base USDC treasury)
 *   X402_NETWORK=base                   (base | solana)
 *   X402_ASSET=USDC
 *   X402_CHALLENGE_TTL_MS=120000
 *   X402_USDC_PRICE_DEFAULT=10000       (smallest unit, USDC 6dp; 10000 = $0.01)
 *   X402_USDC_PRICES={"llama-3-70b":"50000"}   (JSON model→price override)
 */

const DEFAULT_TTL_MS = parseInt(process.env.X402_CHALLENGE_TTL_MS, 10) || 120000;

export function isX402Enabled() {
  return process.env.X402_ENABLED === 'true';
}

/** Server default rail: "usdc" (default, Base) | "tfuel" (optional legacy). */
export function defaultRail() {
  const r = (process.env.X402_DEFAULT_RAIL || 'usdc').toLowerCase();
  return r === 'tfuel' ? 'tfuel' : 'usdc';
}

/** Whether to fall back to TFUEL when USDC/x402 is requested but unavailable. */
export function fallbackToTfuel() {
  return process.env.X402_FALLBACK_TFUEL === 'true';
}

// ─── Challenge + replay store ───────────────────────────────────────────────
// Binds an issued 402 challenge (nonce) to its amount/asset/network/resource so
// verify/settle can reject amount tampering, expired challenges, and replays.
// In-memory by design for Phase 0 (single-process); swap for Redis when the
// server path scales horizontally.

/**
 * Normalize a nonce for store lookups. After 2026-08-21 challenges emit 0x-prefixed
 * bytes32 nonces; older in-flight challenges may still have raw hex. Accept both.
 * @param {string|null} nonce
 * @returns {string[]} - Array of possible keys: [normalized, alternateForm] or [nonce] if no normalization needed
 */
function nonceVariants(nonce) {
  if (!nonce || typeof nonce !== 'string') return [];
  const trimmed = nonce.trim();
  // If it has 0x prefix, also try without
  if (trimmed.startsWith('0x')) {
    return [trimmed, trimmed.slice(2)];
  }
  // If no 0x prefix, also try with 0x prefix (padded to 64 hex chars for old short nonces)
  return [trimmed, '0x' + trimmed.padStart(64, '0')];
}

export class ChallengeStore {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map();   // nonce → { taskId, amount, asset, network, payTo, resource, expiresAt }
    this.spent = new Set(); // nonce (or txRef) already settled → replay protection
  }

  put(nonce, data) {
    this._gc();
    this.map.set(nonce, { ...data, nonce, expiresAt: Date.now() + this.ttlMs });
    return this.map.get(nonce);
  }

  get(nonce) {
    // Try the exact nonce first, then alternate forms for backward compat.
    for (const key of nonceVariants(nonce)) {
      const c = this.map.get(key);
      if (c) {
        if (Date.now() > c.expiresAt) {
          this.map.delete(key);
          return null;
        }
        return c;
      }
    }
    return null;
  }

  isSpent(nonce) {
    // Check all variants for spent status.
    for (const key of nonceVariants(nonce)) {
      if (this.spent.has(key)) return true;
    }
    return false;
  }

  markSpent(nonce) {
    if (nonce) {
      // Mark the exact nonce and delete all variants from the map.
      this.spent.add(nonce);
      for (const key of nonceVariants(nonce)) {
        this.map.delete(key);
      }
    }
  }

  _gc() {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (now > v.expiresAt) this.map.delete(k);
    }
  }
}

/** Module-level default store (server + tests share this unless a store is injected). */
export const challengeStore = new ChallengeStore();

// ─── Pricing ─────────────────────────────────────────────────────────────────
/**
 * Price a task in USDC smallest units (6dp string). Config-driven for Phase 1:
 * per-model overrides via X402_USDC_PRICES (JSON) or an injected `prices` map,
 * else X402_USDC_PRICE_DEFAULT, else 10000 ($0.01).
 *
 * @param {{ model?: string, serviceType?: number }} task
 * @param {{ prices?: Record<string,string>, default?: string }} [opts]
 * @returns {string} smallest-unit USDC amount
 */
export function priceTaskUSDC(task = {}, opts = {}) {
  let envPrices = {};
  if (process.env.X402_USDC_PRICES) {
    try { envPrices = JSON.parse(process.env.X402_USDC_PRICES); } catch { envPrices = {}; }
  }
  const prices = { ...envPrices, ...(opts.prices || {}) };
  const fallback = String(opts.default || process.env.X402_USDC_PRICE_DEFAULT || '10000');
  const key = task.model || (task.serviceType != null ? `service:${task.serviceType}` : null);
  const raw = (key && prices[key] != null) ? prices[key] : fallback;
  return String(raw);
}

// ─── Challenge ───────────────────────────────────────────────────────────────
/**
 * Encode a PaymentRequired body for the v2 `PAYMENT-REQUIRED` response header.
 * @param {Object} body
 * @returns {string} base64(JSON)
 */
export function encodePaymentRequiredHeader(body) {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

/**
 * Build a machine-parseable x402 v2 "Payment Required" challenge for a task and
 * record it in the store (bound to amount/asset/network/resource + a nonce) so
 * verify/settle can enforce it.
 *
 * CDP Bazaar cataloging (https://docs.cdp.coinbase.com/x402/bazaar):
 *   - Public HTTPS resource must return 402 (not 401) with this body
 *   - Top-level `resource` object + `extensions.bazaar`
 *   - `accepts[0]` uses CAIP-2 network, USDC contract `asset`, and `amount`
 *   - `PAYMENT-REQUIRED` header carries the same JSON (base64)
 *
 * Dual-network support (2026-08-22):
 *   - When `p.solana` is provided and enabled, adds a second accepts entry for Solana USDC
 *   - Base (EVM) stays as accepts[0] (primary); Solana is accepts[1]
 *   - Each network has its own nonce, payTo, and facilitator
 *   - Incoming payment's accepted.network determines which facilitator to use
 *
 * @param {Object} p
 * @param {string} p.taskId
 * @param {string} p.maxAmountRequired  smallest-unit string (USDC 6dp)
 * @param {string} [p.resource]         absolute resource URL (required for bazaar)
 * @param {string} [p.baseUrl]          base URL for building absolute links (e.g. https://api.xfuel.app)
 * @param {string} [p.payTo]            Base USDC treasury address
 * @param {string} [p.network]          base | base-sepolia | eip155:8453 | …
 * @param {string} [p.description]
 * @param {boolean} [p.includeBazaar=true]  include the bazaar discovery extension
 * @param {Object} [p.solana]           Solana payment config (optional, second network)
 * @param {boolean} [p.solana.enabled]  whether to include Solana accepts entry
 * @param {string} [p.solana.payTo]     Solana USDC treasury (ATA address)
 * @param {string} [p.solana.network]   solana | solana-devnet (default: solana)
 * @param {Object} [opts]
 * @param {ChallengeStore|null} [opts.store]  store to record into (default module store; null to skip)
 * @returns {{ status:number, body:Object, headers:Record<string,string> }}
 */
export function buildPaymentChallenge(p, opts = {}) {
  if (!p || !p.taskId) throw new Error('taskId is required');
  if (!p.maxAmountRequired) throw new Error('maxAmountRequired is required');

  // Internal short name for facilitator USDC lookup + challenge store.
  const network = fromCaip2Network(p.network || process.env.X402_NETWORK || 'base');
  const wireNetwork = toCaip2Network(network);
  const { asset: assetAddress, name: eip712Name, version: eip712Version } = usdcFor(network);
  const payTo = p.payTo || process.env.X402_PAY_TO || null;
  const amount = String(p.maxAmountRequired);
  // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. CDP-native clients that
  // sign accepts[0].extra.nonce as the authorization nonce need this format.
  // Per Section 3.5 challenge binding.
  const nonce = '0x' + crypto.randomBytes(32).toString('hex');
  const maxTimeoutSeconds = Math.max(30, Math.floor((opts.ttlMs || DEFAULT_TTL_MS) / 1000));

  // Absolute URL for CDP Bazaar catalog key — always /task-request, never per-task.
  const baseUrl = p.baseUrl ? String(p.baseUrl).replace(/\/$/, '') : '';
  const resourcePath = '/task-request';
  const resourceUrl = p.resource || (baseUrl ? `${baseUrl}${resourcePath}` : resourcePath);

  const serviceName = 'XFuel';
  // Per task: tags llm, openai-compatible, chat-completions help Bazaar search
  // queries "inference", "llm", "chat completions", "openai" find XFuel.
  const tags = ['llm', 'openai-compatible', 'chat-completions', 'inference', 'receipt', 'verifiable'];
  const iconUrl = 'https://xfuel.app/xfuel-icon.svg';

  // Update description when both networks are available.
  // Lead with "OpenAI-compatible" for Bazaar search discoverability.
  const solanaEnabled = p.solana?.enabled && p.solana?.payTo;
  const description = p.description || (solanaEnabled
    ? 'OpenAI-compatible paid inference via x402 USDC; accepts Base (primary) and Solana. ' +
      'POST /v1/chat/completions is the recommended surface. Returns signed receipt + verify_url. ' +
      'Paying this host is real mainnet USDC.'
    : 'OpenAI-compatible paid inference on Base USDC via x402. POST /v1/chat/completions is the ' +
      'recommended surface. Returns a signed receipt + verify_url. Paying this host is real Base mainnet USDC.');

  const includeBazaar = p.includeBazaar !== false;
  // When Solana is enabled, use the Solana example body for PayAI discoverability.
  // PayAI indexes the bazaar extension and shows the example to Solana buyers.
  const exampleBody = solanaEnabled ? TASK_REQUEST_BODY_EXAMPLE_SOLANA : TASK_REQUEST_BODY_EXAMPLE;
  const extensions = includeBazaar ? buildBazaarExtension({ method: 'POST', exampleBody }) : undefined;
  // v1 facilitators still catalog via paymentRequirements.outputSchema on settle.
  const outputSchema = v1OutputSchemaFromBazaar(extensions);

  const store = opts.store === undefined ? challengeStore : opts.store;
  let expiresAt = null;
  if (store) {
    // Persist bazaar fields so settleViaFacilitator can echo them on the
    // PaymentPayload even when the buyer SDK omits them. CDP will not catalog
    // a settle that lacks paymentPayload.resource.
    const rec = store.put(nonce, {
      taskId: p.taskId,
      amount,
      asset: assetAddress,
      network, // short name for usdcFor / facilitator
      payTo,
      resource: resourceUrl,
      description,
      mimeType: 'application/json',
      extensions,
      outputSchema,
    });
    expiresAt = rec.expiresAt;
  }

  // x402 v2 PaymentRequired — resource + extensions are top-level (not on accepts).
  // accepts[0]: Base (EVM) — primary network
  const baseAcceptsEntry = {
    scheme: 'exact',
    network: wireNetwork,
    amount,
    // Compat for older xfuel-sdk readers that still look at maxAmountRequired.
    maxAmountRequired: amount,
    asset: assetAddress,
    payTo,
    maxTimeoutSeconds,
    extra: {
      name: eip712Name,
      version: eip712Version,
      taskId: p.taskId,
      nonce,
      expiresAt,
    },
  };

  const accepts = [baseAcceptsEntry];

  // ── Solana accepts entry (optional, second network) ─────────────────────────
  // When Solana is enabled, add a second accepts entry for Solana USDC.
  // Solana uses Ed25519 signatures — no EIP-712 domain. PayAI handles verification.
  // feePayer is REQUIRED by @x402/svm ExactSvmScheme — PayAI's facilitator pays tx fees.
  if (solanaEnabled) {
    const solNetwork = fromCaip2Network(p.solana.network || 'solana');
    const solWireNetwork = toCaip2Network(solNetwork);
    const { asset: solAsset, feePayer: solFeePayer } = usdcFor(solNetwork);
    const solPayTo = p.solana.payTo;
    // Solana nonce: 32 random bytes as base58 (PayAI spec) or hex. PayAI accepts both.
    // Using hex for consistency with the store key format.
    const solNonce = '0x' + crypto.randomBytes(32).toString('hex');

    // Store the Solana challenge binding (include feePayer for toPaymentRequirements)
    if (store) {
      const solRec = store.put(solNonce, {
        taskId: p.taskId,
        amount,
        asset: solAsset,
        network: solNetwork,
        payTo: solPayTo,
        feePayer: solFeePayer,  // Forwarded to toPaymentRequirements for PayAI /verify
        resource: resourceUrl,
        description,
        mimeType: 'application/json',
        extensions,
        outputSchema,
        facilitator: 'payai', // Route to PayAI for Solana
      });
      // expiresAt is already set from the Base entry
    }

    const solanaAcceptsEntry = {
      scheme: 'exact',
      network: solWireNetwork,
      amount,
      maxAmountRequired: amount,
      asset: solAsset,
      payTo: solPayTo,
      maxTimeoutSeconds,
      extra: {
        // feePayer is REQUIRED by @x402/svm. PayAI GET /supported advertises this account
        // as the fee payer for Solana mainnet. Without it, ExactSvmScheme throws.
        feePayer: solFeePayer,
        taskId: p.taskId,
        nonce: solNonce,
        expiresAt,
      },
    };
    accepts.push(solanaAcceptsEntry);
  }

  const body = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
      serviceName,
      tags: tags.slice(0, 5),
      iconUrl,
    },
    accepts,
    ...(extensions ? { extensions } : {}),
  };

  return {
    status: 402,
    body,
    headers: {
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body),
    },
  };
}

// ─── Shared facilitator resolution ─────────────────────────────────────────
/**
 * Which facilitator protocol to speak:
 *   'x402' → standard x402 facilitator (e.g. Coinbase's Base Sepolia reference)
 *   'zan'  → bespoke ZAN /verify+/settle contract (default; also the mock's shape)
 */
function resolveProvider(opts = {}) {
  const p = (opts.provider || process.env.X402_FACILITATOR_PROVIDER || 'zan').toLowerCase();
  return p === 'x402' ? 'x402' : 'zan';
}

/**
 * Resolve the facilitator gateway for a payment.
 *
 * Dual-network routing (2026-08-22):
 *   - Solana payments → PayAI facilitator (https://facilitator.payai.network)
 *   - Base/EVM payments → CDP facilitator or network-aware default
 *   - The challenge.network or opts.network determines the route
 *   - If the challenge was stored with `facilitator: 'payai'`, use PayAI
 *
 * IMPORTANT (2026-08-23 bugfix): For Solana payments, opts.gatewayUrl is IGNORED.
 * The caller (runX402Handshake) passes cfg.facilitatorUrl (the Base CDP URL) as
 * opts.gatewayUrl, which is correct for EVM but wrong for Solana. Solana payments
 * must use X402_SOLANA_FACILITATOR_URL or the PayAI default — never the CDP URL.
 *
 * @param {Object} opts
 * @param {string} [opts.network] - Network from the payment blob
 * @param {Object} [opts.challenge] - Bound challenge from the store
 * @returns {{ provider: string, gateway: string, apiKey: string|null }}
 */
function resolveGateway(opts = {}) {
  const provider = resolveProvider(opts);

  // Determine network from challenge (bound) or opts (from payment blob)
  const network = opts.challenge?.network || opts.network || process.env.X402_NETWORK || 'base-sepolia';

  // ── Solana payments route to PayAI ──────────────────────────────────────────
  // If the challenge was explicitly marked for PayAI, or the network is Solana.
  // NOTE: opts.gatewayUrl is NOT used here. It comes from cfg.facilitatorUrl (Base CDP)
  // and would incorrectly route Solana payments to the EVM facilitator.
  const isPayAI = opts.challenge?.facilitator === 'payai' || isSolanaNetwork(network);
  if (isPayAI) {
    return {
      provider: 'x402', // PayAI speaks standard x402 protocol
      gateway: process.env.X402_SOLANA_FACILITATOR_URL
        || PAYAI_FACILITATOR_URL,
      apiKey: opts.apiKey || null, // PayAI free tier needs no key
    };
  }

  // ── EVM payments route to CDP/network-aware default ─────────────────────────
  if (provider === 'x402') {
    return {
      provider,
      // Public testnet facilitator (Base Sepolia) needs no API key.
      // Base mainnet defaults to CDP facilitator URL (needs CDP JWT env).
      gateway: opts.gatewayUrl
        || process.env.X402_FACILITATOR_URL
        || defaultFacilitatorUrlForNetwork(network),
      apiKey: opts.apiKey || process.env.X402_FACILITATOR_API_KEY || null,
    };
  }
  return {
    provider,
    gateway: opts.gatewayUrl || process.env.ZAN_X402_GATEWAY_URL || null,
    apiKey: opts.apiKey || process.env.ZAN_X402_API_KEY || null,
  };
}

/**
 * Resolve + validate the challenge bound to this payment (if binding requested).
 * @returns {{ ok:true, challenge:Object|null }|{ ok:false, reason:string }}
 */
function checkBinding(opts) {
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || opts.challenge?.nonce || null;

  // Binding is optional: callers that don't pass a nonce/challenge skip it
  // (preserves the simple verifyPayment(header, { gatewayUrl }) contract).
  if (!nonce) return { ok: true, challenge: opts.challenge || null };

  if (store && store.isSpent(nonce)) return { ok: false, reason: 'payment_replayed' };

  let challenge = opts.challenge || null;
  if (store) {
    const stored = store.get(nonce);
    if (!stored) return { ok: false, reason: 'challenge_expired_or_unknown' };
    challenge = stored;
  }
  return { ok: true, challenge };
}

// ─── Verify ──────────────────────────────────────────────────────────────────
/**
 * Verify an x402 payment via the facilitator. When a nonce/challenge is supplied
 * (with a store), enforces expiry + replay + amount binding by forwarding the
 * expected values. Idempotent — does NOT mark spent (settle does).
 *
 * @param {string} paymentHeader  X-PAYMENT header value from the client
 * @param {Object} [opts]  { gatewayUrl, apiKey, store, nonce, challenge }
 * @returns {Promise<{valid:boolean, txRef?:string, reason?:string}>}
 */
export async function verifyPayment(paymentHeader, opts = {}) {
  if (!paymentHeader) return { valid: false, reason: 'missing_payment_header' };

  // Look up the challenge FIRST so resolveGateway can determine the network.
  // This is critical for dual-network routing: Solana payments need the
  // challenge.network or challenge.facilitator to route to PayAI, not CDP.
  const bind = checkBinding(opts);
  if (!bind.ok) return { valid: false, reason: bind.reason };
  const challenge = bind.challenge;

  // Pass the resolved challenge to resolveGateway for network-aware routing.
  const { provider, gateway, apiKey } = resolveGateway({ ...opts, challenge });
  // ZAN gateway requires an API key; the standard x402 public facilitator does not.
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { valid: false, reason: 'gateway_not_configured' };
  }

  if (provider === 'x402') {
    // Pass client x402 version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE) to the facilitator.
    return verifyViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version: opts.x402Version });
  }

  try {
    const res = await fetch(`${gateway.replace(/\/$/, '')}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        payment: paymentHeader,
        expected: challenge
          ? {
              amount: challenge.amount,
              asset: challenge.asset,
              network: challenge.network,
              payTo: challenge.payTo,
              resource: challenge.resource,
              nonce: challenge.nonce,
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { valid: false, reason: `gateway_http_${res.status}` };
    const data = await res.json();
    return { valid: !!data.valid, txRef: data.txRef || data.transaction || null, reason: data.reason };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 verifyPayment failed');
    return { valid: false, reason: 'gateway_error' };
  }
}

// ─── Settle ──────────────────────────────────────────────────────────────────
/**
 * Settle a verified x402 payment via the facilitator (broadcast/capture) and
 * mark the challenge nonce spent (replay protection). Call after verifyPayment.
 *
 * @param {string} paymentHeader
 * @param {Object} [opts]  { gatewayUrl, apiKey, store, nonce, challenge }
 * @returns {Promise<{settled:boolean, txRef?:string, reason?:string}>}
 */
export async function settlePayment(paymentHeader, opts = {}) {
  if (!paymentHeader) return { settled: false, reason: 'missing_payment_header' };

  // Look up the challenge FIRST so resolveGateway can determine the network.
  // This is critical for dual-network routing: Solana payments need the
  // challenge.network or challenge.facilitator to route to PayAI, not CDP.
  const bind = checkBinding(opts);
  if (!bind.ok) return { settled: false, reason: bind.reason };
  const challenge = bind.challenge;
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || challenge?.nonce || null;

  // Pass the resolved challenge to resolveGateway for network-aware routing.
  const { provider, gateway, apiKey } = resolveGateway({ ...opts, challenge });
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { settled: false, reason: 'gateway_not_configured' };
  }

  if (provider === 'x402') {
    // Pass client x402 version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE) to the facilitator.
    const r = await settleViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version: opts.x402Version });
    if (r.settled && store && nonce) store.markSpent(nonce);
    return r;
  }

  try {
    const res = await fetch(`${gateway.replace(/\/$/, '')}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ payment: paymentHeader, nonce: nonce || undefined }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { settled: false, reason: `gateway_http_${res.status}` };
    const data = await res.json();
    const settled = !!data.settled;
    const txRef = data.txRef || data.transaction || null;
    if (settled && store && nonce) store.markSpent(nonce);
    return { settled, txRef, reason: data.reason };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 settlePayment failed');
    return { settled: false, reason: 'gateway_error' };
  }
}

// ─── A2A settlement mapping ──────────────────────────────────────────────────
/**
 * Map a verified+settled x402 payment to an XFuel A2A settlement plan.
 * Returns a descriptor the relayer can act on (no key handling here).
 *
 * @param {Object} p  { taskId, bidId, resultHash, txRef }
 * @returns {{ action:string, bidId:string, resultHash:string, paymentRef:string }}
 */
export function planA2ASettlement(p) {
  if (!p?.bidId || !p?.resultHash) throw new Error('bidId and resultHash are required');
  return {
    action: 'settleBidFairExchange',
    bidId: p.bidId,
    resultHash: p.resultHash,
    paymentRef: p.txRef || null,
    note: 'Submit via relayer or A2ACircuit calldata (xfuel-sdk/onchain encodeSettleBidFairExchange).',
  };
}
