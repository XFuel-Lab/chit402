/**
 * T22–T23. Inclusion size is checked before the head compare.
 * 0.3.5 is the tree at 484c5b7e, built in a temp directory.
 * 0.3.6 is this workspace. Nothing here is published.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const COMMIT_035 = '484c5b7e6657aed4a56a78f2a3b4b5c1ff0271b2';

execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const { verifyReceipt } = await import('../dist/index.js');
const { headTrustedFromInclusion, PINNED_BASE_ANCHOR_WALLET, PINNED_SOLANA_ANCHOR_FEE_PAYER } = await import('../dist/anchor-trust.js');
const { SOLANA_GENESIS } = await import('../dist/anchor-witness.js');
const { jwkThumbprint } = await import('../dist/jws.js');

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

function seal(doc, key, typ) {
  const { issuer_signature: _ignored, ...rest } = doc;
  const claims = JSON.parse(JSON.stringify(rest));
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ,
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function sealHead(head, key) {
  return seal(head, key, 'chit402-tree-head+jwt');
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function rootOf(leaves) {
  let level = leaves.map((leaf) => Buffer.from(leaf));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

function inclusionProof(leaves, index) {
  const proof = [];
  let idx = index;
  let level = leaves.map((leaf) => Buffer.from(leaf));
  while (level.length > 1) {
    const sibling = idx ^ 1;
    if (sibling < level.length) {
      proof.push({
        hash: level[sibling].toString('hex'),
        position: sibling < idx ? 'left' : 'right',
      });
    }
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

function makeHead(root, size, key, tx, solanaSig) {
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-10-08:${root}:${prev}`;
  return sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: size,
    anchors: {
      base: {
        status: 'anchored',
        tx,
        calldata: `0x${root}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: solanaSig,
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  }, key);
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

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const key = issuerKey();
const foreign = issuerKey();
const bodies = Array.from({ length: 11 }, (_, i) => `t${i}|r${i}`);
const leaves = bodies.map((body) => sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])));
const root4 = rootOf(leaves.slice(0, 4)).toString('hex');
const root11 = rootOf(leaves).toString('hex');
const head4 = makeHead(root4, 4, key, `0x${'ab'.repeat(32)}`, 'sig-size-4');
const head11 = makeHead(root11, 11, key, `0x${'cd'.repeat(32)}`, 'sig-size-11');

function proofInclusion(size) {
  const slice = leaves.slice(0, size);
  const root = size === 4 ? root4 : root11;
  return {
    task_id: 't1',
    status: 'anchored',
    anchor_status: 'anchored',
    leaf_index: 1,
    tree_size: size,
    root,
    leaf: leaves[1].toString('hex'),
    row_hash: 'r1',
    proof: inclusionProof(slice, 1),
    anchor_confirmed_by: 'signed_head',
    head_url: `/v1/receipts/tree/head?tree_size=${size}`,
    anchored_signed: true,
  };
}

const inc4 = proofInclusion(4);
const inc11 = proofInclusion(11);
const incDefault = {
  ...inc11,
  head: {
    tree_size: 11,
    root: root11,
    signature: head11.issuer_signature,
    anchored: true,
    anchored_signed: true,
  },
};

function signedV6() {
  return seal({
    task_id: 't1',
    book_chain: { row_hash: 'r1' },
    payload_version: 6,
  }, key, 'chit402-receipt+jwt');
}

function signedV9(treeHeadHash) {
  return seal({
    task_id: 't1',
    book_chain: { row_hash: 'r1' },
    payload_version: 9,
    tree_head_hash: treeHeadHash,
    tolerance: { base: 300, solana: 150 },
  }, key, 'chit402-receipt+jwt');
}

const jwks = { keys: [key.publicJwk] };
const trust = { jwks, trustedKids: [key.kid], requirePreimages: false, skipIssuerHistory: true };

test('T22 a size mismatch is tree_size_mismatch in the signed flow and offline', async () => {
  const receipt = signedV9(root4);
  const sized = await verifyReceipt(receipt, {
    ...trust,
    head: head11,
    inclusion: inc4,
  });
  assert.equal(sized.overall, 'failed');
  assert.notEqual(sized.overall, 'verified');
  assert.ok(sized.errors.includes('tree_size_mismatch'), sized.errors.join(','));
  assert.equal(sized.errors.includes('tree_head_mismatch'), false, sized.errors.join(','));
  assert.equal(sized.errors.includes('inclusion_failed'), false, sized.errors.join(','));

  const pending = await verifyReceipt(receipt, {
    ...trust,
    head: head11,
    inclusion: {
      ...inc4,
      status: 'pending_anchor',
      anchor_status: 'pending',
      proof: null,
    },
  });
  assert.equal(pending.overall, 'failed');
  assert.notEqual(pending.overall, 'verified');
  assert.ok(pending.errors.includes('tree_size_mismatch'), pending.errors.join(','));
  assert.equal(pending.errors.includes('tree_head_mismatch'), false, pending.errors.join(','));
  assert.equal(pending.errors.includes('inclusion_failed'), false, pending.errors.join(','));

  const sameSizeNull = await verifyReceipt(signedV6(), {
    ...trust,
    head: head4,
    inclusion: { ...inc4, proof: null, leaf_index: 1 },
  });
  assert.equal(sameSizeNull.overall, 'failed');
  assert.notEqual(sameSizeNull.overall, 'verified');
  assert.ok(sameSizeNull.errors.includes('inclusion_failed'), sameSizeNull.errors.join(','));
  assert.equal(sameSizeNull.errors.includes('tree_size_mismatch'), false);
  assert.equal(sameSizeNull.errors.includes('tree_head_mismatch'), false);

  const dir = mkdtempSync(join(tmpdir(), 'chit-t22-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify({ ...inc4, proof: null, status: 'pending_anchor' }));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(head11));
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify(jwks));
  const cli = join(pkgDir, 'dist', 'cli.js');
  const offline = await runCli([
    cli,
    join(dir, 'receipt.json'),
    join(dir, 'inclusion.json'),
    join(dir, 'head.json'),
    '--json',
    '--jwks-file', join(dir, 'jwks.json'),
    '--trusted-kid', key.kid,
    '--no-issuer-history',
    '--no-preimage',
  ]);
  assert.notEqual(offline.status, 0, offline.stderr);
  const parsed = JSON.parse(offline.stdout);
  assert.notEqual(parsed.overall, 'verified');
  assert.ok(parsed.errors.includes('tree_size_mismatch'), parsed.errors.join(','));
  assert.equal(parsed.errors.includes('tree_head_mismatch'), false, parsed.errors.join(','));
  rmSync(dir, { recursive: true, force: true });
});

test('T22 inclusion.head is trusted only through a pinned key or JWKS', async () => {
  const adopted = headTrustedFromInclusion({
    head: {
      tree_size: 11,
      root: root11,
      signature: { ...head11.issuer_signature, issuer_jwk: foreign.publicJwk },
    },
  }, { jwks, trustedKids: [key.kid] });
  assert.ok(adopted);
  assert.equal(adopted.root, root11);
  assert.equal(adopted.tree_size, 11);
  assert.equal(adopted.issuer_signature.issuer_jwk, undefined);

  const pinnedOnly = headTrustedFromInclusion({
    head: { tree_size: 4, root: root4, signature: head4.issuer_signature },
  }, { trustedKids: [key.kid] });
  assert.equal(pinnedOnly?.root, root4);
  assert.equal(pinnedOnly.issuer_signature.issuer_jwk.kid, key.kid);

  const unpinned = headTrustedFromInclusion({
    head: { tree_size: 11, root: root11, signature: head11.issuer_signature },
  }, { trustedKids: [] });
  assert.equal(unpinned, null);

  const lied = headTrustedFromInclusion({
    head: { tree_size: 4, root: root4, signature: head11.issuer_signature },
  }, { jwks, trustedKids: [key.kid] });
  assert.equal(lied, null);

  const viaSummary = await verifyReceipt(signedV6(), {
    ...trust,
    inclusion: {
      ...inc4,
      proof: null,
      head: {
        tree_size: 11,
        root: root11,
        signature: head11.issuer_signature,
      },
    },
  });
  assert.equal(viaSummary.overall, 'failed');
  assert.notEqual(viaSummary.overall, 'verified');
  assert.ok(viaSummary.errors.includes('tree_size_mismatch'), viaSummary.errors.join(','));

  const ignored = await verifyReceipt(signedV6(), {
    ...trust,
    trustedKids: [],
    jwks: { keys: [] },
    inclusion: {
      ...inc4,
      proof: null,
      head: {
        tree_size: 11,
        root: root11,
        signature: head11.issuer_signature,
      },
    },
  });
  assert.equal(ignored.overall, 'failed');
  assert.notEqual(ignored.overall, 'verified');
  assert.equal(ignored.errors.includes('tree_size_mismatch'), false, ignored.errors.join(','));
  assert.ok(ignored.errors.includes('inclusion_failed'), ignored.errors.join(','));

  const suppliedWins = await verifyReceipt(signedV6(), {
    ...trust,
    head: head4,
    inclusion: {
      ...inc4,
      head: {
        tree_size: 11,
        root: root11,
        signature: head11.issuer_signature,
      },
    },
  });
  assert.equal(suppliedWins.errors.includes('tree_size_mismatch'), false, suppliedWins.errors.join(','));
  assert.equal(suppliedWins.errors.includes('inclusion_failed'), false, suppliedWins.errors.join(','));
});

function build035() {
  const dir = mkdtempSync(join(tmpdir(), 'chit-verify-035-'));
  execSync(`git archive ${COMMIT_035} packages/verify | tar -x -C ${JSON.stringify(dir)}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const packed = join(dir, 'packages', 'verify');
  execSync('npm ci --ignore-scripts', { cwd: packed, stdio: 'pipe' });
  execSync('npm run build', { cwd: packed, stdio: 'pipe' });
  return join(packed, 'dist', 'cli.js');
}

test('T23 only a matching inclusion and head can verify', async () => {
  const cli035 = build035();
  const cli036 = join(pkgDir, 'dist', 'cli.js');
  const dir = mkdtempSync(join(tmpdir(), 'chit-t23-'));
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(signedV6()));
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify(jwks));
  const jwksPath = join(dir, 'jwks.json');

  const rpc = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      let result = null;
      const hash = Array.isArray(msg.params) ? msg.params[0] : null;
      const head = hash === head4.anchors.base.tx || hash === head4.anchors.solana.signature ? head4 : head11;
      if (msg.method === 'getGenesisHash') result = SOLANA_GENESIS.devnet;
      else if (msg.method === 'eth_chainId') result = '0x2105';
      else if (msg.method === 'eth_getTransactionByHash') {
        result = {
          hash: head.anchors.base.tx,
          input: `0x${head.root}`,
          from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(),
        };
      } else if (msg.method === 'getSignaturesForAddress') {
        result = [{ signature: head11.anchors.solana.signature, err: null }];
      } else if (msg.method === 'getTransaction') {
        result = {
          slot: 99,
          meta: { err: null },
          transaction: {
            message: {
              accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true, writable: true }],
              instructions: [{
                program: 'spl-memo',
                programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
                parsed: head.anchors.solana.memo,
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
  const url = `http://127.0.0.1:${port}`;

  const inclusionFiles = {
    default: join(dir, 'inc-default.json'),
    ts4: join(dir, 'inc-ts4.json'),
    ts11: join(dir, 'inc-ts11.json'),
  };
  const headFiles = {
    '/tree/head': join(dir, 'head-latest.json'),
    head4: join(dir, 'head4.json'),
    head11: join(dir, 'head11.json'),
  };
  writeFileSync(inclusionFiles.default, JSON.stringify(incDefault));
  writeFileSync(inclusionFiles.ts4, JSON.stringify(inc4));
  writeFileSync(inclusionFiles.ts11, JSON.stringify(inc11));
  writeFileSync(headFiles['/tree/head'], JSON.stringify(head11));
  writeFileSync(headFiles.head4, JSON.stringify(head4));
  writeFileSync(headFiles.head11, JSON.stringify(head11));

  const clis = { '0.3.5': cli035, '0.3.6': cli036 };
  const sizeCodes = /tree_size_mismatch|tree_head_mismatch|root_mismatch|head_size_mismatch/;
  let runs = 0;
  try {
    for (const incName of ['default', 'ts4', 'ts11']) {
      for (const headName of ['/tree/head', 'head4', 'head11']) {
        const pair = (incName === 'ts4' ? 4 : 11) === (headName === 'head4' ? 4 : 11);
        for (const version of ['0.3.5', '0.3.6']) {
          for (const mode of ['offline', 'rpc']) {
            runs += 1;
            const args = [
              clis[version],
              receiptPath,
              inclusionFiles[incName],
              headFiles[headName],
              '--json',
              '--jwks-file', jwksPath,
              '--trusted-kid', key.kid,
              '--no-issuer-history',
              '--no-preimage',
            ];
            if (mode === 'rpc') args.push('--rpc', url, '--solana-rpc', url);
            const run = await runCli(args);
            const label = `${version} ${mode} ${incName} x ${headName}`;
            let parsed;
            try {
              parsed = JSON.parse(run.stdout);
            } catch {
              assert.fail(`${label} did not print JSON\n${run.stdout}\n${run.stderr}`);
            }
            const errors = [
              ...(parsed.errors || []),
              parsed.inclusion?.reason,
              ...(parsed.receipt_check?.errors || []),
            ].filter(Boolean).join(',');
            if (pair) {
              assert.equal(sizeCodes.test(errors), false, `${label} size/root: ${errors}`);
              if (parsed.overall === 'verified') assert.equal(run.status, 0, label);
            } else {
              assert.notEqual(parsed.overall, 'verified', label);
              assert.notEqual(run.status, 0, label);
              assert.match(errors, sizeCodes, `${label} errors ${errors}`);
            }
          }
        }
      }
    }
    assert.equal(runs, 36);

    const failedText = await runCli([
      cli036,
      receiptPath,
      inclusionFiles.ts4,
      headFiles.head11,
      '--rpc', url,
      '--solana-rpc', url,
      '--jwks-file', jwksPath,
      '--trusted-kid', key.kid,
      '--no-issuer-history',
      '--no-preimage',
    ]);
    assert.notEqual(failedText.status, 0);
    assert.match(failedText.stdout, /Overall: FAILED/);
    assert.equal(failedText.stdout.includes('This receipt leaf is inside the tree'), false);
    assert.equal(failedText.stdout.includes('What this proves'), false);

    const proved = await runCli([
      cli036,
      receiptPath,
      inclusionFiles.ts11,
      headFiles.head11,
      '--rpc', url,
      '--solana-rpc', url,
      '--jwks-file', jwksPath,
      '--trusted-kid', key.kid,
      '--no-issuer-history',
      '--no-preimage',
    ]);
    assert.equal(proved.status, 0, `${proved.stdout}\n${proved.stderr}`);
    assert.match(proved.stdout, /Overall: VERIFIED/);
    assert.match(proved.stdout, /What this proves/);
    assert.match(proved.stdout, /This receipt leaf is inside the tree/);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
