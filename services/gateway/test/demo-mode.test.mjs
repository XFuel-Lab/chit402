import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Legacy demo env vars may still be set on hosts; they must not grant free inference.
process.env.M2M_DEMO_MODE = 'true';
process.env.M2M_DEMO_API_KEY = 'xfuel-demo';
process.env.M2M_API_KEYS = 'private-key-1';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.HUB_CATALOG_OFFLINE = 'true';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;

before(async () => {
  resetHubCatalogCache();
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

test('GET /v1/models is public — no key required to see seats', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data) && body.data.length >= 1);
});

test('private partner key is accepted on /v1/models', async () => {
  const res = await fetch(`${base}/v1/models`, {
    headers: { 'X-API-Key': 'private-key-1' },
  });
  assert.equal(res.status, 200);
});

test('public demo keys do not skip payment on POST /v1/chat/completions', async () => {
  const cases = [
    { 'X-API-Key': 'xfuel-demo' },
    { 'X-API-Key': 'chit402-demo' },
    { Authorization: 'Bearer xfuel-demo' },
  ];
  for (const authHeaders of cases) {
    const headers = { 'content-type': 'application/json', ...authHeaders };
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
      }),
    });
    assert.equal(res.status, 402, `expected 402 for headers ${JSON.stringify(authHeaders)}`);
    const body = await res.json();
    assert.equal(body.error.type, 'payment_required');
  }
});

test('demo key prefix does not skip payment', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo-extra' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 8,
    }),
  });
  assert.equal(res.status, 402);
});

test('demo key does not authorize POST /task-request without payment', async () => {
  const res = await fetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'theta/qwen3',
      input: 'hello',
    }),
  });
  assert.equal(res.status, 402);
});

test('M2M routes keep the flat XFuel error shape', async () => {
  const res = await fetch(`${base}/task-status?task_id=nope`, {
    headers: { 'X-API-Key': 'not-a-real-key' },
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  assert.equal(typeof body.message, 'string');
});
