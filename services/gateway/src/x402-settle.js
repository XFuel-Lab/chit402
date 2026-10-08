/**
 * Enforced x402 settlement. Requirements, payee, network, and amount come from
 * the server-issued challenge and the confirmed chain transfer.
 */
import crypto from 'node:crypto';
import logger from './logger.js';
import { verifyPayment, settlePayment, challengeStore as defaultStore } from './x402-adapter.js';
import { isSolanaNetwork, toCaip2Network } from './x402-facilitator.js';
import {
  assertX402Boot,
  bindingEnforced,
  clientPaymentCode,
  noteUnboundUse,
  recordRefusal,
  samePayee,
  userAgentOf,
} from './x402-flags.js';
import { normalizePaymentRef, sameNetwork, canonicalNetwork } from './payment-ref.js';
import { confirmSettlement, facilitatorFieldsOk, readEvmAuthorization } from './x402-chain.js';
import { challengeStoreFailed, getActiveChallengeStore } from './x402-durable-store.js';
import {
  verifyIssuanceBindAtSettle,
  buildIssuanceCommitmentPublic,
  buildDisputeWindow,
  fetchBaseL1Anchor,
} from './issuance-commitment.js';

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

export function quoteBodyHash(body) {
  return crypto.createHash('sha256').update(stable(body ?? {})).digest('hex');
}

export function assertConfirmedSettlement(decision) {
  if (!decision || decision.kind !== 'settled' || decision.confirmed !== true) {
    const err = new Error('settlement is not confirmed');
    err.code = 'settle_unconfirmed';
    throw err;
  }
  return decision;
}

function fail(reason, extra = {}) {
  return { kind: 'failed', reason, code: clientPaymentCode(reason), preSettle: extra.preSettle === true, retryAfter: extra.retryAfter };
}

function expectedResourceOf({ resource, baseUrl }) {
  if (resource) return String(resource).replace(/\/$/, '');
  if (baseUrl) return `${String(baseUrl).replace(/\/$/, '')}/task-request`;
  return '/task-request';
}

function housePayee(cfg, network, payToOverride) {
  if (payToOverride) return payToOverride;
  if (isSolanaNetwork(network)) return cfg.solana?.payTo || null;
  return cfg.payTo || null;
}

function networkAllowed(network, cfg) {
  if (!network) return false;
  const allowed = [cfg.network, cfg.solana?.enabled ? cfg.solana.network : null].filter(Boolean);
  return allowed.some((n) => sameNetwork(n, network));
}

function blobNetwork(paymentHeader) {
  try {
    const raw = paymentHeader.trim().startsWith('{')
      ? JSON.parse(paymentHeader)
      : JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    return raw?.accepted?.network || raw?.network || null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<object>} handshake decision
 */
export async function settleBoundPayment({
  req,
  taskId,
  cfg,
  priceBody,
  amount,
  baseUrl,
  resource,
  l1Anchor,
  quoteOpts,
  expectedPayer,
  payTo,
  strictTaskId = false,
  paymentHeader,
  clientVersion,
  nonce,
  store = null,
  resolveQuote = null,
}) {
  try {
    assertX402Boot(cfg);
  } catch (err) {
    return fail('gateway_not_configured');
  }
  if (!bindingEnforced(cfg)) {
    noteUnboundUse('settleBoundPayment', { taskId });
    return null;
  }
  if (challengeStoreFailed()) return fail('gateway_not_configured');

  const active = store || cfg.store || getActiveChallengeStore() || defaultStore;

  if (!nonce) return refused(req, 'challenge_required', { preSettle: true });
  if (active.isSpent(nonce)) return refused(req, 'payment_replayed', { preSettle: true });
  const challenge = active.get(nonce);
  if (!challenge || challenge.state === 'unknown') {
    return refused(req, challenge?.state === 'unknown' ? 'settle_unconfirmed' : 'challenge_required', { preSettle: true });
  }
  if (!networkAllowed(challenge.network, cfg)) {
    return refused(req, 'network_not_accepted', { preSettle: true });
  }
  const blobNet = blobNetwork(paymentHeader);
  if (blobNet && !sameNetwork(blobNet, challenge.network)) {
    return refused(req, 'network_not_accepted', { preSettle: true });
  }

  const solana = isSolanaNetwork(challenge.network);
  const expectedPayTo = housePayee(cfg, challenge.network, payTo);
  if (!expectedPayTo || !samePayee(challenge.payTo, expectedPayTo, { solana })) {
    return refused(req, 'challenge_mismatch', { preSettle: true });
  }
  const resourceWant = expectedResourceOf({ resource, baseUrl });
  const resourceHave = challenge.resource ? String(challenge.resource).replace(/\/$/, '') : '';
  if (resourceHave && resourceWant && resourceHave !== resourceWant) {
    return refused(req, 'challenge_mismatch', { preSettle: true });
  }
  if (strictTaskId && challenge.taskId !== taskId) {
    return refused(req, 'challenge_mismatch', { preSettle: true });
  }

  let routeQuote = challenge.amount;
  if (amount != null) routeQuote = String(amount);
  else if (challenge.quoteBodyHash && challenge.quoteBodyHash === quoteBodyHash(priceBody)) {
    routeQuote = String(challenge.amount);
  } else if (typeof resolveQuote === 'function') {
    try {
      routeQuote = String(await resolveQuote());
    } catch {
      return refused(req, 'challenge_mismatch', { preSettle: true });
    }
  }
  try {
    if (BigInt(String(challenge.amount)) < BigInt(String(routeQuote))) {
      return refused(req, 'challenge_mismatch', { preSettle: true });
    }
  } catch {
    return refused(req, 'challenge_mismatch', { preSettle: true });
  }

  const authEarly = readEvmAuthorization(paymentHeader);
  const authKeyEarly = !solana && authEarly?.from && authEarly?.nonce
    ? `${canonicalNetwork(challenge.network)}|${String(challenge.asset || '').toLowerCase()}|${String(authEarly.from).toLowerCase()}|${String(authEarly.nonce).toLowerCase()}`
    : null;
  if (authKeyEarly && active.isAuthSpent(authKeyEarly)) {
    return refused(req, 'payment_replayed', { preSettle: true });
  }

  const owner = `${taskId}:${nonce}`;
  const claim = active.claim(nonce, owner);
  if (!claim.ok) {
    return refused(req, claim.reason, {
      preSettle: true,
      retryAfter: claim.reason === 'payment_in_flight' ? 2 : undefined,
    });
  }

  const gwOpts = {
    provider: (cfg.facilitatorProvider || 'zan').toLowerCase() === 'x402' ? 'x402' : 'zan',
    gatewayUrl: (cfg.facilitatorProvider || 'zan') === 'zan' ? cfg.gatewayUrl : (cfg.facilitatorUrl || null),
    apiKey: cfg.apiKey,
    store: active,
    network: challenge.network,
    solanaFacilitatorUrl: cfg.solana?.facilitatorUrl || null,
    cfg,
    nonce,
    x402Version: clientVersion,
    allowUnbound: false,
    deferSpent: true,
  };

  const release = () => { try { active.release(nonce, owner); } catch { /* already spent */ } };
  const pend = (why) => {
    try { active.markUnknown(nonce); } catch { /* store */ }
    try {
      active.recordPending({
        nonce,
        taskId,
        why,
        network: challenge.network,
        payTo: expectedPayTo,
      });
    } catch { /* store */ }
  };

  const verified = await verifyPayment(paymentHeader, gwOpts);
  if (!verified.valid) {
    release();
    return refused(req, clientPaymentCode(verified.reason || 'verify_failed'));
  }

  let bindCheck = null;
  if (challenge.issuance_bind?.required) {
    bindCheck = verifyIssuanceBindAtSettle({
      storedBind: challenge.issuance_bind,
      paymentHeader,
      challengeNonce: nonce,
      settlementContract: challenge.asset,
    });
    if (!bindCheck.ok) {
      release();
      return fail(bindCheck.reason);
    }
  }

  const settled = await settlePayment(paymentHeader, gwOpts);
  if (!settled.settled) {
    const maybeSent = settled.reason === 'gateway_error' || settled.reason === 'facilitator_error';
    if (maybeSent) pend('settle_failed');
    else release();
    return refused(req, clientPaymentCode(settled.reason || 'settle_failed'));
  }

  const fields = {
    ...settled,
    success: settled.success !== undefined ? settled.success : settled.settled === true,
    transaction: settled.transaction || settled.txRef,
    network: settled.network || toCaip2Network(challenge.network),
  };
  // ZAN mocks echo the short network. Accept it when it matches the challenge.
  if (!fields.network) fields.network = challenge.network;
  if (!facilitatorFieldsOk(fields, challenge)) {
    pend('facilitator_fields');
    return refused(req, 'settle_unconfirmed');
  }

  const auth = readEvmAuthorization(paymentHeader);
  if (!solana && auth?.from && fields.payer && !samePayee(auth.from, fields.payer)) {
    pend('payer_field');
    return refused(req, 'settle_unconfirmed');
  }

  const norm = normalizePaymentRef(challenge.network, fields.transaction);
  if (!norm.ok) {
    pend('bad_tx');
    return refused(req, 'settle_unconfirmed');
  }
  if (active.isTxSpent(norm.key)) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    const prior = typeof active.txFactsOf === 'function' ? active.txFactsOf(norm.key) : null;
    // A confirmed transfer already in the book is an idempotent replay, not a
    // second collect. A transfer marked spent without confirmation stays refused.
    if (prior?.amount && prior.payer && prior.payTo) {
      return {
        kind: 'settled',
        confirmed: true,
        paymentRef: norm.key,
        settledAmount: String(prior.amount),
        payerWallet: prior.payer,
        payTo: prior.payTo,
        asset: challenge.asset,
        taskId,
        replay: true,
        settlementEvidence: prior.evidence || null,
      };
    }
    return refused(req, 'payment_replayed');
  }
  const authKey = !solana && auth?.from && auth?.nonce
    ? `${norm.network}|${String(challenge.asset || '').toLowerCase()}|${String(auth.from).toLowerCase()}|${String(auth.nonce).toLowerCase()}`
    : null;
  if (authKey && active.isAuthSpent(authKey)) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    return refused(req, 'payment_replayed');
  }

  const chain = await confirmSettlement({
    challenge,
    facilitator: fields,
    paymentHeader,
    expectedPayTo,
    cfg: {
      ...cfg,
      baseRpcUrl: cfg.baseRpcUrl || cfg.rpcUrl || null,
      solanaRpcUrl: cfg.solanaRpcUrl || cfg.solana?.rpcUrl || null,
    },
  });
  if (!chain.ok) {
    pend(chain.pending ? 'awaiting_finality' : 'chain_mismatch');
    return refused(req, 'settle_unconfirmed');
  }
  let chainAmount;
  try { chainAmount = BigInt(String(chain.amount)); } catch { chainAmount = 0n; }
  let quote;
  try { quote = BigInt(String(routeQuote)); } catch { quote = 0n; }
  if (chainAmount < quote) {
    pend('underpaid');
    return refused(req, 'settle_unconfirmed');
  }
  if (!samePayee(chain.payTo, expectedPayTo, { solana })) {
    pend('payee');
    return refused(req, 'settle_unconfirmed');
  }
  if (expectedPayer && !samePayee(chain.payer, expectedPayer, { solana })) {
    active.markSpent(nonce, { txRef: norm.key, payer: chain.payer, rejected: 'payer_mismatch' });
    active.markTxSpent(norm.key);
    return refused(req, 'payer_mismatch');
  }

  active.markSpent(nonce, {
    txRef: norm.key,
    amount: chain.amount,
    payer: chain.payer,
    payTo: chain.payTo,
    blockNumber: chain.blockNumber || null,
    logIndex: chain.logIndex ?? null,
    slot: chain.slot ?? null,
  });
  active.markTxSpent(norm.key, {
    amount: String(chain.amount),
    payer: chain.payer,
    payTo: chain.payTo,
    evidence: {
      blockNumber: chain.blockNumber ?? null,
      logIndex: chain.logIndex ?? null,
      slot: chain.slot ?? null,
    },
  });
  if (authKey) active.markAuthSpent(authKey, norm.key);

  let issuance_commitment = null;
  let dispute_window = null;
  if (bindCheck?.ok) {
    issuance_commitment = buildIssuanceCommitmentPublic(bindCheck.bind, bindCheck.commitment);
    issuance_commitment.authorization = bindCheck.authorization;
    try {
      const anchor = await fetchBaseL1Anchor(l1Anchor);
      dispute_window = buildDisputeWindow({
        chainId: anchor.chain_id,
        anchorBlock: anchor.block_number,
        anchorTimestamp: anchor.timestamp,
        durationSec: cfg.issuanceDisputeWindowSec,
        anchorSource: anchor.anchor_source || null,
      });
    } catch (err) {
      logger.warn({ err: err.message, taskId }, 'x402: dispute window anchor failed');
      return fail('dispute_window_anchor_failed');
    }
  }

  return {
    kind: 'settled',
    confirmed: true,
    paymentRef: norm.key,
    settledAmount: String(chain.amount),
    payerWallet: chain.payer,
    payTo: chain.payTo,
    asset: challenge.asset || 'USDC',
    taskId: strictTaskId ? taskId : (challenge.taskId || taskId),
    issuance_commitment,
    dispute_window,
    settlementEvidence: {
      blockNumber: chain.blockNumber || null,
      logIndex: chain.logIndex ?? null,
      slot: chain.slot ?? null,
    },
  };
}

function refused(req, reason, extra = {}) {
  const code = ['challenge_required', 'challenge_mismatch', 'network_not_accepted', 'payment_replayed', 'payment_in_flight', 'settle_unconfirmed', 'payer_mismatch', 'stamp_underpaid', 'verify_failed', 'settle_failed', 'gateway_not_configured', 'invalid_payment_ref'].includes(reason)
    ? reason
    : clientPaymentCode(reason);
  recordRefusal(code, userAgentOf(req));
  return {
    kind: 'failed',
    reason: code,
    code,
    preSettle: extra.preSettle === true,
    retryAfter: extra.retryAfter,
  };
}

export function reconcilePending(store, readerResults = []) {
  const pending = store.listPending();
  const out = [];
  for (const row of pending) {
    const match = readerResults.find((r) => r.nonce === row.nonce);
    if (!match) continue;
    if (match.ok) store.updatePending(row.id, { status: 'confirmed_internal' });
    else store.updatePending(row.id, { status: 'refund_flagged' });
    out.push(store.listPending().find((p) => p.id === row.id));
  }
  return out;
}
