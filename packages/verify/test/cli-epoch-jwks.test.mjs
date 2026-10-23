/**
 * The epoch signature check uses the same JWKS sources as the receipt check.
 * An embedded key still has to match the trusted-kid pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  EPOCH1_FINAL_ROOT,
  EPOCH1_FINAL_SIZE,
  EPOCH1_GENESIS_DIGEST,
  EPOCH2_OPENING_ROOT,
} = await import('../dist/epoch.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { verifyEpochRecord } = await import('../dist/epoch.js');

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}
function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function epochClaims() {
  return {
    epochs: [
      {
        epoch: 1,
        status: 'closed',
        final_root: EPOCH1_FINAL_ROOT,
        final_size: EPOCH1_FINAL_SIZE,
        genesis_digest: EPOCH1_GENESIS_DIGEST,
        prev_epoch_root: null,
        prev_epoch_size: 0,
      },
      {
        epoch: 2,
        status: 'open',
        opening_root: EPOCH2_OPENING_ROOT,
        opening_size: 1,
        prev_epoch_root: EPOCH1_FINAL_ROOT,
        prev_epoch_size: EPOCH1_FINAL_SIZE,
      },
    ],
    orphans: [
      { root: '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9' },
      { root: null, root_prefix: 'd7f6c548', unrecoverable: true },
      { root: EPOCH2_OPENING_ROOT },
    ],
  };
}

function signCompact(claims, privateKey, kid, typ) {
  const header = { alg: 'ES256', typ, kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function signEpoch(claims, privateKey, kid) {
  return signCompact(claims, privateKey, kid, 'chit402-tree-epoch+jwt');
}

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  const claims = epochClaims();
  const jws = signEpoch(claims, privateKey, kid);
  const taskId = 'task-epoch';
  const rowHash = 'row-hash-epoch';
  const leaf = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash}`)]));
  const sibling = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from('genesis')]));
  const root = nodeHash(sibling, leaf).toString('hex');
  const receiptClaims = {
    task_id: taskId,
    row_hash: rowHash,
    verification: { jwks_uri: 'https://api.chit402.com/.well-known/jwks.json' },
    payload_version: 6,
  };
  const receipt = {
    ...receiptClaims,
    issuer_signature: {
      alg: 'ES256',
      jws: signCompact(receiptClaims, privateKey, kid, 'chit402-receipt+jwt'),
      kid,
      issuer_jwk: publicJwk,
    },
  };
  const inclusion = {
    task_id: taskId,
    leaf_index: 1,
    tree_size: 2,
    root,
    leaf: leaf.toString('hex'),
    proof: [{ hash: sibling.toString('hex'), position: 'left' }],
  };
  const head = {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 2,
    prev_epoch_root: EPOCH1_FINAL_ROOT,
    prev_epoch_size: EPOCH1_FINAL_SIZE,
    root,
    tree_size: 2,
    anchors: {
      base: { status: 'pending', tx: null, calldata: `0x${root}`, chain_id: 8453 },
      solana: { status: 'pending', signature: null, slot: null, cluster: 'devnet', memo: null, fee_payer: null },
    },
  };
  const headClaims = JSON.parse(JSON.stringify(head));
  head.issuer_signature = {
    jws: signCompact(headClaims, privateKey, kid, 'chit402-tree-head+jwt'),
    kid,
    issuer_jwk: publicJwk,
  };
  const record = {
    schema: 'chit402.tree_epoch.v1',
    ...claims,
    issuer_signature: { jws, kid, issuer_jwk: publicJwk },
  };
  return { publicJwk, kid, receipt, inclusion, head, record };
}

function runCli(fx, args, env) {
  const dir = tempDir('chit-epoch-jwks-');
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(fx.receipt));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(fx.inclusion));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fx.head));
  writeFileSync(join(dir, 'epoch.json'), JSON.stringify(fx.record));
  const cli = join(pkgDir, 'dist', 'cli.js');
  // --import is an ESM specifier. A raw C:\ path is parsed as protocol "c:"
  // and Node exits ERR_UNSUPPORTED_ESM_URL_SCHEME before the CLI runs.
  const preload = pathToFileURL(fileURLToPath(new URL('./jwks-fetch-preload.mjs', import.meta.url))).href;
  return spawnSync(process.execPath, [
    '--import', preload,
    cli,
    join(dir, 'receipt.json'),
    join(dir, 'inclusion.json'),
    join(dir, 'head.json'),
    '--epoch-record', join(dir, 'epoch.json'),
    '--rpc', 'http://127.0.0.1:9',
    '--no-preimage',
    '--json',
    ...args,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function errorsOf(run) {
  const body = `${run.stdout || ''}`;
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  return { parsed, text: body + (run.stderr || '') };
}

test('epoch signature is checked in the library and the CLI trust flags are removed', () => {
  const fx = fixture();
  const trusted = verifyEpochRecord(fx.record, { verifySignature: () => true });
  assert.equal(trusted.ok, true, trusted.reason);
  const closed = verifyEpochRecord(fx.record, { verifySignature: () => false });
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'epoch_signature_invalid');

  const run = runCli(fx, ['--jwks-url', 'https://127.0.0.1/jwks.json', '--no-trusted-kid'], {});
  const out = errorsOf(run);
  assert.equal(run.status, 1, out.text);
  assert.equal(out.parsed?.reason, 'removed_flag');
  assert.match(out.parsed?.message || '', /removed in 0\.4: --epoch-record is not a verifier flag/);
  assert.notEqual(out.parsed?.result, 'verified');
});
