import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fileProblems, filesWithoutCompletion, problemMessages, runTestFiles } from '../scripts/run-tests.mjs';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOW = 'test/fixtures/run-tests/slow.fixture.mjs';
const QUICK = 'test/fixtures/run-tests/quick.fixture.mjs';

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
  assert.ok(/runTestFiles\(files, \{ nodeArgs: process\.argv\.slice\(2\) \}\)/.test(runner), 'main forwards node args');
  const reporter = readFileSync(join(gatewayDir, 'scripts/file-done-reporter.mjs'), 'utf8');
  assert.ok(/'testTimeoutFailure', 'cancelledByParent'/.test(reporter), 'reporter records timeouts and cancellations');
  assert.ok(/event\.type !== 'test:complete' && event\.type !== 'test:fail'/.test(reporter), 'reporter reads test:complete, which arrives before test:fail');
});
