/**
 * A public shell is inclusion, not a holder signature.
 * The live 1ebc5616 fixture is the holder document. Without --jws the
 * verdict is INCLUDED_SHELL and the process exits non-zero unless
 * --accept-shell. Holder mode checks the original JWS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const { shellFromHolder } = await import('../dist/index.js');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const holderPath = fileURLToPath(new URL('./fixtures/public/chit-1ebc5616.json', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
}

test('1ebc5616 shell is INCLUDED_SHELL and holder mode is VERIFIED', () => {
  const holder = JSON.parse(readFileSync(holderPath, 'utf8'));
  const shell = shellFromHolder(holder);
  const raw = JSON.stringify(shell);
  assert.equal(shell.schema, 'chit402.receipt_shell.v1');
  assert.equal(shell.unsigned, true);
  assert.equal(shell.amount_gross, '2000');
  assert.equal(shell.payment_tx, '0xf63ed6a83106d84a04b18a53ebbd73ff4c1fce280ec1a6035c5bdc2bed283f6f');
  for (const banned of ['Llama-3.3', 'akash-network', 'prompt_tokens', holder.caller_binding.payer_wallet, 'issuer_signature']) {
    assert.equal(raw.includes(banned), false, banned);
  }

  const dir = mkdtempSync(join(tmpdir(), 'chit-shell-'));
  const shellPath = join(dir, 'shell.json');
  writeFileSync(shellPath, raw);

  const plain = run([shellPath]);
  assert.equal(plain.status, 1);
  assert.match(plain.stdout, /INCLUDED_SHELL: signature requires owner view/);
  assert.match(plain.stdout, /Overall: INCLUDED_SHELL/);

  const accepted = run([shellPath, '--accept-shell']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /INCLUDED_SHELL/);

  const held = run([shellPath, '--jws', holderPath]);
  assert.equal(held.status, 0, `${held.stdout}\n${held.stderr}`);
  assert.match(held.stdout, /Overall: VERIFIED/);

  const tampered = { ...shell, amount_gross: '1' };
  const tamperedPath = join(dir, 'tampered.json');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  const mismatch = run([tamperedPath, '--jws', holderPath]);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /shell_jws_mismatch/);

  const gated = run(['--url', 'https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96']);
  assert.equal(gated.status, 1);
  assert.match(gated.stdout, /owner_proof_required/);
  assert.match(gated.stdout, /OWNER_PROOF_REQUIRED/);
});
