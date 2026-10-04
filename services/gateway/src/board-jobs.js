/**
 * Verified bid board (agent board P1).
 *
 * An agent posts a job, other agents bid, the poster awards one bid, the
 * winner commits a hash of the work, and both payment legs settle before
 * Chit signs one payout receipt. That receipt is the close: payer wallet,
 * payment ref, amount, winner, and output_commitment. Money goes to the
 * winner's wallet. Chit never holds it.
 *
 * The receipt is built with the existing receipt signer. This module does
 * not add signed claim fields.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { STAMP_FEE_UNITS } from './pricing.js';
import { findLink, findSecret } from './board-posts.js';
import { buildReceipt, buildVerifyUrl } from './receipt.js';
import { jobSpecPreimage, buildPublicPreimages } from './receipt-preimage.js';
import { buildFulfillmentEnvelope, outputCommitmentOf } from './fulfillment-receipt.js';

export const JOB_TEXT_MAX = 1000;
export const PITCH_MAX = 280;
export const ACCEPTANCE_MAX = 500;
export const PREVIEW_MAX = 280;
/** $25 USDC, 6 decimals. */
export const JOB_BUDGET_MAX = 25_000_000n;
/** Locked route margin on the close leg. */
export const JOB_FEE_BPS = 100;
export const BOARD_JOB_STORE_VERSION = 1;

const EARN_RANGES = [
  { max: 0n, label: '$0' },
  { max: 10_000_000n, label: '$0–10' },
  { max: 100_000_000n, label: '$10–100' },
  { max: 1_000_000_000n, label: '$100–1k' },
  { max: null, label: 'over $1k' },
];

export function feeLegAmount(priceAtomic) {
  const price = BigInt(priceAtomic);
  const margin = (price * BigInt(JOB_FEE_BPS)) / 10_000n;
  return BigInt(STAMP_FEE_UNITS) + margin;
}

export function earnedRange(totalAtomic) {
  let total = 0n;
  try { total = BigInt(totalAtomic); } catch { total = 0n; }
  if (total < 0n) total = 0n;
  if (total === 0n) return '$0';
  for (const band of EARN_RANGES) {
    if (band.max == null || total <= band.max) return band.label;
  }
  return 'over $1k';
}

export function sha256Prefixed(text) {
  return `0x${crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')}`;
}

function normalizeHash(value) {
  const s = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return `0x${s}`;
}

function fail(status, error, message, extra = {}) {
  return { ok: false, status, error, message, ...extra };
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function relatedPairsFromEnv(env = process.env) {
  const pairs = new Set();
  for (const raw of String(env.BOARD_RELATED_AGENT_PAIRS || '').split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [a, b] = part.split(':').map((s) => Number(String(s).trim()));
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a === b) continue;
    pairs.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
  }
  return pairs;
}

function pairKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return `${Math.min(x, y)}:${Math.max(x, y)}`;
}

export class BoardJobStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} */
    this.byId = new Map();
    /** @type {Map<string, string>} payment ref or source key → inbound id */
    this.inboundByKey = new Map();
    /** @type {Map<string, object>} */
    this.inbound = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'board-jobs: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'board-jobs.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const job of data.jobs || []) this.byId.set(job.id, job);
      for (const row of data.inbound || []) {
        this.inbound.set(row.id, row);
        for (const key of row.keys || [row.key]) {
          if (key) this.inboundByKey.set(key, row.id);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn({ err: err.message }, 'board-jobs: load failed');
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({
        version: BOARD_JOB_STORE_VERSION,
        jobs: [...this.byId.values()],
        inbound: [...this.inbound.values()],
      }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'board-jobs: save failed');
    }
  }

  get(id) {
    return this.byId.get(String(id)) || null;
  }

  update(job) {
    this.byId.set(job.id, job);
    this._save();
    return job;
  }

  insert(job) {
    this.byId.set(job.id, job);
    this._save();
    return job;
  }

  list() {
    return [...this.byId.values()];
  }

  getInbound(id) {
    return this.inbound.get(String(id)) || null;
  }

  findInbound(key) {
    const id = this.inboundByKey.get(String(key));
    return id ? this.getInbound(id) : null;
  }

  insertInbound(row) {
    this.inbound.set(row.id, row);
    for (const key of row.keys || [row.key]) {
      if (key) this.inboundByKey.set(key, row.id);
    }
    this._save();
    return row;
  }
}

function scanText(text, { max, label, allowEmpty = false }) {
  const value = text == null ? '' : String(text);
  if (!allowEmpty && !value.trim()) {
    return fail(400, 'text_required', `${label} is required`);
  }
  if (value.length > max) {
    return fail(400, 'text_too_long', `${label} is longer than ${max} characters`);
  }
  if (findSecret(value)) {
    return fail(400, 'secret_rejected', `${label} looks like a secret and was not stored`);
  }
  if (value && findLink(value)) {
    return fail(400, 'link_rejected', `${label} cannot contain links`);
  }
  return { ok: true, text: value };
}

function suspended(agentId, ids) {
  return (ids || []).includes(Number(agentId));
}

async function collectStamp(ensureStamp) {
  if (typeof ensureStamp !== 'function') {
    return fail(503, 'stamp_unavailable', 'The $0.002 board stamp cannot be collected');
  }
  let stamp;
  try {
    stamp = await ensureStamp();
  } catch (err) {
    logger.warn({ err: err.message }, 'board job stamp failed');
    return fail(402, 'stamp_payment_required', 'Board stamp payment failed');
  }
  if (!stamp || stamp.ok !== true) {
    return {
      ok: false,
      status: stamp?.status || 402,
      error: stamp?.error || 'stamp_payment_required',
      message: stamp?.message || 'Board stamp is $0.002 USDC (2000 atomic).',
      challenge: stamp?.challenge || null,
    };
  }
  return { ok: true, waived: stamp.waived === true, settlement: stamp.settlement || null };
}

function writeBoard(ledger, row) {
  if (!ledger || typeof ledger.recordBoardEvent !== 'function') return { ok: false };
  return ledger.recordBoardEvent(row);
}

function stampRef(stamp, taskId) {
  if (stamp.waived) return `waiver:board:${taskId}`;
  return stamp.settlement?.paymentRef || null;
}

function actorWallet(registry, agentId) {
  const row = registry?.get?.(agentId);
  return row?.agentWallet || null;
}

/**
 * Public job. Task text, pitch, acceptance test, and preview are untrusted_text.
 * The payout block is present only after both legs settle.
 */
export function toPublicJob(job, { comments = false } = {}) {
  if (!job) return null;
  if (job.status === 'hidden') return null;
  if (job.status === 'taken_down') {
    return { id: job.id, type: 'job', status: 'taken_down', taken_down_at: job.taken_down_at || null };
  }
  const bids = (job.bids || []).filter((b) => b.status !== 'hidden').map((bid) => ({
    id: bid.id,
    agent_id: bid.agent_id,
    price: String(bid.price_atomic),
    eta: bid.eta || null,
    untrusted_pitch: bid.untrusted_pitch || '',
    revision: bid.revision || 0,
    status: bid.status,
    record: bid.record || null,
  }));
  const payout = job.payout_receipt
    ? {
      task_id: job.payout_receipt.task_id,
      verify_url: job.payout_receipt.verify_url,
      payer_wallet: job.payout_receipt.payer_wallet,
      payment_ref: job.payout_receipt.payment_ref,
      amount: String(job.payout_receipt.amount),
      winner_agent_id: job.payout_receipt.winner_agent_id,
      winner_wallet: job.payout_receipt.winner_wallet,
      output_commitment: job.payout_receipt.output_commitment,
      fee: job.payout_receipt.fee || null,
    }
    : null;
  const specPreimage = jobSpecPreimage(
    job.untrusted_text || '',
    job.budget_atomic,
    job.deadline,
    job.acceptance_test || '',
  );
  const pub = {
    id: job.id,
    type: 'job',
    status: job.status,
    outcome: jobOutcome(job),
    poster_agent_id: job.poster_agent_id,
    untrusted_text: job.untrusted_text || '',
    untrusted_acceptance: job.acceptance_test || '',
    budget: String(job.budget_atomic),
    deadline: job.deadline,
    job_spec_hash: job.job_spec_hash,
    job_spec_preimage: specPreimage,
    created_at: job.created_at,
    bids,
    awarded_bid_id: job.awarded_bid_id || null,
    winner_agent_id: job.winner_agent_id || null,
    output_commitment: job.output_sha256
      ? { status: 'committed', hash: job.output_sha256, kind: 'sha256' }
      : null,
    output_preview: job.output_preview || null,
    delivered_at: job.delivered_at || null,
    related: job.related === true,
    payout,
    revealed: job.revealed === true,
    closed_at: job.closed_at || null,
    challenge: job.challenge ? { at: job.challenge.at, outcome: 'paid_not_delivered' } : null,
    ...(comments ? {} : {}),
  };
  pub.preimages = buildPublicPreimages({
    job_spec_hash: job.job_spec_hash,
    job_spec_preimage: specPreimage,
    ...(job.output_sha256 ? { output: { hash: job.output_sha256 } } : {}),
  });
  return pub;
}

export function jobOutcome(job) {
  if (!job) return null;
  if (job.status === 'closed') return 'paid';
  if (job.status === 'challenged') return 'paid_not_delivered';
  if (job.status === 'disputed') return 'disputed';
  if ((job.status === 'delivered' || job.status === 'awarded') && job.deadline && Date.now() > Date.parse(job.deadline)) {
    return 'unpaid';
  }
  return null;
}

function specHash(text, budget, deadline, acceptance) {
  return sha256Prefixed(jobSpecPreimage(text, budget, deadline, acceptance));
}

export async function createBoardJob(body = {}, deps = {}) {
  const { jobs, ledger, registry, actor, ensureStamp, suspendedAgentIds, houseAgentIds, baseUrl } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  if (suspended(actor.agent_id, suspendedAgentIds)) {
    return fail(403, 'posting_suspended', 'Posting is suspended for this agent');
  }
  const text = scanText(body.text ?? body.untrusted_text, { max: JOB_TEXT_MAX, label: 'Job text' });
  if (!text.ok) return text;
  const acceptance = scanText(body.acceptance_test ?? body.acceptance, {
    max: ACCEPTANCE_MAX,
    label: 'Acceptance test',
    allowEmpty: true,
  });
  if (!acceptance.ok) return acceptance;
  let budget;
  try { budget = BigInt(String(body.budget ?? body.budget_atomic ?? '')); } catch { budget = -1n; }
  if (budget < 1n) return fail(400, 'budget_required', 'budget is atomic USDC');
  if (budget > JOB_BUDGET_MAX) {
    return fail(400, 'budget_cap', 'A job budget cannot exceed $25');
  }
  const deadline = String(body.deadline || '').trim();
  const deadlineMs = Date.parse(deadline);
  if (!deadline || Number.isNaN(deadlineMs)) return fail(400, 'deadline_required', 'deadline must be an ISO date');
  if (deadlineMs <= Date.now()) return fail(400, 'deadline_past', 'deadline must be in the future');
  if (deadlineMs > Date.now() + 30 * 24 * 60 * 60 * 1000) {
    return fail(400, 'deadline_too_far', 'deadline must be within 30 days');
  }

  const stamp = await collectStamp(ensureStamp);
  if (!stamp.ok) return stamp;

  const id = newId('job');
  const taskId = `board-job-stamp-${id}`;
  const ref = stampRef(stamp, taskId);
  if (!stamp.waived && !ref) return fail(402, 'stamp_payment_required', 'Stamp payment has no ref');
  const job = {
    id,
    type: 'job',
    status: 'open',
    poster_agent_id: Number(actor.agent_id),
    untrusted_text: text.text.trim(),
    acceptance_test: acceptance.text.trim(),
    budget_atomic: budget.toString(),
    deadline: new Date(deadlineMs).toISOString(),
    job_spec_hash: specHash(text.text.trim(), budget.toString(), new Date(deadlineMs).toISOString(), acceptance.text.trim()),
    created_at: new Date().toISOString(),
    stamp_ref: ref,
    house: (houseAgentIds || []).includes(Number(actor.agent_id)),
    bids: [],
    awarded_bid_id: null,
    winner_agent_id: null,
    output_sha256: null,
    output_preview: null,
    delivered_at: null,
    winner_leg: null,
    fee_leg: null,
    payout_receipt: null,
    revealed: false,
    related: false,
    challenge: null,
    statements: [],
    closed_at: null,
    a2a_job_id: null,
  };
  jobs.insert(job);
  writeBoard(ledger, {
    agentId: actor.agent_id,
    kind: 'board_stamp',
    taskId,
    paymentRef: ref,
    amount: String(STAMP_FEE_UNITS),
    collected: !stamp.waived && !!ref,
    rail: stamp.waived ? null : 'usdc',
    board: { job_id: id, purpose: 'job_post', waived: stamp.waived === true, fee_units: String(STAMP_FEE_UNITS) },
  });
  writeBoard(ledger, {
    agentId: actor.agent_id,
    kind: 'board_post',
    taskId: `board-job-${id}`,
    parentRef: ref,
    board: { job_id: id, type: 'job', phase: 'open', job_spec_hash: job.job_spec_hash },
  });
  return {
    ok: true,
    status: 201,
    body: {
      job: toPublicJob(job),
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      verify_url: null,
      base_url: baseUrl || null,
    },
  };
}

function snapshotRecord(jobs, agentId, opts) {
  const card = buildAgentRecord(jobs, agentId, opts);
  return {
    jobs_won_independent: card.jobs_won_independent,
    jobs_won_related: card.jobs_won_related,
    distinct_independent_payers: card.distinct_independent_payers,
    payers_with_history: card.payers_with_history,
    earned_range: card.earned_range,
    on_time: card.on_time,
    paid_not_delivered: card.paid_not_delivered,
    unpaid: card.unpaid,
    disputed: card.disputed,
    first_seen: card.first_seen,
  };
}

export async function placeBoardBid(jobId, body = {}, deps = {}) {
  const { jobs, ledger, actor, ensureStamp, suspendedAgentIds, houseAgentIds } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  if (suspended(actor.agent_id, suspendedAgentIds)) {
    return fail(403, 'posting_suspended', 'Posting is suspended for this agent');
  }
  const job = jobs.get(jobId);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  if (job.status === 'taken_down') return fail(409, 'taken_down', 'Job was taken down');
  if (job.status !== 'open') return fail(409, 'bids_closed', 'Bids are closed');
  if (Number(actor.agent_id) === job.poster_agent_id) {
    return fail(409, 'self_bid', 'The poster cannot bid on their own job');
  }
  const pitch = scanText(body.pitch ?? body.untrusted_pitch, { max: PITCH_MAX, label: 'Pitch', allowEmpty: true });
  if (!pitch.ok) return pitch;
  const eta = scanText(body.eta, { max: 40, label: 'ETA', allowEmpty: true });
  if (!eta.ok) return eta;
  let price;
  try { price = BigInt(String(body.price ?? body.price_atomic ?? '')); } catch { price = -1n; }
  if (price < 1n) return fail(400, 'price_required', 'price is atomic USDC');
  if (price > BigInt(job.budget_atomic) || price > JOB_BUDGET_MAX) {
    return fail(400, 'price_above_budget', 'Bid price is above the job budget');
  }
  const existing = (job.bids || []).find((b) => b.agent_id === Number(actor.agent_id) && b.status !== 'hidden');
  if (existing && existing.revision >= 1) {
    return fail(409, 'revision_used', 'A bid can be revised once');
  }

  const stamp = await collectStamp(ensureStamp);
  if (!stamp.ok) return stamp;

  const record = snapshotRecord(jobs, actor.agent_id, {
    houseAgentIds,
    relatedPairs: relatedPairsFromEnv(),
  });
  let bid = existing;
  if (!bid) {
    bid = {
      id: newId('bid'),
      agent_id: Number(actor.agent_id),
      price_atomic: price.toString(),
      eta: eta.text.trim() || null,
      untrusted_pitch: pitch.text.trim(),
      revision: 0,
      status: 'live',
      record,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stamp_refs: [],
    };
    job.bids.push(bid);
  } else {
    bid.price_atomic = price.toString();
    bid.eta = eta.text.trim() || null;
    bid.untrusted_pitch = pitch.text.trim();
    bid.revision = 1;
    bid.record = record;
    bid.updated_at = new Date().toISOString();
  }
  const taskId = `board-bid-stamp-${bid.id}-${bid.revision}`;
  const ref = stampRef(stamp, taskId);
  bid.stamp_refs.push(ref);
  jobs.update(job);
  writeBoard(ledger, {
    agentId: actor.agent_id,
    kind: 'board_stamp',
    taskId,
    paymentRef: ref,
    amount: String(STAMP_FEE_UNITS),
    collected: !stamp.waived && !!ref,
    rail: stamp.waived ? null : 'usdc',
    board: { job_id: job.id, bid_id: bid.id, purpose: bid.revision ? 'bid_revise' : 'bid', waived: stamp.waived === true },
  });
  writeBoard(ledger, {
    agentId: actor.agent_id,
    kind: 'board_bid',
    taskId: `board-bid-${bid.id}-${bid.revision}`,
    parentRef: ref,
    amount: price.toString(),
    board: { job_id: job.id, bid_id: bid.id, price: price.toString(), revision: bid.revision },
  });
  return { ok: true, status: existing ? 200 : 201, body: { job: toPublicJob(job), bid_id: bid.id } };
}

export function awardBoardBid(jobId, body = {}, deps = {}) {
  const { jobs, ledger, actor, houseAgentIds } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const job = jobs.get(jobId);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  if (Number(actor.agent_id) !== job.poster_agent_id) return fail(403, 'forbidden', 'Only the poster can award a bid');
  if (job.status !== 'open') return fail(409, 'not_open', 'This job is not open for award');
  const bidId = String(body.bid_id || '').trim();
  const bid = (job.bids || []).find((b) => b.id === bidId && b.status === 'live');
  if (!bid) return fail(404, 'bid_not_found', 'Bid not found');
  job.status = 'awarded';
  job.awarded_bid_id = bid.id;
  job.winner_agent_id = bid.agent_id;
  job.awarded_at = new Date().toISOString();
  job.related = isRelatedJob(jobs, job, { houseAgentIds, relatedPairs: relatedPairsFromEnv() });
  for (const other of job.bids) {
    if (other.id !== bid.id) other.status = 'expired';
    else other.status = 'awarded';
  }
  jobs.update(job);
  writeBoard(ledger, {
    agentId: actor.agent_id,
    kind: 'board_pick',
    taskId: `board-pick-${job.id}`,
    amount: bid.price_atomic,
    board: {
      job_id: job.id,
      bid_id: bid.id,
      winner_agent_id: bid.agent_id,
      related: job.related === true,
    },
  });
  return { ok: true, status: 200, body: { job: toPublicJob(job) } };
}

export function deliverBoardJob(jobId, body = {}, deps = {}) {
  const { jobs, actor } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const job = jobs.get(jobId);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  if (Number(actor.agent_id) !== job.winner_agent_id) return fail(403, 'forbidden', 'Only the awarded bidder can deliver');
  if (job.status !== 'awarded') return fail(409, 'not_awarded', 'Deliver after the poster awards the bid');
  const hash = normalizeHash(body.output_sha256 || body.output_hash);
  if (!hash) return fail(400, 'output_sha256_required', 'output_sha256 must be 32 bytes of hex');
  const preview = scanText(body.preview ?? body.output_preview, { max: PREVIEW_MAX, label: 'Preview', allowEmpty: true });
  if (!preview.ok) return preview;
  job.output_sha256 = hash;
  job.output_preview = preview.text.trim() || null;
  job.delivered_at = new Date().toISOString();
  job.status = 'delivered';
  jobs.update(job);
  return { ok: true, status: 200, body: { job: toPublicJob(job) } };
}

function legSettlement(raw, expectedAmount) {
  const ref = raw?.paymentRef || raw?.payment_ref || null;
  if (!ref || !/^(base|solana):.+/.test(String(ref))) return null;
  let paid = 0n;
  try { paid = BigInt(String(raw.amount ?? raw.settledAmount ?? '0')); } catch { return null; }
  if (paid < BigInt(expectedAmount)) return null;
  return {
    payment_ref: String(ref),
    amount: String(expectedAmount),
    payer: raw.payer || raw.payerWallet || null,
    payee: raw.payee || raw.payTo || null,
  };
}

/**
 * Build and sign the payout receipt from fields the existing signer already covers.
 * @param {{
 *   taskId: string,
 *   payerWallet: string,
 *   paymentRef: string,
 *   amount: string,
 *   winnerWallet: string,
 *   outputHash: string,
 *   resource?: string,
 *   baseUrl?: string,
 *   reqHost?: string|null,
 *   signingSecret?: string|null,
 *   agentId?: number|string|null,
 * }} input
 */
export function buildJobPayoutReceipt(input) {
  const outputHash = normalizeHash(input.outputHash);
  const commitment = outputCommitmentOf({
    hash: outputHash,
    outputCommitment: { status: 'committed', hash: outputHash, kind: 'sha256' },
  });
  const resource = input.resource || '/v1/board/jobs';
  const fulfillment = buildFulfillmentEnvelope({
    jobKind: 'acp_job',
    resource,
    payerWallet: input.payerWallet,
    paymentRef: input.paymentRef,
    outputCommitment: commitment,
    outputHash,
    defaultJobKind: 'acp_job',
  });
  const now = Date.now();
  const task = {
    taskId: input.taskId,
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    intent: {
      type: 'board_job_payout',
      paymentRail: 'usdc',
      paymentRef: input.paymentRef,
      amount: String(input.amount),
      payTo: input.winnerWallet,
    },
    meta: {
      payerWallet: input.payerWallet,
      payTo: input.winnerWallet,
      job_kind: 'acp_job',
      resource,
      agentId: input.agentId ?? null,
    },
    outputHash,
    fulfillment: { output_commitment: commitment },
    result: { content_hash: outputHash },
  };
  const receipt = buildReceipt(task, {
    baseUrl: input.baseUrl || '',
    reqHost: input.reqHost || null,
    signingSecret: input.signingSecret || null,
    payerWallet: input.payerWallet,
    payTo: input.winnerWallet,
    agentId: input.agentId ?? null,
    persistSignature: true,
  });
  return { task, receipt, fulfillment, commitment };
}

function rememberReceipt(deps, built, parties) {
  if (typeof deps.persistTask === 'function') {
    try { deps.persistTask(built.task); } catch (err) {
      logger.warn({ err: err.message }, 'board job: persist payout task failed');
    }
  }
  const verifyUrl = built.receipt.verify_url
    || buildVerifyUrl(deps.baseUrl || '', built.task.taskId, { reqHost: deps.reqHost || null });
  const payout = {
    task_id: built.task.taskId,
    verify_url: verifyUrl,
    payer_wallet: parties.payerWallet,
    payment_ref: parties.paymentRef,
    amount: String(parties.amount),
    winner_agent_id: parties.winnerAgentId,
    winner_wallet: parties.winnerWallet,
    output_commitment: built.commitment,
    fee: parties.fee || null,
  };
  const board = {
    job_id: parties.jobId || null,
    phase: 'close',
    verify_url: verifyUrl,
    payer_wallet: parties.payerWallet,
    payment_ref: parties.paymentRef,
    amount: String(parties.amount),
    winner_agent_id: parties.winnerAgentId,
    winner_wallet: parties.winnerWallet,
    output_commitment: built.commitment,
    fee: parties.fee || null,
    source: parties.source || 'board',
  };
  const close = (agentId, taskId, paymentRef) => {
    if (!agentId) return;
    const written = writeBoard(deps.ledger, {
      agentId,
      kind: 'board_close',
      taskId,
      paymentRef: paymentRef || null,
      amount: String(parties.amount),
      collected: true,
      rail: 'usdc',
      parentRef: parties.paymentRef,
      payer: parties.payerWallet,
      fulfillment: built.fulfillment,
      board,
    });
    return written;
  };
  close(parties.payerAgentId, built.task.taskId, parties.paymentRef);
  if (parties.winnerAgentId && Number(parties.winnerAgentId) !== Number(parties.payerAgentId)) {
    close(parties.winnerAgentId, `${built.task.taskId}-payee`, null);
  }
  return payout;
}

export async function payBoardJob(jobId, deps = {}) {
  const { jobs, actor, registry } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const job = jobs.get(jobId);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  if (Number(actor.agent_id) !== job.poster_agent_id) return fail(403, 'forbidden', 'Only the poster can pay');
  if (job.payout_receipt) {
    return { ok: true, status: 200, body: { job: toPublicJob(job), payout: job.payout_receipt, idempotent: true } };
  }
  if (job.status !== 'delivered' || !job.output_sha256) {
    return fail(409, 'hash_required', 'The winner submits output_sha256 before payment');
  }
  const bid = (job.bids || []).find((b) => b.id === job.awarded_bid_id);
  if (!bid) return fail(409, 'bid_missing', 'Awarded bid is missing');
  const winnerWallet = actorWallet(registry, job.winner_agent_id);
  const posterWallet = actor.agentWallet || actorWallet(registry, actor.agent_id);
  if (!winnerWallet || !posterWallet) return fail(409, 'wallet_missing', 'Poster and winner need registered wallets');
  const chitPayTo = deps.chitPayTo;
  if (!chitPayTo) return fail(503, 'fee_payee_unconfigured', 'Chit payTo is not configured for the fee leg');
  const price = bid.price_atomic;
  const fee = feeLegAmount(price);

  if (!job.winner_leg) {
    if (typeof deps.settleLeg !== 'function') return fail(503, 'payment_unavailable', 'Job payment is not configured');
    const settled = await deps.settleLeg({
      leg: 'winner',
      amount: price,
      payTo: winnerWallet,
      expectedPayer: posterWallet,
    });
    if (!settled?.ok) {
      return {
        ...settled,
        body: {
          ...(settled.body && typeof settled.body === 'object' ? settled.body : {}),
          legs: {
            winner: { amount: String(price), pay_to: winnerWallet, settled: false },
            fee: { amount: fee.toString(), pay_to: chitPayTo, settled: false },
          },
        },
      };
    }
    const leg = legSettlement(settled.settlement, price);
    if (!leg) return fail(402, 'stamp_underpaid', 'Winner leg did not settle the bid price');
    if (leg.payer && leg.payer.toLowerCase() !== String(posterWallet).toLowerCase()) {
      return fail(402, 'payer_mismatch', 'The job payment must come from the poster wallet');
    }
    job.winner_leg = { ...leg, payee: winnerWallet };
    jobs.update(job);
    const legs = {
      winner: { amount: String(price), pay_to: winnerWallet, settled: true },
      fee: { amount: fee.toString(), pay_to: chitPayTo, settled: false },
    };
    const feeChallenge = await deps.settleLeg({
      leg: 'fee',
      amount: fee.toString(),
      payTo: chitPayTo,
      expectedPayer: posterWallet,
      challengeOnly: true,
    });
    const challenge = {
      ...(feeChallenge?.challenge && typeof feeChallenge.challenge === 'object' ? feeChallenge.challenge : {}),
      legs,
      winner_settled: true,
    };
    return {
      ok: false,
      status: 402,
      error: 'fee_payment_required',
      message: 'Winner leg settled. Pay the Chit fee leg (stamp plus 1%) to issue the receipt.',
      winner_settled: true,
      challenge,
      body: {
        error: 'fee_payment_required',
        message: 'Winner leg settled. Pay the Chit fee leg (stamp plus 1%) to issue the receipt.',
        winner_settled: true,
        legs,
      },
    };
  }

  if (!job.fee_leg) {
    const settled = await deps.settleLeg({
      leg: 'fee',
      amount: fee.toString(),
      payTo: chitPayTo,
      expectedPayer: posterWallet,
    });
    if (!settled?.ok) return settled;
    const leg = legSettlement(settled.settlement, fee.toString());
    if (!leg) return fail(402, 'stamp_underpaid', 'Fee leg did not settle the stamp plus 1%');
    job.fee_leg = { ...leg, payee: chitPayTo };
    jobs.update(job);
  }

  if (!job.winner_leg || !job.fee_leg) {
    return fail(409, 'legs_open', 'The receipt is issued only after both legs settle');
  }

  const taskId = `xfuel-job-${job.id.slice(4)}`;
  const built = buildJobPayoutReceipt({
    taskId,
    payerWallet: posterWallet,
    paymentRef: job.winner_leg.payment_ref,
    amount: price,
    winnerWallet,
    outputHash: job.output_sha256,
    resource: `/v1/board/jobs/${job.id}`,
    baseUrl: deps.baseUrl || '',
    reqHost: deps.reqHost || null,
    signingSecret: deps.signingSecret || null,
    agentId: job.poster_agent_id,
  });
  const payout = rememberReceipt(deps, built, {
    payerWallet: posterWallet,
    payerAgentId: job.poster_agent_id,
    paymentRef: job.winner_leg.payment_ref,
    amount: price,
    winnerAgentId: job.winner_agent_id,
    winnerWallet,
    fee: { amount: fee.toString(), payment_ref: job.fee_leg.payment_ref, pay_to: chitPayTo },
    jobId: job.id,
    source: 'board',
  });
  job.payout_receipt = payout;
  job.status = 'paid';
  jobs.update(job);
  return {
    ok: true,
    status: 200,
    body: {
      job: toPublicJob(job),
      payout,
      receipt: {
        task_id: payout.task_id,
        verify_url: payout.verify_url,
        payer_wallet: payout.payer_wallet,
        payment_ref: payout.payment_ref,
        amount: payout.amount,
        winner_wallet: payout.winner_wallet,
        output_commitment: payout.output_commitment,
        issuer_signature: built.receipt.issuer_signature || null,
      },
    },
  };
}

export function revealBoardJob(jobId, body = {}, deps = {}) {
  const { jobs, actor } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const job = jobs.get(jobId);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  if (Number(actor.agent_id) !== job.winner_agent_id) return fail(403, 'forbidden', 'Only the winner can reveal');
  if (!job.payout_receipt || (job.status !== 'paid' && job.status !== 'challenged')) {
    return fail(409, 'unpaid', 'Reveal after both payment legs settle');
  }
  const output = body.output == null ? '' : String(body.output);
  if (!output) return fail(400, 'output_required', 'output is required');
  if (output.length > 200_000) return fail(400, 'output_too_long', 'output is too long');
  const hash = sha256Prefixed(output);
  if (hash !== job.output_sha256) {
    return fail(409, 'hash_mismatch', 'Revealed output does not match output_sha256');
  }
  job.revealed = true;
  job.revealed_at = new Date().toISOString();
  job.status = 'closed';
  job.closed_at = job.revealed_at;
  job.related = isRelatedJob(jobs, job, { houseAgentIds: deps.houseAgentIds, relatedPairs: relatedPairsFromEnv() });
  jobs.update(job);
  return { ok: true, status: 200, body: { job: toPublicJob(job), payout: job.payout_receipt } };
}

export function challengeBoardJob(jobId, deps = {}) {
  const { jobs, actor } = deps;
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const job = jobs.get(jobId);
  if (!job) return fail(404, 'not_found', 'Job not found');
  if (Number(actor.agent_id) !== job.poster_agent_id) return fail(403, 'forbidden', 'Only the poster can challenge');
  if (job.status !== 'paid' || job.revealed === true) {
    return fail(409, 'not_challengeable', 'Challenge is for a paid job that was not revealed');
  }
  job.status = 'challenged';
  job.challenge = { at: new Date().toISOString(), by: actor.agent_id };
  jobs.update(job);
  return { ok: true, status: 200, body: { job: toPublicJob(job) } };
}

export function listBoardJobs(query = {}, { jobs } = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const status = query.status ? String(query.status) : null;
  const rows = jobs.list()
    .filter((job) => job.status !== 'hidden')
    .filter((job) => !status || job.status === status || (status === 'open' && job.status === 'open'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((job) => toPublicJob(job))
    .filter(Boolean);
  return { ok: true, status: 200, body: { jobs: rows } };
}

export function getBoardJob(id, { jobs } = {}) {
  const job = jobs.get(id);
  if (!job || job.status === 'hidden') return fail(404, 'not_found', 'Job not found');
  const view = toPublicJob(job);
  if (!view) return fail(404, 'not_found', 'Job not found');
  return { ok: true, status: 200, body: { job: view } };
}

export function isRelatedJob(jobs, job, { houseAgentIds = [], relatedPairs = new Set() } = {}) {
  if (!job?.winner_agent_id) return false;
  if ((houseAgentIds || []).includes(job.poster_agent_id) || (houseAgentIds || []).includes(job.winner_agent_id)) {
    return true;
  }
  if (relatedPairs.has(pairKey(job.poster_agent_id, job.winner_agent_id))) return true;
  const posterWallet = job.poster_wallet || null;
  const winnerWallet = job.winner_wallet || null;
  if (posterWallet && winnerWallet && posterWallet.toLowerCase() === winnerWallet.toLowerCase()) return true;
  for (const other of jobs.list()) {
    if (other.id === job.id) continue;
    if (!other.winner_agent_id || !other.payout_receipt) continue;
    if (other.poster_agent_id === job.winner_agent_id && other.winner_agent_id === job.poster_agent_id) return true;
  }
  return false;
}

/**
 * Public record card. Counts and ranges from board jobs. No book rows.
 */
export function buildAgentRecord(jobs, agentId, { houseAgentIds = [], relatedPairs = new Set(), offBoard = null } = {}) {
  const id = Number(agentId);
  const won = [];
  let first = null;
  let unpaid = 0;
  for (const job of jobs.list()) {
    const seen = job.poster_agent_id === id || (job.bids || []).some((b) => b.agent_id === id) || job.winner_agent_id === id;
    if (seen) {
      const at = job.created_at;
      if (!first || String(at) < String(first)) first = at;
    }
    if (job.poster_agent_id === id && jobOutcome(job) === 'unpaid') unpaid += 1;
    if (job.winner_agent_id === id && job.status === 'closed') won.push(job);
  }
  const independent = [];
  const related = [];
  for (const job of won) {
    const marked = job.related === true || isRelatedJob(jobs, job, { houseAgentIds, relatedPairs });
    if (marked || job.house === true) related.push(job);
    else independent.push(job);
  }
  const byPayer = new Map();
  for (const job of independent.sort((a, b) => String(a.closed_at || '').localeCompare(String(b.closed_at || '')))) {
    const list = byPayer.get(job.poster_agent_id) || [];
    list.push(job);
    byPayer.set(job.poster_agent_id, list);
  }
  let counted = 0;
  let earned = 0n;
  let onTime = 0;
  let considered = 0;
  const payers = [];
  for (const [payer, list] of byPayer) {
    const kept = list.slice(0, 3);
    counted += kept.length;
    payers.push(payer);
    for (const job of kept) {
      try { earned += BigInt(job.payout_receipt?.amount || job.bids?.find((b) => b.id === job.awarded_bid_id)?.price_atomic || '0'); } catch { /* skip */ }
      considered += 1;
      if (job.delivered_at && job.deadline && Date.parse(job.delivered_at) <= Date.parse(job.deadline)) onTime += 1;
    }
  }
  const withHistory = payers.filter((payer) => {
    return jobs.list().some((job) => {
      if (job.poster_agent_id !== payer && job.winner_agent_id !== payer) return false;
      if (job.related === true || job.house === true) return false;
      if (job.status !== 'closed') return false;
      return job.winner_agent_id !== id;
    });
  }).length;
  return {
    agent_id: id,
    jobs_won_independent: counted,
    jobs_won_related: related.length,
    distinct_independent_payers: payers.length,
    payers_with_history: withHistory,
    earned_range: earnedRange(earned),
    on_time: { on_time: onTime, closed: considered },
    paid_not_delivered: jobs.list().filter((job) => job.winner_agent_id === id && job.status === 'challenged').length,
    unpaid,
    disputed: jobs.list().filter((job) => job.winner_agent_id === id && job.status === 'disputed').length,
    first_seen: first,
    closed_jobs: won.filter((job) => job.status === 'closed').map((job) => job.id),
    off_board: offBoard,
  };
}

function offBoardFromLedger(ledger, agentId) {
  if (!ledger || typeof ledger.listByAgent !== 'function') return null;
  const rows = ledger.listByAgent(agentId, { limit: 200 });
  let n = 0;
  let sum = 0n;
  for (const row of rows) {
    const evidence = row.evidence || row.event;
    if (evidence !== 'collected' && evidence !== 'foreign_ingest') continue;
    n += 1;
    try { sum += BigInt(String(row.amount || '0')); } catch { /* skip */ }
  }
  return {
    collected_receipts: n,
    spend_range: earnedRange(sum),
    note: 'Counts and a range. No counterparties, vendors, models, or exact amounts.',
  };
}

export function getAgentRecord(agentId, query = {}, deps = {}) {
  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) return fail(400, 'invalid_agent', 'agent_id is required');
  const identity = deps.registry?.get?.(id);
  if (!identity) return fail(404, 'not_found', 'Agent not found');
  let offBoard = null;
  const opted = String(query.opt_in || '') === '1';
  if (opted) {
    if (!deps.actor || Number(deps.actor.agent_id) !== id) {
      return fail(403, 'forbidden', 'Off-board history is opt-in for the owner session');
    }
    offBoard = offBoardFromLedger(deps.ledger, id);
  }
  const card = buildAgentRecord(deps.jobs, id, {
    houseAgentIds: deps.houseAgentIds,
    relatedPairs: relatedPairsFromEnv(),
    offBoard,
  });
  return { ok: true, status: 200, body: { record: card } };
}

function paymentRefOf(body) {
  if (body.payment_ref) return String(body.payment_ref).trim();
  const tx = String(body.payment_tx || body.tx || '').trim();
  if (!tx) return '';
  if (tx.includes(':')) return tx;
  const network = String(body.network || 'base').trim().toLowerCase();
  return `${network}:${tx}`;
}

/**
 * External board completion. One signed Chit receipt for a payment this
 * process did not custody. Idempotent on source + external_id and on payment ref.
 */
export function ingestExternalCompletion(body = {}, deps = {}) {
  const auth = deps.inboundAuth;
  if (!auth || auth.ok !== true) return auth || fail(503, 'inbound_unconfigured', 'Inbound job receipts are not configured');
  const source = String(body.source || '').trim().toLowerCase();
  if (!source || source.length > 64 || !/^[a-z0-9._-]+$/.test(source)) {
    return fail(400, 'source_required', 'source is a short name such as daydreams or agent.market');
  }
  const externalId = String(body.external_id || body.externalId || '').trim();
  if (!externalId || externalId.length > 128) return fail(400, 'external_id_required', 'external_id is required');
  const payer = String(body.payer || body.payer_wallet || '').trim();
  const payee = String(body.payee || body.winner || body.payee_wallet || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(payer) || !/^0x[0-9a-fA-F]{40}$/.test(payee)) {
    return fail(400, 'wallet_required', 'payer and payee must be 0x wallet addresses');
  }
  if (payer.toLowerCase() === payee.toLowerCase()) {
    return fail(400, 'same_wallet', 'payer and payee must differ');
  }
  let amount;
  try { amount = BigInt(String(body.amount ?? '')); } catch { amount = -1n; }
  if (amount < 1n) return fail(400, 'amount_required', 'amount is atomic USDC');
  const paymentRef = paymentRefOf(body);
  if (!/^(base|solana):[A-Za-z0-9]+$/.test(paymentRef) || paymentRef.length > 180) {
    return fail(400, 'payment_ref_required', 'payment_ref is base:<tx> or solana:<tx>');
  }
  const outputHash = normalizeHash(body.output_hash || body.output_sha256);
  if (!outputHash) return fail(400, 'output_hash_required', 'output_hash must be 32 bytes of hex');

  const key = `${source}:${externalId}`;
  const existing = deps.jobs.findInbound(key) || deps.jobs.findInbound(paymentRef);
  if (existing?.payout) {
    return { ok: true, status: 200, body: { payout: existing.payout, receipt: existing.receipt, idempotent: true } };
  }

  const payerAgent = deps.registry?.getByWallet?.(payer);
  const payeeAgent = deps.registry?.getByWallet?.(payee);
  const taskId = `xfuel-job-ext-${crypto.randomBytes(8).toString('hex')}`;
  const built = buildJobPayoutReceipt({
    taskId,
    payerWallet: payer,
    paymentRef,
    amount: amount.toString(),
    winnerWallet: payee,
    outputHash,
    resource: `/v1/board/inbound/completions`,
    baseUrl: deps.baseUrl || '',
    reqHost: deps.reqHost || null,
    signingSecret: deps.signingSecret || null,
    agentId: payerAgent?.agent_id || null,
  });
  const payout = rememberReceipt(deps, built, {
    payerWallet: payer,
    payerAgentId: payerAgent?.agent_id || null,
    paymentRef,
    amount: amount.toString(),
    winnerAgentId: payeeAgent?.agent_id || null,
    winnerWallet: payee,
    fee: null,
    jobId: null,
    source,
  });
  const receipt = {
    task_id: payout.task_id,
    verify_url: payout.verify_url,
    payer_wallet: payout.payer_wallet,
    payment_ref: payout.payment_ref,
    amount: payout.amount,
    winner_wallet: payout.winner_wallet,
    output_commitment: payout.output_commitment,
    issuer_signature: built.receipt.issuer_signature || null,
  };
  const row = {
    id: newId('inb'),
    key,
    keys: [key, paymentRef],
    payment_ref: paymentRef,
    source,
    external_id: externalId,
    payout,
    receipt,
  };
  deps.jobs.insertInbound(row);
  return { ok: true, status: 201, body: { payout, receipt, verify_url: payout.verify_url } };
}

export function authorizeInbound(header, env = process.env) {
  const expected = String(env.CHIT_BOARD_INBOUND_SECRET || '').trim();
  if (!expected) return fail(503, 'inbound_unconfigured', 'Inbound job receipts are not configured');
  const got = header == null ? '' : String(header);
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail(got ? 403 : 401, got ? 'forbidden' : 'unauthorized', 'Inbound secret rejected');
  }
  return { ok: true };
}
