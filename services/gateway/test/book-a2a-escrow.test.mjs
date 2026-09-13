/**
 * A2A escrow + machine dispute v1 — open → fund → submit → release
 * and fund → clawback smoke paths with exportable book rows.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BookA2aJobStore,
  A2A_JOB_ACTIONS,
  A2A_JOB_STATUS,
  handleA2aJobAction,
  resetBookA2aJobStore,
  MAX_CHALLENGES_PER_JOB,
} from '../src/book-a2a-escrow.js';
import { BookEscrowStore, resetBookEscrowStore } from '../src/book-escrow.js';
import { BookDisputeStore, resetBookDisputeStore } from '../src/book-dispute.js';
import { UsageSettledLedger, BOOK_EVIDENCE } from '../src/usage-settled.js';

const SPEC_HASH = '0x' + 'ab'.repeat(32);
const OUTPUT_HASH = '0x' + 'cd'.repeat(32);

function ledgerWithEntry(over = {}) {
  const ledger = new UsageSettledLedger();
  const entry = {
    task_id: over.task_id || 'task-a2a-pay-1',
    payment_ref: over.ref || 'base:0xa2a1',
    payer: '0xpayer',
    agent_id: over.agent_id ?? 7,
    collected: true,
    rail: 'usdc',
    amount: over.amount || '50000',
    collected_at: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    model: 'xfuel/auto',
    hub: 'mock',
  };
  ledger.entries.push(entry);
  ledger.byTask.set(entry.task_id, entry);
  return { ledger, entry };
}

function receiptFor(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id || 'task-a2a-pay-1',
    payment: { ref: over.ref || 'base:0xa2a1', collected: true, gross_amount: over.amount || '50000' },
    output: { hash: over.output_hash || OUTPUT_HASH },
    proof: { tier: 'settlement' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

function recordBookRowFactory(ledger) {
  return (row) => ledger.recordA2aEscrowEvent({
    agentId: row.agentId,
    jobId: row.jobId,
    phase: row.phase,
    job: row.job,
    verifyUrl: row.verifyUrl || null,
    meterUnits: row.meterUnits || null,
    challengeIndex: row.challengeIndex ?? null,
  });
}

describe('A2A escrow job flow', () => {
  beforeEach(() => {
    resetBookA2aJobStore();
    resetBookEscrowStore();
    resetBookDisputeStore();
  });

  test('open → fund → submit → release leaves holdable rows and verify_url', async () => {
    const jobs = new BookA2aJobStore();
    const escrows = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();
    const recordBookRow = recordBookRowFactory(ledger);
    const loadReceipt = async (id) => receiptFor({ task_id: id });

    const opened = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.OPEN,
      agent_id: 7,
      job_spec_hash: SPEC_HASH,
      amount: '50000',
      parties: { principal_agent_id: 7, counterparty_agent_id: 12 },
    }, { jobs, escrows, disputes, ledger, recordBookRow, baseUrl: 'https://api.chit402.com' });

    assert.equal(opened.ok, true);
    assert.equal(opened.job.status, A2A_JOB_STATUS.OPENED);
    assert.ok(opened.book_row);
    assert.equal(opened.book_row.evidence, BOOK_EVIDENCE.A2A_ESCROW);

    const funded = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.FUND,
      agent_id: 7,
      job_id: opened.job.job_id,
      task_id: 'task-a2a-pay-1',
    }, { jobs, escrows, disputes, ledger, recordBookRow, loadReceipt, baseUrl: 'https://api.chit402.com' });

    assert.equal(funded.ok, true);
    assert.equal(funded.job.status, A2A_JOB_STATUS.FUNDED);
    assert.ok(funded.escrow.escrow_id);
    assert.ok(funded.job.verify_url.includes('task-a2a-pay-1'));

    const submitted = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.SUBMIT,
      agent_id: 7,
      job_id: opened.job.job_id,
      fulfillment_receipt_id: 'task-fulfill-9',
      output_commitment: OUTPUT_HASH,
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    assert.equal(submitted.ok, true);
    assert.equal(submitted.job.status, A2A_JOB_STATUS.SUBMITTED);

    const released = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.RELEASE,
      agent_id: 7,
      job_id: opened.job.job_id,
    }, {
      jobs,
      escrows,
      disputes,
      ledger,
      recordBookRow,
      loadReceipt,
      verifyReceipt: () => ({ valid: true }),
      baseUrl: 'https://api.chit402.com',
    });

    assert.equal(released.ok, true);
    assert.equal(released.job.status, A2A_JOB_STATUS.RELEASED);
    assert.ok(released.book_row.a2a_escrow.phase === 'release');

    const a2aRows = ledger.entries.filter(e => e.evidence === BOOK_EVIDENCE.A2A_ESCROW);
    assert.ok(a2aRows.length >= 4);
    const listed = ledger.listByAgent(7, { limit: 50 });
    assert.ok(listed.some(r => r.evidence === BOOK_EVIDENCE.A2A_ESCROW));
  });

  test('clawback path closes job and ties dispute', async () => {
    const jobs = new BookA2aJobStore();
    const escrows = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();
    const recordBookRow = recordBookRowFactory(ledger);

    const opened = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.OPEN,
      agent_id: 7,
      job_spec_hash: '0x' + '11'.repeat(32),
      amount: '50000',
      parties: { principal_agent_id: 7, counterparty_agent_id: 99 },
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    const funded = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.FUND,
      agent_id: 7,
      job_id: opened.job.job_id,
      task_id: 'task-a2a-pay-1',
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    const claw = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.CLAWBACK,
      agent_id: 7,
      job_id: funded.job.job_id,
      claim_type: 'output_missing',
    }, {
      jobs,
      escrows,
      disputes,
      ledger,
      recordBookRow,
      loadReceipt: async () => receiptFor({ output_hash: null }),
    });

    assert.equal(claw.ok, true);
    assert.equal(claw.job.status, A2A_JOB_STATUS.CLAWED_BACK);
    assert.ok(claw.dispute?.dispute_id);
  });

  test('challenge is metered per job', async () => {
    const jobs = new BookA2aJobStore();
    const escrows = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();
    const recordBookRow = recordBookRowFactory(ledger);

    const opened = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.OPEN,
      agent_id: 7,
      job_spec_hash: '0x' + '22'.repeat(32),
      amount: '50000',
      parties: { principal_agent_id: 7, counterparty_agent_id: 3 },
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.FUND,
      agent_id: 7,
      job_id: opened.job.job_id,
      task_id: 'task-a2a-pay-1',
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    for (let i = 0; i < MAX_CHALLENGES_PER_JOB; i += 1) {
      const ch = await handleA2aJobAction({
        action: A2A_JOB_ACTIONS.CHALLENGE,
        agent_id: 7,
        job_id: opened.job.job_id,
        claim_type: 'wrong_model',
        evidence: { requested_model: 'theta/glm' },
      }, {
        jobs,
        escrows,
        disputes,
        ledger,
        recordBookRow,
        loadReceipt: async () => receiptFor({}),
      });
      assert.equal(ch.ok, true);
      assert.equal(ch.job.challenge_count, i + 1);
      assert.ok(ch.meter.units);
    }

    const exhausted = await handleA2aJobAction({
      action: A2A_JOB_ACTIONS.CHALLENGE,
      agent_id: 7,
      job_id: opened.job.job_id,
    }, { jobs, escrows, disputes, ledger, recordBookRow });

    assert.equal(exhausted.ok, false);
    assert.match(exhausted.reason, /meter exhausted/);
  });
});
