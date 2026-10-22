/**
 * scripts/corpus-gate.mjs: the corpus baseline, changes.json and the frozen
 * registry are checked against the merge base, so a baseline edit in the
 * same change as a verifier change cannot bless a looser result.
 *
 * The end-to-end cases build a throwaway git repo, commit the real files as
 * the merge base, commit an edit on top, and run the gate script on it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, BASELINE, CHANGES, REGISTRY_PIN } from '../scripts/corpus-gate.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const script = join(pkg, 'scripts', 'corpus-gate.mjs');
const read = (rel) => JSON.parse(readFileSync(join(pkg, rel.replace(/^packages\/verify\//, '')), 'utf8'));
const baseline = read(BASELINE);
const changes = read(CHANGES);
const registry = read(REGISTRY_PIN);
const REAL = 'id-xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli';
const SYN = 'version-l1-v4-not-allowlisted|library';
const clone = (v) => JSON.parse(JSON.stringify(v));
const run = (over = {}) => gate({ baseBaseline: baseline, headBaseline: baseline, baseChanges: changes, headChanges: changes, baseRegistry: registry, headRegistry: registry, ...over });
const entry = (key, to, extra = {}) => ({ case: key.split('|')[0], path: key.split('|')[1], to, pr: 'test', spec: 'test', ...extra });
const withEntries = (...e) => ({ ...changes, changes: [...changes.changes, ...e] });

test('unchanged files pass', () => {
  assert.deepEqual(run(), []);
});

test('NOT_IN_LOG -> VERIFIED baseline edit fails, however it is recorded', () => {
  assert.equal(baseline[REAL].reason, 'not_in_log');
  const head = clone(baseline);
  head[REAL] = { exit: 0, result: 'verified', reason: null, checks: { ...head[REAL].checks, log_inclusion: 'pass' } };
  assert.ok(run({ headBaseline: head }).some((p) => p.includes('no changes.json entry')));
  assert.ok(run({ headBaseline: head, headChanges: withEntries(entry(REAL, head[REAL])) }).some((p) => p.includes('more permissive than the merge base: exit 1 -> 0')));
  assert.ok(run({ headBaseline: head, headChanges: withEntries(entry(REAL, head[REAL], { kind: 'corpus_fix', note: 'x' })) }).some((p) => p.includes('corpus_fix is only for synthetic cases')));
});

test('each loosening is caught: exit, result, a check, a dropped check, overall', () => {
  const was = baseline[REAL];
  const cases = [
    [{ ...was, exit: 2, result: 'could_not_check' }, 'exit 1 -> 2'],
    [{ ...was, result: 'verified' }, 'result verified with exit 1'],
    [{ ...was, checks: { ...was.checks, log_inclusion: 'pass' } }, 'checks.log_inclusion fail -> pass'],
    [{ ...was, checks: Object.fromEntries(Object.entries(was.checks).filter(([k]) => k !== 'log_inclusion')) }, 'drops check log_inclusion'],
    [{ ...was, exit: 3 }, 'outside 0/1/2'],
  ];
  for (const [to, msg] of cases) {
    const head = { ...baseline, [REAL]: to };
    const problems = run({ headBaseline: head, headChanges: withEntries(entry(REAL, to)) });
    assert.ok(problems.some((p) => p.includes(msg)), `${msg}: ${problems.join('; ')}`);
  }
  const lib = 'control-test-key-v10|library';
  const failedLib = { exit: 1, result: 'invalid', reason: 'x', checks: baseline[lib].checks, overall: 'failed' };
  const base2 = { ...baseline, [lib]: failedLib };
  const head2 = { ...baseline, [lib]: { ...failedLib, overall: 'partial' } };
  assert.ok(run({ baseBaseline: base2, headBaseline: head2, headChanges: withEntries(entry(lib, head2[lib])) }).some((p) => p.includes('overall failed -> partial')));
});

test('a stricter recorded change passes; the head value must be the entry', () => {
  const to = { ...baseline[SYN], exit: 1, result: 'invalid', reason: 'legacy_not_allowlisted' };
  const head = { ...baseline, [SYN]: to };
  assert.deepEqual(run({ headBaseline: head, headChanges: withEntries(entry(SYN, to)) }), []);
  assert.ok(run({ headBaseline: head, headChanges: withEntries(entry(SYN, { ...to, reason: 'other' })) }).some((p) => p.includes("is not the changes.json entry's `to`")));
});

test('corpus_fix: synthetic only, needs a note, never to exit 0', () => {
  const to = { ...baseline[SYN], exit: 0, result: 'verified', reason: null };
  const head = { ...baseline, [SYN]: to };
  assert.ok(run({ headBaseline: head, headChanges: withEntries(entry(SYN, to, { kind: 'corpus_fix', note: 'x' })) }).some((p) => p.includes('may not move a case to exit 0')));
  const to2 = { ...baseline[SYN], reason: 'other' };
  assert.ok(run({ headBaseline: { ...baseline, [SYN]: to2 }, headChanges: withEntries(entry(SYN, to2, { kind: 'corpus_fix' })) }).some((p) => p.includes('corpus_fix needs a note')));
});

test('removing a real receipt case fails; changes.json is append-only', () => {
  const head = clone(baseline);
  delete head[REAL];
  assert.ok(run({ headBaseline: head }).some((p) => p.includes('a real receipt case was removed')));
  const edited = clone(changes);
  edited.changes[0].to = { ...edited.changes[0].to, exit: 0 };
  assert.ok(run({ headChanges: edited }).some((p) => p.includes('append-only: entry 0')));
  const dropped = { ...changes, changes: changes.changes.slice(1) };
  assert.ok(run({ headChanges: dropped }).some((p) => p.includes('append-only')));
});

test('frozen registry: append-only, appended entries recorded', () => {
  const edited = clone(registry);
  edited.entries[6].rule_set_digest = 'ab'.repeat(32);
  assert.ok(run({ headRegistry: edited }).some((p) => p.includes('append-only: entry 6 (pv7)')));
  const grown = clone(registry);
  grown.entries.push({ id: 'pv12', rule_set: 'rs-pv12-1', rule_set_digest: 'cd'.repeat(32) });
  assert.ok(run({ headRegistry: grown }).some((p) => p.includes('entry pv12 appended with no changes.json registry entry')));
  assert.deepEqual(run({ headRegistry: grown, headChanges: withEntries({ kind: 'registry', entry: 'pv12', pr: 'x', spec: 'x' }) }), []);
});

// ---------- end to end, in a throwaway git repo ----------

const gitOk = spawnSync('git', ['--version']).status === 0;

function repoWith(edit) {
  const root = mkdtempSync(join(tmpdir(), 'corpus-gate-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  for (const rel of [BASELINE, CHANGES, REGISTRY_PIN]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), readFileSync(join(pkg, rel.replace(/^packages\/verify\//, ''))));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  edit(root);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'head');
  return { root, base };
}

function gateCli(root, base) {
  return spawnSync(process.execPath, [script, '--base', base, '--root', root], { encoding: 'utf8' });
}

test('end to end: the mutant baseline edit fails the gate script, a clean head passes', { skip: !gitOk }, () => {
  const clean = repoWith(() => {});
  const ok = gateCli(clean.root, clean.base);
  assert.equal(ok.status, 0, ok.stderr);

  const mutant = repoWith((root) => {
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    b[REAL] = { exit: 0, result: 'verified', reason: null, checks: { ...b[REAL].checks, log_inclusion: 'pass' } };
    writeFileSync(p, JSON.stringify(b, null, 1));
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(entry(REAL, b[REAL]));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  });
  const bad = gateCli(mutant.root, mutant.base);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /more permissive than the merge base: exit 1 -> 0/);
});

test('end to end: an unknown base is a usage error, not a pass', { skip: !gitOk }, () => {
  const clean = repoWith(() => {});
  assert.equal(gateCli(clean.root, 'f'.repeat(40)).status, 3);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 3);
});
