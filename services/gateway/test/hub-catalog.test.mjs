import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyThetaService,
  mapThetaService,
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
  assert.ok(r.model.id.startsWith('theta/'));
});

test('resolveCatalogModel accepts bare alias', () => {
  const r = resolveCatalogModel('qwen3', [...CATALOG_SEED]);
  assert.equal(r.ok, true);
  assert.equal(r.model.id, 'theta/qwen3');
});

test('getHubCatalog offline seed includes xfuel/auto + modalities', async () => {
  const { models, source } = await getHubCatalog({ forceRefresh: true });
  assert.equal(source, 'seed-offline');
  assert.ok(models.some((m) => m.id === 'xfuel/auto'));
  assert.ok(models.some((m) => m.modality === 'image'));
  assert.ok(models.some((m) => m.modality === 'audio'));
  const list = toOpenAIList(models, { modality: 'chat' });
  assert.ok(list.data.every((m) => m.modality === 'chat' || m.id === 'xfuel/auto'));
});

test('getHubCatalog maps live Theta payload via fetchFn', async () => {
  process.env.HUB_CATALOG_OFFLINE = 'false';
  resetHubCatalogCache();
  const fetchFn = async () => ({
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
  });
  const { models, source } = await getHubCatalog({ forceRefresh: true, fetchFn });
  assert.equal(source, 'theta-live');
  assert.ok(models.some((m) => m.id === 'theta/glm_5_2'));
});
