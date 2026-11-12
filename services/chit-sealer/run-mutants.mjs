#!/usr/bin/env node
/**
 * Mutation runner for the P0-8 sealer and store.
 *
 *   node services/chit-sealer/run-mutants.mjs [repo-root]
 *
 * The suite must pass before any mutant runs. Each mutant is one literal
 * find/replace. A kill is an assertion failure. A crash that is not an
 * assertion is hollow. A find that misses is not applied. The tree is
 * restored on exit, Ctrl-C, and SIGTERM. The loop yields so those signals
 * fire between mutants. Score is killed / (killed + survived). The run
 * fails below 90%, or if a must-kill id is not killed.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const only = new Set((opt('--only', '') || '').split(',').filter(Boolean));
const useUnshare = !args.includes('--no-unshare');
const timeoutMs = Number(opt('--timeout-sec', '120')) * 1000;

function findRoot(start) {
  let dir = resolve(start);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

const rootArg = args.find((arg) => !arg.startsWith('--') && arg !== opt('--only', '') && arg !== opt('--timeout-sec', ''));
const root = rootArg ? resolve(rootArg) : findRoot(HERE);
if (!root || !existsSync(join(root, '.git'))) {
  process.stderr.write('usage: node run-mutants.mjs [repo-root] [--only ID] [--no-unshare] [--timeout-sec 120]\n');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(join(HERE, 'review-mutants.json'), 'utf8'));
const mutants = spec.mutants.filter((mutant) => only.size === 0 || only.has(mutant.id));
const originals = new Map();
let child = null;
let stop = false;

function restoreAll() {
  for (const [abs, text] of originals) writeFileSync(abs, text);
  originals.clear();
}

function halt(code) {
  stop = true;
  if (child && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  restoreAll();
  process.exit(code);
}

process.on('exit', () => { restoreAll(); });
process.on('SIGINT', () => halt(130));
process.on('SIGTERM', () => halt(130));

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function applyMutant(mutant) {
  const abs = join(root, mutant.file);
  const text = readFileSync(abs, 'utf8');
  if (text.split(mutant.find).length - 1 !== 1) return false;
  const next = text.replace(mutant.find, mutant.replace);
  if (next === text) return false;
  originals.set(abs, text);
  writeFileSync(abs, next);
  return true;
}

function runSuite() {
  const suite = spec.suite;
  const argv = useUnshare
    ? ['-rn', 'sh', '-c', 'ip link set lo up 2>/dev/null; exec "$@"', 'sh', ...suite.argv]
    : suite.argv.slice(1);
  const cmd = useUnshare ? 'unshare' : suite.argv[0];
  return new Promise((resolveRun) => {
    let out = '';
    let settled = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child = null;
      resolveRun({ result, out });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }, timeoutMs);
    child = spawn(cmd, argv, {
      cwd: join(root, suite.cwd || '.'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cap = (chunk) => {
      out += chunk;
      if (out.length > 1_000_000) out = out.slice(-500_000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    child.on('error', (err) => {
      out += err?.message || 'spawn_error';
      finish('ERROR');
    });
    child.on('close', (code) => {
      setImmediate(() => {
        if (timedOut) finish('TIMEOUT');
        else if (code === 0) finish('PASS');
        else if (/AssertionError|ERR_ASSERTION/.test(out)) finish('FAIL');
        else finish('OTHER');
      });
    });
  });
}

function label(result) {
  if (result === 'PASS') return 'SURVIVED';
  if (result === 'FAIL') return 'KILLED';
  if (result === 'OTHER') return 'HOLLOW';
  if (result === 'TIMEOUT') return 'TIMEOUT';
  return 'ERROR';
}

function yieldTurn() {
  return new Promise((resolveTurn) => { setImmediate(resolveTurn); });
}

const touched = [...new Set(mutants.map((mutant) => mutant.file))];
const before = Object.fromEntries(touched.map((file) => [file, sha256(join(root, file))]));

const baseline = await runSuite();
process.stdout.write(`BASELINE\tp0-8\t${baseline.result}\n`);
if (baseline.result !== 'PASS') {
  process.stderr.write(baseline.out.slice(-4000));
  process.exit(3);
}

const tally = {};
const rows = [];
for (const mutant of mutants) {
  await yieldTurn();
  if (stop) break;
  let result;
  try {
    if (!applyMutant(mutant)) result = 'NOT_APPLIED';
    else result = label((await runSuite()).result);
  } finally {
    restoreAll();
  }
  tally[result] = (tally[result] || 0) + 1;
  rows.push({ id: mutant.id, result });
  process.stdout.write(`MUT\t${mutant.id}\t${result}\t${mutant.note || ''}\n`);
}

const dirty = touched.filter((file) => sha256(join(root, file)) !== before[file]);
const killed = tally.KILLED || 0;
const survived = tally.SURVIVED || 0;
const hollow = tally.HOLLOW || 0;
const equivalent = tally.EQUIVALENT || 0;
const scored = killed + survived;
const score = scored === 0 ? 0 : killed / scored;
const must = new Set(['R1', 'R2', 'R3', 'R3b', 'R4', 'R5', 'R6', 'R7', 'R8', 'R8b', 'R8c', 'R9', 'R10', 'R10b', 'R11', 'R12', 'R13', 'C1', 'S1']);
const missed = rows.filter((row) => must.has(row.id) && row.result !== 'KILLED');

process.stdout.write(`TALLY\t${JSON.stringify({ ...tally, equivalent })}\tRESTORED\t${dirty.length ? `NO: ${dirty.join(',')}` : 'yes'}\n`);
process.stdout.write(`killed ${killed} survived ${survived} hollow ${hollow} equivalent ${equivalent} not_applied ${tally.NOT_APPLIED || 0} timeout ${tally.TIMEOUT || 0} score ${(score * 100).toFixed(1)}%\n`);

if (dirty.length) process.exit(4);
if (missed.length || tally.NOT_APPLIED || tally.ERROR || tally.TIMEOUT || hollow || score < 0.9) process.exit(1);
process.exit(0);
