/**
 * Gateway CI hook for the v13 line codec. Discovery picks this file up with
 * the rest of test/*.test.mjs, so no workflow edit is required. The child
 * process runs the full line suite.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('cs2 line suite (gateway CI hook)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    'packages/cs2-core/line/line.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  assert.match(out, /# pass 16/);
  assert.match(out, /# fail 0/);
});
