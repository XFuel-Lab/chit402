/**
 * Public /health copy that visitors check against the site.
 * server stays xfuel-m2m-api: no in-repo weekday hosts smoke matches it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.M2M_DEMO_MODE = 'true';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');

let server;
let base;

before(async () => {
  const app = createApp();
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

test('GET /health lists Solana, drops post-TGE buckets, and does not advertise a free demo key', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.server, 'xfuel-m2m-api');
  assert.ok(body.chains.includes('base'));
  assert.ok(body.chains.includes('solana'));
  const split = body.fee_config.revenue_split;
  assert.equal(split.post_tge, undefined);
  const dumped = JSON.stringify(split);
  assert.doesNotMatch(dumped, /Buyback|veXF/);
  assert.match(body.demo.note, /do not grant free completions/);
  assert.doesNotMatch(body.demo.note, /Public demo key is rate-limited/);
});
