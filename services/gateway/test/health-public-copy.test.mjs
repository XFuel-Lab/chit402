/**
 * Public /health is status, the last anchored root and tx, and free tier available.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.M2M_DEMO_MODE = 'true';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.GATEWAY_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

const { createApp } = await import('../src/server.js');

let server;
let base;

before(async () => {
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health keeps only status, the last anchor, and free tier available', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.status === 'ok' || body.status === 'degraded');
  assert.equal(body.free_tier, 'available');
  assert.ok('last_anchored_root' in body);
  assert.ok('last_anchored_tx' in body);
  assert.deepEqual(Object.keys(body).sort(), [
    'anchor_lag_s',
    'commit',
    'free_tier',
    'issuance',
    'last_anchored_root',
    'last_anchored_tx',
    'receipt_failures',
    'status',
    'unanchored_leaves',
  ]);
  assert.deepEqual(Object.keys(body.issuance.cap).sort(), ['day_used', 'hour_used', 'state']);
  assert.equal(body.issuance.cap.state, 'off');
  assert.equal(typeof body.receipt_failures, 'number');
  assert.equal(body.commit, 'fedcba9876543210fedcba9876543210fedcba98');
});
