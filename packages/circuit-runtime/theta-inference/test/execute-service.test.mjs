/**
 * Regression test for the *real* ThetaInferenceHandler._executeService waterfall
 * after the ComputeRouter extraction. Unlike the inlined unit suite, this drives
 * the actual handler method (with the flag off / default routing) so the
 * refactored path is genuinely exercised.
 *
 * Lightweight by design: the network-facing _call* tiers are stubbed; on-chain
 * (no this.contract) and proof (no ctx.generateProof) steps are skipped.
 *
 * Run: node --test circuits/theta-inference/test/execute-service.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThetaInferenceHandler } from '../theta-inference-handler.js';

const SERVICE_TYPE_LLM = 0;

function makeHandler(overrides = {}) {
  const h = new ThetaInferenceHandler({});
  // Skip async key resolution and force a deterministic credential state
  // (ignore any ambient THETA_* env vars in the test environment).
  h._keyResolved = true;
  h.edgeCloudApiKey = '';
  h.rapidApiKey = '';
  h.mcpEndpoint = '';
  h.akashMnemonic = '';
  h.renderApiKey = '';
  h.awsAccessKeyId = '';
  h.awsSecretAccessKey = '';
  Object.assign(h, overrides);
  return h;
}

const intent = { args: { intentId: 'reg-test-1', gpuTier: 0 } };
const ctx = { chain: 'theta_testnet' }; // no generateProof, no on-chain contract
const requestBody = { model: 'llama-3.1-8b', prompt: 'hello' };

test('_executeService: EdgeCloud success wins (priority 1)', async () => {
  const h = makeHandler({ edgeCloudApiKey: 'k' });
  let called = false;
  h._callEdgeCloud = async () => { called = true; return { text: 'edge-ok' }; };
  h._callRapidAPI = async () => { throw new Error('should not be reached'); };

  const out = await h._executeService(intent, ctx, SERVICE_TYPE_LLM, requestBody);
  assert.equal(called, true);
  assert.equal(out.outcome, 'fulfilled');
  assert.equal(out.details.source, 'edgecloud');
  assert.equal(h.apiStats.mock.calls, 0);
});

test('_executeService: EdgeCloud null → RapidAPI fallthrough (priority 2)', async () => {
  const h = makeHandler({ edgeCloudApiKey: 'k', rapidApiKey: 'r' });
  const order = [];
  h._callEdgeCloud = async () => { order.push('edge'); return null; };
  h._callRapidAPI = async () => { order.push('rapid'); return { text: 'rapid-ok' }; };
  h._callMCP = async () => { throw new Error('should not be reached'); };

  const out = await h._executeService(intent, ctx, SERVICE_TYPE_LLM, requestBody);
  assert.deepEqual(order, ['edge', 'rapid']);
  assert.equal(out.details.source, 'rapidapi');
});

test('_executeService: no credentials → mock fallback with warning', async () => {
  const h = makeHandler(); // all keys empty
  const out = await h._executeService(intent, ctx, SERVICE_TYPE_LLM, requestBody);
  assert.equal(out.outcome, 'fulfilled');
  assert.equal(out.details.source, 'mock');
  assert.equal(h.apiStats.mock.calls, 1);
  const entry = h.activeIntents.get('reg-test-1');
  assert.ok(entry, 'active intent tracked');
  assert.equal(entry.result._mock, true);
  assert.match(entry.result._warning, /no API keys configured/);
});

test('_executeService: deep fallthrough reaches Bedrock (priority 6)', async () => {
  const h = makeHandler({ awsAccessKeyId: 'id', awsSecretAccessKey: 'sk' });
  const order = [];
  h._callBedrock = async () => { order.push('bedrock'); return { text: 'bedrock-ok' }; };
  const out = await h._executeService(intent, ctx, SERVICE_TYPE_LLM, requestBody);
  assert.deepEqual(order, ['bedrock']);
  assert.equal(out.details.source, 'bedrock');
});
