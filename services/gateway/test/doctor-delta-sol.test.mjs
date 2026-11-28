/**
 * Solana re-poll regressions. Offline facilitator. No production host.
 * DOC-D1: a later-final transfer settles once, and an RPC miss stays pending.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment, serveSolanaHold } from '../src/x402-settle.js';
import {
  confirmSolanaTransaction,
  associatedTokenAddress,
  clearChainReaderForTests,
} from '../src/x402-chain.js';
import { encodeBase58 } from '../src/payment-ref.js';

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
      extra: { feePayer: SOL_FEE },
    },
    payload: { transaction: 'AQAAAA==' },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function listenFacilitator() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      hits.push(req.url || '');
      const network = 'solana';
      res.setHeader('content-type', 'application/json');
      if ((req.url || '').endsWith('/verify')) {
        res.end(JSON.stringify({ valid: true, isValid: true, payer: SOL_PAYER }));
        return;
      }
      res.end(JSON.stringify({
        settled: true,
        success: true,
        txRef: SOL_SIG,
        transaction: SOL_SIG,
        network,
        payer: SOL_PAYER,
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

function tx(shape) {
  const ata = associatedTokenAddress(SOL_HOUSE, SOL_MINT);
  const built = {
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
  if (shape === 'confirmed') built.confirmationStatus = 'confirmed';
  if (shape === 'fixture-final') built.confirmationStatus = 'finalized';
  return built;
}

function settle(cfg, store, nonce, header) {
  return settleBoundPayment({
    taskId: 'task-1',
    amount: '2000',
    cfg,
    store,
    nonce,
    paymentHeader: header,
    clientVersion: 2,
    resource: '/task-request',
  });
}

test.beforeEach(() => {
  clearChainReaderForTests();
});

test('DOC-D1 a Solana hold that finalizes later yields one receipt on a same-header retry', async () => {
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
    chainReader: async (args) => confirmSolanaTransaction(tx(mode), {
      challenge: args.challenge,
      expectedPayTo: args.expectedPayTo,
      facilitatorPayer: args.facilitator?.payer,
      signature: SOL_SIG,
    }),
  };
  try {
    for (const finalShape of ['fixture-final', 'rpc-final']) {
      mode = 'confirmed';
      const before = fac.hits.filter((url) => url.endsWith('/settle')).length;
      const store = new ChallengeStore();
      const nonce = `0x${finalShape === 'rpc-final' ? 'cd' : 'ab'}${'ab'.repeat(31)}`;
      store.put(nonce, {
        taskId: 'task-1',
        amount: '2000',
        asset: SOL_MINT,
        network: 'solana',
        payTo: SOL_HOUSE,
        resource: '/task-request',
        state: 'issued',
        expiresAt: Date.now() + 60_000,
        feePayer: SOL_FEE,
        nonce,
      });
      const header = solHeader();
      const first = await settle(cfg, store, nonce, header);
      assert.equal(first.code, 'settle_pending', finalShape);
      mode = finalShape;
      const r1 = await settle(cfg, store, nonce, header);
      const r2 = await settle(cfg, store, nonce, header);
      const concurrent = await Promise.all([
        settle(cfg, store, nonce, header),
        settle(cfg, store, nonce, header),
      ]);
      assert.equal(r1.kind, 'settled', `${finalShape} ${r1.code} ${r1.reason}`);
      assert.notEqual(r1.idempotentReplay, true);
      const fresh = [r1, r2, ...concurrent].filter((row) => row.kind === 'settled' && row.idempotentReplay !== true);
      assert.equal(fresh.length, 1, finalShape);
      for (const row of [r2, ...concurrent]) {
        assert.equal(row.idempotentReplay, true, finalShape);
        assert.equal(row.paymentRef, r1.paymentRef);
      }
      assert.equal(fac.hits.filter((url) => url.endsWith('/settle')).length - before, 1, finalShape);
      const held = serveSolanaHold(first.pendingId, store, header);
      assert.equal(held.status, 200);
      assert.equal(held.body.id, first.pendingId);
      const stranger = serveSolanaHold(first.pendingId, store, null);
      assert.equal(stranger.body.state, 'final');
      assert.equal(stranger.body.id, undefined);
    }
  } finally {
    await fac.close();
  }
});

test('DOC-D1 an RPC error on the Solana retry stays settle_pending', async () => {
  const fac = await listenFacilitator();
  let boom = false;
  const cfg = {
    network: 'solana',
    payTo: SOL_HOUSE,
    facilitatorProvider: 'zan',
    gatewayUrl: fac.url,
    apiKey: 'k',
    asset: USDC,
    allowUnboundPayments: false,
    solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
    chainReader: async () => {
      if (boom) throw new Error('rpc down');
      return { ok: false, pending: true };
    },
  };
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'ef'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-1',
      amount: '2000',
      asset: SOL_MINT,
      network: 'solana',
      payTo: SOL_HOUSE,
      resource: '/task-request',
      state: 'issued',
      expiresAt: Date.now() + 60_000,
      feePayer: SOL_FEE,
      nonce,
    });
    const header = solHeader();
    const first = await settle(cfg, store, nonce, header);
    assert.equal(first.code, 'settle_pending');
    boom = true;
    const again = await settle(cfg, store, nonce, header);
    assert.equal(again.code, 'settle_pending');
    assert.notEqual(again.code, 'not_settled');
    assert.equal(again.pendingId, first.pendingId);
  } finally {
    await fac.close();
  }
});
