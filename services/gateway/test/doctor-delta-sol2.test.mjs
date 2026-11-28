/**
 * Solana durable hold and sweep. Offline. No production host.
 * DOC-D1b uses the real getTransaction shape (no confirmationStatus).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChallengeStore } from '../src/x402-adapter.js';
import { DurableChallengeStore } from '../src/x402-durable-store.js';
import {
  settleBoundPayment,
  serveSolanaHold,
  startSolanaHoldSweep,
  stopSolanaHoldSweep,
  sweepSolanaHolds,
} from '../src/x402-settle.js';
import {
  confirmSolanaTransaction,
  associatedTokenAddress,
  clearChainReaderForTests,
  readSolanaTransaction,
} from '../src/x402-chain.js';
import { encodeBase58 } from '../src/payment-ref.js';
import { localTransferIndex } from '../src/x402-chain.js';
import { ethers } from 'ethers';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_HOUSE = '2SKNEcAnVCiKtFwWhYvj3QjSLepR4eh8rDpHab3xPtP1';
const SOL_PAYER = 'SoLPayer1111111111111111111111111111111111';
const SOL_FEE = 'SoLFeePayer11111111111111111111111111111111';
const SOL_SIG = encodeBase58(Buffer.alloc(64, 7));
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function solHeader() {
  const blob = {
    x402Version: 2,
    network: 'solana',
    accepted: {
      scheme: 'exact',
      network: 'solana',
      amount: '2000',
      payTo: SOL_HOUSE,
      asset: SOL_MINT,
      extra: { feePayer: SOL_FEE, recentBlockhash: 'blockhash', lastValidBlockHeight: 40 },
    },
    payload: { transaction: 'AQAAAA==' },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function listenFacilitator() {
  const hits = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      hits.push(req.url || '');
      res.setHeader('content-type', 'application/json');
      if ((req.url || '').endsWith('/verify')) {
        res.end(JSON.stringify({ valid: true, isValid: true, payer: SOL_PAYER }));
        return;
      }
      res.end(JSON.stringify({
        settled: true, success: true, txRef: SOL_SIG, transaction: SOL_SIG, network: 'solana', payer: SOL_PAYER,
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function rpcFinalTx() {
  const ata = associatedTokenAddress(SOL_HOUSE, SOL_MINT);
  return {
    slot: 4,
    blockTime: 1795800000,
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, mint: SOL_MINT, uiTokenAmount: { amount: '0' } }],
      postTokenBalances: [{ accountIndex: 1, mint: SOL_MINT, uiTokenAmount: { amount: '2000' } }],
    },
    transaction: {
      signatures: [SOL_SIG],
      message: {
        accountKeys: [SOL_PAYER, ata],
        instructions: [{
          programId: TOKEN_PROGRAM,
          parsed: {
            type: 'transferChecked',
            info: {
              mint: SOL_MINT,
              destination: ata,
              authority: SOL_PAYER,
              source: 'SourceToken111111111111111111111111111111',
              tokenAmount: { amount: '2000', decimals: 6 },
            },
          },
        }],
      },
    },
  };
}

test.beforeEach(() => {
  clearChainReaderForTests();
  stopSolanaHoldSweep();
});

test('DOC-D1b a real getTransaction shape with no confirmationStatus settles', async () => {
  const fac = await listenFacilitator();
  let mode = 'confirmed';
  const cfg = {
    network: 'solana',
    payTo: SOL_HOUSE,
    facilitatorProvider: 'zan',
    gatewayUrl: fac.url,
    apiKey: 'k',
    asset: USDC,
    allowUnboundPayments: false,
    solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
    chainReader: async (args) => {
      const built = rpcFinalTx();
      if (mode === 'confirmed') built.confirmationStatus = 'confirmed';
      return confirmSolanaTransaction(built, {
        challenge: args.challenge,
        expectedPayTo: args.expectedPayTo,
        facilitatorPayer: args.facilitator?.payer,
        signature: SOL_SIG,
      });
    },
  };
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'11'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-1', amount: '2000', asset: SOL_MINT, network: 'solana', payTo: SOL_HOUSE,
      resource: '/task-request', state: 'issued', expiresAt: Date.now() + 60_000, feePayer: SOL_FEE, nonce,
    });
    const header = solHeader();
    const pay = () => settleBoundPayment({
      taskId: 'task-1', amount: '2000', cfg, store, nonce, paymentHeader: header, clientVersion: 2,
    });
    const first = await pay();
    assert.equal(first.code, 'settle_pending');
    mode = 'rpc-final';
    const settled = await pay();
    assert.equal(settled.kind, 'settled', settled.code);
    assert.equal(settled.finalized === false, false);
    const again = await pay();
    assert.equal(again.idempotentReplay, true);
    assert.equal(fac.hits.filter((url) => url.endsWith('/settle')).length, 1);
  } finally {
    await fac.close();
  }
});

test('D-M4 a durable hold keeps the tx hint and the scheduled sweep issues one receipt', async () => {
  const fac = await listenFacilitator();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-hold-'));
  const file = path.join(dir, 'challenges.json');
  let finalNow = false;
  const cfg = {
    network: 'solana',
    payTo: SOL_HOUSE,
    facilitatorProvider: 'zan',
    gatewayUrl: fac.url,
    apiKey: 'k',
    asset: USDC,
    allowUnboundPayments: false,
    intervalMs: 15000,
    solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
    chainReader: async () => (finalNow
      ? { ok: true, confirmed: true, finalized: true, amount: '2000', payer: SOL_PAYER, payTo: SOL_HOUSE, tx: SOL_SIG }
      : { ok: false, pending: true }),
  };
  try {
    const store = new DurableChallengeStore(file);
    const nonce = `0x${'22'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-1', amount: '2000', asset: SOL_MINT, network: 'solana', payTo: SOL_HOUSE,
      resource: '/task-request', state: 'issued', expiresAt: Date.now() + 60_000, feePayer: SOL_FEE, nonce,
    });
    const header = solHeader();
    const first = await settleBoundPayment({
      taskId: 'task-1', amount: '2000', cfg, store, nonce, paymentHeader: header, clientVersion: 2,
    });
    assert.equal(first.code, 'settle_pending');
    const reopened = new DurableChallengeStore(file);
    const rows = reopened.listHoldHandles();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tx_hint, SOL_SIG);
    assert.equal(rows[0].payer, SOL_PAYER);
    const pending = serveSolanaHold(first.pendingId, reopened, header);
    assert.equal(pending.status, 202);
    finalNow = true;
    const scheduled = startSolanaHoldSweep(reopened, cfg);
    assert.equal(scheduled.started, true);
    await scheduled.first;
    assert.equal(startSolanaHoldSweep(reopened, cfg).already, true);
    const body = serveSolanaHold(first.pendingId, reopened, header);
    assert.equal(body.status, 200);
    assert.equal(body.body.id, first.pendingId);
    const hidden = serveSolanaHold(first.pendingId, reopened, null);
    assert.equal(hidden.body.state, 'final');
    assert.equal(hidden.body.payment_ref, undefined);
    const sweptAgain = await sweepSolanaHolds(reopened, cfg);
    assert.equal(sweptAgain.length, 0);
  } finally {
    stopSolanaHoldSweep();
    await fac.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D-S2 one Transfer wins when a decoy log names the payee first', () => {
  const transfer = ethers.id('Transfer(address,address,uint256)');
  const approval = ethers.id('Approval(address,address,uint256)');
  const payTo = `0x${'22'.repeat(20)}`;
  const from = `0x${'11'.repeat(20)}`;
  const token = USDC;
  const logs = [
    {
      address: token,
      topics: [approval, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(payTo, 32)],
      data: ethers.toBeHex(2000n, 32),
    },
    {
      address: token,
      topics: [transfer, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(payTo, 32)],
      data: ethers.toBeHex(2000n, 32),
    },
  ];
  assert.equal(localTransferIndex(logs, { token, from, to: payTo, value: '2000' }), 1);
});

test('FA12-poll readSolanaTransaction returns a finalized getTransaction without confirmationStatus', async () => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls += 1;
      const body = calls < 2
        ? { jsonrpc: '2.0', id: 1, result: null }
        : { jsonrpc: '2.0', id: 1, result: { slot: 9, meta: { err: null }, transaction: { signatures: ['s'] } } };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  try {
    const tx = await readSolanaTransaction(url, 'sig', { waitMs: 2500, intervalMs: 1000 });
    assert.equal(calls >= 2, true);
    assert.equal(tx.finalized, true);
    assert.equal(tx.confirmationStatus, undefined);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('S7b a Solana transaction without header blockhash fields still records the message blockhash', async () => {
  const fac = await listenFacilitator();
  const hash = Buffer.alloc(32, 9);
  const raw = Buffer.concat([
    Buffer.from([1]),
    Buffer.alloc(64, 1),
    Buffer.from([1, 0, 1, 1]),
    Buffer.alloc(32, 3),
    hash,
  ]);
  const blob = {
    x402Version: 2,
    network: 'solana',
    accepted: {
      scheme: 'exact', network: 'solana', amount: '2000', payTo: SOL_HOUSE, asset: SOL_MINT,
      extra: { feePayer: SOL_FEE },
    },
    payload: { transaction: raw.toString('base64') },
  };
  const header = Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
  const cfg = {
    network: 'solana', payTo: SOL_HOUSE, facilitatorProvider: 'zan', gatewayUrl: fac.url, apiKey: 'k',
    asset: USDC, allowUnboundPayments: false,
    solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
    chainReader: async () => ({ ok: false, pending: true }),
  };
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'33'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-1', amount: '2000', asset: SOL_MINT, network: 'solana', payTo: SOL_HOUSE,
      resource: '/task-request', state: 'issued', expiresAt: Date.now() + 60_000, feePayer: SOL_FEE, nonce,
    });
    const first = await settleBoundPayment({
      taskId: 'task-1', amount: '2000', cfg, store, nonce, paymentHeader: header, clientVersion: 2,
    });
    assert.equal(first.code, 'settle_pending');
    const row = store.listHoldHandles()[0];
    assert.equal(row.blockhash.recentBlockhash, encodeBase58(hash));
  } finally {
    await fac.close();
  }
});
