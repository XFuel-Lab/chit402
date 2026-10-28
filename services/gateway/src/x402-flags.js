/**
 * Payment-binding flags and the closed client error set.
 * X402_ALLOW_UNBOUND is an emergency rollback. Off is the enforced path.
 */
import logger from './logger.js';
import { getAddress } from 'ethers';
import { isSolanaNetwork, fromCaip2Network } from './x402-facilitator.js';

export const PAYMENT_ERROR_CODES = Object.freeze([
  'challenge_required',
  'challenge_mismatch',
  'network_not_accepted',
  'payment_replayed',
  'payment_in_flight',
  'verify_failed',
  'settle_failed',
  'settle_unconfirmed',
  'settle_pending',
  'idempotency_conflict',
  'replay_store_unavailable',
  'payer_mismatch',
  'payer_not_bound',
  'owner_proof_required',
  'owner_proof_unavailable',
  'invalid_payment_ref',
  'stamp_underpaid',
  'payment_scheme_unsupported',
  'gateway_not_configured',
]);

const CLOSED = new Set(PAYMENT_ERROR_CODES);

const MAINNET = new Set([
  'base',
  'eip155:8453',
  'solana',
  'solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp',
]);

const TESTNET = new Set([
  'base-sepolia',
  'eip155:84532',
  'solana-devnet',
  'solana:etwtrabzayq6imfeykouru166vu2xqa1',
]);

/** Refusal counters for the first days after the guard is on. */
const refusalCounts = new Map();

export function allowUnboundFrom(cfg) {
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'allowUnboundPayments')) {
    return cfg.allowUnboundPayments === true;
  }
  return process.env.X402_ALLOW_UNBOUND === 'true';
}

export function bindingEnforced(cfg) {
  return !allowUnboundFrom(cfg);
}

export function isMainnetNetwork(network) {
  if (!network) return false;
  const short = fromCaip2Network(String(network)).toLowerCase();
  const raw = String(network).toLowerCase();
  return MAINNET.has(short) || MAINNET.has(raw);
}

/**
 * TFUEL is not a buyer rail on Base or Solana mainnet. The opt-in fallback
 * and an explicit tfuel rail stay available on known testnets.
 * @param {string|null|undefined} network
 */
export function tfuelBuyerRailAllowed(network) {
  if (!network) return false;
  return !isMainnetNetwork(network);
}

/**
 * Production boot refuses the rollback flag on a mainnet network.
 * Testnet may boot with the flag; every unbound use logs at error level.
 */
export function assertX402Boot(cfg = {}) {
  if (!allowUnboundFrom(cfg)) return;
  // L: allow the flag only on known testnets. An unknown or padded string
  // ("base ", "BASE-MAINNET", "mainnet-beta") counts as mainnet.
  const nets = [cfg.network, cfg.solana?.network].filter(Boolean);
  if (nets.some((n) => !TESTNET.has(String(n).toLowerCase()))) {
    const err = new Error('X402_ALLOW_UNBOUND refused on a mainnet network');
    err.code = 'x402_boot_refused';
    throw err;
  }
}

export function noteUnboundUse(where, extra = {}) {
  logger.error({ where, ...extra }, 'x402: unbound payment path used');
}

export function isClosedPaymentCode(code) {
  return CLOSED.has(code);
}

/** Map internal / upstream reasons onto the closed client set. */
export function clientPaymentCode(reason) {
  if (CLOSED.has(reason)) return reason;
  if (reason === 'x402_unavailable') return 'gateway_not_configured';
  if (reason === 'missing_payment_header' || reason === 'payment_header_undecodable' || reason === 'payment_payload_invalid') {
    return 'verify_failed';
  }
  const s = String(reason || '');
  if (s.startsWith('facilitator_http_') || s === 'facilitator_error' || s === 'gateway_error' || s === 'mock_rejected') {
    return 'verify_failed';
  }
  if (s === 'mock_settle_rejected' || s.startsWith('gateway_http_')) return 'settle_failed';
  return 'verify_failed';
}

export function paymentErrorStatus(code) {
  if (code === 'gateway_not_configured' || code === 'x402_unavailable' || code === 'replay_store_unavailable') return 503;
  if (code === 'payer_mismatch' || code === 'payer_not_bound' || code === 'owner_proof_required' || code === 'owner_proof_unavailable') {
    return 403;
  }
  if (code === 'payment_replayed' || code === 'idempotency_conflict') return 409;
  return 402;
}

/** Late-issue public ids are 16 random bytes, hex. Anything else is not a handle. */
const REAL_PENDING_ID = /^[0-9a-f]{32}$/;

export function realPendingId(id) {
  return typeof id === 'string' && REAL_PENDING_ID.test(id);
}

/**
 * Seconds a resolvable hold asks the client to wait. Matches the late
 * reconciler's published wait. A caller may set a shorter one (the in-process
 * paid replay uses 2) and that value is kept.
 */
export const RESOLVABLE_RETRY_AFTER_SEC = 5;

function retrySeconds(value, fallback) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 3600) return n;
  return fallback;
}

/**
 * Status for one payment failure.
 * 202 and 409 refund_owed only when the decision names its class and carries
 * a real pending id. Anything else keeps today's status for that code.
 * A named class with no usable id is the documented non-402 fallback
 * (409, no refund_owed field, no Retry-After): the handle write failed and
 * the client must not be told to pay again, and must not be given a 202.
 * @returns {{ status: number, retryAfter: number|null, refundOwed: boolean, fallback: boolean }}
 */
export function paymentFailureStatus(decision) {
  const code = decision && (decision.code || decision.reason);
  const today = paymentErrorStatus(code);
  // A pre-settle refusal is never a hold, even if a caller attached a class.
  if (decision?.preSettle === true) {
    return {
      status: today,
      retryAfter: retrySeconds(decision.retryAfter, null),
      refundOwed: false,
      fallback: false,
    };
  }
  const klass = decision && decision.holdClass;
  if (klass !== 'resolvable' && klass !== 'terminal') {
    const retryAfter = retrySeconds(decision?.retryAfter, null);
    return { status: today, retryAfter, refundOwed: false, fallback: false };
  }
  const pending = decision.pendingId ?? decision.pending_id;
  if (!realPendingId(pending)) {
    return { status: 409, retryAfter: null, refundOwed: false, fallback: true };
  }
  if (klass === 'resolvable') {
    return {
      status: 202,
      retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),
      refundOwed: false,
      fallback: false,
    };
  }
  return { status: 409, retryAfter: null, refundOwed: true, fallback: false };
}

export function paymentErrorBody(code) {
  const c = CLOSED.has(code) ? code : clientPaymentCode(code);
  return { error: c, code: c };
}

/**
 * Closed payment failure plus the late-issue handles. No challenge body.
 * A resolvable hold keeps today's keys, values and order. A terminal hold
 * adds status: "refund_owed" after the handles. A class with no handle is
 * the fallback sentence and nothing else.
 */
export function paymentFailureBody(decision) {
  const code = decision?.code || decision?.reason;
  const base = paymentErrorBody(code);
  const view = paymentFailureStatus(decision);
  if (view.fallback) {
    return { error: base.error, code: base.code, message: 'Do not pay again.' };
  }
  if (!view.refundOwed && view.status !== 202) {
    if (typeof decision?.receiptJws === 'string' && decision.receiptJws) {
      return { ...base, receipt_jws: decision.receiptJws };
    }
    return base;
  }
  const body = { error: base.error, code: base.code };
  const pending = decision?.pendingId || decision?.pending_id;
  const verify = decision?.verifyUrl || decision?.verify_url;
  if (pending) body.pending_id = pending;
  if (verify) body.verify_url = verify;
  if (view.refundOwed) body.status = 'refund_owed';
  if (typeof decision?.receiptJws === 'string' && decision.receiptJws) body.receipt_jws = decision.receiptJws;
  return body;
}

/** Header only. A null retryAfter leaves the response without Retry-After. */
export function setHoldRetryAfter(res, retryAfter) {
  if (retryAfter == null || retryAfter === '') return;
  res.set('Retry-After', String(retryAfter));
}

/**
 * JSON for a stamp or board failure that already ran through the status helper.
 * Pre-settle results have none of the hold fields, so their bytes stay put.
 */
export function stampFailureBody(result) {
  const closed = result?.code || result?.error;
  const hold = {
    ...(result?.pending_id ? { pending_id: result.pending_id } : {}),
    ...(result?.verify_url ? { verify_url: result.verify_url } : {}),
    ...(result?.outcome === 'refund_owed' ? { status: 'refund_owed' } : {}),
  };
  if (isBindingRefusal(closed)) {
    return {
      error: closed,
      code: closed,
      ...(result?.message ? { message: result.message } : {}),
      ...hold,
    };
  }
  return {
    error: result?.error,
    ...(result?.message ? { message: result.message } : {}),
    ...hold,
  };
}

/**
 * The object a route returns to its caller for one post-settle decision.
 * HTTP status, Retry-After and the public fields, and nothing else.
 */
export function decisionHoldResult(decision) {
  const view = paymentFailureStatus(decision);
  const body = paymentFailureBody(decision);
  return {
    ok: false,
    status: view.status,
    error: body.error,
    code: body.code,
    ...(body.pending_id ? { pending_id: body.pending_id } : {}),
    ...(body.verify_url ? { verify_url: body.verify_url } : {}),
    ...(body.message ? { message: body.message } : {}),
    ...(body.status === 'refund_owed' ? { outcome: 'refund_owed' } : {}),
    ...(view.status === 202 && view.retryAfter != null ? { retryAfter: view.retryAfter } : {}),
  };
}

/** Binding failures must not downgrade onto another rail. */
export function isBindingRefusal(code) {
  return CLOSED.has(code) && code !== 'gateway_not_configured';
}

/**
 * Logs one settle refusal. `meta` is bounded by the caller (x402-settle.js
 * refusalMeta): a network name, a sub_reason from REFUSAL_SUB_REASONS and a
 * phase. Nothing else from the request reaches the line except the
 * truncated user agent, as before.
 */
export function recordRefusal(code, userAgent, meta = null) {
  const fields = meta && typeof meta === 'object'
    ? { network: meta.network, sub_reason: meta.sub_reason, phase: meta.phase }
    : {};
  if (code !== 'challenge_required' && code !== 'challenge_mismatch' && code !== 'payment_in_flight') {
    if (meta) logger.info({ code, ...fields }, 'x402: settle refusal');
    return;
  }
  const ua = String(userAgent || 'unknown').slice(0, 80);
  const key = `${code}|${ua}`;
  refusalCounts.set(key, (refusalCounts.get(key) || 0) + 1);
  logger.warn({ code, ua, count: refusalCounts.get(key), ...fields }, 'x402: payment binding refusal');
}

export function refusalSnapshot() {
  return Object.fromEntries(refusalCounts.entries());
}

export function resetRefusalCounts() {
  refusalCounts.clear();
}

export function truncateWallet(addr) {
  const s = String(addr || '');
  if (s.length < 12) return s ? `${s.slice(0, 2)}…` : '';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function sameEvmAddress(a, b) {
  if (!a || !b) return false;
  try {
    return getAddress(String(a)) === getAddress(String(b));
  } catch {
    return false;
  }
}

/** EVM via checksum. Solana exact, never lowercased. */
export function samePayee(a, b, { solana = false } = {}) {
  if (solana || isSolanaNetwork(a) || looksSolana(a) || looksSolana(b)) {
    return typeof a === 'string' && typeof b === 'string' && a === b;
  }
  if (sameEvmAddress(a, b)) return true;
  // Test fixtures use non-address payees ('0xtreasury'). Compare the raw string.
  return typeof a === 'string' && typeof b === 'string' && a === b;
}

function looksSolana(s) {
  return typeof s === 'string' && !s.startsWith('0x') && s.length >= 32 && s.length <= 44;
}

export function userAgentOf(req) {
  const h = req?.headers?.['user-agent'];
  return typeof h === 'string' ? h : '';
}
