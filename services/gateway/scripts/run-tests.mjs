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

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * TAP file lines that mean a file finished. A truncated run can exit 0
 * without one of these, so a missing line is a failure even when the
 * process status is 0. Indented subtest lines do not count.
 * @param {string} output
 * @param {string[]} files paths as passed to node --test, e.g. test/a.test.mjs
 * @returns {string[]}
 */
export function filesMissingTapSummary(output, files) {
  const text = String(output || '');
  const missing = [];
  for (const file of files) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(?:ok|not ok) \\d+ - ${escaped}(?:\\s|$)`, 'm');
    if (!re.test(text)) missing.push(file);
  }
  return missing;
}

function main() {
  const files = readdirSync(join(gatewayDir, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `test/${name}`);

  // A green run over zero files is the one outcome worse than a red one.
  if (files.length === 0) {
    console.error('run-tests: no test/*.test.mjs files found — refusing to report success.');
    process.exit(1);
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
  // stdout is captured so a file that ends without its `ok N - test/<file>`
  // line fails the run. The TAP is still written through to this process.
  const { status, error, signal, stdout, stderr } = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-timeout=120000', '--test-force-exit', ...process.argv.slice(2), ...files],
    {
      cwd: gatewayDir,
      timeout: 10 * 60 * 1000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (error) {
    console.error(`run-tests: ${error.message}`);
    process.exit(1);
  }
  if (signal) {
    console.error(`run-tests: test process killed (${signal})`);
    process.exit(1);
  }
  const missing = filesMissingTapSummary(stdout, files);
  if (missing.length > 0) {
    console.error(`run-tests: ended without a file summary: ${missing.join(', ')}`);
    process.exit(1);
  }
  process.exit(status ?? 1);
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
