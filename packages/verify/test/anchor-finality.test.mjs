/**
 * Anchor finality. Chain calls are a local RPC or an injected fetcher.
 * No production host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const {
  verifyAnchoredRoot,
  assessBaseAnchor,
  fetchBaseAnchorTransaction,
  fetchSolanaAnchorTransaction,
  BASE_ANCHOR_MIN_CONFIRMATIONS,
  SOLANA_ANCHOR_COMMITMENT,
  SOLANA_GENESIS,
  isUncheckedAnchorReason,
} = await import('../dist/anchor-witness.js');
const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
  PINNED_SOLANA_ANCHOR_FEE_PAYERS,
  LEGACY_HEAD_UNPINNED_SIGNER,
} = await import('../dist/anchor-trust.js');
const { jwkThumbprint } = await import('../dist/jws.js');
const { verifyReceipt } = await import('../dist/index.js');

const FIRST_SOLANA_PAYER = 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD';

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

function fixture(feePayer = PINNED_SOLANA_ANCHOR_FEE_PAYER) {
  const taskId = 'task-1';
  const rowHash = 'row-hash-1';
  const leaf = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash}`)]));
  const sibling = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from('genesis')]));
  const root = nodeHash(sibling, leaf).toString('hex');
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-09-30:${root}:${prev}`;
  const key = issuerKey();
  const tx = `0x${'ab'.repeat(32)}`;
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 2,
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
        signature: '2soASZVz6NaEUZtRyCbf3hAdpPAAiecRovUSi99FFw9GJGQTbdoPFaFctNx1Nzt2FzPMLj5JjBnkXJm6CGofULNX',
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: feePayer,
      },
    },
  }, key);
  const solanaTx = {
    slot: 99,
    confirmationStatus: 'finalized',
    meta: { err: null },
    transaction: {
      signatures: ['2soASZVz6NaEUZtRyCbf3hAdpPAAiecRovUSi99FFw9GJGQTbdoPFaFctNx1Nzt2FzPMLj5JjBnkXJm6CGofULNX'],
      message: {
        accountKeys: [{ pubkey: feePayer, signer: true, writable: true }],
        instructions: [{
          program: 'spl-memo',
          programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
          parsed: memo,
        }],
      },
    },
  };
  const baseTx = {
    hash: tx,
    input: `0x${root}`,
    chainId: 8453,
    from: PINNED_BASE_ANCHOR_WALLET,
    status: '0x1',
    blockNumber: '0x64',
    tipBlockNumber: '0x70',
  };
  return {
    receipt: { task_id: taskId, row_hash: rowHash },
    inclusion: {
      task_id: taskId,
      leaf_index: 1,
      tree_size: 2,
      root,
      leaf: leaf.toString('hex'),
      proof: [{ hash: sibling.toString('hex'), position: 'left' }],
    },
    head,
    key,
    memo,
    root,
    tx,
    solanaTx,
    baseTx,
  };
}

function run(fx, overrides = {}) {
  return verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    fetchSolanaTx: async () => ('solanaTx' in overrides ? overrides.solanaTx : fx.solanaTx),
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => ('baseTx' in overrides ? overrides.baseTx : fx.baseTx),
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function jsonRpc(handler) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const out = handler(msg);
      const body = out && out.error
        ? { jsonrpc: '2.0', id: msg.id, error: out.error }
        : { jsonrpc: '2.0', id: msg.id, result: out === undefined ? null : out };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
}

test('the Solana pin stays append-only and BHTn is still the first entry', () => {
  assert.equal(PINNED_SOLANA_ANCHOR_FEE_PAYERS[0], FIRST_SOLANA_PAYER);
  assert.equal(PINNED_SOLANA_ANCHOR_FEE_PAYER, FIRST_SOLANA_PAYER);
  assert.equal(PINNED_SOLANA_ANCHOR_FEE_PAYERS[1], '8ef3GtYNuQ6P2ANxLMPUXTAo9BhfJJqMx6cdDVh7JM4U');
  assert.equal(BASE_ANCHOR_MIN_CONFIRMATIONS, 12);
  assert.equal(SOLANA_ANCHOR_COMMITMENT, 'finalized');
});

test('a deep successful Base anchor and a finalized Solana memo verify', async () => {
  const fx = fixture();
  const result = await run(fx);
  assert.equal(result.overall, 'verified', result.errors.join(','));
  assert.equal(result.base.valid, true);
  assert.equal(result.base.chain_id, 8453);
  assert.equal(result.solana.valid, true);
  assert.equal(result.solana.fee_payer, FIRST_SOLANA_PAYER);
});

test('the rotated Solana fee payer still verifies and an unlisted payer fails', async () => {
  const rotated = PINNED_SOLANA_ANCHOR_FEE_PAYERS[1];
  const ok = await run(fixture(rotated));
  assert.equal(ok.overall, 'verified', ok.errors.join(','));

  const stranger = 'C'.repeat(44);
  const fx = fixture(stranger);
  let calls = 0;
  const result = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    fetchSolanaTx: async () => { calls += 1; return fx.solanaTx; },
    fetchBaseTx: async () => { calls += 1; return fx.baseTx; },
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.solana.reason, 'fee_payer_unlisted');
  assert.notEqual(result.overall, 'verified');
  assert.equal(calls, 0);
});

test('a pending Base anchor with no receipt is could_not_check', async () => {
  const fx = fixture();
  const result = await run(fx, {
    baseTx: { ...fx.baseTx, status: null, blockNumber: null },
  });
  assert.equal(result.overall, 'could_not_check');
  assert.equal(result.base.reason, 'receipt_missing');
  assert.equal(result.base.valid, false);
  assert.equal(isUncheckedAnchorReason(result.base.reason), true);
  assert.notEqual(result.overall, 'verified');
});

test('a reverted Base receipt is not verified', async () => {
  const fx = fixture();
  const result = await run(fx, { baseTx: { ...fx.baseTx, status: '0x0' } });
  assert.equal(result.overall, 'failed');
  assert.equal(result.base.reason, 'tx_reverted');
  assert.equal(result.base.valid, false);
  assert.notEqual(result.overall, 'verified');
  assert.notEqual(result.overall, 'could_not_check');
});

test('a null Base block number is could_not_check', async () => {
  const fx = fixture();
  const result = await run(fx, { baseTx: { ...fx.baseTx, blockNumber: null } });
  assert.equal(result.overall, 'could_not_check');
  assert.equal(result.base.reason, 'block_number_missing');
});

test('Base depth below the constant is could_not_check and depth at the constant passes', async () => {
  const fx = fixture();
  const shallow = await run(fx, {
    baseTx: { ...fx.baseTx, blockNumber: 100, tipBlockNumber: 100 + BASE_ANCHOR_MIN_CONFIRMATIONS - 1 },
  });
  assert.equal(shallow.overall, 'could_not_check');
  assert.equal(shallow.base.reason, 'confirmation_shallow');
  assert.equal(shallow.base.valid, false);

  const deep = await run(fx, {
    baseTx: { ...fx.baseTx, blockNumber: 100, tipBlockNumber: 100 + BASE_ANCHOR_MIN_CONFIRMATIONS },
  });
  assert.equal(deep.overall, 'verified', deep.errors.join(','));
  assert.equal(assessBaseAnchor(deep.base && {
    ...fx.baseTx,
    blockNumber: 100,
    tipBlockNumber: 100 + BASE_ANCHOR_MIN_CONFIRMATIONS,
  }, 8453).ok, true);
});

test('a null chain id is could_not_check and a wrong chain id fails', async () => {
  const fx = fixture();
  const missing = await run(fx, { baseTx: { ...fx.baseTx, chainId: null } });
  assert.equal(missing.overall, 'could_not_check');
  assert.equal(missing.base.reason, 'chain_id_missing');
  assert.equal(missing.base.valid, false);

  const omitted = await run(fx, { baseTx: { ...fx.baseTx, chainId: undefined } });
  assert.equal(omitted.overall, 'could_not_check');
  assert.equal(omitted.base.reason, 'chain_id_missing');

  const wrong = await run(fx, { baseTx: { ...fx.baseTx, chainId: 1 } });
  assert.equal(wrong.overall, 'failed');
  assert.equal(wrong.base.reason, 'chain_mismatch');
  assert.equal(wrong.base.chain_id, 1);
  assert.notEqual(wrong.overall, 'verified');

  const disagreed = await run(fx, { baseTx: { ...fx.baseTx, chainId: 8453, txChainId: '0x1' } });
  assert.equal(disagreed.overall, 'failed');
  assert.equal(disagreed.base.reason, 'chain_mismatch');
  assert.notEqual(disagreed.overall, 'verified');
});

test('a null, thrown, or timed-out Base RPC is covered by a confirmed Solana anchor (0.4.10), and fails closed alone', async () => {
  const fx = fixture();
  const nulled = await run(fx, { baseTx: null });
  assert.equal(nulled.overall, 'could_not_check');
  assert.equal(nulled.base.reason, 'tx_not_found');

  const thrown = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    fetchSolanaTx: async () => fx.solanaTx,
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => { throw new Error('socket hang up'); },
    rpcRetry: { backoffMs: 0 },
  });
  // 0.4.10: Solana confirmed the root, so the Base RPC failure is a warning.
  assert.equal(thrown.overall, 'verified');
  assert.equal(thrown.base.reason, 'base_rpc_error');
  assert.deepEqual(thrown.anchor_warnings, ['base:base_rpc_error']);
  const bothDown = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    fetchSolanaTx: async () => { throw new Error('connection reset'); },
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => { throw new Error('socket hang up'); },
    rpcRetry: { backoffMs: 0 },
  });
  assert.equal(bothDown.overall, 'could_not_check');
  assert.equal(bothDown.anchor_warnings, undefined);

  const coded = await run(fx, { baseTx: { ...fx.baseTx, rpcCode: 'base_rpc_null' } });
  assert.equal(coded.overall, 'verified');
  assert.deepEqual(coded.anchor_warnings, ['base:base_rpc_null']);
  assert.equal(coded.base.reason, 'base_rpc_null');

  const hang = http.createServer(() => {});
  const port = await listen(hang);
  try {
    await assert.rejects(
      () => fetchBaseAnchorTransaction(fx.tx, `http://127.0.0.1:${port}`, 50),
      (err) => err instanceof Error && err.message === 'base_rpc_timeout',
    );
    const timed = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      fetchSolanaTx: async () => fx.solanaTx,
      fetchGenesis: async () => SOLANA_GENESIS.devnet,
      fetchBaseTx: () => fetchBaseAnchorTransaction(fx.tx, `http://127.0.0.1:${port}`, 50),
      rpcRetry: { backoffMs: 0 },
    });
    assert.equal(timed.overall, 'verified');
    assert.equal(timed.base.reason, 'base_rpc_timeout');
    assert.deepEqual(timed.anchor_warnings, ['base:base_rpc_timeout']);
  } finally {
    await new Promise((resolve) => hang.close(resolve));
  }
});

test('a Base RPC that answers null for every method is base_rpc_null', async () => {
  const fx = fixture();
  const rpc = jsonRpc(() => null);
  const port = await listen(rpc);
  try {
    await assert.rejects(
      () => fetchBaseAnchorTransaction(fx.tx, `http://127.0.0.1:${port}`),
      /base_rpc_null/,
    );
    const result = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      baseRpcUrl: `http://127.0.0.1:${port}`,
      fetchSolanaTx: async () => fx.solanaTx,
      fetchGenesis: async () => SOLANA_GENESIS.devnet,
      rpcRetry: { backoffMs: 0 },
    });
    assert.equal(result.overall, 'verified');
    assert.equal(result.base.reason, 'base_rpc_null');
    assert.equal(result.base.attempts, 2);
    const alone = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      baseRpcUrl: `http://127.0.0.1:${port}`,
      fetchSolanaTx: async () => null,
      fetchGenesis: async () => SOLANA_GENESIS.devnet,
      rpcRetry: { backoffMs: 0 },
    });
    assert.equal(alone.overall, 'could_not_check');
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('disagreeing Base RPC fields are not a verified anchor', async () => {
  const fx = fixture();
  const rpc = jsonRpc((msg) => {
    if (msg.method === 'eth_chainId') return '0x2105';
    if (msg.method === 'eth_blockNumber') return '0x70';
    if (msg.method === 'eth_getTransactionByHash') {
      return { hash: fx.tx, input: `0x${fx.root}`, from: PINNED_BASE_ANCHOR_WALLET, blockNumber: '0x64' };
    }
    if (msg.method === 'eth_getTransactionReceipt') {
      return {
        transactionHash: `0x${'cd'.repeat(32)}`,
        status: '0x1',
        blockNumber: '0x64',
        from: PINNED_BASE_ANCHOR_WALLET,
      };
    }
    return null;
  });
  const port = await listen(rpc);
  try {
    const result = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      baseRpcUrl: `http://127.0.0.1:${port}`,
      fetchSolanaTx: async () => fx.solanaTx,
      fetchGenesis: async () => SOLANA_GENESIS.devnet,
    });
    assert.equal(result.overall, 'could_not_check');
    assert.equal(result.base.reason, 'anchor_inconsistent');
    assert.equal(result.base.valid, false);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('a missing receipt does not fall back to an older anchor hash', async () => {
  const fx = fixture();
  const older = `0x${'11'.repeat(32)}`;
  const asked = [];
  const rpc = jsonRpc((msg) => {
    const hash = Array.isArray(msg.params) ? msg.params[0] : null;
    asked.push(`${msg.method}:${hash || ''}`);
    if (msg.method === 'eth_chainId') return '0x2105';
    if (msg.method === 'eth_blockNumber') return '0x70';
    if (hash === older) {
      return {
        hash: older,
        transactionHash: older,
        input: `0x${fx.root}`,
        from: PINNED_BASE_ANCHOR_WALLET,
        status: '0x1',
        blockNumber: '0x10',
      };
    }
    return null;
  });
  const port = await listen(rpc);
  try {
    const result = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      baseRpcUrl: `http://127.0.0.1:${port}`,
      fetchSolanaTx: async () => fx.solanaTx,
      fetchGenesis: async () => SOLANA_GENESIS.devnet,
    });
    assert.equal(result.overall, 'could_not_check');
    assert.equal(result.base.reason, 'tx_not_found');
    assert.equal(asked.some((line) => line.includes(older)), false);
    assert.equal(asked.some((line) => line.includes(fx.tx)), true);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('Solana that is not finalized is could_not_check', async () => {
  const fx = fixture();
  const confirmed = await run(fx, {
    solanaTx: { ...fx.solanaTx, confirmationStatus: 'confirmed' },
  });
  assert.equal(confirmed.overall, 'could_not_check');
  assert.equal(confirmed.solana.reason, 'not_finalized');
  assert.equal(confirmed.solana.valid, false);

  const calls = [];
  const rpc = jsonRpc((msg) => {
    calls.push(msg);
    if (msg.method === 'getGenesisHash') return SOLANA_GENESIS.devnet;
    if (msg.method === 'getTransaction') return null;
    return null;
  });
  const port = await listen(rpc);
  try {
    const result = await verifyAnchoredRoot({
      receipt: fx.receipt,
      inclusion: fx.inclusion,
      head: fx.head,
      trustedKids: [fx.key.kid],
      solanaRpcUrl: `http://127.0.0.1:${port}`,
      fetchBaseTx: async () => fx.baseTx,
    });
    assert.equal(result.overall, 'could_not_check');
    assert.equal(result.solana.reason, 'tx_not_found');
    const got = calls.find((msg) => msg.method === 'getTransaction');
    assert.equal(got.params[1].commitment, 'finalized');
    assert.equal(got.params[1].encoding, 'jsonParsed');
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});

test('a finalized Solana transaction with meta.err fails', async () => {
  const fx = fixture();
  const result = await run(fx, {
    solanaTx: { ...fx.solanaTx, confirmationStatus: 'finalized', meta: { err: { InstructionError: [0, 'Custom'] } } },
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.solana.reason, 'tx_failed');
  assert.notEqual(result.overall, 'verified');
});

test('a thrown Solana RPC is covered by a confirmed Base anchor (0.4.10); a timed-out fetch still maps', async () => {
  const fx = fixture();
  const thrown = await verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head: fx.head,
    trustedKids: [fx.key.kid],
    fetchSolanaTx: async () => { throw new Error('connection reset'); },
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => fx.baseTx,
    rpcRetry: { backoffMs: 0 },
  });
  assert.equal(thrown.overall, 'verified');
  assert.equal(thrown.solana.reason, 'solana_rpc_error');
  assert.deepEqual(thrown.anchor_warnings, ['solana:solana_rpc_error']);

  const hang = http.createServer(() => {});
  const port = await listen(hang);
  try {
    await assert.rejects(
      () => fetchSolanaAnchorTransaction('2soASZVz6NaEUZtRyCbf3hAdpPAAiecRovUSi99FFw9GJGQTbdoPFaFctNx1Nzt2FzPMLj5JjBnkXJm6CGofULNX', `http://127.0.0.1:${port}`, 50),
      (err) => err instanceof Error && err.message === 'solana_rpc_timeout',
    );
  } finally {
    await new Promise((resolve) => hang.close(resolve));
  }
});

test('a recorded long-final epoch-2 anchor still verifies, and the unpinned head does not', async () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/recorded-epoch2-anchor-rpc.json', import.meta.url), 'utf8'));
  const realHead = JSON.parse(readFileSync(new URL('./fixtures/pardal-head-honest.json', import.meta.url), 'utf8'));
  const inclusion = JSON.parse(readFileSync(new URL('./fixtures/pardal-inclusion-honest.json', import.meta.url), 'utf8'));
  const foreign = JSON.parse(readFileSync(new URL('./fixtures/public/foreign-x402-muy1hh8y.json', import.meta.url), 'utf8'));
  const receipt = {
    task_id: foreign.task_id,
    row_hash: foreign.book_chain.row_hash,
  };
  const payment = await verifyReceipt(foreign, { requirePreimages: false, skipIssuerHistory: true });
  assert.equal(payment.issuer_signature.valid, true, payment.errors.join('; '));

  const legacyCalls = [];
  const legacy = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head: realHead,
    fetchSolanaTx: async () => { legacyCalls.push('solana'); return recorded.solana.transaction; },
    fetchBaseTx: async () => { legacyCalls.push('base'); return null; },
    fetchGenesis: async () => recorded.solana.genesis,
  });
  assert.equal(legacy.overall, 'failed');
  assert.ok(legacy.errors.includes(LEGACY_HEAD_UNPINNED_SIGNER));
  assert.notEqual(legacy.overall, 'verified');
  assert.equal(legacyCalls.length, 0);

  const key = issuerKey();
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root: realHead.root,
    tree_size: realHead.tree_size,
    anchors: {
      base: {
        status: 'anchored',
        tx: recorded.base.tx,
        calldata: recorded.base.transaction.input,
        chain_id: 8453,
        from: recorded.base.from,
      },
      solana: {
        status: 'anchored',
        signature: recorded.solana.signature,
        slot: recorded.solana.transaction.slot,
        cluster: 'mainnet-beta',
        memo: recorded.solana.transaction.transaction.message.instructions[0].parsed,
        fee_payer: FIRST_SOLANA_PAYER,
      },
    },
  }, key);
  const asked = [];
  const rpc = jsonRpc((msg) => {
    asked.push(msg.method);
    const hash = Array.isArray(msg.params) ? msg.params[0] : null;
    if (msg.method === 'eth_chainId') return recorded.base.chainId;
    if (msg.method === 'eth_blockNumber') return recorded.base.tip;
    if (msg.method === 'eth_getTransactionByHash') {
      assert.equal(hash, recorded.base.tx);
      return recorded.base.transaction;
    }
    if (msg.method === 'eth_getTransactionReceipt') {
      assert.equal(hash, recorded.base.tx);
      return recorded.base.receipt;
    }
    if (msg.method === 'getGenesisHash') return recorded.solana.genesis;
    if (msg.method === 'getTransaction') {
      assert.equal(msg.params[1].commitment, recorded.solana.commitment);
      assert.equal(hash, recorded.solana.signature);
      return recorded.solana.transaction;
    }
    return null;
  });
  const port = await listen(rpc);
  const url = `http://127.0.0.1:${port}`;
  try {
    const result = await verifyAnchoredRoot({
      receipt,
      inclusion,
      head,
      trustedKids: [key.kid],
      baseRpcUrl: url,
      solanaRpcUrl: url,
    });
    assert.equal(result.overall, 'verified', result.errors.join(','));
    assert.equal(result.base.valid, true);
    assert.equal(result.solana.valid, true);
    assert.equal(result.solana.fee_payer, FIRST_SOLANA_PAYER);
    assert.ok(asked.includes('eth_getTransactionReceipt'));
    assert.ok(asked.includes('eth_blockNumber'));
    assert.equal(asked.includes('eth_getTransactionByHash'), true);
  } finally {
    await new Promise((resolve) => rpc.close(resolve));
  }
});
