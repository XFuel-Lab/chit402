/**
 * OpenRouter hub: catalog mapping, cost-plus quote, aliases, mocked upstream.
 * No live key and no live network.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  mapOpenRouterService,
  classifyOpenRouterModel,
  getHubCatalog,
  resetHubCatalogCache,
  resolveCatalogModel,
  setModelAliasResolver,
} from '../src/hub-catalog.js';
import { rateForModel, costOfUsage, estimateCogsFromRequest, measureCogs } from '../src/provider-rates.js';
import { quoteOpenRouterFromCogs, capOpenRouterOutputTokens, OPENROUTER_MAX_OUTPUT_TOKENS } from '../src/openrouter-pricing.js';
import { quoteResolved } from '../src/x402-server.js';
import { probeModels, resetHealth, healthOf } from '../src/provider-health.js';
import { resetOpenRouterPreflightCache } from '../src/openrouter-infer.js';

/** Captured 2026-09-26 from GET https://openrouter.ai/api/v1/models (public list). */
const GPT_4O_MINI = {
  id: 'openai/gpt-4o-mini',
  name: 'OpenAI: GPT-4o-mini',
  created: 1721260800,
  architecture: {
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    output_modalities: ['text'],
    tokenizer: 'GPT',
    instruct_type: null,
  },
  pricing: {
    prompt: '0.00000015',
    completion: '0.0000006',
    input_cache_read: '0.000000075',
  },
  top_provider: { max_completion_tokens: 16384 },
};

const GPT_4O = {
  id: 'openai/gpt-4o',
  name: 'OpenAI: GPT-4o',
  created: 1715558400,
  architecture: {
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    output_modalities: ['text'],
  },
  pricing: {
    prompt: '0.0000025',
    completion: '0.00001',
    input_cache_read: '0.00000125',
  },
};

const CLAUDE = {
  id: 'anthropic/claude-sonnet-5',
  name: 'Anthropic: Claude Sonnet 5',
  created: 1721260800,
  architecture: { output_modalities: ['text'], input_modalities: ['text'] },
  pricing: { prompt: '0.000003', completion: '0.000015' },
};

const GEMINI = {
  id: 'google/gemini-3.8-flash',
  name: 'Google: Gemini 3.8 Flash',
  created: 1721260800,
  architecture: { output_modalities: ['text'], input_modalities: ['text'] },
  pricing: { prompt: '0.0000001', completion: '0.0000004' },
};

const LIST = { data: [GPT_4O_MINI, GPT_4O, CLAUDE, GEMINI] };

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

beforeEach(() => {
  resetHubCatalogCache();
  resetOpenRouterPreflightCache();
  resetHealth();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MAX_TOKENS_CAP;
  process.env.HUB_CATALOG_OFFLINE = 'false';
  setModelAliasResolver(null);
});

afterEach(() => {
  setModelAliasResolver(null);
  delete process.env.OPENROUTER_API_KEY;
});

test('mapOpenRouterService uses openrouter/<vendor>/<model> and keeps pricing verbatim', () => {
  const row = mapOpenRouterService(GPT_4O_MINI);
  assert.equal(row.id, 'openrouter/openai/gpt-4o-mini');
  assert.equal(row.hub, 'openrouter');
  assert.equal(row.alias, 'openai/gpt-4o-mini');
  assert.equal(row.modality, 'chat');
  assert.equal(classifyOpenRouterModel(GPT_4O_MINI), 'chat');
  assert.equal(row.owned_by, 'openrouter');
  assert.deepEqual(row.cost, GPT_4O_MINI.pricing);
  assert.equal(row.capacity, undefined);
});

test('gpt-4o-mini rate matches the published USD-per-token price ($0.15 / $0.60 per 1M)', () => {
  // Independent check: OpenAI's list price for the same model is $0.15 input and
  // $0.60 output per million tokens. OpenRouter's strings are that price per token.
  const rate = rateForModel(mapOpenRouterService(GPT_4O_MINI));
  assert.equal(rate.input, 0.00000015);
  assert.equal(rate.output, 0.0000006);
  assert.equal(rate.input * 1_000_000, 0.15);
  assert.equal(rate.output * 1_000_000, 0.6);
  assert.equal(rate.cachedInput, 0.000000075);
  assert.equal(rate.perRequest, 0);
});

test('a zero cached-read price is not a free cache', () => {
  const rate = rateForModel(mapOpenRouterService({
    ...GPT_4O_MINI,
    pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0' },
  }));
  assert.equal(rate.cachedInput, null);
});

test('quote is upstream cost + 1% + $0.002 and never below upstream', () => {
  const cogs = 301n;
  const q = quoteOpenRouterFromCogs(cogs, { platformFeeBps: 100 });
  assert.equal(q.basis, 'cost_plus');
  assert.equal(q.fee_bps, 100);
  assert.equal(q.provider_cogs, '301');
  assert.equal(q.platform_fee, '4');
  assert.equal(q.receipt_fee, '2000');
  assert.equal(q.amount, '2305');
  assert.ok(BigInt(q.amount) >= cogs);
  assert.equal(q.floor_applied, false);

  const large = quoteOpenRouterFromCogs(50_000n, { platformFeeBps: 100 });
  const fee = (50_000n * 100n + 9_999n) / 10_000n;
  assert.equal(large.amount, String(50_000n + fee + 2_000n));
  assert.ok(BigInt(large.amount) > 50_000n);
});

test('max_tokens cap bounds the upfront quote', () => {
  assert.equal(capOpenRouterOutputTokens(1_000_000), OPENROUTER_MAX_OUTPUT_TOKENS);
  assert.equal(capOpenRouterOutputTokens(32), 32);
  assert.equal(capOpenRouterOutputTokens(undefined), 500);
});

test('COGS for an OpenRouter model is estimated from the published rate, not no_rate', async () => {
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    assert.match(String(url), /\/models$/);
    return jsonResponse(200, LIST);
  };
  await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: 'test-or-key',
    fetchFn,
    thetaBase: 'http://theta.test',
    akashBase: 'http://akash.test',
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  // Theta and Akash polls still run; OpenRouter is the third.
  assert.ok(calls >= 1);

  const estimated = await estimateCogsFromRequest({
    modelId: 'openrouter/openai/gpt-4o-mini',
    promptTokens: 1,
    maxOutputTokens: 500,
  });
  assert.equal(estimated.basis, 'estimated');
  assert.equal(
    estimated.amount,
    costOfUsage({ prompt_tokens: 1, completion_tokens: 500 }, rateForModel(mapOpenRouterService(GPT_4O_MINI))),
  );

  const measured = await measureCogs({
    modelId: 'openrouter/openai/gpt-4o-mini',
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });
  assert.equal(measured.basis, 'measured');
  assert.equal(measured.amount, 5n);
});

test('catalog TTL caches the OpenRouter list', async () => {
  let calls = 0;
  const fetchFn = async (url) => {
    if (String(url).includes('openrouter.test')) {
      calls += 1;
      return jsonResponse(200, LIST);
    }
    return jsonResponse(500, { error: 'down' });
  };
  const opts = {
    openrouterApiKey: 'test-or-key',
    fetchFn,
    ttlMs: 60_000,
    openrouterBase: 'http://openrouter.test/api/v1',
  };
  const first = await getHubCatalog({ ...opts, forceRefresh: true });
  const second = await getHubCatalog(opts);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.ok(first.models.some((m) => m.id === 'openrouter/openai/gpt-4o-mini'));
  await getHubCatalog({ ...opts, forceRefresh: true });
  assert.equal(calls, 2);
});

test('missing key advertises nothing and does not call OpenRouter', async () => {
  const fetchFn = async (url) => {
    if (String(url).includes('openrouter')) throw new Error('should not poll OpenRouter');
    if (String(url).includes('/service/list')) {
      return jsonResponse(200, {
        body: { services: [{ alias: 'glm_5_2', name: 'GLM', default_prediction: 'completions', predictions: { completions: {} } }] },
      });
    }
    return jsonResponse(500, {});
  };
  const { models, source } = await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: '',
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  assert.equal(models.some((m) => m.hub === 'openrouter'), false);
  assert.doesNotMatch(source, /openrouter/);
  assert.equal(resolveCatalogModel('gpt-4o-mini', models).ok, false);
  assert.equal(resolveCatalogModel('llama-3.3', [
    ...models,
    { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', alias: 'meta-llama/Llama-3.3-70B-Instruct', modality: 'chat' },
  ]).model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
});

test('a dead OpenRouter poll leaves the other hubs and xfuel/auto', async () => {
  const fetchFn = async (url) => {
    const u = String(url);
    if (u.includes('openrouter')) throw new Error('openrouter down');
    if (u.includes('/service/list')) {
      return jsonResponse(200, {
        body: { services: [{ alias: 'glm_5_2', name: 'GLM', default_prediction: 'completions', predictions: { completions: { input_vars: { messages: {} } } } }] },
      });
    }
    if (u.includes('/models')) {
      return jsonResponse(200, { data: [{ id: 'zai-org/GLM-5.3', name: 'GLM-5.3', created: 1 }] });
    }
    throw new Error(`unexpected ${u}`);
  };
  const { models } = await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: 'test-or-key',
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  assert.ok(models.some((m) => m.id === 'theta/glm_5_2'));
  assert.ok(models.some((m) => m.id === 'akash/zai-org/GLM-5.3'));
  assert.equal(models.some((m) => m.hub === 'openrouter'), false);
  const auto = resolveCatalogModel('xfuel/auto', models, { modality: 'chat' });
  assert.equal(auto.ok, true);
});

test('familiar names resolve to OpenRouter when enabled and to open-model aliases when not', async () => {
  const fetchFn = async (url) => {
    if (String(url).includes('openrouter')) return jsonResponse(200, LIST);
    return jsonResponse(500, {});
  };
  const { models } = await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: 'test-or-key',
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  const withOpen = [
    ...models,
    { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', alias: 'meta-llama/Llama-3.3-70B-Instruct', modality: 'chat' },
  ];
  assert.equal(resolveCatalogModel('gpt-4o-mini', withOpen).model.id, 'openrouter/openai/gpt-4o-mini');
  assert.equal(resolveCatalogModel('gpt-4o', withOpen).model.id, 'openrouter/openai/gpt-4o');
  assert.notEqual(resolveCatalogModel('gpt-4o', withOpen).model.id, 'openrouter/openai/gpt-4o-mini');
  assert.equal(resolveCatalogModel('claude-sonnet-5', withOpen).model.id, 'openrouter/anthropic/claude-sonnet-5');
  assert.equal(resolveCatalogModel('claude-3.5-sonnet', [{
    id: 'openrouter/anthropic/claude-3.5-sonnet',
    hub: 'openrouter',
    alias: 'anthropic/claude-3.5-sonnet',
    modality: 'chat',
  }]).model.alias, 'anthropic/claude-3.5-sonnet');
  assert.equal(resolveCatalogModel('gemini-3.8-flash', withOpen).model.id, 'openrouter/google/gemini-3.8-flash');
  assert.equal(resolveCatalogModel('llama-3.3', withOpen).model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');

  // An external alias table loses to OpenRouter while the hub is listed, and
  // wins once those rows are gone.
  setModelAliasResolver((name, rows) => {
    if (String(name).toLowerCase() !== 'gpt-4o') return null;
    return rows.find((m) => m.hub === 'akash') || null;
  });
  assert.equal(resolveCatalogModel('gpt-4o', withOpen).model.hub, 'openrouter');
  const noOr = withOpen.filter((m) => m.hub !== 'openrouter');
  assert.equal(resolveCatalogModel('gpt-4o', noOr).model.hub, 'akash');
  setModelAliasResolver(null);
  assert.equal(resolveCatalogModel('gpt-4o', noOr).ok, false);
});

test('quoteResolved uses the capped OpenRouter cost-plus bill', async () => {
  const fetchFn = async (url) => (
    String(url).includes('openrouter') ? jsonResponse(200, LIST) : jsonResponse(500, {})
  );
  await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: 'test-or-key',
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1_000_000,
  };
  const q = await quoteResolved(body);
  const capped = await quoteResolved({ ...body, max_tokens: OPENROUTER_MAX_OUTPUT_TOKENS });
  assert.equal(q.priced_model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(q.requested_model, 'gpt-4o-mini');
  assert.equal(q.basis, 'cost_plus');
  assert.equal(q.fee_bps, 100);
  assert.equal(q.receipt_fee, '2000');
  assert.equal(q.max_output_tokens, OPENROUTER_MAX_OUTPUT_TOKENS);
  assert.equal(q.amount, capped.amount);
  assert.ok(BigInt(q.amount) >= BigInt(q.provider_cogs));
  assert.equal(q.amount, String(BigInt(q.provider_cogs) + BigInt(q.platform_fee) + 2000n));
});

test('probeModels strips the openrouter prefix', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push(JSON.parse(init.body).model);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  await probeModels(['openrouter/openai/gpt-4o-mini'], {
    baseUrl: 'http://openrouter.test/api/v1',
    apiKey: 'k',
    fetchFn,
  });
  assert.deepEqual(seen, ['openai/gpt-4o-mini']);
  assert.equal(healthOf('openrouter/openai/gpt-4o-mini').status, 'available');
});

// ── HTTP: mocked OpenRouter + mocked facilitator ─────────────────────────────

const EVM_PAYER = '0x1234567890123456789012345678901234567890';
const EVM_TX = '0x' + 'ab'.repeat(32);

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('gateway quotes, fails closed before settle, and receipts a mocked OpenRouter', async () => {
  let settles = 0;
  let keyStatus = 200;
  let chatStatus = 200;
  const facilitator = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url || '';
      if (url.endsWith('/settle')) settles += 1;
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      if (url.endsWith('/verify')) return send(200, { valid: true, txRef: EVM_TX, isValid: true, payer: EVM_PAYER });
      if (url.endsWith('/settle')) return send(200, { settled: true, txRef: EVM_TX, success: true, transaction: EVM_TX, network: 'base', payer: EVM_PAYER });
      return send(404, { error: 'not_found', body: body.slice(0, 40) });
    });
  });
  const upstream = await startServer((req, res) => {
    const url = req.url || '';
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    if (url.endsWith('/models')) return send(200, LIST);
    if (url.endsWith('/key')) return send(keyStatus, keyStatus === 200 ? { data: { label: 'test' } } : { error: 'down' });
    if (url.endsWith('/chat/completions')) {
      if (chatStatus !== 200) return send(chatStatus, { error: { message: 'upstream down' } });
      return send(200, {
        choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      });
    }
    return send(500, { error: 'unexpected', url });
  });

  process.env.HUB_CATALOG_OFFLINE = 'false';
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  process.env.OPENROUTER_BASE_URL = `${upstream.url}/openrouter/api/v1`;
  process.env.THETA_EDGECLOUD_BASE = `${upstream.url}/theta`;
  process.env.AKASHML_BASE_URL = `${upstream.url}/akash/v1`;
  delete process.env.AKASHML_API_KEY;
  process.env.X402_ENABLED = 'true';
  process.env.X402_PAY_TO = '0xtreasury';
  process.env.X402_NETWORK = 'base';
  process.env.X402_USDC_PRICE_DEFAULT = '2000';
  process.env.X402_FACILITATOR_PROVIDER = 'zan';
  process.env.X402_FACILITATOR_API_KEY = 'testkey';
  process.env.ZAN_X402_GATEWAY_URL = facilitator.url;
  process.env.X402_COST_PLUS = 'true';
  process.env.X402_PLATFORM_FEE_BPS = '100';
  delete process.env.M2M_API_KEYS;
  delete process.env.THETA_EDGECLOUD_API_KEY;
  process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'false';
  process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

  resetHubCatalogCache();
  resetOpenRouterPreflightCache();

  const { createApp } = await import('../src/server.js');
  const { initAIListener } = await import('../src/ai-listener.js');
  const { resetFloatManagerForTests } = await import('../src/provider-float.js');
  resetFloatManagerForTests();
  await initAIListener();
  const app = createApp();
  const gateway = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });

  const pay = (nonce) => ({
    'content-type': 'application/json',
    'x-payment': Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: 'base',
      payload: { authorization: { from: EVM_PAYER } },
    }), 'utf8').toString('base64'),
    ...(nonce ? { 'x-payment-nonce': nonce } : {}),
  });

  try {
    const listed = await fetch(`${gateway.base}/v1/models`);
    const models = await listed.json();
    assert.equal(listed.status, 200);
    assert.ok(models.data.some((m) => m.id === 'openrouter/openai/gpt-4o-mini'));
    const mini = models.data.find((m) => m.id === 'openrouter/openai/gpt-4o-mini');
    assert.equal(mini.pricing.basis, 'cost_plus');
    assert.equal(mini.pricing.fee_bps, 100);
    assert.equal(mini.pricing.provider_cost_per_million.input, 0.15);

    const chatBody = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 32,
    };
    const challengeRes = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
    assert.equal(challengeRes.status, 402);
    const challenge = await challengeRes.json();
    const quoted = challenge.accepts[0].maxAmountRequired;
    const expected = await quoteResolved(chatBody);
    assert.equal(quoted, expected.amount);
    assert.equal(expected.receipt_fee, '2000');
    assert.ok(BigInt(quoted) >= BigInt(expected.provider_cogs));
    assert.equal(settles, 0);

    const unknown = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: pay('ignored-nonce'),
      body: JSON.stringify({
        model: 'not-a-real-model',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    assert.equal(unknown.status, 400);
    const unknownBody = await unknown.json();
    assert.equal(unknownBody.error.code, 'model_not_found');
    assert.equal(settles, 0);

    keyStatus = 500;
    resetOpenRouterPreflightCache();
    const preflight = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: pay(challenge.accepts[0].extra.nonce),
      body: JSON.stringify(chatBody),
    });
    assert.equal(preflight.status, 503);
    const preflightBody = await preflight.json();
    assert.equal(preflightBody.error.code, 'openrouter_preflight_failed');
    assert.equal(settles, 0);

    keyStatus = 200;
    resetOpenRouterPreflightCache();
    const again = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
    const againBody = await again.json();
    const nonce = againBody.accepts[0].extra.nonce;
    const paid = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: pay(nonce),
      body: JSON.stringify(chatBody),
    });
    const paidBody = await paid.json();
    assert.equal(paid.status, 200, JSON.stringify(paidBody));
    assert.equal(settles, 1);
    assert.equal(paidBody.model, 'openrouter/openai/gpt-4o-mini');
    assert.equal(paidBody.usage.prompt_tokens, 12);
    assert.equal(paidBody.usage.completion_tokens, 4);
    assert.equal(paidBody.xfuel.route.provider, 'openrouter');
    assert.equal(paidBody.xfuel.route.model, 'openrouter/openai/gpt-4o-mini');
    assert.equal(paidBody.xfuel.route.requested_model, 'gpt-4o-mini');
    assert.equal(paidBody.xfuel.route_meta.requested_model, 'gpt-4o-mini');
    assert.equal(paidBody.xfuel.provider_cogs.actual, '5');
    assert.equal(paidBody.xfuel.provider_cogs.basis, 'measured');
    assert.equal(paidBody.xfuel.status, 'completed');

    const streamed = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...chatBody, stream: true }),
    });
    // Unpaid stream still 402s before tokens. Pay a fresh challenge.
    assert.equal(streamed.status, 402);
    const streamChallenge = await streamed.json();
    const streamRes = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: pay(streamChallenge.accepts[0].extra.nonce),
      body: JSON.stringify({ ...chatBody, stream: true }),
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);
    const sse = await streamRes.text();
    assert.match(sse, /pong/);
    assert.match(sse, /event: xfuel\.receipt/);
    assert.match(sse, /openrouter\/openai\/gpt-4o-mini/);
    assert.match(sse, /data: \[DONE\]/);

    chatStatus = 500;
    const failChallenge = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
    const failChallengeBody = await failChallenge.json();
    const failed = await fetch(`${gateway.base}/v1/chat/completions`, {
      method: 'POST',
      headers: pay(failChallengeBody.accepts[0].extra.nonce),
      body: JSON.stringify(chatBody),
    });
    const failedBody = await failed.json();
    assert.equal(failed.status, 502, JSON.stringify(failedBody));
    assert.ok(settles >= 2);
    assert.equal(failedBody.xfuel.status, 'failed');
    assert.equal(failedBody.xfuel.refund.status, 'refund_owed');
    assert.equal(failedBody.xfuel.route.provider, 'openrouter');
    assert.equal(failedBody.xfuel.route.model, 'openrouter/openai/gpt-4o-mini');
    assert.equal(failedBody.xfuel.route_meta.requested_model, 'gpt-4o-mini');
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    gateway.server.closeAllConnections?.();
    await new Promise((r) => gateway.server.close(r));
    await facilitator.close();
    await upstream.close();
  }
});
