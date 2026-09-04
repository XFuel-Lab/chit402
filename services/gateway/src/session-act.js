/**
 * Prove-key execution v1 — SessionAct is the *act* side of session-delegation.
 *
 * AuthorizeSession binds agent_pubkey at settle. Privileged acts require a
 * fresh challenge and an EIP-712 SessionAct recovered to that agent_pubkey
 * (secp256k1, Base). No capability-token shortcut in v1.
 *
 * Actions: handoff | read_private | redeem (redeem may 501 after verify).
 */

import crypto from 'crypto';
import { verifyTypedData, getAddress, isAddress } from 'ethers';
import {
  AGENT_KEY_TYPE_SECP256K1,
  SESSION_CHAIN_ID,
  SESSION_VERIFYING_CONTRACT_DEFAULT,
  canonicalizeSessionDomain,
  jsonSafeTypedData,
  normalizeSessionNonce,
  sessionEip712Domain,
} from './session-delegation.js';

export const SESSION_ACT_PRIMARY = 'SessionAct';

export const SESSION_ACT_ACTIONS = Object.freeze({
  HANDOFF: 'handoff',
  READ_PRIVATE: 'read_private',
  REDEEM: 'redeem',
});

export const SESSION_ACT_ACTION_LIST = Object.freeze([
  SESSION_ACT_ACTIONS.HANDOFF,
  SESSION_ACT_ACTIONS.READ_PRIVATE,
  SESSION_ACT_ACTIONS.REDEEM,
]);

export const SESSION_ACT_TYPES = {
  SessionAct: [
    { name: 'delegationHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'action', type: 'string' },
    { name: 'resource', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/** Challenge TTL: lock is ~2–5 min. Default 3 min. */
export const CHALLENGE_TTL_SEC_DEFAULT = 180;
export const CHALLENGE_TTL_SEC_MIN = 120;
export const CHALLENGE_TTL_SEC_MAX = 300;

export function clampChallengeTtlSec(value) {
  if (value == null || value === '') return CHALLENGE_TTL_SEC_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return CHALLENGE_TTL_SEC_DEFAULT;
  return Math.min(CHALLENGE_TTL_SEC_MAX, Math.max(CHALLENGE_TTL_SEC_MIN, Math.floor(n)));
}

function toUint(value, field) {
  if (value == null || value === '') throw new Error(`${field} is required`);
  try {
    const n = BigInt(value);
    if (n < 0n) throw new Error('negative');
    return n.toString();
  } catch {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function nowSec(now = null) {
  if (now != null) {
    const n = Number(now);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return Math.floor(Date.now() / 1000);
}

function addressesEqual(a, b) {
  if (!a || !b) return false;
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
}

function hashesEqual(a, b) {
  if (!a || !b) return false;
  try {
    return normalizeSessionNonce(a).toLowerCase() === normalizeSessionNonce(b).toLowerCase();
  } catch {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }
}

/**
 * Session JWS / store record must already bind agent_pubkey + delegation_hash.
 * Missing either is not a bound session — prove-key will not invent one.
 */
export function sessionBindsAgent(session, expectedDelegationHash = null) {
  if (!session || typeof session !== 'object') {
    return { ok: false, reason: 'session_not_bound' };
  }
  if (!session.agent_pubkey || !isAddress(session.agent_pubkey)) {
    return { ok: false, reason: 'session_not_bound' };
  }
  if (!session.delegation_hash) {
    return { ok: false, reason: 'session_not_bound' };
  }
  if (expectedDelegationHash && !hashesEqual(session.delegation_hash, expectedDelegationHash)) {
    return { ok: false, reason: 'delegation_hash_mismatch' };
  }
  return {
    ok: true,
    agent_pubkey: getAddress(session.agent_pubkey),
    delegation_hash: normalizeSessionNonce(session.delegation_hash),
    agent_key_type: session.agent_key_type || AGENT_KEY_TYPE_SECP256K1,
  };
}

/**
 * Active = found, not revoked, inside valid_after..valid_until.
 */
export function sessionIsActive(session, { now = null, revoked = false } = {}) {
  if (revoked) return { ok: false, reason: 'session_revoked' };
  const bound = sessionBindsAgent(session);
  if (!bound.ok) return bound;
  const clock = nowSec(now);
  const validAfter = Number(session.valid_after ?? 0);
  const validUntil = Number(session.valid_until ?? session.session_expiry);
  if (Number.isFinite(validAfter) && clock < validAfter) {
    return { ok: false, reason: 'session_not_yet_valid' };
  }
  if (!Number.isFinite(validUntil)) {
    return { ok: false, reason: 'session_expired' };
  }
  if (clock > validUntil) {
    return { ok: false, reason: 'session_expired' };
  }
  return { ok: true, agent_pubkey: bound.agent_pubkey, delegation_hash: bound.delegation_hash };
}

export function normalizeSessionActAction(action) {
  return String(action || '').trim().toLowerCase();
}

export function isKnownSessionAct(action) {
  return SESSION_ACT_ACTION_LIST.includes(normalizeSessionActAction(action));
}

/**
 * Build a SessionAct typed-data payload for the agent to sign.
 *
 * @param {object} params
 * @param {string} params.delegationHash
 * @param {string} params.nonce
 * @param {string} params.action
 * @param {string} params.resource
 * @param {number|string} params.deadline
 * @param {{ verifyingContract?: string, issuerUri?: string, chainId?: number }} [params.domain]
 */
export function buildSessionActTypedData(params) {
  const delegationHash = normalizeSessionNonce(params.delegationHash);
  const nonce = normalizeSessionNonce(params.nonce);
  const action = normalizeSessionActAction(params.action);
  if (!action) throw new Error('action is required');
  const resource = String(params.resource ?? '').trim();
  if (!resource) throw new Error('resource is required');
  const deadline = toUint(params.deadline, 'deadline');
  const domain = sessionEip712Domain(params.domain || {});
  return {
    domain,
    types: SESSION_ACT_TYPES,
    primaryType: SESSION_ACT_PRIMARY,
    message: {
      delegationHash,
      nonce,
      action,
      resource,
      deadline,
    },
  };
}

/**
 * Verify a SessionAct EIP-712 signature and recover the agent (secp256k1).
 *
 * @param {object} typedData
 * @param {string} signature
 * @param {{
 *   expectedAgent?: string|null,
 *   expectedDelegationHash?: string|null,
 *   expectedNonce?: string|null,
 *   expectedAction?: string|null,
 *   expectedResource?: string|null,
 *   verifyingContract?: string|null,
 *   now?: number|null,
 * }} [opts]
 */
export function verifySessionAct(typedData, signature, {
  expectedAgent = null,
  expectedDelegationHash = null,
  expectedNonce = null,
  expectedAction = null,
  expectedResource = null,
  verifyingContract = null,
  now = null,
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
    const types = typedData.types || SESSION_ACT_TYPES;
    if (!types.SessionAct) {
      return { valid: false, reason: 'missing_session_act_types' };
    }
    const recovered = getAddress(verifyTypedData(domain, types, msg, signature));
    if (expectedAgent) {
      if (!isAddress(expectedAgent) || getAddress(expectedAgent) !== recovered) {
        return { valid: false, reason: 'signer_mismatch', agent_pubkey: recovered };
      }
    }
    const delegationHash = msg.delegationHash ? normalizeSessionNonce(msg.delegationHash) : null;
    const nonce = msg.nonce ? normalizeSessionNonce(msg.nonce) : null;
    const action = normalizeSessionActAction(msg.action);
    const resource = String(msg.resource ?? '').trim();
    const deadline = Number(msg.deadline);
    if (expectedDelegationHash && (!delegationHash || !hashesEqual(delegationHash, expectedDelegationHash))) {
      return { valid: false, reason: 'delegation_hash_mismatch', agent_pubkey: recovered };
    }
    if (expectedNonce && (!nonce || !hashesEqual(nonce, expectedNonce))) {
      return { valid: false, reason: 'nonce_mismatch', agent_pubkey: recovered };
    }
    if (expectedAction != null && action !== normalizeSessionActAction(expectedAction)) {
      return { valid: false, reason: 'action_mismatch', agent_pubkey: recovered };
    }
    if (expectedResource != null && resource !== String(expectedResource).trim()) {
      return { valid: false, reason: 'resource_mismatch', agent_pubkey: recovered };
    }
    const clock = nowSec(now);
    if (!Number.isFinite(deadline)) {
      return { valid: false, reason: 'missing_deadline', agent_pubkey: recovered };
    }
    if (clock > deadline) {
      return { valid: false, reason: 'deadline_expired', agent_pubkey: recovered };
    }
    return {
      valid: true,
      agent_pubkey: recovered,
      agent_key_type: AGENT_KEY_TYPE_SECP256K1,
      delegation_hash: delegationHash,
      nonce,
      action,
      resource,
      deadline,
      domain,
      types: jsonSafeTypedData(types),
      message: jsonSafeTypedData(msg),
    };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Published SessionAct proof block (full types map — required for verify).
 */
export function publicSessionActProof({ typedData, signature, verified = null } = {}) {
  const td = jsonSafeTypedData(typedData) || {};
  const domain = verified?.domain || td.domain || sessionEip712Domain();
  const types = verified?.types || td.types || SESSION_ACT_TYPES;
  const message = verified?.message || td.message || null;
  return jsonSafeTypedData({
    type: 'eip712',
    primary_type: SESSION_ACT_PRIMARY,
    primaryType: SESSION_ACT_PRIMARY,
    agent_key_type: AGENT_KEY_TYPE_SECP256K1,
    chain_id: SESSION_CHAIN_ID,
    types,
    domain,
    message,
    signature: signature || null,
  });
}

export class SessionActChallengeStore {
  /**
   * @param {{ ttlSec?: number }} [opts]
   */
  constructor({ ttlSec = CHALLENGE_TTL_SEC_DEFAULT } = {}) {
    this.ttlSec = clampChallengeTtlSec(ttlSec);
    /** @type {Map<string, object>} challenge_id → row */
    this.challenges = new Map();
    /** @type {Set<string>} spent challenge ids + nonces */
    this.spent = new Set();
  }

  _gc(now = null) {
    const clock = nowSec(now);
    for (const [id, row] of this.challenges) {
      if (clock > Number(row.expires_at)) this.challenges.delete(id);
    }
  }

  /**
   * Issue a one-shot challenge for an active session.
   * @param {string} delegationHash
   * @param {{ resources?: string[]|object[], ttlSec?: number, now?: number, resource?: string }} [opts]
   */
  issue(delegationHash, {
    resources = null,
    ttlSec = null,
    now = null,
    resource = null,
  } = {}) {
    this._gc(now);
    const hash = normalizeSessionNonce(delegationHash);
    const clock = nowSec(now);
    const ttl = ttlSec != null ? clampChallengeTtlSec(ttlSec) : this.ttlSec;
    const nonce = normalizeSessionNonce(null);
    const challengeId = normalizeSessionNonce(`0x${crypto.randomBytes(32).toString('hex')}`);
    const expiresAt = clock + ttl;
    const list = Array.isArray(resources) && resources.length
      ? resources
      : [...SESSION_ACT_ACTION_LIST];
    const row = {
      challenge_id: challengeId,
      nonce,
      delegation_hash: hash,
      expires_at: expiresAt,
      resources: list,
      resource: resource || null,
      created_at: clock,
    };
    this.challenges.set(challengeId.toLowerCase(), row);
    return { ...row };
  }

  peek(challengeId) {
    if (!challengeId) return null;
    return this.challenges.get(String(challengeId).toLowerCase()) || null;
  }

  isSpent(challengeId, nonce = null) {
    if (challengeId && this.spent.has(String(challengeId).toLowerCase())) return true;
    if (nonce) {
      try {
        if (this.spent.has(normalizeSessionNonce(nonce).toLowerCase())) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  /**
   * Look up a live (unspent, unexpired) challenge.
   */
  getLive(challengeId, { now = null, expectedDelegationHash = null } = {}) {
    if (this.isSpent(challengeId)) {
      return { ok: false, reason: 'nonce_reused' };
    }
    const row = this.peek(challengeId);
    if (!row) return { ok: false, reason: 'challenge_not_found' };
    if (this.isSpent(row.challenge_id, row.nonce)) {
      return { ok: false, reason: 'nonce_reused' };
    }
    if (nowSec(now) > Number(row.expires_at)) {
      this.challenges.delete(String(row.challenge_id).toLowerCase());
      return { ok: false, reason: 'challenge_expired' };
    }
    if (expectedDelegationHash && !hashesEqual(row.delegation_hash, expectedDelegationHash)) {
      return { ok: false, reason: 'delegation_hash_mismatch' };
    }
    return { ok: true, challenge: row };
  }

  /**
   * Consume a challenge after a successful SessionAct verify. One-shot.
   */
  consume(challengeId, { now = null } = {}) {
    const live = this.getLive(challengeId, { now });
    if (!live.ok) return live;
    const row = live.challenge;
    this.spent.add(String(row.challenge_id).toLowerCase());
    this.spent.add(String(row.nonce).toLowerCase());
    this.challenges.delete(String(row.challenge_id).toLowerCase());
    return { ok: true, challenge: row };
  }

  /** Test helper — force a challenge past expiry without waiting. */
  expire(challengeId, { now = null } = {}) {
    const row = this.peek(challengeId);
    if (!row) return null;
    row.expires_at = nowSec(now) - 1;
    return row;
  }
}

let _challengeStore = null;

export function getSessionActStore(opts = {}) {
  if (!_challengeStore) {
    const ttl = opts.ttlSec
      ?? (process.env.SESSION_ACT_CHALLENGE_TTL_SEC
        ? Number(process.env.SESSION_ACT_CHALLENGE_TTL_SEC)
        : CHALLENGE_TTL_SEC_DEFAULT);
    _challengeStore = new SessionActChallengeStore({ ttlSec: ttl });
  }
  return _challengeStore;
}

/** Test helper — drop the singleton. */
export function _resetSessionActStore() {
  _challengeStore = null;
}

/**
 * Reconstruct typed data from a live challenge + act body.
 */
export function typedDataFromActRequest(proof, challenge, { verifyingContract = null, issuerUri = null } = {}) {
  const signature = proof?.signature || proof?.sig || null;
  let typedData = proof?.typed_data || proof?.typedData || null;
  if (!typedData && proof?.message) {
    typedData = {
      domain: proof.domain || sessionEip712Domain({ verifyingContract, issuerUri }),
      types: proof.types || SESSION_ACT_TYPES,
      primaryType: proof.primaryType || proof.primary_type || SESSION_ACT_PRIMARY,
      message: proof.message,
    };
  }
  if (!typedData && challenge) {
    try {
      typedData = buildSessionActTypedData({
        delegationHash: proof?.delegation_hash || proof?.delegationHash || challenge.delegation_hash,
        nonce: proof?.nonce || challenge.nonce,
        action: proof?.action,
        resource: proof?.resource || challenge.resource,
        deadline: proof?.deadline ?? challenge.expires_at,
        domain: { verifyingContract, issuerUri, ...(proof?.domain || {}) },
      });
    } catch (err) {
      return { ok: false, reason: err.message, signature };
    }
  }
  if (!typedData) {
    return { ok: false, reason: 'missing_typed_data_or_signature', signature };
  }
  return { ok: true, typedData, signature };
}

/**
 * Full prove-key gate: bound session + active + SessionAct + one-shot nonce.
 * Consumes the challenge only after crypto succeeds.
 *
 * @param {object} opts
 * @param {object|null} opts.session
 * @param {boolean} [opts.revoked]
 * @param {object|null} opts.challenge  live challenge row (from getLive)
 * @param {object} opts.proof  { action, resource, signature, typed_data? }
 * @param {string} opts.delegationHash
 * @param {string|null} [opts.verifyingContract]
 * @param {string|null} [opts.issuerUri]
 * @param {number|null} [opts.now]
 * @param {SessionActChallengeStore|null} [opts.store]  consumed on success
 */
export function acceptSessionAct({
  session = null,
  revoked = false,
  challenge = null,
  proof = null,
  delegationHash = null,
  verifyingContract = null,
  issuerUri = null,
  now = null,
  store = null,
} = {}) {
  const bound = sessionBindsAgent(session, delegationHash);
  if (!bound.ok) return { ok: false, reason: bound.reason };
  const active = sessionIsActive(session, { now, revoked });
  if (!active.ok) return { ok: false, reason: active.reason };

  if (!challenge) {
    return { ok: false, reason: 'challenge_not_found' };
  }
  if (store?.isSpent(challenge.challenge_id, challenge.nonce)) {
    return { ok: false, reason: 'nonce_reused' };
  }
  if (nowSec(now) > Number(challenge.expires_at)) {
    return { ok: false, reason: 'challenge_expired' };
  }
  if (!hashesEqual(challenge.delegation_hash, bound.delegation_hash)) {
    return { ok: false, reason: 'delegation_hash_mismatch' };
  }

  const action = normalizeSessionActAction(proof?.action);
  const resource = String(proof?.resource ?? challenge.resource ?? '').trim();
  if (!action) return { ok: false, reason: 'action_required' };
  if (!resource) return { ok: false, reason: 'resource_required' };

  const rebuilt = typedDataFromActRequest(
    { ...proof, action, resource },
    challenge,
    { verifyingContract, issuerUri },
  );
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };

  const verified = verifySessionAct(rebuilt.typedData, rebuilt.signature, {
    expectedAgent: bound.agent_pubkey,
    expectedDelegationHash: bound.delegation_hash,
    expectedNonce: challenge.nonce,
    expectedAction: action,
    expectedResource: resource,
    verifyingContract,
    now,
  });
  if (!verified.valid) {
    return { ok: false, reason: verified.reason, agent_pubkey: verified.agent_pubkey };
  }

  // Deadline cannot outlive the challenge that issued the nonce.
  if (Number(verified.deadline) > Number(challenge.expires_at)) {
    return { ok: false, reason: 'deadline_after_challenge' };
  }

  if (store) {
    const consumed = store.consume(challenge.challenge_id, { now });
    if (!consumed.ok) return { ok: false, reason: consumed.reason };
  }

  return {
    ok: true,
    session,
    agent_pubkey: bound.agent_pubkey,
    agent_key_type: AGENT_KEY_TYPE_SECP256K1,
    delegation_hash: bound.delegation_hash,
    action: verified.action,
    resource: verified.resource,
    nonce: verified.nonce,
    challenge_id: challenge.challenge_id,
    typed_data: jsonSafeTypedData({
      ...rebuilt.typedData,
      domain: verified.domain,
      types: verified.types || SESSION_ACT_TYPES,
    }),
    signature: rebuilt.signature,
    proof: publicSessionActProof({
      typedData: rebuilt.typedData,
      signature: rebuilt.signature,
      verified,
    }),
  };
}

/**
 * Receipt JWS claims bind this session's agent_pubkey + delegation_hash.
 * Used by read_private so we do not leak another session's slimmed fields.
 */
export function receiptBindsSession(claims, session) {
  if (!claims || !session) return false;
  const agent = claims.agent_pubkey || claims.session?.agent_pubkey || claims.caller_binding?.agent_pubkey;
  const hash = claims.delegation_hash || claims.session?.delegation_hash;
  if (!agent || !hash) return false;
  return addressesEqual(agent, session.agent_pubkey) && hashesEqual(hash, session.delegation_hash);
}

export { SESSION_CHAIN_ID, SESSION_VERIFYING_CONTRACT_DEFAULT };

export default {
  SESSION_ACT_PRIMARY,
  SESSION_ACT_TYPES,
  SESSION_ACT_ACTIONS,
  SESSION_ACT_ACTION_LIST,
  CHALLENGE_TTL_SEC_DEFAULT,
  buildSessionActTypedData,
  verifySessionAct,
  acceptSessionAct,
  sessionBindsAgent,
  sessionIsActive,
  publicSessionActProof,
  receiptBindsSession,
  SessionActChallengeStore,
  getSessionActStore,
};
