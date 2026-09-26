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
import { quoteOpenRouterFromCogs, quoteOpenRouterByok, capOpenRouterOutputTokens, OPENROUTER_MAX_OUTPUT_TOKENS } from '../src/openrouter-pricing.js';
import { quoteResolved } from '../src/x402-server.js';
import { probeModels, resetHealth, healthOf } from '../src/provider-health.js';
import {
  inferOpenRouter,
  preflightOpenRouter,
  resetOpenRouterPreflightCache,
  scheduleOpenRouterCostReconcile,
  openRouterReconcileSettled,
  openrouterEndUser,
  openrouterHouseResaleEnabled,
  redactSecrets,
  resolveOpenRouterAccess,
  formatPlainDecimal,
} from '../src/openrouter-infer.js';
import logger from '../src/logger.js';
import { providerCogsOf, buildReceipt, decodeReceiptClaims, renderReceiptHtml, storedReceiptJson, verifyReceiptEcdsaWithJwks } from '../src/receipt.js';

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
  delete process.env.OPENROUTER_HOUSE_RESALE_ENABLED;
  delete process.env.OPENROUTER_MAX_TOKENS_CAP;
  delete process.env.OPENROUTER_REFERER;
  delete process.env.OPENROUTER_TITLE;
  process.env.HUB_CATALOG_OFFLINE = 'false';
  setModelAliasResolver(null);
});

afterEach(() => {
  setModelAliasResolver(null);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_HOUSE_RESALE_ENABLED;
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

test('flag off advertises OpenRouter as BYOK and does not send the house key', async () => {
  process.env.OPENROUTER_API_KEY = 'house-secret-not-sent';
  const fetchFn = async (url, init) => {
    const u = String(url);
    if (u.includes('openrouter')) {
      assert.equal(init?.headers?.Authorization, undefined);
      return jsonResponse(200, LIST);
    }
    if (u.includes('/service/list')) {
      return jsonResponse(200, {
        body: { services: [{ alias: 'glm_5_2', name: 'GLM', default_prediction: 'completions', predictions: { completions: {} } }] },
      });
    }
    return jsonResponse(500, {});
  };
  const { models, source } = await getHubCatalog({
    forceRefresh: true,
    fetchFn,
    openrouterBase: 'http://openrouter.test/api/v1',
  });
  assert.match(source, /openrouter/);
  const mini = models.find((m) => m.id === 'openrouter/openai/gpt-4o-mini');
  assert.equal(mini.access, 'byok');
  assert.equal(openrouterHouseResaleEnabled(), false);
  assert.equal(resolveCatalogModel('gpt-4o-mini', models).ok, false);
  assert.equal(resolveCatalogModel('gpt-4o', models).ok, false);
  assert.equal(resolveCatalogModel('openrouter/openai/gpt-4o-mini', models).model.hub, 'openrouter');
  const quoted = await quoteResolved({
    model: 'openrouter/openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
  });
  assert.equal(quoted.amount, '2000');
  assert.equal(quoted.basis, 'byok_receipt');
  assert.equal(quoted.fee_bps, 0);
  assert.equal(quoted.platform_fee, '0');
  assert.equal(quoted.provider_cogs, '0');
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

test('familiar names resolve to OpenRouter only when house resale is on', async () => {
  process.env.OPENROUTER_HOUSE_RESALE_ENABLED = 'true';
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

test('quoteResolved uses the capped OpenRouter cost-plus bill when house resale is on', async () => {
  process.env.OPENROUTER_HOUSE_RESALE_ENABLED = 'true';
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

test('BYOK quote is the $0.002 receipt with no route margin', () => {
  const q = quoteOpenRouterByok();
  assert.equal(q.amount, '2000');
  assert.equal(q.basis, 'byok_receipt');
  assert.equal(q.fee_bps, 0);
  assert.equal(q.platform_fee, '0');
  assert.equal(q.provider_cogs, '0');
  assert.equal(q.receipt_fee, '2000');
  assert.equal(q.label, 'paid-by-caller-to-OpenRouter');
});

test('caller key wins over the house key, and aliases do not take a bearer', () => {
  process.env.OPENROUTER_HOUSE_RESALE_ENABLED = 'true';
  process.env.OPENROUTER_API_KEY = 'house-key-xyz';
  assert.deepEqual(
    resolveOpenRouterAccess({ headers: { 'x-openrouter-key': 'caller-key-xyz' } }, 'gpt-4o'),
    { mode: 'byok', apiKey: 'caller-key-xyz' },
  );
  assert.equal(resolveOpenRouterAccess({ headers: {} }, 'gpt-4o').mode, 'house');
  delete process.env.OPENROUTER_HOUSE_RESALE_ENABLED;
  assert.equal(
    resolveOpenRouterAccess(
      { headers: { authorization: 'Bearer or-key-xyzxyz' } },
      'openrouter/openai/gpt-4o-mini',
    ).mode,
    'byok',
  );
  assert.equal(
    resolveOpenRouterAccess({ headers: { authorization: 'Bearer or-key-xyzxyz' } }, 'gpt-4o').mode,
    'missing',
  );
  assert.equal(
    resolveOpenRouterAccess(
      { headers: { authorization: 'Bearer chit-partner-key' } },
      'openrouter/openai/gpt-4o-mini',
      { authorizationIsChitCredential: true },
    ).mode,
    'missing',
  );
  assert.equal(
    resolveOpenRouterAccess(
      { headers: { 'x-api-key': 'chit-partner-key', authorization: 'Bearer or-key-xyzxyz' } },
      'openrouter/openai/gpt-4o-mini',
      { authorizationIsChitCredential: true },
    ).apiKey,
    'or-key-xyzxyz',
  );
  assert.equal(
    resolveOpenRouterAccess(
      { headers: { authorization: 'Bearer chit402-demo' } },
      'openrouter/openai/gpt-4o-mini',
    ).mode,
    'missing',
  );
});

test('a stable hashed user does not contain the wallet or the key', () => {
  const wallet = '0x1234567890123456789012345678901234567890';
  const id = openrouterEndUser({ payerWallet: wallet });
  assert.match(id, /^chit:[a-f0-9]{64}$/);
  assert.equal(id.includes('1234567890'), false);
  assert.equal(openrouterEndUser({ payerWallet: wallet.toUpperCase() }), id);
  const fromKey = openrouterEndUser({ byokKey: 'caller-key-xyz' });
  assert.match(fromKey, /^chit:[a-f0-9]{64}$/);
  assert.notEqual(fromKey, id);
  assert.equal(fromKey.includes('caller-key-xyz'), false);
});

test('chat completions send user and a flag-off process does not spend the house key', async () => {
  let seen;
  const completion = await inferOpenRouter({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'caller-key-abcdef',
    user: 'chit:abc',
    baseUrl: 'http://openrouter.test/api/v1',
    fetchFn: async (_url, init) => {
      seen = { auth: init.headers.Authorization, body: JSON.parse(init.body) };
      return jsonResponse(200, {
        id: 'gen-u',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.01 },
      });
    },
  });
  assert.equal(completion.ok, true);
  assert.equal(completion.reportedCost, '0.01');
  assert.equal(seen.auth, 'Bearer caller-key-abcdef');
  assert.equal(seen.body.user, 'chit:abc');
  assert.equal(JSON.stringify(seen.body).includes('caller-key-abcdef'), false);

  process.env.OPENROUTER_API_KEY = 'house-secret-value';
  delete process.env.OPENROUTER_HOUSE_RESALE_ENABLED;
  let called = false;
  const blocked = await inferOpenRouter({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    fetchFn: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  assert.equal(called, false);
  assert.equal(blocked.reason, 'missing_api_key');
});

test('preflight success is cached per key', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return jsonResponse(200, { data: { label: 'ok' } });
  };
  const baseUrl = 'http://openrouter.test/api/v1';
  const first = await preflightOpenRouter({ apiKey: 'key-aaaa-1111', baseUrl, fetchFn });
  const again = await preflightOpenRouter({ apiKey: 'key-aaaa-1111', baseUrl, fetchFn });
  const other = await preflightOpenRouter({ apiKey: 'key-bbbb-2222', baseUrl, fetchFn });
  assert.equal(first.cached, false);
  assert.equal(again.cached, true);
  assert.equal(other.cached, false);
  assert.equal(calls, 2);
});

test('upstream errors redact the caller key from the detail and the log', async () => {
  const secret = 'sk-or-caller-secret-do-not-log';
  assert.equal(redactSecrets(`bad ${secret} token`, [secret]), 'bad [redacted] token');
  const seen = [];
  const original = logger.warn;
  logger.warn = (obj, msg) => { seen.push({ obj, msg }); };
  try {
    const result = await inferOpenRouter({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: secret,
      baseUrl: 'http://openrouter.test/api/v1',
      fetchFn: async () => jsonResponse(500, { error: { message: `rejected ${secret}` } }),
    });
    assert.equal(result.ok, false);
    assert.equal(String(result.detail).includes(secret), false);
    assert.match(result.detail, /\[redacted\]/);
    assert.equal(JSON.stringify(seen).includes(secret), false);
  } finally {
    logger.warn = original;
  }
});

test('reported USD cost is a plain decimal, never scientific notation', () => {
  assert.equal(formatPlainDecimal(8.3e-7), '0.00000083');
  assert.equal(formatPlainDecimal('8.3e-7'), '0.00000083');
  assert.equal(formatPlainDecimal('0.0000042'), '0.0000042');
  assert.equal(formatPlainDecimal(0), '0');
  const cogs = providerCogsOf({
    meta: { providerCogs: { provider: 'openrouter', reported_cost_usd: 8.3e-7, label: 'paid-by-caller-to-OpenRouter' } },
  });
  assert.equal(cogs.reported_cost_usd, '0.00000083');
});

test('signed JWS covers OpenRouter generation id, served model, tokens, cost, and label', () => {
  const task = {
    taskId: 'xfuel-or-facts',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      amount: '2000',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      requestedModel: 'openrouter/meta-llama/llama-3.1-8b-instruct',
      modelId: 'meta-llama/llama-3.1-8b-instruct',
    },
    feeAmount: '10',
    netAmount: '1990',
    feeBps: 50,
    outputHash: '0x' + 'cd'.repeat(32),
    usage: { prompt_tokens: 19, completion_tokens: 9, total_tokens: 28, source: 'provider' },
    result: { provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct' },
    meta: {
      requestedModel: 'openrouter/meta-llama/llama-3.1-8b-instruct',
      openrouter: {
        generation_id: 'gen-live-1',
        served_model: 'meta-llama/llama-3.1-8b-instruct',
      },
      providerCogs: {
        provider: 'openrouter',
        basis: 'reported',
        paid_by: 'caller-to-openrouter',
        label: 'paid-by-caller-to-OpenRouter',
        reported_cost_usd: '8.3e-7',
        actual: null,
      },
      bookView: {
        settlement_status: 'settled',
        idempotent_replay: false,
        replay_of: null,
        usage_settled: {
          agent_id: 1,
          hub: 'openrouter',
          model: 'meta-llama/llama-3.1-8b-instruct',
          amount: '2000',
          settlement_status: 'settled',
          idempotent_replay: false,
          replay_of: null,
        },
      },
    },
  };
  const receipt = buildReceipt(task, { baseUrl: 'https://api.chit402.com' });
  const stored = storedReceiptJson(receipt);
  assert.equal(stored.openrouter.generation_id, 'gen-live-1');
  assert.equal(stored.openrouter.reported_cost_usd, '0.00000083');
  assert.equal(stored.route.model, 'meta-llama/llama-3.1-8b-instruct');
  assert.equal(stored.route.resolved, 'meta-llama/llama-3.1-8b-instruct');
  assert.equal(stored.route.requested_model, 'openrouter/meta-llama/llama-3.1-8b-instruct');
  assert.notEqual(stored.route.model, stored.route.requested_model);
  assert.equal(stored.settlement_status, 'settled');
  assert.equal(stored.idempotent_replay, false);
  assert.equal(stored.replay_of, null);
  assert.equal(stored.payment.collected, true);
  assert.equal(stored.payment.ref, 'base:0x' + 'ab'.repeat(32));
  assert.equal(stored.usage_settled.amount, '2000');
  assert.equal(stored.usage_settled.settlement_status, 'settled');
  assert.equal(stored.session, undefined);
  assert.equal(stored.agent_pubkey, undefined);
  assert.equal(receipt.payment, undefined, 'slim envelope keeps payment inside the JWS');
  assert.equal(verifyReceiptEcdsaWithJwks(stored, { keys: [] }).valid, true);
  assert.equal(verifyReceiptEcdsaWithJwks(receipt, { keys: [] }).valid, true);
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.route.model, 'meta-llama/llama-3.1-8b-instruct');
  assert.equal(claims.openrouter.generation_id, 'gen-live-1');
  assert.equal(claims.openrouter.served_model, 'meta-llama/llama-3.1-8b-instruct');
  assert.equal(claims.openrouter.prompt_tokens, 19);
  assert.equal(claims.openrouter.completion_tokens, 9);
  assert.equal(claims.openrouter.reported_cost_usd, '0.00000083');
  assert.equal(claims.openrouter.label, 'paid-by-caller-to-OpenRouter');
  const html = renderReceiptHtml(receipt);
  assert.match(html, /\$0\.00000083/);
  assert.equal(html.includes('8.3e-7'), false);
  assert.match(html, /gen-live-1/);
});


