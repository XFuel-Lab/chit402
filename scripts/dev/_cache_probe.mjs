/**
 * Does AkashML actually cache repeated prefixes, and does it tell us?
 *
 * Our COGS model assumes cached input bills at ~10% of the fresh rate, which is
 * OpenAI/Anthropic convention — not necessarily an open-weight host's. This
 * sends the same long prefix twice with a different one-line suffix (the agent
 * pattern) and reports latency plus the full usage block.
 *
 * Reading it:
 *   usage.prompt_tokens_details.cached_tokens > 0 on call 2  → caching reported
 *   call 2 much faster, cached_tokens absent                 → caching happening, not reported
 *   identical latency, no cached_tokens                      → no prefix cache on this route
 *
 * Throwaway diagnostic. Costs a few tenths of a cent.
 */

import 'dotenv/config';

const KEY = (process.env.AKASHML_API_KEY || '').trim();
const BASE = (process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1').replace(/\/$/, '');
const MODEL = process.argv[2] || process.env.AKASHML_DEFAULT_MODEL || 'zai-org/GLM-5.2';
const PREFIX_TOKENS = Number(process.argv[3] || 8000);

if (!KEY) {
  console.error('AKASHML_API_KEY not set');
  process.exit(1);
}

/** Prose rather than repeated filler — a degenerate prompt can hit unrelated fast paths. */
function buildPrefix(targetTokens) {
  const para = 'The gateway records each settled task with a signed receipt naming the provider '
    + 'that actually served the request, the model resolved, and the tokens billed. '
    + 'Auditors reconcile these against the on-chain payment reference. ';
  const need = Math.ceil((targetTokens * 4) / para.length);
  const lines = [];
  for (let i = 0; i < need; i += 1) lines.push(`Record ${i}. ${para}`);
  return lines.join('\n');
}

const prefix = buildPrefix(PREFIX_TOKENS);

async function call(label, suffix) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: prefix },
      { role: 'user', content: suffix },
    ],
    max_tokens: 2000,
    temperature: 0,
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} in ${elapsed}ms — ${text.slice(0, 300)}`);
    return null;
  }
  const data = JSON.parse(text);
  const usage = data.usage || {};
  console.log(`\n${label}  (${elapsed}ms)`);
  console.log('  usage:', JSON.stringify(usage));
  console.log('  finish_reason:', data.choices?.[0]?.finish_reason);
  const content = data.choices?.[0]?.message?.content;
  console.log('  content:', JSON.stringify((content || '').slice(0, 60)));
  return { elapsed, usage };
}

console.log(`model=${MODEL}  prefix≈${PREFIX_TOKENS} tokens (${prefix.length} chars)`);

const a = await call('call 1 — cold prefix', 'Reply with exactly one word: ALPHA');
// Back to back: a busy multi-tenant server may evict the prefix within seconds.
const b = await call('call 2 — same prefix, different suffix', 'Reply with exactly one word: BETA');
await new Promise((r) => setTimeout(r, 30_000));
const c = await call('call 3 — same prefix, 30s later', 'Reply with exactly one word: GAMMA');

console.log('\n─── verdict ───');
const cachedOn = (u) => u?.prompt_tokens_details?.cached_tokens
  ?? u?.cached_tokens
  ?? u?.prompt_cache_hit_tokens
  ?? null;

for (const [label, r] of [['call 1', a], ['call 2', b], ['call 3', c]]) {
  if (!r) continue;
  const cached = cachedOn(r.usage);
  console.log(`${label}: ${r.elapsed}ms, prompt_tokens=${r.usage.prompt_tokens}, cached=${cached === null ? 'NOT REPORTED' : cached}`);
}

if (a && b) {
  const delta = ((a.elapsed - b.elapsed) / a.elapsed) * 100;
  console.log(`\nlatency change call 1 → call 2: ${delta.toFixed(1)}% faster`);
  console.log(cachedOn(b.usage)
    ? 'Cached tokens ARE reported — billing discount is then a pricing-page question.'
    : 'No cached-token field. Either no prefix cache on this route, or it is invisible to us —\n'
      + 'and a saving we cannot see is a saving we cannot bill against or prove in a receipt.');
}
