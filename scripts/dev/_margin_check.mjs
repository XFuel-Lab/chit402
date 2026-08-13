/**
 * Margin per median agent call, per live AkashML model: what the rate card
 * charges against what the provider charges us. Throwaway probe.
 */
import 'dotenv/config';
import { rateForModel, costOfUsage } from '../../services/gateway/src/provider-rates.js';
import { quoteTask } from '../../services/gateway/src/pricing.js';

// Straight off the live catalog, so both hubs are read exactly as production reads them.
const { getHubCatalog } = await import('../../services/gateway/src/hub-catalog.js');
const { models } = await getHubCatalog({ forceRefresh: true });
const rows = models.filter((m) => m.modality === 'chat' && m.hub !== 'xfuel');

// The measured median production agent call.
const PROMPT_TOKENS = 68_000;
const OUTPUT_TOKENS = 247;
const MAX_TOKENS = 500; // what we quote against, and the gateway default

const usd = (units) => `$${(Number(units) / 1e6).toFixed(5)}`;
// Quote per model — the whole point of the card is that the row varies.
const priceOf = (modelId) => BigInt(quoteTask({
  model_id: modelId,
  messages: [{ role: 'user', content: 'x'.repeat(PROMPT_TOKENS * 4) }],
  max_tokens: MAX_TOKENS,
}, {}).amount);

console.log(`Median agent call: ${PROMPT_TOKENS} in / ${OUTPUT_TOKENS} out (quoted at max_tokens=${MAX_TOKENS})\n`);
console.log('model                                        price       COGS      margin   multiple');
console.log('─'.repeat(88));

const scored = rows
  .map((r) => ({ id: r.id, rate: rateForModel(r) }))
  .filter((r) => r.rate)
  .map((r) => {
    const cogs = costOfUsage({ prompt_tokens: PROMPT_TOKENS, completion_tokens: OUTPUT_TOKENS }, r.rate);
    const price = priceOf(r.id);
    return { ...r, cogs, price, margin: price - cogs };
  })
  .sort((a, b) => Number(b.margin - a.margin));

for (const s of scored) {
  const flag = s.margin < 0n ? '  ← LOSS' : '';
  console.log(
    `${s.id.padEnd(42)}${usd(s.price).padStart(9)}${usd(s.cogs).padStart(11)}${usd(s.margin).padStart(12)}`
    + `${(Number(s.price) / Number(s.cogs)).toFixed(2).padStart(9)}x${flag}`,
  );
}

const dflt = process.env.AKASHML_DEFAULT_MODEL || 'zai-org/GLM-5.2';
const hit = scored.find((s) => s.id === dflt);
console.log(`\ndefault model (AKASHML_DEFAULT_MODEL) = ${dflt}`);
if (hit) {
  console.log(hit.margin < 0n
    ? `  LOSS-MAKING: costs ${usd(hit.cogs)}, we charge ${usd(hit.price)} → ${usd(-hit.margin)} lost per call`
    : `  margin ${usd(hit.margin)} per call (charge ${usd(hit.price)}, cost ${usd(hit.cogs)})`);
}
