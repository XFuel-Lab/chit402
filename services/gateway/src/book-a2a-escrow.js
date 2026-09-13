/**
 * A2A escrow + machine dispute v1 — thin wrapper on ledger escrow + book dispute.
 *
 * Job lifecycle: open → fund → submit → release | clawback | challenge (metered).
 * Each phase can append an exportable book row (see usage-settled recordA2aEscrowEvent).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import {
  ESCROW_ACTIONS,
  ESCROW_STATUS,
  handleEscrowAction,
} from './book-escrow.js';
import { CLAIM_TYPES, fileAndAdjudicate } from './book-dispute.js';
import { DEFAULT_FLOOR_UNITS } from './pricing.js';

export const A2A_JOB_ACTIONS = {
  OPEN: 'open',
  FUND: 'fund',
  SUBMIT: 'submit',
  RELEASE: 'release',
  CLAWBACK: 'clawback',
  CHALLENGE: 'challenge',
  STATUS: 'status',
};

export const A2A_JOB_STATUS = {
  OPENED: 'opened',
  FUNDED: 'funded',
  SUBMITTED: 'submitted',
  RELEASED: 'released',
  CLAWED_BACK: 'clawed_back',
  CHALLENGED: 'challenged',
  EXPIRED: 'expired',
};

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_CHALLENGES_PER_JOB = 3;
export const CHALLENGE_METER_UNITS = String(DEFAULT_FLOOR_UNITS);

function normalizeHash(value) {
  const s = String(value || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return `0x${s}`;
}

function normalizeParties(parties, principalAgentId) {
  if (!parties || typeof parties !== 'object') return { ok: false, reason: 'parties required' };
  const principal = Number(parties.principal_agent_id ?? parties.principal);
  const counterparty = Number(parties.counterparty_agent_id ?? parties.counterparty);
  if (!Number.isInteger(principal) || principal < 1) {
    return { ok: false, reason: 'parties.principal_agent_id required' };
  }
  if (principal !== Number(principalAgentId)) {
    return { ok: false, reason: 'principal_agent_id must match possession agent_id' };
  }
  if (!Number.isInteger(counterparty) || counterparty < 1) {
    return { ok: false, reason: 'parties.counterparty_agent_id required' };
  }
  if (counterparty === principal) {
    return { ok: false, reason: 'counterparty must differ from principal' };
  }
  return { ok: true, principal, counterparty };
}

export class BookA2aJobStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} */
    this.jobs = new Map();
    /** @type {Map<string, string>} job_spec_hash+principal → job_id */
    this.bySpec = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'book-a2a-escrow: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-a2a-jobs.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const j of data.jobs || []) {
        this.jobs.set(j.job_id, j);
        if (j.job_spec_hash && j.principal_agent_id) {
          this.bySpec.set(`${j.principal_agent_id}:${j.job_spec_hash}`, j.job_id);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'book-a2a-escrow: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ jobs: [...this.jobs.values()] }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'book-a2a-escrow: save failed');
    }
  }

  get(jobId) {
    return this.jobs.get(String(jobId)) || null;
  }

  listByPrincipal(agentId) {
    const id = Number(agentId);
    return [...this.jobs.values()].filter(j => j.principal_agent_id === id);
  }

  _touchExpiry(job) {
    if (![A2A_JOB_STATUS.OPENED, A2A_JOB_STATUS.FUNDED, A2A_JOB_STATUS.SUBMITTED, A2A_JOB_STATUS.CHALLENGED].includes(job.status)) {
      return job;
    }
    if (!job.expires_at) return job;
    if (Date.now() >= Date.parse(job.expires_at)) {
      job.status = A2A_JOB_STATUS.EXPIRED;
      job.closed_at = new Date().toISOString();
      job.close_reason = 'expired';
      this._save();
    }
    return job;
  }
}

function packJobView(job, baseUrl = '') {
  const verifyUrl = job.task_id && baseUrl
    ? `${String(baseUrl).replace(/\/$/, '')}/receipt/${job.task_id}`
    : (job.fulfillment_receipt_id && baseUrl
      ? `${String(baseUrl).replace(/\/$/, '')}/receipt/${job.fulfillment_receipt_id}`
      : null);
  return {
    ...job,
    verify_url: verifyUrl,
    challenge_meter_units: CHALLENGE_METER_UNITS,
  };
}

/**
 * @param {object} input
 * @param {{
 *   jobs: BookA2aJobStore,
 *   escrows: import('./book-escrow.js').BookEscrowStore,
 *   disputes: import('./book-dispute.js').BookDisputeStore,
 *   ledger: object,
 *   recordBookRow?: Function,
 *   loadReceipt?: Function,
 *   verifyReceipt?: Function,
 *   baseUrl?: string,
 * }} deps
 */
export async function handleA2aJobAction(input, deps = {}) {
  const {
    jobs,
    escrows,
    disputes,
    ledger,
    recordBookRow,
    loadReceipt,
    verifyReceipt,
    baseUrl = '',
  } = deps;

  const action = String(input.action || '').toLowerCase();
  if (!Object.values(A2A_JOB_ACTIONS).includes(action)) {
    return { ok: false, reason: `invalid action: ${input.action}` };
  }

  const principalId = Number(input.agent_id);

  if (action === A2A_JOB_ACTIONS.STATUS) {
    const jobId = input.job_id ? String(input.job_id) : null;
    if (!jobId) return { ok: false, reason: 'job_id required for status' };
    let job = jobs.get(jobId);
    if (!job || job.principal_agent_id !== principalId) {
      return { ok: false, reason: 'job not found' };
    }
    job = jobs._touchExpiry(job);
    return { ok: true, job: packJobView(job, baseUrl) };
  }

  if (action === A2A_JOB_ACTIONS.OPEN) {
    const specHash = normalizeHash(input.job_spec_hash);
    if (!specHash) return { ok: false, reason: 'job_spec_hash required (32-byte hex)' };
    const amount = input.amount != null ? String(input.amount).trim() : '';
    if (!amount || !/^\d+$/.test(amount)) {
      return { ok: false, reason: 'amount required (USDC atomic units)' };
    }
    const partiesCheck = normalizeParties(input.parties, principalId);
    if (!partiesCheck.ok) return partiesCheck;

    const specKey = `${principalId}:${specHash}`;
    const existingId = jobs.bySpec.get(specKey);
    if (existingId) {
      const existing = jobs.get(existingId);
      if (existing && [A2A_JOB_STATUS.OPENED, A2A_JOB_STATUS.FUNDED, A2A_JOB_STATUS.SUBMITTED, A2A_JOB_STATUS.CHALLENGED].includes(existing.status)) {
        return { ok: false, reason: 'job already open for this job_spec_hash', existing: packJobView(existing, baseUrl) };
      }
    }

    let expiresAt = input.expires_at ? String(input.expires_at) : null;
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return { ok: false, reason: 'invalid expires_at' };
    }
    if (!expiresAt) {
      expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MS).toISOString();
    }

    const jobId = `a2ajob-${crypto.randomBytes(8).toString('hex')}`;
    const job = {
      job_id: jobId,
      job_spec_hash: specHash,
      amount,
      principal_agent_id: partiesCheck.principal,
      counterparty_agent_id: partiesCheck.counterparty,
      status: A2A_JOB_STATUS.OPENED,
      task_id: null,
      escrow_id: null,
      fulfillment_receipt_id: null,
      output_commitment: null,
      challenge_count: 0,
      dispute_ids: [],
      opened_at: new Date().toISOString(),
      funded_at: null,
      submitted_at: null,
      closed_at: null,
      close_reason: null,
      expires_at: expiresAt,
      evidence_note: 'Ledger A2A job — not on-chain escrow. See docs/product/a2a-escrow-dispute-v1.md.',
    };

    jobs.jobs.set(jobId, job);
    jobs.bySpec.set(specKey, jobId);
    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'open',
      job,
    });

    return { ok: true, job: packJobView(job, baseUrl), book_row: bookRow?.entry || null };
  }

  const jobId = input.job_id ? String(input.job_id) : null;
  if (!jobId) return { ok: false, reason: 'job_id required' };
  let job = jobs.get(jobId);
  if (!job || job.principal_agent_id !== principalId) {
    return { ok: false, reason: 'job not found' };
  }
  job = jobs._touchExpiry(job);

  if (job.status === A2A_JOB_STATUS.EXPIRED) {
    return { ok: false, reason: 'job expired', job: packJobView(job, baseUrl) };
  }
  if ([A2A_JOB_STATUS.RELEASED, A2A_JOB_STATUS.CLAWED_BACK].includes(job.status)) {
    return { ok: false, reason: `job closed (${job.status})`, job: packJobView(job, baseUrl) };
  }

  if (action === A2A_JOB_ACTIONS.FUND) {
    if (job.status !== A2A_JOB_STATUS.OPENED) {
      return { ok: false, reason: `fund requires opened status (got ${job.status})` };
    }
    const taskId = input.task_id ? String(input.task_id).trim() : '';
    if (!taskId) return { ok: false, reason: 'task_id required for fund' };

    const entry = ledger?.findByTask(taskId);
    if (!entry) return { ok: false, reason: 'task not on book — pay via x402 first' };
    if (Number(entry.agent_id) !== principalId) {
      return { ok: false, reason: 'task not owned by principal agent' };
    }
    if (!entry.collected) return { ok: false, reason: 'ledger entry not collected' };
    if (String(entry.amount || '') !== String(job.amount)) {
      return { ok: false, reason: 'task amount does not match job amount' };
    }

    const escrowOpen = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: principalId,
      task_id: taskId,
      amount: job.amount,
      expires_at: job.expires_at,
      required: { proof_tier: 'settlement' },
    }, { store: escrows, ledger, disputes, loadReceipt, verifyReceipt, baseUrl });

    if (!escrowOpen.ok) {
      return { ok: false, reason: escrowOpen.reason, checks: escrowOpen.checks };
    }

    job.task_id = taskId;
    job.escrow_id = escrowOpen.escrow.escrow_id;
    job.status = A2A_JOB_STATUS.FUNDED;
    job.funded_at = new Date().toISOString();
    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'fund',
      job,
      verifyUrl: escrowOpen.escrow.verify_url,
    });

    return {
      ok: true,
      job: packJobView(job, baseUrl),
      escrow: escrowOpen.escrow,
      book_row: bookRow?.entry || null,
    };
  }

  if (action === A2A_JOB_ACTIONS.SUBMIT) {
    if (![A2A_JOB_STATUS.FUNDED, A2A_JOB_STATUS.CHALLENGED].includes(job.status)) {
      return { ok: false, reason: `submit requires funded or challenged status (got ${job.status})` };
    }
    const fulfillmentId = input.fulfillment_receipt_id
      ? String(input.fulfillment_receipt_id).trim()
      : (input.fulfillment_task_id ? String(input.fulfillment_task_id).trim() : '');
    const outputCommitment = input.output_commitment
      ? normalizeHash(input.output_commitment)
      : (input.output_hash ? normalizeHash(input.output_hash) : null);

    if (!fulfillmentId && !outputCommitment) {
      return { ok: false, reason: 'fulfillment_receipt_id and/or output_commitment required' };
    }

    job.fulfillment_receipt_id = fulfillmentId || job.fulfillment_receipt_id;
    job.output_commitment = outputCommitment || job.output_commitment;
    job.status = A2A_JOB_STATUS.SUBMITTED;
    job.submitted_at = new Date().toISOString();

    if (job.escrow_id && outputCommitment) {
      const escrow = escrows.get(job.escrow_id);
      if (escrow && escrow.status === ESCROW_STATUS.OPEN) {
        escrow.required = {
          ...(escrow.required || {}),
          output_hash: outputCommitment,
          proof_tier: escrow.required?.proof_tier || 'settlement',
        };
        escrows._save?.();
      }
    }

    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'submit',
      job,
    });

    return { ok: true, job: packJobView(job, baseUrl), book_row: bookRow?.entry || null };
  }

  if (action === A2A_JOB_ACTIONS.RELEASE) {
    if (!job.escrow_id || !job.task_id) {
      return { ok: false, reason: 'job not funded' };
    }
    const escrowResult = await handleEscrowAction({
      action: ESCROW_ACTIONS.RELEASE,
      agent_id: principalId,
      escrow_id: job.escrow_id,
    }, { store: escrows, ledger, disputes, loadReceipt, verifyReceipt, baseUrl });

    if (!escrowResult.ok) {
      return {
        ok: false,
        reason: escrowResult.reason,
        checks: escrowResult.checks,
        job: packJobView(job, baseUrl),
        disclaimer: escrowResult.disclaimer,
      };
    }

    job.status = A2A_JOB_STATUS.RELEASED;
    job.closed_at = new Date().toISOString();
    job.close_reason = 'release';
    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'release',
      job,
      verifyUrl: escrowResult.escrow?.verify_url,
    });

    return {
      ok: true,
      job: packJobView(job, baseUrl),
      escrow: escrowResult.escrow,
      checks: escrowResult.checks,
      book_row: bookRow?.entry || null,
      disclaimer: escrowResult.disclaimer,
    };
  }

  if (action === A2A_JOB_ACTIONS.CLAWBACK) {
    if (!job.escrow_id || !job.task_id) {
      return { ok: false, reason: 'job not funded' };
    }
    const claimType = input.claim_type || CLAIM_TYPES.OUTPUT_MISSING;
    const escrowResult = await handleEscrowAction({
      action: ESCROW_ACTIONS.CLAWBACK,
      agent_id: principalId,
      escrow_id: job.escrow_id,
      claim_type: claimType,
      evidence: input.evidence || {},
    }, { store: escrows, ledger, disputes, loadReceipt, verifyReceipt, baseUrl });

    if (!escrowResult.ok) {
      return {
        ok: false,
        reason: escrowResult.reason,
        job: packJobView(job, baseUrl),
        disclaimer: escrowResult.disclaimer,
      };
    }

    job.status = A2A_JOB_STATUS.CLAWED_BACK;
    job.closed_at = new Date().toISOString();
    job.close_reason = `clawback:${claimType}`;
    if (escrowResult.dispute?.dispute_id) {
      job.dispute_ids.push(escrowResult.dispute.dispute_id);
    }
    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'clawback',
      job,
    });

    return {
      ok: true,
      job: packJobView(job, baseUrl),
      escrow: escrowResult.escrow,
      dispute: escrowResult.dispute,
      book_row: bookRow?.entry || null,
      disclaimer: escrowResult.disclaimer,
    };
  }

  if (action === A2A_JOB_ACTIONS.CHALLENGE) {
    if (!job.task_id) return { ok: false, reason: 'job not funded' };
    if (job.challenge_count >= MAX_CHALLENGES_PER_JOB) {
      return { ok: false, reason: `challenge meter exhausted (max ${MAX_CHALLENGES_PER_JOB})` };
    }

    const claimType = input.claim_type || CLAIM_TYPES.WRONG_MODEL;
    const priorDispute = disputes.getByTask(job.task_id);
    let disputeResult;
    if (priorDispute) {
      disputeResult = { ok: true, dispute: priorDispute, checks: null, auto_adjudicated: false };
    } else {
      disputeResult = await fileAndAdjudicate({
        agent_id: principalId,
        task_id: job.task_id,
        claim_type: claimType,
        evidence: {
          ...(input.evidence || {}),
          a2a_job_id: job.job_id,
          job_spec_hash: job.job_spec_hash,
          counterparty_agent_id: job.counterparty_agent_id,
          fulfillment_receipt_id: job.fulfillment_receipt_id,
          output_commitment: job.output_commitment,
        },
      }, { disputes, ledger, loadReceipt, verifyReceipt });

      if (!disputeResult.ok && !disputeResult.dispute) {
        return { ok: false, reason: disputeResult.reason, existing: disputeResult.existing };
      }
    }

    job.challenge_count += 1;
    job.status = A2A_JOB_STATUS.CHALLENGED;
    if (disputeResult.dispute?.dispute_id) {
      job.dispute_ids.push(disputeResult.dispute.dispute_id);
    }
    jobs._save();

    const bookRow = recordBookRow?.({
      agentId: principalId,
      jobId,
      phase: 'challenge',
      job,
      meterUnits: CHALLENGE_METER_UNITS,
      challengeIndex: job.challenge_count,
    });

    return {
      ok: true,
      job: packJobView(job, baseUrl),
      dispute: disputeResult.dispute || null,
      checks: disputeResult.checks || null,
      book_row: bookRow?.entry || null,
      meter: {
        units: CHALLENGE_METER_UNITS,
        challenge_count: job.challenge_count,
        max: MAX_CHALLENGES_PER_JOB,
        note: 'Metered machine dispute — recorded on book; not a human jury.',
      },
    };
  }

  return { ok: false, reason: 'unhandled action' };
}

let _jobStore = null;

export function getBookA2aJobStore(opts) {
  if (!_jobStore) _jobStore = new BookA2aJobStore(opts);
  return _jobStore;
}

export function resetBookA2aJobStore() {
  _jobStore = null;
}

export default {
  BookA2aJobStore,
  A2A_JOB_ACTIONS,
  A2A_JOB_STATUS,
  MAX_CHALLENGES_PER_JOB,
  CHALLENGE_METER_UNITS,
  handleA2aJobAction,
  getBookA2aJobStore,
  resetBookA2aJobStore,
};
