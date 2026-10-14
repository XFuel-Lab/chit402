/**
 * chit402.public.v1.
 * PUBLIC_VERIFIED exits 0 with scope "public".
 * Unknown versions exit 2. A full receipt that does not match exits 1.
 * Pre-log records are not green. Inclusion requires a signed head.
 * No new CLI flag. --require-full is not implemented (Christopher).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { verifyReceipt } = await import('../dist/index.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const exported = publicKey.export({ format: 'jwk' });
const kid = 'public-record-test-kid';
const jwk = {
  kty: 'EC',
  crv: 'P-256',
  x: exported.x,
  y: exported.y,
  kid,
  alg: 'ES256',
  use: 'sig',
};
const jwks = { keys: [jwk] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-record-'));
const jwksPath = path.join(dir, 'jwks.json');
fs.writeFileSync(jwksPath, JSON.stringify(jwks));

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

function headFor(root) {
  const claims = { schema: 'chit402.tree_head.v1', root, tree_size: 1 };
  const jws = signJws(claims, 'chit402-tree-head+jwt');
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', jws, kid },
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

function write(name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function run(args) {
  const res = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { json = null; }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
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
  doc.issuer_signature = { jws: signJws(claims, 'chit402-issuer-history+jwt'), kid };
  return doc;
}

test('v10 and v11 public records are PUBLIC_VERIFIED, issuer_asserted, exit 0', () => {
  for (const version of [10, 11]) {
    const built = publicPayload(`xfuel-public-v${version}`, version);
    const record = signJws(built.payload);
    const file = write(`v${version}.jws`, record);
    const root = built.payload.leaf_hash;
    const result = run([
      file,
      '--json',
      '--jwks-file', jwksPath,
      '--inclusion', write(`inclusion-v${version}.json`, inclusionFor(root)),
      '--head', write(`head-v${version}.json`, headFor(root)),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.json.verdict, 'PUBLIC_VERIFIED');
    assert.equal(result.json.scope, 'public');
    assert.equal(result.json.leaf_binding, 'issuer_asserted');
    assert.deepEqual(result.json.not_checked, ['payer', 'agent', 'content', 'usage']);
    assert.equal(result.json.checks.signature, 'ok');
    assert.equal(result.json.checks.key, 'ok');
    assert.equal(result.json.checks.inclusion, 'ok');
    assert.equal(result.json.checks.payment, 'not_checked');
    assert.notEqual(result.json.verdict, 'VERIFIED');
  }
});

test('human output says payment was not checked and does not claim VERIFIED', () => {
  const built = publicPayload('xfuel-public-human', 10);
  const file = write('human.jws', signJws(built.payload));
  const root = built.payload.leaf_hash;
  const result = run([
    file,
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-human.json', inclusionFor(root)),
    '--head', write('head-human.json', headFor(root)),
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /PUBLIC_VERIFIED \(public copy\) — payer, agent and content not checked/);
  assert.match(result.stdout, /Payment: not checked/);
  assert.match(result.stdout, /Leaf binding: issuer_asserted/);
  assert.match(result.stdout, /Overall: PUBLIC_VERIFIED/);
  assert.doesNotMatch(result.stdout, /Overall: VERIFIED\b/);
  assert.doesNotMatch(result.stdout, /"verdict": "VERIFIED"/);
});

test('a pre-log record is PUBLIC_SIGNED_NOT_IN_LOG and exits 1', () => {
  const built = publicPayload('xfuel-public-prelog', 10, { leaf: null });
  const file = write('prelog.jws', signJws(built.payload));
  const result = run([file, '--json', '--jwks-file', jwksPath]);
  assert.equal(result.status, 1);
  assert.equal(result.json.verdict, 'FAILED');
  assert.equal(result.json.reason, 'PUBLIC_SIGNED_NOT_IN_LOG');
  assert.equal(result.json.checks.inclusion, 'not_in_log');
  assert.notEqual(result.json.verdict, 'PUBLIC_VERIFIED');
  assert.notEqual(result.json.verdict, 'VERIFIED');
});

test('an unknown public schema or receipt version exits 2', () => {
  const built = publicPayload('xfuel-public-unknown', 10);
  const v2 = signJws({ ...built.payload, schema: 'chit402.public.v2' });
  const v12 = signJws({ ...built.payload, payload_version: 12 });
  const stringVersion = signJws({ ...built.payload, payload_version: '10' });
  for (const [name, jws] of [['v2', v2], ['v12', v12], ['string', stringVersion]]) {
    const result = run([write(`${name}.jws`, jws), '--json', '--jwks-file', jwksPath]);
    assert.equal(result.status, 2, name);
    assert.equal(result.json.reason, 'unsupported_version');
    assert.equal(result.json.verdict, 'FAILED');
    assert.equal(result.json.scope, 'public');
    assert.notEqual(result.json.verdict, 'VERIFIED');
  }
});

test('a head without an issuer JWS is head_unavailable, exit 2', () => {
  const built = publicPayload('xfuel-public-head', 10);
  const file = write('nohead.jws', signJws(built.payload));
  const missing = run([file, '--json', '--jwks-file', jwksPath]);
  assert.equal(missing.status, 2);
  assert.equal(missing.json.reason, 'head_unavailable');
  const unsigned = write('unsigned-head.json', {
    schema: 'chit402.tree_head.v1',
    root: built.payload.leaf_hash,
    tree_size: 1,
  });
  const forged = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-forged.json', inclusionFor(built.payload.leaf_hash)),
    '--head', unsigned,
  ]);
  assert.equal(forged.status, 2);
  assert.equal(forged.json.reason, 'head_unavailable');
  assert.notEqual(forged.json.verdict, 'PUBLIC_VERIFIED');
});

test('a leaf that is not under the signed head exits 1', () => {
  const built = publicPayload('xfuel-public-mismatch-leaf', 10);
  const file = write('badleaf.jws', signJws(built.payload));
  const other = leafHash('xfuel-other', ROW);
  const result = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-other.json', inclusionFor(other)),
    '--head', write('head-other.json', headFor(other)),
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.json.reason, 'inclusion_mismatch');
  assert.equal(result.json.verdict, 'FAILED');
});

test('T7 a forged full receipt exits 1 and a public record never prints VERIFIED', () => {
  const built = publicPayload('xfuel-public-t7', 10);
  const record = signJws(built.payload);
  const file = write('t7.jws', record);
  const root = built.payload.leaf_hash;
  const forged = write('forged-full.json', {
    task_id: 'xfuel-public-t7',
    issuer_signature: { jws: receiptJws('xfuel-public-t7', 10).replace(/.$/, 'A') },
  });
  const mismatch = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-t7.json', inclusionFor(root)),
    '--head', write('head-t7.json', headFor(root)),
    '--jws', forged,
  ]);
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.json.reason, 'public_full_mismatch');
  assert.equal(mismatch.json.verdict, 'FAILED');
  assert.doesNotMatch(mismatch.stdout, /PUBLIC_VERIFIED/);
  assert.doesNotMatch(mismatch.stdout, /"verdict": "VERIFIED"/);

  const alone = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-t7.json', inclusionFor(root)),
    '--head', write('head-t7.json', headFor(root)),
  ]);
  assert.equal(alone.status, 0, alone.stdout + alone.stderr);
  assert.equal(alone.json.verdict, 'PUBLIC_VERIFIED');
  assert.doesNotMatch(alone.stdout, /"verdict": "VERIFIED"/);

  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.doesNotMatch(help.stdout, /require-full/);
  const src = fs.readFileSync(path.join(pkgDir, 'src', 'cli.ts'), 'utf8');
  assert.doesNotMatch(src, /require-full|requireFull/);

  const flagged = run([
    write('t7-flag.jws', record),
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-t7.json', inclusionFor(root)),
    '--head', write('head-t7.json', headFor(root)),
    '--require-full',
  ]);
  assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
  assert.equal(flagged.json.verdict, 'PUBLIC_VERIFIED');
  assert.notEqual(flagged.json.verdict, 'VERIFIED');
});

test('a matching full receipt stays PUBLIC_VERIFIED', () => {
  const built = publicPayload('xfuel-public-match', 10);
  const file = write('match.jws', signJws(built.payload));
  const full = write('match-full.jws', built.full);
  const root = built.payload.leaf_hash;
  const result = run([
    file,
    full,
    '--json',
    '--jwks-file', jwksPath,
    '--inclusion', write('inclusion-match.json', inclusionFor(root)),
    '--head', write('head-match.json', headFor(root)),
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.verdict, 'PUBLIC_VERIFIED');
  assert.equal(result.json.scope, 'public');
});

test('issuer history is judged at public_signed_at', () => {
  const built = publicPayload('xfuel-public-history', 10);
  const file = write('history.jws', signJws(built.payload));
  const root = built.payload.leaf_hash;
  const open = write('history-open.json', historyDoc({ notBefore: '2026-10-01T00:00:00.000Z' }));
  const ok = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--issuer-history-file', open,
    '--inclusion', write('inclusion-history.json', inclusionFor(root)),
    '--head', write('head-history.json', headFor(root)),
  ]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(ok.json.leaf_binding, 'issuer_asserted');

  const early = publicPayload('xfuel-public-early', 10, { signedAt: '2020-06-01T00:00:00.000Z' });
  const earlyFile = write('early.jws', signJws(early.payload));
  const earlyRoot = early.payload.leaf_hash;
  const tooSoon = run([
    earlyFile,
    '--json',
    '--jwks-file', jwksPath,
    '--issuer-history-file', open,
    '--inclusion', write('inclusion-early.json', inclusionFor(earlyRoot)),
    '--head', write('head-early.json', headFor(earlyRoot)),
  ]);
  assert.equal(tooSoon.status, 1);
  assert.equal(tooSoon.json.reason, 'issued_before_not_before');
  assert.notEqual(tooSoon.json.verdict, 'PUBLIC_VERIFIED');

  const revoked = write('history-revoked.json', historyDoc({
    notBefore: '2026-01-01T00:00:00.000Z',
    status: 'revoked',
    revokedAt: '2026-10-01T00:00:00.000Z',
  }));
  const dead = run([
    file,
    '--json',
    '--jwks-file', jwksPath,
    '--issuer-history-file', revoked,
    '--inclusion', write('inclusion-revoked.json', inclusionFor(root)),
    '--head', write('head-revoked.json', headFor(root)),
  ]);
  assert.equal(dead.status, 1);
  assert.equal(dead.json.reason, 'kid_revoked_before_issuance');
});

test('the receipt verifier does not call a public record VERIFIED', async () => {
  const built = publicPayload('xfuel-public-not-receipt', 10);
  const jws = signJws(built.payload);
  const result = await verifyReceipt({
    task_id: 'xfuel-public-not-receipt',
    issuer_signature: { jws, kid },
  }, { jwks, trustedKids: [], skipIssuerHistory: true, fetchIssuerHistory: false });
  assert.notEqual(result.overall, 'verified');
});
