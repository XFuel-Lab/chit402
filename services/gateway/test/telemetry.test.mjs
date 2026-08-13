import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageStats, renderStatsHtml } from '../src/telemetry.js';

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0);
const hoursAgo = (h) => NOW - h * 3600 * 1000;

// These fixtures pre-date the settled-gross fix, so the money window would
// exclude them. They exercise aggregation, not the historical data question —
// that has its own test below.
const ALL = { now: NOW, feeTrustFrom: 'all' };

function task(over = {}) {
  return {
    taskId: `t-${Math.random().toString(36).slice(2)}`,
    intent: { type: 'inference_request', model: 'llama-3-70b', amount: '1000000', paymentRail: 'tfuel' },
    meta: { provider: 'edgecloud', chain: 'theta' },
    status: 'fee_collected',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    feeAmount: '5000',
    netAmount: '995000',
    sp1Proof: { proof: '0xabc', nullifier: '0xnull' },
    ...over,
  };
}

test('computeUsageStats: totals, statuses, providers, proof outcomes', () => {
  const tasks = [
    task(),
    task({ status: 'completed' }),
    task({ status: 'failed', sp1Proof: null }),
    task({ status: 'pending', sp1Proof: null }),
    task({ sp1Proof: { error: 'prover down' } }), // regenerable
  ];
  const s = computeUsageStats(tasks, { now: NOW });

  assert.equal(s.tasks.total, 5);
  assert.equal(s.tasks.settled, 3); // completed + 2×fee_collected (default status)
  assert.equal(s.tasks.by_status.fee_collected, 2);
  assert.equal(s.tasks.by_status.failed, 1);
  assert.equal(s.tasks.by_provider.edgecloud, 5);
  assert.equal(s.proofs.valid, 2);
  assert.equal(s.proofs.regenerable, 1);
  assert.equal(s.proofs.invalid, 1); // failed status, no proof
  assert.equal(s.proofs.pending, 1);
  assert.equal(s.proofs.proven_pct, 40); // 2/5
});

test('computeUsageStats: per-rail sums use BigInt and never cross rails', () => {
  const tasks = [
    task({ intent: { type: 'inference_request', amount: '1000000', paymentRail: 'usdc' }, feeAmount: '5000', netAmount: '995000' }),
    task({ intent: { type: 'inference_request', amount: '2000000', paymentRail: 'usdc' }, feeAmount: '10000', netAmount: '1990000' }),
    task({ intent: { type: 'inference_request', amount: '500000000000000000', paymentRail: 'tfuel' }, feeAmount: '2500000000000000', netAmount: '497500000000000000' }),
  ];
  const s = computeUsageStats(tasks, ALL);

  assert.equal(s.payments.by_rail.usdc.count, 2);
  assert.equal(s.payments.by_rail.usdc.fee_amount, '15000');
  assert.equal(s.payments.by_rail.usdc.gross_amount, '3000000');
  assert.equal(s.payments.by_rail.tfuel.count, 1);
  assert.equal(s.payments.by_rail.tfuel.fee_amount, '2500000000000000');
});

test('computeUsageStats: activity windows + first/last seen', () => {
  const tasks = [
    task({ createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }),       // in 24h + 7d
    task({ createdAt: hoursAgo(30), updatedAt: hoursAgo(30) }),      // in 7d only
    task({ createdAt: hoursAgo(24 * 10), updatedAt: hoursAgo(24 * 9) }), // older
  ];
  const s = computeUsageStats(tasks, { now: NOW });
  assert.equal(s.activity.last_24h, 1);
  assert.equal(s.activity.last_7d, 2);
  assert.equal(new Date(s.activity.first_seen).getTime(), hoursAgo(24 * 10));
  assert.equal(new Date(s.activity.last_seen).getTime(), hoursAgo(2));
});

test('computeUsageStats: empty input yields safe zeros', () => {
  const s = computeUsageStats([], { now: NOW });
  assert.equal(s.tasks.total, 0);
  assert.equal(s.proofs.proven_pct, 0);
  assert.equal(s.payments.by_rail.usdc.fee_amount, '0');
  assert.equal(s.payments.by_rail.tfuel.count, 0);
});

test('computeUsageStats: tolerates malformed amounts without throwing', () => {
  const tasks = [task({ feeAmount: 'not-a-number', netAmount: null, intent: { type: 'inference_request', amount: undefined, paymentRail: 'usdc' } })];
  const s = computeUsageStats(tasks, ALL);
  assert.equal(s.payments.by_rail.usdc.fee_amount, '0');
  assert.equal(s.payments.by_rail.usdc.count, 1);
});

// ── Pre-fix rows must not inflate reported revenue ───────────────────────────
// Before gross was derived from the settled x402 payment, a caller could declare
// any amount: our own demo declared $1.00 while paying $0.01, so historical fees
// read ~100x high. Counts stay honest; only money is windowed.

const CUTOFF = '2026-08-12T00:00:00Z';
const beforeFix = Date.parse('2026-08-10T12:00:00Z');
const afterFix = Date.parse('2026-08-13T12:00:00Z');
const usdcTask = (createdAt, feeAmount, amount) => task({
  createdAt,
  updatedAt: createdAt,
  intent: { type: 'inference_request', amount, paymentRail: 'usdc' },
  feeAmount,
  netAmount: '0',
});

test('fees from before the settled-gross fix are excluded from the totals', () => {
  const s = computeUsageStats([
    usdcTask(beforeFix, '5000', '1000000'), // declared $1.00, actually paid $0.01
    usdcTask(afterFix, '50', '10000'),      // honest row
  ], { now: afterFix, feeTrustFrom: CUTOFF });

  // Only the honest row's fee is summed — the inflated one would be 100x it.
  assert.equal(s.payments.by_rail.usdc.fee_amount, '50');
  assert.equal(s.payments.by_rail.usdc.gross_amount, '10000');
  // But the task itself is still counted: we are correcting money, not history.
  assert.equal(s.payments.by_rail.usdc.count, 2);
  assert.equal(s.tasks.total, 2);
});

test('the excluded rows are reported rather than silently dropped', () => {
  const s = computeUsageStats([
    usdcTask(beforeFix, '5000', '1000000'),
    usdcTask(afterFix, '50', '10000'),
  ], { now: afterFix, feeTrustFrom: CUTOFF });

  assert.equal(s.payments.fee_basis.excluded_tasks, 1);
  assert.equal(Date.parse(s.payments.fee_basis.trusted_from), Date.parse(CUTOFF));
  assert.match(s.payments.fee_basis.note, /overstate/);
});

test('the 7d north-star fee excludes pre-fix rows too', () => {
  // The headline figure is the one most likely to be quoted, so it must not be
  // the one place the inflation survives.
  const s = computeUsageStats([
    usdcTask(beforeFix, '5000', '1000000'),
    usdcTask(afterFix, '50', '10000'),
  ], { now: afterFix, feeTrustFrom: CUTOFF });

  assert.equal(s.north_star.usdc_fees_7d, '50');
  // Task counts are unaffected — both settled, both inside 7 days.
  assert.equal(s.north_star.usdc_paid_tasks_7d, 2);
});

test('a task with no timestamp cannot be trusted for money', () => {
  const s = computeUsageStats([
    task({ createdAt: undefined, updatedAt: undefined, intent: { type: 'inference_request', amount: '1000000', paymentRail: 'usdc' }, feeAmount: '5000' }),
  ], { now: afterFix, feeTrustFrom: CUTOFF });

  assert.equal(s.payments.by_rail.usdc.fee_amount, '0');
  assert.equal(s.payments.fee_basis.excluded_tasks, 1);
});

test('renderStatsHtml: renders a standalone page with the headline numbers', () => {
  const s = computeUsageStats([task(), task({ status: 'completed' })], { now: NOW });
  const html = renderStatsHtml(s);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /XFuel/);
  assert.match(html, /network activity|Tasks total/);
  assert.match(html, /\?format=json/); // link to machine-readable view
});
