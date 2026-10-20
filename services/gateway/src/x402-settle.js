/**
 * Enforced x402 settlement. Requirements, payee, network, and amount come from
 * the server-issued challenge and the confirmed chain transfer.
 */
import crypto from 'node:crypto';
import logger from './logger.js';
import { verifyPayment, settlePayment, challengeStore as defaultStore } from './x402-adapter.js';
import { decodePaymentHeader, isSolanaNetwork, toCaip2Network, toPaymentPayload } from './x402-facilitator.js';
import {
  assertX402Boot,
  bindingEnforced,
  clientPaymentCode,
  noteUnboundUse,
  recordRefusal,
  samePayee,
  truncateWallet,
  userAgentOf,
} from './x402-flags.js';
import { normalizePaymentRef, sameNetwork, canonicalNetwork } from './payment-ref.js';
import { canonicalAuthNonce, confirmSettlement, facilitatorFieldsOk, readEvmAuthorization, getChainReaderForTests, settlementRefusal, settlementSolanaRpcUrl } from './x402-chain.js';
import { recordReceiptFailure } from './receipt-failures.js';
import { arcAssetAllowed, arcRefused, evmRpcUrlFor, isArcId } from './arc-rail.js';
import { challengeStoreFailed, getActiveChallengeStore } from './x402-durable-store.js';
import {
  verifyIssuanceBindAtSettle,
  buildIssuanceCommitmentPublic,
  buildDisputeWindow,
  fetchBaseL1Anchor,
} from './issuance-commitment.js';
import { atomicUnits, canonicalPaidRoute } from './paid-route.js';
import {
  abortServedReceipt,
  armServedReceipt,
  REPLAY_WAIT_TIMEOUT,
  replayBytesReady,
  replayWaiterMs,
} from './paid-response-replay.js';
import {
  LATE_RETRY_AFTER_SEC,
  evmAuthKey,
  lateIssueEnabled,
  lateTupleFrom,
  lateVerifyUrl,
  noteLateInlineIssued,
  openLateSubmission,
  lateAdmissionCapped,
  resumeLateIssue,
} from './late-issue.js';

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
  // Arc ids are refused unless ARC_RAIL_ENABLED is on and the chain is enabled.
  if (arcRefused(network)) return false;
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

/** Base Sepolia USDC. Naming this asset on a Base challenge is not mainnet. */
const BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';

function evmAssetAddress(raw) {
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function svmTransaction(decoded) {
  const tx = decoded?.payload?.transaction || decoded?.transaction;
  return typeof tx === 'string' && tx.length > 0 ? tx : null;
}

function integerAmount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'bigint') return raw >= 0n ? raw.toString() : null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) return null;
    return String(raw);
  }
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  if (/^\d+\.0+$/.test(s)) return s.slice(0, s.indexOf('.'));
  return null;
}

/**
 * Pre-settle amount guard. Keyed on the pinned challenge network, never the blob shape.
 * One function for the handshake and any later issuer of the same settlement.
 * @returns {{ amount: string|null } | { refuse: true }}
 */
export function boundSettledAmount(header, x402Version, live) {
  const decoded = decodePaymentHeader(header);
  if (!decoded) return { amount: null };
  const svm = svmTransaction(decoded);
  if (isSolanaNetwork(live.network)) {
    if (!svm) return { refuse: true };
    return { amount: integerAmount(live.amount) };
  }
  if (svm) return { refuse: true };
  let sent;
  try {
    sent = toPaymentPayload(decoded, { x402Version: x402Version === 2 ? 2 : 1 });
  } catch {
    return { amount: null };
  }
  const auth = sent?.payload?.authorization;
  if (!auth) return { amount: null };
  const value = integerAmount(auth.value);
  if (value == null) return { refuse: true };
  return { amount: value };
}

/** Recipients inside the signed authorization. Accepts-field payees are not requirements. */
function signedRecipients(decoded) {
  if (!decoded || typeof decoded !== 'object') return [];
  const found = [];
  const push = (value) => {
    if (value != null && value !== '') found.push(value);
  };
  push(decoded.payload?.authorization?.to);
  const auth = decoded.authorization;
  if (auth && typeof auth === 'object') {
    push(auth.to);
    if (auth.message && typeof auth.message === 'object') push(auth.message.to);
  }
  return found;
}

function declaredEvmAsset(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;
  const candidates = [
    decoded.accepted?.asset,
    decoded.asset,
    decoded.authorization?.domain?.verifyingContract,
  ];
  for (const candidate of candidates) {
    const addr = evmAssetAddress(candidate);
    if (addr) return addr;
  }
  return null;
}

/**
 * @returns {Promise<object>} handshake decision
 */
const inflightTx = new Set();
const inflightAuth = new Set();
/** In-process waiters for a challenge that is already settling. */
const inflightByNonce = new Map();

function idempotentReplay(decision) {
  if (!decision || decision.kind !== 'settled') return null;
  return {
    ...decision,
    kind: 'settled',
    confirmed: true,
    replay: true,
    idempotentReplay: true,
  };
}

/** Original confirmed settlement for a spent challenge. Refusals are not receipts. */
function settlementReplay(rec, resourceHave) {
  const settlement = rec?.settlement;
  if (!settlement || typeof settlement !== 'object') return null;
  if (settlement.replay === true || settlement.rejected) return null;
  if (!settlement.txRef || settlement.amount == null || settlement.amount === '') return null;
  return {
    kind: 'settled',
    confirmed: true,
    paymentRef: settlement.txRef,
    paymentHash: settlement.paymentHash || null,
    route: resourceHave,
    quotedAmount: String(rec.amount),
    settledAmount: String(settlement.amount),
    payerWallet: settlement.payer || null,
    payTo: settlement.payTo || rec.payTo || null,
    asset: rec.asset || 'USDC',
    taskId: rec.taskId || null,
    issuance_commitment: null,
    dispute_window: null,
    settlementEvidence: {
      blockNumber: settlement.blockNumber || null,
      logIndex: settlement.logIndex ?? null,
      slot: settlement.slot ?? null,
    },
  };
}

/** SHA-256 of the raw payment header. The signature is inside that header. */
function headerDigest(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  return crypto.createHash('sha256').update(header, 'utf8').digest('hex');
}

function digestEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length || left.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * Same route, same quoted price, and the same payment header bytes.
 * A header that only copies the payer address is not this proof.
 */
function replayAllowed(decision, { resourceHave, issued, paymentHeader }) {
  if (!decision || decision.kind !== 'settled' || decision.confirmed !== true || !decision.paymentRef) return false;
  if (canonicalPaidRoute(decision.route) !== resourceHave) return false;
  if (atomicUnits(decision.quotedAmount) !== issued) return false;
  const got = headerDigest(paymentHeader);
  if (!decision.paymentHash || !got || !digestEqual(decision.paymentHash, got)) return false;
  return true;
}

/**
 * Exact proof is not enough. The route must opt in, and this process must
 * still hold the response (or be writing it). Anything else is payment_replayed.
 * @returns {object|null} a decision to return, or null when this is not an exact replay
 */
function decideReplay(req, prior, { resourceHave, issued, paymentHeader, nonce, serveStoredResponse }) {
  if (!replayAllowed(prior, { resourceHave, issued, paymentHeader })) return null;
  if (serveStoredResponse === true && replayBytesReady(nonce)) {
    return idempotentReplay(prior);
  }
  return refused(req, 'payment_replayed', { preSettle: true });
}

function awaitInflight(pending) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(REPLAY_WAIT_TIMEOUT), replayWaiterMs());
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

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
  serveStoredResponse = false,
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
  if (typeof active.findLate === 'function') {
    const existing = active.findLate({ nonce });
    const stillSubmitting = existing && existing.state === 'submitted' && existing.sent !== true;
    if (!stillSubmitting) {
      const resumed = await resumeLateIssue({
        store: active, req, cfg, nonce, taskId, paymentHeader,
      });
      if (resumed) return resumed;
    }
  }
  const spent = active.isSpent(nonce);
  const challenge = spent
    ? (typeof active.replayRecord === 'function' ? active.replayRecord(nonce) : null)
    : active.get(nonce);
  if (!challenge || (!spent && challenge.state === 'unknown')) {
    return refused(
      req,
      spent ? 'payment_replayed' : (challenge?.state === 'unknown' ? 'settle_unconfirmed' : 'challenge_required'),
      { preSettle: true },
    );
  }
  // A spent nonce that does not match this route and price is a replay refusal,
  // not a fresh challenge mismatch.
  const mismatch = () => refused(req, spent ? 'payment_replayed' : 'challenge_mismatch', { preSettle: true });
  if (!networkAllowed(challenge.network, cfg)) {
    return refused(req, 'network_not_accepted', { preSettle: true });
  }
  const pausedNetwork = settlementRefusal(challenge.network);
  if (pausedNetwork) return refused(req, pausedNetwork, { preSettle: true });
  const blobNet = blobNetwork(paymentHeader);
  if (blobNet && !sameNetwork(blobNet, challenge.network)) {
    return refused(req, 'network_not_accepted', { preSettle: true });
  }

  const solana = isSolanaNetwork(challenge.network);
  const expectedPayTo = housePayee(cfg, challenge.network, payTo);
  if (!expectedPayTo || !samePayee(challenge.payTo, expectedPayTo, { solana })) {
    return mismatch();
  }
  const decoded = decodePaymentHeader(paymentHeader);
  if (!solana) {
    for (const recipient of signedRecipients(decoded)) {
      if (!samePayee(recipient, expectedPayTo, { solana: false })) {
        return mismatch();
      }
    }
    const declaredAsset = declaredEvmAsset(decoded);
    const pinnedAsset = evmAssetAddress(challenge.asset);
    if (declaredAsset && canonicalNetwork(challenge.network) === 'base' && declaredAsset === BASE_SEPOLIA_USDC) {
      return refused(req, 'network_not_accepted', { preSettle: true });
    }
    if (declaredAsset && pinnedAsset && declaredAsset !== pinnedAsset) {
      return refused(req, 'network_not_accepted', { preSettle: true });
    }
    // Arc: only the chain's own USDC contract, never 0xff..fe or another token.
    if (isArcId(challenge.network)) {
      if (!arcAssetAllowed(challenge.network, pinnedAsset)) {
        return refused(req, 'network_not_accepted', { preSettle: true });
      }
      if (declaredAsset && !arcAssetAllowed(challenge.network, declaredAsset)) {
        return refused(req, 'network_not_accepted', { preSettle: true });
      }
    }
  }
  // NEW-3: the challenge is bound to this route, the price it was quoted at, and
  // this payee. A missing route fails closed. A body-hash match does not keep a
  // cheaper quote when this route's live price is higher. A lower live price
  // still charges the quoted challenge amount.
  const resourceWant = canonicalPaidRoute(expectedResourceOf({ resource, baseUrl }));
  const resourceHave = canonicalPaidRoute(challenge.resource);
  if (!resourceHave || !resourceWant || resourceHave !== resourceWant) {
    return mismatch();
  }
  if (challenge.quoteRoute && canonicalPaidRoute(challenge.quoteRoute) !== resourceHave) {
    return mismatch();
  }
  if (!challenge.payTo) {
    return mismatch();
  }
  if (strictTaskId && challenge.taskId !== taskId) {
    return mismatch();
  }

  const issued = atomicUnits(challenge.amount);
  const lockedQuote = challenge.quotePrice != null ? atomicUnits(challenge.quotePrice) : issued;
  const routeLocked = challenge.routeQuote != null ? atomicUnits(challenge.routeQuote) : issued;
  if (issued == null || lockedQuote == null || routeLocked == null || issued !== lockedQuote || issued !== routeLocked) {
    return mismatch();
  }

  let routePrice = null;
  if (amount != null) {
    routePrice = atomicUnits(amount);
  } else if (typeof resolveQuote === 'function') {
    try {
      routePrice = atomicUnits(await resolveQuote());
    } catch {
      return mismatch();
    }
  } else if (challenge.quoteBodyHash && challenge.quoteBodyHash === quoteBodyHash(priceBody)) {
    routePrice = issued;
  }
  // The quoted challenge is the price. It may exceed today's route price.
  // It cannot pay a route that now costs more.
  if (routePrice == null || routePrice > issued) {
    return mismatch();
  }
  const routeQuote = issued.toString();

  const settledPick = boundSettledAmount(paymentHeader, clientVersion, challenge);
  if (settledPick.refuse) {
    return mismatch();
  }
  if (settledPick.amount != null) {
    try {
      if (BigInt(settledPick.amount) < BigInt(String(routeQuote))) {
        return mismatch();
      }
    } catch {
      return mismatch();
    }
  }

  const authEarly = readEvmAuthorization(paymentHeader);
  if (!solana && authEarly?.value) {
    try {
      if (BigInt(authEarly.value) < BigInt(String(routeQuote))) {
        return mismatch();
      }
    } catch { /* the chain read is the authority when the value is not an integer */ }
  }
  // Same challenge and the same payment header, before the auth-spent check:
  // that authorization is the one that already settled. Default is 409. A route
  // serves the stored response only when it opted in and the bytes are still here.
  if (spent) {
    const prior = settlementReplay(challenge, resourceHave);
    const replay = decideReplay(req, prior, {
      resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
    });
    if (replay) return replay;
    return refused(req, 'payment_replayed', { preSettle: true });
  }
  // A decoded EVM authorization must carry its EIP-3009 nonce as exactly
  // 0x plus 64 hex. Chain confirmation binds the transfer by that nonce, so
  // anything else is refused here, before the facilitator is called.
  if (!solana && (!authEarly || !canonicalAuthNonce(authEarly.nonce))) {
    return refused(req, 'settle_unconfirmed', { preSettle: true });
  }
  const authKeyEarly = !solana
    ? evmAuthKey(challenge.network, challenge.asset, authEarly?.from, authEarly?.nonce)
    : null;
  if (authKeyEarly && active.isAuthSpent(authKeyEarly)) {
    return refused(req, 'payment_replayed', { preSettle: true });
  }

  // MF1 (after every binding refusal, before the claim): no confirmation RPC for this network means every settle would collect
  // funds and then stay unconfirmed. Refuse before the facilitator is called.
  const injectedReader = cfg.chainReader || getChainReaderForTests();
  const rpcForNet = solana
    ? (cfg.solanaRpcUrl || cfg.solana?.rpcUrl)
    : evmRpcUrlFor(challenge.network, cfg);
  if (!injectedReader && !rpcForNet) return fail('gateway_not_configured');

  const owner = `${taskId}:${nonce}`;
  const claim = active.claim(nonce, owner);
  if (!claim.ok) {
    if (claim.reason === 'payment_in_flight') {
      const pending = inflightByNonce.get(String(nonce));
      if (pending) {
        const winner = await awaitInflight(pending);
        if (winner === REPLAY_WAIT_TIMEOUT) {
          return refused(req, 'payment_in_flight', { preSettle: true, retryAfter: 2 });
        }
        const replay = decideReplay(req, winner, {
          resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
        });
        if (replay) return replay;
        if (winner?.kind === 'settled') return refused(req, 'payment_replayed', { preSettle: true });
      }
      return refused(req, 'payment_in_flight', { preSettle: true, retryAfter: 2 });
    }
    if (claim.reason === 'payment_replayed') {
      const rec = typeof active.replayRecord === 'function' ? active.replayRecord(nonce) : null;
      const prior = rec ? settlementReplay(rec, resourceHave) : null;
      const replay = decideReplay(req, prior, {
        resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
      });
      if (replay) return replay;
    }
    return refused(req, claim.reason, { preSettle: true });
  }

  // Registered before any await so a concurrent same-nonce caller can wait
  // for this settlement instead of taking a second one.
  let resolveWaiters = () => {};
  const nonceKey = String(nonce);
  const waiter = new Promise((resolve) => { resolveWaiters = resolve; });
  inflightByNonce.set(nonceKey, waiter);
  let outcome;
  try {
    outcome = await settleClaimed();
    return outcome;
  } catch (err) {
    abortServedReceipt(nonceKey);
    throw err;
  } finally {
    resolveWaiters(outcome);
    if (inflightByNonce.get(nonceKey) === waiter) inflightByNonce.delete(nonceKey);
  }

  async function settleClaimed() {
  if (serveStoredResponse === true) armServedReceipt(nonce);
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

  let lateRow = null;
  let lateCapped = false;
  let preparedWindow = null;
  let seenTx = null;
  const release = () => {
    if (lateRow?.sent) return;
    try { active.release(nonce, owner); } catch { /* already spent */ }
  };
  const hold = async (why, publicReason, { terminal = false, txHint = null } = {}) => {
    const hint = txHint || seenTx || null;
    if (lateRow && hint) lateRow.tx_hint = hint;
    const stage = (why === 'http' || why === 'success_false' || why === 'transport') ? 'settle' : 'confirm';
    // Switch off keeps main's S1: an HTTP error or success:false is released
    // so the same challenge can settle again. Transport still stays unknown.
    const s1Release = !solana && !lateIssueEnabled(cfg) && !terminal
      && (why === 'http' || why === 'success_false');
    if (s1Release) {
      if (lateRow && typeof active.casLate === 'function') {
        try {
          active.casLate(lateRow.pending_id, ['submitted', 'unknown', 'confirmed'], 'unknown', {
            why,
            sent: true,
            tx_hint: hint || lateRow.tx_hint || null,
          });
        } catch { /* store */ }
      }
      try { active.revertSubmitted(nonce, owner); } catch { /* store */ }
      return refused(req, publicReason, { stage, network: challenge.network, tx: hint });
    }
    if (lateCapped && !terminal && (why === 'http' || why === 'success_false')) {
      try { active.release(nonce, owner); } catch { /* store */ }
      return refused(req, publicReason, { stage, network: challenge.network, tx: hint });
    }
    if (solana && !terminal && (why === 'http' || why === 'success_false')) {
      release();
      return refused(req, publicReason, { stage, network: challenge.network, tx: hint });
    }
    try { active.markUnknown(nonce); } catch { /* store */ }
    try {
      await active.recordPending({
        nonce,
        taskId,
        why,
        reason: publicReason,
        network: challenge.network,
        amount: challenge.amount != null ? String(challenge.amount) : null,
        tx: hint,
        payTo: expectedPayTo,
      });
    } catch { /* store */ }
    recordReceiptFailure({
      network: challenge.network,
      stage,
      reason: publicReason,
      tx: hint,
      outcome: 'pending',
      requestId: req?.id || null,
    });
    if (lateRow && typeof active.casLate === 'function') {
      const next = terminal ? 'mismatch_hold' : 'unknown';
      try {
        active.casLate(lateRow.pending_id, ['submitted', 'unknown', 'confirmed'], next, {
          why,
          sent: true,
          tx_hint: hint || lateRow.tx_hint || null,
        });
      } catch { /* store */ }
    }
    const pendingId = lateRow?.pending_id || null;
    if (!solana && lateIssueEnabled(cfg) && !terminal) {
      return refused(req, 'settle_pending', {
        retryAfter: LATE_RETRY_AFTER_SEC,
        pendingId,
        verifyUrl: lateVerifyUrl(cfg, pendingId),
        capture: false,
      });
    }
    return refused(req, publicReason, {
      pendingId,
      verifyUrl: lateVerifyUrl(cfg, pendingId),
      capture: false,
    });
  };

  if (authKeyEarly && typeof active.findLate === 'function') {
    const priorLate = active.findLate({ authKey: authKeyEarly });
    if (priorLate && priorLate.nonce !== nonce) {
      release();
      return refused(req, 'payment_replayed', { preSettle: true });
    }
  }
  if (!solana && authEarly && typeof cfg.authorizationState === 'function') {
    let used = null;
    try {
      used = await cfg.authorizationState({
        from: authEarly.from,
        nonce: authEarly.nonce,
        asset: challenge.asset,
        network: challenge.network,
      });
    } catch { used = null; }
    if (used === 'used') {
      release();
      return refused(req, 'payment_replayed', { preSettle: true });
    }
  }

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

  // Anchor before /settle so a collected transfer cannot die on a failed read.
  if (bindCheck?.ok) {
    try {
      const anchor = await fetchBaseL1Anchor(l1Anchor);
      preparedWindow = buildDisputeWindow({
        chainId: anchor.chain_id,
        anchorBlock: anchor.block_number,
        anchorTimestamp: anchor.timestamp,
        durationSec: cfg.issuanceDisputeWindowSec,
        anchorSource: anchor.anchor_source || null,
      });
    } catch (err) {
      logger.warn({ err: err.message, taskId }, 'x402: dispute window anchor failed');
      release();
      return fail('dispute_window_anchor_failed');
    }
  }

  const submittedAt = typeof cfg.now === 'function' ? cfg.now() : Date.now();
  // Solana late-issue is unsupported. Those failures follow main: transport
  // stays unknown, and an HTTP error or success:false is released.
  // A payer with two open rows, or a full queue, stays on that same release.
  if (!solana) lateCapped = lateAdmissionCapped(active, authEarly?.from);
  if (!solana && !lateCapped) {
    const authKey = authKeyEarly || evmAuthKey(challenge.network, challenge.asset, authEarly?.from, authEarly?.nonce);
    const prior = typeof active.findLate === 'function' ? active.findLate({ nonce }) : null;
    const opened = prior && prior.auth_key && prior.auth_key === authKey
      ? { ok: true, row: prior }
      : openLateSubmission(active, lateTupleFrom({
        req,
        cfg,
        challenge: { ...challenge, nonce },
        decoded,
        auth: authEarly,
        authKey,
        routeQuote,
        expectedSettledAmount: settledPick.amount != null ? settledPick.amount : (authEarly?.value || null),
        taskId,
        resource: resourceHave,
        submittedAt,
        paymentHeader,
      }));
    if (!opened.ok) {
      release();
      if (opened.reason === 'replay_store_unavailable') return fail('replay_store_unavailable');
      return refused(req, opened.reason || 'payment_replayed', { preSettle: true });
    }
    lateRow = opened.row;
    try { active.markSubmitted(nonce); } catch { /* store */ }
  }

  let settled;
  try {
    settled = await settlePayment(paymentHeader, gwOpts);
  } catch (err) {
    logger.warn({ err: err.message, payer: truncateWallet(authEarly?.from) }, 'x402: settle threw after submit');
    return await hold('transport', 'settle_failed');
  }
  if (!settled?.sent) {
    if (lateRow) {
      try { active.abortLate(lateRow.pending_id); } catch { /* store */ }
    }
    try { active.revertSubmitted(nonce, owner); } catch { /* store */ }
    lateRow = null;
    return refused(req, clientPaymentCode(settled?.reason || 'settle_failed'));
  }
  seenTx = settled.transaction || settled.txRef || null;
  if (lateRow) {
    lateRow.sent = true;
    if (seenTx) lateRow.tx_hint = seenTx;
    try {
      active.casLate(lateRow.pending_id, 'submitted', 'submitted', {
        sent: true,
        tx_hint: seenTx || lateRow.tx_hint || null,
      });
    } catch { /* store */ }
  }
  if (!settled.settled || settled.success === false) {
    const reason = String(settled.reason || '');
    const why = (reason === 'gateway_error' || reason === 'facilitator_error')
      ? 'transport'
      : ((reason.startsWith('gateway_http_') || reason.startsWith('facilitator_http_')) ? 'http' : 'success_false');
    return await hold(why, clientPaymentCode(reason || 'settle_failed'));
  }

  const fields = {
    ...settled,
    success: settled.success !== undefined ? settled.success : settled.settled === true,
    transaction: settled.transaction || settled.txRef,
    network: settled.network || toCaip2Network(challenge.network),
  };
  // ZAN mocks echo the short network. Accept it when it matches the challenge.
  if (settled.network && !sameNetwork(settled.network, challenge.network)) {
    return await hold('facilitator_network', 'network_not_accepted');
  }
  if (!fields.network) fields.network = challenge.network;
  if (!facilitatorFieldsOk(fields, challenge)) {
    return await hold('missing_tx', 'settle_unconfirmed');
  }

  const auth = readEvmAuthorization(paymentHeader);
  if (!solana && auth?.from && fields.payer && !samePayee(auth.from, fields.payer)) {
    return await hold('payer_field', 'settle_unconfirmed');
  }

  const norm = normalizePaymentRef(challenge.network, fields.transaction);
  if (!norm.ok) {
    return await hold('missing_tx', 'settle_unconfirmed');
  }
  // PB4 / PB12: a booked transfer is not a second settlement. Facilitator
  // success and a prior tx are not "settled". Only the chain confirmation
  // below, for this challenge's route and quoted price, is.
  if (active.isTxSpent(norm.key)) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    return refused(req, 'payment_replayed');
  }
  const authKey = !solana
    ? evmAuthKey(norm.network, challenge.asset, auth?.from, auth?.nonce)
    : null;
  if (authKey && active.isAuthSpent(authKey)) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    return refused(req, 'payment_replayed');
  }

  // One transfer, one settlement. reserveTx holds the spent check and the
  // lease in one store lock, so two processes cannot both issue. Released
  // on every exit that did not mark the tx spent. The in-memory sets remain
  // only for a store that has no reserveTx.
  const reserveOwner = `${process.pid}:${nonce}`;
  const canReserve = typeof active.reserveTx === 'function';
  let reserved = false;
  if (canReserve) {
    try {
      reserved = active.reserveTx(norm.key, authKey, reserveOwner, 180_000) === true;
    } catch (err) {
      logger.warn({ err: err.message }, 'x402: reserveTx failed closed');
      return refused(req, 'replay_store_unavailable');
    }
    if (!reserved) {
      if (active.isTxSpent(norm.key) || (authKey && active.isAuthSpent(authKey))) {
        active.markSpent(nonce, { txRef: norm.key, replay: true });
      }
      return refused(req, 'payment_replayed');
    }
  } else if (inflightTx.has(norm.key) || (authKey && inflightAuth.has(authKey))) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    return refused(req, 'payment_replayed');
  } else {
    inflightTx.add(norm.key);
    if (authKey) inflightAuth.add(authKey);
  }
  try {
    return await confirmAndSettle();
  } catch (err) {
    logger.warn({ err: err.message, taskId }, 'x402: local failure after settle');
    return await hold('local_failure', 'settle_unconfirmed');
  } finally {
    if (canReserve) {
      if (reserved) {
        try {
          if (!active.isTxSpent(norm.key)) active.releaseTx(norm.key, authKey, reserveOwner);
        } catch { /* the lease expires */ }
      }
    } else {
      inflightTx.delete(norm.key);
      if (authKey) inflightAuth.delete(authKey);
    }
  }

  async function confirmAndSettle() {
  const chain = await confirmSettlement({
    challenge,
    facilitator: fields,
    paymentHeader,
    expectedPayTo,
    ignorePause: true,
    cfg: {
      ...cfg,
      baseRpcUrl: cfg.baseRpcUrl || cfg.rpcUrl || null,
      solanaRpcUrl: settlementSolanaRpcUrl(cfg),
    },
  });
  if (!chain.ok) {
    // Pause was already cleared before /settle. A miss here means the reader
    // could not see the pinned transfer, so the MF1 hold is the fallback.
    return await hold(chain.pending ? 'awaiting_finality' : 'chain_mismatch', 'settle_unconfirmed', {
      terminal: !chain.pending,
    });
  }
  let chainAmount;
  try { chainAmount = BigInt(String(chain.amount)); } catch { chainAmount = 0n; }
  let quote;
  try { quote = BigInt(String(routeQuote)); } catch { quote = 0n; }
  // Solana receipts follow the challenge amount the facilitator enforces.
  // A chain value that only covers the route quote is not that transfer.
  let pinnedAmount = quote;
  if (solana) {
    try { pinnedAmount = BigInt(String(challenge.amount)); } catch { pinnedAmount = quote; }
  }
  if (chainAmount < quote || chainAmount < pinnedAmount) {
    return await hold('underpaid', 'settle_unconfirmed', { terminal: true });
  }
  if (!samePayee(chain.payTo, expectedPayTo, { solana })) {
    return await hold('payee', 'settle_unconfirmed', { terminal: true });
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
    route: resourceHave,
    quotedAmount: String(challenge.amount),
    paymentHash: headerDigest(paymentHeader),
    blockNumber: chain.blockNumber || null,
    logIndex: chain.logIndex ?? null,
    slot: chain.slot ?? null,
  });
  active.markTxSpent(norm.key, {
    amount: String(chain.amount),
    payer: chain.payer,
    payTo: chain.payTo,
    nonce,
    route: resourceHave,
    quotedAmount: String(challenge.amount),
    evidence: {
      blockNumber: chain.blockNumber ?? null,
      logIndex: chain.logIndex ?? null,
      slot: chain.slot ?? null,
    },
  });
  if (authKey) active.markAuthSpent(authKey, norm.key);

  let issuance_commitment = null;
  let dispute_window = null;
  if (bindCheck?.ok && preparedWindow) {
    issuance_commitment = buildIssuanceCommitmentPublic(bindCheck.bind, bindCheck.commitment);
    issuance_commitment.authorization = bindCheck.authorization;
    dispute_window = preparedWindow;
  }
  if (lateRow) {
    let marked = null;
    try {
      marked = noteLateInlineIssued(active, lateRow.pending_id, { txRef: norm.key });
    } catch {
      marked = null;
    }
    if (!marked) {
      const pendingId = lateRow.pending_id;
      return refused(req, 'settle_pending', {
        retryAfter: LATE_RETRY_AFTER_SEC,
        pendingId,
        verifyUrl: lateVerifyUrl(cfg, pendingId),
      });
    }
  }

  return {
    kind: 'settled',
    confirmed: true,
    paymentRef: norm.key,
    paymentHash: headerDigest(paymentHeader),
    route: resourceHave,
    quotedAmount: String(challenge.amount),
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
  }
}

function refused(req, reason, extra = {}) {
  const code = ['challenge_required', 'challenge_mismatch', 'network_not_accepted', 'payment_replayed', 'payment_in_flight', 'settle_unconfirmed', 'settle_pending', 'idempotency_conflict', 'replay_store_unavailable', 'payer_mismatch', 'stamp_underpaid', 'verify_failed', 'settle_failed', 'gateway_not_configured', 'invalid_payment_ref'].includes(reason)
    ? reason
    : clientPaymentCode(reason);
  if (extra.capture !== false) {
    recordReceiptFailure({
      network: extra.network || null,
      stage: extra.stage || (extra.preSettle ? 'pre-check' : 'settle'),
      reason: code,
      tx: extra.tx || null,
      outcome: extra.outcome || 'refused',
      requestId: req?.id || null,
      preSettle: extra.preSettle === true,
    });
  }
  recordRefusal(code, userAgentOf(req));
  return {
    kind: 'failed',
    reason: code,
    code,
    preSettle: extra.preSettle === true,
    retryAfter: extra.retryAfter,
    pendingId: extra.pendingId || null,
    verifyUrl: extra.verifyUrl || null,
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
