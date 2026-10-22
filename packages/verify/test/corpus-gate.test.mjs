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
import { createHash } from 'node:crypto';
import { gate, BASELINE, CHANGES, REGISTRY_PIN, baseOutcomes, docForm, exportInputs, inputDigests, inputsProblems, stable } from '../scripts/corpus-gate.mjs';

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

test('corpus_fix with a changed input digest is accepted only when `to` is the merge-base verifier outcome, and never exit 0', () => {
  const was = { ...baseline[SYN], exit: 1, result: 'invalid', reason: 'unsupported_version', overall: 'failed' };
  const to = { ...baseline[SYN], exit: 2, result: 'could_not_check', reason: 'log_unreachable', overall: 'partial' };
  const base = { ...baseline, [SYN]: was };
  const fix = (row) => withEntries(entry(SYN, row, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD }));
  const ok = run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: fix(to), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: clone(to) } });
  assert.deepEqual(ok, []);
  // Merge-base verifier gives something else on the head input.
  const other = run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: fix(to), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: was } });
  assert.ok(other.some((p) => p.includes('is not what the merge-base verifier gives on the head input')), other.join('; '));
  // No merge-base outcome at all, or none for this key.
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: fix(to), ...digests(synId, D_BASE, D_HEAD) }).some((p) => p.includes('needs the merge-base verifier outcomes')));
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: fix(to), ...digests(synId, D_BASE, D_HEAD), baseOnHead: {} }).some((p) => p.includes('has no outcome for this case and path')));
  // Exit 0 stays capped even when the merge-base verifier agrees.
  const zero = { ...to, exit: 0, result: 'verified', reason: null };
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: zero }, headChanges: fix(zero), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: zero } }).some((p) => p.includes('may not move a case to exit 0')));
  // The same loosening as a plain tighten entry is still rejected.
  assert.ok(run({ baseBaseline: base, headBaseline: { ...baseline, [SYN]: to }, headChanges: withEntries(entry(SYN, to)) }).some((p) => p.includes('more permissive than the merge base')));
});

// ---------- case inputs: export, digests, merge-base runs ----------

const headInputs = await exportInputs(pkg);
const withCase = (inputs, id, edit) => ({ ...inputs, cases: inputs.cases.map((c) => (c.id === id ? edit(clone(c)) : c)) });

test('the corpus_fix entries in changes.json carry their head input digest', () => {
  const head = inputDigests(headInputs);
  const fixes = changes.changes.filter((c) => c.kind === 'corpus_fix');
  assert.ok(fixes.length > 0);
  for (const c of fixes) assert.equal(c.input_digest, head[c.case], `${c.case}|${c.path}`);
});

test('input digests do not depend on the run', async () => {
  assert.deepEqual(inputDigests(await exportInputs(pkg)), inputDigests(headInputs));
});

test('the history marker is the issuer history document hash', async () => {
  const { issuerHistoryDocumentHash } = await import('../dist/issuer-history.js');
  const c = headInputs.cases.find((x) => x.id === 'control-test-key-v10');
  const h = JSON.parse(c.history);
  assert.equal(createHash('sha256').update(stable(h)).digest('hex'), issuerHistoryDocumentHash(h));
  assert.ok(JSON.stringify(docForm(c.doc, c.history)).includes('<covering test history>'));
});

test('the issuer history is digested: a key validity window, kid, version or seq change moves the digests', () => {
  const before = inputDigests(headInputs);
  const edits = {
    not_after: (h) => { h.entries[0].not_after = '2020-06-01T00:00:00.000Z'; },
    not_before: (h) => { h.entries[0].not_before = '2019-01-01T00:00:00.000Z'; },
    status: (h) => { h.entries[0].status = 'revoked'; h.entries[0].revoked_at = '2021-01-01T00:00:00.000Z'; },
    kid: (h) => { h.entries[0].kid = 'other-kid'; },
    version: (h) => { h.version = 2; },
    seq: (h) => { h.seq = 9; },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const changed = { ...headInputs, cases: headInputs.cases.map((c) => { const h = JSON.parse(c.history); edit(h); return { ...c, history: JSON.stringify(h) }; }) };
    const after = inputDigests(changed);
    for (const id of Object.keys(before)) assert.notEqual(after[id], before[id], `${name}: ${id}`);
  }
  // Key bytes alone do not: each export uses a fresh throwaway key, and
  // 'input digests do not depend on the run' holds.
});

test('the window change from the review moves the digest and the merge-base outcome of control-test-key-v10', async () => {
  const id = 'control-test-key-v10';
  const changed = withCase(headInputs, id, (c) => { const h = JSON.parse(c.history); h.entries[0].not_after = '2020-06-01T00:00:00.000Z'; c.history = JSON.stringify(h); return c; });
  assert.notEqual(inputDigests(changed)[id], inputDigests(headInputs)[id]);
  const o = await baseOutcomes(pkg, changed, [`${id}|library`]);
  assert.equal(o[`${id}|library`].exit, 1, JSON.stringify(o));
});

test('head inputs are checked as data', () => {
  assert.deepEqual(inputsProblems(headInputs), []);
  assert.ok(inputsProblems({ format: 'x', cases: [] }).length);
  assert.ok(inputsProblems({ ...headInputs, cases: [{ id: '../x', paths: [], doc: '', history: '', jwks: '' }] }).length);
  assert.ok(inputsProblems({ ...headInputs, cases: [headInputs.cases[0], headInputs.cases[0]] }).some((p) => p.includes('duplicate')));
});

// Protocol Review's case: the head verifier is changed to accept an unknown
// v13 receipt as v10; the v13 case gets a no-op `corpus_note`, the baseline
// is re-recorded with the looser rows, and two corpus_fix entries carry the
// new head digest. The gate never runs the head verifier: the merge-base
// verifier (this tree here) on the edited input still says
// unsupported_version, so both entries are rejected although the digest
// rule alone is met.
const V13 = 'version-v13-unknown';
const attackInputs = withCase(headInputs, V13, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'fixture tidy'; c.doc = JSON.stringify(d); return c; });
const attackRows = {
  [`${V13}|library`]: { exit: 2, result: 'could_not_check', reason: 'log_unreachable', checks: { signature: 'pass', key_window: 'pass', payment_binding: 'could_not_check', log_inclusion: 'could_not_check', anchor: 'could_not_check', shape: 'pass' }, overall: 'partial' },
  [`${V13}|cli`]: { exit: 1, result: 'invalid', reason: 'key untrusted', checks: { signature: 'fail', key_window: 'could_not_check', payment_binding: 'could_not_check', log_inclusion: 'could_not_check', anchor: 'could_not_check', shape: 'pass' } },
};
const attackEntries = (digest) => Object.entries(attackRows).map(([k, to]) => entry(k, to, { kind: 'corpus_fix', note: 'fixture tidy', input_digest: digest }));

test('review case: a no-op input edit plus a looser verifier is rejected by the merge-base run', async () => {
  const headDigests = inputDigests(attackInputs);
  const baseDigests = inputDigests(headInputs);
  assert.notEqual(headDigests[V13], baseDigests[V13], 'the digest rule alone is met');
  const keys = Object.keys(attackRows);
  const baseOnHead = await baseOutcomes(pkg, attackInputs, keys);
  assert.equal(baseOnHead[`${V13}|library`].reason, 'unsupported_version');
  const problems = run({ headBaseline: { ...baseline, ...attackRows }, headChanges: withEntries(...attackEntries(headDigests[V13])), baseDigests, headDigests, baseOnHead });
  for (const k of keys) assert.ok(problems.some((p) => p.startsWith(`${k}: corpus_fix: \`to\` is not what the merge-base verifier gives`)), `${k}: ${problems.join('; ')}`);
  assert.ok(!problems.some((p) => /input digest|input_digest|unchanged from the merge base/.test(p)), problems.join('; '));
});

test('the merge-base runner leaves out a path it does not have', async () => {
  const o = await baseOutcomes(pkg, headInputs, ['control-test-key-v10|nope', 'no-such-case|cli']);
  assert.deepEqual(o, {});
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

function writeInputs(root, name, inputs) {
  const f = join(root, name);
  writeFileSync(f, JSON.stringify(inputs));
  return f;
}

test('end to end: a corpus_fix passes only with merge-base runs on a changed head input', { skip: !gitOk }, () => {
  const to = clone(baseline[SYN]);
  const setRow = (root, row) => {
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    b[SYN] = row;
    writeFileSync(p, JSON.stringify(b, null, 1));
  };
  const tidy = withCase(headInputs, synId, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'input changed'; c.doc = JSON.stringify(d); return c; });
  const digest = inputDigests(tidy)[synId];
  const r = repoWith((root) => {
    setRow(root, to);
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(entry(SYN, to, { kind: 'corpus_fix', note: 'x', input_digest: digest }));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  }, (root) => setRow(root, { ...to, exit: 1, result: 'invalid', reason: 'unsupported_version', overall: 'failed' }));
  const none = gateCli(r.root, r.base);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /needs the merge-base and head input digests/);
  // Head input unchanged from the merge base: rejected.
  const same = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'same.json', headInputs)]);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /input_digest is not the head digest|unchanged from the merge base/);
  // Changed input, and `to` is what the merge-base verifier gives on it: ok.
  const changed = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'tidy.json', tidy)]);
  assert.equal(changed.status, 0, changed.stderr);
  // Malformed head inputs fail closed.
  const bad = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'bad.json', { format: 'x' })]);
  assert.equal(bad.status, 1);
});

test('end to end: the review case fails the gate script', { skip: !gitOk }, () => {
  const digest = inputDigests(attackInputs)[V13];
  const r = repoWith((root) => {
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    Object.assign(b, attackRows);
    writeFileSync(p, JSON.stringify(b, null, 1));
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(...attackEntries(digest));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  });
  const res = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'attack.json', attackInputs)]);
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /version-v13-unknown\|library: corpus_fix: `to` is not what the merge-base verifier gives on the head input/);
  assert.match(res.stderr, /version-v13-unknown\|cli: corpus_fix: `to` is not what the merge-base verifier gives on the head input/);
});

test('end to end: an unknown base is a usage error, not a pass', { skip: !gitOk }, () => {
  const clean = repoWith(() => {});
  assert.equal(gateCli(clean.root, 'f'.repeat(40)).status, 3);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 3);
});
