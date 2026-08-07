import logger from './logger.js';
import { resolveFacilitatorBearer } from './cdp-jwt.js';

/**
 * Real x402 facilitator client (Base Sepolia + Base mainnet).
 *
 * The ZAN-shaped path in `x402-adapter.js` uses a bespoke `/verify` + `/settle`
 * contract (`{ payment, expected }` → `{ valid, txRef }`). This module speaks the
 * STANDARD x402 facilitator protocol instead, so XFuel can point at a live public
 * facilitator (e.g. Coinbase's reference `https://x402.org/facilitator` on Base
 * Sepolia, which needs no API key) with no ZAN dependency.
 *
 * Base mainnet: use Coinbase CDP facilitator
 * (`https://api.cdp.coinbase.com/platform/v2/x402`) with CDP_API_KEY_ID +
 * CDP_API_KEY_SECRET (EdDSA JWT). See docs/MAINNET_X402_CHECKLIST.md.
 *
 * Standard protocol (x402 "exact" scheme, v1):
 *   POST /verify  { x402Version, paymentPayload, paymentRequirements }
 *                 → { isValid, invalidReason?, payer? }
 *   POST /settle  { x402Version, paymentPayload, paymentRequirements }
 *                 → { success, transaction, network, payer?, errorReason? }
 *
 * XFuel's SDK payer (`createEip3009Payer`) already signs a spec-shaped EIP-3009
 * `transferWithAuthorization` and envelopes it in the X-PAYMENT header as
 *   { x402Version, scheme, network, asset, amount, payTo, nonce,
 *     authorization: { type, domain, message:{from,to,value,validAfter,validBefore,nonce}, signature } }
 * so this module only has to (a) decode that blob, (b) reshape it into the
 * standard `paymentPayload`, and (c) rebuild `paymentRequirements` from the bound
 * challenge — the facilitator re-derives the EIP-712 digest and recovers the payer.
 *
 * Selected via `provider: 'x402'` (env `X402_FACILITATOR_PROVIDER=x402`). Fully
 * reversible: leave the provider `zan` (default) to keep the legacy/mock path.
 */

/** Coinbase reference facilitator (testnet: Base Sepolia, no API key). */
export const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';

/** Coinbase CDP hosted facilitator (Base mainnet + multi-network; requires CDP JWT). */
export const CDP_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

/**
 * Pick facilitator URL from network when X402_FACILITATOR_URL is unset.
 * `base` → CDP mainnet; `base-sepolia` → public x402.org testnet.
 */
export function defaultFacilitatorUrlForNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'base' || n === 'eip155:8453') return CDP_FACILITATOR_URL;
  return DEFAULT_FACILITATOR_URL;
}

/**
 * USDC token address + EIP-712 domain per network. These MUST match the domain
 * the client signer used (see the SDK's USDC_NETWORKS) or the facilitator will
 * recover the wrong signer and reject the payment. Override via env for other
 * deployments (X402_ASSET_ADDRESS / X402_EIP712_NAME / X402_EIP712_VERSION).
 */
const USDC_NETWORKS = {
  'base-sepolia': { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
  base: { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
};

function usdcFor(network) {
  const known = USDC_NETWORKS[network] || {};
  return {
    asset: process.env.X402_ASSET_ADDRESS || known.asset || null,
    name: process.env.X402_EIP712_NAME || known.name || 'USD Coin',
    version: process.env.X402_EIP712_VERSION || known.version || '2',
  };
}

/** Decode an X-PAYMENT header (raw JSON or base64-JSON) to the XFuel payment blob. */
export function decodePaymentHeader(header) {
  if (!header || typeof header !== 'string') return null;
  try { return JSON.parse(header); } catch { /* not raw json — try base64 */ }
  try { return JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { return null; }
}

/**
 * Build the x402 `PaymentRequirements` object the facilitator validates against.
 * The `asset`/`extra` (EIP-712 name+version) must match what the payer signed.
 */
export function toPaymentRequirements({ network, amount, payTo, resource, taskId, maxTimeoutSeconds } = {}) {
  const { asset, name, version } = usdcFor(network);
  return {
    scheme: 'exact',
    network,
    maxAmountRequired: String(amount),
    resource: resource || `/x402/task/${taskId || 'task'}`,
    description: taskId ? `XFuel task ${taskId}` : 'XFuel task',
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: Number(maxTimeoutSeconds) || 120,
    asset,
    extra: { name, version },
  };
}

/** Translate the XFuel X-PAYMENT blob → standard x402 `PaymentPayload` (exact scheme). */
export function toPaymentPayload(decoded, { network } = {}) {
  if (!decoded) throw new Error('x402: X-PAYMENT header could not be decoded');
  const auth = decoded.authorization || {};
  // Support both the enveloped shape ({ message, signature }) and a flat one.
  const msg = auth.message || auth;
  const signature = auth.signature || decoded.signature;
  if (!signature || !msg || !msg.from) {
    throw new Error('x402: X-PAYMENT missing signature or authorization');
  }
  return {
    x402Version: 1,
    scheme: decoded.scheme || 'exact',
    network: network || decoded.network,
    payload: {
      signature,
      authorization: {
        from: msg.from,
        to: msg.to,
        value: String(msg.value),
        validAfter: String(msg.validAfter ?? 0),
        validBefore: String(msg.validBefore),
        nonce: msg.nonce,
      },
    },
  };
}

async function callFacilitator(path, { gateway, apiKey, body, timeoutMs }) {
  const headers = { 'Content-Type': 'application/json' };
  const url = `${gateway.replace(/\/$/, '')}${path}`;
  // Public testnet facilitator needs no key. CDP mainnet uses per-request EdDSA JWT
  // (CDP_API_KEY_ID + CDP_API_KEY_SECRET). Optional static bearer via apiKey /
  // X402_FACILITATOR_API_KEY for non-CDP facilitators.
  const bearer = await resolveFacilitatorBearer({ apiKey, method: 'POST', url });
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data, elapsedMs: Date.now() - t0 };
}

/** Resolve PaymentRequirements from the bound challenge, falling back to the decoded blob. */
function requirementsFrom(challenge, decoded) {
  return toPaymentRequirements({
    network: challenge?.network || decoded?.network,
    amount: challenge?.amount ?? decoded?.amount,
    payTo: challenge?.payTo ?? decoded?.payTo,
    resource: challenge?.resource,
    taskId: challenge?.taskId,
  });
}

/**
 * Verify a payment via the standard x402 facilitator. Idempotent (does not settle).
 * @returns {Promise<{valid:boolean, payer?:string, reason?:string}>}
 */
export async function verifyViaFacilitator(paymentHeader, { gateway, apiKey, challenge } = {}) {
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return { valid: false, reason: 'payment_header_undecodable' };
  const paymentRequirements = requirementsFrom(challenge, decoded);
  let paymentPayload;
  try {
    paymentPayload = toPaymentPayload(decoded, { network: paymentRequirements.network });
  } catch {
    return { valid: false, reason: 'payment_payload_invalid' };
  }
  try {
    const { ok, status, data, elapsedMs } = await callFacilitator('/verify', {
      gateway, apiKey, timeoutMs: 15000,
      body: { x402Version: 1, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: data.invalidReason || data.errorReason || data.errorMessage || data.errorType,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
        },
        'x402 facilitator verify HTTP error',
      );
      return { valid: false, reason: `facilitator_http_${status}` };
    }
    if (!data.isValid) {
      logger.warn(
        {
          invalidReason: data.invalidReason,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.maxAmountRequired,
          asset: paymentRequirements.asset,
        },
        'x402 facilitator verify rejected',
      );
    }
    return { valid: !!data.isValid, payer: data.payer || null, reason: data.invalidReason };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 facilitator verify failed');
    return { valid: false, reason: 'facilitator_error' };
  }
}

/**
 * Settle a verified payment via the standard x402 facilitator (broadcasts the
 * USDC transferWithAuthorization on-chain).
 * @returns {Promise<{settled:boolean, txRef?:string, payer?:string, reason?:string}>}
 */
export async function settleViaFacilitator(paymentHeader, { gateway, apiKey, challenge } = {}) {
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return { settled: false, reason: 'payment_header_undecodable' };
  const paymentRequirements = requirementsFrom(challenge, decoded);
  let paymentPayload;
  try {
    paymentPayload = toPaymentPayload(decoded, { network: paymentRequirements.network });
  } catch {
    return { settled: false, reason: 'payment_payload_invalid' };
  }
  try {
    const { ok, status, data, elapsedMs } = await callFacilitator('/settle', {
      gateway, apiKey, timeoutMs: 30000,
      body: { x402Version: 1, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: data.invalidReason || data.errorReason || data.errorMessage || data.errorType,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
        },
        'x402 facilitator settle HTTP error',
      );
      return { settled: false, reason: `facilitator_http_${status}` };
    }
    const settled = !!data.success;
    return {
      settled,
      txRef: data.transaction || data.txHash || null,
      payer: data.payer || null,
      reason: data.errorReason,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 facilitator settle failed');
    return { settled: false, reason: 'facilitator_error' };
  }
}
