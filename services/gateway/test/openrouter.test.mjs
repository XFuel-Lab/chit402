/**
 * OpenRouter hub: catalog mapping, cost-plus quote, aliases, mocked upstream.
 * No live key and no live network.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

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
import {
  inferOpenRouter,
  preflightOpenRouter,
  resetOpenRouterPreflightCache,
  scheduleOpenRouterCostReconcile,
  openRouterReconcileSettled,
} from '../src/openrouter-infer.js';
import { providerCogsOf, buildReceipt } from '../src/receipt.js';

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
  delete process.env.OPENROUTER_REFERER;
  delete process.env.OPENROUTER_TITLE;
  process.env.HUB_CATALOG_OFFLINE = 'false';
  setModelAliasResolver(null);
});

afterEach(() => {
  setModelAliasResolver(null);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_REFERER;
  delete process.env.OPENROUTER_TITLE;
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

test('probeModels strips the openrouter prefix and sends attribution', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ model: JSON.parse(init.body).model, headers: init.headers });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  await probeModels(['openrouter/openai/gpt-4o-mini'], {
    baseUrl: 'http://openrouter.test/api/v1',
    apiKey: 'k',
    fetchFn,
  });
  assert.deepEqual(seen.map((s) => s.model), ['openai/gpt-4o-mini']);
  assertAttribution(seen[0].headers);
  assert.equal(healthOf('openrouter/openai/gpt-4o-mini').status, 'available');
});

test('every OpenRouter request carries attribution headers, overridable by env', async () => {
  const hits = [];
  const fetchFn = async (url, init) => {
    hits.push({ url: String(url), headers: init.headers });
    if (String(url).endsWith('/models')) return jsonResponse(200, LIST);
    if (String(url).endsWith('/key')) return jsonResponse(200, { data: { label: 'test' } });
    return jsonResponse(200, {
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  const completion = await inferOpenRouter({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'test-or-key',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn,
  });
  assert.equal(completion.ok, true);
  assertAttribution(hits[0].headers);

  resetOpenRouterPreflightCache();
  const pre = await preflightOpenRouter({
    apiKey: 'test-or-key',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn,
    force: true,
  });
  assert.equal(pre.ok, true);
  assertAttribution(hits[1].headers);

  await getHubCatalog({
    forceRefresh: true,
    openrouterApiKey: 'test-or-key',
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  const modelsHit = hits.find((h) => h.url.includes('openrouter.test') && h.url.endsWith('/models'));
  assertAttribution(modelsHit.headers);

  process.env.OPENROUTER_REFERER = 'https://example.test';
  process.env.OPENROUTER_TITLE = 'Example';
  hits.length = 0;
  await inferOpenRouter({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'test-or-key',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn,
  });
  assert.equal(hits[0].headers['HTTP-Referer'], 'https://example.test');
  assert.equal(hits[0].headers['X-OpenRouter-Title'], 'Example');
  assert.equal(hits[0].headers['X-Title'], 'Example');
  assert.equal(hits[0].headers['X-OpenRouter-Categories'], 'cloud-agent');
  assert.equal(hits[0].headers['X-OpenRouter-App-Visibility'], undefined);
});

function assertAttribution(headers) {
  assert.equal(headers['HTTP-Referer'], 'https://chit402.com');
  assert.equal(headers['X-OpenRouter-Title'], 'Chit402');
  assert.equal(headers['X-Title'], 'Chit402');
  assert.equal(headers['X-OpenRouter-Categories'], 'cloud-agent');
  assert.equal(Object.hasOwn(headers, 'X-OpenRouter-App-Visibility'), false);
}

test('generation cost is recorded on the receipt after the response, without blocking it', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchFn = async (url, init) => {
    assert.match(String(url), /\/generation\?id=gen-1$/);
    assertAttribution(init.headers);
    await gate;
    return jsonResponse(200, {
      data: { id: 'gen-1', total_cost: '0.0015', upstream_inference_cost: '0.0012' },
    });
  };
  const task = {
    taskId: 'xfuel-gen-1',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: { type: 'inference_request', modelId: 'openrouter/openai/gpt-4o-mini', paymentRail: 'usdc' },
    result: { provider: 'openrouter', model: 'openrouter/openai/gpt-4o-mini' },
    meta: { providerCogs: { provider: 'openrouter', actual: '5', basis: 'measured', currency: 'USDC' } },
  };
  const job = scheduleOpenRouterCostReconcile({
    id: 'gen-1',
    task,
    apiKey: 'test-or-key',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn,
  });
  assert.equal(task.meta.providerCogs.openrouter_generation, undefined);
  const early = buildReceipt(task, { persistSignature: false });
  assert.equal(early.provider_cogs.openrouter_generation, undefined);
  assert.equal(early.provider_cogs.actual, '5');
  release();
  await job;
  await openRouterReconcileSettled();
  const cogs = providerCogsOf(task);
  assert.equal(cogs.actual, '5');
  assert.equal(cogs.basis, 'measured');
  assert.deepEqual(cogs.openrouter_generation, {
    id: 'gen-1',
    total_cost: '0.0015',
    upstream_inference_cost: '0.0012',
    currency: 'USD',
  });
  const later = buildReceipt(task, { persistSignature: false });
  assert.equal(later.provider_cogs.actual, '5');
  assert.equal(later.provider_cogs.openrouter_generation.total_cost, '0.0015');
  assert.equal(later.provider_cogs.openrouter_generation.upstream_inference_cost, '0.0012');

  const missed = { meta: { providerCogs: { provider: 'openrouter', actual: '5', basis: 'measured' } } };
  await scheduleOpenRouterCostReconcile({
    id: 'gen-missing',
    task: missed,
    apiKey: 'test-or-key',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn: async () => jsonResponse(404, { error: { message: 'not ready' } }),
  });
  assert.equal(missed.meta.providerCogs.openrouter_generation, undefined);
  assert.equal(missed.meta.providerCogs.actual, '5');
});


