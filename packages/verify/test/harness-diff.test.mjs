// Harness diff (scripts/harness-diff.mjs): the merge-base harness and the
// head harness on the same merge-base cases, against the merge-base
// verifier build. Includes the two-PR route from the #629 review: PR-A
// edits only run-library.mjs so that timing-l5-backdated-iat's library
// path reports a decision cause; PR-B touches src and tightens the deferred
// row to it. The job fails on PR-A, so PR-B never has a doctored harness
// to rely on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases, buildOverlay, changedHarnessPaths, compareOutcomes, harnessOutcomes } from '../scripts/harness-diff.mjs';
import { isBuilderPath } from '../scripts/corpus-gate.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const script = join(pkg, 'scripts', 'harness-diff.mjs');
const gitOk = spawnSync('git', ['--version']).status === 0;
const work = mkdtempSync(join(tmpdir(), 'harness-diff-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

const L5 = 'timing-l5-backdated-iat';
const LIB = 'packages/verify/test/corpus/run-library.mjs';
const CLI_RUNNER = 'packages/verify/test/corpus/lib.mjs';
const PR_A_LINE = `if (/timing-l5/.test(file)) out = { ...out, exit: 1, result: 'invalid', reason: 'invalid', overall: 'failed', cause: 'not_in_log' };\n`;

// A throwaway repo with the packages/verify harness files, so overlays can be
// read through git exactly as the job reads them.
function harnessRepo() {
  const root = mkdtempSync(join(work, 'repo-'));
  const git = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q');
  const files = spawnSync('git', ['-C', pkg, 'ls-files', '-z', 'test'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean)
    .map((f) => `packages/verify/${f}`).filter(isBuilderPath);
  assert.ok(files.includes(LIB) && files.includes(CLI_RUNNER), files.join(' '));
  for (const rel of [...files, 'packages/verify/src/cli.ts', 'packages/verify/test/corpus/baseline.json']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), readFileSync(join(pkg, rel.slice('packages/verify/'.length))));
  }
  git('add', '-A'); git('commit', '-q', '-m', 'main');
  return { root, git, base: git('rev-parse', 'HEAD') };
}
const edit = (root, rel, fn) => writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));

const casesDir = join(work, 'cases');
const cases = await buildCases(pkg, casesDir);
const baseOut = await harnessOutcomes(pkg, cases);

test('the merge-base harness gives the same outcomes on two runs (no flake to diff)', async () => {
  assert.ok(Object.keys(baseOut.public).length > 100 && Object.keys(baseOut.chain).length === Object.keys(baseOut.public).length);
  assert.ok(baseOut.public[`${L5}|library`], 'the l5 library path is in the case list');
  assert.deepEqual(compareOutcomes(baseOut, await harnessOutcomes(pkg, cases)), []);
});

test('two-PR route, step 1: the harness-only PR-A is caught; step 2 (PR-B) touches no harness file', { skip: !gitOk }, async () => {
  const r = harnessRepo();
  // PR-A: one line in run-library.mjs, nothing else.
  edit(r.root, LIB, (s) => s.replace('process.stdout.write(`${JSON.stringify(out)}\\n`);', `${PR_A_LINE}process.stdout.write(\`\${JSON.stringify(out)}\\n\`);`));
  assert.ok(readFileSync(join(r.root, LIB), 'utf8').includes(PR_A_LINE));
  r.git('commit', '-q', '-am', 'PR-A: harness only');
  const prA = r.git('rev-parse', 'HEAD');
  assert.deepEqual(changedHarnessPaths(r.root, r.base, prA), [LIB]);
  const overlay = join(work, 'overlay-pr-a');
  buildOverlay(pkg, r.root, prA, overlay);
  assert.ok(readFileSync(join(overlay, 'test/corpus/run-library.mjs'), 'utf8').includes(PR_A_LINE));
  const problems = compareOutcomes(baseOut, await harnessOutcomes(overlay, cases));
  assert.ok(problems.some((p) => p.startsWith(`public: ${L5}|library: merge-base harness`) && p.includes('not_in_log')), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith(`chain: ${L5}|library:`)), problems.join('\n'));
  // Only the l5 library path moves.
  assert.ok(problems.every((p) => p.includes(`${L5}|library`)), problems.join('\n'));
  rmSync(overlay, { recursive: true, force: true });
  // PR-B (on top of PR-A): a src touch and the deferred tighten. No harness
  // file, so the job has nothing to diff; the route depended on PR-A landing.
  edit(r.root, 'packages/verify/src/cli.ts', (s) => `${s}\n`);
  edit(r.root, 'packages/verify/test/corpus/baseline.json', (s) => {
    const b = JSON.parse(s);
    b[`${L5}|library`] = { ...b[`${L5}|library`], exit: 1, result: 'invalid', reason: 'invalid', overall: 'failed', cause: 'not_in_log' };
    return JSON.stringify(b, null, 1);
  });
  r.git('commit', '-q', '-am', 'PR-B: src touch and tighten');
  assert.deepEqual(changedHarnessPaths(r.root, prA, 'HEAD'), []);
});

test('the same route through the cli runner (lib.mjs) is caught', { skip: !gitOk }, async () => {
  const r = harnessRepo();
  edit(r.root, CLI_RUNNER, (s) => s.replace("return ['--import', preload, cli, c.file || c.input, '--json'];", "return /timing-l5/.test(String(c.file)) ? ['-e', 'process.exit(1)'] : ['--import', preload, cli, c.file || c.input, '--json'];"));
  r.git('commit', '-q', '-am', 'harness only');
  const overlay = join(work, 'overlay-cli');
  buildOverlay(pkg, r.root, 'HEAD', overlay);
  const problems = compareOutcomes(baseOut, await harnessOutcomes(overlay, cases));
  rmSync(overlay, { recursive: true, force: true });
  assert.ok(problems.some((p) => p.startsWith(`public: ${L5}|cli:`)), problems.join('\n'));
});

test('a harness change that moves no outcome passes', { skip: !gitOk }, async () => {
  const r = harnessRepo();
  edit(r.root, CLI_RUNNER, (s) => `// a comment\n${s}`);
  edit(r.root, LIB, (s) => s.replace('let out;', 'let out; // same behaviour'));
  r.git('commit', '-q', '-am', 'harness refactor');
  assert.deepEqual(changedHarnessPaths(r.root, r.base, 'HEAD').sort(), [CLI_RUNNER, LIB].sort());
  const overlay = join(work, 'overlay-noop');
  buildOverlay(pkg, r.root, 'HEAD', overlay);
  const out = await harnessOutcomes(overlay, cases);
  rmSync(overlay, { recursive: true, force: true });
  assert.deepEqual(compareOutcomes(baseOut, out), []);
});

test('a deleted harness file is removed from the overlay, and the CLI reports differences with exit 1', { skip: !gitOk }, () => {
  const r = harnessRepo();
  r.git('rm', '-q', 'packages/verify/test/corpus/run-signature.mjs');
  r.git('commit', '-q', '-m', 'drop runner');
  const overlay = join(work, 'overlay-del');
  const files = buildOverlay(pkg, r.root, 'HEAD', overlay);
  assert.ok(!files.includes('packages/verify/test/corpus/run-signature.mjs'));
  assert.throws(() => readFileSync(join(overlay, 'test/corpus/run-signature.mjs')));
  rmSync(overlay, { recursive: true, force: true });
  const a = join(work, 'a.json');
  const b = join(work, 'b.json');
  writeFileSync(a, JSON.stringify({ public: { 'x|cli': { exit: 2 } } }));
  writeFileSync(b, JSON.stringify({ public: { 'x|cli': { exit: 1 } } }));
  const diff = spawnSync(process.execPath, [script, 'compare', a, b], { encoding: 'utf8' });
  assert.equal(diff.status, 1);
  assert.match(diff.stderr, /x\|cli: merge-base harness \{"exit":2\} \| head harness \{"exit":1\}/);
  assert.equal(spawnSync(process.execPath, [script, 'compare', a, a], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 3);
});

test('compare fails closed on a missing outcome or no outcomes at all', () => {
  assert.ok(compareOutcomes({ public: { 'x|cli': { exit: 2 } } }, { public: {} }).some((p) => p.includes('no outcome from the head harness')));
  assert.ok(compareOutcomes({ public: {} }, { public: { 'x|cli': { exit: 2 } } }).some((p) => p.includes('no outcome from the merge-base harness')));
  assert.ok(compareOutcomes({}, {}).some((p) => p.includes('gave no outcomes')));
  assert.ok(compareOutcomes({ public: { 'x|cli': { exit: 2 } } }, {}).some((p) => p.includes('no outcome from the head harness')));
});

test('git reads ignore replace refs and grafts (changed and overlay)', { skip: !gitOk }, () => {
  const r = harnessRepo();
  const lib = readFileSync(join(r.root, LIB), 'utf8');
  edit(r.root, 'packages/verify/src/cli.ts', (s) => `${s}\n`);
  r.git('commit', '-q', '-am', 'src only');
  const forged = join(work, 'forged-lib.mjs');
  writeFileSync(forged, `${PR_A_LINE}${lib}`);
  // Plain git would see a harness edit in HEAD through the replace ref.
  r.git('replace', r.git('rev-parse', `HEAD:${LIB}`), r.git('hash-object', '-w', forged));
  assert.notEqual(r.git('show', `HEAD:${LIB}`), lib.trim());
  assert.deepEqual(changedHarnessPaths(r.root, r.base, 'HEAD'), []);
  const overlay = join(work, 'overlay-replace');
  buildOverlay(pkg, r.root, 'HEAD', overlay);
  assert.equal(readFileSync(join(overlay, 'test/corpus/run-library.mjs'), 'utf8'), lib);
  rmSync(overlay, { recursive: true, force: true });
  // A graft that makes HEAD a root commit would list every file as changed.
  mkdirSync(join(r.root, '.git', 'info'), { recursive: true });
  writeFileSync(join(r.root, '.git', 'info', 'grafts'), `${r.git('rev-parse', 'HEAD')}\n`);
  assert.deepEqual(changedHarnessPaths(r.root, r.base, 'HEAD'), []);
});
