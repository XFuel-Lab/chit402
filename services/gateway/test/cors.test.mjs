/**
 * Browser CORS for principals' /book dashboard and M2M playgrounds.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'false';
delete process.env.M2M_CORS_ORIGIN;

const { createApp } = await import('../src/server.js');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('default allowlist reflects www.chit402.com and allows X-XFuel-Session', async () => {
  const res = await fetch(`${base}/v1/models`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://www.chit402.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-xfuel-session',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://www.chit402.com');
  const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
  assert.match(allowHeaders, /X-XFuel-Session/i);
  assert.match(allowHeaders, /x-xfuel-session/i);
  const expose = res.headers.get('access-control-expose-headers') ?? '';
  assert.match(expose, /PAYMENT-RESPONSE/);
  assert.match(expose, /X-PAYMENT-RESPONSE/);
});

test('default allowlist rejects unknown origins', async () => {
  const res = await fetch(`${base}/v1/models`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
