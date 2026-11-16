/**
 * Gateway CI hook for the P0-9 fast suite. Discovery picks this file up
 * with the rest of test/*.test.mjs, so no workflow edit is required.
 * The child process does not start a chain.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('p0-9 fast suite (gateway CI hook)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    'e2e/chit-simple/test/fast.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  assert.match(out, /^(?:# |ℹ )pass 12$/m);
});
