/**
 * chit402.public.v1 on the 0.4.0 verifier.
 * The CLI takes one receipt URL. Flags stay --issuer-history and --json.
 * Trust is the pin plus verified history. Under the default pin a test key
 * is `key untrusted`, not signature_invalid.
 * Library checks use a history document that verifies under that test key's
 * thumbprint. They do not pass a JWKS file, an inclusion file, or a head file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { verifyPublicRecord, verifyReceipt } = await import('../dist/index.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const exported = publicKey.export({ format: 'jwk' });
const kid = jwkThumbprint({ kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y });
const jwk = {
  kty: 'EC',
  crv: 'P-256',
  x: exported.x,
  y: exported.y,
  kid,
  alg: 'ES256',
  use: 'sig',
};
const pins = [kid];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-record-'));

const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const ROW = 'ab'.repeat(32);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function leafHash(taskId, rowHash) {
  const body = Buffer.from(`${taskId}|${rowHash}`);
  return sha256(Buffer.concat([Buffer.from([0x00]), body]));
}

function signJws(payload, typ = 'chit402.public+jws') {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ, kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function receiptJws(taskId, version) {
  const claims = version === 11
    ? {
      v: 11,
      task_id: taskId,
      iss: 'chit402',
      iat: Math.floor(Date.parse('2020-01-01T00:00:33.000Z') / 1000),
      payment: {
        asset: 'USDC',
        network: 'base',
        payee: PAYEE,
        gross_amount: '2000',
        settled_amount: '2000',
        ref: `base:0x${'ab'.repeat(32)}`,
      },
      caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
    }
    : {
      payload_version: version,
      task_id: taskId,
      iss: 'chit402',
      iat: Math.floor(Date.parse('2020-01-01T00:00:33.000Z') / 1000),
      payment: {
        asset: 'USDC',
        network: 'base',
        payee: PAYEE,
        gross_amount: '2000',
        settled_amount: '2000',
        ref: `base:0x${'ab'.repeat(32)}`,
      },
      caller_binding: { payer_wallet: `0x${'11'.repeat(20)}` },
      route: { provider: 'akash-network', model: 'secret-model' },
    };
  return signJws(claims, 'chit402-receipt+jwt');
}

function publicPayload(taskId, version, { leaf = undefined, signedAt = '2026-10-14T12:00:00.000Z' } = {}) {
  const full = receiptJws(taskId, version);
  const leafHex = leaf === undefined ? leafHash(taskId, ROW) : leaf;
  return {
    full,
    payload: {
      schema: 'chit402.public.v1',
      receipt_id: taskId,
      payload_version: version,
      full_receipt_sha256: sha256(Buffer.from(full, 'utf8')),
      leaf_hash: leafHex,
      log_id: leafHex ? 'epoch:2' : null,
      asset: 'USDC',
      chain: 'base',
      pay_to: PAYEE,
      amount_gross: '2000',
      amount_settled: '2000',
      issued_at: '2020-01-01T00:00:00.000Z',
      public_signed_at: signedAt,
      kid,
    },
  };
}

function historyDoc({ notBefore, status = 'active', revokedAt = null }) {
  const entry = {
    kid,
    jwk,
    alg: 'ES256',
    not_before: notBefore,
    not_after: null,
    status,
    revoked_at: revokedAt,
    reason: null,
    custody: 'test',
    prev_hash: null,
  };
  entry.entry_hash = issuerHistoryEntryHash(entry);
  const doc = {
    schema: 'chit402.issuer_history.v1',
    version: 1,
    seq: 1,
    entries: [entry],
    head_hash: entry.entry_hash,
  };
  const claims = {
    schema: 'chit402.issuer_history.v1',
    entry_count: 1,
    head_hash: entry.entry_hash,
    version: 1,
    seq: 1,
  };
  doc.issuer_signature = {
    jws: signJws(claims, 'chit402-issuer-history+jwt'),
    kid,
    issuer_jwk: jwk,
  };
  return doc;
}

const openHistory = historyDoc({ notBefore: '2020-01-01T00:00:00.000Z' });

function headFor(root) {
  const claims = { schema: 'chit402.tree_head.v1', root, tree_size: 1 };
  const jws = signJws(claims, 'chit402-tree-head+jwt');
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', jws, kid, issuer_jwk: jwk },
  };
}

function inclusionFor(root) {
  return {
    schema: 'chit402.inclusion.v1',
    leaf_index: 0,
    tree_size: 1,
    root,
    proof: [],
  };
}

function verify(record, extra = {}) {
  return verifyPublicRecord(record, { trustedKids: pins, history: openHistory, ...extra });
}

function run(args) {
  const res = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { json = null; }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function runAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { json = null; }
      resolve({ status, stdout, stderr, json });
    });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('v10 and v11 public records are PUBLIC_VERIFIED, issuer_asserted, exit 0', () => {
  for (const version of [10, 11]) {
    const built = publicPayload(`xfuel-public-v${version}`, version);
    const record = signJws(built.payload);
    const result = verify(record, {
      inclusion: inclusionFor(built.payload.leaf_hash),
      head: headFor(built.payload.leaf_hash),
    });
    assert.equal(result.exitCode, 0, result.reason || '');
    assert.equal(result.verdict, 'PUBLIC_VERIFIED');
    assert.equal(result.scope, 'public');
    assert.equal(result.leaf_binding, 'issuer_asserted');
    assert.deepEqual(result.not_checked, ['payer', 'agent', 'content', 'usage']);
    assert.equal(result.checks.signature, 'ok');
    assert.equal(result.checks.key, 'ok');
    assert.equal(result.checks.inclusion, 'ok');
    assert.equal(result.checks.payment, 'not_checked');
    assert.notEqual(result.verdict, 'VERIFIED');
  }
});

test('a pre-log record is PUBLIC_SIGNED_NOT_IN_LOG and exits 1', () => {
  const built = publicPayload('xfuel-public-prelog', 10, { leaf: null });
  const result = verify(signJws(built.payload));
  assert.equal(result.exitCode, 1);
  assert.equal(result.verdict, 'FAILED');
  assert.equal(result.reason, 'PUBLIC_SIGNED_NOT_IN_LOG');
  assert.equal(result.checks.inclusion, 'not_in_log');
});

test('an unknown public schema or receipt version exits 2', () => {
  const built = publicPayload('xfuel-public-unknown', 10);
  const v2 = signJws({ ...built.payload, schema: 'chit402.public.v2' });
  const v12 = signJws({ ...built.payload, payload_version: 12 });
  const stringVersion = signJws({ ...built.payload, payload_version: '10' });
  for (const [name, jws] of [['v2', v2], ['v12', v12], ['string', stringVersion]]) {
    const result = verify(jws);
    assert.equal(result.exitCode, 2, name);
    assert.equal(result.reason, 'unsupported_version');
    assert.equal(result.verdict, 'FAILED');
    assert.equal(result.scope, 'public');
  }
});

test('a head without an issuer JWS is head_unavailable, exit 2', () => {
  const built = publicPayload('xfuel-public-head', 10);
  const record = signJws(built.payload);
  const missing = verify(record);
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.reason, 'head_unavailable');
  const unsigned = verify(record, {
    inclusion: inclusionFor(built.payload.leaf_hash),
    head: { schema: 'chit402.tree_head.v1', root: built.payload.leaf_hash, tree_size: 1 },
  });
  assert.equal(unsigned.exitCode, 2);
  assert.equal(unsigned.reason, 'head_unavailable');
});

test('a leaf that is not under the signed head exits 1', () => {
  const built = publicPayload('xfuel-public-mismatch-leaf', 10);
  const other = leafHash('xfuel-other', ROW);
  const result = verify(signJws(built.payload), {
    inclusion: inclusionFor(other),
    head: headFor(other),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'inclusion_mismatch');
  assert.equal(result.verdict, 'FAILED');
});

test('T7 a forged full receipt exits 1 and a public record never becomes VERIFIED', () => {
  const built = publicPayload('xfuel-public-t7', 10);
  const record = signJws(built.payload);
  const root = built.payload.leaf_hash;
  const parts = {
    inclusion: inclusionFor(root),
    head: headFor(root),
  };
  const forged = verify(record, { ...parts, fullJws: built.full.replace(/.$/, 'A') });
  assert.equal(forged.exitCode, 1);
  assert.equal(forged.reason, 'public_full_mismatch');
  assert.equal(forged.verdict, 'FAILED');

  const alone = verify(record, parts);
  assert.equal(alone.exitCode, 0, alone.reason || '');
  assert.equal(alone.verdict, 'PUBLIC_VERIFIED');

  const matched = verify(record, { ...parts, fullJws: built.full });
  assert.equal(matched.exitCode, 0, matched.reason || '');
  assert.equal(matched.verdict, 'PUBLIC_VERIFIED');
  assert.equal(matched.scope, 'public');

  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.doesNotMatch(help.stdout, /require-full/);
  assert.doesNotMatch(help.stdout, /--jwks-file/);
  assert.doesNotMatch(help.stdout, /--inclusion/);
  assert.doesNotMatch(help.stdout, /--head/);
  const src = fs.readFileSync(path.join(pkgDir, 'src', 'cli.ts'), 'utf8');
  assert.doesNotMatch(src, /require-full|requireFull/);
  assert.match(src, /peekPublicRecord/);
});

test('issuer history is judged at public_signed_at', () => {
  const built = publicPayload('xfuel-public-history', 10);
  const record = signJws(built.payload);
  const parts = {
    inclusion: inclusionFor(built.payload.leaf_hash),
    head: headFor(built.payload.leaf_hash),
  };
  const ok = verify(record, parts);
  assert.equal(ok.exitCode, 0, ok.reason || '');
  assert.equal(ok.leaf_binding, 'issuer_asserted');

  const early = publicPayload('xfuel-public-early', 10, { signedAt: '2020-06-01T00:00:00.000Z' });
  const laterHistory = historyDoc({ notBefore: '2026-10-01T00:00:00.000Z' });
  const tooSoon = verifyPublicRecord(signJws(early.payload), {
    trustedKids: pins,
    history: laterHistory,
    inclusion: inclusionFor(early.payload.leaf_hash),
    head: headFor(early.payload.leaf_hash),
  });
  assert.equal(tooSoon.exitCode, 1);
  assert.equal(tooSoon.reason, 'issued_before_not_before');

  const revoked = historyDoc({
    notBefore: '2020-01-01T00:00:00.000Z',
    status: 'revoked',
    revokedAt: '2026-10-01T00:00:00.000Z',
  });
  const dead = verifyPublicRecord(record, { trustedKids: pins, history: revoked, ...parts });
  assert.equal(dead.exitCode, 1);
  assert.equal(dead.reason, 'kid_revoked_before_issuance');
});

test('the default pin reports key untrusted, not signature_invalid', () => {
  const built = publicPayload('xfuel-public-pin', 10);
  const record = signJws(built.payload);
  const result = verifyPublicRecord(record, {
    inclusion: inclusionFor(built.payload.leaf_hash),
    head: headFor(built.payload.leaf_hash),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'key untrusted');
  assert.notEqual(result.reason, 'signature_invalid');
  assert.equal(result.checks.signature, 'not_checked');
  assert.equal(result.checks.key, 'untrusted');
});

test('one receipt URL supplies the record, the inclusion, and the head', async () => {
  const task = 'xfuel-public-url';
  const built = publicPayload(task, 10);
  const record = signJws(built.payload);
  const root = built.payload.leaf_hash;
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    seen.push(url.pathname);
    if (url.pathname === `/receipt/${task}/public`) {
      res.writeHead(200, { 'content-type': 'application/jose' });
      res.end(record);
      return;
    }
    if (url.pathname === `/v1/receipts/${task}/inclusion`) {
      const host = `http://127.0.0.1:${server.address().port}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ...inclusionFor(root),
        head_url: `${host}/v1/receipts/tree/head`,
      }));
      return;
    }
    if (url.pathname === '/v1/receipts/tree/head') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(headFor(root)));
      return;
    }
    if (url.pathname === `/receipt/${task}`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        task_id: task,
        issuer_signature: { jws: built.full, kid },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not_found"}');
  });
  const port = await listen(server);
  try {
    const receiptUrl = `http://127.0.0.1:${port}/receipt/${task}`;
    const result = await runAsync([receiptUrl, '--json']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.json.reason, 'key untrusted');
    assert.equal(result.json.scope, 'public');
    assert.equal(result.json.verdict, 'FAILED');
    assert.equal(result.json.exit_code, 1);
    assert.doesNotMatch(result.stdout, /signature_invalid/);
    assert.doesNotMatch(result.stdout, /"verdict": "VERIFIED"/);
    assert.deepEqual(seen, [
      `/receipt/${task}`,
      `/receipt/${task}/public`,
      `/v1/receipts/${task}/inclusion`,
      '/v1/receipts/tree/head',
    ]);
    assert.equal(seen.some((pathName) => pathName.includes('chit402.com')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('removed flags stay removed', () => {
  const file = path.join(dir, 'record.jws');
  fs.writeFileSync(file, signJws(publicPayload('xfuel-public-flags', 10).payload));
  for (const flag of ['--jwks-file', '--inclusion', '--head', '--require-full', '--jws']) {
    const result = run([file, '--json', flag, file]);
    assert.equal(result.status, 1, flag);
    assert.equal(result.json.reason, 'removed_flag');
    assert.match(result.stdout, /removed in 0\.4/);
  }
});

test('the receipt verifier does not call a public record VERIFIED', async () => {
  const built = publicPayload('xfuel-public-not-receipt', 10);
  const jws = signJws(built.payload);
  const result = await verifyReceipt({
    task_id: 'xfuel-public-not-receipt',
    issuer_signature: { jws, kid },
  }, { trustedKids: pins, skipIssuerHistory: true, fetchIssuerHistory: false });
  assert.notEqual(result.overall, 'verified');
});
