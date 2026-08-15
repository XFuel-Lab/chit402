/**
 * Which models are actually serving, right now.
 *
 * Theta publishes live worker counts and hub-catalog.js reads them, which is
 * free and exact. AkashML publishes nothing — no capacity, health or status
 * field, and no usage endpoint (checked 2026-08-15) — and AkashML serves all our
 * live inference. So on the hub that matters, the only way to know a model is up
 * is that something called it.
 *
 * Two sources, deliberately split by what they cost:
 *
 *   observed  Real traffic. A request that succeeded or failed is the strongest
 *             possible evidence and costs nothing extra, so this is always on.
 *             Its weakness is that it only learns about models people use, and
 *             only at the moment someone is already being failed.
 *
 *   probe     A synthetic 1-token call on a timer. Costs real money and makes
 *             requests nobody asked for, so it is opt-in
 *             (`PROVIDER_HEALTH_PROBE=true`). It buys the two things observation
 *             cannot: it notices an outage before a customer does, and it
 *             notices recovery on a model no one is currently calling — without
 *             it a model marked down stays down until someone volunteers to be
 *             the request that discovers otherwise.
 *
 * Deliberately not a full uptime index. This answers "should I route here now",
 * not "what is this model's 30-day availability" — the latter needs durable
 * storage, and everything here is in-memory and dies with the process. That is
 * the right trade for routing: stale health is worse than no health, and a fresh
 * process re-learns within one probe interval.
 */

import logger from './logger.js';

/** Consecutive failures before a model is treated as down. */
const DEFAULT_FAIL_THRESHOLD = 3;
/** How often the opt-in prober sweeps. */
const DEFAULT_PROBE_INTERVAL_MS = 300_000;
/** A probe that has not answered in this long is a failure, not a slow success. */
const PROBE_TIMEOUT_MS = 20_000;
/**
 * Health older than this is not evidence. Without expiry a model that failed
 * three times an hour ago and was never called again stays down forever, which
 * turns a transient blip into a permanent delisting.
 */
const DEFAULT_STALE_MS = 1_800_000;

/** @type {Map<string, object>} modelId → health record */
const _health = new Map();
let _timer = null;

const nowMs = () => Date.now();

const intEnv = (name, dflt) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const failThreshold = () => intEnv('PROVIDER_HEALTH_FAIL_THRESHOLD', DEFAULT_FAIL_THRESHOLD);
const staleMs = () => intEnv('PROVIDER_HEALTH_STALE_MS', DEFAULT_STALE_MS);

/** Is the active prober switched on? Off by default — it spends money. */
export function probingEnabled() {
  return String(process.env.PROVIDER_HEALTH_PROBE || '').toLowerCase() === 'true';
}

function record(modelId) {
  let h = _health.get(modelId);
  if (!h) {
    h = {
      consecutiveFailures: 0,
      lastOkAt: null,
      lastFailAt: null,
      lastError: null,
      latencyMs: null,
      checkedAt: null,
      source: null,
    };
    _health.set(modelId, h);
  }
  return h;
}

/**
 * A call to this model worked.
 *
 * Recovery is immediate rather than requiring a run of successes: the cost of
 * trusting one success is a single failed request if we are wrong, while the
 * cost of distrusting it is continuing to route around a model that came back.
 *
 * @param {string} modelId
 * @param {{latencyMs?:number, source?:'observed'|'probe'}} [meta]
 */
export function recordSuccess(modelId, { latencyMs = null, source = 'observed' } = {}) {
  if (!modelId) return;
  const h = record(modelId);
  const wasDown = h.consecutiveFailures >= failThreshold();
  h.consecutiveFailures = 0;
  h.lastOkAt = nowMs();
  h.checkedAt = h.lastOkAt;
  h.lastError = null;
  h.latencyMs = latencyMs;
  h.source = source;
  if (wasDown) logger.info({ model: modelId, source }, 'provider-health: recovered');
}

/**
 * A call to this model failed.
 *
 * Only counts provider-side failures. A 400 from a malformed request says
 * nothing about the model's health, and counting it would let one buyer's bad
 * payload delist a model for everyone.
 *
 * @param {string} modelId
 * @param {{reason?:string, source?:'observed'|'probe'}} [meta]
 */
export function recordFailure(modelId, { reason = null, source = 'observed' } = {}) {
  if (!modelId) return;
  const h = record(modelId);
  h.consecutiveFailures += 1;
  h.lastFailAt = nowMs();
  h.checkedAt = h.lastFailAt;
  h.lastError = reason;
  h.source = source;
  if (h.consecutiveFailures === failThreshold()) {
    logger.warn({ model: modelId, reason, failures: h.consecutiveFailures }, 'provider-health: marking down');
  }
}

/**
 * Should routing avoid this model?
 *
 * False for anything we have no current evidence against — an unknown model is
 * routable, and so is one whose failures have aged out. Being wrong in this
 * direction costs one failed request; being wrong in the other silently removes
 * working capacity.
 */
export function isDown(modelId, { now = nowMs() } = {}) {
  const h = _health.get(modelId);
  if (!h || h.consecutiveFailures < failThreshold()) return false;
  if (h.checkedAt !== null && now - h.checkedAt > staleMs()) return false;
  return true;
}

/**
 * Health for one model, or null when nothing is known.
 * @returns {{status:string, consecutive_failures:number, last_ok_at:string|null,
 *   last_error:string|null, latency_ms:number|null, checked_at:string|null,
 *   source:string|null}|null}
 */
export function healthOf(modelId, { now = nowMs() } = {}) {
  const h = _health.get(modelId);
  if (!h || h.checkedAt === null) return null;

  const iso = (t) => (t ? new Date(t).toISOString() : null);
  const stale = now - h.checkedAt > staleMs();
  const status = isDown(modelId, { now })
    ? 'down'
    : stale
      ? 'stale'
      : h.consecutiveFailures > 0
        ? 'degraded'
        : 'available';

  return {
    status,
    consecutive_failures: h.consecutiveFailures,
    last_ok_at: iso(h.lastOkAt),
    last_error: h.lastError,
    latency_ms: h.latencyMs,
    checked_at: iso(h.checkedAt),
    source: h.source,
  };
}

/** Everything we know, for /health. */
export function healthSnapshot({ now = nowMs() } = {}) {
  const models = {};
  for (const id of _health.keys()) {
    const h = healthOf(id, { now });
    if (h) models[id] = h;
  }
  const values = Object.values(models);
  return {
    probing: probingEnabled(),
    fail_threshold: failThreshold(),
    tracked: values.length,
    down: values.filter((m) => m.status === 'down').length,
    models,
  };
}

/** Drop all state. Tests, and nothing else. */
export function resetHealth() {
  _health.clear();
  stopHealthProbes();
}

/**
 * One synthetic liveness call.
 *
 * `max_tokens: 1` because this asks "did the provider accept and answer", not
 * "was the answer any good" — a reasoning model that burns its budget on hidden
 * thought and returns empty text is still up. Cheap enough to ignore: ~$0.00002
 * a probe, so eight models every five minutes is a few cents a month.
 */
async function probeOnce(model, { baseUrl, apiKey, fetchFn = globalThis.fetch }) {
  const t0 = nowMs();
  try {
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = nowMs() - t0;
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, latencyMs };
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : err.message, latencyMs: nowMs() - t0 };
  }
}

/**
 * Probe every named model once, sequentially.
 *
 * Sequential on purpose: this is a background sweep with no deadline, and firing
 * eight concurrent requests at a provider to ask whether it is healthy is a good
 * way to make it less so.
 *
 * @param {string[]} models hub-prefixed ids (`akash/...`)
 */
export async function probeModels(models, { baseUrl, apiKey, fetchFn } = {}) {
  if (!apiKey) return { probed: 0, skipped: 'no_api_key' };
  let probed = 0;
  for (const id of models) {
    const native = id.startsWith('akash/') ? id.slice('akash/'.length) : id;
    const res = await probeOnce(native, { baseUrl, apiKey, fetchFn });
    if (res.ok) recordSuccess(id, { latencyMs: res.latencyMs, source: 'probe' });
    else recordFailure(id, { reason: res.reason, source: 'probe' });
    probed += 1;
  }
  return { probed };
}

/**
 * Start the background sweep. No-op unless `PROVIDER_HEALTH_PROBE=true`.
 *
 * Only AkashML is probed. Theta publishes worker counts in the catalogue poll we
 * already make, so probing it would be paying for an answer we are given.
 *
 * @param {() => Promise<{models: object[]}>} getCatalog
 */
export function startHealthProbes(getCatalog, { intervalMs = null, fetchFn } = {}) {
  if (!probingEnabled() || _timer) return false;

  const every = intervalMs || intEnv('PROVIDER_HEALTH_INTERVAL_MS', DEFAULT_PROBE_INTERVAL_MS);
  const baseUrl = (process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1').replace(/\/$/, '');

  const sweep = async () => {
    try {
      const { models } = await getCatalog();
      const ids = models.filter((m) => m.hub === 'akash' && m.modality === 'chat').map((m) => m.id);
      const out = await probeModels(ids, { baseUrl, apiKey: process.env.AKASHML_API_KEY, fetchFn });
      logger.info({ ...out, down: healthSnapshot().down }, 'provider-health: sweep');
    } catch (err) {
      logger.warn({ err: err.message }, 'provider-health: sweep failed');
    }
  };

  _timer = setInterval(sweep, every);
  // Never hold the process open for a health check.
  if (typeof _timer.unref === 'function') _timer.unref();
  // Kick one off immediately so a fresh process is not blind for a full interval.
  sweep();
  logger.info({ intervalMs: every }, 'provider-health: probing enabled');
  return true;
}

export function stopHealthProbes() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

export default { recordSuccess, recordFailure, isDown, healthOf, healthSnapshot };
