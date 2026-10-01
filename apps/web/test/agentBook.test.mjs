import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  formatUsdc,
  formatUsd,
  parseUsdcInput,
  computeBurnRate,
  computeBookSummary,
  bookWindowQuery,
  entriesInWindow,
  computeModelMix,
  summarizePaymentRef,
  verifyUrlFor,
  auditorVerifyUrlFor,
  formatPayerWallet,
  resolveRowEvidence,
  evidenceLabel,
  evidenceBadgeTone,
  evidenceHint,
  replayParentTaskId,
  BOOK_EVIDENCE,
} = await import('../src/lib/agentBookCore.mjs');

test('formatUsdc renders atomic units', () => {
  assert.equal(formatUsdc('10000'), '0.01');
  assert.equal(formatUsdc('1000000'), '1');
  assert.equal(formatUsdc('0'), '0');
});

test('parseUsdcInput converts human amounts', () => {
  assert.equal(parseUsdcInput('1.5'), '1500000');
  assert.equal(parseUsdcInput('0.002'), '2000');
  assert.equal(parseUsdcInput(''), null);
  assert.equal(parseUsdcInput('bad'), null);
});

test('formatUsd shows $0.00 for zero and keeps sub-cent USDC', () => {
  assert.equal(formatUsd('0'), '$0.00');
  assert.equal(formatUsd(null), '$0.00');
  assert.equal(formatUsd('2000'), '$0.002');
  assert.equal(formatUsd('1500000'), '$1.5');
});

test('bookWindowQuery defaults the dashboard to the last 7 days', () => {
  const now = Date.parse('2026-10-01T00:00:00.000Z');
  const week = bookWindowQuery('7d', now);
  assert.equal(week.label, 'Last 7 days');
  assert.equal(week.from, '2026-09-24T00:00:00.000Z');
  assert.equal(week.to, null);
  assert.equal(bookWindowQuery('all', now).from, null);
  assert.equal(bookWindowQuery('24h', now).from, '2026-09-30T00:00:00.000Z');
});

test('computeBookSummary aggregates spend, payees, and verified receipts', () => {
  const summary = computeBookSummary([
    {
      task_id: 'paid-a',
      evidence: 'collected',
      collected: true,
      collected_at: '2026-09-30T00:00:00.000Z',
      route: { hub: 'Theta' },
      payment: { ref: 'base:1', rail: 'usdc', amount: '1000000' },
    },
    {
      task_id: 'paid-b',
      evidence: 'collected',
      collected: true,
      collected_at: '2026-09-30T01:00:00.000Z',
      route: { hub: 'theta' },
      payment: { ref: 'base:2', rail: 'usdc', amount: '500000' },
    },
    {
      task_id: 'paid-c',
      evidence: 'foreign_ingest',
      collected: true,
      collected_at: '2026-09-30T02:00:00.000Z',
      pay_to: '0xVendor',
      route: { hub: 'other' },
      payment: { ref: 'base:3', rail: 'usdc', amount: '250000' },
    },
    {
      task_id: 'gap',
      evidence: 'UNVERIFIED',
      collected: true,
      collected_at: '2026-09-30T03:00:00.000Z',
      route: { hub: 'akash' },
      payment: { ref: '', rail: 'usdc', amount: '999' },
    },
    {
      task_id: 'blocked',
      evidence: 'policy_blocked',
      event: 'policy_blocked',
      collected_at: '2026-09-30T04:00:00.000Z',
      route: { hub: 'openrouter' },
      payment: { ref: '—', rail: 'usdc', amount: null },
    },
  ]);
  assert.equal(summary.spend_atomic, '1750000');
  assert.equal(summary.payments, 3);
  assert.equal(summary.vendors_paid, 2);
  assert.equal(summary.receipts, 5);
  assert.equal(summary.receipts_verified, 3);
  assert.equal(summary.verified_percent, 60);
});

test('computeBookSummary is zeroed when there are no receipts', () => {
  const summary = computeBookSummary([]);
  assert.deepEqual(summary, {
    spend_atomic: '0',
    payments: 0,
    vendors_paid: 0,
    receipts: 0,
    receipts_verified: 0,
    verified_percent: 0,
  });
  assert.equal(formatUsd(summary.spend_atomic), '$0.00');
});

test('entriesInWindow drops rows outside the selected bounds', () => {
  const rows = [
    { task_id: 'old', collected_at: '2026-09-01T00:00:00.000Z', payment: { ref: 'a', rail: 'usdc', amount: '1' } },
    { task_id: 'new', collected_at: '2026-09-30T00:00:00.000Z', payment: { ref: 'b', rail: 'usdc', amount: '2' } },
  ];
  const kept = entriesInWindow(rows, '2026-09-24T00:00:00.000Z', null);
  assert.deepEqual(kept.map((row) => row.task_id), ['new']);
});

test('computeBurnRate sums rows in window', () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const rate = computeBurnRate([
    { task_id: 'a', payment: { ref: 'x', rail: 'usdc', amount: '1000000' }, collected_at: now },
    { task_id: 'b', payment: { ref: 'y', rail: 'usdc', amount: '500000' }, collected_at: old },
  ], 24);
  assert.equal(rate.rowCount, 1);
  assert.equal(rate.spentUnits, 1000000n);
  assert.equal(rate.perDay, '1');
});

test('computeModelMix groups by hub and model', () => {
  const mix = computeModelMix([
    {
      task_id: '1',
      payment: { ref: 'a', rail: 'usdc', amount: '3000000' },
      route: { hub: 'theta', model: 'theta/glm' },
      collected_at: null,
    },
    {
      task_id: '2',
      payment: { ref: 'b', rail: 'usdc', amount: '1000000' },
      route: { hub: 'akash', model: 'xfuel/auto' },
      collected_at: null,
    },
  ]);
  assert.equal(mix.length, 2);
  assert.equal(mix[0].model, 'theta/glm');
  assert.equal(mix[0].pct, 75);
});

test('verifyUrlFor and auditorVerifyUrlFor build receipt URLs', () => {
  const host = 'https://api.chit402.com';
  assert.equal(verifyUrlFor('task-1', host), 'https://api.chit402.com/receipt/task-1');
  assert.equal(auditorVerifyUrlFor('task-1', host), 'https://api.chit402.com/receipt/task-1?format=auditor');
});

test('formatPayerWallet shortens long addresses', () => {
  const long = '0x' + 'a'.repeat(40);
  const short = formatPayerWallet(long);
  assert.ok(short.includes('…'));
  assert.equal(formatPayerWallet('0xabc'), '0xabc');
  assert.equal(formatPayerWallet(null), null);
});

test('summarizePaymentRef truncates long refs', () => {
  const short = summarizePaymentRef('base:0xabc', 'usdc');
  assert.equal(short, 'usdc:base:0xabc');
  const long = summarizePaymentRef('base:0x' + 'a'.repeat(40), 'usdc');
  assert.ok(long.includes('…'));
});

test('resolveRowEvidence prefers API field and legacy fallbacks', () => {
  assert.equal(resolveRowEvidence({ evidence: 'inflow_claimed' }), 'inflow_claimed');
  assert.equal(resolveRowEvidence({ event: 'policy_blocked' }), 'policy_blocked');
  assert.equal(resolveRowEvidence({ collected: false, payment: { amount: null } }), 'UNVERIFIED');
  assert.equal(resolveRowEvidence({ payment: { amount: '1' } }), 'collected');
});

test('evidenceLabel and evidenceBadgeTone map known statuses', () => {
  assert.equal(evidenceLabel(BOOK_EVIDENCE.RECORDED_BY_SETTLE), 'Recorded at settle');
  assert.equal(evidenceBadgeTone(BOOK_EVIDENCE.COLLECTED), 'green');
  assert.equal(evidenceBadgeTone(BOOK_EVIDENCE.POLICY_BLOCKED), 'danger');
  assert.ok(evidenceHint(BOOK_EVIDENCE.INFLOW_CLAIMED).includes('bucket'));
});

test('replayParentTaskId resolves canonical task', () => {
  assert.equal(replayParentTaskId({ task_id: 'a', replay_of: 'parent-1' }), 'parent-1');
  assert.equal(
    replayParentTaskId({ task_id: 'a', replay_events: [{ replay_of: 'a' }] }),
    'a',
  );
  assert.equal(replayParentTaskId({ task_id: 'solo' }), 'solo');
});
