/**
 * 0.4.11 follow-ups. Each case is looser in the library than in the CLI on
 * 0.4.10 and main:
 *   1. A detached legacy `issuer_signature.value` is trusted only under a
 *      kid pinned in issuer history (bundled snapshot or a supplied history
 *      that extends it). A caller key outside that history is key untrusted.
 *   2. `overall` comes from the shared verdict: verified only at exit 0.
 *   3. Follow-up reads (history, inclusion, head) never follow a redirect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const lib = await import('../dist/index.js');
const { verifyReceipt, verifyIssuerSignatureWithJwks, canonicalIssuerPayload } = lib;

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(here, 'fixtures');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(fixtures, rel), 'utf8'));
const JWKS = read('chit402-jwks.json');
const REAL = read('chit-4d6e8331.json');
const SNAPSHOT = readFileSync(fileURLToPath(new URL('../issuer-history.snapshot.json', import.meta.url)), 'utf8');
const PRODUCTION_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

function throwawayKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  return { privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' } };
}

function detachedReceipt(key, kid) {
  const receipt = { task_id: 'xfuel-detached-0411', status: 'completed', payment: { rail: 'usdc', gross_amount: '1000' } };
  const value = sign('sha256', Buffer.from(canonicalIssuerPayload(receipt), 'utf8'), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  receipt.issuer_signature = { alg: 'ES256', value, kid };
  return receipt;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr, text: `${stdout}\n${stderr}` }));
  });
}

test('a detached legacy signature is not trusted under a caller key outside issuer history', async () => {
  // A caller JWKS key under its own kid.
  const own = throwawayKey('caller-key-1');
  const ownReceipt = detachedReceipt(own, 'caller-key-1');
  const direct = verifyIssuerSignatureWithJwks(ownReceipt, { keys: [own.publicJwk] });
  assert.equal(direct.valid, false);
  assert.equal(direct.key_trusted, false);
  assert.equal(direct.reason, 'key untrusted');
  const viaLib = await verifyReceipt(ownReceipt, { jwks: { keys: [own.publicJwk] } });
  assert.equal(viaLib.issuer_signature.valid, false);
  assert.equal(viaLib.overall, 'failed');
  assert.equal(viaLib.amount_usdc, null);

  // A caller JWKS key that claims the production history kid with other key material.
  const lookalike = throwawayKey(PRODUCTION_KID);
  const lookalikeReceipt = detachedReceipt(lookalike, PRODUCTION_KID);
  const claimed = await verifyReceipt(lookalikeReceipt, { jwks: { keys: [lookalike.publicJwk] } });
  assert.equal(claimed.issuer_signature.valid, false);
  assert.equal(claimed.issuer_signature.key_trusted, false);
  assert.notEqual(claimed.overall, 'verified');

  // A supplied history that does not verify under the pinned kids or extend
  // the bundled snapshot does not pin the caller key either.
  const unsignedHistory = {
    schema: 'chit402.issuer_history.v1',
    version: 99,
    seq: 99,
    entries: [{ kid: 'caller-key-1', jwk: own.publicJwk, alg: 'ES256', not_before: '2020-01-01T00:00:00Z', status: 'active' }],
  };
  const withHistory = await verifyReceipt(ownReceipt, { jwks: { keys: [own.publicJwk] }, issuerHistory: unsignedHistory });
  assert.equal(withHistory.issuer_signature.valid, false);
  assert.notEqual(withHistory.overall, 'verified');
});

test('overall reads verified only when the shared verdict is exit 0', async () => {
  // The library does not fetch the log or the anchors, so a receipt whose
  // library checks all pass is exit 2 and overall partial.
  const result = await verifyReceipt(structuredClone(REAL), { jwks: JWKS });
  assert.equal(result.issuer_signature.valid, true);
  assert.equal(result.overall, 'partial');
  assert.equal(result.verdict.exit_code, 2);
  assert.equal(result.verdict.checks.signature, 'pass');

  const tampered = structuredClone(REAL);
  tampered.payment = { ...tampered.payment, gross_amount: '999000000' };
  const bad = await verifyReceipt(tampered, { jwks: JWKS });
  assert.equal(bad.verdict.exit_code, 1);
  assert.equal(bad.overall, 'failed');

  const map = { 0: ['verified', 'verified_carried_forward'], 1: ['failed'], 2: ['partial'] };
  for (const opts of [{}, { jwks: JWKS }, { jwks: JWKS, checkPayer: false }]) {
    const r = await verifyReceipt(structuredClone(REAL), opts);
    assert.ok(map[r.verdict.exit_code].includes(r.overall), `exit ${r.verdict.exit_code} with overall ${r.overall}`);
  }
});

test('follow-up log reads do not follow redirects (CLI)', async () => {
  const signedHead = read('pardal-head-honest.json');
  const task = 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
  const moved = [];
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/moved/')) {
      moved.push(url);
      if (url.includes('inclusion')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_in_tree' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(signedHead));
      return;
    }
    if (url.includes('/inclusion')) {
      res.writeHead(302, { location: '/moved/inclusion' });
      res.end();
      return;
    }
    if (url.includes('/tree/head')) {
      res.writeHead(302, { location: '/moved/head' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      schema: 'chit402.receipt_shell.v1',
      unsigned: true,
      task_id: task,
      receipt_id: task,
      inclusion: { leaf_hash: null, proof: null, signed_head: null },
    }));
  });
  const port = await listen(server);
  try {
    const run = await runCliAsync([`http://127.0.0.1:${port}/receipt/${task}`, '--json']);
    assert.equal(run.status, 2, run.text);
    assert.equal(JSON.parse(run.stdout).reason, 'signed_receipt_unavailable');
    assert.deepEqual(moved, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('follow-up history reads do not follow redirects (library)', async () => {
  const moved = [];
  const server = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/moved/')) {
      moved.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(SNAPSHOT);
      return;
    }
    res.writeHead(302, { location: '/moved/issuer-history.json' });
    res.end();
  });
  const port = await listen(server);
  // The issuer host is answered by the loopback server; the request options
  // (including redirect handling) reach the real fetch unchanged.
  const fetchImpl = (url, init) => fetch(String(url).replace('https://api.chit402.com', `http://127.0.0.1:${port}`), init);
  try {
    const result = await verifyReceipt(structuredClone(REAL), {
      jwks: JWKS,
      fetchIssuerHistory: true,
      strictIssuerHistory: true,
      fetchImpl,
    });
    assert.deepEqual(moved, []);
    assert.equal(result.issuer_history.unreachable, true);
    assert.equal(result.issuer_history.document, null);
    assert.notEqual(result.overall, 'verified');
    assert.equal(result.verdict.exit_code, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
