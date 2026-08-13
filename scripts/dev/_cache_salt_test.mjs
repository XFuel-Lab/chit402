/**
 * Does `cache_salt` actually isolate, or is it accepted and ignored?
 *
 * This matters because we multiplex every customer through one AkashML key.
 * CacheProbe (SAGAI '26) measured exactly this architecture on OpenRouter and
 * found cross-tenant cache sharing up to 100% on some upstreams — one tenant's
 * prompt served from cache to another, detectable by timing.
 *
 * Test: same prefix, three requests.
 *   1. salt A, cold        → slow
 *   2. salt A, repeat      → fast (cache works at all)
 *   3. salt B, same prefix → SLOW if the salt isolates, FAST if it is ignored
 *
 * A fast third call means our tenants currently share a cache namespace and the
 * mitigation is not available at this provider.
 */

import 'dotenv/config';

const KEY = (process.env.AKASHML_API_KEY || '').trim();
const MODEL = process.argv[2] || 'zai-org/GLM-5.2';
const FIELD = process.argv[3] || 'cache_salt';

const para = 'Confidential tenant strategy notes, revision log, and reconciliation entries. ';
const PREFIX = Array.from({ length: Math.ceil((12000 * 4) / para.length) }, (_, i) => `Note ${i}. ${para}`).join('\n');

async function call(label, salt) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: PREFIX },
      // Fixed tiny output so latency reflects prefill, not decode.
      { role: 'user', content: 'Reply with exactly one word: OK' },
    ],
    max_tokens: 2000,
    temperature: 0,
  };
  if (salt !== null) body[FIELD] = salt;

  const t0 = Date.now();
  const res = await fetch('https://api.akashml.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  const data = JSON.parse(await res.text());
  const c = data.usage?.completion_tokens;
  console.log(`  ${label.padEnd(30)} ${String(elapsed).padStart(5)}ms  completion=${c}`);
  return elapsed;
}

console.log(`model=${MODEL}  field=${FIELD}\n`);
const cold = await call(`1. salt=A (cold)`, 'tenant-aaaa');
const warm = await call(`2. salt=A (repeat)`, 'tenant-aaaa');
const other = await call(`3. salt=B (other tenant)`, 'tenant-bbbb');

console.log('\n─── reading ───');
const hit = (cold - warm) / cold;
console.log(`cache works at all: ${(hit * 100).toFixed(0)}% faster on repeat — ${hit > 0.25 ? 'YES' : 'inconclusive'}`);

if (hit <= 0.25) {
  console.log('Cache speed-up too small to judge isolation. Re-run.');
} else if (other > cold * 0.7) {
  console.log(`ISOLATED: salt=B took ${other}ms, near the ${cold}ms cold time.`);
  console.log(`\`${FIELD}\` partitions the cache — usable as a per-tenant mitigation.`);
} else {
  console.log(`NOT ISOLATED: salt=B took ${other}ms, close to the ${warm}ms cached time.`);
  console.log(`\`${FIELD}\` is accepted and ignored. Tenants share a cache namespace on this`);
  console.log('provider, and one tenant can detect another\'s prompt prefix by timing.');
}
