/**
 * Tool calling through the real gateway against the real provider.
 * Unit tests use mocked fetch, so this is the only thing that proves the
 * passthrough actually works end to end. Throwaway probe.
 */
import 'dotenv/config';

const { createApp } = await import('../../services/gateway/src/server.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
      required: ['city'],
    },
  },
}];

const post = (body) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
  body: JSON.stringify(body),
});

const MODEL = process.argv[2] || 'xfuel/auto';

console.log(`gateway ${base}  model=${MODEL}\n`);

// 1. Does the default now resolve to Llama rather than GLM?
{
  const res = await post({ model: 'xfuel/auto', messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 16 });
  const body = await res.json();
  console.log(`1. xfuel/auto resolves to: ${body.model}`);
  console.log(`   provider: ${body.xfuel?.route?.provider ?? '?'}  status ${res.status}`);
}

// 2. Tool call out.
let toolCall;
{
  const res = await post({
    model: MODEL,
    messages: [{ role: 'user', content: 'What is the weather in Oslo right now? Use celsius.' }],
    tools: TOOLS,
    max_tokens: 512,
  });
  const body = await res.json();
  const choice = body.choices?.[0];
  toolCall = choice?.message?.tool_calls?.[0];
  console.log(`\n2. tool call  status ${res.status}  finish_reason=${choice?.finish_reason}`);
  if (toolCall) {
    console.log(`   ${toolCall.function.name}(${toolCall.function.arguments})`);
  } else {
    console.log(`   NO TOOL CALL — content: ${JSON.stringify(choice?.message?.content)?.slice(0, 120)}`);
    console.log(`   ${JSON.stringify(body.error ?? {}).slice(0, 200)}`);
  }
  // `output.hash` since /v1 converged on the canonical signed receipt — the flat
  // `output_hash` this used to read no longer exists on either surface.
  console.log(`   receipt output.hash: ${body.xfuel?.output?.hash?.slice(0, 18) ?? '(none)'}…`
    + `  signed: ${body.xfuel?.signature ? 'yes' : 'NO'}`);
}

// 3. Feed the result back — the multi-turn shape the old validator rejected.
if (toolCall) {
  const res = await post({
    model: MODEL,
    max_tokens: 512,
    messages: [
      { role: 'user', content: 'What is the weather in Oslo right now? Use celsius.' },
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: toolCall.id, content: '{"temp_c": -6, "conditions": "sleet"}' },
    ],
    tools: TOOLS,
  });
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content || '';
  const norm = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  console.log(`\n3. tool result → answer  status ${res.status}`);
  console.log(`   "${text.slice(0, 120)}"`);
  console.log(`   used the result: ${/-\s?6/.test(norm) && /sleet/i.test(norm) ? 'YES' : 'NO'}`);
}

// 4. Theta must refuse rather than silently drop the tools.
{
  const res = await post({
    model: 'theta/qwen3',
    messages: [{ role: 'user', content: 'weather in Oslo?' }],
    tools: TOOLS,
  });
  const body = await res.json();
  console.log(`\n4. theta + tools  status ${res.status}  code=${body.error?.code}`);
}

await new Promise((r) => server.close(r));
process.exit(0);
