/**
 * Paid OpenRouter path against a local mock. Env is set before the gateway
 * loads so x402 config (snapshotted at import) points at the mock facilitator.
 * No live key and no live network.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const EVM_PAYER = '0x1234567890123456789012345678901234567890';
const EVM_TX = '0x' + 'ab'.repeat(32);

const LIST = {
  data: [
    {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o-mini',
      created: 1721260800,
      architecture: { output_modalities: ['text'], input_modalities: ['text'] },
      pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.000000075' },
    },
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      created: 1715558400,
      architecture: { output_modalities: ['text'], input_modalities: ['text'] },
      pricing: { prompt: '0.0000025', completion: '0.00001' },
    },
    {
      id: 'anthropic/claude-sonnet-5',
      name: 'Anthropic: Claude Sonnet 5',
      created: 1721260800,
      architecture: { output_modalities: ['text'], input_modalities: ['text'] },
      pricing: { prompt: '0.000003', completion: '0.000015' },
    },
    {
      id: 'google/gemini-3.8-flash',
      name: 'Google: Gemini 3.8 Flash',
      created: 1721260800,
      architecture: { output_modalities: ['text'], input_modalities: ['text'] },
      pricing: { prompt: '0.0000001', completion: '0.0000004' },
    },
  ],
};

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

let settles = 0;
let keyStatus = 200;
let chatStatus = 200;
let chatErrorBody = { error: { message: 'upstream down' } };

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

const upstreamHits = [];
const upstream = await startServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const url = req.url || '';
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    upstreamHits.push({
      url,
      authorization: req.headers.authorization,
      body,
      referer: req.headers['http-referer'],
      title: req.headers['x-openrouter-title'],
      titleCompat: req.headers['x-title'],
      categories: req.headers['x-openrouter-categories'],
      visibility: req.headers['x-openrouter-app-visibility'],
    });
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    if (url.endsWith('/models')) return send(200, LIST);
    if (url.endsWith('/key')) return send(keyStatus, keyStatus === 200 ? { data: { label: 'test' } } : { error: 'down' });
    if (url.includes('/generation')) {
      return send(200, {
        data: { id: 'gen-http-1', total_cost: '0.0000042', upstream_inference_cost: '0.0000039' },
      });
    }
    if (url.endsWith('/chat/completions')) {
      if (chatStatus !== 200) return send(chatStatus, chatErrorBody);
      return send(200, {
        id: 'gen-http-1',
        choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0.0000042 },
      });
    }
    return send(500, { error: 'unexpected', url });
  });
});

process.env.HUB_CATALOG_OFFLINE = 'false';
process.env.OPENROUTER_API_KEY = 'test-or-key';
process.env.OPENROUTER_HOUSE_RESALE_ENABLED = 'true';
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
// A configured partner key turns off open mode, so an OpenRouter bearer is not
// treated as a Chit credential and the call still settles the receipt.
process.env.M2M_API_KEYS = 'chit-partner-not-openrouter';
delete process.env.THETA_EDGECLOUD_API_KEY;
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetFloatManagerForTests } = await import('../src/provider-float.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const {
  resetOpenRouterPreflightCache,
  openRouterReconcileSettled,
  openrouterEndUser,
} = await import('../src/openrouter-infer.js');
const { quoteResolved } = await import('../src/x402-server.js');

let server;
let base;

before(async () => {
  resetFloatManagerForTests();
  resetHubCatalogCache();
  resetOpenRouterPreflightCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_HOUSE_RESALE_ENABLED;
  if (server) {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  await facilitator.close();
  await upstream.close();
});

function pay(nonce) {
  return {
    'content-type': 'application/json',
    'x-payment': Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: 'base',
      payload: { authorization: { from: EVM_PAYER } },
    }), 'utf8').toString('base64'),
    ...(nonce ? { 'x-payment-nonce': nonce } : {}),
  };
}

test('gateway quotes, fails closed before settle, and receipts a mocked OpenRouter', async () => {
  const listed = await fetch(`${base}/v1/models`);
  const models = await listed.json();
  assert.equal(listed.status, 200);
  assert.ok(models.data.some((m) => m.id === 'openrouter/openai/gpt-4o-mini'));
  const mini = models.data.find((m) => m.id === 'openrouter/openai/gpt-4o-mini');
  assert.equal(mini.access, 'house');
  assert.equal(mini.pricing.basis, 'cost_plus');
  assert.equal(mini.pricing.fee_bps, 100);
  assert.equal(mini.pricing.provider_cost_per_million.input, 0.15);

  const chatBody = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
  };
  const challengeRes = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(challengeRes.status, 402, await challengeRes.clone().text());
  assert.equal(challengeRes.headers.get('x-chit-model-substituted'), 'true');
  assert.equal(challengeRes.headers.get('x-chit-requested-model'), 'gpt-4o-mini');
  assert.equal(challengeRes.headers.get('x-chit-served-model'), 'openrouter/openai/gpt-4o-mini');
  const challenge = await challengeRes.json();
  const quoted = challenge.accepts[0].maxAmountRequired;
  const expected = await quoteResolved(chatBody);
  assert.equal(quoted, expected.amount);
  assert.equal(expected.receipt_fee, '2000');
  assert.ok(BigInt(quoted) >= BigInt(expected.provider_cogs));
  assert.equal(settles, 0);

  const unknown = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: pay('ignored-nonce'),
    body: JSON.stringify({
      model: 'not-a-real-model',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  assert.equal(unknown.status, 400);
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.error.code, 'model_not_routable');
  assert.equal(unknownBody.charged, false);
  assert.equal(settles, 0);

  keyStatus = 500;
  resetOpenRouterPreflightCache();
  const preflight = await fetch(`${base}/v1/chat/completions`, {
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
  const again = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  const againBody = await again.json();
  const nonce = againBody.accepts[0].extra.nonce;
  const paid = await fetch(`${base}/v1/chat/completions`, {
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
  assert.equal(paidBody.xfuel.route.substituted, true);
  assert.equal(paidBody.chit.requested_model, 'gpt-4o-mini');
  assert.equal(paidBody.chit.served_model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(paidBody.chit.substituted, true);
  assert.equal(paidBody.xfuel.route_meta.requested_model, 'gpt-4o-mini');
  assert.equal(paidBody.xfuel.provider_cogs.actual, '5');
  assert.equal(paidBody.xfuel.provider_cogs.basis, 'measured');
  assert.equal(paidBody.xfuel.status, 'completed');
  for (const suffix of ['/models', '/key', '/chat/completions']) {
    const hit = upstreamHits.find((h) => h.url.includes('/openrouter/') && h.url.endsWith(suffix));
    assert.ok(hit, `missing upstream ${suffix}`);
    assert.equal(hit.referer, 'https://chit402.com');
    assert.equal(hit.title, 'Chit402');
    assert.equal(hit.titleCompat, 'Chit402');
    assert.equal(hit.categories, 'cloud-agent');
    assert.equal(hit.visibility, undefined);
  }
  assert.equal(paidBody.xfuel.provider_cogs.openrouter_generation, undefined);
  await openRouterReconcileSettled();
  const receiptRes = await fetch(`${base}/receipt/${paidBody.xfuel.task_id}?format=json`);
  const receipt = await receiptRes.json();
  assert.equal(receiptRes.status, 200, JSON.stringify(receipt));
  assert.equal(receipt.provider_cogs.actual, '5');
  assert.equal(receipt.provider_cogs.openrouter_generation.id, 'gen-http-1');
  assert.equal(receipt.provider_cogs.openrouter_generation.total_cost, '0.0000042');
  assert.equal(receipt.provider_cogs.openrouter_generation.upstream_inference_cost, '0.0000039');
  assert.equal(receipt.provider_cogs.openrouter_generation.currency, 'USD');
  const chatHit = upstreamHits.find((h) => h.url.includes('/openrouter/') && h.url.endsWith('/chat/completions'));
  assert.equal(chatHit.authorization, 'Bearer test-or-key');
  assert.equal(chatHit.body.user, openrouterEndUser({ payerWallet: EVM_PAYER }));
  const generationHit = upstreamHits.find((h) => h.url.includes('/generation'));
  assert.ok(generationHit);
  assert.equal(generationHit.authorization, 'Bearer test-or-key');
  assert.equal(generationHit.categories, 'cloud-agent');
  assert.equal(generationHit.visibility, undefined);

  const streamed = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...chatBody, stream: true }),
  });
  assert.equal(streamed.status, 402);
  const streamChallenge = await streamed.json();
  const streamRes = await fetch(`${base}/v1/chat/completions`, {
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
  const failChallenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  const failChallengeBody = await failChallenge.json();
  const failed = await fetch(`${base}/v1/chat/completions`, {
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
});

test('BYOK forwards the caller key, charges only the receipt, and redacts the key', async () => {
  const callerKey = 'sk-or-caller-secret-do-not-log';
  process.env.OPENROUTER_HOUSE_RESALE_ENABLED = 'false';
  resetHubCatalogCache();
  resetOpenRouterPreflightCache();
  keyStatus = 200;
  chatStatus = 200;
  chatErrorBody = { error: { message: 'upstream down' } };
  upstreamHits.length = 0;
  const settlesBefore = settles;

  const listed = await fetch(`${base}/v1/models`);
  const models = await listed.json();
  const mini = models.data.find((m) => m.id === 'openrouter/openai/gpt-4o-mini');
  assert.equal(mini.access, 'byok');
  assert.equal(mini.pricing.basis, 'byok_receipt');
  assert.equal(mini.pricing.fee_bps, 0);
  const modelsHit = upstreamHits.find((h) => h.url.endsWith('/models'));
  assert.equal(modelsHit.authorization, undefined);

  const alias = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: pay('alias-nonce'),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  assert.equal(alias.status, 400);
  const aliasBody = await alias.json();
  assert.equal(aliasBody.error.code, 'model_not_routable');
  assert.equal(aliasBody.charged, false);
  assert.equal(settles, settlesBefore);
  assert.equal(
    upstreamHits.some((h) => h.url.endsWith('/chat/completions') && h.authorization === 'Bearer test-or-key'),
    false,
  );

  const chatBody = {
    model: 'openrouter/openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 32,
  };
  const unpaidMissing = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(unpaidMissing.status, 400);
  const unpaidMissingBody = await unpaidMissing.json();
  assert.equal(unpaidMissingBody.error.code, 'openrouter_key_required');
  assert.equal(unpaidMissingBody.charged, false);
  assert.equal(settles, settlesBefore);

  const missing = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: pay('missing-key-nonce'),
    body: JSON.stringify(chatBody),
  });
  assert.equal(missing.status, 400);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, 'openrouter_key_required');
  assert.equal(missingBody.charged, false);
  assert.equal(JSON.stringify(missingBody).includes('test-or-key'), false);
  assert.equal(settles, settlesBefore);

  const challengeRes = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openrouter-key': callerKey },
    body: JSON.stringify(chatBody),
  });
  assert.equal(challengeRes.status, 402);
  assert.equal(challengeRes.headers.get('x-chit-model-substituted'), null);
  const challenge = await challengeRes.json();
  assert.equal(challenge.accepts[0].maxAmountRequired, '2000');
  assert.equal(JSON.stringify(challenge).includes(callerKey), false);

  const strictChallenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-openrouter-key': callerKey,
      'x-chit-strict-model': 'true',
    },
    body: JSON.stringify(chatBody),
  });
  assert.equal(strictChallenge.status, 402, await strictChallenge.clone().text());
  assert.equal(strictChallenge.headers.get('x-chit-model-substituted'), null);
  assert.equal(settles, settlesBefore);

  upstreamHits.length = 0;
  const paid = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...pay(challenge.accepts[0].extra.nonce), 'x-openrouter-key': callerKey },
    body: JSON.stringify(chatBody),
  });
  const paidText = await paid.text();
  const paidBody = JSON.parse(paidText);
  assert.equal(paid.status, 200, paidText);
  assert.equal(settles, settlesBefore + 1);
  assert.equal(paidText.includes(callerKey), false);
  assert.equal(paidText.includes('test-or-key'), false);
  assert.equal(paidBody.model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(paidBody.chit.substituted, false);
  assert.equal(paidBody.chit.requested_model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(paidBody.chit.served_model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(paid.headers.get('x-chit-model-substituted'), null);
  assert.equal(paidBody.usage.prompt_tokens, 12);
  assert.equal(paidBody.xfuel.route.provider, 'openrouter');
  assert.equal(paidBody.xfuel.route.model, 'openrouter/openai/gpt-4o-mini');
  assert.equal(paidBody.xfuel.route.substituted, false);
  assert.equal(paidBody.xfuel.provider_cogs.basis, 'reported');
  assert.equal(paidBody.xfuel.provider_cogs.label, 'paid-by-caller-to-OpenRouter');
  assert.equal(paidBody.xfuel.provider_cogs.paid_by, 'caller-to-openrouter');
  assert.equal(paidBody.xfuel.provider_cogs.reported_cost_usd, '0.0000042');
  assert.equal(paidBody.xfuel.provider_cogs.actual ?? null, null);
  const chatHit = upstreamHits.find((h) => h.url.endsWith('/chat/completions'));
  assert.equal(chatHit.authorization, `Bearer ${callerKey}`);
  assert.equal(chatHit.body.user, openrouterEndUser({ payerWallet: EVM_PAYER }));
  assert.equal(JSON.stringify(chatHit.body).includes(callerKey), false);

  await openRouterReconcileSettled();
  const receiptRes = await fetch(`${base}/receipt/${paidBody.xfuel.task_id}?format=json`);
  const receipt = await receiptRes.json();
  assert.equal(receipt.provider_cogs.label, 'paid-by-caller-to-OpenRouter');
  assert.equal(receipt.provider_cogs.actual ?? null, null);
  assert.equal(receipt.provider_cogs.openrouter_generation.total_cost, '0.0000042');
  assert.equal(receipt.provider_cogs.openrouter_generation.label, 'paid-by-caller-to-OpenRouter');
  const generationHit = upstreamHits.find((h) => h.url.includes('/generation'));
  assert.equal(generationHit.authorization, `Bearer ${callerKey}`);

  chatStatus = 500;
  chatErrorBody = { error: { message: `rejected ${callerKey}` } };
  resetOpenRouterPreflightCache();
  const failChallenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openrouter-key': callerKey },
    body: JSON.stringify(chatBody),
  });
  const failNonce = (await failChallenge.json()).accepts[0].extra.nonce;
  const failed = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...pay(failNonce), 'x-openrouter-key': callerKey },
    body: JSON.stringify(chatBody),
  });
  const failedText = await failed.text();
  assert.equal(failed.status, 502, failedText);
  assert.equal(failedText.includes(callerKey), false);
  const failedBody = JSON.parse(failedText);
  assert.equal(failedBody.xfuel.refund.status, 'refund_owed');
  chatStatus = 200;
  chatErrorBody = { error: { message: 'upstream down' } };

  upstreamHits.length = 0;
  resetOpenRouterPreflightCache();
  const passChallenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${callerKey}` },
    body: JSON.stringify(chatBody),
  });
  assert.equal(passChallenge.status, 402);
  const passNonce = (await passChallenge.json()).accepts[0].extra.nonce;
  const passed = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...pay(passNonce), authorization: `Bearer ${callerKey}` },
    body: JSON.stringify(chatBody),
  });
  assert.equal(passed.status, 200, await passed.clone().text());
  const passHit = upstreamHits.find((h) => h.url.endsWith('/chat/completions'));
  assert.equal(passHit.authorization, `Bearer ${callerKey}`);
  assert.notEqual(passHit.authorization, 'Bearer test-or-key');
});
