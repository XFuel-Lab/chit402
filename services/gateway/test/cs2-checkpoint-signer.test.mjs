/**
 * Gateway CI hook for the v13 checkpoint signer. Discovery picks this file
 * up with the rest of test/*.test.mjs, so no workflow edit is required.
 * The child process runs the ecdsa and sealer suites.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('cs2 checkpoint signer suites (gateway CI hook)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    'packages/cs2-core/ecdsa/ecdsa.test.mjs',
    'services/chit-sealer/kms-secp256k1.test.mjs',
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  assert.match(out, /# pass 40/);
});
