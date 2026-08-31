/**
 * Book Policy — possession-gated policy rows for an agent's book.
 *
 * Treasury sets policy on the book: max $X / day, allowlisted models, kill switch.
 * The agent just runs. Store caps as book policy rows the possession holder writes;
 * gateway enforces them on spend. Per whitepaper lineage: A→B→inference is one chain.
 *
 * Policy types:
 *   daily_cap      — max $X / day (resets at midnight UTC)
 *   model_allowlist — only these models are allowed
 *   kill_switch    — all spend blocked when set
 *
 * Policy rows are stored separately from usage rows. Possession holder writes them;
 * gateway enforces them. Demo never writes policy rows.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

export const POLICY_TYPES = {
  DAILY_CAP: 'daily_cap',
  MODEL_ALLOWLIST: 'model_allowlist',
  KILL_SWITCH: 'kill_switch',
};

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
      } else if (policyType === POLICY_TYPES.MODEL_ALLOWLIST) {
        if (!Array.isArray(value)) {
          return { ok: false, reason: 'model_allowlist must be an array' };
        }
        policy[policyType] = value.map(String);
      } else if (policyType === POLICY_TYPES.KILL_SWITCH) {
        policy[policyType] = !!value;
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

/**
 * Enforce policy on a spend attempt. Returns { allowed: true } or { allowed: false, reason, code }.
 *
 * @param {number|string} agentId
 * @param {{ model?: string, amount?: string|bigint }} spend
 * @param {{ policy: BookPolicyStore, ledger: { sumCollectedByAgentToday?: Function, sumCollectedByAgent?: Function } }} deps
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
        remaining: (limit - spentToday).toString(),
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
  enforcePolicy,
  getBookPolicyStore,
  resetBookPolicyStore,
};
