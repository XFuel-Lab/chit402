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
 *
 * Test filters. A skipped test still emits test:pass, so a filtered run keeps
 * every count row equal to the manifest and exits 0 with nothing executed
 * (`--test-name-pattern='^none$'` gave "pass 0, skipped 72"). Two guards:
 *   - The runner refuses --test-name-pattern, --test-skip-pattern, --test-only
 *     and --test-shard in its arguments, and strips them from NODE_OPTIONS
 *     before spawning node.
 *   - test-counts.json records `skipped`, the most skipped and todo tests a
 *     run may have. A run that skips more fails. Some skips depend on the
 *     machine (a root user can read a mode-000 file, anvil may be missing), so
 *     the number is the worst legitimate case, not one run's count:
 *     --write-counts keeps the recorded number and fails a run over it.
 *     Raising it is a hand edit, visible in the diff.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Hard cap on the whole node --test process. The loaded full suite takes about
 * 300 s, so this is about 2x. The gateway job's timeout-minutes in
 * .github/workflows/test.yml sits above it, so this cap fires first and names
 * the file that was running.
 */
export const SUITE_TIMEOUT_MS = 10 * 60 * 1000;

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNTS_PATH = join(gatewayDir, 'test', 'test-counts.json');
/** node --test options that run fewer tests than the full suite. */
export const TEST_FILTER_FLAGS = ['--test-name-pattern', '--test-skip-pattern', '--test-only', '--test-shard'];

function isTestFilter(arg) {
  return TEST_FILTER_FLAGS.some((flag) => arg === flag || String(arg).startsWith(`${flag}=`));
}

/**
 * Test filter options in an argument list, as given (`--test-only`,
 * `--test-name-pattern=x`, or `--test-name-pattern` followed by its value).
 * @param {string[]} args
 * @returns {string[]}
 */
export function testFilterArgs(args) {
  return (args || []).filter(isTestFilter);
}

/**
 * NODE_OPTIONS with every test filter removed, including the value of a
 * space-separated `--test-name-pattern x`. Returns the cleaned string and what
 * was removed. NODE_OPTIONS is split on whitespace, the way node splits it for
 * unquoted values.
 * @param {string | undefined} value
 * @returns {{ value: string, removed: string[] }}
 */
export function stripTestFilters(value) {
  const parts = String(value || '').split(/\s+/).filter(Boolean);
  const kept = [];
  const removed = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!isTestFilter(part)) {
      kept.push(part);
      continue;
    }
    removed.push(part);
    const takesValue = part !== '--test-only' && !part.includes('=');
    if (takesValue && i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
      i += 1;
      removed.push(parts[i]);
    }
  }
  return { value: kept.join(' '), removed };
}

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
 * Skipped and todo tests per file, from the same count rows. A count row with
 * no `skipped` field counts as zero skipped.
 * @param {string} records
 * @returns {Map<string, number>}
 */
export function fileSkipCounts(records) {
  const skips = new Map();
  for (const line of String(records || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row && row.file && Number.isInteger(row.tests) && !('passed' in row)) skips.set(row.file, Number.isInteger(row.skipped) ? row.skipped : 0);
  }
  return skips;
}

/**
 * Lines for a run that skipped more tests than the manifest allows.
 * @param {Map<string, number>} skips from fileSkipCounts
 * @param {number} maxSkipped manifest `skipped`
 * @param {string} cwd
 * @returns {string[]}
 */
export function skipCapLines(skips, maxSkipped, cwd) {
  const total = [...skips.values()].reduce((a, b) => a + b, 0);
  if (total <= maxSkipped) return [];
  const worst = [...skips].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([file, n]) => `${relative(cwd, file)} (${n})`).join(', ');
  return [`run-tests: FAIL ${total} tests were skipped, more than the ${maxSkipped} test/test-counts.json allows. A test filter (--test-name-pattern, --test-only) or a new skip can make a run green with tests not executed. Most skipped: ${worst}. If a new skip is intended, raise \`skipped\` in test/test-counts.json by hand and say why in the PR; npm run test:counts keeps the recorded number.`];
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
    if (!counts.has(resolve(cwd, file))) {
      lines.push(`run-tests: FAIL ${file} reported no test count, so 0 of ${want} expected tests are confirmed. The file exited before any test finished, or the reporter's stream was cut before it wrote its count rows (for example under --test-force-exit). ${REGENERATE}`);
    } else if (got < want) {
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
  return readManifest(path).files;
}

/**
 * Reads and checks test/test-counts.json, including `skipped`, the most
 * skipped and todo tests a run may have. Throws on a malformed file.
 * @param {string} [path]
 * @returns {{ files: Record<string, number>, skipped: number }}
 */
export function readManifest(path = COUNTS_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const files = parsed && parsed.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('test-counts.json has no files object');
  for (const [file, n] of Object.entries(files)) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`test-counts.json: ${file} has count ${JSON.stringify(n)}`);
  }
  const sum = Object.values(files).reduce((a, b) => a + b, 0);
  if (parsed.total !== sum) throw new Error(`test-counts.json: total ${JSON.stringify(parsed.total)} is not the sum of its files (${sum})`);
  if (!Number.isInteger(parsed.skipped) || parsed.skipped < 0) throw new Error(`test-counts.json: skipped ${JSON.stringify(parsed.skipped)} is not a whole number`);
  return { files, skipped: parsed.skipped };
}

/**
 * Run the given files the way CI does and return the exit code. Errors are
 * written with `error`. Options exist for the runner test.
 * @param {string[]} files paths relative to cwd
 * When `expected` is given, every file's reported count must equal it. When
 * `onCounts` is given, it receives the per-file counts (relative paths) and
 * the total skipped. When `maxSkipped` is given, a run that skips more fails.
 * `suiteTimeoutMs` is the hard cap on the whole node --test process.
 * @param {{ cwd?: string, timeoutMs?: number, suiteTimeoutMs?: number, stdio?: any, env?: NodeJS.ProcessEnv, nodeArgs?: string[], error?: (line: string) => void, expected?: Record<string, number>, maxSkipped?: number, onCounts?: (counts: Record<string, number>, skipped: number) => void }} [opts]
 */
export function runTestFiles(files, opts = {}) {
  const cwd = opts.cwd || gatewayDir;
  const timeoutMs = opts.timeoutMs || 120000;
  const error = opts.error || ((line) => console.error(line));
  const baseEnv = opts.env || process.env;
  const suiteTimeoutMs = opts.suiteTimeoutMs || SUITE_TIMEOUT_MS;

  const filters = testFilterArgs(opts.nodeArgs);
  if (filters.length > 0) {
    error(`run-tests: refusing test filter ${filters.join(' ')}. A filtered run reports skipped tests as passing and can exit 0 with nothing executed. Run node --test on the file directly to debug.`);
    return 1;
  }
  const nodeOptions = stripTestFilters(baseEnv.NODE_OPTIONS);
  if (nodeOptions.removed.length > 0) {
    error(`run-tests: removed ${nodeOptions.removed.join(' ')} from NODE_OPTIONS for the test run. Test filters are not allowed.`);
  }

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
      timeout: suiteTimeoutMs,
      killSignal: 'SIGKILL',
      env: {
        ...baseEnv,
        NODE_OPTIONS: nodeOptions.value,
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

  // spawnSync reports the suite cap as an ETIMEDOUT error with signal SIGKILL.
  const capHit = (spawnError && spawnError.code === 'ETIMEDOUT') || signal === 'SIGKILL';
  if (spawnError && !capHit) {
    error(`run-tests: ${spawnError.message}`);
    return 1;
  }
  if (signal || capHit) {
    error(`run-tests: test process killed (${signal || 'SIGKILL'})`);
    const unfinished = filesWithoutCompletion(records, files.map((file) => resolve(cwd, file)));
    if (capHit && unfinished.length > 0) {
      // The files without a completion row were running or had not started
      // when the cap hit. Name them, so the red run points somewhere.
      const shown = unfinished.slice(0, 5).map((file) => relative(cwd, file)).join(', ');
      const more = unfinished.length > 5 ? ` and ${unfinished.length - 5} more` : '';
      error(`run-tests: FAIL the whole-suite cap of ${Math.round(suiteTimeoutMs / 1000)} s hit with ${unfinished.length} file${unfinished.length === 1 ? '' : 's'} unfinished: ${shown}${more}. Look at those first; if the suite has simply grown, raise SUITE_TIMEOUT_MS in scripts/run-tests.mjs and timeout-minutes in .github/workflows/test.yml together.`);
    }
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
  const skips = fileSkipCounts(records);
  if (opts.maxSkipped !== undefined) {
    const over = skipCapLines(skips, opts.maxSkipped, cwd);
    if (over.length > 0) {
      for (const line of over) error(line);
      return 1;
    }
  }
  if (opts.onCounts) {
    const byFile = {};
    for (const file of files) byFile[file] = counts.get(resolve(cwd, file)) || 0;
    opts.onCounts(byFile, [...skips.values()].reduce((a, b) => a + b, 0));
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
  let maxSkipped;
  try {
    ({ files: expected, skipped: maxSkipped } = readManifest());
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
  process.exitCode = runTestFiles(files, { nodeArgs: args, expected, maxSkipped });
}

/**
 * --write-counts. Exported for the runner test, which passes `run` and
 * `countsPath` so it never runs the suite or writes the real manifest.
 * @param {string[]} files
 * @param {string[]} args
 * @param {{ run?: typeof runTestFiles, countsPath?: string, error?: (line: string) => void, log?: (line: string) => void }} [opts]
 */
export function writeCounts(files, args, opts = {}) {
  const run = opts.run || runTestFiles;
  const countsPath = opts.countsPath || COUNTS_PATH;
  const error = opts.error || ((line) => console.error(line));
  const log = opts.log || ((line) => console.log(line));
  if (args.length !== 1) {
    error('run-tests: --write-counts takes no other arguments, so a filtered run cannot write lower counts.');
    return 1;
  }
  // Keep the recorded skip cap. A machine that skips fewer must not lower it
  // for the machines that skip more, and a run over it does not write.
  let recordedSkipped;
  try {
    recordedSkipped = readManifest(countsPath).skipped;
  } catch {
    recordedSkipped = undefined;
  }
  let counts;
  let skipped = 0;
  const code = run(files, { maxSkipped: recordedSkipped, onCounts: (byFile, skips) => { counts = byFile; skipped = skips || 0; } });
  if (code !== 0 || !counts) {
    error('run-tests: the run did not pass cleanly. test/test-counts.json was not written.');
    return 1;
  }
  const empty = files.filter((file) => !(counts[file] > 0));
  if (empty.length > 0) {
    error(`run-tests: no tests reported for ${empty.join(', ')}. test/test-counts.json was not written.`);
    return 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (recordedSkipped !== undefined) skipped = recordedSkipped;
  const body = {
    about: 'Tests each gateway test file reports. run-tests.mjs fails on any difference, and on more skipped or todo tests than `skipped`. Regenerate with npm run test:counts after a clean run.',
    total,
    skipped,
    files: counts,
  };
  writeFileSync(countsPath, `${JSON.stringify(body, null, 2)}\n`);
  log(`run-tests: wrote ${relative(gatewayDir, countsPath)} (${files.length} files, ${total} tests, ${skipped} skipped).`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
