/**
 * ComputeRouter — XFuel 6-tier DePIN compute waterfall (control flow only).
 *
 * Extracted from ThetaInferenceHandler._executeService so the priority routing
 * (EdgeCloud → RapidAPI → MCP → Akash → Render → OpenAI-compatible → Bedrock →
 * Claude) lives in one place and can be unit-tested in isolation and reused by
 * both the inference handler and the M2M AI listener. Providers are pluggable
 * tiers — the generic OpenAI-compatible tier makes the router truly
 * provider-agnostic (point it at any OpenAI-shaped endpoint via env).
 *
 * This module is intentionally pure control-flow: it does NOT own the provider
 * executors or API keys. Callers supply an ordered list of tier descriptors. The
 * waterfall semantics exactly match the original handler:
 *   - tiers run in order; unavailable tiers are skipped
 *   - a tier "wins" when its executor returns a truthy result
 *   - executors return result-or-null on soft failure (to allow fallthrough)
 *   - a thrown error is fatal and propagates to the caller (no fallthrough),
 *     matching the original single-try-block behavior
 *   - mock fallback is left to the caller (so reason strings / stats are exact)
 *
 * @typedef {Object} Tier
 * @property {string}   tag        provider tag, e.g. 'edgecloud'
 * @property {boolean}  available  whether this tier is eligible to run
 * @property {Function} execute    async (req) => result|null
 * @property {string}   [log]      optional message logged before attempting
 */

export const PROVIDER_TAGS = Object.freeze({
  EDGECLOUD: 'edgecloud',
  RAPIDAPI: 'rapidapi',
  MCP: 'mcp',
  AKASH: 'akash',
  RENDER: 'render',
  /** Confidential / TEE-class content path (Phala-class). Prefer when Private Spend needs prompt privacy. */
  CONFIDENTIAL: 'confidential',
  OPENAI: 'openai-compatible',
  BEDROCK: 'bedrock',
  CLAUDE: 'claude',
  MOCK: 'mock',
});

export class ComputeRouter {
  /**
   * @param {{ tiers: Tier[], logger?: { log: Function } }} opts
   */
  constructor({ tiers, logger = console } = {}) {
    if (!Array.isArray(tiers)) throw new Error('tiers must be an array');
    this.tiers = tiers;
    this.logger = logger;
  }

  /**
   * Run the waterfall. Returns the first truthy result and its source tag.
   * If no available tier produces output, returns { result: null, source: null }
   * (the caller decides on mock fallback).
   *
   * @param {Object} req  passed to each tier executor
   * @param {string[]} [req.preferTags]  optional tags to try first (still skip unavailable)
   * @returns {Promise<{ result: any, source: string|null }>}
   */
  async route(req) {
    let tiers = this.tiers;
    const prefer = Array.isArray(req?.preferTags) ? req.preferTags.filter(Boolean) : [];
    if (prefer.length) {
      const preferred = [];
      const rest = [];
      for (const tier of this.tiers) {
        if (prefer.includes(tier.tag)) preferred.push(tier);
        else rest.push(tier);
      }
      tiers = [...preferred, ...rest];
    }
    for (const tier of tiers) {
      if (!tier || !tier.available) continue;
      if (tier.log) this.logger.log(tier.log);
      const result = await tier.execute(req);
      if (result) return { result, source: tier.tag };
    }
    return { result: null, source: null };
  }

  /**
   * Build the standard 6-tier router from a ThetaInferenceHandler instance.
   * Availability conditions and log strings mirror the original
   * _executeService waterfall exactly.
   *
   * @param {Object} handler  ThetaInferenceHandler instance
   * @param {{ logger?: { log: Function } }} [opts]
   * @returns {ComputeRouter}
   */
  static fromHandler(handler, opts = {}) {
    const run = (method) => (req) =>
      handler[method](req.serviceType, req.requestBody, req.modelName, req.gpuName);

    const tiers = [
      {
        tag: PROVIDER_TAGS.EDGECLOUD,
        available: !!handler.edgeCloudApiKey,
        execute: run('_callEdgeCloud'),
      },
      {
        tag: PROVIDER_TAGS.RAPIDAPI,
        available: !!(handler.useRapidApiFallback && handler.rapidApiKey),
        execute: run('_callRapidAPI'),
        log: '[Router] EdgeCloud unavailable → trying RapidAPI...',
      },
      {
        tag: PROVIDER_TAGS.MCP,
        available: !!(handler.useMcpFallback && handler.mcpEndpoint),
        execute: run('_callMCP'),
        log: '[Router] RapidAPI unavailable → trying MCP...',
      },
      {
        tag: PROVIDER_TAGS.AKASH,
        available: !!(handler.useAkashFallback && handler.akashMnemonic),
        execute: run('_callAkash'),
        log: '[Router] Theta tiers unavailable → trying Akash Network DePIN...',
      },
      {
        tag: PROVIDER_TAGS.RENDER,
        available: !!(handler.useRenderFallback && handler.renderApiKey),
        execute: run('_callRender'),
        log: '[Router] Akash unavailable → trying Render Network DePIN...',
      },
      {
        // Confidential / TEE-class (Phala-compatible OpenAI shape). Opt-in via
        // CONFIDENTIAL_PROVIDER_BASE_URL + CONFIDENTIAL_PROVIDER_API_KEY.
        tag: PROVIDER_TAGS.CONFIDENTIAL,
        available: !!(handler.confidentialProviderBase && handler.confidentialProviderKey),
        execute: run('_callConfidential'),
        log: '[Router] Trying confidential / TEE-class provider...',
      },
      {
        // Provider-agnostic tier: any OpenAI-compatible endpoint (OpenAI, Groq,
        // Together, Fireworks, DeepInfra, a self-hosted vLLM, an Akash-hosted
        // model…) plugs in via env — no code change to swap providers. This is
        // where the bulk of real-world inference lives today, so it sits right
        // after the DePIN tiers as the primary reliable route. LLM only.
        tag: PROVIDER_TAGS.OPENAI,
        available: !!(handler.useOpenAICompatFallback && handler.openaiCompatKey && handler.openaiCompatBase),
        execute: run('_callOpenAICompatible'),
        log: '[Router] DePIN tiers unavailable → trying configured OpenAI-compatible endpoint...',
      },
      {
        tag: PROVIDER_TAGS.BEDROCK,
        available: !!(handler.useBedrockFallback && handler.awsAccessKeyId && handler.awsSecretAccessKey),
        execute: run('_callBedrock'),
        log: '[Router] All DePINs unavailable → falling back to AWS Bedrock (centralized)...',
      },
      {
        // Reliable centralized backstop so a demo/agent request never hard-fails
        // when DePIN tiers are cold (e.g. Theta on-demand "no instances"). LLM only.
        tag: PROVIDER_TAGS.CLAUDE,
        available: !!(handler.useClaudeFallback && handler.anthropicApiKey),
        execute: run('_callClaude'),
        log: '[Router] All prior tiers unavailable → falling back to Claude (Anthropic, centralized)...',
      },
    ];

    return new ComputeRouter({ tiers, logger: opts.logger });
  }
}

export default ComputeRouter;
