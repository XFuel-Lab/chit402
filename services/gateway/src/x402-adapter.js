import crypto from 'crypto';
import logger from './logger.js';
import {
  verifyViaFacilitator,
  settleViaFacilitator,
  defaultFacilitatorUrlForNetwork,
} from './x402-facilitator.js';

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

/** Example POST /task-request body advertised to Bazaar buyers. */
export const TASK_REQUEST_BODY_EXAMPLE = {
  message_type: 'inference_request',
  chain_id: 'base',
  sender: '0xYourWalletAddress',
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
 * @returns {Object} extensions object to spread into the 402 accepts entry
 */
export function buildBazaarExtension(opts = {}) {
  const method = opts.method || 'POST';

  return {
    [BAZAAR_EXTENSION_KEY]: {
      info: {
        input: {
          type: 'http',
          method,
          bodyType: 'json',
          body: TASK_REQUEST_BODY_EXAMPLE,
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
    const c = this.map.get(nonce);
    if (!c) return null;
    if (Date.now() > c.expiresAt) {
      this.map.delete(nonce);
      return null;
    }
    return c;
  }

  isSpent(nonce) {
    return this.spent.has(nonce);
  }

  markSpent(nonce) {
    if (nonce) {
      this.spent.add(nonce);
      this.map.delete(nonce);
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
 * Build a machine-parseable x402 "Payment Required" challenge for a task and
 * record it in the store (bound to amount/asset/network/resource + a nonce) so
 * verify/settle can enforce it. Shape follows the x402 `accepts` convention.
 *
 * CDP Bazaar cataloging (https://docs.x402.org/extensions/bazaar):
 *   - `resource` MUST be an absolute https:// URL for the catalog key
 *   - `extensions.bazaar` MUST be present with info.input.type / info.output.type
 *   - `routeTemplate` is the stable catalog key (not per-task)
 *
 * @param {Object} p
 * @param {string} p.taskId
 * @param {string} p.maxAmountRequired  smallest-unit string (USDC 6dp)
 * @param {string} [p.resource]         absolute resource URL (required for bazaar)
 * @param {string} [p.baseUrl]          base URL for building absolute links (e.g. https://api.xfuel.app)
 * @param {string} [p.payTo]
 * @param {string} [p.network]          base | solana
 * @param {string} [p.asset]            default USDC
 * @param {string} [p.description]
 * @param {boolean} [p.includeBazaar=true]  include the bazaar discovery extension
 * @param {Object} [opts]
 * @param {ChallengeStore|null} [opts.store]  store to record into (default module store; null to skip)
 * @returns {{ status:number, body:Object }}
 */
export function buildPaymentChallenge(p, opts = {}) {
  if (!p || !p.taskId) throw new Error('taskId is required');
  if (!p.maxAmountRequired) throw new Error('maxAmountRequired is required');

  const network = p.network || process.env.X402_NETWORK || 'base';
  const asset = p.asset || process.env.X402_ASSET || 'USDC';
  const payTo = p.payTo || process.env.X402_PAY_TO || null;
  const amount = String(p.maxAmountRequired);
  const nonce = crypto.randomBytes(16).toString('hex');

  // Build the absolute resource URL for CDP Bazaar cataloging.
  // Per the spec, `resource` must be an absolute https:// URL for the catalog key.
  // We use /task-request as the routeTemplate (the single catalogable endpoint)
  // rather than a per-task path like /x402/task/{taskId}.
  const baseUrl = p.baseUrl ? String(p.baseUrl).replace(/\/$/, '') : '';
  const resourcePath = '/task-request';
  const resource = p.resource || (baseUrl ? `${baseUrl}${resourcePath}` : resourcePath);

  // The routeTemplate is the catalog key — one entry for the service, not per-task.
  // Per spec: "Facilitators use routeTemplate as the catalog key, consolidating all
  // requests to the same route pattern into a single discovery entry."
  const routeTemplate = baseUrl ? `${baseUrl}/task-request` : '/task-request';

  // Service metadata for CDP Bazaar (on the resource object per spec)
  const serviceName = 'XFuel';
  const tags = ['inference', 'receipt', 'x402', 'ai', 'verifiable'];
  const iconUrl = 'https://xfuel.app/xfuel-icon.svg';

  // CDP Bazaar description: must explain what the service does
  const description = p.description ||
    'Paid inference on Base USDC via x402; returns a signed receipt + verify_url. ' +
    'Unmetered OpenAI path is POST /v1/chat/completions (not this resource). ' +
    'Paying this host is real Base mainnet USDC.';

  // Build the accepts entry with bazaar extension
  const includeBazaar = p.includeBazaar !== false;
  const extensions = includeBazaar ? buildBazaarExtension({ method: 'POST' }) : undefined;
  // v1 facilitators catalog via paymentRequirements.outputSchema.
  const outputSchema = v1OutputSchemaFromBazaar(extensions);

  const store = opts.store === undefined ? challengeStore : opts.store;
  let expiresAt = null;
  if (store) {
    // Persist bazaar fields so settleViaFacilitator can echo them on the
    // PaymentPayload even when the buyer SDK omits them (xfuel-sdk before
    // this change). CDP will not catalog a settle that lacks resource.
    const rec = store.put(nonce, {
      taskId: p.taskId,
      amount,
      asset,
      network,
      payTo,
      resource,
      description,
      mimeType: 'application/json',
      extensions,
      outputSchema,
    });
    expiresAt = rec.expiresAt;
  }

  const acceptsEntry = {
    scheme: 'exact',
    network,
    asset,
    maxAmountRequired: amount,
    resource,
    routeTemplate,
    payTo,
    mimeType: 'application/json',
    description,
    // Service metadata (spec: set on the resource object for Bazaar)
    serviceName,
    tags: tags.slice(0, 5), // spec: ≤5 tags
    iconUrl,
    extra: { taskId: p.taskId, nonce, expiresAt },
    // CDP Bazaar extension — required for cataloging
    ...(extensions ? { extensions } : {}),
  };

  return {
    status: 402,
    body: {
      x402Version: 1,
      error: 'payment_required',
      accepts: [acceptsEntry],
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

function resolveGateway(opts = {}) {
  const provider = resolveProvider(opts);
  if (provider === 'x402') {
    const network = opts.network
      || opts.challenge?.network
      || process.env.X402_NETWORK
      || 'base-sepolia';
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
  const { provider, gateway, apiKey } = resolveGateway(opts);
  // ZAN gateway requires an API key; the standard x402 public facilitator does not.
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { valid: false, reason: 'gateway_not_configured' };
  }
  if (!paymentHeader) return { valid: false, reason: 'missing_payment_header' };

  const bind = checkBinding(opts);
  if (!bind.ok) return { valid: false, reason: bind.reason };
  const challenge = bind.challenge;

  if (provider === 'x402') {
    return verifyViaFacilitator(paymentHeader, { gateway, apiKey, challenge });
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
  const { provider, gateway, apiKey } = resolveGateway(opts);
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { settled: false, reason: 'gateway_not_configured' };
  }
  if (!paymentHeader) return { settled: false, reason: 'missing_payment_header' };

  const bind = checkBinding(opts);
  if (!bind.ok) return { settled: false, reason: bind.reason };
  const challenge = bind.challenge;
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || challenge?.nonce || null;

  if (provider === 'x402') {
    const r = await settleViaFacilitator(paymentHeader, { gateway, apiKey, challenge });
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
