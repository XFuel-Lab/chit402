import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSuccess,
  recordFailure,
  isDown,
  healthOf,
  healthSnapshot,
  resetHealth,
  probeModels,
  probingEnabled,
  startHealthProbes,
  stopHealthProbes,
} from '../src/provider-health.js';
import { resolveCatalogModel, isRoutable, toOpenAIList } from '../src/hub-catalog.js';

const M = 'akash/zai-org/GLM-5.2';

beforeEach(() => {
  resetHealth();
  delete process.env.PROVIDER_HEALTH_PROBE;
  delete process.env.PROVIDER_HEALTH_FAIL_THRESHOLD;
  delete process.env.PROVIDER_HEALTH_STALE_MS;
});
afterEach(() => {
  stopHealthProbes();
  resetHealth();
});

const failTimes = (n, id = M) => { for (let i = 0; i < n; i += 1) recordFailure(id, { reason: 'http_503' }); };

test('one failure is not an outage', () => {
  // A single failed call is noise — providers hiccup. Delisting on the first
  // one would make routing flap on every transient error.
  recordFailure(M, { reason: 'http_500' });
  assert.equal(isDown(M), false);
  assert.equal(healthOf(M).status, 'degraded');
});

test('a run of failures marks the model down', () => {
  failTimes(3);
  assert.equal(isDown(M), true);
  const h = healthOf(M);
  assert.equal(h.status, 'down');
  assert.equal(h.consecutive_failures, 3);
  assert.equal(h.last_error, 'http_503');
});

test('one success is enough to come back', () => {
  failTimes(5);
  assert.equal(isDown(M), true);
  // Recovery is deliberately asymmetric with failure. Being wrong here costs one
  // failed request; refusing to recover keeps working capacity offline, and on a
  // model nobody is calling there may be no second chance to find out.
  recordSuccess(M, { latencyMs: 120 });
  assert.equal(isDown(M), false);
  assert.equal(healthOf(M).status, 'available');
  assert.equal(healthOf(M).latency_ms, 120);
});

test('stale failures stop counting', () => {
  // Without expiry, three failures an hour ago delist a model forever — a
  // transient blip becomes permanent, because nothing will call it again to
  // prove otherwise.
  process.env.PROVIDER_HEALTH_STALE_MS = '1000';
  failTimes(3);
  assert.equal(isDown(M), true);
  const later = Date.now() + 5_000;
  assert.equal(isDown(M, { now: later }), false);
  assert.equal(healthOf(M, { now: later }).status, 'stale');
});

test('nothing is known about a model nobody has called', () => {
  assert.equal(healthOf('akash/never-used'), null);
  assert.equal(isDown('akash/never-used'), false);
  assert.equal(isRoutable({ id: 'akash/never-used' }), true);
});

test('the failure threshold is configurable', () => {
  process.env.PROVIDER_HEALTH_FAIL_THRESHOLD = '2';
  failTimes(2);
  assert.equal(isDown(M), true);
});

// ── Routing ──────────────────────────────────────────────────────────────────

test('xfuel/auto routes around a model that keeps failing', () => {
  const models = [
    { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', modality: 'chat' },
    { id: M, hub: 'akash', modality: 'chat' },
  ];
  assert.equal(resolveCatalogModel('xfuel/auto', models).model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');

  failTimes(3, 'akash/meta-llama/Llama-3.3-70B-Instruct');
  assert.equal(resolveCatalogModel('xfuel/auto', models).model.id, M);
});

test('a total outage still routes somewhere rather than refusing', () => {
  // The dangerous failure mode: health rules out everything and every request
  // becomes no_chat_models. Refusing to try is worse than trying and failing —
  // and it also prevents the success that would clear the state.
  const models = [
    { id: M, hub: 'akash', modality: 'chat' },
    { id: 'theta/qwen3', hub: 'theta', modality: 'chat', capacity: 0 },
  ];
  failTimes(3);
  const res = resolveCatalogModel('xfuel/auto', models);
  assert.equal(res.ok, true);
  assert.ok(res.model.id);
});

test('/v1/models reports observed health, and a failing model overrides its own hub', () => {
  failTimes(3, 'theta/glm_5_2');
  const list = toOpenAIList([
    { id: 'theta/glm_5_2', hub: 'theta', modality: 'chat', capacity: 1 },
    { id: M, hub: 'akash', modality: 'chat' },
  ]);
  const at = (id) => list.data.find((m) => m.id === id).availability;

  // Theta claims a worker is attached; calls to it are failing. The outcome wins
  // over the claim.
  assert.equal(at('theta/glm_5_2').status, 'down');
  assert.equal(at('theta/glm_5_2').workers, 1);
  assert.equal(at('theta/glm_5_2').health.consecutive_failures, 3);

  assert.equal(at(M).status, 'unknown');
});

// ── Probing ──────────────────────────────────────────────────────────────────

test('probing is off unless asked for — it spends real money', () => {
  assert.equal(probingEnabled(), false);
  assert.equal(startHealthProbes(async () => ({ models: [] })), false);
  process.env.PROVIDER_HEALTH_PROBE = 'true';
  assert.equal(probingEnabled(), true);
});

test('a probe sweep records health per model', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    return body.model.includes('Llama')
      ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
      : new Response('nope', { status: 503 });
  };

  const out = await probeModels([M, 'akash/meta-llama/Llama-3.3-70B-Instruct'], {
    baseUrl: 'https://example.test/v1',
    apiKey: 'k',
    fetchFn,
  });

  assert.equal(out.probed, 2);
  // The hub prefix is ours, not the provider's — probing `akash/x` would 404.
  assert.deepEqual(seen.map((b) => b.model), ['zai-org/GLM-5.2', 'meta-llama/Llama-3.3-70B-Instruct']);
  // Liveness only: one token is enough to learn whether the provider answers.
  assert.equal(seen[0].max_tokens, 1);

  assert.equal(healthOf(M).status, 'degraded');
  assert.equal(healthOf(M).source, 'probe');
  assert.equal(healthOf('akash/meta-llama/Llama-3.3-70B-Instruct').status, 'available');
});

test('a probe sweep without an API key does nothing rather than failing everything', async () => {
  const out = await probeModels([M], { baseUrl: 'https://example.test/v1', apiKey: '' });
  assert.equal(out.skipped, 'no_api_key');
  // Crucially it must not have recorded a failure: a missing key is our
  // misconfiguration, and marking every model down over it would take the
  // gateway offline for a reason that has nothing to do with the provider.
  assert.equal(healthOf(M), null);
});

test('the snapshot counts what is down', () => {
  failTimes(3);
  recordSuccess('akash/other');
  const snap = healthSnapshot();
  assert.equal(snap.tracked, 2);
  assert.equal(snap.down, 1);
  assert.equal(snap.probing, false);
  assert.equal(snap.models[M].status, 'down');
});
