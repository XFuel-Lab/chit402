/**
 * Gateway CI hook for the v13 seller sigma signer. Discovery picks this file
 * up with the rest of test/*.test.mjs, so no workflow edit is required.
 * The child process runs the seller suite and the shared EIP-712 suite.
 * The TAP counts are pinned.
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function runTap(file) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    file,
  ], { cwd: repo, encoding: 'utf8', env, timeout: 120_000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, out.slice(-4000));
  return {
    out,
    tests: out.match(/^# tests (\d+)$/m),
    passed: out.match(/^# pass (\d+)$/m),
    failed: out.match(/^# fail (\d+)$/m),
    skipped: out.match(/^# skipped (\d+)$/m),
    cancelled: out.match(/^# cancelled (\d+)$/m),
  };
}

test('cs2 seller sigma suite (gateway CI hook)', () => {
  const seller = runTap('packages/chit-seller/seller.test.mjs');
  assert.ok(seller.tests, seller.out.slice(-2000));
  assert.equal(seller.tests[1], '60');
  assert.equal(seller.passed && seller.passed[1], '60');
  assert.equal(seller.failed && seller.failed[1], '0');
  assert.equal(seller.skipped && seller.skipped[1], '0');
  assert.equal(seller.cancelled && seller.cancelled[1], '0');
  const shared = runTap('packages/cs2-core/eip712/eip712.test.mjs');
  assert.ok(shared.tests, shared.out.slice(-2000));
  assert.equal(shared.tests[1], '3');
  assert.equal(shared.passed && shared.passed[1], '3');
  assert.equal(shared.failed && shared.failed[1], '0');
  assert.equal(shared.skipped && shared.skipped[1], '0');
  assert.equal(shared.cancelled && shared.cancelled[1], '0');
  const rev5 = runTap('packages/cs2-core/eip712/rev5.test.mjs');
  assert.ok(rev5.tests, rev5.out.slice(-2000));
  assert.equal(rev5.tests[1], '6');
  assert.equal(rev5.passed && rev5.passed[1], '6');
  assert.equal(rev5.failed && rev5.failed[1], '0');
  assert.equal(rev5.skipped && rev5.skipped[1], '0');
  assert.equal(rev5.cancelled && rev5.cancelled[1], '0');
  const status = runTap('packages/cs2-core/key-status/status.test.mjs');
  assert.ok(status.tests, status.out.slice(-2000));
  assert.equal(status.tests[1], '9');
  assert.equal(status.passed && status.passed[1], '9');
  assert.equal(status.failed && status.failed[1], '0');
  assert.equal(status.skipped && status.skipped[1], '0');
  assert.equal(status.cancelled && status.cancelled[1], '0');
});
