import test from 'node:test';
import assert from 'node:assert/strict';
import { buildX402Manifest } from '../src/x402-discovery.js';
import { buildPaymentChallenge, BAZAAR_EXTENSION_KEY } from '../src/x402-adapter.js';

test('buildX402Manifest: describes the /task-request USDC resource in the bazaar shape', () => {
  const m = buildX402Manifest('https://api-testnet.xfuel.app');

  assert.equal(m.x402Version, 1);
  assert.equal(m.name, 'XFuel Protocol');
  assert.equal(typeof m.description, 'string');
  assert.equal(typeof m.x402_enabled, 'boolean');
  assert.ok(['usdc', 'tfuel'].includes(m.default_rail));

  // Facilitator block reflects config.
  assert.ok(m.facilitator);
  assert.ok(['x402', 'zan'].includes(m.facilitator.protocol));

  // Exactly one paid resource: POST /task-request (absolute), with an `accepts` entry.
  assert.equal(m.resources.length, 1);
  const r = m.resources[0];
  assert.equal(r.type, 'http');
  assert.equal(r.method, 'POST');
  assert.equal(r.resource, 'https://api-testnet.xfuel.app/task-request');
  assert.equal(r.accepts[0].scheme, 'exact');
  assert.equal(typeof r.accepts[0].maxAmountRequired, 'string');
  assert.ok(r.outputSchema.required.includes('verify_url'));
  assert.ok(r.input.required.includes('sender'));
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

  const manifestResource = manifest.resources[0].resource;
  const challengeResource = challenge.accepts[0].resource;

  assert.equal(manifestResource, challengeResource,
    '402 challenge resource URL matches discovery manifest');
  assert.equal(challengeResource, 'https://api.xfuel.app/task-request',
    'both point to the absolute /task-request URL');
});

test('402 challenge includes bazaar extension for CDP cataloging', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'catalog-test',
    maxAmountRequired: '10000',
    baseUrl: 'https://api.xfuel.app',
  });

  const a = body.accepts[0];

  // CDP Bazaar cataloging requires:
  // 1. Absolute https:// resource URL
  assert.ok(a.resource.startsWith('https://'), 'resource is absolute https URL');

  // 2. extensions.bazaar with info.input.type and info.output.type
  assert.ok(a.extensions, 'extensions object present');
  assert.ok(a.extensions[BAZAAR_EXTENSION_KEY], 'bazaar extension present');
  assert.ok(a.extensions[BAZAAR_EXTENSION_KEY].info.input.type, 'info.input.type present');
  assert.ok(a.extensions[BAZAAR_EXTENSION_KEY].info.output.type, 'info.output.type present');

  // 3. routeTemplate as the catalog key (not per-task)
  assert.ok(a.routeTemplate, 'routeTemplate present');
  assert.ok(!a.routeTemplate.includes('catalog-test'), 'routeTemplate is not per-task');
});

test('buildX402Manifest: emits root-relative links when no base URL is known', () => {
  const m = buildX402Manifest('');
  assert.equal(m.resources[0].resource, '/task-request');
  assert.equal(m.links.agent_manifest, '/llms.txt');
});

test('buildX402Manifest: trims a trailing slash on the base URL', () => {
  const m = buildX402Manifest('https://api-testnet.xfuel.app/');
  assert.equal(m.resources[0].resource, 'https://api-testnet.xfuel.app/task-request');
});
