#!/usr/bin/env node
/**
 * Settle refusal counts by network x reason x sub_reason x phase, as JSON.
 *
 *   OPS_READ_TOKEN=... node scripts/refusal-counts.mjs --base https://api.chit402.com \
 *     --since 2026-10-26T00:00:00Z [--until 2026-10-27T00:00:00Z]
 *
 * Read-only: one GET of /v1/ops/receipt-failures?breakdown=1 with the ops
 * token as Authorization: Bearer. The token is read from the environment and
 * never printed. Prints {"refusal_breakdown": {...}} to stdout, or an error
 * line to stderr with exit 1. The daily receipt-failure check calls this, and
 * a spike alert compares one window's counts with the trailing ones.
 */
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const base = flag('base') || process.env.REFUSAL_COUNTS_BASE || null;
const since = flag('since');
const until = flag('until');
const token = process.env.OPS_READ_TOKEN;

function die(msg) {
  process.stderr.write(`refusal-counts: ${msg}\n`);
  process.exit(1);
}

if (!base) die('--base is required');
if (typeof token !== 'string' || !token.trim()) die('OPS_READ_TOKEN is not set');
for (const [name, value] of [['since', since], ['until', until]]) {
  if (value != null && !Number.isFinite(Date.parse(value))) die(`--${name} is not a date`);
}

const url = new URL('/v1/ops/receipt-failures', base);
url.searchParams.set('breakdown', '1');
if (since) url.searchParams.set('since', since);
if (until) url.searchParams.set('until', until);

let res;
try {
  res = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token.trim()}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  die(`GET failed: ${err?.name || 'error'}`);
}
if (!res.ok) die(`GET ${url.pathname} returned ${res.status}`);
let body;
try { body = await res.json(); } catch { die('response is not JSON'); }
if (!body || typeof body.refusal_breakdown !== 'object' || body.refusal_breakdown === null) {
  die('response has no refusal_breakdown (gateway older than this script?)');
}
process.stdout.write(`${JSON.stringify({ refusal_breakdown: body.refusal_breakdown })}\n`);
