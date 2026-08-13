/**
 * Two things at once:
 *   1. Does openai/gpt-oss-120b actually serve? At $0.037/M input it is 3.5x
 *      cheaper than the Llama 3.3 70B our COGS model is built on.
 *   2. GLM-5.2 publishes a cache-read rate ($0.26/M vs $1.40/M input) yet the
 *      first probe saw no `cached_tokens`. Dump the whole response body, not
 *      just `usage`, to find out whether the discount is reported anywhere.
 *
 * A discount we cannot observe is one we cannot verify, bill against, or put
 * in a receipt.
 */

import 'dotenv/config';

const KEY = (process.env.AKASHML_API_KEY || '').trim();
const BASE = 'https://api.akashml.com/v1';

function prefixOf(n = 12000) {
  const para = 'Settlement records are reconciled against the on-chain payment reference each cycle. ';
  return Array.from({ length: Math.ceil((n * 4) / para.length) }, (_, i) => `Row ${i}. ${para}`).join('\n');
}
const PREFIX = prefixOf();

async function call(model, word) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: PREFIX },
        { role: 'user', content: `Reply with exactly one word: ${word}` },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 300), elapsed };
  const data = JSON.parse(text);
  // Any cache signal, wherever the provider chose to put it.
  const headerCache = {};
  for (const [k, v] of res.headers.entries()) {
    if (/cache|prompt.token/i.test(k)) headerCache[k] = v;
  }
  return {
    ok: true,
    elapsed,
    usage: data.usage,
    topLevelKeys: Object.keys(data),
    headerCache,
    content: (data.choices?.[0]?.message?.content || '').slice(0, 40),
  };
}

for (const model of ['openai/gpt-oss-120b', 'zai-org/GLM-5.2']) {
  console.log(`\n═══ ${model} ═══`);
  const a = await call(model, 'ALPHA');
  if (!a.ok) { console.log(`  FAILED ${a.status}: ${a.detail}`); continue; }
  const b = await call(model, 'BETA');

  for (const [label, r] of [['cold ', a], ['warm ', b]]) {
    console.log(`  ${label} ${String(r.elapsed).padStart(5)}ms  usage=${JSON.stringify(r.usage)}`);
    if (Object.keys(r.headerCache).length) console.log(`         cache headers: ${JSON.stringify(r.headerCache)}`);
  }
  console.log(`  response keys: ${a.topLevelKeys.join(', ')}`);
  console.log(`  output: ${JSON.stringify(a.content)}`);

  const reported = b.usage?.prompt_tokens_details?.cached_tokens ?? b.usage?.cached_tokens ?? null;
  const faster = ((a.elapsed - b.elapsed) / a.elapsed) * 100;
  console.log(`  → repeat ${faster.toFixed(0)}% faster; cached_tokens ${reported === null ? 'NOT REPORTED' : reported}`);
}

// Cost of the measured median agent call: 68,000 in / 247 out, no caching.
console.log('\n═══ median agent call, 68k in / 247 out, uncached ═══');
for (const [name, i, o] of [
  ['meta-llama/Llama-3.3-70B-Instruct', 0.13, 0.40],
  ['openai/gpt-oss-120b', 0.037, 0.49],
  ['deepseek-ai/DeepSeek-V4-Flash-0731', 0.14, 0.28],
]) {
  const cost = (68000 * i + 247 * o) / 1e6;
  console.log(`  ${name.padEnd(38)} $${cost.toFixed(5)}`);
}
