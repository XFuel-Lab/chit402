/**
 * Gateway CI hook for the v13 seller sigma signer. Discovery picks this file
 * up with the rest of test/*.test.mjs, so no workflow edit is required.
 * The child process runs the seller suite and the TAP counts are pinned.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('cs2 seller sigma suite (gateway CI hook)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    'packages/chit-seller/seller.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  const tests = out.match(/^# tests (\d+)$/m);
  const passed = out.match(/^# pass (\d+)$/m);
  const failed = out.match(/^# fail (\d+)$/m);
  const skipped = out.match(/^# skipped (\d+)$/m);
  const cancelled = out.match(/^# cancelled (\d+)$/m);
  assert.ok(tests, out.slice(-2000));
  assert.equal(tests[1], '45');
  assert.equal(passed && passed[1], '45');
  assert.equal(failed && failed[1], '0');
  assert.equal(skipped && skipped[1], '0');
  assert.equal(cancelled && cancelled[1], '0');
});
