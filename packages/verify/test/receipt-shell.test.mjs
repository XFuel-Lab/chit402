/**
 * A public shell is inclusion, not a holder signature.
 * The live 1ebc5616 fixture is the holder document. Without --jws the
 * verdict is INCLUDED_SHELL and the process exits non-zero.
 * --accept-shell was removed in 0.4. That line is never VERIFIED.
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
  assert.doesNotMatch(run.stdout, /^VERIFIED\n/m);
  assert.doesNotMatch(run.stdout, /INCLUDED_SHELL/);
}

function removed(run, flag) {
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(`${run.stderr}\n${run.stdout}`, /removed in 0\.4:/);
  notVerified(run);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
}

test('1ebc5616 shell is INCLUDED_SHELL and an unsigned fixture head is not VERIFIED', () => {
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
  assert.notEqual(plain.status, 0, plain.stdout + plain.stderr);
  assert.doesNotMatch(plain.stdout, /kid_not_in_history/);
  assert.doesNotMatch(plain.stdout, /--issuer-history/);
  if (plain.status === 1) {
    assert.match(plain.stdout, /^NOT_IN_LOG\n/);
  } else {
    assert.equal(plain.status, 2, plain.stdout + plain.stderr);
    assert.match(plain.stdout, /^COULD_NOT_CHECK\n/);
    assert.match(plain.stdout, /NOT found invalid/);
    assert.match(plain.stdout, /signed_receipt_unavailable/);
  }
  notVerified(plain);

  const accepted = run([shellPath, '--accept-shell']);
  removed(accepted, '--accept-shell');

  const held = run([
    shellPath, '--jws', ownerPath, '--jwks-file', jwksPath,
    '--inclusion', inclusionPath, '--head', headPath,
  ]);
  removed(held, '--jws');

  const holderOnly = run([shellPath, '--jws', holderPath, '--inclusion', inclusionPath, '--head', headPath]);
  removed(holderOnly, '--jws');

  const tampered = { ...shell, amount_gross: '1' };
  const tamperedPath = join(dir, 'tampered.json');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  const mismatch = run([tamperedPath, '--jws', holderPath, '--inclusion', inclusionPath, '--head', headPath]);
  removed(mismatch, '--jws');

  const gated = run(['--url', 'https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96']);
  removed(gated, '--url');
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
  removed(attacked, '--jws');

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
  removed(forgedOwner, '--jws');

  const realShell = join(dir, 'published-shell.json');
  writeFileSync(realShell, JSON.stringify(shellFromHolder(holder)));
  const missing = run([realShell, '--jws', holderPath]);
  removed(missing, '--jws');

  const badRoot = 'ab'.repeat(32);
  const bad = { ...inclusionFor(holder), root: badRoot };
  const badPath = join(dir, 'bad-inclusion.json');
  const badHeadPath = join(dir, 'bad-head.json');
  writeFileSync(badPath, JSON.stringify(bad));
  writeFileSync(badHeadPath, JSON.stringify({ root: badRoot, tree_size: bad.tree_size }));
  const badRun = run([realShell, '--jws', holderPath, '--inclusion', badPath, '--head', badHeadPath]);
  removed(badRun, '--jws');

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
  removed(claimedRun, '--jws');

  const decorated = run([claimedPath, '--accept-shell']);
  assert.equal(decorated.status, 1);
  assert.match(decorated.stderr, /removed in 0\.4: a shell is not a verified payment/);
  assert.doesNotMatch(decorated.stdout, /Overall:\s*VERIFIED/);
});
