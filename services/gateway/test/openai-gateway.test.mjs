import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Config reads these at import time — set before server.js loads (ESM hoists static imports).
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { openAiErrorShape } = await import('../src/openai-gateway.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');

// Spin the real Express app on an ephemeral port and exercise the
// OpenAI-compatible routes over HTTP. No provider keys are set, so
// /v1/chat/completions falls back to the labelled mock — which is exactly
// what we assert on (honest receipt, correct OpenAI shape).

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

test('GET /openapi.json is public OpenAPI 3.1 with x-payment-info', async () => {
  const res = await fetch(`${base}/openapi.json`);
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'Chit');
  assert.equal(typeof spec.info['x-guidance'], 'string');
  assert.deepEqual(Object.keys(spec.paths), [
    '/v1/chat/completions',
    '/v1/responses',
    '/a2a-message',
    '/task-request',
    '/v1/agents/register',
    '/v1/agents/{agent_id}/book',
    '/v1/agents/{agent_id}/book/ingest',
    '/v1/agents/{agent_id}/book/lineage/{task_id}',
    '/v1/agents/{agent_id}/book/policy',
    '/v1/agents/{agent_id}/book/assign',
    '/v1/agents/{agent_id}/book/assign/{assignment_id}',
    '/v1/book/slice',
    '/v1/agents/{agent_id}/book/dispute',
    '/v1/agents/{agent_id}/book/rotate',
    '/receipt/{taskId}',
    '/receipt/by-tx',
  ]);
  assert.equal(spec.paths['/v1/agents/register'].post['x-payment-info'], undefined);
  assert.equal(spec.paths['/v1/agents/{agent_id}/book'].post['x-payment-info'], undefined);
  assert.equal(spec.paths['/v1/agents/{agent_id}/book/ingest'].post['x-payment-info'], undefined);
  const chat = spec.paths['/v1/chat/completions'].post;
  assert.ok(chat.responses[402] || chat.responses['402']);
  assert.equal(chat['x-payment-info'].price.amount, '0.002');
  assert.deepEqual(chat['x-payment-info'].protocols, [{ x402: {} }]);
  assert.equal(chat.requestBody.content['application/json'].schema.type, 'object');
  const a2a = spec.paths['/a2a-message'].post;
  assert.ok(a2a.responses[402] || a2a.responses['402']);
  assert.equal(a2a['x-payment-info'].price.amount, '0.002');
  assert.match(a2a.description, /hub, model, and amount/);
});

test('GET /llms.txt serves a public agent manifest (no auth)', async () => {
  const res = await fetch(`${base}/llms.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  const body = await res.text();
  assert.match(body, /# Chit Protocol/);
  assert.match(body, /\/v1\/chat\/completions/);
  assert.match(body, /xfuel-sdk/);
  assert.match(body, /npx xfuel-mcp/);
  assert.match(body, /Base mainnet/);
  assert.match(body, /USDC/);
  assert.match(body, /verify_url/);
  assert.doesNotMatch(body, /\$0\.01/); // No fixed price in public copy
  assert.doesNotMatch(body, /unmetered/i);
  assert.doesNotMatch(body, /free path/i);
});

test('GET /.well-known/x402list.txt is the x402-list domain proof', async () => {
  const res = await fetch(`${base}/.well-known/x402list.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  const body = await res.text();
  assert.match(body, /^x402list-verify-nNJp3v2Qz1oVuWVxqpuOcDbL8O8nepV_fz480CVRjAU$/m);
  assert.doesNotMatch(body, /request_id/i);
});

test('GET /.well-known/x402 and agent-card.json still serve after x402list', async () => {
  const x402 = await fetch(`${base}/.well-known/x402`);
  assert.equal(x402.status, 200);
  const manifest = await x402.json();
  assert.equal(manifest.x402Version, 2);
  assert.ok(Array.isArray(manifest.resources));

  const card = await fetch(`${base}/.well-known/agent-card.json`);
  assert.equal(card.status, 200);
  const body = await card.json();
  assert.equal(body.name, 'Chit');
  assert.ok(Array.isArray(body.skills));
});

test('GET /xfuel-icon.svg is a real SVG, not HTML', async () => {
  const res = await fetch(`${base}/xfuel-icon.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
  const body = await res.text();
  assert.match(body, /<svg[\s>]/);
  assert.match(body, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(body, /<!DOCTYPE html>/i);
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
  assert.equal(typeof first.hub, 'string');
  assert.ok(first.availability && typeof first.availability.status === 'string');
  assert.ok(first.modality);
});

test('GET /v1/models/:id → 200 known, 400 unknown / retired (with live ids)', async () => {
  const known = await fetch(`${base}/v1/models/theta%2Fqwen3`);
  assert.equal(known.status, 200);
  const knownBody = await known.json();
  assert.equal(knownBody.id, 'theta/qwen3');
  assert.equal(knownBody.modality, 'chat');

  const retired = await fetch(`${base}/v1/models/llama-3-70b`);
  assert.equal(retired.status, 400);
  const retiredBody = await retired.json();
  assert.equal(retiredBody.error.code, 'model_retired');

  const unknown = await fetch(`${base}/v1/models/does-not-exist`);
  assert.equal(unknown.status, 400);
  const unknownBody = await unknown.json();
  assert.ok(unknownBody.error.code);
  assert.ok(Array.isArray(unknownBody.error.available));
  assert.ok(unknownBody.error.available.includes('theta/qwen3'));
});

test('GET /v1/chat/completions is not 404 (x402 off → 405, not missing)', async () => {
  const res = await fetch(`${base}/v1/chat/completions`);
  assert.notEqual(res.status, 404);
  assert.equal(res.status, 405);
  assert.match(res.headers.get('allow') ?? '', /POST/);
});

test('POST /v1/chat/completions returns an OpenAI completion + Chit receipt', async () => {
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
  const taskIdHdr = res.headers.get('x-xfuel-task-id');
  assert.equal(typeof taskIdHdr, 'string');
  assert.match(taskIdHdr, /^xfuel-[0-9a-f-]{36}$/i);
  assert.ok(['pending', 'unavailable', 'skipped'].includes(res.headers.get('x-xfuel-proof-status')));
  // Shareable proof link is present as a header and points at the receipt page.
  const verifyHeader = res.headers.get('x-xfuel-verify-url');
  assert.equal(typeof verifyHeader, 'string');
  assert.ok(verifyHeader.includes('/receipt/'));
  assert.ok(verifyHeader.includes(taskIdHdr));
  assert.ok(!verifyHeader.includes('/receipt/openai-'));

  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.model, 'theta/qwen3');
  assert.equal(body.choices[0].message.role, 'assistant');
  assert.equal(typeof body.choices[0].message.content, 'string');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.ok(body.usage.total_tokens >= 1);

  assert.match(body.xfuel.task_id, /^xfuel-/);
  assert.equal(body.xfuel.task_id, taskIdHdr);

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

  // Public receipt chrome uses the real task id — no openai- shop invoice prefix.
  // Title is just "Chit" (task_id not appended), and xfuel- prefix becomes chit- in display.
  const receiptHtml = await fetch(`${base}/receipt/${body.xfuel.task_id}`);
  assert.equal(receiptHtml.status, 200);
  const html = await receiptHtml.text();
  assert.match(html, /<title>Chit<\/title>/);
  assert.doesNotMatch(html, /openai/i);
});

test('GET /receipt/openai-* still 200 for pre-cutover task ids', async () => {
  const legacyId = 'openai-11111111-2222-3333-4444-555555555555';
  getAIListener().activeTasks.set(legacyId, {
    taskId: legacyId,
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      amount: '2000',
      modelId: 'theta/qwen3',
      chain: 'base',
    },
    meta: { chain: 'base', provider: 'theta-edgecloud' },
    feeAmount: '50',
    netAmount: '9950',
    feeBps: 50,
    result: { provider: 'theta-edgecloud' },
    sp1Proof: null,
  });

  const res = await fetch(`${base}/receipt/${legacyId}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // Title is just "Chit" (task_id not appended)
  assert.match(html, /<title>Chit<\/title>/);
  // openai-* prefix is NOT stripped (only xfuel- is)
  assert.match(html, new RegExp(`class="taskid">${legacyId}<`));

  const json = await fetch(`${base}/receipt/${legacyId}?format=json`);
  assert.equal(json.status, 200);
  const body = await json.json();
  assert.equal(body.task_id, legacyId);
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
  assert.equal(res.status, 400);
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
