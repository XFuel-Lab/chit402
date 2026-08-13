/**
 * Which candidate defaults survive a small `max_tokens`?
 *
 * Moving `xfuel/auto` to GLM-5.2 for agent-loop correctness has a buyer-visible
 * cost: GLM is a reasoning model, and a caller asking for 16 tokens gets a 400
 * because the budget is consumed before any answer is emitted. That is a
 * compatibility break for anyone sending short completions to the default alias.
 * This measures where each candidate starts answering. Throwaway probe.
 */
import 'dotenv/config';

const KEY = (process.env.AKASHML_API_KEY || '').trim();
const BASE = (process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1').replace(/\/$/, '');

const MODELS = ['zai-org/GLM-5.2', 'openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct'];
const CAPS = [16, 64, 256, 1024];

for (const model of MODELS) {
  console.log(`\n${model}`);
  for (const max of CAPS) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: PONG' }],
        max_tokens: max,
        temperature: 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const msg = data.choices?.[0]?.message || {};
    const text = (msg.content || '').trim();
    const reasoning = (msg.reasoning_content || msg.reasoning || '').length;
    console.log(`   max_tokens=${String(max).padEnd(5)} HTTP ${res.status}  `
      + `answer=${JSON.stringify(text.slice(0, 30)).padEnd(12)} `
      + `completion_tokens=${data.usage?.completion_tokens ?? '-'} `
      + `reasoning_chars=${reasoning} finish=${data.choices?.[0]?.finish_reason ?? '-'}`);
  }
}
