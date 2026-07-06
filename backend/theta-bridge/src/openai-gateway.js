import crypto from 'crypto';
import { ethers } from 'ethers';
import config from './config.js';
import logger from './logger.js';
import { getAIListener } from './ai-listener.js';
import { getSP1Prover } from './sp1-prover-client.js';

/**
 * XFuel OpenAI-compatible gateway.
 *
 * Exposes the standard OpenAI surface so any agent framework (OpenAI SDK,
 * Vercel AI SDK, LangChain, LlamaIndex, Cursor/Claude via base-url override) can
 * use XFuel by swapping a single `baseURL` — no XFuel-specific integration.
 *
 *   GET  /v1/models              → list routable models
 *   GET  /v1/models/:id          → retrieve one model
 *   POST /v1/chat/completions    → run inference (streaming or not) + receipt
 *
 * Under the hood the request is routed through the 6-tier DePIN ComputeRouter
 * (real compute when provider keys are set; a clearly-labelled mock otherwise),
 * a task is registered in the AIListener so the existing `/task-status`,
 * `/prove-result` and webhook machinery keep working, and an SP1 settlement
 * proof is generated asynchronously (non-fatal, exactly like the M2M path).
 *
 * Honesty note (surfaced in the receipt): the SP1 proof attests settlement
 * metadata + a commitment to the output hash — NOT that the model executed the
 * inference correctly. The receipt reports `compute` (real vs mock) and
 * `proof.status`/`proof.attests` truthfully so adopters are never misled.
 */

// ─── Model catalogue ─────────────────────────────────────────────────────────

const DEFAULT_MODELS = ['llama-3-70b', 'xfuel-auto'];

/** Models the gateway advertises. Override with OPENAI_GATEWAY_MODELS (CSV). */
function modelIds() {
  const env = (process.env.OPENAI_GATEWAY_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return env.length ? env : DEFAULT_MODELS;
}

function modelObject(id) {
  return {
    id,
    object: 'model',
    created: 1_700_000_000,
    owned_by: 'xfuel',
  };
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
        '../../../circuits/theta-inference/theta-inference-handler.js'
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
 * Run a chat inference through the 6-tier ComputeRouter. Never throws on
 * provider issues — falls back to a clearly-labelled mock so the OpenAI
 * contract always resolves.
 *
 * @returns {Promise<{ content: string, provider: string, mock: boolean, raw: any }>}
 */
async function runChatInference({ model, messages, max_tokens, temperature }) {
  const modelName = !model || model === 'xfuel-auto' || model === 'auto' ? 'default-llm' : model;
  const requestBody = {
    model: modelName,
    messages,
    max_tokens: max_tokens ?? undefined,
    temperature: temperature ?? undefined,
  };

  let providerConfigured = false;
  try {
    const handler = await getRouterHandler();
    providerConfigured = !!(handler && (
      handler.edgeCloudApiKey || handler.rapidApiKey || handler.mcpEndpoint ||
      handler.akashMnemonic || handler.renderApiKey || handler.awsAccessKeyId
    ));
    const { ComputeRouter } = await import(
      '../../../circuits/theta-inference/compute-router.js'
    );
    const router = ComputeRouter.fromHandler(handler);
    // SERVICE_TYPES.LLM_INFERENCE === 0
    const routed = await router.route({ serviceType: 0, requestBody, modelName, gpuName: 'default' });
    if (routed.result) {
      return {
        content: extractContent(routed.result),
        provider: routed.source,
        mock: false,
        raw: routed.result,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message, model: modelName }, 'OpenAI gateway: router error — using mock');
  }

  // Soft failure → labelled mock. Be honest about WHY: a configured provider
  // that returns no result is almost always transient capacity (e.g. Theta
  // on-demand "no instances available"), not a missing key.
  const reason = providerConfigured
    ? 'Provider(s) configured but returned no result (likely transient capacity — e.g. Theta on-demand "no instances available"). Retry shortly.'
    : 'No DePIN provider is configured (set THETA_EDGECLOUD_API_KEY or a fallback tier).';
  const content = `[XFuel mock] ${reason} Echoing prompt: ${messagesToText(messages).slice(0, 200)}`;
  return { content, provider: 'mock', mock: true, raw: { mock: true, providerConfigured, reason } };
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
function registerTaskAndProve({ model, messages, content, provider }) {
  let aiListener;
  try {
    aiListener = getAIListener();
  } catch {
    // Listener not initialised (e.g. isolated tests) — skip settlement wiring.
    return { taskId: `openai-${crypto.randomUUID()}`, proverConfigured: false };
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
      chain: 'theta',
      proofSystem: 'sp1',
      paymentRail: 'unmetered', // OpenAI-compat path is not x402-metered in Phase 1
      paymentRef: null,
    },
    meta: { chain: 'theta', txHash: `openai-${taskId}`, height: 0, source: 'openai-gateway' },
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
  if (proverConfigured && typeof aiListener._generateTaskProof === 'function') {
    aiListener._generateTaskProof(task).catch((err) => {
      logger.warn({ err: err.message, taskId }, 'OpenAI gateway: async proof failed (non-fatal)');
    });
  }

  return { taskId, proverConfigured };
}

// ─── Verification receipt ─────────────────────────────────────────────────────

function buildReceipt({ taskId, provider, mock, proverConfigured, mockReason }) {
  const proofStatus = mock ? 'skipped' : proverConfigured ? 'pending' : 'unavailable';
  return {
    task_id: taskId,
    compute: {
      provider,
      real: !mock,
      note: mock
        ? `Response is a mock (compute.real=false). ${mockReason || 'No DePIN provider configured — set a provider key to route real compute.'}`
        : `Routed to ${provider} via the XFuel DePIN router.`,
    },
    payment: {
      rail: 'unmetered',
      note: 'The OpenAI-compatible path is unmetered in Phase 1. Use POST /task-request with payment.rail="usdc" for x402 settlement.',
    },
    proof: {
      status: proofStatus, // pending | unavailable | skipped
      system: 'sp1',
      attests: 'settlement metadata + commitment to the output hash (NOT inference correctness)',
      links: {
        status: `/task-status?task_id=${taskId}`,
        proof: `/prove-result?task_id=${taskId}`,
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
  app.get('/v1/models', (_req, res) => {
    res.json({ object: 'list', data: modelIds().map(modelObject) });
  });

  // ── GET /v1/models/:id ─────────────────────────────────────────────────────
  app.get('/v1/models/:id', (req, res) => {
    const id = req.params.id;
    if (!modelIds().includes(id)) {
      return res.status(404).json({
        error: { message: `The model '${id}' does not exist`, type: 'invalid_request_error', code: 'model_not_found' },
      });
    }
    res.json(modelObject(id));
  });

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
    const echoModel = model || 'xfuel-auto';

    let inference;
    try {
      inference = await runChatInference({ model, messages, max_tokens: clampMaxTokens(max_tokens), temperature });
    } catch (err) {
      logger.error({ err, reqId: req.id }, 'POST /v1/chat/completions inference error');
      return res.status(500).json({
        error: { message: 'inference failed', type: 'server_error', code: null },
      });
    }

    const { content, provider, mock } = inference;
    const { taskId, proverConfigured } = registerTaskAndProve({ model: echoModel, messages, content, provider });
    const receipt = buildReceipt({ taskId, provider, mock, proverConfigured, mockReason: inference.raw?.reason });

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
