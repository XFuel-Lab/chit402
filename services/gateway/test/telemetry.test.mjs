import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageStats, renderStatsHtml } from '../src/telemetry.js';

const NOW = Date.UTC(2026, 6, 13, 12, 0, 0);
const hoursAgo = (h) => NOW - h * 3600 * 1000;

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
  const s = computeUsageStats(tasks, { now: NOW });

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
  const s = computeUsageStats(tasks, { now: NOW });
  assert.equal(s.payments.by_rail.usdc.fee_amount, '0');
  assert.equal(s.payments.by_rail.usdc.count, 1);
});

test('renderStatsHtml: renders a standalone page with the headline numbers', () => {
  const s = computeUsageStats([task(), task({ status: 'completed' })], { now: NOW });
  const html = renderStatsHtml(s);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /XFuel/);
  assert.match(html, /network activity|Tasks total/);
  assert.match(html, /\?format=json/); // link to machine-readable view
});
