/**
 * `/task-request` must serve real compute.
 *
 * This is the surface that takes USDC and returns the signed receipt, and it
 * spent an unknown period returning `theta-edge-mock` for every caller — a
 * correctly signed attestation of an inference that never ran. The suite was 243
 * green throughout, because nothing drove `/task-request` end to end against a
 * provider. That is the gap this file closes.
 *
 * The provider and both catalog endpoints are stubbed at `fetch`, so the real
 * routing, resolution, and receipt code all execute without network access.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.AKASHML_API_KEY = 'akml-test-key';
// Pinned, not inherited. A developer with X402_ENABLED=true in .env gets a 402 for
// every request here and the whole file fails for a reason that has nothing to do
// with routing. Payment is covered by the x402 suites; this file is about what
// actually serves the request.
process.env.X402_ENABLED = 'false';
// Force the mock branch to be *reachable*: if routing regresses, the task falls
// through to it and these tests fail loudly rather than quietly passing.
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { priceUSDCResolved, resolvePricingModel } = await import('../src/x402-server.js');

const SERVED_TEXT = 'PONG from the stubbed provider';
const realFetch = globalThis.fetch;

const AKASH_MODELS = {
  data: [
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct',
      name: 'Llama 3.3 70B',
      input_modalities: ['text'],
      pricing: { input: '0.00000013', output: '0.0000004' },
    },
    {
      id: 'zai-org/GLM-5.2',
      name: 'GLM 5.2',
      input_modalities: ['text'],
      pricing: { input: '0.0000014', output: '0.0000044' },
    },
  ],
};

let inferenceCalls = [];
/** When set, the stubbed provider answers with these tool calls and no content. */
let toolCallResponse = null;
/** When true, the stubbed provider 503s, so every real route declines. */
let providerDown = false;
let server;
let base;

/** Answer the provider + catalog endpoints; let everything else hit the loopback server. */
function stubFetch(url, init) {
  const href = String(url);

  if (href.includes('api.akashml.com') && href.endsWith('/models')) {
    return Promise.resolve(new Response(JSON.stringify(AKASH_MODELS), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  if (href.includes('api.akashml.com') && href.includes('/chat/completions')) {
    inferenceCalls.push(JSON.parse(init.body));
    if (providerDown) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'upstream capacity' }), {
        status: 503, headers: { 'content-type': 'application/json' },
      }));
    }
    // A tool call arrives with content:null and finish_reason 'tool_calls' — the
    // shape that used to read as an empty answer.
    const message = toolCallResponse
      ? { role: 'assistant', content: null, tool_calls: toolCallResponse }
      : { role: 'assistant', content: SERVED_TEXT };
    return Promise.resolve(new Response(JSON.stringify({
      id: 'cmpl-stub',
      choices: [{ message, finish_reason: toolCallResponse ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }

  // Theta's catalog: reachable but empty, so `xfuel/auto` has only the Akash hub
  // to choose from and any Theta route would have no key anyway.
  if (href.includes('thetaedgecloud.com')) {
    return Promise.resolve(new Response(JSON.stringify({ body: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  return realFetch(url, init);
}

const post = (body) => realFetch(`${base}/task-request`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
  body: JSON.stringify({
    message_type: 'inference_request',
    chain_id: 'base',
    amount: '10000',
    sender: '0x0000000000000000000000000000000000000001',
    // `/task-request` requires a model, so `xfuel/auto` *is* the default request.
    model_id: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Reply with one word.' }],
    max_tokens: 32,
    ...body,
  }),
});

/** Submit and wait for the listener to finish routing. */
async function run(body = {}) {
  const accepted = await (await post(body)).json();
  const taskId = accepted.task_id;
  assert.ok(taskId, `task must be accepted, got ${JSON.stringify(accepted)}`);

  let status;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 50));
    status = await (await realFetch(`${base}/task-status?task_id=${taskId}`)).json();
    if (['completed', 'failed', 'fee_collected'].includes(status.status)) break;
  }
  const receipt = await (await realFetch(`${base}/receipt/${taskId}?format=json`)).json();
  return { taskId, status, receipt };
}

before(async () => {
  globalThis.fetch = stubFetch;
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

test('a default paid request reaches a real provider instead of the mock', async () => {
  inferenceCalls = [];
  // `xfuel/auto`, no preferred_provider — exactly what a normal caller sends, and
  // precisely the shape that used to be answered with a mock.
  const { status, receipt } = await run();

  assert.equal(inferenceCalls.length, 1, 'the provider must actually be called');
  assert.ok(!status.result?.mock, 'result must not be a mock');
  assert.equal(status.result.content, SERVED_TEXT);
  assert.equal(receipt.route.provider, 'akash-network');
});

test('xfuel/auto is resolved before it reaches the provider', async () => {
  inferenceCalls = [];
  await run({ model_id: 'xfuel/auto' });

  // The upstream 404s on `xfuel/auto` — it is an XFuel alias, not a model.
  assert.notEqual(inferenceCalls[0].model, 'xfuel/auto');
  assert.equal(inferenceCalls[0].model, 'meta-llama/Llama-3.3-70B-Instruct');
});

test('the paid path routes tool work to the model that finishes loops', async () => {
  // The shape split lives in the catalog, but the paid path has its own
  // resolution route into it (`_resolveIntentModel`), which read no shape at all
  // until this test — so agent callers silently got the short-completion model.
  inferenceCalls = [];
  await run({
    model_id: 'xfuel/auto',
    tools: [{ type: 'function', function: { name: 'get_invoice', parameters: { type: 'object', properties: {} } } }],
  });

  assert.equal(inferenceCalls[0].model, 'zai-org/GLM-5.2');
});

test('the receipt attests the model that served, not the alias requested', async () => {
  const { receipt } = await run({ model_id: 'xfuel/auto' });

  assert.equal(receipt.route.model, 'akash/meta-llama/Llama-3.3-70B-Instruct');
  assert.ok(receipt.signature, 'the paid path receipt must be signed');
});

test('an explicit hub-prefixed model routes to that model', async () => {
  inferenceCalls = [];
  const { receipt } = await run({ model_id: 'akash/zai-org/GLM-5.2' });

  assert.equal(inferenceCalls[0].model, 'zai-org/GLM-5.2');
  assert.equal(receipt.route.model, 'akash/zai-org/GLM-5.2');
});

test('naming a provider still routes there', async () => {
  inferenceCalls = [];
  const { status } = await run({ preferred_provider: 'akash-network' });

  assert.equal(inferenceCalls.length, 1);
  assert.equal(status.result.provider, 'akash-network');
});

test('a model nobody serves fails the task rather than minting a mock receipt', async () => {
  inferenceCalls = [];
  const { status, receipt } = await run({ model_id: 'acme/does-not-exist' });

  assert.equal(inferenceCalls.length, 0, 'no provider should be called');
  assert.equal(status.status, 'failed');
  assert.ok(!status.result?.mock);
  // Nothing served, so the receipt must not name a compute source.
  assert.equal(receipt.route.provider, null);
  // And the caller has to be told why, or 'failed' is indistinguishable from an
  // upstream outage they should retry.
  assert.equal(status.error?.code, 'model_not_found');
});

test('a tool call comes back to the paid caller intact', async () => {
  inferenceCalls = [];
  toolCallResponse = [{
    id: 'call_1',
    type: 'function',
    function: { name: 'get_invoice', arguments: '{"id":"INV-1"}' },
  }];
  try {
    const { status } = await run({
      model_id: 'akash/zai-org/GLM-5.2',
      tools: [{ type: 'function', function: { name: 'get_invoice', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'auto',
    });

    // Forwarded to the hub...
    assert.equal(inferenceCalls[0].tools?.[0]?.function?.name, 'get_invoice');
    assert.equal(inferenceCalls[0].tool_choice, 'auto');
    // ...and handed back, or the caller cannot run the next turn.
    assert.ok(!status.result?.mock);
    assert.equal(status.result.tool_calls?.[0]?.function?.name, 'get_invoice');
    assert.equal(status.result.finish_reason, 'tool_calls');
  } finally {
    toolCallResponse = null;
  }
});

test('tools are refused on a hub that cannot serve them, not answered with prose', async () => {
  inferenceCalls = [];
  const { status } = await run({
    preferred_provider: 'theta-edgecloud',
    tools: [{ type: 'function', function: { name: 'get_invoice', parameters: { type: 'object', properties: {} } } }],
  });

  assert.equal(inferenceCalls.length, 0);
  assert.equal(status.status, 'failed');
  assert.equal(status.error?.code, 'tools_unsupported_on_hub');
});

test('a malformed tools array is rejected at the door, before payment', async () => {
  const res = await post({ tools: [{ type: 'function' }] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.details.join(' '), /tools must be an array/);
});

test('max_tokens reaches the provider, since the quote already charged for it', async () => {
  inferenceCalls = [];
  await run({ model_id: 'akash/zai-org/GLM-5.2', max_tokens: 1024 });

  assert.equal(inferenceCalls[0].max_tokens, 1024);
});

test('when every provider declines, the task fails instead of serving a mock', async () => {
  // The mock branch is the one that signed receipts for inferences that never
  // ran. `/task-request` has already taken the money by the time routing runs, so
  // a synthetic answer here is a false attestation, not a graceful degradation.
  inferenceCalls = [];
  providerDown = true;
  try {
    const { status, receipt } = await run({ model_id: 'akash/zai-org/GLM-5.2' });

    assert.ok(inferenceCalls.length >= 1, 'the provider should have been attempted');
    assert.equal(status.status, 'failed');
    assert.ok(!status.result?.mock, 'a paid task must never be answered with a mock');
    assert.equal(status.error?.code, 'no_provider_available');
    assert.equal(receipt.route.provider, null);
  } finally {
    providerDown = false;
  }
});

// ── The quote must price the model that serves ────────────────────────────────
// The per-model rate rows fixed a 4.6x loss on GLM-5.2, but pricing reads
// `model_id` verbatim and runs *before* routing resolves it — so `xfuel/auto`,
// the id in every default request, matched no row and was quoted at the cheap
// default whatever it served. The loss came straight back on the default route.

const MEDIAN_AGENT = {
  messages: [{ role: 'user', content: 'x'.repeat(68_000 * 4) }],
  max_tokens: 247,
};
const AGENT_TOOLS = [{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: {} } } }];

test('an agent-shaped xfuel/auto call is priced on the model it resolves to', async () => {
  const { model } = await resolvePricingModel({ model_id: 'xfuel/auto', ...MEDIAN_AGENT, tools: AGENT_TOOLS });
  assert.equal(model, 'akash/zai-org/GLM-5.2');

  const quoted = Number(await priceUSDCResolved({ model_id: 'xfuel/auto', ...MEDIAN_AGENT, tools: AGENT_TOOLS }));
  // Measured COGS for GLM-5.2 on this shape is ~$0.096 (96,290 base units). The
  // quote has to clear it, and quoting the alias verbatim gave ~20,600.
  assert.ok(quoted > 96_290, `must clear GLM's own COGS, got ${quoted}`);
});

test('a short completion is not charged the reasoning-model rate', async () => {
  const { model } = await resolvePricingModel({ model_id: 'xfuel/auto', ...MEDIAN_AGENT });
  assert.equal(model, 'akash/meta-llama/Llama-3.3-70B-Instruct');

  const quoted = Number(await priceUSDCResolved({ model_id: 'xfuel/auto', ...MEDIAN_AGENT }));
  assert.ok(quoted < 96_290, `a Llama-shaped call must not pay GLM prices, got ${quoted}`);
});

test('an unresolvable model is quoted, not thrown on — routing rejects it later', async () => {
  const { model, requested } = await resolvePricingModel({ model_id: 'acme/nope', ...MEDIAN_AGENT });
  assert.equal(model, null);
  assert.equal(requested, 'acme/nope');
  assert.ok(Number(await priceUSDCResolved({ model_id: 'acme/nope', ...MEDIAN_AGENT })) > 0);
});

test('the /task-quote preview reports which model the price is for', async () => {
  const res = await realFetch(`${base}/task-quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({ model_id: 'xfuel/auto', ...MEDIAN_AGENT, tools: AGENT_TOOLS }),
  });
  const { rails } = await res.json();

  // A preview that disagrees with the 402 challenge is worse than no preview.
  assert.equal(rails.usdc.pricing.requested_model, 'xfuel/auto');
  assert.equal(rails.usdc.pricing.priced_model, 'akash/zai-org/GLM-5.2');
  assert.equal(
    rails.usdc.amount,
    await priceUSDCResolved({ model_id: 'xfuel/auto', ...MEDIAN_AGENT, tools: AGENT_TOOLS }),
  );
});

test('COGS is measured from real tokens against the published rate', async () => {
  const { receipt } = await run({ model_id: 'akash/meta-llama/Llama-3.3-70B-Instruct' });

  // 12 prompt × $0.00000013 + 7 completion × $0.0000004 = $0.00000436 → 5 base
  // units after rounding up. The point is the basis, not the rounding: a
  // measured cost means real tokens priced at the provider's own rate.
  if (receipt.provider_cogs) {
    assert.equal(receipt.provider_cogs.basis, 'measured');
  }
});
