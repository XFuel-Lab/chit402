/**
 * Can we tell which model actually served a request?
 *
 * ADR 0007 proposes spot-check assurance: re-execute a sampled fraction of calls
 * and compare, to bound how often a provider is serving something other than what
 * it billed. Everything in that ADR rests on one unproven assumption — that
 * comparing two outputs can distinguish two models at all. If it cannot, no
 * sample rate saves it, and the tier should not be built.
 *
 * This measures that assumption before anything is built on it.
 *
 *   self          same model, same provider, repeated → the agreement ceiling.
 *                 LLMs are non-deterministic even at temperature 0, so this is
 *                 the noise floor every other number is read against.
 *   cross (near)  Qwen3.5-35B vs Qwen3.6-35B — same family, same size, adjacent
 *                 versions. The hardest honest discrimination case available, and
 *                 the closest proxy we have for "a quantised substitute".
 *   cross (far)   Llama-70B vs GPT-OSS-120B and friends. The easy case; if this
 *                 does not separate, the comparator is broken.
 *
 * The headline output is the **margin**: self-agreement minus the highest
 * cross-agreement. A large margin means substitution is detectable by comparison
 * alone. A small one means it is not, and ADR 0007 needs a different mechanism.
 *
 * Probes are arbitrary-choice prompts with short outputs — "name a colour, one
 * word". A model's prior shows through on a free choice, while a prompt with one
 * correct answer ("what is 2+2") makes every model agree and measures nothing.
 * Short outputs keep this cheap: the whole run costs cents, and it is hard-capped
 * anyway.
 *
 * Runs against AkashML directly. Cross-*provider* comparison (the same model on
 * two hubs, which is the actual substitution check) needs a Theta EdgeCloud key
 * and is skipped without one.
 *
 *   node scripts/dev/_canary_probe.mjs [--reps 5] [--budget 20] [--models a,b] [--json out.json]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

// Provider credentials live with the service that uses them, not at the repo
// root, so this runs from either directory without the caller having to know.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../services/gateway/.env'),
});

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

const REPS = Number(arg('reps', 5));
const BUDGET_USD = Number(arg('budget', 20));
const JSON_OUT = arg('json', null);
const CONCURRENCY = Math.max(1, Number(arg('concurrency', 8)));
const MODEL_FILTER = arg('models', null)?.split(',') ?? null;

/** Generous: GLM-5.2 spends hidden reasoning tokens before it emits anything. */
const MAX_TOKENS = 512;

// ─── Probe battery ────────────────────────────────────────────────────────────

/**
 * Free-choice prompts. Each constrains the *format* hard and the *content* not at
 * all, so the answer is a fingerprint of the model's prior rather than a fact
 * every model shares.
 */
const PROBES = [
  'Name a colour. Reply with the single word only.',
  'Name a city. Reply with the single word only.',
  'Pick a whole number between 1 and 100. Reply with the digits only.',
  'Name an animal. Reply with the single word only.',
  'Choose a programming language. Reply with the single word only.',
  'Name a fruit. Reply with the single word only.',
  'Pick a letter of the alphabet. Reply with the single letter only.',
  'Name a musical instrument. Reply with the single word only.',
  'Complete in exactly three words: "The morning air was"',
  'Complete in exactly three words: "She opened the door and"',
  'Give a variable name for a user\'s remaining credit. Reply with the identifier only.',
  'Give a function name that retries a failed network call. Reply with the identifier only.',
  'Name a country. Reply with the single word only.',
  'Pick a month. Reply with the single word only.',
  'Invent a one-word name for a coffee shop. Reply with the single word only.',
  'Name an emotion. Reply with the single word only.',
  'Pick a two-digit prime. Reply with the digits only.',
  'Name a metal. Reply with the single word only.',
  'Complete in exactly four words: "The best debugging tool is"',
  'Give a git branch name for a caching bug fix. Reply with the branch name only.',
  'Name a planet. Reply with the single word only.',
  'Pick a hexadecimal colour code you like. Reply with the code only.',
  'Name a tree. Reply with the single word only.',
  'Invent a one-word name for a database table of audit records. Reply with the single word only.',
];

// ─── Live rates + hard budget ─────────────────────────────────────────────────

const rates = await (async () => {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`GET /models HTTP ${res.status}`);
  const out = {};
  for (const m of (await res.json()).data || []) {
    out[m.id] = { in: Number(m.pricing?.input || 0), out: Number(m.pricing?.output || 0) };
  }
  return out;
})();

const MODELS = (MODEL_FILTER || Object.keys(rates)).filter((m) => rates[m]);
if (!MODELS.length) {
  console.error('no models to probe');
  process.exit(1);
}

let spent = 0;
let stoppedForBudget = false;

/** Worst case for one probe, so the cap is never crossed rather than noticed after. */
const worstCase = (model) => 120 * rates[model].in + MAX_TOKENS * rates[model].out;

function chargeAndCheck(model, usage) {
  spent += (usage.prompt_tokens || 0) * rates[model].in
    + (usage.completion_tokens || 0) * rates[model].out;
}

// ─── Comparison ───────────────────────────────────────────────────────────────

/** Strip everything that varies for reasons other than model identity. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s"'`.,!?;:()[\]{}]+/g, ' ')
    .trim();
}

/** Levenshtein ratio, 0..1. Outputs are a few words, so the naive matrix is fine. */
function similarity(a, b) {
  const s = normalize(a);
  const t = normalize(b);
  if (!s.length && !t.length) return 1;
  if (!s.length || !t.length) return 0;
  if (s === t) return 1;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

const exactMatch = (a, b) => normalize(a) === normalize(b);

// ─── Collection ───────────────────────────────────────────────────────────────

async function probe(model, prompt) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const json = await res.json();
    chargeAndCheck(model, json.usage || {});
    const content = (json.choices?.[0]?.message?.content || '').trim();
    return { ok: !!content, ms, content, error: content ? null : 'empty content' };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  }
}

/** @type {Map<string, Map<string, string[]>>} model → prompt → responses */
const responses = new Map();
const health = new Map();

/**
 * Two failure kinds that mean opposite things: an HTTP error is the provider
 * being unavailable, while empty content is a reasoning model spending its whole
 * `max_tokens` budget on hidden thought and emitting nothing. Only the second is
 * our problem to design around.
 */
function classify(error) {
  if (!error) return null;
  if (error === 'empty content') return 'empty';
  if (error.startsWith('HTTP')) return 'http';
  return 'timeout';
}

const total = MODELS.length * PROBES.length * REPS;
console.log(`\nCanary probe — ${MODELS.length} models × ${PROBES.length} prompts × ${REPS} reps = ${total} calls`);
console.log(`Budget cap $${BUDGET_USD.toFixed(2)}, concurrency ${CONCURRENCY}\n${'─'.repeat(72)}`);

// Run the whole grid through a worker pool rather than model-by-model. Serially
// this is dominated by the slowest models — GLM-5.2 and Qwen3.6 average 4–6s a
// call, so 576 calls took ~28 minutes and the budget was never the binding
// constraint. Interleaving means a slow model no longer blocks a fast one.
for (const model of MODELS) {
  responses.set(model, new Map());
  health.set(model, { ok: 0, calls: 0, empty: 0, http: 0, timeout: 0, totalMs: 0 });
}

const tasks = [];
for (const model of MODELS) {
  for (const prompt of PROBES) {
    for (let r = 0; r < REPS; r += 1) tasks.push({ model, prompt });
  }
}

let cursor = 0;
let done = 0;
const started = Date.now();

async function worker() {
  for (;;) {
    const i = cursor;
    cursor += 1;
    if (i >= tasks.length) return;
    const { model, prompt } = tasks[i];
    // Conservative: reserve the worst case before spending, so concurrent
    // workers cannot collectively step over the cap.
    if (spent + worstCase(model) * CONCURRENCY > BUDGET_USD) { stoppedForBudget = true; return; }

    const result = await probe(model, prompt);
    const h = health.get(model);
    h.calls += 1;
    h.totalMs += result.ms;
    if (result.ok) {
      h.ok += 1;
      const byPrompt = responses.get(model);
      if (!byPrompt.has(prompt)) byPrompt.set(prompt, []);
      byPrompt.get(prompt).push(result.content);
    } else {
      h[classify(result.error)] += 1;
    }

    done += 1;
    if (done % 50 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((tasks.length - done) / rate);
      process.stdout.write(`  ${done}/${tasks.length} calls  $${spent.toFixed(4)}  ~${eta}s left\r`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stdout.write(' '.repeat(60) + '\r');

for (const model of MODELS) {
  const h = health.get(model);
  h.meanMs = h.calls ? Math.round(h.totalMs / h.calls) : null;
  const why = [h.empty && `${h.empty} empty`, h.http && `${h.http} http`, h.timeout && `${h.timeout} timeout`]
    .filter(Boolean).join(' ') || 'clean';
  console.log(`${model.padEnd(38)} ${String(h.ok).padStart(3)}/${String(h.calls).padEnd(3)} ok  ${String(h.meanMs).padStart(5)} ms  ${why}`);
}
console.log(`\n  ${done} calls in ${Math.round((Date.now() - started) / 1000)}s for $${spent.toFixed(4)}`);

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Agreement between two response lists for one prompt, over all pairs. */
function agreeOne(a, b, sameSet) {
  let exact = 0;
  let sim = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 1) {
    // Within one model, comparing a response to itself is free agreement and
    // would inflate the noise floor we are trying to measure.
    for (let j = sameSet ? i + 1 : 0; j < b.length; j += 1) {
      exact += exactMatch(a[i], b[j]) ? 1 : 0;
      sim += similarity(a[i], b[j]);
      n += 1;
    }
  }
  return { exact, sim, n };
}

/** Agreement between two models, restricted to `prompts`. */
function agreement(aSets, bSets, { sameSet, prompts = null }) {
  let exact = 0;
  let sim = 0;
  let n = 0;
  for (const [prompt, a] of aSets) {
    if (prompts && !prompts.has(prompt)) continue;
    const b = bSets.get(prompt);
    if (!b) continue;
    const one = agreeOne(a, b, sameSet);
    exact += one.exact;
    sim += one.sim;
    n += one.n;
  }
  return n ? { exact: exact / n, sim: sim / n, n } : { exact: null, sim: null, n: 0 };
}

const probed = [...responses.keys()].filter((m) => responses.get(m).size > 0);

/**
 * Score every prompt by how well it separates same-model from different-model.
 *
 * A free-choice prompt is only useful if models actually choose differently.
 * "Name a colour" is a poor probe if every model answers "blue" — shared priors
 * push cross-model agreement up and drown the signal. This finds which prompts
 * earn their place, so the battery can be curated instead of guessed at.
 */
function scorePrompts() {
  const rows = [];
  for (const prompt of PROBES) {
    let selfEx = 0;
    let selfN = 0;
    let crossEx = 0;
    let crossN = 0;
    for (let i = 0; i < probed.length; i += 1) {
      const a = responses.get(probed[i]).get(prompt);
      if (!a) continue;
      const s = agreeOne(a, a, true);
      selfEx += s.exact;
      selfN += s.n;
      for (let j = i + 1; j < probed.length; j += 1) {
        const b = responses.get(probed[j]).get(prompt);
        if (!b) continue;
        const c = agreeOne(a, b, false);
        crossEx += c.exact;
        crossN += c.n;
      }
    }
    if (!selfN || !crossN) continue;
    const selfRate = selfEx / selfN;
    const crossRate = crossEx / crossN;
    rows.push({ prompt, self: selfRate, cross: crossRate, discrimination: selfRate - crossRate });
  }
  return rows.sort((x, y) => y.discrimination - x.discrimination);
}

const self = new Map();
for (const m of probed) self.set(m, agreement(responses.get(m), responses.get(m), { sameSet: true }));

/** Same family and size, adjacent version — the hardest honest case in the catalogue. */
const NEAR_TWINS = [['Qwen/Qwen3.5-35B-A3B', 'Qwen/Qwen3.6-35B-A3B']];
const isNearTwin = (a, b) => NEAR_TWINS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

const cross = [];
for (let i = 0; i < probed.length; i += 1) {
  for (let j = i + 1; j < probed.length; j += 1) {
    const a = probed[i];
    const b = probed[j];
    const agreed = agreement(responses.get(a), responses.get(b), { sameSet: false });
    // Read each pair against the noisier of its two models, not a global mean:
    // a model that cannot repeat itself sets the floor for every comparison it
    // takes part in, and averaging that away would overstate the method.
    const floor = Math.min(self.get(a).exact ?? 0, self.get(b).exact ?? 0);
    cross.push({ a, b, ...agreed, floor, margin: floor - (agreed.exact ?? 0), nearTwin: isNearTwin(a, b) });
  }
}

// A curated battery, to separate "the method does not work" from "these prompts
// do not work". Half the prompts, chosen for discrimination rather than at random.
const promptScores = scorePrompts();
const CURATED_N = Math.max(4, Math.ceil(promptScores.length / 2));
const curatedPrompts = new Set(promptScores.slice(0, CURATED_N).map((r) => r.prompt));

function marginsOver(prompts) {
  const selfBy = new Map(
    probed.map((m) => [m, agreement(responses.get(m), responses.get(m), { sameSet: true, prompts })]),
  );
  const pairs = [];
  for (let i = 0; i < probed.length; i += 1) {
    for (let j = i + 1; j < probed.length; j += 1) {
      const a = probed[i];
      const b = probed[j];
      const agreed = agreement(responses.get(a), responses.get(b), { sameSet: false, prompts });
      const floor = Math.min(selfBy.get(a).exact ?? 0, selfBy.get(b).exact ?? 0);
      pairs.push({ a, b, ...agreed, floor, margin: floor - (agreed.exact ?? 0), nearTwin: isNearTwin(a, b) });
    }
  }
  pairs.sort((x, y) => x.margin - y.margin);
  return {
    weakestSelf: probed.length ? Math.min(...probed.map((m) => selfBy.get(m).exact ?? 0)) : 0,
    pairs,
  };
}

const curated = marginsOver(curatedPrompts);

// ─── Report ───────────────────────────────────────────────────────────────────

const pct = (x) => (x === null ? '   —' : `${(x * 100).toFixed(1).padStart(5)}%`);

console.log(`\n${'─'.repeat(72)}\nSELF-AGREEMENT (the noise floor — same model, repeated)\n`);
for (const m of probed) {
  const s = self.get(m);
  console.log(`  ${m.padEnd(38)} exact ${pct(s.exact)}   sim ${pct(s.sim)}   n=${s.n}`);
}

console.log(`\nCROSS-MODEL AGREEMENT (what a substituted model would look like)\n`);
cross.sort((x, y) => x.margin - y.margin);
for (const c of cross) {
  const label = `${c.a.split('/').pop()} vs ${c.b.split('/').pop()}`;
  console.log(`  ${label.padEnd(46)} exact ${pct(c.exact)}  margin ${pct(c.margin)}${c.nearTwin ? '  ← near twin' : ''}`);
}

const worst = cross.length ? cross[0] : null;
const twin = cross.find((c) => c.nearTwin) || null;
const weakestSelf = probed.length ? Math.min(...probed.map((m) => self.get(m).exact ?? 0)) : 0;

console.log(`\nPROMPT DISCRIMINATION (self minus cross, per prompt)\n`);
for (const r of promptScores) {
  const keep = curatedPrompts.has(r.prompt) ? 'keep' : ' cut';
  console.log(`  ${keep}  ${pct(r.discrimination)}  self ${pct(r.self)} cross ${pct(r.cross)}  ${r.prompt.slice(0, 44)}`);
}

const cWorst = curated.pairs[0] || null;
const cTwin = curated.pairs.find((c) => c.nearTwin) || null;

console.log(`\n${'─'.repeat(72)}`);
console.log('                           full battery      curated top-' + CURATED_N);
console.log(`  weakest self-agreement   ${pct(weakestSelf)}            ${pct(curated.weakestSelf)}`);
console.log(`  narrowest margin         ${pct(worst?.margin ?? null)}            ${pct(cWorst?.margin ?? null)}`);
console.log(`  near-twin margin         ${pct(twin?.margin ?? null)}            ${pct(cTwin?.margin ?? null)}`);
console.log(`\n  spent                    $${spent.toFixed(4)} of $${BUDGET_USD.toFixed(2)}${stoppedForBudget ? '  (STOPPED AT CAP)' : ''}`);

/**
 * Sample size to tell two agreement rates apart at 95% confidence, 80% power.
 * This is the number that decides whether spot-checking is viable, because it is
 * what turns a noisy per-call comparison into a claim about a provider.
 */
function samplesNeeded(p1, p2) {
  if (p1 === null || p2 === null || p1 === p2) return null;
  const pooled = (p1 + p2) / 2;
  return Math.ceil((2 * (1.96 + 0.84) ** 2 * pooled * (1 - pooled)) / (p1 - p2) ** 2);
}

const nFull = worst ? samplesNeeded(worst.floor, worst.exact) : null;
const nCurated = cWorst ? samplesNeeded(cWorst.floor, cWorst.exact) : null;

console.log(`\nVERDICT`);
console.log('  Per-call comparison is not viable and never was: the weakest model disagrees with');
console.log(`  itself ${pct(1 - weakestSelf).trim()} of the time at temperature 0, so a single mismatch carries no`);
console.log('  information. The claim has to be about a *rate* over many samples, not a call.');
if (nFull || nCurated) {
  console.log(`\n  Samples needed to separate the hardest pair from its own noise floor:`);
  console.log(`    full battery   ${nFull ?? '—'} checks`);
  console.log(`    curated        ${nCurated ?? '—'} checks`);
  const best = Math.min(nFull ?? Infinity, nCurated ?? Infinity);
  if (Number.isFinite(best)) {
    console.log(`\n  At ${best} checks per provider-model pair this is out of reach for one customer's`);
    console.log('  traffic and easy across the network — which is the pooling decision in ADR 0007,');
    console.log('  now with a number attached rather than an intuition.');
  }
}

console.log('\nNOT MEASURED HERE');
console.log('  Cross-provider (the real check: the same model on two hubs) — needs a Theta key.');
console.log('  AkashML accepts `logprobs` but returns null, so distribution fingerprinting,');
console.log('  which would be far stronger than text comparison, is unavailable on this hub.');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    at: new Date().toISOString(),
    config: { reps: REPS, prompts: PROBES.length, maxTokens: MAX_TOKENS, budgetUsd: BUDGET_USD },
    spentUsd: Number(spent.toFixed(6)),
    stoppedForBudget,
    health: Object.fromEntries(health),
    self: Object.fromEntries(self),
    cross,
    weakestSelf,
    narrowestMargin: worst?.margin ?? null,
    nearTwinMargin: twin?.margin ?? null,
    promptScores,
    curated: { keep: [...curatedPrompts], weakestSelf: curated.weakestSelf, pairs: curated.pairs },
    samplesNeeded: { full: nFull, curated: nCurated },
    // Raw responses, so the battery can be re-scored with a different comparator
    // without paying for the calls again.
    responses: Object.fromEntries([...responses].map(([m, byPrompt]) => [m, Object.fromEntries(byPrompt)])),
  }, null, 2));
  console.log(`\nWrote ${JSON_OUT}`);
}
