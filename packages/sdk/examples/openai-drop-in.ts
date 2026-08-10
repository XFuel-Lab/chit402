/**
 * XFuel — OpenAI-compatible drop-in.
 *
 * XFuel exposes the standard OpenAI surface (`/v1/models`,
 * `/v1/chat/completions`). Any OpenAI-compatible client works by swapping ONE
 * thing — the base URL — and every response carries a verifiable-compute
 * receipt (in the `xfuel` field and in `x-xfuel-*` response headers).
 *
 * This example is intentionally dependency-free (uses `fetch`) so it runs with
 * just `tsx`. The one-line swaps for popular clients are shown at the bottom.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   # 1. Start the XFuel backend (backend/theta-bridge):  node src/server.js
 *   #    (set THETA_EDGECLOUD_API_KEY for real compute; otherwise you get a
 *   #     clearly-labelled mock — the receipt says compute.real=false.)
 *   # 2. From packages/sdk:
 *   #      XFUEL_API_URL=http://localhost:3002 \
 *   #      XFUEL_API_KEY=your-key \
 *   #      npx tsx examples/openai-drop-in.ts
 */

const {
  XFUEL_API_URL = 'https://api-testnet.xfuel.app', // hosted testnet demo; override with http://localhost:3002 for local dev
  XFUEL_API_KEY = 'xfuel-demo', // shared public demo key (rate-limited); bring your own for higher limits
  // Resolves to the best live chat model in the hub catalog. GET /v1/models lists
  // the concrete ids (e.g. theta/glm_5_2) — retired names are rejected, not remapped.
  XFUEL_MODEL = 'xfuel/auto',
} = process.env;

const baseURL = `${XFUEL_API_URL.replace(/\/$/, '')}/v1`;

async function listModels() {
  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${XFUEL_API_KEY}` },
  });
  const body = await res.json();
  console.log('Models:', body.data.map((m: { id: string }) => m.id).join(', '));
}

async function chat() {
  console.log('\nPOST /v1/chat/completions (non-streaming)…');
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${XFUEL_API_KEY}`,
    },
    body: JSON.stringify({
      model: XFUEL_MODEL,
      messages: [{ role: 'user', content: 'Explain ZK proofs in one sentence.' }],
    }),
  });

  const body = await res.json();
  console.log('  answer     :', body.choices[0].message.content);

  // The verification receipt is available two ways: response headers…
  console.log('\n  ── XFuel receipt (headers) ──');
  console.log('  task-id      :', res.headers.get('x-xfuel-task-id'));
  console.log('  provider     :', res.headers.get('x-xfuel-provider'));
  console.log('  compute-real :', res.headers.get('x-xfuel-compute-real'));
  console.log('  proof-status :', res.headers.get('x-xfuel-proof-status'));

  // …and the `xfuel` extension object on the JSON body (ignored by strict clients).
  console.log('\n  ── XFuel receipt (body.xfuel) ──');
  console.log('  compute      :', JSON.stringify(body.xfuel.compute));
  console.log('  proof.attests:', body.xfuel.proof.attests);
  console.log('  verify at    :', `${XFUEL_API_URL}${body.xfuel.proof.links.proof}`);
}

async function chatStreaming() {
  console.log('\nPOST /v1/chat/completions (stream:true)…');
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${XFUEL_API_KEY}`,
    },
    body: JSON.stringify({
      model: XFUEL_MODEL,
      stream: true,
      messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
    }),
  });

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  process.stdout.write('  streamed: ');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) process.stdout.write(delta);
      } catch {
        /* skip non-JSON keepalive / event lines */
      }
    }
  }
  process.stdout.write('\n');
}

async function main() {
  await listModels();
  await chat();
  await chatStreaming();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});

/*
 ─── One-line swaps for popular clients ───────────────────────────────────────

 OpenAI SDK (Node):
   import OpenAI from 'openai';
   const openai = new OpenAI({ baseURL: `${process.env.XFUEL_API_URL}/v1`, apiKey: process.env.XFUEL_API_KEY });
   const r = await openai.chat.completions.create({ model: 'xfuel/auto', messages: [...] });
   // r.xfuel carries the verification receipt (cast to any — it's an XFuel extension)

 Vercel AI SDK:
   import { createOpenAI } from '@ai-sdk/openai';
   const xfuel = createOpenAI({ baseURL: `${process.env.XFUEL_API_URL}/v1`, apiKey: process.env.XFUEL_API_KEY });
   const { text } = await generateText({ model: xfuel('xfuel/auto'), prompt: '...' });

 LangChain:
   import { ChatOpenAI } from '@langchain/openai';
   const model = new ChatOpenAI({ model: 'xfuel/auto', configuration: { baseURL: `${process.env.XFUEL_API_URL}/v1` }, apiKey: process.env.XFUEL_API_KEY });
*/
