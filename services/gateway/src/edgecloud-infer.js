/**
 * Direct Theta EdgeCloud on-demand inference (modality-aware).
 *
 * Builds the correct `input` body from catalog metadata instead of always
 * sending chat completions fields (which breaks Whisper / SDXL).
 *
 * Auth: THETA_EDGECLOUD_API_KEY (on-demand inference key).
 */

import logger from './logger.js';

const DEFAULT_BASE = 'https://ondemand.thetaedgecloud.com';

/**
 * @param {object} opts
 * @param {string} opts.alias
 * @param {string} [opts.prediction]  default_prediction from catalog
 * @param {object} opts.input         already-shaped Theta input object
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.waitSec]
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function inferEdgeCloud({
  alias,
  prediction = null,
  input,
  apiKey = process.env.THETA_EDGECLOUD_API_KEY || '',
  baseUrl = process.env.THETA_EDGECLOUD_BASE || DEFAULT_BASE,
  waitSec = 30,
  fetchFn = globalThis.fetch,
}) {
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key', alias };
  }
  if (!alias) {
    return { ok: false, reason: 'missing_alias' };
  }

  const base = String(baseUrl).replace(/\/$/, '');
  const endpoint = `/infer_request/${encodeURIComponent(alias)}?wait=${waitSec}`;
  const url = `${base}${endpoint}`;
  const body = { input: input || {} };
  // Some services accept variant; leave unset unless caller adds it.

  // EdgeCloud answers 409 while a service has no worker ready, so a retry is
  // waiting on a GPU to come up, not on a network blip. Two attempts 2s apart
  // covered neither case: too long to spend on a model that is simply down, and
  // far too short for a genuine cold start. Backoff instead — 2s then 6s — so a
  // service that is warming has a chance to answer, and give up after that
  // rather than holding an agent for a minute. Models with no published capacity
  // are filtered out of auto-routing upstream, so the common dead case never
  // reaches here.
  const maxAttempts = 3;
  const retryDelaysMs = [2_000, 6_000];
  const perCallTimeout = waitSec * 1000 + 15_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), perCallTimeout);
    const t0 = Date.now();
    try {
      logger.info({ alias, prediction, attempt }, 'edgecloud-infer: POST');
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
        if (res.status === 409 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1] ?? 2_000));
          continue;
        }
        logger.warn({ alias, status: res.status, elapsed, body: rawText.slice(0, 200) }, 'edgecloud-infer: HTTP error');
        return { ok: false, reason: `http_${res.status}`, alias, detail: rawText.slice(0, 500), elapsed_ms: elapsed };
      }

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        return { ok: false, reason: 'unparseable', alias, detail: rawText.slice(0, 200), elapsed_ms: elapsed };
      }

      const reqObj = data?.body?.infer_requests?.[0] || data?.infer_requests?.[0] || null;
      if (reqObj?.state && reqObj.state !== 'success') {
        return { ok: false, reason: `state_${reqObj.state}`, alias, elapsed_ms: elapsed };
      }
      const output = reqObj?.output ?? data?.output ?? data;
      return {
        ok: true,
        alias,
        prediction,
        output,
        raw: data,
        provider: 'theta-edgecloud',
        elapsed_ms: elapsed,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < maxAttempts && err.name === 'AbortError') {
        continue;
      }
      logger.warn({ alias, err: err.message }, 'edgecloud-infer: failed');
      return { ok: false, reason: 'network_error', alias, detail: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, reason: 'exhausted', alias };
}

/** Build Theta input for chat completions services. */
export function chatInputFromMessages({ messages, max_tokens, temperature, top_p }) {
  return {
    messages: messages || [],
    max_tokens: max_tokens ?? 500,
    temperature: temperature ?? 0.7,
    top_p: top_p ?? 0.9,
    stream: false,
  };
}

/** Build Theta input for text→image (SDXL / flux-class). */
export function imageInputFromPrompt({ prompt, steps, guidance, seed, strength }) {
  const input = { prompt: String(prompt || '') };
  if (steps != null) input.steps = steps;
  if (guidance != null) input.guidance = guidance;
  if (seed != null) input.seed = seed;
  if (strength != null) input.strength = strength;
  return input;
}

/** Build Theta input for Whisper STT. */
export function audioInputFromUrl(audioUrl) {
  return { audio_filename: String(audioUrl || '') };
}

/**
 * Pull assistant text from EdgeCloud output envelopes.
 *
 * Theta services disagree on shape: `{ text }`, `{ message: "..." }` (GLM),
 * `{ message: { content } }`, or an OpenAI-style `{ choices: [...] }`. Return the
 * plain string in every case — never a JSON-encoded envelope, which would leak
 * `{"message":"hi"}` into an OpenAI client's `choices[0].message.content`.
 */
export function extractTextOutput(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const first = output[0];
    return typeof first === 'string' ? first : extractTextOutput(first);
  }

  const candidates = [
    output.text,
    output.message,
    output.message?.content,
    output.response,
    output.content,
    output.output,
    output.generated_text,
    output.choices?.[0]?.message?.content,
    output.choices?.[0]?.text,
    output.choices?.[0]?.delta?.content,
    Array.isArray(output.data)
      ? (typeof output.data[0] === 'string' ? output.data[0] : output.data[0]?.text)
      : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }

  // Unknown envelope — surface it rather than dropping the answer, but this is a
  // shape we should teach the extractor about.
  logger.warn({ keys: Object.keys(output).slice(0, 10) }, 'edgecloud-infer: unrecognized output envelope');
  return JSON.stringify(output);
}

/** Pull image URL from EdgeCloud image outputs. */
export function extractImageUrl(output) {
  if (!output) return null;
  if (typeof output === 'string' && /^https?:\/\//.test(output)) return output;
  return (
    output.image_url
    ?? output.url
    ?? output.path
    ?? (Array.isArray(output.data) ? (output.data[0]?.url || output.data[0]?.path || output.data[0]) : null)
    ?? null
  );
}
