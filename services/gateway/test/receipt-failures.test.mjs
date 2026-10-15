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
process.env.OPS_READ_TOKEN = 'owner-test-token';
delete process.env.RECEIPT_FAILURES_TOKEN;

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

const OPS = 'owner-test-token';
const exportUrl = () => `${base}/v1/ops/receipt-failures`;

function bodyHidesTokens(text, ...secrets) {
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false);
  }
}

test('GET /v1/ops/receipt-failures with no token is 401', async () => {
  process.env.OPS_READ_TOKEN = OPS;
  const res = await fetch(exportUrl());
  const text = await res.text();
  assert.equal(res.status, 401);
  bodyHidesTokens(text, OPS);
  assert.equal(JSON.parse(text).error, 'unauthorized');
});

test('GET /v1/ops/receipt-failures with a wrong token is 401', async () => {
  process.env.OPS_READ_TOKEN = OPS;
  const wrong = 'wrong-token-value';
  const res = await fetch(exportUrl(), {
    headers: { authorization: `Bearer ${wrong}` },
  });
  const text = await res.text();
  assert.equal(res.status, 401);
  bodyHidesTokens(text, OPS, wrong);
  const header = await fetch(exportUrl(), {
    headers: { 'x-receipt-failures-token': OPS },
  });
  assert.equal(header.status, 401);
  const query = await fetch(`${exportUrl()}?token=${encodeURIComponent(OPS)}`);
  assert.equal(query.status, 401);
});

test('GET /v1/ops/receipt-failures with a valid token returns the rows', async () => {
  process.env.OPS_READ_TOKEN = OPS;
  resetReceiptFailuresForTests();
  recordReceiptFailure({
    stage: 'sign',
    outcome: 'refused',
    reason: 'sign_failed',
    network: 'solana',
    requestId: 'req-2',
  });
  const res = await fetch(exportUrl(), {
    headers: { authorization: `Bearer ${OPS}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.failures.length, 1);
  assert.equal(body.failures[0].stage, 'sign');
  assert.equal(JSON.stringify(body).includes('payer'), false);
  const csv = await fetch(`${exportUrl()}?format=csv`, {
    headers: { authorization: `Bearer ${OPS}` },
  });
  assert.equal(csv.headers.get('content-type').includes('text/csv'), true);
  const csvText = await csv.text();
  assert.equal(csvText.includes('sign_failed'), true);
  assert.equal(csvText.includes(OPS), false);
  const health = await fetch(`${base}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.receipt_failures, receiptFailureCount());
  assert.equal(healthBody.receipt_failures >= 1, true);
});

test('GET /v1/ops/receipt-failures is disabled when OPS_READ_TOKEN is unset', async () => {
  const saved = process.env.OPS_READ_TOKEN;
  delete process.env.OPS_READ_TOKEN;
  const res = await fetch(exportUrl(), {
    headers: { authorization: `Bearer ${OPS}` },
  });
  const text = await res.text();
  process.env.OPS_READ_TOKEN = saved;
  assert.equal(res.status, 503);
  bodyHidesTokens(text, OPS);
  assert.equal(JSON.parse(text).error, 'disabled');
});

test('the export is GET-only and the read token opens nothing else', async () => {
  process.env.OPS_READ_TOKEN = OPS;
  const post = await fetch(exportUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPS}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const postBody = await post.json();
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal(postBody.error, 'method_not_allowed');
  assert.equal(postBody.accepts, undefined);
  assert.equal(post.headers.get('payment-required'), null);
  const door = await fetch(`${base}/v1/internal/door-metrics`, {
    headers: { authorization: `Bearer ${OPS}` },
  });
  assert.notEqual(door.status, 200);
  await door.text();
});
});
