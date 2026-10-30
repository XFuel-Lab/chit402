/**
 * Gateway CI hook for the v13 state SMT. Discovery picks this file up with
 * the rest of test/*.test.mjs, so no workflow edit is required. The child
 * process runs the full SMT suite.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('cs2 smt suite (gateway CI hook)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    'packages/cs2-core/smt/smt.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  const passed = out.match(/^# pass (\d+)$/m);
  const failed = out.match(/^# fail (\d+)$/m);
  const tests = out.match(/^# tests (\d+)$/m);
  assert.ok(passed, out.slice(-2000));
  assert.equal(passed[1], '17');
  assert.equal(failed && failed[1], '0');
  assert.equal(tests && tests[1], '17');
});
