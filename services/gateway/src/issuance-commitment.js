/**
 * Issuance-commitment bind (design-partner seat) — ties x402 auth to
 * (chain_id, settlement_contract, nonce, content_hash) and anchors dispute
 * windows on Base L1 block timestamps.
 */

import { getAddress, keccak256, solidityPacked, JsonRpcProvider } from 'ethers';
import { decodePaymentHeader } from './x402-facilitator.js';
import config from './config.js';
import logger from './logger.js';

/** Base mainnet — home chain for L1-timestamped dispute windows. */
export const BASE_HOME_CHAIN_ID = 8453;

export const DEFAULT_DISPUTE_WINDOW_SEC = 7 * 24 * 60 * 60;

const BYTES32_RE = /^0x[0-9a-f]{64}$/;

export function normalizeBytes32(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (BYTES32_RE.test(s)) return s;
  const bare = s.replace(/^0x/, '');
  if (/^[0-9a-f]{64}$/.test(bare)) return `0x${bare}`;
  return null;
}

export function normalizeChainId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  const s = String(value).trim();
  if (/^eip155:\d+$/i.test(s)) return parseInt(s.split(':')[1], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

export function normalizeSettlementContract(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return getAddress(value.trim());
  } catch {
    return null;
  }
}

export function normalizeAuthNonce(value) {
  const n = normalizeBytes32(value);
  return n;
}

/**
 * Deterministic issuance commitment over the bind tuple.
 * @param {{ chain_id: number, settlement_contract: string, nonce: string, content_hash: string }} bind
 */
export function computeIssuanceCommitment(bind) {
  const chainId = BigInt(bind.chain_id);
  const contract = getAddress(bind.settlement_contract);
  const nonce = normalizeAuthNonce(bind.nonce);
  const content = normalizeBytes32(bind.content_hash);
  if (!nonce || !content) {
    throw new Error('issuance_bind_invalid_tuple');
  }
  return keccak256(
    solidityPacked(
      ['uint256', 'address', 'bytes32', 'bytes32'],
      [chainId, contract, nonce, content],
    ),
  );
}

/**
 * Parse optional issuance bind from an API body (OpenAI / task-request).
 * Fail-closed when the bind object is present but incomplete.
 */
export function parseIssuanceBindFromBody(body = {}) {
  const raw = body?.xfuel?.issuance_bind ?? body?.issuance_bind;
  if (raw == null || raw === false) return { requested: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { requested: true, ok: false, reason: 'issuance_bind_invalid' };
  }
  const chain_id = normalizeChainId(raw.chain_id);
  const settlement_contract = normalizeSettlementContract(raw.settlement_contract);
  const content_hash = normalizeBytes32(raw.content_hash);
  const nonce = raw.nonce != null && raw.nonce !== '' ? normalizeAuthNonce(raw.nonce) : null;
  const missing = [];
  if (!chain_id) missing.push('chain_id');
  if (!settlement_contract) missing.push('settlement_contract');
  if (!content_hash) missing.push('content_hash');
  if (missing.length) {
    return { requested: true, ok: false, reason: `issuance_bind_missing_${missing.join('_')}` };
  }
  return {
    requested: true,
    ok: true,
    bind: { chain_id, settlement_contract, nonce, content_hash },
  };
}

/**
 * Merge client bind with challenge nonce + settlement asset for storage on the challenge.
 */
export function issuanceBindForChallenge(clientBind, { challengeNonce, settlementContract }) {
  const contract = normalizeSettlementContract(settlementContract);
  if (!contract) return { ok: false, reason: 'settlement_contract_unconfigured' };
  if (clientBind.settlement_contract.toLowerCase() !== contract.toLowerCase()) {
    return { ok: false, reason: 'issuance_bind_settlement_contract_mismatch' };
  }
  const nonce = normalizeAuthNonce(challengeNonce);
  if (!nonce) return { ok: false, reason: 'challenge_nonce_missing' };
  return {
    ok: true,
    bind: {
      chain_id: clientBind.chain_id,
      settlement_contract: contract,
      nonce,
      content_hash: clientBind.content_hash,
    },
  };
}

function domainChainId(domain) {
  if (!domain) return null;
  const raw = domain.chainId ?? domain.chain_id;
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
  try {
    return Number(BigInt(raw));
  } catch {
    return null;
  }
}

/**
 * Challenge nonce echoed by the payer (402 accepts[0].extra.nonce binding).
 * v2 ExactEvmScheme / CDP clients put this on `accepted.extra.nonce`, not in EIP-3009 auth.
 */
export function extractPaymentChallengeNonce(paymentHeader) {
  if (!paymentHeader) return null;
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return null;
  if (decoded.accepted?.extra?.nonce != null && decoded.accepted.extra.nonce !== '') {
    return normalizeAuthNonce(decoded.accepted.extra.nonce);
  }
  if (decoded.nonce != null && decoded.nonce !== '') {
    return normalizeAuthNonce(decoded.nonce);
  }
  return null;
}

/**
 * Extract EIP-3009 authorization fields from an x402 payment header blob.
 * Uses the signed `transferWithAuthorization` message nonce (payload.authorization for v2).
 * @returns {{ chain_id: number|null, settlement_contract: string|null, nonce: string|null, to: string|null, challenge_nonce: string|null }|null}
 */
export function extractEvmAuthorizationFromPayment(paymentHeader) {
  if (!paymentHeader) return null;
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return null;

  let auth = decoded.authorization;
  let domain = auth?.domain;
  let message = auth?.message || auth;

  const payload = decoded.payload;
  if (payload?.authorization) {
    auth = payload.authorization;
    message = auth.message || auth;
    domain = auth.domain || domain;
  }

  const challenge_nonce = extractPaymentChallengeNonce(paymentHeader);
  let authNonce = normalizeAuthNonce(message?.nonce);
  if (!authNonce && challenge_nonce) {
    // v1 XFuel SDK: top-level / message nonce is the EIP-3009 bytes32.
    authNonce = challenge_nonce;
  }
  if (!authNonce) {
    authNonce = normalizeAuthNonce(decoded.nonce);
  }

  const accepted = decoded.accepted;
  if (authNonce && accepted && domainChainId(domain) == null) {
    const chainFromNetwork = normalizeChainId(accepted.network);
    if (chainFromNetwork) {
      domain = { ...(domain || {}), chainId: chainFromNetwork };
    }
  }

  const to = message?.to ? normalizeSettlementContract(message.to) : null;
  const chain_id = domainChainId(domain)
    ?? (accepted?.network ? normalizeChainId(accepted.network) : null);

  return {
    chain_id,
    settlement_contract: null,
    nonce: authNonce,
    to,
    challenge_nonce,
  };
}

/**
 * Verify payment authorization against a stored issuance bind (fail-closed).
 */
export function verifyIssuanceBindAtSettle({
  storedBind,
  paymentHeader,
  challengeNonce,
  settlementContract,
}) {
  if (!storedBind?.required) return { ok: true, skipped: true };

  const merged = issuanceBindForChallenge(storedBind, {
    challengeNonce,
    settlementContract,
  });
  if (!merged.ok) return { ok: false, reason: merged.reason };

  const expectedChallengeNonce = merged.bind.nonce;
  const auth = extractEvmAuthorizationFromPayment(paymentHeader);
  if (!auth?.nonce) {
    return { ok: false, reason: 'issuance_bind_auth_missing_nonce' };
  }

  const paymentChallengeNonce = auth.challenge_nonce
    ?? extractPaymentChallengeNonce(paymentHeader);
  if (paymentChallengeNonce) {
    if (paymentChallengeNonce.toLowerCase() !== expectedChallengeNonce.toLowerCase()) {
      return { ok: false, reason: 'issuance_bind_nonce_mismatch' };
    }
  } else if (auth.nonce.toLowerCase() !== expectedChallengeNonce.toLowerCase()) {
    // v1: no accepted.extra echo — EIP-3009 nonce must match the issued challenge nonce.
    return { ok: false, reason: 'issuance_bind_nonce_mismatch' };
  }

  const bind = {
    ...merged.bind,
    nonce: auth.nonce,
  };

  if (storedBind.nonce && normalizeAuthNonce(storedBind.nonce)) {
    const clientNonce = normalizeAuthNonce(storedBind.nonce);
    if (clientNonce.toLowerCase() !== expectedChallengeNonce.toLowerCase()) {
      return { ok: false, reason: 'issuance_bind_client_nonce_mismatch' };
    }
  }

  if (auth.chain_id != null && Number(auth.chain_id) !== Number(bind.chain_id)) {
    return { ok: false, reason: 'issuance_bind_chain_id_mismatch' };
  }

  const contract = normalizeSettlementContract(settlementContract);
  if (!contract || contract.toLowerCase() !== bind.settlement_contract.toLowerCase()) {
    return { ok: false, reason: 'issuance_bind_settlement_contract_mismatch' };
  }

  let commitment;
  try {
    commitment = computeIssuanceCommitment(bind);
  } catch {
    return { ok: false, reason: 'issuance_bind_commitment_failed' };
  }

  return {
    ok: true,
    bind,
    commitment,
    authorization: {
      chain_id: bind.chain_id,
      settlement_contract: bind.settlement_contract,
      nonce: bind.nonce,
      content_hash: bind.content_hash,
      payee: auth.to,
    },
  };
}

export function buildIssuanceCommitmentPublic(bind, commitment) {
  return {
    bind: {
      chain_id: bind.chain_id,
      settlement_contract: bind.settlement_contract,
      nonce: bind.nonce,
      content_hash: bind.content_hash,
    },
    commitment,
  };
}

/**
 * L1-anchored dispute window (wall clock is advisory only; closes_at is L1 seconds).
 */
/**
 * Resolve L1 anchor for dispute windows (Base home chain). Prefer latest block timestamp.
 * @param {{ chain_id?: number, block_number?: number|null, timestamp?: number, anchor_source?: string }|null} [override]
 */
export async function fetchBaseL1Anchor(override = null) {
  if (override?.timestamp != null) return override;
  const rpc = config.settlement?.rpcUrl || process.env.BASE_RPC_URL || null;
  if (!rpc) {
    return {
      chain_id: BASE_HOME_CHAIN_ID,
      block_number: null,
      timestamp: Math.floor(Date.now() / 1000),
      anchor_source: 'wall_clock_fallback',
    };
  }
  try {
    const provider = new JsonRpcProvider(rpc, BASE_HOME_CHAIN_ID, { staticNetwork: true });
    const block = await provider.getBlock('latest');
    if (!block?.timestamp) throw new Error('missing_block_timestamp');
    return {
      chain_id: BASE_HOME_CHAIN_ID,
      block_number: block.number,
      timestamp: block.timestamp,
      anchor_source: 'base_rpc',
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'issuance: Base L1 anchor fetch failed');
    throw err;
  }
}

export function buildDisputeWindow({
  chainId = BASE_HOME_CHAIN_ID,
  anchorBlock,
  anchorTimestamp,
  durationSec = DEFAULT_DISPUTE_WINDOW_SEC,
  anchorSource = null,
} = {}) {
  const ts = Number(anchorTimestamp);
  const block = Number(anchorBlock);
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new Error('dispute_window_invalid_anchor_timestamp');
  }
  const duration = Number(durationSec);
  return {
    chain_id: Number(chainId),
    anchor_block: Number.isFinite(block) && block >= 0 ? block : null,
    anchor_timestamp: ts,
    duration_sec: duration,
    opens_at: ts,
    closes_at: ts + duration,
    clock: 'l1_block_timestamp',
    anchor_source: anchorSource,
  };
}

export function isDisputeWindowOpen(disputeWindow, { l1Timestamp, nowSec = null } = {}) {
  if (!disputeWindow || typeof disputeWindow !== 'object') return { open: false, reason: 'no_dispute_window' };
  const now = l1Timestamp != null
    ? Number(l1Timestamp)
    : (nowSec != null ? Number(nowSec) : Math.floor(Date.now() / 1000));
  if (!Number.isFinite(now)) return { open: false, reason: 'invalid_clock' };
  if (now < disputeWindow.opens_at) return { open: false, reason: 'dispute_window_not_yet_open' };
  if (now > disputeWindow.closes_at) return { open: false, reason: 'dispute_window_closed' };
  return { open: true, reason: 'within_window' };
}
