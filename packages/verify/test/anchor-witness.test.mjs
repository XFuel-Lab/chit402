/**
 * Dual-anchor check: inclusion, Solana memo, Base calldata.
 * Chain calls are injected. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  verifyAnchoredRoot,
  leafHash,
  ANCHOR_PROVES,
  ANCHOR_DOES_NOT_PROVE,
  SOLANA_GENESIS,
} = await import('../dist/anchor-witness.js');
const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
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

function sealHead(head, key) {
  const { issuer_signature: _ignored, ...rest } = head;
  const claims = JSON.parse(JSON.stringify(rest));
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function fixture() {
  const taskId = 'task-1';
  const rowHash = 'row-hash-1';
  const leaf = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash}`)]));
  const sibling = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from('genesis')]));
  const rootBuf = nodeHash(sibling, leaf);
  const root = rootBuf.toString('hex');
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-09-30:${root}:${prev}`;
  const receipt = { task_id: taskId, row_hash: rowHash };
  const inclusion = {
    task_id: taskId,
    leaf_index: 1,
    tree_size: 2,
    root,
    leaf: leaf.toString('hex'),
    proof: [{ hash: sibling.toString('hex'), position: 'left' }],
  };
  const head = {
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 2,
    anchors: {
      base: {
        status: 'anchored',
        tx: '0x' + 'ab'.repeat(32),
        calldata: `0x${root}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: 'sig1',
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  };
  const key = issuerKey();
  const solanaTx = {
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
  const baseTx = { hash: head.anchors.base.tx, input: `0x${root}`, chainId: 8453, from: PINNED_BASE_ANCHOR_WALLET };
  return {
    receipt,
    inclusion,
    head: sealHead(head, key),
    key,
    trustedKids: [key.kid],
    memo,
    root,
    solanaTx,
    baseTx,
    leaf,
  };
}

function fetchers(fx, overrides = {}) {
  const calls = [];
  return {
    calls,
    fetchSolanaTx: async () => {
      calls.push('solana');
      return overrides.solanaTx === undefined ? fx.solanaTx : overrides.solanaTx;
    },
    fetchGenesis: async () => {
      calls.push('genesis');
      return overrides.genesis === undefined ? SOLANA_GENESIS.devnet : overrides.genesis;
    },
    fetchBaseTx: async () => {
      calls.push('base');
      return overrides.baseTx === undefined ? fx.baseTx : overrides.baseTx;
    },
  };
}

test('leaf hash matches the gateway byte rule', () => {
  const bytes = Buffer.from('task-1|row-hash-1');
  const local = sha256(Buffer.concat([Buffer.from([0x00]), bytes]));
  assert.equal(Buffer.from(leafHash(bytes)).toString('hex'), local.toString('hex'));
});

test('inclusion plus both anchors verifies, and the boundary text is explicit', async () => {
  const fx = fixture();
  const fetched = fetchers(fx);
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'verified');
  assert.equal(result.inclusion.valid, true);
  assert.equal(result.inclusion.leaf_source, 'receipt');
  assert.equal(result.solana.valid, true);
  assert.equal(result.solana.memo, fx.memo);
  assert.equal(result.base.valid, true);
  assert.equal(result.base.chain_id, 8453);
  assert.deepEqual(result.proves, ANCHOR_PROVES);
  assert.ok(result.does_not_prove.some((line) => /does not prove the payment/i.test(line)));
  assert.deepEqual(fetched.calls, ['solana', 'genesis', 'base']);
});

test('a flipped inclusion proof fails before any RPC', async () => {
  const fx = fixture();
  const fetched = fetchers(fx);
  const bad = {
    ...fx.inclusion,
    proof: [{ hash: 'ff'.repeat(32), position: 'left' }],
  };
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: bad,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.inclusion.reason, 'inclusion_failed');
  assert.deepEqual(fetched.calls, []);
});

test('a memo that does not carry this root fails', async () => {
  const fx = fixture();
  const other = fx.memo.replace(fx.root, '12'.repeat(32));
  const fetched = fetchers(fx, {
    solanaTx: {
      ...fx.solanaTx,
      transaction: {
        message: {
          instructions: [{ program: 'spl-memo', parsed: other }],
        },
      },
    },
  });
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.solana.reason, 'memo_mismatch');
});

test('Base calldata that is not the root fails', async () => {
  const fx = fixture();
  const fetched = fetchers(fx, { baseTx: { ...fx.baseTx, input: '0x' + '00'.repeat(32) } });
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.base.reason, 'calldata_mismatch');
});

test('a devnet RPC genesis does not satisfy a mainnet-beta head', async () => {
  const fx = fixture();
  fx.head.anchors.solana.cluster = 'mainnet-beta';
  fx.head = sealHead(fx.head, fx.key);
  const fetched = fetchers(fx, { genesis: SOLANA_GENESIS.devnet });
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.solana.reason, 'cluster_mismatch');
});

test('pending anchors are partial and do not fetch', async () => {
  const fx = fixture();
  fx.head.anchors.solana = { status: 'pending', signature: null, slot: null, cluster: 'devnet', memo: fx.memo, fee_payer: null };
  fx.head.anchors.base = { status: 'pending', tx: null, calldata: `0x${fx.root}`, chain_id: 8453, from: null };
  fx.head = sealHead(fx.head, fx.key);
  const fetched = fetchers(fx);
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.overall, 'partial');
  assert.equal(result.inclusion.valid, true);
  assert.equal(result.solana.reason, 'pending');
  assert.equal(result.base.reason, 'pending');
  assert.deepEqual(fetched.calls, []);
  assert.ok(result.does_not_prove.length >= ANCHOR_DOES_NOT_PROVE.length);
});

test('cli --rpc prints the prove and does-not-prove lines', () => {
  const fx = fixture();
  fx.head.anchors.solana.status = 'pending';
  fx.head.anchors.solana.signature = null;
  fx.head.anchors.solana.fee_payer = null;
  fx.head.anchors.base.status = 'pending';
  fx.head.anchors.base.tx = null;
  fx.head.anchors.base.from = null;
  fx.head = sealHead(fx.head, fx.key);
  const dir = mkdtempSync(join(tmpdir(), 'chit-anchor-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(fx.receipt));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(fx.inclusion));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fx.head));
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [fx.key.publicJwk] }));
  const cli = join(pkgDir, 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [
    cli,
    join(dir, 'receipt.json'),
    join(dir, 'inclusion.json'),
    join(dir, 'head.json'),
    '--rpc',
    '--jwks-file', join(dir, 'jwks.json'),
    '--trusted-kid', fx.key.kid,
    '--no-issuer-history',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /What this proves/);
  assert.match(run.stdout, /What this does not prove/);
  assert.match(run.stdout, /does not prove the payment/i);
  assert.match(run.stdout, /PARTIAL/);

  const payerMode = spawnSync(process.execPath, [
    cli,
    join(dir, 'receipt.json'),
    '--rpc',
    'https://mainnet.base.org',
  ], { encoding: 'utf8' });
  assert.equal(`${payerMode.stdout}`.includes('What this proves'), false);
  assert.notEqual(payerMode.status, 0);
});

/**
 * These strings are the getGenesisHash values. The mock below returns them
 * directly. It does not read SOLANA_GENESIS, so a truncated table still fails.
 */
const GENESIS_LITERALS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

test('genesis hashes are the full getGenesisHash values, not the CAIP-2 prefix', async () => {
  assert.equal(SOLANA_GENESIS['mainnet-beta'], GENESIS_LITERALS['mainnet-beta']);
  assert.equal(SOLANA_GENESIS.devnet, GENESIS_LITERALS.devnet);
  assert.equal(SOLANA_GENESIS.testnet, GENESIS_LITERALS.testnet);
  assert.notEqual(SOLANA_GENESIS['mainnet-beta'], '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  assert.notEqual(SOLANA_GENESIS.devnet, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
  assert.notEqual(SOLANA_GENESIS.testnet, '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z');
  for (const [cluster, literal] of Object.entries(GENESIS_LITERALS)) {
    const fx = fixture();
    fx.head.anchors.solana.cluster = cluster;
    fx.head = sealHead(fx.head, fx.key);
    const fetched = fetchers(fx, { genesis: literal });
    const result = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: fx.trustedKids,
      ...fetched,
    });
    assert.equal(result.solana.reason, undefined, cluster);
    assert.equal(result.solana.valid, true, cluster);
    assert.equal(result.overall, 'verified', cluster);
  }
});

test('an inclusion endpoint 404 body is not_in_tree', async () => {
  const fx = fixture();
  const fetched = fetchers(fx);
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: { error: 'not_in_tree', task_id: fx.receipt.task_id },
    head: fx.head,
    trustedKids: fx.trustedKids,
    ...fetched,
  });
  assert.equal(result.inclusion.reason, 'not_in_tree');
  assert.equal(result.errors.includes('not_in_tree'), true);
  assert.equal(result.errors.includes('bad_root'), false);
  assert.deepEqual(fetched.calls, []);
});
