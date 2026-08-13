/**
 * `/v1` receipts must be signed, and must agree with `/receipt/:task_id`.
 *
 * `/v1` used to build its own receipt object with **no `signature` field at all**,
 * so the tamper-evident receipt that is the product did not exist on the busiest
 * surface — while the inline `xfuel` block looked authoritative enough that
 * nobody noticed. It now shares `receipt.js`, and these lock in the two
 * properties that convergence is *for*: the receipt verifies, and the same task
 * produces the same signature no matter which surface returned it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Read at import time by config.js.
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { canonicalSignedPayload } = await import('../src/receipt.js');
const { initAIListener } = await import('../src/ai-listener.js');

const SECRET = process.env.RECEIPT_SIGNING_SECRET;
let server;
let base;

const expectedSignature = (receipt) => 'sha256=' + crypto
  .createHmac('sha256', SECRET)
  .update(canonicalSignedPayload(receipt))
  .digest('hex');

const chat = (body = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
  body: JSON.stringify({
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 16,
    ...body,
  }),
});

before(async () => {
  resetHubCatalogCache();
  // The task has to be retrievable for the cross-surface check. `init()` only
  // constructs the listener — `startListening()` is what opens sockets, and is
  // deliberately not called here.
  await initAIListener();
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

test('a /v1 receipt carries a signature and verifies against it', async () => {
  const { xfuel } = await (await chat()).json();

  assert.ok(xfuel.signature, '/v1 receipt must be signed');
  assert.equal(xfuel.signature.alg, 'HMAC-SHA256');
  assert.equal(xfuel.signature.value, expectedSignature(xfuel));
});

test('tampering with the attested provider breaks the /v1 signature', async () => {
  const { xfuel } = await (await chat()).json();
  const tampered = { ...xfuel, route: { ...xfuel.route, provider: 'someone-else' } };

  assert.notEqual(expectedSignature(tampered), xfuel.signature.value);
});

test('tampering with the attested model breaks the /v1 signature', async () => {
  const { xfuel } = await (await chat()).json();
  const tampered = { ...xfuel, route: { ...xfuel.route, model: 'a-cheaper-model' } };

  assert.notEqual(expectedSignature(tampered), xfuel.signature.value);
});

test('the same task signs identically on /v1 and /receipt/:task_id', async () => {
  const { xfuel } = await (await chat()).json();
  const fetched = await (await fetch(`${base}/receipt/${xfuel.task_id}?format=json`)).json();

  // One task, one signature — a verifier must not need to know which surface
  // handed it the receipt.
  assert.equal(fetched.signature.value, xfuel.signature.value);
  assert.equal(fetched.route.model, xfuel.route.model);
  assert.equal(fetched.route.provider, xfuel.route.provider);
  assert.equal(fetched.payment.rail, xfuel.payment.rail);
  assert.equal(fetched.output?.hash, xfuel.output?.hash);
});

test('the /v1 receipt keeps the fields OpenAI-surface clients already read', async () => {
  // Convergence must not be a breaking change for anyone parsing the inline block.
  const { xfuel } = await (await chat()).json();

  assert.equal(typeof xfuel.compute.real, 'boolean');
  assert.equal(typeof xfuel.compute.provider, 'string');
  assert.ok(xfuel.proof.status);
  assert.ok(xfuel.proof.links.proof.includes(xfuel.task_id));
  assert.ok(xfuel.verify_url.endsWith(`/receipt/${xfuel.task_id}`));
  assert.equal(xfuel.route.requested, 'theta/qwen3');
  assert.ok(xfuel.route.resolved);
});
