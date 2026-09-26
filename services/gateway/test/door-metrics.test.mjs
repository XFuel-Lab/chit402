import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDoorMetrics,
  computePublicDoorAggregate,
  buildPublicDoorSeries,
  isDoorTrafficTask,
  networkBucketFromPaymentRef,
  doorMetricsAuthResult,
  extractDoorMetricsToken,
  PUBLIC_DOOR_DEFINITION,
} from '../src/door-metrics.js';

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const hoursAgo = (h) => NOW - h * 3600 * 1000;
const SOLANA_PAYER = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
const EVM_PAYER = '0x1234567890123456789012345678901234567890';

function doorTask(over = {}) {
  return {
    taskId: over.taskId || `door-${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    intent: {
      type: 'inference_request',
      sender: 'openai-gateway',
      paymentRail: 'usdc',
      paymentRef: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpSigExample111111111111111111111',
      amount: '2000',
    },
    meta: {
      source: 'openai-gateway',
      payerWallet: SOLANA_PAYER,
    },
    issuerSignature: { jws: 'eyJhbGciOiJFUzI1NiJ9.eyJ0YXNrf2lkIjoidCJ9.sig' },
    ...over,
  };
}

test('isDoorTrafficTask: requires stamped JWS, usdc paymentRef, openai-gateway source', () => {
  assert.equal(isDoorTrafficTask(doorTask()), true);
  assert.equal(isDoorTrafficTask(doorTask({ issuerSignature: null })), false);
  assert.equal(isDoorTrafficTask(doorTask({ intent: { paymentRail: 'usdc', paymentRef: null, sender: 'openai-gateway' } })), false);
  assert.equal(isDoorTrafficTask(doorTask({ meta: { source: 'ai_task' }, intent: { sender: 'ai_task', paymentRail: 'usdc', paymentRef: 'base:0xabc' } })), false);
  assert.equal(isDoorTrafficTask(doorTask({ meta: { source: 'foreign_ingest' } })), false);
});

test('networkBucketFromPaymentRef maps solana vs evm', () => {
  assert.equal(networkBucketFromPaymentRef('solana:abc'), 'solana');
  assert.equal(networkBucketFromPaymentRef('solana-devnet:abc'), 'solana');
  assert.equal(networkBucketFromPaymentRef('base:0xabc'), 'evm');
  assert.equal(networkBucketFromPaymentRef('base-sepolia:0xabc'), 'evm');
  assert.equal(networkBucketFromPaymentRef(null), 'unknown');
});

test('computeDoorMetrics: 24h and 7d windows, status, payers, network split', () => {
  const tasks = [
    doorTask({ taskId: 's1', createdAt: hoursAgo(2), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({
      taskId: 's2',
      createdAt: hoursAgo(2),
      intent: {
        sender: 'openai-gateway',
        paymentRail: 'usdc',
        paymentRef: 'base:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      meta: { source: 'openai-gateway', payerWallet: EVM_PAYER },
    }),
    doorTask({ taskId: 's3', status: 'failed', createdAt: hoursAgo(2), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({ taskId: 'old', createdAt: hoursAgo(24 * 10) }),
    doorTask({ taskId: 'm2m', meta: { source: 'ai_task' }, intent: { sender: 'ai_task', paymentRail: 'usdc', paymentRef: 'base:0x1' } }),
  ];

  const m = computeDoorMetrics(tasks, { now: NOW });
  assert.equal(m.windows['24h'].stamped_receipts, 3);
  assert.equal(m.windows['24h'].outcome.completed, 2);
  assert.equal(m.windows['24h'].outcome.failed, 1);
  assert.equal(m.windows['24h'].unique_payer_wallets, 2);
  assert.equal(m.windows['24h'].by_network.solana, 2);
  assert.equal(m.windows['24h'].by_network.evm, 1);
  assert.equal(m.windows['7d'].stamped_receipts, 3);
  assert.equal(m.windows['24h'].refunds_owed, 0);
  assert.equal(m.totals.door_stamped_all_time, 4);
});

test('computeDoorMetrics counts refund-owed rows for ops', () => {
  const tasks = [
    doorTask({
      taskId: 'owed',
      status: 'failed',
      meta: {
        source: 'openai-gateway',
        payerWallet: EVM_PAYER,
        refund: {
          refund_status: 'owed',
          amount: '2000',
          payer: EVM_PAYER,
          payment_ref: 'base:0xrefund',
        },
      },
    }),
    doorTask({ taskId: 'ok' }),
  ];
  const m = computeDoorMetrics(tasks, { now: NOW });
  assert.equal(m.windows['24h'].refunds_owed, 1);
  assert.equal(m.windows['24h'].stamped_receipts, 2);
});

test('doorMetricsAuthResult fails closed when token unset', () => {
  const r = doorMetricsAuthResult(null, 'secret');
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test('doorMetricsAuthResult accepts matching bearer token', () => {
  const r = doorMetricsAuthResult('house-token', 'house-token');
  assert.equal(r.ok, true);
  const bad = doorMetricsAuthResult('house-token', 'wrong');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
});

test('extractDoorMetricsToken reads Bearer and custom header', () => {
  assert.equal(extractDoorMetricsToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(extractDoorMetricsToken({ headers: { 'x-door-metrics-token': 'xyz' } }), 'xyz');
});

test('computePublicDoorAggregate: 7d/24h counts and unique payers only — no leakage', () => {
  const tasks = [
    doorTask({ taskId: 'p1', createdAt: hoursAgo(2), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({
      taskId: 'p2',
      createdAt: hoursAgo(2),
      intent: {
        sender: 'openai-gateway',
        paymentRail: 'usdc',
        paymentRef: 'base:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      meta: { source: 'openai-gateway', payerWallet: EVM_PAYER },
    }),
    doorTask({ taskId: 'p3', status: 'failed', createdAt: hoursAgo(2), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({ taskId: 'old', createdAt: hoursAgo(24 * 10) }),
    doorTask({ taskId: 'm2m', meta: { source: 'ai_task' }, intent: { sender: 'ai_task', paymentRail: 'usdc', paymentRef: 'base:0x1' } }),
  ];

  const pub = computePublicDoorAggregate(tasks, { now: NOW });
  assert.equal(pub.stamped_receipts_7d, 3);
  assert.equal(pub.stamped_receipts_24h, 3);
  assert.equal(pub.unique_payers_7d, 2);
  assert.equal(pub.definition, PUBLIC_DOOR_DEFINITION);
  assert.ok(!pub.definition.includes('openai-gateway'));
  assert.ok(Array.isArray(pub.series_30d), 'series_30d must be an array');
  assert.equal(pub.series_30d.length, 30, 'series_30d is ~30 daily buckets');
  assert.equal(typeof pub.series_30d[0].day, 'string');
  assert.equal(typeof pub.series_30d[0].stamped_receipts, 'number');
  assert.equal(typeof pub.series_30d[0].unique_payers, 'number');
  const seriesSum = pub.series_30d.reduce((n, d) => n + d.stamped_receipts, 0);
  assert.equal(seriesSum, 4, 'series includes 7d tasks plus 10d-old within 30d');

  const raw = JSON.stringify(pub);
  assert.ok(!raw.includes(SOLANA_PAYER), 'must not leak solana payer');
  assert.ok(!raw.includes(EVM_PAYER), 'must not leak evm payer');
  assert.ok(!raw.includes('p1'), 'must not leak task ids');
  assert.ok(!raw.includes('0xdeadbeef'), 'must not leak paymentRef / tx');
  assert.ok(!('by_network' in pub), 'no network split on public aggregate');
  assert.ok(!('outcome' in pub), 'no failed/debug outcome split on public aggregate');
  assert.ok(!('by_status' in pub), 'no status split on public aggregate');
});

test('buildPublicDoorSeries: 30 UTC day buckets, counts only', () => {
  const tasks = [
    doorTask({ taskId: 'd1', createdAt: hoursAgo(2), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({ taskId: 'd2', createdAt: hoursAgo(26), meta: { source: 'openai-gateway', payerWallet: EVM_PAYER } }),
    doorTask({ taskId: 'd3', createdAt: hoursAgo(24 * 5), meta: { source: 'openai-gateway', payerWallet: SOLANA_PAYER } }),
    doorTask({ taskId: 'old', createdAt: hoursAgo(24 * 40) }),
  ];
  const doorTasks = tasks.filter(isDoorTrafficTask);
  const series = buildPublicDoorSeries(doorTasks, NOW);
  assert.equal(series.length, 30);
  assert.equal(series[series.length - 1].day, '2026-09-20');
  assert.ok(series.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)));
  assert.ok(series.every((d) => typeof d.stamped_receipts === 'number' && typeof d.unique_payers === 'number'));
  const sum = series.reduce((n, d) => n + d.stamped_receipts, 0);
  assert.equal(sum, 3);
  const raw = JSON.stringify(series);
  assert.ok(!raw.includes(SOLANA_PAYER));
  assert.ok(!raw.includes(EVM_PAYER));
  assert.ok(!raw.includes('d1'));
});
