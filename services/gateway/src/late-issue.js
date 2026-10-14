/**
 * Late-issue receipts.
 *
 * A settle whose request left the process keeps one row in the replay store
 * (the durable challenge store). States run
 * submitted → unknown → confirmed → issuing → issued.
 * The row is written before /settle and is not released after that.
 * Issuance is off unless X402_LATE_ISSUE is on. The receipt payload is the
 * existing v11 document. This module does not add a signed field.
 */
import crypto from 'node:crypto';
import logger from './logger.js';
import { confirmSettlement, evmFinality } from './x402-chain.js';
import { samePayee, truncateWallet } from './x402-flags.js';
import { canonicalNetwork, encodeBase58, normalizePaymentRef, sameNetwork } from './payment-ref.js';
import { buildV11SignedClaims, minuteIssuedAt } from './v11-seal.js';
import { jcsRfc8785 } from './offer-receipt.js';
import { signJws } from './issuer-key.js';
import { bindSaltReceipt, requestDigest, requestSalt, saltReceiptId } from './request-binding.js';

export const LATE_HORIZON_MS = 24 * 60 * 60 * 1000;
export const LATE_REDEEM_MS = 15 * 60 * 1000;
export const LATE_SKEW_MS = 120_000;
/** Solana: settle timeout 45s + blockhash lifetime ~90s + 60s. */
export const SOLANA_LATE_WINDOW_MS = (45 + 90 + 60) * 1000;
export const LATE_RETRY_AFTER_SEC = 5;

const TERMINAL = new Set([
  'issued',
  'mismatch_hold',
  'expired_unresolved',
  'not_settled',
  'refund_owed',
  'ineligible_alert',
]);

export function lateIssueEnabled(cfg = {}) {
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'lateIssue')) return cfg.lateIssue === true;
  const v = process.env.X402_LATE_ISSUE;
  return v === '1' || v === 'true';
}

export function lateIssueShadow(cfg = {}) {
  if (cfg && cfg.lateIssueShadow === true) return true;
  return process.env.X402_LATE_ISSUE_SHADOW === '1' || process.env.X402_LATE_ISSUE_SHADOW === 'true';
}

export function evmAuthKey(network, asset, from, nonce) {
  if (!from || !nonce) return null;
  return `${canonicalNetwork(network)}|${String(asset || '').toLowerCase()}|${String(from).toLowerCase()}|${String(nonce).toLowerCase()}`;
}

function readShortvec(buf, offset) {
  let len = 0;
  let shift = 0;
  let i = offset;
  for (let n = 0; n < 3; n += 1) {
    if (i >= buf.length) return null;
    const b = buf[i];
    i += 1;
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { len, next: i };
    shift += 7;
  }
  return null;
}

/**
 * Fee payer is account 0. The payer authority is the other required signer
 * when there is exactly one. Ambiguous messages do not guess.
 */
export function solanaMessageAccounts(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  const buf = Buffer.from(base64, 'base64');
  const count = readShortvec(buf, 0);
  if (!count || count.len < 1 || count.len > 8) return null;
  const start = count.next + (count.len * 64);
  if (start <= 0 || start >= buf.length) return null;
  const msg = buf.subarray(start);
  if (msg.length < 4) return null;
  const required = msg[0];
  const keys = readShortvec(msg, 3);
  if (!keys || required < 1 || required > keys.len) return null;
  const end = keys.next + (keys.len * 32);
  if (end > msg.length) return null;
  const accounts = [];
  for (let i = 0; i < keys.len; i += 1) {
    const slice = msg.subarray(keys.next + (i * 32), keys.next + ((i + 1) * 32));
    const text = encodeBase58(slice);
    if (!text) return null;
    accounts.push(text);
  }
  const feePayer = accounts[0];
  const others = accounts.slice(0, required).filter((key) => key !== feePayer);
  return {
    feePayer,
    authority: others.length === 1 ? others[0] : null,
    accounts,
  };
}

/** SHA-256 of the Solana compiled message (bytes after the signature block). */
export function solanaMessageHash(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 65) return null;
  const count = readShortvec(buf, 0);
  if (!count || count.len < 1 || count.len > 8) return null;
  const start = count.next + (count.len * 64);
  if (start <= 0 || start >= buf.length) return null;
  return crypto.createHash('sha256').update(buf.subarray(start)).digest('hex');
}

function solanaNetwork(network) {
  const name = canonicalNetwork(network);
  return name === 'solana' || name === 'solana-devnet' || String(network || '').toLowerCase().includes('solana');
}

function nowMs(deps, cfg) {
  if (typeof deps?.now === 'function') return deps.now();
  if (typeof cfg?.now === 'function') return cfg.now();
  return Date.now();
}

function principalOf(req, payer) {
  const apiKey = req?.headers?.['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32);
  }
  if (payer) return `payer:${String(payer).toLowerCase()}`;
  return 'anon';
}

function digestOf(req, saltRef = null) {
  if (!req || typeof req !== 'object') return { digest: null, saltRef: saltRef || null };
  if (!req.method || !req.path || (req.body == null && req.rawBody == null)) {
    return { digest: null, saltRef: saltRef || null };
  }
  try {
    if (saltRef && !saltReceiptId(req)) bindSaltReceipt(req, saltRef);
    if (saltRef && !requestSalt(req)) return { digest: null, saltRef };
    const digest = requestDigest(req);
    return { digest, saltRef: saltReceiptId(req) || saltRef };
  } catch {
    return { digest: null, saltRef: saltRef || null };
  }
}

function samePrincipal(req, row) {
  const stored = row?.principal;
  if (!stored || stored === 'anon' || String(stored).startsWith('payer:')) return true;
  const apiKey = req?.headers?.['x-api-key'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) return false;
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32) === stored;
}

/**
 * One decision for "too late". On-chain times are seconds. `now` is store-clock ms.
 * @returns {'issue'|'mismatch_hold'|'expired_unresolved'|'not_settled'|'unknown'}
 */
export function decideLateExpiry({
  record,
  chain = null,
  now,
  nonceUnused = null,
  horizonMs = LATE_HORIZON_MS,
  skewMs = LATE_SKEW_MS,
}) {
  const submitted = Number(record?.submitted_at);
  if (!Number.isFinite(submitted)) return 'unknown';
  const pastHorizon = now > submitted + horizonMs;
  const matched = !!(chain && chain.ok === true && chain.finalized === true);
  if (!matched) {
    if (pastHorizon) return 'expired_unresolved';
    if (record.solana) {
      if (chain?.blockhashExpired === true) return 'not_settled';
      return 'unknown';
    }
    const validBefore = Number(record.auth?.validBefore);
    const nowSec = Math.floor(now / 1000);
    if (Number.isFinite(validBefore) && validBefore > 0 && nowSec >= validBefore) {
      if (nonceUnused === true) return 'not_settled';
      return 'unknown';
    }
    return 'unknown';
  }
  if (pastHorizon) return 'expired_unresolved';
  const ts = Number(chain.blockTimestamp);
  if (!Number.isFinite(ts)) return 'unknown';
  const earliest = Math.floor((submitted - skewMs) / 1000);
  if (ts < earliest) return 'mismatch_hold';
  const issuedSec = Math.floor(Number(record.challenge_issued_at) / 1000);
  if (record.solana) {
    const end = Math.floor((submitted + SOLANA_LATE_WINDOW_MS) / 1000);
    if (Number.isFinite(issuedSec) && (ts < issuedSec || ts > end)) return 'mismatch_hold';
    return 'issue';
  }
  const validAfter = Number(record.auth?.validAfter ?? 0);
  const validBefore = Number(record.auth?.validBefore);
  if (!Number.isFinite(validBefore)) return 'unknown';
  if (!(validAfter < ts && ts < validBefore)) return 'mismatch_hold';
  if (Number.isFinite(issuedSec) && ts < issuedSec) return 'mismatch_hold';
  return 'issue';
}

function facilitatorIdOf(cfg) {
  return (cfg?.facilitatorProvider || 'zan').toLowerCase() === 'x402' ? 'x402' : 'zan';
}

/**
 * Durable row, captured once. No raw header, body, or salt.
 * @returns {{ ok: true, row: object } | { ok: false, reason: string }}
 */
export function openLateSubmission(store, tuple) {
  if (!store || typeof store.putLate !== 'function') {
    return { ok: false, reason: 'replay_store_unavailable' };
  }
  const pendingId = crypto.randomBytes(16).toString('hex');
  const row = {
    pending_id: pendingId,
    state: 'submitted',
    sent: false,
    inline: false,
    facilitator_id: tuple.facilitatorId,
    submitted_at: tuple.submittedAt,
    nonce: tuple.nonce,
    network: tuple.network,
    asset: tuple.asset,
    payee: tuple.payee,
    challenge_amount: tuple.challengeAmount,
    route_quote: tuple.routeQuote,
    expected_settled_amount: tuple.expectedSettledAmount,
    auth_key: tuple.authKey || null,
    auth: tuple.auth || null,
    message_hash: tuple.messageHash || null,
    payer_authority: tuple.payerAuthority || null,
    memo: tuple.memo ?? null,
    fee_payer: tuple.feePayer || null,
    solana: tuple.solana === true,
    request_digest: tuple.requestDigest || null,
    salt_ref: tuple.saltRef || null,
    principal: tuple.principal || 'anon',
    idempotency_key: tuple.idempotencyKey || null,
    task_id: tuple.taskId || null,
    route: tuple.route || null,
    challenge_issued_at: tuple.challengeIssuedAt,
    book_ref: crypto.randomBytes(16).toString('hex'),
    tx_hint: null,
    tx_ref: null,
    jws: null,
    receipt_id: null,
    served: false,
    why: null,
    lease_owner: null,
    lease_seq: 0,
    lease_until: 0,
    confirmed_at: null,
    log_appended: false,
  };
  try {
    const put = store.putLate(row);
    if (!put?.ok) return { ok: false, reason: put?.reason || 'payment_replayed' };
    return { ok: true, row: put.row };
  } catch (err) {
    logger.warn({ err: err.message }, 'late-issue store write failed');
    return { ok: false, reason: 'replay_store_unavailable' };
  }
}

export function noteLateInlineIssued(store, id, facts = {}) {
  if (!id || typeof store?.casLate !== 'function') return null;
  return store.casLate(id, ['submitted', 'unknown', 'confirmed'], 'issued', {
    inline: true,
    sent: true,
    tx_ref: facts.txRef || null,
    why: 'inline',
    served: true,
  });
}

function ownerNote(row) {
  if (row.state === 'issued' && row.inline !== true && row.served !== true) {
    return 'payment confirmed late; not served.';
  }
  if (row.state === 'ineligible_alert') return 'ineligible landing; no auto-issue';
  if (row.why === 'refund_conflict') return 'refund_conflict';
  return row.why || row.state;
}

/** One owner-view list. Wallets are truncated. No raw header or salt. */
export function listLateIssueOwnerView(store) {
  if (!store || typeof store.listLate !== 'function') return [];
  return store.listLate().map((row) => ({
    pending_id: row.pending_id,
    state: row.state,
    why: row.why || null,
    task_id: row.task_id || null,
    network: row.network || null,
    submitted_at: row.submitted_at || null,
    receipt_id: row.receipt_id || null,
    served: row.served === true,
    note: ownerNote(row),
    payer: truncateWallet(row.auth?.from || row.payer_authority || ''),
    payee: truncateWallet(row.payee || ''),
  }));
}

export function noteIneligibleLanding(store, row = {}) {
  if (!store || typeof store.putLate !== 'function') return { ok: false, reason: 'replay_store_unavailable' };
  return store.putLate({
    pending_id: crypto.randomBytes(16).toString('hex'),
    state: 'ineligible_alert',
    sent: false,
    inline: false,
    why: row.why || 'pre_settle',
    nonce: row.nonce || null,
    network: row.network || null,
    submitted_at: typeof row.submittedAt === 'number' ? row.submittedAt : Date.now(),
    task_id: row.taskId || null,
    principal: row.principal || 'anon',
    served: false,
    jws: null,
  });
}

/** confirmed → refund_owed, or a refusal when the row is already issuing or issued. */
export function casLateRefund(store, query = {}) {
  const row = store.findLate?.(query);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.state === 'issuing' || row.state === 'issued') {
    return { ok: false, reason: 'refund_conflict' };
  }
  if (row.state !== 'confirmed') return { ok: false, reason: 'refund_conflict' };
  const next = store.casLate(row.pending_id, 'confirmed', 'refund_owed', { why: 'refund_owed' });
  if (!next) return { ok: false, reason: 'refund_conflict' };
  return { ok: true, row: next };
}

function rebind(record, chain) {
  if (!chain || chain.ok !== true) return chain?.pending ? 'unknown' : 'mismatch_hold';
  if (chain.finalized !== true) return 'unknown';
  if (chain.network && !sameNetwork(chain.network, record.network)) return 'mismatch_hold';
  const net = canonicalNetwork(chain.network || record.network);
  if (net === 'base-sepolia' || net === 'solana-devnet') return 'mismatch_hold';
  if (!chain.asset || !record.asset) return 'unknown';
  const want = String(record.asset);
  const got = String(chain.asset);
  if (want.startsWith('0x') || got.startsWith('0x')) {
    if (!(want.startsWith('0x') && got.startsWith('0x') && want.length === 42 && got.length === 42)) {
      return 'mismatch_hold';
    }
    if (want.toLowerCase() !== got.toLowerCase()) return 'mismatch_hold';
  } else if (want !== got) {
    return 'mismatch_hold';
  }
  if (!chain.payTo || !record.payee) return 'unknown';
  if (!samePayee(chain.payTo, record.payee, { solana: record.solana })) return 'mismatch_hold';
  if (chain.transferCount == null) return 'unknown';
  if (Number(chain.transferCount) !== 1) return 'mismatch_hold';
  let amount;
  let quote;
  try {
    amount = BigInt(String(chain.amount));
    quote = BigInt(String(record.route_quote));
  } catch {
    return 'unknown';
  }
  if (record.solana) {
    let pinned;
    try { pinned = BigInt(String(record.challenge_amount)); } catch { return 'unknown'; }
    if (amount < pinned || amount < quote) return 'mismatch_hold';
    if (!record.payer_authority || chain.payer !== record.payer_authority) return 'mismatch_hold';
    if (!record.fee_payer || chain.feePayer !== record.fee_payer) return 'mismatch_hold';
    if (chain.feePayer === chain.payer) return 'mismatch_hold';
    if (record.message_hash && chain.messageHash && chain.messageHash !== record.message_hash) {
      return 'mismatch_hold';
    }
    if (record.message_hash && !chain.messageHash) return 'unknown';
    return 'confirmed';
  }
  let authValue;
  try { authValue = BigInt(String(record.auth?.value)); } catch { return 'unknown'; }
  if (amount !== authValue || amount < quote) return 'mismatch_hold';
  const from = record.auth?.from;
  if (!from || !chain.payer || !chain.authorizer) return 'unknown';
  if (!samePayee(chain.payer, from, { solana: false })) return 'mismatch_hold';
  if (!samePayee(chain.authorizer, from, { solana: false })) return 'mismatch_hold';
  return 'confirmed';
}

function ledgerRef(record, chain) {
  const stored = record.tx_ref;
  if (typeof stored === 'string' && stored.includes(':')) return stored;
  const raw = stored || chain?.tx || chain?.transaction || record.tx_hint;
  if (!raw) return null;
  const norm = normalizePaymentRef(record.network, raw);
  return norm.ok ? norm.key : null;
}

function chainChallenge(record) {
  return {
    network: record.network,
    asset: record.asset,
    amount: record.challenge_amount,
    payTo: record.payee,
    memo: record.memo,
    extra: { feePayer: record.fee_payer },
    nonce: record.nonce,
  };
}

function pendingChain(out) {
  return {
    ok: false,
    pending: true,
    code: 'settle_unconfirmed',
    nonceUnused: out?.nonceUnused === true,
    blockhashExpired: out?.blockhashExpired === true,
  };
}

function sameChainIdentity(a, b) {
  if (!a?.ok || !b?.ok || a.finalized !== true || b.finalized !== true) return false;
  if (String(a.amount) !== String(b.amount)) return false;
  if (String(a.payer) !== String(b.payer)) return false;
  if (String(a.payTo) !== String(b.payTo)) return false;
  if (Number(a.blockTimestamp) !== Number(b.blockTimestamp)) return false;
  const txA = a.tx || a.transaction || '';
  const txB = b.tx || b.transaction || '';
  if (txA && txB && txA !== txB) return false;
  if (a.asset && b.asset) {
    const left = String(a.asset);
    const right = String(b.asset);
    const equal = left.startsWith('0x') && right.startsWith('0x')
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
    if (!equal) return false;
  }
  return true;
}

async function proveFinality(record, out, deps) {
  if (!out?.ok) return pendingChain(out);
  if (out.finalized === false) return { ...out, pending: true };
  if (out.finalized === true && Number.isFinite(Number(out.blockTimestamp))) return out;
  if (record.solana) {
    const ts = Number(out.blockTimestamp ?? out.blockTime);
    if (out.finalized === true || out.confirmationStatus === 'finalized') {
      return Number.isFinite(ts) ? { ...out, finalized: true, blockTimestamp: ts } : pendingChain(out);
    }
    return pendingChain(out);
  }
  const cfg = deps.cfg || {};
  const url = cfg.baseRpcUrl || cfg.rpcUrl || null;
  if (!url || out.blockNumber == null) return pendingChain(out);
  try {
    const fin = await evmFinality(url, out.blockNumber);
    const url2 = cfg.baseRpcUrl2 || cfg.rpcUrl2 || null;
    if (url2) {
      const other = await evmFinality(url2, out.blockNumber);
      if (!fin.finalized || !other.finalized || fin.blockTimestamp !== other.blockTimestamp) {
        return pendingChain(out);
      }
    }
    if (!fin.finalized || !Number.isFinite(fin.blockTimestamp)) return pendingChain(out);
    return {
      ...out,
      finalized: true,
      blockTimestamp: fin.blockTimestamp,
      network: out.network || record.network,
      tx: out.tx || out.transaction || record.tx_hint,
    };
  } catch (err) {
    logger.warn({ err: err.message, payer: truncateWallet(record.auth?.from || record.payer_authority) }, 'late-issue finality read failed');
    return pendingChain(out);
  }
}

async function readSettlement(record, deps, reader) {
  const cfg = { ...(deps.cfg || {}) };
  if (reader) cfg.chainReader = reader;
  try {
    return await confirmSettlement({
      challenge: chainChallenge(record),
      facilitator: {
        transaction: record.tx_hint,
        txRef: record.tx_hint,
        payer: record.auth?.from || record.payer_authority || null,
        network: record.network,
        success: true,
        settled: true,
      },
      paymentHeader: null,
      authorization: record.auth,
      expectedPayTo: record.payee,
      cfg,
      chainReader: reader || cfg.chainReader || deps.chainReader || null,
    });
  } catch (err) {
    logger.warn({ err: err.message, payer: truncateWallet(record.auth?.from || record.payer_authority) }, 'late-issue chain read failed');
    return pendingChain(null);
  }
}

async function readChain(record, deps) {
  const cfg = deps.cfg || {};
  const primary = deps.chainReader || cfg.chainReader || null;
  const secondary = deps.chainReader2 || cfg.chainReader2 || null;
  const first = await proveFinality(record, await readSettlement(record, deps, primary), deps);
  if (!secondary) return first;
  const second = await proveFinality(record, await readSettlement(record, deps, secondary), deps);
  if (!sameChainIdentity(first, second)) return pendingChain(null);
  return first;
}

function refundBlocked(record, deps) {
  if (record.state === 'refund_owed' || record.why === 'refund_conflict') return true;
  if (typeof deps.hasRefund === 'function') {
    try {
      if (deps.hasRefund(record) === true) return true;
    } catch (err) {
      logger.warn({ err: err.message }, 'late-issue refund lookup failed');
      return true;
    }
  }
  return false;
}

async function appendLeaf(record, digest, deps) {
  if (record.log_appended === true) return true;
  if (typeof deps.appendLog === 'function') {
    await deps.appendLog(record, digest);
    return true;
  }
  try {
    const { getReceiptMerkleTree } = await import('./receipt-merkle.js');
    const inclusion = getReceiptMerkleTree().appendReceipt(record.receipt_id, digest, { publish: false });
    return inclusion != null;
  } catch (err) {
    logger.warn({ err: err.message }, 'late-issue log append failed');
    return false;
  }
}

async function defaultSigner(claims) {
  const payloadUtf8 = jcsRfc8785(claims);
  const signed = signJws(claims, { payloadUtf8 });
  return signed.jws;
}

function withSigner(deps) {
  if (typeof deps.signer === 'function') return deps;
  return { ...deps, signer: defaultSigner };
}

/** Salt for one late receipt. Derived from the pending id so a retry signs the same bytes. */
export function lateClaimSalt(record) {
  return crypto.createHash('sha256').update(`late-salt:${record?.book_ref || ''}:${record?.pending_id || ''}`).digest();
}

function claimsFor(record, chain, outputBytes, issuedAt) {
  const network = canonicalNetwork(record.network);
  const chainName = network === 'solana' || network === 'solana-devnet' ? 'solana' : 'base';
  const tx = chain.tx || chain.transaction || record.tx_hint;
  const ref = `${chainName}:${tx}`;
  const digest = record.request_digest
    || crypto.createHash('sha256').update('').digest('hex');
  const view = {
    payment: {
      ref,
      asset: 'USDC',
      payee: chain.payTo || record.payee,
      quoted_amount: String(record.route_quote),
      bound_settled: String(chain.amount),
    },
    caller_binding: { payer_wallet: chain.payer },
    route: record.route || { provider: null, model: null },
    meta: { payTo: chain.payTo || record.payee },
    seq: null,
  };
  return buildV11SignedClaims(view, {
    kid: 'late-issue',
    salt: lateClaimSalt(record),
    outputBytes: outputBytes || Buffer.alloc(0),
    receiptId: record.receipt_id,
    requestDigest: digest,
    issuedAt,
    agentId: record.principal || 'late',
    bookRef: record.book_ref,
  });
}

async function publishIssued(store, record, chain, deps, outputBytes) {
  const id = record.pending_id;
  const fresh = store.getLate(id) || record;
  if (fresh.jws && fresh.log_appended === true && fresh.state === 'issued') {
    return { jws: fresh.jws, signed: false, served: fresh.served === true };
  }
  if (fresh.jws) {
    const txRef = ledgerRef(fresh, chain);
    if (txRef && typeof store.appendLateLedger === 'function') {
      store.appendLateLedger({
        auth_key: fresh.auth_key || null,
        tx_ref: txRef,
        pending_id: id,
        receipt_id: fresh.receipt_id,
        amount: String(chain?.amount || ''),
        payer: chain?.payer || null,
      });
    }
    const logged = await appendLeaf(fresh, crypto.createHash('sha256').update(fresh.jws).digest('hex'), deps);
    if (!logged) return { pending: true, pendingId: id };
    if (deps.crashAfterSign === true && fresh.state === 'issuing') {
      store.casLate(id, 'issuing', 'issuing', { log_appended: true });
      const err = new Error('late-issue crash after sign');
      err.code = 'injected_crash';
      throw err;
    }
    store.casLate(id, ['issuing', 'confirmed'], 'issued', { log_appended: true, served: fresh.served === true });
    if (typeof store.markSpent === 'function' && fresh.nonce) {
      store.markSpent(fresh.nonce, {
        txRef: txRef || fresh.tx_ref,
        amount: chain?.amount || null,
        payer: chain?.payer || null,
        payTo: chain?.payTo || fresh.payee,
        late: true,
      });
    }
    if (fresh.auth_key && typeof store.markAuthSpent === 'function') {
      store.markAuthSpent(fresh.auth_key, txRef || fresh.tx_ref);
    }
    if (txRef && typeof store.markTxSpent === 'function') {
      store.markTxSpent(txRef, {
        amount: chain?.amount != null ? String(chain.amount) : null,
        payer: chain?.payer || null,
        payTo: chain?.payTo || fresh.payee,
      });
    }
    return { jws: fresh.jws, signed: false, served: fresh.served === true };
  }

  const now = nowMs(deps, deps.cfg);
  const issuedAt = minuteIssuedAt(new Date(now));
  const receiptId = fresh.receipt_id || `late-${id}`;
  store.casLate(id, 'issuing', 'issuing', { receipt_id: receiptId });
  const current = store.getLate(id);
  let jws;
  try {
    const claims = claimsFor(current, chain, outputBytes, issuedAt);
    if (typeof deps.signer !== 'function') {
      const err = new Error('late-issue signer missing');
      err.code = 'signer_unavailable';
      throw err;
    }
    jws = await deps.signer(claims);
    if (typeof jws !== 'string' || jws.length === 0) throw new Error('empty signature');
  } catch (err) {
    if (err.code === 'injected_crash') throw err;
    logger.warn({ err: err.message, payer: truncateWallet(current.auth?.from || current.payer_authority) }, 'late-issue signer failed');
    store.casLate(id, 'issuing', 'confirmed', { lease_owner: null, lease_until: 0, jws: null });
    return { pending: true, pendingId: id, signerFailed: true };
  }
  const persisted = store.casLate(id, 'issuing', 'issuing', {
    jws,
    receipt_id: receiptId,
    request_digest: current.request_digest || crypto.createHash('sha256').update('').digest('hex'),
    served: outputBytes && outputBytes.length > 0,
  });
  if (!persisted?.jws) return { pending: true, pendingId: id };
  if (deps.crashBeforeLedger === true) {
    const err = new Error('late-issue crash before ledger');
    err.code = 'injected_crash';
    throw err;
  }
  return publishIssued(store, store.getLate(id), chain, deps, outputBytes);
}

async function waitForJws(store, id) {
  for (let i = 0; i < 40; i += 1) {
    const cur = store.getLate(id);
    if (cur?.jws) return cur.jws;
    if (cur?.state === 'issued' && cur.jws) return cur.jws;
    await new Promise((resolve) => { setTimeout(resolve, 15); });
  }
  return null;
}

/**
 * Resolve one row. A loser of the issue CAS never signs.
 * @returns {Promise<object>}
 */
export async function resolveLateRecord(store, record, deps = {}) {
  if (!record) return { pending: false };
  const id = record.pending_id;
  const cfg = deps.cfg || {};
  const now = nowMs(deps, cfg);
  let row = store.getLate(id) || record;
  if (TERMINAL.has(row.state)) {
    return { jws: row.jws || null, state: row.state, pendingId: id, served: row.served === true };
  }
  if (row.state === 'submitted') {
    const age = now - Number(row.submitted_at || 0);
    if (row.sent === true || age > 5000) {
      store.casLate(id, 'submitted', 'unknown', { why: row.why || 'unresolved_submit' });
      row = store.getLate(id);
    } else {
      return { pending: true, pendingId: id, state: 'submitted' };
    }
  }
  if (row.state === 'issuing') {
    const leaseHeld = row.lease_until > now && row.lease_owner && row.lease_owner !== (deps.owner || `p${process.pid}`);
    if (leaseHeld && !row.jws) {
      const jws = await waitForJws(store, id);
      return jws
        ? { jws, signed: false, pendingId: id }
        : { pending: true, pendingId: id, state: 'issuing' };
    }
    if (row.jws) {
      return publishIssued(store, row, {
        amount: row.expected_settled_amount,
        payer: row.auth?.from || row.payer_authority,
        payTo: row.payee,
        tx: row.tx_hint,
      }, deps, null);
    }
  }

  const enabled = lateIssueEnabled(cfg);
  const shadow = lateIssueShadow(cfg);
  if (row.state === 'unknown' || row.state === 'confirmed') {
    const chain = await readChain(row, deps);
    if (chain?.tx && !row.tx_hint) {
      store.casLate(id, [row.state], row.state, { tx_hint: chain.tx });
      row = store.getLate(id);
    }
    const bound = rebind(row, chain);
    const expiry = decideLateExpiry({
      record: row,
      chain: bound === 'unknown' ? { ...chain, ok: false, finalized: false } : chain,
      now,
      nonceUnused: chain?.nonceUnused ?? null,
      horizonMs: deps.horizonMs ?? cfg.lateHorizonMs ?? LATE_HORIZON_MS,
    });
    let next = expiry;
    if (bound === 'mismatch_hold') next = 'mismatch_hold';
    else if (bound === 'unknown' && expiry === 'issue') next = 'unknown';
    else if (bound === 'confirmed' && expiry === 'issue') next = 'confirmed';
    if (shadow) {
      logger.warn({
        pending_id: id,
        decision: next,
        payer: truncateWallet(row.auth?.from || row.payer_authority),
      }, 'late-issue shadow');
    }
    if (next === 'mismatch_hold' || next === 'expired_unresolved' || next === 'not_settled') {
      store.casLate(id, ['unknown', 'confirmed', 'submitted'], next, { why: next });
      return { state: next, pendingId: id, ownerOnly: true };
    }
    if (next !== 'confirmed') {
      return { pending: true, pendingId: id, state: 'unknown' };
    }
    if (row.state !== 'confirmed') {
      store.casLate(id, 'unknown', 'confirmed', {
        why: 'confirmed',
        confirmed_at: now,
        tx_hint: chain.tx || chain.transaction || row.tx_hint || null,
      });
      row = store.getLate(id);
    }
    if (!enabled || shadow) {
      return { pending: true, pendingId: id, state: 'confirmed' };
    }
    if (refundBlocked(row, deps)) {
      store.casLate(id, 'confirmed', 'confirmed', { why: 'refund_conflict' });
      return { state: 'confirmed', pendingId: id, ownerOnly: true, code: 'refund_conflict' };
    }
    const confirmedAt = Number(row.confirmed_at || now);
    const redeemWindow = deps.redeemWindowMs ?? LATE_REDEEM_MS;
    const digest = deps.requestDigest || null;
    const outputBytes = Buffer.isBuffer(deps.outputBytes) ? deps.outputBytes : null;
    const digestOk = row.request_digest && digest && digest === row.request_digest;
    if (digest && row.request_digest && digest !== row.request_digest) {
      return { code: 'idempotency_conflict', pendingId: id };
    }
    const within = now <= confirmedAt + redeemWindow;
    if (within && !(digestOk && outputBytes) && !deps.forcePaymentOnly) {
      return { pending: true, pendingId: id, state: 'confirmed', redeemOpen: true };
    }
    const servedBytes = digestOk && outputBytes ? outputBytes : Buffer.alloc(0);
    const signing = withSigner(deps);
    const owner = deps.owner || `p${process.pid}`;
    const won = store.casLate(id, 'confirmed', 'issuing', {
      lease_owner: owner,
      lease_seq: Number(row.lease_seq || 0) + 1,
      lease_until: now + 60_000,
      served: servedBytes.length > 0,
    });
    if (!won) {
      const jws = await waitForJws(store, id);
      return jws
        ? { jws, signed: false, pendingId: id, served: servedBytes.length > 0 }
        : { pending: true, pendingId: id };
    }
    const tx = chain.tx || chain.transaction || row.tx_hint;
    let txRef = null;
    if (tx) {
      const norm = normalizePaymentRef(row.network, tx);
      if (norm.ok) txRef = norm.key;
    }
    store.casLate(id, 'issuing', 'issuing', { tx_ref: txRef, tx_hint: tx || row.tx_hint });
    return publishIssued(store, store.getLate(id), { ...chain, tx }, signing, servedBytes);
  }
  return { pending: true, pendingId: id, state: row.state };
}

function lookupLate(store, { nonce, pendingId, idempotencyKey, principal }) {
  if (typeof store.findLate !== 'function') return null;
  if (pendingId) {
    const byId = store.findLate({ pendingId });
    if (byId) return byId;
  }
  if (nonce) {
    const byNonce = store.findLate({ nonce });
    if (byNonce) return byNonce;
  }
  if (idempotencyKey && principal) {
    return store.findLate({ idempotencyKey, principal });
  }
  return null;
}

/**
 * Retry of a submitted payment. Does not call /settle.
 * @returns {Promise<object|null>}
 */
export async function resumeLateIssue({ store, req, cfg, nonce, taskId }) {
  const pendingId = req?.headers?.['x-pending-id'] || null;
  const idempotencyKey = req?.headers?.['idempotency-key'] || null;
  const principal = principalOf(req, null);
  const row = lookupLate(store, { nonce, pendingId, idempotencyKey, principal });
  if (!row) return null;
  const { digest } = digestOf(req, row.salt_ref);
  if (row.state === 'submitted' && row.sent !== true) return null;
  if (row.inline === true && row.state === 'issued') return null;
  if (row.state === 'ineligible_alert') return null;
  if (row.state === 'issued' && row.jws) {
    return {
      kind: 'failed',
      reason: 'settle_pending',
      code: 'settle_pending',
      pendingId: row.pending_id,
      receiptJws: row.jws,
      served: false,
      retryAfter: LATE_RETRY_AFTER_SEC,
    };
  }
  const enabled = lateIssueEnabled(cfg);
  if (!enabled && !lateIssueShadow(cfg)) {
    return {
      kind: 'failed',
      reason: 'settle_unconfirmed',
      code: 'settle_unconfirmed',
      pendingId: row.pending_id,
      preSettle: false,
    };
  }
  const resolved = await resolveLateRecord(store, row, {
    cfg,
    now: cfg?.now,
    signer: cfg?.lateSigner,
    appendLog: cfg?.lateAppendLog,
    hasRefund: cfg?.lateHasRefund,
    chainReader: cfg?.chainReader,
    requestDigest: digest,
    outputBytes: samePrincipal(req, row) ? (cfg?.lateOutputBytes || null) : null,
    owner: `resume:${taskId || 'late'}`,
    horizonMs: cfg?.lateHorizonMs,
    redeemWindowMs: cfg?.lateRedeemWindowMs,
    crashBeforeLedger: cfg?.crashBeforeLedger === true,
    forcePaymentOnly: cfg?.lateForcePaymentOnly === true,
  });
  if (resolved?.code === 'idempotency_conflict') {
    return {
      kind: 'failed',
      reason: 'idempotency_conflict',
      code: 'idempotency_conflict',
      pendingId: row.pending_id,
    };
  }
  if (resolved?.jws && resolved.served === true) {
    return {
      kind: 'settled',
      confirmed: true,
      lateRedeem: true,
      receiptJws: resolved.jws,
      pendingId: row.pending_id,
      taskId: row.task_id || taskId || null,
    };
  }
  if (resolved?.jws) {
    return {
      kind: 'failed',
      reason: 'settle_pending',
      code: 'settle_pending',
      pendingId: row.pending_id,
      retryAfter: LATE_RETRY_AFTER_SEC,
      receiptJws: resolved.jws,
      served: false,
    };
  }
  if (resolved?.ownerOnly) {
    return {
      kind: 'failed',
      reason: 'settle_unconfirmed',
      code: 'settle_unconfirmed',
      pendingId: row.pending_id,
    };
  }
  return {
    kind: 'failed',
    reason: 'settle_pending',
    code: 'settle_pending',
    pendingId: row.pending_id,
    retryAfter: LATE_RETRY_AFTER_SEC,
  };
}

export async function tickLateIssue(store, deps = {}) {
  if (!store || typeof store.listLate !== 'function') return [];
  const cfg = deps.cfg || {};
  if (!lateIssueEnabled(cfg) && !lateIssueShadow(cfg)) return [];
  const out = [];
  for (const row of store.listLate()) {
    if (TERMINAL.has(row.state)) continue;
    out.push(await resolveLateRecord(store, row, deps));
  }
  return out;
}

let timer = null;

export function startLateIssueResolver(store, deps = {}) {
  if (timer) return;
  const interval = deps.intervalMs || 60_000;
  timer = setInterval(() => {
    tickLateIssue(store, deps).catch((err) => {
      logger.warn({ err: err.message }, 'late-issue tick failed');
    });
  }, interval);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Test hook. Production boot keeps the interval. */
export function stopLateIssueResolver() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function lateTupleFrom({
  req,
  cfg,
  challenge,
  decoded,
  auth,
  authKey,
  routeQuote,
  expectedSettledAmount,
  taskId,
  resource,
  submittedAt,
  solana,
  messageHash,
  payerAuthority,
  feePayer,
}) {
  const svm = typeof decoded?.payload?.transaction === 'string'
    ? decoded.payload.transaction
    : (typeof decoded?.transaction === 'string' ? decoded.transaction : null);
  const accounts = solana && svm ? solanaMessageAccounts(svm) : null;
  const { digest, saltRef } = digestOf(req);
  const issuedAt = Number(challenge?.issuedAt || challenge?.createdAt || submittedAt);
  return {
    facilitatorId: facilitatorIdOf(cfg),
    submittedAt,
    nonce: challenge?.nonce,
    network: challenge?.network,
    asset: challenge?.asset,
    payee: challenge?.payTo,
    challengeAmount: String(challenge?.amount),
    routeQuote: String(routeQuote),
    expectedSettledAmount: expectedSettledAmount != null ? String(expectedSettledAmount) : null,
    authKey: authKey || null,
    auth: auth ? {
      from: auth.from || null,
      to: auth.to || null,
      value: auth.value != null ? String(auth.value) : null,
      nonce: auth.nonce || null,
      validAfter: auth.validAfter != null ? String(auth.validAfter) : (decoded?.payload?.authorization?.validAfter != null ? String(decoded.payload.authorization.validAfter) : '0'),
      validBefore: auth.validBefore != null ? String(auth.validBefore) : (decoded?.payload?.authorization?.validBefore != null ? String(decoded.payload.authorization.validBefore) : null),
    } : null,
    messageHash: messageHash || (svm ? solanaMessageHash(svm) : null),
    payerAuthority: payerAuthority || accounts?.authority || null,
    memo: challenge?.memo ?? null,
    feePayer: feePayer || accounts?.feePayer || null,
    solana: solana === true,
    requestDigest: digest,
    saltRef,
    principal: principalOf(req, auth?.from || payerAuthority),
    idempotencyKey: req?.headers?.['idempotency-key'] || null,
    taskId,
    route: {
      provider: challenge?.route?.provider ?? null,
      model: challenge?.route?.model ?? null,
      path: resource || challenge?.resource || null,
    },
    challengeIssuedAt: Number.isFinite(issuedAt) ? issuedAt : submittedAt,
  };
}
