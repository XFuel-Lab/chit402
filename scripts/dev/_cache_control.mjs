/**
 * Control for _cache_probe.mjs.
 *
 * The first probe showed a repeated prefix returning 37% faster, but that is
 * also what connection warm-up looks like. This alternates two unrelated
 * prefixes: A, A, B, A. If the speed-up follows the *prefix* rather than the
 * call order, it is a prefix cache. If everything after call 1 is fast, it was
 * warm-up and there is no cache to route around.
 */

import 'dotenv/config';

const KEY = (process.env.AKASHML_API_KEY || '').trim();
const BASE = (process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1').replace(/\/$/, '');
const MODEL = process.argv[2] || 'zai-org/GLM-5.2';

if (!KEY) { console.error('AKASHML_API_KEY not set'); process.exit(1); }

function prefixOf(theme, n = 8000) {
  const para = `${theme} Each entry is logged, reconciled, and retained for audit purposes. `;
  const need = Math.ceil((n * 4) / para.length);
  return Array.from({ length: need }, (_, i) => `Entry ${i}. ${para}`).join('\n');
}

const A = prefixOf('Settlement ledger for verifiable compute receipts on Base.');
const B = prefixOf('Warehouse inventory manifest for perishable produce in transit.');

async function call(label, prefix, word) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: prefix },
        // Force a fixed, tiny completion so latency reflects prefill, not decode.
        { role: 'user', content: `Reply with exactly one word: ${word}` },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });
  const elapsed = Date.now() - t0;
  const data = JSON.parse(await res.text());
  const u = data.usage || {};
  console.log(`${label.padEnd(28)} ${String(elapsed).padStart(5)}ms  prompt=${u.prompt_tokens} completion=${u.completion_tokens}`);
  return { elapsed, completion: u.completion_tokens };
}

console.log(`model=${MODEL}\n`);
const r = [];
r.push(await call('1. prefix A (cold)', A, 'ALPHA'));
r.push(await call('2. prefix A (repeat)', A, 'BETA'));
r.push(await call('3. prefix B (new, cold)', B, 'GAMMA'));
r.push(await call('4. prefix A (still cached?)', A, 'DELTA'));

console.log('\n─── reading ───');
const [a1, a2, b1, a3] = r;
const sameLen = new Set(r.map((x) => x.completion)).size === 1;
if (!sameLen) console.log('NOTE: completion lengths differ, so latency is not a clean comparison.');
console.log(`A cold ${a1.elapsed}ms → A repeat ${a2.elapsed}ms  (${(((a1.elapsed - a2.elapsed) / a1.elapsed) * 100).toFixed(0)}% faster)`);
console.log(`B cold ${b1.elapsed}ms — if this is slow again, the speed-up follows the prefix, not the connection.`);
console.log(`A after B: ${a3.elapsed}ms — if still fast, the cache survives an intervening request.`);
