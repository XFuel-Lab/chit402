#!/usr/bin/env node
/**
 * Harness diff: does a change to the corpus harness change what the
 * merge-base verifier is observed to do?
 *
 * The corpus gate never runs head code, so it cannot judge a change to the
 * corpus harness (lib.mjs with the cli runner, run-*.mjs, tape-*.mjs,
 * record*.mjs, tapes/**, test/history-file.mjs, golden-corpus.test.mjs,
 * synthetic.mjs, test/fixtures/**; isBuilderPath in corpus-gate.mjs). This
 * script runs the merge-base harness and the head harness on the same
 * merge-base cases, both against the merge-base verifier build, and fails
 * on any difference in any case|path outcome: the whole summary the harness
 * reports (exit, result, reason, cause, every check, overall, tape misses).
 *
 * The case list is golden-corpus.test.mjs's: the manifest ids and fixture
 * files and the synthetic cases, built by the merge-base synthetic.mjs from
 * merge-base fixtures. Each case path runs through the harness's own
 * runPathAsync and pool (four at a time) on the public tape and on the
 * chain tape, as the golden corpus runs them.
 *
 * Subcommands (CI runs the merge-base copy of this file and of
 * corpus-gate.mjs, side by side):
 *   changed <root> <base> [rev]       harness paths a change touches, one per line
 *   overlay <baseTree> <root> <rev> <out>
 *                                     copy the built merge-base packages/verify to
 *                                     <out> and replace its harness files with those
 *                                     of <rev>, read through git as data
 *   cases <baseTree> <dir>            build the merge-base case list into <dir> and
 *                                     write <dir>/cases.json (merge-base code)
 *   outcomes <tree> <cases.json>      every case|path outcome of <tree>'s harness,
 *                                     per tape. This runs <tree>'s code: run it
 *                                     offline, in a sandbox, without secrets.
 *   compare <base.json> <head.json>   exit 1 and list every difference
 *
 * Exit codes: 0 ok, 1 a difference (or a missing outcome), 3 usage error.
 *
 * Limits: the head harness runs as code, so a harness written to detect
 * this job and behave differently here than in the golden corpus would not
 * show a difference. golden-corpus.test.mjs itself is not run (its
 * comparison logic is not an outcome). The job is a tripwire for harness
 * changes that move an outcome; a harness diff still needs review.
 *
 * Trust: `compare` trusts the stdout of each `outcomes` run, and the head
 * side is written by the head harness. A head harness that prints
 * base-looking outcomes (every key, the merge-base values) passes. The job
 * is a tripwire only: it does not replace human review of a harness change
 * or code-owner protection on .github/workflows/** and these scripts, and it
 * runs on pull requests only, so a push straight to main skips it.
 *
 * Which copy of this file and corpus-gate.mjs CI runs is decided by
 * select-driver.sh: the merge-base copy once the file has ever existed on
 * the target branch, failing closed on a branch that predates it.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isBuilderPath } from './corpus-gate.mjs';

const VERIFY = 'packages/verify/';

// Git reads of the merge base and the change ignore replace refs and grafts.
const GIT_ENV = (() => {
  const env = { ...process.env, GIT_GRAFT_FILE: devNull };
  delete env.GIT_REPLACE_REF_BASE;
  delete env.GIT_NO_REPLACE_OBJECTS;
  return env;
})();
const git = (root, args, opts = {}) => execFileSync('git', ['--no-replace-objects', '-c', 'advice.graftFileDeprecated=false', '-C', root, ...args], { env: GIT_ENV, ...opts });

/** Harness paths (repo-relative) changed between two commits. */
export function changedHarnessPaths(root, base, rev = 'HEAD') {
  const out = git(root, ['diff', '--name-only', '--no-renames', '-z', base, rev], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\0').filter(Boolean).filter(isBuilderPath);
}

const listFiles = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p, { throwIfNoEntry: false });
      if (!s) continue;
      if (s.isDirectory()) { if (name !== 'node_modules') walk(p); } else out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};

/**
 * Build `out`: the built merge-base packages/verify with every harness file
 * replaced by its version at `rev` (and removed where `rev` has none).
 * Head files are read through git as data; nothing from `rev` runs here.
 */
export function buildOverlay(baseTree, root, rev, out) {
  rmSync(out, { recursive: true, force: true });
  cpSync(resolve(baseTree), out, { recursive: true, verbatimSymlinks: true });
  for (const f of listFiles(join(out, 'test'))) {
    const rel = VERIFY + relative(out, f).split('\\').join('/');
    if (isBuilderPath(rel)) rmSync(f, { force: true });
  }
  const tracked = git(root, ['ls-tree', '-r', '-z', '--name-only', rev, '--', `${VERIFY}test`], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean).filter(isBuilderPath);
  for (const rel of tracked) {
    const dest = join(out, rel.slice(VERIFY.length));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git(root, ['show', `${rev}:${rel}`], { maxBuffer: 256 << 20 }));
  }
  return tracked;
}

/** The golden corpus case list of a built packages/verify tree; synthetic case files go to `dir`. */
export async function buildCases(baseTree, dir) {
  const corpus = join(resolve(baseTree), 'test', 'corpus');
  const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8'));
  const fixtures = join(corpus, '..', 'fixtures');
  const { buildSynthetic } = await import(pathToFileURL(join(corpus, 'synthetic.mjs')).href);
  mkdirSync(dir, { recursive: true });
  const synthetic = await buildSynthetic(dir);
  return [
    ...manifest.ids.map((c) => ({ ...c, kind: 'id', paths: ['cli'] })),
    ...manifest.files.map((c) => ({ ...c, kind: 'file', file: join(fixtures, c.fixture), paths: ['cli'] })),
    ...synthetic,
  ];
}

/** Every case|path outcome of `tree`'s harness on `cases`, per tape. */
export async function harnessOutcomes(tree, cases) {
  const corpus = join(resolve(tree), 'test', 'corpus');
  // Replay only: never record (which would reach the network).
  delete process.env.CHIT_CORPUS_MODE;
  delete process.env.CHIT_CORPUS_RPC;
  const { pool, runPathAsync } = await import(pathToFileURL(join(corpus, 'lib.mjs')).href);
  const jobs = cases.flatMap((c) => (c.paths || ['cli']).map((path) => ({ c, path, key: `${c.id}|${path}` })));
  const out = {};
  for (const [tier, tape] of [['public', 'public.json'], ['chain', 'public-chain.json']]) {
    const file = join(corpus, 'tapes', tape);
    const res = {};
    await pool(jobs, 4, async (job) => { res[job.key] = await runPathAsync(job.c, job.path, file); });
    out[tier] = res;
  }
  return out;
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null));
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

function compareTier(base, head) {
  const p = [];
  for (const k of [...new Set([...Object.keys(base ?? {}), ...Object.keys(head ?? {})])].sort()) {
    if (!has(base, k)) { p.push(`${k}: no outcome from the merge-base harness`); continue; }
    if (!has(head, k)) { p.push(`${k}: no outcome from the head harness`); continue; }
    const a = stable(base[k]);
    const b = stable(head[k]);
    if (a !== b) p.push(`${k}: merge-base harness ${a} | head harness ${b}`);
  }
  return p;
}

/**
 * Differences between two per-tape outcome maps, one line each.
 * The head map is whatever the head harness printed: a forged map that
 * mirrors the merge-base outcomes passes (a tripwire, not a proof).
 */
export function compareOutcomes(base, head) {
  const p = [];
  if (!base || Object.keys(base).length === 0 || Object.values(base).every((t) => !t || Object.keys(t).length === 0)) p.push('the merge-base harness gave no outcomes');
  for (const tier of [...new Set([...Object.keys(base ?? {}), ...Object.keys(head ?? {})])].sort()) {
    for (const x of compareTier(base?.[tier], head?.[tier])) p.push(`${tier}: ${x}`);
  }
  return p;
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'changed' && a.length >= 2) {
    for (const f of changedHarnessPaths(a[0], a[1], a[2] ?? 'HEAD')) console.log(f);
  } else if (cmd === 'overlay' && a.length === 4) {
    const files = buildOverlay(a[0], a[1], a[2], a[3]);
    console.error(`harness-diff: overlay with ${files.length} harness files from ${a[2]}`);
  } else if (cmd === 'cases' && a.length === 2) {
    const cases = await buildCases(a[0], a[1]);
    writeFileSync(join(a[1], 'cases.json'), `${JSON.stringify(cases)}\n`);
    console.error(`harness-diff: ${cases.length} cases in ${join(a[1], 'cases.json')}`);
  } else if (cmd === 'outcomes' && a.length === 2) {
    const cases = JSON.parse(readFileSync(a[1], 'utf8'));
    process.stdout.write(`${JSON.stringify(await harnessOutcomes(a[0], cases))}\n`);
  } else if (cmd === 'compare' && a.length === 2) {
    const problems = compareOutcomes(JSON.parse(readFileSync(a[0], 'utf8')), JSON.parse(readFileSync(a[1], 'utf8')));
    if (problems.length) {
      for (const x of problems) console.error(`harness-diff: ${x}`);
      console.error(`harness-diff: ${problems.length} outcome difference(s) between the merge-base harness and the head harness on the merge-base cases`);
      process.exit(1);
    }
    console.log('harness-diff: ok, every case|path outcome is the same under both harnesses');
  } else {
    console.error('usage: harness-diff.mjs changed <root> <base> [rev] | overlay <baseTree> <root> <rev> <out> | cases <baseTree> <dir> | outcomes <tree> <cases.json> | compare <base.json> <head.json>');
    process.exit(3);
  }
}
