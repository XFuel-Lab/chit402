/**
 * Prove-key execution v1 — SessionAct is the *act* side of session-delegation.
 *
 * AuthorizeSession binds agent_pubkey at settle. Privileged acts require an
 * EIP-712 SessionAct recovered to that agent_pubkey (secp256k1, Base).
 *
 * Transport (schema unchanged):
 *   - challenge → act: server issues nonce + deadline (TTL 2–5 min)
 *   - 1-shot: client supplies nonce + deadline on POST /act (same types)
 * Replay: unused nonce, deadline in window, session active. No capability token.
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

/** Sentinel address — "self" / unset target. Resolved to the bound agent on accept. */
export const SESSION_ACT_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SESSION_ACT_ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const SESSION_ACT_TYPES = {
  SessionAct: [
    { name: 'delegationHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'action', type: 'string' },
    { name: 'resource', type: 'string' },
    { name: 'deadline', type: 'uint256' },
    { name: 'targetAgent', type: 'address' },
    { name: 'payloadHash', type: 'bytes32' },
  ],
};

/** Challenge / 1-shot deadline TTL: lock is ~2–5 min. Default 3 min. */
export const CHALLENGE_TTL_SEC_DEFAULT = 180;
export const CHALLENGE_TTL_SEC_MIN = 120;
export const CHALLENGE_TTL_SEC_MAX = 300;
/** 1-shot client deadline may not sit more than this many seconds ahead of now. */
export const ONESHOT_DEADLINE_MAX_SEC = CHALLENGE_TTL_SEC_MAX;

export function clampChallengeTtlSec(value) {
  if (value == null || value === '') return CHALLENGE_TTL_SEC_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return CHALLENGE_TTL_SEC_DEFAULT;
  return Math.min(CHALLENGE_TTL_SEC_MAX, Math.max(CHALLENGE_TTL_SEC_MIN, Math.floor(n)));
}

/**
 * 1-shot deadline window: not expired, not more than CHALLENGE_TTL_SEC_MAX ahead.
 * Challenge path keeps its own expires_at bound (deadline_after_challenge).
 */
export function checkOneshotDeadlineWindow(deadline, now = null) {
  const clock = nowSec(now);
  const dl = Number(deadline);
  if (!Number.isFinite(dl)) return { ok: false, reason: 'missing_deadline' };
  if (clock > dl) return { ok: false, reason: 'deadline_expired' };
  if (dl > clock + ONESHOT_DEADLINE_MAX_SEC) return { ok: false, reason: 'deadline_too_far' };
  return { ok: true };
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

export function isZeroAddress(value) {
  if (!value) return true;
  try {
    return getAddress(value) === SESSION_ACT_ZERO_ADDRESS;
  } catch {
    return String(value).toLowerCase() === SESSION_ACT_ZERO_ADDRESS;
  }
}

/**
 * Normalize a SessionAct target. Empty / zero means "self" when `fallback` is set.
 */
export function resolveSessionActTarget(value, fallback = null) {
  if (value && isAddress(value) && !isZeroAddress(value)) {
    return getAddress(value);
  }
  if (fallback && isAddress(fallback) && !isZeroAddress(fallback)) {
    return getAddress(fallback);
  }
  return SESSION_ACT_ZERO_ADDRESS;
}

export function normalizePayloadHash(value) {
  if (!value) return SESSION_ACT_ZERO_BYTES32;
  return normalizeSessionNonce(value);
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
 * @param {string} [params.targetAgent]  recipient of a handoff; zero/omit = self
 * @param {string} [params.payloadHash]  keccak256 of extra payload; zero if unused
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
  const targetAgent = resolveSessionActTarget(params.targetAgent ?? params.target_agent);
  const payloadHash = normalizePayloadHash(params.payloadHash ?? params.payload_hash);
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
      targetAgent,
      payloadHash,
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
    const actFields = (types.SessionAct || []).map((f) => f.name);
    if (!actFields.includes('targetAgent') || !actFields.includes('payloadHash')) {
      return { valid: false, reason: 'missing_session_act_types', agent_pubkey: recovered };
    }
    const delegationHash = msg.delegationHash ? normalizeSessionNonce(msg.delegationHash) : null;
    const nonce = msg.nonce ? normalizeSessionNonce(msg.nonce) : null;
    const action = normalizeSessionActAction(msg.action);
    const resource = String(msg.resource ?? '').trim();
    const deadline = Number(msg.deadline);
    const targetAgent = resolveSessionActTarget(msg.targetAgent);
    const payloadHash = normalizePayloadHash(msg.payloadHash);
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
      target_agent: targetAgent,
      payload_hash: payloadHash,
      domain,
      types: jsonSafeTypedData(types),
      message: jsonSafeTypedData({
        ...msg,
        targetAgent,
        payloadHash,
      }),
    };
  } catch (err) {
    return { valid: false, reason: `verification_error: ${err.message}` };
  }
}

/**
 * Published SessionAct proof block (full types map — required for verify).
 */
export function publicSessionActProof({
  typedData,
  signature,
  verified = null,
  challengeId = null,
} = {}) {
  const td = jsonSafeTypedData(typedData) || {};
  const domain = verified?.domain || td.domain || sessionEip712Domain();
  const types = verified?.types || td.types || SESSION_ACT_TYPES;
  const message = verified?.message || td.message || null;
  const nonce = verified?.nonce || message?.nonce || td.nonce || null;
  return jsonSafeTypedData({
    type: 'eip712',
    primary_type: SESSION_ACT_PRIMARY,
    primaryType: SESSION_ACT_PRIMARY,
    agent_key_type: AGENT_KEY_TYPE_SECP256K1,
    chain_id: SESSION_CHAIN_ID,
    types,
    domain,
    message,
    signature: signature || td.signature || null,
    nonce,
    challenge_id: challengeId || td.challenge_id || null,
  });
}

/**
 * Normalize a SessionAct proof for signed receipt claims.
 * Verifiers recover agent_pubkey from signature + types/domain/message
 * without trusting Chit logs. Full EIP-712 types map is required (Bankr).
 */
export function sessionActClaimOf(sessionAct) {
  if (!sessionAct || typeof sessionAct !== 'object') return null;
  if (sessionAct.types?.SessionAct && (sessionAct.message || sessionAct.signature)) {
    return publicSessionActProof({
      typedData: sessionAct,
      signature: sessionAct.signature,
      verified: sessionAct.message ? {
        domain: sessionAct.domain,
        types: sessionAct.types,
        message: sessionAct.message,
        nonce: sessionAct.nonce || sessionAct.message?.nonce || null,
      } : null,
      challengeId: sessionAct.challenge_id || null,
    });
  }
  return publicSessionActProof({
    typedData: sessionAct.typed_data || sessionAct.typedData || sessionAct,
    signature: sessionAct.signature,
    verified: sessionAct.verified || null,
    challengeId: sessionAct.challenge_id || null,
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

  /**
   * Persist a client-generated 1-shot nonce (same spent set as challenge nonces).
   */
  consumeNonce(nonce) {
    if (!nonce) return { ok: false, reason: 'invalid_nonce' };
    let key;
    try {
      key = normalizeSessionNonce(nonce).toLowerCase();
    } catch {
      return { ok: false, reason: 'invalid_nonce' };
    }
    if (this.spent.has(key)) return { ok: false, reason: 'nonce_reused' };
    this.spent.add(key);
    return { ok: true, nonce: key };
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
 * Reconstruct typed data from a live challenge + act body, or from a 1-shot
 * body that already carries nonce + deadline (same SessionAct fields).
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
  const oneshotReady = !challenge
    && proof?.nonce
    && proof?.deadline != null
    && proof?.action
    && (proof?.resource != null && String(proof.resource).trim() !== '');
  if (!typedData && (challenge || oneshotReady)) {
    try {
      typedData = buildSessionActTypedData({
        delegationHash: proof?.delegation_hash || proof?.delegationHash || challenge?.delegation_hash,
        nonce: proof?.nonce || challenge?.nonce,
        action: proof?.action,
        resource: proof?.resource || challenge?.resource,
        deadline: proof?.deadline ?? challenge?.expires_at,
        targetAgent: proof?.target_agent || proof?.targetAgent || challenge?.target_agent,
        payloadHash: proof?.payload_hash || proof?.payloadHash,
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
 * Full prove-key gate: bound session + active + SessionAct + unused nonce.
 * Challenge path consumes the issued challenge after crypto succeeds.
 * 1-shot path (no challenge): client nonce + deadline, same types, same spent set.
 *
 * @param {object} opts
 * @param {object|null} opts.session
 * @param {boolean} [opts.revoked]
 * @param {object|null} opts.challenge  live challenge row (from getLive); omit for 1-shot
 * @param {object} opts.proof  { action, resource, signature, typed_data?, nonce?, deadline? }
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

  const oneshot = !challenge
    && proof?.nonce != null
    && proof?.deadline != null;
  if (!challenge && !oneshot) {
    return { ok: false, reason: 'challenge_or_nonce_required' };
  }

  if (challenge) {
    if (store?.isSpent(challenge.challenge_id, challenge.nonce)) {
      return { ok: false, reason: 'nonce_reused' };
    }
    if (nowSec(now) > Number(challenge.expires_at)) {
      return { ok: false, reason: 'challenge_expired' };
    }
    if (!hashesEqual(challenge.delegation_hash, bound.delegation_hash)) {
      return { ok: false, reason: 'delegation_hash_mismatch' };
    }
  }

  const action = normalizeSessionActAction(proof?.action);
  const resource = String(proof?.resource ?? challenge?.resource ?? '').trim();
  if (!action) return { ok: false, reason: 'action_required' };
  if (!resource) return { ok: false, reason: 'resource_required' };

  let clientNonce = null;
  if (oneshot) {
    try {
      clientNonce = normalizeSessionNonce(proof.nonce);
    } catch {
      return { ok: false, reason: 'invalid_nonce' };
    }
    if (store?.isSpent(null, clientNonce)) {
      return { ok: false, reason: 'nonce_reused' };
    }
  }

  const rebuilt = typedDataFromActRequest(
    {
      ...proof,
      action,
      resource,
      nonce: oneshot ? clientNonce : (proof?.nonce || challenge?.nonce),
      deadline: oneshot ? proof.deadline : (proof?.deadline ?? challenge?.expires_at),
      // 1-shot schema default is zero address (self). Do not fill agent_pubkey
      // or a signature over the locked default fails recovery. Challenge path
      // still falls back to the published challenge / bound agent.
      target_agent: proof?.target_agent || proof?.targetAgent
        || (oneshot ? SESSION_ACT_ZERO_ADDRESS : (challenge?.target_agent || bound.agent_pubkey)),
    },
    challenge,
    { verifyingContract, issuerUri },
  );
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };

  const verified = verifySessionAct(rebuilt.typedData, rebuilt.signature, {
    expectedAgent: bound.agent_pubkey,
    expectedDelegationHash: bound.delegation_hash,
    expectedNonce: oneshot ? clientNonce : challenge.nonce,
    expectedAction: action,
    expectedResource: resource,
    verifyingContract,
    now,
  });
  if (!verified.valid) {
    return { ok: false, reason: verified.reason, agent_pubkey: verified.agent_pubkey };
  }

  if (challenge) {
    // Deadline cannot outlive the challenge that issued the nonce.
    if (Number(verified.deadline) > Number(challenge.expires_at)) {
      return { ok: false, reason: 'deadline_after_challenge' };
    }
  } else {
    const window = checkOneshotDeadlineWindow(verified.deadline, now);
    if (!window.ok) return { ok: false, reason: window.reason };
  }

  if (store) {
    if (challenge) {
      const consumed = store.consume(challenge.challenge_id, { now });
      if (!consumed.ok) return { ok: false, reason: consumed.reason };
    } else {
      const consumed = store.consumeNonce(clientNonce);
      if (!consumed.ok) return { ok: false, reason: consumed.reason };
    }
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
    challenge_id: challenge?.challenge_id || null,
    oneshot,
    typed_data: jsonSafeTypedData({
      ...rebuilt.typedData,
      domain: verified.domain,
      types: verified.types || SESSION_ACT_TYPES,
    }),
    signature: rebuilt.signature,
    target_agent: resolveSessionActTarget(verified.target_agent, bound.agent_pubkey),
    payload_hash: verified.payload_hash || SESSION_ACT_ZERO_BYTES32,
    proof: publicSessionActProof({
      typedData: rebuilt.typedData,
      signature: rebuilt.signature,
      verified,
      challengeId: challenge?.challenge_id || null,
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
  SESSION_ACT_ZERO_ADDRESS,
  SESSION_ACT_ZERO_BYTES32,
  CHALLENGE_TTL_SEC_DEFAULT,
  ONESHOT_DEADLINE_MAX_SEC,
  buildSessionActTypedData,
  verifySessionAct,
  acceptSessionAct,
  checkOneshotDeadlineWindow,
  sessionBindsAgent,
  sessionIsActive,
  publicSessionActProof,
  sessionActClaimOf,
  resolveSessionActTarget,
  receiptBindsSession,
  SessionActChallengeStore,
  getSessionActStore,
};
