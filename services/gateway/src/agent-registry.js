/**
 * Registered agent identity: integer agent_id + bound agentWallet.
 *
 * A qualifying HMAC-valid collected receipt is required. Demo / unmetered /
 * collected:false never creates an identity. UsageSettled is written on
 * collected /v1 and /a2a-message settle (not deferred to register); register
 * binds a wallet onto that bookable agent_id when the row already exists.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { keccak256, toUtf8Bytes } from 'ethers';
import logger from './logger.js';
import { bindAgentWallet } from './agent-wallet.js';
import { readAndVerifyReceipt } from './receipt-oracle.js';
import { receiptQualifiesForLedger } from './usage-settled.js';
import { buildValidationRecord } from './erc8004.js';

/** Per-identity possession secret. Issued at register; used to HMAC the book. */
function issueSession() {
  return crypto.randomBytes(32).toString('hex');
}

export class AgentRegistry {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    this.nextId = 1;
    /** @type {Map<number, object>} */
    this.byId = new Map();
    /** @type {Map<string, number>} */
    this.byWallet = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'agent-registry: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'identities.json');
  }

  _load() {
    try {
      const snap = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      this.nextId = Number(snap.nextId) || 1;
      for (const row of snap.identities || []) {
        if (row.budget === undefined) row.budget = null;
        this.byId.set(Number(row.agent_id), row);
        if (row.agentWallet) this.byWallet.set(String(row.agentWallet).toLowerCase(), Number(row.agent_id));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'agent-registry: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({
        nextId: this.nextId,
        identities: [...this.byId.values()],
      }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'agent-registry: save failed');
    }
  }

  get(agentId) {
    return this.byId.get(Number(agentId)) || null;
  }

  getByWallet(wallet) {
    const id = this.byWallet.get(String(wallet).toLowerCase());
    return id != null ? this.get(id) : null;
  }

  /**
   * Resolve identity by possession session. Timing-safe compare.
   * @param {string|null|undefined} session
   */
  getBySession(session) {
    if (!session) return null;
    const want = Buffer.from(String(session));
    for (const row of this.byId.values()) {
      if (!row?.session) continue;
      const have = Buffer.from(String(row.session));
      if (want.length === have.length && crypto.timingSafeEqual(want, have)) return row;
    }
    return null;
  }

  /**
   * Rotate the possession session for an agent. The old session becomes invalid;
   * a new session is issued. The book (UsageSettled entries) is NOT dropped —
   * entries are tied to agent_id, not session. Possession sanity: key rotation
   * must not drop the book.
   *
   * @param {number|string} agentId
   * @param {string} oldSession - The current session (must match to rotate)
   * @returns {{ ok: boolean, session?: string, reason?: string }}
   */
  rotateSession(agentId, oldSession) {
    const id = Number(agentId);
    const row = this.byId.get(id);
    if (!row || !Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'unknown agent_id' };
    }
    if (!oldSession || row.session !== oldSession) {
      return { ok: false, reason: 'session mismatch' };
    }
    row.session = issueSession();
    row.session_rotated_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    this._save();
    return { ok: true, session: row.session };
  }

  /**
   * Set prepaid budget Y in USDC atomic units (2000 = $0.002).
   * Null/absent clears the cap (unlimited). allocate() itself has no budget.
   * @param {number|string} agentId
   * @param {string|number|bigint|null|undefined} budget
   */
  setBudget(agentId, budget) {
    const id = Number(agentId);
    const row = this.byId.get(id);
    if (!row || !Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'unknown agent_id' };
    }
    if (budget === null || budget === undefined || budget === '') {
      row.budget = null;
    } else {
      let n;
      try {
        n = BigInt(String(budget).trim());
      } catch {
        return { ok: false, reason: 'invalid budget' };
      }
      if (n < 0n) return { ok: false, reason: 'invalid budget' };
      row.budget = n.toString();
    }
    row.updated_at = new Date().toISOString();
    this._save();
    return { ok: true, identity: row };
  }

  /**
   * Allocate a bookable agent_id + session without a wallet.
   * Used on collected /v1 and /a2a-message settle so UsageSettled can
   * land under an id the book can read before POST /v1/agents/register.
   * Budget is unset (unlimited) — set via setBudget under possession.
   * @param {{ taskId?: string, paymentRef?: string }} [fields]
   */
  allocate(fields = {}) {
    const agentId = this.nextId++;
    const row = {
      agent_id: agentId,
      agentWallet: null,
      wallet_kind: null,
      official: false,
      task_id: fields.taskId || null,
      payment_ref: fields.paymentRef || null,
      session: issueSession(),
      budget: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.byId.set(agentId, row);
    this._save();
    return row;
  }

  /**
   * Bind an AAWP wallet onto an existing agent_id (from settle allocate).
   * @param {number|string} agentId
   * @param {{ agentWallet: string, kind?: string, official?: boolean, taskId?: string, paymentRef?: string }} fields
   */
  bindWallet(agentId, fields) {
    const id = Number(agentId);
    const row = this.byId.get(id);
    if (!row || !Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'unknown agent_id' };
    }
    const key = String(fields.agentWallet).toLowerCase();
    const existingWalletId = this.byWallet.get(key);
    if (existingWalletId != null && existingWalletId !== id) {
      return { ok: false, reason: 'wallet already bound to another agent_id' };
    }
    if (row.agentWallet && String(row.agentWallet).toLowerCase() !== key) {
      return { ok: false, reason: 'agent_id already bound to another wallet' };
    }
    row.agentWallet = fields.agentWallet;
    row.wallet_kind = fields.kind || row.wallet_kind;
    row.official = !!fields.official;
    if (fields.taskId) row.task_id = fields.taskId;
    if (fields.paymentRef) row.payment_ref = fields.paymentRef;
    if (!row.session) row.session = issueSession();
    row.updated_at = new Date().toISOString();
    this.byWallet.set(key, id);
    this._save();
    return { ok: true, identity: row };
  }

  /**
   * Allocate or reuse an identity for a bound wallet.
   * @param {{ agentWallet: string, kind?: string, official?: boolean, taskId?: string, paymentRef?: string }} fields
   */
  upsert(fields) {
    const key = String(fields.agentWallet).toLowerCase();
    const existingId = this.byWallet.get(key);
    if (existingId != null) {
      const row = this.byId.get(existingId);
      if (fields.taskId) row.task_id = fields.taskId;
      if (fields.paymentRef) row.payment_ref = fields.paymentRef;
      if (!row.session) row.session = issueSession();
      row.updated_at = new Date().toISOString();
      this._save();
      return { created: false, identity: row };
    }
    const agentId = this.nextId++;
    const row = {
      agent_id: agentId,
      agentWallet: fields.agentWallet,
      wallet_kind: fields.kind || null,
      official: !!fields.official,
      task_id: fields.taskId || null,
      payment_ref: fields.paymentRef || null,
      session: issueSession(),
      budget: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.byId.set(agentId, row);
    this.byWallet.set(key, agentId);
    this._save();
    return { created: true, identity: row };
  }
}

let _registry = null;

export function getAgentRegistry(opts) {
  if (!_registry) _registry = new AgentRegistry(opts);
  return _registry;
}

export function resetAgentRegistry() {
  _registry = null;
}

function requestHashOf({ requestHash, taskId, agentWallet }) {
  if (requestHash && /^0x[0-9a-fA-F]{64}$/.test(requestHash)) return requestHash;
  return keccak256(toUtf8Bytes(`xfuel-register:${taskId}:${agentWallet}`));
}

/**
 * Register an agent against a paid HMAC-valid receipt.
 *
 * @param {object} body
 * @param {object} deps
 */
export async function registerAgent(body = {}, {
  registry,
  ledger,
  loadReceipt,
  verify,
  bindWallet,
  postA2A,
  apiKey = null,
  walletOpts = {},
} = {}) {
  const taskId = body.task_id || body.taskId || body.receipt_id;
  const agentWallet = body.agentWallet || body.agent_wallet;
  const requestHash = body.request_hash || body.requestHash;
  const payer = body.payer || null;

  if (!taskId) {
    return { ok: false, status: 400, error: 'validation_error', message: 'task_id is required' };
  }
  if (!agentWallet) {
    return { ok: false, status: 400, error: 'validation_error', message: 'agentWallet is required' };
  }
  if (typeof verify !== 'function' || typeof loadReceipt !== 'function') {
    return { ok: false, status: 503, error: 'service_unavailable', message: 'receipt oracle is not configured' };
  }

  const bound = await (bindWallet || bindAgentWallet)(agentWallet, { apiKey, ...walletOpts });
  if (!bound.ok) {
    return { ok: false, status: 400, error: 'invalid_wallet', message: bound.reason };
  }

  const oracle = await readAndVerifyReceipt(String(taskId), { loadReceipt, verify });
  if (!oracle.ok) {
    const hmacFail = /hmac/i.test(oracle.reason || '');
    return {
      ok: false,
      status: hmacFail ? 400 : (oracle.reason === 'receipt not found' ? 404 : 400),
      error: hmacFail ? 'hmac_invalid' : (oracle.reason === 'receipt not found' ? 'not_found' : 'receipt_invalid'),
      message: oracle.reason,
    };
  }

  const qualify = receiptQualifiesForLedger(oracle.receipt);
  if (!qualify.ok) {
    return {
      ok: false,
      status: 403,
      error: 'not_qualifying',
      message: qualify.reason,
    };
  }

  const existingRef = ledger.findByRef(oracle.receipt.payment.ref);
  const existingTask = ledger.findByTask(oracle.receipt.task_id);

  // Settle already ledgered this receipt under a bookable agent_id — bind wallet
  // onto that id. Do not append again. Cross-task same payment.ref still 409s.
  if (existingRef && existingRef.task_id !== oracle.receipt.task_id) {
    return { ok: false, status: 409, error: 'duplicate_ref', message: 'duplicate payment.ref' };
  }
  if (existingTask && existingTask.payment_ref !== oracle.receipt.payment.ref) {
    return { ok: false, status: 409, error: 'duplicate_task', message: 'duplicate task_id' };
  }

  let identity;
  let creditedEntry;

  if (existingTask || existingRef) {
    const entry = existingTask || existingRef;
    if (typeof registry.bindWallet !== 'function') {
      return { ok: false, status: 503, error: 'service_unavailable', message: 'registry.bindWallet is not configured' };
    }
    const boundId = registry.bindWallet(entry.agent_id, {
      agentWallet: bound.address,
      kind: bound.kind,
      official: bound.official,
      taskId: oracle.receipt.task_id,
      paymentRef: oracle.receipt.payment.ref,
    });
    if (!boundId.ok) {
      return { ok: false, status: 409, error: 'bind_failed', message: boundId.reason };
    }
    identity = boundId.identity;
    creditedEntry = entry;
  } else {
    // Legacy / offline receipts that never hit the settle append path.
    const upserted = registry.upsert({
      agentWallet: bound.address,
      kind: bound.kind,
      official: bound.official,
      taskId: oracle.receipt.task_id,
      paymentRef: oracle.receipt.payment.ref,
    });
    identity = upserted.identity;
    const credited = ledger.append(oracle.receipt, {
      payer: payer || bound.address,
      agentId: identity.agent_id,
    });
    if (!credited.ok) {
      return { ok: false, status: 409, error: credited.code, message: credited.reason };
    }
    creditedEntry = credited.entry;
  }

  const hash = requestHashOf({
    requestHash,
    taskId: oracle.receipt.task_id,
    agentWallet: bound.address,
  });

  let validation = null;
  try {
    validation = buildValidationRecord(oracle.receipt, {
      requestHash: hash,
      agentId: identity.agent_id,
    });
  } catch (err) {
    validation = { eligible: false, reason: err.message, response: 0 };
  }

  let a2a = null;
  if (typeof postA2A === 'function') {
    const senderIdentity = keccak256(toUtf8Bytes(`agent:${identity.agent_id}:${bound.address}`));
    a2a = await postA2A({
      message_type: 'capability_query',
      sender_chain: 'base',
      recipient_chain: 'base',
      payload_hash: hash,
      escrow_amount: '0',
      ttl: 3600,
      sender_address: bound.address,
      sender_identity: senderIdentity,
    });
  }

  return {
    ok: true,
    status: 200,
    body: {
      agent_id: identity.agent_id,
      agentWallet: identity.agentWallet,
      wallet_kind: identity.wallet_kind,
      session: identity.session,
      task_id: oracle.receipt.task_id,
      payment: {
        ref: oracle.receipt.payment.ref,
        rail: oracle.receipt.payment.rail,
        collected: true,
      },
      usage_settled: creditedEntry,
      validation,
      validate_score: validation?.response ?? null,
      a2a,
    },
  };
}
