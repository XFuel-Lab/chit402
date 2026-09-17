import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const METRICS_TOKEN = 'test-door-metrics-token-route';

process.env.DOOR_METRICS_TOKEN = METRICS_TOKEN;
process.env.TASK_STORE_PERSIST = 'false';
process.env.M2M_API_KEYS = '';

const { createApp } = await import('../src/server.js');

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
  delete process.env.DOOR_METRICS_TOKEN;
});

test('GET /v1/internal/door-metrics without token returns 401', async () => {
  const res = await fetch(`${base}/v1/internal/door-metrics`);
  assert.equal(res.status, 401);
});

test('GET /v1/internal/door-metrics with token returns JSON shape', async () => {
  const res = await fetch(`${base}/v1/internal/door-metrics`, {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'receipt_task_store');
  assert.ok(body.windows['24h']);
  assert.ok(body.windows['7d']);
  assert.equal(typeof body.windows['24h'].stamped_receipts, 'number');
  assert.ok(body.windows['24h'].by_network);
  assert.ok(!JSON.stringify(body).match(/0x[0-9a-fA-F]{40}/), 'must not leak raw payer addresses');
});
