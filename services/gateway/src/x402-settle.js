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
import { normalizePaymentRef, sameNetwork, canonicalNetwork, encodeBase58 } from './payment-ref.js';
import { testSwitchesOn } from './test-switch.js';
import { canonicalAuthNonce, confirmSettlement, evmAuthorizationRefusalDetail, evmFinality, expectedEvmChainId, facilitatorFieldsOk, localTransferIndex, readEvmAuthorization, readEvmReceipt, getChainReaderForTests, settlementRefusal, settlementSolanaRpcUrl } from './x402-chain.js';
import { authorizationKey } from '../../../packages/cs2-core/line/index.mjs';
import { findByPaymentRef, houseIntakeDir, openIntake } from '../../chit-store/intake.js';
import { answerStoredHouseRow } from './v13-issue.js';
import { issuanceEnabled, mainnetSealerEnabled, storeEnabled, v13Flags } from './v13-flags.js';
import { recordReceiptFailure, refusalNetworkName, refusalSubReason } from './receipt-failures.js';
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
import { openPostSettleHandle, settleHoldKey } from './hold-handle.js';

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
  const code = clientPaymentCode(reason);
  // Logged and counted like a pre-settle refusal (fail() is only reached
  // before /settle). The decision below is unchanged.
  recordReceiptFailure({
    network: extra.network || null,
    stage: 'pre-check',
    reason: code,
    preSettle: true,
    sub_reason: refusalSubReason(extra.sub),
    phase: 'pre_settle',
  });
  recordRefusal(code, null, refusalMeta(extra.network, extra.sub, 'pre_settle'));
  return { kind: 'failed', reason, code, preSettle: extra.preSettle === true, retryAfter: extra.retryAfter };
}

/** Issuance-bind refusal reasons (issuance-commitment.js) as a fixed sub_reason. */
const BIND_SUB = {
  issuance_bind_nonce_mismatch: 'bind_nonce',
  issuance_bind_client_nonce_mismatch: 'bind_client_nonce',
  issuance_bind_chain_id_mismatch: 'bind_chain_id',
  issuance_bind_settlement_contract_mismatch: 'bind_contract',
  issuance_bind_commitment_failed: 'bind_commitment',
  issuance_bind_auth_missing_nonce: 'bind_auth_nonce',
};

/** Bounded log fields for one refusal: network name, sub_reason, phase. */
function refusalMeta(network, sub, phase) {
  return {
    network: refusalNetworkName(network),
    sub_reason: refusalSubReason(sub),
    phase: phase === 'pre_settle' ? 'pre_settle' : 'post_submit',
  };
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
    if (!svm) return { refuse: true, why: 'network' };
    return { amount: integerAmount(live.amount) };
  }
  if (svm) return { refuse: true, why: 'network' };
  let sent;
  try {
    sent = toPaymentPayload(decoded, { x402Version: x402Version === 2 ? 2 : 1 });
  } catch {
    return { amount: null };
  }
  const auth = sent?.payload?.authorization;
  if (!auth) return { amount: null };
  const value = integerAmount(auth.value);
  if (value == null) return { refuse: true, why: 'value' };
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

function lineHex(value, width) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase().replace(/^0x/, '');
  if (raw.length !== width * 2 || !/^[0-9a-f]+$/.test(raw)) return null;
  return raw;
}

/**
 * Payment identity and finality observation for a settled transfer.
 * Chain, token, authorizer, and nonce come from the EIP-3009 authorization
 * and the server challenge. Finality is read with evmFinality only when a
 * v13 flag is on, so a flags-off settle does not open a new RPC.
 */
export async function houseSettlementIdentity({
  paymentHeader,
  challenge = null,
  chain = null,
  txRef = null,
  cfg = {},
  env = process.env,
} = {}) {
  const decoded = decodePaymentHeader(paymentHeader);
  const auth = readEvmAuthorization(paymentHeader);
  const domain = decoded?.payload?.authorization?.domain
    || decoded?.authorization?.domain
    || decoded?.payload?.domain
    || decoded?.domain
    || null;
  const network = challenge?.network || null;
  const solana = isSolanaNetwork(network);
  let chainId = null;
  if (!solana) {
    if (domain?.chainId != null && String(domain.chainId).trim() !== '') {
      const n = Number(domain.chainId);
      chainId = Number.isFinite(n) ? n : null;
    } else {
      chainId = expectedEvmChainId(network);
    }
  }
  const token = lineHex(domain?.verifyingContract, 20)
    || lineHex(decoded?.accepted?.asset, 20)
    || lineHex(decoded?.asset, 20)
    || lineHex(chain?.asset, 20);
  const authorizer = lineHex(auth?.from, 20) || lineHex(chain?.authorizer, 20) || lineHex(chain?.payer, 20);
  const nonce = lineHex(auth?.nonce, 32);
  const flags = v13Flags(env);
  const live = flags.issuance === true || flags.mainnetSealer === true || flags.store === true;
  let fin = { finalized: false, blockTimestamp: null, blockHash: null };
  if (live && !solana && chain?.blockNumber != null) {
    try {
      const next = await evmFinality(evmRpcUrlFor(network, cfg || {}), chain.blockNumber);
      if (next && typeof next === 'object') fin = next;
    } catch {
      fin = { finalized: false, blockTimestamp: null, blockHash: null };
    }
  }
  const blockTime = Number.isFinite(fin.blockTimestamp) ? fin.blockTimestamp : null;
  const blockNumber = chain?.blockNumber != null && Number.isFinite(Number(chain.blockNumber))
    ? Number(chain.blockNumber)
    : null;
  const observation = blockNumber == null ? null : {
    blockNumber,
    finalizedNumber: fin.finalized === true ? blockNumber : null,
    blockHash: fin.blockHash || chain?.blockHash || null,
    blockTime,
    txIndex: Number.isInteger(chain?.transactionIndex) ? chain.transactionIndex : null,
    localLogIndex: Number.isInteger(chain?.localLogIndex) ? chain.localLogIndex : null,
    txHash: txRef || chain?.transaction || null,
    hourStart: blockTime != null ? blockTime - (blockTime % 3600) : null,
  };
  return { chainId, token, authorizer, nonce, observation };
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

async function rereadBaseObservation(rec, cfg) {
  const settlement = rec?.settlement;
  if (!settlement || typeof settlement !== 'object') return null;
  if (isSolanaNetwork(rec.network || settlement.network)) return null;
  const tx = settlement.txRef || settlement.txHash;
  const matched = String(tx || '').match(/0x[0-9a-fA-F]{64}/);
  const hash = matched ? `0x${matched[0].slice(2).toLowerCase()}` : null;
  const url = evmRpcUrlFor(rec.network || settlement.network, cfg || {});
  if (!url || !hash) return null;
  try {
    const receipt = await readEvmReceipt(url, hash);
    if (!receipt || receipt.status !== 1 || receipt.blockNumber == null) return null;
    const fin = await evmFinality(url, receipt.blockNumber);
    const blockTime = Number.isFinite(fin && fin.blockTimestamp) ? fin.blockTimestamp : null;
    const blockHash = String((fin && fin.blockHash) || receipt.blockHash || '').replace(/^0x/, '').toLowerCase();
    const txIndex = Number.isInteger(receipt.transactionIndex) ? receipt.transactionIndex : null;
    const localLogIndex = localTransferIndex(receipt.logs, {
      token: settlement.token || rec.asset,
      from: settlement.authorizer || settlement.payer || rec.payer,
      to: settlement.payTo || rec.payTo,
      value: settlement.amount,
    });
    return {
      blockNumber: receipt.blockNumber,
      finalizedNumber: null,
      blockHash: blockHash || null,
      blockTime,
      txIndex,
      localLogIndex,
      txHash: hash.slice(2),
      hourStart: blockTime != null ? blockTime - (blockTime % 3600) : null,
    };
  } catch {
    return null;
  }
}

/** Original confirmed settlement for a spent challenge. Refusals are not receipts. */
async function settlementReplay(rec, resourceHave, cfg) {
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
    chainId: settlement.chainId ?? null,
    nonce: settlement.authNonce ?? null,
    token: settlement.token ?? null,
    authorizer: settlement.authorizer ?? null,
    observation: await rereadBaseObservation(rec, cfg),
    network: rec.network || null,
  };
}

function intakeRowForHeader(paymentHeader, challenge) {
  const dir = houseIntakeDir();
  if (!dir || !challenge || isSolanaNetwork(challenge.network)) return null;
  const auth = readEvmAuthorization(paymentHeader);
  if (!auth?.from || !auth?.nonce) return null;
  const key = authorizationKey({
    chainId: Number(challenge.chainId || expectedEvmChainId(challenge.network) || 8453),
    token: String(challenge.asset || '').replace(/^0x/, '').toLowerCase(),
    authorizer: String(auth.from).replace(/^0x/, '').toLowerCase(),
    nonce: String(auth.nonce).replace(/^0x/, '').toLowerCase(),
  });
  if (!key.ok) return null;
  try {
    return findByPaymentRef(openIntake(dir), key.hex);
  } catch {
    return null;
  }
}

async function solanaRpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.error) return null;
  return data.result;
}

async function solanaFundsUnmoved(cfg, signature, blockhash) {
  const url = settlementSolanaRpcUrl(cfg);
  if (!url || !signature) return false;
  const status = await solanaRpc(url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const value = status && Array.isArray(status.value) ? status.value : null;
  if (!value || value.length !== 1 || value[0] != null) return false;
  const recent = blockhash && typeof blockhash.recentBlockhash === 'string' ? blockhash.recentBlockhash : null;
  if (recent) {
    const valid = await solanaRpc(url, 'isBlockhashValid', [recent, { commitment: 'finalized' }]);
    if (valid && valid.value === false) return true;
  }
  const height = await solanaRpc(url, 'getBlockHeight', [{ commitment: 'finalized' }]);
  const last = blockhash && Number.isInteger(blockhash.lastValidBlockHeight) ? blockhash.lastValidBlockHeight : null;
  return typeof height === 'number' && last != null && height > last;
}

function recentBlockhashFromTransaction(encoded) {
  let buf;
  try { buf = Buffer.from(String(encoded || ''), 'base64'); } catch { return null; }
  if (!Buffer.isBuffer(buf) || buf.length < 68) return null;
  const sigs = buf[0];
  if (sigs > 4) return null;
  let off = 1 + sigs * 64 + 3;
  if (off >= buf.length) return null;
  const accounts = buf[off];
  off += 1 + accounts * 32;
  if (accounts > 64 || off + 32 > buf.length) return null;
  return encodeBase58(buf.subarray(off, off + 32));
}

function solanaBlockhash(paymentHeader) {
  const decoded = decodePaymentHeader(paymentHeader);
  const extra = decoded?.accepted?.extra || decoded?.payload || {};
  let recent = extra.recentBlockhash || decoded?.payload?.recentBlockhash || null;
  if (typeof recent !== 'string' || !recent) {
    recent = recentBlockhashFromTransaction(decoded?.payload?.transaction);
  }
  const raw = extra.lastValidBlockHeight ?? decoded?.payload?.lastValidBlockHeight;
  const last = Number.isInteger(raw) ? raw : (typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null);
  return {
    recentBlockhash: typeof recent === 'string' ? recent : null,
    lastValidBlockHeight: last,
  };
}

async function solanaFinalizedError(cfg, signature) {
  const url = settlementSolanaRpcUrl(cfg);
  if (!url || !signature) return false;
  const tx = await solanaRpc(url, 'getTransaction', [signature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  }]);
  return !!(tx && tx.meta && tx.meta.err != null);
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
export async function sweepSolanaHolds(store, cfg = {}) {
  if (!store || typeof store.listHoldHandles !== 'function') return [];
  const done = [];
  const rows = store.listHoldHandles();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.receipt || row.hold_class === 'terminal') continue;
    if (!isSolanaNetwork(row.network)) continue;
    const again = await repollSolanaFinality(cfg, {
      network: row.network,
      payTo: cfg.payTo || null,
    }, null, row);
    if (typeof store.noteHoldHint !== 'function') continue;
    const sig = again?.tx || row.tx_hint || null;
    const matched = again?.ok === true && again.finalized === true;
    if (!matched) {
      const failed = sig ? await solanaFinalizedError(cfg, sig) : false;
      const dropped = sig ? await solanaFundsUnmoved(cfg, sig, row.blockhash || null) : false;
      if ((failed || dropped) && typeof store.patch === 'function') {
        const prefix = `settle:${row.network}:`;
        const nonce = String(row.key || '').startsWith(prefix) ? String(row.key).slice(prefix.length) : '';
        if (nonce) store.patch(nonce, { state: 'issued', lease_owner: null, lease_until: null });
      }
      continue;
    }
    const receipt = {
      id: row.pending_id,
      pending_id: row.pending_id,
      state: 'final',
      network: 'solana',
      tx: sig,
      payment_ref: sig,
    };
    store.noteHoldHint(row.key, { receipt });
    const prefix = `settle:${row.network}:`;
    const nonce = String(row.key || '').startsWith(prefix) ? String(row.key).slice(prefix.length) : '';
    if (nonce && typeof store.markSpent === 'function' && !(typeof store.isSpent === 'function' && store.isSpent(nonce))) {
      store.markSpent(nonce, {
        txRef: sig,
        payer: again.payer || row.payer || null,
        payTo: again.payTo || cfg.payTo || null,
        amount: String(again.amount || ''),
      });
    }
    done.push(receipt);
  }
  return done;
}

export function serveSolanaHold(receiptId, store = null, paymentHeader = null) {
  const active = store || getActiveChallengeStore() || defaultStore;
  if (!active || typeof active.holdByPendingId !== 'function') return null;
  const row = active.holdByPendingId(receiptId);
  if (!row || !isSolanaNetwork(row.network)) return null;
  if (row.receipt) {
    const digest = headerDigest(paymentHeader);
    const holder = typeof row.payment_hash === 'string' && typeof digest === 'string'
      && row.payment_hash.length === digest.length
      && digestEqual(row.payment_hash, digest);
    if (!holder) {
      return { status: 200, body: { state: 'final', pending_id: row.pending_id, finality: 'final' } };
    }
    return { status: 200, body: row.receipt };
  }
  return {
    status: 202,
    retryAfter: LATE_RETRY_AFTER_SEC,
    body: { state: 'pending', pending_id: row.pending_id, code: 'settle_pending' },
  };
}

async function repollSolanaFinality(cfg, challenge, paymentHeader, linked) {
  const budget = Math.min(Number(cfg && cfg.solanaFinalizeWaitMs) || 5000, 5000);
  return confirmSettlement({
    challenge,
    facilitator: {
      transaction: linked?.tx_hint || null,
      network: challenge?.network || 'solana',
      payer: linked?.payer || null,
    },
    paymentHeader,
    expectedPayTo: challenge?.payTo,
    ignorePause: true,
    cfg: { ...cfg, solanaFinalizeWaitMs: budget },
  });
}

let solanaSweepTimer = null;

export function startSolanaHoldSweep(store, cfg = {}) {
  if (solanaSweepTimer) return { started: true, already: true };
  const interval = Math.min(Math.max(Number(cfg.intervalMs) || 15000, 1000), 60000);
  const tick = () => sweepSolanaHolds(store, cfg).catch(() => {});
  const first = tick();
  solanaSweepTimer = setInterval(tick, interval);
  if (typeof solanaSweepTimer.unref === 'function') solanaSweepTimer.unref();
  return { started: true, first };
}

export function stopSolanaHoldSweep() {
  if (solanaSweepTimer) clearInterval(solanaSweepTimer);
  solanaSweepTimer = null;
}

async function houseIntakeReplay(challenge, paymentHeader, cfg, requestBaseUrl) {
  const chainId = Number(challenge?.chainId || expectedEvmChainId(challenge?.network) || 0);
  if (!houseReplayOpen({ chainId })) return null;
  const row = intakeRowForHeader(paymentHeader, challenge);
  if (!row) return null;
  const baseUrl = (cfg && (cfg.publicBaseUrl || cfg.publicBase)) || requestBaseUrl || '';
  if (row.state === 'awaiting_block') {
    const fresh = await rereadBaseObservation(challenge, cfg || {});
    const ready = fresh && fresh.blockNumber != null && fresh.blockHash && fresh.blockTime != null
      && fresh.txIndex != null && fresh.localLogIndex != null;
    if (ready) {
      const { resumeAwaitingHouse } = await import('./v13-issue.js');
      const resumed = await resumeAwaitingHouse({
        row,
        observation: fresh,
        paymentHeader,
        challenge,
        baseUrl,
      });
      if (resumed) {
        return {
          kind: 'house_answer',
          status: resumed.status,
          body: resumed.body,
          retryAfter: resumed.retryAfter ?? null,
        };
      }
    }
    const held = answerStoredHouseRow(row, baseUrl);
    if (!held) return null;
    return { kind: 'house_answer', status: held.status, body: held.body, retryAfter: held.retryAfter };
  }
  const answered = answerStoredHouseRow(row, baseUrl);
  if (!answered) return null;
  return {
    kind: 'house_answer',
    status: answered.status,
    body: answered.body,
    retryAfter: answered.retryAfter,
  };
}

function houseReplayOpen(prior) {
  if (issuanceEnabled(process.env) !== true || mainnetSealerEnabled(process.env) !== true) return false;
  if (storeEnabled(process.env) !== true) return false;
  return Number(prior?.chainId) === 8453;
}

function decideReplay(req, prior, { resourceHave, issued, paymentHeader, nonce, serveStoredResponse }) {
  if (!replayAllowed(prior, { resourceHave, issued, paymentHeader })) return null;
  if (serveStoredResponse === true && replayBytesReady(nonce)) {
    return idempotentReplay(prior);
  }
  if (houseReplayOpen(prior)) {
    return {
      ...prior,
      kind: 'settled',
      confirmed: true,
      replay: true,
      idempotentReplay: false,
    };
  }
  return refused(req, 'payment_replayed', { preSettle: true, network: prior?.network || null, sub: 'exact_replay' });
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
    return fail('gateway_not_configured', { sub: 'boot_refused' });
  }
  if (!bindingEnforced(cfg)) {
    noteUnboundUse('settleBoundPayment', { taskId });
    return null;
  }
  if (challengeStoreFailed()) return fail('gateway_not_configured', { sub: 'challenge_store_failed' });

  const active = store || cfg.store || getActiveChallengeStore() || defaultStore;

  if (!nonce) return refused(req, 'challenge_required', { preSettle: true, sub: 'no_nonce' });
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
    if (challenge?.state === 'unknown') {
      const got = headerDigest(paymentHeader);
      const samePayment = (stored) => typeof stored === 'string' && !!got && digestEqual(stored, got);
      const late = typeof active.findLate === 'function' ? active.findLate({ nonce }) : null;
      const handle = typeof active.findHoldHandleByKey === 'function'
        ? active.findHoldHandleByKey(settleHoldKey(challenge.network, nonce))
        : null;
      const lateLinked = late?.pending_id && samePayment(late.payment_hash)
        ? {
          pending_id: late.pending_id,
          hold_class: late.hold_class || (late.state === 'mismatch_hold' || late.state === 'expired_unresolved' ? 'terminal' : 'resolvable'),
          code: late.public_code || handle?.code || null,
        }
        : null;
      const linked = lateLinked || (handle?.pending_id && samePayment(handle.payment_hash) ? handle : null);
      if (linked?.pending_id) {
        const terminal = linked.hold_class === 'terminal';
        if (!terminal && isSolanaNetwork(challenge.network)) {
          const again = await repollSolanaFinality(cfg, challenge, paymentHeader, linked);
          const solanaMatch = again?.ok === true && again.finalized === true;
          if (solanaMatch) {
            if (active.isSpent(nonce)) {
              const prior = await settlementReplay(
                typeof active.replayRecord === 'function' ? active.replayRecord(nonce) : challenge,
                canonicalPaidRoute(challenge.resource),
                cfg,
              );
              if (prior) return idempotentReplay(prior);
            }
            const tx = again.tx || linked.tx_hint || null;
            const solanaSpentMeta = {
              txRef: tx,
              amount: String(again.amount || challenge.amount),
              payer: again.payer || linked.payer || null,
              payTo: again.payTo || challenge.payTo || null,
              paymentHash: got,
              route: canonicalPaidRoute(challenge.resource),
              quotedAmount: String(challenge.amount),
            };
            active.markSpent(nonce, solanaSpentMeta);
            if (typeof active.noteHoldHint === 'function') {
              active.noteHoldHint(settleHoldKey(challenge.network, nonce), {
                receipt: {
                  id: linked.pending_id,
                  pending_id: linked.pending_id,
                  state: 'final',
                  network: 'solana',
                  payment_ref: tx,
                },
              });
            }
            return {
              kind: 'settled',
              confirmed: true,
              replay: true,
              idempotentReplay: false,
              paymentRef: tx,
              paymentHash: got,
              route: canonicalPaidRoute(challenge.resource),
              quotedAmount: String(challenge.amount),
              settledAmount: String(again.amount || challenge.amount),
              payerWallet: again.payer || linked.payer || null,
              payTo: again.payTo || challenge.payTo || null,
              asset: challenge.asset || 'USDC',
              chainId: null,
              network: challenge.network,
              observation: null,
              pendingId: linked.pending_id,
            };
          }
          const sig = linked.tx_hint || null;
          const failed = sig ? await solanaFinalizedError(cfg, sig) : false;
          const dropped = sig ? await solanaFundsUnmoved(cfg, sig, solanaBlockhash(paymentHeader)) : false;
          if (failed || dropped) {
            if (typeof active.patch === 'function') {
              active.patch(nonce, { state: 'issued', lease_owner: null, lease_until: null });
            }
            return refused(req, 'not_settled', {
              preSettle: false,
              pendingId: linked.pending_id,
              verifyUrl: lateVerifyUrl(cfg, linked.pending_id),
              holdClass: 'terminal',
              network: challenge.network,
              sub: 'missing_tx',
            });
          }
          return refused(req, 'settle_pending', {
            preSettle: false,
            pendingId: linked.pending_id,
            verifyUrl: lateVerifyUrl(cfg, linked.pending_id),
            holdClass: 'resolvable',
            retryAfter: LATE_RETRY_AFTER_SEC,
            network: challenge.network,
            sub: 'prior_unknown',
          });
        }
        const code = linked.code || (terminal ? 'settle_unconfirmed' : 'settle_pending');
        return refused(req, code, {
          preSettle: false,
          pendingId: linked.pending_id,
          verifyUrl: lateVerifyUrl(cfg, linked.pending_id),
          holdClass: terminal ? 'terminal' : 'resolvable',
          retryAfter: terminal ? undefined : LATE_RETRY_AFTER_SEC,
          network: challenge.network,
          sub: 'prior_unknown',
        });
      }
    }
    return refused(
      req,
      spent ? 'payment_replayed' : (challenge?.state === 'unknown' ? 'settle_unconfirmed' : 'challenge_required'),
      {
        preSettle: true,
        network: challenge?.network || null,
        // Missing, expired and evicted challenges read the same: challenge_unknown.
        sub: spent ? 'spent_nonce' : (challenge?.state === 'unknown' ? 'prior_unknown' : 'challenge_unknown'),
      },
    );
  }
  // A spent nonce that does not match this route and price is a replay refusal,
  // not a fresh challenge mismatch.
  // `sub` names the check (logs only). A spent nonce logs spent_nonce, never
  // the field, so the logs do not describe another payer's settled challenge.
  const parked = intakeRowForHeader(paymentHeader, challenge);
  if (parked && parked.state === 'not_settled') {
    return refused(req, 'not_settled', {
      pendingId: parked.pendingId,
      holdClass: 'terminal',
      network: challenge.network,
      preSettle: false,
      sub: 'other',
    });
  }
  const net = challenge.network;
  const mismatch = (sub) => refused(req, spent ? 'payment_replayed' : 'challenge_mismatch', {
    preSettle: true,
    network: net,
    sub: spent ? 'spent_nonce' : sub,
  });
  const deny = (reason, sub, extra = {}) => refused(req, reason, { preSettle: true, network: net, sub, ...extra });
  if (!networkAllowed(challenge.network, cfg)) {
    return deny('network_not_accepted', 'network_not_allowed');
  }
  const pausedNetwork = settlementRefusal(challenge.network);
  if (pausedNetwork) return deny(pausedNetwork, 'network_paused');
  const blobNet = blobNetwork(paymentHeader);
  if (blobNet && !sameNetwork(blobNet, challenge.network)) {
    return deny('network_not_accepted', 'payload_network');
  }

  const solana = isSolanaNetwork(challenge.network);
  const expectedPayTo = housePayee(cfg, challenge.network, payTo);
  if (!expectedPayTo || !samePayee(challenge.payTo, expectedPayTo, { solana })) {
    return mismatch('payto_house');
  }
  const decoded = decodePaymentHeader(paymentHeader);
  if (!solana) {
    for (const recipient of signedRecipients(decoded)) {
      if (!samePayee(recipient, expectedPayTo, { solana: false })) {
        return mismatch('signed_recipient');
      }
    }
    const declaredAsset = declaredEvmAsset(decoded);
    const pinnedAsset = evmAssetAddress(challenge.asset);
    if (declaredAsset && canonicalNetwork(challenge.network) === 'base' && declaredAsset === BASE_SEPOLIA_USDC) {
      return deny('network_not_accepted', 'sepolia_asset');
    }
    if (declaredAsset && pinnedAsset && declaredAsset !== pinnedAsset) {
      return deny('network_not_accepted', 'asset_mismatch');
    }
    // Arc: only the chain's own USDC contract, never 0xff..fe or another token.
    if (isArcId(challenge.network)) {
      if (!arcAssetAllowed(challenge.network, pinnedAsset)) {
        return deny('network_not_accepted', 'arc_asset');
      }
      if (declaredAsset && !arcAssetAllowed(challenge.network, declaredAsset)) {
        return deny('network_not_accepted', 'arc_asset');
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
    return mismatch('resource');
  }
  if (challenge.quoteRoute && canonicalPaidRoute(challenge.quoteRoute) !== resourceHave) {
    return mismatch('quote_route');
  }
  if (!challenge.payTo) {
    return mismatch('payto_missing');
  }
  if (strictTaskId && challenge.taskId !== taskId) {
    return mismatch('task_id');
  }

  const issued = atomicUnits(challenge.amount);
  const lockedQuote = challenge.quotePrice != null ? atomicUnits(challenge.quotePrice) : issued;
  const routeLocked = challenge.routeQuote != null ? atomicUnits(challenge.routeQuote) : issued;
  if (issued == null || lockedQuote == null || routeLocked == null || issued !== lockedQuote || issued !== routeLocked) {
    return mismatch('amount_inconsistent');
  }

  let routePrice = null;
  if (amount != null) {
    routePrice = atomicUnits(amount);
  } else if (typeof resolveQuote === 'function') {
    try {
      routePrice = atomicUnits(await resolveQuote());
    } catch {
      return mismatch('quote_unavailable');
    }
  } else if (challenge.quoteBodyHash && challenge.quoteBodyHash === quoteBodyHash(priceBody)) {
    routePrice = issued;
  }
  // The quoted challenge is the price. It may exceed today's route price.
  // It cannot pay a route that now costs more.
  if (routePrice == null || routePrice > issued) {
    return mismatch('price_increased');
  }
  const routeQuote = issued.toString();

  const settledPick = boundSettledAmount(paymentHeader, clientVersion, challenge);
  if (settledPick.refuse) {
    return mismatch(settledPick.why === 'network' ? 'payload_network_shape' : 'value_not_integer');
  }
  if (settledPick.amount != null) {
    try {
      if (BigInt(settledPick.amount) < BigInt(String(routeQuote))) {
        return mismatch('amount_short');
      }
    } catch {
      return mismatch('amount_unparseable');
    }
  }

  const authEarly = readEvmAuthorization(paymentHeader);
  if (!solana && authEarly?.value) {
    try {
      if (BigInt(authEarly.value) < BigInt(String(routeQuote))) {
        return mismatch('auth_value_short');
      }
    } catch { /* the chain read is the authority when the value is not an integer */ }
  }
  // Same challenge and the same payment header, before the auth-spent check:
  // that authorization is the one that already settled. Default is 409. A route
  // serves the stored response only when it opted in and the bytes are still here.
  if (spent) {
    const prior = await settlementReplay(challenge, resourceHave, cfg);
    const housed = await houseIntakeReplay(challenge, paymentHeader, cfg, baseUrl);
    if (housed) return housed;
    if (isSolanaNetwork(challenge.network) && typeof active.findHoldHandleByKey === 'function') {
      const handle = active.findHoldHandleByKey(settleHoldKey(challenge.network, nonce));
      const got = headerDigest(paymentHeader);
      if (handle?.receipt && prior && got && digestEqual(handle.payment_hash || prior.paymentHash, got)) {
        return idempotentReplay(prior);
      }
    }
    const replay = decideReplay(req, prior, {
      resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
    });
    if (replay) return replay;
    return deny('payment_replayed', 'spent_same_payment');
  }
  // A decoded EVM authorization must carry its EIP-3009 nonce as exactly
  // 0x plus 64 hex. Chain confirmation binds the transfer by that nonce, so
  // anything else is refused here, before the facilitator is called.
  // The same check requires address-shaped from and to, uint value and
  // validity bounds inside the window, and a signature within its size range,
  // and gives Permit2 and other transfer methods their own code. It also caps
  // the header size.
  if (!solana) {
    const authRefusal = evmAuthorizationRefusalDetail(paymentHeader, { maxTimeoutSeconds: challenge.maxTimeoutSeconds });
    if (authRefusal) return deny(authRefusal.code, authRefusal.sub);
    if (!authEarly || !canonicalAuthNonce(authEarly.nonce)) {
      return deny('settle_unconfirmed', 'auth_nonce');
    }
  }
  const authKeyEarly = !solana
    ? evmAuthKey(challenge.network, challenge.asset, authEarly?.from, authEarly?.nonce)
    : null;
  // Every EVM payment needs a replay key. Without one, isAuthSpent cannot
  // stop the same authorization from settling twice.
  if (!solana && !authKeyEarly) {
    return deny('settle_unconfirmed', 'replay_key_missing');
  }
  if (authKeyEarly && active.isAuthSpent(authKeyEarly)) {
    return deny('payment_replayed', 'auth_spent');
  }
  // F-2: a route bound to one payer (expectedPayer) refuses another wallet's
  // EIP-3009 authorization here, before openLateSubmission and /settle, as
  // the handshake does (x402-server.js:612-623). Nothing has moved yet.
  // Solana: the transfer authority is only read from the chain after
  // /settle, so the post-check in confirmAndSettle stays the check there.
  if (!solana && expectedPayer && !samePayee(authEarly?.from, expectedPayer, { solana: false })) {
    return deny('payer_mismatch', 'payer_precheck');
  }

  // MF1 (after every binding refusal, before the claim): no confirmation RPC for this network means every settle would collect
  // funds and then stay unconfirmed. Refuse before the facilitator is called.
  const injectedReader = cfg.chainReader || getChainReaderForTests();
  const rpcForNet = solana
    ? (cfg.solanaRpcUrl || cfg.solana?.rpcUrl)
    : evmRpcUrlFor(challenge.network, cfg);
  if (!injectedReader && !rpcForNet) return fail('gateway_not_configured', { network: net, sub: 'no_confirm_rpc' });

  const owner = `${taskId}:${nonce}`;
  const claim = active.claim(nonce, owner, undefined, headerDigest(paymentHeader));
  if (!claim.ok) {
    if (claim.reason === 'payment_in_flight') {
      const pending = inflightByNonce.get(String(nonce));
      if (pending) {
        const winner = await awaitInflight(pending);
        if (winner === REPLAY_WAIT_TIMEOUT) {
          return deny('payment_in_flight', 'inflight_timeout', { retryAfter: 2 });
        }
        const replay = decideReplay(req, winner, {
          resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
        });
        if (replay) return replay;
        if (winner?.kind === 'settled') return deny('payment_replayed', 'inflight_settled');
      }
      return deny('payment_in_flight', 'inflight_claimed', { retryAfter: 2 });
    }
    if (claim.reason === 'payment_replayed') {
      const rec = typeof active.replayRecord === 'function' ? active.replayRecord(nonce) : null;
      const prior = rec ? await settlementReplay(rec, resourceHave, cfg) : null;
      const replay = decideReplay(req, prior, {
        resourceHave, issued, paymentHeader, nonce, serveStoredResponse,
      });
      if (replay) return replay;
    }
    return deny(claim.reason, claim.reason === 'payment_replayed' ? 'claim_replayed' : 'claim_other');
  }

  // Registered before any await so a concurrent same-nonce caller can wait
  // for this settlement instead of taking a second one.
  let resolveWaiters = () => {};
  const nonceKey = String(nonce);
  const waiter = new Promise((resolve) => { resolveWaiters = resolve; });
  inflightByNonce.set(nonceKey, waiter);
  let outcome;
  let postSent = false;
  let postSentPending = null;
  try {
    outcome = await settleClaimed();
    return outcome;
  } catch (err) {
    abortServedReceipt(nonceKey);
    if (postSent) {
      logger.warn({ err: err.message }, 'x402: throw after settle');
      let pendingId = postSentPending;
      if (!pendingId && nonce) {
        try {
          const opened = openPostSettleHandle(active, {
            key: settleHoldKey(challenge.network, nonce),
            holdClass: 'resolvable',
            code: 'settle_unconfirmed',
            cfg,
            paymentHash: headerDigest(paymentHeader),
          });
          pendingId = opened?.pendingId || null;
        } catch { /* store */ }
      }
      return refused(req, 'settle_unconfirmed', {
        pendingId,
        verifyUrl: lateVerifyUrl(cfg, pendingId),
        holdClass: 'resolvable',
        retryAfter: LATE_RETRY_AFTER_SEC,
        network: challenge?.network || null,
        sub: 'local_failure',
        capture: false,
      });
    }
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
  let solanaPayer = null;
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
    // /settle was called. These three exits release the nonce so one retry
    // can still settle, and they still return a resolvable handle. A 402
    // here would invite a second payment.
    const releasedHold = () => {
      let pendingId = lateRow?.pending_id || null;
      if (!pendingId && nonce) {
        const opened = openPostSettleHandle(active, {
          key: settleHoldKey(challenge.network, nonce),
          holdClass: 'resolvable',
          code: publicReason,
          cfg,
          paymentHash: headerDigest(paymentHeader),
        });
        pendingId = opened?.pendingId || null;
      }
      if (lateRow && !lateRow.public_code) lateRow.public_code = publicReason;
      return refused(req, publicReason, {
        stage,
        network: challenge.network,
        tx: hint,
        sub: why,
        pendingId,
        verifyUrl: lateVerifyUrl(cfg, pendingId),
        holdClass: 'resolvable',
        retryAfter: LATE_RETRY_AFTER_SEC,
      });
    };
    if (s1Release) {
      if (lateRow && typeof active.casLate === 'function') {
        try {
          active.casLate(lateRow.pending_id, ['submitted', 'unknown', 'confirmed'], 'unknown', {
            why,
            sent: true,
            tx_hint: hint || lateRow.tx_hint || null,
            hold_class: 'resolvable',
            public_code: lateRow.public_code || publicReason,
          });
        } catch { /* store */ }
      }
      try { active.revertSubmitted(nonce, owner); } catch { /* store */ }
      return releasedHold();
    }
    if (lateCapped && !terminal && (why === 'http' || why === 'success_false')) {
      try { active.release(nonce, owner); } catch { /* store */ }
      return releasedHold();
    }
    if (solana && !terminal && (why === 'http' || why === 'success_false')) {
      release();
      return releasedHold();
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
      sub_reason: refusalSubReason(why),
      phase: 'post_submit',
    });
    if (lateRow && typeof active.casLate === 'function') {
      const next = terminal ? 'mismatch_hold' : 'unknown';
      try {
        if (!lateRow.public_code) lateRow.public_code = publicReason;
        active.casLate(lateRow.pending_id, ['submitted', 'unknown', 'confirmed'], next, {
          why,
          sent: true,
          tx_hint: hint || lateRow.tx_hint || null,
          hold_class: terminal ? 'terminal' : 'resolvable',
          public_code: lateRow.public_code,
        });
      } catch { /* store */ }
    }
    // A late row's id is the public handle. Solana and a capped EVM payer
    // have no late row. recordPending's id is guessable, so it stays private.
    // One unguessable handle per nonce is what the verify page resolves.
    const holdClass = terminal ? 'terminal' : 'resolvable';
    let pendingId = lateRow?.pending_id || null;
    if (!pendingId && nonce) {
      const opened = openPostSettleHandle(active, {
        key: settleHoldKey(challenge.network, nonce),
        holdClass,
        code: publicReason,
        cfg,
        paymentHash: headerDigest(paymentHeader),
      });
      pendingId = opened?.pendingId || null;
    } else if (pendingId && nonce && typeof active.linkHoldHandle === 'function') {
      try { active.linkHoldHandle(settleHoldKey(challenge.network, nonce), pendingId, headerDigest(paymentHeader)); } catch { /* store */ }
    }
    const verifyUrl = lateVerifyUrl(cfg, pendingId);
    if (solana && nonce && typeof active.noteHoldHint === 'function') {
      active.noteHoldHint(settleHoldKey(challenge.network, nonce), {
        txHint: seenTx || null,
        network: challenge.network,
        payer: solanaPayer || null,
        blockhash: solanaBlockhash(paymentHeader),
      });
    }
    const solanaPendingHold = solana && !terminal;
    if ((!solana && lateIssueEnabled(cfg) && !terminal) || solanaPendingHold) {
      return refused(req, 'settle_pending', {
        retryAfter: LATE_RETRY_AFTER_SEC,
        pendingId,
        verifyUrl,
        holdClass: 'resolvable',
        capture: false,
        network: challenge.network,
        sub: why,
      });
    }
    return refused(req, publicReason, {
      pendingId,
      verifyUrl,
      holdClass,
      capture: false,
      network: challenge.network,
      sub: why,
    });
  };

  if (authKeyEarly && typeof active.findLate === 'function') {
    const priorLate = active.findLate({ authKey: authKeyEarly });
    if (priorLate && priorLate.nonce !== nonce) {
      release();
      return deny('payment_replayed', 'late_other_nonce');
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
      return deny('payment_replayed', 'auth_used_onchain');
    }
  }

  const verified = await verifyPayment(paymentHeader, gwOpts);
  if (!verified.valid) {
    release();
    return refused(req, clientPaymentCode(verified.reason || 'verify_failed'), { network: net, sub: 'facilitator_invalid', phase: 'pre_settle' });
  }
  if (typeof active.noteVerifiedPayment === 'function') {
    try { active.noteVerifiedPayment(nonce, headerDigest(paymentHeader)); } catch { /* store */ }
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
      return fail(bindCheck.reason, { network: net, sub: BIND_SUB[bindCheck.reason] || 'bind_other' });
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
      return fail('dispute_window_anchor_failed', { network: net, sub: 'anchor_failed' });
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
      if (opened.reason === 'replay_store_unavailable') return fail('replay_store_unavailable', { network: net, sub: 'store_unavailable' });
      return deny(opened.reason || 'payment_replayed', 'late_open');
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
    return refused(req, clientPaymentCode(settled?.reason || 'settle_failed'), { network: net, sub: 'settle_not_sent' });
  }
  seenTx = settled.transaction || settled.txRef || null;
  solanaPayer = settled.payer || null;
  postSent = true;
  postSentPending = lateRow?.pending_id || null;
  // Test-only observer. A throw here is the post-sent catch.
  if (testSwitchesOn() && typeof cfg.afterSent === 'function') cfg.afterSent();
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
  // F-1: from here /settle has returned sent, so funds have moved. A store
  // read or write that throws goes to hold('local_failure'), which records
  // the pending row and returns its pendingId and verifyUrl, never a bare
  // replay_store_unavailable.
  // Named exception: tx_spent, auth_spent_post, reserve_lost, inflight_tx.
  // The original payment already has its receipt. These are the replays.
  // They stay 409 payment_replayed and carry no handle.
  let txSpent;
  try {
    txSpent = active.isTxSpent(norm.key);
  } catch (err) {
    logger.warn({ err: err.message, taskId }, 'x402: spent-tx check failed after settle');
    return await hold('local_failure', 'settle_unconfirmed');
  }
  if (txSpent) {
    try { active.markSpent(nonce, { txRef: norm.key, replay: true }); } catch { /* store */ }
    return refused(req, 'payment_replayed', { network: net, sub: 'tx_spent' });
  }
  const authKey = !solana
    ? evmAuthKey(norm.network, challenge.asset, auth?.from, auth?.nonce)
    : null;
  if (!solana && !authKey) {
    return await hold('missing_replay_key', 'settle_unconfirmed');
  }
  let authSpent = false;
  try {
    authSpent = Boolean(authKey) && active.isAuthSpent(authKey);
  } catch (err) {
    logger.warn({ err: err.message, taskId }, 'x402: spent-auth check failed after settle');
    return await hold('local_failure', 'settle_unconfirmed');
  }
  if (authSpent) {
    try { active.markSpent(nonce, { txRef: norm.key, replay: true }); } catch { /* store */ }
    return refused(req, 'payment_replayed', { network: net, sub: 'auth_spent_post' });
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
      logger.warn({ err: err.message }, 'x402: reserveTx failed after settle');
      return await hold('local_failure', 'settle_unconfirmed');
    }
    if (!reserved) {
      try {
        if (active.isTxSpent(norm.key) || (authKey && active.isAuthSpent(authKey))) {
          active.markSpent(nonce, { txRef: norm.key, replay: true });
        }
      } catch { /* another holder has the lease; the replay answer stands */ }
      return refused(req, 'payment_replayed', { network: net, sub: 'reserve_lost' });
    }
  } else if (inflightTx.has(norm.key) || (authKey && inflightAuth.has(authKey))) {
    active.markSpent(nonce, { txRef: norm.key, replay: true });
    return refused(req, 'payment_replayed', { network: net, sub: 'inflight_tx' });
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
    if (solana) {
      const sig = fields.transaction || seenTx;
      const failed = !chain.pending && await solanaFinalizedError(cfg, sig);
      const dropped = chain.pending && await solanaFundsUnmoved(cfg, sig, solanaBlockhash(paymentHeader));
      if (failed || dropped) {
        if (typeof active.patch === 'function') {
          active.patch(nonce, { state: 'issued', lease_owner: null, lease_until: null });
        }
        let pendingId = lateRow?.pending_id || null;
        if (!pendingId && nonce) {
          const opened = openPostSettleHandle(active, {
            key: settleHoldKey(challenge.network, nonce),
            holdClass: 'terminal',
            code: 'not_settled',
            cfg,
            paymentHash: headerDigest(paymentHeader),
          });
          pendingId = opened?.pendingId || null;
        }
        const verifyUrl = lateVerifyUrl(cfg, pendingId);
        return refused(req, 'not_settled', {
          pendingId,
          verifyUrl,
          holdClass: 'terminal',
          network: challenge.network,
          sub: failed ? 'chain_mismatch' : 'missing_tx',
        });
      }
    }
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
    // The transfer is on chain from another wallet. Write the refund row
    // first (pending row, late row to mismatch_hold) so the payer gets a
    // pendingId and verifyUrl, then mark the tx and nonce spent so the
    // transfer can never unlock this bound resource later.
    const held = await hold('payer', 'payer_mismatch', { terminal: true });
    try {
      active.markSpent(nonce, { txRef: norm.key, payer: chain.payer, rejected: 'payer_mismatch' });
      active.markTxSpent(norm.key);
    } catch (err) {
      logger.warn({ err: err.message, taskId }, 'x402: spent mark failed after payer mismatch');
    }
    return held;
  }

  const house = await houseSettlementIdentity({
    paymentHeader,
    challenge,
    chain,
    txRef: norm.key,
    cfg,
  });
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
    chainId: house.chainId,
    authNonce: house.nonce,
    token: house.token,
    authorizer: house.authorizer,
    observation: house.observation,
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
        holdClass: 'resolvable',
        network: net,
        sub: 'late_unmarked',
      });
    }
  }

  const issuedTaskId = strictTaskId ? taskId : (challenge.taskId || taskId);
  if (nonce && typeof active.findHoldHandleByKey === 'function' && typeof active.linkHoldHandle === 'function') {
    try {
      const key = settleHoldKey(challenge.network, nonce);
      const existing = active.findHoldHandleByKey(key);
      if (existing?.pending_id) active.linkHoldHandle(key, { taskId: issuedTaskId }, headerDigest(paymentHeader));
    } catch { /* store */ }
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
    chainId: house.chainId,
    nonce: house.nonce,
    token: house.token,
    authorizer: house.authorizer,
    observation: house.observation,
    network: challenge.network || null,
  };
  }
  }
}

function refused(req, reason, extra = {}) {
  const code = ['challenge_required', 'challenge_mismatch', 'network_not_accepted', 'payment_replayed', 'payment_in_flight', 'settle_unconfirmed', 'settle_pending', 'not_settled', 'idempotency_conflict', 'replay_store_unavailable', 'payer_mismatch', 'stamp_underpaid', 'verify_failed', 'settle_failed', 'gateway_not_configured', 'invalid_payment_ref', 'payment_scheme_unsupported'].includes(reason)
    ? reason
    : clientPaymentCode(reason);
  // pre_settle: /settle was not called. A /verify refusal is pre_settle
  // too, though its row has stage settle (extra.phase).
  const phase = extra.phase || (extra.preSettle ? 'pre_settle' : 'post_submit');
  const sub = refusalSubReason(extra.sub);
  if (extra.capture !== false) {
    recordReceiptFailure({
      network: extra.network || null,
      stage: extra.stage || (extra.preSettle ? 'pre-check' : 'settle'),
      reason: code,
      tx: extra.tx || null,
      outcome: extra.outcome || 'refused',
      requestId: req?.id || null,
      preSettle: extra.preSettle === true,
      sub_reason: sub,
      phase,
    });
  }
  recordRefusal(code, userAgentOf(req), refusalMeta(extra.network, sub, phase));
  const out = {
    kind: 'failed',
    reason: code,
    code,
    preSettle: extra.preSettle === true,
    retryAfter: extra.retryAfter,
    pendingId: extra.pendingId || null,
    verifyUrl: extra.verifyUrl || null,
  };
  if (extra.holdClass === 'resolvable' || extra.holdClass === 'terminal') out.holdClass = extra.holdClass;
  return out;
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
