/**
 * Can the *paid* surface run an agent loop?
 *
 * Tool calling shipped on `/v1`, but `/task-request` — the surface that takes the
 * USDC and returns the signed receipt — never accepted a `tools` array, so the
 * beachhead workload could only be run for free. This drives the real provider
 * through `/task-request` and checks the tool call survives the round trip, plus
 * that `xfuel/auto` picks the loop-capable model when tools are present.
 */
import 'dotenv/config';

process.env.RECEIPT_SIGNING_SECRET ||= 'probe-secret';

const { createApp } = await import('../../services/gateway/src/server.js');
const { initAIListener } = await import('../../services/gateway/src/ai-listener.js');

await initAIListener();
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_invoice_total',
    description: 'Return the total of an invoice by id.',
    parameters: {
      type: 'object',
      properties: { invoice_id: { type: 'string' } },
      required: ['invoice_id'],
    },
  },
}];

async function submit(body) {
  const res = await fetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      ...body,
    }),
  });
  const accepted = await res.json();
  if (!accepted.task_id) return { error: accepted };

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await (await fetch(`${base}/task-status?task_id=${accepted.task_id}`, {
      headers: { 'x-api-key': 'xfuel-demo' },
    })).json();
    if (['completed', 'failed', 'fee_collected'].includes(s.status)) return s;
  }
  return { error: 'timeout' };
}

// 1. Turn one: ask for the tool.
const first = await submit({
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'What is the total on invoice INV-42? Use the tool.' }],
  tools: TOOLS,
  tool_choice: 'auto',
  max_tokens: 512,
});
const call = first.result?.tool_calls?.[0];
console.log(`turn 1 model:      ${first.result?.model || first.error?.code || first.status}`);
console.log(`turn 1 tool call:  ${call ? `${call.function.name}(${call.function.arguments})` : 'NONE'}`);

// 2. Turn two: feed the result back and see the loop close.
if (call) {
  const second = await submit({
    model_id: 'xfuel/auto',
    messages: [
      { role: 'user', content: 'What is the total on invoice INV-42? Use the tool.' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, content: '{"invoice_id":"INV-42","total_usd":1284.50}' },
    ],
    tools: TOOLS,
    max_tokens: 512,
  });
  console.log(`turn 2 model:      ${second.result?.model || second.error?.code || second.status}`);
  console.log(`turn 2 answer:     ${(second.result?.content || '').slice(0, 160).replace(/\s+/g, ' ')}`);
  console.log(`loop closed:       ${/1,?284/.test(second.result?.content || '') ? 'YES' : 'NO'}`);
}

// 3. A plain completion must not be dragged onto the reasoning model.
const plain = await submit({
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Reply with the single word PONG.' }],
  max_tokens: 16,
});
console.log(`\nno-tools model:    ${plain.result?.model || plain.error?.code || plain.status}`);
console.log(`no-tools answer:   ${JSON.stringify((plain.result?.content || '').slice(0, 60))}`);

await new Promise((r) => server.close(r));
process.exit(0);
