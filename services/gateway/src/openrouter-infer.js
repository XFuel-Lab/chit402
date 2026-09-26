/**
 * OpenRouter inference (OpenAI-compatible).
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *
 * Primary mode is bring-your-own-key: the caller sends `X-OpenRouter-Key`,
 * or `Authorization: Bearer` on an `openrouter/*` route. That key is forwarded
 * and never stored. House-key resale (`OPENROUTER_API_KEY`) runs only when
 * `OPENROUTER_HOUSE_RESALE_ENABLED=true`.
 *
 * Model ids on the wire are OpenRouter's own (`openai/gpt-4o-mini`);
 * the catalog prefixes them as `openrouter/<vendor>/<model>`.
 */

import crypto from 'crypto';
import logger from './logger.js';
import { hashApiKey } from './buyer-attr.js';
import { capOpenRouterOutputTokens, OPENROUTER_CALLER_PAID_LABEL } from './openrouter-pricing.js';

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_REFERER = 'https://chit402.com';
const DEFAULT_TITLE = 'Chit402';
/** Marketplace category from https://openrouter.ai/docs/app-attribution */
const DEFAULT_CATEGORIES = 'cloud-agent';

/**
 * Attribution OpenRouter asks routers to send on every request.
 * `OPENROUTER_REFERER` / `OPENROUTER_TITLE` override the URL and display name.
 *
 * `X-OpenRouter-Title` is the current name header. `X-Title` stays for
 * back-compat. `X-OpenRouter-App-Visibility` is never sent: omitting it is
 * what lists the app. Sending `hidden` would keep Chit402 off the rankings.
 */
export function openrouterAttributionHeaders() {
  const referer = String(process.env.OPENROUTER_REFERER || '').trim() || DEFAULT_REFERER;
  const title = String(process.env.OPENROUTER_TITLE || '').trim() || DEFAULT_TITLE;
  return {
    'HTTP-Referer': referer,
    'X-OpenRouter-Title': title,
    'X-Title': title,
    'X-OpenRouter-Categories': DEFAULT_CATEGORIES,
  };
}

/**
 * Plain decimal USD string. `String(8.3e-7)` is `"8.3e-7"`, which is not a
 * cost a receipt page or a verifier should have to parse.
 * @param {unknown} value
 * @returns {string|null}
 */
export function formatPlainDecimal(value) {
  if (value == null || value === '') return null;
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? value.toString() : null)
    : (typeof value === 'string' ? value.trim() : null);
  if (text == null || text === '') return null;
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  if (match[1] === '-') return null;
  const intPart = match[2];
  const frac = match[3] || '';
  const exp = match[4] != null ? Number.parseInt(match[4], 10) : 0;
  if (!Number.isFinite(exp)) return null;
  const rawDigits = intPart + frac;
  const leadingZeros = rawDigits.match(/^0*/)[0].length;
  const digits = rawDigits.replace(/^0+/, '') || '0';
  if (digits === '0') return '0';
  const point = intPart.length + exp - leadingZeros;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** OpenRouter publishes generation costs in USD. Keep a plain decimal. */
function usdCostString(value) {
  return formatPlainDecimal(value);
}

/** @returns {string} house key, or '' when unset. Not a license to resell. */
export function openrouterApiKey() {
  return String(process.env.OPENROUTER_API_KEY || '').trim();
}

/**
 * House-key resale. Default off. Only the string `true` enables it.
 * Read live so a process can flip it without a restart in tests.
 */
export function openrouterHouseResaleEnabled() {
  return /^true$/i.test(String(process.env.OPENROUTER_HOUSE_RESALE_ENABLED || '').trim());
}

/**
 * A key the gateway may spend. An omitted argument uses the house key only
 * while resale is on. An explicit empty string never falls through to it.
 * @param {string|undefined} explicit
 */
export function openrouterKeyFor(explicit) {
  if (explicit !== undefined) return String(explicit || '').trim();
  return openrouterHouseResaleEnabled() ? openrouterApiKey() : '';
}

/** @deprecated House key presence is not the advertising switch. */
export function openrouterEnabled() {
  return openrouterHouseResaleEnabled() && openrouterApiKey().length > 0;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const raw = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (raw == null) return '';
  return String(Array.isArray(raw) ? raw[0] : raw).trim();
}

function isGatewayDemoKey(token) {
  if (!token) return false;
  const demo = String(process.env.M2M_DEMO_API_KEY || 'chit402-demo');
  if (token === demo || token === 'xfuel-demo' || token === 'chit402-demo') return true;
  return token.startsWith('xfuel-demo') || token.startsWith('chit402-demo');
}

function bearerToken(req) {
  const auth = headerValue(req?.headers, 'authorization');
  const match = auth.match(/^Bearer\s+(\S+)/i);
  return match ? match[1].trim() : '';
}

/**
 * Who pays OpenRouter for this request.
 *
 * 1. `X-OpenRouter-Key` — the caller's key, on any route.
 * 2. `Authorization: Bearer` on an `openrouter/*` route, unless that bearer
 *    is a Chit credential (demo key, or the key that authorised the request
 *    and no separate `X-API-Key`).
 * 3. House key, only when resale is enabled.
 *
 * @param {object} req
 * @param {string} requestedModel
 * @param {{ authorizationIsChitCredential?: boolean }} [opts]
 * @returns {{ mode: 'byok'|'house'|'missing', apiKey: string }}
 */
export function resolveOpenRouterAccess(req, requestedModel, opts = {}) {
  const dedicated = headerValue(req?.headers, 'x-openrouter-key');
  if (dedicated) return { mode: 'byok', apiKey: dedicated };

  const model = String(requestedModel || '').trim().toLowerCase();
  const bearer = bearerToken(req);
  const separateChitKey = !!headerValue(req?.headers, 'x-api-key');
  if (model.startsWith('openrouter/') && bearer && !isGatewayDemoKey(bearer)) {
    if (separateChitKey || !opts.authorizationIsChitCredential) {
      return { mode: 'byok', apiKey: bearer };
    }
  }

  if (openrouterHouseResaleEnabled()) {
    const house = openrouterApiKey();
    if (house) return { mode: 'house', apiKey: house };
  }
  return { mode: 'missing', apiKey: '' };
}

/**
 * Replace every copy of a secret with `[redacted]`. Short strings are left
 * alone so a status code cannot wipe unrelated text.
 * @param {unknown} text
 * @param {Array<string|null|undefined>} secrets
 */
export function redactSecrets(text, secrets) {
  if (text == null) return text;
  let out = String(text);
  const list = (Array.isArray(secrets) ? secrets : [secrets])
    .filter((s) => typeof s === 'string' && s.length >= 6);
  for (const secret of list) {
    if (!out.includes(secret)) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * Stable end-user id for OpenRouter's `user` field.
 * A second hash, so the provider does not receive a wallet, a raw key, or
 * the buyer digest we store ourselves.
 * @param {{ payerWallet?: string|null, apiKeyHash?: string|null, byokKey?: string|null }} src
 * @returns {string|null}
 */
export function openrouterEndUser({ payerWallet = null, apiKeyHash = null, byokKey = null } = {}) {
  let material = null;
  const wallet = typeof payerWallet === 'string' ? payerWallet.trim().toLowerCase() : '';
  if (/^0x[a-f0-9]{40}$/.test(wallet)) material = `wallet:${wallet}`;
  else if (typeof apiKeyHash === 'string' && apiKeyHash.trim()) material = `keyhash:${apiKeyHash.trim()}`;
  else if (byokKey) {
    const hashed = hashApiKey(byokKey);
    if (hashed) material = `byok:${hashed}`;
  }
  if (!material) return null;
  const digest = crypto.createHash('sha256').update(`chit-or-user:${material}`, 'utf8').digest('hex');
  return `chit:${digest}`;
}

export function openrouterBaseUrl() {
  return String(process.env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/**
 * @param {object} opts
 * @param {string} opts.model OpenRouter native id (`openai/gpt-4o-mini`)
 * @param {Array} opts.messages
 * @param {number} [opts.max_tokens]
 * @param {number} [opts.temperature]
 * @param {Array} [opts.tools]
 * @param {string|object} [opts.tool_choice]
 * @param {string|undefined} [opts.apiKey] omitted uses the house key only when resale is on
 * @param {string|null} [opts.user] stable hashed end-user id
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function inferOpenRouter({
  model,
  messages,
  max_tokens,
  temperature = 0.7,
  tools = null,
  tool_choice = null,
  apiKey,
  user = null,
  baseUrl = openrouterBaseUrl(),
  timeoutMs = 60_000,
  fetchFn = globalThis.fetch,
}) {
  const key = openrouterKeyFor(apiKey);
  if (!key) return { ok: false, reason: 'missing_api_key', model };
  if (!model) return { ok: false, reason: 'missing_model' };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, reason: 'missing_messages', model };
  }

  const capped = capOpenRouterOutputTokens(max_tokens);
  const base = String(baseUrl).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    max_tokens: capped,
  };
  if (typeof user === 'string' && user) body.user = user;
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
  }
  const safe = (text) => redactSecrets(text, [key]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    logger.info({ model, max_tokens: capped }, 'openrouter-infer: POST');
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...openrouterAttributionHeaders(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    const rawText = await res.text();
    if (!res.ok) {
      const redacted = safe(rawText);
      logger.warn(
        { model, status: res.status, elapsed, body: redacted.slice(0, 200) },
        'openrouter-infer: HTTP error',
      );
      return {
        ok: false,
        reason: `http_${res.status}`,
        model,
        detail: redacted.slice(0, 500),
        elapsed_ms: elapsed,
      };
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, reason: 'unparseable', model, detail: safe(rawText).slice(0, 200), elapsed_ms: elapsed };
    }

    const choice = data?.choices?.[0];
    const output = choice?.message?.content ?? choice?.text ?? '';
    const toolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length
      ? choice.message.tool_calls
      : null;
    if (!toolCalls && (typeof output !== 'string' || !output)) {
      return {
        ok: false,
        reason: 'empty_output',
        model,
        usage: data?.usage ?? null,
        detail: safe(rawText).slice(0, 200),
        elapsed_ms: elapsed,
      };
    }

    return {
      ok: true,
      model,
      output: typeof output === 'string' ? output : '',
      toolCalls,
      raw: data,
      usage: data?.usage ?? null,
      reportedCost: usdCostString(data?.usage?.cost),
      generationId: typeof data?.id === 'string' && data.id ? data.id : null,
      finish_reason: choice?.finish_reason ?? null,
      provider: 'openrouter',
      elapsed_ms: elapsed,
      max_tokens: capped,
    };
  } catch (err) {
    const detail = safe(err.message);
    logger.warn({ model, err: detail }, 'openrouter-infer: failed');
    return { ok: false, reason: 'network_error', model, detail };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Confirm the key and the upstream are answering, without starting a billed completion.
 * OpenRouter's `GET /key` returns account metadata. A non-2xx or a network error
 * is a preflight failure: do not settle.
 *
 * Success is cached per key for the catalog TTL so a paid call does not wait
 * on this twice a minute. One caller's success does not skip the next key.
 * Failures are not cached. The cache key is a hash — the raw key is not stored.
 *
 * @param {object} [opts]
 * @param {string|undefined} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {boolean} [opts.force]
 */
const _keyOkAt = new Map();

export function resetOpenRouterPreflightCache() {
  _keyOkAt.clear();
}

function preflightCacheId(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey), 'utf8').digest('hex');
}

export async function preflightOpenRouter({
  apiKey,
  baseUrl = openrouterBaseUrl(),
  fetchFn = globalThis.fetch,
  force = false,
} = {}) {
  const key = openrouterKeyFor(apiKey);
  if (!key) return { ok: false, reason: 'disabled' };
  const cacheId = preflightCacheId(key);
  const ttl = parseInt(process.env.HUB_CATALOG_TTL_MS, 10) || 60_000;
  const seen = _keyOkAt.get(cacheId) || 0;
  if (!force && seen && Date.now() - seen < ttl) {
    return { ok: true, cached: true };
  }
  const base = String(baseUrl).replace(/\/$/, '');
  try {
    const res = await fetchFn(`${base}/key`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        ...openrouterAttributionHeaders(),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    _keyOkAt.set(cacheId, Date.now());
    return { ok: true, cached: false };
  } catch (err) {
    return { ok: false, reason: 'network_error', detail: redactSecrets(err.message, [key]) };
  }
}

/**
 * OpenRouter's billed cost for one completion.
 * `GET /api/v1/generation?id=<id>` → `total_cost` and `upstream_inference_cost` (USD).
 * A miss returns null. Callers must not fail the completion on that.
 *
 * @param {object} opts
 * @param {string} opts.id generation id from the completion (`gen-…`)
 */
export async function fetchOpenRouterGeneration({
  id,
  apiKey,
  baseUrl = openrouterBaseUrl(),
  fetchFn = globalThis.fetch,
} = {}) {
  const key = openrouterKeyFor(apiKey);
  if (!id || !key) return null;
  const base = String(baseUrl).replace(/\/$/, '');
  const url = `${base}/generation?id=${encodeURIComponent(id)}`;
  const res = await fetchFn(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...openrouterAttributionHeaders(),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = typeof res.json === 'function' ? await res.json() : null;
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const total = usdCostString(data?.total_cost);
  const upstream = usdCostString(data?.upstream_inference_cost);
  if (total == null && upstream == null) return null;
  return {
    id: String(id),
    total_cost: total,
    upstream_inference_cost: upstream,
  };
}

/**
 * Attach a generation bill onto the task the receipt is built from.
 * Does not replace `provider_cogs.actual` (the signed token measurement).
 * @returns {boolean}
 */
export function applyOpenRouterGenerationCost(task, generation) {
  if (!task || !generation) return false;
  const total = usdCostString(generation.total_cost);
  const upstream = usdCostString(generation.upstream_inference_cost);
  if (total == null && upstream == null) return false;
  task.meta = task.meta || {};
  const prev = task.meta.providerCogs && typeof task.meta.providerCogs === 'object'
    ? task.meta.providerCogs
    : { provider: 'openrouter', currency: 'USDC' };
  const callerPaid = prev.label === OPENROUTER_CALLER_PAID_LABEL
    || prev.paid_by === 'caller-to-openrouter';
  task.meta.providerCogs = {
    ...prev,
    openrouter_generation: {
      id: generation.id ? String(generation.id) : null,
      total_cost: total,
      upstream_inference_cost: upstream,
      currency: 'USD',
      ...(callerPaid ? {
        label: OPENROUTER_CALLER_PAID_LABEL,
        paid_by: 'caller-to-openrouter',
      } : {}),
    },
  };
  task.updatedAt = Date.now();
  return true;
}

const _reconcileJobs = new Set();

/** Tests wait for in-flight lookups. The request path does not. */
export function openRouterReconcileSettled() {
  return Promise.allSettled([..._reconcileJobs]);
}

/**
 * Look up the generation bill and write it onto the task.
 * Returns the job and does not need to be awaited — a failure is a log line.
 */
export function scheduleOpenRouterCostReconcile({
  id, task, apiKey, baseUrl, fetchFn,
} = {}) {
  const job = (async () => {
    try {
      const cost = await fetchOpenRouterGeneration({ id, apiKey, baseUrl, fetchFn });
      if (cost) applyOpenRouterGenerationCost(task, cost);
    } catch (err) {
      logger.warn(
        { err: redactSecrets(err.message, [apiKey]), id },
        'openrouter: generation cost reconcile skipped',
      );
    }
  })();
  _reconcileJobs.add(job);
  job.finally(() => _reconcileJobs.delete(job));
  return job;
}

export default inferOpenRouter;
