import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Config reads these at import time, so they must be set before `server.js`
// pulls it in. Node runs each test file in its own process, which is why this
// lives apart from openai-gateway.test.mjs (that file asserts the unmetered
// default).
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '10000';
process.env.X402_METER_V1_EXEMPT_KEYS = 'partner-key-1';
// The hosted demo caps output. Set here so the quote can be checked against it.
process.env.OPENAI_GATEWAY_MAX_TOKENS_CAP = '512';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;

const chat = (headers = {}, body = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 16,
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

test('unauth POST /v1/chat/completions with {} is 402, not 400', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 402, 'x402scan probes {} and must 402 before body validation');
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.accepts[0].amount, '10000', 'runtime 402 amount stays atomic USDC');
  assert.match(body.resource.url, /\/v1\/chat\/completions/);
  assert.ok(!body.resource.url.includes('/task-request'));
});

test('unauth GET /v1/chat/completions is the same 402 as POST {}', async () => {
  const getRes = await fetch(`${base}/v1/chat/completions`);
  const postRes = await fetch(`${base}/v1/chat/completions`, {
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
  assert.equal(getBody.accepts[0].amount, '10000');
  assert.equal(getBody.accepts.length, postBody.accepts.length);
  assert.match(getBody.resource.url, /\/v1\/chat\/completions/);
  assert.equal(new URL(getBody.resource.url).pathname, new URL(postBody.resource.url).pathname);
});

test('GET /v1/models without a key returns the catalog, not 401 or 402', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  const m = body.data[0];
  assert.equal(typeof m.id, 'string');
  assert.equal(typeof m.hub, 'string');
  assert.equal(typeof m.availability.status, 'string');
});

test('demo key + empty body skips payment and then 400s on validation', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.param, 'messages');
});

test('payment header + empty body is 400, not settle-then-400', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment': 'not-a-payload' },
    body: '{}',
  });
  assert.equal(res.status, 400, 'invalid body must 400 before handshake/settle');
});

test('an unpaid /v1 call is refused with a 402, not served for free', async () => {
  const res = await chat();
  assert.equal(res.status, 402);
  const body = await res.json();

  // An x402 client reads this half (v2: CAIP-2 network + amount; maxAmountRequired kept for compat)...
  assert.equal(body.x402Version, 2);
  assert.ok(Array.isArray(body.accepts) && body.accepts.length === 1);
  assert.equal(body.accepts[0].scheme, 'exact');
  assert.equal(body.accepts[0].payTo, '0xtreasury');
  assert.equal(body.accepts[0].network, 'eip155:84532');
  assert.equal(body.accepts[0].amount, body.accepts[0].maxAmountRequired);
  // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. Per Section 3.5.
  assert.match(body.accepts[0].extra.nonce, /^0x[0-9a-f]{64}$/);
  assert.equal(typeof body.resource, 'object');

  // ...and a plain OpenAI client reads this half.
  assert.equal(body.error.type, 'payment_required');
  assert.match(body.error.message, /X-PAYMENT/);

  // CDP Bazaar keys listings off resource.url — must catalog /v1, not /task-request.
  assert.match(body.resource.url, /\/v1\/chat\/completions/);
  assert.ok(!body.resource.url.includes('/task-request'));
  const bazaarBody = body.extensions?.bazaar?.info?.input?.body;
  assert.ok(bazaarBody?.messages, 'bazaar example is OpenAI chat-completions shape');
  assert.ok(!bazaarBody?.message_type, 'bazaar example is not /task-request schema');
});

test('the 402 is priced from the request, not a flat figure', async () => {
  const small = await chat({}, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 });
  const large = await chat({}, {
    // ~68k prompt tokens — the measured median agent call.
    messages: [{ role: 'user', content: 'x'.repeat(272_000) }],
    max_tokens: 250,
  });

  const smallAmount = Number((await small.json()).accepts[0].maxAmountRequired);
  const largeAmount = Number((await large.json()).accepts[0].maxAmountRequired);

  assert.equal(smallAmount, 10_000, 'a ping pays the floor');
  assert.ok(largeAmount > 20_000, `a median agent call should clear $0.02, got ${largeAmount}`);
});

test('the quote charges for the capped output, not the output that was asked for', async () => {
  // The `exact` scheme prices output at its ceiling, and the hosted demo caps that
  // ceiling — so quoting the requested figure bills for tokens the caller is
  // structurally unable to receive. 100k requested against a 512 cap is a $0.09
  // overcharge on a single call.
  const prompt = [{ role: 'user', content: 'x'.repeat(4_000) }];
  const atCap = await chat({}, { messages: prompt, max_tokens: 512 });
  const overCap = await chat({}, { messages: prompt, max_tokens: 100_000 });

  assert.equal(
    (await overCap.json()).accepts[0].maxAmountRequired,
    (await atCap.json()).accepts[0].maxAmountRequired,
    'asking above the cap must not cost more than asking for the cap',
  );
});

test('the demo key stays exempt, so the public gateway keeps working', async () => {
  const res = await chat({ 'x-api-key': 'xfuel-demo' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.ok(body.usage.total_tokens > 0);
});

test('an explicitly exempted key is not charged', async () => {
  const res = await chat({ 'x-api-key': 'partner-key-1' });
  assert.equal(res.status, 200);
});

test('an exempt call still reports usage and stays marked unmetered', async () => {
  const res = await chat({ 'x-api-key': 'xfuel-demo' });
  const body = await res.json();
  assert.ok(['provider', 'estimate'].includes(body.usage.xfuel_source));
  assert.equal(typeof body.usage.prompt_tokens, 'number');
  assert.ok(body.xfuel, 'receipt is still attached');
  // The receipt must not claim a rail that carried no money. `ref` is explicitly
  // null rather than absent now that /v1 shares the canonical receipt shape —
  // what matters is that it names no settlement.
  assert.equal(body.xfuel.payment.rail, 'unmetered');
  assert.ok(!body.xfuel.payment.ref);
  assert.equal(body.xfuel.payment.collected, false);
  assert.equal(body.xfuel.schema, 'xfuel.receipt.v3');
});

test('the receipt names the provider that served', async () => {
  // route.provider is what makes the compute source tamper-evident once the
  // receipt is signed; it was being dropped from the /v1 receipt entirely.
  const res = await chat({ 'x-api-key': 'xfuel-demo' });
  const body = await res.json();
  assert.ok(body.xfuel.route.provider, 'route.provider must be present');
  assert.equal(body.xfuel.route.provider, body.xfuel.compute.provider);
});
