import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.AKASHML_API_KEY = 'akml-test-key';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { inferAkashML } = await import('../src/akashml-infer.js');

let server;
let base;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Weather for a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
}];

const post = (body, headers = {}) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo', ...headers },
  body: JSON.stringify(body),
});

before(async () => {
  resetHubCatalogCache();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

// ── adapter ──────────────────────────────────────────────────────────────────

test('the adapter forwards tool definitions upstream', async () => {
  let sent;
  const fetchFn = async (_url, opts) => {
    sent = JSON.parse(opts.body);
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }] } }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }), { status: 200 });
  };

  const r = await inferAkashML({
    model: 'm', messages: [{ role: 'user', content: 'weather?' }],
    tools: TOOLS, tool_choice: 'auto', apiKey: 'akml-x', fetchFn,
  });

  assert.deepEqual(sent.tools, TOOLS);
  assert.equal(sent.tool_choice, 'auto');
  assert.equal(r.ok, true, 'a tool call is a success, not an empty output');
  assert.equal(r.toolCalls[0].function.name, 'get_weather');
});

test('a tool call is not mistaken for an empty output', async () => {
  // This was the second half of the bug: even with `tools` forwarded, a response
  // whose content is null by design was reported as `empty_output` and failed over.
  const fetchFn = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] } }],
  }), { status: 200 });

  const r = await inferAkashML({
    model: 'm', messages: [{ role: 'user', content: 'x' }], tools: TOOLS, apiKey: 'akml-x', fetchFn,
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.reason, 'empty_output');
});

test('a genuinely empty response is still a failure', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '' } }],
  }), { status: 200 });

  const r = await inferAkashML({ model: 'm', messages: [{ role: 'user', content: 'x' }], apiKey: 'akml-x', fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_output');
});

test('no tools means no tools field — an empty array is not sent', async () => {
  let sent;
  const fetchFn = async (_u, opts) => {
    sent = JSON.parse(opts.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
  };
  await inferAkashML({ model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [], apiKey: 'akml-x', fetchFn });
  assert.equal(sent.tools, undefined);
  assert.equal(sent.tool_choice, undefined);
});

// ── gateway request validation ───────────────────────────────────────────────

test('an assistant turn with tool_calls and null content is accepted', async () => {
  // Requiring a string `content` on every message made a multi-turn agent loop
  // impossible to express, which is the shape every tool-using agent sends.
  const res = await post({
    model: 'theta/qwen3',
    messages: [
      { role: 'user', content: 'weather in Oslo?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"temp_c":-6}' },
    ],
    max_tokens: 32,
  });
  assert.notEqual(res.status, 400, await res.text());
});

test('a message with neither content nor tool_calls is still rejected', async () => {
  const res = await post({
    model: 'theta/qwen3',
    messages: [{ role: 'user' }],
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.param, 'messages');
});

test('a malformed tools array is rejected rather than forwarded', async () => {
  for (const tools of [[{ type: 'function' }], [{ name: 'x' }], 'nope']) {
    const res = await post({ model: 'theta/qwen3', messages: [{ role: 'user', content: 'x' }], tools });
    assert.equal(res.status, 400, `should reject ${JSON.stringify(tools)}`);
    assert.equal((await res.json()).error.param, 'tools');
  }
});

test('streaming with tools is refused, not silently answered as prose', async () => {
  const res = await post({
    model: 'akash/zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'weather?' }],
    tools: TOOLS,
    stream: true,
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'stream_tools_unsupported');
});

test('asking a Theta model for tools fails loudly — its API has no tools param', async () => {
  // Forwarding would drop them and return prose where a structured call was expected.
  const res = await post({
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'weather in Oslo?' }],
    tools: TOOLS,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'tools_unsupported_on_hub');
  assert.match(body.error.message, /xfuel\/auto/, 'should point at auto-routing for tool support');
  assert.match(body.error.message, /GET \/v1\/models/, 'should point at catalog');
});
