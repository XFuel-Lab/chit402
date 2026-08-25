import test from 'node:test';
import assert from 'node:assert/strict';
import { buildX402Manifest, buildOpenApiSpec } from '../src/x402-discovery.js';
import { buildPaymentChallenge, BAZAAR_EXTENSION_KEY } from '../src/x402-adapter.js';

test('buildX402Manifest: describes paid resources in the v2 bazaar shape', () => {
  const m = buildX402Manifest('https://api-testnet.xfuel.app');

  assert.equal(m.x402Version, 2);
  assert.equal(m.name, 'XFuel Protocol');
  assert.equal(typeof m.description, 'string');
  assert.ok(Array.isArray(m.tags), 'manifest tags is an array');
  assert.ok(m.tags.length <= 5, 'manifest tags ≤5 items');
  assert.ok(m.tags.includes('llm'), 'manifest tags includes llm');
  assert.ok(!m.tags.includes('x402'), 'manifest tags omits legacy x402 tag');
  assert.equal(typeof m.x402_enabled, 'boolean');
  assert.equal(m.iconUrl, 'https://api.xfuel.app/xfuel-icon.svg');
  assert.ok(['usdc', 'tfuel'].includes(m.default_rail));

  // Facilitator block reflects config.
  assert.ok(m.facilitator);
  assert.ok(['x402', 'zan'].includes(m.facilitator.protocol));
  assert.match(m.facilitator.network, /^eip155:/);

  // Two paid resources: /v1/chat/completions (OpenAI-compatible) and /task-request (M2M)
  assert.equal(m.resources.length, 2);

  // First resource: /v1/chat/completions (OpenAI-compatible)
  const chatResource = m.resources.find((r) => r.resource.includes('/v1/chat/completions'));
  assert.ok(chatResource, 'chat completions resource exists');
  assert.equal(chatResource.type, 'http');
  assert.equal(chatResource.method, 'POST');
  assert.equal(chatResource.resource, 'https://api-testnet.xfuel.app/v1/chat/completions');
  assert.equal(chatResource.accepts[0].scheme, 'exact');
  assert.ok(chatResource.input.required.includes('messages'));

  // Second resource: /task-request (M2M)
  const taskResource = m.resources.find((r) => r.resource.includes('/task-request'));
  assert.ok(taskResource, 'task-request resource exists');
  assert.equal(taskResource.type, 'http');
  assert.equal(taskResource.method, 'POST');
  assert.equal(taskResource.resource, 'https://api-testnet.xfuel.app/task-request');
  assert.equal(taskResource.accepts[0].scheme, 'exact');
  assert.equal(typeof taskResource.accepts[0].amount, 'string');
  assert.match(taskResource.accepts[0].asset, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(taskResource.outputSchema.required.includes('verify_url'));
  assert.ok(taskResource.input.required.includes('sender'));
});

test('402 challenge resource URL matches discovery manifest resource URL', () => {
  // The 402 challenge and the discovery manifest must agree on the resource URL
  // so CDP Bazaar catalogs them as the same service.
  const baseUrl = 'https://api.xfuel.app';

  const manifest = buildX402Manifest(baseUrl);
  const { body: challenge } = buildPaymentChallenge({
    taskId: 'test-task',
    maxAmountRequired: '50000',
    baseUrl,
  });

  // The challenge defaults to /task-request; verify it matches the task-request resource
  const taskResource = manifest.resources.find((r) => r.resource.includes('/task-request'));
  const challengeResource = challenge.resource.url;

  assert.equal(taskResource.resource, challengeResource,
    '402 challenge resource URL matches discovery manifest task-request');
  assert.equal(challengeResource, 'https://api.xfuel.app/task-request',
    'challenge points to the absolute /task-request URL');
});

test('402 challenge includes top-level bazaar extension for CDP cataloging', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'catalog-test',
    maxAmountRequired: '10000',
    baseUrl: 'https://api.xfuel.app',
  });

  assert.equal(body.x402Version, 2);
  assert.ok(body.resource.url.startsWith('https://'), 'resource.url is absolute https URL');

  assert.ok(body.extensions, 'extensions object present at top level');
  assert.ok(body.extensions[BAZAAR_EXTENSION_KEY], 'bazaar extension present');
  assert.ok(body.extensions[BAZAAR_EXTENSION_KEY].info.input.type, 'info.input.type present');
  assert.ok(body.extensions[BAZAAR_EXTENSION_KEY].info.output.type, 'info.output.type present');

  assert.equal(body.accepts[0].network, 'eip155:8453');
  assert.equal(body.accepts[0].amount, '10000');
  assert.ok(!body.resource.url.includes('catalog-test'), 'resource URL is not per-task');
});

test('buildX402Manifest: emits root-relative links when no base URL is known', () => {
  const m = buildX402Manifest('');
  // Both resources use root-relative paths
  const chatResource = m.resources.find((r) => r.resource.includes('/v1/chat/completions'));
  const taskResource = m.resources.find((r) => r.resource.includes('/task-request'));
  assert.equal(chatResource.resource, '/v1/chat/completions');
  assert.equal(taskResource.resource, '/task-request');
  assert.equal(m.links.agent_manifest, '/llms.txt');
  assert.equal(m.links.agent_card, '/.well-known/agent-card.json');
  assert.equal(m.links.agents_register, '/v1/agents/register');
});

test('buildX402Manifest: trims a trailing slash on the base URL', () => {
  const m = buildX402Manifest('https://api-testnet.xfuel.app/');
  const taskResource = m.resources.find((r) => r.resource.includes('/task-request'));
  assert.equal(taskResource.resource, 'https://api-testnet.xfuel.app/task-request');
});

test('buildOpenApiSpec: x402scan document lists chat first with x-payment-info', () => {
  const spec = buildOpenApiSpec('https://api.xfuel.app');

  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'XFuel');
  assert.equal(typeof spec.info.version, 'string');
  assert.equal(typeof spec.info['x-guidance'], 'string');
  assert.match(spec.info['x-guidance'], /\/v1\/chat\/completions/);
  assert.ok(!/public door is POST \/task-request/i.test(spec.info['x-guidance']));
  assert.deepEqual(spec.servers, [{ url: 'https://api.xfuel.app' }]);

  const pathKeys = Object.keys(spec.paths);
  assert.deepEqual(pathKeys, ['/v1/chat/completions', '/task-request', '/v1/agents/register'],
    'chat completions is the public door; task-request is second; register is identity');
  assert.equal(spec.paths['/v1/agents/register'].post['x-payment-info'], undefined,
    'register is not the $0.01 paid door');

  const chat = spec.paths['/v1/chat/completions'].post;
  const task = spec.paths['/task-request'].post;
  for (const op of [chat, task]) {
    assert.ok(op.responses[402] || op.responses['402'], 'paid op declares 402');
    assert.equal(op['x-payment-info'].price.mode, 'fixed');
    assert.equal(op['x-payment-info'].price.currency, 'USD');
    assert.equal(op['x-payment-info'].price.amount, '0.01',
      'OpenAPI price is decimal USD, not atomic 10000');
    assert.deepEqual(op['x-payment-info'].protocols, [{ x402: {} }]);
    assert.equal(op.requestBody.content['application/json'].schema.type, 'object');
  }
  assert.ok(chat.requestBody.content['application/json'].schema.required.includes('messages'));
  assert.ok(task.requestBody.content['application/json'].schema.required.includes('sender'));
});

test('buildOpenApiSpec: omits servers when no base URL is known', () => {
  const spec = buildOpenApiSpec('');
  assert.equal(spec.servers, undefined);
  assert.ok(spec.paths['/v1/chat/completions']);
});
