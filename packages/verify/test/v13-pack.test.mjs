/**
 * The packed tarball has to run a v13 receipt. The line codec is vendored.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function npm(args, opts) {
  return execFileSync(npmBin, args, {
    ...opts,
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

test('the packed verifier loads the v13 path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v13pack-'));
  try {
    const raw = npm(['pack', '--json', '--silent'], { cwd: pkg, encoding: 'utf8' });
    const listed = JSON.parse(raw.slice(raw.indexOf('[')));
    const names = listed[0].files.map((file) => file.path);
    for (const needle of [
      'vendor/cs2-core/eip712/index.mjs',
      'vendor/cs2-core/eip712/kinds.mjs',
      'vendor/cs2-core/key-status/status.mjs',
      'vendor/cs2-core/ecdsa/bytes.js',
      'vendor/cs2-core/line/index.mjs',
      'vendor/cs2-core/merkle/index.js',
      'vendor/cs2-core/sha256.js',
    ]) {
      assert.equal(names.some((path) => path.endsWith(needle)), true, needle);
    }
    const tarball = join(pkg, listed[0].filename);
    execFileSync('tar', ['-xzf', tarball, '-C', dir], { encoding: 'utf8' });
    symlinkSync(join(pkg, 'node_modules'), join(dir, 'package', 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
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
      cwd: join(dir, 'package'),
      encoding: 'utf8',
      env: { ...process.env, CHIT402_HERMETIC: '1' },
    });
    unlinkSync(tarball);
    assert.equal(true, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
