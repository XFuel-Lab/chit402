// scripts/select-driver.sh: which copy of a CI driver (corpus-gate.mjs,
// harness-diff.mjs) the corpus jobs run. Once a driver has ever existed on
// the target branch it must come from the merge base; a branch that
// predates it fails closed. Only the change that adds it runs its own copy.
// A shallow clone fails closed.
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
