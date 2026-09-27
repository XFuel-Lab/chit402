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
import { getAddress, hashMessage, Interface, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';
import logger from './logger.js';
import { bindAgentWallet } from './agent-wallet.js';
import { readAndVerifyReceipt } from './receipt-oracle.js';
import { receiptQualifiesForLedger, noteIdempotentReplay, markRefundOwed, SETTLEMENT_STATUS } from './usage-settled.js';
import { buildValidationRecord } from './erc8004.js';
import { STAMP_FEE_UNITS } from './pricing.js';

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

/** EIP-191 personal_sign window for recovering an already-issued session. */
export const REGISTER_RECOVER_MAX_AGE_SEC = 300;

/**
 * Message a bound wallet signs to recover an existing possession session.
 * `chit.register.recover|<taskId>|<checksumAddress>|<unixSeconds>`
 */
export function canonicalRegisterRecoverMessage(taskId, agentWallet, timestamp) {
  return `chit.register.recover|${taskId}|${getAddress(agentWallet)}|${timestamp}`;
}

/**
 * Message for a wallet-only register that pays the $0.002 stamp on this route.
 * `chit.register.pay|<checksumAddress>|<unixSeconds>`
 */
export function canonicalRegisterPayMessage(agentWallet, timestamp) {
  return `chit.register.pay|${getAddress(agentWallet)}|${timestamp}`;
}

const ERC1271_ABI = ['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'];
const ERC1271_MAGIC = '0x1626ba7e';

function evmPayer(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) return null;
  try { return getAddress(value.trim()); } catch { return null; }
}

/**
 * On-chain payer of a collected receipt. Body-supplied payer is ignored.
 * @param {object|null} receipt
 * @param {object|null} [ledgerEntry]
 */
export function receiptOnChainPayer(receipt, ledgerEntry = null) {
  const candidates = [
    receipt?.caller_binding?.payer_wallet,
    receipt?.authorization?.payer_wallet,
    receipt?.payment?.payer,
    receipt?.payment?.payer_wallet,
    ledgerEntry?.payer,
  ];
  for (const candidate of candidates) {
    const addr = evmPayer(candidate);
    if (addr) return addr;
  }
  return null;
}

function sessionMatches(stored, presented) {
  if (stored == null || presented == null || presented === '') return false;
  const want = Buffer.from(String(presented));
  const have = Buffer.from(String(stored));
  if (want.length !== have.length) return false;
  return crypto.timingSafeEqual(want, have);
}

/**
 * personal_sign over canonicalRegisterRecoverMessage. Same proof for a first
 * EOA bind and for releasing an already-issued session.
 * @returns {{ ok: true } | { ok: false, status: number, error: string, message: string }}
 */
export function verifyWalletControlSignature(body, taskId, agentWallet, nowSec = Math.floor(Date.now() / 1000), messageOverride = null) {
  const signature = body?.wallet_signature || body?.signature || null;
  if (!signature) {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_required',
      message: 'Plain EOA registration requires wallet_signature (personal_sign) and signature_timestamp',
    };
  }
  const timestamp = body?.signature_timestamp ?? body?.sig_timestamp ?? body?.timestamp;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_invalid',
      message: 'signature_timestamp is required',
    };
  }
  const age = nowSec - ts;
  if (age > REGISTER_RECOVER_MAX_AGE_SEC || age < -60) {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_invalid',
      message: 'wallet signature timestamp is outside the recovery window',
    };
  }
  try {
    const message = messageOverride || canonicalRegisterRecoverMessage(taskId, agentWallet, ts);
    const recovered = getAddress(verifyMessage(message, signature));
    if (recovered.toLowerCase() !== getAddress(agentWallet).toLowerCase()) {
      return {
        ok: false,
        status: 401,
        error: 'wallet_signature_invalid',
        message: 'wallet signature did not recover the agentWallet',
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_invalid',
      message: err?.message || 'wallet signature did not prove control',
    };
  }
}

/**
 * ERC-1271 isValidSignature on the payer contract. Magic value 0x1626ba7e.
 * The hash is the EIP-191 digest of the same personal_sign message.
 */
export async function verifyErc1271({ provider, payer, message, signature }) {
  if (!signature) {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_required',
      message: 'Smart-account registration requires wallet_signature for ERC-1271 isValidSignature',
    };
  }
  if (!provider || typeof provider.call !== 'function') {
    return {
      ok: false,
      status: 401,
      error: 'wallet_control_unverified',
      message: 'Smart-account registration needs an RPC to check ERC-1271 isValidSignature',
    };
  }
  try {
    const iface = new Interface(ERC1271_ABI);
    const data = iface.encodeFunctionData('isValidSignature', [hashMessage(message), signature]);
    const raw = await provider.call({ to: payer, data });
    const decoded = iface.decodeFunctionResult('isValidSignature', raw);
    if (String(decoded[0]).toLowerCase() !== ERC1271_MAGIC) {
      return {
        ok: false,
        status: 401,
        error: 'wallet_signature_invalid',
        message: 'ERC-1271 isValidSignature did not accept this wallet',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_invalid',
      message: 'ERC-1271 isValidSignature did not prove control of the payer',
    };
  }
}

/**
 * The registering wallet must be the receipt's on-chain payer, and must prove control.
 * EOA and unknown bytecode: personal_sign recovering to that payer.
 * AAWP / smart account: ERC-1271, unless a test injects proveSmartControl.
 */
async function assertRegistererIsPayer({
  body,
  bound,
  taskId,
  payer,
  provider = null,
  proveSmartControl = null,
  message = null,
}) {
  if (!payer) {
    return {
      ok: false,
      status: 403,
      error: 'payer_unknown',
      message: 'Receipt has no on-chain payer; registration requires that proof',
    };
  }
  let wallet;
  try { wallet = getAddress(bound.address); } catch {
    return { ok: false, status: 400, error: 'invalid_wallet', message: 'agentWallet is not an EVM address' };
  }
  if (wallet !== payer) {
    return {
      ok: false,
      status: 403,
      error: 'payer_mismatch',
      message: 'agentWallet must be the receipt on-chain payer',
    };
  }
  const contractWallet = bound.kind === 'aawp' || bound.kind === 'smart_account';
  if (!contractWallet) {
    return verifyWalletControlSignature(body, taskId, wallet, undefined, message);
  }
  if (typeof proveSmartControl === 'function') {
    return proveSmartControl({
      body,
      bound,
      taskId,
      payer,
      message: message || null,
    });
  }
  const ts = Number(body?.signature_timestamp ?? body?.sig_timestamp ?? body?.timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || (nowSec - ts) > REGISTER_RECOVER_MAX_AGE_SEC || (nowSec - ts) < -60) {
    if (!(body?.wallet_signature || body?.signature)) {
      return {
        ok: false,
        status: 401,
        error: 'wallet_signature_required',
        message: 'Smart-account registration requires wallet_signature for ERC-1271 isValidSignature',
      };
    }
    return {
      ok: false,
      status: 401,
      error: 'wallet_signature_invalid',
      message: 'signature_timestamp is outside the recovery window',
    };
  }
  const signedMessage = message || canonicalRegisterRecoverMessage(taskId, wallet, ts);
  return verifyErc1271({
    provider,
    payer,
    message: signedMessage,
    signature: body?.wallet_signature || body?.signature || null,
  });
}

/**
 * Prove control of an already-bound wallet. A matching session is the existing
 * key. A fresh personal_sign is wallet control. Either releases the session.
 * @returns {{ ok: true, release: boolean } | { ok: false, status: number, error: string, message: string }}
 */
export function authorizeExistingSessionRelease(body, identity, taskId, agentWallet, nowSec = Math.floor(Date.now() / 1000)) {
  const presented = body?.session ?? body?.possession_session ?? null;
  if (presented != null && presented !== '') {
    if (sessionMatches(identity?.session, presented)) return { ok: true, release: true };
    return {
      ok: false,
      status: 403,
      error: 'session_mismatch',
      message: 'presented session does not match this agent',
    };
  }

  const signature = body?.wallet_signature || body?.signature || null;
  if (signature) {
    const proof = verifyWalletControlSignature(body, taskId, agentWallet, nowSec);
    if (!proof.ok) return proof;
    return { ok: true, release: true };
  }

  return { ok: true, release: false };
}

/**
 * Register an agent against a paid HMAC-valid receipt.
 *
 * @param {object} body
 * @param {object} deps
 */
function payerGateFailure(payer, bound) {
  if (!payer) {
    return {
      ok: false,
      status: 403,
      error: 'payer_unknown',
      message: 'Receipt has no on-chain payer; registration requires that proof',
    };
  }
  if (getAddress(bound.address) !== payer) {
    return {
      ok: false,
      status: 403,
      error: 'payer_mismatch',
      message: 'agentWallet must be the receipt on-chain payer',
    };
  }
  return null;
}

/**
 * A settled register payment we will not turn into an agent. The row stays on
 * the book as refund_owed so the USDC is not dropped. The wallet is not bound.
 */
function recordRegisterRefundOwed(ledger, registry, { paymentRef, amount, payer }) {
  if (!ledger || typeof ledger.append !== 'function' || !registry || typeof registry.allocate !== 'function') {
    return null;
  }
  if (!paymentRef) return null;
  const ref = String(paymentRef);
  const taskId = `register-refund-${crypto.createHash('sha256').update(ref).digest('hex').slice(0, 32)}`;
  const existing = typeof ledger.findByRef === 'function' ? ledger.findByRef(ref) : null;
  if (existing) {
    const marked = markRefundOwed(ledger, {
      taskId: existing.task_id,
      amount: amount != null ? String(amount) : existing.amount,
      payer: payer || existing.payer,
      paymentRef: ref,
    });
    return marked.ok ? marked.entry : existing;
  }
  const identity = registry.allocate({ taskId, paymentRef: ref });
  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: taskId,
    status: 'failed',
    payment: {
      rail: 'usdc',
      ref,
      collected: true,
      gross_amount: String(amount || STAMP_FEE_UNITS),
      payer: payer || null,
    },
    route: {
      model: 'chit402/register',
      hub: 'chit',
      provider: 'chit402',
      resource: 'https://api.chit402.com/v1/agents/register',
    },
  };
  const appended = ledger.append(receipt, { payer: payer || null, agentId: identity.agent_id });
  if (!appended.ok) return null;
  const marked = markRefundOwed(ledger, {
    taskId,
    amount: String(amount || STAMP_FEE_UNITS),
    payer: payer || null,
    paymentRef: ref,
  });
  return marked.ok ? marked.entry : appended.entry;
}

/**
 * Wallet-only register: pay the $0.002 stamp on this route. The paying wallet
 * is the agent wallet, and that stamp is the collected receipt on the book.
 * A waiver is not a payment and cannot register.
 */
async function registerPaidStamp(body, deps) {
  const {
    registry,
    ledger,
    bindWallet,
    postA2A,
    apiKey = null,
    walletOpts = {},
    provider = null,
    proveSmartControl = null,
    ensureRegisterStamp,
  } = deps;
  const agentWallet = body.agentWallet || body.agent_wallet;
  if (typeof ensureRegisterStamp !== 'function') {
    return { ok: false, status: 400, error: 'validation_error', message: 'task_id is required' };
  }
  if (!registry || !ledger) {
    return { ok: false, status: 503, error: 'service_unavailable', message: 'registry is not configured' };
  }
  const bound = await (bindWallet || bindAgentWallet)(agentWallet, { apiKey, ...walletOpts });
  if (!bound.ok) {
    return { ok: false, status: 400, error: 'invalid_wallet', message: bound.reason };
  }
  const ts = Number(body?.signature_timestamp ?? body?.sig_timestamp ?? body?.timestamp);
  const payMessage = Number.isFinite(ts) ? canonicalRegisterPayMessage(bound.address, ts) : null;
  const control = await assertRegistererIsPayer({
    body,
    bound,
    taskId: 'register-pay',
    payer: getAddress(bound.address),
    provider,
    proveSmartControl,
    message: payMessage,
  });
  if (!control.ok) return control;

  let stamp;
  try {
    stamp = await ensureRegisterStamp();
  } catch (err) {
    return { ok: false, status: 402, error: 'stamp_payment_required', message: err?.message || 'Register stamp payment failed' };
  }
  if (!stamp || stamp.ok !== true) {
    return {
      ok: false,
      status: stamp?.status || 402,
      error: stamp?.error || 'stamp_payment_required',
      message: stamp?.message || 'Register stamp is $0.002 USDC (2000 atomic), paid by this wallet',
      challenge: stamp?.challenge || null,
    };
  }
  if (stamp.waived === true) {
    return {
      ok: false,
      status: 402,
      error: 'stamp_payment_required',
      message: 'Paid registration requires a settled x402 payment of 2000 atomic USDC',
    };
  }
  const paymentRef = stamp.settlement?.paymentRef ? String(stamp.settlement.paymentRef) : null;
  const paidPayer = evmPayer(stamp.settlement?.payerWallet);
  const rawPayer = stamp.settlement?.payerWallet ? String(stamp.settlement.payerWallet) : null;
  if (!paymentRef) {
    return { ok: false, status: 402, error: 'stamp_payment_required', message: 'Register stamp did not include a payment ref' };
  }
  if (!paidPayer || paidPayer !== getAddress(bound.address)) {
    recordRegisterRefundOwed(ledger, registry, {
      paymentRef,
      amount: stamp.settlement?.amount,
      payer: rawPayer,
    });
    return {
      ok: false,
      status: 403,
      error: 'payer_mismatch',
      message: 'The stamp settled from a wallet other than agentWallet. The payment is on the book as refund_owed. This wallet is not registered.',
    };
  }
  let paid = 0n;
  try { paid = BigInt(String(stamp.settlement.amount)); } catch { paid = 0n; }
  if (paid < BigInt(STAMP_FEE_UNITS)) {
    recordRegisterRefundOwed(ledger, registry, {
      paymentRef,
      amount: stamp.settlement?.amount,
      payer: paidPayer,
    });
    return {
      ok: false,
      status: 402,
      error: 'stamp_underpaid',
      message: `Register stamp ${paid} is below ${STAMP_FEE_UNITS}. The payment is on the book as refund_owed.`,
    };
  }

  const taskId = `register-${crypto.createHash('sha256').update(paymentRef).digest('hex').slice(0, 32)}`;
  const existing = typeof ledger.findByRef === 'function' ? ledger.findByRef(paymentRef) : null;
  if (existing && existing.task_id !== taskId) {
    return { ok: false, status: 409, error: 'duplicate_ref', message: 'duplicate payment.ref' };
  }

  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: taskId,
    status: 'completed',
    payment: {
      rail: 'usdc',
      ref: paymentRef,
      collected: true,
      gross_amount: String(STAMP_FEE_UNITS),
      payer: paidPayer,
    },
    caller_binding: { payer_wallet: paidPayer },
    route: {
      model: 'chit402/register',
      hub: 'chit',
      provider: 'chit402',
      resource: 'https://api.chit402.com/v1/agents/register',
    },
  };

  let identity;
  let creditedEntry;
  let replay = false;
  if (existing) {
    const prior = typeof registry.get === 'function' ? registry.get(existing.agent_id) : null;
    const alreadyBound = !!(
      prior?.agentWallet
      && String(prior.agentWallet).toLowerCase() === String(bound.address).toLowerCase()
    );
    if (!alreadyBound && prior?.agentWallet) {
      return { ok: false, status: 409, error: 'bind_failed', message: 'agent_id already bound to another wallet' };
    }
    const boundId = registry.bindWallet(existing.agent_id, {
      agentWallet: bound.address,
      kind: bound.kind,
      official: bound.official,
      taskId,
      paymentRef,
    });
    if (!boundId.ok) {
      return { ok: false, status: 409, error: 'bind_failed', message: boundId.reason };
    }
    identity = boundId.identity;
    creditedEntry = existing;
    replay = true;
  } else {
    const upserted = registry.upsert({
      agentWallet: bound.address,
      kind: bound.kind,
      official: bound.official,
      taskId,
      paymentRef,
    });
    identity = upserted.identity;
    const credited = ledger.append(receipt, { payer: paidPayer, agentId: identity.agent_id });
    if (!credited.ok) {
      return { ok: false, status: 409, error: credited.code, message: credited.reason };
    }
    creditedEntry = credited.entry;
  }

  return finishRegistration({
    identity,
    bound,
    receipt,
    creditedEntry,
    replay,
    releaseSession: true,
    postA2A,
    requestHash: body.request_hash || body.requestHash,
  });
}

async function finishRegistration({
  identity,
  bound,
  receipt,
  creditedEntry,
  replay,
  releaseSession,
  postA2A,
  requestHash,
}) {
  const hash = requestHashOf({
    requestHash,
    taskId: receipt.task_id,
    agentWallet: bound.address,
  });
  let validation = null;
  try {
    validation = buildValidationRecord(receipt, { requestHash: hash, agentId: identity.agent_id });
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
      session: releaseSession ? identity.session : null,
      ...(releaseSession ? {} : { session_withheld: true }),
      task_id: receipt.task_id,
      payment: {
        ref: receipt.payment.ref,
        rail: receipt.payment.rail,
        collected: true,
      },
      settlement_status: replay ? SETTLEMENT_STATUS.IDEMPOTENT_REPLAY : SETTLEMENT_STATUS.SETTLED,
      idempotent_replay: !!replay,
      replay_of: replay ? creditedEntry.task_id : null,
      usage_settled: creditedEntry,
      validation,
      validate_score: validation?.response ?? null,
      a2a,
    },
  };
}

/**
 * Register an agent against a paid HMAC-valid receipt, or pay the $0.002
 * register stamp when task_id is omitted.
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
  provider = null,
  proveSmartControl = null,
  ensureRegisterStamp = null,
} = {}) {
  const taskId = body.task_id || body.taskId || body.receipt_id;
  const agentWallet = body.agentWallet || body.agent_wallet;
  const requestHash = body.request_hash || body.requestHash;

  if (!agentWallet) {
    return { ok: false, status: 400, error: 'validation_error', message: 'agentWallet is required' };
  }
  if (!taskId) {
    return registerPaidStamp(body, {
      registry,
      ledger,
      bindWallet,
      postA2A,
      apiKey,
      walletOpts,
      provider,
      proveSmartControl,
      ensureRegisterStamp,
    });
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
  let releaseSession = true;

  if (existingTask || existingRef) {
    const entry = existingTask || existingRef;
    const prior = typeof registry.get === 'function' ? registry.get(entry.agent_id) : null;
    const alreadyBound = !!(
      prior?.agentWallet
      && String(prior.agentWallet).toLowerCase() === String(bound.address).toLowerCase()
    );
    noteIdempotentReplay(entry);
    if (typeof registry.bindWallet !== 'function') {
      return { ok: false, status: 503, error: 'service_unavailable', message: 'registry.bindWallet is not configured' };
    }
    const onChainPayer = receiptOnChainPayer(oracle.receipt, entry);
    if (alreadyBound) {
      const mismatch = payerGateFailure(onChainPayer, bound);
      if (mismatch) return mismatch;
    } else {
      const control = await assertRegistererIsPayer({
        body,
        bound,
        taskId: oracle.receipt.task_id,
        payer: onChainPayer,
        provider,
        proveSmartControl,
      });
      if (!control.ok) return control;
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
    if (alreadyBound) {
      const gate = authorizeExistingSessionRelease(
        body,
        identity,
        oracle.receipt.task_id,
        bound.address,
      );
      if (!gate.ok) {
        return { ok: false, status: gate.status, error: gate.error, message: gate.message };
      }
      releaseSession = gate.release === true;
    }
  } else {
    const onChainPayer = receiptOnChainPayer(oracle.receipt, null);
    const control = await assertRegistererIsPayer({
      body,
      bound,
      taskId: oracle.receipt.task_id,
      payer: onChainPayer,
      provider,
      proveSmartControl,
    });
    if (!control.ok) return control;
    const upserted = registry.upsert({
      agentWallet: bound.address,
      kind: bound.kind,
      official: bound.official,
      taskId: oracle.receipt.task_id,
      paymentRef: oracle.receipt.payment.ref,
    });
    identity = upserted.identity;
    const credited = ledger.append(oracle.receipt, {
      payer: onChainPayer,
      agentId: identity.agent_id,
    });
    if (!credited.ok) {
      return { ok: false, status: 409, error: credited.code, message: credited.reason };
    }
    creditedEntry = credited.entry;
  }

  return finishRegistration({
    identity,
    bound,
    receipt: oracle.receipt,
    creditedEntry,
    replay: !!(existingTask || existingRef),
    releaseSession,
    postA2A,
    requestHash,
  });
}
