/**
 * Runs every `test/*.test.mjs`.
 *
 * The list used to be spelled out by hand in `npm test`, and a file that was
 * never added to it simply never ran: `provider-health` and `edgecloud-extract`
 * both sat green and unexecuted, the latter for long enough that nobody
 * remembered writing it. Discovery removes the failure mode rather than
 * documenting it.
 *
 * `node --test "test/*.test.mjs"` does the same in one line, but glob patterns
 * need Node 21+ and `engines` allows 20 (CI pins 20), where the pattern is
 * treated as a literal filename. Reading the directory works on every version
 * and in every shell.
 *
 * Expected test counts. test/test-counts.json holds the number of tests each
 * file reports. A run fails when a file reports a different number, when a
 * file is not in the manifest, or when the manifest names a file that is gone.
 * Fewer tests than expected is how a cut-short file shows up: it can exit 0 and
 * still have skipped the rest of its tests, which the pass/fail totals cannot
 * show. After adding or removing tests, regenerate and commit the manifest:
 *
 *   npm run test:counts        (node scripts/run-tests.mjs --write-counts)
 *
 * --write-counts runs the full suite and writes the file only when every file
 * finished, nothing timed out or was cancelled, and nothing failed. It takes no
 * other arguments, so a filtered run cannot write a lowered count.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNTS_PATH = join(gatewayDir, 'test', 'test-counts.json');
const REGENERATE = 'If the change is intended, run `npm run test:counts` in services/gateway and commit test/test-counts.json.';

/**
 * Files that never produced a completion record. `records` is JSON lines from
 * file-done-reporter. A blank line is skipped. A partial last line does not
 * throw. TAP text is not consulted: a passing file has no `ok N - <file>` line.
 * @param {string} records
 * @param {string[]} files absolute paths, the same paths the reporter writes
 * @returns {string[]}
 */
export function filesWithoutCompletion(records, files) {
  const done = new Set();
  const lines = String(records || '').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      // A completion row has `passed`. A row with only a problem is not one.
      if (row && row.file && 'passed' in row) done.add(row.file);
    } catch {
      // A partial last line, or any line that is not JSON, is not a completion.
    }
  }
  return files.filter((file) => !done.has(file));
}

/**
 * Files whose output had a testTimeoutFailure or a cancelled test, from the
 * problem rows file-done-reporter writes. One entry per file, problem and test.
 * @param {string} records
 * @returns {{ file: string, problem: string, test: string }[]}
 */
export function fileProblems(records) {
  const seen = new Map();
  for (const line of String(records || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || !row.file || !row.problem) continue;
    const key = `${row.file}\u0000${row.problem}\u0000${row.test || ''}`;
    if (!seen.has(key)) seen.set(key, { file: row.file, problem: row.problem, test: String(row.test || '') });
  }
  return [...seen.values()];
}

/**
 * The lines run-tests prints for problem rows. Exported for the runner test.
 * @param {{ file: string, problem: string, test: string }[]} problems
 */
export function problemMessages(problems) {
  return problems.map(({ file, problem, test }) => {
    const what = problem === 'testTimeoutFailure' ? 'hit the per-file time limit (testTimeoutFailure)' : 'had a cancelled test (cancelledByParent)';
    const which = test && test !== file ? `, test: ${test}` : '';
    return `run-tests: FAIL ${file} ${what}${which}. Its tests are missing from the totals.`;
  });
}

/**
 * Tests reported per file, from the count rows file-done-reporter writes when
 * its stream ends. Keys are the absolute paths the reporter writes.
 * @param {string} records
 * @returns {Map<string, number>}
 */
export function fileTestCounts(records) {
  const counts = new Map();
  for (const line of String(records || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row && row.file && Number.isInteger(row.tests) && !('passed' in row)) counts.set(row.file, row.tests);
  }
  return counts;
}

/**
 * Lines for every file whose reported count differs from the manifest. A file
 * with no count row counts as zero. Files are paths relative to cwd, which are
 * also the manifest keys (test/<name>.test.mjs).
 * @param {Map<string, number>} counts from fileTestCounts
 * @param {string[]} files paths relative to cwd
 * @param {Record<string, number>} expected manifest `files` object
 * @param {string} cwd
 * @returns {string[]}
 */
export function countMismatches(counts, files, expected, cwd) {
  const lines = [];
  for (const file of files) {
    const got = counts.get(resolve(cwd, file)) || 0;
    if (!Object.prototype.hasOwnProperty.call(expected, file)) {
      lines.push(`run-tests: FAIL ${file} is not in test/test-counts.json (it reported ${got} tests). ${REGENERATE}`);
      continue;
    }
    const want = expected[file];
    if (got < want) {
      lines.push(`run-tests: FAIL ${file} reported ${got} of ${want} expected tests. It stopped early or tests were removed. ${REGENERATE}`);
    } else if (got > want) {
      lines.push(`run-tests: FAIL ${file} reported ${got} tests but test/test-counts.json expects ${want}. ${REGENERATE}`);
    }
  }
  return lines;
}

/**
 * Manifest entries with no file on disk.
 * @param {Record<string, number>} expected
 * @param {string[]} files
 */
export function staleManifestEntries(expected, files) {
  const present = new Set(files);
  return Object.keys(expected).filter((file) => !present.has(file))
    .map((file) => `run-tests: FAIL test/test-counts.json lists ${file}, which does not exist. ${REGENERATE}`);
}

/**
 * Reads and checks test/test-counts.json. Throws on a malformed file.
 * @param {string} [path]
 * @returns {Record<string, number>}
 */
export function readCountManifest(path = COUNTS_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const files = parsed && parsed.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('test-counts.json has no files object');
  for (const [file, n] of Object.entries(files)) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`test-counts.json: ${file} has count ${JSON.stringify(n)}`);
  }
  const sum = Object.values(files).reduce((a, b) => a + b, 0);
  if (parsed.total !== sum) throw new Error(`test-counts.json: total ${JSON.stringify(parsed.total)} is not the sum of its files (${sum})`);
  return files;
}

/**
 * Run the given files the way CI does and return the exit code. Errors are
 * written with `error`. Options exist for the runner test.
 * @param {string[]} files paths relative to cwd
 * When `expected` is given, every file's reported count must equal it. When
 * `onCounts` is given, it receives the per-file counts (relative paths).
 * @param {{ cwd?: string, timeoutMs?: number, stdio?: any, env?: NodeJS.ProcessEnv, nodeArgs?: string[], error?: (line: string) => void, expected?: Record<string, number>, onCounts?: (counts: Record<string, number>) => void }} [opts]
 */
export function runTestFiles(files, opts = {}) {
  const cwd = opts.cwd || gatewayDir;
  const timeoutMs = opts.timeoutMs || 120000;
  const error = opts.error || ((line) => console.error(line));
  const baseEnv = opts.env || process.env;


  // Node options have to precede the file list. A per-test timeout so one hung
  // file cannot pin CI the way a missing filename used to skip it; spawnSync
  // also gets a hard cap so a stuck worker is killed rather than left running.
  //
  // Files run one at a time. The parallel scheduler under-counted
  // receipt.test.mjs by a different amount on each run.
  //
  // No `--test-force-exit`. It was added because some files left the event
  // loop busy, but under load it also cut the tail of a file's event stream:
  // the file still wrote its completion row and the run exited 0 with tests
  // missing (3 of 15 loaded runs in an A/B, 0 of 15 without it). Every file
  // now exits on its own. A file that leaves a server, socket, timer or child
  // open never exits, hits the per-file limit, and fails the run by name as a
  // testTimeoutFailure. Close handles in after() or t.after().
  //
  // Completion is a second reporter, not a TAP line. Node 20 and 22 do not
  // print `ok N - test/<file>` for a passing file. TAP streams to stdout.
  // An unset NODE_ENV means 'development', which starts pino-pretty in a
  // worker thread whose MessagePort can keep a finished file alive.
  const dir = mkdtempSync(join(tmpdir(), 'run-tests-'));
  const recordFile = join(dir, 'files.jsonl');
  const reporter = join(gatewayDir, 'scripts', 'file-done-reporter.mjs');
  const { status, error: spawnError, signal } = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      `--test-timeout=${timeoutMs}`,
      '--test-reporter=tap',
      '--test-reporter-destination=stdout',
      `--test-reporter=${reporter}`,
      `--test-reporter-destination=${recordFile}`,
      ...(opts.nodeArgs || []),
      ...files,
    ],
    {
      stdio: opts.stdio || 'inherit',
      cwd,
      timeout: 10 * 60 * 1000,
      killSignal: 'SIGKILL',
      env: {
        ...baseEnv,
        NODE_ENV: baseEnv.NODE_ENV || 'test',
        // Ephemeral key resets in this process may drop an in-memory history
        // chain. Production never reads this flag.
        ISSUER_HISTORY_TEST_ROTATION: baseEnv.ISSUER_HISTORY_TEST_ROTATION || 'true',
        // Test files load throwaway issuer keys. A set ISSUER_PRIVATE_KEY counts
        // as production unless this opt-out is set, and the opt-out never
        // covers the production kid (src/production-process.js).
        ISSUER_TEST_KEY: baseEnv.ISSUER_TEST_KEY || '1',
      },
    },
  );

  let records = '';
  try {
    records = readFileSync(recordFile, 'utf8');
  } catch {
    records = '';
  }
  rmSync(dir, { recursive: true, force: true });

  if (spawnError) {
    error(`run-tests: ${spawnError.message}`);
    return 1;
  }
  if (signal) {
    error(`run-tests: test process killed (${signal})`);
    return 1;
  }
  const missing = filesWithoutCompletion(records, files.map((file) => resolve(cwd, file)));
  if (missing.length > 0) {
    error(`run-tests: these files did not finish: ${missing.join(', ')}`);
    return 1;
  }
  const problems = fileProblems(records);
  if (problems.length > 0) {
    for (const line of problemMessages(problems)) error(line);
    return 1;
  }
  const counts = fileTestCounts(records);
  if (opts.expected) {
    const mismatches = countMismatches(counts, files, opts.expected, cwd);
    if (mismatches.length > 0) {
      for (const line of mismatches) error(line);
      return 1;
    }
  }
  if (opts.onCounts) {
    const byFile = {};
    for (const file of files) byFile[file] = counts.get(resolve(cwd, file)) || 0;
    opts.onCounts(byFile);
  }
  return status ?? 1;
}

function main() {
  const files = readdirSync(join(gatewayDir, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `test/${name}`);

  // A green run over zero files is the one outcome worse than a red one.
  if (files.length === 0) {
    console.error('run-tests: no test/*.test.mjs files found. Refusing to report success.');
    process.exitCode = 1;
    return;
  }
  const args = process.argv.slice(2);
  if (args.includes('--write-counts')) {
    process.exitCode = writeCounts(files, args);
    return;
  }

  let expected;
  try {
    expected = readCountManifest();
  } catch (err) {
    console.error(`run-tests: cannot read test/test-counts.json (${err.message}). ${REGENERATE}`);
    process.exitCode = 1;
    return;
  }
  const stale = staleManifestEntries(expected, files);
  if (stale.length > 0) {
    for (const line of stale) console.error(line);
    process.exitCode = 1;
    return;
  }
  process.exitCode = runTestFiles(files, { nodeArgs: args, expected });
}

function writeCounts(files, args) {
  if (args.length !== 1) {
    console.error('run-tests: --write-counts takes no other arguments, so a filtered run cannot write lower counts.');
    return 1;
  }
  let counts;
  const code = runTestFiles(files, { onCounts: (byFile) => { counts = byFile; } });
  if (code !== 0 || !counts) {
    console.error('run-tests: the run did not pass cleanly. test/test-counts.json was not written.');
    return 1;
  }
  const empty = files.filter((file) => !(counts[file] > 0));
  if (empty.length > 0) {
    console.error(`run-tests: no tests reported for ${empty.join(', ')}. test/test-counts.json was not written.`);
    return 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const body = {
    about: 'Tests each gateway test file reports. run-tests.mjs fails on any difference. Regenerate with npm run test:counts after a clean run.',
    total,
    files: counts,
  };
  writeFileSync(COUNTS_PATH, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`run-tests: wrote ${relative(gatewayDir, COUNTS_PATH)} (${files.length} files, ${total} tests).`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
