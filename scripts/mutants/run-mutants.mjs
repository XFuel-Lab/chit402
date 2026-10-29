#!/usr/bin/env node
/**
 * Portable mutant runner for PR #665 (post-settle holds).
 *
 * usage: node run-mutants.mjs <repo-root> [--list mutants.json] [--only ID,ID] [--no-unshare] [--timeout-sec 180]
 *
 * - Every mutant is data (mutants.json): file, a regex `find`, `replace`, which
 *   occurrence (`nth`, 1-based, default 1) and a `suite` name.
 * - Suites are data too (mutants.json "suites"): cwd relative to the repo root,
 *   argv, and extra env. A baseline run of every used suite must pass first,
 *   or the runner stops (a broken baseline makes every mutant look KILLED).
 * - Each run is wrapped in `unshare -rn` (loopback up) with a private TMPDIR,
 *   unless --no-unshare. Timeout per mutant run: 180 s (SIGKILL), reported TIMEOUT.
 * - Files are restored after every mutant, on SIGINT/SIGTERM, on process exit,
 *   and verified by sha256 at the end. A mutant whose pattern does not match
 *   is NOT_APPLIED. A suite that fails to spawn is ERROR, never KILLED, and
 *   the mutated file is restored.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null;
const selfCheck = args.includes('--self-check');
const selfCheckExit = args.includes('--self-check-exit');
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const listPath = resolve(opt('--list', join(HERE, 'mutants.json')));
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const useUnshare = !args.includes('--no-unshare');
const timeoutMs = Number(opt('--timeout-sec', '180')) * 1000;

let spec = null;
const originals = new Map();
function restoreAll() {
  for (const [abs, text] of originals) writeFileSync(abs, text);
  originals.clear();
}
// Suites run async so these handlers fire mid-run (spawnSync blocks the event loop).
let child = null;
// Backstop: a crash after a mutant is applied still puts the original bytes back.
process.on('exit', () => { restoreAll(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (child && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
  restoreAll();
  process.exit(130);
});

function mutantLabel(suiteResult) {
  if (suiteResult === 'PASS') return 'SURVIVED';
  if (suiteResult === 'FAIL') return 'KILLED';
  if (suiteResult === 'TIMEOUT') return 'TIMEOUT';
  return 'ERROR';
}

function runSuite(name) {
  const s = spec.suites[name];
  const tmp = mkdtempSync(join(tmpdir(), 'mut-'));
  const env = { ...process.env, ...(s.env || {}), TMPDIR: tmp };
  const cmd = useUnshare ? 'unshare' : s.argv[0];
  const argv = useUnshare
    ? ['-rn', 'sh', '-c', 'ip link set lo up 2>/dev/null; exec "$@"', 'sh', ...s.argv]
    : s.argv.slice(1);
  return spawnSuite({ cmd, argv, cwd: join(root, s.cwd), env, timeoutMs, tmp });
}

function spawnSuite({ cmd, argv, cwd, env, timeoutMs: limit, tmp }) {
  return new Promise((resolveRun) => {
    let out = '';
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child = null;
      if (tmp) rmSync(tmp, { recursive: true, force: true });
      resolveRun({ result, out });
    };
    const cap = (d) => { out += d; if (out.length > 1_000_000) out = out.slice(-500_000); };
    timer = setTimeout(() => {
      timedOut = true;
      if (child && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
    }, limit);
    try {
      child = spawn(cmd, argv, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      spawnFailed = true;
      out += err?.message || 'spawn_error';
      restoreAll();
      finish('ERROR');
      return;
    }
    if (child.stdout) child.stdout.on('data', cap);
    if (child.stderr) child.stderr.on('data', cap);
    // A missing binary emits error. That is ERROR, never a suite FAIL (which
    // would be recorded as KILLED). Restore before the result is reported.
    child.on('error', (err) => {
      spawnFailed = true;
      out += err?.message || 'spawn_error';
      restoreAll();
      finish('ERROR');
    });
    child.on('close', (code) => {
      // Let an error event queued in this turn win over a null close code.
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

function applyMutant(m) {
  const abs = join(root, m.file);
  const text = readFileSync(abs, 'utf8');
  const re = new RegExp(m.find, 'g' + (m.flags || ''));
  let n = 0;
  const want = m.nth || 1;
  const next = text.replace(re, (...g) => {
    n += 1;
    if (n !== want) return g[0];
    return m.replace.replace(/\$(\d)/g, (_, d) => g[Number(d)] ?? '');
  });
  if (next === text) return false;
  originals.set(abs, text);
  writeFileSync(abs, next);
  return true;
}

async function proveSpawnRestores() {
  const dir = mkdtempSync(join(tmpdir(), 'mut-self-'));
  const file = join(dir, 'watched.txt');
  const original = 'alpha\n';
  writeFileSync(file, original);
  const missing = 'mutant-runner-missing-bin';
  try {
    originals.set(file, original);
    writeFileSync(file, 'beta\n');
    const spawned = await spawnSuite({
      cmd: missing,
      argv: [],
      cwd: dir,
      env: process.env,
      timeoutMs: 5000,
      tmp: null,
    });
    const label = mutantLabel(spawned.result);
    const after = readFileSync(file, 'utf8');
    if (after !== original || label !== 'ERROR') {
      console.error(`spawn self-check failed label=${label} bytes=${JSON.stringify(after)} ${spawned.out}`);
      return 1;
    }
    console.log('MUT\tself_spawn\tERROR\tspawn failure restored the file');

    writeFileSync(file, original);
    const exitProbe = spawnSync(process.execPath, [
      fileURLToPath(import.meta.url),
      '--self-check-exit',
      file,
    ], { encoding: 'utf8' });
    const exited = readFileSync(file, 'utf8');
    if (exitProbe.status !== 7 || exited !== original) {
      console.error(`exit self-check failed status=${exitProbe.status} bytes=${JSON.stringify(exited)} ${exitProbe.stdout}${exitProbe.stderr}`);
      return 1;
    }
    console.log('MUT\tself_exit\tRESTORED\texit backstop restored the file');
    return 0;
  } finally {
    originals.delete(file);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (selfCheckExit) {
  const file = opt('--self-check-exit', '');
  const original = readFileSync(file, 'utf8');
  originals.set(file, original);
  writeFileSync(file, 'beta\n');
  process.exit(7);
}

if (selfCheck) {
  process.exit(await proveSpawnRestores());
}

if (!root || !existsSync(join(root, '.git'))) {
  console.error('usage: node run-mutants.mjs <repo-root> [--list mutants.json] [--only ID,ID] [--no-unshare] [--timeout-sec 180]');
  process.exit(2);
}

spec = JSON.parse(readFileSync(listPath, 'utf8'));
const mutants = spec.mutants.filter((m) => !only.length || only.includes(m.id));

// Never run against a symlinked node_modules (a mutant run could touch a shared tree).
for (const s of Object.values(spec.suites)) {
  const nm = join(root, s.cwd, 'node_modules');
  if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) {
    console.error(`refusing: ${nm} is a symlink`);
    process.exit(2);
  }
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const touched = [...new Set(mutants.map((m) => m.file))];
const before = Object.fromEntries(touched.map((f) => [f, sha(join(root, f))]));

const suites = [...new Set(mutants.map((m) => m.suite))];
for (const name of suites) {
  const b = await runSuite(name);
  console.log(`BASELINE\t${name}\t${b.result}`);
  if (b.result !== 'PASS') { console.error(b.out.slice(-4000)); process.exit(3); }
}

const tally = {};
for (const m of mutants) {
  let result;
  try {
    if (!applyMutant(m)) result = 'NOT_APPLIED';
    else result = mutantLabel((await runSuite(m.suite)).result);
  } finally {
    restoreAll();
  }
  tally[result] = (tally[result] || 0) + 1;
  console.log(`MUT\t${m.id}\t${result}\t${m.note || ''}`);
}
const dirty = touched.filter((f) => sha(join(root, f)) !== before[f]);
const errored = tally.ERROR || 0;
console.log(`TALLY\t${JSON.stringify(tally)}\tRESTORED\t${dirty.length ? 'NO: ' + dirty.join(',') : 'yes'}`);
process.exit(dirty.length ? 4 : errored ? 5 : 0);
