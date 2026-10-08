/**
 * Leaves newer than the anchored head are PENDING.
 * Chain calls are injected or served by a local RPC. No mainnet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  verifyAnchoredRoot,
  verifyMerkleInclusion,
  leafHash,
  SOLANA_GENESIS,
  fetchNewestSolanaAnchorRoot,
  NEWEST_ANCHOR_PAGE_LIMIT,
  NEWEST_ANCHOR_PAGE_CAP,
} = await import('../dist/anchor-witness.js');
const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
  ANCHOR_WALLETS_SCHEMA,
} = await import('../dist/anchor-trust.js');
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

function signedReceipt(key, taskId, rowHash) {
  const claims = rowHash
    ? { task_id: taskId, book_chain: { row_hash: rowHash } }
    : { task_id: taskId };
  return seal(claims, key, 'chit402-receipt+jwt');
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

function epoch2Fixture() {
  const bodies = ['genesis|rg', 'a|ra', 'b|rb', 'c|rc', 'd|rd'];
  const leaves = bodies.map((body) => sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])));
  const anchored = leaves.slice(0, 4);
  const root = rootOf(anchored).toString('hex');
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-10-08:${root}:${prev}`;
  const key = issuerKey();
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 4,
    anchors: {
      base: {
        status: 'anchored',
        tx: `0x${'ab'.repeat(32)}`,
        calldata: `0x${root}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: 'sig-anchored-4',
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  }, key);
  const ids = ['genesis', 'a', 'b', 'c', 'd'];
  const rows = ['rg', 'ra', 'rb', 'rc', 'rd'];
  return { leaves, root, memo, key, head, ids, rows };
}

function solanaTx(memo) {
  return {
    slot: 99,
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true, writable: true }],
        instructions: [{
          program: 'spl-memo',
          programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
          parsed: memo,
        }],
      },
    },
  };
}

function fetchers(fx, newestRoot = fx.root) {
  return {
    fetchSolanaTx: async () => solanaTx(fx.memo),
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => ({
      hash: fx.head.anchors.base.tx,
      input: `0x${fx.root}`,
      chainId: 8453,
      from: PINNED_BASE_ANCHOR_WALLET,
    }),
    fetchNewestAnchor: async () => ({ root: newestRoot, signature: 'sig-anchored-4' }),
  };
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

test('a proof is not verified when its head is not anchored', async () => {
  const fx = epoch2Fixture();
  const pendingHead = sealHead({
    ...fx.head,
    issuer_signature: undefined,
    anchors: {
      base: { ...fx.head.anchors.base, status: 'pending', tx: null },
      solana: { ...fx.head.anchors.solana, status: 'pending', signature: null, fee_payer: null },
    },
  }, fx.key);
  const inclusion = {
    task_id: 'a',
    status: 'anchored',
    anchor_status: 'anchored',
    leaf_index: 1,
    tree_size: 4,
    root: fx.root,
    leaf: fx.leaves[1].toString('hex'),
    proof: inclusionProof(fx.leaves.slice(0, 4), 1),
  };
  const result = await verifyAnchoredRoot({
    receipt: { task_id: 'a', row_hash: 'ra' },
    inclusion,
    head: pendingHead,
    trustedKids: [fx.key.kid],
    ...fetchers(fx),
  });
  assert.equal(result.overall, 'failed');
  assert.ok(result.errors.includes('head_not_anchored'));
  assert.notEqual(result.overall, 'verified');
});

test('a forged head, a mismatched pair, and a swapped proof are rejected', async () => {
  const fx = epoch2Fixture();
  const inclusion = {
    task_id: 'a',
    leaf_index: 1,
    tree_size: 4,
    root: fx.root,
    leaf: fx.leaves[1].toString('hex'),
    proof: inclusionProof(fx.leaves.slice(0, 4), 1),
  };
  const receipt = { task_id: 'a', row_hash: 'ra' };
  const common = { receipt, trustedKids: [fx.key.kid], ...fetchers(fx), checkNewestAnchor: true };

  const unsigned = { ...fx.head };
  delete unsigned.issuer_signature;
  const missing = await verifyAnchoredRoot({ ...common, inclusion, head: unsigned });
  assert.equal(missing.overall, 'failed');
  assert.equal(missing.head_signature.reason, 'head_signature_missing');

  const forged = sealHead(fx.head, fx.key);
  forged.issuer_signature.jws = `${forged.issuer_signature.jws.slice(0, -4)}AAAA`;
  const badSig = await verifyAnchoredRoot({ ...common, inclusion, head: forged });
  assert.equal(badSig.overall, 'failed');
  assert.notEqual(badSig.head_signature.valid, true);

  const sizeMismatch = await verifyAnchoredRoot({
    ...common,
    head: fx.head,
    inclusion: { ...inclusion, tree_size: 2 },
  });
  assert.equal(sizeMismatch.overall, 'failed');
  assert.equal(sizeMismatch.inclusion.reason, 'tree_size_mismatch');

  const rootMismatch = await verifyAnchoredRoot({
    ...common,
    head: fx.head,
    inclusion: { ...inclusion, root: 'ab'.repeat(32) },
  });
  assert.equal(rootMismatch.overall, 'failed');
  assert.equal(rootMismatch.inclusion.reason, 'root_mismatch');

  const leaf = fx.leaves[1];
  assert.equal(verifyMerkleInclusion(leaf, 1, 4, fx.root, inclusion.proof), true);
  assert.equal(verifyMerkleInclusion(leaf, 0, 4, fx.root, inclusion.proof), false);
  const swapped = inclusion.proof.map((step, i) => (i === 0 ? { ...step, hash: 'cd'.repeat(32) } : step));
  assert.equal(verifyMerkleInclusion(leaf, 1, 4, fx.root, swapped), false);
  const flipped = inclusion.proof.map((step, i) => (
    i === 0 ? { ...step, position: step.position === 'left' ? 'right' : 'left' } : step
  ));
  assert.equal(verifyMerkleInclusion(leaf, 1, 4, fx.root, flipped), false);
  const sibling = await verifyAnchoredRoot({
    ...common,
    head: fx.head,
    inclusion: { ...inclusion, proof: swapped },
  });
  assert.equal(sibling.overall, 'failed');
  assert.equal(sibling.inclusion.reason, 'inclusion_failed');
});

test('epoch-2 style: leaves 0-3 verify with --rpc and leaf 4 is PENDING', async () => {
  const fx = epoch2Fixture();
  const rpc = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      let result = null;
      if (msg.method === 'getGenesisHash') result = SOLANA_GENESIS.devnet;
      else if (msg.method === 'eth_chainId') result = '0x2105';
      else if (msg.method === 'eth_getTransactionByHash') {
        result = { hash: fx.head.anchors.base.tx, input: `0x${fx.root}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
      } else if (msg.method === 'getSignaturesForAddress') {
        result = [{ signature: fx.head.anchors.solana.signature, err: null }];
      } else if (msg.method === 'getTransaction') {
        result = solanaTx(fx.memo);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  const port = await listen(rpc);
  const dir = mkdtempSync(join(tmpdir(), 'chit-pending-anchor-'));
  const url = `http://127.0.0.1:${port}`;
  const cli = join(pkgDir, 'dist', 'cli.js');
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [fx.key.publicJwk] }));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fx.head));
  try {
    for (let index = 0; index < 4; index += 1) {
      const receipt = signedReceipt(fx.key, fx.ids[index], fx.rows[index]);
      const inclusion = {
        task_id: fx.ids[index],
        status: 'anchored',
        anchor_status: 'anchored',
        leaf_index: index,
        tree_size: 4,
        live_tree_size: 5,
        anchored_tree_size: 4,
        root: fx.root,
        leaf: fx.leaves[index].toString('hex'),
        proof: inclusionProof(fx.leaves.slice(0, 4), index),
      };
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
      writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(inclusion));
      const run = await runCli([
        cli,
        join(dir, 'receipt.json'),
        join(dir, 'inclusion.json'),
        join(dir, 'head.json'),
        '--rpc', url,
        '--solana-rpc', url,
        '--jwks-file', join(dir, 'jwks.json'),
        '--trusted-kid', fx.key.kid,
        '--no-issuer-history',
        '--no-preimage',
      ]);
      const text = `${run.stdout}\n${run.stderr}`;
      assert.equal(run.status, 0, `${fx.ids[index]}\n${text}`);
      assert.match(run.stdout, /Overall: VERIFIED/);
    }

    const pending = {
      status: 'pending_anchor',
      anchor_status: 'pending',
      task_id: 'd',
      leaf_index: 4,
      tree_size: 4,
      live_tree_size: 5,
      anchored_tree_size: 4,
      root: fx.root,
      proof: null,
      head: {
        tree_size: 4,
        root: fx.root,
        signature: fx.head.issuer_signature,
        anchor_tx: fx.head.anchors.base.tx,
        anchor_chain: 'base,solana',
      },
    };
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(signedReceipt(fx.key, 'd', 'rd')));
    writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(pending));
    const late = await runCli([
      cli,
      join(dir, 'receipt.json'),
      join(dir, 'inclusion.json'),
      join(dir, 'head.json'),
      '--rpc', url,
      '--solana-rpc', url,
      '--jwks-file', join(dir, 'jwks.json'),
      '--trusted-kid', fx.key.kid,
      '--no-issuer-history',
      '--no-preimage',
    ]);
    const lateText = `${late.stdout}\n${late.stderr}`;
    assert.equal(late.status, 2, lateText);
    assert.match(late.stdout, /Overall: PENDING/);
    assert.match(late.stdout, /pending_anchor/);
    assert.equal(lateText.includes('VERIFIED'), false);
    assert.equal(lateText.includes('UNVERIFIED'), false);

    const jsonRun = await runCli([
      cli,
      join(dir, 'receipt.json'),
      join(dir, 'inclusion.json'),
      join(dir, 'head.json'),
      '--json',
      '--rpc', url,
      '--solana-rpc', url,
      '--jwks-file', join(dir, 'jwks.json'),
      '--trusted-kid', fx.key.kid,
      '--no-issuer-history',
      '--no-preimage',
    ]);
    assert.equal(jsonRun.status, 2, `${jsonRun.stdout}\n${jsonRun.stderr}`);
    const parsed = JSON.parse(jsonRun.stdout);
    assert.equal(parsed.overall, 'pending');
    assert.equal(parsed.receipt_check.overall, 'pending');

    const stripped = signedReceipt(fx.key, 'd', 'rd');
    delete stripped.issuer_signature;
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(stripped));
    const bare = await runCli([
      cli,
      join(dir, 'receipt.json'),
      join(dir, 'inclusion.json'),
      join(dir, 'head.json'),
      '--rpc', url,
      '--solana-rpc', url,
      '--jwks-file', join(dir, 'jwks.json'),
      '--trusted-kid', fx.key.kid,
      '--no-issuer-history',
      '--no-preimage',
    ]);
    const bareText = `${bare.stdout}\n${bare.stderr}`;
    assert.equal(bare.status, 1, bareText);
    assert.match(bare.stdout, /Overall: FAILED/);
    assert.equal(/(?<!UN)VERIFIED/.test(bareText), false);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('a stale head cannot hide a leaf when --rpc is set', async () => {
  const fx = epoch2Fixture();
  const newer = 'ee'.repeat(32);
  const inclusion = {
    task_id: 'a',
    status: 'anchored',
    anchor_status: 'anchored',
    leaf_index: 1,
    tree_size: 4,
    root: fx.root,
    leaf: fx.leaves[1].toString('hex'),
    proof: inclusionProof(fx.leaves.slice(0, 4), 1),
  };
  const hidden = await verifyAnchoredRoot({
    receipt: { task_id: 'a', row_hash: 'ra' },
    inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    ...fetchers(fx, newer),
  });
  assert.equal(hidden.overall, 'failed');
  assert.ok(hidden.errors.includes('stale_head'));
  assert.notEqual(hidden.overall, 'verified');

  const pending = {
    status: 'pending_anchor',
    anchor_status: 'pending',
    task_id: 'd',
    leaf_index: 4,
    tree_size: 4,
    anchored_tree_size: 4,
    live_tree_size: 5,
    root: fx.root,
    proof: null,
  };
  const stalePending = await verifyAnchoredRoot({
    receipt: { task_id: 'd', row_hash: 'rd' },
    inclusion: pending,
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    ...fetchers(fx, newer),
  });
  assert.equal(stalePending.overall, 'failed');
  assert.ok(stalePending.errors.includes('stale_head'));
  assert.notEqual(stalePending.overall, 'pending');

  const honest = await verifyAnchoredRoot({
    receipt: { task_id: 'd', row_hash: 'rd' },
    inclusion: pending,
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    ...fetchers(fx, fx.root),
  });
  assert.equal(honest.overall, 'pending');
  assert.equal(leafHash(Buffer.from('d|rd')).toString('hex'), fx.leaves[4].toString('hex'));
});

function pendingInclusion(extra = {}) {
  return {
    status: 'pending_anchor',
    anchor_status: 'pending',
    task_id: 'd',
    leaf_index: 4,
    tree_size: 4,
    anchored_tree_size: 4,
    live_tree_size: 5,
    root: null,
    proof: null,
    ...extra,
  };
}

test('an in-range pending leaf fails and a broken bound is not pending', async () => {
  const fx = epoch2Fixture();
  const common = {
    receipt: { task_id: 'd', row_hash: 'rd' },
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    ...fetchers(fx),
  };
  const inside = await verifyAnchoredRoot({
    ...common,
    inclusion: pendingInclusion({
      leaf_index: 1,
      proof: inclusionProof(fx.leaves.slice(0, 4), 1),
      root: fx.root,
    }),
  });
  assert.equal(inside.overall, 'failed');
  assert.ok(inside.errors.includes('pending_leaf_in_head'));
  assert.notEqual(inside.overall, 'pending');
  assert.notEqual(inside.overall, 'verified');

  const liveTooSmall = await verifyAnchoredRoot({
    ...common,
    inclusion: pendingInclusion({ leaf_index: 4, tree_size: 4, live_tree_size: 4, root: fx.root }),
  });
  assert.equal(liveTooSmall.overall, 'failed');
  assert.ok(liveTooSmall.errors.includes('pending_bounds'));

  const pastLive = await verifyAnchoredRoot({
    ...common,
    inclusion: pendingInclusion({ leaf_index: 5, tree_size: 4, live_tree_size: 5, root: fx.root }),
  });
  assert.equal(pastLive.overall, 'failed');
  assert.ok(pastLive.errors.includes('pending_bounds'));

  const leadingZero = await verifyAnchoredRoot({
    ...common,
    inclusion: pendingInclusion({ leaf_index: 4, tree_size: '04', live_tree_size: 5, root: fx.root }),
  });
  assert.equal(leadingZero.overall, 'failed');
  assert.ok(leadingZero.errors.includes('pending_bounds') || leadingZero.errors.includes('tree_size_mismatch'));

  const withoutLive = pendingInclusion({ leaf_index: 4, tree_size: 4, root: fx.root });
  delete withoutLive.live_tree_size;
  const openLive = await verifyAnchoredRoot({ ...common, inclusion: withoutLive });
  assert.equal(openLive.overall, 'pending');
  assert.equal(openLive.errors.includes('pending_leaf_in_head'), false);
});

test('a missing fee payer and a newer memo on another listed payer fail closed', async () => {
  const fx = epoch2Fixture();
  const baseOnly = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: fx.root,
    tree_size: 4,
    anchors: {
      base: { ...fx.head.anchors.base },
      solana: {
        status: 'pending',
        signature: null,
        slot: null,
        cluster: null,
        memo: null,
        fee_payer: null,
      },
    },
  }, fx.key);
  const pending = pendingInclusion({ root: fx.root });
  let scanned = 0;
  const missingPayer = await verifyAnchoredRoot({
    receipt: { task_id: 'd', row_hash: 'rd' },
    inclusion: pending,
    head: baseOnly,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    fetchNewestAnchor: async () => {
      scanned += 1;
      return { root: fx.root, signature: 'sig-anchored-4', slot: 99 };
    },
    fetchBaseTx: async () => ({
      hash: fx.head.anchors.base.tx,
      input: `0x${fx.root}`,
      chainId: 8453,
      from: PINNED_BASE_ANCHOR_WALLET,
    }),
  });
  assert.equal(missingPayer.overall, 'failed');
  assert.ok(missingPayer.errors.includes('newest_anchor_unavailable'));
  assert.equal(scanned, 0);
  assert.notEqual(missingPayer.overall, 'pending');

  const altPayer = 'B'.repeat(32);
  const wallets = seal({
    schema: ANCHOR_WALLETS_SCHEMA,
    base: [PINNED_BASE_ANCHOR_WALLET],
    solana: [PINNED_SOLANA_ANCHOR_FEE_PAYER, altPayer],
  }, fx.key, 'chit402-anchor-wallets+jwt');
  const included = {
    task_id: 'a',
    status: 'anchored',
    anchor_status: 'anchored',
    leaf_index: 1,
    tree_size: 4,
    root: fx.root,
    leaf: fx.leaves[1].toString('hex'),
    proof: inclusionProof(fx.leaves.slice(0, 4), 1),
  };
  const newer = 'ee'.repeat(32);
  const byPayer = async (payer) => {
    if (payer === altPayer) return { root: newer, signature: 'sig-alt', slot: 200 };
    return { root: fx.root, signature: 'sig-anchored-4', slot: 99 };
  };
  const hidden = await verifyAnchoredRoot({
    receipt: { task_id: 'a', row_hash: 'ra' },
    inclusion: included,
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    anchorWalletDocument: wallets,
    ...fetchers(fx),
    fetchNewestAnchor: byPayer,
  });
  assert.equal(hidden.overall, 'failed');
  assert.ok(hidden.errors.includes('stale_head'));
  assert.notEqual(hidden.overall, 'verified');

  const olderAlt = await verifyAnchoredRoot({
    receipt: { task_id: 'a', row_hash: 'ra' },
    inclusion: included,
    head: fx.head,
    trustedKids: [fx.key.kid],
    checkNewestAnchor: true,
    anchorWalletDocument: wallets,
    ...fetchers(fx),
    fetchNewestAnchor: async (payer) => {
      if (payer === altPayer) return { root: newer, signature: 'sig-alt', slot: 10 };
      return { root: fx.root, signature: 'sig-anchored-4', slot: 200 };
    },
  });
  assert.equal(olderAlt.overall, 'verified');
  assert.equal(olderAlt.errors.includes('stale_head'), false);
});

function jsonRpc(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const out = handler(msg);
      const body = out && out.error
        ? { jsonrpc: '2.0', id: msg.id, error: out.error }
        : { jsonrpc: '2.0', id: msg.id, result: out };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return server;
}

test('a null or thrown transaction fails the memo scan and does not keep an older memo', async () => {
  const fx = epoch2Fixture();
  const nullRpc = jsonRpc((msg) => {
    if (msg.method === 'getSignaturesForAddress') {
      return [
        { signature: 'sig-gone', err: null, slot: 300 },
        { signature: 'sig-anchored-4', err: null, slot: 99 },
      ];
    }
    if (msg.method === 'getTransaction') {
      if (msg.params[0] === 'sig-gone') return null;
      return solanaTx(fx.memo);
    }
    if (msg.method === 'getGenesisHash') return SOLANA_GENESIS.devnet;
    if (msg.method === 'eth_chainId') return '0x2105';
    if (msg.method === 'eth_getTransactionByHash') {
      return { hash: fx.head.anchors.base.tx, input: `0x${fx.root}`, from: PINNED_BASE_ANCHOR_WALLET };
    }
    return null;
  });
  const nullPort = await listen(nullRpc);
  const nullUrl = `http://127.0.0.1:${nullPort}`;
  try {
    await assert.rejects(
      () => fetchNewestSolanaAnchorRoot(PINNED_SOLANA_ANCHOR_FEE_PAYER, nullUrl),
      /newest_anchor_unavailable/,
    );
    const pending = pendingInclusion({ root: fx.root });
    const hidden = await verifyAnchoredRoot({
      receipt: { task_id: 'd', row_hash: 'rd' },
      inclusion: pending,
      head: fx.head,
      trustedKids: [fx.key.kid],
      checkNewestAnchor: true,
      solanaRpcUrl: nullUrl,
      baseRpcUrl: nullUrl,
    });
    assert.equal(hidden.overall, 'failed');
    assert.ok(hidden.errors.includes('newest_anchor_unavailable'));
    assert.notEqual(hidden.overall, 'pending');
  } finally {
    await new Promise((resolve) => nullRpc.close(resolve));
  }

  const throwRpc = jsonRpc((msg) => {
    if (msg.method === 'getSignaturesForAddress') {
      return [{ signature: 'sig-anchored-4', err: null, slot: 99 }];
    }
    if (msg.method === 'getTransaction') return { error: { message: 'rpc blew up' } };
    return null;
  });
  const throwPort = await listen(throwRpc);
  try {
    await assert.rejects(
      () => fetchNewestSolanaAnchorRoot(PINNED_SOLANA_ANCHOR_FEE_PAYER, `http://127.0.0.1:${throwPort}`),
      /newest_anchor_unavailable/,
    );
  } finally {
    await new Promise((resolve) => throwRpc.close(resolve));
  }
});

test('the memo scan pages with before and fails closed at the page cap', async () => {
  const fx = epoch2Fixture();
  const limit = NEWEST_ANCHOR_PAGE_LIMIT;
  const befores = [];
  const pageRpc = jsonRpc((msg) => {
    if (msg.method !== 'getSignaturesForAddress') {
      const signature = msg.params?.[0];
      if (signature === 'memo-sig') return solanaTx(fx.memo);
      return { slot: 1, meta: { err: null }, transaction: { message: { instructions: [] } } };
    }
    const before = msg.params[1]?.before || null;
    befores.push(before);
    if (!before) {
      return Array.from({ length: limit }, (_, i) => ({ signature: `pad-${i}`, err: null, slot: 1000 - i }));
    }
    return [{ signature: 'memo-sig', err: null, slot: 1 }];
  });
  const pagePort = await listen(pageRpc);
  try {
    const found = await fetchNewestSolanaAnchorRoot(
      PINNED_SOLANA_ANCHOR_FEE_PAYER,
      `http://127.0.0.1:${pagePort}`,
    );
    assert.equal(found.root, fx.root);
    assert.deepEqual(befores, [null, `pad-${limit - 1}`]);
  } finally {
    await new Promise((resolve) => pageRpc.close(resolve));
  }

  let pages = 0;
  const capRpc = jsonRpc((msg) => {
    if (msg.method === 'getSignaturesForAddress') {
      const start = pages * limit;
      pages += 1;
      return Array.from({ length: limit }, (_, i) => ({ signature: `cap-${start + i}`, err: null, slot: 1 }));
    }
    return { slot: 1, meta: { err: null }, transaction: { message: { instructions: [] } } };
  });
  const capPort = await listen(capRpc);
  try {
    await assert.rejects(
      () => fetchNewestSolanaAnchorRoot(PINNED_SOLANA_ANCHOR_FEE_PAYER, `http://127.0.0.1:${capPort}`),
      /newest_anchor_unavailable/,
    );
    assert.equal(pages, NEWEST_ANCHOR_PAGE_CAP);
  } finally {
    await new Promise((resolve) => capRpc.close(resolve));
  }
});
