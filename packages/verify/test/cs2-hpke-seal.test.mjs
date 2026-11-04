/**
 * Runs the gateway HPKE hook so the seal suite is part of the verify
 * package job, including the Windows run. No workflow edit.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('cs2 hpke seal suite via the gateway hook', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    'services/gateway/test/cs2-hpke-seal.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 180_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  assert.match(out, /^# pass 1$/m);
  assert.match(out, /^# fail 0$/m);
});
