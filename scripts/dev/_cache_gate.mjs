/**
 * Does any model we route actually price cached reads?
 *
 * Session-affinity routing (pin a conversation to one provider replica so its
 * prompt prefix stays warm) is only worth building where the provider both
 * **prices cached reads** and **exposes an affinity key**. Without the first, a
 * cache hit saves the provider money and costs us the routing flexibility for
 * nothing. This checks the first condition against the live catalog; the second
 * is a question for the provider.
 *
 * Run this before spending any time on affinity work.
 */
import 'dotenv/config';
import { getHubCatalog } from '../../services/gateway/src/hub-catalog.js';
import { rateForModel } from '../../services/gateway/src/provider-rates.js';

const { models, source } = await getHubCatalog({ forceRefresh: true });
console.log(`catalog source: ${source}\n`);

const rows = [];
for (const m of models) {
  if (m.hub === 'xfuel') continue;
  const rate = rateForModel(m);
  if (!rate) {
    rows.push({ id: m.id, note: 'no published rate' });
    continue;
  }
  rows.push({
    id: m.id,
    input: rate.input,
    cached: rate.cachedInput,
    ratio: rate.cachedInput ? rate.input / rate.cachedInput : null,
  });
}

const priced = rows.filter((r) => r.cached);
const per = (v) => (v == null ? '—' : `$${(v * 1e6).toFixed(3)}/M`);

for (const r of rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  if (r.note) { console.log(`  ${r.id.padEnd(46)} ${r.note}`); continue; }
  console.log(`  ${r.id.padEnd(46)} in ${per(r.input).padEnd(12)} cached ${per(r.cached).padEnd(12)}`
    + (r.ratio ? ` ${r.ratio.toFixed(1)}x cheaper` : ' not priced'));
}

console.log(`\n${priced.length} of ${rows.length} models price cached reads.`);
console.log(`session-affinity gate: ${priced.length ? 'condition 1 met for some models' : 'BLOCKED — no model prices cached reads'}`);
if (priced.length) {
  console.log(`  models: ${priced.map((r) => r.id).join(', ')}`);
}
console.log('condition 2 (provider exposes an affinity key): unanswered — operator decision');
