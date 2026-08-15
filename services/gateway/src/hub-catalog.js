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
import { isDown, healthOf } from './provider-health.js';
import { akashmlApiKey } from './akashml-infer.js';

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
  // Theta's price is `cost` over `cost_divisor`, in the unit named by
  // `instructions` — tokens for LLMs, images for the diffusion models. All three
  // are needed to read it; provider-rates.js does the interpreting.
  const cost = pred.cost
    ? { ...pred.cost, cost_divisor: pred.cost_divisor ?? 1, price_unit: parseThetaUnits(pred.instructions) }
    : null;

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
 * Theta describes its own price units in an `instructions` JSON string:
 * `{"isPriceSplit":true,"inputUnit":"1M input tokens","outputUnit":"1M output tokens"}`
 * for LLMs, `{"unit":"image","isPriceSplit":false}` for the diffusion models. On
 * some services it also carries unrelated sample-image URLs, so parse
 * defensively and treat anything unreadable as unknown.
 * @returns {{isPriceSplit:boolean, unit:string|null}}
 */
function parseThetaUnits(instructions) {
  if (!instructions || typeof instructions !== 'string') return { isPriceSplit: false, unit: null };
  try {
    const parsed = JSON.parse(instructions);
    return {
      isPriceSplit: !!parsed.isPriceSplit,
      unit: parsed.inputUnit || parsed.unit || parsed.outputUnit || null,
    };
  } catch {
    return { isPriceSplit: false, unit: null };
  }
}

/**
 * Live GPU capacity behind a Theta service, as a worker count.
 *
 * `state: "public"` says a service is listed, not that anything is running it —
 * every Theta service reads `public`, including ones that answer every request
 * with a 409. `workers` is the field that actually distinguishes them: measured
 * 2026-08-15, `glm_5_2` at `{"default":1}` served, `qwen3` at `{}` did not, and
 * 5 of the 8 listed services had none.
 *
 * A missing field is unknown, not zero — AkashML publishes no equivalent, and
 * treating silence as "down" would hide a working hub.
 *
 * @returns {number|null} total workers, or null when the hub does not say
 */
function thetaCapacity(svc) {
  const workers = svc?.workers;
  if (!workers || typeof workers !== 'object') return null;
  return Object.values(workers).reduce((n, v) => n + (Number(v) || 0), 0);
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
    capacity: thetaCapacity(svc),
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
  const akashKey = opts.akashApiKey ?? akashmlApiKey();
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
 * Does this request look like agent work? Tools offered, or a tool result being
 * fed back. Both mean the caller is running a loop, which is the workload where
 * models diverge sharply — see `autoPreferenceFor`.
 * @param {{ tools?: unknown, messages?: Array<{role?: string, tool_calls?: unknown}> }} req
 * @returns {'agent'|'simple'}
 */
export function requestShape(req = {}) {
  if (Array.isArray(req.tools) && req.tools.length) return 'agent';
  const messages = Array.isArray(req.messages) ? req.messages : [];
  const looping = messages.some((m) => m?.role === 'tool' || (Array.isArray(m?.tool_calls) && m.tool_calls.length));
  return looping ? 'agent' : 'simple';
}

/**
 * What `xfuel/auto` should resolve to, per request shape. Evidence-led — see
 * docs/MODEL_QUALITY_EVAL.md.
 *
 * There is no single right default, because the two workloads want opposite
 * things and picking one model punishes the other:
 *
 *   - **Agent loops.** Over 18 runs of a dependent-tool-call loop, GLM-5.2
 *     completed 6/6, GPT-OSS-120B 3/6, and Llama 3.3 70B **0/6** — Llama makes
 *     three correct tool calls, then abandons the loop and emits Python
 *     describing what it would have done. A default that cannot finish an agent
 *     loop is a correctness bug, not a price/quality trade, and agent teams are
 *     the beachhead.
 *
 *   - **Short completions.** GLM is a reasoning model: it spends ~110 output
 *     tokens to answer "PONG" and returns nothing at all below `max_tokens=256`.
 *     Making it the blanket default breaks every caller sending a small budget
 *     and bills ~37x the output tokens for a one-word answer. Llama answers the
 *     same prompt in 3 tokens at `max_tokens=16`, and swept the single-turn
 *     primitives 27/27.
 *
 * So route on the shape of the request rather than paying one of those costs on
 * every call. `XFUEL_AUTO_MODEL` overrides both without a code change.
 *
 * @param {'agent'|'simple'} [shape]
 * @returns {string[]} catalog ids, best first
 */
export function autoPreferenceFor(shape) {
  return shape === 'agent'
    ? [
        'akash/zai-org/GLM-5.2',
        'akash/openai/gpt-oss-120b',
        'theta/qwen3',
        'akash/meta-llama/Llama-3.3-70B-Instruct',
      ]
    : [
        'akash/meta-llama/Llama-3.3-70B-Instruct',
        'akash/openai/gpt-oss-120b',
        'theta/qwen3',
        'akash/zai-org/GLM-5.2',
      ];
}

/**
 * Can this model serve right now, as far as the hub will say?
 *
 * Unknown counts as yes. Only a hub that publishes capacity *and* reports none
 * is treated as down, so a hub that says nothing keeps working exactly as before.
 *
 * @param {CatalogModel} m
 */
export function hasCapacity(m) {
  return !(typeof m?.capacity === 'number' && m.capacity <= 0);
}

/**
 * Should `xfuel/auto` consider this model?
 *
 * Two independent sources, because the two hubs tell us different things. Theta
 * publishes worker counts, so we know before calling. AkashML publishes nothing,
 * so the only evidence is how recent calls went — see provider-health.js.
 *
 * @param {CatalogModel} m
 */
export function isRoutable(m) {
  return hasCapacity(m) && !isDown(m?.id);
}

/**
 * Resolve a client model id to a catalog row.
 * Accepts hub/alias, bare alias (theta preferred, then any hub), or xfuel/auto.
 *
 * A failed hub poll drops that hub's models from `models` entirely, so the
 * preference lists degrade to the other hub on an outage with no explicit
 * failover logic.
 *
 * @param {string} modelId
 * @param {CatalogModel[]} models
 * @param {{ modality?: Modality, shape?: 'agent'|'simple' }} [opts]
 *   `shape` steers `xfuel/auto` only — 'agent' when the request carries tools or a
 *   tool-result turn. See `autoPreferenceFor`.
 * @returns {{ ok: true, model: CatalogModel, requested: string } | { ok: false, reason: string, requested: string }}
 */
export function resolveCatalogModel(modelId, models, opts = {}) {
  const requested = String(modelId || '').trim() || 'xfuel/auto';
  const modality = opts.modality || null;

  if (requested === 'xfuel/auto' || requested === 'auto' || requested === 'xfuel-auto') {
    // Never auto-route to a model the hub says has no workers. `theta/qwen3` sits
    // third in the non-agent order and has had zero capacity — so an Akash outage,
    // the one time failover matters, would have picked a model that answers every
    // request with a 409. An explicit request for it still resolves; only the
    // automatic choice is filtered, because the caller did not name this model and
    // has no way to know it is dead.
    // If health has ruled out everything, route as though we knew nothing. A
    // provider-wide outage would otherwise turn every request into
    // `no_chat_models` — refusing to try is strictly worse than trying and
    // failing, and it would also prevent the success that clears the state.
    const routable = models.filter(isRoutable);
    const live = routable.length ? routable : models;
    const chat = live.find((m) => m.hub !== 'xfuel' && m.modality === 'chat');
    const order = autoPreferenceFor(opts.shape);
    const pick = (id) => live.find((m) => m.id === id);

    const override = (process.env.XFUEL_AUTO_MODEL || '').trim();
    const preferred =
      // An explicit override is an instruction, not a preference: honour it even
      // if capacity is unknown or zero, and let it fail loudly if it is wrong.
      (override ? models.find((m) => m.id === override || m.alias === override) : null) ||
      order.map(pick).find(Boolean) ||
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

/**
 * OpenAI list shape (+ XFuel extensions on each row).
 *
 * `priceFor` is injected rather than imported so this module stays free of the
 * pricing layer — provider-rates.js already reads the catalogue, and importing
 * it back here would close the cycle.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.modality]
 * @param {(m: object) => object|null} [opts.priceFor] per-row buyer-facing price
 */
export function toOpenAIList(models, { modality = null, priceFor = null } = {}) {
  let rows = models;
  if (modality) rows = rows.filter((m) => m.modality === modality || m.id === 'xfuel/auto');
  return {
    object: 'list',
    data: rows.map((m) => {
      const pricing = typeof priceFor === 'function' ? priceFor(m) : null;
      return {
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
        ...(pricing ? { pricing } : {}),
        availability: availabilityOf(m),
      };
    }),
  };
}

/**
 * What a caller needs to know before picking this model.
 *
 * Published because a catalogue that lists a model it cannot serve is worse than
 * one that omits it — an agent picks it, waits, and gets a 409. Listing it with
 * `status: "no_capacity"` keeps it discoverable (capacity comes back) while
 * saying plainly that a call right now will fail.
 */
function availabilityOf(m) {
  // Observed and probed health, when we have any. Reported alongside capacity
  // rather than merged into it: they answer different questions — "does the hub
  // say a GPU is attached" and "did calling it work" — and a model can fail both
  // ways independently.
  const health = healthOf(m?.id);

  if (typeof m?.capacity !== 'number') {
    return {
      status: health?.status === 'down' ? 'down' : (health?.status || 'unknown'),
      note: health
        ? 'This hub does not publish capacity; status is from observed calls and probes.'
        : 'This hub does not publish live capacity, and nothing has called this model yet.',
      ...(health ? { health } : {}),
    };
  }
  if (m.capacity <= 0) {
    return {
      status: 'no_capacity',
      workers: 0,
      note: 'The hub reports no workers for this model — a request now will likely fail. '
        + 'Not auto-routed to; an explicit request is still attempted.',
      ...(health ? { health } : {}),
    };
  }
  return {
    // The hub says a worker is attached, but calls have been failing. Trust the
    // calls: capacity is a claim, a failed request is an outcome.
    status: health?.status === 'down' ? 'down' : 'available',
    workers: m.capacity,
    ...(health ? { health } : {}),
  };
}
