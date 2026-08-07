import crypto from 'crypto';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { getAIListener } from './ai-listener.js';
import { getSP1Prover } from './sp1-prover-client.js';
import { proveAllowedForKey } from './prove-gate.js';
import { buildVerifyUrl, baseUrlFromReq } from './receipt.js';
import { apiKeyHashFromReq } from './buyer-attr.js';
import { getHubCatalog, resolveCatalogModel, toOpenAIList } from './hub-catalog.js';
import {
  inferEdgeCloud,
  chatInputFromMessages,
  imageInputFromPrompt,
  audioInputFromUrl,
  extractTextOutput,
  extractImageUrl,
} from './edgecloud-infer.js';

/**
 * XFuel OpenAI-compatible gateway.
 *
 *   GET  /v1/models              → live hub catalog (Theta /service/list + …)
 *   GET  /v1/models/:id          → retrieve one model
 *   POST /v1/chat/completions    → chat (+ receipt)
 *   POST /v1/images/generations  → image (+ receipt)
 *   POST /v1/audio/transcriptions → STT (+ receipt)
 *
 * Model ids are hub-prefixed (theta/qwen3). No silent Llama→Qwen remap.
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
const GATEWAY_TASK_AMOUNT = process.env.OPENAI_GATEWAY_TASK_AMOUNT || '10000';

/** Hard cap on max_tokens (0 = uncapped). Set on the hosted demo to gate spend. */
const MAX_TOKENS_CAP = parseInt(process.env.OPENAI_GATEWAY_MAX_TOKENS_CAP, 10) || 0;

/** Clamp a requested max_tokens to the configured cap (if any). */
function clampMaxTokens(requested) {
  if (MAX_TOKENS_CAP <= 0) return requested;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return MAX_TOKENS_CAP;
  return Math.min(n, MAX_TOKENS_CAP);
}

function calcFee(grossAmount, feeBps = GATEWAY_FEE_BPS) {
  const gross = BigInt(grossAmount);
  const bps = BigInt(Math.min(Math.max(feeBps, 50), 100));
  const fee = (gross * bps) / FEE_DENOMINATOR;
  return { feeAmount: fee.toString(), netAmount: (gross - fee).toString(), feeBps: Number(bps) };
}

// ─── Token estimate (rough — ~4 chars/token; good enough for usage fields) ────

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function messagesToText(messages) {
  return messages.map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
}

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
 * Chat inference: resolve catalog model → Theta EdgeCloud when hub=theta;
 * optional ComputeRouter fallthrough when allowFallback.
 *
 * @returns {Promise<{ content: string, provider: string, mock: boolean, resolvedModel: string, raw: any, error?: object }>}
 */
async function runChatInference({ model, messages, max_tokens, temperature, allowFallback: fb }) {
  const { models } = await getHubCatalog();
  const resolved = resolveCatalogModel(model, models, { modality: 'chat' });
  if (!resolved.ok) {
    return {
      content: '',
      provider: 'none',
      mock: true,
      resolvedModel: resolved.requested,
      raw: resolved,
      error: {
        status: resolved.reason === 'model_retired' || resolved.reason === 'model_not_found' ? 404 : 400,
        code: resolved.reason,
        message: resolved.hint || `Model '${resolved.requested}' is not available (${resolved.reason})`,
      },
    };
  }

  const cat = resolved.model;
  const resolvedModel = cat.id;

  // Prefer direct EdgeCloud for theta hub (honest alias).
  if (cat.hub === 'theta' && process.env.THETA_EDGECLOUD_API_KEY) {
    const result = await inferEdgeCloud({
      alias: cat.alias,
      prediction: cat.default_prediction,
      input: chatInputFromMessages({ messages, max_tokens, temperature }),
    });
    if (result.ok) {
      return {
        content: extractTextOutput(result.output),
        provider: 'theta-edgecloud',
        mock: false,
        resolvedModel,
        raw: result,
      };
    }
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
          message: `theta/${cat.alias} failed (${result.reason}). Set allow_fallback or retry.`,
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
        handler.openaiCompatKey || handler.anthropicApiKey
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
      : 'No DePIN provider is configured (set THETA_EDGECLOUD_API_KEY or a fallback tier).';
    const content = `[XFuel mock] ${reason} Echoing prompt: ${messagesToText(messages).slice(0, 200)}`;
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
  if (!process.env.THETA_EDGECLOUD_API_KEY) {
    if (!fb) {
      return { error: { status: 503, code: 'provider_unavailable', message: 'THETA_EDGECLOUD_API_KEY not set' } };
    }
    return {
      mock: true,
      provider: 'mock',
      resolvedModel: cat.id,
      text: '[XFuel mock] transcription — set THETA_EDGECLOUD_API_KEY',
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

/** Pull assistant text out of the router's OpenAI-shaped result. */
function extractContent(result) {
  if (!result) return '';
  const choice = result.choices?.[0];
  const msg = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof msg === 'string') return msg;
  if (typeof result.output === 'string') return result.output;
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// ─── Task registration + async proof (reuses AIListener machinery) ────────────

/**
 * Register a completed inference task so `/task-status`, `/prove-result` and the
 * webhook dispatcher work, then kick off the SP1 settlement proof (async,
 * non-fatal — identical to the M2M `/task-request` path).
 *
 * @returns {{ taskId: string, proverConfigured: boolean }}
 */
function registerTaskAndProve({ model, messages, content, provider, proveAllowed = true, apiKeyHash = null, privateSpend = false }) {
  let aiListener;
  try {
    aiListener = getAIListener();
  } catch {
    // Listener not initialised (e.g. isolated tests) — skip settlement wiring.
    return { taskId: `openai-${crypto.randomUUID()}`, proverConfigured: false, proveAllowed };
  }

  const taskId = `openai-${crypto.randomUUID()}`;
  const inputHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(messages)));
  const outputHash = ethers.keccak256(ethers.toUtf8Bytes(content ?? ''));
  const { feeAmount, netAmount, feeBps } = calcFee(GATEWAY_TASK_AMOUNT);

  const task = {
    taskId,
    intent: {
      type: 'inference_request',
      sender: 'openai-gateway',
      amount: GATEWAY_TASK_AMOUNT,
      modelId: model,
      inputHash,
      chain: 'base',
      proofSystem: 'sp1',
      paymentRail: 'unmetered', // OpenAI-compat path is not x402-metered in Phase 1
      paymentRef: null,
      proveAllowed, // cost gate: false → settle + signed receipt, skip SP1 proof
    },
    meta: {
      chain: 'base',
      txHash: `openai-${taskId}`,
      height: 0,
      source: 'openai-gateway',
      provider,
      apiKeyHash: apiKeyHash || null,
      privateSpend: !!privateSpend,
      privacyMode: privateSpend ? 'vendor_blind' : null,
    },
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    feeAmount,
    netAmount,
    feeBps,
    sp1Proof: null,
    result: { provider, outputHash, content_hash: outputHash },
    callbackUrl: null,
    callbackSecret: null,
  };

  aiListener.activeTasks.set(taskId, task);

  const proverConfigured = !!getSP1Prover();
  if (proverConfigured && proveAllowed && typeof aiListener._generateTaskProof === 'function') {
    aiListener._generateTaskProof(task).catch((err) => {
      logger.warn({ err: err.message, taskId }, 'OpenAI gateway: async proof failed (non-fatal)');
    });
  }

  return { taskId, proverConfigured, proveAllowed };
}

// ─── Verification receipt ─────────────────────────────────────────────────────

function buildReceipt({ taskId, provider, mock, proverConfigured, proveAllowed = true, mockReason, baseUrl = '', privateSpend = false }) {
  // pending  → proof generating; unavailable → no prover; gated → cost-gated for
  // this key (signed receipt only); skipped → mock response (nothing to prove).
  const proofStatus = mock
    ? 'skipped'
    : !proverConfigured
      ? 'unavailable'
      : !proveAllowed
        ? 'gated'
        : 'pending';
  const verifyUrl = buildVerifyUrl(baseUrl, taskId);
  return {
    task_id: taskId,
    // Canonical shareable proof link (public receipt page — same across all surfaces).
    verify_url: verifyUrl,
    compute: {
      provider,
      real: !mock,
      note: mock
        ? `Response is a mock (compute.real=false). ${mockReason || 'No DePIN provider configured — set a provider key to route real compute.'}`
        : `Routed to ${provider} via the XFuel provider-agnostic router.`,
    },
    payment: {
      rail: 'unmetered',
      note: 'The OpenAI-compatible path is unmetered in Phase 1. Use POST /task-request with payment.rail="usdc" for x402 settlement.',
    },
    privacy: privateSpend
      ? {
          mode: 'vendor_blind',
          trust: 'gateway',
          notes: 'Provider saw gateway-pooled credentials, not end-customer identity. Not prompt-confidential.',
        }
      : null,
    proof: {
      status: proofStatus, // pending | unavailable | gated | skipped
      system: 'sp1',
      attests: 'settlement metadata + commitment to the output hash (NOT inference correctness)',
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
  res.setHeader('x-xfuel-provider', receipt.compute.provider);
  res.setHeader('x-xfuel-compute-real', String(receipt.compute.real));
  res.setHeader('x-xfuel-payment-rail', receipt.payment.rail);
  res.setHeader('x-xfuel-proof-status', receipt.proof.status);
  res.setHeader('x-xfuel-proof-url', receipt.proof.links.proof);
  if (receipt.verify_url) res.setHeader('x-xfuel-verify-url', receipt.verify_url);
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

// ─── Route registration ───────────────────────────────────────────────────────

/**
 * Register the OpenAI-compatible routes on an Express app.
 *
 * @param {import('express').Express} app
 * @param {{ rateLimit: Function, authenticate: Function }} mw  shared middleware
 */
export function registerOpenAIRoutes(app, { rateLimit, authenticate } = {}) {
  const chain = [bearerToApiKey, rateLimit, authenticate].filter(Boolean);

  app.use('/v1', ...chain);

  // ── GET /v1/models ───────────────────────────────────────────────────────
  app.get('/v1/models', async (req, res) => {
    try {
      const modality = typeof req.query.modality === 'string' ? req.query.modality : null;
      const { models, source } = await getHubCatalog();
      const body = toOpenAIList(models, { modality });
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
      return res.status(404).json({
        error: {
          message: resolved.hint || `The model '${id}' does not exist`,
          type: 'invalid_request_error',
          code: resolved.reason || 'model_not_found',
        },
      });
    }
    const m = resolved.model;
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
    });
  }
  app.get('/v1/models/:hub/:alias', (req, res) => getModelById(req, res, `${req.params.hub}/${req.params.alias}`));
  app.get('/v1/models/:id', (req, res) => getModelById(req, res, req.params.id));

  // ── POST /v1/chat/completions ──────────────────────────────────────────────
  app.post('/v1/chat/completions', async (req, res) => {
    const { model, messages, max_tokens, temperature, stream } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { message: '`messages` must be a non-empty array', type: 'invalid_request_error', param: 'messages', code: null },
      });
    }
    const badMsg = messages.find((m) => !m || typeof m.role !== 'string' || typeof m.content !== 'string');
    if (badMsg) {
      return res.status(400).json({
        error: { message: 'each message requires a string `role` and string `content`', type: 'invalid_request_error', param: 'messages', code: null },
      });
    }

    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const fb = allowFallback(req);

    let inference;
    try {
      inference = await runChatInference({
        model: model || 'xfuel/auto',
        messages,
        max_tokens: clampMaxTokens(max_tokens),
        temperature,
        allowFallback: fb,
      });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /v1/chat/completions inference error');
      return res.status(500).json({
        error: { message: 'inference failed', type: 'server_error', code: null },
      });
    }

    if (inference.error) {
      return res.status(inference.error.status || 400).json({
        error: {
          message: inference.error.message,
          type: 'invalid_request_error',
          code: inference.error.code,
        },
      });
    }

    const echoModel = inference.resolvedModel || model || 'xfuel/auto';
    const { content, provider, mock } = inference;
    const proveAllowed = proveAllowedForKey(req.headers['x-api-key']);
    const privateSpend = !!config.privateSpend?.enabled;
    const { taskId, proverConfigured } = registerTaskAndProve({
      model: echoModel,
      messages,
      content,
      provider,
      proveAllowed,
      apiKeyHash: apiKeyHashFromReq(req),
      privateSpend,
    });
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
    const receipt = buildReceipt({
      taskId, provider, mock, proverConfigured, proveAllowed,
      mockReason: inference.raw?.reason, baseUrl, privateSpend,
    });
    receipt.route = { requested: model || 'xfuel/auto', resolved: echoModel };

    const promptTokens = estimateTokens(messagesToText(messages));
    const completionTokens = estimateTokens(content);

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
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
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
    const proveAllowed = proveAllowedForKey(req.headers['x-api-key']);
    const privateSpend = !!config.privateSpend?.enabled;
    const content = inference.url || JSON.stringify(inference.raw?.output || {});
    const { taskId, proverConfigured } = registerTaskAndProve({
      model: inference.resolvedModel,
      messages: [{ role: 'user', content: prompt }],
      content,
      provider: inference.provider,
      proveAllowed,
      apiKeyHash: apiKeyHashFromReq(req),
      privateSpend,
    });
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
    const receipt = buildReceipt({
      taskId,
      provider: inference.provider,
      mock: !!inference.mock,
      proverConfigured,
      proveAllowed,
      baseUrl,
      privateSpend,
    });
    receipt.route = { requested: model || 'xfuel/auto', resolved: inference.resolvedModel };
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
    const proveAllowed = proveAllowedForKey(req.headers['x-api-key']);
    const privateSpend = !!config.privateSpend?.enabled;
    const { taskId, proverConfigured } = registerTaskAndProve({
      model: inference.resolvedModel,
      messages: [{ role: 'user', content: String(audioUrl) }],
      content: inference.text || '',
      provider: inference.provider,
      proveAllowed,
      apiKeyHash: apiKeyHashFromReq(req),
      privateSpend,
    });
    const baseUrl = baseUrlFromReq(req, config.service.publicBaseUrl);
    const receipt = buildReceipt({
      taskId,
      provider: inference.provider,
      mock: !!inference.mock,
      proverConfigured,
      proveAllowed,
      baseUrl,
      privateSpend,
    });
    receipt.route = { requested: model || 'theta/whisper', resolved: inference.resolvedModel };
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
