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
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');

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
 * Run the given files the way CI does and return the exit code. Errors are
 * written with `error`. Options exist for the runner test.
 * @param {string[]} files paths relative to cwd
 * @param {{ cwd?: string, timeoutMs?: number, stdio?: any, env?: NodeJS.ProcessEnv, nodeArgs?: string[], error?: (line: string) => void }} [opts]
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
  // Files run one at a time. `--test-force-exit` is required because some files
  // leave the event loop busy, but combined with the default parallel scheduler
  // it can end the process before a file has run its remaining tests and still
  // exit 0. That under-counted receipt.test.mjs by a different amount on each
  // run (main reported 1144/1145; one merged run reported 1132). Serial
  // execution keeps the summary equal to every test() in the tree.
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
      '--test-force-exit',
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
  process.exitCode = runTestFiles(files, { nodeArgs: process.argv.slice(2) });
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
