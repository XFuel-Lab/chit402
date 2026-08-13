/**
 * Does the PAID path actually serve real compute? Throwaway probe.
 *
 * /v1 (free) routes to AkashML by hub. /task-request (paid) reaches AkashML only
 * via an explicit preferred_provider — the ComputeRouter's tier list does not
 * include AkashML at all. This checks what a paying caller gets by default.
 */
import 'dotenv/config';

const { initAIListener } = await import('../../services/gateway/src/ai-listener.js');
await initAIListener();
const { createApp } = await import('../../services/gateway/src/server.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function run(label, extra) {
  const res = await fetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'xfuel/auto',
      messages: [{ role: 'user', content: 'Reply with exactly one word: PING' }],
      max_tokens: 64,
      ...extra,
    }),
  });
  const { task_id: id } = await res.json();
  if (!id) return console.log(`${label}: request rejected`);

  let receipt;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 750));
    receipt = await (await fetch(`${base}/receipt/${id}?format=json`)).json();
    if (receipt?.status === 'completed' || receipt?.status === 'failed') break;
  }
  const status = await (await fetch(`${base}/task-status?task_id=${id}`)).json();
  const content = status?.result?.content ?? status?.result?.output ?? null;
  console.log(`${label}`);
  console.log(`   status:      ${status?.status}`);
  console.log(`   model:       ${status?.result?.model ?? '(none)'}`);
  console.log(`   provider:    ${receipt?.route?.provider}`);
  console.log(`   compute.real: ${receipt?.compute?.real ?? '(n/a)'}   mock: ${!!status?.result?.mock}`);
  console.log(`   content:     ${content ? JSON.stringify(String(content).slice(0, 60)) : '(none — mock has no text)'}`);
  console.log(`   cogs basis:  ${receipt?.provider_cogs?.basis ?? '(none)'}\n`);
}

console.log(`AKASHML key present: ${!!process.env.AKASHML_API_KEY}\n`);
await run('1. default (no preferred_provider) — what a normal paying caller sends', {});
await run('2. preferred_provider = akash-network', { preferred_provider: 'akash-network' });
await run('3. explicit hub-prefixed model', { model_id: 'akash/openai/gpt-oss-120b' });
await run('4. model nobody serves — must fail, not mock', { model_id: 'acme/does-not-exist' });

await new Promise((r) => server.close(r));
process.exit(0);
