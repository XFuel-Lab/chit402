/**
 * `/v1` receipts must be signed, and must agree with `/receipt/:task_id`.
 *
 * `/v1` used to build its own receipt object with **no `signature` field at all**,
 * so the tamper-evident receipt that is the product did not exist on the busiest
 * surface — while the inline `xfuel` block looked authoritative enough that
 * nobody noticed. It now shares `receipt.js`, and these lock in the two
 * properties that convergence is *for*: the receipt verifies, and the same task
 * produces the same signature no matter which surface returned it.
 *
 * The PRIMARY verification path is now ES256 (issuer_signature.jws) verified against JWKS.
 * HMAC attestations are secondary and available for internal/compat use only.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Read at import time by config.js.
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { canonicalSignedPayload, verifyReceiptEcdsaWithJwks, mergeReceiptView } = await import('../src/receipt.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { getJwks } = await import('../src/issuer-key.js');

const SECRET = process.env.RECEIPT_SIGNING_SECRET;
let server;
let base;

const expectedHmacSignature = (receipt) => 'sha256=' + crypto
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

test('a /v1 receipt carries an ES256 issuer_signature (primary) and verifies against JWKS', async () => {
  const { xfuel } = await (await chat()).json();

  // ES256 is the primary verification path
  assert.ok(xfuel.issuer_signature, '/v1 receipt must have issuer_signature');
  assert.equal(xfuel.issuer_signature.alg, 'ES256');
  assert.ok(xfuel.issuer_signature.jws, 'must have compact JWS');
  
  // Verify the JWS against JWKS
  const jwks = getJwks();
  const result = verifyReceiptEcdsaWithJwks(xfuel, jwks);
  assert.equal(result.valid, true, 'issuer_signature must verify against JWKS');
  
  // HMAC attestation is secondary (optional)
  if (xfuel.hmac_attestation) {
    assert.equal(xfuel.hmac_attestation.alg, 'HMAC-SHA256');
    assert.equal(xfuel.hmac_attestation.role, 'attestor');
    assert.equal(xfuel.hmac_attestation.value, expectedHmacSignature(xfuel));
  }
});

test('tampering with the attested provider breaks ES256 verification', async () => {
  const { xfuel } = await (await chat()).json();
  const jwks = getJwks();
  
  // Original should verify
  const originalResult = verifyReceiptEcdsaWithJwks(xfuel, jwks);
  assert.equal(originalResult.valid, true);
  
  // Tampered should fail (task_id mismatch since provider is in signed claims)
  const tampered = { ...xfuel, task_id: 'tampered-task-id' };
  const tamperedResult = verifyReceiptEcdsaWithJwks(tampered, jwks);
  assert.equal(tamperedResult.valid, false);
});

test('tampering with the attested model breaks the HMAC signature', async () => {
  const { xfuel } = await (await chat()).json();
  const tampered = { ...xfuel, route: { ...xfuel.route, model: 'a-cheaper-model' } };

  assert.notEqual(expectedHmacSignature(tampered), xfuel.hmac_attestation?.value);
});

test('the same task verifies identically on /v1 and /receipt/:task_id', async () => {
  const { xfuel } = await (await chat()).json();
  const fetched = await (await fetch(`${base}/receipt/${xfuel.task_id}?format=json`)).json();
  const jwks = getJwks();

  // Both signatures should verify against the same JWKS
  const v1Result = verifyReceiptEcdsaWithJwks(xfuel, jwks);
  const fetchedResult = verifyReceiptEcdsaWithJwks(fetched, jwks);
  
  assert.equal(v1Result.valid, true, '/v1 receipt should verify');
  assert.equal(fetchedResult.valid, true, '/receipt/:task_id should verify');
  
  // The signed claims should be identical (except iat which is generated at build time)
  assert.equal(v1Result.payload.task_id, fetchedResult.payload.task_id);
  assert.equal(v1Result.payload.payment.rail, fetchedResult.payload.payment.rail);
  assert.equal(v1Result.payload.route.model, fetchedResult.payload.route.model);
  assert.equal(v1Result.payload.route.provider, fetchedResult.payload.route.provider);
  
  // The unsigned receipt fields should match (xfuel merges JWS claims for display)
  const fetchedView = mergeReceiptView(fetched);
  assert.equal(fetchedView.route.model, xfuel.route.model);
  assert.equal(fetchedView.route.provider, xfuel.route.provider);
  assert.equal(fetchedView.payment.rail, xfuel.payment.rail);
  assert.equal(fetchedView.output?.hash, xfuel.output?.hash);
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
