/**
 * Alias disclosure on a completed call (x402 off → mock, no charge) and
 * strict mode's 400. The 402 challenge and the pre-settle refusal live in
 * unroutable-fail-closed.test.mjs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.AKASHML_API_KEY;

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { mergeReceiptView } = await import('../src/receipt.js');

const SERVED_OSS = 'akash/openai/gpt-oss-120b';

let server;
let base;

before(async () => {
  resetHubCatalogCache();
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
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function post(path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('GET /v1/models publishes substitution_policy', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.substitution_policy.default, 'alias');
  assert.equal(body.substitution_policy.strict_header, 'X-Chit-Strict-Model');
  assert.equal(body.substitution_policy.strict_body, 'chit_strict_model');
  assert.ok(body.substitution_policy.disclosure_headers.includes('X-Chit-Requested-Model'));
  assert.ok(body.substitution_policy.disclosure_headers.includes('X-Chit-Served-Model'));
  assert.ok(body.substitution_policy.disclosure_headers.includes('X-Chit-Model-Substituted'));
});

test('alias completion discloses headers, chit, and receipt.substituted', async () => {
  const res = await post('/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello alias' }],
  }, { origin: 'https://www.chit402.com' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-chit-requested-model'), 'gpt-4o-mini');
  assert.equal(res.headers.get('x-chit-served-model'), SERVED_OSS);
  assert.equal(res.headers.get('x-chit-model-substituted'), 'true');
  const expose = res.headers.get('access-control-expose-headers') || '';
  assert.match(expose, /X-Chit-Requested-Model/);
  assert.match(expose, /X-Chit-Served-Model/);
  assert.match(expose, /X-Chit-Model-Substituted/);

  const body = await res.json();
  assert.equal(body.model, SERVED_OSS);
  assert.deepEqual(body.chit, {
    requested_model: 'gpt-4o-mini',
    served_model: SERVED_OSS,
    substituted: true,
  });
  assert.equal(body.xfuel.route.requested_model, 'gpt-4o-mini');
  assert.equal(body.xfuel.route.substituted, true);
  assert.equal(body.xfuel.route.model, SERVED_OSS);

  const receiptRes = await fetch(`${base}/receipt/${body.xfuel.task_id}?format=json`);
  assert.equal(receiptRes.status, 200);
  const receipt = await receiptRes.json();
  const view = mergeReceiptView(receipt);
  assert.equal(receipt.route_meta.requested_model, 'gpt-4o-mini');
  assert.equal(receipt.route_meta.substituted, true);
  assert.equal(view.route.substituted, true);
  assert.equal(view.route.model, SERVED_OSS);
});

test('an exact id and xfuel/auto are not substitutions', async () => {
  const exact = await post('/v1/chat/completions', {
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'exact' }],
  });
  assert.equal(exact.status, 200);
  assert.equal(exact.headers.get('x-chit-model-substituted'), null);
  assert.equal(exact.headers.get('x-chit-requested-model'), null);
  const exactBody = await exact.json();
  assert.deepEqual(exactBody.chit, {
    requested_model: 'theta/qwen3',
    served_model: 'theta/qwen3',
    substituted: false,
  });
  assert.equal(exactBody.xfuel.route.substituted, false);

  const auto = await post('/v1/chat/completions', {
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'auto' }],
  });
  assert.equal(auto.status, 200);
  assert.equal(auto.headers.get('x-chit-model-substituted'), null);
  const autoBody = await auto.json();
  assert.equal(autoBody.chit.requested_model, 'xfuel/auto');
  assert.equal(autoBody.chit.substituted, false);
  assert.notEqual(autoBody.chit.served_model, 'xfuel/auto');
  assert.equal(autoBody.xfuel.route.substituted, false);
});

test('bare gpt is an alias hit and is disclosed', async () => {
  const res = await post('/v1/chat/completions', {
    model: 'gpt',
    messages: [{ role: 'user', content: 'bare gpt' }],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(res.headers.get('x-chit-requested-model'), 'gpt');
  assert.equal(res.headers.get('x-chit-served-model'), body.model);
  assert.equal(res.headers.get('x-chit-model-substituted'), 'true');
  assert.equal(body.chit.substituted, true);
  assert.equal(body.chit.requested_model, 'gpt');
  assert.equal(body.xfuel.route.substituted, true);
  assert.notEqual(body.model, 'gpt');
});

test('streaming alias sets the same headers and receipt flag', async () => {
  const res = await post('/v1/chat/completions', {
    model: 'claude-3-5-sonnet',
    stream: true,
    messages: [{ role: 'user', content: 'stream me' }],
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  assert.equal(res.headers.get('x-chit-requested-model'), 'claude-3-5-sonnet');
  assert.equal(res.headers.get('x-chit-served-model'), SERVED_OSS);
  assert.equal(res.headers.get('x-chit-model-substituted'), 'true');
  const text = await res.text();
  assert.match(text, /chat\.completion\.chunk/);
  const marker = 'event: xfuel.receipt\ndata: ';
  const start = text.indexOf(marker);
  assert.ok(start >= 0);
  const receipt = JSON.parse(text.slice(start + marker.length).split('\n')[0]);
  assert.equal(receipt.route.substituted, true);
  assert.equal(receipt.route.requested_model, 'claude-3-5-sonnet');
  assert.equal(receipt.route.model, SERVED_OSS);
});

test('responses alias includes chit and disclosure headers', async () => {
  const res = await post('/v1/responses', {
    model: 'gpt-4o',
    input: 'one sentence',
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-chit-requested-model'), 'gpt-4o');
  assert.equal(res.headers.get('x-chit-served-model'), SERVED_OSS);
  assert.equal(res.headers.get('x-chit-model-substituted'), 'true');
  const body = await res.json();
  assert.equal(body.object, 'response');
  assert.deepEqual(body.chit, {
    requested_model: 'gpt-4o',
    served_model: SERVED_OSS,
    substituted: true,
  });
  assert.equal(body.xfuel.route.substituted, true);
});

test('strict header and body reject an alias with no charge', async () => {
  const headerRes = await post('/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'strict' }],
  }, { 'x-chit-strict-model': 'true' });
  assert.equal(headerRes.status, 400);
  const headerBody = await headerRes.json();
  assert.equal(headerBody.error.code, 'model_not_routable');
  assert.equal(headerBody.charged, false);
  assert.match(headerBody.error.message, /No charge was made/);
  assert.ok(headerBody.available_models.includes(SERVED_OSS));
  assert.equal(headerBody.chit, undefined);
  assert.equal(headerRes.headers.get('x-chit-model-substituted'), null);

  const bodyRes = await post('/v1/chat/completions', {
    model: 'openai/gpt-4o',
    chit_strict_model: true,
    messages: [{ role: 'user', content: 'strict body' }],
  });
  assert.equal(bodyRes.status, 400);
  const body = await bodyRes.json();
  assert.equal(body.error.code, 'model_not_routable');
  assert.match(body.error.message, /No charge was made/);
  assert.ok(Array.isArray(body.available_models));
  assert.ok(body.available_models.length > 0);
});

test('strict mode still serves an exact catalog id', async () => {
  const res = await post('/v1/chat/completions', {
    model: 'theta/qwen3',
    chit_strict_model: 'true',
    messages: [{ role: 'user', content: 'still me' }],
  }, { 'x-chit-strict-model': 'true' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.model, 'theta/qwen3');
  assert.equal(body.chit.substituted, false);
  assert.equal(res.headers.get('x-chit-model-substituted'), null);
});
