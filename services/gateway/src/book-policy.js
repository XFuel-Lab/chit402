/**
 * Book Policy — possession-gated policy rows for an agent's book.
 *
 * Treasury sets policy on the book: max $X / day, allowlisted models, kill switch.
 * The agent just runs. Store caps as book policy rows the possession holder writes;
 * gateway enforces them on spend. Per whitepaper lineage: A→B→inference is one chain.
 *
 * Policy types:
 *   daily_cap           — max $X / day (resets at midnight UTC)
 *   hourly_cap          — max $X / clock hour UTC (resets at top of each hour)
 *   model_allowlist     — only these models are allowed
 *   kill_switch         — all spend blocked when set
 *   require_payment_ref — block new spend when ledger rows lack payment.ref
 *   tier2_above         — spend at/above $X requires Tier-2 proof_tier on the request
 *   approval_ttl        — seconds after which high-blast SessionAct needs a fresh challenge
 *   risk_tiers          — optional override: { high: string[], low: string[] } for SessionAct actions
 *
 * Policy rows are stored separately from usage rows. Possession holder writes them;
 * gateway enforces them. Demo never writes policy rows.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { normalizeSessionActAction } from './session-act.js';

export const POLICY_TYPES = {
  DAILY_CAP: 'daily_cap',
  HOURLY_CAP: 'hourly_cap',
  MODEL_ALLOWLIST: 'model_allowlist',
  KILL_SWITCH: 'kill_switch',
  REQUIRE_PAYMENT_REF: 'require_payment_ref',
  TIER2_ABOVE: 'tier2_above',
  APPROVAL_TTL: 'approval_ttl',
  RISK_TIERS: 'risk_tiers',
};

/** Default SessionAct risk classification when risk_tiers is unset. */
export const DEFAULT_RISK_TIERS = Object.freeze({
  high: Object.freeze(['handoff', 'redeem']),
  low: Object.freeze(['read_private']),
});

export const APPROVAL_TTL_SEC_MIN = 60;
export const APPROVAL_TTL_SEC_MAX = 604800; // 7 days

export class BookPolicyStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<number, object>} agentId → policy object */
    this.byAgent = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'book-policy: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-policy.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const [k, v] of Object.entries(data.policies || {})) {
        this.byAgent.set(Number(k), v);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'book-policy: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      const policies = {};
      for (const [k, v] of this.byAgent.entries()) {
        policies[k] = v;
      }
      fs.writeFileSync(tmp, JSON.stringify({ policies }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'book-policy: save failed');
    }
  }

  /**
   * Get policy for an agent. Returns null if none set.
   * @param {number|string} agentId
   */
  get(agentId) {
    return this.byAgent.get(Number(agentId)) || null;
  }

  /**
   * Set a policy field for an agent. Possession-gated (caller verifies).
   * @param {number|string} agentId
   * @param {string} policyType - one of POLICY_TYPES
   * @param {*} value - policy value (null to clear)
   */
  set(agentId, policyType, value) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id' };
    }
    if (!Object.values(POLICY_TYPES).includes(policyType)) {
      return { ok: false, reason: `unknown policy type: ${policyType}` };
    }

    let policy = this.byAgent.get(id);
    if (!policy) {
      policy = { agent_id: id, created_at: new Date().toISOString() };
      this.byAgent.set(id, policy);
    }

    if (value === null || value === undefined) {
      delete policy[policyType];
    } else {
      if (policyType === POLICY_TYPES.DAILY_CAP) {
        let cap;
        try {
          cap = BigInt(String(value).trim());
          if (cap < 0n) return { ok: false, reason: 'daily_cap must be non-negative' };
        } catch {
          return { ok: false, reason: 'invalid daily_cap value' };
        }
        policy[policyType] = { limit: cap.toString(), reset_at: nextMidnightUTC() };
      } else if (policyType === POLICY_TYPES.HOURLY_CAP) {
        let cap;
        try {
          cap = BigInt(String(value).trim());
          if (cap < 0n) return { ok: false, reason: 'hourly_cap must be non-negative' };
        } catch {
          return { ok: false, reason: 'invalid hourly_cap value' };
        }
        policy[policyType] = { limit: cap.toString(), reset_at: nextHourUTC() };
      } else if (policyType === POLICY_TYPES.MODEL_ALLOWLIST) {
        if (!Array.isArray(value)) {
          return { ok: false, reason: 'model_allowlist must be an array' };
        }
        policy[policyType] = value.map(String);
      } else if (policyType === POLICY_TYPES.KILL_SWITCH) {
        policy[policyType] = !!value;
      } else if (policyType === POLICY_TYPES.REQUIRE_PAYMENT_REF) {
        policy[policyType] = !!value;
      } else if (policyType === POLICY_TYPES.TIER2_ABOVE) {
        let threshold;
        try {
          threshold = BigInt(String(value).trim());
          if (threshold < 0n) return { ok: false, reason: 'tier2_above must be non-negative' };
        } catch {
          return { ok: false, reason: 'invalid tier2_above value' };
        }
        policy[policyType] = { threshold: threshold.toString() };
      } else if (policyType === POLICY_TYPES.APPROVAL_TTL) {
        const seconds = clampApprovalTtlSec(value);
        if (seconds == null) return { ok: false, reason: 'invalid approval_ttl value' };
        policy[policyType] = { seconds };
      } else if (policyType === POLICY_TYPES.RISK_TIERS) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return { ok: false, reason: 'risk_tiers must be an object with high/low arrays' };
        }
        const high = Array.isArray(value.high) ? value.high.map((a) => normalizeSessionActAction(a)).filter(Boolean) : [];
        const low = Array.isArray(value.low) ? value.low.map((a) => normalizeSessionActAction(a)).filter(Boolean) : [];
        if (!high.length && !low.length) {
          return { ok: false, reason: 'risk_tiers requires at least one high or low action' };
        }
        policy[policyType] = { high, low };
      }
    }

    policy.updated_at = new Date().toISOString();
    this._save();
    return { ok: true, policy };
  }

  /**
   * Clear all policy for an agent.
   * @param {number|string} agentId
   */
  clear(agentId) {
    const id = Number(agentId);
    if (this.byAgent.has(id)) {
      this.byAgent.delete(id);
      this._save();
      return { ok: true };
    }
    return { ok: false, reason: 'no policy to clear' };
  }
}

function nextMidnightUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return tomorrow.toISOString();
}

/** Next clock-hour boundary (UTC). Hourly caps reset here. */
function nextHourUTC() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    0, 0, 0,
  ));
  return next.toISOString();
}

export function clampApprovalTtlSec(value) {
  if (value == null || value === '') return null;
  const raw = typeof value === 'object' && value != null && value.seconds != null
    ? value.seconds
    : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const sec = Math.floor(n);
  if (sec < APPROVAL_TTL_SEC_MIN || sec > APPROVAL_TTL_SEC_MAX) return null;
  return sec;
}

function riskTiersOf(policy) {
  const custom = policy?.[POLICY_TYPES.RISK_TIERS];
  if (custom && (custom.high?.length || custom.low?.length)) {
    return {
      high: (custom.high || []).map((a) => normalizeSessionActAction(a)),
      low: (custom.low || []).map((a) => normalizeSessionActAction(a)),
    };
  }
  return {
    high: [...DEFAULT_RISK_TIERS.high],
    low: [...DEFAULT_RISK_TIERS.low],
  };
}

/**
 * Classify a SessionAct action as high-blast or low-blast.
 * @param {string} action
 * @param {object|null} policyRow
 * @returns {'high'|'low'|'unknown'}
 */
export function classifySessionActRisk(action, policyRow = null) {
  const act = normalizeSessionActAction(action);
  if (!act) return 'unknown';
  const tiers = riskTiersOf(policyRow);
  if (tiers.high.includes(act)) return 'high';
  if (tiers.low.includes(act)) return 'low';
  return 'unknown';
}

function approvalTtlSecOf(policyRow) {
  if (!policyRow?.[POLICY_TYPES.APPROVAL_TTL]) return null;
  return clampApprovalTtlSec(policyRow[POLICY_TYPES.APPROVAL_TTL].seconds
    ?? policyRow[POLICY_TYPES.APPROVAL_TTL]);
}

/**
 * In-memory store: last high-blast SessionAct approval per delegation_hash.
 */
export class SessionActApprovalStore {
  constructor() {
    /** @type {Map<string, number>} delegation_hash → unix sec */
    this.byDelegation = new Map();
  }

  _key(delegationHash) {
    return String(delegationHash || '').toLowerCase();
  }

  getLastHighBlastAt(delegationHash) {
    const at = this.byDelegation.get(this._key(delegationHash));
    return at != null ? Number(at) : null;
  }

  recordHighBlast(delegationHash, now = null) {
    const clock = now != null ? Math.floor(Number(now)) : Math.floor(Date.now() / 1000);
    this.byDelegation.set(this._key(delegationHash), clock);
    return clock;
  }

  /** Test helper */
  clear() {
    this.byDelegation.clear();
  }
}

let _approvalStore = null;

export function getSessionActApprovalStore() {
  if (!_approvalStore) _approvalStore = new SessionActApprovalStore();
  return _approvalStore;
}

export function resetSessionActApprovalStore() {
  _approvalStore = null;
}

/**
 * Enforce approval_ttl for high-blast SessionAct before nonce consumption.
 *
 * @param {number|string} agentId
 * @param {string} action
 * @param {{ hasFreshChallenge?: boolean, delegationHash?: string|null, now?: number|null }} ctx
 * @param {{ policy?: BookPolicyStore, approvalStore?: SessionActApprovalStore }} deps
 */
export function enforceSessionActApproval(agentId, action, ctx = {}, { policy, approvalStore } = {}) {
  if (!policy) return { allowed: true };

  const id = Number(agentId);
  const p = policy.get(id);
  const ttlSec = approvalTtlSecOf(p);
  if (!ttlSec) return { allowed: true };

  const risk = classifySessionActRisk(action, p);
  if (risk !== 'high') return { allowed: true };

  if (ctx.hasFreshChallenge) {
    return { allowed: true, refreshOnSuccess: true, risk };
  }

  const hash = ctx.delegationHash;
  const store = approvalStore || getSessionActApprovalStore();
  const lastAt = hash ? store.getLastHighBlastAt(hash) : null;
  const clock = ctx.now != null ? Math.floor(Number(ctx.now)) : Math.floor(Date.now() / 1000);

  if (lastAt == null) {
    return {
      allowed: false,
      reason: 'high-blast SessionAct requires a fresh challenge before first approval',
      code: 'approval_ttl_expired',
      risk,
      approval_ttl_sec: ttlSec,
    };
  }

  if (clock - lastAt <= ttlSec) {
    return { allowed: true, refreshOnSuccess: true, risk };
  }

  return {
    allowed: false,
    reason: `high-blast SessionAct approval expired after ${ttlSec}s — request a fresh challenge`,
    code: 'approval_ttl_expired',
    risk,
    approval_ttl_sec: ttlSec,
    last_approval_at: lastAt,
  };
}

function tier2ProofRequested(proofTier) {
  if (!proofTier) return false;
  const t = String(proofTier).toLowerCase().trim();
  return t === 'settlement' || t === 'inference' || t === 'tee'
    || t === 'zk-spotcheck' || t === 'spotcheck' || t === 't3a' || t === 't3b' || t === 't3c'
    || t === 'zk-full' || t === 'full';
}

/**
 * Enforce policy on a spend attempt. Returns { allowed: true } or { allowed: false, reason, code }.
 *
 * @param {number|string} agentId
 * @param {{ model?: string, amount?: string|bigint, proof_tier?: string|null }} spend
 * @param {{ policy: BookPolicyStore, ledger: { sumCollectedByAgentToday?: Function, sumCollectedByAgentThisHour?: Function, hasIntegrityGapForAgent?: Function } }} deps
 */
export function enforcePolicy(agentId, spend = {}, { policy, ledger } = {}) {
  if (!policy) return { allowed: true };

  const id = Number(agentId);
  const p = policy.get(id);
  if (!p) return { allowed: true };

  if (p[POLICY_TYPES.KILL_SWITCH] === true) {
    return { allowed: false, reason: 'kill switch active', code: 'kill_switch' };
  }

  if (p[POLICY_TYPES.MODEL_ALLOWLIST] && Array.isArray(p[POLICY_TYPES.MODEL_ALLOWLIST])) {
    const model = spend.model ? String(spend.model).toLowerCase() : null;
    const allowed = p[POLICY_TYPES.MODEL_ALLOWLIST].map(m => String(m).toLowerCase());
    if (model && !allowed.includes(model)) {
      return { allowed: false, reason: `model ${spend.model} not in allowlist`, code: 'model_not_allowed' };
    }
  }

  if (p[POLICY_TYPES.REQUIRE_PAYMENT_REF] === true) {
    const gap = ledger?.hasIntegrityGapForAgent?.(id);
    if (gap?.has_gap) {
      return {
        allowed: false,
        reason: 'collected row missing payment.ref — new spend paused',
        code: 'payment_ref_required',
        task_id: gap.task_id || null,
      };
    }
  }

  if (p[POLICY_TYPES.HOURLY_CAP]) {
    const cap = p[POLICY_TYPES.HOURLY_CAP];
    const resetAt = new Date(cap.reset_at);
    const now = new Date();

    if (now >= resetAt) {
      cap.reset_at = nextHourUTC();
      policy.set(id, POLICY_TYPES.HOURLY_CAP, cap.limit);
    }

    const spentHour = ledger?.sumCollectedByAgentThisHour?.(id) ?? 0n;
    const limit = BigInt(cap.limit);
    const spendAmount = spend.amount ? BigInt(String(spend.amount)) : 0n;

    if (spentHour + spendAmount > limit) {
      return {
        allowed: false,
        reason: 'hourly cap exceeded',
        code: 'hourly_cap_exceeded',
        spent_hour: spentHour.toString(),
        hourly_cap: limit.toString(),
        remaining: (limit > spentHour ? limit - spentHour : 0n).toString(),
      };
    }
  }

  if (p[POLICY_TYPES.DAILY_CAP]) {
    const cap = p[POLICY_TYPES.DAILY_CAP];
    const resetAt = new Date(cap.reset_at);
    const now = new Date();

    if (now >= resetAt) {
      cap.reset_at = nextMidnightUTC();
      policy.set(id, POLICY_TYPES.DAILY_CAP, cap.limit);
    }

    const spentToday = ledger?.sumCollectedByAgentToday?.(id) ?? 0n;
    const limit = BigInt(cap.limit);
    const spendAmount = spend.amount ? BigInt(String(spend.amount)) : 0n;

    if (spentToday + spendAmount > limit) {
      return {
        allowed: false,
        reason: 'daily cap exceeded',
        code: 'daily_cap_exceeded',
        spent_today: spentToday.toString(),
        daily_cap: limit.toString(),
        remaining: (limit > spentToday ? limit - spentToday : 0n).toString(),
      };
    }
  }

  if (p[POLICY_TYPES.TIER2_ABOVE]) {
    const tierCfg = p[POLICY_TYPES.TIER2_ABOVE];
    const threshold = BigInt(tierCfg.threshold);
    const spendAmount = spend.amount ? BigInt(String(spend.amount)) : 0n;
    if (threshold > 0n && spendAmount >= threshold && !tier2ProofRequested(spend.proof_tier)) {
      return {
        allowed: false,
        reason: `spend at or above ${threshold.toString()} requires proof_tier settlement or inference`,
        code: 'tier2_required',
        threshold: threshold.toString(),
        amount: spendAmount.toString(),
      };
    }
  }

  return { allowed: true };
}

let _policyStore = null;

export function getBookPolicyStore(opts) {
  if (!_policyStore) _policyStore = new BookPolicyStore(opts);
  return _policyStore;
}

export function resetBookPolicyStore() {
  _policyStore = null;
}

export default {
  BookPolicyStore,
  POLICY_TYPES,
  DEFAULT_RISK_TIERS,
  enforcePolicy,
  enforceSessionActApproval,
  classifySessionActRisk,
  SessionActApprovalStore,
  getBookPolicyStore,
  resetBookPolicyStore,
  getSessionActApprovalStore,
  resetSessionActApprovalStore,
};
