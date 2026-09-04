import crypto from 'crypto';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { getAIListener } from './ai-listener.js';
import { getSP1Prover } from './sp1-prover-client.js';
import { settlementProofAllowed } from './prove-gate.js';
import { buildVerifyUrl, baseUrlFromReq, buildReceipt as buildSignedReceipt } from './receipt.js';
import { apiKeyHashFromReq, cacheNamespace } from './buyer-attr.js';
import { getHubCatalog, resolveCatalogModel, requestShape, toOpenAIList } from './hub-catalog.js';
import { recordSuccess, recordFailure } from './provider-health.js';
import {
  inferEdgeCloud,
  chatInputFromMessages,
  imageInputFromPrompt,
  audioInputFromUrl,
  extractTextOutput,
  extractImageUrl,
} from './edgecloud-infer.js';
import { inferAkashML, akashmlApiKey } from './akashml-infer.js';
import { normalizeUsage, messagesToText } from './usage.js';
import { runX402Handshake, extractPaymentHeader } from './x402-server.js';
import { measureCogs, rateForModel } from './provider-rates.js';
import { publishedPrice } from './pricing.js';
import { getFloatManager } from './provider-float.js';
import { freeTierBucket, checkFreeAllowance, recordFreeSpend, usd as cogsUsd } from './free-tier.js';
import { recordCollectedSpend } from './usage-settled.js';
import {
  resolveBookableAgent,
  remainingBlocksDoor,
  capViewOf,
} from './agent-book.js';

/**
 * XFuel OpenAI-compatible gateway.
 *
 *   GET  /v1/models              → live hub catalog (Theta + AkashML + …)
 *   GET  /v1/models/:id          → retrieve one model
 *   POST /v1/chat/completions    → chat (+ receipt)
 *   POST /v1/images/generations  → image (+ receipt)
 *   POST /v1/audio/transcriptions → STT (+ receipt)
 *
 * Model ids are hub-prefixed (theta/qwen3, akash/zai-org/GLM-5.3). Typed aliases
 * (deepseek, llama-3.3, …) map onto live hub rows only — never silent vendor remap.
 * OPENAI_GATEWAY_ALLOW_FALLBACK=false → hard-fail when preferred hub fails.
 */

/** When false, preferred hub miss returns 503 instead of mock / other tiers. */
function allowFallback(req) {
  if (req?.body?.xfuel?.allow_fallback === false) return false;
  if (req?.body?.allow_fallback === false) return false;
  return process.env.OPENAI_GATEWAY_ALLOW_FALLBACK !== 'false';
}

// ─── Fee math (mirrors calculateTaskFee in server.js / main.rs) ───────────────

const GATEWAY_FEE_BPS = parseInt(process.env.AI_TASK_FEE_BPS, 10) || 50; // 0.5%
const FEE_DENOMINATOR = 10000n;
/** Accounting amount for the proof/fee record when the OpenAI call is unmetered. */
const GATEWAY_TASK_AMOUNT = process.env.OPENAI_GATEWAY_TASK_AMOUNT || '2000';

/** Hard cap on max_tokens (0 = uncapped). Set on the hosted demo to gate spend. */
const MAX_TOKENS_CAP = parseInt(process.env.OPENAI_GATEWAY_MAX_TOKENS_CAP, 10) || 0;

/** Clamp a requested max_tokens to the configured cap (if any). */
function clampMaxTokens(requested) {
  if (MAX_TOKENS_CAP <= 0) return requested;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return MAX_TOKENS_CAP;
  return Math.min(n, MAX_TOKENS_CAP);
}

// ─── Demo key helper ─────────────────────────────────────────────────────────

const DEMO_API_KEY = process.env.M2M_DEMO_API_KEY || 'chit402-demo';

/**
 * Check if a key is the demo key or a demo key prefix variant.
 * Accepts both 'chit402-demo' (public) and 'xfuel-demo' (legacy/internal).
 * @param {string|null|undefined} key
 * @returns {boolean}
 */
function isDemoKey(key) {
  if (!key) return false;
  const k = String(key);
  if (k === DEMO_API_KEY) return true;
  // Legacy and prefix variants
  if (k === 'xfuel-demo' || k === 'chit402-demo') return true;
  if (k.startsWith('xfuel-demo') || k.startsWith('chit402-demo')) return true;
  return false;
}

// ─── x402 metering for /v1 ───────────────────────────────────────────────────

/**
 * The demo key and any explicitly listed key skip payment. Without this,
 * enabling metering would 402 the public testnet gateway and every quickstart
 * that points at it.
 */
function meteringExempt(req) {
  const key = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return false;
  if (isDemoKey(key)) return true;
  return (config.x402?.meterV1ExemptKeys || []).includes(key);
}

/**
 * True if the request has a valid possession session (registered agent).
 * Private Spend is the default for registered/possession sessions — providers
 * see gateway-pooled credentials, not end-customer topology.
 *
 * Demo keys never qualify (they should not silently get privacy they did not pay for).
 *
 * @param {object} req - Express request
 * @param {{ getBySession?: Function }|null} registry - AgentRegistry instance
 * @returns {boolean}
 */
function isPrivateSpendSession(req, registry) {
  if (!registry || typeof registry.getBySession !== 'function') return false;
  const key = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return false;
  if (isDemoKey(key)) return false;
  const session = req.body?.session || req.headers['x-xfuel-session'] || null;
  if (!session) return false;
  const identity = registry.getBySession(String(session));
  return !!identity;
}

/**
 * Send a 402 with PAYMENT-REQUIRED header (CDP Bazaar / validate require this).
 * Shapes the body for both x402 clients (reads `accepts`) and OpenAI clients
 * (reads `error.message`).
 */
function sendV1PaymentRequired(res, body, headers = {}) {
  const pr = headers['PAYMENT-REQUIRED']
    || Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
  res.set('PAYMENT-REQUIRED', pr);
  const exposed = res.get('Access-Control-Expose-Headers') || '';
  if (!/PAYMENT-REQUIRED/i.test(exposed)) {
    res.set('Access-Control-Expose-Headers',
      exposed ? `${exposed}, PAYMENT-REQUIRED` : 'PAYMENT-REQUIRED');
  }
  return res.status(402).json({
    ...body,
    error: {
      message: 'Payment required. Retry with an X-PAYMENT or PAYMENT-SIGNATURE header for the amount in `accepts[0]`.',
      type: 'payment_required',
      code: 'payment_required',
    },
  });
}

/**
 * Charge for a `/v1` call over x402 before running it.
 *
 * `/v1` is the busiest surface and has been free, so metering `/task-request`
 * alone earns nothing — the traffic goes through the unmetered door. Priced by
 * the same rate card as the M2M path: `quoteTask` reads `model`/`messages`/
 * `max_tokens`, which the OpenAI body already carries, and `xfuel/auto` is
 * resolved to a concrete model first so the alias is not billed at the cheap
 * default row.
 *
 * `max_tokens` is quoted at the **capped** value, not the requested one. Output is
 * priced at its ceiling under the `exact` scheme, and the hosted demo caps the
 * ceiling — quoting uncapped would charge for output the caller cannot receive.
 *
 * A plain OpenAI SDK cannot satisfy a 402, which is why this is opt-in. Callers
 * that speak x402 (the XFuel SDK, x402-fetch wrappers) retry with `X-PAYMENT`.
 *
 * When the request already names a bookable agent_id (session) and remaining
 * is below the $0.002 hop floor, fail closed BEFORE runX402Handshake — never take
 * payment then refuse.
 *
 * @returns {Promise<{halted:boolean, payment?:{ref:string, amount:string}|null}>}
 *   `halted` → a 402/403 has already been written; the handler must return.
 */
async function meterV1Request(req, res, {
  taskId,
  isAuthorised = null,
  resourcePath = '/v1/chat/completions',
  ledger = null,
  registry = null,
} = {}) {
  // When isAuthorised is passed, we use it to determine if the request is exempt.
  // Otherwise, fall back to the config-gated behavior for backward compat.
  const useIsAuth = typeof isAuthorised === 'function';
  if (!useIsAuth) {
    // Legacy config-gated path
    if (!config.x402?.meterV1 || !config.x402?.enabled) return { halted: false, payment: null };
  } else {
    // x402 must be enabled for paid requests
    if (!config.x402?.enabled) return { halted: false, payment: null };
  }
  // Demo key and explicitly exempt keys always free — never burn budget Y.
  if (meteringExempt(req)) return { halted: false, payment: null };
  // A request with an explicit key that passes authorization is free.
  // Open mode (no M2M_API_KEYS configured) does NOT bypass payment - the caller
  // must present a valid key. This separates dev convenience from production billing.
  if (useIsAuth) {
    const key = req.headers['x-api-key']
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (key && isAuthorised(req)) return { halted: false, payment: null };
  }
  // No valid auth and not exempt → must pay

  // Per-agent prepaid ceiling: reject before settle when remaining < door floor.
  const bookable = resolveBookableAgent(req, registry);
  if (bookable && ledger && typeof ledger.sumCollectedByAgent === 'function') {
    const spent = ledger.sumCollectedByAgent(bookable.agent_id);
    const caps = capViewOf(bookable, spent);
    if (remainingBlocksDoor(caps.remaining)) {
      res.status(403).json({
        error: {
          message: 'Agent budget remaining is below the hop floor',
          type: 'budget_exhausted',
          code: 'budget_exhausted',
          agent_id: bookable.agent_id,
          window: caps.window,
          cap: caps.cap,
          spent: caps.spent,
          remaining: caps.remaining,
        },
      });
      return { halted: true };
    }
  }

  try {
    const body = { ...(req.body || {}) };
    if (body.max_tokens != null || MAX_TOKENS_CAP > 0) body.max_tokens = clampMaxTokens(body.max_tokens);

    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts);
    const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
    const resource = `${baseUrl.replace(/\/$/, '')}${path}`;
    const decision = await runX402Handshake(req, { taskId, body, baseUrl, resource });

    if (decision.kind === 'settled') {
      return { halted: false, payment: { ref: decision.paymentRef, amount: decision.settledAmount, payer: decision.payerWallet } };
    }

    if (decision.kind === 'challenge') {
      sendV1PaymentRequired(res, decision.body);
      return { halted: true };
    }

    logger.warn({ reqId: req.id, reason: decision.reason }, 'openai-gateway: x402 payment failed');
    res.status(402).json({
      error: {
        message: `Payment could not be settled: ${decision.reason}`,
        type: 'payment_required',
        code: decision.reason || 'settle_failed',
      },
    });
    return { halted: true };
  } catch (err) {
    logger.error({ err, reqId: req.id }, 'openai-gateway: x402 metering error');
    return { halted: true, payment: null, meteringError: err };
  }
}

function calcFee(grossAmount, feeBps = GATEWAY_FEE_BPS) {
  const gross = BigInt(grossAmount);
  const bps = BigInt(Math.min(Math.max(feeBps, 50), 100));
  const fee = (gross * bps) / FEE_DENOMINATOR;
  return { feeAmount: fee.toString(), netAmount: (gross - fee).toString(), feeBps: Number(bps) };
}

// Token accounting lives in usage.js so `/v1` and the metered `/task-request`
// path report the same numbers.

// ─── Inference runner (lazy 6-tier router singleton) ──────────────────────────

let _handler = null;
let _handlerReady = null;

async function getRouterHandler() {
  if (_handler) return _handler;
  if (!_handlerReady) {
    _handlerReady = (async () => {
      const { ThetaInferenceHandler } = await import(
        '../../../packages/circuit-runtime/theta-inference/theta-inference-handler.js'
      );
      const h = new ThetaInferenceHandler({});
      if (typeof h.resolveApiKeys === 'function') {
        await h.resolveApiKeys().catch(() => {});
      }
      _handler = h;
      return h;
    })();
  }
  return _handlerReady;
}

/**
 * Chat inference: resolve catalog model → Theta EdgeCloud / AkashML by hub;
 * optional ComputeRouter fallthrough when allowFallback.
 *
 * @returns {Promise<{ content: string, provider: string, mock: boolean, resolvedModel: string, raw: any, error?: object }>}
 */
async function runChatInference({
  model, messages, max_tokens, temperature, allowFallback: fb, cacheNs = null,
  tools = null, tool_choice = null,
}) {
  const { models } = await getHubCatalog();
  const resolved = resolveCatalogModel(model, models, {
    modality: 'chat',
    shape: requestShape({ tools, messages }),
  });
  if (!resolved.ok) {
    const detail = resolved.hint
      || `Model '${resolved.requested}' is not available. Use xfuel/auto for automatic routing, or GET /v1/models for available ids.`;
    return {
      content: '',
      provider: 'none',
      mock: true,
      resolvedModel: resolved.requested,
      raw: resolved,
      error: {
        status: 400,
        code: resolved.reason,
        message: detail,
      },
    };
  }

  const cat = resolved.model;
  const resolvedModel = cat.id;
  const wantsTools = Array.isArray(tools) && tools.length > 0;

  // Theta's on-demand completions accept only
  // {messages, max_tokens, temperature, top_p, stream, enable_thinking} — there is
  // no tools parameter, so forwarding would drop them and return prose where the
  // caller expects a structured call. Say so instead of guessing.
  if (wantsTools && cat.hub === 'theta') {
    return {
      content: '',
      provider: 'theta-edgecloud',
      mock: true,
      resolvedModel,
      raw: null,
      error: {
        status: 400,
        code: 'tools_unsupported_on_hub',
        message: `${resolvedModel} does not support the tools parameter. `
          + 'Use xfuel/auto or GET /v1/models to find a model that supports tool calling.',
      },
    };
  }

  // Prefer direct EdgeCloud for theta hub (honest alias).
  if (cat.hub === 'theta' && process.env.THETA_EDGECLOUD_API_KEY) {
    const result = await inferEdgeCloud({
      alias: cat.alias,
      prediction: cat.default_prediction,
      input: chatInputFromMessages({ messages, max_tokens, temperature }),
    });
    if (result.ok) {
      recordSuccess(cat.id);
      return {
        content: extractTextOutput(result.output),
        provider: 'theta-edgecloud',
        mock: false,
        resolvedModel,
        raw: result,
      };
    }
    recordFailure(cat.id, { reason: result.reason });
    logger.warn(
      { hub: 'theta', model: cat.alias, reason: result.reason, fallback: fb },
      'openai-gateway: preferred hub miss',
    );
    if (!fb) {
      return {
        content: '',
        provider: 'theta-edgecloud',
        mock: true,
        resolvedModel,
        raw: result,
        error: {
          status: 503,
          code: 'provider_unavailable',
          message: thetaFailureMessage(cat, result.reason),
        },
      };
    }
  }

  // AkashML hub — OpenAI-compatible chat only.
  if (cat.hub === 'akash' && akashmlApiKey()) {
    const result = await inferAkashML({
      model: cat.alias,
      messages,
      max_tokens,
      temperature,
      tools,
      tool_choice,
      cacheNamespace: cacheNs,
    });
    if (result.ok) {
      recordSuccess(cat.id);
      return {
        content: result.output,
        toolCalls: result.toolCalls || null,
        provider: 'akash-network',
        mock: false,
        resolvedModel,
        raw: result,
      };
    }
    // Truncation means the provider worked and the request was under-budgeted.
    // Failing over would bill a second provider for the same mistake, and a mock
    // blaming "transient capacity" hides the real cause — so answer honestly
    // whether or not fallback is allowed.
    if (result.reason === 'truncated') {
      logger.warn(
        { hub: 'akash', model: cat.alias, finish_reason: result.finish_reason, usage: result.usage },
        'openai-gateway: max_tokens too small for a reasoning model — not failing over',
      );
      return {
        content: '',
        provider: 'akash-network',
        mock: true,
        resolvedModel,
        raw: result,
        error: {
          status: 400,
          code: 'max_tokens_too_small',
          message: `akash/${cat.alias} is a reasoning model: max_tokens=${max_tokens} was consumed by `
            + 'internal reasoning before any answer was emitted. Raise max_tokens and retry.',
        },
      };
    }
    // A truncation is the caller's budget, not the provider's health, and is
    // returned above — so anything reaching here is the provider failing us.
    recordFailure(cat.id, { reason: result.reason });
    logger.warn(
      { hub: 'akash', model: cat.alias, reason: result.reason, fallback: fb },
      'openai-gateway: preferred hub miss',
    );
    if (!fb) {
      return {
        content: '',
        provider: 'akash-network',
        mock: true,
        resolvedModel,
        raw: result,
        error: {
          status: 503,
          code: 'provider_unavailable',
          message: `akash/${cat.alias} failed (${result.reason}). Set allow_fallback or retry.`,
        },
      };
    }
  }

  // Optional multi-tier fallthrough (Web2 / other DePIN) when allowed.
  if (fb) {
    let providerConfigured = false;
    try {
      const handler = await getRouterHandler();
      providerConfigured = !!(handler && (
        handler.edgeCloudApiKey || handler.rapidApiKey || handler.mcpEndpoint ||
        handler.akashMnemonic || handler.renderApiKey || handler.awsAccessKeyId ||
        handler.openaiCompatKey || handler.anthropicApiKey || akashmlApiKey()
      ));
      const { ComputeRouter } = await import(
        '../../../packages/circuit-runtime/theta-inference/compute-router.js'
      );
      const router = ComputeRouter.fromHandler(handler);
      const routed = await router.route({
        serviceType: 0,
        requestBody: { model: cat.alias, messages, max_tokens, temperature },
        modelName: cat.id,
        gpuName: 'default',
      });
      if (routed.result) {
        return {
          content: extractContent(routed.result),
          provider: routed.result?._source || routed.source,
          mock: false,
          resolvedModel,
          raw: routed.result,
        };
      }
    } catch (err) {
      logger.warn({ err: err.message, model: resolvedModel }, 'OpenAI gateway: router error');
    }

    const reason = providerConfigured
      ? 'Provider(s) configured but returned no result (likely transient capacity). Retry shortly.'
      : 'No DePIN provider is configured (set THETA_EDGECLOUD_API_KEY, AKASHML_API_KEY, or a fallback tier).';
    const content = `[Chit mock] ${reason} Echoing prompt: ${messagesToText(messages).slice(0, 200)}`;
    return { content, provider: 'mock', mock: true, resolvedModel, raw: { mock: true, providerConfigured, reason } };
  }

  return {
    content: '',
    provider: 'none',
    mock: true,
    resolvedModel,
    raw: {},
    error: {
      status: 503,
      code: 'provider_unavailable',
      message: 'Preferred hub unavailable and allow_fallback=false',
    },
  };
}

async function runImageInference({ model, prompt, allowFallback: fb }) {
  const { models } = await getHubCatalog();
  let modelId = model || 'xfuel/auto';
  if (modelId === 'xfuel/auto' || modelId === 'auto' || modelId === 'xfuel-auto') {
    const img = models.find((m) => m.modality === 'image');
    if (!img) {
      return { error: { status: 404, code: 'model_not_found', message: 'No image models in catalog' } };
    }
    modelId = img.id;
  }
  const resolved = resolveCatalogModel(modelId, models);
  if (!resolved.ok) {
    return {
      error: {
        status: 404,
        code: resolved.reason,
        message: resolved.hint || `Model '${resolved.requested}' not found`,
      },
    };
  }
  if (resolved.model.modality !== 'image') {
    return {
      error: {
        status: 400,
        code: 'modality_mismatch',
        message: `${resolved.model.id} is modality=${resolved.model.modality}, expected image`,
      },
    };
  }
  const cat = resolved.model;
  // This model/hub is chat-only — cannot generate images.
  if (cat.hub === 'akash') {
    return {
      error: {
        status: 400,
        code: 'modality_unsupported',
        message: `${cat.id} is chat-only and cannot generate images. GET /v1/models?modality=image for image models.`,
      },
      resolvedModel: cat.id,
    };
  }
  if (!process.env.THETA_EDGECLOUD_API_KEY) {
    if (!fb) {
      return { error: { status: 503, code: 'provider_unavailable', message: 'THETA_EDGECLOUD_API_KEY not set' } };
    }
    return {
      mock: true,
      provider: 'mock',
      resolvedModel: cat.id,
      url: null,
      raw: { reason: 'missing_api_key' },
    };
  }
  const result = await inferEdgeCloud({
    alias: cat.alias,
    prediction: cat.default_prediction,
    input: imageInputFromPrompt({ prompt }),
  });
  if (!result.ok) {
    if (!fb) {
      return {
        error: {
          status: 503,
          code: 'provider_unavailable',
          message: `${cat.id} failed (${result.reason})`,
        },
        resolvedModel: cat.id,
      };
    }
    return { mock: true, provider: 'mock', resolvedModel: cat.id, url: null, raw: result };
  }
  return {
    mock: false,
    provider: 'theta-edgecloud',
    resolvedModel: cat.id,
    url: extractImageUrl(result.output),
    raw: result,
  };
}

async function runTranscriptionInference({ model, audioUrl, allowFallback: fb }) {
  const { models } = await getHubCatalog();
  let modelId = model || 'theta/whisper';
  if (modelId === 'xfuel/auto' || modelId === 'auto') {
    const w = models.find((m) => m.modality === 'audio') || models.find((m) => m.alias === 'whisper');
    if (!w) return { error: { status: 404, code: 'model_not_found', message: 'No audio models in catalog' } };
    modelId = w.id;
  }
  const resolved = resolveCatalogModel(modelId, models);
  if (!resolved.ok) {
    return {
      error: {
        status: 404,
        code: resolved.reason,
        message: resolved.hint || `Model '${resolved.requested}' not found`,
      },
    };
  }
  const cat = resolved.model;
  if (cat.modality !== 'audio') {
    return {
      error: {
        status: 400,
        code: 'modality_mismatch',
        message: `${cat.id} is modality=${cat.modality}, expected audio`,
      },
    };
  }
  if (!audioUrl) {
    return { error: { status: 400, code: 'invalid_request', message: 'audio_url (or file URL) is required' } };
  }
  // This model/hub is chat-only — cannot transcribe audio.
  if (cat.hub === 'akash') {
    return {
      error: {
        status: 400,
        code: 'modality_unsupported',
        message: `${cat.id} is chat-only and cannot transcribe audio. GET /v1/models?modality=audio for audio models.`,
      },
    };
  }
  if (!process.env.THETA_EDGECLOUD_API_KEY) {
    if (!fb) {
      return { error: { status: 503, code: 'provider_unavailable', message: 'THETA_EDGECLOUD_API_KEY not set' } };
    }
    return {
      mock: true,
      provider: 'mock',
      resolvedModel: cat.id,
      text: '[Chit mock] transcription — set THETA_EDGECLOUD_API_KEY',
      raw: {},
    };
  }
  const result = await inferEdgeCloud({
    alias: cat.alias,
    prediction: cat.default_prediction,
    input: audioInputFromUrl(audioUrl),
  });
  if (!result.ok) {
    if (!fb) {
      return {
        error: {
          status: 503,
          code: 'provider_unavailable',
          message: `${cat.id} failed (${result.reason})`,
        },
      };
    }
    return { mock: true, provider: 'mock', resolvedModel: cat.id, text: `[mock] ${result.reason}`, raw: result };
  }
  return {
    mock: false,
    provider: 'theta-edgecloud',
    resolvedModel: cat.id,
    text: extractTextOutput(result.output),
    raw: result,
  };
}

/**
 * Say what actually happened, and what would actually help.
 *
 * "Retry" was the wrong advice for the common case: EdgeCloud returns 409 when a
 * service has no worker, and retrying a model with zero published capacity fails
 * the same way every time. When the catalogue already told us there is nothing
 * running, say so and point at a model that is up.
 */
function thetaFailureMessage(cat, reason) {
  if (reason === 'http_409' && typeof cat?.capacity === 'number' && cat.capacity <= 0) {
    return `theta/${cat.alias} has no workers running on Theta EdgeCloud, so it cannot serve `
      + 'this request. This is provider capacity, not an error in your call — retrying will not '
      + 'help. Use xfuel/auto to route to a model that is up, set allow_fallback, or check '
      + '`availability` on GET /v1/models.';
  }
  if (reason === 'http_409') {
    return `theta/${cat.alias} returned 409 after retries — the service is warming or has no `
      + 'worker free. Set allow_fallback to route elsewhere, or retry shortly.';
  }
  return `theta/${cat.alias} failed (${reason}). Set allow_fallback or retry.`;
}

/** Pull assistant text out of the router's OpenAI-shaped result. */
function extractContent(result) {
  if (!result) return '';
  const choice = result.choices?.[0];
  const msg = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof msg === 'string') return msg;
  // Non-OpenAI tiers use provider-specific envelopes; share the EdgeCloud unwrapper
  // so a partner never sees a JSON blob as assistant content.
  return extractTextOutput(result.output ?? result);
}

// ─── Task registration + async proof (reuses AIListener machinery) ────────────

/**
 * Register a completed inference task so `/task-status`, `/prove-result` and the
 * webhook dispatcher work, then kick off the SP1 settlement proof (async,
 * non-fatal — identical to the M2M `/task-request` path).
 *
 * @returns {{ taskId: string, proverConfigured: boolean }}
 */
function startTaskProof(task, proveAllowed) {
  if (!task) return;
  task.intent = task.intent || {};
  task.intent.proveAllowed = !!proveAllowed;
  if (!proveAllowed) return;
  let aiListener;
  try {
    aiListener = getAIListener();
  } catch {
    return;
  }
  if (!getSP1Prover() || typeof aiListener._generateTaskProof !== 'function') return;
  aiListener._generateTaskProof(task).catch((err) => {
    logger.warn({ err: err.message, taskId: task.taskId }, 'OpenAI gateway: async proof failed (non-fatal)');
  });
}

function registerTaskAndProve({
  taskId: providedTaskId,
  model, messages, content, provider, toolCalls = null,
  proveAllowed = true, apiKeyHash = null, privateSpend = false,
  usage = null, payment = null, deferProve = false,
  status = 'completed', failureReason = null,
}) {
  const taskId = providedTaskId || `xfuel-${crypto.randomUUID()}`;
  let aiListener = null;
  try {
    aiListener = getAIListener();
  } catch {
    // Listener not initialised (e.g. isolated tests). Still build the task — the
    // receipt is signed from it, and a receipt that silently loses its signature
    // when a subsystem is absent is the failure mode this path already had.
  }

  const inputHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(messages)));
  // On a tool call the answer *is* the tool call and `content` is empty, so
  // hashing content alone would attest an empty output for the response the
  // caller actually acts on.
  const outputHash = ethers.keccak256(ethers.toUtf8Bytes(
    toolCalls ? JSON.stringify({ content: content || null, tool_calls: toolCalls }) : (content ?? ''),
  ));
  // Gross is what x402 actually settled when the call was paid. Never the
  // notional accounting amount — a receipt may only report money that moved.
  const grossAmount = payment?.amount || GATEWAY_TASK_AMOUNT;
  const { feeAmount, netAmount, feeBps } = calcFee(grossAmount);

  const task = {
    taskId,
    intent: {
      type: 'inference_request',
      sender: 'openai-gateway',
      amount: grossAmount,
      modelId: model,
      inputHash,
      chain: 'base',
      proofSystem: 'sp1',
      paymentRail: payment ? 'usdc' : 'unmetered',
      paymentRef: payment?.ref || null,
      proveAllowed, // cost gate: false → settle + signed receipt, skip SP1 proof
    },
    meta: {
      chain: 'base',
      txHash: `gateway-${taskId}`,
      height: 0,
      source: 'openai-gateway',
      provider,
      apiKeyHash: apiKeyHash || null,
      payerWallet: payment?.payer || null,
      privateSpend: !!privateSpend,
      privacyMode: privateSpend ? 'vendor_blind' : null,
      ...(failureReason ? { failureReason } : {}),
    },
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    feeAmount,
    netAmount,
    feeBps,
    sp1Proof: null,
    // Token counts belong on the task, not only in the HTTP response — /stats
    // aggregates from the durable snapshots, and /v1 is the busiest surface.
    usage,
    outputHash,
    result: { provider, outputHash, content_hash: outputHash, usage },
    callbackUrl: null,
    callbackSecret: null,
  };

  if (!aiListener) return { taskId, proverConfigured: false, proveAllowed, task };

  aiListener.activeTasks.set(taskId, task);

  const proverConfigured = !!getSP1Prover();
  if (!deferProve) startTaskProof(task, proveAllowed);

  return { taskId, proverConfigured, proveAllowed, task };
}

/**
 * Measure what a `/v1` call actually cost us, and burn it against the float.
 *
 * `/task-request` has always done this (`_reconcileProviderCogs` in ai-listener);
 * `/v1` never did. So the busiest surface spent real provider money with no
 * record of it anywhere — the float balance overstated by however much unmetered
 * traffic had served, and "what does the free tier cost us" was unanswerable.
 *
 * Mutates `task.meta` before the receipt is built, so `provider_cogs` appears on
 * the `/v1` receipt exactly as on the M2M one. `/v1` stays free (ADR 0006), so
 * the signed cost-plus fields on the paid path (`provider_cogs.actual`,
 * `payment.platform_fee`) are not the product here — `route.provider` still
 * resolves from `task.result.provider` before the COGS record is consulted.
 *
 * @returns {Promise<bigint>} measured COGS in USDC base units; `0n` when the
 *   model has no published rate, in which case nothing is burned and the free
 *   allowance is not charged — under-counting rather than inventing a number.
 */
async function accountForCogs({ task, modelId, usage, provider }) {
  let measured = null;
  try {
    const m = await measureCogs({ modelId, usage });
    if (m.basis === 'measured') measured = m.amount;
  } catch (err) {
    logger.warn({ err: err.message, taskId: task?.taskId }, 'openai-gateway: COGS measurement failed');
  }

  try {
    const { provider: providerId, record } = getFloatManager().reconcileAfterServe({
      actualProvider: provider,
      // `/v1` does not quote, so there is no pre-serve estimate to reconcile
      // against. Measured tokens are the only honest basis here.
      estimated: 0n,
      measured,
    });
    if (task?.meta && record) {
      task.meta.providerCogs = record;
      task.meta.provider = providerId || record.provider;
    }
  } catch (err) {
    logger.error({ err: err.message, taskId: task?.taskId }, 'openai-gateway: COGS burn failed');
  }

  return measured ?? 0n;
}

// ─── Verification receipt ─────────────────────────────────────────────────────

/**
 * The `/v1` receipt.
 *
 * This used to be a hand-rolled object with **no signature field at all**, so the
 * tamper-evident receipt that is the entire product did not exist on the busiest
 * surface — while an inline `xfuel` block that looked authoritative was returned
 * on every call. It is now the canonical receipt from `receipt.js`, signed with
 * the same key over the same canonical payload, with the `/v1` presentation
 * fields layered on top.
 *
 * One signature per task, not two: the object returned here and the one at
 * `/receipt/:task_id` are built from the same task and verify identically, so an
 * SDK verifier does not need to know which surface a receipt came from. Only
 * unsigned presentation fields are added after signing — never a field in
 * `canonicalSignedPayload`.
 */
function buildReceipt({
  task, taskId, provider, mock, proverConfigured, proveAllowed = true, mockReason,
  baseUrl = '', privateSpend = false, payment = null, requestedModel = null, resolvedModel = null,
  reqHost = null,
}) {
  // pending  → proof generating; unavailable → no prover; gated → cost-gated for
  // this key (signed receipt only); skipped → mock response (nothing to prove).
  const proofStatus = mock
    ? 'skipped'
    : !proverConfigured
      ? 'unavailable'
      : !proveAllowed
        ? 'gated'
        : 'pending';
  const verifyUrl = buildVerifyUrl(baseUrl, taskId, { reqHost });

  const signed = task
    ? buildSignedReceipt(task, {
        baseUrl,
        signingSecret: config.receipts?.signingSecret,
        coSignerSecret: config.receipts?.coSignerSecret,
        viPolicy: config.verifiedInference,
        reqHost,
      })
    : { task_id: taskId, verify_url: verifyUrl, route: {}, payment: {}, proof: {} };

  return {
    ...signed,
    surface: 'openai-v1',
    compute: {
      provider,
      real: !mock,
      note: mock
        ? `Response is a mock (compute.real=false). ${mockReason || 'No DePIN provider configured — set a provider key to route real compute.'}`
        : `Routed to ${provider} via the Chit provider-agnostic router.`,
    },
    route: {
      ...signed.route,
      // What the caller asked for vs what served. `route.model` is signed and
      // stays as the canonical builder set it.
      requested: requestedModel || 'xfuel/auto',
      resolved: resolvedModel || signed.route?.model || null,
    },
    payment: {
      ...signed.payment,
      note: payment
        ? 'Settled over x402 before the request was served.'
        : 'This call was not charged. /v1 is metered only when X402_METER_V1 is on, and '
          + 'the demo key and X402_METER_V1_EXEMPT_KEYS stay exempt. Unpaid calls draw on a '
          + 'daily provider-cost allowance (FREE_TIER_DAILY_COGS_USD); see provider_cogs for '
          + 'what this one cost to serve.',
    },
    privacy: privateSpend
      ? {
          mode: 'vendor_blind',
          trust: 'gateway',
          notes: 'Provider saw gateway-pooled credentials, not end-customer identity. Not prompt-confidential.',
        }
      : signed.privacy ?? null,
    proof: {
      ...signed.proof,
      status: proofStatus, // pending | unavailable | gated | skipped
      ...(proofStatus === 'gated'
        ? { note: 'On-chain proof is cost-gated for this key. Signed receipt above stands; request proving access to generate an SP1 settlement proof.' }
        : {}),
      links: {
        status: `/task-status?task_id=${taskId}`,
        proof: `/prove-result?task_id=${taskId}`,
        receipt: verifyUrl,
      },
    },
  };
}

function setReceiptHeaders(res, receipt) {
  res.setHeader('x-xfuel-task-id', receipt.task_id);
  if (receipt.compute?.provider) res.setHeader('x-xfuel-provider', receipt.compute.provider);
  if (receipt.compute) res.setHeader('x-xfuel-compute-real', String(receipt.compute.real));
  res.setHeader('x-xfuel-payment-rail', receipt.payment.rail);
  res.setHeader('x-xfuel-proof-status', receipt.proof.status);
  res.setHeader('x-xfuel-proof-url', receipt.proof.links.proof);
  if (receipt.verify_url) res.setHeader('x-xfuel-verify-url', receipt.verify_url);
  if (receipt.agent_id != null) res.setHeader('x-xfuel-agent-id', String(receipt.agent_id));
}

/**
 * On collected settle: append hub/model/amount under a bookable agent_id.
 * Session is possession for GET|POST book — returned once here, not on public GET /receipt.
 * Do not wait for POST /v1/agents/register. Reuse agent_id when session is presented.
 */
function withBookSpend(receipt, { ledger, registry, agentId = null } = {}) {
  if (!ledger || !registry || !receipt?.payment?.collected || !receipt?.payment?.ref) {
    return receipt;
  }
  try {
    const recorded = recordCollectedSpend(receipt, { ledger, registry, agentId });
    if (!recorded.ok) {
      logger.warn(
        { reason: recorded.reason, code: recorded.code, taskId: receipt.task_id },
        'openai-gateway: UsageSettled append failed',
      );
      return receipt;
    }
    return {
      ...receipt,
      agent_id: recorded.agent_id,
      session: recorded.session,
      usage_settled: {
        agent_id: recorded.agent_id,
        hub: recorded.entry.hub,
        model: recorded.entry.model,
        amount: recorded.entry.amount,
      },
    };
  } catch (err) {
    logger.warn({ err: err.message, taskId: receipt.task_id }, 'openai-gateway: UsageSettled append threw');
    return receipt;
  }
}

/**
 * Register a paid /v1 task immediately after x402 settlement so a downstream
 * failure never leaves money moved with no durable task or public receipt.
 */
function registerPaidV1Shell({
  taskId, payment, model, messages, apiKeyHash, privateSpend,
}) {
  return registerTaskAndProve({
    taskId,
    model: model || 'xfuel/auto',
    messages,
    content: '',
    provider: null,
    proveAllowed: false,
    deferProve: true,
    apiKeyHash,
    privateSpend,
    payment,
    status: 'processing',
  });
}

/**
 * When inference or receipt assembly fails after USDC settled, still return a
 * signed receipt and a non-500 status. Never swallow collected payment as
 * a generic server_error without task_id / payment.ref.
 */
function respondPaidV1Failure(res, {
  task, taskId, payment, baseUrl, privateSpend = false,
  statusCode = 503, message, code = 'inference_failed',
  requestedModel = null, resolvedModel = null,
  ledger = null, registry = null, agentId = null, req = null,
}) {
  if (task) {
    task.status = 'failed';
    task.updatedAt = Date.now();
    if (message) task.meta = { ...(task.meta || {}), failureReason: message };
  }
  const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
  let receipt = buildReceipt({
    task,
    taskId,
    provider: task?.meta?.provider || 'none',
    mock: true,
    proverConfigured: !!getSP1Prover(),
    proveAllowed: false,
    mockReason: message,
    baseUrl,
    privateSpend,
    payment,
    requestedModel,
    resolvedModel,
    reqHost,
  });
  const reuseId = agentId ?? resolveBookableAgent(req, registry)?.agent_id ?? null;
  receipt = withBookSpend(receipt, { ledger, registry, agentId: reuseId });
  setReceiptHeaders(res, receipt);
  return res.status(statusCode).json({
    error: {
      message: message || 'Inference could not be completed after payment was collected.',
      type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
      code,
    },
    task_id: taskId,
    payment_ref: payment?.ref || null,
    xfuel: receipt,
  });
}

/**
 * Metering threw after handshake — respond without a bare 500 when we already
 * know payment moved (should be rare; settlement path is defensive).
 */
function respondMeteringFailure(res, { taskId, payment, task, baseUrl, privateSpend = false, ledger = null, registry = null, req = null }) {
  if (payment?.ref) {
    return respondPaidV1Failure(res, {
      task, taskId, payment, baseUrl, privateSpend,
      statusCode: 503,
      message: 'Payment was collected but the gateway could not finish processing this request.',
      code: 'post_settle_processing_failed',
      ledger,
      registry,
      req,
    });
  }
  return res.status(503).json({
    error: {
      message: 'Payment processing could not be completed. Retry with a fresh 402 challenge.',
      type: 'server_error',
      code: 'payment_processing_failed',
    },
    task_id: taskId,
  });
}

// ─── Bearer → X-API-Key shim ──────────────────────────────────────────────────

/**
 * OpenAI clients send `Authorization: Bearer <key>`; XFuel auth expects
 * `X-API-Key`. Map the bearer token onto x-api-key when the latter is absent so
 * a plain OpenAI client authenticates unchanged.
 */
function bearerToApiKey(req, _res, next) {
  if (!req.headers['x-api-key']) {
    const auth = req.headers['authorization'];
    if (auth && /^Bearer\s+/i.test(auth)) {
      req.headers['x-api-key'] = auth.replace(/^Bearer\s+/i, '').trim();
    }
  }
  next();
}

// ─── Error-shape normalizer ───────────────────────────────────────────────────

/** Map an HTTP status onto the OpenAI `error.type` vocabulary. */
function openAiErrorType(status) {
  if (status === 429) return 'rate_limit_error';
  if (status === 401 || status === 403) return 'authentication_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

/**
 * Shared M2M middleware (auth, rate limit, 404) answers with XFuel's flat shape
 * `{ error: "code", message }`. OpenAI client libraries expect the nested
 * `{ error: { message, type, code } }` and throw opaquely on anything else, so
 * rewrite flat error bodies for /v1 responses only.
 */
export function openAiErrorShape(_req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body.error === 'string') {
      return sendJson({
        error: {
          message: body.message || body.error,
          type: openAiErrorType(res.statusCode),
          code: body.error,
          param: null,
        },
      });
    }
    return sendJson(body);
  };
  next();
}

// ─── Route registration ───────────────────────────────────────────────────────

/**
 * Register the OpenAI-compatible routes on an Express app.
 *
 * @param {import('express').Express} app
 * @param {{ rateLimit: Function, authenticate: Function }} mw  shared middleware
 */
/**
 * Buyer-facing price for one catalogue row.
 *
 * `xfuel/auto` is quoted as unpriceable on purpose. It is an alias that resolves
 * per request — agent-shaped work goes to GLM-5.2, short completions to Llama —
 * and those differ by more than 10x. Publishing either number would be wrong for
 * roughly half of all traffic, and the rate card's own default row is the one
 * `xfuel/auto` never actually gets priced at (see `DEFAULT_RATE_CARD`).
 */
function priceForCatalogModel(m) {
  if (!m) return null;
  if (m.hub === 'xfuel') {
    const { provider_cost_per_million: _cost, ...base } = publishedPrice(null, null) || {};
    return {
      ...base,
      price_per_million: null,
      note: 'Alias — resolved to a concrete model per request on request shape, so the rate '
        + 'is whichever model serves. Call POST /task-quote, or name a hub model to see its '
        + 'price here.',
    };
  }
  return publishedPrice(m.id, rateForModel(m));
}

export function registerOpenAIRoutes(app, {
  rateLimit, authenticate, isAuthorised, ledger = null, registry = null,
} = {}) {
  // Base middleware chain for all /v1 routes (no auth — that's route-specific)
  const baseChain = [openAiErrorShape, bearerToApiKey, rateLimit].filter(Boolean);
  // Routes that require authentication use the full chain
  const authChain = [...baseChain, authenticate].filter(Boolean);

  // /v1/models is the seat catalog — public, no key. Images/audio stay keyed.
  // /v1/chat/completions + /a2a-message: NO auth — 402 for unauth; demo key skips payment
  app.use('/v1/models', ...baseChain);
  app.use('/v1/images', ...authChain);
  app.use('/v1/audio', ...authChain);
  app.use('/v1/chat', ...baseChain);

  const bookSpend = (receipt, req = null) => {
    const identity = resolveBookableAgent(req, registry);
    return withBookSpend(receipt, {
      ledger,
      registry,
      agentId: identity?.agent_id ?? null,
    });
  };

  // ── GET /v1/models ───────────────────────────────────────────────────────
  app.get('/v1/models', async (req, res) => {
    try {
      const modality = typeof req.query.modality === 'string' ? req.query.modality : null;
      const { models, source } = await getHubCatalog();
      const body = toOpenAIList(models, { modality, priceFor: priceForCatalogModel });
      res.setHeader('x-xfuel-catalog-source', source);
      res.json(body);
    } catch (err) {
      logger.error({ err: err.message }, 'GET /v1/models failed');
      res.status(500).json({
        error: { message: 'catalog unavailable', type: 'server_error', code: null },
      });
    }
  });

  // ── GET /v1/models/:id (supports hub/alias via two path segments) ───────────
  async function getModelById(req, res, id) {
    const { models } = await getHubCatalog();
    const resolved = resolveCatalogModel(id, models);
    if (!resolved.ok) {
      return res.status(400).json({
        error: {
          message: resolved.hint || `The model '${id}' does not exist`,
          type: 'invalid_request_error',
          code: resolved.reason || 'model_not_found',
          ...(resolved.available ? { available: resolved.available } : {}),
        },
      });
    }
    const m = resolved.model;
    const pricing = priceForCatalogModel(m);
    return res.json({
      id: m.id,
      object: 'model',
      created: m.created,
      owned_by: m.owned_by,
      hub: m.hub,
      alias: m.alias,
      name: m.name,
      modality: m.modality,
      default_prediction: m.default_prediction,
      ...(pricing ? { pricing } : {}),
    });
  }
  app.get('/v1/models/:hub/:alias', (req, res) => getModelById(req, res, `${req.params.hub}/${req.params.alias}`));
  app.get('/v1/models/:id', (req, res) => getModelById(req, res, req.params.id));

  async function maybeMeterUnauthChat(req, res, resourcePath = '/v1/chat/completions') {
    const { header: paymentHeader } = extractPaymentHeader(req);
    const taskId = `xfuel-${crypto.randomUUID()}`;
    let metering = { halted: false, payment: null };
    if (!paymentHeader) {
      metering = await meterV1Request(req, res, {
        taskId, isAuthorised, resourcePath, ledger, registry,
      });
      if (metering.meteringError) {
        return respondMeteringFailure(res, {
          taskId,
          payment: metering.payment,
          task: null,
          baseUrl: baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts),
          ledger,
          registry,
          req,
        });
      }
    }
    return { halted: metering.halted, taskId, metering, paymentHeader };
  }

  /**
   * Shared paid-chat handler for POST /v1/chat/completions and POST /a2a-message.
   * Same floor, rails, receipt, and UsageSettled row — only the 402 resource URL differs.
   */
  async function handlePaidChatPost(req, res, resourcePath = '/v1/chat/completions') {
    // Unauth probes (no payment) must 402 before body validation so x402scan
    // can list this route. A payment header still waits until after validation
    // so we never settle then 400 (Bankr 2026-08-21). Demo key xfuel-demo skips
    // payment via meteringExempt. GET uses the same helper so probes match POST {}.
    let { halted, taskId, metering, paymentHeader } = await maybeMeterUnauthChat(req, res, resourcePath);
    if (halted) return undefined;

    const { model, messages, max_tokens, temperature, stream, tools, tool_choice } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { message: '`messages` must be a non-empty array', type: 'invalid_request_error', param: 'messages', code: null },
      });
    }
    // A tool-calling conversation carries two shapes this used to reject outright:
    // an assistant turn with `content: null` and `tool_calls`, and a `role: "tool"`
    // turn carrying the result. Requiring a string `content` everywhere made a
    // multi-turn agent loop impossible to express.
    const badMsg = messages.find((m) => {
      if (!m || typeof m.role !== 'string') return true;
      if (typeof m.content === 'string') return false;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) return false;
      return true;
    });
    if (badMsg) {
      return res.status(400).json({
        error: {
          message: 'each message requires a string `role` and string `content` — except an '
            + 'assistant turn carrying `tool_calls`, whose content may be null',
          type: 'invalid_request_error',
          param: 'messages',
          code: null,
        },
      });
    }
    if (tools !== undefined && (!Array.isArray(tools) || tools.some((t) => t?.type !== 'function' || !t.function?.name))) {
      return res.status(400).json({
        error: { message: '`tools` must be an array of {type:"function", function:{name,...}}', type: 'invalid_request_error', param: 'tools', code: null },
      });
    }
    const wantsTools = Array.isArray(tools) && tools.length > 0;
    // Streaming a tool call means assembling `tool_calls` deltas across chunks, and
    // streamCompletion re-chunks a finished string. Emitting the prose path here
    // would hand back a plausible-looking answer with the tool call missing.
    if (wantsTools && stream) {
      return res.status(400).json({
        error: {
          message: 'streaming with `tools` is not supported yet — retry with stream:false',
          type: 'invalid_request_error',
          param: 'stream',
          code: 'stream_tools_unsupported',
        },
      });
    }

    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const fb = allowFallback(req);
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts);
    const privateSpend = !!config.privateSpend?.enabled || isPrivateSpendSession(req, registry);
    const apiKeyHash = apiKeyHashFromReq(req);
    let paidTask = null;

    // Payment present: settle only after the body is valid (Bankr: don't settle then 400).
    if (paymentHeader) {
      metering = await meterV1Request(req, res, {
        taskId, isAuthorised, resourcePath, ledger, registry,
      });
      if (metering.meteringError) {
        return respondMeteringFailure(res, {
          taskId,
          payment: metering.payment,
          task: paidTask,
          baseUrl,
          privateSpend,
          ledger,
          registry,
          req,
        });
      }
      if (metering.halted) return undefined;
      if (metering.payment) {
        ({ task: paidTask } = registerPaidV1Shell({
          taskId,
          payment: metering.payment,
          model: model || 'xfuel/auto',
          messages,
          apiKeyHash,
          privateSpend,
        }));
      }
    }

    // A call that settled pays its own COGS; only unmetered traffic draws on the
    // free allowance (ADR 0006 — receipts are free, compute is not). Checked
    // before serving and charged after, so a caller can cross the line by at
    // most one call.
    const freeBucket = metering.payment ? null : freeTierBucket(req, apiKeyHashFromReq(req));
    if (freeBucket) {
      const allowance = checkFreeAllowance(freeBucket);
      if (!allowance.allowed) {
        const global = allowance.scope === 'global';
        logger.warn(
          {
            reqId: req.id,
            scope: allowance.scope,
            spentUsd: cogsUsd(allowance.spent),
            limitUsd: cogsUsd(allowance.limit),
            globalSpentUsd: cogsUsd(allowance.globalSpent),
            globalLimitUsd: cogsUsd(allowance.globalLimit),
          },
          'openai-gateway: free allowance exhausted',
        );
        // 402 rather than 429: retrying does not help before the reset, and the
        // resolution we actually want is a metered key. A plain OpenAI SDK treats
        // this as fatal and surfaces the message, which is the intent — this is a
        // deliberate wall, not backpressure.
        res.set('Retry-After', String(allowance.retryAfterSec));
        return res.status(402).json({
          error: {
            // Say which ceiling was hit. Telling a caller who has spent nothing
            // that they are over their own limit sends them looking for a fault
            // on their side that does not exist.
            message: global
              ? `The shared free tier is exhausted for today: $${cogsUsd(allowance.globalLimit)} of provider cost `
                + `across all free callers. It resets at ${allowance.resetAt}. A metered key is not subject to `
                + 'this ceiling — receipts are free either way.'
              : `Free allowance exhausted: $${cogsUsd(allowance.limit)} of provider cost today. `
                + `It resets at ${allowance.resetAt}. For uninterrupted access, use a metered key — `
                + 'receipts are free either way.',
            type: 'payment_required',
            code: global ? 'free_tier_capacity' : 'free_tier_exhausted',
          },
        });
      }
    }

    let inference;
    try {
      inference = await runChatInference({
        model: model || 'xfuel/auto',
        messages,
        max_tokens: clampMaxTokens(max_tokens),
        temperature,
        allowFallback: fb,
        cacheNs: cacheNamespace(apiKeyHash),
        tools: wantsTools ? tools : null,
        tool_choice: wantsTools ? tool_choice : null,
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /v1/chat/completions inference error');
      if (metering.payment) {
        return respondPaidV1Failure(res, {
          task: paidTask,
          taskId,
          payment: metering.payment,
          baseUrl,
          privateSpend,
          requestedModel: model,
          message: 'Inference failed after payment was collected.',
          code: 'inference_failed',
          ledger,
          registry,
          req,
        });
      }
      return res.status(500).json({
        error: { message: 'inference failed', type: 'server_error', code: null },
      });
    }

    if (inference.error) {
      if (metering.payment) {
        return respondPaidV1Failure(res, {
          task: paidTask,
          taskId,
          payment: metering.payment,
          baseUrl,
          privateSpend,
          statusCode: inference.error.status || 503,
          message: inference.error.message,
          code: inference.error.code || 'inference_failed',
          requestedModel: model,
          resolvedModel: inference.resolvedModel,
          ledger,
          registry,
          req,
        });
      }
      return res.status(inference.error.status || 400).json({
        error: {
          message: inference.error.message,
          type: 'invalid_request_error',
          code: inference.error.code,
        },
      });
    }

    const echoModel = inference.resolvedModel || model || 'xfuel/auto';
    const { content, provider, mock, toolCalls } = inference;

    // Prefer the provider's own usage. Estimating from visible text understates
    // reasoning models badly — they bill hidden reasoning tokens, so a 2-word answer
    // can cost 130+ completion tokens. Clients meter spend off this block, and the
    // float should reconcile against the same numbers the provider billed.
    const { source, ...counts } = normalizeUsage(inference.raw, { messages, output: content });
    const usage = { ...counts, xfuel_source: source };

    let task;
    let proverConfigured;
    if (paidTask) {
      task = paidTask;
      task.status = 'completed';
      task.updatedAt = Date.now();
      task.intent.modelId = echoModel;
      task.meta.provider = provider;
      task.outputHash = ethers.keccak256(ethers.toUtf8Bytes(
        toolCalls ? JSON.stringify({ content: content || null, tool_calls: toolCalls }) : (content ?? ''),
      ));
      task.result = {
        provider,
        outputHash: task.outputHash,
        content_hash: task.outputHash,
        usage,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      };
      task.usage = { ...counts, source };
      proverConfigured = !!getSP1Prover();
    } else {
      ({ proverConfigured, task } = registerTaskAndProve({
        taskId,
        model: echoModel,
        messages,
        content,
        toolCalls,
        provider,
        proveAllowed: false,
        deferProve: true,
        apiKeyHash,
        privateSpend,
        usage: { ...counts, source },
        payment: metering.payment,
      }));
    }

    // Must precede buildReceipt — the receipt reads provider_cogs off task.meta.
    // A mock cost us nothing, so it neither burns float nor spends the allowance.
    const cogs = mock ? 0n : await accountForCogs({ task, modelId: echoModel, usage: counts, provider });
    if (freeBucket) recordFreeSpend(freeBucket, cogs);
    const proveAllowed = settlementProofAllowed({
      apiKey: req.headers['x-api-key'],
      cogs,
      proofTier: req.body?.proof_tier ?? req.body?.xfuel?.proof_tier,
      minCogs: config.verifiedInference?.tier2MinCogs,
    });
    startTaskProof(task, proveAllowed);

    const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
    const receipt = bookSpend(buildReceipt({
      task, taskId, provider, mock, proverConfigured, proveAllowed,
      mockReason: inference.raw?.reason, baseUrl, privateSpend,
      payment: metering.payment,
      requestedModel: model, resolvedModel: echoModel,
      reqHost,
    }), req);

    setReceiptHeaders(res, receipt);

    if (stream) {
      return streamCompletion(res, { id, created, model: echoModel, content, receipt });
    }

    return res.json({
      id,
      object: 'chat.completion',
      created,
      model: echoModel,
      choices: [
        {
          index: 0,
          // OpenAI sends `content: null` alongside tool_calls, and clients branch
          // on it to decide whether to execute a tool or render text.
          message: toolCalls
            ? { role: 'assistant', content: content || null, tool_calls: toolCalls }
            : { role: 'assistant', content },
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
        },
      ],
      usage,
      xfuel: receipt,
    });
  }

  // GET /v1/chat/completions — same unauth 402 as POST {}. Not a second receipt.
  app.get('/v1/chat/completions', async (req, res) => {
    const { halted } = await maybeMeterUnauthChat(req, res, '/v1/chat/completions');
    if (halted) return undefined;
    res.set('Allow', 'POST');
    return res.status(405).json({
      error: {
        message: 'Method not allowed. POST /v1/chat/completions with a JSON body.',
        type: 'invalid_request_error',
        code: 'method_not_allowed',
      },
    });
  });

  // Same handshake + fulfillment: /v1 door and A2A card URL. Same $0.01. No second door.
  app.post('/v1/chat/completions', (req, res) => handlePaidChatPost(req, res, '/v1/chat/completions'));
  app.post('/a2a-message', ...baseChain, (req, res) => handlePaidChatPost(req, res, '/a2a-message'));

  // ── POST /v1/responses ─────────────────────────────────────────────────────
  // Responses API drop-in: same x402 + signed receipt as /v1/chat/completions.
  // Accepts: { model, input (string | message[]), max_output_tokens }.
  // Returns: Responses-shaped output + XFuel receipt (hub, model, amount, verify_url).
  // Stateless one-shot — no store, previous_response_id, or server memory.

  /**
   * Convert Responses API `input` to chat-completions `messages`.
   * @param {string | Array} input - string prompt or array of message objects
   * @returns {Array} messages array for chat completions
   */
  function responsesInputToMessages(input) {
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }
    if (!Array.isArray(input)) return [];
    return input.map((m) => {
      if (typeof m === 'string') return { role: 'user', content: m };
      return { role: m.role || 'user', content: m.content || '' };
    });
  }

  /**
   * Convert chat completion content to Responses API output format.
   * @param {string} content - assistant response text
   * @param {Array|null} toolCalls - tool calls if any
   * @returns {{ output: Array, output_text: string }}
   */
  function toResponsesOutput(content, toolCalls = null) {
    const outputItems = [];
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        outputItems.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments || '{}',
        });
      }
    }
    outputItems.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: content || '' }],
    });
    return {
      output: outputItems,
      output_text: content || '',
    };
  }

  app.use('/v1/responses', ...baseChain);

  // GET /v1/responses — same unauth 402 as POST {}
  app.get('/v1/responses', async (req, res) => {
    const { halted } = await maybeMeterUnauthChat(req, res, '/v1/responses');
    if (halted) return undefined;
    res.set('Allow', 'POST');
    return res.status(405).json({
      error: {
        message: 'Method not allowed. POST /v1/responses with a JSON body.',
        type: 'invalid_request_error',
        code: 'method_not_allowed',
      },
    });
  });

  // POST /v1/responses — Responses API drop-in with x402 + signed receipt
  app.post('/v1/responses', async (req, res) => {
    // Unauth probes (no payment) must 402 before body validation
    let { halted, taskId, metering, paymentHeader } = await maybeMeterUnauthChat(req, res, '/v1/responses');
    if (halted) return undefined;

    const { model, input, max_output_tokens, temperature, tools, tool_choice } = req.body || {};

    // Convert input to messages
    const messages = responsesInputToMessages(input);
    if (!messages || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: '`input` is required and must be a non-empty string or array of messages',
          type: 'invalid_request_error',
          param: 'input',
          code: null,
        },
      });
    }

    // Validate message structure
    const badMsg = messages.find((m) => {
      if (!m || typeof m.role !== 'string') return true;
      if (typeof m.content === 'string') return false;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) return false;
      return true;
    });
    if (badMsg) {
      return res.status(400).json({
        error: {
          message: 'each message requires a string `role` and string `content`',
          type: 'invalid_request_error',
          param: 'input',
          code: null,
        },
      });
    }

    // Validate tools if provided
    if (tools !== undefined && (!Array.isArray(tools) || tools.some((t) => t?.type !== 'function' || !t.function?.name))) {
      return res.status(400).json({
        error: { message: '`tools` must be an array of {type:"function", function:{name,...}}', type: 'invalid_request_error', param: 'tools', code: null },
      });
    }
    const wantsTools = Array.isArray(tools) && tools.length > 0;

    const id = `resp_${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const fb = allowFallback(req);
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts);
    const privateSpend = !!config.privateSpend?.enabled || isPrivateSpendSession(req, registry);
    const apiKeyHash = apiKeyHashFromReq(req);
    let paidTask = null;

    // Payment present: settle only after the body is valid
    if (paymentHeader) {
      metering = await meterV1Request(req, res, {
        taskId, isAuthorised, resourcePath: '/v1/responses', ledger, registry,
      });
      if (metering.meteringError) {
        return respondMeteringFailure(res, {
          taskId,
          payment: metering.payment,
          task: paidTask,
          baseUrl,
          privateSpend,
          ledger,
          registry,
          req,
        });
      }
      if (metering.halted) return undefined;
      if (metering.payment) {
        ({ task: paidTask } = registerPaidV1Shell({
          taskId,
          payment: metering.payment,
          model: model || 'xfuel/auto',
          messages,
          apiKeyHash,
          privateSpend,
        }));
      }
    }

    // Free tier check for unmetered requests
    const freeBucket = metering.payment ? null : freeTierBucket(req, apiKeyHashFromReq(req));
    if (freeBucket) {
      const allowance = checkFreeAllowance(freeBucket);
      if (!allowance.allowed) {
        const global = allowance.scope === 'global';
        logger.warn(
          {
            reqId: req.id,
            scope: allowance.scope,
            spentUsd: cogsUsd(allowance.spent),
            limitUsd: cogsUsd(allowance.limit),
          },
          'openai-gateway: free allowance exhausted (responses)',
        );
        res.set('Retry-After', String(allowance.retryAfterSec));
        return res.status(402).json({
          error: {
            message: global
              ? `The shared free tier is exhausted for today. It resets at ${allowance.resetAt}. Use a metered key.`
              : `Free allowance exhausted. It resets at ${allowance.resetAt}. Use a metered key.`,
            type: 'payment_required',
            code: global ? 'free_tier_capacity' : 'free_tier_exhausted',
          },
        });
      }
    }

    let inference;
    try {
      inference = await runChatInference({
        model: model || 'xfuel/auto',
        messages,
        max_tokens: clampMaxTokens(max_output_tokens),
        temperature,
        allowFallback: fb,
        cacheNs: cacheNamespace(apiKeyHash),
        tools: wantsTools ? tools : null,
        tool_choice: wantsTools ? tool_choice : null,
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /v1/responses inference error');
      if (metering.payment) {
        return respondPaidV1Failure(res, {
          task: paidTask,
          taskId,
          payment: metering.payment,
          baseUrl,
          privateSpend,
          requestedModel: model,
          message: 'Inference failed after payment was collected.',
          code: 'inference_failed',
          ledger,
          registry,
          req,
        });
      }
      return res.status(500).json({
        error: { message: 'inference failed', type: 'server_error', code: null },
      });
    }

    if (inference.error) {
      if (metering.payment) {
        return respondPaidV1Failure(res, {
          task: paidTask,
          taskId,
          payment: metering.payment,
          baseUrl,
          privateSpend,
          statusCode: inference.error.status || 503,
          message: inference.error.message,
          code: inference.error.code || 'inference_failed',
          requestedModel: model,
          resolvedModel: inference.resolvedModel,
          ledger,
          registry,
          req,
        });
      }
      return res.status(inference.error.status || 400).json({
        error: {
          message: inference.error.message,
          type: 'invalid_request_error',
          code: inference.error.code,
        },
      });
    }

    const echoModel = inference.resolvedModel || model || 'xfuel/auto';
    const { content, provider, mock, toolCalls } = inference;

    // Usage from provider
    const { source, ...counts } = normalizeUsage(inference.raw, { messages, output: content });
    const usage = { ...counts, xfuel_source: source };

    let task;
    let proverConfigured;
    if (paidTask) {
      task = paidTask;
      task.status = 'completed';
      task.updatedAt = Date.now();
      task.intent.modelId = echoModel;
      task.meta.provider = provider;
      task.outputHash = ethers.keccak256(ethers.toUtf8Bytes(
        toolCalls ? JSON.stringify({ content: content || null, tool_calls: toolCalls }) : (content ?? ''),
      ));
      task.result = {
        provider,
        outputHash: task.outputHash,
        content_hash: task.outputHash,
        usage,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      };
      task.usage = { ...counts, source };
      proverConfigured = !!getSP1Prover();
    } else {
      ({ proverConfigured, task } = registerTaskAndProve({
        taskId,
        model: echoModel,
        messages,
        content,
        toolCalls,
        provider,
        proveAllowed: false,
        deferProve: true,
        apiKeyHash,
        privateSpend,
        usage: { ...counts, source },
        payment: metering.payment,
      }));
    }

    // Account for COGS
    const cogs = mock ? 0n : await accountForCogs({ task, modelId: echoModel, usage: counts, provider });
    if (freeBucket) recordFreeSpend(freeBucket, cogs);
    const proveAllowed = settlementProofAllowed({
      apiKey: req.headers['x-api-key'],
      cogs,
      proofTier: req.body?.proof_tier ?? req.body?.xfuel?.proof_tier,
      minCogs: config.verifiedInference?.tier2MinCogs,
    });
    startTaskProof(task, proveAllowed);

    const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
    const receipt = bookSpend(buildReceipt({
      task, taskId, provider, mock, proverConfigured, proveAllowed,
      mockReason: inference.raw?.reason, baseUrl, privateSpend,
      payment: metering.payment,
      requestedModel: model, resolvedModel: echoModel,
      reqHost,
    }), req);

    setReceiptHeaders(res, receipt);

    // Build Responses-shaped output
    const { output, output_text } = toResponsesOutput(content, toolCalls);

    return res.json({
      id,
      object: 'response',
      created_at: created,
      model: echoModel,
      status: 'completed',
      output,
      output_text,
      usage,
      xfuel: receipt,
    });
  });

  // ── POST /v1/images/generations ────────────────────────────────────────────
  app.post('/v1/images/generations', async (req, res) => {
    const { model, prompt, n } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        error: { message: '`prompt` is required', type: 'invalid_request_error', param: 'prompt', code: null },
      });
    }
    const fb = allowFallback(req);
    const inference = await runImageInference({ model, prompt, allowFallback: fb });
    if (inference.error) {
      return res.status(inference.error.status || 400).json({
        error: {
          message: inference.error.message,
          type: 'invalid_request_error',
          code: inference.error.code,
        },
      });
    }
    const proveAllowed = settlementProofAllowed({
      apiKey: req.headers['x-api-key'],
      proofTier: req.body?.proof_tier ?? req.body?.xfuel?.proof_tier,
      minCogs: config.verifiedInference?.tier2MinCogs,
    });
    const privateSpend = !!config.privateSpend?.enabled || isPrivateSpendSession(req, registry);
    const content = inference.url || JSON.stringify(inference.raw?.output || {});
    const { taskId, proverConfigured, task } = registerTaskAndProve({
      model: inference.resolvedModel,
      messages: [{ role: 'user', content: prompt }],
      content,
      provider: inference.provider,
      proveAllowed,
      apiKeyHash: apiKeyHashFromReq(req),
      privateSpend,
    });
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts);
    const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
    const receipt = buildReceipt({
      task,
      taskId,
      provider: inference.provider,
      mock: !!inference.mock,
      proverConfigured,
      proveAllowed,
      baseUrl,
      privateSpend,
      requestedModel: model,
      resolvedModel: inference.resolvedModel,
      reqHost,
    });
    setReceiptHeaders(res, receipt);

    const count = Math.min(Math.max(Number(n) || 1, 1), 4);
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push(inference.url
        ? { url: inference.url, revised_prompt: prompt }
        : { url: '', b64_json: null, revised_prompt: prompt });
    }
    return res.json({
      created: Math.floor(Date.now() / 1000),
      data,
      model: inference.resolvedModel,
      xfuel: receipt,
    });
  });

  // ── POST /v1/audio/transcriptions ──────────────────────────────────────────
  // JSON body (v0): { model, audio_url } — multipart file upload can follow.
  app.post('/v1/audio/transcriptions', async (req, res) => {
    const body = req.body || {};
    const model = body.model;
    const audioUrl = body.audio_url || body.file || body.audio_filename;
    const fb = allowFallback(req);
    const inference = await runTranscriptionInference({ model, audioUrl, allowFallback: fb });
    if (inference.error) {
      return res.status(inference.error.status || 400).json({
        error: {
          message: inference.error.message,
          type: 'invalid_request_error',
          code: inference.error.code,
        },
      });
    }
    const proveAllowed = settlementProofAllowed({
      apiKey: req.headers['x-api-key'],
      proofTier: req.body?.proof_tier ?? req.body?.xfuel?.proof_tier,
      minCogs: config.verifiedInference?.tier2MinCogs,
    });
    const privateSpend = !!config.privateSpend?.enabled || isPrivateSpendSession(req, registry);
    const { taskId, proverConfigured, task } = registerTaskAndProve({
      model: inference.resolvedModel,
      messages: [{ role: 'user', content: String(audioUrl) }],
      content: inference.text || '',
      provider: inference.provider,
      proveAllowed,
      apiKeyHash: apiKeyHashFromReq(req),
      privateSpend,
    });
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl, config.service.publicHosts);
    const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
    const receipt = buildReceipt({
      task,
      taskId,
      provider: inference.provider,
      mock: !!inference.mock,
      proverConfigured,
      proveAllowed,
      baseUrl,
      privateSpend,
      requestedModel: model || 'theta/whisper',
      resolvedModel: inference.resolvedModel,
      reqHost,
    });
    setReceiptHeaders(res, receipt);
    return res.json({
      text: inference.text || '',
      model: inference.resolvedModel,
      xfuel: receipt,
    });
  });
}

// ─── SSE streaming ─────────────────────────────────────────────────────────────

/**
 * Stream a (already-computed) completion as OpenAI-style SSE chunks. Phase 1
 * chunks the full text for compatibility; true provider-token streaming is a
 * follow-up. The verification receipt is emitted as a trailing `xfuel.receipt`
 * event (and in the response headers) before `[DONE]`.
 */
function streamCompletion(res, { id, created, model, content, receipt }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const base = { id, object: 'chat.completion.chunk', created, model };
  const send = (choices) => res.write(`data: ${JSON.stringify({ ...base, choices })}\n\n`);

  // 1) role delta
  send([{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]);

  // 2) content deltas (chunk on whitespace for a natural cadence)
  const pieces = content.match(/\S+\s*/g) || [content];
  for (const piece of pieces) {
    send([{ index: 0, delta: { content: piece }, finish_reason: null }]);
  }

  // 3) finish
  send([{ index: 0, delta: {}, finish_reason: 'stop' }]);

  // 4) XFuel receipt (custom event; ignored by strict OpenAI clients, headers still carry it)
  res.write(`event: xfuel.receipt\ndata: ${JSON.stringify(receipt)}\n\n`);

  res.write('data: [DONE]\n\n');
  res.end();
}

export default registerOpenAIRoutes;
