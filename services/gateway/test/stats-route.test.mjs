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
  assert.ok(!JSON.stringify(body).includes('sender'));
});

test('GET /stats returns a standalone HTML dashboard by default', async () => {
  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /XFuel/);
  assert.match(html, /\?format=json/);
});
