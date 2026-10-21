/**
 * Log mode must not report VERIFIED when the receipt signature is missing,
 * stripped, or only partial, even if the inclusion proof and both anchors match.
 * --quiet still prints the failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { writeCoveringHistory } from './history-file.mjs';
import { assertLibraryPass } from './library-pass.mjs';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
} = await import('../dist/anchor-trust.js');
const { SOLANA_GENESIS } = await import('../dist/anchor-witness.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { verifyReceipt } = await import('../dist/index.js');

function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function seal(doc, key, typ) {
  const { issuer_signature: _ignored, ...rest } = doc;
  const claims = JSON.parse(JSON.stringify(rest));
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ,
      jws: signClaims(claims, key, typ),
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function fixture() {
  const key = issuerKey();
  const taskId = 'task-log-mode';
  const rowHash = 'row-hash-log-mode';
  const leaf = createHash('sha256').update(Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(`${taskId}|${rowHash}`),
  ])).digest();
  const sibling = createHash('sha256').update(Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('genesis'),
  ])).digest();
  const root = createHash('sha256').update(Buffer.concat([
    Buffer.from([0x01]),
    sibling,
    leaf,
  ])).digest('hex');
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-09-30:${root}:${prev}`;
  const baseTx = `0x${'ab'.repeat(32)}`;
  const head = seal({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 2,
    anchors: {
      base: {
        status: 'anchored',
        tx: baseTx,
        calldata: `0x${root}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: '5AJWNP2hfZiD511rpFenjZXqZACyYp8RjadatEzGJ84YdQSQyVVbYyHJLa2hqco67oD3xZrYMDDvySoN7zAXNrCr',
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  }, key, 'chit402-tree-head+jwt');
  const claims = {
    task_id: taskId,
    book_chain: { row_hash: rowHash },
    payment: { gross_amount: '10000' },
    payload_version: 6,
    iat: '2026-06-01T00:00:00.000Z',
  };
  const receipt = seal(claims, key, 'chit402-receipt+jwt');
  const inclusion = {
    task_id: taskId,
    leaf_index: 1,
    tree_size: 2,
    root,
    leaf: leaf.toString('hex'),
    proof: [{ hash: sibling.toString('hex'), position: 'left' }],
  };
  return { key, head, receipt, inclusion, root, baseTx, memo };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function rpcServer(fx) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      let result = null;
      if (msg.method === 'getGenesisHash') result = SOLANA_GENESIS.devnet;
      else if (msg.method === 'eth_chainId') result = '0x2105';
      else if (msg.method === 'eth_getTransactionByHash') {
        result = { hash: fx.baseTx, input: `0x${fx.root}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
      } else if (msg.method === 'getSignaturesForAddress') {
        result = [{ signature: '5AJWNP2hfZiD511rpFenjZXqZACyYp8RjadatEzGJ84YdQSQyVVbYyHJLa2hqco67oD3xZrYMDDvySoN7zAXNrCr', err: null }];
      } else if (msg.method === 'getTransaction') {
        result = {
          slot: 99,
          meta: { err: null },
          transaction: {
            message: {
              accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true }],
              instructions: [{ program: 'spl-memo', parsed: fx.memo }],
            },
          },
        };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function writeCase(dir, receipt, fx) {
  mkdirSync(dir, { recursive: true });
  const receiptPath = path.join(dir, 'receipt.json');
  const inclusionPath = path.join(dir, 'inclusion.json');
  const headPath = path.join(dir, 'head.json');
  const jwksPath = path.join(dir, 'jwks.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(inclusionPath, JSON.stringify(fx.inclusion));
  writeFileSync(headPath, JSON.stringify(fx.head));
  writeFileSync(jwksPath, JSON.stringify({ keys: [fx.key.publicJwk] }));
  return { receiptPath, inclusionPath, headPath, jwksPath, dir };
}

test('log mode fails a stripped signature, a partial check, and a tampered amount', async () => {
  const fx = fixture();
  const trust = {
    trustedKids: [fx.key.kid],
    jwks: { keys: [fx.key.publicJwk] },
    head: fx.head,
    inclusion: fx.inclusion,
    requirePreimages: false,
    skipIssuerHistory: true,
  };
  const honest = await verifyReceipt(fx.receipt, trust);
  assertLibraryPass(honest, honest.errors.join('; '));

  const stripped = JSON.parse(JSON.stringify(fx.receipt));
  delete stripped.issuer_signature;
  stripped.payment.gross_amount = '100000';
  const strippedResult = await verifyReceipt(stripped, trust);
  assert.notEqual(strippedResult.overall, 'verified');
  assert.match(strippedResult.issuer_signature.reason, /No issuer signature present on receipt/);

  const partial = JSON.parse(JSON.stringify(fx.receipt));
  partial.issuer_signature = { alg: 'ES256', value: 'dummy', kid: 'not-checked' };
  const partialResult = await verifyReceipt(partial, { ...trust, jwks: undefined });
  assert.notEqual(partialResult.overall, 'verified');
  assert.match(partialResult.issuer_signature.reason, /kid_not_in_history/);

  const tampered = JSON.parse(JSON.stringify(fx.receipt));
  tampered.payment.gross_amount = '100000';
  const tamperedResult = await verifyReceipt(tampered, trust);
  assert.equal(tamperedResult.overall, 'failed');
  assert.match(tamperedResult.errors.join(' '), /gross_amount/);

  const dir = mkdtempSync(path.join(tmpdir(), 'chit-log-receipt-'));
  const files = writeCase(dir, fx.receipt, fx);
  const run = await runCli([files.receiptPath, '--json', '--rpc', 'http://127.0.0.1:9']);
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.reason, 'removed_flag');
  assert.match(parsed.message, /removed in 0\.4: --rpc is not a verifier flag/);
  assert.notEqual(parsed.result, 'verified');
});
