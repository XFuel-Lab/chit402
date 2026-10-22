/**
 * Golden corpus runner and the never-worse comparison.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const corpusDir = fileURLToPath(new URL('.', import.meta.url));
// A file URL, so --import also works on Windows.
const preload = pathToFileURL(fileURLToPath(new URL('./tape-preload.mjs', import.meta.url))).href;
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const libraryRunner = fileURLToPath(new URL('./run-library.mjs', import.meta.url));

/** Higher is more permissive. VERIFIED > COULD_NOT_CHECK > INVALID. */
export function exitRank(exit) {
  if (exit === 0) return 2;
  if (exit === 2) return 1;
  return 0;
}

/** Per-check rank. pass > anything that is not a decision > fail. */
export function checkRank(value) {
  if (value === 'pass') return 2;
  if (value === 'fail') return 0;
  return 1;
}

function childEnv(tape) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(BASE_RPC_URL|SOLANA_RPC_URL|NODE_OPTIONS|CHIT_CORPUS_)/.test(k)) delete env[k];
  }
  return {
    ...env,
    CHIT_CORPUS_MODE: process.env.CHIT_CORPUS_MODE === 'record' ? 'record' : 'replay',
    CHIT_CORPUS_APPEND: '1',
    CHIT_CORPUS_TAPE: tape,
    // Chain reads are recorded only by record-chain.mjs (read methods, public RPC hosts).
    ...(process.env.CHIT_CORPUS_MODE === 'record' && process.env.CHIT_CORPUS_RPC === '1' ? { CHIT_CORPUS_RPC: '1' } : {}),
    // The tape preload replaces fetch for every host, so a chain read is
    // answered from the tape; the hermetic guard would refuse it earlier.
    CHIT402_ALLOW_PUBLIC_RPC: '1',
    CHIT402_RPC_BACKOFF_MS: '0',
  };
}

function summarize(proc) {
  const misses = (proc.stderr || '').split('\n').filter((l) => l.startsWith('corpus-tape-miss ')).map((l) => l.slice(17));
  let parsed = null;
  try { parsed = JSON.parse(proc.stdout); } catch { /* stderr outcome */ }
  if (parsed && typeof parsed === 'object' && 'exit_code' in parsed) {
    return {
      exit: proc.status,
      json_exit: parsed.exit_code,
      result: parsed.result ?? null,
      reason: parsed.reason ?? null,
      checks: parsed.checks ?? null,
      misses,
    };
  }
  if (parsed && typeof parsed === 'object' && 'overall' in parsed) {
    return { exit: parsed.exit, json_exit: parsed.exit, result: parsed.result, reason: parsed.reason, overall: parsed.overall, checks: parsed.checks, misses };
  }
  const first = (proc.stderr || '').split('\n').find((l) => l && !l.startsWith('corpus-tape-miss ')) || '';
  return { exit: proc.status, json_exit: null, result: null, reason: `stderr: ${first.slice(0, 80)}`, checks: null, misses };
}

function argsFor(c, path) {
  return path === 'library'
    ? ['--import', preload, libraryRunner, c.file, c.jwksFile, c.historyFile]
    : ['--import', preload, cli, c.file || c.input, '--json'];
}

/** Async run of one case on one path (replay only). */
export function runPathAsync(c, path, tape) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argsFor(c, path), { env: childEnv(tape), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => { clearTimeout(timer); resolve(summarize({ status, stdout, stderr })); });
  });
}

/** Run up to `limit` jobs at once. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Run one case on one path. `input` is a file path or a receipt id. */
export function runPath(c, path, tape) {
  const args = argsFor(c, path);
  const proc = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, env: childEnv(tape) });
  if (proc.error) return { exit: null, json_exit: null, result: null, reason: `spawn: ${proc.error.code || proc.error.message}`, checks: null, misses: [] };
  return summarize(proc);
}

/** The pinned part of an outcome. */
export function pinned(o) {
  const out = { exit: o.exit, result: o.result, reason: o.reason, checks: o.checks };
  if (o.overall !== undefined) out.overall = o.overall;
  return out;
}

/**
 * Compare an outcome to its baseline. Returns a list of problems.
 * - never more permissive: exit rank and every check rank stay at or below
 *   the baseline (every case);
 * - exact: exit, result, reason and checks equal the baseline unless a
 *   recorded change in changes.json names this case and path.
 */
export function compare(baseline, actual, change) {
  const problems = [];
  const expected = change ? change.to : baseline;
  if (exitRank(actual.exit) > exitRank(baseline.exit)) {
    problems.push(`more permissive: exit ${baseline.exit} -> ${actual.exit}`);
  }
  if (baseline.overall === 'failed' && actual.overall && actual.overall !== 'failed') {
    problems.push(`more permissive: overall failed -> ${actual.overall}`);
  }
  if (baseline.overall === 'partial' && /^verified/.test(String(actual.overall || ''))) {
    problems.push(`more permissive: overall partial -> ${actual.overall}`);
  }
  for (const [name, value] of Object.entries(baseline.checks || {})) {
    const now = actual.checks ? actual.checks[name] : undefined;
    if (now !== undefined && checkRank(now) > checkRank(value)) {
      problems.push(`more permissive: checks.${name} ${value} -> ${now}`);
    }
  }
  if (change && exitRank(change.to.exit) > exitRank(baseline.exit)) {
    problems.push('changes.json entry is more permissive than the baseline');
  }
  const a = JSON.stringify(pinned(actual));
  const e = JSON.stringify(pinned(expected));
  if (a !== e) problems.push(`changed: expected ${e} got ${a}${change ? '' : ' (no changes.json entry)'}`);
  return problems;
}
