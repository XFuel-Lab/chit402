import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Honest catalog seed (no live Theta poll / no Llama fiction) for deterministic tests.
process.env.HUB_CATALOG_OFFLINE = 'true';

import { createApp } from '../src/server.js';
import { resetHubCatalogCache } from '../src/hub-catalog.js';
import { openAiErrorShape } from '../src/openai-gateway.js';

// Spin the real Express app on an ephemeral port and exercise the
// OpenAI-compatible routes over HTTP. No provider keys are set, so
// /v1/chat/completions falls back to the labelled mock — which is exactly
// what we assert on (honest receipt, correct OpenAI shape).

let server;
let base;

before(async () => {
  resetHubCatalogCache();
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
  await new Promise((resolve) => server.close(resolve));
});

test('GET /llms.txt serves a public agent manifest (no auth)', async () => {
  const res = await fetch(`${base}/llms.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  const body = await res.text();
  assert.match(body, /# XFuel Protocol/);
  assert.match(body, /\/v1\/chat\/completions/);
  assert.match(body, /xfuel-sdk/);
});

test('GET /v1/models lists live hub catalog in OpenAI shape', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length >= 1);
  assert.ok(body.data.some((m) => m.id === 'xfuel/auto'));
  assert.ok(body.data.some((m) => m.id === 'theta/qwen3'));
  assert.ok(!body.data.some((m) => m.id === 'llama-3-70b'));
  const first = body.data[0];
  assert.equal(first.object, 'model');
  assert.equal(typeof first.id, 'string');
  assert.ok(first.modality);
});

test('GET /v1/models/:id → 200 known, 404 unknown / retired', async () => {
  const known = await fetch(`${base}/v1/models/theta%2Fqwen3`);
  assert.equal(known.status, 200);
  const knownBody = await known.json();
  assert.equal(knownBody.id, 'theta/qwen3');
  assert.equal(knownBody.modality, 'chat');

  const retired = await fetch(`${base}/v1/models/llama-3-70b`);
  assert.equal(retired.status, 404);

  const unknown = await fetch(`${base}/v1/models/does-not-exist`);
  assert.equal(unknown.status, 404);
  const unknownBody = await unknown.json();
  assert.ok(unknownBody.error.code);
});

test('POST /v1/chat/completions returns an OpenAI completion + XFuel receipt', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      messages: [{ role: 'user', content: 'Explain ZK proofs in one sentence.' }],
    }),
  });
  assert.equal(res.status, 200);

  // Verification receipt is mirrored in headers.
  assert.equal(typeof res.headers.get('x-xfuel-task-id'), 'string');
  assert.ok(['pending', 'unavailable', 'skipped'].includes(res.headers.get('x-xfuel-proof-status')));
  // Shareable proof link is present as a header and points at the receipt page.
  const verifyHeader = res.headers.get('x-xfuel-verify-url');
  assert.equal(typeof verifyHeader, 'string');
  assert.ok(verifyHeader.includes('/receipt/'));
  assert.ok(verifyHeader.includes(res.headers.get('x-xfuel-task-id')));

  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.model, 'theta/qwen3');
  assert.equal(body.choices[0].message.role, 'assistant');
  assert.equal(typeof body.choices[0].message.content, 'string');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.ok(body.usage.total_tokens >= 1);

  // Honest receipt: no provider keys in test → mock compute, proof skipped.
  assert.equal(body.xfuel.compute.real, false);
  assert.equal(body.xfuel.proof.status, 'skipped');
  // `/v1` now shares receipt.js's canonical proof note rather than keeping its own
  // wording. Assert the disclaimer that must survive any rewording, not the prose.
  assert.match(body.xfuel.proof.attests, /does NOT attest that the provider computed the model correctly/i);
  assert.ok(body.xfuel.proof.links.proof.includes(body.xfuel.task_id));
  // Canonical shareable proof link is present in the body + proof links.
  assert.equal(typeof body.xfuel.verify_url, 'string');
  assert.ok(body.xfuel.verify_url.endsWith(`/receipt/${body.xfuel.task_id}`));
  assert.equal(body.xfuel.proof.links.receipt, body.xfuel.verify_url);
  assert.equal(body.xfuel.verify_url, verifyHeader);
});

test('POST /v1/chat/completions rejects a bad body with an OpenAI error', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'theta/qwen3', messages: [] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.param, 'messages');
});

test('POST /v1/chat/completions rejects retired llama fiction', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3-70b',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'model_retired');
});

test('POST /v1/chat/completions supports SSE streaming', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      stream: true,
      messages: [{ role: 'user', content: 'Say hello.' }],
    }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /"object":"chat\.completion\.chunk"/);
  assert.match(text, /"finish_reason":"stop"/);
  assert.match(text, /event: xfuel\.receipt/);
  assert.match(text, /data: \[DONE\]/);
});

// Shared M2M middleware (auth, rate limit, 404) answers `{ error: "code", message }`.
// OpenAI client libraries throw opaquely on that shape, so /v1 rewrites it.
function runErrorShape(status, body) {
  let captured;
  const res = { statusCode: status, json: (b) => { captured = b; return res; } };
  openAiErrorShape({}, res, () => {});
  res.json(body);
  return captured;
}

test('openAiErrorShape rewrites flat M2M errors into the OpenAI envelope', () => {
  const unauthorized = runErrorShape(401, {
    error: 'unauthorized',
    message: 'Provide a valid X-API-Key header or X-Signature relayer authentication.',
  });
  assert.equal(unauthorized.error.type, 'authentication_error');
  assert.equal(unauthorized.error.code, 'unauthorized');
  assert.match(unauthorized.error.message, /X-API-Key/);
  assert.equal(unauthorized.error.param, null);

  const limited = runErrorShape(429, { error: 'rate_limit_exceeded', message: 'Slow down.' });
  assert.equal(limited.error.type, 'rate_limit_error');
  assert.equal(limited.error.code, 'rate_limit_exceeded');

  const server = runErrorShape(503, { error: 'provider_float_exhausted', message: 'Float low.' });
  assert.equal(server.error.type, 'server_error');
});

test('openAiErrorShape leaves success bodies and nested errors untouched', () => {
  const ok = runErrorShape(200, { object: 'list', data: [] });
  assert.deepEqual(ok, { object: 'list', data: [] });

  const nested = { error: { message: 'nope', type: 'invalid_request_error', code: 'model_not_found' } };
  assert.deepEqual(runErrorShape(404, nested), nested);
});

test('GET /v1/models?modality=image filters catalog', async () => {
  const res = await fetch(`${base}/v1/models?modality=image`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.data.every((m) => m.modality === 'image' || m.id === 'xfuel/auto'));
});

test('POST /v1/images/generations returns OpenAI image shape (mock without key)', async () => {
  const res = await fetch(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/stable_diffusion_xl_turbo',
      prompt: 'a verification receipt hologram',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(body.model, 'theta/stable_diffusion_xl_turbo');
  assert.ok(body.xfuel?.task_id);
});
