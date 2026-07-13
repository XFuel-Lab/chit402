import test from 'node:test';
import assert from 'node:assert/strict';
import { buildX402Manifest } from '../src/x402-discovery.js';

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

test('buildX402Manifest: emits root-relative links when no base URL is known', () => {
  const m = buildX402Manifest('');
  assert.equal(m.resources[0].resource, '/task-request');
  assert.equal(m.links.agent_manifest, '/llms.txt');
});

test('buildX402Manifest: trims a trailing slash on the base URL', () => {
  const m = buildX402Manifest('https://api-testnet.xfuel.app/');
  assert.equal(m.resources[0].resource, 'https://api-testnet.xfuel.app/task-request');
});
