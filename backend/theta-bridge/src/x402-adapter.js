import crypto from 'crypto';
import logger from './logger.js';

/**
 * XFuel ⇄ ZAN x402 adapter.
 *
 * x402 is an agent-native payment protocol (machine-parseable HTTP 402
 * challenges, USDC settlement on Base/Solana, wallet-as-identity). This adapter
 * lets XFuel expose tasks as x402-priced resources so any x402-speaking agent
 * can pay in USDC, then maps a verified+settled payment to an XFuel task /
 * A2A settlement.
 *
 * Payment-rail strategy: USDC via x402 is the DEFAULT rail; TFUEL/TDROP on Theta
 * is retained as a secondary rail (see docs/payments-x402.md).
 *
 * Settlement model (Phase 1 decision): USDC lands in a Base treasury
 * (X402_PAY_TO); the Theta-side BBB/GET/Staker/Treasury split is reconciled by
 * `paymentRef` via a deferred/periodic bridge — NOT synchronously. The payer is
 * the AGENT's wallet (agent-side, pluggable); this module never holds keys.
 *
 * Status: adapter hardened (challenge binding, nonce/replay store, verify+settle,
 * pricing). The facilitator HTTP calls target a ZAN x402 gateway; until one is
 * provisioned, use the mock facilitator (x402-mock-facilitator.js) for dev/CI.
 * Gated behind X402_ENABLED at the server layer.
 *
 * Env:
 *   X402_ENABLED=true
 *   X402_DEFAULT_RAIL=usdc|tfuel        (server default rail; start tfuel)
 *   X402_FALLBACK_TFUEL=true            (usdc unavailable → fall back vs 503)
 *   ZAN_X402_GATEWAY_URL=https://...    (facilitator; verify + settle)
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

/** Server default rail: "usdc" (recommended) | "tfuel". Starts "tfuel" until the gateway is live. */
export function defaultRail() {
  const r = (process.env.X402_DEFAULT_RAIL || 'tfuel').toLowerCase();
  return r === 'usdc' ? 'usdc' : 'tfuel';
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
 * @param {Object} p
 * @param {string} p.taskId
 * @param {string} p.maxAmountRequired  smallest-unit string (USDC 6dp)
 * @param {string} [p.resource]
 * @param {string} [p.payTo]
 * @param {string} [p.network]          base | solana
 * @param {string} [p.asset]            default USDC
 * @param {string} [p.description]
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
  const resource = p.resource || `/x402/task/${p.taskId}`;
  const amount = String(p.maxAmountRequired);
  const nonce = crypto.randomBytes(16).toString('hex');

  const store = opts.store === undefined ? challengeStore : opts.store;
  let expiresAt = null;
  if (store) {
    const rec = store.put(nonce, { taskId: p.taskId, amount, asset, network, payTo, resource });
    expiresAt = rec.expiresAt;
  }

  return {
    status: 402,
    body: {
      x402Version: 1,
      error: 'payment_required',
      accepts: [
        {
          scheme: 'exact',
          network,
          asset,
          maxAmountRequired: amount,
          resource,
          payTo,
          mimeType: 'application/json',
          description: p.description || `XFuel task ${p.taskId}`,
          extra: { taskId: p.taskId, nonce, expiresAt },
        },
      ],
    },
  };
}

// ─── Shared facilitator resolution ─────────────────────────────────────────
function resolveGateway(opts = {}) {
  return {
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
  const { gateway, apiKey } = resolveGateway(opts);
  if (!gateway || !apiKey) return { valid: false, reason: 'gateway_not_configured' };
  if (!paymentHeader) return { valid: false, reason: 'missing_payment_header' };

  const bind = checkBinding(opts);
  if (!bind.ok) return { valid: false, reason: bind.reason };
  const challenge = bind.challenge;

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
  const { gateway, apiKey } = resolveGateway(opts);
  if (!gateway || !apiKey) return { settled: false, reason: 'gateway_not_configured' };
  if (!paymentHeader) return { settled: false, reason: 'missing_payment_header' };

  const bind = checkBinding(opts);
  if (!bind.ok) return { settled: false, reason: bind.reason };
  const challenge = bind.challenge;
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || challenge?.nonce || null;

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
