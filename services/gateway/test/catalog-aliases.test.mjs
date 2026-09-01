/**
 * Typed aliases + live-hub auto preferences (2026-08-30 live set).
 *
 * Desktop agents send `deepseek`, `llama-3.3`, `auto` — not hub-prefixed ids.
 * Preferences must land on rows GET /v1/models actually lists; missing GLM-5.2
 * must not 409 auto; kimi/gpt-4o/grok must not silently become Llama.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCatalogModel,
  pickAutoPreference,
  autoPreferenceFor,
  liveCatalogIds,
} from '../src/hub-catalog.js';

/** Snapshot of live chat rows (api.xfuel.app 2026-08-30) — no invented Kimi. */
const LIVE = [
  { id: 'xfuel/auto', hub: 'xfuel', alias: 'auto', modality: 'chat' },
  { id: 'theta/glm_5_3', hub: 'theta', alias: 'glm_5_3', modality: 'chat', capacity: 1 },
  { id: 'theta/glm_5_3_flash', hub: 'theta', alias: 'glm_5_3_flash', modality: 'chat', capacity: 0 },
  { id: 'theta/qwen3', hub: 'theta', alias: 'qwen3', modality: 'chat', capacity: 1 },
  { id: 'akash/deepseek-ai/DeepSeek-V4-Flash-0731', hub: 'akash', alias: 'deepseek-ai/DeepSeek-V4-Flash-0731', modality: 'chat' },
  { id: 'akash/Qwen/Qwen3.8-27B', hub: 'akash', alias: 'Qwen/Qwen3.8-27B', modality: 'chat' },
  { id: 'akash/Qwen/Qwen3.6-35B-A3B', hub: 'akash', alias: 'Qwen/Qwen3.6-35B-A3B', modality: 'chat' },
  { id: 'akash/openai/gpt-oss-120b', hub: 'akash', alias: 'openai/gpt-oss-120b', modality: 'chat' },
  { id: 'akash/zai-org/GLM-5.3', hub: 'akash', alias: 'zai-org/GLM-5.3', modality: 'chat' },
  { id: 'akash/openai/gpt-oss-20b', hub: 'akash', alias: 'openai/gpt-oss-20b', modality: 'chat' },
  { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', alias: 'meta-llama/Llama-3.3-70B-Instruct', modality: 'chat' },
];

test('live DeepSeek id is listed and deepseek alias resolves to it', () => {
  assert.ok(LIVE.some((m) => m.id === 'akash/deepseek-ai/DeepSeek-V4-Flash-0731'));
  const r = resolveCatalogModel('deepseek', LIVE, { modality: 'chat' });
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'akash/deepseek-ai/DeepSeek-V4-Flash-0731');
  assert.equal(r.model.hub, 'akash');
  assert.notEqual(r.model.hub, 'deepseek');
});

test('typed aliases people send map onto live hub rows only', () => {
  const cases = {
    'deepseek-chat': 'akash/deepseek-ai/DeepSeek-V4-Flash-0731',
    'llama-3.3': 'akash/meta-llama/Llama-3.3-70B-Instruct',
    'llama-3.3-70b': 'akash/meta-llama/Llama-3.3-70B-Instruct',
    'gpt-oss': 'akash/openai/gpt-oss-120b',
    'gpt-oss-120b': 'akash/openai/gpt-oss-120b',
    glm: 'akash/zai-org/GLM-5.3',
    'glm-5.3': 'akash/zai-org/GLM-5.3',
    qwen: 'akash/Qwen/Qwen3.8-27B',
    qwen3: 'akash/Qwen/Qwen3.8-27B',
  };
  for (const [name, id] of Object.entries(cases)) {
    const r = resolveCatalogModel(name, LIVE, { modality: 'chat' });
    assert.equal(r.ok, true, name);
    assert.equal(r.model.id, id, name);
  }
});

test('qwen / qwen3 stamp Akash hub id — never alias as hub, never theta/qwen3', () => {
  for (const name of ['qwen', 'qwen3']) {
    const r = resolveCatalogModel(name, LIVE, { modality: 'chat' });
    assert.equal(r.ok, true, name);
    assert.equal(r.model.id, 'akash/Qwen/Qwen3.8-27B', name);
    assert.equal(r.model.hub, 'akash', name);
    assert.equal(r.model.alias, 'Qwen/Qwen3.8-27B', name);
    assert.notEqual(r.model.hub, 'qwen', name);
    assert.notEqual(r.model.id, 'theta/qwen3', name);
  }
});

test('explicit theta/qwen3 stays Theta (named miss stays named)', () => {
  const r = resolveCatalogModel('theta/qwen3', LIVE, { modality: 'chat' });
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'theta/qwen3');
  assert.equal(r.model.hub, 'theta');
});

test('qwen falls back to Akash 3.6 when 3.8 is absent', () => {
  const without38 = LIVE.filter((m) => m.id !== 'akash/Qwen/Qwen3.8-27B');
  const r = resolveCatalogModel('qwen', without38, { modality: 'chat' });
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'akash/Qwen/Qwen3.6-35B-A3B');
});

test('qwen never remaps onto theta even when Theta is the only qwen left', () => {
  const thetaOnly = LIVE.filter((m) => m.hub === 'theta' || m.hub === 'xfuel');
  assert.ok(thetaOnly.some((m) => m.id === 'theta/qwen3'));
  const r = resolveCatalogModel('qwen3', thetaOnly, { modality: 'chat' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'model_not_found');
});

test('xfuel/auto does not pick theta/qwen3 when Akash Qwen or Llama is live', () => {
  // Even if Theta lies with capacity>0, auto preferences skip it.
  const withLie = LIVE.map((m) => (
    m.id === 'theta/qwen3' ? { ...m, capacity: 99 } : m
  ));
  const simple = resolveCatalogModel('xfuel/auto', withLie, { modality: 'chat', shape: 'simple' });
  assert.equal(simple.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
  assert.notEqual(simple.model.id, 'theta/qwen3');

  const noLlamaNoGlm = withLie.filter(
    (m) => !/Llama|GLM|DeepSeek|gpt-oss/i.test(m.id),
  );
  const next = resolveCatalogModel('xfuel/auto', noLlamaNoGlm, { modality: 'chat', shape: 'simple' });
  assert.equal(next.model.id, 'akash/Qwen/Qwen3.8-27B');
});

test('receipt stamp stays hub + native id — alias is never the hub', () => {
  const r = resolveCatalogModel('llama-3.3', LIVE);
  assert.equal(r.model.hub, 'akash');
  assert.equal(r.model.alias, 'meta-llama/Llama-3.3-70B-Instruct');
  assert.equal(r.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
});

test('agent auto prefers live GLM when GLM-5.2 is gone (no 409)', () => {
  assert.ok(!LIVE.some((m) => /GLM-5\.2/i.test(m.id)));
  const r = resolveCatalogModel('xfuel/auto', LIVE, { modality: 'chat', shape: 'agent' });
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'akash/zai-org/GLM-5.3');
});

test('simple auto prefers Llama, then DeepSeek (cheap long-context)', () => {
  const r = resolveCatalogModel('xfuel/auto', LIVE, { modality: 'chat', shape: 'simple' });
  assert.equal(r.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');

  const withoutLlama = LIVE.filter((m) => !/Llama/i.test(m.id));
  const next = resolveCatalogModel('xfuel/auto', withoutLlama, { modality: 'chat', shape: 'simple' });
  assert.equal(next.model.id, 'akash/deepseek-ai/DeepSeek-V4-Flash-0731');
});

test('pickAutoPreference: GLM-5.2 key lands on newest live Akash GLM', () => {
  const hit = pickAutoPreference('akash/zai-org/GLM-5.2', LIVE);
  assert.equal(hit?.id, 'akash/zai-org/GLM-5.3');
  assert.equal(pickAutoPreference('akash/zai-org/GLM', LIVE)?.id, 'akash/zai-org/GLM-5.3');
});

test('kimi-k3 with no hub row is model_not_found — not Llama', () => {
  const r = resolveCatalogModel('kimi-k3', LIVE, { modality: 'chat' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'model_not_found');
  assert.ok(Array.isArray(r.available));
  assert.ok(r.available.includes('akash/deepseek-ai/DeepSeek-V4-Flash-0731'));
  assert.ok(!r.available.some((id) => /kimi/i.test(id)));
});

test('gpt-4o and grok refuse — no bait-and-switch onto Llama', () => {
  for (const name of ['gpt-4o', 'grok', 'kimi']) {
    const r = resolveCatalogModel(name, LIVE, { modality: 'chat' });
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'model_not_found', name);
  }
});

test('unknown name lists live ids and vendor-neutral hint', () => {
  const r = resolveCatalogModel('totally-made-up', LIVE);
  assert.equal(r.ok, false);
  assert.deepEqual(r.available, liveCatalogIds(LIVE));
  assert.match(r.hint, /xfuel\/auto/);
  assert.match(r.hint, /GET \/v1\/models/);
  assert.ok(!r.hint.includes('theta/'), 'hint must not name vendor-prefixed examples');
  assert.ok(!r.hint.includes('akash/'), 'hint must not name vendor-prefixed examples');
});

test('autoPreferenceFor agent first key resolves against live catalog', () => {
  const [first] = autoPreferenceFor('agent');
  const hit = pickAutoPreference(first, LIVE);
  assert.ok(hit, `first preference ${first} must match a live row`);
  assert.equal(hit.hub, 'akash');
  assert.match(hit.alias, /GLM-/i);
});

test('do not invent a Kimi row when Akash has not listed one', () => {
  assert.ok(!LIVE.some((m) => /kimi|moonshot/i.test(m.id)));
  const r = resolveCatalogModel('kimi-k2.7', LIVE);
  assert.equal(r.ok, false);
});

test('"default" alias routes to xfuel/auto (Bankr 2026-09-01)', () => {
  const r = resolveCatalogModel('default', LIVE, { modality: 'chat' });
  assert.equal(r.ok, true, 'default should resolve to a model');
  assert.notEqual(r.model.id, 'xfuel/auto', 'should resolve to concrete model, not alias');
  assert.equal(r.model.hub, 'akash', 'default should route to a live hub');
});

test('empty and missing model ids route to xfuel/auto', () => {
  for (const input of ['', null, undefined]) {
    const r = resolveCatalogModel(input, LIVE, { modality: 'chat' });
    assert.equal(r.ok, true, `input=${JSON.stringify(input)} should resolve`);
    assert.notEqual(r.model.id, 'xfuel/auto', 'should resolve to concrete model');
    assert.ok(r.model.hub === 'akash' || r.model.hub === 'theta', 'should route to a real hub');
  }
});

test('model_retired hint is vendor-neutral', () => {
  const r = resolveCatalogModel('llama-3-70b', LIVE, { modality: 'chat' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'model_retired');
  assert.match(r.hint, /xfuel\/auto/);
  assert.ok(!r.hint.includes('theta/'), 'retired hint must not name vendor-prefixed examples');
  assert.ok(!r.hint.includes('akash/'), 'retired hint must not name vendor-prefixed examples');
});
