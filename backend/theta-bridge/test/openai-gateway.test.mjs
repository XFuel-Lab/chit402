import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

// Spin the real Express app on an ephemeral port and exercise the
// OpenAI-compatible routes over HTTP. No provider keys are set, so
// /v1/chat/completions falls back to the labelled mock — which is exactly
// what we assert on (honest receipt, correct OpenAI shape).

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

test('GET /v1/models lists routable models in OpenAI shape', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length >= 1);
  const first = body.data[0];
  assert.equal(first.object, 'model');
  assert.equal(first.owned_by, 'xfuel');
  assert.equal(typeof first.id, 'string');
});

test('GET /v1/models/:id → 200 known, 404 unknown', async () => {
  const known = await fetch(`${base}/v1/models/llama-3-70b`);
  assert.equal(known.status, 200);
  const knownBody = await known.json();
  assert.equal(knownBody.id, 'llama-3-70b');

  const unknown = await fetch(`${base}/v1/models/does-not-exist`);
  assert.equal(unknown.status, 404);
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.error.code, 'model_not_found');
});

test('POST /v1/chat/completions returns an OpenAI completion + XFuel receipt', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'llama-3-70b',
      messages: [{ role: 'user', content: 'Explain ZK proofs in one sentence.' }],
    }),
  });
  assert.equal(res.status, 200);

  // Verification receipt is mirrored in headers.
  assert.equal(typeof res.headers.get('x-xfuel-task-id'), 'string');
  assert.ok(['pending', 'unavailable', 'skipped'].includes(res.headers.get('x-xfuel-proof-status')));

  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.model, 'llama-3-70b');
  assert.equal(body.choices[0].message.role, 'assistant');
  assert.equal(typeof body.choices[0].message.content, 'string');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.ok(body.usage.total_tokens >= 1);

  // Honest receipt: no provider keys in test → mock compute, proof skipped.
  assert.equal(body.xfuel.compute.real, false);
  assert.equal(body.xfuel.proof.status, 'skipped');
  assert.match(body.xfuel.proof.attests, /NOT inference correctness/);
  assert.ok(body.xfuel.proof.links.proof.includes(body.xfuel.task_id));
});

test('POST /v1/chat/completions rejects a bad body with an OpenAI error', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3-70b', messages: [] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.param, 'messages');
});

test('POST /v1/chat/completions supports SSE streaming', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3-70b',
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
