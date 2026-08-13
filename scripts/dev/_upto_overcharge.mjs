/**
 * How much does quoting output at the `max_tokens` ceiling overcharge?
 *
 * The `exact` scheme needs a price before the work runs, so output is quoted at
 * the ceiling. Agents set a generous `max_tokens` and use a fraction of it, so
 * the buyer pays for tokens that were never generated. This measures the gap on
 * the turn shapes observed in the multi-turn agent loop eval. Throwaway probe.
 */
import 'dotenv/config';
import { quoteTask } from '../../services/gateway/src/pricing.js';

const usd = (units) => `$${(Number(units) / 1e6).toFixed(4)}`;

// prompt/completion pairs measured in scripts/dev/_agent_loop_eval.mjs.
const SHAPES = [
  { label: 'agent loop turn (GLM)', model: 'akash/zai-org/GLM-5.2', prompt: 2000, actualOut: 300, maxTokens: 1024 },
  { label: 'agent loop turn (GPT-OSS)', model: 'akash/openai/gpt-oss-120b', prompt: 3700, actualOut: 800, maxTokens: 1024 },
  { label: 'short answer, generous cap', model: 'akash/zai-org/GLM-5.2', prompt: 500, actualOut: 40, maxTokens: 4096 },
  { label: 'median agent call (68k in)', model: 'akash/openai/gpt-oss-120b', prompt: 68000, actualOut: 247, maxTokens: 2048 },
];

const quoteFor = (model, promptTokens, maxTokens) => quoteTask({
  model_id: model,
  messages: [{ role: 'user', content: 'x'.repeat(promptTokens * 4) }],
  max_tokens: maxTokens,
});

console.log('quoted = what the buyer pays today (output at the ceiling)');
console.log('metered = what `upto` would settle (output actually generated)\n');

for (const s of SHAPES) {
  const quoted = quoteFor(s.model, s.prompt, s.maxTokens);
  const metered = quoteFor(s.model, s.prompt, s.actualOut);
  const over = Number(quoted.amount) - Number(metered.amount);
  const pct = Number(metered.amount) ? (over / Number(metered.amount)) * 100 : 0;

  console.log(`${s.label}`);
  console.log(`   ${s.prompt} in, ${s.actualOut} out, max_tokens=${s.maxTokens}`);
  console.log(`   quoted  ${usd(quoted.amount)}   metered ${usd(metered.amount)}`
    + `   overcharge ${usd(over)} (${pct.toFixed(0)}%)`);
  console.log(`   basis: ${quoted.basis}\n`);
}
