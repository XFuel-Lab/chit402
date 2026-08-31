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

/** ERC-20 Transfer event topic (keccak256 of Transfer(address,address,uint256)) */
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Known USDC contract addresses by network. */
const USDC_ADDRESSES = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

/** Networks that use Solana rail (not EVM). */
const SOLANA_NETWORKS = new Set(['solana', 'solana-devnet', 'solana-mainnet']);

/**
 * Determine the rail from the network.
 * @param {string} network
 * @returns {'usdc'|'solana'}
 */
export function railFromNetwork(network) {
  const n = String(network || '').toLowerCase();
  if (SOLANA_NETWORKS.has(n) || n.startsWith('solana')) return 'solana';
  return 'usdc';
}

/**
 * True if network is EVM-based (can verify via getTransactionReceipt).
 */
export function isEvmNetwork(network) {
  const n = String(network || '').toLowerCase();
  return !SOLANA_NETWORKS.has(n) && !n.startsWith('solana');
}

/**
 * Build a verify function that reads the actual USDC Transfer event on-chain.
 * Verifies: tx succeeded, Transfer from payer → payTo for >= amount on USDC contract.
 *
 * @param {{ getTransactionReceipt: Function }} provider - EVM provider
 * @returns {Function|null} verify function for ingestForeignX402, or null if unavailable
 */
export function buildOnChainVerify(provider) {
  if (!provider || typeof provider.getTransactionReceipt !== 'function') {
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

    // Extract tx hash from paymentRef (format: "network:txHash")
    const parts = paymentRef.split(':');
    const txHash = parts.length > 1 ? parts.slice(1).join(':') : paymentRef;

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
      receipt = await provider.getTransactionReceipt(txHash);
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
 * Build a synthetic receipt for a foreign x402 payment.
 * This is NOT a merchant-attested receipt — HMAC means "XFuel recorded this."
 *
 * @param {object} params
 * @param {string} params.taskId - Synthetic task id for this ingest
 * @param {object} params.paymentRequired - { resource, amount, payTo, network?, asset? }
 * @param {object} params.paymentResponse - { tx, payer, network }
 * @param {string} params.rail - 'usdc' or 'solana'
 * @param {string} [params.signingSecret] - HMAC signing secret
 * @returns {object} Receipt-like object for ledger append
 */
export function buildForeignReceipt({
  taskId,
  paymentRequired,
  paymentResponse,
  rail,
  signingSecret = null,
}) {
  const route = extractRouteFromResource(paymentRequired.resource);
  const amount = String(paymentRequired.amount);
  const network = paymentResponse.network || paymentRequired.network || 'base';
  const paymentRef = `${network}:${paymentResponse.tx}`;

  const receipt = {
    schema: 'xfuel.receipt.v3',
    task_id: taskId,
    status: 'completed',
    proof_outcome: 'signed',
    foreign_x402: true,
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
    },
  };

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

  // Validate payment_required (the 402 context — not naked tx)
  const paymentRequired = body.payment_required || body.paymentRequired;
  const reqValid = validatePaymentRequired(paymentRequired);
  if (!reqValid.ok) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_payment_required',
      message: reqValid.reason,
    };
  }

  // Validate payment_response (the payment — not naked tx)
  const paymentResponse = body.payment_response || body.paymentResponse;
  const respValid = validatePaymentResponse(paymentResponse);
  if (!respValid.ok) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_payment_response',
      message: respValid.reason,
    };
  }

  // Build payment ref and determine rail
  const network = paymentResponse.network || paymentRequired.network || 'base';
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

  // Generate synthetic task id
  const taskId = generateForeignTaskId();

  // Build the foreign receipt with correct rail for network
  const receipt = buildForeignReceipt({
    taskId,
    paymentRequired,
    paymentResponse,
    rail,
    signingSecret,
  });

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
  });

  if (!appended.ok) {
    return {
      ok: false,
      status: 409,
      error: appended.code || 'append_failed',
      message: appended.reason,
    };
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

  return {
    ok: true,
    status: 201,
    body: {
      task_id: taskId,
      agent_id: id,
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
      },
      foreign_x402: true,
      recorded_at: appended.entry.recorded_at,
      signature: receipt.signature || null,
    },
  };
}

export default {
  ingestForeignX402,
  validatePaymentRequired,
  validatePaymentResponse,
  extractRouteFromResource,
  buildForeignReceipt,
  generateForeignTaskId,
  buildOnChainVerify,
  railFromNetwork,
  isEvmNetwork,
};
