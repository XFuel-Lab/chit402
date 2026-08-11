/**
 * AkashML managed inference (OpenAI-compatible).
 *
 * POST https://api.akashml.com/v1/chat/completions
 * Auth: AKASHML_API_KEY (Bearer).
 *
 * Simpler than Theta EdgeCloud — no `{input:{messages}}` wrap / unwrap.
 * Chat-only; image/audio stay on Theta.
 */

import logger from './logger.js';

const DEFAULT_BASE = 'https://api.akashml.com/v1';

/**
 * @param {object} opts
 * @param {string} opts.model          Native AkashML model id (e.g. zai-org/GLM-5.2)
 * @param {Array}  opts.messages
 * @param {number} [opts.max_tokens]
 * @param {number} [opts.temperature]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ ok: true, output: string, raw: object, provider: 'akash-network', elapsed_ms: number, model: string }
 *   | { ok: false, reason: string, detail?: string, elapsed_ms?: number, model?: string }>}
 */
export async function inferAkashML({
  model,
  messages,
  max_tokens = 500,
  temperature = 0.7,
  apiKey = process.env.AKASHML_API_KEY || '',
  baseUrl = process.env.AKASHML_BASE_URL || DEFAULT_BASE,
  timeoutMs = 60_000,
  fetchFn = globalThis.fetch,
}) {
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key', model };
  }
  if (!model) {
    return { ok: false, reason: 'missing_model' };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, reason: 'missing_messages', model };
  }

  const base = String(baseUrl).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    max_tokens,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    logger.info({ model }, 'akashml-infer: POST');
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    const rawText = await res.text();
    if (!res.ok) {
      logger.warn({ model, status: res.status, elapsed, body: rawText.slice(0, 200) }, 'akashml-infer: HTTP error');
      return { ok: false, reason: `http_${res.status}`, model, detail: rawText.slice(0, 500), elapsed_ms: elapsed };
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, reason: 'unparseable', model, detail: rawText.slice(0, 200), elapsed_ms: elapsed };
    }

    const output =
      data?.choices?.[0]?.message?.content
      ?? data?.choices?.[0]?.text
      ?? '';
    if (typeof output !== 'string' || !output) {
      return { ok: false, reason: 'empty_output', model, detail: rawText.slice(0, 200), elapsed_ms: elapsed };
    }

    return {
      ok: true,
      model,
      output,
      raw: data,
      provider: 'akash-network',
      elapsed_ms: elapsed,
    };
  } catch (err) {
    logger.warn({ model, err: err.message }, 'akashml-infer: failed');
    return { ok: false, reason: 'network_error', model, detail: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

export default inferAkashML;
