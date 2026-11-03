/**
 * The packed tarball has to run a v13 receipt. The line codec is vendored.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const pkg = fileURLToPath(new URL('..', import.meta.url));

test('the packed verifier loads the v13 path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v13pack-'));
  try {
    const listed = JSON.parse(execFileSync('npm', ['pack', '--json', '--silent'], {
      cwd: pkg,
      encoding: 'utf8',
    }));
    const tarball = join(pkg, listed[0].filename);
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
      cwd: dir,
      encoding: 'utf8',
    });
    const script = `
      import { checkReceiptInput } from 'chit402-verify/check-input';
      const out = await checkReceiptInput(JSON.stringify({
        v: 13,
        schema: 'chit402.cs2.receipt.v1',
        line: '${'00'.repeat(1024)}',
        index: 0,
        epoch: 1,
        contract: '0x${'11'.repeat(20)}',
        proof: [],
      }), { publicInput: true });
      if (out.verdict.reason !== 'bad_line') throw new Error(out.verdict.reason || 'exit');
      if (!JSON.stringify(out.verdict.notes || []).includes('anchor contract unaudited')) throw new Error('note');
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CHIT402_HERMETIC: '1' },
    });
    unlinkSync(tarball);
    assert.equal(true, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
