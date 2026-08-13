#!/usr/bin/env node
/**
 * Availability probe — does the catalogue tell the truth?
 *
 * A hub's discovery endpoint lists what it *offers*. That is not the same as what
 * it will *serve*: Theta has listed on-demand chat models that return an error on
 * every request. An agent cannot tell the difference before it spends money, and
 * unlike a human it does not give up and try something else — it retries, burns
 * budget, or fails silently in the middle of a loop.
 *
 * So this measures the gap directly: read each hub's catalogue, then send every
 * chat model a real (tiny) request and record what actually comes back. The
 * output is the difference between advertised and live supply, per hub, with
 * latency and a failure class for anything that did not serve.
 *
 * Deliberately uses the same request shapes as the production adapters
 * (`akashml-infer.js`, `edgecloud-infer.js`) — a probe that talks to the provider
 * differently to the gateway measures the probe, not the provider.
 *
 * Usage (from repo root):
 *   node scripts/dev/_availability_probe.mjs
 *   node scripts/dev/_availability_probe.mjs --out availability.json --concurrency 6
 *   node scripts/dev/_availability_probe.mjs --hub theta
 *
 * Cost: one 8-token completion per chat model, so cents. Safe to run on a loop.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// Load env the same way the canary probe does, so this runs from anywhere.
for (const envPath of [join(REPO_ROOT, 'services', 'gateway', '.env'), join(REPO_ROOT, '.env')]) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k] !== undefined) continue;
    process.env[k] = rawV.replace(/^["']|["']$/g, '').trim();
  }
}

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = flag('out', null);
const CONCURRENCY = Math.max(1, Number(flag('concurrency', '6')) || 6);
const ONLY_HUB = flag('hub', null);
/**
 * Generous on purpose. Reasoning models (GLM-5.2 and friends) spend budget on
 * `reasoning_content` before emitting any answer, so a small ceiling returns a
 * 200 with empty content and `finish_reason: length`. That is an under-budgeted
 * request, not an unavailable model — measuring it as downtime would invent a
 * failure. See the note in `akashml-infer.js`.
 */
const MAX_TOKENS = Math.max(1, Number(flag('max-tokens', '512')) || 512);
const TIMEOUT_MS = Math.max(1000, Number(flag('timeout', '45000')) || 45_000);

const THETA_BASE = process.env.THETA_EDGECLOUD_BASE || 'https://ondemand.thetaedgecloud.com';
const AKASH_BASE = process.env.AKASHML_BASE_URL || 'https://api.akashml.com/v1';
const THETA_KEY = process.env.THETA_EDGECLOUD_API_KEY || '';
const AKASH_KEY = process.env.AKASHML_API_KEY || '';

const PROMPT = 'Reply with exactly one word: ocean';

/** Classify a failure so the report distinguishes "provider is down" from "we are misconfigured". */
function classify(status, detail = '') {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'payment_required';
  if (status >= 500) return 'provider_error';
  if (status >= 400) return 'bad_request';
  if (/abort|timeout/i.test(detail)) return 'timeout';
  return 'unknown';
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { throw new Error(`unparseable: ${text.slice(0, 160)}`); }
}

// ─── Catalogues ──────────────────────────────────────────────────────────────

async function thetaCatalogue() {
  const data = await fetchJson(`${THETA_BASE}/service/list`, { headers: { Accept: 'application/json' } });
  const services = data?.body?.services || data?.services || [];
  return services
    // `alias` is the callable id (`glm_5_2`); `name` is a display string
    // ("GLM 5.2") that 404s if you POST to it. Same rule as `mapThetaService`.
    .filter((s) => s && s.state !== 'private' && String(s.alias || '').trim())
    .map((s) => ({
      hub: 'theta',
      id: String(s.alias).trim(),
      // Theta publishes worker counts per service — a capacity signal no other
      // hub gives us, and the closest thing to a live availability number that
      // exists today without probing.
      workers: Array.isArray(s.workers) ? s.workers.length : (s.workers ?? null),
      executions: s.executions ?? null,
      raw: s,
    }));
}

async function akashCatalogue() {
  const headers = { Accept: 'application/json' };
  if (AKASH_KEY) headers.Authorization = `Bearer ${AKASH_KEY}`;
  const data = await fetchJson(`${AKASH_BASE}/models`, { headers });
  const rows = data?.data || data?.models || [];
  return rows.map((m) => ({ hub: 'akash', id: m?.id || null, raw: m })).filter((m) => m.id);
}

/**
 * Chat-only filter. Image/audio models are excluded because a text probe would
 * fail against them for reasons that say nothing about availability.
 */
function looksLikeChat(model) {
  const id = String(model.id).toLowerCase();
  if (/whisper|stable[-_]?diffusion|sdxl|flux|esrgan|image|tts|embed|rerank|vision|llava|blip|image[-_]?to[-_]?image/.test(id)) return false;
  if (model.hub === 'theta') {
    // Authoritative rather than name-guessing: a chat service is one whose
    // prediction actually declares a `messages` input of type chat_array.
    const preds = model.raw?.predictions || {};
    const hasChatInput = Object.values(preds).some(
      (p) => String(p?.input_vars?.messages?.type || '') === 'chat_array',
    );
    return hasChatInput;
  }
  return true;
}

// ─── Probes, matching the production adapters ────────────────────────────────

async function probeAkash(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${String(AKASH_BASE).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AKASH_KEY}` },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const elapsed = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, elapsed_ms: elapsed, status: res.status, failure: classify(res.status, text), detail: text.slice(0, 200) };
    }
    const json = JSON.parse(text);
    const choice = json?.choices?.[0];
    const out = choice?.message?.content;
    const finish = choice?.finish_reason || null;
    if (typeof out !== 'string' || !out.trim()) {
      // Distinguish "we did not pay for enough tokens" from "the provider
      // returned nothing". Only the second is an availability problem.
      const failure = finish === 'length' ? 'under_budgeted' : 'empty_output';
      return { ok: false, elapsed_ms: elapsed, status: 200, failure, finish_reason: finish, detail: text.slice(0, 200) };
    }
    return { ok: true, elapsed_ms: elapsed, status: 200, finish_reason: finish, output: out.trim().slice(0, 80) };
  } catch (err) {
    return { ok: false, elapsed_ms: Date.now() - t0, status: null, failure: classify(0, err.message), detail: err.message.slice(0, 200) };
  }
}

async function probeTheta(model) {
  const t0 = Date.now();
  const waitSec = Math.ceil(TIMEOUT_MS / 1000);
  try {
    const res = await fetch(
      `${String(THETA_BASE).replace(/\/$/, '')}/infer_request/${encodeURIComponent(model.id)}?wait=${waitSec}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${THETA_KEY}` },
        body: JSON.stringify({
          // `stream` defaults to TRUE in Theta's own input_vars, so omitting it
          // returns SSE and any JSON.parse of the body fails — which looks
          // identical to an outage unless you read the payload.
          input: { messages: [{ role: 'user', content: PROMPT }], max_tokens: MAX_TOKENS, stream: false },
          stream: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS + 15_000),
      },
    );
    const elapsed = Date.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, elapsed_ms: elapsed, status: res.status, failure: classify(res.status, text), detail: text.slice(0, 200) };
    }
    let json;
    try { json = JSON.parse(text); } catch {
      return { ok: false, elapsed_ms: elapsed, status: 200, failure: 'unparseable', detail: text.slice(0, 200) };
    }
    // Theta returns a job envelope, not an OpenAI body: the result lives at
    // body.infer_requests[0], with an explicit `state` and — uniquely among our
    // hubs — the actual `cost_usd` of the call.
    const job = json?.body?.infer_requests?.[0] || json?.body?.infer_request || null;
    if (job?.state && job.state !== 'success') {
      return {
        ok: false, elapsed_ms: elapsed, status: 200,
        failure: job.state === 'failed' ? 'provider_error' : `state_${job.state}`,
        detail: String(job.error_message || job.state).slice(0, 200),
      };
    }
    const out = job?.output ?? json?.body?.output ?? json?.output;
    const asText = typeof out === 'string'
      ? out
      : (out?.message ?? out?.text ?? out?.content ?? null);
    if (!asText || !String(asText).trim()) {
      return { ok: false, elapsed_ms: elapsed, status: 200, failure: 'empty_output', detail: text.slice(0, 200) };
    }
    return {
      ok: true, elapsed_ms: elapsed, status: 200,
      output: String(asText).trim().slice(0, 80),
      usage: job?.usage ?? null,
      // Ground truth COGS, straight from the provider.
      cost_usd: job?.cost_usd ?? null,
    };
  } catch (err) {
    return { ok: false, elapsed_ms: Date.now() - t0, status: null, failure: classify(0, err.message), detail: err.message.slice(0, 200) };
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const startedAt = new Date().toISOString();
const catalogue = [];
const catalogueErrors = {};

for (const [hub, loader, key] of [
  ['theta', thetaCatalogue, THETA_KEY],
  ['akash', akashCatalogue, AKASH_KEY],
]) {
  if (ONLY_HUB && ONLY_HUB !== hub) continue;
  if (!key) {
    catalogueErrors[hub] = 'no api key configured';
    console.log(`${hub}: SKIPPED — no API key`);
    continue;
  }
  try {
    const rows = await loader();
    catalogue.push(...rows);
    console.log(`${hub}: catalogue lists ${rows.length} services`);
  } catch (err) {
    catalogueErrors[hub] = err.message;
    console.log(`${hub}: catalogue FAILED — ${err.message}`);
  }
}

const targets = catalogue.filter(looksLikeChat);
console.log(`\nProbing ${targets.length} chat models (concurrency ${CONCURRENCY}, max_tokens ${MAX_TOKENS})…\n`);

const results = await pool(targets, CONCURRENCY, async (m) => {
  const r = m.hub === 'theta' ? await probeTheta(m) : await probeAkash(m);
  const mark = r.ok ? 'up  ' : 'DOWN';
  const note = r.ok ? `${r.elapsed_ms}ms` : `${r.failure}${r.status ? ` (${r.status})` : ''}`;
  console.log(`  ${mark} ${`${m.hub}/${m.id}`.padEnd(46)} ${note}`);
  return { hub: m.hub, id: m.id, ...r };
});

// ─── Report ──────────────────────────────────────────────────────────────────

/**
 * Not every non-success is the provider's fault. An under-budgeted request or a
 * missing key on our side says nothing about whether the model is up, and
 * counting either as downtime would overstate the very number this exists to
 * measure honestly.
 */
const INCONCLUSIVE = new Set(['under_budgeted', 'auth', 'payment_required']);

const byHub = {};
for (const r of results) {
  const h = (byHub[r.hub] ||= { advertised: 0, serving: 0, unavailable: 0, inconclusive: 0, failures: {}, latencies: [] });
  h.advertised += 1;
  if (r.ok) {
    h.serving += 1;
    h.latencies.push(r.elapsed_ms);
  } else {
    h.failures[r.failure] = (h.failures[r.failure] || 0) + 1;
    if (INCONCLUSIVE.has(r.failure)) h.inconclusive += 1;
    else h.unavailable += 1;
  }
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log('\n─── Advertised vs actually serving ─────────────────────────────');
for (const [hub, h] of Object.entries(byHub)) {
  // Denominator excludes inconclusive probes, so this is availability, not
  // "everything that did not return a string".
  const judged = h.serving + h.unavailable;
  const pct = judged ? ((h.serving / judged) * 100).toFixed(0) : '–';
  console.log(
    `  ${hub.padEnd(8)} ${String(h.serving).padStart(2)}/${String(judged).padEnd(2)} serving (${pct}%)`
    + `   advertised ${String(h.advertised).padEnd(3)}`
    + `   median ${median(h.latencies) ?? '–'}ms`
    + (h.inconclusive ? `   inconclusive ${h.inconclusive}` : '')
    + (Object.keys(h.failures).length ? `   [${Object.entries(h.failures).map(([k, v]) => `${k}=${v}`).join(' ')}]` : ''),
  );
}

const totalUp = results.filter((r) => r.ok).length;
const totalBad = results.filter((r) => !r.ok && !INCONCLUSIVE.has(r.failure)).length;
console.log(`\n  TOTAL    ${totalUp}/${totalUp + totalBad} advertised chat models actually served a request.`);
if (totalBad) {
  console.log(`  ${totalBad} model(s) are listed in a catalogue but could not be used just now.`);
}

const report = {
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  catalogue_errors: catalogueErrors,
  summary: Object.fromEntries(Object.entries(byHub).map(([hub, h]) => [hub, {
    advertised: h.advertised,
    serving: h.serving,
    unavailable: h.unavailable,
    inconclusive: h.inconclusive,
    availability_pct: (h.serving + h.unavailable)
      ? Number(((h.serving / (h.serving + h.unavailable)) * 100).toFixed(1))
      : null,
    median_latency_ms: median(h.latencies),
    failures: h.failures,
  }])),
  results,
};

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${OUT}`);
}
