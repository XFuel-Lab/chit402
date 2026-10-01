/**
 * Principal dashboard summary: spend, payments, distinct payees,
 * receipts that verify. The aggregate covers the scoped universe,
 * not only the last-N page. CSV export already exists; the same
 * from/to window is what the dashboard Export CSV button sends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from '../src/agent-registry.js';
import {
  UsageSettledLedger,
  recordCollectedSpend,
  BOOK_EVIDENCE,
} from '../src/usage-settled.js';
import {
  readAgentBook,
  bindBookVerifier,
  exportAgentBook,
  summarizeBookWindow,
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

function bookOf(rows) {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  let recorded = null;
  for (const row of rows) {
    recorded = recordCollectedSpend(collectedReceipt(row), { ledger, registry, agentId: recorded?.agent_id });
    assert.equal(recorded.ok, true, recorded.reason);
    if (row.collected_at) {
      const entry = ledger.findByTask(row.task_id);
      entry.collected_at = row.collected_at;
    }
    if (row.pay_to) {
      ledger.findByTask(row.task_id).pay_to = row.pay_to;
    }
  }
  return { ledger, registry, recorded };
}

test('summarizeBookWindow is zeroed for an empty set', () => {
  const summary = summarizeBookWindow([]);
  assert.equal(summary.spend_atomic, '0');
  assert.equal(summary.payments, 0);
  assert.equal(summary.vendors_paid, 0);
  assert.equal(summary.receipts, 0);
  assert.equal(summary.receipts_verified, 0);
  assert.equal(summary.verified_percent, 0);
});

test('book summary counts the full window, not the last-N page', () => {
  const recent = '2026-09-30T12:00:00.000Z';
  const old = '2026-08-01T12:00:00.000Z';
  const { ledger, registry, recorded } = bookOf([
    { task_id: 'old-theta', ref: 'base:old', amount: '9000000', hub: 'theta', collected_at: old },
    { task_id: 'new-theta', ref: 'base:t', amount: '1000000', hub: 'Theta', collected_at: recent },
    { task_id: 'new-akash', ref: 'base:a', amount: '500000', hub: 'akash', collected_at: recent },
    { task_id: 'new-vendor', ref: 'base:v', amount: '250000', hub: 'ignored', pay_to: '0xVendor', collected_at: recent },
  ]);
  const agentId = recorded.agent_id;
  ledger.entries.push({
    task_id: 'unverified-1',
    payment_ref: null,
    agent_id: agentId,
    collected: true,
    evidence: BOOK_EVIDENCE.UNVERIFIED,
    rail: 'usdc',
    amount: '99999',
    hub: 'akash',
    collected_at: recent,
    recorded_at: recent,
  });
  ledger.entries.push({
    task_id: 'blocked-1',
    payment_ref: null,
    agent_id: agentId,
    collected: false,
    evidence: BOOK_EVIDENCE.POLICY_BLOCKED,
    event: 'policy_blocked',
    rail: 'usdc',
    amount: null,
    hub: 'openrouter',
    collected_at: recent,
    recorded_at: recent,
  });

  const from = '2026-09-24T00:00:00.000Z';
  const book = readAgentBook(agentId, { session: recorded.session, from, limit: 1 }, {
    ledger,
    verify: bindBookVerifier(registry),
    registry,
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.entries.length, 1);
  assert.equal(book.body.summary.spend_atomic, '1750000');
  assert.equal(book.body.summary.payments, 3);
  assert.equal(book.body.summary.vendors_paid, 3);
  assert.equal(book.body.summary.receipts, 5);
  assert.equal(book.body.summary.receipts_verified, 3);
  assert.equal(book.body.summary.verified_percent, 60);
  assert.equal(book.body.summary.from, from);
  assert.ok(book.body.entries.every((row) => row.task_id !== 'old-theta'));
});

test('a window with no rows still returns a zero summary', () => {
  const { ledger, registry, recorded } = bookOf([
    { task_id: 'only', ref: 'base:only', amount: '1000', hub: 'theta' },
  ]);
  const from = '2099-01-01T00:00:00.000Z';
  const book = readAgentBook(recorded.agent_id, { session: recorded.session, from }, {
    ledger,
    verify: bindBookVerifier(registry),
    registry,
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.entries.length, 0);
  assert.equal(book.body.summary.spend_atomic, '0');
  assert.equal(book.body.summary.payments, 0);
  assert.equal(book.body.summary.vendors_paid, 0);
  assert.equal(book.body.summary.receipts_verified, 0);
  assert.equal(book.body.summary.verified_percent, 0);
});

test('existing CSV export honors the same from bound the dashboard sends', () => {
  const { ledger, registry, recorded } = bookOf([
    { task_id: 'old-row', ref: 'base:oldrow', amount: '1000', hub: 'theta', collected_at: '2026-08-01T00:00:00.000Z' },
    { task_id: 'new-row', ref: 'base:newrow', amount: '2000', hub: 'akash', collected_at: '2026-09-30T00:00:00.000Z' },
  ]);
  const csv = exportAgentBook(recorded.agent_id, {
    session: recorded.session,
    format: 'csv',
    limit: 200,
    from: '2026-09-24T00:00:00.000Z',
  }, {
    ledger,
    verify: bindBookVerifier(registry),
    registry,
  });
  assert.equal(csv.status, 200);
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
  assert.match(csv.body, /new-row/);
  assert.doesNotMatch(csv.body, /old-row/);
  assert.match(csv.body, /verify_url/);
});
