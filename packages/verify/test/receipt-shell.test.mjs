/**
 * A public shell is inclusion, not a holder signature.
 * The live 1ebc5616 fixture is the holder document. Without --jws the
 * verdict is INCLUDED_SHELL and the process exits non-zero unless
 * --accept-shell. That line is never VERIFIED.
 * Owner view reaches VERIFIED only with a trusted issuer key, a passing
 * inclusion proof, and a signed payment. A holder signed by any other key
 * is not VERIFIED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
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
const jwksPath = fileURLToPath(new URL('./fixtures/chit402-jwks.json', import.meta.url));

function leafHash(body) {
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])).digest('hex');
}

function inclusionFor(holder, row = holder.book_chain.row_hash) {
  const leaf = leafHash(`${holder.task_id}|${row}`);
  return {
    schema: 'chit402.inclusion.v1',
    leaf_index: 0,
    tree_size: 1,
    leaf,
    row_hash: row,
    proof: [],
    root: leaf,
  };
}

function resign(holder) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({
    crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y,
  })).digest('base64url');
  const payloadB64 = holder.issuer_signature.jws.split('.')[1];
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'ES256', kid })).toString('base64url');
  const input = `${headerB64}.${payloadB64}`;
  const sign = createSign('SHA256');
  sign.update(input);
  sign.end();
  const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const forged = structuredClone(holder);
  forged.issuer_signature = {
    ...holder.issuer_signature,
    kid,
    jws: `${input}.${sig}`,
    issuer_jwk: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256' },
  };
  return forged;
}

function notVerified(run) {
  assert.notEqual(run.status, 0);
  assert.doesNotMatch(run.stdout, /Overall:\s*VERIFIED/);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
}

test('1ebc5616 shell is INCLUDED_SHELL and the owner view can be VERIFIED', () => {
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
  const inclusion = inclusionFor(holder);
  const inclusionPath = join(dir, 'inclusion.json');
  const headPath = join(dir, 'head.json');
  writeFileSync(inclusionPath, JSON.stringify(inclusion));
  writeFileSync(headPath, JSON.stringify({ root: inclusion.root, tree_size: inclusion.tree_size }));
  const ownerPath = join(dir, 'owner-view.json');
  writeFileSync(ownerPath, JSON.stringify({
    jws: holder.issuer_signature.jws,
    salt: null,
    private_fields: { payer_wallet: holder.caller_binding.payer_wallet },
    issuer_jwk: { kty: 'EC', crv: 'P-256', x: 'attacker', y: 'attacker' },
  }));

  const plain = run([shellPath]);
  assert.equal(plain.status, 1);
  assert.match(plain.stdout, /INCLUDED_SHELL: signature requires owner view/);
  assert.match(plain.stdout, /Overall: INCLUDED_SHELL/);
  assert.doesNotMatch(plain.stdout, /Overall:\s*VERIFIED/);

  const accepted = run([shellPath, '--accept-shell']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /INCLUDED_SHELL/);
  assert.doesNotMatch(accepted.stdout, /Overall:\s*VERIFIED/);

  const held = run([
    shellPath, '--jws', ownerPath, '--jwks-file', jwksPath,
    '--inclusion', inclusionPath, '--head', headPath,
  ]);
  assert.equal(held.status, 0, `${held.stdout}\n${held.stderr}`);
  assert.match(held.stdout, /Overall: VERIFIED/);

  const holderOnly = run([shellPath, '--jws', holderPath, '--inclusion', inclusionPath, '--head', headPath]);
  assert.equal(holderOnly.status, 0, `${holderOnly.stdout}\n${holderOnly.stderr}`);
  assert.match(holderOnly.stdout, /Overall: VERIFIED/);

  const tampered = { ...shell, amount_gross: '1' };
  const tamperedPath = join(dir, 'tampered.json');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  const mismatch = run([tamperedPath, '--jws', holderPath, '--inclusion', inclusionPath, '--head', headPath]);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /shell_jws_mismatch/);
  assert.doesNotMatch(mismatch.stdout, /Overall:\s*VERIFIED/);

  const gated = run(['--url', 'https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96']);
  assert.equal(gated.status, 1);
  assert.match(gated.stdout, /owner_proof_required/);
  assert.match(gated.stdout, /OWNER_PROOF_REQUIRED/);
  assert.doesNotMatch(gated.stdout, /Overall:\s*VERIFIED/);
});

test('a forged holder key is not VERIFIED, and a shell without inclusion is not VERIFIED', () => {
  const holder = JSON.parse(readFileSync(holderPath, 'utf8'));
  const forged = resign(holder);
  const dir = mkdtempSync(join(tmpdir(), 'chit-shell-attack-'));
  const shell = shellFromHolder(forged);
  const shellPath = join(dir, 'shell.json');
  writeFileSync(shellPath, JSON.stringify(shell));
  const forgedPath = join(dir, 'forged-holder.json');
  writeFileSync(forgedPath, JSON.stringify(forged));
  const inclusion = inclusionFor(forged);
  const inclusionPath = join(dir, 'inclusion.json');
  const headPath = join(dir, 'head.json');
  writeFileSync(inclusionPath, JSON.stringify(inclusion));
  writeFileSync(headPath, JSON.stringify({ root: inclusion.root, tree_size: inclusion.tree_size }));

  const attacked = run([shellPath, '--jws', forgedPath, '--inclusion', inclusionPath, '--head', headPath]);
  notVerified(attacked);
  assert.match(attacked.stdout, /key untrusted/);

  const ownerAttack = join(dir, 'owner-attack.json');
  writeFileSync(ownerAttack, JSON.stringify({
    jws: forged.issuer_signature.jws,
    salt: null,
    private_fields: {},
    issuer_jwk: forged.issuer_signature.issuer_jwk,
  }));
  const ownerShell = shellFromHolder(holder);
  const ownerShellPath = join(dir, 'real-shell.json');
  writeFileSync(ownerShellPath, JSON.stringify(ownerShell));
  const forgedOwner = run([
    ownerShellPath, '--jws', ownerAttack, '--jwks-file', jwksPath,
    '--inclusion', inclusionPath, '--head', headPath,
  ]);
  notVerified(forgedOwner);

  const realShell = join(dir, 'published-shell.json');
  writeFileSync(realShell, JSON.stringify(shellFromHolder(holder)));
  const missing = run([realShell, '--jws', holderPath]);
  notVerified(missing);
  assert.match(missing.stdout, /inclusion_missing/);

  const badRoot = 'ab'.repeat(32);
  const bad = { ...inclusionFor(holder), root: badRoot };
  const badPath = join(dir, 'bad-inclusion.json');
  const badHeadPath = join(dir, 'bad-head.json');
  writeFileSync(badPath, JSON.stringify(bad));
  writeFileSync(badHeadPath, JSON.stringify({ root: badRoot, tree_size: bad.tree_size }));
  const badRun = run([realShell, '--jws', holderPath, '--inclusion', badPath, '--head', badHeadPath]);
  notVerified(badRun);

  const claimed = shellFromHolder(holder);
  claimed.inclusion = { leaf_hash: 'cd'.repeat(32), proof: null, signed_head: null };
  const claimedPath = join(dir, 'claimed-shell.json');
  writeFileSync(claimedPath, JSON.stringify(claimed));
  const realInclusion = inclusionFor(holder);
  const realInclusionPath = join(dir, 'real-inclusion.json');
  const realHeadPath = join(dir, 'real-head.json');
  writeFileSync(realInclusionPath, JSON.stringify(realInclusion));
  writeFileSync(realHeadPath, JSON.stringify({ root: realInclusion.root, tree_size: realInclusion.tree_size }));
  const claimedRun = run([
    claimedPath, '--jws', holderPath, '--inclusion', realInclusionPath, '--head', realHeadPath,
  ]);
  notVerified(claimedRun);
  assert.match(claimedRun.stdout, /inclusion_mismatch/);

  const decorated = run([claimedPath, '--accept-shell']);
  assert.match(decorated.stdout, /INCLUDED_SHELL/);
  assert.doesNotMatch(decorated.stdout, /Overall:\s*VERIFIED/);
});
