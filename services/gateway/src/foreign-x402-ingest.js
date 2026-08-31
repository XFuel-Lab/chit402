/**
 * Foreign x402 Book Ingest — record an agent's arbitrary x402 spend.
 *
 * An agent paid someone else's 402 endpoint (not XFuel's). We verify the
 * payment on-chain, nullify/replay-protect the tx, and write a possession-
 * gated book row: hub=host, model=path, amount=atomic USDC.
 *
 * Per whitepaper §2: HMAC on a foreign row means "we recorded this," not
 * merchant attestation — unless they later send an offer-receipt.
 *
 * XFuel does NOT settle foreign payments. CDP/PayAI stay verify+settle.
 * AgentCash stays the signer/wallet. We do NOT become a wallet or Agent402.
 */

import crypto from 'crypto';
import logger from './logger.js';

/**
 * Build a verify function that checks if a tx exists on-chain.
 * Uses the provider's getTransactionReceipt to confirm the tx is mined.
 *
 * @param {{ getTransactionReceipt: Function }} provider
 * @returns {Function} verify function for ingestForeignX402
 */
export function buildOnChainVerify(provider) {
  if (!provider || typeof provider.getTransactionReceipt !== 'function') {
    return null;
  }

  return async function verifyOnChain({ paymentRef, payer, amount, payTo, network }) {
    if (!paymentRef) {
      return { valid: false, reason: 'paymentRef required' };
    }

    // Extract tx hash from paymentRef (format: "network:txHash")
    const parts = paymentRef.split(':');
    const txHash = parts.length > 1 ? parts.slice(1).join(':') : paymentRef;

    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { valid: false, reason: 'invalid tx hash format' };
    }

    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { valid: false, reason: 'transaction not found on-chain' };
      }
      if (receipt.status === 0) {
        return { valid: false, reason: 'transaction reverted' };
      }
      return { valid: true, txHash, blockNumber: receipt.blockNumber };
    } catch (err) {
      throw new Error(`on-chain verification failed: ${err.message}`);
    }
  };
}

/**
 * Replay-protection store for foreign x402 tx hashes.
 * In-memory for MVP; same pattern as challengeStore in x402-adapter.
 */
class ForeignTxNullifier {
  constructor() {
    this.spent = new Set();
  }

  isSpent(txRef) {
    return this.spent.has(String(txRef).toLowerCase());
  }

  markSpent(txRef) {
    this.spent.add(String(txRef).toLowerCase());
    return true;
  }
}

const foreignTxNullifier = new ForeignTxNullifier();

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
 * @param {string} [params.signingSecret] - HMAC signing secret
 * @returns {object} Receipt-like object for ledger append
 */
export function buildForeignReceipt({
  taskId,
  paymentRequired,
  paymentResponse,
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
      rail: 'usdc',
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

  // Build payment ref and check replay
  const network = paymentResponse.network || paymentRequired.network || 'base';
  const paymentRef = `${network}:${paymentResponse.tx}`;

  if (foreignTxNullifier.isSpent(paymentRef)) {
    return {
      ok: false,
      status: 409,
      error: 'duplicate_tx',
      message: 'This transaction has already been recorded',
    };
  }

  // Also check against the ledger for any existing entry with this ref
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

  // Build the foreign receipt
  const receipt = buildForeignReceipt({
    taskId,
    paymentRequired,
    paymentResponse,
    signingSecret,
  });

  // Append to ledger
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

  // Mark tx as spent for replay protection
  foreignTxNullifier.markSpent(paymentRef);

  logger.info({
    taskId,
    agentId: id,
    paymentRef,
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
        rail: 'usdc',
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

/**
 * Reset the foreign tx nullifier (for testing).
 */
export function resetForeignTxNullifier() {
  foreignTxNullifier.spent.clear();
}

export default {
  ingestForeignX402,
  validatePaymentRequired,
  validatePaymentResponse,
  extractRouteFromResource,
  buildForeignReceipt,
  generateForeignTaskId,
  resetForeignTxNullifier,
  buildOnChainVerify,
};
