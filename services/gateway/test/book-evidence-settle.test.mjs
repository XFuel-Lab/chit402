/**
 * Book evidence (UNVERIFIED) + settle-time ledger row (hemei).
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
  entryQualifiesForTotals,
} from '../src/usage-settled.js';
import {
  readAgentBook,
  bindBookVerifier,
  exportAgentBook,
  buildBookExportCsv,
  totalsOf,
} from '../src/agent-book.js';

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
  test('recordSettleBookRow writes ledger row bound to payment.ref and payer', () => {
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
    assert.equal(recorded.entry.evidence, BOOK_EVIDENCE.COLLECTED);
    assert.equal(deriveEvidence(recorded.entry), BOOK_EVIDENCE.COLLECTED);

    const byRef = ledger.findByRef('base:0xsettleabc');
    assert.equal(byRef.task_id, 'xfuel-settle-1');
    const byTask = ledger.findByTask('xfuel-settle-1');
    assert.equal(byTask.payment_ref, 'base:0xsettleabc');
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
