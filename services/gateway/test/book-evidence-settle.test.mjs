/**
 * Book evidence (greenspan + hemei) + settle-time ledger row.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from '../src/agent-registry.js';
import {
  UsageSettledLedger,
  recordCollectedSpend,
  recordSettleBookRow,
  deriveEvidence,
  BOOK_EVIDENCE,
  ARRIVAL_STATUS,
  entryQualifiesForTotals,
  markArrivalUnverified,
} from '../src/usage-settled.js';
import {
  readAgentBook,
  bindBookVerifier,
  exportAgentBook,
  buildBookExportCsv,
  totalsOf,
} from '../src/agent-book.js';
import { recordBookInflow, correctBookInflow } from '../src/book-inflow.js';

function collectedReceipt(over = {}) {
  return {
    task_id: over.task_id || 'task-1',
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || 'base:0xabc',
      collected: true,
      gross_amount: over.amount || '10000',
    },
    route: { model: over.model || 'xfuel/auto', hub: over.hub || 'mock' },
  };
}

describe('UNVERIFIED evidence', () => {
  test('deriveEvidence marks missing payment_ref as UNVERIFIED', () => {
    const entry = {
      task_id: 'gap-1',
      payment_ref: null,
      collected: true,
      amount: '5000',
      rail: 'usdc',
      agent_id: 1,
    };
    assert.equal(deriveEvidence(entry), BOOK_EVIDENCE.UNVERIFIED);
    assert.equal(entryQualifiesForTotals(entry), false);
  });

  test('deriveEvidence marks missing amount as UNVERIFIED', () => {
    const entry = {
      task_id: 'gap-2',
      payment_ref: 'base:0x1',
      collected: true,
      amount: null,
      rail: 'usdc',
      agent_id: 1,
    };
    assert.equal(deriveEvidence(entry), BOOK_EVIDENCE.UNVERIFIED);
  });

  test('book and export render UNVERIFIED with null amount — not zero', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 'ok-1', ref: 'base:0xok' }), {
      ledger,
      registry,
    });

    ledger.entries.push({
      task_id: 'unverified-1',
      payment_ref: null,
      payer: null,
      agent_id: recorded.agent_id,
      collected: true,
      evidence: BOOK_EVIDENCE.UNVERIFIED,
      rail: 'usdc',
      amount: '99999',
      collected_at: new Date().toISOString(),
      recorded_at: new Date().toISOString(),
      model: 'xfuel/auto',
      hub: 'mock',
    });

    const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.status, 200);
    const unverified = book.body.entries.find((e) => e.task_id === 'unverified-1');
    assert.ok(unverified);
    assert.equal(unverified.evidence, 'UNVERIFIED');
    assert.equal(unverified.payment.amount, null);
    assert.equal(unverified.collected, false);
    assert.equal(book.body.totals.usdc_sum, '10000');

    const exported = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'json' }, {
      ledger,
      verify: bindBookVerifier(registry),
      baseUrl: 'https://api.chit402.com',
    });
    const row = exported.body.rows.find((r) => r.task_id === 'unverified-1');
    assert.equal(row.evidence, 'UNVERIFIED');
    assert.equal(row.amount, null);

    const csv = buildBookExportCsv(ledger.listByAgent(recorded.agent_id), recorded.agent_id, 'https://api.chit402.com');
    assert.match(csv, /unverified-1,UNVERIFIED/);
    assert.doesNotMatch(csv, /unverified-1,UNVERIFIED,[^,]*,[^,]*,99999/);
  });

  test('totalsOf excludes UNVERIFIED rows', () => {
    const entries = [
      { payment_ref: 'base:0x1', amount: '1000', collected: true, rail: 'usdc', evidence: 'collected' },
      { payment_ref: null, amount: '9000', collected: true, rail: 'usdc' },
    ];
    const totals = totalsOf(entries);
    assert.equal(totals.count, 1);
    assert.equal(totals.usdc_sum, '1000');
  });
});

describe('settle-time book row', () => {
  test('recordSettleBookRow writes RECORDED_BY_SETTLE (not collected until ingress)', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const payer = '0x1234567890123456789012345678901234567890';
    const recorded = recordSettleBookRow({
      taskId: 'xfuel-settle-1',
      paymentRef: 'base:0xsettleabc',
      amount: '2000',
      payer,
      model: 'theta/qwen3',
      hub: 'theta',
      ledger,
      registry,
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.duplicate, false);
    assert.equal(recorded.entry.task_id, 'xfuel-settle-1');
    assert.equal(recorded.entry.payment_ref, 'base:0xsettleabc');
    assert.equal(recorded.entry.payer, payer);
    assert.equal(recorded.entry.amount, '2000');
    assert.equal(recorded.entry.recorded_by, 'settle');
    assert.equal(deriveEvidence(recorded.entry), BOOK_EVIDENCE.RECORDED_BY_SETTLE);
    assert.equal(entryQualifiesForTotals(recorded.entry), false);

    const byRef = ledger.findByRef('base:0xsettleabc');
    assert.equal(byRef.task_id, 'xfuel-settle-1');
  });

  test('ingress_receipt promotes RECORDED_BY_SETTLE to collected', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const settled = recordSettleBookRow({
      taskId: 'xfuel-arrival-1',
      paymentRef: 'base:0xarrival',
      amount: '5000',
      ledger,
      registry,
    });
    assert.equal(deriveEvidence(settled.entry), BOOK_EVIDENCE.RECORDED_BY_SETTLE);

    const afterReceipt = recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-arrival-1',
      ref: 'base:0xarrival',
      amount: '5000',
    }), {
      ledger,
      registry,
      agentId: settled.agent_id,
      payer: null,
    });
    assert.equal(afterReceipt.duplicate, true);
    assert.equal(deriveEvidence(afterReceipt.entry), BOOK_EVIDENCE.RECORDED_BY_SETTLE);

    afterReceipt.entry.ingress_receipt = { ref: 'base:0xarrival', confirmed_at: new Date().toISOString() };
    afterReceipt.entry.arrival_status = ARRIVAL_STATUS.CONFIRMED;
    afterReceipt.entry.evidence = BOOK_EVIDENCE.COLLECTED;
    assert.equal(deriveEvidence(afterReceipt.entry), BOOK_EVIDENCE.COLLECTED);
    assert.equal(entryQualifiesForTotals(afterReceipt.entry), true);
  });

  test('markArrivalUnverified sets ARRIVAL_UNVERIFIED with explicit omission', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const settled = recordSettleBookRow({
      taskId: 'xfuel-omit-1',
      paymentRef: 'base:0xomit',
      amount: '8000',
      ledger,
      registry,
    });
    const marked = markArrivalUnverified(ledger, 'xfuel-omit-1', settled.agent_id);
    assert.equal(marked.ok, true);
    assert.equal(deriveEvidence(marked.entry), BOOK_EVIDENCE.ARRIVAL_UNVERIFIED);
    assert.equal(entryQualifiesForTotals(marked.entry), false);

    const book = readAgentBook(settled.agent_id, { session: settled.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    const row = book.body.entries.find((e) => e.task_id === 'xfuel-omit-1');
    assert.equal(row.evidence, 'ARRIVAL_UNVERIFIED');
    assert.equal(row.payment.amount, null);
    assert.equal(row.omission_rule, 'no_ingress_receipt_at_cutoff');
    assert.equal(book.body.totals.usdc_sum, '0');
  });

  test('RECORDED_BY_SETTLE shows amount in book but excluded from totals', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const collected = recordCollectedSpend(collectedReceipt({ task_id: 'ok-collected', ref: 'base:0xok2' }), {
      ledger,
      registry,
    });
    const settled = recordSettleBookRow({
      taskId: 'xfuel-pending-1',
      paymentRef: 'base:0xpending',
      amount: '3000',
      ledger,
      registry,
      agentId: collected.agent_id,
    });

    const book = readAgentBook(collected.agent_id, { session: collected.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    const pending = book.body.entries.find((e) => e.task_id === 'xfuel-pending-1');
    assert.equal(pending.evidence, 'RECORDED_BY_SETTLE');
    assert.equal(pending.payment.amount, '3000');
    assert.equal(pending.collected, false);
    assert.equal(book.body.totals.usdc_sum, '10000');
  });

  test('recordSettleBookRow is idempotent on payment.ref', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const first = recordSettleBookRow({
      taskId: 'xfuel-idem-1',
      paymentRef: 'base:0xidem',
      amount: '1000',
      ledger,
      registry,
    });
    const second = recordSettleBookRow({
      taskId: 'xfuel-idem-1',
      paymentRef: 'base:0xidem',
      amount: '1000',
      ledger,
      registry,
      agentId: first.agent_id,
    });
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(ledger.entries.length, 1);
  });

  test('recordCollectedSpend after settle row is idempotent', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const settled = recordSettleBookRow({
      taskId: 'xfuel-post-1',
      paymentRef: 'base:0xpost',
      amount: '3000',
      payer: '0xabcdef1234567890abcdef1234567890abcdef12',
      model: 'xfuel/auto',
      ledger,
      registry,
    });
    const afterReceipt = recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-post-1',
      ref: 'base:0xpost',
      amount: '3000',
    }), {
      ledger,
      registry,
      agentId: settled.agent_id,
      payer: '0xabcdef1234567890abcdef1234567890abcdef12',
    });
    assert.equal(afterReceipt.ok, true);
    assert.equal(afterReceipt.duplicate, true);
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].payer, '0xabcdef1234567890abcdef1234567890abcdef12');
  });
});

describe('unaffiliated inflow (hemei)', () => {
  test('recordBookInflow writes signed inflow_claim row', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const collected = recordCollectedSpend(collectedReceipt({ task_id: 'seed-1', ref: 'base:0xseed' }), {
      ledger,
      registry,
    });
    const verify = bindBookVerifier(registry);

    const result = recordBookInflow(collected.agent_id, {
      bucket: 'patron',
      allocation: '15000',
      task_id: 'inflow-test-1',
      model: 'xfuel/auto',
    }, {
      ledger,
      registry,
      verify,
      claim: { session: collected.session },
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.bucket, 'patron');
    assert.equal(result.body.allocation, '15000');
    assert.ok(result.body.inflow_claim.signature.value.startsWith('sha256='));

    const entry = ledger.findByTask('inflow-test-1');
    assert.equal(deriveEvidence(entry), BOOK_EVIDENCE.INFLOW_CLAIMED);
    assert.equal(entryQualifiesForTotals(entry), true);

    const book = readAgentBook(collected.agent_id, { session: collected.session }, {
      ledger,
      verify,
      registry,
    });
    const row = book.body.entries.find((e) => e.task_id === 'inflow-test-1');
    assert.equal(row.evidence, 'inflow_claimed');
    assert.equal(row.bucket, 'patron');
    assert.equal(row.inflow_claim.allocation, '15000');
    assert.equal(book.body.totals.usdc_sum, '25000');
  });

  test('correctBookInflow appends correction without mutating original claim', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const collected = recordCollectedSpend(collectedReceipt({ task_id: 'seed-2', ref: 'base:0xseed2' }), {
      ledger,
      registry,
    });
    const verify = bindBookVerifier(registry);

    recordBookInflow(collected.agent_id, {
      bucket: 'treasury',
      allocation: '10000',
      task_id: 'inflow-correct-1',
    }, { ledger, registry, verify, claim: { session: collected.session } });

    const original = ledger.findByTask('inflow-correct-1');
    const originalClaim = { ...original.inflow_claim };

    const corrected = correctBookInflow(collected.agent_id, {
      task_id: 'inflow-correct-1',
      bucket: 'treasury',
      allocation: '12000',
      reason: 'allocation_adjusted',
    }, { ledger, registry, verify, claim: { session: collected.session } });

    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.allocation, '12000');
    assert.equal(corrected.body.inflow_corrections.length, 1);
    assert.deepEqual(original.inflow_claim, originalClaim);
    assert.equal(ledger.findByTask('inflow-correct-1').amount, '12000');

    const exported = exportAgentBook(collected.agent_id, { session: collected.session, format: 'json' }, {
      ledger,
      verify,
      baseUrl: 'https://api.chit402.com',
    });
    const row = exported.body.rows.find((r) => r.task_id === 'inflow-correct-1');
    assert.equal(row.evidence, 'inflow_claimed');
    assert.equal(row.amount, '12000');
    assert.equal(row.inflow_corrections.length, 1);

    const csv = buildBookExportCsv(ledger.listByAgent(collected.agent_id), collected.agent_id, 'https://api.chit402.com');
    assert.match(csv, /inflow-correct-1,inflow_claimed/);
  });
});
