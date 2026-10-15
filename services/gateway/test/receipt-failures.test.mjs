import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordReceiptFailure,
  listReceiptFailures,
  receiptFailureCount,
  receiptFailureCsv,
  resetReceiptFailuresForTests,
} from '../src/receipt-failures.js';

process.env.M2M_DEMO_MODE = 'true';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_FAILURES_TOKEN = 'owner-test-token';

const { createApp } = await import('../src/server.js');

let server;
let base;

before(async () => {
  resetReceiptFailuresForTests();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  resetReceiptFailuresForTests();
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('receipt failures', { concurrency: 1 }, () => {
test('a failure row keeps the review fields and drops payer and payload', () => {
  resetReceiptFailuresForTests();
  const row = recordReceiptFailure({
    stage: 'confirm',
    outcome: 'pending',
    reason: 'settle_unconfirmed',
    network: 'base',
    tx: '0x' + 'ab'.repeat(32),
    requestId: 'req-1',
    payer: '0x5555555555555555555555555555555555555555',
    payload: { authorization: 'nope' },
  });
  assert.deepEqual(Object.keys(row).sort(), [
    'network', 'outcome', 'reason', 'request_id', 'stage', 'time', 'tx',
  ]);
  assert.equal(row.payer, undefined);
  assert.equal(row.payload, undefined);
  assert.equal(row.request_id, 'req-1');
  const older = recordReceiptFailure({
    time: '2020-01-01T00:00:00.000Z',
    stage: 'pre-check',
    outcome: 'refused',
    reason: 'network_not_accepted',
    network: 'base',
  });
  const since = listReceiptFailures({ since: row.time });
  assert.equal(since.some((item) => item.time === older.time), false);
  assert.equal(since.length, 1);
  const csv = receiptFailureCsv(listReceiptFailures());
  assert.equal(csv.includes('payer'), false);
  assert.equal(csv.includes('authorization'), false);
  assert.equal(csv.split('\n')[0], 'time,network,stage,reason,tx,outcome,request_id');
});

test('GET /v1/ops/receipt-failures is owner-only JSON and CSV, and /health counts rows', async () => {
  resetReceiptFailuresForTests();
  recordReceiptFailure({
    stage: 'sign',
    outcome: 'refused',
    reason: 'sign_failed',
    network: 'solana',
    requestId: 'req-2',
  });
  const saved = process.env.RECEIPT_FAILURES_TOKEN;
  delete process.env.RECEIPT_FAILURES_TOKEN;
  const open = await fetch(`${base}/v1/ops/receipt-failures`);
  process.env.RECEIPT_FAILURES_TOKEN = saved;
  assert.equal(open.status, 503);
  const denied = await fetch(`${base}/v1/ops/receipt-failures`, {
    headers: { authorization: 'Bearer wrong' },
  });
  assert.equal(denied.status, 401);
  const res = await fetch(`${base}/v1/ops/receipt-failures`, {
    headers: { authorization: 'Bearer owner-test-token' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.failures.length, 1);
  assert.equal(body.failures[0].stage, 'sign');
  assert.equal(JSON.stringify(body).includes('payer'), false);
  const csv = await fetch(`${base}/v1/ops/receipt-failures?format=csv`, {
    headers: { 'x-receipt-failures-token': 'owner-test-token' },
  });
  assert.equal(csv.headers.get('content-type').includes('text/csv'), true);
  assert.equal((await csv.text()).includes('sign_failed'), true);
  const health = await fetch(`${base}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.receipt_failures, receiptFailureCount());
  assert.equal(healthBody.receipt_failures >= 1, true);
});
});
