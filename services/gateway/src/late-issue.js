/**
 * Late-issue receipts. EVM only. Solana is unsupported: a Solana settle
 * stays on the main path and this module does not open or sign a row.
 *
 * A Base settle whose request left the process keeps one row in the replay
 * store (the durable challenge store). States run
 * submitted → unknown → confirmed → issuing → issued.
 * The row is written before /settle and is not released after that.
 * Issuance is off unless X402_LATE_ISSUE is on. The receipt payload is the
 * existing v11 document. This module does not add a signed field.
 * A finalized match is signed once. There is no redeem window.
 */
import crypto from 'node:crypto';
import logger from './logger.js';
import { confirmSettlement, evmFinality, findAuthorizationTx, readEvmReceipt } from './x402-chain.js';
import { samePayee, truncateWallet } from './x402-flags.js';
import { canonicalNetwork, normalizePaymentRef, sameNetwork } from './payment-ref.js';
import { buildV11SignedClaims, minuteIssuedAt } from './v11-seal.js';
import { jcsRfc8785 } from './offer-receipt.js';
import { getIssuerKid, signJws } from './issuer-key.js';
import { bindSaltReceipt, requestDigest, requestSalt, saltReceiptId } from './request-binding.js';
import { buildVerifyUrl } from './receipt.js';
import { getActiveChallengeStore } from './x402-durable-store.js';

export const LATE_HORIZON_MS = 24 * 60 * 60 * 1000;
export const LATE_SKEW_MS = 120_000;
export const LATE_RETRY_AFTER_SEC = 5;

const TERMINAL = new Set([
  'issued',
  'mismatch_hold',
  'expired_unresolved',
  'not_settled',
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
    issue_block: tuple.issueBlock != null ? tuple.issueBlock : null,
    request_digest: tuple.requestDigest || null,
    payment_hash: tuple.paymentHash || null,
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
    receipt_id: `late-${pendingId}`,
    public_receipt: null,
    ledger_recorded: false,
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
    payer: truncateWallet(row.auth?.from || ''),
    payee: truncateWallet(row.payee || ''),
  }));
}

function rebind(record, chain) {
  if (!chain || chain.ok !== true) return chain?.pending ? 'unknown' : 'mismatch_hold';
  if (chain.finalized !== true) return 'unknown';
  if (chain.network && !sameNetwork(chain.network, record.network)) return 'mismatch_hold';
  const net = canonicalNetwork(chain.network || record.network);
  if (net === 'base-sepolia') return 'mismatch_hold';
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
  if (!samePayee(chain.payTo, record.payee, { solana: false })) return 'mismatch_hold';
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
  if (!out?.ok) {
    if (out && out.pending !== true && out.ok === false) return { ...out, pending: false };
    return pendingChain(out);
  }
  if (out.finalized === false) return { ...out, pending: true };
  if (out.finalized === true && Number.isFinite(Number(out.blockTimestamp))) return out;
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
    logger.warn({ err: err.message, payer: truncateWallet(record.auth?.from) }, 'late-issue finality read failed');
    return pendingChain(out);
  }
}

async function readSettlement(record, deps, reader) {
  const cfg = { ...(deps.cfg || {}) };
  if (process.env.NODE_ENV !== 'test') {
    delete cfg.chainReader;
    delete cfg.chainReader2;
    delete cfg.lateSigner;
    delete cfg.lateAppendLog;
    delete cfg.crashBeforeLedger;
    delete cfg.lateForcePaymentOnly;
    delete cfg.lateOutputBytes;
  }
  if (reader) cfg.chainReader = reader;
  try {
    return await confirmSettlement({
      challenge: chainChallenge(record),
      facilitator: {
        transaction: record.tx_hint,
        txRef: record.tx_hint,
        payer: record.auth?.from || null,
        network: record.network,
        success: true,
        settled: true,
      },
      paymentHeader: null,
      authorization: record.auth,
      expectedPayTo: record.payee,
      cfg,
      chainReader: reader || (process.env.NODE_ENV === 'test' ? cfg.chainReader : null) || null,
    });
  } catch (err) {
    logger.warn({ err: err.message, payer: truncateWallet(record.auth?.from) }, 'late-issue chain read failed');
    return pendingChain(null);
  }
}

/** Test-only cfg hooks. Production reads RPC from cfg and never these fields. */
function testHooks(cfg) {
  if (process.env.NODE_ENV !== 'test' || !cfg || typeof cfg !== 'object') return {};
  const out = {};
  if (typeof cfg.lateSigner === 'function') out.signer = cfg.lateSigner;
  if (typeof cfg.lateAppendLog === 'function') out.appendLog = cfg.lateAppendLog;
  if (cfg.crashBeforeLedger === true) out.crashBeforeLedger = true;
  if (typeof cfg.chainReader === 'function') out.chainReader = cfg.chainReader;
  if (typeof cfg.chainReader2 === 'function') out.chainReader2 = cfg.chainReader2;
  return out;
}

function readerOf(deps) {
  if (typeof deps.chainReader === 'function') return deps.chainReader;
  if (process.env.NODE_ENV === 'test' && typeof deps.cfg?.chainReader === 'function') return deps.cfg.chainReader;
  return null;
}

function paymentHeaderHash(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  return crypto.createHash('sha256').update(header, 'utf8').digest('hex');
}

function hashesEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length || left.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/** Stable public id for a late row. Assigned when the row is opened. */
export function lateVerifyUrl(cfg, pendingId) {
  if (!pendingId) return null;
  const base = cfg?.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';
  return buildVerifyUrl(base, `late-${pendingId}`);
}

async function discoverHint(record, deps) {
  if (record.tx_hint) return record;
  if (readerOf(deps)) return record;
  const cfg = deps.cfg || {};
  const url = cfg.baseRpcUrl || cfg.rpcUrl || null;
  if (!url) return record;
  const found = await findAuthorizationTx(url, {
    asset: record.asset,
    from: record.auth?.from,
    nonce: record.auth?.nonce,
    issueBlock: record.issue_block,
    validAfter: record.auth?.validAfter,
    issuedAtMs: record.challenge_issued_at,
  });
  if (!found.ok || !found.tx) return record;
  return { ...record, tx_hint: found.tx };
}

async function readChain(record, deps) {
  const hinted = await discoverHint(record, deps);
  if (!hinted.tx_hint && !readerOf(deps)) return pendingChain(null);
  const cfg = deps.cfg || {};
  const primary = readerOf(deps);
  const secondary = typeof deps.chainReader2 === 'function'
    ? deps.chainReader2
    : (process.env.NODE_ENV === 'test' && typeof cfg.chainReader2 === 'function' ? cfg.chainReader2 : null);
  const first = await proveFinality(hinted, await readSettlement(hinted, deps, primary), deps);
  const withTx = first?.tx || first?.transaction || hinted.tx_hint
    ? { ...first, tx: first?.tx || first?.transaction || hinted.tx_hint }
    : first;
  if (!secondary) return withTx;
  const second = await proveFinality(hinted, await readSettlement(hinted, deps, secondary), deps);
  if (!sameChainIdentity(withTx, second)) return pendingChain(null);
  return withTx;
}

/**
 * Re-read the receipt at finality depth before signing.
 * An injected reader is called twice. A block hash, when both reads have one,
 * must match, and a status, when present, must be 1. Without a reader the
 * RPC receipt status and the block hash are read twice.
 */
async function reorgGuard(record, chain, deps) {
  const cfg = deps.cfg || {};
  const reader = readerOf(deps);
  if (reader) {
    let first;
    let second;
    try {
      first = await readSettlement(record, deps, reader);
      second = await readSettlement(record, deps, reader);
    } catch (err) {
      logger.warn({ err: err.message }, 'late-issue reorg read failed');
      return false;
    }
    if (first?.status != null && Number(first.status) !== 1) return false;
    if (second?.status != null && Number(second.status) !== 1) return false;
    if (first?.blockHash && second?.blockHash && String(first.blockHash) !== String(second.blockHash)) {
      return false;
    }
    return true;
  }
  const url = cfg.baseRpcUrl || cfg.rpcUrl || null;
  const tx = chain?.tx || chain?.transaction || record.tx_hint;
  if (!url || !tx) return false;
  try {
    const receipt = await readEvmReceipt(url, tx);
    if (!receipt || receipt.status !== 1 || !receipt.blockHash || receipt.blockNumber == null) return false;
    const fin = await evmFinality(url, receipt.blockNumber);
    if (!fin.finalized || !fin.blockHash) return false;
    if (String(fin.blockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) return false;
    const again = await evmFinality(url, receipt.blockNumber);
    if (!again.finalized || !again.blockHash) return false;
    if (String(again.blockHash).toLowerCase() !== String(fin.blockHash).toLowerCase()) return false;
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'late-issue reorg read failed');
    return false;
  }
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
  const tx = chain.tx || chain.transaction || record.tx_hint;
  const ref = `base:${tx}`;
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
    kid: getIssuerKid(),
    salt: lateClaimSalt(record),
    outputBytes: outputBytes || Buffer.alloc(0),
    receiptId: record.receipt_id,
    requestDigest: digest,
    issuedAt,
    agentId: record.principal || 'late',
    bookRef: record.book_ref,
  });
}

function publicLateReceipt(record, chain, jws) {
  const txRef = ledgerRef(record, chain);
  const receiptId = record.receipt_id || `late-${record.pending_id}`;
  return {
    task_id: receiptId,
    receipt_id: receiptId,
    status: 'paid',
    payment: {
      rail: 'usdc',
      ref: txRef,
      asset: 'USDC',
      payee: chain?.payTo || record.payee,
      gross_amount: String(record.route_quote),
      settled_amount: String(chain?.amount || record.expected_settled_amount || ''),
      network: record.network,
    },
    issuer_signature: { jws },
    note: 'payment confirmed late; not served.',
  };
}

async function writeLateLedger(receipt, deps) {
  if (typeof deps.recordLedger === 'function') {
    await deps.recordLedger(receipt);
    return;
  }
  if (process.env.NODE_ENV === 'test') return;
  const { recordLateIssueReceipt } = await import('./usage-settled.js');
  recordLateIssueReceipt(receipt);
}

async function publishIssued(store, record, chain, deps, outputBytes) {
  const id = record.pending_id;
  const fresh = store.getLate(id) || record;
  if (fresh.jws && fresh.log_appended === true && fresh.state === 'issued' && fresh.ledger_recorded === true) {
    return { jws: fresh.jws, signed: false, served: fresh.served === true };
  }
  if (fresh.jws) {
    const receipt = publicLateReceipt(fresh, chain, fresh.jws);
    store.casLate(id, ['issuing', 'confirmed', 'issued'], fresh.state, {
      public_receipt: receipt,
      receipt_id: receipt.receipt_id,
    });
    if (fresh.ledger_recorded !== true) {
      try {
        await writeLateLedger(receipt, deps);
        store.casLate(id, ['issuing', 'confirmed', 'issued'], fresh.state, { ledger_recorded: true });
      } catch (err) {
        logger.warn({ err: err.message }, 'late-issue ledger write failed');
        return { pending: true, pendingId: id };
      }
    }
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
    logger.warn({ err: err.message, payer: truncateWallet(current.auth?.from) }, 'late-issue signer failed');
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
    const owner = deps.owner || `p${process.pid}`;
    const leaseLive = row.lease_until > now && row.lease_owner && row.lease_owner !== owner;
    if (row.jws) {
      return publishIssued(store, row, {
        amount: row.expected_settled_amount,
        payer: row.auth?.from,
        payTo: row.payee,
        tx: row.tx_hint,
      }, deps, null);
    }
    if (leaseLive) {
      const jws = await waitForJws(store, id);
      return jws
        ? { jws, signed: false, pendingId: id }
        : { pending: true, pendingId: id, state: 'issuing' };
    }
    const recovered = store.casLate(id, 'issuing', 'confirmed', {
      lease_owner: null,
      lease_until: 0,
      jws: null,
    });
    if (!recovered) return { pending: true, pendingId: id, state: 'issuing' };
    row = store.getLate(id);
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
        payer: truncateWallet(row.auth?.from),
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
    const guarded = await reorgGuard(row, chain, deps);
    if (!guarded) {
      store.casLate(id, 'confirmed', 'unknown', { why: 'reorg' });
      return { pending: true, pendingId: id, state: 'unknown' };
    }
    const signing = withSigner(deps);
    const owner = deps.owner || `p${process.pid}`;
    const won = store.casLate(id, 'confirmed', 'issuing', {
      lease_owner: owner,
      lease_seq: Number(row.lease_seq || 0) + 1,
      lease_until: now + 60_000,
      served: false,
    });
    if (!won) {
      const jws = await waitForJws(store, id);
      return jws
        ? { jws, signed: false, pendingId: id, served: false }
        : { pending: true, pendingId: id };
    }
    const tx = chain.tx || chain.transaction || row.tx_hint;
    let txRef = null;
    if (tx) {
      const norm = normalizePaymentRef(row.network, tx);
      if (norm.ok) txRef = norm.key;
    }
    store.casLate(id, 'issuing', 'issuing', { tx_ref: txRef, tx_hint: tx || row.tx_hint });
    return publishIssued(store, store.getLate(id), { ...chain, tx }, signing, Buffer.alloc(0));
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
function settlePending(row, cfg, extra = {}) {
  return {
    kind: 'failed',
    reason: 'settle_pending',
    code: 'settle_pending',
    pendingId: row.pending_id,
    retryAfter: LATE_RETRY_AFTER_SEC,
    verifyUrl: lateVerifyUrl(cfg, row.pending_id),
    served: false,
    ...extra,
  };
}

export async function resumeLateIssue({ store, req, cfg, nonce, taskId, paymentHeader }) {
  const pendingId = req?.headers?.['x-pending-id'] || null;
  const idempotencyKey = req?.headers?.['idempotency-key'] || null;
  const principal = principalOf(req, null);
  const row = lookupLate(store, { nonce, pendingId, idempotencyKey, principal });
  if (!row) return null;
  if (row.state === 'submitted' && row.sent !== true) return null;
  if (row.inline === true && row.state === 'issued') return null;
  // Switch off, including shadow, leaves the retry on main's path.
  if (!lateIssueEnabled(cfg)) return null;
  const header = typeof paymentHeader === 'string' ? paymentHeader : (req?.headers?.['x-payment'] || null);
  const got = paymentHeaderHash(header);
  if (!row.payment_hash || !got || !hashesEqual(row.payment_hash, got)) return null;
  if (row.state === 'issued' && row.jws) {
    return settlePending(row, cfg, { receiptJws: row.jws });
  }
  const hooks = testHooks(cfg);
  const resolved = await resolveLateRecord(store, row, {
    ...hooks,
    cfg,
    now: cfg?.now,
    owner: `resume:${taskId || 'late'}`,
    horizonMs: cfg?.lateHorizonMs,
  });
  if (resolved?.jws) {
    return settlePending(row, cfg, { receiptJws: resolved.jws });
  }
  if (resolved?.ownerOnly) {
    return {
      kind: 'failed',
      reason: 'settle_unconfirmed',
      code: 'settle_unconfirmed',
      pendingId: row.pending_id,
      verifyUrl: lateVerifyUrl(cfg, row.pending_id),
    };
  }
  return settlePending(row, cfg);
}

export async function tickLateIssue(store, deps = {}) {
  if (!store || typeof store.listLate !== 'function') return [];
  if (typeof store.pruneLate === 'function') {
    try { store.pruneLate(nowMs(deps, deps.cfg), LATE_HORIZON_MS); } catch { /* store */ }
  }
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
  paymentHeader,
}) {
  const headerAuth = decoded?.payload?.authorization || decoded?.authorization || null;
  const { digest, saltRef } = digestOf(req);
  const issuedAt = Number(challenge?.issuedAt || challenge?.createdAt || submittedAt);
  const issueBlock = challenge?.issueBlock ?? challenge?.blockNumber ?? null;
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
      validAfter: auth.validAfter != null ? String(auth.validAfter) : (headerAuth?.validAfter != null ? String(headerAuth.validAfter) : '0'),
      validBefore: auth.validBefore != null ? String(auth.validBefore) : (headerAuth?.validBefore != null ? String(headerAuth.validBefore) : null),
    } : null,
    issueBlock,
    requestDigest: digest,
    paymentHash: paymentHeaderHash(paymentHeader),
    saltRef,
    principal: principalOf(req, auth?.from),
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

/** Public late receipt stored on the row. Null until the signature is saved. */
export function findLatePublicReceipt(taskId, store = null) {
  const active = store || getActiveChallengeStore();
  if (!taskId || !active || typeof active.listLate !== 'function') return null;
  const id = String(taskId);
  const row = active.listLate().find((item) => (
    item.receipt_id === id
    || item.public_receipt?.task_id === id
    || `late-${item.pending_id}` === id
  ));
  const receipt = row?.public_receipt;
  if (!receipt?.issuer_signature?.jws) return null;
  return receipt;
}
