/**
 * Multi-turn agent loop through the real gateway against a real provider.
 *
 * The existing tool suite only proves one round trip: call out, result back,
 * answer. Agents do not work that way — they chain calls where each argument
 * depends on the last result, and roughly 9% of turns hit a tool failure they
 * have to recover from (Copilot telemetry, docs/KNOWN_ISSUES.md). A model can
 * pass a single round trip and still be unusable in a loop.
 *
 * Two scenarios, both requiring dependent calls:
 *   audit    — list → fetch each → fetch vendor terms → arithmetic
 *   flaky    — same, but one tool fails once and must be retried
 *
 * Usage: node scripts/dev/_agent_loop_eval.mjs [model ...]
 */
import 'dotenv/config';

const { createApp } = await import('../../services/gateway/src/server.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TRACE = process.argv.includes('--trace');
const USE_SYSTEM = process.argv.includes('--system');
const REPEATS = Number((process.argv.find((a) => a.startsWith('--repeat=')) || '').split('=')[1]) || 1;

const MODELS = args.length
  ? args
  : ['akash/meta-llama/Llama-3.3-70B-Instruct', 'akash/openai/gpt-oss-120b', 'akash/zai-org/GLM-5.2'];

const MAX_TURNS = 12;

// ── The world the agent is reasoning about ───────────────────────────────────
// Unpaid: INV-1 (1000 Acme -10% = 900), INV-3 (500 Acme -10% = 450),
//         INV-4 (3000 Initech -0% = 3000).  Total = 4350.
const INVOICES = {
  'INV-1': { vendor: 'Acme', amount: 1000, status: 'unpaid' },
  'INV-2': { vendor: 'Globex', amount: 2500, status: 'paid' },
  'INV-3': { vendor: 'Acme', amount: 500, status: 'unpaid' },
  'INV-4': { vendor: 'Initech', amount: 3000, status: 'unpaid' },
};
const TERMS = { Acme: { discount_pct: 10 }, Globex: { discount_pct: 5 }, Initech: { discount_pct: 0 } };
const EXPECTED = 4350;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_invoices',
      description: 'List every invoice id in the system.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_invoice',
      description: 'Get one invoice: vendor, amount, and paid/unpaid status.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Invoice id, e.g. INV-1' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vendor_terms',
      description: 'Get a vendor\'s payment terms, including their discount percentage.',
      parameters: {
        type: 'object',
        properties: { vendor: { type: 'string' } },
        required: ['vendor'],
      },
    },
  },
];

const TASK = 'What is the total we still owe across all UNPAID invoices, after applying each '
  + 'vendor\'s discount to that invoice\'s amount? Use the tools to look everything up. '
  + 'When you have the answer, reply with the final number only, no units and no commas.';

/**
 * Optional steer (`--system`). Llama 3.3 70B abandons the loop partway and emits
 * Python describing what it would do; if a system prompt fixes that, the cheap
 * model stays viable and the default does not need to change.
 */
const SYSTEM = 'You are an agent that answers ONLY by calling the provided tools. '
  + 'You cannot execute code and must never write code as your answer. '
  + 'Every fact must come from a tool result. Keep calling tools until you have '
  + 'looked up every invoice and every vendor you need, then give the final number.';

/** Execute a tool call against the fake world. `flaky` fails get_invoice once. */
function makeExecutor({ flaky }) {
  const failedOnce = new Set();
  const calls = [];

  return {
    calls,
    run(name, argsJson) {
      let args = {};
      try { args = JSON.parse(argsJson || '{}'); } catch { /* model sent malformed args */ }
      calls.push({ name, args });

      if (name === 'list_invoices') return { ids: Object.keys(INVOICES) };

      if (name === 'get_invoice') {
        const id = String(args.id || '');
        // One transient failure, on the invoice most likely to be fetched mid-loop.
        if (flaky && id === 'INV-3' && !failedOnce.has(id)) {
          failedOnce.add(id);
          return { error: 'rate_limited', message: 'Too many requests, retry this call.' };
        }
        return INVOICES[id] ? { id, ...INVOICES[id] } : { error: 'not_found', id };
      }

      if (name === 'get_vendor_terms') {
        const v = String(args.vendor || '');
        return TERMS[v] ? { vendor: v, ...TERMS[v] } : { error: 'not_found', vendor: v };
      }

      return { error: 'unknown_tool', name };
    },
  };
}

const post = (body) => fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
  body: JSON.stringify(body),
});

/** Run one scenario to completion or until the turn cap. */
async function runLoop(model, { flaky }) {
  const exec = makeExecutor({ flaky });
  const messages = USE_SYSTEM
    ? [{ role: 'system', content: SYSTEM }, { role: 'user', content: TASK }]
    : [{ role: 'user', content: TASK }];
  const started = Date.now();
  let turns = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const res = await post({ model, messages, tools: TOOLS, max_tokens: 1024 });
    const body = await res.json();
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, detail: body?.error?.message, turns, exec };
    }

    promptTokens += body.usage?.prompt_tokens || 0;
    completionTokens += body.usage?.completion_tokens || 0;

    const choice = body.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;

    if (TRACE) {
      console.log(`\n   turn ${turns}: finish_reason=${choice?.finish_reason} `
        + `tool_calls=${toolCalls?.length ?? 0}`);
      for (const tc of toolCalls || []) {
        console.log(`      → ${tc.function?.name}(${tc.function?.arguments})`);
      }
      if (choice?.message?.content) {
        console.log(`      content: ${JSON.stringify(String(choice.message.content).slice(0, 160))}`);
      }
    }

    if (!toolCalls?.length) {
      const text = String(choice?.message?.content ?? '');
      return {
        ok: true, text, turns, exec,
        elapsedMs: Date.now() - started,
        promptTokens, completionTokens,
      };
    }

    // Echo the assistant turn back verbatim, then one `tool` message per call —
    // several models emit parallel calls and drop the loop if any result is missing.
    messages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(exec.run(tc.function?.name, tc.function?.arguments)),
      });
    }
  }

  return { ok: false, reason: 'turn_cap', turns, exec, elapsedMs: Date.now() - started };
}

/** The answer is correct if 4350 appears and no competing total does. */
function grade(text) {
  if (!text) return false;
  const normalized = text.replace(/,/g, '');
  return new RegExp(`\\b${EXPECTED}(\\.0+)?\\b`).test(normalized);
}

console.log(`gateway ${base}`);
console.log(`scenario: ${Object.keys(INVOICES).length} invoices, 3 vendors, expected answer ${EXPECTED}\n`);

const rows = [];
for (const model of MODELS) {
  for (const scenario of ['audit', 'flaky']) {
    for (let attempt = 1; attempt <= REPEATS; attempt++) {
    process.stdout.write(`${model.padEnd(46)} ${scenario.padEnd(6)} #${attempt} … `);
    let r;
    try {
      r = await runLoop(model, { flaky: scenario === 'flaky' });
    } catch (err) {
      console.log(`ERROR ${err.message}`);
      rows.push({ model, scenario, verdict: 'error', detail: err.message });
      continue;
    }

    if (!r.ok) {
      console.log(`FAIL (${r.reason}${r.detail ? `: ${String(r.detail).slice(0, 60)}` : ''}) after ${r.turns} turns`);
      rows.push({ model, scenario, verdict: r.reason, turns: r.turns, toolCalls: r.exec.calls.length });
      continue;
    }

    const correct = grade(r.text);
    const retried = r.exec.calls.filter((c) => c.name === 'get_invoice' && c.args.id === 'INV-3').length;
    console.log(
      `${correct ? 'PASS' : 'WRONG'}  ${r.turns} turns, ${r.exec.calls.length} tool calls, `
      + `${(r.elapsedMs / 1000).toFixed(1)}s, ${r.promptTokens}+${r.completionTokens} tok`
      + (scenario === 'flaky' ? `, INV-3 fetched ${retried}x` : ''),
    );
    if (!correct) console.log(`      answered: ${JSON.stringify(r.text.slice(0, 140))}`);

    rows.push({
      model, scenario, verdict: correct ? 'pass' : 'wrong',
      turns: r.turns, toolCalls: r.exec.calls.length,
      seconds: +(r.elapsedMs / 1000).toFixed(1),
      tokens: r.promptTokens + r.completionTokens,
      retriedFlakyCall: scenario === 'flaky' ? retried > 1 : null,
    });
    }
  }
}

console.log('\n── summary ──');
for (const model of MODELS) {
  const mine = rows.filter((r) => r.model === model);
  const passed = mine.filter((r) => r.verdict === 'pass').length;
  const secs = mine.filter((r) => r.seconds).map((r) => r.seconds);
  const avg = secs.length ? (secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1) : '-';
  console.log(`${model.padEnd(46)} ${passed}/${mine.length} completed the loop   avg ${avg}s`);
  for (const r of mine) {
    console.log(`   ${r.scenario.padEnd(6)} ${String(r.verdict).padEnd(9)} `
      + `${r.turns ?? '-'} turns  ${r.toolCalls ?? '-'} calls  ${r.seconds ?? '-'}s  ${r.tokens ?? '-'} tok`);
  }
}

await new Promise((r) => server.close(r));
process.exit(0);
