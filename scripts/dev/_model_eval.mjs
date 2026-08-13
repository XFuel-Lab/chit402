/**
 * Is GPT-OSS-120B good enough to be the default?
 *
 * `xfuel/auto` resolves to GLM-5.2, the dearest model across both hubs
 * ($0.096–$0.106 per median agent call). GPT-OSS-120B is $0.00264 — 40x less,
 * and it would let the buyer's price drop 10x. The only thing in the way is
 * whether it is *adequate for agent work*, which nobody has measured.
 *
 * This grades the things agents actually depend on, deterministically wherever
 * possible — no LLM-as-judge, because a judge would import the very quality
 * question we are trying to answer.
 *
 *   tool      picks the right tool with the right arguments
 *   json      emits parseable JSON matching a schema
 *   needle    retrieves one fact from a long context
 *   instruct  obeys an exact output constraint
 *   reason    multi-step problem with one checkable answer
 *
 * Hits AkashML directly: our own gateway drops `tools` on the floor, so tool
 * calling cannot be tested through it.
 *
 *   node scripts/dev/_model_eval.mjs [--reps 3] [--models a,b] [--only tool,json]
 */
import 'dotenv/config';

const KEY = process.env.AKASHML_API_KEY;
const BASE = (process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1').replace(/\/$/, '');
if (!KEY) {
  console.error('AKASHML_API_KEY is not set');
  process.exit(1);
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const REPS = Number(arg('reps', 3));
const MODELS = arg('models', 'openai/gpt-oss-120b,meta-llama/Llama-3.3-70B-Instruct,zai-org/GLM-5.2').split(',');
const ONLY = arg('only', null)?.split(',') ?? null;

// Live rates, so cost per correct answer is real rather than assumed.
const rates = await (async () => {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  const out = {};
  for (const m of (await res.json()).data || []) {
    out[m.id] = { in: Number(m.pricing?.input || 0), out: Number(m.pricing?.output || 0) };
  }
  return out;
})();

/** Generous, so a reasoning model burning hidden tokens is not scored as wrong. */
const MAX_TOKENS = 2048;

async function call(model, { messages, tools = null, maxTokens = MAX_TOKENS }) {
  const body = { model, messages, max_tokens: maxTokens, temperature: 0 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }

  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const json = await res.json();
    const msg = json.choices?.[0]?.message || {};
    return {
      ok: true,
      ms,
      content: (msg.content || '').trim(),
      toolCalls: msg.tool_calls || null,
      finish: json.choices?.[0]?.finish_reason,
      usage: json.usage || {},
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  }
}

// ── tasks ────────────────────────────────────────────────────────────────────
// Each returns { pass: boolean, detail: string }. Graded on substance, not
// formatting: a right answer wrapped in prose still passes where an agent
// harness would accept it, and only fails where an agent would actually break.

const WEATHER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email',
      parameters: {
        type: 'object',
        properties: { to: { type: 'string' }, body: { type: 'string' } },
        required: ['to', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_flights',
      description: 'Search for flights between two airports',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
  },
];

/** Filler with facts buried at given depths. `lines`≈20 tokens each. */
function haystack(facts, total = 1400) {
  const lines = [];
  const placed = new Map();
  for (const [depth, text] of facts) placed.set(Math.floor(total * depth), text);
  for (let i = 0; i < total; i++) {
    lines.push(placed.get(i)
      ?? `Record ${i}: routine shipment logged, no exceptions, standard handling applied, cleared by duty officer.`);
  }
  return lines.join('\n');
}

const ONE_FACT = [[0.6, 'Note: the internal reconciliation code for the Helsinki depot is PLUM-7741.']];

const TASKS = {
  tool: {
    label: 'tool calling',
    run: async (model) => {
      const r = await call(model, {
        messages: [{ role: 'user', content: 'What is the weather in Oslo right now? Use celsius.' }],
        tools: WEATHER_TOOLS,
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const tc = r.toolCalls?.[0];
      if (!tc) return { pass: false, detail: `no tool call (said: ${r.content.slice(0, 60)})`, r };
      if (tc.function?.name !== 'get_weather') return { pass: false, detail: `called ${tc.function?.name}`, r };
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {
        return { pass: false, detail: 'arguments were not valid JSON', r };
      }
      if (!/oslo/i.test(args.city || '')) return { pass: false, detail: `city=${args.city}`, r };
      return { pass: true, detail: `get_weather(${args.city}, ${args.unit ?? '-'})`, r };
    },
  },

  json: {
    label: 'structured JSON',
    run: async (model) => {
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: 'Return ONLY a JSON object, no prose and no code fence, with keys: '
            + '"name" (string), "count" (integer), "tags" (array of strings). '
            + 'Use name="widget", count=3, tags=["a","b"].',
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      // Tolerate a code fence: agent harnesses commonly strip one.
      const text = r.content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      let obj;
      try { obj = JSON.parse(text); } catch {
        return { pass: false, detail: `unparseable: ${text.slice(0, 60)}`, r };
      }
      if (obj.name !== 'widget') return { pass: false, detail: `name=${obj.name}`, r };
      if (obj.count !== 3) return { pass: false, detail: `count=${JSON.stringify(obj.count)}`, r };
      if (!Array.isArray(obj.tags) || obj.tags.join(',') !== 'a,b') {
        return { pass: false, detail: `tags=${JSON.stringify(obj.tags)}`, r };
      }
      return { pass: true, detail: 'schema matched', r };
    },
  },

  needle: {
    label: 'long-context recall',
    run: async (model) => {
      const r = await call(model, {
        messages: [
          { role: 'user', content: `${haystack(ONE_FACT)}\n\nWhat is the internal reconciliation code for the Helsinki depot? Answer with the code only.` },
        ],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const pass = /PLUM-7741/i.test(r.content);
      return { pass, detail: pass ? 'found' : `said: ${r.content.slice(0, 60)}`, r };
    },
  },

  instruct: {
    label: 'instruction following',
    run: async (model) => {
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: 'Reply with exactly one word, in uppercase, naming the capital of Japan. No punctuation, no explanation.',
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const pass = r.content === 'TOKYO';
      return { pass, detail: pass ? 'exact' : `got: ${JSON.stringify(r.content.slice(0, 40))}`, r };
    },
  },

  reason: {
    label: 'multi-step reasoning',
    run: async (model) => {
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: 'A warehouse ships 3 pallets on Monday, twice that on Tuesday, and on Wednesday '
            + 'half the combined Monday and Tuesday total. Two Wednesday pallets are returned. '
            + 'How many pallets shipped in total across the three days, net of returns? '
            + 'End your reply with the final number on its own line.',
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      // 3 + 6 + 4.5 → 4 or 5 depending on rounding; the arithmetic intent is 3+6+4.5=13.5,
      // net 11.5. Accept the exact non-rounded answer or either sane rounding of it.
      const nums = r.content.match(/-?\d+(?:\.\d+)?/g) || [];
      const last = nums.length ? nums[nums.length - 1] : null;
      const pass = ['11.5', '11', '12'].includes(last);
      return { pass, detail: pass ? `final=${last}` : `final=${last} (want 11.5/11/12)`, r };
    },
  },
};

// ── harder suite ─────────────────────────────────────────────────────────────
// The five above are agent *primitives* and every model aced them, which means
// they cannot discriminate. These are sized and shaped like the real workload:
// 68k of context (our measured median), two facts needing synthesis rather than
// one needing lookup, a tool result fed back in, and a schema with nesting.

const HARD = {
  synth: {
    label: 'synthesis @68k',
    run: async (model) => {
      // Two facts, far apart, neither of which answers the question alone.
      const facts = [
        [0.18, 'Note: the Helsinki depot operates 14 loading bays.'],
        [0.83, 'Note: each loading bay at Helsinki clears 23 pallets per shift.'],
      ];
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: `${haystack(facts, 3400)}\n\nUsing only the records above, how many pallets can the Helsinki depot clear in one shift across all of its bays? End your reply with the number on its own line.`,
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const nums = r.content.match(/\d+/g) || [];
      const pass = nums.includes('322'); // 14 × 23
      return { pass, detail: pass ? '322' : `said: ${r.content.slice(-60)}`, r };
    },
  },

  chain: {
    label: 'tool result → answer',
    run: async (model) => {
      // Feed a tool result back and require the model to use it, not its priors.
      const r = await call(model, {
        messages: [
          { role: 'user', content: 'What is the weather in Oslo? Use celsius.' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Oslo","unit":"c"}' },
            }],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '{"temp_c": -6, "conditions": "sleet"}' },
        ],
        tools: WEATHER_TOOLS,
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      // Models write minus signs as U+2011/U+2212 and friends. Grading on the
      // ASCII hyphen alone scored a correct GPT-OSS answer as a quality failure,
      // which is precisely the wrong call for this eval to hand back.
      const norm = r.content.replace(/[\u2010-\u2015\u2212]/g, '-');
      const pass = /-\s?6/.test(norm) && /sleet/i.test(norm);
      return { pass, detail: pass ? 'used tool result' : `said: ${r.content.slice(0, 70)}`, r };
    },
  },

  nested: {
    label: 'nested JSON schema',
    run: async (model) => {
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: 'Return ONLY JSON, no prose, no code fence, matching exactly: '
            + '{"order":{"id":"A-1","items":[{"sku":"X","qty":2},{"sku":"Y","qty":5}]},"total":7,"paid":false}. '
            + 'Reproduce it precisely.',
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const text = r.content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      let o;
      try { o = JSON.parse(text); } catch { return { pass: false, detail: `unparseable: ${text.slice(0, 50)}`, r }; }
      const pass = o?.order?.id === 'A-1'
        && Array.isArray(o.order.items) && o.order.items.length === 2
        && o.order.items[1]?.qty === 5 && o.total === 7 && o.paid === false;
      return { pass, detail: pass ? 'exact' : `got: ${JSON.stringify(o).slice(0, 70)}`, r };
    },
  },

  conflict: {
    label: 'constraint under trap',
    run: async (model) => {
      // A plausible-but-wrong pull: the model is invited to explain, and told not to.
      const r = await call(model, {
        messages: [{
          role: 'user',
          content: 'Explain in detail why the sky is blue. IMPORTANT: your entire reply must be '
            + 'the single word BLUE in uppercase, nothing else, no explanation despite the request above.',
        }],
      });
      if (!r.ok) return { pass: false, detail: r.error, r };
      const pass = r.content === 'BLUE';
      return { pass, detail: pass ? 'obeyed' : `got ${r.content.length} chars: ${JSON.stringify(r.content.slice(0, 40))}`, r };
    },
  },
};

Object.assign(TASKS, HARD);

// ── run ──────────────────────────────────────────────────────────────────────

const names = ONLY || Object.keys(TASKS);
const results = {};

console.log(`Evaluating ${MODELS.length} models × ${names.length} tasks × ${REPS} reps\n`);

for (const model of MODELS) {
  results[model] = { tasks: {}, ms: [], cost: 0, calls: 0, errors: 0 };
  process.stdout.write(`${model}\n`);
  for (const name of names) {
    const task = TASKS[name];
    if (!task) { console.log(`  unknown task ${name}`); continue; }
    let passes = 0;
    const details = [];
    for (let i = 0; i < REPS; i++) {
      const { pass, detail, r } = await task.run(model);
      if (pass) passes++;
      else details.push(detail);
      if (r?.usage) {
        const rate = rates[model] || { in: 0, out: 0 };
        results[model].cost += (r.usage.prompt_tokens || 0) * rate.in
          + (r.usage.completion_tokens || 0) * rate.out;
      }
      if (r?.ms) results[model].ms.push(r.ms);
      if (r && !r.ok) results[model].errors++;
      results[model].calls++;
    }
    results[model].tasks[name] = { passes, reps: REPS, details };
    const bar = passes === REPS ? 'PASS' : passes === 0 ? 'FAIL' : 'FLAKY';
    console.log(`  ${task.label.padEnd(22)} ${String(passes).padStart(2)}/${REPS}  ${bar}`
      + (details.length ? `  — ${details[0]}` : ''));
  }
  console.log('');
}

// ── scorecard ────────────────────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log('═'.repeat(96));
console.log(`${'model'.padEnd(38)}${names.map((n) => n.slice(0, 8).padStart(9)).join('')}${'  score'.padStart(8)}${'  med ms'.padStart(9)}${'  $/eval'.padStart(9)}`);
console.log('─'.repeat(96));

for (const model of MODELS) {
  const r = results[model];
  const cells = names.map((n) => {
    const t = r.tasks[n];
    return `${t.passes}/${t.reps}`.padStart(9);
  }).join('');
  const total = names.reduce((a, n) => a + r.tasks[n].passes, 0);
  const possible = names.length * REPS;
  console.log(
    `${model.padEnd(38)}${cells}${`${total}/${possible}`.padStart(8)}`
    + `${String(median(r.ms)).padStart(9)}${`$${r.cost.toFixed(4)}`.padStart(9)}`,
  );
}

console.log('\nErrors:', MODELS.map((m) => `${m.split('/').pop()}=${results[m].errors}`).join(' '));
console.log(`Total spend: $${MODELS.reduce((a, m) => a + results[m].cost, 0).toFixed(4)}`);
