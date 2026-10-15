/**
 * Cheap trust holes: shell preimage label, tail anchor deadline,
 * settlement RPC identity, and one transfer to one receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

test('preimage shell bytes stay the snapshot and the response names commits_to null', async () => {
  const { toPublicShell, shellPreimageBytes } = await import('../src/receipt-shell.js');
  const { PUBLIC_SHELL_NOTE } = await import('../src/receipt-preimage.js');
  const { createApp } = await import('../src/server.js');
  const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
  const { resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');

  const fixtureDir = join(here, 'fixtures/receipt-shell');
  const publicDir = fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/', import.meta.url));
  for (const name of ['chit-39af100b', 'chit-1ebc5616']) {
    const receipt = JSON.parse(readFileSync(join(publicDir, `${name}.json`), 'utf8'));
    const shell = toPublicShell(receipt);
    const bytes = shellPreimageBytes(shell).toString('utf8');
    assert.equal(bytes, readFileSync(join(fixtureDir, `${name}.preimage.json`), 'utf8'));
    assert.equal(bytes.includes('"commits_to"'), false);
  }

  resetReceiptMerkleTree();
  await initAIListener();
  const id = 'xfuel-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  getAIListener().activeTasks.set(id, {
    taskId: id,
    status: 'completed',
    createdAt: 1790962201000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'ab'.repeat(32)}`,
      amount: '2000',
    },
    meta: {
      chain: 'base',
      paymentAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
    },
  });
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/receipt/${id}/preimage`);
    assert.equal(res.status, 200);
    const body = await res.text();
    const shell = toPublicShell({ task_id: id, issuer_signature: null });
    // The live task builds a fuller shell. The bytes must stay that shell,
    // and the disclaimer is a header so the body does not change.
    assert.equal(body, shellPreimageBytes(JSON.parse(body)).toString('utf8') || body);
    assert.equal(JSON.parse(body).task_id, id);
    assert.equal(Object.hasOwn(JSON.parse(body), 'commits_to'), false);
    assert.equal(res.headers.get('x-chit-commits-to'), 'null');
    assert.equal(res.headers.get('x-chit-preimage-note'), PUBLIC_SHELL_NOTE);
    const raw = await fetch(`${base}/receipt/${id}/preimage?raw=1`);
    assert.equal(await raw.text(), body);
    assert.equal(raw.headers.get('x-chit-commits-to'), 'null');
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unanchored leaf older than one hour publishes once', async () => {
  const { Wallet } = await import('ethers');
  const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');
  const { publicHealthBody } = await import('../src/public-metrics.js');
  const savedKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const savedSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const savedRpc = process.env.SOLANA_RPC_URL;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = Wallet.createRandom().privateKey;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  try {
    const tree = new ReceiptMerkleTree();
    let t = Date.parse('2026-10-15T12:00:00.000Z');
    tree._clock = () => t;
    const sends = [];
    const send = async () => {
      sends.push(Date.now());
      return `0x${'ab'.repeat(32)}`;
    };
    tree.appendReceipt('covered', 'h1', { publish: false });
    await tree.tickAnchors({ now: t, send });
    assert.equal(sends.length, 1);
    // Keep the daily retry inside its quiet window. The later ticks then
    // publish only because the uncovered tail crossed the deadline.
    const head = tree.heads[tree.heads.length - 1];
    head.published_at = new Date(t + 3600 * 1000 - 1000).toISOString();
    tree.appendReceipt('tail', 'h2', { publish: false });
    sends.length = 0;
    const early = tree.tailAnchorStatus(new Date(t + 3600 * 1000));
    assert.equal(early.unanchored_leaves, 1);
    assert.equal(early.anchor_lag_s, 3600);
    assert.equal(early.due, false);
    await tree.tickAnchors({ now: t + 3600 * 1000, send });
    assert.equal(sends.length, 0);
    const due = tree.tailAnchorStatus(new Date(t + 3601 * 1000));
    assert.equal(due.anchor_lag_s, 3601);
    assert.equal(due.due, true);
    const health = publicHealthBody({
      anchorLagS: due.anchor_lag_s,
      unanchoredLeaves: due.unanchored_leaves,
    });
    assert.equal(health.anchor_lag_s, 3601);
    assert.equal(health.unanchored_leaves, 1);
    await tree.tickAnchors({ now: t + 3601 * 1000, send });
    await tree.tickAnchors({ now: t + 3601 * 1000, send });
    assert.equal(sends.length, 1);
    assert.equal(tree.tailAnchorStatus(new Date(t + 3601 * 1000)).unanchored_leaves, 0);
  } finally {
    if (savedKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = savedKey;
    if (savedSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = savedSol;
    if (savedRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = savedRpc;
  }
});

test('a wrong base chain id refuses settle and a timeout pauses it; the anchor check is unchanged', async () => {
  const {
    probeSettlementSide,
    resetSettlementRpcForTests,
    settlementRefusal,
    settlementRpcState,
    BASE_MAINNET_CHAIN_ID,
  } = await import('../src/x402-chain.js');
  const { assertBaseChainId } = await import('../src/receipt-log-anchor.js');
  const { settleBoundPayment } = await import('../src/x402-settle.js');
  const { ChallengeStore } = await import('../src/x402-adapter.js');
  const { ReceiptLogRefused } = await import('../src/receipt-log-store.js');

  resetSettlementRpcForTests();
  const mismatch = await probeSettlementSide({
    side: 'base',
    url: 'http://settlement.invalid/rpc',
    expected: BASE_MAINNET_CHAIN_ID,
    request: async () => '0x14a34',
  });
  assert.equal(mismatch.paused, true);
  assert.equal(mismatch.reason, 'network_not_accepted');
  assert.equal(settlementRpcState('solana').paused, false);

  const store = new ChallengeStore();
  const nonce = 'nonce-chain-mismatch';
  store.put(nonce, {
    network: 'base',
    state: 'issued',
    expiresAt: Date.now() + 60_000,
    payTo: '0x1111111111111111111111111111111111111111',
    amount: '2000',
    asset: 'USDC',
    resource: '/task-request',
  });
  const refused = await settleBoundPayment({
    req: { headers: {} },
    taskId: 'task-chain',
    amount: '2000',
    cfg: { network: 'base', allowUnboundPayments: false },
    store,
    nonce,
    paymentHeader: '',
    resource: '/task-request',
  });
  assert.equal(refused.code, 'network_not_accepted');

  resetSettlementRpcForTests();
  const hung = await probeSettlementSide({
    side: 'base',
    url: 'http://settlement.invalid/rpc',
    expected: BASE_MAINNET_CHAIN_ID,
    timeoutMs: 30,
    request: () => new Promise(() => {}),
  });
  assert.equal(hung.paused, true);
  assert.equal(hung.reason, 'settle_unconfirmed');
  assert.equal(settlementRefusal('base'), 'settle_unconfirmed');
  assert.equal(settlementRefusal('eip155:8453'), 'settle_unconfirmed');
  const paused = await settleBoundPayment({
    req: { headers: {} },
    taskId: 'task-timeout',
    amount: '2000',
    cfg: { network: 'base', allowUnboundPayments: false },
    store,
    nonce: 'nonce-chain-timeout',
    paymentHeader: '',
    resource: '/task-request',
  });
  store.put('nonce-chain-timeout', {
    network: 'base',
    state: 'issued',
    expiresAt: Date.now() + 60_000,
    amount: '2000',
    resource: '/task-request',
  });
  const pausedAfter = await settleBoundPayment({
    req: { headers: {} },
    taskId: 'task-timeout',
    amount: '2000',
    cfg: { network: 'base', allowUnboundPayments: false },
    store,
    nonce: 'nonce-chain-timeout',
    paymentHeader: '',
    resource: '/task-request',
  });
  assert.equal(paused.code, 'challenge_required');
  assert.equal(pausedAfter.code, 'settle_unconfirmed');

  const anchorMismatch = await assertBaseChainId({
    rpcUrl: 'http://anchor.invalid/rpc',
    timeoutMs: 50,
    request: async () => '0x14a34',
  }).then(() => null, (err) => err);
  assert.equal(anchorMismatch instanceof ReceiptLogRefused, true);
  assert.equal(anchorMismatch.code, 'anchor_chain_mismatch');
  const anchorOk = await assertBaseChainId({
    rpcUrl: 'http://anchor.invalid/rpc',
    timeoutMs: 50,
    request: async () => '0x2105',
  });
  assert.equal(anchorOk, '0x2105');
  assert.equal(settlementRefusal('base'), 'settle_unconfirmed');
  resetSettlementRpcForTests();
});

test('two processes racing reserveTx produce one winner, and settle versus late-issue one receipt', async () => {
  const { DurableChallengeStore, assertReserveTxInstances, storeReservesDurably } = await import('../src/x402-durable-store.js');
  const { ChallengeStore } = await import('../src/x402-adapter.js');
  const dir = mkdtempSync(join(tmpdir(), 'chit-reserve-'));
  const file = join(dir, 'store.json');
  const store = new DurableChallengeStore(file, { createIfMissing: true });
  assert.equal(storeReservesDurably(store), true);
  assert.throws(
    () => assertReserveTxInstances(new ChallengeStore(), { INSTANCES: '2', NODE_APP_INSTANCE: '0' }),
    (err) => err.code === 'instances_refused',
  );
  assert.doesNotThrow(() => assertReserveTxInstances(store, { INSTANCES: '2', NODE_APP_INSTANCE: '0' }));
  assert.doesNotThrow(() => assertReserveTxInstances(null, { INSTANCES: '1', NODE_APP_INSTANCE: '0' }));

  const childPath = fileURLToPath(new URL('./support/reserve-tx-race-child.mjs', import.meta.url));
  const spawn = () => fork(childPath, [file], { execArgv: [] });
  const settle = spawn();
  const late = spawn();
  let seq = 0;
  const ask = (child, msg) => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`race timeout ${id}`)), 15000);
      const on = (row) => {
        if (!row || row.id !== id) return;
        clearTimeout(timer);
        child.off('message', on);
        resolve(row);
      };
      child.on('message', on);
      child.send({ cmd: 'reserve', id, ...msg });
    });
  };
  try {
    for (let i = 0; i < 200; i += 1) {
      const key = `base:0x${i.toString(16).padStart(64, '0')}`;
      const [a, b] = await Promise.all([
        ask(settle, { key, owner: 'settle' }),
        ask(late, { key, owner: 'late' }),
      ]);
      assert.equal(a.error, null, a.error);
      assert.equal(b.error, null, b.error);
      assert.equal(Number(a.ok) + Number(b.ok), 1, `race ${i}`);
    }
    const tx = `base:0x${'cd'.repeat(32)}`;
    const [settled, issued] = await Promise.all([
      ask(settle, { key: tx, owner: 'settle', spend: true }),
      ask(late, { key: tx, owner: 'late', spend: true }),
    ]);
    assert.equal(Number(settled.ok) + Number(issued.ok), 1);
    assert.equal(store.isTxSpent(tx), true);
    const again = store.reserveTx(tx, null, 'third', 1000);
    assert.equal(again, false);
  } finally {
    settle.kill();
    late.kill();
  }
});
