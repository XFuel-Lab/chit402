import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Config reads these at import time — set before server.js loads.
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');

let server;
let base;

before(async () => {
  resetHubCatalogCache();
  await initAIListener();
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

test('GET /v1/responses is 405 (not 404), method not allowed', async () => {
  const res = await fetch(`${base}/v1/responses`);
  assert.notEqual(res.status, 404);
  assert.equal(res.status, 405);
  assert.match(res.headers.get('allow') ?? '', /POST/);
  const body = await res.json();
  assert.equal(body.error.code, 'method_not_allowed');
});

test('POST /v1/responses with string input returns Responses-shaped output + Chit receipt', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      input: 'Explain ZK proofs in one sentence.',
    }),
  });
  assert.equal(res.status, 200);

  const taskIdHdr = res.headers.get('x-xfuel-task-id');
  assert.equal(typeof taskIdHdr, 'string');
  assert.match(taskIdHdr, /^xfuel-[0-9a-f-]{36}$/i);

  const verifyHeader = res.headers.get('x-xfuel-verify-url');
  assert.equal(typeof verifyHeader, 'string');
  assert.ok(verifyHeader.includes('/receipt/'));

  const body = await res.json();

  // Responses-shaped output
  assert.equal(body.object, 'response');
  assert.match(body.id, /^resp_/);
  assert.equal(body.status, 'completed');
  assert.equal(body.model, 'theta/qwen3');
  assert.ok(Array.isArray(body.output));
  assert.ok(body.output.length >= 1);
  assert.equal(typeof body.output_text, 'string');

  // Output structure check
  const msgItem = body.output.find((o) => o.type === 'message');
  assert.ok(msgItem, 'should have a message output item');
  assert.equal(msgItem.role, 'assistant');
  assert.ok(Array.isArray(msgItem.content));
  const textContent = msgItem.content.find((c) => c.type === 'output_text');
  assert.ok(textContent, 'should have output_text content');
  assert.equal(typeof textContent.text, 'string');

  // Usage
  assert.ok(body.usage.total_tokens >= 1);

  // Chit receipt
  assert.match(body.xfuel.task_id, /^xfuel-/);
  assert.equal(body.xfuel.task_id, taskIdHdr);
  assert.equal(body.xfuel.compute.real, false); // No provider keys in test → mock
  assert.equal(body.xfuel.proof.status, 'skipped');
  assert.equal(typeof body.xfuel.verify_url, 'string');
  assert.ok(body.xfuel.verify_url.endsWith(`/receipt/${body.xfuel.task_id}`));
});

test('POST /v1/responses with message array input works', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      input: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Say hi.' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'response');
  assert.ok(body.output.length >= 1);
  assert.ok(body.xfuel.task_id);
});

test('POST /v1/responses rejects empty input', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/qwen3',
      input: [],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.param, 'input');
});

test('POST /v1/responses rejects missing input', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'theta/qwen3',
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.param, 'input');
});

test('POST /v1/responses rejects retired model (same as chat completions)', async () => {
  const res = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({
      model: 'llama-3-70b',
      input: 'hi',
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'model_retired');
});

test('GET /openapi.json includes /v1/responses with x-payment-info', async () => {
  const res = await fetch(`${base}/openapi.json`);
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.ok(spec.paths['/v1/responses'], '/v1/responses should be in OpenAPI paths');
  const responses = spec.paths['/v1/responses'].post;
  assert.ok(responses.responses[402] || responses.responses['402']);
  assert.equal(responses['x-payment-info'].price.amount, '0.002');
  assert.deepEqual(responses['x-payment-info'].protocols, [{ x402: {} }]);
  assert.match(responses.description, /Responses API/);
});

test('GET /.well-known/x402 includes /v1/responses resource', async () => {
  const res = await fetch(`${base}/.well-known/x402`);
  assert.equal(res.status, 200);
  const manifest = await res.json();
  const responsesResource = manifest.resources.find((r) => r.resource.includes('/v1/responses'));
  assert.ok(responsesResource, '/v1/responses should be in x402 manifest');
  assert.equal(responsesResource.method, 'POST');
  assert.match(responsesResource.description, /Responses API/);
});

test('GET /.well-known/agent-card.json includes responses skill', async () => {
  const res = await fetch(`${base}/.well-known/agent-card.json`);
  assert.equal(res.status, 200);
  const card = await res.json();
  const responsesSkill = card.skills.find((s) => s.id === 'responses');
  assert.ok(responsesSkill, 'responses skill should be in agent card');
  assert.match(responsesSkill.description, /POST \/v1\/responses/);
});
