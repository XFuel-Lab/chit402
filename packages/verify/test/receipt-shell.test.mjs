/**
 * A public shell is inclusion, not a holder signature.
 * The live 1ebc5616 fixture is the holder document. Without --jws the
 * verdict is INCLUDED_SHELL and the process exits non-zero.
 * --accept-shell was removed in 0.4. That line is never VERIFIED.
 * Owner view reaches VERIFIED only with a trusted issuer key, a passing
 * inclusion proof, and a signed payment. A holder signed by any other key
 * is not VERIFIED.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { execSync, spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';
import { offHost, loopbackGuardImport } from './loopback-guard.mjs';

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

const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9/', SOLANA_RPC_URL: 'http://127.0.0.1:9/' };

function run(args) {
  const proc = spawnSync(process.execPath, ['--import', loopbackGuardImport, cli, ...args], { encoding: 'utf8', timeout: 15000, env });
  assert.doesNotMatch(proc.stderr, /OFF_LOOPBACK/);
  return proc;
}

// The shell's log lookups go to this loopback stub: not_in_tree for the
// receipt, and a recorded production tree head (its signature still checks).
const head = JSON.parse(readFileSync(new URL('./fixtures/public/tree-head-size3.json', import.meta.url), 'utf8'));
const logGets = [];
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    logGets.push(`${req.method} ${req.url}`);
    if (req.method !== 'GET') return send(405, { error: 'method' });
    if (/^\/v1\/receipts\/[^/]+\/inclusion/.test(req.url)) return send(404, { error: 'not_in_tree' });
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, head);
    return send(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

// Async, so the stub in this process can answer while the CLI runs.
function runAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', loopbackGuardImport, cli, ...args], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      assert.doesNotMatch(stderr, /OFF_LOOPBACK/);
      resolve({ status, stdout, stderr });
    });
  });
}

test('1ebc5616 shell is INCLUDED_SHELL and an unsigned fixture head is not VERIFIED', async () => {
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

  const dir = tempDir('chit-shell-');
  const shellPath = join(dir, 'shell.json');
  writeFileSync(shellPath, raw);
  // Same shell, with its log host on loopback for the run that reads the log.
  const loopShellPath = join(dir, 'shell-loopback.json');
  writeFileSync(loopShellPath, JSON.stringify({ ...shell, verify_url: `${origin}/receipt/${shell.receipt_id}` }));
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

  // The log says not_in_tree under a signed head: NOT_IN_LOG, exit 1.
  const plain = await runAsync([loopShellPath]);
  assert.equal(plain.status, 1, plain.stdout + plain.stderr);
  assert.ok(/^NOT_IN_LOG\n/.test(plain.stdout), plain.stdout);
  assert.doesNotMatch(plain.stdout, /kid_not_in_history/);
  assert.doesNotMatch(plain.stdout, /--issuer-history/);
  notVerified(plain);
  assert.ok(logGets.some((line) => line.startsWith('GET /v1/receipts/tree/head')), logGets.join('\n'));

  // The log cannot be read (nothing listens on the loopback port): COULD_NOT_CHECK, exit 2.
  const shut = join(dir, 'shell-unreachable.json');
  writeFileSync(shut, JSON.stringify({ ...shell, verify_url: `http://127.0.0.1:9/receipt/${shell.receipt_id}` }));
  const unread = run([shut]);
  assert.equal(unread.status, 2, unread.stdout + unread.stderr);
  assert.ok(/^COULD_NOT_CHECK\n/.test(unread.stdout), unread.stdout);
  assert.ok(/The receipt could not be checked\./.test(unread.stdout), unread.stdout);
  assert.doesNotMatch(unread.stdout, /invalid/i);
  assert.ok(/signed_receipt_unavailable/.test(unread.stdout), unread.stdout);
  notVerified(unread);

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
  const dir = tempDir('chit-shell-attack-');
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

test('only the loopback stub was read, GET only, and no fetch left loopback', () => {
  assert.deepEqual(offHost, [], `off-loopback fetches: ${offHost.join(', ')}`);
  assert.ok(logGets.every((line) => line.startsWith('GET ')), logGets.join('\n'));
});
