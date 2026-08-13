/**
 * AkashML managed inference (OpenAI-compatible).
 *
 * POST https://api.akashml.com/v1/chat/completions
 * Auth: AKASHML_API_KEY (Bearer).
 *
 * Simpler than Theta EdgeCloud — no `{input:{messages}}` wrap / unwrap.
 * Chat-only; image/audio stay on Theta.
 *
 * Billing is per token against prepaid credits — there is no lease to leave
 * running, unlike Akash Console SDL deployments (see docs/providers/README.md).
 */

import logger from './logger.js';

const DEFAULT_BASE = 'https://api.akashml.com/v1';

/** AkashML inference keys carry this prefix; Akash Console keys use `ac.sk.`. */
const AKASHML_PREFIX = 'akml-';
const CONSOLE_PREFIX = 'ac.sk.';

const warned = new Set();
function warnOnce(id, msg) {
  if (warned.has(id)) return;
  warned.add(id);
  logger.warn(msg);
}

/**
 * Resolve the AkashML inference credential, selecting on key *prefix* rather than
 * variable name — because Akash ships two unrelated credentials and its docs name
 * the other one `AKASH_API_KEY`:
 *
 *   akml-…   AkashML inference, api.akashml.com, `Authorization: Bearer`, per-token
 *   ac.sk.…  Akash Console, console-api.akash.network, `x-api-key`, per-lease
 *
 * A Console key on an inference endpoint 401s and would otherwise fall through to
 * mock silently, so it is rejected loudly instead of forwarded.
 * @returns {string} inference key, or '' when none is usable
 */
export function akashmlApiKey() {
  const canonical = (process.env.AKASHML_API_KEY || '').trim();
  if (canonical) {
    if (canonical.startsWith(CONSOLE_PREFIX)) {
      warnOnce(
        'console-key-in-akashml-slot',
        'AKASHML_API_KEY holds an Akash Console key (ac.sk.…). Console keys manage SDL '
        + 'leases at console-api.akash.network and are rejected by AkashML inference. '
        + 'Create an inference key (akml-…) at akashml.com → Settings → API Keys.',
      );
      return '';
    }
    return canonical;
  }

  // AKASH_API_KEY is Akash Console's documented variable name — only borrow it when
  // the value is unambiguously an AkashML inference key.
  const alt = (process.env.AKASH_API_KEY || '').trim();
  if (alt.startsWith(AKASHML_PREFIX)) return alt;
  if (alt) {
    warnOnce(
      'console-key-only',
      'AKASH_API_KEY looks like an Akash Console key (deployments/leases), not AkashML '
      + 'inference — AkashML routing stays disabled. Set AKASHML_API_KEY=akml-… to enable it.',
    );
  }
  return '';
}

/**
 * @param {object} opts
 * @param {string} opts.model          Native AkashML model id (e.g. zai-org/GLM-5.2)
 * @param {Array}  opts.messages
 * @param {number} [opts.max_tokens]
 * @param {number} [opts.temperature]
 * @param {Array}  [opts.tools]        OpenAI tool definitions, forwarded as-is
 * @param {string|object} [opts.tool_choice]
 * @param {string} [opts.cacheNamespace] per-buyer prompt-cache partition (see buyer-attr.js)
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
  tools = null,
  tool_choice = null,
  cacheNamespace = null,
  apiKey = akashmlApiKey(),
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
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
  }
  // Partition the upstream prompt cache per buyer. All XFuel traffic shares one
  // AkashML key, so the provider sees one account and cannot isolate our tenants
  // from each other — a measured leak in this exact architecture (see
  // cacheNamespace in buyer-attr.js). Both field names are sent because the
  // upstream engine is not contractually known: `cache_salt` is vLLM's, and
  // `prompt_cache_key` is the OpenAI-standard spelling. AkashML accepts and
  // ignores unknown fields, so sending both is safe; neither is documented as
  // honoured, which is why this is defence in depth rather than a guarantee.
  if (cacheNamespace) {
    body.cache_salt = cacheNamespace;
    body.prompt_cache_key = cacheNamespace;
  }

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

    const choice = data?.choices?.[0];
    const finishReason = choice?.finish_reason ?? null;
    const usage = data?.usage ?? null;
    const output = choice?.message?.content ?? choice?.text ?? '';
    const toolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length
      ? choice.message.tool_calls
      : null;

    // A tool call IS the answer, and it arrives with `content: null` by design.
    // Treating empty content as failure here is what made tool calling unusable
    // through the gateway even before the request side dropped `tools`.
    if (!toolCalls && (typeof output !== 'string' || !output)) {
      // Reasoning models (GLM-5.2 et al) emit `reasoning_content` before `content`,
      // so a max_tokens budget consumed entirely by reasoning yields finish_reason
      // 'length' with an empty answer. That is an under-budgeted request, NOT a
      // provider fault — failing over would pay a second provider for the same
      // mistake, so report it distinctly and let the caller raise max_tokens.
      const truncated = finishReason === 'length';
      const reasoned = typeof choice?.message?.reasoning_content === 'string'
        && choice.message.reasoning_content.length > 0;
      logger.warn(
        { model, finishReason, usage, reasoning_only: truncated && reasoned },
        truncated
          ? 'akashml-infer: max_tokens exhausted before any answer (reasoning model)'
          : 'akashml-infer: empty output',
      );
      return {
        ok: false,
        reason: truncated ? 'truncated' : 'empty_output',
        model,
        finish_reason: finishReason,
        usage,
        detail: truncated
          ? `max_tokens (${max_tokens}) consumed by reasoning before any answer was emitted — raise max_tokens`
          : rawText.slice(0, 200),
        elapsed_ms: elapsed,
      };
    }

    return {
      ok: true,
      model,
      output,
      toolCalls,
      raw: data,
      usage,
      finish_reason: finishReason,
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
