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
  'payer_mismatch',
  'payer_not_bound',
  'owner_proof_required',
  'owner_proof_unavailable',
  'invalid_payment_ref',
  'stamp_underpaid',
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
  if (code === 'gateway_not_configured' || code === 'x402_unavailable') return 503;
  if (code === 'payer_mismatch' || code === 'payer_not_bound' || code === 'owner_proof_required' || code === 'owner_proof_unavailable') {
    return 403;
  }
  if (code === 'payment_replayed') return 409;
  return 402;
}

export function paymentErrorBody(code) {
  const c = CLOSED.has(code) ? code : clientPaymentCode(code);
  return { error: c, code: c };
}

/** Binding failures must not downgrade onto another rail. */
export function isBindingRefusal(code) {
  return CLOSED.has(code) && code !== 'gateway_not_configured';
}

export function recordRefusal(code, userAgent) {
  if (code !== 'challenge_required' && code !== 'challenge_mismatch' && code !== 'payment_in_flight') return;
  const ua = String(userAgent || 'unknown').slice(0, 80);
  const key = `${code}|${ua}`;
  refusalCounts.set(key, (refusalCounts.get(key) || 0) + 1);
  logger.warn({ code, ua, count: refusalCounts.get(key) }, 'x402: payment binding refusal');
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
