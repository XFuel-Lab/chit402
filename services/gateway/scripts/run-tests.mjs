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
const files = readdirSync(join(gatewayDir, 'test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `test/${name}`);

// A green run over zero files is the one outcome worse than a red one.
if (files.length === 0) {
  console.error('run-tests: no test/*.test.mjs files found — refusing to report success.');
  process.exit(1);
}

// Node options have to precede the file list.
const { status } = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...files],
  { stdio: 'inherit', cwd: gatewayDir },
);

process.exit(status ?? 1);
