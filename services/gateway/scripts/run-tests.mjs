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
      if (row && row.file) done.add(row.file);
    } catch {
      // A partial last line, or any line that is not JSON, is not a completion.
    }
  }
  return files.filter((file) => !done.has(file));
}

function main() {
  const files = readdirSync(join(gatewayDir, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `test/${name}`);

  // A green run over zero files is the one outcome worse than a red one.
  if (files.length === 0) {
    console.error('run-tests: no test/*.test.mjs files found — refusing to report success.');
    process.exitCode = 1;
    return;
  }

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
  const { status, error, signal } = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      '--test-timeout=120000',
      '--test-force-exit',
      '--test-reporter=tap',
      '--test-reporter-destination=stdout',
      `--test-reporter=${reporter}`,
      `--test-reporter-destination=${recordFile}`,
      ...process.argv.slice(2),
      ...files,
    ],
    {
      stdio: 'inherit',
      cwd: gatewayDir,
      timeout: 10 * 60 * 1000,
      killSignal: 'SIGKILL',
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
    },
  );

  let records = '';
  try {
    records = readFileSync(recordFile, 'utf8');
  } catch {
    records = '';
  }
  rmSync(dir, { recursive: true, force: true });

  if (error) {
    console.error(`run-tests: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (signal) {
    console.error(`run-tests: test process killed (${signal})`);
    process.exitCode = 1;
    return;
  }
  const missing = filesWithoutCompletion(records, files.map((file) => resolve(gatewayDir, file)));
  if (missing.length > 0) {
    console.error(`run-tests: these files did not finish: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = status ?? 1;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
