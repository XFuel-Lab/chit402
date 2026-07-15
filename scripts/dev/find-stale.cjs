#!/usr/bin/env node
/**
 * find-stale.cjs — repo staleness + dead-reference audit.
 *
 * Computes each tracked file's last-commit date in a single `git log` pass,
 * buckets files by age, and flags code/script files whose basename is
 * referenced NOWHERE else in the repo (a strong dead-code signal).
 *
 * Usage:
 *   node scripts/dev/find-stale.cjs [cutoffMonths]
 *   node scripts/dev/find-stale.cjs 6        # only files >= 6 months untouched
 *
 * Caveats (why this is a signal, not a verdict):
 *   - Config files (postcss/tailwind/.solcover/tsconfig) are loaded by tooling
 *     convention, not by basename → they show 0 refs but are NOT dead.
 *   - Test files collected by glob (hardhat-test-all, mocha) show 0 refs but ARE run.
 *   Always eyeball the "dead candidates" list before deleting.
 */
const { execSync } = require('child_process');
const path = require('path');

const CUTOFF_MONTHS = Number(process.argv[2]) || 4;
const root = execSync('git rev-parse --show-toplevel').toString().trim();
const opts = { cwd: root, maxBuffer: 1024 * 1024 * 256 };

const log = execSync('git log --no-merges --pretty=format:__C__%cI --name-only', opts).toString();
const lastTouched = new Map();
let curDate = null;
for (const line of log.split('\n')) {
  if (line.startsWith('__C__')) { curDate = line.slice(5); continue; }
  const f = line.trim();
  if (f && !lastTouched.has(f)) lastTouched.set(f, curDate);
}

const tracked = new Set(
  execSync('git ls-files', opts).toString().split('\n').map(s => s.trim()).filter(Boolean)
);

const now = new Date();
const monthsAgo = (iso) => (now - new Date(iso)) / (1000 * 60 * 60 * 24 * 30.44);

const stale = [];
for (const f of tracked) {
  const dt = lastTouched.get(f);
  if (!dt) continue;
  const age = monthsAgo(dt);
  if (age >= CUTOFF_MONTHS) stale.push({ f, dt: dt.slice(0, 10), age, top: f.split('/')[0], ext: path.extname(f) });
}

const CHECK_EXT = new Set(['.cjs', '.js', '.mjs', '.sh', '.ps1', '.ts']);
function refsElsewhere(file) {
  const base = path.basename(file);
  try {
    const out = execSync(`git grep -l -F -- "${base}"`, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.split('\n').map(s => s.trim()).filter(Boolean).filter(h => h !== file).length;
  } catch (_) { return 0; }
}
for (const s of stale) s.refs = CHECK_EXT.has(s.ext) ? refsElsewhere(s.f) : null;

stale.sort((a, b) => b.age - a.age);
console.log(`Today: ${now.toISOString().slice(0, 10)} | cutoff: >= ${CUTOFF_MONTHS} months untouched`);
console.log(`Total tracked: ${tracked.size} | stale: ${stale.length}\n`);

const dead = stale.filter(s => s.refs === 0);
console.log(`=== DEAD CANDIDATES (script/code, basename referenced nowhere else): ${dead.length} ===`);
for (const s of dead) console.log(`${s.age.toFixed(1)}mo  ${s.dt}  ${s.f}`);

console.log(`\n=== STALE COUNT BY TOP-LEVEL DIR ===`);
const byTop = new Map();
for (const s of stale) (byTop.get(s.top) || byTop.set(s.top, []).get(s.top)).push(s);
for (const [top, arr] of [...byTop.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(arr.length).padStart(4)}  ${top.padEnd(22)}  oldest: ${arr[0].age.toFixed(1)}mo (${arr[0].dt})`);
}
