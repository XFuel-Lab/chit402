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

/** PayAI facilitator (Solana-first, multi-network; supports v1 and v2). */
export const PAYAI_FACILITATOR_URL = 'https://facilitator.payai.network';

/**
 * PayAI Solana feePayer — the account that pays transaction fees for USDC transfers.
 * From PayAI GET /supported: extra.feePayer for solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp.
 * Override via X402_SOLANA_FEE_PAYER env for custom facilitators.
 */
export const PAYAI_DEFAULT_FEE_PAYER = 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww';

// ════════════════════════════════════════════════════════════════════════════════
// Facilitator timeouts by network
//
// Solana facilitators (Dexter, PayAI) do on-chain simulation before returning,
// which can take 30-60s under load. EVM facilitators (CDP) are faster.
// Per 2026-08-23 bugfix: 15s was too short for Solana /verify.
// ════════════════════════════════════════════════════════════════════════════════

/** Facilitator timeout configuration (ms). */
export const FACILITATOR_TIMEOUTS = {
  evm: { verify: 15000, settle: 30000 },
  solana: { verify: 45000, settle: 45000 },
};

/**
 * Get the appropriate timeout for a facilitator call based on network.
 * @param {'verify'|'settle'} operation
 * @param {string} network - Network identifier (short name or CAIP-2)
 * @returns {number} Timeout in milliseconds
 */
export function facilitatorTimeout(operation, network) {
  const timeouts = isSolanaNetwork(network)
    ? FACILITATOR_TIMEOUTS.solana
    : FACILITATOR_TIMEOUTS.evm;
  return timeouts[operation] || FACILITATOR_TIMEOUTS.evm.verify;
}

// ════════════════════════════════════════════════════════════════════════════════
// Network type detection
// ════════════════════════════════════════════════════════════════════════════════

/** Solana network identifiers (v1 short name → CAIP-2). */
export const SOLANA_NETWORKS = {
  'solana': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',        // Solana mainnet
  'solana-devnet': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',  // Solana devnet
};

/** Reverse map: CAIP-2 → short name. Includes lowercase variants for case-insensitive lookup. */
const SOLANA_CAIP2_TO_SHORT = Object.fromEntries([
  ...Object.entries(SOLANA_NETWORKS).map(([k, v]) => [v, k]),
  ...Object.entries(SOLANA_NETWORKS).map(([k, v]) => [v.toLowerCase(), k]),
]);

/**
 * True if this network is a Solana network (mainnet or devnet).
 * Supports both short names (solana, solana-devnet) and CAIP-2 identifiers.
 * @param {string} network - Short name or CAIP-2 identifier
 */
export function isSolanaNetwork(network) {
  if (!network) return false;
  const n = String(network);
  const nLower = n.toLowerCase();
  // Check short names (case-insensitive)
  if (nLower in SOLANA_NETWORKS) return true;
  // Check CAIP-2 (exact match first, then lowercase)
  if (n in SOLANA_CAIP2_TO_SHORT) return true;
  if (nLower in SOLANA_CAIP2_TO_SHORT) return true;
  return false;
}

/**
 * True if this network is an EVM network (Base, etc.).
 * EVM networks use EIP-155 CAIP-2 format (eip155:chainId).
 */
export function isEvmNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (n.startsWith('eip155:')) return true;
  if (n === 'base' || n === 'base-sepolia') return true;
  return false;
}

/**
 * Pick facilitator URL from network when X402_FACILITATOR_URL is unset.
 * `base` → CDP mainnet; `base-sepolia` → public x402.org testnet.
 * `solana` / `solana-devnet` → PayAI facilitator.
 */
export function defaultFacilitatorUrlForNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (isSolanaNetwork(n)) return PAYAI_FACILITATOR_URL;
  if (n === 'base' || n === 'eip155:8453') return CDP_FACILITATOR_URL;
  return DEFAULT_FACILITATOR_URL;
}

/**
 * USDC token address + EIP-712 domain per network. These MUST match the domain
 * the client signer used (see the SDK's USDC_NETWORKS) or the facilitator will
 * recover the wrong signer and reject the payment. Override via env for other
 * deployments (X402_ASSET_ADDRESS / X402_EIP712_NAME / X402_EIP712_VERSION).
 *
 * Solana USDC: SPL token mint address. No EIP-712 domain — Solana uses Ed25519 signatures.
 * The PayAI facilitator handles Solana signature verification natively.
 */
const USDC_NETWORKS = {
  // EVM networks (EIP-712 domain for EIP-3009 signatures)
  'base-sepolia': { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
  base: { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
  // Solana networks (SPL token mint address, no EIP-712 domain)
  solana: { asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  'solana-devnet': { asset: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' },  // devnet USDC
};

// ════════════════════════════════════════════════════════════════════════════════
// Authorization field normalization (Bankr float-string fix, 2026-08-21 PR)
//
// CDP /verify returns `invalid_payload` when authorization fields arrive as float
// strings (e.g. `"1787321234.927"` or `"10000.0"`). Bankr and other CDP clients
// JSON-stringify JS numbers, so `Date.now()/1000` becomes a float string.
//
// This normalizes authorization fields before sending to CDP:
// - Integer-equivalent floats ("10000.0") → integer string ("10000")
// - JSON numbers (1787321234) → integer string ("1787321234")
// - Nonzero fractional values → fail closed with specific reason (not sent to CDP)
// - Nonce: 64-hex without 0x → prefix 0x; 32-hex (16 bytes) → fail (EIP-3009 needs bytes32)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Coerce a value to an integer string. Accepts:
 * - Integer strings ("1234") → pass through
 * - Float strings with .0 ("1234.0", "1234.000") → coerce to "1234"
 * - JSON numbers (1234) → coerce to "1234"
 *
 * @throws {Error} If the value has a nonzero fractional part
 * @returns {{ value: string, coerced: boolean }}
 */
export function normalizeIntegerString(value, fieldName) {
  if (value === null || value === undefined) {
    return { value: '0', coerced: true };
  }
  const str = String(value);

  // Fast path: already an integer string (no decimal point)
  if (/^-?\d+$/.test(str)) {
    // If it was a number, it was coerced; if it was already a string, no coercion
    return { value: str, coerced: typeof value === 'number' };
  }

  // Float string: check if it's integer-equivalent
  if (/^-?\d+\.0*$/.test(str)) {
    // "1234.0" or "1234.000" → "1234"
    const intPart = str.split('.')[0];
    return { value: intPart, coerced: true };
  }

  // Check for nonzero fractional part
  const floatMatch = str.match(/^(-?\d+)\.(\d+)$/);
  if (floatMatch) {
    const fractional = floatMatch[2];
    // If fractional part is all zeros, it's integer-equivalent (handled above)
    // If fractional part has nonzero digits, fail closed
    if (/[1-9]/.test(fractional)) {
      throw new Error(
        `authorization_${fieldName}_must_be_integer_string:received_${str.slice(0, 20)}`
      );
    }
    // All zeros (shouldn't reach here, but handle it)
    return { value: floatMatch[1], coerced: true };
  }

  // Not a recognizable numeric format - pass through as-is (CDP will validate)
  return { value: str, coerced: false };
}

/**
 * Normalize an EIP-3009 nonce to a 0x-prefixed 64-character hex string (bytes32).
 *
 * - 64 hex without 0x → prefix 0x
 * - 66 hex with 0x → pass through
 * - 32 hex (16 bytes) → fail closed (EIP-3009 needs bytes32)
 *
 * @returns {{ nonce: string, coerced: boolean, has0x: boolean, hexLen: number }}
 * @throws {Error} If nonce is 32-hex (bytes16 instead of bytes32)
 */
export function normalizeNonce(nonce) {
  if (!nonce || typeof nonce !== 'string') {
    return { nonce, coerced: false, has0x: false, hexLen: 0 };
  }

  const has0x = nonce.startsWith('0x') || nonce.startsWith('0X');
  const hexPart = has0x ? nonce.slice(2) : nonce;
  const hexLen = hexPart.length;

  // 32 hex chars = 16 bytes (bytes16) — EIP-3009 needs bytes32 (32 bytes = 64 hex)
  if (hexLen === 32 && /^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(
      'authorization_nonce_must_be_bytes32:received_32_hex_chars_(bytes16)'
    );
  }

  // 64 hex chars without 0x prefix → prefix it
  if (!has0x && hexLen === 64 && /^[0-9a-fA-F]+$/.test(hexPart)) {
    return { nonce: '0x' + hexPart, coerced: true, has0x: false, hexLen: 64 };
  }

  // Already 0x-prefixed or other format — pass through
  return { nonce, coerced: false, has0x, hexLen };
}

/**
 * Normalize authorization fields in a CDP-native v2 payload.
 * Coerces integer-equivalent floats and validates nonce format.
 *
 * @param {Object} payload - The payload object { signature, authorization }
 * @returns {{ normalizedPayload: Object, coercions: Object }}
 * @throws {Error} If validation fails (fractional values, bytes16 nonce)
 */
export function normalizeAuthorizationPayload(payload) {
  if (!payload?.authorization) {
    return { normalizedPayload: payload, coercions: {} };
  }

  const auth = payload.authorization;
  const coercions = {};

  // Normalize numeric fields: value, validAfter, validBefore
  const valueResult = normalizeIntegerString(auth.value, 'value');
  const validAfterResult = normalizeIntegerString(auth.validAfter, 'validAfter');
  const validBeforeResult = normalizeIntegerString(auth.validBefore, 'validBefore');

  if (valueResult.coerced) coercions.value = { from: auth.value, to: valueResult.value };
  if (validAfterResult.coerced) coercions.validAfter = { from: auth.validAfter, to: validAfterResult.value };
  if (validBeforeResult.coerced) coercions.validBefore = { from: auth.validBefore, to: validBeforeResult.value };

  // Normalize nonce
  const nonceResult = normalizeNonce(auth.nonce);
  if (nonceResult.coerced) coercions.nonce = { from: auth.nonce, to: nonceResult.nonce };

  const normalizedPayload = {
    ...payload,
    authorization: {
      ...auth,
      value: valueResult.value,
      validAfter: validAfterResult.value,
      validBefore: validBeforeResult.value,
      nonce: nonceResult.nonce,
    },
  };

  return { normalizedPayload, coercions };
}

/**
 * Short name (`base`, `solana`) ←→ CAIP-2 (`eip155:8453`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`).
 * CDP/PayAI Bazaar indexes the CAIP-2 form.
 */
export function toCaip2Network(network) {
  if (!network) return 'eip155:8453';
  const n = String(network);
  const nLower = n.toLowerCase();
  // EVM networks (lowercase compare)
  if (nLower === 'base' || nLower === 'eip155:8453') return 'eip155:8453';
  if (nLower === 'base-sepolia' || nLower === 'eip155:84532') return 'eip155:84532';
  // Solana networks: short name → CAIP-2
  if (nLower in SOLANA_NETWORKS) return SOLANA_NETWORKS[nLower];
  // Already CAIP-2 (exact match or lowercase match in reverse map)
  if (n in SOLANA_CAIP2_TO_SHORT) return n;
  if (nLower in SOLANA_CAIP2_TO_SHORT) return n;  // Preserve original case
  return network;
}

export function fromCaip2Network(network) {
  if (!network) return 'base';
  const n = String(network);
  const nLower = n.toLowerCase();
  // EVM networks (lowercase compare)
  if (nLower === 'eip155:8453' || nLower === 'base') return 'base';
  if (nLower === 'eip155:84532' || nLower === 'base-sepolia') return 'base-sepolia';
  // Solana networks: CAIP-2 → short name
  if (n in SOLANA_CAIP2_TO_SHORT) return SOLANA_CAIP2_TO_SHORT[n];
  if (nLower in SOLANA_CAIP2_TO_SHORT) return SOLANA_CAIP2_TO_SHORT[nLower];
  // Already short form
  if (nLower in SOLANA_NETWORKS) return nLower;
  return network;
}

/**
 * Get USDC token info for a network.
 *
 * For EVM networks: returns asset address + EIP-712 domain (name, version).
 * For Solana networks: returns asset (mint address) + feePayer — no EIP-712 domain.
 *
 * @param {string} network - Short name or CAIP-2 identifier
 * @returns {{ asset: string|null, name?: string, version?: string, feePayer?: string }}
 */
export function usdcFor(network) {
  const shortNet = fromCaip2Network(network);
  const known = USDC_NETWORKS[shortNet] || {};
  // Solana: no EIP-712 domain — PayAI handles Ed25519 signatures natively.
  // feePayer is required by @x402/svm ExactSvmScheme — PayAI's facilitator pays tx fees.
  if (isSolanaNetwork(shortNet)) {
    return {
      asset: process.env.X402_SOLANA_ASSET_ADDRESS || known.asset || null,
      feePayer: process.env.X402_SOLANA_FEE_PAYER || PAYAI_DEFAULT_FEE_PAYER,
    };
  }
  // EVM: include EIP-712 domain for EIP-3009 signature verification.
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
 * The `asset`/`extra` must match what the payer signed.
 *
 * For EVM networks: `extra` contains EIP-712 domain { name, version }.
 * For Solana networks: `extra` contains { feePayer } — PayAI's transaction fee payer.
 *
 * v1 (XFuel SDK / ZAN): includes `maxAmountRequired`, `resource`, `description`,
 * `mimeType`, `outputSchema` per the ZAN/testnet schema.
 *
 * v2 (CDP-native like Bankr): per x402 spec section 5.1.2, PaymentRequirements has:
 *   - scheme (string)
 *   - network (CAIP-2, e.g. eip155:8453 or solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)
 *   - amount (string, atomic units) — NOT maxAmountRequired
 *   - asset (string)
 *   - payTo (string)
 *   - maxTimeoutSeconds (number)
 *   - extra (optional, for EVM: { name, version }, for Solana: { feePayer })
 * v2 does NOT have: maxAmountRequired, resource, description, mimeType, outputSchema.
 *
 * @param {1|2} [opts.x402Version=1] - Protocol version; v2 uses `amount` + CAIP-2 network
 * @param {string} [opts.feePayer] - Override feePayer for Solana (from challenge or PayAI /supported)
 */
export function toPaymentRequirements({
  network, amount, payTo, resource, taskId, maxTimeoutSeconds, description, outputSchema,
  x402Version = 1,
  feePayer: feePayerOverride,
  memo,  // SVM: client's memo for Memo ix matching (optional per spec, but required if tx has Memo ix)
} = {}) {
  const shortNet = fromCaip2Network(network);
  const usdcInfo = usdcFor(shortNet);
  const { asset, name, version, feePayer: defaultFeePayer } = usdcInfo;
  // For v2 (CDP-native), use CAIP-2 network to match what the payer signed.
  // For v1 (XFuel SDK / ZAN), use short form for backward compatibility.
  const wireNetwork = x402Version === 2 ? toCaip2Network(network) : shortNet;

  // Build network-appropriate extra field:
  // - Solana: { feePayer, memo? } — feePayer required; memo optional but needed for Path 1 static
  //   validation when the transaction contains a Memo ix (per x402 SVM spec).
  // - EVM: { name, version } — EIP-712 domain for EIP-3009 signature verification
  const isSolana = isSolanaNetwork(shortNet);
  const extra = isSolana
    ? {
        feePayer: feePayerOverride || defaultFeePayer,
        ...(memo !== undefined ? { memo } : {}),
      }
    : { name, version };

  // v2 (CDP-native): minimal spec shape — `amount`, no v1 discovery fields.
  // Per https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md 5.1.2/7.1
  if (x402Version === 2) {
    return {
      scheme: 'exact',
      network: wireNetwork,
      amount: String(amount),
      asset,
      payTo,
      maxTimeoutSeconds: Number(maxTimeoutSeconds) || 120,
      extra,
    };
  }

  // v1 (XFuel SDK / ZAN): includes discovery fields for backward compatibility.
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
    extra,
  };
  if (outputSchema) req.outputSchema = outputSchema;
  return req;
}

/**
 * True if decoded blob is an SVM (Solana) payment with a partially-signed transaction.
 * SVM payments use { transaction: "<base64 versioned tx>" } instead of EVM's { authorization, signature }.
 * @x402/svm ExactSvmScheme produces this shape; PayAI /verify and /settle accept it unchanged.
 */
function isSvmPaymentPayload(decoded) {
  // SVM v2: { payload: { transaction: "..." } } or { transaction: "..." }
  const tx = decoded?.payload?.transaction || decoded?.transaction;
  return typeof tx === 'string' && tx.length > 0;
}

/**
 * Translate the payment blob → standard x402 `PaymentPayload`.
 * Accepts v1 (X-PAYMENT / XFuel SDK), v2 (PAYMENT-SIGNATURE / CDP-native), and SVM (Solana) headers.
 *
 * v1 (XFuel SDK) shape - needs reshape for ZAN/testnet facilitator:
 *   { authorization: { message: { from, to, ... }, signature }, ... }
 *   → Output: { x402Version, scheme, network, payload: { signature, authorization } }
 *
 * v2 (CDP-native EVM) shape - already spec-compliant, preserve structure:
 *   { x402Version: 2, accepted: { scheme, network, ... }, payload: { signature, authorization }, resource?, ... }
 *   → Output: preserve with `accepted` (NOT top-level scheme/network) per CDP v2 schema.
 *
 * SVM (Solana) shape - passthrough to PayAI unchanged:
 *   { x402Version: 2, accepted: { scheme, network, ... }, payload: { transaction: "<base64>" }, ... }
 *   → Output: preserve structure; PayAI /verify and /settle accept it directly.
 *   The `transaction` field is a base64-encoded partially-signed Solana versioned transaction.
 *   @x402/svm ExactSvmScheme produces this; do NOT try to extract authorization/signature.
 *
 * CDP v2 /verify rejects PaymentPayload with top-level `scheme`/`network`:
 *   400 'paymentPayload'_is_invalid:_must_match_one_of_[x402V2PaymentPayload...
 * The v2 schema requires `accepted` as a required field; scheme/network live INSIDE accepted.
 *
 * @param {Object} decoded - Decoded payment header blob
 * @param {Object} opts
 * @param {string} [opts.network] - Override network (v1) or merge into accepted (v2)
 * @param {string} [opts.resource] - Preferred resource URL (from bound challenge)
 * @param {Object} [opts.extensions] - Preferred extensions (from bound challenge)
 * @param {1|2} [opts.x402Version=1] - Protocol version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE)
 */
export function toPaymentPayload(decoded, { network, resource, extensions, x402Version = 1 } = {}) {
  if (!decoded) throw new Error('x402: payment header could not be decoded');

  // ────────────────────────────────────────────────────────────────────────────
  // SVM (Solana) passthrough: { payload: { transaction: "<base64>" } }
  // @x402/svm clients send a partially-signed versioned transaction that PayAI
  // /verify and /settle accept unchanged. Do NOT try to extract authorization.
  // Per x402 SVM spec, the transaction blob IS the payment — forward it as-is.
  // ────────────────────────────────────────────────────────────────────────────
  if (isSvmPaymentPayload(decoded) && x402Version === 2) {
    const acceptedFromHeader = decoded.accepted || {};

    // Slim `accepted` to spec fields only — same as EVM path but no EIP-712 domain.
    // Solana extra: feePayer (required), memo (optional but needed for Path 1 static validation).
    // Per x402 SVM spec: "If extra.memo is present, facilitator MUST require exactly one Memo ix
    // matching it." Dropping memo when the tx contains a Memo ix forces Path 2 (simulation).
    const incomingExtra = acceptedFromHeader.extra || {};
    const slimAccepted = {
      scheme: acceptedFromHeader.scheme,
      network: network || acceptedFromHeader.network,
      amount: acceptedFromHeader.amount,
      asset: acceptedFromHeader.asset,
      payTo: acceptedFromHeader.payTo,
      maxTimeoutSeconds: acceptedFromHeader.maxTimeoutSeconds,
      // Solana: forward feePayer + memo; drop challenge-binding fields (taskId, nonce, expiresAt).
      extra: {
        ...(incomingExtra.feePayer ? { feePayer: incomingExtra.feePayer } : {}),
        ...(incomingExtra.memo !== undefined ? { memo: incomingExtra.memo } : {}),
      },
    };

    // Payload is the transaction blob — forward unchanged.
    const result = {
      x402Version: 2,
      accepted: slimAccepted,
      payload: decoded.payload,  // { transaction: "<base64>" }
    };

    // Resource for PayAI cataloging (same pattern as EVM).
    const resourceUrl = catalogResourceUrl(resource) || catalogResourceUrl(decoded.resource);
    if (resourceUrl) {
      const decodedRes = (typeof decoded.resource === 'object') ? decoded.resource : {};
      result.resource = { ...decodedRes, url: resourceUrl };
    }
    const ext = (extensions && typeof extensions === 'object')
      ? extensions
      : (decoded.extensions && typeof decoded.extensions === 'object' ? decoded.extensions : null);
    if (ext) result.extensions = ext;
    return result;
  }

  // CDP-native v2: the header is already a spec-shaped PaymentPayload with
  // { accepted: { scheme, network, ... }, payload: { authorization, signature }, ... }.
  // Bankr and other CDP-native clients send this shape directly.
  const cdpPayload = decoded.payload;
  const isCdpNativeV2 = cdpPayload?.authorization?.from && cdpPayload?.signature;

  // ────────────────────────────────────────────────────────────────────────────
  // CDP-native v2: preserve the spec-compliant shape with `accepted` at top level.
  // Per https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md:
  //   PaymentPayload = { x402Version, accepted, payload, resource?, extensions? }
  // CDP's /verify schema rejects payloads with top-level scheme/network (v1 shape).
  //
  // IMPORTANT: Slim `accepted` to spec fields only before sending to CDP /verify.
  // Bankr and other CDP-native clients echo the entire 402 accepts[0] into their
  // PaymentPayload.accepted, which includes our challenge-binding fields that CDP
  // rejects: `maxAmountRequired`, `extra.taskId`, `extra.expiresAt`, `extra.nonce`.
  // Per Section 3.5 challenge binding stays in our store; CDP only sees EIP-712 extra.
  // ────────────────────────────────────────────────────────────────────────────
  if (isCdpNativeV2 && x402Version === 2) {
    // Start with the incoming accepted; fill in any missing fields from challenge.
    const acceptedFromHeader = decoded.accepted || {};

    // Slim `accepted` to spec fields only: scheme, network, amount, asset, payTo,
    // maxTimeoutSeconds, extra. Remove maxAmountRequired and challenge-binding
    // extra fields (taskId, expiresAt, nonce).
    // EVM: extra contains EIP-712 domain { name, version }.
    // Solana: extra contains { feePayer } — PayAI's transaction fee payer.
    const incomingExtra = acceptedFromHeader.extra || {};
    const acceptedNetwork = network || acceptedFromHeader.network;
    const isSolanaAccepted = isSolanaNetwork(acceptedNetwork);
    const slimAccepted = {
      scheme: acceptedFromHeader.scheme,
      network: acceptedNetwork,
      amount: acceptedFromHeader.amount,
      asset: acceptedFromHeader.asset,
      payTo: acceptedFromHeader.payTo,
      maxTimeoutSeconds: acceptedFromHeader.maxTimeoutSeconds,
      // Network-appropriate extra: feePayer for Solana, name+version for EVM.
      // Drop taskId/expiresAt/nonce (challenge binding) for both.
      extra: isSolanaAccepted
        ? (incomingExtra.feePayer ? { feePayer: incomingExtra.feePayer } : {})
        : { name: incomingExtra.name, version: incomingExtra.version },
    };

    // Normalize authorization fields (Bankr float-string fix):
    // - Coerce integer-equivalent floats ("1787321234.927" → error, "10000.0" → "10000")
    // - Coerce JSON numbers to integer strings
    // - Validate nonce format (64-hex without 0x → prefix, 32-hex → error)
    // This throws with a specific reason if validation fails (fail closed, not sent to CDP).
    const { normalizedPayload } = normalizeAuthorizationPayload(decoded.payload);

    const result = {
      x402Version: 2,
      accepted: slimAccepted,
      payload: normalizedPayload,  // Normalized: { signature, authorization }
    };

    // CDP catalogs only when settle carries paymentPayload.resource (absolute URL)
    // plus the echoed bazaar extension. Prefer the bound challenge.
    const resourceUrl = catalogResourceUrl(resource) || catalogResourceUrl(decoded.resource);
    if (resourceUrl) {
      // CDP expects resource as an object { url, description?, mimeType? } in v2.
      // If decoded.resource is already an object, merge; url from opts/challenge wins.
      const decodedRes = (typeof decoded.resource === 'object') ? decoded.resource : {};
      result.resource = { ...decodedRes, url: resourceUrl };
    }
    const ext = (extensions && typeof extensions === 'object')
      ? extensions
      : (decoded.extensions && typeof decoded.extensions === 'object' ? decoded.extensions : null);
    if (ext) result.extensions = ext;
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // XFuel SDK v1 / ZAN path: reshape into { scheme, network, payload } at top level.
  // This is the legacy shape the testnet facilitator and ZAN adapter expect.
  // ────────────────────────────────────────────────────────────────────────────
  let msg;
  let signature;

  if (isCdpNativeV2) {
    // CDP-native v2 blob but caller requested v1 wire format (shouldn't happen normally).
    msg = cdpPayload.authorization;
    signature = cdpPayload.signature;
  } else {
    // XFuel SDK v1: extract from decoded.authorization.message + decoded.authorization.signature
    const auth = decoded.authorization || {};
    msg = auth.message || auth;
    signature = auth.signature || decoded.signature;
  }

  if (!signature || !msg || !msg.from) {
    // This branch is for EVM payments (EIP-3009). SVM payments with { transaction }
    // are handled earlier by isSvmPaymentPayload(). If we reach here with neither
    // EVM authorization nor SVM transaction, the payment header is malformed.
    throw new Error('x402: payment header missing signature or authorization (EVM) or transaction (SVM)');
  }

  const wireVersion = x402Version === 2 ? 2 : 1;
  const accepted = decoded.accepted || {};
  const v1Payload = {
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

  // CDP catalogs only when settle carries paymentPayload.resource (absolute URL).
  const resourceUrl = catalogResourceUrl(resource) || catalogResourceUrl(decoded.resource);
  if (resourceUrl) v1Payload.resource = resourceUrl;
  const ext = (extensions && typeof extensions === 'object')
    ? extensions
    : (decoded.extensions && typeof decoded.extensions === 'object' ? decoded.extensions : null);
  if (ext) v1Payload.extensions = ext;
  return v1Payload;
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

/**
 * Slugify a CDP invalidMessage for inclusion in the 402 reason string.
 * Produces a URL-safe, human-readable slug for debugging (e.g. Bankr tweets).
 *
 * Example:
 *   "invalid signature: public key recovery code 171 is not in the valid range [27, 34]"
 *   → "recovery_code_171_not_in_valid_range_27_34"
 *
 * Rules:
 * - Remove common prefixes ("invalid signature:", "invalid:", etc.)
 * - Replace spaces with underscores, lowercase
 * - Remove special characters except underscores and alphanumerics
 * - Filter out long hex strings (signatures) — anything 0x + 20+ hex chars
 * - Truncate to maxLen chars (default 80)
 * - If result is empty or too short after filtering, return null
 *
 * @param {string|undefined} msg - The invalidMessage from CDP
 * @param {number} [maxLen=80] - Max length of the slug
 * @returns {string|null} - Slugified message or null if unusable
 */
export function slugifyInvalidMessage(msg, maxLen = 80) {
  if (!msg || typeof msg !== 'string') return null;

  let s = msg;

  // Remove common unhelpful prefixes (case-insensitive)
  s = s.replace(/^invalid\s+signature:\s*/i, '');
  s = s.replace(/^invalid:\s*/i, '');
  s = s.replace(/^error:\s*/i, '');

  // Remove long hex strings (signatures, hashes) — 0x followed by 20+ hex chars
  s = s.replace(/0x[0-9a-fA-F]{20,}/g, '');

  // Remove standalone long hex strings without 0x prefix (40+ hex chars likely a hash/sig)
  s = s.replace(/\b[0-9a-fA-F]{40,}\b/g, '');

  // Lowercase and replace non-alphanumeric (except spaces) with spaces
  s = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // Collapse multiple spaces into single space, trim
  s = s.replace(/\s+/g, ' ').trim();

  // Replace spaces with underscores
  s = s.replace(/\s/g, '_');

  // Remove leading/trailing underscores
  s = s.replace(/^_+|_+$/g, '');

  // Collapse multiple underscores
  s = s.replace(/_+/g, '_');

  // If too short (less than 5 chars), not useful
  if (s.length < 5) return null;

  // Truncate to maxLen, but try to break at an underscore
  if (s.length > maxLen) {
    const truncated = s.slice(0, maxLen);
    const lastUnderscore = truncated.lastIndexOf('_');
    // If there's an underscore in the last 20 chars, break there for cleaner output
    if (lastUnderscore > maxLen - 20) {
      s = truncated.slice(0, lastUnderscore);
    } else {
      s = truncated;
    }
  }

  return s || null;
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

/**
 * Extract authorization diagnostics from paymentPayload for logging on HTTP 400.
 * Does NOT log secrets (signature, raw header).
 * @returns {Object} Diagnostic info: from, to, value, validAfter, validBefore, nonce format
 */
function authorizationDiagnostics(paymentPayload) {
  // v2: paymentPayload.payload.authorization, v1: paymentPayload.payload.authorization
  const auth = paymentPayload?.payload?.authorization;
  if (!auth) return { authPresent: false };

  // Analyze nonce format
  const nonce = auth.nonce;
  let nonceFormat = { has0x: false, hexLen: 0 };
  if (nonce && typeof nonce === 'string') {
    nonceFormat.has0x = nonce.startsWith('0x') || nonce.startsWith('0X');
    const hexPart = nonceFormat.has0x ? nonce.slice(2) : nonce;
    nonceFormat.hexLen = hexPart.length;
  }

  return {
    authPresent: true,
    from: auth.from,
    to: auth.to,
    value: auth.value,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    nonceFormat,
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
 * For Solana payments, forward feePayer from the challenge or decoded.accepted.extra
 * to toPaymentRequirements so PayAI /verify receives it.
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
  // Solana: forward feePayer from challenge (stored from 402 issue) or incoming blob.
  const feePayer = challenge?.feePayer ?? accepted.extra?.feePayer;
  // Solana: forward memo from client blob for Path 1 static Memo ix validation.
  // Per x402 SVM spec: "If extra.memo is present, facilitator MUST require exactly one
  // Memo ix matching it." Dropping memo forces Path 2 (simulation) on some facilitators.
  const memo = accepted.extra?.memo;

  return toPaymentRequirements({
    network,
    amount,
    payTo,
    resource: challenge?.resource,
    taskId: challenge?.taskId,
    description: challenge?.description,
    outputSchema: challenge?.outputSchema,
    x402Version,
    feePayer,  // Solana-only; ignored by EVM path (uses name/version from usdcFor)
    memo,      // Solana-only; enables Path 1 static Memo validation
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
  } catch (payloadErr) {
    // Surface specific normalization errors (e.g. fractional validAfter, bytes16 nonce)
    // so Bankr sees a clear reason, not generic "payment_payload_invalid".
    const reason = payloadErr?.message?.startsWith('authorization_')
      ? payloadErr.message
      : 'payment_payload_invalid';
    return { valid: false, reason };
  }
  // Network-aware timeout: Solana facilitators (Dexter, PayAI) do on-chain
  // simulation and need longer timeouts than EVM/CDP. Per 2026-08-23 bugfix.
  const verifyTimeoutMs = facilitatorTimeout('verify', paymentRequirements.network);
  const t0 = Date.now();
  try {
    const { ok, status, data, elapsedMs, extensionResponses } = await callFacilitator('/verify', {
      gateway, apiKey, timeoutMs: verifyTimeoutMs,
      body: { x402Version: wireVersion, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      const cdpReason = data.invalidReason || data.errorReason || data.errorMessage || data.errorType;
      const cdpInvalidMessage = data.invalidMessage;
      // Log authorization field details on HTTP 400 for debugging (no secrets)
      const authDiag = authorizationDiagnostics(paymentPayload);
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.amount || paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: cdpReason,
          invalidMessage: cdpInvalidMessage,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
          // Bankr float-string debugging: authorization field details (no secrets)
          authorization: authDiag,
        },
        'x402 facilitator verify HTTP error',
      );
      // Surface the actual CDP invalidReason and invalidMessage when available.
      // Before: always returned generic `facilitator_http_400`.
      // After: returns `facilitator_http_400:invalid_exact_evm_payload_signature:recovery_code_171_not_in_27_34`
      // when CDP provides both invalidReason and invalidMessage.
      let reason = `facilitator_http_${status}`;
      if (cdpReason) {
        reason += `:${String(cdpReason).replace(/\s+/g, '_').slice(0, 50)}`;
      }
      const msgSlug = slugifyInvalidMessage(cdpInvalidMessage);
      if (msgSlug) {
        reason += `:${msgSlug}`;
      }
      return { valid: false, reason };
    }
    logBazaarResponses('/verify', extensionResponses, paymentPayload);
    if (!data.isValid) {
      logger.warn(
        {
          invalidReason: data.invalidReason,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.amount || paymentRequirements.maxAmountRequired,
          asset: paymentRequirements.asset,
        },
        'x402 facilitator verify rejected',
      );
    }
    return { valid: !!data.isValid, payer: data.payer || null, reason: data.invalidReason };
  } catch (err) {
    // Log gateway host (not secrets), elapsedMs, and network for debugging.
    // Per 2026-08-23 bugfix: previous catch only logged err.message.
    const elapsedMs = Date.now() - t0;
    let gatewayHost = null;
    try { gatewayHost = new URL(gateway).host; } catch { /* invalid URL */ }
    logger.warn(
      {
        err: err.message,
        gatewayHost,
        elapsedMs,
        timeoutMs: verifyTimeoutMs,
        network: paymentRequirements.network,
      },
      'x402 facilitator verify failed',
    );
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
  } catch (payloadErr) {
    // Surface specific normalization errors (e.g. fractional validAfter, bytes16 nonce)
    // so Bankr sees a clear reason, not generic "payment_payload_invalid".
    const reason = payloadErr?.message?.startsWith('authorization_')
      ? payloadErr.message
      : 'payment_payload_invalid';
    return { settled: false, reason };
  }
  // Network-aware timeout: Solana facilitators (Dexter, PayAI) do on-chain
  // simulation and need longer timeouts than EVM/CDP. Per 2026-08-23 bugfix.
  const settleTimeoutMs = facilitatorTimeout('settle', paymentRequirements.network);
  const t0 = Date.now();
  try {
    const { ok, status, data, elapsedMs, extensionResponses } = await callFacilitator('/settle', {
      gateway, apiKey, timeoutMs: settleTimeoutMs,
      body: { x402Version: wireVersion, paymentPayload, paymentRequirements },
    });
    if (!ok) {
      const cdpReason = data.invalidReason || data.errorReason || data.errorMessage || data.errorType;
      const cdpInvalidMessage = data.invalidMessage;
      // Log authorization field details on HTTP 400 for debugging (no secrets)
      const authDiag = authorizationDiagnostics(paymentPayload);
      logger.warn(
        {
          status,
          elapsedMs,
          network: paymentRequirements.network,
          payTo: paymentRequirements.payTo,
          amount: paymentRequirements.amount || paymentRequirements.maxAmountRequired,
          correlationId: data.correlationId,
          invalidReason: cdpReason,
          invalidMessage: cdpInvalidMessage,
          errKeys: Object.keys(data || {}),
          rawSnippet: typeof data._raw === 'string' ? data._raw.slice(0, 240) : JSON.stringify(data).slice(0, 240),
          // Bankr float-string debugging: authorization field details (no secrets)
          authorization: authDiag,
        },
        'x402 facilitator settle HTTP error',
      );
      // Surface the actual CDP invalidReason and invalidMessage when available.
      // Before: always returned generic `facilitator_http_400`.
      // After: returns `facilitator_http_400:invalid_exact_evm_payload_signature:recovery_code_171_not_in_27_34`
      // when CDP provides both invalidReason and invalidMessage.
      let reason = `facilitator_http_${status}`;
      if (cdpReason) {
        reason += `:${String(cdpReason).replace(/\s+/g, '_').slice(0, 50)}`;
      }
      const msgSlug = slugifyInvalidMessage(cdpInvalidMessage);
      if (msgSlug) {
        reason += `:${msgSlug}`;
      }
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
    // Log gateway host (not secrets), elapsedMs, and network for debugging.
    // Per 2026-08-23 bugfix: previous catch only logged err.message.
    const elapsedMs = Date.now() - t0;
    let gatewayHost = null;
    try { gatewayHost = new URL(gateway).host; } catch { /* invalid URL */ }
    logger.warn(
      {
        err: err.message,
        gatewayHost,
        elapsedMs,
        timeoutMs: settleTimeoutMs,
        network: paymentRequirements.network,
      },
      'x402 facilitator settle failed',
    );
    return { settled: false, reason: 'facilitator_error' };
  }
}
