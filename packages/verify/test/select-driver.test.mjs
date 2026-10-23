// scripts/select-driver.sh: which copy of a CI driver (corpus-gate.mjs,
// harness-diff.mjs) the corpus jobs run. Once a driver has ever existed on
// the target branch it must come from the merge base; a branch that
// predates it fails closed. Only the change that adds it runs its own copy.
// A shallow, partial or treeless clone fails closed, and replace refs and
// grafts are ignored.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/select-driver.sh', import.meta.url));
// The jobs that call it run on Linux only.
const skip = process.platform === 'win32' || spawnSync('bash', ['--version']).status !== 0 || spawnSync('git', ['--version']).status !== 0;
const work = mkdtempSync(join(tmpdir(), 'select-driver-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

const GATE = 'packages/verify/scripts/corpus-gate.mjs';
const DIFF = 'packages/verify/scripts/harness-diff.mjs';
const TRUSTED = '// merge-base driver\n';
const FORGED = 'console.log("ok"); // no-op driver from the change\n';

function repo() {
  const root = mkdtempSync(join(work, 'repo-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  git('checkout', '-q', '-B', 'main');
  put(GATE, '// gate\n');
  put('README.md', 'x\n');
  commit('main: gate');
  return { root, git, put, commit };
}

const run = (root, ref, base, out, ...paths) => spawnSync('bash', [script, root, ref, base, out, ...paths], { encoding: 'utf8' });

test('(a) a branch made before the driver landed on main fails closed, and the stale copy is not written', { skip }, () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'old-pr');
  r.put('packages/verify/test/corpus/run-library.mjs', '// harness edit\n');
  r.put(DIFF, FORGED);
  r.commit('old-pr: harness edit and its own driver');
  r.git('checkout', '-q', 'main');
  r.put(DIFF, TRUSTED);
  r.commit('main: add the driver');
  r.git('checkout', '-q', 'old-pr');
  const base = r.git('merge-base', 'HEAD', 'main');
  const out = join(work, 'out-a');
  const res = run(r.root, 'main', base, out, GATE, DIFF);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /::error::.*harness-diff\.mjs exists on main .* but not at the merge base .*merge main into this branch/);
  assert.ok(!existsSync(join(out, 'harness-diff.mjs')), 'the change\'s own driver is never selected');
});

test('(b) the change that adds the driver (never on main) runs its own copy, with a notice', { skip }, () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'add-driver');
  r.put(DIFF, TRUSTED);
  r.commit('add the driver');
  const base = r.git('merge-base', 'HEAD', 'main');
  const out = join(work, 'out-b');
  const res = run(r.root, 'main', base, out, GATE, DIFF);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /::notice::packages\/verify\/scripts\/harness-diff\.mjs has never existed on main; running this change's copy/);
  assert.match(res.stdout, /corpus-gate\.mjs from the merge base/);
  assert.equal(readFileSync(join(out, 'harness-diff.mjs'), 'utf8'), TRUSTED);
  assert.equal(readFileSync(join(out, 'corpus-gate.mjs'), 'utf8'), '// gate\n');
});

test('(c) a normal PR runs the merge-base driver, not its own edit of it', { skip }, () => {
  const r = repo();
  r.put(DIFF, TRUSTED);
  r.commit('main: add the driver');
  r.git('checkout', '-q', '-b', 'pr');
  r.put(DIFF, FORGED);
  r.put(GATE, '// gate edited by the change\n');
  r.commit('pr: edit both drivers');
  r.git('checkout', '-q', 'main');
  r.put('README.md', 'y\n');
  r.commit('main moves on');
  r.git('checkout', '-q', 'pr');
  const base = r.git('merge-base', 'HEAD', 'main');
  const out = join(work, 'out-c');
  const res = run(r.root, 'main', base, out, GATE, DIFF);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stdout, /::notice::/);
  assert.equal(readFileSync(join(out, 'harness-diff.mjs'), 'utf8'), TRUSTED);
  assert.equal(readFileSync(join(out, 'corpus-gate.mjs'), 'utf8'), '// gate\n');
});

test('(d) a shallow clone fails closed, even where the full history would allow the bootstrap', { skip }, () => {
  const r = repo();
  r.put('README.md', 'z\n');
  r.commit('main: second commit');
  r.git('checkout', '-q', '-b', 'add-driver');
  r.put(DIFF, TRUSTED);
  r.commit('add the driver');
  const shallow = join(work, 'shallow');
  const c = spawnSync('git', ['clone', '-q', '--depth', '1', '--no-single-branch', `file://${r.root}`, shallow], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  spawnSync('git', ['-C', shallow, 'checkout', '-q', 'add-driver']);
  const out = join(work, 'out-d');
  const res = run(shallow, 'origin/main', 'origin/main', out, GATE, DIFF);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /::error::select-driver: the checkout is shallow/);
  assert.ok(!existsSync(join(out, 'harness-diff.mjs')));
});

test('an unknown ref or base fails closed; missing arguments are a usage error', { skip }, () => {
  const r = repo();
  const head = r.git('rev-parse', 'HEAD');
  assert.equal(run(r.root, 'origin/nope', head, join(work, 'out-e'), GATE).status, 1);
  assert.equal(run(r.root, 'main', '0000000000000000000000000000000000000000', join(work, 'out-e'), GATE).status, 1);
  assert.equal(spawnSync('bash', [script, r.root, 'main'], { encoding: 'utf8' }).status, 3);
});

// main: gate, then the driver added, then the driver deleted (tip). A branch
// off the tip adds its own driver. The driver has existed on main, so the
// branch must fail closed. A replace ref or a graft that re-parents the tip
// onto the first commit hides that history; neither may change the answer.
function deletedOnMain() {
  const r = repo();
  const c0 = r.git('rev-parse', 'HEAD');
  r.put(DIFF, TRUSTED);
  r.commit('main: add the driver');
  r.git('rm', '-q', DIFF);
  const tip = r.commit('main: drop the driver');
  r.git('checkout', '-q', '-b', 'pr');
  r.put(DIFF, FORGED);
  r.commit('pr: its own driver');
  return { ...r, c0, tip };
}

test('a replace ref that hides the driver\'s history on main is ignored', { skip }, () => {
  const r = deletedOnMain();
  r.git('replace', '--graft', r.tip, r.c0);
  assert.equal(r.git('rev-list', '-1', 'main', '--', DIFF), '', 'the replace ref hides the history from plain git');
  const res = run(r.root, 'main', r.tip, join(work, 'out-replace-hist'), GATE, DIFF);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /::error::.*harness-diff\.mjs exists on main .* but not at the merge base/);
  assert.ok(!existsSync(join(work, 'out-replace-hist', 'harness-diff.mjs')));
});

test('a replace ref that swaps the merge-base driver blob is ignored', { skip }, () => {
  const r = repo();
  r.put(DIFF, TRUSTED);
  const base = r.commit('main: add the driver');
  r.git('checkout', '-q', '-b', 'pr');
  r.put('README.md', 'pr\n');
  r.commit('pr: docs');
  const forged = join(work, 'forged-blob.mjs');
  writeFileSync(forged, FORGED);
  r.git('replace', r.git('rev-parse', `${base}:${DIFF}`), r.git('hash-object', '-w', forged));
  assert.equal(r.git('show', `${base}:${DIFF}`) + '\n', FORGED, 'the replace ref swaps the blob for plain git');
  const out = join(work, 'out-replace-blob');
  const res = run(r.root, 'main', base, out, GATE, DIFF);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(readFileSync(join(out, 'harness-diff.mjs'), 'utf8'), TRUSTED);
  // An inherited GIT_REPLACE_REF_BASE is not honoured either.
  const env = { ...process.env, GIT_REPLACE_REF_BASE: 'refs/replace/' };
  const res2 = spawnSync('bash', [script, r.root, 'main', base, out, DIFF], { encoding: 'utf8', env });
  assert.equal(res2.status, 0, res2.stdout + res2.stderr);
  assert.equal(readFileSync(join(out, 'harness-diff.mjs'), 'utf8'), TRUSTED);
});

test('a graft file that hides the driver\'s history on main is ignored', { skip }, () => {
  const r = deletedOnMain();
  mkdirSync(join(r.root, '.git', 'info'), { recursive: true });
  writeFileSync(join(r.root, '.git', 'info', 'grafts'), `${r.tip} ${r.c0}\n`);
  assert.equal(r.git('-c', 'advice.graftFileDeprecated=false', 'rev-list', '-1', 'main', '--', DIFF), '', 'the graft hides the history from plain git');
  const out = join(work, 'out-graft');
  const res = run(r.root, 'main', r.tip, out, GATE, DIFF);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /::error::.*harness-diff\.mjs exists on main .* but not at the merge base/);
  assert.ok(!existsSync(join(out, 'harness-diff.mjs')));
  // GIT_GRAFT_FILE pointing at the same grafts is overridden too.
  const env = { ...process.env, GIT_GRAFT_FILE: join(r.root, '.git', 'info', 'grafts') };
  const res2 = spawnSync('bash', [script, r.root, 'main', r.tip, out, GATE, DIFF], { encoding: 'utf8', env });
  assert.equal(res2.status, 1, res2.stdout + res2.stderr);
});

for (const filter of ['blob:none', 'tree:0']) {
  test(`a partial clone (--filter=${filter}) fails closed`, { skip }, () => {
    const r = repo();
    r.git('checkout', '-q', '-b', 'add-driver');
    r.put(DIFF, TRUSTED);
    r.commit('add the driver');
    r.git('config', 'uploadpack.allowFilter', 'true');
    const clone = join(work, `partial-${filter.replace(/\W/g, '-')}`);
    const c = spawnSync('git', ['clone', '-q', `--filter=${filter}`, '--no-single-branch', `file://${r.root}`, clone], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    assert.equal(spawnSync('git', ['-C', clone, 'checkout', '-q', 'add-driver']).status, 0);
    assert.equal(spawnSync('git', ['-C', clone, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).stdout.trim(), 'false');
    const out = join(work, `out-${filter.replace(/\W/g, '-')}`);
    const res = run(clone, 'origin/main', 'origin/main', out, GATE, DIFF);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /::error::select-driver: the checkout is a partial or treeless clone/);
    assert.ok(!existsSync(join(out, 'harness-diff.mjs')));
  });
}

test('a promisor remote set in config alone fails closed', { skip }, () => {
  const r = repo();
  r.git('config', 'extensions.partialClone', 'origin');
  const head = r.git('rev-parse', 'HEAD');
  const res = run(r.root, 'main', head, join(work, 'out-promisor'), GATE);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /partial or treeless clone/);
});
