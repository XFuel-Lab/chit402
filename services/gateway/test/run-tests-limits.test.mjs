import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  countMismatches,
  fileProblems,
  fileTestCounts,
  filesWithoutCompletion,
  problemMessages,
  readCountManifest,
  runTestFiles,
  staleManifestEntries,
} from '../scripts/run-tests.mjs';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOW = 'test/fixtures/run-tests/slow.fixture.mjs';
const QUICK = 'test/fixtures/run-tests/quick.fixture.mjs';
const EARLY = 'test/fixtures/run-tests/exits-early.fixture.mjs';
const LEAK = 'test/fixtures/run-tests/leaks-handle.fixture.mjs';

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test('run-tests: a file past the per-file limit fails the run and is named', { timeout: 60_000 }, () => {
  const errors = [];
  const code = runTestFiles([QUICK, SLOW], {
    cwd: gatewayDir,
    timeoutMs: 1500,
    stdio: 'pipe',
    env: childEnv(),
    error: (line) => errors.push(line),
  });
  const out = errors.join('\n');
  assert.equal(code, 1, out);
  const slowAbs = resolve(gatewayDir, SLOW);
  assert.ok(errors.some((line) => line.includes(slowAbs) && /testTimeoutFailure/.test(line)), out);
  assert.equal(errors.some((line) => line.includes(resolve(gatewayDir, QUICK))), false, out);
});

test('run-tests: files inside the limit pass with no problem lines', { timeout: 60_000 }, () => {
  const errors = [];
  const code = runTestFiles([QUICK], {
    cwd: gatewayDir,
    timeoutMs: 30_000,
    stdio: 'pipe',
    env: childEnv(),
    error: (line) => errors.push(line),
  });
  assert.equal(code, 0, errors.join('\n'));
  assert.deepEqual(errors, []);
});

test('fileProblems reads timeout and cancelled rows, dedupes, and problem rows are not completions', () => {
  const a = '/tmp/a.test.mjs';
  const b = '/tmp/b.test.mjs';
  const records = [
    { file: a, passed: true },
    { file: b, passed: false, problem: 'testTimeoutFailure', test: b },
    { file: b, passed: false, problem: 'testTimeoutFailure', test: b },
    { file: a, problem: 'cancelledByParent', test: 'inner' },
    { file: '/tmp/c.test.mjs', problem: 'cancelledByParent', test: 'orphan' },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n{"fi';
  const problems = fileProblems(records);
  assert.deepEqual(problems, [
    { file: b, problem: 'testTimeoutFailure', test: b },
    { file: a, problem: 'cancelledByParent', test: 'inner' },
    { file: '/tmp/c.test.mjs', problem: 'cancelledByParent', test: 'orphan' },
  ]);
  assert.deepEqual(filesWithoutCompletion(records, [a, b, '/tmp/c.test.mjs']), ['/tmp/c.test.mjs'], 'a problem row alone is not a completion');
  const lines = problemMessages(problems);
  assert.ok(/FAIL \/tmp\/b\.test\.mjs hit the per-file time limit \(testTimeoutFailure\)\./.test(lines[0]), lines[0]);
  assert.ok(/FAIL \/tmp\/a\.test\.mjs had a cancelled test \(cancelledByParent\), test: inner\./.test(lines[1]), lines[1]);
  assert.deepEqual(fileProblems(''), []);
});

test('run-tests main passes its own argv through and the reporter records problems', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(/runTestFiles\(files, \{ nodeArgs: args, expected \}\)/.test(runner), 'main forwards node args and checks the manifest');
  assert.ok(/const args = process\.argv\.slice\(2\);/.test(runner), 'args are the runner argv');
  const reporter = readFileSync(join(gatewayDir, 'scripts/file-done-reporter.mjs'), 'utf8');
  assert.ok(/'testTimeoutFailure', 'cancelledByParent'/.test(reporter), 'reporter records timeouts and cancellations');
  assert.ok(/event\.type !== 'test:complete' && event\.type !== 'test:fail'/.test(reporter), 'reporter reads test:complete, which arrives before test:fail');
});

function run(files, extra = {}) {
  const errors = [];
  const code = runTestFiles(files, {
    cwd: gatewayDir,
    timeoutMs: 30_000,
    stdio: 'pipe',
    env: childEnv(),
    error: (line) => errors.push(line),
    ...extra,
  });
  return { code, errors, out: errors.join('\n') };
}

test('run-tests: a file that exits 0 partway fails against its manifest count', { timeout: 60_000 }, () => {
  // Without the count check this run is green: the file exits 0 and writes its
  // completion row. This is the shape of a cut-short file.
  const bare = run([EARLY]);
  assert.equal(bare.code, 0, `the early exit alone looks green: ${bare.out}`);
  const { code, errors, out } = run([QUICK, EARLY], { expected: { [QUICK]: 2, [EARLY]: 3 } });
  assert.equal(code, 1, out);
  assert.ok(errors.some((line) => /FAIL test\/fixtures\/run-tests\/exits-early\.fixture\.mjs reported [0-2] of 3 expected tests/.test(line)), out);
  assert.equal(errors.some((line) => line.includes(QUICK)), false, out);
});

test('run-tests: a count above the manifest, or a file missing from it, fails and says how to regenerate', { timeout: 60_000 }, () => {
  const lowered = run([QUICK], { expected: { [QUICK]: 1 } });
  assert.equal(lowered.code, 1, lowered.out);
  assert.ok(/FAIL test\/fixtures\/run-tests\/quick\.fixture\.mjs reported 2 tests but test\/test-counts\.json expects 1\./.test(lowered.out), lowered.out);
  assert.ok(/npm run test:counts/.test(lowered.out), lowered.out);
  const absent = run([QUICK], { expected: {} });
  assert.equal(absent.code, 1, absent.out);
  assert.ok(/FAIL test\/fixtures\/run-tests\/quick\.fixture\.mjs is not in test\/test-counts\.json \(it reported 2 tests\)/.test(absent.out), absent.out);
});

test('run-tests: a matching manifest passes and reports per-file counts', { timeout: 60_000 }, () => {
  let counts;
  const { code, errors } = run([QUICK], { expected: { [QUICK]: 2 }, onCounts: (c) => { counts = c; } });
  assert.equal(code, 0, errors.join('\n'));
  assert.deepEqual(errors, []);
  assert.deepEqual(counts, { [QUICK]: 2 });
});

test('run-tests: a server left open with no after() hangs the file and fails the run by name', { timeout: 60_000 }, () => {
  const { code, errors, out } = run([QUICK, LEAK], { timeoutMs: 3000, expected: { [QUICK]: 2, [LEAK]: 1 } });
  assert.equal(code, 1, out);
  const leakAbs = resolve(gatewayDir, LEAK);
  assert.ok(errors.some((line) => line.includes(leakAbs) && /testTimeoutFailure/.test(line)), out);
});

test('fileTestCounts reads count rows only, and a file with no count row is zero', () => {
  const a = resolve(gatewayDir, 'test/a.test.mjs');
  const b = resolve(gatewayDir, 'test/b.test.mjs');
  const records = [
    { file: a, passed: true },
    { file: b, passed: true },
    { file: a, tests: 5 },
    { file: b, problem: 'cancelledByParent', test: 'x' },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n{"file":"' + b + '","tes';
  const counts = fileTestCounts(records);
  assert.deepEqual([...counts], [[a, 5]]);
  const lines = countMismatches(counts, ['test/a.test.mjs', 'test/b.test.mjs'], { 'test/a.test.mjs': 5, 'test/b.test.mjs': 3 }, gatewayDir);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.ok(/FAIL test\/b\.test\.mjs reported 0 of 3 expected tests\. It stopped early or tests were removed\./.test(lines[0]), lines[0]);
  assert.deepEqual(staleManifestEntries({ 'test/a.test.mjs': 5, 'test/gone.test.mjs': 1 }, ['test/a.test.mjs']).length, 1);
  assert.ok(/lists test\/gone\.test\.mjs, which does not exist/.test(staleManifestEntries({ 'test/gone.test.mjs': 1 }, [])[0]));
});

test('readCountManifest rejects a malformed manifest and a total that does not add up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'counts-'));
  try {
    const path = join(dir, 'c.json');
    const bad = [
      {},
      { total: 1, files: [] },
      { total: 0, files: { 'test/a.test.mjs': 0 } },
      { total: 2, files: { 'test/a.test.mjs': 1.5 } },
      { total: 9, files: { 'test/a.test.mjs': 3 } },
    ];
    for (const body of bad) {
      writeFileSync(path, JSON.stringify(body));
      assert.throws(() => readCountManifest(path), undefined, JSON.stringify(body));
    }
    writeFileSync(path, JSON.stringify({ total: 3, files: { 'test/a.test.mjs': 3 } }));
    assert.deepEqual(readCountManifest(path), { 'test/a.test.mjs': 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the runner spawns node without --test-force-exit and --write-counts refuses extra arguments', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(!/'--test-force-exit'/.test(runner), 'no force-exit in the spawn arguments');
  assert.ok(/if \(args\.length !== 1\)/.test(runner), '--write-counts takes no other arguments');
  assert.ok(/if \(code !== 0 \|\| !counts\)/.test(runner), '--write-counts writes only after a clean run');
  const pkg = JSON.parse(readFileSync(join(gatewayDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
  assert.equal(pkg.scripts['test:counts'], 'node scripts/run-tests.mjs --write-counts');
});
