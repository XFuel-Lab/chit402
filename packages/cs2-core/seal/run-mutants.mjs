#!/usr/bin/env node
/**
 * Mutation runner for the cs2 HPKE line seal.
 *
 *   node packages/cs2-core/seal/run-mutants.mjs [repo-root]
 *   node packages/cs2-core/seal/run-mutants.mjs --only S01_dk_label
 *
 * Each mutant is a literal find/replace applied to the original file.
 * The seal suite must pass before any mutant runs. A mutant whose suite
 * fails is KILLED. One that still passes SURVIVED. A find that misses is
 * NOT_APPLIED. The file is restored after every mutant and checked by sha256.
 * Score is killed / (killed + survived). The run fails below 90%.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const listPath = resolve(opt('--list', join(HERE, 'mutants.json')));

function findRoot(start) {
  let dir = resolve(start);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

const rootArg = args.find((arg) => !arg.startsWith('--') && arg !== opt('--only', '') && arg !== opt('--list', '') && arg !== opt('--timeout-sec', ''));
const root = rootArg ? resolve(rootArg) : findRoot(HERE);
if (!root || !existsSync(join(root, '.git'))) {
  process.stderr.write('usage: node run-mutants.mjs [repo-root] [--only ID] [--no-unshare] [--timeout-sec 120]\n');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(listPath, 'utf8'));
const mutants = spec.mutants.filter((mutant) => only.size === 0 || only.has(mutant.id));
const originals = new Map();

function restoreAll() {
  for (const [abs, text] of originals) writeFileSync(abs, text);
  originals.clear();
}

let child = null;
process.on('exit', () => { restoreAll(); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    restoreAll();
    process.exit(130);
  });
}

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function applyMutant(mutant) {
  const abs = join(root, mutant.file);
  const text = readFileSync(abs, 'utf8');
  const want = mutant.nth || 1;
  let seen = 0;
  let at = 0;
  while (at <= text.length) {
    const found = text.indexOf(mutant.find, at);
    if (found < 0) return false;
    seen += 1;
    if (seen === want) {
      const next = text.slice(0, found) + mutant.replace + text.slice(found + mutant.find.length);
      if (next === text) return false;
      originals.set(abs, text);
      writeFileSync(abs, next);
      return true;
    }
    at = found + mutant.find.length;
  }
  return false;
}

function runSuite() {
  const suite = spec.suite;
  const tmp = mkdtempSync(join(tmpdir(), 'cs2-seal-mut-'));
  const argv = useUnshare
    ? ['-rn', 'sh', '-c', 'ip link set lo up 2>/dev/null; exec "$@"', 'sh', ...suite.argv]
    : suite.argv.slice(1);
  const cmd = useUnshare ? 'unshare' : suite.argv[0];
  return new Promise((resolveRun) => {
    let out = '';
    let settled = false;
    let spawnFailed = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child = null;
      rmSync(tmp, { recursive: true, force: true });
      resolveRun({ result, out });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (child && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }, timeoutMs);
    try {
      child = spawn(cmd, argv, {
        cwd: join(root, suite.cwd || '.'),
        env: { ...process.env, ...(suite.env || {}), TMPDIR: tmp },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      spawnFailed = true;
      out += err?.message || 'spawn_error';
      restoreAll();
      finish('ERROR');
      return;
    }
    const cap = (chunk) => {
      out += chunk;
      if (out.length > 1_000_000) out = out.slice(-500_000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    child.on('error', (err) => {
      spawnFailed = true;
      out += err?.message || 'spawn_error';
      restoreAll();
      finish('ERROR');
    });
    child.on('close', (code) => {
      setImmediate(() => {
        if (spawnFailed) {
          restoreAll();
          finish('ERROR');
          return;
        }
        finish(timedOut ? 'TIMEOUT' : (code === 0 ? 'PASS' : 'FAIL'));
      });
    });
  });
}

function label(result) {
  if (result === 'PASS') return 'SURVIVED';
  if (result === 'FAIL') return 'KILLED';
  if (result === 'TIMEOUT') return 'TIMEOUT';
  return 'ERROR';
}

const touched = [...new Set(mutants.map((mutant) => mutant.file))];
const before = Object.fromEntries(touched.map((file) => [file, sha256(join(root, file))]));

const baseline = await runSuite();
process.stdout.write(`BASELINE\tseal\t${baseline.result}\n`);
if (baseline.result !== 'PASS') {
  process.stderr.write(baseline.out.slice(-4000));
  process.exit(3);
}

const tally = {};
for (const mutant of mutants) {
  let result;
  try {
    if (!applyMutant(mutant)) result = 'NOT_APPLIED';
    else result = label((await runSuite()).result);
  } finally {
    restoreAll();
  }
  tally[result] = (tally[result] || 0) + 1;
  process.stdout.write(`MUT\t${mutant.id}\t${result}\t${mutant.note || ''}\n`);
}

const dirty = touched.filter((file) => sha256(join(root, file)) !== before[file]);
const killed = tally.KILLED || 0;
const survived = tally.SURVIVED || 0;
const applicable = killed + survived;
const score = applicable === 0 ? 0 : killed / applicable;
process.stdout.write(`TALLY\t${JSON.stringify(tally)}\tRESTORED\t${dirty.length ? `NO: ${dirty.join(',')}` : 'yes'}\n`);
process.stdout.write(`SCORE\t${killed}/${applicable}\t${(score * 100).toFixed(1)}%\n`);

if (dirty.length) process.exit(4);
if (tally.NOT_APPLIED || tally.ERROR || tally.TIMEOUT) process.exit(1);
if (score < 0.9) process.exit(1);
process.exit(0);
