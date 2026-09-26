/**
 * OpenRouter inference (OpenAI-compatible).
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   Auth: OPENROUTER_API_KEY (Bearer).
 *
 * The hub is off when the key is absent: callers must not advertise routes or
 * throw. Model ids on the wire are OpenRouter's own (`openai/gpt-4o-mini`);
 * the catalog prefixes them as `openrouter/<vendor>/<model>`.
 */

import logger from './logger.js';
import { capOpenRouterOutputTokens } from './openrouter-pricing.js';

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_REFERER = 'https://chit402.com';
const DEFAULT_TITLE = 'Chit402';

/**
 * Attribution OpenRouter asks routers to send on every request.
 * `OPENROUTER_REFERER` / `OPENROUTER_TITLE` override the defaults.
 */
export function openrouterAttributionHeaders() {
  const referer = String(process.env.OPENROUTER_REFERER || '').trim() || DEFAULT_REFERER;
  const title = String(process.env.OPENROUTER_TITLE || '').trim() || DEFAULT_TITLE;
  return {
    'HTTP-Referer': referer,
    'X-Title': title,
  };
}

/** @returns {string} key, or '' when the hub is disabled */
export function openrouterApiKey() {
  return String(process.env.OPENROUTER_API_KEY || '').trim();
}

export function openrouterEnabled() {
  return openrouterApiKey().length > 0;
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
 * @param {string} [opts.apiKey]
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
  apiKey = openrouterApiKey(),
  baseUrl = openrouterBaseUrl(),
  timeoutMs = 60_000,
  fetchFn = globalThis.fetch,
}) {
  if (!apiKey) return { ok: false, reason: 'missing_api_key', model };
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
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    logger.info({ model, max_tokens: capped }, 'openrouter-infer: POST');
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...openrouterAttributionHeaders(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    const rawText = await res.text();
    if (!res.ok) {
      logger.warn(
        { model, status: res.status, elapsed, body: rawText.slice(0, 200) },
        'openrouter-infer: HTTP error',
      );
      return {
        ok: false,
        reason: `http_${res.status}`,
        model,
        detail: rawText.slice(0, 500),
        elapsed_ms: elapsed,
      };
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, reason: 'unparseable', model, detail: rawText.slice(0, 200), elapsed_ms: elapsed };
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
        detail: rawText.slice(0, 200),
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
      finish_reason: choice?.finish_reason ?? null,
      provider: 'openrouter',
      elapsed_ms: elapsed,
      max_tokens: capped,
    };
  } catch (err) {
    logger.warn({ model, err: err.message }, 'openrouter-infer: failed');
    return { ok: false, reason: 'network_error', model, detail: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Confirm the key and the upstream are answering, without starting a billed completion.
 * OpenRouter's `GET /key` returns account metadata. A non-2xx or a network error
 * is a preflight failure: do not settle.
 *
 * Success is cached for the catalog TTL so a paid call does not wait on this
 * twice a minute. Failures are not cached.
 *
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {boolean} [opts.force]
 */
let _keyOkAt = 0;

export function resetOpenRouterPreflightCache() {
  _keyOkAt = 0;
}

export async function preflightOpenRouter({
  apiKey = openrouterApiKey(),
  baseUrl = openrouterBaseUrl(),
  fetchFn = globalThis.fetch,
  force = false,
} = {}) {
  if (!apiKey) return { ok: false, reason: 'disabled' };
  const ttl = parseInt(process.env.HUB_CATALOG_TTL_MS, 10) || 60_000;
  if (!force && _keyOkAt && Date.now() - _keyOkAt < ttl) {
    return { ok: true, cached: true };
  }
  const base = String(baseUrl).replace(/\/$/, '');
  try {
    const res = await fetchFn(`${base}/key`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...openrouterAttributionHeaders(),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    _keyOkAt = Date.now();
    return { ok: true, cached: false };
  } catch (err) {
    return { ok: false, reason: 'network_error', detail: err.message };
  }
}

export default inferOpenRouter;
