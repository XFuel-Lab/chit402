/**
 * The paid path used to serve mocks.
 *
 * `/task-request` settled USDC, took its fee, and returned a validly signed
 * receipt attesting `provider: theta-edge-mock` — a cryptographic attestation of
 * an inference that never happened. Three separate defects stacked up:
 *
 *   1. `preferred_provider` defaulted to the *float treasury* default, which
 *      pinned every request to a hub that had no API key.
 *   2. `xfuel/auto` was forwarded to the upstream verbatim, which 404s — it is
 *      an XFuel-side alias, not a model any hub knows.
 *   3. Neither failure surfaced: both fell through to mock and reported success.
 *
 * The whole suite was green throughout, so these guard the seams that were
 * silently wrong rather than the happy path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, mergeReceiptView } from '../src/receipt.js';
import { resolveCatalogModel, requestShape } from '../src/hub-catalog.js';

const CATALOG = [
  { id: 'akash/zai-org/GLM-5.3', alias: 'zai-org/GLM-5.3', hub: 'akash', modality: 'chat' },
  { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', alias: 'meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', modality: 'chat' },
  { id: 'akash/deepseek-ai/DeepSeek-V4-Flash-0731', alias: 'deepseek-ai/DeepSeek-V4-Flash-0731', hub: 'akash', modality: 'chat' },
  { id: 'akash/openai/gpt-oss-120b', alias: 'openai/gpt-oss-120b', hub: 'akash', modality: 'chat' },
  { id: 'theta/qwen3', alias: 'qwen3', hub: 'theta', modality: 'chat' },
  { id: 'theta/glm_5_3', alias: 'glm_5_3', hub: 'theta', modality: 'chat' },
];

test('xfuel/auto resolves to a concrete hub model, never passed through raw', () => {
  const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat' });
  assert.equal(res.ok, true);
  assert.notEqual(res.model.id, 'xfuel/auto');
  assert.ok(res.model.hub === 'akash' || res.model.hub === 'theta');
  // The alias sent upstream must be hub-native — no `akash/` prefix, no `xfuel/`.
  assert.ok(!res.model.alias.startsWith('akash/'));
  assert.ok(!res.model.alias.startsWith('xfuel/'));
});

test('scoping auto to one hub keeps the evidence-led ordering within it', () => {
  // "auto, but on Theta" is resolved by filtering the catalog, so the pick must
  // still come from the preference list rather than whatever is first.
  const theta = resolveCatalogModel('xfuel/auto', CATALOG.filter((m) => m.hub === 'theta'), {});
  assert.equal(theta.ok, true);
  assert.equal(theta.model.hub, 'theta');
  assert.equal(theta.model.id, 'theta/qwen3');

  const akash = resolveCatalogModel('xfuel/auto', CATALOG.filter((m) => m.hub === 'akash'), { shape: 'agent' });
  assert.equal(akash.model.id, 'akash/zai-org/GLM-5.3');
});

// ── `xfuel/auto` routes on the shape of the request ──────────────────────────
// One fixed default cannot serve both workloads. GLM is the only family that
// completes an agent loop (6/6 against Llama's 0/6), but it is a reasoning model
// that returns nothing below max_tokens=256 and burns ~110 output tokens to say
// one word — so making it the blanket default breaks short completions and bills
// ~37x for them. See docs/MODEL_QUALITY_EVAL.md.

test('a tool-carrying request is recognised as agent work', () => {
  assert.equal(requestShape({ tools: [{ type: 'function' }] }), 'agent');
});

test('feeding a tool result back is agent work even with no tools declared', () => {
  assert.equal(requestShape({ messages: [{ role: 'tool', content: '{}' }] }), 'agent');
  assert.equal(requestShape({ messages: [{ role: 'assistant', tool_calls: [{ id: 'c1' }] }] }), 'agent');
});

test('a plain completion is not agent work', () => {
  assert.equal(requestShape({ messages: [{ role: 'user', content: 'hi' }] }), 'simple');
  assert.equal(requestShape({ tools: [] }), 'simple');
  assert.equal(requestShape({}), 'simple');
});

test('agent-shaped auto resolves to the model that completes loops', () => {
  const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat', shape: 'agent' });
  assert.equal(res.model.id, 'akash/zai-org/GLM-5.3');
});

test('a short completion does not get routed to the reasoning model', () => {
  // Routing a `max_tokens=16` call to GLM returns an empty answer and charges
  // for the reasoning that ate the budget.
  const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat', shape: 'simple' });
  assert.equal(res.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
});

test('an unspecified shape stays on the cheap, compatible default', () => {
  const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat' });
  assert.equal(res.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
});

test('the override wins over both shapes', () => {
  process.env.XFUEL_AUTO_MODEL = 'akash/openai/gpt-oss-120b';
  try {
    for (const shape of ['agent', 'simple']) {
      const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat', shape });
      assert.equal(res.model.id, 'akash/openai/gpt-oss-120b', `shape=${shape}`);
    }
  } finally {
    delete process.env.XFUEL_AUTO_MODEL;
  }
});

test('an unknown XFUEL_AUTO_MODEL falls back rather than failing every request', () => {
  process.env.XFUEL_AUTO_MODEL = 'akash/typo-not-a-model';
  try {
    const res = resolveCatalogModel('xfuel/auto', CATALOG, { modality: 'chat', shape: 'agent' });
    assert.equal(res.ok, true);
    assert.equal(res.model.id, 'akash/zai-org/GLM-5.3');
  } finally {
    delete process.env.XFUEL_AUTO_MODEL;
  }
});

test('a model no hub serves is rejected, so routing can fail instead of mocking', () => {
  const res = resolveCatalogModel('acme/does-not-exist', CATALOG, { modality: 'chat' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'model_not_found');
});

test('receipt names the model that served, not the xfuel/auto alias asked for', () => {
  const r = buildReceipt({
    taskId: 't-served',
    status: 'completed',
    intent: { type: 'inference_request', modelId: 'xfuel/auto', paymentRail: 'usdc', amount: '10000' },
    result: { model: 'meta-llama/Llama-3.3-70B-Instruct', provider: 'akash-network' },
    meta: { chain: 'base' },
  }, { baseUrl: 'https://api-testnet.xfuel.app' });

  assert.equal(mergeReceiptView(r).route.model, 'meta-llama/Llama-3.3-70B-Instruct');
  assert.equal(mergeReceiptView(r).route.provider, 'akash-network');
});

test('a failed task attests no provider, even when a float default is set', () => {
  // meta.provider carries PROVIDER_FLOAT_DEFAULT. Naming it here would have the
  // receipt credit a provider that never ran the task.
  const r = buildReceipt({
    taskId: 't-failed',
    status: 'failed',
    intent: { type: 'inference_request', modelId: 'acme/nope', paymentRail: 'usdc', amount: '10000' },
    meta: { chain: 'base', provider: 'theta-edgecloud' },
  }, { baseUrl: 'https://api-testnet.xfuel.app' });

  assert.equal(mergeReceiptView(r).route.provider, null);
});

test('a real COGS burn outranks the float default label', () => {
  const r = buildReceipt({
    taskId: 't-cogs',
    status: 'completed',
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '10000' },
    meta: {
      chain: 'base',
      provider: 'theta-edgecloud',
      providerCogs: { provider: 'akash-network', currency: 'USDC', estimated: '100', actual: '90' },
    },
  }, { baseUrl: 'https://api-testnet.xfuel.app' });

  assert.equal(mergeReceiptView(r).route.provider, 'akash-network');
});

test('a mock result is still reported as mock, never as a real provider', () => {
  const r = buildReceipt({
    taskId: 't-mock',
    status: 'completed',
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '10000' },
    result: { mock: true, provider: 'theta-edge-mock' },
    meta: { chain: 'base', provider: 'theta-edgecloud' },
  }, { baseUrl: 'https://api-testnet.xfuel.app' });

  assert.equal(mergeReceiptView(r).route.provider, 'theta-edge-mock');
});
