/**
 * Session-delegation v1 — reusable EIP-712 agent_pubkey grants (Bankr lock 2026-09-04).
 *
 * Bind-at-settle: receipt JWS is born with payer_wallet + session fields.
 * Late assign never mutates a genesis JWS; it issues a distinct child handoff
 * receipt that references parent_receipt_id + the same delegation proof.
 *
 * v1 key type is secp256k1 (EVM) only. Amounts are atomic USDC (6 decimals).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  TypedDataEncoder,
  verifyTypedData,
  getAddress,
  isAddress,
} from 'ethers';
import logger from './logger.js';

export const USDC_ATOMIC_DECIMALS = 6;
export const USDC_ATOMIC_UNIT = 'atomic_usdc';

/** Base mainnet. Domain separator is load-bearing — do not silently swap chains. */
export const SESSION_CHAIN_ID = 8453;

/** Sentinel verifyingContract when no on-chain session registry is configured. */
export const SESSION_VERIFYING_CONTRACT_DEFAULT =
  '0x0000000000000000000000000000000000000402';

export const AGENT_KEY_TYPE_SECP256K1 = 'secp256k1';

export const SESSION_EIP712_NAME = 'Chit402';
export const SESSION_EIP712_VERSION = '1';

export const AUTHORIZE_SESSION_PRIMARY = 'AuthorizeSession';
export const REVOKE_SESSION_PRIMARY = 'RevokeSession';

/** Default session TTL (seconds). Lock prefers 1h–24h; 24h is the default cap. */
export const SESSION_DEFAULT_TTL_SEC = 24 * 60 * 60;
export const SESSION_MIN_TTL_SEC = 60 * 60;
export const SESSION_MAX_TTL_SEC = 24 * 60 * 60;

export const AUTHORIZE_SESSION_TYPES = {
  AuthorizeSession: [
    { name: 'agentPubkey', type: 'address' },
    { name: 'agentKeyType', type: 'string' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'maxCumulativeSpend', type: 'uint256' },
    { name: 'allowedRoutes', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export const REVOKE_SESSION_TYPES = {
  RevokeSession: [
    { name: 'agentPubkey', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'delegationHash', type: 'bytes32' },
  ],
};

/**
 * EIP-712 domain for session v1. chainId is always Base (8453).
 * verifyingContract is a domain separator (registry or the 0x…0402 sentinel).
 * issuerUri is published alongside so verifiers can resolve the issuer without
 * treating Chit as the sole attestor.
 *
 * @param {{ verifyingContract?: string, issuerUri?: string, chainId?: number }} [opts]
 */
export function sessionEip712Domain(opts = {}) {
  const chainId = Number(opts.chainId ?? SESSION_CHAIN_ID);
  const verifyingContract = checksumOrDefault(
    opts.verifyingContract,
    SESSION_VERIFYING_CONTRACT_DEFAULT,
  );
  return {
    name: SESSION_EIP712_NAME,
    version: SESSION_EIP712_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Pin a client-supplied EIP-712 domain to the Chit402 / Base session v1
 * separator. Omitted fields are filled. A present-but-wrong name, version,
 * chainId, or verifyingContract is rejected — a Base signature over a
 * different domain must not bind or revoke.
 *
 * @param {object|null|undefined} domain
 * @param {{ verifyingContract?: string|null }} [opts]
 * @returns {{ ok: true, domain: object } | { ok: false, reason: string }}
 */
export function canonicalizeSessionDomain(domain, { verifyingContract = null } = {}) {
  const expected = sessionEip712Domain({ verifyingContract: verifyingContract || undefined });
  const incoming = domain && typeof domain === 'object' ? domain : {};

  if (incoming.chainId != null && Number(incoming.chainId) !== SESSION_CHAIN_ID) {
    return { ok: false, reason: 'chain_id_not_base' };
  }
  if (incoming.name != null && String(incoming.name) !== SESSION_EIP712_NAME) {
    return { ok: false, reason: 'domain_name_mismatch' };
  }
  if (incoming.version != null && String(incoming.version) !== SESSION_EIP712_VERSION) {
    return { ok: false, reason: 'domain_version_mismatch' };
  }
  if (incoming.verifyingContract != null) {
    if (!isAddress(incoming.verifyingContract)) {
      return { ok: false, reason: 'verifying_contract_mismatch' };
    }
    if (getAddress(incoming.verifyingContract) !== expected.verifyingContract) {
      return { ok: false, reason: 'verifying_contract_mismatch' };
    }
  }

  return {
    ok: true,
    domain: {
      name: SESSION_EIP712_NAME,
      version: SESSION_EIP712_VERSION,
      chainId: SESSION_CHAIN_ID,
      verifyingContract: expected.verifyingContract,
    },
  };
}

/** True when the settled x402 payer is the AuthorizeSession signer. */
export function sessionMatchesSettledPayer(session, settledPayer) {
  if (!session?.payer_wallet || !settledPayer) return false;
  try {
    return getAddress(session.payer_wallet) === getAddress(settledPayer);
  } catch {
    return String(session.payer_wallet).toLowerCase() === String(settledPayer).toLowerCase();
  }
}

/**
 * Who is allowed to revoke. Never trust a caller-supplied payer_wallet.
 * Stored session payer wins; otherwise the original AuthorizeSession proof
 * must recover the payer (early revoke before first bind).
 *
 * @param {{
 *   storedSession?: object|null,
 *   authorizeProof?: object|null,
 *   expectedDelegationHash?: string|null,
 *   verifyingContract?: string|null,
 * }} [opts]
 */
export function resolveRevokeExpectedPayer({
  storedSession = null,
  authorizeProof = null,
  expectedDelegationHash = null,
  verifyingContract = null,
} = {}) {
  if (storedSession?.payer_wallet && isAddress(storedSession.payer_wallet)) {
    if (expectedDelegationHash && storedSession.delegation_hash) {
      if (normalizeSessionNonce(storedSession.delegation_hash)
        !== normalizeSessionNonce(expectedDelegationHash)) {
        return { ok: false, reason: 'delegation_hash_mismatch' };
      }
    }
    return { ok: true, expectedPayer: getAddress(storedSession.payer_wallet), source: 'store' };
  }
  if (authorizeProof) {
    const signature = authorizeProof.signature || authorizeProof.sig || null;
    let typedData = authorizeProof.typed_data || authorizeProof.typedData || null;
    if (!typedData && authorizeProof.message) {
      typedData = {
        domain: authorizeProof.domain || sessionEip712Domain({ verifyingContract }),
        types: authorizeProof.types || AUTHORIZE_SESSION_TYPES,
        primaryType: authorizeProof.primaryType || AUTHORIZE_SESSION_PRIMARY,
        message: authorizeProof.message,
      };
    }
    if (!typedData || !signature) {
      return { ok: false, reason: 'missing_authorize_proof' };
    }
    // Crypto only — window/expiry does not block a payer from revoking.
    const verified = verifyAuthorizeSession(typedData, signature, { verifyingContract });
    if (!verified.valid) {
      return { ok: false, reason: verified.reason || 'authorize_proof_invalid' };
    }
    if (expectedDelegationHash && verified.delegation_hash) {
      if (normalizeSessionNonce(verified.delegation_hash)
        !== normalizeSessionNonce(expectedDelegationHash)) {
        return { ok: false, reason: 'delegation_hash_mismatch' };
      }
    }
    return { ok: true, expectedPayer: verified.payer_wallet, source: 'authorize_proof' };
  }
  return { ok: false, reason: 'unknown_session' };
}

/** keccak256 of the issuer URI, used as EIP-712 domain salt when a URI is known. */
export function issuerSalt(issuerUri) {
  return crypto.createHash('sha256').update(String(issuerUri), 'utf8').digest();
}

function checksumOrDefault(value, fallback) {
  if (value && isAddress(value)) {
    try { return getAddress(value); } catch { /* fall through */ }
  }
  return getAddress(fallback);
}

/**
 * Canonical allowed_routes string for EIP-712. Sorted unique paths, or "*".
 * @param {string|string[]|null|undefined} routes
 */
export function canonicalizeAllowedRoutes(routes) {
  if (routes == null || routes === '' || routes === '*') return '*';
  if (Array.isArray(routes)) {
    const uniq = [...new Set(routes.map((r) => String(r).trim()).filter(Boolean))].sort();
    return uniq.length ? uniq.join(',') : '*';
  }
  const parts = String(routes).split(',').map((r) => r.trim()).filter(Boolean);
  if (!parts.length || parts.includes('*')) return '*';
  return [...new Set(parts)].sort().join(',');
}

/**
 * Normalize a session nonce to 32-byte hex.
 * @param {string|null|undefined} nonce
 */
export function normalizeSessionNonce(nonce) {
  if (!nonce || typeof nonce !== 'string') {
    return `0x${crypto.randomBytes(32).toString('hex')}`;
  }
  const hex = nonce.startsWith('0x') ? nonce.slice(2) : nonce;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length > 64) {
    throw new Error('session nonce must be a bytes32 hex string');
  }
  return `0x${hex.padStart(64, '0')}`;
}

/**
 * Build an AuthorizeSession typed-data payload for a payer to sign.
 *
 * @param {object} params
 * @param {string} params.agentPubkey
 * @param {number|string} params.validAfter
 * @param {number|string} params.validUntil
 * @param {number|string|bigint} params.maxCumulativeSpend
 * @param {string|string[]} [params.allowedRoutes]
 * @param {string} [params.nonce]
 * @param {string} [params.agentKeyType]
 * @param {{ verifyingContract?: string, issuerUri?: string, chainId?: number }} [params.domain]
 */
export function buildAuthorizeTypedData(params) {
  const agentPubkey = requireSecp256k1Address(params.agentPubkey, 'agentPubkey');
  const agentKeyType = params.agentKeyType || AGENT_KEY_TYPE_SECP256K1;
  if (agentKeyType !== AGENT_KEY_TYPE_SECP256K1) {
    throw new Error(`session v1 requires agentKeyType=${AGENT_KEY_TYPE_SECP256K1}`);
  }
  const validAfter = toUint(params.validAfter, 'validAfter');
  const validUntil = toUint(params.validUntil, 'validUntil');
  if (validUntil <= validAfter) {
    throw new Error('validUntil must be greater than validAfter');
  }
  const maxCumulativeSpend = toUint(params.maxCumulativeSpend, 'maxCumulativeSpend');
  const allowedRoutes = canonicalizeAllowedRoutes(params.allowedRoutes);
  const nonce = normalizeSessionNonce(params.nonce);
  const domain = sessionEip712Domain(params.domain || {});

  const message = {
    agentPubkey,
    agentKeyType,
    validAfter,
    validUntil,
    maxCumulativeSpend,
    allowedRoutes,
    nonce,
  };

  return {
    domain,
    types: AUTHORIZE_SESSION_TYPES,
    primaryType: AUTHORIZE_SESSION_PRIMARY,
    message,
  };
}

/**
 * Build a RevokeSession typed-data payload.
 *
 * @param {object} params
 * @param {string} params.agentPubkey
 * @param {string} params.nonce
 * @param {string} params.delegationHash
 * @param {{ verifyingContract?: string, issuerUri?: string, chainId?: number }} [params.domain]
 */
export function buildRevokeTypedData(params) {
  const agentPubkey = requireSecp256k1Address(params.agentPubkey, 'agentPubkey');
  const nonce = normalizeSessionNonce(params.nonce);
  const delegationHash = normalizeSessionNonce(params.delegationHash);
  const domain = sessionEip712Domain(params.domain || {});
  return {
    domain,
    types: REVOKE_SESSION_TYPES,
    primaryType: REVOKE_SESSION_PRIMARY,
    message: { agentPubkey, nonce, delegationHash },
  };
}

/** EIP-712 digest (bytes32) of AuthorizeSession — this is delegation_hash. */
export function delegationHashOf(typedData) {
  const td = typedData.domain ? typedData : null;
  if (!td) throw new Error('typedData required');
  return TypedDataEncoder.hash(td.domain, td.types, td.message);
}

export function requireSecp256k1Address(value, field = 'address') {
  if (!value || typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${field} must be a secp256k1 EVM address`);
  }
  return getAddress(value);
}

function toUint(value, field) {
  if (value == null || value === '') throw new Error(`${field} is required`);
  try {
    const n = BigInt(value);
    if (n < 0n) throw new Error('negative');
    // Decimal string — JSON-safe and accepted by ethers uint256.
    return n.toString();
  } catch {
    throw new Error(`${field} must be a non-negative integer (atomic USDC / unix seconds)`);
  }
}

/** Strip BigInt from a typed-data message so it can live in a JWS / HTTP body. */
export function jsonSafeTypedData(typedData) {
  if (!typedData || typeof typedData !== 'object') return typedData;
  return JSON.parse(JSON.stringify(typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Verify an AuthorizeSession EIP-712 signature and recover the payer.
 *
 * @param {object} typedData
 * @param {string} signature
 * @param {{ verifyingContract?: string|null }} [opts]
 * @returns {{
 *   valid: boolean,
 *   payer_wallet?: string,
 *   agent_pubkey?: string,
 *   agent_key_type?: string,
 *   delegation_hash?: string,
 *   valid_after?: number,
 *   valid_until?: number,
 *   max_cumulative_spend?: string,
 *   allowed_routes?: string,
 *   nonce?: string,
 *   reason?: string,
 * }}
 */
export function verifyAuthorizeSession(typedData, signature, { verifyingContract = null } = {}) {
  if (!typedData || !signature) {
    return { valid: false, reason: 'missing_typed_data_or_signature' };
  }
  try {
    const pinned = canonicalizeSessionDomain(typedData.domain, { verifyingContract });
    if (!pinned.ok) {
      return { valid: false, reason: pinned.reason };
    }
    const domain = pinned.domain;
    const msg = typedData.message || {};
    if ((msg.agentKeyType || AGENT_KEY_TYPE_SECP256K1) !== AGENT_KEY_TYPE_SECP256K1) {
      return { valid: false, reason: 'unsupported_agent_key_type' };
    }
    if (!isAddress(msg.agentPubkey)) {
      return { valid: false, reason: 'agent_pubkey_not_secp256k1' };
    }
    const recovered = verifyTypedData(
      domain,
      typedData.types || AUTHORIZE_SESSION_TYPES,
      msg,
      signature,
    );
    const hash = TypedDataEncoder.hash(
      domain,
      typedData.types || AUTHORIZE_SESSION_TYPES,
      msg,
    );
    return {
      valid: true,
      payer_wallet: getAddress(recovered),
      agent_pubkey: getAddress(msg.agentPubkey),
      agent_key_type: AGENT_KEY_TYPE_SECP256K1,
      delegation_hash: hash,
      valid_after: Number(msg.validAfter),
      valid_until: Number(msg.validUntil),
      max_cumulative_spend: String(msg.maxCumulativeSpend),
      allowed_routes: canonicalizeAllowedRoutes(msg.allowedRoutes),
      nonce: normalizeSessionNonce(msg.nonce),
      domain,
    };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Verify a RevokeSession EIP-712 signature.
 *
 * @param {object} typedData
 * @param {string} signature
 * @param {{ expectedPayer?: string|null, verifyingContract?: string|null }} [opts]
 */
export function verifyRevokeSession(typedData, signature, {
  expectedPayer = null,
  verifyingContract = null,
} = {}) {
  if (!typedData || !signature) {
    return { valid: false, reason: 'missing_typed_data_or_signature' };
  }
  try {
    const pinned = canonicalizeSessionDomain(typedData.domain, { verifyingContract });
    if (!pinned.ok) {
      return { valid: false, reason: pinned.reason };
    }
    const domain = pinned.domain;
    const msg = typedData.message || {};
    const recovered = getAddress(verifyTypedData(
      domain,
      typedData.types || REVOKE_SESSION_TYPES,
      msg,
      signature,
    ));
    if (expectedPayer) {
      if (!isAddress(expectedPayer) || getAddress(expectedPayer) !== recovered) {
        return { valid: false, reason: 'signer_mismatch', payer_wallet: recovered };
      }
    }
    return {
      valid: true,
      payer_wallet: recovered,
      agent_pubkey: isAddress(msg.agentPubkey) ? getAddress(msg.agentPubkey) : null,
      nonce: msg.nonce ? normalizeSessionNonce(msg.nonce) : null,
      delegation_hash: msg.delegationHash ? normalizeSessionNonce(msg.delegationHash) : null,
      domain,
    };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Receipt `iat` must fall inside the reusable session window.
 * No new payer signature is required — that is the reusable-session law.
 *
 * @param {{ iat?: number, session?: object, session_expiry?: number }} claims
 * @param {{ now?: number }} [opts]
 */
export function verifySessionWindow(claims, { now = null } = {}) {
  const session = claims?.session || null;
  if (!session && claims?.session_expiry == null && claims?.delegation_hash == null) {
    return { checked: false, valid: true, reason: 'no_session' };
  }
  const iat = Number(claims?.iat);
  if (!Number.isFinite(iat)) {
    return { checked: true, valid: false, reason: 'missing_iat' };
  }
  const validAfter = Number(session?.valid_after ?? session?.validAfter ?? 0);
  const validUntil = Number(
    session?.valid_until
    ?? session?.validUntil
    ?? session?.session_expiry
    ?? claims?.session_expiry,
  );
  if (!Number.isFinite(validUntil)) {
    return { checked: true, valid: false, reason: 'missing_session_expiry' };
  }
  if (iat < validAfter) {
    return { checked: true, valid: false, reason: 'iat_before_valid_after', iat, valid_after: validAfter };
  }
  if (iat > validUntil) {
    return { checked: true, valid: false, reason: 'iat_outside_session_window', iat, session_expiry: validUntil };
  }
  if (now != null) {
    const n = Number(now);
    if (Number.isFinite(n) && n > validUntil) {
      return { checked: true, valid: false, reason: 'session_expired', now: n, session_expiry: validUntil };
    }
  }
  return { checked: true, valid: true, iat, valid_after: validAfter, session_expiry: validUntil };
}

/**
 * Parse a session-delegation proof from a request (header or body).
 * Header: X-XFuel-Session-Delegation (JSON or base64url JSON).
 * Body: session_delegation | delegation.
 *
 * @param {object} req
 * @returns {object|null}
 */
/**
 * Bind a request's session-delegation proof onto a task. Missing proof is a
 * no-op (unbound receipt). A present but invalid proof is an error — do not
 * issue a receipt that pretends to be bound.
 *
 * @param {object} req
 * @param {{ expectedPayer?: string|null, issuerUri?: string, verifyingContract?: string, store?: SessionDelegationStore|null, now?: number }} [opts]
 * @returns {{ bound: boolean, session?: object, error?: { reason: string } }}
 */
export function bindSessionFromRequest(req, {
  expectedPayer = null,
  issuerUri = null,
  verifyingContract = null,
  store = null,
  now = null,
} = {}) {
  const proof = extractSessionDelegation(req);
  if (!proof) return { bound: false };
  const accepted = acceptDelegationProof(proof, {
    expectedPayer,
    issuerUri,
    verifyingContract,
    now,
  });
  if (!accepted.ok) {
    return { bound: false, error: { reason: accepted.reason, payer_wallet: accepted.payer_wallet } };
  }
  if (store?.isRevoked(accepted.session.delegation_hash)) {
    return { bound: false, error: { reason: 'session_revoked' } };
  }
  store?.put(accepted.session);
  return { bound: true, session: accepted.session };
}

export function extractSessionDelegation(req) {
  const header = req?.headers?.['x-xfuel-session-delegation']
    || req?.headers?.['x-session-delegation']
    || null;
  if (header && typeof header === 'string') {
    const parsed = parseDelegationBlob(header);
    if (parsed) return parsed;
  }
  const body = req?.body;
  if (body && typeof body === 'object') {
    if (body.session_delegation && typeof body.session_delegation === 'object') {
      return body.session_delegation;
    }
    if (body.delegation && typeof body.delegation === 'object' && body.delegation.signature) {
      return body.delegation;
    }
  }
  return null;
}

function parseDelegationBlob(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch { /* try base64url */ }
  try {
    const json = Buffer.from(trimmed, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Accept a client proof blob and return a verified session record ready to stamp.
 *
 * Proof shape:
 *   { signature, typed_data }  or  { signature, message, domain? }
 *
 * @param {object} proof
 * @param {{ expectedPayer?: string|null, issuerUri?: string, verifyingContract?: string, now?: number }} [opts]
 */
export function acceptDelegationProof(proof, {
  expectedPayer = null,
  issuerUri = null,
  verifyingContract = null,
  now = null,
} = {}) {
  if (!proof || typeof proof !== 'object') {
    return { ok: false, reason: 'missing_delegation_proof' };
  }
  const signature = proof.signature || proof.sig || null;
  let typedData = proof.typed_data || proof.typedData || null;
  if (!typedData && proof.message) {
    typedData = {
      domain: proof.domain || sessionEip712Domain({ issuerUri, verifyingContract }),
      types: proof.types || AUTHORIZE_SESSION_TYPES,
      primaryType: proof.primaryType || AUTHORIZE_SESSION_PRIMARY,
      message: proof.message,
    };
  }
  if (!typedData) {
    // Flattened proof: fields at top level
    try {
      typedData = buildAuthorizeTypedData({
        agentPubkey: proof.agent_pubkey || proof.agentPubkey,
        validAfter: proof.valid_after ?? proof.validAfter,
        validUntil: proof.valid_until ?? proof.validUntil,
        maxCumulativeSpend: proof.max_cumulative_spend ?? proof.maxCumulativeSpend,
        allowedRoutes: proof.allowed_routes ?? proof.allowedRoutes,
        nonce: proof.nonce,
        agentKeyType: proof.agent_key_type || proof.agentKeyType,
        domain: { issuerUri, verifyingContract, ...(proof.domain || {}) },
      });
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // Force Base domain if the client omitted chainId; reject a wrong chain.
  if (typedData.domain && typedData.domain.chainId == null) {
    typedData = { ...typedData, domain: { ...typedData.domain, chainId: SESSION_CHAIN_ID } };
  }

  const verified = verifyAuthorizeSession(typedData, signature, { verifyingContract });
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }
  if (expectedPayer && isAddress(expectedPayer)) {
    if (getAddress(expectedPayer) !== verified.payer_wallet) {
      return { ok: false, reason: 'payer_mismatch', payer_wallet: verified.payer_wallet };
    }
  }
  const clock = now != null ? Number(now) : Math.floor(Date.now() / 1000);
  if (clock < verified.valid_after) {
    return { ok: false, reason: 'session_not_yet_valid' };
  }
  if (clock > verified.valid_until) {
    return { ok: false, reason: 'session_expired' };
  }

  const lookupUri = issuerUri
    ? `${String(issuerUri).replace(/\/$/, '')}/v1/sessions/${verified.delegation_hash}`
    : `/v1/sessions/${verified.delegation_hash}`;

  // Publish the pinned domain used to hash delegation_hash — not the
  // client-submitted (possibly omitted-fields) domain.
  const pinnedTyped = jsonSafeTypedData({
    ...typedData,
    domain: verified.domain || canonicalizeSessionDomain(typedData.domain, { verifyingContract }).domain,
    message: typedData.message,
  });

  return {
    ok: true,
    session: {
      agent_pubkey: verified.agent_pubkey,
      agent_key_type: AGENT_KEY_TYPE_SECP256K1,
      delegation_hash: verified.delegation_hash,
      session_expiry: verified.valid_until,
      valid_after: verified.valid_after,
      valid_until: verified.valid_until,
      max_cumulative_spend: verified.max_cumulative_spend,
      decimals: USDC_ATOMIC_DECIMALS,
      unit: USDC_ATOMIC_UNIT,
      allowed_routes: verified.allowed_routes,
      nonce: verified.nonce,
      payer_wallet: verified.payer_wallet,
      proof: {
        type: 'eip712',
        primary_type: AUTHORIZE_SESSION_PRIMARY,
        primaryType: AUTHORIZE_SESSION_PRIMARY,
        types: jsonSafeTypedData(typedData)?.types || typedData.types || AUTHORIZE_SESSION_TYPES,
        signature,
        domain: pinnedTyped.domain,
        message: pinnedTyped.message,
        lookup_uri: lookupUri,
      },
    },
    typed_data: pinnedTyped,
  };
}

/**
 * Stampable session claims for the receipt JWS. Null when unbound.
 * @param {object} task
 * @param {object} [opts]
 */
export function sessionOf(task, opts = {}) {
  const raw = opts.session
    || task?.meta?.session
    || task?.meta?.sessionDelegation
    || task?.session
    || null;
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.agent_pubkey && !raw.delegation_hash) return null;
  return {
    agent_pubkey: raw.agent_pubkey || raw.agentPubkey || null,
    agent_key_type: raw.agent_key_type || raw.agentKeyType || AGENT_KEY_TYPE_SECP256K1,
    delegation_hash: raw.delegation_hash || raw.delegationHash || null,
    session_expiry: raw.session_expiry ?? raw.sessionExpiry ?? raw.valid_until ?? raw.validUntil ?? null,
    valid_after: raw.valid_after ?? raw.validAfter ?? null,
    valid_until: raw.valid_until ?? raw.validUntil ?? raw.session_expiry ?? null,
    max_cumulative_spend: raw.max_cumulative_spend != null
      ? String(raw.max_cumulative_spend)
      : (raw.maxCumulativeSpend != null ? String(raw.maxCumulativeSpend) : null),
    decimals: raw.decimals ?? USDC_ATOMIC_DECIMALS,
    unit: raw.unit || USDC_ATOMIC_UNIT,
    allowed_routes: raw.allowed_routes ?? raw.allowedRoutes ?? null,
    nonce: raw.nonce || null,
    proof: raw.proof || null,
  };
}

/**
 * Full session block for signed JWS claims (includes EIP-712 proof + types).
 * @param {object} session
 */
export function publicSessionBlock(session) {
  if (!session) return null;
  const proof = session.proof || null;
  return jsonSafeTypedData({
    agent_pubkey: session.agent_pubkey,
    agent_key_type: session.agent_key_type || AGENT_KEY_TYPE_SECP256K1,
    delegation_hash: session.delegation_hash,
    session_expiry: session.session_expiry != null ? Number(session.session_expiry) : null,
    valid_after: session.valid_after != null ? Number(session.valid_after) : null,
    valid_until: session.valid_until != null ? Number(session.valid_until) : null,
    max_cumulative_spend: session.max_cumulative_spend != null ? String(session.max_cumulative_spend) : null,
    decimals: session.decimals ?? USDC_ATOMIC_DECIMALS,
    unit: session.unit || USDC_ATOMIC_UNIT,
    allowed_routes: session.allowed_routes,
    nonce: session.nonce,
    proof: proof ? {
      ...proof,
      types: proof.types || AUTHORIZE_SESSION_TYPES,
      primaryType: proof.primaryType || proof.primary_type || AUTHORIZE_SESSION_PRIMARY,
    } : null,
  });
}

/**
 * Minimal session pointers on the unauthenticated outer receipt envelope.
 * Full session + proof live only in issuer_signature.jws.
 *
 * @param {object} session
 * @param {string} [baseUrl]
 */
export function outerSessionPointer(session, baseUrl = '') {
  if (!session?.delegation_hash) return null;
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const statusUri = session.proof?.lookup_uri
    || (base
      ? `${base}/v1/sessions/${session.delegation_hash}`
      : `/v1/sessions/${session.delegation_hash}`);
  return {
    delegation_hash: session.delegation_hash,
    status_uri: statusUri,
  };
}

/**
 * In-memory (+ optional disk) registry of sessions and revocations.
 */
export class SessionDelegationStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} delegation_hash → session */
    this.sessions = new Map();
    /** @type {Map<string, object>} delegation_hash → revocation */
    this.revocations = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'session-delegation: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'session-delegations.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const s of data.sessions || []) {
        if (s.delegation_hash) this.sessions.set(s.delegation_hash.toLowerCase(), s);
      }
      for (const r of data.revocations || []) {
        if (r.delegation_hash) this.revocations.set(r.delegation_hash.toLowerCase(), r);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'session-delegation: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({
        sessions: [...this.sessions.values()],
        revocations: [...this.revocations.values()],
      }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'session-delegation: save failed');
    }
  }

  put(session) {
    if (!session?.delegation_hash) return session;
    const key = String(session.delegation_hash).toLowerCase();
    const row = {
      ...session,
      recorded_at: session.recorded_at || Math.floor(Date.now() / 1000),
    };
    this.sessions.set(key, row);
    this._save();
    return row;
  }

  get(delegationHash) {
    if (!delegationHash) return null;
    return this.sessions.get(String(delegationHash).toLowerCase()) || null;
  }

  isRevoked(delegationHash) {
    if (!delegationHash) return false;
    return this.revocations.has(String(delegationHash).toLowerCase());
  }

  getRevocation(delegationHash) {
    if (!delegationHash) return null;
    return this.revocations.get(String(delegationHash).toLowerCase()) || null;
  }

  /**
   * Publish a payer-signed revoke. Does not amend any receipt.
   * @param {object} revocation
   */
  revoke(revocation) {
    const hash = revocation?.delegation_hash;
    if (!hash) throw new Error('delegation_hash required');
    const key = String(hash).toLowerCase();
    const row = {
      delegation_hash: hash,
      agent_pubkey: revocation.agent_pubkey || null,
      payer_wallet: revocation.payer_wallet || null,
      nonce: revocation.nonce || null,
      revoked_at: revocation.revoked_at || Math.floor(Date.now() / 1000),
      proof: revocation.proof || null,
    };
    this.revocations.set(key, row);
    this._save();
    return row;
  }

  listRevocations() {
    return [...this.revocations.values()].sort((a, b) => (b.revoked_at || 0) - (a.revoked_at || 0));
  }

  status(delegationHash) {
    const session = this.get(delegationHash);
    const revocation = this.getRevocation(delegationHash);
    if (!session && !revocation) {
      return { found: false, status: 'unknown', delegation_hash: delegationHash || null };
    }
    const now = Math.floor(Date.now() / 1000);
    let status = 'active';
    if (revocation) status = 'revoked';
    else if (session?.valid_until != null && now > Number(session.valid_until)) status = 'expired';
    else if (session?.valid_after != null && now < Number(session.valid_after)) status = 'pending';
    return {
      found: true,
      status,
      delegation_hash: session?.delegation_hash || revocation?.delegation_hash || delegationHash,
      agent_pubkey: session?.agent_pubkey || revocation?.agent_pubkey || null,
      agent_key_type: session?.agent_key_type || AGENT_KEY_TYPE_SECP256K1,
      payer_wallet: session?.payer_wallet || revocation?.payer_wallet || null,
      valid_after: session?.valid_after ?? null,
      valid_until: session?.valid_until ?? session?.session_expiry ?? null,
      session_expiry: session?.session_expiry ?? session?.valid_until ?? null,
      max_cumulative_spend: session?.max_cumulative_spend ?? null,
      decimals: USDC_ATOMIC_DECIMALS,
      unit: USDC_ATOMIC_UNIT,
      allowed_routes: session?.allowed_routes ?? null,
      revoked: !!revocation,
      revoked_at: revocation?.revoked_at ?? null,
    };
  }
}

let _store = null;

export function getSessionStore(opts = {}) {
  if (!_store) {
    const dir = opts.dir
      || process.env.SESSION_DELEGATION_DIR
      || null;
    const persist = opts.persist ?? !!dir;
    _store = new SessionDelegationStore({ dir, persist });
  }
  return _store;
}

/** Test helper — drop the singleton. */
export function _resetSessionStore() {
  _store = null;
}

export default {
  SESSION_CHAIN_ID,
  SESSION_VERIFYING_CONTRACT_DEFAULT,
  SESSION_EIP712_NAME,
  SESSION_EIP712_VERSION,
  AGENT_KEY_TYPE_SECP256K1,
  AUTHORIZE_SESSION_TYPES,
  REVOKE_SESSION_TYPES,
  canonicalizeSessionDomain,
  sessionMatchesSettledPayer,
  resolveRevokeExpectedPayer,
  buildAuthorizeTypedData,
  buildRevokeTypedData,
  delegationHashOf,
  verifyAuthorizeSession,
  verifyRevokeSession,
  verifySessionWindow,
  extractSessionDelegation,
  bindSessionFromRequest,
  acceptDelegationProof,
  sessionOf,
  publicSessionBlock,
  outerSessionPointer,
  SessionDelegationStore,
  getSessionStore,
};
