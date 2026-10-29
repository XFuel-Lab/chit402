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
 * - Files are restored after every mutant, on SIGINT/SIGTERM, and verified by
 *   sha256 at the end. A mutant whose pattern does not match is NOT_APPLIED.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null;
if (!root || !existsSync(join(root, '.git'))) {
  console.error('usage: node run-mutants.mjs <repo-root> [--list mutants.json] [--only ID,ID] [--no-unshare] [--timeout-sec 180]');
  process.exit(2);
}
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const listPath = resolve(opt('--list', join(HERE, 'mutants.json')));
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const useUnshare = !args.includes('--no-unshare');
const timeoutMs = Number(opt('--timeout-sec', '180')) * 1000;

const spec = JSON.parse(readFileSync(listPath, 'utf8'));
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
const originals = new Map();
function restoreAll() {
  for (const [abs, text] of originals) writeFileSync(abs, text);
  originals.clear();
}
// Suites run async so these handlers fire mid-run (spawnSync blocks the event loop).
let child = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
  restoreAll();
  process.exit(130);
});

function runSuite(name) {
  const s = spec.suites[name];
  const tmp = mkdtempSync(join(tmpdir(), 'mut-'));
  const env = { ...process.env, ...(s.env || {}), TMPDIR: tmp };
  const cmd = useUnshare ? 'unshare' : s.argv[0];
  const argv = useUnshare
    ? ['-rn', 'sh', '-c', 'ip link set lo up 2>/dev/null; exec "$@"', 'sh', ...s.argv]
    : s.argv.slice(1);
  return new Promise((resolveRun) => {
    let out = '';
    let timedOut = false;
    child = spawn(cmd, argv, { cwd: join(root, s.cwd), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const cap = (d) => { out += d; if (out.length > 1_000_000) out = out.slice(-500_000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      child = null;
      rmSync(tmp, { recursive: true, force: true });
      resolveRun({ result: timedOut ? 'TIMEOUT' : (code === 0 ? 'PASS' : 'FAIL'), out });
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
    else result = (({ PASS: 'SURVIVED', FAIL: 'KILLED', TIMEOUT: 'TIMEOUT' })[(await runSuite(m.suite)).result]);
  } finally {
    restoreAll();
  }
  tally[result] = (tally[result] || 0) + 1;
  console.log(`MUT\t${m.id}\t${result}\t${m.note || ''}`);
}
const dirty = touched.filter((f) => sha(join(root, f)) !== before[f]);
console.log(`TALLY\t${JSON.stringify(tally)}\tRESTORED\t${dirty.length ? 'NO: ' + dirty.join(',') : 'yes'}`);
process.exit(dirty.length ? 4 : 0);
