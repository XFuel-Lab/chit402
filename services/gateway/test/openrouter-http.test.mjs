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
  const url = req.url || '';
  upstreamHits.push({
    url,
    referer: req.headers['http-referer'],
    title: req.headers['x-title'],
  });
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

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetFloatManagerForTests } = await import('../src/provider-float.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { resetOpenRouterPreflightCache } = await import('../src/openrouter-infer.js');
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
  assert.equal(unknownBody.error.code, 'model_not_found');
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
  assert.equal(paidBody.xfuel.route_meta.requested_model, 'gpt-4o-mini');
  assert.equal(paidBody.xfuel.provider_cogs.actual, '5');
  assert.equal(paidBody.xfuel.provider_cogs.basis, 'measured');
  assert.equal(paidBody.xfuel.status, 'completed');
  for (const suffix of ['/models', '/key', '/chat/completions']) {
    const hit = upstreamHits.find((h) => h.url.includes('/openrouter/') && h.url.endsWith(suffix));
    assert.ok(hit, `missing upstream ${suffix}`);
    assert.equal(hit.referer, 'https://chit402.com');
    assert.equal(hit.title, 'Chit402');
  }

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
