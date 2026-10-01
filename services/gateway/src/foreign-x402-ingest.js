/**
 * Foreign x402 Book Ingest — record an agent's arbitrary x402 spend.
 *
 * An agent paid someone else's 402 endpoint (not XFuel's). We verify the
 * USDC transfer on-chain (read the Transfer event, match payer/payTo/amount),
 * then write a possession-gated book row: hub=host, model=path, amount.
 *
 * Per whitepaper §2: HMAC on a foreign row means "we recorded this," not
 * merchant attestation — unless they later send an offer-receipt.
 *
 * FAIL CLOSED: No row appends unless the USDC transfer on that `tx` matches
 * `payer`, `payTo`, `amount`, and `asset`. If we cannot read the transfer, 503.
 *
 * XFuel does NOT settle foreign payments. CDP/PayAI stay verify+settle.
 * AgentCash stays the signer/wallet. We do NOT become a wallet or Agent402.
 */

import crypto from 'crypto';
import { ethers } from 'ethers';
import logger from './logger.js';
import config from './config.js';
import { STAMP_FEE_UNITS } from './pricing.js';
import { parseNanoIngest, verifyNanoSend } from './nano-rail.js';
import { buildVerifyUrl, explorerUrlForRef, networkFromPaymentRef } from './receipt.js';
import { fromCaip2Network } from './x402-facilitator.js';
import {
  buildFulfillmentEnvelope,
  fulfillmentFieldsFromIngestBody,
} from './fulfillment-receipt.js';

/** ERC-20 Transfer event topic (keccak256 of Transfer(address,address,uint256)) */
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Known USDC contract addresses by network. */
const USDC_ADDRESSES = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

/** Base mainnet USDC. The per-tx Transfer check uses this contract. */
export const BASE_MAINNET_USDC = USDC_ADDRESSES.base;

/** Networks that use Solana rail (not EVM). */
const SOLANA_NETWORKS = new Set(['solana', 'solana-devnet', 'solana-mainnet']);

/**
 * Determine the rail from the network.
 * @param {string} network
 * @returns {'usdc'|'solana'}
 */
export function railFromNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'nano' || n === 'xno') return 'nano';
  if (SOLANA_NETWORKS.has(n) || n.startsWith('solana')) return 'solana';
  return 'usdc';
}

/**
 * True if network is EVM-based (can verify via getTransactionReceipt).
 */
export function isEvmNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (n === 'nano' || n === 'xno') return false;
  return !SOLANA_NETWORKS.has(n) && !n.startsWith('solana');
}

/** Cached Base provider for on-chain verification. Lazily created. */
let baseProvider = null;

/** @type {Function|null} Test-only override for HTTP integration tests (NODE_ENV=test). */
let foreignIngestVerifyOverride = null;

export function setForeignIngestVerifyForTests(fn) {
  foreignIngestVerifyOverride = typeof fn === 'function' ? fn : null;
}

export function resolveForeignIngestVerify(provider = null) {
  if (foreignIngestVerifyOverride) return foreignIngestVerifyOverride;
  return buildOnChainVerify(provider);
}

/**
 * Get or create the Base provider for on-chain USDC verification.
 * Uses config.settlement.rpcUrl (BASE_RPC_URL env var).
 * Returns null if no RPC URL is configured.
 */
export function getBaseProvider() {
  if (baseProvider) return baseProvider;

  const rpcUrl = config.settlement?.rpcUrl;
  if (!rpcUrl) {
    logger.warn('foreign-x402: BASE_RPC_URL not configured — on-chain verification unavailable');
    return null;
  }

  try {
    baseProvider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    logger.info({ rpcUrl: rpcUrl.replace(/\/\/[^@]+@/, '//***@') }, 'foreign-x402: Base provider initialized');
    return baseProvider;
  } catch (err) {
    logger.error({ err: err.message }, 'foreign-x402: failed to create Base provider');
    return null;
  }
}

/**
 * Build a verify function that reads the actual USDC Transfer event on-chain.
 * Verifies: tx succeeded, Transfer from payer → payTo for >= amount on USDC contract.
 *
 * If no provider is passed, uses the Base provider from config.settlement.rpcUrl.
 *
 * @param {{ getTransactionReceipt: Function }|null} [provider] - EVM provider (optional)
 * @returns {Function|null} verify function for ingestForeignX402, or null if unavailable
 */
export function buildOnChainVerify(provider = null) {
  // Use provided provider or fall back to Base provider from config
  const p = provider || getBaseProvider();
  if (!p || typeof p.getTransactionReceipt !== 'function') {
    return null;
  }

  return async function verifyUsdcTransfer({ paymentRef, payer, amount, payTo, network }) {
    if (!paymentRef) {
      return { valid: false, reason: 'paymentRef required' };
    }
    if (!payer || !payTo || amount == null) {
      return { valid: false, reason: 'payer, payTo, and amount are required' };
    }

    // Solana networks need a Solana provider, which we don't have
    if (!isEvmNetwork(network)) {
      throw new Error(`Solana transfer verification not yet supported (network: ${network})`);
    }

    // "base:0x…" or "eip155:8453:0x…" — the hash is the 0x word, not the CAIP prefix.
    const txHash = txHashFromPaymentRef(paymentRef);

    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { valid: false, reason: 'invalid tx hash format' };
    }

    // Resolve expected USDC contract for this network
    const netKey = String(network || 'base').toLowerCase();
    const usdcAddress = USDC_ADDRESSES[netKey];
    if (!usdcAddress) {
      throw new Error(`unknown USDC address for network: ${network}`);
    }

    let receipt;
    try {
      receipt = await p.getTransactionReceipt(txHash);
    } catch (err) {
      throw new Error(`failed to fetch tx receipt: ${err.message}`);
    }

    if (!receipt) {
      return { valid: false, reason: 'transaction not found on-chain' };
    }
    if (receipt.status === 0) {
      return { valid: false, reason: 'transaction reverted' };
    }

    // Parse logs for ERC-20 Transfer events from the USDC contract
    const expectedAmount = BigInt(String(amount));
    const expectedFrom = String(payer).toLowerCase();
    const expectedTo = String(payTo).toLowerCase();
    const usdcLower = usdcAddress.toLowerCase();

    let foundTransfer = false;
    let transferredAmount = 0n;

    for (const log of receipt.logs || []) {
      // Must be from the USDC contract
      if (log.address?.toLowerCase() !== usdcLower) continue;
      // Must be a Transfer event
      if (log.topics?.[0] !== ERC20_TRANSFER_TOPIC) continue;
      if (log.topics.length < 3) continue;

      // Decode indexed params: topics[1] = from, topics[2] = to
      const from = '0x' + log.topics[1].slice(26).toLowerCase();
      const to = '0x' + log.topics[2].slice(26).toLowerCase();

      // Decode data: amount (uint256)
      const value = BigInt(log.data || '0');

      // Check match
      if (from === expectedFrom && to === expectedTo) {
        transferredAmount += value;
        foundTransfer = true;
      }
    }

    if (!foundTransfer) {
      return {
        valid: false,
        reason: `no USDC Transfer from ${payer} to ${payTo} found in tx`,
      };
    }

    if (transferredAmount < expectedAmount) {
      return {
        valid: false,
        reason: `transferred ${transferredAmount} < expected ${expectedAmount}`,
      };
    }

    return {
      valid: true,
      txHash,
      blockNumber: receipt.blockNumber,
      verifiedAmount: transferredAmount.toString(),
    };
  };
}

/**
 * Reset the Base provider (for testing).
 */
export function resetBaseProvider() {
  baseProvider = null;
}

/**
 * Extract hub (host) and model (path) from a resource URL.
 * Per design: hub=host, model=path (no query string).
 *
 * @param {string} resource - The 402 resource URL (e.g. https://api.grokbot.app/v1/chat/completions)
 * @returns {{ hub: string|null, model: string|null }}
 */
export function extractRouteFromResource(resource) {
  if (!resource || typeof resource !== 'string') {
    return { hub: null, model: null };
  }
  try {
    const url = new URL(resource);
    return {
      hub: url.host || null,
      model: url.pathname || null,
    };
  } catch {
    return { hub: null, model: null };
  }
}

/**
 * Validate the payment_required envelope from a foreign 402.
 * Must have resource, amount, payTo — otherwise it's not a job.
 *
 * @param {object} paymentRequired - { resource, amount, payTo, network?, asset? }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validatePaymentRequired(paymentRequired) {
  if (!paymentRequired || typeof paymentRequired !== 'object') {
    return { ok: false, reason: 'payment_required is required' };
  }
  if (!paymentRequired.resource) {
    return { ok: false, reason: 'payment_required.resource is required' };
  }
  if (paymentRequired.amount == null || paymentRequired.amount === '') {
    return { ok: false, reason: 'payment_required.amount is required' };
  }
  if (!paymentRequired.payTo) {
    return { ok: false, reason: 'payment_required.payTo is required' };
  }
  return { ok: true };
}

/**
 * Validate the payment_response from the payment.
 * Must have tx (the settlement ref) and payer — naked tx is rejected.
 *
 * @param {object} paymentResponse - { tx, payer, network }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validatePaymentResponse(paymentResponse) {
  if (!paymentResponse || typeof paymentResponse !== 'object') {
    return { ok: false, reason: 'payment_response is required' };
  }
  if (!paymentResponse.tx) {
    return { ok: false, reason: 'payment_response.tx is required (naked tx hash rejected)' };
  }
  if (!paymentResponse.payer) {
    return { ok: false, reason: 'payment_response.payer is required (naked tx hash rejected)' };
  }
  return { ok: true };
}

/**
 * Pull the settlement hash out of a book ref.
 * `base:0x<64>` and `eip155:8453:0x<64>` both yield the 0x word.
 * Non-EVM refs keep the legacy "everything after the first colon" split.
 *
 * @param {string} paymentRef
 * @returns {string}
 */
export function txHashFromPaymentRef(paymentRef) {
  const raw = String(paymentRef || '');
  const evm = raw.match(/0x[0-9a-fA-F]{64}/);
  if (evm) return evm[0];
  const parts = raw.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : raw;
}

/**
 * Book network stored on the receipt. x402 v2 sends CAIP-2 (`eip155:8453`).
 * A colon in `payment.ref` would hide the tx hash from on-chain verify,
 * so known CAIP-2 ids become the short name (`base`).
 *
 * @param {string} [network]
 * @returns {string}
 */
export function bookNetwork(network) {
  return fromCaip2Network(network || 'base');
}

/**
 * Parse an x402 v2 PAYMENT-RESPONSE into the foreign-ingest payment_response.
 * Accepts the header value (standard or url-safe base64 JSON), a JSON string,
 * or the decoded object `{ success, transaction, network, payer }`.
 * `tx` is an alias for `transaction`. `success: false` is rejected.
 * Legacy `{ tx, payer, network? }` is unchanged aside from CAIP-2 → short network.
 *
 * @param {string|object} input
 * @returns {{ ok: true, paymentResponse: { tx: string, payer: string, network?: string } } | { ok: false, reason: string }}
 */
export function parseX402V2PaymentResponse(input) {
  const decoded = decodePaymentResponseInput(input);
  if (!decoded.ok) return decoded;

  const obj = decoded.value;
  if (obj.success === false) {
    const detail = stringField(obj.errorReason) || stringField(obj.error) || 'settlement failed';
    return { ok: false, reason: `PAYMENT-RESPONSE settlement failed: ${detail}` };
  }

  const tx = stringField(obj.transaction) || stringField(obj.tx);
  const payer = stringField(obj.payer);
  const networkRaw = stringField(obj.network);
  if (!tx) {
    return { ok: false, reason: 'payment_response.tx is required (naked tx hash rejected)' };
  }
  if (!payer) {
    return { ok: false, reason: 'payment_response.payer is required (naked tx hash rejected)' };
  }
  const v2 = obj.transaction != null && !stringField(obj.tx);
  if (v2 && !networkRaw) {
    return { ok: false, reason: 'PAYMENT-RESPONSE network is required' };
  }

  const paymentResponse = { tx, payer };
  if (networkRaw) paymentResponse.network = bookNetwork(networkRaw);
  const settled = atomicAmountField(obj.amount);
  if (settled) paymentResponse.amount = settled;
  return { ok: true, paymentResponse };
}

function atomicAmountField(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value.trim())) return value.trim();
  return '';
}

/** True when the body would record an `upto` ceiling because no settled amount was given. */
function uptoCeilingWithoutSettlement(paymentRequired) {
  if (!paymentRequired || typeof paymentRequired !== 'object') return false;
  if (paymentRequired.amount != null && paymentRequired.amount !== '') return false;
  const accepts = Array.isArray(paymentRequired.accepts) ? paymentRequired.accepts : [];
  if (accepts.some((entry) => entry && entry.scheme === 'exact')) return false;
  return accepts.some((entry) => entry && entry.scheme === 'upto');
}

/**
 * Flatten an x402 v2 PAYMENT-REQUIRED object into `{ resource, amount, payTo }`.
 * A challenge whose `resource` is already a URL string is returned as-is.
 *
 * @param {object} input
 * @returns {object}
 */
export function normalizePaymentRequired(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const resourceIsObject = input.resource && typeof input.resource === 'object';
  const accept = Array.isArray(input.accepts)
    ? (input.accepts.find((entry) => entry && entry.scheme === 'exact') || input.accepts[0])
    : null;
  if (!resourceIsObject && !accept) return input;
  if (!resourceIsObject && input.resource && input.amount != null && input.payTo) return input;

  let resource = input.resource;
  if (resourceIsObject) resource = typeof input.resource.url === 'string' ? input.resource.url : '';
  const amount = input.amount ?? accept?.amount ?? accept?.maxAmountRequired;
  const payTo = input.payTo || accept?.payTo;
  const network = input.network || accept?.network;
  return {
    resource,
    amount: amount == null ? amount : String(amount),
    payTo,
    ...(network ? { network: bookNetwork(String(network)) } : {}),
    asset: input.asset || accept?.asset || 'USDC',
  };
}

function decodePaymentResponseInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return { ok: true, value: input };
  }
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, reason: 'payment_response is required' };
  }
  const raw = input.trim();
  if (raw.startsWith('{')) {
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: 'PAYMENT-RESPONSE is not a settlement object' };
      }
      return { ok: true, value };
    } catch {
      return { ok: false, reason: 'PAYMENT-RESPONSE is not valid JSON' };
    }
  }
  try {
    const pad = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const value = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'PAYMENT-RESPONSE is not a settlement object' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'PAYMENT-RESPONSE is not valid base64 JSON' };
  }
}

function stringField(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Coalesce x402-shaped or minimal foreign-invoice bodies into payment_required + payment_response.
 * Minimal invoice: amount, payer, tx or payment_ref, payTo, plus resource | service_url | hub (+ optional model).
 *
 * @param {object} body
 * @returns {{ ok: boolean, paymentRequired?: object, paymentResponse?: object, reason?: string, error?: string }}
 */
export function normalizeIngestInput(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'body required' };
  }

  const nano = parseNanoIngest(body);
  if (nano) {
    if (!nano.ok) return { ok: false, reason: nano.reason };
    return {
      ok: true,
      rail: 'nano',
      nano: nano.value,
      fulfillmentMeta: fulfillmentFieldsFromIngestBody(body),
    };
  }

  const existingRequired = body.payment_required || body.paymentRequired;
  const existingResponse = body.payment_response
    || body.paymentResponse
    || body.payment_response_header
    || body['PAYMENT-RESPONSE'];
  if (existingRequired && existingResponse) {
    const parsed = parseX402V2PaymentResponse(existingResponse);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, error: 'invalid_payment_response' };
    const settledAmount = parsed.paymentResponse.amount;
    const paymentResponse = { ...parsed.paymentResponse };
    delete paymentResponse.amount;
    if (!settledAmount && uptoCeilingWithoutSettlement(existingRequired)) {
      return {
        ok: false,
        reason: 'upto PAYMENT-REQUIRED needs payment_response.amount for the settled transfer, not the authorized ceiling',
        error: 'invalid_payment_response',
      };
    }
    const normalizedRequired = normalizePaymentRequired(existingRequired);
    const paymentRequired = normalizedRequired && typeof normalizedRequired === 'object'
      ? { ...normalizedRequired }
      : normalizedRequired;
    if (settledAmount && paymentRequired && typeof paymentRequired === 'object') {
      paymentRequired.amount = settledAmount;
    }
    return {
      ok: true,
      paymentRequired,
      paymentResponse,
      fulfillmentMeta: fulfillmentFieldsFromIngestBody(body),
    };
  }

  const inv = body.fulfillment_invoice || body.foreign_invoice || body.foreign_settle || body.invoice;
  const flat = inv && typeof inv === 'object' ? inv : body;

  const amount = flat.amount;
  const payer = flat.payer;
  const payTo = flat.payTo || flat.pay_to;
  let tx = flat.tx || flat.payment_ref || flat.transaction;
  let network = bookNetwork(flat.network || 'base');

  if (amount == null || amount === '' || !payer || !payTo || !tx) {
    return {
      ok: false,
      reason: 'foreign invoice requires amount, payer, payTo, and tx or payment_ref',
    };
  }

  if (String(tx).includes(':') && !String(tx).startsWith('0x')) {
    const raw = String(tx);
    const hashMatch = raw.match(/0x[0-9a-fA-F]{64}$/);
    if (hashMatch) {
      const prefix = raw.slice(0, raw.length - hashMatch[0].length - 1);
      network = bookNetwork(prefix || network);
      tx = hashMatch[0];
    } else {
      const idx = raw.indexOf(':');
      network = bookNetwork(raw.slice(0, idx) || network);
      tx = raw.slice(idx + 1);
    }
  }

  let resource = flat.resource || flat.service_url || flat.serviceUrl;
  const hub = flat.hub;
  const model = flat.model;
  if (!resource && hub) {
    const host = String(hub).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const path = model
      ? (String(model).startsWith('/') ? String(model) : `/${model}`)
      : '/';
    resource = `https://${host}${path}`;
  }
  if (!resource) {
    return {
      ok: false,
      reason: 'foreign invoice requires resource, service_url, or hub (route context)',
    };
  }

  return {
    ok: true,
    paymentRequired: {
      resource,
      amount: String(amount),
      payTo,
      network,
      asset: flat.asset || 'USDC',
    },
    paymentResponse: {
      tx: String(tx),
      payer: String(payer),
      network,
    },
    fulfillmentMeta: fulfillmentFieldsFromIngestBody(body),
  };
}

/**
 * Public receipt view for GET /receipt/:taskId on foreign-ingest rows (ledger snapshot).
 */
export function buildPublicForeignIngestReceipt(snapshot, { baseUrl = '', reqHost = null } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const taskId = snapshot.task_id;
  if (!taskId) return null;
  const verifyUrl = buildVerifyUrl(baseUrl, taskId, { reqHost });
  const payment = snapshot.payment || {};
  const ref = payment.ref || null;
  const network = payment.network || networkFromPaymentRef(ref);
  return {
    ...snapshot,
    verify_url: verifyUrl,
    links: {
      self: verifyUrl,
      explorer: payment.explorer_url || explorerUrlForRef(ref),
    },
    payment: {
      ...payment,
      network,
      chain: payment.chain || (network === 'nano' ? 'nano' : undefined),
      explorer_url: payment.explorer_url || explorerUrlForRef(ref),
    },
    attestation_note:
      'Foreign ingest: Chit402 verified and recorded this payment — we did not execute the inference hop.',
    evidence: 'foreign_ingest',
  };
}

/**
 * Build a synthetic receipt for a foreign x402 payment.
 * This is NOT a merchant-attested receipt — HMAC means "XFuel recorded this."
 *
 * @param {object} params
 * @param {string} params.taskId - Synthetic task id for this ingest
 * @param {object} params.paymentRequired - { resource, amount, payTo, network?, asset? }
 * @param {object} params.paymentResponse - { tx, payer, network }
 * @param {string} params.rail - 'usdc' or 'solana'
 * @param {string} [params.signingSecret] - HMAC signing secret
 * @param {object} [params.paymentExtra] - rail-specific payment fields (applied before HMAC)
 * @param {object} [params.routeOverride] - replaces hub/model after resource parsing
 * @returns {object} Receipt-like object for ledger append
 */
export function buildForeignReceipt({
  taskId,
  paymentRequired,
  paymentResponse,
  rail,
  signingSecret = null,
  fulfillmentMeta = null,
  paymentExtra = null,
  routeOverride = null,
}) {
  const route = extractRouteFromResource(paymentRequired.resource);
  const amount = String(paymentRequired.amount);
  const network = bookNetwork(paymentResponse.network || paymentRequired.network || 'base');
  const paymentRef = `${network}:${paymentResponse.tx}`;
  const meta = fulfillmentMeta && typeof fulfillmentMeta === 'object' ? fulfillmentMeta : {};
  const fulfillment = buildFulfillmentEnvelope({
    jobKind: meta.jobKind,
    resource: paymentRequired.resource,
    intentId: meta.intentId,
    attemptIndex: meta.attemptIndex,
    payerWallet: paymentResponse.payer,
    paymentRef,
    outputCommitment: meta.outputCommitment,
    deliverableHash: meta.deliverableHash,
    omitDeliverable: meta.omitDeliverable,
    defaultJobKind: 'other',
  });

  const receipt = {
    schema: 'xfuel.receipt.v3',
    task_id: taskId,
    status: 'completed',
    proof_outcome: 'signed',
    foreign_x402: true,
    source: 'foreign_ingest',
    payment: {
      rail: rail || railFromNetwork(network),
      ref: paymentRef,
      collected: true,
      gross_amount: amount,
      net_amount: amount,
      fee_amount: '0',
      payer: paymentResponse.payer,
      payTo: paymentRequired.payTo,
      collected_at: new Date().toISOString(),
    },
    route: {
      model: route.model,
      hub: route.hub,
      provider: route.hub,
      resource: paymentRequired.resource,
      job_kind: fulfillment.intent.job_kind,
    },
    fulfillment,
  };

  if (paymentExtra && typeof paymentExtra === 'object') {
    Object.assign(receipt.payment, paymentExtra);
  }
  if (routeOverride && typeof routeOverride === 'object') {
    Object.assign(receipt.route, routeOverride);
  }

  if (signingSecret) {
    const payload = JSON.stringify([
      receipt.task_id,
      receipt.payment.rail,
      receipt.payment.ref,
      receipt.payment.gross_amount,
      receipt.foreign_x402,
    ]);
    const value = crypto.createHmac('sha256', signingSecret).update(payload).digest('hex');
    receipt.signature = {
      alg: 'HMAC-SHA256',
      scope: 'recorded',
      value: `sha256=${value}`,
    };
  }

  return receipt;
}

/**
 * Generate a synthetic task id for a foreign x402 ingest.
 * Format: foreign-x402-<timestamp>-<random>
 */
export function generateForeignTaskId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `foreign-x402-${ts}-${rand}`;
}

/**
 * Ingest a foreign x402 payment into the possession-gated book.
 *
 * @param {object} body - { payment_required, payment_response }
 * @param {object} deps - { ledger, registry, verify?, agentId, session, signingSecret? }
 * @returns {Promise<{ ok: boolean, status: number, body?: object, error?: string, message?: string }>}
 */
export async function ingestForeignX402(body = {}, {
  ledger,
  registry,
  verify = null,
  agentId,
  session = null,
  signingSecret = null,
  isDemo = false,
  baseUrl = '',
  reqHost = null,
  ensureStamp = null,
  commitStampWaiver = null,
  fetchImpl = null,
  rpcUrls = null,
} = {}) {
  // Demo keys never write to the book
  if (isDemo) {
    return {
      ok: false,
      status: 403,
      error: 'demo_rejected',
      message: 'Demo keys cannot write to the book',
    };
  }

  // Validate agent_id
  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_agent_id',
      message: 'Valid agent_id is required',
    };
  }

  // Verify possession (session must match the agent)
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Possession proof (session) is required',
    };
  }

  if (!registry || typeof registry.getBySession !== 'function') {
    return {
      ok: false,
      status: 503,
      error: 'service_unavailable',
      message: 'Registry not configured',
    };
  }

  const identity = registry.getBySession(session);
  if (!identity || identity.agent_id !== id) {
    return {
      ok: false,
      status: 403,
      error: 'forbidden',
      message: 'Session does not match agent_id',
    };
  }

  const normalized = normalizeIngestInput(body);
  if (!normalized.ok) {
    return {
      ok: false,
      status: 400,
      error: normalized.error || 'invalid_ingest_payload',
      message: normalized.reason,
    };
  }

  if (normalized.rail === 'nano') {
    return ingestNanoPayment({
      nano: normalized.nano,
      fulfillmentMeta: normalized.fulfillmentMeta || fulfillmentFieldsFromIngestBody(body),
      ledger,
      agentId: id,
      signingSecret,
      baseUrl,
      reqHost,
      ensureStamp,
      commitStampWaiver,
      fetchImpl,
      rpcUrls,
    });
  }

  const paymentRequired = normalized.paymentRequired;
  const fulfillmentMeta = normalized.fulfillmentMeta || fulfillmentFieldsFromIngestBody(body);
  const reqValid = validatePaymentRequired(paymentRequired);
  if (!reqValid.ok) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_payment_required',
      message: reqValid.reason,
    };
  }

  const paymentResponse = normalized.paymentResponse;
  const respValid = validatePaymentResponse(paymentResponse);
  if (!respValid.ok) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_payment_response',
      message: respValid.reason,
    };
  }

  // Build payment ref and determine rail. v2 CAIP-2 (`eip155:8453`) becomes `base`
  // so the ref stays `base:0x…` and on-chain verify can read the hash.
  const network = bookNetwork(paymentResponse.network || paymentRequired.network || 'base');
  const paymentRef = `${network}:${paymentResponse.tx}`;
  const rail = railFromNetwork(network);

  // Replay protection: ledger.findByRef is the persistent source of truth.
  // Per whitepaper: nullify tx via ledger ref + persist, not in-memory Set.
  if (ledger && typeof ledger.findByRef === 'function') {
    const existing = ledger.findByRef(paymentRef);
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: 'duplicate_ref',
        message: 'This payment reference is already in the book',
      };
    }
  }

  // Verify the payment on-chain via facilitator — FAIL CLOSED.
  // Per whitepaper §2: verify on-chain, do not settle. No row without verification.
  if (!verify || typeof verify !== 'function') {
    return {
      ok: false,
      status: 502,
      error: 'verify_unavailable',
      message: 'Payment verification is not configured — cannot ingest without on-chain verify',
    };
  }

  let verification;
  try {
    verification = await verify({
      paymentHeader: null,
      paymentRef,
      payer: paymentResponse.payer,
      amount: paymentRequired.amount,
      payTo: paymentRequired.payTo,
      network,
    });
  } catch (err) {
    logger.warn({ err: err.message, paymentRef }, 'foreign-x402: verification threw — rejecting (fail closed)');
    return {
      ok: false,
      status: 502,
      error: 'verify_failed',
      message: `Payment verification failed: ${err.message}`,
    };
  }

  if (!verification || verification.valid !== true) {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: verification?.reason || 'Payment verification did not confirm valid',
    };
  }

  // Stamp is $0.002 USDC paid by the submitter (x402 Base/Solana), or waived.
  // It must not call registry.setBudget — the ingested amount is already spend,
  // and debiting the cap as well reduced remaining twice.
  const stamp = await collectIngestStamp(ensureStamp);
  if (!stamp.ok) return stamp;

  // Generate synthetic task id
  const taskId = generateForeignTaskId();

  // Build the foreign receipt with correct rail for network
  const receipt = buildForeignReceipt({
    taskId,
    paymentRequired,
    paymentResponse,
    rail,
    signingSecret,
    fulfillmentMeta,
  });
  receipt.stamp = stampFields(stamp);

  // Append to ledger — this is the nullification; ledger dedupes by payment.ref
  if (!ledger || typeof ledger.append !== 'function') {
    return {
      ok: false,
      status: 503,
      error: 'service_unavailable',
      message: 'Ledger not configured',
    };
  }

  const appended = ledger.append(receipt, {
    payer: paymentResponse.payer,
    agentId: id,
    intentId: fulfillmentMeta.intentId || null,
    attemptIndex: fulfillmentMeta.attemptIndex ?? null,
  });

  if (!appended.ok) {
    return {
      ok: false,
      status: 409,
      error: appended.code || 'append_failed',
      message: appended.reason,
    };
  }

  if (stamp.waived && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }

  logger.info({
    taskId,
    agentId: id,
    paymentRef,
    rail,
    amount: paymentRequired.amount,
    hub: receipt.route.hub,
    model: receipt.route.model,
  }, 'foreign-x402: ingested');

  const verifyUrl = buildVerifyUrl(baseUrl, taskId, { reqHost });
  const stampBook = bookIngestStamp(ledger, { agentId: id, foreignTaskId: taskId, stamp });

  return {
    ok: true,
    status: 201,
    body: {
      task_id: taskId,
      agent_id: id,
      verify_url: verifyUrl,
      payment: {
        ref: paymentRef,
        rail,
        amount: paymentRequired.amount,
        collected: true,
      },
      route: {
        hub: receipt.route.hub,
        model: receipt.route.model,
        resource: paymentRequired.resource,
        job_kind: receipt.fulfillment?.intent?.job_kind ?? null,
      },
      foreign_x402: true,
      source: 'foreign_ingest',
      evidence: 'foreign_ingest',
      fulfillment: receipt.fulfillment || null,
      recorded_at: appended.entry.recorded_at,
      signature: receipt.signature || null,
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      stamp_waived: stamp.waived === true,
      stamp_payment_ref: stamp.settlement?.paymentRef || null,
      stamp_task_id: stampBook.task_id,
    },
  };
}

const STAMP_DUE_MESSAGE = 'Ingest stamp is $0.002 USDC (2000 atomic, 6 decimals) on Base or Solana, paid by the submitter. Prepaid budget is not debited.';

/**
 * Collect the stamp without touching prepaid budget.
 * When `ensureStamp` is omitted (direct unit calls), the row still records
 * the fee amount and does not debit budget. The HTTP door always passes
 * `ensureStamp`, which 402s unless x402 settlement or a pilot waiver applies.
 */
async function collectIngestStamp(ensureStamp) {
  if (typeof ensureStamp !== 'function') {
    return { ok: true, waived: false, settlement: null };
  }
  let stamp;
  try {
    stamp = await ensureStamp();
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: 'stamp_failed',
      message: `Stamp collection failed: ${err.message}`,
    };
  }
  if (!stamp || stamp.ok !== true) {
    return {
      ok: false,
      status: stamp?.status || 402,
      error: stamp?.error || 'stamp_payment_required',
      message: stamp?.message || STAMP_DUE_MESSAGE,
      challenge: stamp?.challenge || null,
    };
  }
  return {
    ok: true,
    waived: stamp.waived === true,
    settlement: stamp.settlement || null,
  };
}

function bookIngestStamp(ledger, { agentId, foreignTaskId, stamp }) {
  const paymentRef = stamp?.settlement?.paymentRef ? String(stamp.settlement.paymentRef) : null;
  if (!paymentRef || !ledger || typeof ledger.recordIngestStamp !== 'function') {
    return { booked: false, task_id: null };
  }
  const taskId = `ingest-stamp-${foreignTaskId}`;
  const recorded = ledger.recordIngestStamp({
    agentId,
    taskId,
    paymentRef,
    amount: stamp.settlement?.amount != null ? String(stamp.settlement.amount) : String(STAMP_FEE_UNITS),
    payer: stamp.settlement?.payer || stamp.settlement?.payerWallet || null,
    parentRef: foreignTaskId,
  });
  if (!recorded?.ok) {
    logger.warn({
      taskId,
      agentId,
      paymentRef,
      code: recorded?.code,
      reason: recorded?.reason,
    }, 'foreign-x402: ingest stamp row was not written');
    return { booked: false, task_id: null };
  }
  return { booked: true, task_id: taskId };
}

function stampFields(stamp) {
  return {
    fee_units: String(STAMP_FEE_UNITS),
    fee_usd: '0.002',
    currency: 'USDC',
    decimals: 6,
    paid_by: 'submitter',
    waived: stamp.waived === true,
    payment_ref: stamp.settlement?.paymentRef || null,
    budget_debited: false,
  };
}

function rejectDuplicate(existing) {
  if (!existing) return null;
  return {
    ok: false,
    status: 409,
    error: 'duplicate_ref',
    message: 'This payment reference is already in the book',
  };
}

async function ingestNanoPayment({
  nano,
  fulfillmentMeta,
  ledger,
  agentId,
  signingSecret,
  baseUrl,
  reqHost,
  ensureStamp,
  commitStampWaiver,
  fetchImpl,
  rpcUrls,
}) {
  const paymentRef = `nano:${nano.hash}`;
  if (ledger && typeof ledger.findByRef === 'function') {
    const dup = rejectDuplicate(ledger.findByRef(paymentRef));
    if (dup) return dup;
  }

  const verified = await verifyNanoSend({
    hash: nano.hash,
    recipient: nano.recipient,
    amountRaw: nano.amountRaw,
  }, {
    fetchImpl: fetchImpl || globalThis.fetch,
    ...(rpcUrls ? { rpcUrls } : {}),
  });
  if (!verified.ok) {
    return {
      ok: false,
      status: verified.status || 400,
      error: verified.error || 'payment_invalid',
      message: verified.message || 'Nano verification failed',
    };
  }

  const stamp = await collectIngestStamp(ensureStamp);
  if (!stamp.ok) return stamp;

  const taskId = generateForeignTaskId();
  const receipt = buildForeignReceipt({
    taskId,
    paymentRequired: {
      resource: verified.explorer_url,
      amount: verified.amountRaw,
      payTo: verified.recipient,
      network: 'nano',
      asset: 'XNO',
    },
    paymentResponse: {
      tx: verified.hash,
      payer: verified.sender,
      network: 'nano',
    },
    rail: 'nano',
    signingSecret,
    fulfillmentMeta,
    paymentExtra: {
      chain: 'nano',
      block_hash: verified.hash,
      amount_raw: verified.amountRaw,
      amount_xno: verified.amountXno,
      usd_estimate: verified.usd_estimate,
      explorer_url: verified.explorer_url,
      height: verified.height,
      confirmed: true,
      subtype: 'send',
    },
    routeOverride: {
      hub: 'nano',
      model: nano.description,
      provider: 'nano',
      resource: verified.explorer_url,
      chain: 'nano',
      description: nano.description,
    },
  });
  receipt.stamp = stampFields(stamp);

  return commitForeignRow({
    receipt,
    ledger,
    agentId,
    payer: verified.sender,
    fulfillmentMeta,
    paymentRef,
    rail: 'nano',
    amount: verified.amountRaw,
    baseUrl,
    reqHost,
    stamp,
    commitStampWaiver,
    paymentView: {
      ref: paymentRef,
      rail: 'nano',
      chain: 'nano',
      amount: verified.amountRaw,
      amount_raw: verified.amountRaw,
      amount_xno: verified.amountXno,
      block_hash: verified.hash,
      usd_estimate: verified.usd_estimate,
      explorer_url: verified.explorer_url,
      collected: true,
    },
  });
}

async function commitForeignRow({
  receipt,
  ledger,
  agentId,
  payer,
  fulfillmentMeta,
  paymentRef,
  rail,
  amount,
  baseUrl,
  reqHost,
  stamp,
  commitStampWaiver,
  paymentView,
}) {
  if (!ledger || typeof ledger.append !== 'function') {
    return {
      ok: false,
      status: 503,
      error: 'service_unavailable',
      message: 'Ledger not configured',
    };
  }

  const appended = ledger.append(receipt, {
    payer,
    agentId,
    intentId: fulfillmentMeta?.intentId || null,
    attemptIndex: fulfillmentMeta?.attemptIndex ?? null,
  });
  if (!appended.ok) {
    return {
      ok: false,
      status: 409,
      error: appended.code || 'append_failed',
      message: appended.reason,
    };
  }

  if (stamp?.waived && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }

  const taskId = receipt.task_id;
  const stampBook = bookIngestStamp(ledger, { agentId, foreignTaskId: taskId, stamp });
  logger.info({
    taskId,
    agentId,
    paymentRef,
    rail,
    amount,
    hub: receipt.route.hub,
    model: receipt.route.model,
  }, 'foreign-x402: ingested');

  const verifyUrl = buildVerifyUrl(baseUrl, taskId, { reqHost });
  return {
    ok: true,
    status: 201,
    body: {
      task_id: taskId,
      agent_id: agentId,
      verify_url: verifyUrl,
      payment: paymentView || {
        ref: paymentRef,
        rail,
        amount,
        collected: true,
      },
      route: {
        hub: receipt.route.hub,
        model: receipt.route.model,
        resource: receipt.route.resource,
        job_kind: receipt.fulfillment?.intent?.job_kind ?? null,
        description: receipt.route.description || null,
      },
      foreign_x402: true,
      source: 'foreign_ingest',
      evidence: 'foreign_ingest',
      fulfillment: receipt.fulfillment || null,
      recorded_at: appended.entry.recorded_at,
      signature: receipt.signature || null,
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      stamp_waived: stamp?.waived === true,
      stamp_payment_ref: stamp?.settlement?.paymentRef || null,
      stamp_task_id: stampBook.task_id,
    },
  };
}

export default {
  ingestForeignX402,
  normalizeIngestInput,
  parseX402V2PaymentResponse,
  normalizePaymentRequired,
  txHashFromPaymentRef,
  bookNetwork,
  validatePaymentRequired,
  validatePaymentResponse,
  extractRouteFromResource,
  buildForeignReceipt,
  buildPublicForeignIngestReceipt,
  generateForeignTaskId,
  buildOnChainVerify,
  getBaseProvider,
  resetBaseProvider,
  railFromNetwork,
  isEvmNetwork,
};
