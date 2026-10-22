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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gate, isVerifierPath, caseDeclarations, BASELINE, CHANGES, REGISTRY_PIN, DECLARATIONS_PIN, DECLARATIONS_FORMAT, baseOutcomes, docForm, exportInputs, exportDeclarations, inputDigests, inputsProblems, isNonDecision, pinProblems, pinDigestProblems, appendedPinEntries, stable, unclassifiedPaths } from '../scripts/corpus-gate.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const script = join(pkg, 'scripts', 'corpus-gate.mjs');
const read = (rel) => JSON.parse(readFileSync(join(pkg, rel.replace(/^packages\/verify\//, '')), 'utf8'));
const baseline = read(BASELINE);
const changes = read(CHANGES);
const registry = read(REGISTRY_PIN);
const pin = read(DECLARATIONS_PIN);
// A pin that declares nothing, matching baseCases: {} below.
const EMPTY_PIN = { format: DECLARATIONS_FORMAT, declarations: [], deferred: [], reason_allowed: [] };
const REAL = 'id-xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli';
const SYN = 'version-l1-v4-not-allowlisted|library';
const clone = (v) => JSON.parse(JSON.stringify(v));
// changedFiles: [] is a change that touches no verifier file; baseCases: {}
// with an empty pin on both sides declares no case expectations (the
// declared-rule tests pass the real pin and declarations).
const run = (over = {}) => gate({ baseBaseline: baseline, headBaseline: baseline, baseChanges: changes, headChanges: changes, baseRegistry: registry, headRegistry: registry, changedFiles: [], baseCases: {}, basePin: EMPTY_PIN, headPin: EMPTY_PIN, headDecls: new Map(), ...over });
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

// ---------- corpus corrections and verifier changes stay apart ----------

const SRC = 'packages/verify/src/receipt-version.ts';
const TEST_ONLY = ['packages/verify/test/corpus/synthetic.mjs', 'packages/verify/test/corpus/baseline.json', 'packages/verify/test/corpus/changes.json'];

test('verifier paths: default deny under packages/verify, plus the alias and dist/', () => {
  const deny = [
    SRC, 'packages/verify/src/a/b.ts', 'packages/verify/package.json', 'packages/verify/package-lock.json', 'packages/verify/tsconfig.json',
    'packages/verify/legacy-allowlist.json', 'packages/verify/version-windows.json', 'packages/verify/BUILD_DIGEST.txt',
    'packages/verify/dist/index.js', 'dist/x.js', 'packages/other/dist/y.js',
    // L1: case variants, look-alikes and anything new under packages/verify.
    'packages/verify/SRC/verdict.ts', 'Packages/Verify/src/verdict.ts', 'packages/verify/package.JSON', 'packages/verify/Package.Json',
    'packages/verify/\u0455rc/a.ts', 'packages/verify/src\u200b/a.ts', 'packages/verify/\uff53rc/a.ts',
    'packages/verify/foo.yaml', 'packages/verify/data/x.json', 'packages/verify/.npmrc', 'packages/verify/scripts/build-digest.mjs',
    'packages/verify/scripts/corpus-gate.mjs', 'packages/verify/srcx/a.ts', 'packages/verify/distro/a', 'packages/verify/LICENSE.js',
    'packages/verify/src/notes.md',
    // L2: corpus infrastructure.
    'packages/verify/test/corpus/lib.mjs', 'packages/verify/test/corpus/run-library.mjs', 'packages/verify/test/corpus/run-signature.mjs',
    'packages/verify/test/corpus/tape-preload.mjs', 'packages/verify/test/corpus/tape-hosts.mjs', 'packages/verify/test/corpus/record.mjs',
    'packages/verify/test/corpus/record-chain.mjs', 'packages/verify/test/corpus/tapes/public.json', 'packages/verify/test/corpus/tapes/new/x.json',
    'packages/verify/test/history-file.mjs', 'packages/verify/test/corpus/LIB.mjs', 'packages/verify/test/History-File.mjs',
    // L3: the @xfuel/verify alias.
    'packages/aliases/chit402-verify/cli.js', 'packages/aliases/chit402-verify/index.cjs', 'packages/aliases/chit402-verify/package.json',
  ];
  for (const p of deny) assert.equal(isVerifierPath(p), true, p);
  const allow = [
    ...TEST_ONLY, 'packages/verify/test/fixtures/version-registry.frozen.json', 'packages/verify/test/corpus/manifest.json',
    'packages/verify/test/corpus/baseline-chain.json', 'packages/verify/test/corpus/README.md', 'packages/verify/test/verify.test.mjs',
    'packages/verify/README.md', 'packages/verify/CHANGELOG.md', 'packages/verify/LICENSE', 'packages/verify/license.txt',
    'packages/aliases/chit402-verify/README.md', 'packages/aliases/chit402-verify/CHANGELOG.md',
    '.github/workflows/test.yml', 'services/gateway/src/server.js', 'package.json', 'packages/verifyx/src/a.ts',
  ];
  for (const p of allow) assert.equal(isVerifierPath(p), false, p);
  // Any non-ASCII path counts, wherever it is.
  assert.equal(isVerifierPath('docs/caf\u00e9.md'), true);
  assert.equal(isVerifierPath(''), true);
});

test('L1: a corpus_fix next to a look-alike or new verifier path is rejected', () => {
  for (const extra of ['packages/verify/SRC/verdict.ts', 'packages/verify/\u0455rc/a.ts', 'packages/verify/package.JSON', 'packages/verify/foo.yaml', 'packages/verify/test/corpus/lib.mjs', 'packages/aliases/chit402-verify/cli.js']) {
    assert.ok(run({ ...fixScenario(), changedFiles: [...TEST_ONLY, extra] }).some((p) => p.includes(SAME_CHANGE)), extra);
  }
  // A test or markdown change next to it stays allowed.
  assert.deepEqual(run({ ...fixScenario(), changedFiles: [...TEST_ONLY, 'packages/verify/test/verify.test.mjs', 'packages/verify/README.md'] }), []);
});

const fixScenario = () => {
  const was = { ...baseline[SYN], exit: 1, result: 'invalid', reason: 'unsupported_version', overall: 'failed' };
  const to = { ...baseline[SYN], exit: 2, result: 'could_not_check', reason: 'log_unreachable', overall: 'partial' };
  return {
    baseBaseline: { ...baseline, [SYN]: was },
    headBaseline: { ...baseline, [SYN]: to },
    headChanges: withEntries(entry(SYN, to, { kind: 'corpus_fix', note: 'x', input_digest: D_HEAD })),
    ...digests(synId, D_BASE, D_HEAD),
    baseOnHead: { [SYN]: clone(to) },
  };
};
const SAME_CHANGE = 'in the same change as a verifier change';

test('corpus_fix alone is accepted; with a src change it is rejected', () => {
  assert.deepEqual(run({ ...fixScenario(), changedFiles: TEST_ONLY }), []);
  const problems = run({ ...fixScenario(), changedFiles: [...TEST_ONLY, SRC] });
  assert.ok(problems.some((p) => p.startsWith(`${SYN}: corpus_fix or baseline removal ${SAME_CHANGE} (${SRC})`)), problems.join('; '));
  // Without the file list the gate fails closed.
  assert.ok(run({ ...fixScenario(), changedFiles: null }).some((p) => p.includes('need the list of files this change touches')));
});

test('a baseline removal with a package.json change is rejected', () => {
  const head = clone(baseline);
  delete head[SYN];
  const removal = withEntries(entry(SYN, null, { kind: 'corpus_fix', note: 'case retired' }));
  assert.deepEqual(run({ headBaseline: head, headChanges: removal, changedFiles: TEST_ONLY }), []);
  const problems = run({ headBaseline: head, headChanges: removal, changedFiles: [...TEST_ONLY, 'packages/verify/package.json'] });
  assert.ok(problems.some((p) => p.includes(`${SYN}: corpus_fix or baseline removal ${SAME_CHANGE} (packages/verify/package.json)`)), problems.join('; '));
  // A removal without an entry is rejected on both counts.
  const bare = run({ headBaseline: head, changedFiles: ['packages/verify/dist/index.js'] });
  assert.ok(bare.some((p) => p.includes('removed without a corpus_fix entry')) && bare.some((p) => p.includes(SAME_CHANGE)), bare.join('; '));
});

test('a corpus_fix on a row that does not move gets the same checks', () => {
  const now = baseline[SYN];
  const fix = (to, extra = {}) => withEntries(entry(SYN, to, { kind: 'corpus_fix', note: 'input moved inside its window', input_digest: D_HEAD, ...extra }));
  assert.deepEqual(run({ headChanges: fix(now), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: clone(now) } }), []);
  assert.ok(run({ headChanges: fix(now), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: { ...now, reason: 'other' } } }).some((p) => p.includes('is not what the merge-base verifier gives')));
  assert.ok(run({ headChanges: fix({ ...now, reason: 'other' }), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: clone(now) } }).some((p) => p.includes("is not the changes.json entry's `to`")));
  assert.ok(run({ headChanges: fix(now, { input_digest: D_BASE }), ...digests(synId, D_BASE, D_BASE), baseOnHead: { [SYN]: clone(now) } }).some((p) => p.includes('unchanged from the merge base')));
  assert.ok(run({ headChanges: fix(now), ...digests(synId, D_BASE, D_HEAD), baseOnHead: { [SYN]: clone(now) }, changedFiles: [SRC] }).some((p) => p.includes(SAME_CHANGE)));
});

// Review M1: synthetic.mjs swaps the exported v13 input for the control
// case's input only when GITHUB_JOB is corpus-inputs, so the merge-base
// verifier on the export agrees with the looser rows while the head tests
// see the real v13 input. With src touched in the same change the gate
// rejects it whatever the export says.
const M1_SYNTHETIC = `// test input only, never run by the gate
if (process.env.GITHUB_JOB === 'corpus-inputs') { /* export the control case input as version-v13-unknown */ }
`;
const swappedInputs = () => {
  const control = headInputs.cases.find((c) => c.id === 'control-test-key-v10');
  return withCase(headInputs, V13, (c) => ({ ...c, doc: control.doc, history: control.history, jwks: control.jwks }));
};

test('review M1: an export swapped under GITHUB_JOB=corpus-inputs is rejected when src is touched', async () => {
  const swapped = swappedInputs();
  const keys = [`${V13}|library`, `${V13}|cli`];
  const baseOnHead = await baseOutcomes(pkg, swapped, keys);
  const rows = Object.fromEntries(keys.map((k) => [k, baseOnHead[k]]));
  const headDigests = inputDigests(swapped);
  const over = {
    headBaseline: { ...baseline, ...rows },
    headChanges: withEntries(...keys.map((k) => entry(k, rows[k], { kind: 'corpus_fix', note: 'fixture tidy', input_digest: headDigests[V13] }))),
    baseDigests: inputDigests(headInputs),
    headDigests,
    baseOnHead,
  };
  // The export alone fools the (A) and digest rules ...
  assert.deepEqual(run({ ...over, changedFiles: ['packages/verify/test/corpus/synthetic.mjs'] }), []);
  // ... but not with the src change it needs to matter.
  const problems = run({ ...over, changedFiles: ['packages/verify/test/corpus/synthetic.mjs', SRC] });
  for (const k of keys) assert.ok(problems.some((p) => p.startsWith(`${k}: corpus_fix or baseline removal ${SAME_CHANGE}`)), `${k}: ${problems.join('; ')}`);
});

// ---------- the merge base's declared rule for a case ----------

const decls = caseDeclarations(headInputs);
// The real pin on both sides, with the merge-base and head declarations of `inputs`.
const casesOf = (inputs) => inputs.cases.map((c) => ({ id: c.id, paths: c.paths }));
const pinned = (inputs = headInputs) => ({ baseCases: decls, basePin: pin, headPin: pin, headDecls: exportDeclarations(inputs), headCases: casesOf(inputs), baseDigests: inputDigests(headInputs), headDigests: inputDigests(inputs) });
// Every declared and deferred path pins its case input digest, so an input
// change on a pinned case is always rejected; the tests of the other
// corpus_fix rules set that problem aside with others().
const DIGEST_PIN = 'a changed input needs a new case';
const others = (problems, ...texts) => problems.filter((p) => !texts.some((t) => p.includes(t)));
const fixEntries = (keys, rows, digest, kind = 'corpus_fix') => keys.map((k) => entry(k, rows[k], { kind, note: 'fixture tidy', input_digest: digest }));

test('declared rule: the M1 swap is rejected without any src change', async () => {
  const swapped = swappedInputs();
  const keys = [`${V13}|library`, `${V13}|cli`];
  const baseOnHead = await baseOutcomes(pkg, swapped, keys);
  const rows = Object.fromEntries(keys.map((k) => [k, baseOnHead[k]]));
  const headDigests = inputDigests(swapped);
  const problems = run({
    headBaseline: { ...baseline, ...rows },
    headChanges: withEntries(...fixEntries(keys, rows, headDigests[V13])),
    baseDigests: inputDigests(headInputs), headDigests, baseOnHead, ...pinned(swapped),
    changedFiles: ['packages/verify/test/corpus/synthetic.mjs'],
  });
  assert.equal(decls[V13].expect.library, 'unsupported_version');
  assert.ok(problems.some((p) => p.startsWith(`${V13}|library: corpus_fix: the merge-base verifier on the head input is decided by`) && p.includes('"unsupported_version"')), problems.join('; '));
  assert.equal(decls[V13].expect.cli, 'unsupported_version');
  assert.ok(problems.some((p) => p.startsWith(`${V13}|cli: corpus_fix: the merge-base verifier on the head input is decided by`) && p.includes('"unsupported_version"')), problems.join('; '));
});

test('declared rule: the two-PR split (neuter first, loosen later) stops at the first PR; the second has nothing to bless', async () => {
  // PR-1 is the neuter: rejected above whatever lands next. PR-2 alone (a
  // src change with no corpus correction) carries no corpus_fix to check.
  assert.deepEqual(run({ ...pinned(), changedFiles: [SRC] }), []);
  // Concurrent PRs: each is judged against the merge base's declaration,
  // so the neuter is rejected whether or not the src PR is in its base.
  const swapped = swappedInputs();
  const key = `${V13}|library`;
  const baseOnHead = await baseOutcomes(pkg, swapped, [key]);
  const headDigests = inputDigests(swapped);
  for (const changedFiles of [['packages/verify/test/corpus/synthetic.mjs'], ['packages/verify/test/corpus/synthetic.mjs', 'packages/verify/test/corpus/changes.json']]) {
    const problems = run({ headBaseline: { ...baseline, [key]: baseOnHead[key] }, headChanges: withEntries(...fixEntries([key], { [key]: baseOnHead[key] }, headDigests[V13])), baseDigests: inputDigests(headInputs), headDigests, baseOnHead, ...pinned(swapped), changedFiles });
    assert.ok(problems.some((p) => p.includes('not the merge-base declared "unsupported_version"')), problems.join('; '));
  }
});

test('declared rule: an input fix that keeps the declared cause is accepted', async () => {
  const tidy = withCase(headInputs, V13, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'input tidy'; c.doc = JSON.stringify(d); return c; });
  const key = `${V13}|library`;
  const baseOnHead = await baseOutcomes(pkg, tidy, [key]);
  assert.equal(String(baseOnHead[key].cause ?? baseOnHead[key].reason), 'unsupported_version');
  const headDigests = inputDigests(tidy);
  const problems = run({ headBaseline: { ...baseline, [key]: baseOnHead[key] }, headChanges: withEntries(...fixEntries([key], { [key]: baseOnHead[key] }, headDigests[V13])), baseDigests: inputDigests(headInputs), headDigests, baseOnHead, ...pinned(tidy) });
  // `to` carries no cause; the row is the merge-base outcome. The input digest pin rejects the changed input.
  assert.ok(problems.some((p) => p.startsWith(`${V13}|library: the head input digest differs`) && p.includes(DIGEST_PIN)), problems.join('; '));
  assert.deepEqual(others(problems, "is not the changes.json entry's", DIGEST_PIN), []);
});

test('declared rule: an undeclared path of a rule case needs corpus_fix_reason, and only there', async () => {
  // A version case whose cli path is decided before the version rule, so
  // main declares no cli expectation for it.
  const U = 'version-v10-claims-signed-as-v6-after-window';
  assert.equal(decls[U].expect.cli, undefined);
  const tidy = withCase(headInputs, U, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'input tidy'; c.doc = JSON.stringify(d); return c; });
  const cli = `${U}|cli`;
  const lib = `${U}|library`;
  const baseOnHead = await baseOutcomes(pkg, tidy, [cli, lib]);
  const headDigests = inputDigests(tidy);
  const common = { baseDigests: inputDigests(headInputs), headDigests, baseOnHead, ...pinned(tidy) };
  const pick = (k) => ({ [k]: { exit: baseOnHead[k].exit, result: baseOnHead[k].result, reason: baseOnHead[k].reason, checks: baseOnHead[k].checks, ...(baseOnHead[k].overall !== undefined ? { overall: baseOnHead[k].overall } : {}) } });
  const asFix = run({ headBaseline: { ...baseline, ...pick(cli) }, headChanges: withEntries(...fixEntries([cli], pick(cli), headDigests[U])), ...common });
  assert.ok(asFix.some((p) => p.includes('use kind corpus_fix_reason')), asFix.join('; '));
  const asReason = run({ headBaseline: { ...baseline, ...pick(cli) }, headChanges: withEntries(...fixEntries([cli], pick(cli), headDigests[U], 'corpus_fix_reason')), ...common });
  assert.ok(asReason.some((p) => p.includes(DIGEST_PIN)), asReason.join('; '));
  assert.deepEqual(others(asReason, DIGEST_PIN), []);
  // The library path declares log_unreachable, which is not its rule: it is
  // deferred, and takes no correction of either kind.
  for (const kind of ['corpus_fix', 'corpus_fix_reason']) {
    const deferred = run({ headBaseline: { ...baseline, ...pick(lib) }, headChanges: withEntries(...fixEntries([lib], pick(lib), headDigests[U], kind)), ...common });
    assert.ok(deferred.some((p) => p.includes('is deferred in declarations.frozen.json')), `${kind}: ${deferred.join('; ')}`);
  }
  // corpus_fix_reason on a declared path is refused.
  const V = 'version-l1-v4-not-allowlisted';
  const tidyV = withCase(headInputs, V, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'input tidy'; c.doc = JSON.stringify(d); return c; });
  const vlib = `${V}|library`;
  const oV = await baseOutcomes(pkg, tidyV, [vlib]);
  const rowV = { [vlib]: { exit: oV[vlib].exit, result: oV[vlib].result, reason: oV[vlib].reason, checks: oV[vlib].checks, overall: oV[vlib].overall } };
  const wrongKind = run({ headBaseline: { ...baseline, ...rowV }, headChanges: withEntries(...fixEntries([vlib], rowV, inputDigests(tidyV)[V], 'corpus_fix_reason')), baseDigests: inputDigests(headInputs), headDigests: inputDigests(tidyV), baseOnHead: oV, ...pinned(tidyV) });
  assert.ok(wrongKind.some((p) => p.includes('corpus_fix_reason is only for a case path with no declared expectation')), wrongKind.join('; '));
  // corpus_fix_reason keeps every other corpus_fix rule: the src rule, the note.
  assert.ok(run({ headBaseline: { ...baseline, ...pick(cli) }, headChanges: withEntries(...fixEntries([cli], pick(cli), headDigests[U], 'corpus_fix_reason')), ...common, changedFiles: [SRC] }).some((p) => p.includes(SAME_CHANGE)));
  const noNote = withEntries(entry(cli, pick(cli)[cli], { kind: 'corpus_fix_reason', input_digest: headDigests[U] }));
  assert.ok(run({ headBaseline: { ...baseline, ...pick(cli) }, headChanges: noNote, ...common }).some((p) => p.includes('corpus_fix needs a note')));
});

test('declared rule: no merge-base declarations fails closed', () => {
  assert.ok(run({ ...fixScenario(), baseCases: null }).some((p) => p.includes('needs the merge-base case declarations')));
});

// ---------- pinned declarations (declarations.frozen.json) ----------
// Protocol Review's ways around the merge-base `expect` (pr629-review.md
// section 3), each as one PR and as two PRs where PR-1 merges first. PR-2's
// merge base then has PR-1's synthetic.mjs; the pin cannot have moved,
// since PR-1 changing it fails the append-only rule (tested below).

const K13 = [`${V13}|library`, `${V13}|cli`];
const withExpect = (inputs, id, expect) => withCase(inputs, id, (c) => { if (expect === undefined) delete c.expect; else c.expect = expect; return c; });
const withoutCase = (inputs, id) => ({ ...inputs, cases: inputs.cases.filter((c) => c.id !== id) });
const rowOf = (o) => ({ exit: o.exit, result: o.result, reason: o.reason, checks: o.checks, ...(o.overall !== undefined ? { overall: o.overall } : {}) });
const DRIFT_HEAD = 'synthetic.mjs (head) and declarations.frozen.json (head) differ';
const DRIFT_BASE = 'corpus corrections are refused while synthetic.mjs and declarations.frozen.json differ at the merge base';
const has = (problems, text) => problems.some((p) => p.includes(text));
const pinKeyOf = (e) => `${e.case}|${e.path}`;

// The neuter of section 3: the v13 case input becomes the control v10
// document, and the rows are what the merge-base verifier gives on it.
async function neuter(inputs, kind = 'corpus_fix') {
  const neutered = withCase(inputs, V13, (c) => { const control = headInputs.cases.find((x) => x.id === 'control-test-key-v10'); return { ...c, doc: control.doc, history: control.history, jwks: control.jwks }; });
  const baseOnHead = await baseOutcomes(pkg, neutered, K13);
  const rows = Object.fromEntries(K13.map((k) => [k, rowOf(baseOnHead[k])]));
  const headDigests = inputDigests(neutered);
  return {
    inputs: neutered,
    over: {
      headBaseline: { ...baseline, ...rows },
      headChanges: withEntries(...K13.map((k) => entry(k, rows[k], { kind, note: 'fixture tidy', input_digest: headDigests[V13] }))),
      baseDigests: inputDigests(headInputs), headDigests, baseOnHead,
      changedFiles: ['packages/verify/test/corpus/synthetic.mjs', 'packages/verify/test/corpus/baseline.json', 'packages/verify/test/corpus/changes.json'],
    },
  };
}

test('pin: synthetic.mjs expect values equal declarations.frozen.json exactly', () => {
  assert.deepEqual(exportDeclarations(headInputs).size, pin.declarations.length + pin.deferred.length);
  assert.deepEqual(run({ ...pinned() }), []);
  assert.equal(isVerifierPath(DECLARATIONS_PIN), true);
  assert.deepEqual(pin.deferred.map((e) => `${e.case}|${e.path}`), ['version-v10-claims-signed-as-v6-after-window|library', 'timing-l5-backdated-iat|library']);
  assert.deepEqual(pin.reason_allowed.map((e) => `${e.case}|${e.path}`), ['version-v10-claims-signed-as-v6-after-window|cli', 'version-l1-detached-not-allowlisted|cli', 'timing-detached-created-at-moved|cli', 'timing-l5-backdated-iat|cli']);
});

test('A, one PR: weaken the v13 expect to "un" and neuter the case: rejected', async () => {
  const weak = withExpect(headInputs, V13, { library: 'un', cli: 'un' });
  const { inputs, over } = await neuter(weak);
  const problems = run({ ...over, ...pinned(inputs) });
  assert.ok(has(problems, `${DRIFT_HEAD}: ${V13}|library is "un"`), problems.join('; '));
  for (const k of K13) assert.ok(problems.some((p) => p.startsWith(`${k}: corpus_fix: the merge-base verifier on the head input is decided by`) && p.includes('"unsupported_version"')), `${k}: ${problems.join('; ')}`);
  // Weakening the pin in the same PR as well: append-only, and the pin is a
  // verifier path, so it cannot ride with a correction.
  const weakPin = clone(pin);
  for (const e of weakPin.declarations) if (e.case === V13) e.expect = 'un';
  const both = run({ ...over, ...pinned(inputs), headPin: weakPin, changedFiles: [...over.changedFiles, DECLARATIONS_PIN] });
  assert.ok(has(both, 'declarations.frozen.json is append-only: declarations entry'), both.join('; '));
  assert.ok(has(both, SAME_CHANGE), both.join('; '));
  assert.ok(has(both, 'not the merge-base declared "unsupported_version"'), both.join('; '));
});

test('A, two PRs: PR-1 (expect "un", no correction) is rejected; if merged, PR-2 (plain corpus_fix neuter) is rejected', async () => {
  const pr1 = withExpect(headInputs, V13, { library: 'un', cli: 'un' });
  const first = run({ ...pinned(pr1) });
  assert.ok(has(first, `${DRIFT_HEAD}: ${V13}|cli is "un"`), first.join('; '));
  const pr1Pin = clone(pin);
  for (const e of pr1Pin.declarations) if (e.case === V13) e.expect = 'un';
  assert.ok(has(run({ ...pinned(pr1), headPin: pr1Pin }), 'append-only'));
  // PR-1 merged anyway: PR-2's merge base has the weakened synthetic.mjs and the unchanged pin.
  const { inputs, over } = await neuter(pr1);
  const second = run({ ...over, ...pinned(inputs), baseCases: caseDeclarations(pr1) });
  assert.ok(has(second, DRIFT_BASE), second.join('; '));
  for (const k of K13) assert.ok(second.some((p) => p.startsWith(`${k}: corpus_fix: the merge-base verifier on the head input is decided by`) && p.includes('"unsupported_version"')), `${k}: ${second.join('; ')}`);
});

test('B, one PR: delete the v13 declarations and neuter as corpus_fix_reason: rejected', async () => {
  const bare = withExpect(headInputs, V13, undefined);
  const { inputs, over } = await neuter(bare, 'corpus_fix_reason');
  const problems = run({ ...over, ...pinned(inputs) });
  assert.ok(has(problems, `${DRIFT_HEAD}: ${V13}|library is pinned "unsupported_version" but not declared in synthetic.mjs`), problems.join('; '));
  for (const k of K13) {
    assert.ok(has(problems, `${k}: corpus_fix_reason is only for a case path with no declared expectation`), `${k}: ${problems.join('; ')}`);
    assert.ok(has(problems, `${k}: corpus_fix: the merge-base verifier on the head input is decided by`), `${k}: ${problems.join('; ')}`);
  }
});

test('B, two PRs: PR-1 (declarations deleted) is rejected; if merged, PR-2 (corpus_fix_reason neuter) is rejected', async () => {
  const pr1 = withExpect(headInputs, V13, undefined);
  assert.ok(has(run({ ...pinned(pr1) }), DRIFT_HEAD));
  const { inputs, over } = await neuter(pr1, 'corpus_fix_reason');
  const second = run({ ...over, ...pinned(inputs), baseCases: caseDeclarations(pr1) });
  assert.ok(has(second, DRIFT_BASE), second.join('; '));
  for (const k of K13) assert.ok(has(second, `${k}: corpus_fix_reason is only for a case path with no declared expectation`), `${k}: ${second.join('; ')}`);
  // The plain kind is rejected too: the pin, not synthetic.mjs, decides.
  const plain = await neuter(pr1);
  const asFix = run({ ...plain.over, ...pinned(plain.inputs), baseCases: caseDeclarations(pr1) });
  assert.ok(has(asFix, 'not the merge-base declared "unsupported_version"'), asFix.join('; '));
});

const removeV13 = () => {
  const head = clone(baseline);
  for (const k of K13) delete head[k];
  return { headBaseline: head, headChanges: withEntries(...K13.map((k) => entry(k, null, { kind: 'corpus_fix', note: 'case retired' }))), changedFiles: ['packages/verify/test/corpus/synthetic.mjs', 'packages/verify/test/corpus/baseline.json', 'packages/verify/test/corpus/changes.json'] };
};

test('C, one PR: drop the declared v13 case with to: null: rejected', () => {
  const gone = withoutCase(headInputs, V13);
  const problems = run({ ...removeV13(), ...pinned(gone) });
  for (const k of K13) assert.ok(has(problems, `${k}: a case path pinned in declarations.frozen.json may not be removed`), `${k}: ${problems.join('; ')}`);
  assert.ok(has(problems, DRIFT_HEAD), problems.join('; '));
  // Unpinning in the same PR: append-only.
  const smaller = { ...clone(pin), declarations: pin.declarations.filter((e) => e.case !== V13) };
  const both = run({ ...removeV13(), ...pinned(gone), headPin: smaller });
  assert.ok(has(both, 'append-only'), both.join('; '));
  for (const k of K13) assert.ok(has(both, `${k}: a case path pinned in declarations.frozen.json may not be removed`), both.join('; '));
});

test('C, two PRs: PR-1 (declarations deleted) is rejected; if merged, PR-2 (case dropped with to: null) is rejected', () => {
  const pr1 = withExpect(headInputs, V13, undefined);
  assert.ok(has(run({ ...pinned(pr1) }), DRIFT_HEAD));
  const second = run({ ...removeV13(), ...pinned(withoutCase(pr1, V13)), baseCases: caseDeclarations(pr1) });
  assert.ok(has(second, DRIFT_BASE), second.join('; '));
  for (const k of K13) assert.ok(has(second, `${k}: a case path pinned in declarations.frozen.json may not be removed`), `${k}: ${second.join('; ')}`);
});

test('pin: a legitimate append passes; an edit, a removal or a reason_allowed entry for a declared path does not', async () => {
  // A new case path, declared in synthetic.mjs and appended to the pin together.
  const newCase = { ...clone(headInputs.cases.find((c) => c.id === V13)), id: 'version-v14-unknown', expect: { library: 'unsupported_version', cli: 'unsupported_version' } };
  const grownInputs = { ...headInputs, cases: [...headInputs.cases, newCase] };
  const grown = clone(pin);
  const d14 = inputDigests(grownInputs)['version-v14-unknown'];
  grown.declarations.push({ case: 'version-v14-unknown', path: 'library', expect: 'unsupported_version', input_digest: d14 }, { case: 'version-v14-unknown', path: 'cli', expect: 'unsupported_version', input_digest: d14 });
  const o14 = await baseOutcomes(pkg, grownInputs, ['version-v14-unknown|library', 'version-v14-unknown|cli']);
  assert.deepEqual(run({ ...pinned(grownInputs), headPin: grown, baseOnHead: o14 }), []);
  // The same synthetic.mjs change without the pin append is drift.
  assert.ok(has(run({ ...pinned(grownInputs) }), `${DRIFT_HEAD}: version-v14-unknown|library is declared in synthetic.mjs ("unsupported_version") but not pinned`));
  // A deferred path gets its rule declared by an append, once the merged
  // verifier gives that cause on the unchanged input.
  const U = 'version-v10-claims-signed-as-v6-after-window';
  const enforced = withExpect(headInputs, U, { library: 'version_window_closed' });
  const declaredU = clone(pin);
  declaredU.declarations.push({ case: U, path: 'library', expect: 'version_window_closed', input_digest: inputDigests(headInputs)[U] });
  assert.deepEqual(run({ ...pinned(enforced), headPin: declaredU, baseOnHead: { [`${U}|library`]: { exit: 1, result: 'invalid', reason: 'invalid', cause: 'version_window_closed' } } }), []);
  // Declared twice, edited, removed, deleted.
  const twice = clone(declaredU);
  twice.declarations.push({ case: U, path: 'library', expect: 'log_unreachable', input_digest: inputDigests(headInputs)[U] });
  assert.ok(has(run({ ...pinned(enforced), basePin: declaredU, headPin: twice }), 'is already declared'));
  const edited = clone(pin);
  edited.declarations[0].expect = 'other';
  assert.ok(has(run({ ...pinned(), headPin: edited }), 'append-only: declarations entry 0'));
  const dropped = { ...clone(pin), reason_allowed: pin.reason_allowed.slice(1) };
  assert.ok(has(run({ ...pinned(), headPin: dropped }), 'append-only: reason_allowed entry 0'));
  assert.ok(has(run({ ...pinned(), headPin: null }), 'declarations.frozen.json: removed'));
  // reason_allowed is frozen against the merge base; on the first pin
  // (no merge-base pin) an entry may only name a path that was never declared.
  const widened = clone(pin);
  widened.reason_allowed.push({ case: V13, path: 'library' });
  assert.ok(has(run({ ...pinned(), headPin: widened }), `reason_allowed is frozen; ${V13}|library may not be added`));
  assert.ok(has(pinProblems(null, widened), `reason_allowed entry ${V13}|library names a declared path`));
});

test('pin: corpus_fix_reason only on the frozen reason_allowed list; corrections need the merge-base pin', async () => {
  // label-v6-outer-stamp-10|cli is declared version_mismatch: an input tidy
  // that keeps that reason passes as corpus_fix, never as corpus_fix_reason.
  const L = 'label-v6-outer-stamp-10';
  const tidy = withCase(headInputs, L, (c) => { const d = JSON.parse(c.doc); d.corpus_note = 'input tidy'; c.doc = JSON.stringify(d); return c; });
  const key = `${L}|cli`;
  const o = await baseOutcomes(pkg, tidy, [key]);
  const row = { [key]: rowOf(o[key]) };
  const over = { headBaseline: { ...baseline, ...row }, baseDigests: inputDigests(headInputs), headDigests: inputDigests(tidy), baseOnHead: o, ...pinned(tidy) };
  const asReason = run({ ...over, headChanges: withEntries(...fixEntries([key], row, inputDigests(tidy)[L], 'corpus_fix_reason')) });
  assert.ok(has(asReason, 'corpus_fix_reason is only for a case path with no declared expectation'), asReason.join('; '));
  // A path that is neither declared nor on the list (a case the pin does
  // not classify) takes no corpus_fix_reason either, and is unclassified.
  const unpinnedPin = { ...clone(pin), declarations: pin.declarations.filter((e) => pinKeyOf(e) !== key) };
  const unpinnedInputs = withExpect(tidy, L, undefined);
  const unpinned = run({ ...over, ...pinned(unpinnedInputs), basePin: unpinnedPin, headPin: unpinnedPin, baseCases: caseDeclarations(withExpect(headInputs, L, undefined)), headChanges: withEntries(...fixEntries([key], row, inputDigests(tidy)[L], 'corpus_fix_reason')) });
  assert.ok(has(unpinned, 'corpus_fix_reason is only for the paths listed in reason_allowed'), unpinned.join('; '));
  assert.ok(has(unpinned, `${key}: case path in synthetic.mjs (head) is not in declarations.frozen.json (head)`), unpinned.join('; '));
  const asFix = run({ ...over, headChanges: withEntries(...fixEntries([key], row, inputDigests(tidy)[L])) });
  assert.ok(has(asFix, DIGEST_PIN), asFix.join('; '));
  assert.deepEqual(others(asFix, DIGEST_PIN), []);
  // No pin at the merge base: corrections fail closed.
  const noPin = run({ ...over, basePin: null, headChanges: withEntries(...fixEntries([key], row, inputDigests(tidy)[L])) });
  assert.ok(has(noPin, 'corpus corrections need packages/verify/test/corpus/declarations.frozen.json at the merge base'), noPin.join('; '));
  // No head declarations: fail closed.
  assert.ok(has(run({ ...over, headDecls: null, headChanges: withEntries(...fixEntries([key], row, inputDigests(tidy)[L])) }), 'need the head case declarations'));
});

// ---------- Protocol Review re-check of 9f912f22 ----------
// The label class, the deferred unlock (P6), reason_allowed appends (P8),
// deferred entries on declared paths (P5), and case paths the pin does not
// classify. Each correction as one PR and as two PRs where PR-1 merges first.

const LABELS = ['label-v10-outer-stamp-6', 'label-v6-outer-stamp-10'];
const cliKey = (id) => `${id}|cli`;
const declaredValue = (key) => pin.declarations.find((e) => pinKeyOf(e) === key)?.expect;

// A label case input becomes the control v10 document (cli: key untrusted).
async function neuterLabel(inputs, id, kind = 'corpus_fix') {
  const control = headInputs.cases.find((x) => x.id === 'control-test-key-v10');
  const neutered = withCase(inputs, id, (c) => ({ ...c, doc: control.doc, history: control.history, jwks: control.jwks }));
  const key = cliKey(id);
  const baseOnHead = await baseOutcomes(pkg, neutered, [key]);
  const row = rowOf(baseOnHead[key]);
  const headDigests = inputDigests(neutered);
  return {
    inputs: neutered,
    row,
    over: {
      headBaseline: { ...baseline, [key]: row },
      headChanges: withEntries(entry(key, row, { kind, note: 'fixture tidy', input_digest: headDigests[id] })),
      baseDigests: inputDigests(headInputs), headDigests, baseOnHead, changedFiles: [...TEST_ONLY],
    },
  };
}
const dropLabel = (id) => {
  const key = cliKey(id);
  const head = clone(baseline);
  delete head[key];
  return { headBaseline: head, headChanges: withEntries(entry(key, null, { kind: 'corpus_fix', note: 'case retired' })), changedFiles: [...TEST_ONLY] };
};
const LABEL_MISMATCH = (key) => `${key}: corpus_fix: the merge-base verifier on the head input is decided by "key untrusted", not the merge-base declared "version_mismatch"`;

test('label: the cli paths are pinned at the reasons main\'s verifier gives', () => {
  for (const id of LABELS) {
    assert.equal(declaredValue(cliKey(id)), 'version_mismatch', id);
    assert.equal(baseline[cliKey(id)].reason, 'version_mismatch', id);
    assert.equal(decls[id].class, 'label');
  }
  // label-v4v5 cli is decided by the conflicting stamps (the same document
  // without hmac_attestation is legacy_form_not_allowlisted), so it is declared.
  assert.equal(declaredValue('label-v4v5-conflicting-stamps|cli'), 'unsupported_version');
  assert.equal(baseline['label-v4v5-conflicting-stamps|cli'].reason, 'unsupported_version');
});

test('label: a stamp-free label-v4v5 document is decided by another rule, so the cli declaration tests the stamps', async () => {
  const L = 'label-v4v5-conflicting-stamps';
  const key = cliKey(L);
  const noHmac = withCase(headInputs, L, (c) => { const d = JSON.parse(c.doc); delete d.hmac_attestation; c.doc = JSON.stringify(d); return c; });
  const o = await baseOutcomes(pkg, noHmac, [key]);
  assert.equal(o[key].reason, 'legacy_form_not_allowlisted');
  const row = rowOf(o[key]);
  const problems = run({ headBaseline: { ...baseline, [key]: row }, headChanges: withEntries(...fixEntries([key], { [key]: row }, inputDigests(noHmac)[L])), baseDigests: inputDigests(headInputs), headDigests: inputDigests(noHmac), baseOnHead: o, ...pinned(noHmac) });
  assert.ok(has(problems, `${key}: corpus_fix: the merge-base verifier on the head input is decided by "legacy_form_not_allowlisted", not the merge-base declared "unsupported_version"`), problems.join('; '));
});

test('label, one PR: a corpus_fix neuter of either outer-stamp case is rejected, of either kind', async () => {
  for (const id of LABELS) {
    for (const kind of ['corpus_fix', 'corpus_fix_reason']) {
      const { inputs, over } = await neuterLabel(headInputs, id, kind);
      const problems = run({ ...over, ...pinned(inputs) });
      assert.ok(has(problems, LABEL_MISMATCH(cliKey(id))), `${id} ${kind}: ${problems.join('; ')}`);
      if (kind === 'corpus_fix_reason') assert.ok(has(problems, 'corpus_fix_reason is only for a case path with no declared expectation'), problems.join('; '));
    }
  }
});

test('label, one PR: dropping either outer-stamp case with to: null is rejected', () => {
  for (const id of LABELS) {
    const problems = run({ ...dropLabel(id), ...pinned(withoutCase(headInputs, id)) });
    assert.ok(has(problems, `${cliKey(id)}: a case path pinned in declarations.frozen.json may not be removed`), `${id}: ${problems.join('; ')}`);
    assert.ok(has(problems, `${DRIFT_HEAD}: ${cliKey(id)} is pinned "version_mismatch" but not declared in synthetic.mjs`), problems.join('; '));
    // to: null with the row kept is refused too.
    const keep = run({ headChanges: withEntries(entry(cliKey(id), null, { kind: 'corpus_fix', note: 'x' })), ...pinned() });
    assert.ok(has(keep, `${cliKey(id)}: to: null on a case path pinned`), keep.join('; '));
  }
});

test('label, two PRs: PR-1 (expect weakened or deleted) is rejected; if merged, the PR-2 neuter and the PR-2 drop are rejected', async () => {
  for (const id of LABELS) {
    for (const weak of [undefined, { cli: 'version' }, { cli: 'key untrusted' }]) {
      const pr1 = withExpect(headInputs, id, weak);
      assert.ok(has(run({ ...pinned(pr1) }), DRIFT_HEAD), `${id} PR-1`);
      const { inputs, over } = await neuterLabel(pr1, id);
      const second = run({ ...over, ...pinned(inputs), baseCases: caseDeclarations(pr1) });
      assert.ok(has(second, DRIFT_BASE), second.join('; '));
      assert.ok(has(second, LABEL_MISMATCH(cliKey(id))), `${id}: ${second.join('; ')}`);
      const drop = run({ ...dropLabel(id), ...pinned(withoutCase(pr1, id)), baseCases: caseDeclarations(pr1) });
      assert.ok(has(drop, DRIFT_BASE), drop.join('; '));
      assert.ok(has(drop, `${cliKey(id)}: a case path pinned in declarations.frozen.json may not be removed`), drop.join('; '));
    }
  }
});

test('label is a rule class: with no pin entry, a label neuter still needs a declaration', async () => {
  const id = LABELS[1];
  const key = cliKey(id);
  const bare = { ...clone(pin), declarations: pin.declarations.filter((e) => pinKeyOf(e) !== key) };
  const pr1 = withExpect(headInputs, id, undefined);
  const { inputs, over } = await neuterLabel(pr1, id);
  const problems = run({ ...over, ...pinned(inputs), basePin: bare, headPin: bare, baseCases: caseDeclarations(pr1) });
  assert.ok(has(problems, `${key}: corpus_fix: rule case path that is neither declared nor in reason_allowed at the merge base`), problems.join('; '));
});

const U6 = 'version-v10-claims-signed-as-v6-after-window';
const U6LIB = `${U6}|library`;

// ---------- Protocol Review re-check of be90d5f7 ----------
// Pin appends are read off the merge-base verifier on an unchanged input;
// every declared and deferred path pins its case input digest.

const D = inputDigests(headInputs);
const withDigest = (e) => ({ ...e, input_digest: D[e.case] ?? 'f'.repeat(64) });
// The gate with a head pin, the merge-base verifier run on `inputs` for the appended keys.
async function appendRun(inputs, headPinX, over = {}) {
  const keys = appendedPinEntries(over.basePin ?? pin, headPinX).map(pinKeyOf);
  const baseOnHead = keys.length ? await baseOutcomes(pkg, inputs, keys) : {};
  return run({ ...pinned(inputs), headPin: headPinX, baseOnHead, ...over });
}
const BOUND = (key, value, got) => `${key}: pinned ${JSON.stringify(value)}, but the merge-base verifier on the head input gives ${JSON.stringify(got)}`;
const V13_DOC = (inputs, id) => withCase(inputs, id, (c) => { const v = headInputs.cases.find((x) => x.id === V13); return { ...c, doc: v.doc, history: v.history, jwks: v.jwks }; });

test('deferred unlock, PR-1: an appended declaration equal to the deferred value, or to any cause that decides nothing, is rejected', async () => {
  for (const value of ['log_unreachable', 'key untrusted', 'signed_receipt_unavailable', 'receipt_unavailable', 'could_not_check', 'anchor_unreachable', 'base_rpc_error', 'rpc_timeout', 'issuer_history_unavailable', 'invalid']) {
    const p1 = clone(pin);
    p1.declarations.push(withDigest({ case: U6, path: 'library', expect: value }));
    const inputs = value === 'log_unreachable' ? headInputs : withExpect(headInputs, U6, { library: value });
    const first = await appendRun(inputs, p1);
    assert.ok(has(first, `${U6LIB} may not be declared ${JSON.stringify(value)}, which makes no decision by the case rule`), `${value}: ${first.join('; ')}`);
    if (value === 'log_unreachable') assert.ok(has(first, `${U6LIB} is deferred as "log_unreachable"`), first.join('; '));
    else assert.ok(has(first, BOUND(U6LIB, value, 'log_unreachable')), `${value}: ${first.join('; ')}`);
  }
  const want = pin.deferred.find((e) => pinKeyOf(e) === 'timing-l5-backdated-iat|library').expect;
  const p1 = clone(pin);
  p1.declarations.push(withDigest({ case: 'timing-l5-backdated-iat', path: 'library', expect: want }));
  assert.ok(pinProblems(pin, p1).some((p) => p.includes('a declaration for it must name a real decision')));
});

// Values Protocol Review found outside the no-decision list, and a decision by another rule.
const UNLOCK_VALUES = ['not_checked', 'base_rpc_null', 'epoch_signature_unverified', 'no_issuer_signature', 'tx_not_found', 'json_parse_error', 'unsupported_version'];

test('deferred unlock, two PRs: PR-1 appends any other value and is rejected by the merge-base verifier; PR-2 (the v13 input swap) is rejected', async () => {
  for (const value of UNLOCK_VALUES) {
    const p1 = clone(pin);
    p1.declarations.push(withDigest({ case: U6, path: 'library', expect: value }));
    const pr1 = withExpect(headInputs, U6, { library: value });
    const first = await appendRun(pr1, p1);
    assert.ok(has(first, BOUND(U6LIB, value, 'log_unreachable')), `${value}: ${first.join('; ')}`);
    // PR-1 appending together with the input swap: the input changed, and the digest pin moved.
    const swapped = V13_DOC(pr1, U6);
    const p1s = clone(pin);
    p1s.declarations.push({ case: U6, path: 'library', expect: value, input_digest: inputDigests(swapped)[U6] });
    const firstSwap = await appendRun(swapped, p1s);
    assert.ok(has(firstSwap, `${U6LIB}: a pin append for an existing case needs its input unchanged from the merge base`), `${value}: ${firstSwap.join('; ')}`);
    assert.ok(has(firstSwap, `${U6LIB}: the head input digest differs from the input_digest pinned`), `${value}: ${firstSwap.join('; ')}`);
    // PR-2 on the real merge base (PR-1 rejected): library corpus_fix, cli corpus_fix_reason.
    const keys = [U6LIB, `${U6}|cli`];
    const swap2 = V13_DOC(headInputs, U6);
    const o = await baseOutcomes(pkg, swap2, keys);
    const rows = Object.fromEntries(keys.map((k) => [k, rowOf(o[k])]));
    const second = run({
      headBaseline: { ...baseline, ...rows },
      headChanges: withEntries(entry(U6LIB, rows[U6LIB], { kind: 'corpus_fix', note: 'x', input_digest: inputDigests(swap2)[U6] }), entry(`${U6}|cli`, rows[`${U6}|cli`], { kind: 'corpus_fix_reason', note: 'x', input_digest: inputDigests(swap2)[U6] })),
      baseDigests: D, headDigests: inputDigests(swap2), baseOnHead: o, ...pinned(swap2),
    });
    assert.ok(has(second, `${U6LIB}: corpus_fix: ${U6LIB} is deferred`), second.join('; '));
    assert.ok(has(second, `${U6LIB}: the head input digest differs from the input_digest pinned`), second.join('; '));
  }
});

test('deferred unlock, two PRs: PR-1 (declare log_unreachable) is rejected; PR-2 (neuter to log_unreachable) is rejected on the deferred path', async () => {
  const p1 = clone(pin);
  p1.declarations.push(withDigest({ case: U6, path: 'library', expect: 'log_unreachable' }));
  assert.ok(pinProblems(pin, p1).length > 0);
  const control = headInputs.cases.find((x) => x.id === 'control-test-key-v10');
  const neutered = withCase(headInputs, U6, (c) => ({ ...c, doc: control.doc, history: control.history, jwks: control.jwks }));
  const o = await baseOutcomes(pkg, neutered, [U6LIB]);
  assert.equal(o[U6LIB].cause, 'log_unreachable');
  const row = { [U6LIB]: rowOf(o[U6LIB]) };
  for (const kind of ['corpus_fix', 'corpus_fix_reason']) {
    const second = run({ headBaseline: { ...baseline, ...row }, headChanges: withEntries(...fixEntries([U6LIB], row, inputDigests(neutered)[U6], kind)), baseDigests: D, headDigests: inputDigests(neutered), baseOnHead: o, ...pinned(neutered) });
    assert.ok(has(second, `${U6LIB}: corpus_fix: ${U6LIB} is deferred in declarations.frozen.json`), `${kind}: ${second.join('; ')}`);
  }
});

test('a deferred path is declared once the merged verifier reaches its rule: the append is read off the merge-base verifier', async () => {
  // PR-A (verifier change) lands first; the merge-base verifier then gives the rule's cause on the unchanged input.
  const p1 = clone(pin);
  p1.declarations.push(withDigest({ case: U6, path: 'library', expect: 'version_window_closed' }));
  const pr = withExpect(headInputs, U6, { library: 'version_window_closed' });
  const merged = { ...Object.fromEntries([[U6LIB, { exit: 1, result: 'invalid', reason: 'invalid', cause: 'version_window_closed' }]]) };
  assert.deepEqual(run({ ...pinned(pr), headPin: p1, baseOnHead: merged }), []);
  // Before PR-A, the same append is refused.
  assert.ok(has(await appendRun(pr, p1), BOUND(U6LIB, 'version_window_closed', 'log_unreachable')));
  // No merge-base outcomes: fails closed.
  assert.ok(has(run({ ...pinned(pr), headPin: p1, baseOnHead: null }), 'a pin append needs the merge-base verifier outcomes'));
});

test('input swap on a declared log_unreachable path is rejected by the input digest pin', async () => {
  // gate10-pv9 and gate9-pv8 (library) and control-test-key-v10 (library) declare log_unreachable.
  const control = headInputs.cases.find((x) => x.id === 'control-test-key-v10');
  for (const id of ['gate10-pv9-no-history-pin', 'gate9-pv8-no-head-binding']) {
    const key = `${id}|library`;
    assert.equal(declaredValue(key), 'log_unreachable');
    const swapped = withCase(headInputs, id, (c) => ({ ...c, doc: control.doc, history: control.history, jwks: control.jwks }));
    const o = await baseOutcomes(pkg, swapped, [key]);
    assert.equal(o[key].cause, 'log_unreachable', id);
    const row = { [key]: rowOf(o[key]) };
    const problems = run({ headBaseline: { ...baseline, ...row }, headChanges: withEntries(...fixEntries([key], row, inputDigests(swapped)[id])), baseDigests: D, headDigests: inputDigests(swapped), baseOnHead: o, ...pinned(swapped) });
    assert.ok(has(problems, `${key}: the head input digest differs from the input_digest pinned in declarations.frozen.json; a changed input needs a new case`), `${id}: ${problems.join('; ')}`);
    // Without the corpus_fix the swap alone is rejected too.
    assert.ok(has(run({ ...pinned(swapped) }), `${key}: the head input digest differs`), id);
  }
  // The label same-reason swap (label-v10 given the label-v6 document).
  const L = 'label-v10-outer-stamp-6';
  const other = headInputs.cases.find((x) => x.id === 'label-v6-outer-stamp-10');
  const lswap = withCase(headInputs, L, (c) => ({ ...c, doc: other.doc }));
  assert.ok(has(run({ ...pinned(lswap) }), `${L}|cli: the head input digest differs`));
  // Every declared and deferred entry pins its case digest, and the head matches.
  for (const e of [...pin.declarations, ...pin.deferred]) assert.equal(e.input_digest, D[e.case], pinKeyOf(e));
  assert.deepEqual(pinDigestProblems(pin, D), []);
});

test('golden-corpus.test.mjs is a verifier path: a PR-1 edit to it cannot ride with a correction', async () => {
  assert.equal(isVerifierPath('packages/verify/test/golden-corpus.test.mjs'), true);
  assert.equal(isVerifierPath('packages/verify/test/Golden-Corpus.test.mjs'), true);
  // PR-1: weaken the golden test and append a declaration in one change: the append is bound anyway.
  const p1 = clone(pin);
  p1.declarations.push(withDigest({ case: U6, path: 'library', expect: 'unsupported_version' }));
  const first = await appendRun(withExpect(headInputs, U6, { library: 'unsupported_version' }), p1, { changedFiles: ['packages/verify/test/golden-corpus.test.mjs', DECLARATIONS_PIN, 'packages/verify/test/corpus/synthetic.mjs'] });
  assert.ok(has(first, BOUND(U6LIB, 'unsupported_version', 'log_unreachable')), first.join('; '));
  // A corpus correction next to a golden-corpus edit is rejected as a verifier change.
  assert.ok(run({ ...fixScenario(), changedFiles: [...TEST_ONLY, 'packages/verify/test/golden-corpus.test.mjs'] }).some((p) => p.includes(SAME_CHANGE)));
});

test('controls: both cli paths are declared at their targets, and a supersede is rejected', async () => {
  assert.equal(declaredValue('control-test-key-v10|cli'), 'key untrusted');
  assert.equal(declaredValue('control-unsigned-document|cli'), 'signed_receipt_unavailable');
  assert.equal(baseline['control-test-key-v10|cli'].reason, 'key untrusted');
  assert.equal(baseline['control-unsigned-document|cli'].reason, 'signed_receipt_unavailable');
  assert.ok(!pin.deferred.some((e) => e.case.startsWith('control-')));
  // CU1: a later declaration with another value.
  const cu1 = clone(pin);
  cu1.declarations.push(withDigest({ case: 'control-unsigned-document', path: 'cli', expect: 'unsupported_version' }));
  const r = await appendRun(withExpect(headInputs, 'control-unsigned-document', { cli: 'unsupported_version' }), cu1);
  assert.ok(has(r, 'control-unsigned-document|cli is already declared'), r.join('; '));
  assert.ok(has(r, BOUND('control-unsigned-document|cli', 'unsupported_version', 'signed_receipt_unavailable')), r.join('; '));
  // CU2: swap its input for the v13 document.
  assert.ok(has(run({ ...pinned(V13_DOC(headInputs, 'control-unsigned-document')) }), 'control-unsigned-document|cli: the head input digest differs'));
  // The control outcomes on the head inputs are the declared ones.
  const o = await baseOutcomes(pkg, headInputs, ['control-test-key-v10|cli', 'control-unsigned-document|cli']);
  assert.equal(o['control-test-key-v10|cli'].reason, 'key untrusted');
  assert.equal(o['control-unsigned-document|cli'].reason, 'signed_receipt_unavailable');
});

test('reason_allowed is frozen: an append for a future path, a label path or any other path is rejected', () => {
  for (const e of [{ case: 'version-v14-future', path: 'cli' }, { case: 'label-v6-outer-stamp-10', path: 'library' }, { case: 'control-unsigned-document', path: 'library' }]) {
    const h = clone(pin);
    h.reason_allowed.push(e);
    assert.ok(has(run({ ...pinned(), headPin: h }), `reason_allowed is frozen; ${pinKeyOf(e)} may not be added`), pinKeyOf(e));
  }
  const moved = clone(pin);
  moved.reason_allowed.reverse();
  assert.ok(has(pinProblems(pin, moved), 'append-only: reason_allowed entry 0'));
  assert.deepEqual(pinProblems(pin, clone(pin)), []);
});

test('deferred: an added entry naming a declared or reason_allowed path is rejected', () => {
  const onDeclared = clone(pin);
  onDeclared.deferred.push(withDigest({ case: V13, path: 'library', expect: 'log_unreachable' }));
  assert.ok(has(pinProblems(pin, onDeclared), `deferred entry ${V13}|library names a declared path`));
  assert.ok(has(pinProblems(null, onDeclared), `deferred entry ${V13}|library names a declared path`));
  const onReason = clone(pin);
  onReason.deferred.push(withDigest({ case: U6, path: 'cli', expect: 'key untrusted' }));
  assert.ok(has(pinProblems(pin, onReason), `deferred entry ${U6}|cli names a reason_allowed path`));
  const superseded = clone(pin);
  superseded.declarations.push(withDigest({ case: U6, path: 'library', expect: 'version_window_closed' }));
  assert.deepEqual(pinProblems(superseded, clone(superseded)), []);
  // An entry without a well-formed input_digest is malformed.
  const noDigest = clone(pin);
  delete noDigest.declarations[noDigest.declarations.length - 1].input_digest;
  assert.ok(has(pinProblems(null, noDigest), 'declarations: malformed entry'));
});

test('every synthetic case path is classified by the pin, in exactly one list', () => {
  const all = headInputs.cases.flatMap((c) => c.paths.map((p) => `${c.id}|${p}`));
  assert.deepEqual(unclassifiedPaths(casesOf(headInputs), pin), []);
  const lists = ['declarations', 'deferred', 'reason_allowed'].map((l) => new Set(pin[l].map(pinKeyOf)));
  for (const k of all) assert.equal(lists.filter((s) => s.has(k)).length, 1, k);
  assert.equal(all.length, lists.reduce((n, s) => n + s.size, 0));
  assert.deepEqual(lists.map((s) => s.size), [28, 2, 4]);
  for (const e of pin.deferred) assert.equal(isNonDecision(e.expect), true, pinKeyOf(e));
});

test('unclassified case path: a new case without a pin entry is rejected; a new case appended with digest and verifier-read values passes', async () => {
  const NEW = 'version-v14-unknown';
  const newCase = { ...clone(headInputs.cases.find((c) => c.id === V13)), id: NEW, expect: null };
  const grown = { ...headInputs, cases: [...headInputs.cases, newCase] };
  const problems = run({ ...pinned(grown) });
  for (const path of ['cli', 'library']) assert.ok(has(problems, `${NEW}|${path}: case path in synthetic.mjs (head) is not in declarations.frozen.json (head)`), problems.join('; '));
  // Both paths declared at what the merge-base verifier gives, with the case digest: ok.
  const full = { ...headInputs, cases: [...headInputs.cases, { ...newCase, expect: { library: 'unsupported_version', cli: 'unsupported_version' } }] };
  const dNew = inputDigests(full)[NEW];
  const fullPin = clone(pin);
  fullPin.declarations.push({ case: NEW, path: 'library', expect: 'unsupported_version', input_digest: dNew }, { case: NEW, path: 'cli', expect: 'unsupported_version', input_digest: dNew });
  assert.deepEqual(await appendRun(full, fullPin), []);
  // One path left out: only that one is reported.
  const halfPin = clone(pin);
  halfPin.declarations.push({ case: NEW, path: 'library', expect: 'unsupported_version', input_digest: dNew });
  const half = { ...headInputs, cases: [...headInputs.cases, { ...newCase, expect: { library: 'unsupported_version' } }] };
  assert.deepEqual(await appendRun(half, halfPin), [`${NEW}|cli: case path in synthetic.mjs (head) is not in declarations.frozen.json (head); declare it, or defer it with its current expect`]);
  // A wrong digest or a value the verifier does not give: rejected.
  const badDigest = clone(fullPin);
  badDigest.declarations.at(-1).input_digest = 'e'.repeat(64);
  assert.ok(has(await appendRun(full, badDigest), `${NEW}|cli: the head input digest differs`));
  const wrong = { ...headInputs, cases: [...headInputs.cases, { ...newCase, expect: { library: 'unsupported_version', cli: 'version_mismatch' } }] };
  const wrongPin = clone(halfPin);
  wrongPin.declarations.push({ case: NEW, path: 'cli', expect: 'version_mismatch', input_digest: dNew });
  assert.ok(has(await appendRun(wrong, wrongPin), BOUND(`${NEW}|cli`, 'version_mismatch', 'unsupported_version')));
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
  for (const rel of [BASELINE, CHANGES, REGISTRY_PIN, DECLARATIONS_PIN]) {
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
  // Changed input, and `to` is what the merge-base verifier gives on it:
  // every other corpus_fix rule passes, and the pinned input digest rejects it.
  const changed = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'tidy.json', tidy)]);
  assert.equal(changed.status, 1, changed.stdout);
  const lines = changed.stderr.trim().split('\n');
  assert.ok(lines.length > 0 && lines.every((l) => l.includes(DIGEST_PIN)), changed.stderr);
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

test('end to end: review M1 with a src change fails the gate script, which runs no head code', { skip: !gitOk }, async () => {
  const swapped = swappedInputs();
  const keys = [`${V13}|library`, `${V13}|cli`];
  const baseOnHead = await baseOutcomes(pkg, swapped, keys);
  const digest = inputDigests(swapped)[V13];
  const marker = join(mkdtempSync(join(tmpdir(), 'corpus-m1-')), 'ran');
  const srcFile = 'packages/verify/src/receipt-version.ts';
  const synthFile = 'packages/verify/test/corpus/synthetic.mjs';
  const r = repoWith((root) => {
    writeFileSync(join(root, srcFile), 'export const LEGACY = [4, 5, 13];\n');
    // If anything imported this head file, the marker would appear.
    writeFileSync(join(root, synthFile), `${M1_SYNTHETIC}import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`);
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of keys) b[k] = baseOnHead[k];
    writeFileSync(p, JSON.stringify(b, null, 1));
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(...keys.map((k) => entry(k, baseOnHead[k], { kind: 'corpus_fix', note: 'fixture tidy', input_digest: digest })));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  }, (root) => {
    mkdirSync(dirname(join(root, srcFile)), { recursive: true });
    writeFileSync(join(root, srcFile), 'export const LEGACY = [4, 5];\n');
    mkdirSync(dirname(join(root, synthFile)), { recursive: true });
    writeFileSync(join(root, synthFile), '// base\n');
  });
  const res = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'swapped.json', swapped)]);
  assert.equal(res.status, 1, res.stdout);
  for (const k of keys) assert.ok(res.stderr.includes(`${k}: corpus_fix or baseline removal ${SAME_CHANGE} (${srcFile})`), res.stderr);
  assert.equal(existsSync(marker), false, 'the gate ran a head file');
});

test('end to end: the gate reads the declared rule from the merge base, not from the head export', { skip: !gitOk }, async () => {
  const swapped = swappedInputs();
  // The head export claims the case is a control case declared log_unreachable.
  const lying = withCase(swapped, V13, (c) => ({ ...c, class: 'control', expect: { library: 'log_unreachable', cli: 'key untrusted' } }));
  const key = `${V13}|library`;
  const baseOnHead = await baseOutcomes(pkg, lying, [key]);
  const row = { exit: baseOnHead[key].exit, result: baseOnHead[key].result, reason: baseOnHead[key].reason, checks: baseOnHead[key].checks, overall: baseOnHead[key].overall };
  const digest = inputDigests(lying)[V13];
  const r = repoWith((root) => {
    const p = join(root, BASELINE);
    const b = JSON.parse(readFileSync(p, 'utf8'));
    b[key] = row;
    writeFileSync(p, JSON.stringify(b, null, 1));
    const cp = join(root, CHANGES);
    const c = JSON.parse(readFileSync(cp, 'utf8'));
    c.changes.push(entry(key, row, { kind: 'corpus_fix', note: 'fixture tidy', input_digest: digest }));
    writeFileSync(cp, JSON.stringify(c, null, 1));
  });
  const res = gateCli(r.root, r.base, ['--base-tree', pkg, '--head-inputs', writeInputs(r.root, 'lying.json', lying)]);
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /version-v13-unknown\|library: corpus_fix: the merge-base verifier on the head input is decided by .* not the merge-base declared "unsupported_version"/);
});

test('end to end: a case path the pin does not classify fails the gate script', { skip: !gitOk }, () => {
  const extra = { ...clone(headInputs.cases.find((c) => c.id === V13)), id: 'version-v14-unknown', expect: null };
  const grown = { ...headInputs, cases: [...headInputs.cases, extra] };
  const r = repoWith(() => {});
  const ok = gateCli(r.root, r.base, ['--head-inputs', writeInputs(r.root, 'inputs.json', headInputs)]);
  assert.equal(ok.status, 0, ok.stderr);
  const bad = gateCli(r.root, r.base, ['--head-inputs', writeInputs(r.root, 'grown.json', grown)]);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stderr, /version-v14-unknown\|cli: case path in synthetic\.mjs \(head\) is not in declarations\.frozen\.json/);
});

test('end to end: an unknown base is a usage error, not a pass', { skip: !gitOk }, () => {
  const clean = repoWith(() => {});
  assert.equal(gateCli(clean.root, 'f'.repeat(40)).status, 3);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 3);
});
