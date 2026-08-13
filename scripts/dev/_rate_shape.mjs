/**
 * Print the live AkashML /v1/models pricing shape and check that
 * provider-rates.js reads it. Throwaway probe — rates change, so the point is
 * the field names, not the numbers.
 */
import 'dotenv/config';
import { rateForModel, costOfUsage } from '../../services/gateway/src/provider-rates.js';

const key = process.env.AKASHML_API_KEY;
const base = process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1';

const res = await fetch(`${base}/models`, {
  headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const rows = (await res.json()).data || [];
console.log(`${rows.length} models\n`);
console.log('raw pricing block of the first row:');
console.log(JSON.stringify(rows[0]?.pricing ?? rows[0], null, 2).slice(0, 600));

const AGENT = { prompt_tokens: 68000, completion_tokens: 247 };
const want = ['llama', 'gpt-oss', 'GLM-5.2', 'Qwen3', 'deepseek'];

console.log('\nmodel                                    in $/M    out $/M  cache $/M   agent call');
console.log('─'.repeat(92));
for (const r of rows) {
  if (!want.some((w) => String(r.id).toLowerCase().includes(w.toLowerCase()))) continue;
  // mapAkashService puts `pricing` on `cost`; mirror that here.
  const rate = rateForModel({ cost: r.pricing });
  if (!rate) { console.log(`${String(r.id).padEnd(40)} —  no readable rate`); continue; }
  const cost = costOfUsage(AGENT, rate);
  console.log(
    `${String(r.id).padEnd(40)}${(rate.input * 1e6).toFixed(3).padStart(8)}`
    + `${(rate.output * 1e6).toFixed(3).padStart(10)}`
    + `${(rate.cachedInput === null ? '—' : (rate.cachedInput * 1e6).toFixed(3)).padStart(11)}`
    + `   $${(Number(cost) / 1e6).toFixed(5)}`,
  );
}

const unreadable = rows.filter((r) => !rateForModel({ cost: r.pricing }));
console.log(`\n${rows.length - unreadable.length}/${rows.length} models have a readable rate.`);
if (unreadable.length) console.log('unreadable:', unreadable.slice(0, 8).map((r) => r.id).join(', '));
