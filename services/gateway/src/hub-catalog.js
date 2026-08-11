/**
 * Live multi-hub model catalog (control-plane inventory).
 *
 * Polls provider discovery endpoints (Theta EdgeCloud GET /service/list +
 * AkashML GET /v1/models), caches briefly, and exposes OpenAI-shaped model
 * rows with hub-prefixed ids (e.g. theta/qwen3, akash/zai-org/GLM-5.2).
 *
 * See docs/STRATEGY.md · canvases multimodal catalog PMF.
 *
 * Env:
 *   HUB_CATALOG_TTL_MS=60000
 *   THETA_EDGECLOUD_BASE=https://ondemand.thetaedgecloud.com
 *   AKASHML_BASE_URL=https://api.akashml.com/v1
 *   AKASHML_API_KEY=…          — optional; /v1/models may work without it
 *   HUB_CATALOG_OFFLINE=true   — force seed (tests)
 */

import logger from './logger.js';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_THETA_BASE = 'https://ondemand.thetaedgecloud.com';
const DEFAULT_AKASHML_BASE = 'https://api.akashml.com/v1';

/** @typedef {'chat'|'image'|'audio'|'vision'|'image_ops'|'other'} Modality */

/**
 * @typedef {object} CatalogModel
 * @property {string} id              Hub-prefixed id (theta/qwen3, akash/zai-org/GLM-5.2)
 * @property {string} object
 * @property {number} created
 * @property {string} owned_by
 * @property {string} hub
 * @property {string} alias           Native hub slug / model id
 * @property {string} name
 * @property {Modality} modality
 * @property {string} default_prediction
 * @property {object|null} input_vars
 * @property {object|null} cost
 * @property {string} [workload_type]
 */

/** Offline / fetch-failure seed — honest Theta + AkashML chat aliases only. */
export const CATALOG_SEED = Object.freeze([
  seedRow('theta', 'qwen3', 'Qwen3', 'chat', 'completions'),
  seedRow('theta', 'glm_5_2', 'GLM 5.2', 'chat', 'completions'),
  seedRow('akash', 'zai-org/GLM-5.2', 'GLM 5.2 (AkashML)', 'chat', 'completions'),
  seedRow('theta', 'whisper', 'Whisper', 'audio', 'stt'),
  seedRow('theta', 'stable_diffusion_xl_turbo', 'Stable Diffusion XL Turbo', 'image', 'predict'),
  seedRow('theta', 'llava', 'LLaVA', 'vision', 'predict'),
  seedRow('theta', 'blip', 'Blip', 'vision', 'predict'),
  seedRow('theta', 'esrgan', 'ESRGAN', 'image_ops', 'predict'),
  seedRow('theta', 'image_to_image', 'Image to Image', 'image_ops', 'stylize'),
]);

function seedRow(hub, alias, name, modality, defaultPrediction) {
  return Object.freeze({
    id: `${hub}/${alias}`,
    object: 'model',
    created: 1_700_000_000,
    owned_by: hub === 'theta' ? 'theta-edgecloud' : hub === 'akash' ? 'akash-network' : hub,
    hub,
    alias,
    name,
    modality,
    default_prediction: defaultPrediction,
    input_vars: null,
    cost: null,
    workload_type: null,
  });
}

const AUTO_MODEL = Object.freeze({
  id: 'xfuel/auto',
  object: 'model',
  created: 1_700_000_000,
  owned_by: 'xfuel',
  hub: 'xfuel',
  alias: 'auto',
  name: 'XFuel Auto (policy → best live chat hub model)',
  modality: 'chat',
  default_prediction: 'completions',
  input_vars: null,
  cost: null,
  workload_type: null,
});

/** @type {{ at: number, models: CatalogModel[], source: string } | null} */
let _cache = null;

export function resetHubCatalogCache() {
  _cache = null;
}

/**
 * Infer modality from Theta service prediction metadata.
 * @param {object} svc
 * @returns {{ modality: Modality, default_prediction: string, input_vars: object|null, cost: object|null }}
 */
export function classifyThetaService(svc) {
  const predName = svc.default_prediction || Object.keys(svc.predictions || {})[0] || 'predict';
  const pred = svc.predictions?.[predName] || {};
  const vars = pred.input_vars || {};
  const cost = pred.cost || null;

  let modality = /** @type {Modality} */ ('other');
  if (predName === 'completions' || vars.messages) modality = 'chat';
  else if (predName === 'stt' || vars.audio_filename) modality = 'audio';
  else if (vars.prompt && !vars.input_img && !vars.image_filename) modality = 'image';
  else if (vars.question || (vars.input_img && vars.question)) modality = 'vision';
  else if (vars.input_img || vars.image_filename || predName === 'stylize' || predName === 'upscale') {
    modality = vars.prompt ? 'image' : (predName === 'predict' && vars.input_img && !vars.question ? 'vision' : 'image_ops');
  } else if (vars.prompt) modality = 'image';

  // Blip is caption (vision); ESRGAN / image_to_image are ops
  const alias = String(svc.alias || '').toLowerCase();
  if (alias === 'blip' || alias === 'llava') modality = 'vision';
  if (alias === 'esrgan' || alias === 'image_to_image') modality = 'image_ops';
  if (alias === 'whisper') modality = 'audio';
  if (alias === 'stable_diffusion_xl_turbo' || alias.startsWith('flux')) modality = 'image';
  if (alias === 'qwen3' || alias === 'glm_5_2' || alias.includes('llama')) modality = 'chat';

  return { modality, default_prediction: predName, input_vars: vars, cost };
}

/**
 * Map a Theta /service/list row → CatalogModel.
 * @param {object} svc
 * @returns {CatalogModel|null}
 */
export function mapThetaService(svc) {
  if (!svc || svc.state === 'private') return null;
  const alias = String(svc.alias || '').trim();
  if (!alias) return null;
  const { modality, default_prediction, input_vars, cost } = classifyThetaService(svc);
  const created = svc.create_time ? Math.floor(new Date(svc.create_time).getTime() / 1000) : 1_700_000_000;
  return {
    id: `theta/${alias}`,
    object: 'model',
    created: Number.isFinite(created) ? created : 1_700_000_000,
    owned_by: 'theta-edgecloud',
    hub: 'theta',
    alias,
    name: svc.name || alias,
    modality,
    default_prediction,
    input_vars,
    cost,
    workload_type: svc.workload_type || null,
  };
}

/**
 * Infer modality from an AkashML /v1/models row (chat-first OpenAI shape).
 * @param {object} model
 * @returns {Modality}
 */
export function classifyAkashModel(model) {
  const inputs = model?.input_modalities || model?.input_modality || [];
  const arr = Array.isArray(inputs) ? inputs.map((x) => String(x).toLowerCase()) : [];
  if (arr.includes('image') && !arr.includes('text')) return 'image';
  if (arr.includes('audio')) return 'audio';
  // AkashML is chat completions today; default chat.
  return 'chat';
}

/**
 * Map an AkashML /v1/models row → CatalogModel.
 * Ids are `akash/<nativeId>` (nativeId may contain slashes, e.g. zai-org/GLM-5.2).
 * @param {object} model
 * @returns {CatalogModel|null}
 */
export function mapAkashService(model) {
  if (!model) return null;
  const alias = String(model.id || '').trim();
  if (!alias) return null;
  const modality = classifyAkashModel(model);
  const created = Number.isFinite(model.created) ? model.created : 1_700_000_000;
  const pricing = model.pricing || null;
  return {
    id: `akash/${alias}`,
    object: 'model',
    created,
    owned_by: model.owned_by || 'akash-network',
    hub: 'akash',
    alias,
    name: model.name || alias,
    modality,
    default_prediction: 'completions',
    input_vars: null,
    cost: pricing,
    workload_type: null,
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 * @param {string} [opts.thetaBase]
 * @param {string} [opts.akashBase]
 * @param {string} [opts.akashApiKey]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {boolean} [opts.forceRefresh]
 */
export async function getHubCatalog(opts = {}) {
  const ttlMs = opts.ttlMs ?? (parseInt(process.env.HUB_CATALOG_TTL_MS, 10) || DEFAULT_TTL_MS);
  const now = Date.now();
  if (!opts.forceRefresh && _cache && now - _cache.at < ttlMs) {
    return { models: _cache.models, source: _cache.source, cached: true };
  }

  if (process.env.HUB_CATALOG_OFFLINE === 'true') {
    const models = withAuto([...CATALOG_SEED]);
    _cache = { at: now, models, source: 'seed-offline' };
    return { models, source: 'seed-offline', cached: false };
  }

  const thetaBase = (opts.thetaBase || process.env.THETA_EDGECLOUD_BASE || DEFAULT_THETA_BASE).replace(/\/$/, '');
  const akashBase = (opts.akashBase || process.env.AKASHML_BASE_URL || DEFAULT_AKASHML_BASE).replace(/\/$/, '');
  const akashKey = opts.akashApiKey ?? process.env.AKASHML_API_KEY ?? '';
  const fetchFn = opts.fetchFn || globalThis.fetch;

  const [thetaResult, akashResult] = await Promise.all([
    fetchThetaModels(thetaBase, fetchFn),
    fetchAkashModels(akashBase, akashKey, fetchFn),
  ]);

  const merged = [];
  const sources = [];
  if (thetaResult.models.length) {
    merged.push(...thetaResult.models);
    sources.push(thetaResult.source);
  }
  if (akashResult.models.length) {
    merged.push(...akashResult.models);
    sources.push(akashResult.source);
  }

  if (!merged.length) {
    logger.warn(
      { theta: thetaResult.error, akash: akashResult.error },
      'hub-catalog: all hub polls failed — using seed',
    );
    if (_cache) return { models: _cache.models, source: `${_cache.source}+stale`, cached: true };
    const models = withAuto([...CATALOG_SEED]);
    _cache = { at: now, models, source: 'seed-fallback' };
    return { models, source: 'seed-fallback', cached: false };
  }

  const models = withAuto(merged);
  const source = sources.join('+');
  _cache = { at: now, models, source };
  logger.info(
    { count: merged.length, theta: thetaResult.models.length, akash: akashResult.models.length, source },
    'hub-catalog: refreshed multi-hub',
  );
  return { models, source, cached: false };
}

async function fetchThetaModels(thetaBase, fetchFn) {
  try {
    const res = await fetchFn(`${thetaBase}/service/list`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`theta service/list HTTP ${res.status}`);
    const data = await res.json();
    const services = data?.body?.services || data?.services || [];
    const mapped = services.map(mapThetaService).filter(Boolean);
    if (!mapped.length) throw new Error('theta service/list empty');
    return { models: mapped, source: 'theta-live', error: null };
  } catch (err) {
    logger.warn({ err: err.message }, 'hub-catalog: Theta poll failed');
    return { models: [], source: 'theta-none', error: err.message };
  }
}

async function fetchAkashModels(akashBase, apiKey, fetchFn) {
  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchFn(`${akashBase}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`akashml /models HTTP ${res.status}`);
    const data = await res.json();
    const rows = data?.data || data?.models || (Array.isArray(data) ? data : []);
    const mapped = rows.map(mapAkashService).filter(Boolean);
    if (!mapped.length) throw new Error('akashml /models empty');
    return { models: mapped, source: 'akash-live', error: null };
  } catch (err) {
    logger.warn({ err: err.message }, 'hub-catalog: AkashML poll failed');
    return { models: [], source: 'akash-none', error: err.message };
  }
}

function withAuto(models) {
  const ids = new Set(models.map((m) => m.id));
  const out = [...models];
  if (!ids.has(AUTO_MODEL.id)) out.unshift(AUTO_MODEL);
  return out;
}

/**
 * Resolve a client model id to a catalog row.
 * Accepts hub/alias, bare alias (theta preferred, then any hub), or xfuel/auto.
 *
 * @param {string} modelId
 * @param {CatalogModel[]} models
 * @param {{ modality?: Modality }} [opts]
 * @returns {{ ok: true, model: CatalogModel, requested: string } | { ok: false, reason: string, requested: string }}
 */
export function resolveCatalogModel(modelId, models, opts = {}) {
  const requested = String(modelId || '').trim() || 'xfuel/auto';
  const modality = opts.modality || null;

  if (requested === 'xfuel/auto' || requested === 'auto' || requested === 'xfuel-auto') {
    const chat = models.find((m) => m.hub !== 'xfuel' && m.modality === 'chat');
    // Prefer GLM on either hub, then Qwen, then first live chat model.
    const preferred =
      models.find((m) => m.id === 'theta/glm_5_2') ||
      models.find((m) => m.id === 'akash/zai-org/GLM-5.2') ||
      models.find((m) => m.id === 'theta/qwen3') ||
      chat;
    if (!preferred) return { ok: false, reason: 'no_chat_models', requested };
    return { ok: true, model: preferred, requested };
  }

  // Reject known-fiction legacy names — do not remap to qwen.
  const legacy = new Set([
    'llama-3-70b', 'llama-3.1-8b', 'llama-3.1-70b', 'llama-3.1-405b',
    'llama_3_1_70b', 'llama_3_1_8b', 'default-llm',
  ]);
  if (legacy.has(requested)) {
    return {
      ok: false,
      reason: 'model_retired',
      requested,
      hint: 'Use a live hub id from GET /v1/models (e.g. theta/qwen3, theta/glm_5_2, akash/zai-org/GLM-5.2).',
    };
  }

  let hit = models.find((m) => m.id === requested);
  if (!hit && !requested.includes('/')) {
    hit = models.find((m) => m.alias === requested && m.hub === 'theta')
      || models.find((m) => m.alias === requested);
  }
  // Bare Akash native id (contains slash) without hub prefix
  if (!hit && requested.includes('/') && !requested.startsWith('theta/') && !requested.startsWith('akash/') && !requested.startsWith('xfuel/')) {
    hit = models.find((m) => m.hub === 'akash' && m.alias === requested)
      || models.find((m) => m.id === `akash/${requested}`);
  }
  if (!hit) return { ok: false, reason: 'model_not_found', requested };

  if (modality && hit.modality !== modality && hit.hub !== 'xfuel') {
    // Allow vision models on chat only if explicitly chat-shaped
    if (!(modality === 'chat' && hit.modality === 'chat')) {
      return {
        ok: false,
        reason: 'modality_mismatch',
        requested,
        hint: `Model ${hit.id} is modality=${hit.modality}, expected ${modality}`,
      };
    }
  }
  return { ok: true, model: hit, requested };
}

/** OpenAI list shape (+ XFuel extensions on each row). */
export function toOpenAIList(models, { modality = null } = {}) {
  let rows = models;
  if (modality) rows = rows.filter((m) => m.modality === modality || m.id === 'xfuel/auto');
  return {
    object: 'list',
    data: rows.map((m) => ({
      id: m.id,
      object: m.object,
      created: m.created,
      owned_by: m.owned_by,
      // XFuel extensions (ignored by OpenAI SDKs)
      hub: m.hub,
      alias: m.alias,
      name: m.name,
      modality: m.modality,
      default_prediction: m.default_prediction,
    })),
  };
}
