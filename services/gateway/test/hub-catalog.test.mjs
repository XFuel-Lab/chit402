import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThetaService,
  mapThetaService,
  mapAkashService,
  resolveCatalogModel,
  toOpenAIList,
  getHubCatalog,
  resetHubCatalogCache,
  CATALOG_SEED,
} from '../src/hub-catalog.js';

beforeEach(() => {
  resetHubCatalogCache();
  process.env.HUB_CATALOG_OFFLINE = 'true';
});

test('classifyThetaService: chat / audio / image', () => {
  assert.equal(classifyThetaService({
    alias: 'qwen3',
    default_prediction: 'completions',
    predictions: { completions: { input_vars: { messages: { type: 'chat_array' } } } },
  }).modality, 'chat');

  assert.equal(classifyThetaService({
    alias: 'whisper',
    default_prediction: 'stt',
    predictions: { stt: { input_vars: { audio_filename: { type: 'filename' } } } },
  }).modality, 'audio');

  assert.equal(classifyThetaService({
    alias: 'stable_diffusion_xl_turbo',
    default_prediction: 'predict',
    predictions: { predict: { input_vars: { prompt: { type: 'string' } } } },
  }).modality, 'image');
});

test('mapThetaService builds hub-prefixed id', () => {
  const m = mapThetaService({
    alias: 'glm_5_2',
    name: 'GLM 5.2',
    state: 'public',
    default_prediction: 'completions',
    predictions: { completions: { input_vars: { messages: {} }, cost: { input: 1, output: 2 } } },
    create_time: '2026-06-25T05:17:23.564Z',
  });
  assert.equal(m.id, 'theta/glm_5_2');
  assert.equal(m.modality, 'chat');
  assert.equal(m.owned_by, 'theta-edgecloud');
});

test('mapAkashService builds akash/<nativeId> id', () => {
  const m = mapAkashService({
    id: 'zai-org/GLM-5.3',
    name: 'GLM-5.3',
    created: 1_700_000_100,
    owned_by: 'akashml',
    pricing: { input: '0.1', output: '0.2' },
  });
  assert.equal(m.id, 'akash/zai-org/GLM-5.3');
  assert.equal(m.hub, 'akash');
  assert.equal(m.alias, 'zai-org/GLM-5.3');
  assert.equal(m.modality, 'chat');
  assert.equal(m.owned_by, 'akashml');
});

test('resolveCatalogModel rejects retired llama fiction', () => {
  const r = resolveCatalogModel('llama-3-70b', [...CATALOG_SEED]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'model_retired');
});

test('resolveCatalogModel maps xfuel/auto to a chat model', () => {
  const r = resolveCatalogModel('xfuel/auto', [...CATALOG_SEED, {
    id: 'xfuel/auto', hub: 'xfuel', alias: 'auto', modality: 'chat',
    object: 'model', created: 1, owned_by: 'xfuel', name: 'auto',
    default_prediction: 'completions', input_vars: null, cost: null,
  }]);
  assert.equal(r.ok, true);
  assert.ok(r.model.modality === 'chat');
  assert.ok(r.model.hub === 'theta' || r.model.hub === 'akash');
});

test('resolveCatalogModel accepts bare alias', () => {
  const r = resolveCatalogModel('qwen3', [...CATALOG_SEED]);
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'theta/qwen3');
});

test('resolveCatalogModel accepts akash hub id', () => {
  const r = resolveCatalogModel('akash/zai-org/GLM-5.3', [...CATALOG_SEED]);
  assert.equal(r.ok, true);
  assert.equal(r.model.hub, 'akash');
  assert.equal(r.model.alias, 'zai-org/GLM-5.3');
});

test('getHubCatalog offline seed includes xfuel/auto + modalities + akash', async () => {
  const { models, source } = await getHubCatalog({ forceRefresh: true });
  assert.equal(source, 'seed-offline');
  assert.ok(models.some((m) => m.id === 'xfuel/auto'));
  assert.ok(models.some((m) => m.modality === 'image'));
  assert.ok(models.some((m) => m.modality === 'audio'));
  assert.ok(models.some((m) => m.hub === 'akash'));
  const list = toOpenAIList(models, { modality: 'chat' });
  assert.ok(list.data.every((m) => m.modality === 'chat' || m.id === 'xfuel/auto'));
});

test('getHubCatalog merges Theta + AkashML via fetchFn', async () => {
  process.env.HUB_CATALOG_OFFLINE = 'false';
  resetHubCatalogCache();
  const fetchFn = async (url) => {
    if (String(url).includes('/service/list')) {
      return {
        ok: true,
        async json() {
          return {
            body: {
              services: [
                {
                  alias: 'glm_5_2',
                  name: 'GLM 5.2',
                  state: 'public',
                  default_prediction: 'completions',
                  predictions: { completions: { input_vars: { messages: {} } } },
                },
              ],
            },
          };
        },
      };
    }
    if (String(url).includes('/models')) {
      return {
        ok: true,
        async json() {
          return {
            object: 'list',
            data: [
              { id: 'zai-org/GLM-5.3', name: 'GLM-5.3', created: 1, owned_by: 'akashml' },
            ],
          };
        },
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const { models, source } = await getHubCatalog({ forceRefresh: true, fetchFn });
  assert.match(source, /theta-live/);
  assert.match(source, /akash-live/);
  assert.ok(models.some((m) => m.id === 'theta/glm_5_2'));
  assert.ok(models.some((m) => m.id === 'akash/zai-org/GLM-5.3'));
});

// -- Live capacity ------------------------------------------------------------
// Theta lists every public service whether or not anything is running it, so
// `state: "public"` says nothing about whether a call will work. Measured
// 2026-08-15: glm_5_2 at workers {"default":1} served a completion, qwen3 at
// workers {} returned 409, and 5 of 8 listed services had no workers at all.
// The signal was in the poll we already make and was being discarded.

const { hasCapacity } = await import('../src/hub-catalog.js');

const svc = (alias, workers) => ({
  alias,
  state: 'public',
  default_prediction: 'completions',
  predictions: { completions: { input_vars: { messages: { type: 'chat_array' } } } },
  ...(workers === undefined ? {} : { workers }),
});

test('mapThetaService reads live worker count as capacity', () => {
  assert.equal(mapThetaService(svc('glm_5_2', { default: 1 })).capacity, 1);
  assert.equal(mapThetaService(svc('sdxl', { default: 39 })).capacity, 39);
  // The case that 409s.
  assert.equal(mapThetaService(svc('qwen3', {})).capacity, 0);
  // Absent is unknown, not zero ù AkashML publishes no equivalent, and reading
  // silence as "down" would take a working hub offline.
  assert.equal(mapThetaService(svc('qwen3', undefined)).capacity, null);
});

test('hasCapacity: only a hub that reports none counts as down', () => {
  assert.equal(hasCapacity({ capacity: 1 }), true);
  assert.equal(hasCapacity({ capacity: 0 }), false);
  assert.equal(hasCapacity({ capacity: null }), true);
  assert.equal(hasCapacity({}), true);
});

test('xfuel/auto never routes to a model the hub says is empty', () => {
  // theta/qwen3 sits third in the non-agent preference order, so this is not
  // hypothetical: an Akash outage ù the one time failover matters ù used to pick
  // a model that answers every request with a 409.
  const models = [
    { id: 'theta/qwen3', hub: 'theta', modality: 'chat', capacity: 0 },
    { id: 'akash/zai-org/GLM-5.3', hub: 'akash', modality: 'chat', capacity: null },
  ];
  const res = resolveCatalogModel('xfuel/auto', models);
  assert.equal(res.ok, true);
  assert.equal(res.model.id, 'akash/zai-org/GLM-5.3');
});

test('an explicit request for an empty model still resolves', () => {
  // Only the automatic choice is filtered. A caller who names a model may be
  // willing to wait for it to warm, and silently serving something else would
  // break a contract they stated explicitly.
  const models = [{ id: 'theta/qwen3', hub: 'theta', alias: 'qwen3', modality: 'chat', capacity: 0 }];
  const res = resolveCatalogModel('theta/qwen3', models);
  assert.equal(res.ok, true);
  assert.equal(res.model.id, 'theta/qwen3');
});

test('/v1/models publishes availability so an agent can avoid a dead model', () => {
  const list = toOpenAIList([
    { id: 'theta/qwen3', hub: 'theta', modality: 'chat', capacity: 0 },
    { id: 'theta/glm_5_2', hub: 'theta', modality: 'chat', capacity: 1 },
    { id: 'akash/x', hub: 'akash', modality: 'chat', capacity: null },
  ]);
  const at = (id) => list.data.find((m) => m.id === id).availability;

  assert.equal(at('theta/qwen3').status, 'no_capacity');
  assert.equal(at('theta/glm_5_2').status, 'available');
  assert.equal(at('theta/glm_5_2').workers, 1);
  // Not "down" ù Akash simply does not report capacity.
  assert.equal(at('akash/x').status, 'unknown');
});
