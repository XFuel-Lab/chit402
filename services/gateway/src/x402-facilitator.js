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

/** Short name (`base`) ←→ CAIP-2 (`eip155:8453`). CDP Bazaar indexes the CAIP-2 form. */
export function toCaip2Network(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'base' || n === 'eip155:8453') return 'eip155:8453';
  if (n === 'base-sepolia' || n === 'eip155:84532') return 'eip155:84532';
  return network || 'eip155:8453';
}

export function fromCaip2Network(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'eip155:8453' || n === 'base') return 'base';
  if (n === 'eip155:84532' || n === 'base-sepolia') return 'base-sepolia';
  return network || 'base';
}

export function usdcFor(network) {
  const known = USDC_NETWORKS[fromCaip2Network(network)] || {};
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
 * Absolute catalog URL for CDP Bazaar. Relative paths are not catalogable
 * (`paymentPayload.resource` must name the paid endpoint).
 * @param {string|{url?:string}|undefined} resource
 * @returns {string|undefined}
 */
export function catalogResourceUrl(resource) {
  if (!resource) return undefined;
  const url = typeof resource === 'string' ? resource : resource.url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  return undefined;
}

/**
 * Build the x402 `PaymentRequirements` object the facilitator validates against.
 * The `asset`/`extra` (EIP-712 name+version) must match what the payer signed.
 *
 * `outputSchema` is the v1 Bazaar discovery field (info.input / info.output).
 * CDP's v2 path reads `paymentPayload.extensions.bazaar` instead; we send both.
 *
 * For v2 (CDP-native clients like Bankr), the network must stay in CAIP-2 format
 * (`eip155:8453`) to match what the payer signed. For v1 (XFuel SDK / ZAN
 * facilitator), we use the short form (`base`) for backward compatibility.
 *
 * @param {1|2} [opts.x402Version=1] - Protocol version; v2 preserves CAIP-2 network
 */
export function toPaymentRequirements({
  network, amount, payTo, resource, taskId, maxTimeoutSeconds, description, outputSchema,
  x402Version = 1,
} = {}) {
  const shortNet = fromCaip2Network(network);
  const { asset, name, version } = usdcFor(shortNet);
  // For v2 (CDP-native), use CAIP-2 network to match what the payer signed.
  // For v1 (XFuel SDK / ZAN), use short form for backward compatibility.
  const wireNetwork = x402Version === 2 ? toCaip2Network(network) : shortNet;
  const req = {
    scheme: 'exact',
    network: wireNetwork,
    maxAmountRequired: String(amount),
    resource: resource || `/x402/task/${taskId || 'task'}`,
    description: description || (taskId ? `XFuel task ${taskId}` : 'XFuel task'),
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: Number(maxTimeoutSeconds) || 120,
    asset,
    extra: { name, version },
  };
  if (outputSchema) req.outputSchema = outputSchema;
  return req;
}

/**
 * Translate the payment blob → standard x402 `PaymentPayload` (exact scheme).
 * Accepts both v1 (X-PAYMENT / XFuel SDK) and v2 (PAYMENT-SIGNATURE / CDP-native) headers.
 *
 * v1 (XFuel SDK) shape:
 *   { authorization: { message: { from, to, ... }, signature }, ... }
 *
 * v2 (CDP-native) shape - already a spec-compliant PaymentPayload:
 *   { x402Version: 2, payload: { authorization: { from, to, ... }, signature }, accepted, resource?, ... }
 *
 * @param {Object} decoded - Decoded payment header blob
 * @param {Object} opts
 * @param {string} [opts.network]
 * @param {string} [opts.resource]
 * @param {Object} [opts.extensions]
 * @param {1|2} [opts.x402Version=1] - Protocol version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE)
 */
export function toPaymentPayload(decoded, { network, resource, extensions, x402Version = 1 } = {}) {
  if (!decoded) throw new Error('x402: payment header could not be decoded');

  // CDP-native v2: the header is already a spec-shaped PaymentPayload with
  // { payload: { authorization: { from, to, ... }, signature }, ... }.
  // Bankr and other CDP-native clients send this shape directly.
  const cdpPayload = decoded.payload;
  const isCdpNativeV2 = cdpPayload?.authorization?.from && cdpPayload?.signature;

  let msg;
  let signature;

  if (isCdpNativeV2) {
    // CDP-native v2: extract from decoded.payload
    msg = cdpPayload.authorization;
    signature = cdpPayload.signature;
  } else {
    // XFuel SDK v1: extract from decoded.authorization.message + decoded.authorization.signature
    const auth = decoded.authorization || {};
    msg = auth.message || auth;
    signature = auth.signature || decoded.signature;
  }

  if (!signature || !msg || !msg.from) {
    throw new Error('x402: payment header missing signature or authorization');
  }
  // Use the client's protocol version (v2 for CDP-native like Bankr, v1 for XFuel SDK).
  const wireVersion = x402Version === 2 ? 2 : 1;
  // CDP-native v2 puts network/scheme on `accepted`; XFuel SDK v1 puts them at the top level.
  const accepted = decoded.accepted || {};
  const payload = {
    x402Version: wireVersion,
    scheme: accepted.scheme || decoded.scheme || 'exact',
    network: network || accepted.network || decoded.network,
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
  // CDP catalogs only when settle carries paymentPayload.resource (absolute URL)
  // plus the echoed bazaar extension. Prefer the bound challenge — the SDK
  // header may omit both (it did, through the first paid listing attempt).
  const resourceUrl = catalogResourceUrl(resource) || catalogResourceUrl(decoded.resource);
  if (resourceUrl) payload.resource = resourceUrl;
  const ext = (extensions && typeof extensions === 'object')
    ? extensions
    : (decoded.extensions && typeof decoded.extensions === 'object' ? decoded.extensions : null);
  if (ext) payload.extensions = ext;
  return payload;
}

/** Decode CDP/x402 EXTENSION-RESPONSES (JSON or base64-JSON). */
export function parseExtensionResponses(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get('extension-responses')
    || headers.get('EXTENSION-RESPONSES')
    || headers.get('x-extension-responses');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* maybe base64 */ }
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return { _raw: String(raw).slice(0, 240) }; }
}

function logBazaarResponses(path, extensionResponses, paymentPayload) {
  const bazaar = extensionResponses?.bazaar;
  logger.info(
    {
      path,
      resource: paymentPayload?.resource,
      bazaarStatus: bazaar?.status || (extensionResponses ? 'present' : 'header_absent'),
      rejectedReason: bazaar?.rejectedReason,
    },
    'x402 bazaar extension-responses',
  );
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
  return {
    ok: res.ok,
    status: res.status,
    data,
    elapsedMs: Date.now() - t0,
    extensionResponses: parseExtensionResponses(res.headers),
  };
}

/**
 * Resolve PaymentRequirements from the bound challenge, falling back to the decoded blob.
 *
 * CDP-native v2 blobs put network/amount/payTo on `accepted`, not at the top level:
 *   { accepted: { network, amount, payTo, ... }, payload: { ... } }
 * XFuel SDK v1 blobs put them at the top level:
 *   { network, amount, payTo, authorization: { ... } }
 *
 * When the challenge binding fails (e.g. nonce not found), we must still build
 * valid requirements from the decoded blob — otherwise the facilitator gets
 * undefined values and returns HTTP 400. Per Section 3.5.
 *
 * @param {Object|null} challenge - Bound challenge from the store
 * @param {Object|null} decoded - Decoded payment header blob
 * @param {1|2} [x402Version=1] - Protocol version; v2 preserves CAIP-2 network
 */
function requirementsFrom(challenge, decoded, x402Version = 1) {
  // CDP-native v2: read from decoded.accepted; v1: read from top-level
  const accepted = decoded?.accepted || {};
  const network = challenge?.network || accepted.network || decoded?.network;
  const amount = challenge?.amount ?? accepted.amount ?? decoded?.amount;
  const payTo = challenge?.payTo ?? accepted.payTo ?? decoded?.payTo;

  return toPaymentRequirements({
    network,
    amount,
    payTo,
    resource: challenge?.resource,
    taskId: challenge?.taskId,
    description: challenge?.description,
    outputSchema: challenge?.outputSchema,
    x402Version,
  });
}

function payloadOpts(challenge, decoded, paymentRequirements, x402Version) {
  return {
    network: paymentRequirements.network,
    resource: challenge?.resource || decoded?.resource,
    extensions: challenge?.extensions || decoded?.extensions,
    x402Version: x402Version ?? 1,
  };
}

/**
 * Verify a payment via the standard x402 facilitator. Idempotent (does not settle).
 * @param {string} paymentHeader - The payment header (X-PAYMENT or PAYMENT-SIGNATURE)
 * @param {Object} opts
 * @param {string} opts.gateway - Facilitator URL
 * @param {string} [opts.apiKey] - API key for CDP facilitator
 * @param {Object} [opts.challenge] - Bound challenge from the 402 response
 * @param {1|2} [opts.x402Version=1] - Protocol version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE)
 * @returns {Promise<{valid:boolean, payer?:string, reason?:string}>}
 */
export async function verifyViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version } = {}) {
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return { valid: false, reason: 'payment_header_undecodable' };
  // Use the client's protocol version — v2 for CDP-native clients like Bankr.
  const wireVersion = x402Version === 2 ? 2 : 1;
  // For v2, paymentRequirements.network must be CAIP-2 format to match what the payer signed.
  const paymentRequirements = requirementsFrom(challenge, decoded, wireVersion);
  let paymentPayload;
  try {
    paymentPayload = toPaymentPayload(decoded, payloadOpts(challenge, decoded, paymentRequirements, wireVersion));
  } catch {
    return { valid: false, reason: 'payment_payload_invalid' };
  }
  try {
    const { ok, status, data, elapsedMs, extensionResponses } = await callFacilitator('/verify', {
      gateway, apiKey, timeoutMs: 15000,
      body: { x402Version: wireVersion, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      const cdpReason = data.invalidReason || data.errorReason || data.errorMessage || data.errorType;
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: cdpReason,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
        },
        'x402 facilitator verify HTTP error',
      );
      // Surface the actual CDP invalidReason when available (Bankr #2 debugging).
      // Before: always returned generic `facilitator_http_400`.
      // After: returns `facilitator_http_400:amount_required` when CDP tells us why.
      const reason = cdpReason
        ? `facilitator_http_${status}:${String(cdpReason).replace(/\s+/g, '_').slice(0, 50)}`
        : `facilitator_http_${status}`;
      return { valid: false, reason };
    }
    logBazaarResponses('/verify', extensionResponses, paymentPayload);
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
 * @param {string} paymentHeader - The payment header (X-PAYMENT or PAYMENT-SIGNATURE)
 * @param {Object} opts
 * @param {string} opts.gateway - Facilitator URL
 * @param {string} [opts.apiKey] - API key for CDP facilitator
 * @param {Object} [opts.challenge] - Bound challenge from the 402 response
 * @param {1|2} [opts.x402Version=1] - Protocol version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE)
 * @returns {Promise<{settled:boolean, txRef?:string, payer?:string, reason?:string}>}
 */
export async function settleViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version } = {}) {
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return { settled: false, reason: 'payment_header_undecodable' };
  // Use the client's protocol version — v2 for CDP-native clients like Bankr.
  const wireVersion = x402Version === 2 ? 2 : 1;
  // For v2, paymentRequirements.network must be CAIP-2 format to match what the payer signed.
  const paymentRequirements = requirementsFrom(challenge, decoded, wireVersion);
  let paymentPayload;
  try {
    paymentPayload = toPaymentPayload(decoded, payloadOpts(challenge, decoded, paymentRequirements, wireVersion));
  } catch {
    return { settled: false, reason: 'payment_payload_invalid' };
  }
  try {
    const { ok, status, data, elapsedMs, extensionResponses } = await callFacilitator('/settle', {
      gateway, apiKey, timeoutMs: 30000,
      body: { x402Version: wireVersion, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      const cdpReason = data.invalidReason || data.errorReason || data.errorMessage || data.errorType;
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: cdpReason,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
        },
        'x402 facilitator settle HTTP error',
      );
      // Surface the actual CDP invalidReason when available (Bankr #2 debugging).
      const reason = cdpReason
        ? `facilitator_http_${status}:${String(cdpReason).replace(/\s+/g, '_').slice(0, 50)}`
        : `facilitator_http_${status}`;
      return { settled: false, reason };
    }
    logBazaarResponses('/settle', extensionResponses, paymentPayload);
    const settled = !!data.success;
    return {
      settled,
      txRef: data.transaction || data.txHash || null,
      payer: data.payer || null,
      reason: data.errorReason,
      bazaarStatus: extensionResponses?.bazaar?.status || null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 facilitator settle failed');
    return { settled: false, reason: 'facilitator_error' };
  }
}
