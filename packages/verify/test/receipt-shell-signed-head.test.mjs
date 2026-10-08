/**
 * Shell holder mode: inclusion counts only against a signed tree head, and
 * the shell is compared with signed claims only. Throwaway P-256 issuer key;
 * the public 1ebc5616 claims are re-signed only under that throwaway key.
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

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function key() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y })).digest('base64url');
  return { privateKey, jwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid, alg: 'ES256', use: 'sig' } };
}
function jws(k, header, claims) {
  const input = `${b64({ alg: 'ES256', kid: k.jwk.kid, ...header })}.${b64(claims)}`;
  const s = createSign('SHA256'); s.update(input); s.end();
  return `${input}.${s.sign({ key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const leafHash = (body) => createHash('sha256').update(Buffer.concat([Buffer.from([0]), Buffer.from(body)])).digest('hex');
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 }); }
function notVerified(r) { assert.notEqual(r.status, 0, r.stdout); assert.doesNotMatch(r.stdout, /Overall:\s*VERIFIED/); }

const real = JSON.parse(readFileSync(holderPath, 'utf8'));
const claims = JSON.parse(Buffer.from(real.issuer_signature.jws.split('.')[1], 'base64url'));
const issuer = key();
const holderJws = jws(issuer, { typ: 'chit402-receipt+jwt' }, claims);
const holder = { ...structuredClone(real), issuer_signature: { jws: holderJws, kid: issuer.jwk.kid } };
const row = real.book_chain.row_hash;
const leaf = leafHash(`${claims.task_id}|${row}`);
const inclusion = { leaf_index: 0, tree_size: 1, leaf, row_hash: row, proof: [], root: leaf };
const headClaims = { schema: 'chit402.tree_head.v2', payload_version: 2, tree_size: 1, root: leaf };
const signedHead = { ...headClaims, issuer_signature: { jws: jws(issuer, { typ: 'chit402-tree-head+jwt' }, headClaims) } };
const dir = mkdtempSync(join(tmpdir(), 'chit-shell-head-'));
const w = (n, o) => { const f = join(dir, n); writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); return f; };
const jwks = w('jwks.json', { keys: [issuer.jwk] });
const shell = w('shell.json', shellFromHolder(holder));
const holderF = w('holder.json', holder);
const incF = w('inclusion.json', inclusion);
const headF = w('head.json', signedHead);
const base = ['--jwks-file', jwks, '--no-trusted-kid', '--inclusion', incF];

test('a signed head plus inclusion is VERIFIED; an owner view with row_hash is VERIFIED', () => {
  const r = run([shell, '--jws', holderF, ...base, '--head', headF]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Overall: VERIFIED/);
  const ov = w('owner.json', { jws: holderJws, salt: null, private_fields: {}, row_hash: row });
  const incNoRow = w('inc-norow.json', { ...inclusion, row_hash: undefined });
  const r2 = run([shell, '--jws', ov, '--jwks-file', jwks, '--no-trusted-kid', '--inclusion', incNoRow, '--head', headF]);
  assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
  assert.match(r2.stdout, /Overall: VERIFIED/);
});

test('an unsigned or missing head is not VERIFIED (self-made one-leaf tree)', () => {
  notVerified(run([shell, '--jws', holderF, ...base, '--head', w('head-min.json', { root: leaf, tree_size: 1 })]));
  const noHead = run([shell, '--jws', holderF, ...base]);
  notVerified(noHead);
  assert.match(noHead.stdout, /head_signature_missing/);
});

test('a head signed by a key outside the trust set is not VERIFIED', () => {
  const other = key();
  const forgedHead = { ...headClaims, issuer_signature: { jws: jws(other, { typ: 'chit402-tree-head+jwt' }, headClaims) } };
  notVerified(run([shell, '--jws', holderF, ...base, '--head', w('head-forged.json', forgedHead)]));
});

test('unsigned outer holder fields cannot ride under VERIFIED', () => {
  for (const [name, patch] of [
    ['settled', { payment: { ...holder.payment, settled_amount: '999999000' } }],
    ['network', { payment: { ...holder.payment, network: 'solana' } }],
  ]) {
    const h = { ...structuredClone(holder), ...patch };
    const r = run([w(`shell-${name}.json`, shellFromHolder(h)), '--jws', w(`holder-${name}.json`, h), ...base, '--head', headF]);
    notVerified(r);
    assert.match(r.stdout, /shell_jws_mismatch/);
  }
});
