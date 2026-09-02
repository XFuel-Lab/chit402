import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Config reads these at import time — enable x402 metering for /v1
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '2000';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;

const responses = (headers = {}, body = {}) => fetch(`${base}/v1/responses`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({
    model: 'theta/qwen3',
    input: 'hello',
    max_output_tokens: 16,
    ...body,
  }),
});

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

test('unauth POST /v1/responses with {} is 402, not 400 (x402scan probe)', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 402, 'x402scan probes {} and must 402 before body validation');
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.accepts[0].amount, '2000', 'runtime 402 amount stays atomic USDC');
  assert.match(body.resource.url, /\/v1\/responses/);
});

test('unauth GET /v1/responses is the same 402 as POST {}', async () => {
  const getRes = await fetch(`${base}/v1/responses`);
  const postRes = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(getRes.status, 402);
  assert.equal(postRes.status, 402);
  const getBody = await getRes.json();
  const postBody = await postRes.json();
  assert.equal(getBody.x402Version, postBody.x402Version);
  assert.equal(getBody.accepts[0].amount, postBody.accepts[0].amount);
  assert.match(getBody.resource.url, /\/v1\/responses/);
});

test('an unpaid /v1/responses call is refused with 402', async () => {
  const res = await responses();
  assert.equal(res.status, 402);
  const body = await res.json();

  assert.equal(body.x402Version, 2);
  assert.ok(Array.isArray(body.accepts) && body.accepts.length === 1);
  assert.equal(body.accepts[0].scheme, 'exact');
  assert.equal(body.accepts[0].payTo, '0xtreasury');
  assert.equal(body.accepts[0].network, 'eip155:84532');
  assert.match(body.accepts[0].extra.nonce, /^0x[0-9a-f]{64}$/);

  assert.equal(body.error.type, 'payment_required');
  assert.match(body.error.message, /X-PAYMENT/);
  assert.match(body.resource.url, /\/v1\/responses/);
});

test('demo key skips payment for /v1/responses', async () => {
  const res = await responses({ 'x-api-key': 'xfuel-demo' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'response');
  assert.ok(body.output.length > 0);
  assert.ok(body.xfuel.task_id);
  assert.equal(body.xfuel.payment.rail, 'unmetered');
});

test('demo key + empty body skips payment and then 400s on validation', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.param, 'input');
});

test('payment header + empty body is 400, not settle-then-400', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment': 'not-a-payload' },
    body: '{}',
  });
  assert.equal(res.status, 400, 'invalid body must 400 before handshake/settle');
});

test('/v1/responses 402 resource URL is /v1/responses, not /v1/chat/completions', async () => {
  const res = await responses();
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.match(body.resource.url, /\/v1\/responses$/);
  assert.ok(!body.resource.url.includes('/chat/completions'));
});
