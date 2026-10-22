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

// Input digests: SYN's case input changed between base and head.
const D_BASE = 'a'.repeat(64);
const D_HEAD = 'b'.repeat(64);
const SIG = 'gate8-detached-pv7|signature';
const digests = (id, base, head) => ({ baseDigests: { [id]: base }, headDigests: { [id]: head } });
const synId = SYN.split('|')[0];

test('corpus_fix: synthetic only, needs a note, never to exit 0', () => {
  const to = { ...baseline[SYN], exit: 0, result: 'verified', reason: null };
  const head = { ...baseline, [SYN]: to };
  assert.ok(run({ headBaseline: head, headChanges: withEntries(entry(SYN, to, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD })), ...digests(synId, D_BASE, D_HEAD) }).some((p) => p.includes('may not move a case to exit 0')));
  const to2 = { ...baseline[SYN], reason: 'other' };
  assert.ok(run({ headBaseline: { ...baseline, [SYN]: to2 }, headChanges: withEntries(entry(SYN, to2, { kind: 'corpus_fix' })) }).some((p) => p.includes('corpus_fix needs a note')));
});

test('corpus_fix with only a note is rejected: synthetic row 1 -> 2, checks -> pass', () => {
  const was = { exit: 1, result: 'invalid', reason: 'unsupported_version', checks: Object.fromEntries(Object.keys(baseline[SYN].checks).map((k) => [k, 'could_not_check'])), overall: 'failed' };
  const to = { exit: 2, result: 'could_not_check', reason: 'log_unreachable', checks: Object.fromEntries(Object.keys(was.checks).map((k) => [k, 'pass'])), overall: 'partial' };
  const base = { ...baseline, [SYN]: was };
  const head = { ...baseline, [SYN]: to };
  const note = { kind: 'corpus_fix', note: 'case input fixed' };
  // No digests given to the gate at all.
  assert.ok(run({ baseBaseline: base, headBaseline: head, headChanges: withEntries(entry(SYN, to, note)) }).some((p) => p.includes('needs the merge-base and head input digests')));
  // Digests given, but the entry carries none.
  assert.ok(run({ baseBaseline: base, headBaseline: head, headChanges: withEntries(entry(SYN, to, note)), ...digests(synId, D_BASE, D_HEAD) }).some((p) => p.includes('corpus_fix needs input_digest')));
  // The case input did not change in this PR.
  assert.ok(run({ baseBaseline: base, headBaseline: head, headChanges: withEntries(entry(SYN, to, { ...note, input_digest: D_BASE })), ...digests(synId, D_BASE, D_BASE) }).some((p) => p.includes('unchanged from the merge base')));
  // The entry names a digest that is not the head digest.
  assert.ok(run({ baseBaseline: base, headBaseline: head, headChanges: withEntries(entry(SYN, to, { ...note, input_digest: 'c'.repeat(64) })), ...digests(synId, D_BASE, D_HEAD) }).some((p) => p.includes('not the head digest')));
  // A case with no merge-base digest cannot take a corpus_fix.
  assert.ok(run({ baseBaseline: base, headBaseline: head, headChanges: withEntries(entry(SYN, to, { ...note, input_digest: D_HEAD })), baseDigests: {}, headDigests: { [synId]: D_HEAD } }).some((p) => p.includes('no merge-base input digest')));
});

test('corpus_fix on a signature row 1 -> 0 is rejected, even with a changed input digest', () => {
  const was = { exit: 1, result: 'invalid', reason: 'signature_invalid', checks: { signature: 'fail' } };
  const to = { exit: 0, result: 'signature_valid', reason: null, checks: { signature: 'pass' } };
  const id = SIG.split('|')[0];
  const problems = run({ baseBaseline: { ...baseline, [SIG]: was }, headBaseline: { ...baseline, [SIG]: to }, headChanges: withEntries(entry(SIG, to, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD })), ...digests(id, D_BASE, D_HEAD) });
  assert.ok(problems.some((p) => p.includes(`${SIG}: corpus_fix may not move a case to exit 0`)), problems.join('; '));
});

test('corpus_fix with a changed input digest is accepted, unless it moves to exit 0', () => {
  const was = { ...baseline[SYN], exit: 1, result: 'invalid', reason: 'unsupported_version', overall: 'failed' };
  const to = { ...baseline[SYN], exit: 2, result: 'could_not_check', reason: 'log_unreachable', overall: 'partial' };
  const base = { ...baseline, [SYN]: was };
  const ok = run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: withEntries(entry(SYN, to, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD })), ...digests(synId, D_BASE, D_HEAD) });
  assert.deepEqual(ok, []);
  const zero = { ...to, exit: 0, result: 'verified', reason: null };
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: zero }, headChanges: withEntries(entry(SYN, zero, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD })), ...digests(synId, D_BASE, D_HEAD) }).some((p) => p.includes('may not move a case to exit 0')));
  // The same loosening as a plain tighten entry is still rejected.
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: withEntries(entry(SYN, to)) }).some((p) => p.includes('more permissive than the merge base')));
});

test('the corpus_fix entries in changes.json carry their head input digest', async () => {
  const { inputDigests } = await import('./corpus/input-digests.mjs');
  const head = await inputDigests(pkg);
  const fixes = changes.changes.filter((c) => c.kind === 'corpus_fix');
  assert.ok(fixes.length > 0);
  for (const c of fixes) assert.equal(c.input_digest, head[c.case], `${c.case}|${c.path}`);
});

test('input digests do not depend on the run', async () => {
  const { inputDigests } = await import('./corpus/input-digests.mjs');
  assert.deepEqual(await inputDigests(pkg), await inputDigests(pkg));
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

function repoWith(edit, baseEdit = () => {}) {
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
  baseEdit(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  edit(root);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'head');
  return { root, base };
}

function gateCli(root, base, extra = []) {
  return spawnSync(process.execPath, [script, '--base', base, '--root', root, ...extra], { encoding: 'utf8' });
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

test('end to end: a corpus_fix needs digest files whose case input changed', { skip: !gitOk }, () => {
  const to = { ...baseline[SYN], exit: 2, result: 'could_not_check', reason: 'log_unreachable', overall: 'partial' };
  const setRow = (root, row) => {
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    b[SYN] = row;
    writeFileSync(p, JSON.stringify(b, null, 1));
  };
  const r = repoWith((root) => {
    setRow(root, to);
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(entry(SYN, to, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD }));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  }, (root) => setRow(root, { ...to, exit: 1, result: 'invalid', reason: 'unsupported_version', overall: 'failed' }));
  const files = (base, head) => {
    const b = join(r.root, 'base-digests.json');
    const h = join(r.root, 'head-digests.json');
    writeFileSync(b, JSON.stringify({ [synId]: base }));
    writeFileSync(h, JSON.stringify({ [synId]: head }));
    return ['--base-digests', b, '--head-digests', h];
  };
  const none = gateCli(r.root, r.base);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /needs the merge-base and head input digests/);
  const same = gateCli(r.root, r.base, files(D_HEAD, D_HEAD));
  assert.equal(same.status, 1);
  assert.match(same.stderr, /unchanged from the merge base/);
  const changed = gateCli(r.root, r.base, files(D_BASE, D_HEAD));
  assert.equal(changed.status, 0, changed.stderr);
});

test('end to end: an unknown base is a usage error, not a pass', { skip: !gitOk }, () => {
  const clean = repoWith(() => {});
  assert.equal(gateCli(clean.root, 'f'.repeat(40)).status, 3);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 3);
});
