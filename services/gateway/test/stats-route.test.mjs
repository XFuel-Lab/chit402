import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

// Boot the real Express app on an ephemeral port and exercise GET /stats end-to-end
// (route wiring + JSON/HTML negotiation + cache). No tasks are required — the store
// may be empty; we assert the public-safe shape either way.

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /stats?format=json returns aggregate, public-safe usage stats', async () => {
  const res = await fetch(`${base}/stats?format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json();

  // Shape is present and safe (no task ids / senders / outputs anywhere).
  assert.equal(body.window, 'all-time');
  assert.equal(typeof body.tasks.total, 'number');
  assert.ok(body.tasks.by_status && typeof body.tasks.by_status === 'object');
  assert.ok(body.payments.by_rail.usdc && body.payments.by_rail.tfuel);
  assert.equal(typeof body.payments.by_rail.usdc.fee_amount, 'string');
  assert.ok('proven_pct' in body.proofs);
  assert.ok('last_24h' in body.activity);
  assert.ok(body.north_star);
  assert.equal(typeof body.north_star.paid_tasks_7d, 'number');
  assert.equal(typeof body.north_star.usdc_fees_7d, 'string');
  assert.ok(!JSON.stringify(body).includes('sender'));
});

test('GET /stats returns a standalone HTML dashboard by default', async () => {
  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Chit/);
  assert.match(html, /\?format=json/);
});

test('GET /stats?format=json includes public door aggregate without leakage', async () => {
  const res = await fetch(`${base}/stats?format=json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.door);
  assert.equal(typeof body.door.stamped_receipts_7d, 'number');
  assert.equal(typeof body.door.stamped_receipts_24h, 'number');
  assert.equal(typeof body.door.unique_payers_7d, 'number');
  assert.ok(!('by_network' in body.door));
  assert.ok(!('outcome' in body.door));
  const raw = JSON.stringify(body.door);
  assert.ok(!raw.match(/0x[0-9a-fA-F]{40}/), 'door must not leak raw payer addresses');
  assert.ok(!raw.includes('taskId'), 'door must not leak task ids');
  assert.ok(!raw.includes('paymentRef'), 'door must not leak payment refs');
});

test('GET /stats/door returns public-safe door shape', async () => {
  const res = await fetch(`${base}/stats/door`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json();
  assert.equal(typeof body.stamped_receipts_7d, 'number');
  assert.equal(typeof body.stamped_receipts_24h, 'number');
  assert.equal(typeof body.unique_payers_7d, 'number');
  assert.ok(body.definition);
  assert.ok(Array.isArray(body.series_30d), 'series_30d present for Activity sparklines');
  assert.equal(body.series_30d.length, 30);
  assert.equal(typeof body.series_30d[0].day, 'string');
  assert.equal(typeof body.series_30d[0].stamped_receipts, 'number');
  assert.equal(typeof body.series_30d[0].unique_payers, 'number');
  assert.ok(!('by_network' in body));
  assert.ok(!('windows' in body), 'must not expose private door-metrics windows shape');
  const raw = JSON.stringify(body);
  assert.ok(!raw.match(/0x[0-9a-fA-F]{40}/), 'must not leak raw payer addresses');
  assert.ok(!raw.includes('taskId'));
  assert.ok(!raw.includes('paymentRef'));
});
