/**
 * Epoch-1 fixture shaped like production. Base and Solana RPC are local.
 * getGenesisHash returns the literal mainnet hash, not SOLANA_GENESIS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  EPOCH1_FINAL_ROOT,
  EPOCH1_FINAL_SIZE,
  EPOCH1_GENESIS_DIGEST,
  EPOCH1_SIZE2_ROOT,
  EPOCH2_OPENING_ROOT,
} = await import('../dist/epoch.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
} = await import('../dist/anchor-trust.js');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const BASE_TX = '0x1d8d7ea255170c8d4b87bef9382e13555dded2072fd877ce35f995f1ab54ee09';
const SOLANA_SIG = '61RHMsPPseUc35v5oxDEtANEDCvXk5fmxZdrFDMknGWc5m7U8YhMfz4En1eFFj3z9n67ZtMiha1zkwnneL2LUiXk';
const SOLANA_MEMO = `chit402:root:v1:global:2026-10-03:${EPOCH1_FINAL_ROOT}:${EPOCH1_SIZE2_ROOT}`;
const TASK_ID = 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af';
const ROW_HASH = 'bf860968fe13f05ad1e09b7ef29248c18c537509ae916718032a3d9ac7d05f46';

function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function epochClaims() {
  return {
    schema: 'chit402.tree_epoch.v1',
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
        genesis_digest: '847edd6698d938721c0c59466a601d65cb82c1fdc0abd80104e1132f0cbaa576',
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

function productionFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  const claims = epochClaims();
  const receipt = {
    task_id: TASK_ID,
    book_chain: { row_hash: ROW_HASH },
  };
  const leaf = createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${TASK_ID}|${ROW_HASH}`)]))
    .digest('hex');
  const inclusion = {
    schema: 'chit402.inclusion.v1',
    payload_version: 2,
    epoch: 1,
    prev_epoch_root: null,
    prev_epoch_size: 0,
    task_id: TASK_ID,
    leaf_index: 1,
    leaf,
    tree_size: 4,
    root: EPOCH1_FINAL_ROOT,
    proof: [
      { hash: '8665a0fcb74c2cfeca3a356efe18fe878cf94c21cd38da6b19a2bb57629bc35c', position: 'left' },
      { hash: 'bd433c6e51348362592ab8e47bc32953fed8ec4811b75b42d503d0a72e793e5b', position: 'right' },
    ],
    anchor_status: 'anchored',
    anchor_tx: BASE_TX,
    solana_signature: SOLANA_SIG,
  };
  const head = {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 1,
    prev_epoch_root: null,
    prev_epoch_size: 0,
    root: EPOCH1_FINAL_ROOT,
    tree_size: 4,
    anchors: {
      base: {
        status: 'anchored',
        tx: BASE_TX,
        calldata: `0x${EPOCH1_FINAL_ROOT}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: SOLANA_SIG,
        slot: 452921175,
        cluster: 'mainnet-beta',
        memo: SOLANA_MEMO,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  };
  const headJws = signCompact(head, privateKey, kid, 'chit402-tree-head+jwt');
  head.issuer_signature = {
    alg: 'ES256',
    typ: 'chit402-tree-head+jwt',
    jws: headJws,
    kid,
    issuer_jwk: publicJwk,
  };
  const record = {
    ...claims,
    issuer_signature: { jws: signEpoch(claims, privateKey, kid), kid, issuer_jwk: publicJwk },
  };
  return { kid, publicJwk, receipt, inclusion, head, record };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('xfuel-verify passes an epoch-1 receipt against the real mainnet genesis hash', async () => {
  const fx = productionFixture();
  const rpc = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      let result = null;
      if (msg.method === 'getGenesisHash') result = MAINNET_GENESIS;
      else if (msg.method === 'getSignaturesForAddress') {
        result = [{ signature: SOLANA_SIG, err: null }];
      }
      else if (msg.method === 'eth_chainId') result = '0x2105';
      else if (msg.method === 'eth_getTransactionByHash') {
        result = { hash: BASE_TX, input: `0x${EPOCH1_FINAL_ROOT}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
      } else if (msg.method === 'getTransaction') {
        result = {
          slot: 452921175,
          meta: { err: null },
          transaction: {
            message: {
              accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true, writable: true }],
              instructions: [{
                program: 'spl-memo',
                programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
                parsed: SOLANA_MEMO,
              }],
            },
          },
        };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  const port = await listen(rpc);
  const dir = mkdtempSync(join(tmpdir(), 'chit-epoch1-rpc-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(fx.receipt));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(fx.inclusion));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fx.head));
  writeFileSync(join(dir, 'epoch.json'), JSON.stringify(fx.record));
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [fx.publicJwk] }));
  const cli = join(pkgDir, 'dist', 'cli.js');
  const url = `http://127.0.0.1:${port}`;
  try {
    const run = await runCli([
      cli,
      join(dir, 'receipt.json'),
      join(dir, 'inclusion.json'),
      join(dir, 'head.json'),
      '--rpc', url,
      '--solana-rpc', url,
      '--epoch-record', join(dir, 'epoch.json'),
      '--jwks-file', join(dir, 'jwks.json'),
      '--trusted-kid', fx.kid,
      '--no-issuer-history',
    ]);
    const text = `${run.stdout || ''}\n${run.stderr || ''}`;
    assert.equal(run.status, 0, text);
    assert.match(run.stdout, /Inclusion:\s+✓ YES/);
    assert.match(run.stdout, /Base:\s+✓ YES/);
    assert.match(run.stdout, /Solana:\s+✓ YES/);
    assert.match(run.stdout, /Overall: VERIFIED/);
    assert.equal(text.includes('cluster_mismatch'), false);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('an unpublished head is reported as not_yet_published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-unpublished-'));
  const head = {
    schema: 'chit402.tree_head.v2',
    status: 'not_yet_published',
    published: false,
    epoch: 2,
    prev_epoch_root: EPOCH1_FINAL_ROOT,
    prev_epoch_size: 4,
    tree_size: 1,
    root: EPOCH2_OPENING_ROOT,
  };
  const headPath = join(dir, 'head.json');
  writeFileSync(headPath, JSON.stringify(head));
  const cli = join(pkgDir, 'dist', 'cli.js');
  for (const args of [[headPath, '--rpc'], ['--head', headPath, '--rpc']]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    const text = `${run.stdout || ''}\n${run.stderr || ''}`;
    assert.equal(run.status, 3, text);
    assert.match(run.stderr, /not_yet_published/);
    assert.equal(text.includes('Anchor check needs a receipt, an inclusion proof, and a tree head.'), false);
  }
  const rpcUrl = 'https://mainnet.base.org';
  for (const args of [[headPath, '--rpc', rpcUrl], ['--rpc', rpcUrl, headPath]]) {
    const run = spawnSync(process.execPath, [cli, ...args, '--solana-rpc', rpcUrl], { encoding: 'utf8' });
    const text = `${run.stdout || ''}\n${run.stderr || ''}`;
    assert.equal(run.status, 3, text);
    assert.match(run.stderr, /not_yet_published/);
    assert.equal(text.includes('missing task_id'), false);
  }
});

test('--version prints the package version', () => {
  const cli = join(pkgDir, 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^@xfuel\/verify \d+\.\d+\.\d+\s*$/);
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(run.stdout.trim(), `@xfuel/verify ${pkg.version}`);
});

test('a not_in_tree inclusion file is not reported as bad_root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-not-in-tree-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ task_id: TASK_ID, book_chain: { row_hash: ROW_HASH } }));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify({ error: 'not_in_tree', task_id: TASK_ID }));
  writeFileSync(join(dir, 'head.json'), JSON.stringify({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: EPOCH1_FINAL_ROOT,
    tree_size: 4,
  }));
  const cli = join(pkgDir, 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [
    cli,
    join(dir, 'receipt.json'),
    join(dir, 'inclusion.json'),
    join(dir, 'head.json'),
    '--rpc',
    '--no-issuer-history',
  ], { encoding: 'utf8' });
  const text = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 1, text);
  assert.match(run.stdout, /not_in_tree/);
  assert.equal(text.includes('bad_root'), false);
});

test('an unpublished head with a receipt and inclusion is not_yet_published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-unpublished-full-'));
  const head = {
    schema: 'chit402.tree_head.v2',
    status: 'not_yet_published',
    published: false,
    epoch: 2,
    prev_epoch_root: EPOCH1_FINAL_ROOT,
    prev_epoch_size: 4,
    tree_size: 1,
    root: EPOCH2_OPENING_ROOT,
  };
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ task_id: TASK_ID, book_chain: { row_hash: ROW_HASH } }));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify({
    task_id: TASK_ID,
    leaf_index: 1,
    tree_size: 4,
    root: EPOCH1_FINAL_ROOT,
    proof: [],
  }));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(head));
  const cli = join(pkgDir, 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [
    cli,
    join(dir, 'receipt.json'),
    join(dir, 'inclusion.json'),
    join(dir, 'head.json'),
    '--rpc', 'https://mainnet.base.org',
    '--solana-rpc', 'https://api.mainnet-beta.solana.com',
    '--epoch-url', 'https://api.chit402.com/v1/receipts/tree/epoch',
    '--no-issuer-history',
  ], { encoding: 'utf8' });
  const text = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 3, text);
  assert.match(run.stderr, /not_yet_published/);
  assert.equal(text.includes('root_mismatch'), false);
  assert.equal(text.includes('missing task_id'), false);
});
