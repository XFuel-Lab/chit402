/**
 * Token usage normalization.
 *
 * Every inference path records usage in one shape so aggregate spend, provider
 * COGS reconciliation, and metered pricing all read the same numbers. Before
 * this, the M2M path recorded nothing at all and `/v1` estimated from visible
 * text — which understates reasoning models badly, since hidden reasoning
 * tokens are billed but never appear in the answer.
 *
 * `cached_prompt_tokens` is carried even though nothing consumes it yet: on
 * agent traffic ~90% of the prompt is a repeated prefix, so the cached split is
 * the difference between an accurate COGS figure and one that is ~5x too high.
 * See docs/KNOWN_ISSUES.md.
 */

/** Rough count — ~4 chars/token. Only used when a provider reports no usage. */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

/** Pull billed text out of a message `content` field (string, parts, or object). */
function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') return part.text;
        return JSON.stringify(part);
      }
      return '';
    }).join('');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

/** Flatten chat messages to plain text for estimation. */
export function messagesToText(messages) {
  if (!Array.isArray(messages)) return '';
  return messages.map((m) => {
    const parts = [contentToText(m?.content)];
    if (m?.tool_calls) parts.push(JSON.stringify(m.tool_calls));
    return parts.filter(Boolean).join('\n');
  }).join('\n');
}

const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * Pull usage out of a provider response, accepting either the OpenAI shape
 * (`prompt_tokens` / `completion_tokens`, with `*_tokens_details` sub-objects)
 * or the Anthropic shape (`input_tokens` / `output_tokens` /
 * `cache_read_input_tokens`).
 * @returns {null|{prompt_tokens:number,completion_tokens:number,total_tokens:number,
 *   cached_prompt_tokens:number|null,reasoning_tokens:number|null,source:'provider'}}
 */
function fromProvider(raw) {
  const u = raw?.usage ?? raw;
  if (!u || typeof u !== 'object') return null;

  const prompt = num(u.prompt_tokens) ?? num(u.input_tokens);
  const completion = num(u.completion_tokens) ?? num(u.output_tokens);
  // A provider that reports neither side has told us nothing usable.
  if (prompt === null && completion === null) return null;

  const cached = num(u.prompt_tokens_details?.cached_tokens)
    ?? num(u.cache_read_input_tokens)
    ?? num(u.cached_tokens);
  const reasoning = num(u.completion_tokens_details?.reasoning_tokens)
    ?? num(u.reasoning_tokens);

  const p = prompt ?? 0;
  const c = completion ?? 0;
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: num(u.total_tokens) ?? p + c,
    cached_prompt_tokens: cached,
    reasoning_tokens: reasoning,
    source: 'provider',
  };
}

/**
 * Normalize usage for one inference, preferring what the provider billed and
 * falling back to an estimate from the text.
 *
 * @param {object|null} raw provider response (or its `usage` block)
 * @param {object} [fallback]
 * @param {Array}  [fallback.messages] request messages, for prompt estimation
 * @param {string} [fallback.prompt]   raw prompt, when messages are absent
 * @param {string} [fallback.output]   completion text, for output estimation
 * @returns {{prompt_tokens:number,completion_tokens:number,total_tokens:number,
 *   cached_prompt_tokens:number|null,reasoning_tokens:number|null,
 *   source:'provider'|'estimate'}}
 */
export function normalizeUsage(raw, { messages, prompt, output } = {}) {
  const provider = fromProvider(raw);
  if (provider) return provider;

  const promptText = messages ? messagesToText(messages) : (prompt ?? '');
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(output);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    cached_prompt_tokens: null,
    reasoning_tokens: null,
    source: 'estimate',
  };
}

/**
 * Sum usage across task snapshots, keeping provider-reported and estimated
 * totals apart — mixing them would present a guess as a measurement.
 * @param {Array<object>} tasks task snapshots (from `store.allSnapshots()`)
 */
export function aggregateUsage(tasks) {
  const zero = () => ({ tasks: 0, prompt_tokens: 0, completion_tokens: 0, cached_prompt_tokens: 0 });
  const out = { provider: zero(), estimate: zero() };
  for (const t of tasks || []) {
    const u = t?.usage;
    if (!u || !Number.isFinite(u.total_tokens)) continue;
    const bucket = u.source === 'provider' ? out.provider : out.estimate;
    bucket.tasks += 1;
    bucket.prompt_tokens += u.prompt_tokens || 0;
    bucket.completion_tokens += u.completion_tokens || 0;
    bucket.cached_prompt_tokens += u.cached_prompt_tokens || 0;
  }
  return out;
}

export default { estimateTokens, messagesToText, normalizeUsage, aggregateUsage };
