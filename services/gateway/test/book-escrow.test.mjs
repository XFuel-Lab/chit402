/**
 * Book Escrow Helper — state machine unit tests.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BookEscrowStore,
  ESCROW_ACTIONS,
  ESCROW_STATUS,
  handleEscrowAction,
  verifyEscrowRelease,
  resetBookEscrowStore,
} from '../src/book-escrow.js';
import { BookDisputeStore, resetBookDisputeStore } from '../src/book-dispute.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import { _allowSettlementProofForTests } from '../src/settlement-proof-flag.js';

// The add-on's code guard stays false; tests flip it to exercise the flag-on paths.
_allowSettlementProofForTests(true);

function ledgerWithEntry(over = {}) {
  const ledger = new UsageSettledLedger();
  const entry = {
    task_id: over.task_id || 'task-escrow-1',
    payment_ref: over.ref || 'base:0xescrow1',
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
    task_id: over.task_id || 'task-escrow-1',
    payment: { ref: over.ref || 'base:0xescrow1', collected: true, gross_amount: over.amount || '50000' },
    output: { hash: over.output_hash || '0x' + 'cd'.repeat(32) },
    proof: { tier: over.proof_tier || 'settlement' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

describe('Book Escrow state machine', () => {
  // Settlement-tier escrows need the add-on on; the off path is tested below.
  beforeEach(() => {
    resetBookEscrowStore();
    resetBookDisputeStore();
    process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.SETTLEMENT_PROOF_ENABLED;
  });

  test('flag off: open with required.proof_tier settlement is refused; output_hash-only still opens', async () => {
    delete process.env.SETTLEMENT_PROOF_ENABLED;
    const store = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();
    for (const tier of ['settlement', 'SETTLEMENT']) {
      const refused = await handleEscrowAction({
        action: ESCROW_ACTIONS.OPEN,
        agent_id: 7,
        task_id: 'task-escrow-1',
        amount: '50000',
        required: { output_hash: '0x' + 'cd'.repeat(32), proof_tier: tier },
      }, { store, ledger, disputes, baseUrl: 'https://api.chit402.com' });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'settlement_proof_not_offered');
      assert.match(refused.reason, /Retry without proof_tier/);
      assert.equal(store.escrows.size, 0);
    }
    const opened = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      amount: '50000',
      required: { output_hash: '0x' + 'cd'.repeat(32) },
    }, { store, ledger, disputes, baseUrl: 'https://api.chit402.com' });
    assert.equal(opened.ok, true);
  });

  test('open requires task on book with required hash or tier', async () => {
    const store = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();

    const missing = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'ghost-task',
      required: { output_hash: '0xabc' },
    }, { store, ledger, disputes });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /not on book/);

    const noRequired = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      required: {},
    }, { store, ledger, disputes });
    assert.equal(noRequired.ok, false);
    assert.match(noRequired.reason, /required/);

    const opened = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      amount: '50000',
      required: { output_hash: '0x' + 'cd'.repeat(32), proof_tier: 'settlement' },
    }, { store, ledger, disputes, baseUrl: 'https://api.chit402.com' });

    assert.equal(opened.ok, true);
    assert.equal(opened.escrow.status, ESCROW_STATUS.OPEN);
    assert.equal(opened.escrow.hold.kind, 'ledger');
    assert.equal(opened.escrow.ledger_escrow, true);
    assert.ok(opened.escrow.verify_url.includes('task-escrow-1'));
  });

  test('release verifies output hash and proof tier', async () => {
    const store = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();
    const hash = '0x' + 'ee'.repeat(32);

    const opened = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      required: { output_hash: hash, proof_tier: 'inference' },
    }, { store, ledger, disputes });
    assert.equal(opened.ok, true);

    const badRelease = await handleEscrowAction({
      action: ESCROW_ACTIONS.RELEASE,
      agent_id: 7,
      escrow_id: opened.escrow.escrow_id,
    }, {
      store,
      ledger,
      disputes,
      loadReceipt: async () => receiptFor({ output_hash: hash, proof_tier: 'settlement' }),
    });
    assert.equal(badRelease.ok, false);
    assert.match(badRelease.reason, /below required inference/);

    const goodRelease = await handleEscrowAction({
      action: ESCROW_ACTIONS.RELEASE,
      agent_id: 7,
      escrow_id: opened.escrow.escrow_id,
    }, {
      store,
      ledger,
      disputes,
      loadReceipt: async () => receiptFor({ output_hash: hash, proof_tier: 'inference' }),
      verifyReceipt: () => ({ valid: true }),
    });
    assert.equal(goodRelease.ok, true);
    assert.equal(goodRelease.escrow.status, ESCROW_STATUS.RELEASED);
    assert.ok(goodRelease.disclaimer.includes('closed-weight'));
  });

  test('clawback ties into dispute and records refund instruction', async () => {
    const store = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();

    const opened = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      required: { proof_tier: 'settlement' },
    }, { store, ledger, disputes });

    const claw = await handleEscrowAction({
      action: ESCROW_ACTIONS.CLAWBACK,
      agent_id: 7,
      escrow_id: opened.escrow.escrow_id,
      claim_type: 'output_missing',
    }, {
      store,
      ledger,
      disputes,
      loadReceipt: async () => receiptFor({ output_hash: null }),
    });

    assert.equal(claw.ok, true);
    assert.equal(claw.escrow.status, ESCROW_STATUS.CLAWED_BACK);
    assert.ok(claw.escrow.dispute_id);
    assert.ok(claw.disclaimer.includes('on-chain'));
  });

  test('status expires open escrows past expires_at', async () => {
    const store = new BookEscrowStore();
    const disputes = new BookDisputeStore();
    const { ledger } = ledgerWithEntry();

    const opened = await handleEscrowAction({
      action: ESCROW_ACTIONS.OPEN,
      agent_id: 7,
      task_id: 'task-escrow-1',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      required: { output_hash: '0x' + 'aa'.repeat(32) },
    }, { store, ledger, disputes });

    const status = await handleEscrowAction({
      action: ESCROW_ACTIONS.STATUS,
      agent_id: 7,
      escrow_id: opened.escrow.escrow_id,
    }, { store, ledger, disputes });

    assert.equal(status.ok, true);
    assert.equal(status.escrow.status, ESCROW_STATUS.EXPIRED);
  });

  test('verifyEscrowRelease checks ledger hold', () => {
    const escrow = {
      required: { output_hash: '0x' + 'ff'.repeat(32) },
    };
    const receipt = receiptFor({ output_hash: '0x' + 'ff'.repeat(32) });
    const ok = verifyEscrowRelease(escrow, receipt, { collected: true, payment_ref: 'base:0x1' });
    assert.equal(ok.ok, true);

    const bad = verifyEscrowRelease(escrow, receipt, null);
    assert.equal(bad.ok, false);
  });
});
