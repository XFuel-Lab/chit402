/**
 * Receipts issued before the public log (Oct 2, 2026) keep their exit code.
 * The gateway may add a `log_note` to the public shell JSON; the verdict is
 * the same with or without it: exit 1, not_in_log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const shell = JSON.parse(readFileSync(new URL('./fixtures/public/chit-43c98110-prelog-shell.json', import.meta.url), 'utf8'));
const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9/', SOLANA_RPC_URL: 'http://127.0.0.1:9/' };

function run(doc) {
  const dir = tempDir('chit-prelog-');
  const file = join(dir, 'shell.json');
  writeFileSync(file, JSON.stringify(doc));
  const proc = spawnSync(process.execPath, [cli, file, '--json'], { encoding: 'utf8', timeout: 20000, env });
  return { status: proc.status, body: JSON.parse(proc.stdout) };
}

test('pre-log shell: exit 1 not_in_log, with or without log_note', () => {
  assert.equal(shell.inclusion.leaf_hash, null);
  assert.ok(Date.parse(shell.issued_at) < Date.parse('2026-10-02T17:30:00Z'));
  const plain = run(shell);
  const noted = run({ ...shell, log_note: 'Issued before the public log began on Oct 2, 2026.' });
  for (const r of [plain, noted]) {
    assert.equal(r.status, 1);
    assert.equal(r.body.exit_code, 1);
    assert.equal(r.body.result, 'invalid');
    assert.equal(r.body.reason, 'not_in_log');
    assert.equal(r.body.checks.log_inclusion, 'fail');
  }
  assert.deepEqual(noted.body.checks, plain.body.checks);
});
