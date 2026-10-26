import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  countMismatches,
  fileProblems,
  fileTestCounts,
  filesWithoutCompletion,
  problemMessages,
  fileSkipCounts,
  readCountManifest,
  readManifest,
  runTestFiles,
  skipCapLines,
  staleManifestEntries,
  nodeOptionsTokens,
  normaliseOption,
  resolveSkipCap,
  stripTestFilters,
  testFilterArgs,
  writeCounts,
} from '../scripts/run-tests.mjs';
import fileDoneReporter from '../scripts/file-done-reporter.mjs';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOW = 'test/fixtures/run-tests/slow.fixture.mjs';
const QUICK = 'test/fixtures/run-tests/quick.fixture.mjs';
const EARLY = 'test/fixtures/run-tests/exits-early.fixture.mjs';
const LEAK = 'test/fixtures/run-tests/leaks-handle.fixture.mjs';
const FAILS = 'test/fixtures/run-tests/fails.fixture.mjs';
const SKIPS = 'test/fixtures/run-tests/skips.fixture.mjs';
const CANCELLED = 'test/fixtures/run-tests/cancelled.fixture.mjs';
const NESTED_TIMEOUT = 'test/fixtures/run-tests/nested-timeout.fixture.mjs';

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
  assert.ok(/runTestFiles\(files, \{ nodeArgs: args, expected, maxSkipped: skipCap\.cap, skipCapSource: skipCap\.source \}\)/.test(runner), 'main forwards node args and checks the manifest and the skip cap');
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
  assert.ok(errors.some((line) => /FAIL test\/fixtures\/run-tests\/exits-early\.fixture\.mjs reported ([0-2] of 3 expected tests|no test count, so 0 of 3 expected tests are confirmed)/.test(line)), out);
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
  assert.ok(/FAIL test\/b\.test\.mjs reported no test count, so 0 of 3 expected tests are confirmed\. The file exited before any test finished, or the reporter's stream was cut/.test(lines[0]), lines[0]);
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
    writeFileSync(path, JSON.stringify({ total: 3, skipped: 0, files: { 'test/a.test.mjs': 3 } }));
    assert.deepEqual(readCountManifest(path), { 'test/a.test.mjs': 3 });
    assert.deepEqual(readManifest(path), { files: { 'test/a.test.mjs': 3 }, skipped: 0 });
    for (const skipped of [undefined, -1, 1.5, '3', null]) {
      writeFileSync(path, JSON.stringify({ total: 3, skipped, files: { 'test/a.test.mjs': 3 } }));
      assert.throws(() => readManifest(path), /skipped/, `skipped ${JSON.stringify(skipped)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the runner spawns node without --test-force-exit and --write-counts refuses extra arguments', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  const spawnArgs = runner.slice(runner.indexOf('spawnSync(\n    process.execPath,'), runner.indexOf('      ...files,\n'));
  assert.ok(/'--test-concurrency=1',/.test(spawnArgs), 'found the spawn arguments');
  assert.ok(!/--test-force-exit/.test(spawnArgs), 'no force-exit in the spawn arguments');
  assert.ok(/if \(args\.length !== 1\)/.test(runner), '--write-counts takes no other arguments');
  assert.ok(/if \(code !== 0 \|\| !counts\)/.test(runner), '--write-counts writes only after a clean run');
  const pkg = JSON.parse(readFileSync(join(gatewayDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
  assert.equal(pkg.scripts['test:counts'], 'node scripts/run-tests.mjs --write-counts');
});

// S-1: test filters. A skipped test emits test:pass, so a filtered run keeps the
// manifest counts and used to exit 0 with nothing executed.

test('S-1: the runner refuses test filters in its arguments and spawns nothing', { timeout: 60_000 }, () => {
  for (const nodeArgs of [
    ['--test-name-pattern=^zzNOMATCH$'],
    ['--test-name-pattern', '^zzNOMATCH$'],
    ['--test-skip-pattern=quick'],
    ['--test-only'],
    ['--test-shard=1/2'],
  ]) {
    const { code, errors, out } = run([QUICK], { nodeArgs, expected: { [QUICK]: 2 }, maxSkipped: 0 });
    assert.equal(code, 1, `${nodeArgs.join(' ')}: ${out}`);
    assert.equal(errors.length, 1, out);
    assert.ok(/^run-tests: refusing test option --test-/.test(errors[0]), errors[0]);
  }
  assert.deepEqual(testFilterArgs(['--test-name-pattern', 'x', '--test-only', '--trace-warnings', '--test-shard=1/3']), ['--test-name-pattern', '--test-only', '--test-shard=1/3']);
  assert.deepEqual(testFilterArgs(['--trace-warnings', '--test-timeout=5']), []);
  assert.deepEqual(testFilterArgs(undefined), []);
});

test('S-1: ordinary node arguments still pass through', { timeout: 60_000 }, () => {
  const { code, errors } = run([QUICK], { nodeArgs: ['--trace-warnings'], expected: { [QUICK]: 2 }, maxSkipped: 0 });
  assert.equal(code, 0, errors.join('\n'));
  assert.deepEqual(errors, []);
});

test('S-1: test filters are stripped from NODE_OPTIONS before node runs', { timeout: 60_000 }, () => {
  // --test-only in NODE_OPTIONS skips every test not marked only. With the strip,
  // both quick tests run and none is skipped, so a zero skip cap holds.
  const env = { ...childEnv(), NODE_OPTIONS: '--test-only --max-old-space-size=4096' };
  let skipped;
  const { code, errors, out } = run([QUICK], { env, expected: { [QUICK]: 2 }, maxSkipped: 0, onCounts: (_c, s) => { skipped = s; } });
  assert.equal(code, 0, out);
  assert.equal(skipped, 0, out);
  assert.equal(errors.length, 1, out);
  assert.ok(/^run-tests: removed --test-only from NODE_OPTIONS/.test(errors[0]), errors[0]);
  assert.deepEqual(stripTestFilters('--test-only --max-old-space-size=4096'), { value: '--max-old-space-size=4096', removed: ['--test-only'] });
  assert.deepEqual(stripTestFilters('--test-name-pattern x --inspect=0 --test-skip-pattern=y --test-shard 1/2'), { value: '--inspect=0', removed: ['--test-name-pattern', 'x', '--test-skip-pattern=y', '--test-shard', '1/2'] });
  assert.deepEqual(stripTestFilters(undefined), { value: '', removed: [] });
});

test('S-1: a run that skips more tests than the manifest allows fails and names the file', { timeout: 60_000 }, () => {
  const over = run([QUICK, SKIPS], { expected: { [QUICK]: 2, [SKIPS]: 3 }, maxSkipped: 1 });
  assert.equal(over.code, 1, over.out);
  assert.ok(over.errors.some((line) => /FAIL 2 tests were skipped, more than the 1 test\/test-counts\.json allows/.test(line) && line.includes(`${SKIPS} (2)`)), over.out);
  let skipped;
  const at = run([QUICK, SKIPS], { expected: { [QUICK]: 2, [SKIPS]: 3 }, maxSkipped: 2, onCounts: (_c, s) => { skipped = s; } });
  assert.equal(at.code, 0, at.out);
  assert.equal(skipped, 2, 'skip and todo both count');
});

test('S-1: the skip cap alone catches the review repro shape (72 tests, 72 skipped)', () => {
  // Defence in depth for a filter that gets past both guards, for example a
  // new node flag: the count rows match the manifest, but the skips do not.
  const a = resolve(gatewayDir, 'test/a.test.mjs');
  const records = `${JSON.stringify({ file: a, tests: 72, skipped: 72 })}\n${JSON.stringify({ file: resolve(gatewayDir, 'test/b.test.mjs'), tests: 2 })}\n`;
  const skips = fileSkipCounts(records);
  assert.deepEqual([...skips.values()], [72, 0]);
  const lines = skipCapLines(skips, 3, gatewayDir);
  assert.equal(lines.length, 1);
  assert.ok(/FAIL 72 tests were skipped, more than the 3/.test(lines[0]), lines[0]);
  assert.deepEqual(skipCapLines(fileSkipCounts(`${JSON.stringify({ file: a, tests: 5, skipped: 3 })}\n`), 3, gatewayDir), []);
});

test('S-1: main reads the skip cap from the manifest, and the manifest records one', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(/\(\{ files: expected, skipped: maxSkipped \} = readManifest\(\)\);/.test(runner), 'main takes maxSkipped from test-counts.json');
  const manifest = readManifest(join(gatewayDir, 'test/test-counts.json'));
  assert.ok(Number.isInteger(manifest.skipped) && manifest.skipped <= 10, `skipped cap ${manifest.skipped}`);
});

// M-1: gaps in the runner tests from the #653 review.

test('M-1 R16: an ordinary failing assertion fails the run', { timeout: 60_000 }, () => {
  const { code, out } = run([QUICK, FAILS], { expected: { [QUICK]: 2, [FAILS]: 2 }, maxSkipped: 0 });
  assert.equal(code, 1, out);
});

test('M-1 R2: a file exactly one test short fails', () => {
  const a = resolve(gatewayDir, 'test/a.test.mjs');
  const lines = countMismatches(new Map([[a, 2]]), ['test/a.test.mjs'], { 'test/a.test.mjs': 3 }, gatewayDir);
  assert.equal(lines.length, 1, 'one short is a mismatch');
  assert.ok(/FAIL test\/a\.test\.mjs reported 2 of 3 expected tests\. It stopped early or tests were removed\./.test(lines[0]), lines[0]);
  assert.deepEqual(countMismatches(new Map([[a, 3]]), ['test/a.test.mjs'], { 'test/a.test.mjs': 3 }, gatewayDir), []);
});

async function reporterRows(events) {
  async function* source() { for (const e of events) yield e; }
  const rows = [];
  for await (const chunk of fileDoneReporter(source())) rows.push(JSON.parse(chunk));
  return rows;
}

test('M-1 R10/R11: the reporter counts tests, not suites or the file-level event', async () => {
  const file = resolve(gatewayDir, 'test/x.test.mjs');
  const rows = await reporterRows([
    { type: 'test:pass', data: { name: 'leaf one', nesting: 1, file, details: { type: 'test' } } },
    { type: 'test:fail', data: { name: 'leaf two', nesting: 1, file, details: { type: 'test' } } },
    { type: 'test:pass', data: { name: 'skipped leaf', nesting: 1, file, skip: true, details: { type: 'test' } } },
    { type: 'test:pass', data: { name: 'todo leaf', nesting: 0, file, todo: true, details: { type: 'test' } } },
    { type: 'test:pass', data: { name: 'a suite', nesting: 0, file, details: { type: 'suite' } } },
    { type: 'test:complete', data: { name: file, nesting: 0, file, details: { passed: true } } },
    { type: 'test:pass', data: { name: file, nesting: 0, file, details: {} } },
  ]);
  assert.deepEqual(rows, [{ file, passed: true }, { file, tests: 4, skipped: 2 }]);
});

test('M-1 R23: --write-counts refuses a file that reported no tests and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'counts-'));
  try {
    const countsPath = join(dir, 'c.json');
    const errors = [];
    const files = ['test/a.test.mjs', 'test/b.test.mjs'];
    const empty = writeCounts(files, ['--write-counts'], {
      countsPath,
      error: (line) => errors.push(line),
      log: () => {},
      run: (_f, o) => { o.onCounts({ 'test/a.test.mjs': 2, 'test/b.test.mjs': 0 }, 0); return 0; },
    });
    assert.equal(empty, 1, errors.join('\n'));
    assert.ok(/no tests reported for test\/b\.test\.mjs/.test(errors.join('\n')), errors.join('\n'));
    assert.throws(() => readFileSync(countsPath), /ENOENT/);
    const ok = writeCounts(files, ['--write-counts'], {
      countsPath,
      error: (line) => errors.push(line),
      log: () => {},
      run: (_f, o) => { o.onCounts({ 'test/a.test.mjs': 2, 'test/b.test.mjs': 1 }, 1); return 0; },
    });
    assert.equal(ok, 0);
    assert.deepEqual(readManifest(countsPath), { files: { 'test/a.test.mjs': 2, 'test/b.test.mjs': 1 }, skipped: 1 });
    // A second write keeps the recorded cap (1) and hands it to the run, even
    // when this machine skipped none.
    let capSeen;
    const again = writeCounts(files, ['--write-counts'], {
      countsPath,
      error: (line) => errors.push(line),
      log: () => {},
      run: (_f, o) => { capSeen = o.maxSkipped; o.onCounts({ 'test/a.test.mjs': 2, 'test/b.test.mjs': 1 }, 0); return 0; },
    });
    assert.equal(again, 0);
    assert.equal(capSeen, 1, 'the recorded cap is applied to the run');
    assert.equal(readManifest(countsPath).skipped, 1, 'the recorded cap is kept');
    const filtered = writeCounts(files, ['--write-counts', '--test-only'], { countsPath: join(dir, 'd.json'), error: (line) => errors.push(line), log: () => {}, run: () => 0 });
    assert.equal(filtered, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-2: the whole-suite cap names the file that was running.

test('M-2: the whole-suite cap fails the run and names the file still running', { timeout: 60_000 }, () => {
  const { code, errors, out } = run([QUICK, SLOW], { timeoutMs: 60_000, suiteTimeoutMs: 4000, expected: { [QUICK]: 2, [SLOW]: 2 }, maxSkipped: 0 });
  assert.equal(code, 1, out);
  assert.ok(errors.some((line) => /test process killed \(SIGKILL\)/.test(line)), out);
  assert.ok(errors.some((line) => /FAIL the whole-suite cap of 4 s hit with 1 file unfinished: test\/fixtures\/run-tests\/slow\.fixture\.mjs\. Look at those first/.test(line)), out);
  assert.equal(errors.some((line) => /unfinished.*quick\.fixture/.test(line)), false, out);
});

test('M-2: the suite cap is about 2x the loaded runtime and the gateway CI job has a timeout above it', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(/export const SUITE_TIMEOUT_MS = 10 \* 60 \* 1000;/.test(runner), 'suite cap is 600 s');
  assert.ok(/timeout: suiteTimeoutMs,/.test(runner), 'spawnSync uses the suite cap');
  const yml = readFileSync(join(gatewayDir, '../../.github/workflows/test.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('\n  gateway:'), yml.indexOf('\n  cdp-spend-store:'));
  const m = /\n    timeout-minutes: (\d+)\n/.exec(job);
  assert.ok(m, 'gateway job sets timeout-minutes');
  assert.ok(Number(m[1]) > 10 && Number(m[1]) <= 25, `gateway job timeout-minutes ${m && m[1]}`);
  const step = /- name: Gateway tests[^\n]*\n(?:        [^\n]*\n)*?        timeout-minutes: (\d+)\n/.exec(job);
  assert.ok(step && Number(step[1]) > 10, 'the npm test step has a timeout above the 10 min suite cap');
});

// #652 survivors: behaviour, not source text.

test('#652 M13b: a cancelled subtest fails the run and names the file and the test', { timeout: 60_000 }, () => {
  const { code, errors, out } = run([QUICK, CANCELLED], { expected: { [QUICK]: 2, [CANCELLED]: 2 }, maxSkipped: 0 });
  assert.equal(code, 1, out);
  const abs = resolve(gatewayDir, CANCELLED);
  assert.ok(errors.some((line) => line.includes(abs) && /had a cancelled test \(cancelledByParent\), test: cancelled orphan subtest\./.test(line)), out);
  assert.equal(errors.some((line) => line.includes(resolve(gatewayDir, QUICK))), false, out);
});

test('#652 M16: a timeout on a nested test only is reported from its nested row, by name', { timeout: 60_000 }, () => {
  const { code, errors, out } = run([QUICK, NESTED_TIMEOUT], { expected: { [QUICK]: 2, [NESTED_TIMEOUT]: 2 }, maxSkipped: 0 });
  assert.equal(code, 1, out);
  const abs = resolve(gatewayDir, NESTED_TIMEOUT);
  assert.ok(errors.some((line) => line.includes(abs) && /hit the per-file time limit \(testTimeoutFailure\), test: nested timeout inner\./.test(line)), out);
});

// S-B (pr654 review): the guard reads options the way node does.

test('S-B: argv spellings node accepts are refused: _ for -, quotes, =value, force-exit, isolation none', { timeout: 60_000 }, () => {
  for (const nodeArgs of [
    ['--test_only'],
    ['--test_name_pattern=x'],
    ['"--test-only"'],
    ["'--test-name-pattern=x'"],
    ['--test-name-pattern="x"'],
    ['--test-force-exit'],
    ['--test_force_exit'],
    ['--test-isolation=none'],
    ['--test-isolation', 'none'],
    ['--test_isolation="none"'],
    ['--experimental-test-isolation=none'],
  ]) {
    const { code, errors, out } = run([QUICK], { nodeArgs, expected: { [QUICK]: 2 }, maxSkipped: 0 });
    assert.equal(code, 1, `${nodeArgs.join(' ')}: ${out}`);
    assert.equal(errors.length, 1, out);
    assert.ok(/^run-tests: refusing test option /.test(errors[0]), errors[0]);
  }
  // Isolation `process` is the default and stays allowed, in both forms.
  for (const nodeArgs of [['--test-isolation=process'], ['--test-isolation', 'process']]) {
    assert.deepEqual(testFilterArgs(nodeArgs), [], nodeArgs.join(' '));
  }
  assert.deepEqual(normaliseOption('"--test_name_pattern=\'x\'"'), { name: '--test-name-pattern', value: 'x' });
  assert.deepEqual(normaliseOption('--test_only'), { name: '--test-only', value: null });
});

test('S-B: NODE_OPTIONS spellings are stripped: --test_only, "--test-only", quoted values, force-exit, isolation none', { timeout: 60_000 }, () => {
  for (const nodeOptions of ['--test_only', '"--test-only"', '--test_only --max-old-space-size=4096']) {
    const env = { ...childEnv(), NODE_OPTIONS: nodeOptions };
    let skipped;
    const { code, errors, out } = run([QUICK], { env, expected: { [QUICK]: 2 }, maxSkipped: 0, onCounts: (_c, n) => { skipped = n; } });
    assert.equal(code, 0, `${nodeOptions}: ${out}`);
    assert.equal(skipped, 0, `${nodeOptions}: nothing skipped`);
    assert.equal(errors.length, 1, out);
    assert.ok(/^run-tests: removed --test[-_]only from NODE_OPTIONS/.test(errors[0]), errors[0]);
  }
  assert.deepEqual(stripTestFilters('--test_only --max-old-space-size=4096'), { value: '--max-old-space-size=4096', removed: ['--test_only'] });
  assert.deepEqual(stripTestFilters('"--test-name-pattern=a b" --inspect=0'), { value: '--inspect=0', removed: ['--test-name-pattern=a b'] });
  assert.deepEqual(stripTestFilters('--test-force-exit --test-isolation=none --experimental-test-isolation none'), { value: '', removed: ['--test-force-exit', '--test-isolation=none', '--experimental-test-isolation', 'none'] });
  assert.deepEqual(stripTestFilters('--test-isolation=process "--title=a b"'), { value: '--test-isolation=process "--title=a b"', removed: [] });
  assert.deepEqual(nodeOptionsTokens('"a\\"b" c'), [{ raw: '"a\\"b"', text: 'a"b' }, { raw: 'c', text: 'c' }]);
});

test('N-a: a value-less filter followed by an option strips only the filter', () => {
  assert.deepEqual(stripTestFilters('--test-name-pattern --inspect=0'), { value: '--inspect=0', removed: ['--test-name-pattern'] });
  assert.deepEqual(stripTestFilters('--test-shard --max-old-space-size=64'), { value: '--max-old-space-size=64', removed: ['--test-shard'] });
  assert.deepEqual(testFilterArgs(['--test-isolation', '--trace-warnings']), ['--test-isolation'], 'isolation with no value is refused, and the next option is not taken as its value');
});

// S-A (pr654 review): CI runs with a skip cap of 0.

test('S-A: RUN_TESTS_MAX_SKIPPED may lower the skip cap, never raise it', () => {
  assert.deepEqual(resolveSkipCap(3, {}), { cap: 3, source: 'test/test-counts.json' });
  assert.deepEqual(resolveSkipCap(3, { RUN_TESTS_MAX_SKIPPED: '0' }), { cap: 0, source: 'RUN_TESTS_MAX_SKIPPED' });
  assert.deepEqual(resolveSkipCap(3, { RUN_TESTS_MAX_SKIPPED: '3' }), { cap: 3, source: 'RUN_TESTS_MAX_SKIPPED' });
  for (const raw of ['4', '99', '', ' 0', '-1', '0.5', 'zero', '1e1']) {
    const got = resolveSkipCap(3, { RUN_TESTS_MAX_SKIPPED: raw });
    assert.ok('error' in got && /Refusing to run/.test(got.error), `${JSON.stringify(raw)}: ${JSON.stringify(got)}`);
  }
  assert.ok(/may only lower the cap/.test(resolveSkipCap(3, { RUN_TESTS_MAX_SKIPPED: '4' }).error));
});

test('S-A: a skip in a run capped at 0 fails and names RUN_TESTS_MAX_SKIPPED', { timeout: 60_000 }, () => {
  const { code, errors, out } = run([QUICK, SKIPS], { expected: { [QUICK]: 2, [SKIPS]: 3 }, maxSkipped: 0, skipCapSource: 'RUN_TESTS_MAX_SKIPPED' });
  assert.equal(code, 1, out);
  assert.ok(errors.some((line) => /FAIL 2 tests were skipped, more than the 0 RUN_TESTS_MAX_SKIPPED allows/.test(line)), out);
});

test('S-A: the runner refuses an override above the manifest before running anything', { timeout: 60_000 }, () => {
  const env = { ...childEnv(), RUN_TESTS_MAX_SKIPPED: '9' };
  // --test-only is refused later, in runTestFiles, so even if the cap check
  // were missing this child would stop before running the suite.
  const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--test-only'], { cwd: gatewayDir, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(/RUN_TESTS_MAX_SKIPPED=9 is above the \d+ skipped tests test\/test-counts\.json allows/.test(r.stderr), r.stderr);
  assert.ok(!/^TAP version/m.test(r.stdout), 'no test ran');
});

test('S-A: main applies the resolved cap, and the gateway CI step sets it to 0', () => {
  const runner = readFileSync(join(gatewayDir, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(/const skipCap = resolveSkipCap\(maxSkipped\);/.test(runner), 'main resolves the cap');
  assert.ok(/maxSkipped: skipCap\.cap, skipCapSource: skipCap\.source/.test(runner), 'main runs with the resolved cap');
  const yml = readFileSync(join(gatewayDir, '../../.github/workflows/test.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('\n  gateway:'), yml.indexOf('\n  cdp-spend-store:'));
  const step = job.slice(job.indexOf('- name: Gateway tests'));
  const stepBody = step.slice(0, step.indexOf('run: npm test'));
  assert.ok(/\n        env:\n          RUN_TESTS_MAX_SKIPPED: '0'\n/.test(stepBody), 'the npm test step sets RUN_TESTS_MAX_SKIPPED to 0');
});
