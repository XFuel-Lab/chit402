// Temp-dir hygiene: a gate run, the gate's input export and merge-base
// runs, and the corpus-gate test suite leave nothing behind in the temp
// dir, and a failing test file still removes its temp dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const script = join(pkg, 'scripts', 'corpus-gate.mjs');
const gitOk = spawnSync('git', ['--version']).status === 0;

// A fresh, empty TMPDIR for a child process; nothing else writes there.
const freshTmp = () => tempDir('tmp-hygiene-');
// The child runs as its own test run, not as a subtest of this file.
const childEnv = (tmp) => { const { NODE_TEST_CONTEXT: _c, ...env } = process.env; return { ...env, TMPDIR: tmp, TMP: tmp, TEMP: tmp }; };
const runIn = (tmp, args, opts = {}) => spawnSync(process.execPath, args, { cwd: pkg, encoding: 'utf8', env: childEnv(tmp), maxBuffer: 64 << 20, ...opts });
const left = (tmp) => readdirSync(tmp);

test('corpus-gate export and merge-base runs remove their temp dirs', () => {
  const tmp = freshTmp();
  const out = runIn(tmp, [script, 'export', pkg]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(left(tmp), []);
  const inputsFile = join(tempDir('tmp-hygiene-inputs-'), 'inputs.json');
  writeFileSync(inputsFile, out.stdout);
  const probe = `const g = await import(${JSON.stringify(pathToFileURL(script).href)});
const inputs = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(inputsFile)}, 'utf8'));
const c = inputs.cases[0];
const o = await g.baseOutcomes(${JSON.stringify(pkg)}, inputs, [c.id + '|' + c.paths[0]]);
if (Object.keys(o).length !== 1) process.exit(2);`;
  const r = runIn(tmp, ['--input-type=module', '-e', probe]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(left(tmp), []);
});

test('a gate run against a throwaway repo leaves no temp entries', { skip: !gitOk }, () => {
  const root = tempDir('tmp-hygiene-repo-');
  const git = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q');
  for (const rel of ['test/corpus/baseline.json', 'test/corpus/changes.json', 'test/corpus/manifest.json', 'test/corpus/declarations.frozen.json']) {
    const dest = join(root, 'packages/verify', rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(pkg, rel)));
  }
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'head');
  const tmp = freshTmp();
  const inputs = runIn(tmp, [script, 'export', pkg]);
  assert.equal(inputs.status, 0, inputs.stderr);
  const inputsFile = join(tempDir('tmp-hygiene-inputs-'), 'inputs.json');
  writeFileSync(inputsFile, inputs.stdout);
  const res = runIn(tmp, [script, '--base', base, '--root', root, '--base-tree', pkg, '--head-inputs', inputsFile]);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(left(tmp), []);
});

test('the corpus-gate test suite leaves no temp entries', { skip: !gitOk, timeout: 900000 }, () => {
  const tmp = freshTmp();
  const r = runIn(tmp, ['--test', '--test-concurrency=1', join(pkg, 'test', 'corpus-gate.test.mjs')], { timeout: 880000 });
  assert.equal(r.status, 0, r.stdout.slice(-4000));
  assert.deepEqual(left(tmp), []);
});

test('a failing test file still removes its temp dirs', () => {
  const tmp = freshTmp();
  const dir = tempDir('tmp-hygiene-child-');
  const child = join(dir, 'child.test.mjs');
  writeFileSync(child, `import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from ${JSON.stringify(pathToFileURL(join(pkg, 'test', 'tmp-dirs.mjs')).href)};
test('fails after making a temp dir', () => {
  writeFileSync(join(tempDir('child-'), 'x'), 'x');
  throw new Error('expected failure');
});
`);
  const r = runIn(tmp, ['--test', child]);
  assert.notEqual(r.status, 0, `the child test should fail: ${r.stdout.slice(0, 2000)} ${r.stderr.slice(0, 2000)}`);
  assert.deepEqual(left(tmp), []);
});
