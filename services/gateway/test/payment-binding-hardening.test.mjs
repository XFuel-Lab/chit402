/**
 * Payment-binding regression. Offline facilitator plus a stub chain reader.
 * Requirements, payee, and amount come from the server challenge and the
 * confirmed transfer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ethers } from 'ethers';

import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment, assertConfirmedSettlement, quoteBodyHash, reconcilePending } from '../src/x402-settle.js';
import {
  confirmEvmReceipt,
  confirmSolanaTransaction,
  associatedTokenAddress,
  deriveCreate2Address,
  wrapErc6492,
  readEvmAuthorization,
  clearChainReaderForTests,
} from '../src/x402-chain.js';
import { assertX402Boot, isBindingRefusal, paymentErrorStatus, resetRefusalCounts } from '../src/x402-flags.js';
import { DurableChallengeStore, setActiveChallengeStore } from '../src/x402-durable-store.js';
import { normalizePaymentRef } from '../src/payment-ref.js';
import { encodeBase58 } from '../src/payment-ref.js';
import {
  ingestForeignX402,
  buildOnChainVerify,
} from '../src/foreign-x402-ingest.js';
import { AgentRegistry } from '../src/agent-registry.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import {
  setOwnerProofVerifier,
  verifyOwnerProof,
  resetOwnerProofNonces,
} from '../src/owner-proof.js';
import { sendPublicInternal } from '../src/public-error.js';
import { registerBoardRoutes } from '../src/board-routes.js';
import { BoardPostStore } from '../src/board-posts.js';
import config from '../src/config.js';
import logger from '../src/logger.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const ATTACKER = `0x${'22'.repeat(20)}`;
const WORKER = `0x${'66'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_HOUSE = '2SKNEcAnVCiKtFwWhYvj3QjSLepR4eh8rDpHab3xPtP1';
const SOL_PAYER = 'SoLPayer1111111111111111111111111111111111';
const SOL_FEE = 'SoLFeePayer11111111111111111111111111111111';
const SOL_SIG = encodeBase58(Buffer.alloc(64, 7));
const AUTH_NONCE = `0x${'cd'.repeat(32)}`;
const TX = `0x${'ab'.repeat(32)}`;
const MARKER = 'ZZ_MARK_9f3';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function evmHeader({
  from = PAYER,
  to = HOUSE,
  value = '2000',
  nonce = AUTH_NONCE,
  network = 'base',
  payTo = HOUSE,
  amount = '2000',
  signature = `0x${'11'.repeat(65)}`,
} = {}) {
  const blob = {
    network,
    amount,
    payTo,
    payload: {
      signature,
      authorization: {
        from,
        to,
        value,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function solHeader({ amount = '2000', payTo = SOL_HOUSE } = {}) {
  const blob = {
    x402Version: 2,
    network: 'solana',
    accepted: {
      scheme: 'exact',
      network: 'solana',
      amount,
      payTo,
      asset: SOL_MINT,
      extra: { feePayer: SOL_FEE },
    },
    payload: { transaction: 'AQAAAA==' },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function evmReceipt({
  from = PAYER,
  to = HOUSE,
  value = 2000n,
  asset = USDC,
  nonce = AUTH_NONCE,
  status = 1,
  contractAddress = null,
  extra = [],
} = {}) {
  return {
    status,
    blockNumber: 12,
    contractAddress,
    logs: [
      {
        address: asset,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          ethers.zeroPadValue(from, 32),
          ethers.zeroPadValue(to, 32),
        ],
        data: ethers.toBeHex(BigInt(value), 32),
        logIndex: 0,
      },
      {
        address: asset,
        topics: [
          ethers.id('AuthorizationUsed(address,bytes32)'),
          ethers.zeroPadValue(from, 32),
          ethers.zeroPadValue(nonce, 32),
        ],
        data: '0x',
        logIndex: 1,
      },
      ...extra,
    ],
  };
}

function chainFromReceipt(receipt) {
  return async ({ challenge, facilitator, paymentHeader, expectedPayTo }) => confirmEvmReceipt(receipt, {
    challenge,
    expectedPayTo,
    authorization: readEvmAuthorization(paymentHeader),
    facilitatorPayer: facilitator?.payer,
  });
}

function listenFacilitator({ tx = TX, payer = PAYER, delay = 0, valid = true } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      hits.push({ url: req.url, body, facilitator: req.headers['x-facilitator-url'] || null });
      const finish = () => {
        const network = body.network || body.paymentRequirements?.network || 'base';
        const from = body.paymentPayload?.payload?.authorization?.from || payer;
        const txOut = tx;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        if ((req.url || '').endsWith('/verify')) {
          res.end(JSON.stringify(valid
            ? { valid: true, isValid: true, txRef: txOut, payer: from }
            : { valid: false, isValid: false, reason: 'mock_rejected', invalidReason: 'mock_rejected' }));
          return;
        }
        if ((req.url || '').endsWith('/settle')) {
          res.end(JSON.stringify(valid
            ? { settled: true, success: true, txRef: txOut, transaction: txOut, network, payer: from }
            : { settled: false, success: false, reason: 'nope' }));
          return;
        }
        res.statusCode = 404;
        res.end('{}');
      };
      if (delay > 0) setTimeout(finish, delay);
      else finish();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function baseCfg(url, over = {}) {
  return {
    network: 'base',
    payTo: HOUSE,
    facilitatorProvider: 'zan',
    gatewayUrl: url,
    apiKey: 'k',
    asset: USDC,
    allowUnboundPayments: false,
    ...over,
  };
}

function putChallenge(store, fields = {}) {
  const nonce = fields.nonce || `0x${'ab'.repeat(32)}`;
  store.put(nonce, {
    taskId: 'task-1',
    amount: '2000',
    asset: USDC,
    network: 'base',
    payTo: HOUSE,
    resource: '/task-request',
    state: 'issued',
    expiresAt: Date.now() + 60_000,
    ...fields,
    nonce,
  });
  return nonce;
}

async function settle(opts) {
  return settleBoundPayment({
    taskId: 'task-1',
    amount: '2000',
    paymentHeader: evmHeader(),
    ...opts,
  });
}

test.beforeEach(() => {
  clearChainReaderForTests();
  setActiveChallengeStore(null);
  resetOwnerProofNonces();
  setOwnerProofVerifier(null);
  resetRefusalCounts();
  delete process.env.X402_ALLOW_UNBOUND;
});

test('PT1 no nonce never calls the facilitator', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const header = evmHeader({ to: ATTACKER, payTo: ATTACKER, value: '1', amount: '1' });
    const decision = await settle({
      cfg: baseCfg(fac.url),
      store,
      paymentHeader: header,
      nonce: null,
    });
    assert.equal(decision.code, 'challenge_required');
    assert.equal(decision.kind, 'failed');
    assert.equal(fac.hits.length, 0);
  } finally {
    await fac.close();
  }
});

test('PT2 settled recipient must be the configured house payee', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const decision = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ to: ATTACKER })) }),
      store,
      nonce,
      paymentHeader: evmHeader({ to: HOUSE }),
    });
    assert.equal(decision.code, 'settle_unconfirmed');
    assert.equal(decision.kind, 'failed');
  } finally {
    await fac.close();
  }
});

test('PT3 chain value below the quote is refused', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { amount: '2000' });
    const decision = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 1999n })) }),
      store,
      nonce,
      amount: '2000',
    });
    assert.equal(decision.code, 'settle_unconfirmed');
    const unbound = await settle({
      cfg: baseCfg(fac.url),
      store: new ChallengeStore(),
      nonce: '0xdead',
      amount: '1',
      paymentHeader: evmHeader({ value: '1', amount: '1' }),
    });
    assert.equal(unbound.code, 'challenge_required');
  } finally {
    await fac.close();
  }
});

test('PT4 a transfer from a non-USDC contract is refused', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const decision = await settle({
      cfg: baseCfg(fac.url, {
        chainReader: chainFromReceipt(evmReceipt({ asset: ATTACKER })),
      }),
      store,
      nonce,
    });
    assert.equal(decision.code, 'settle_unconfirmed');
    const settleHit = fac.hits.find((h) => h.url.endsWith('/settle'));
    assert.equal(settleHit.body.network, 'base');
  } finally {
    await fac.close();
  }
});

test('PT5 blob network, facilitator network, and mainnet rollback boot', async () => {
  const lines = [];
  const orig = logger.error.bind(logger);
  logger.error = (...args) => { lines.push(args); return orig(...args); };
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { network: 'base' });
    const mismatch = await settle({
      cfg: baseCfg(fac.url),
      store,
      nonce,
      paymentHeader: evmHeader({ network: 'base-sepolia' }),
    });
    assert.equal(mismatch.code, 'network_not_accepted');
    assert.equal(fac.hits.length, 0);

    const store2 = new ChallengeStore();
    const nonce2 = putChallenge(store2);
    await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt()) }),
      store: store2,
      nonce: nonce2,
    });
    const body = fac.hits.find((h) => h.url.endsWith('/settle')).body;
    assert.equal(body.network, 'base');

    assert.throws(() => assertX402Boot({ allowUnboundPayments: true, network: 'base' }), /mainnet/);
    assert.doesNotThrow(() => assertX402Boot({ allowUnboundPayments: true, network: 'base-sepolia' }));
    const rolled = await settleBoundPayment({
      taskId: 't',
      cfg: baseCfg(fac.url, { allowUnboundPayments: true, network: 'base-sepolia' }),
      paymentHeader: evmHeader(),
      nonce: null,
    });
    assert.equal(rolled, null);
    assert.ok(lines.some((args) => JSON.stringify(args).includes('unbound')));
  } finally {
    logger.error = orig;
    await fac.close();
  }
});

test('PT6 facilitator fields that are not a confirmed transfer are refused', async () => {
  const cases = [
    { tx: '', label: 'missing tx' },
    { tx: TX, network: 'base-sepolia', label: 'wrong network' },
    { tx: TX, payer: ATTACKER, label: 'payer drift' },
    { tx: '0x1234', label: 'malformed tx' },
  ];
  for (const item of cases) {
    const hits = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        hits.push(req.url);
        res.setHeader('content-type', 'application/json');
        if ((req.url || '').endsWith('/verify')) {
          res.end(JSON.stringify({ valid: true, payer: PAYER }));
          return;
        }
        const network = item.network || 'base';
        const tx = item.tx;
        res.end(JSON.stringify({
          settled: true,
          success: true,
          txRef: tx || null,
          transaction: tx || null,
          network,
          payer: item.payer || PAYER,
        }));
      });
    });
    const url = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
    try {
      const store = new ChallengeStore();
      const nonce = putChallenge(store);
      const decision = await settle({
        cfg: baseCfg(url, { chainReader: chainFromReceipt(evmReceipt()) }),
        store,
        nonce,
      });
      const want = item.label === 'wrong network' ? 'network_not_accepted' : 'settle_unconfirmed';
      assert.equal(decision.code, want, item.label);
      assert.ok(store.listPending().length >= 1, item.label);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
});

test('PT7 client facilitator URLs are ignored', async () => {
  const house = await listenFacilitator();
  const attacker = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { resource: '/task-request' });
    const raw = {
      network: 'base',
      amount: '1',
      payTo: ATTACKER,
      facilitator: attacker.url,
      facilitatorUrl: attacker.url,
      payload: {
        signature: `0x${'11'.repeat(65)}`,
        authorization: {
          from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: '9999999999', nonce: AUTH_NONCE,
        },
      },
    };
    const header = Buffer.from(JSON.stringify(raw)).toString('base64');
    const decision = await settle({
      cfg: baseCfg(house.url, { chainReader: chainFromReceipt(evmReceipt()) }),
      store,
      nonce,
      paymentHeader: header,
      req: { headers: { 'x-facilitator-url': attacker.url, 'user-agent': 'pt7' } },
    });
    assert.equal(decision.kind, 'settled');
    assert.equal(attacker.hits.length, 0);
    const verify = house.hits.find((h) => h.url.endsWith('/verify'));
    assert.equal(verify.body.expected.payTo, HOUSE);
    assert.equal(verify.body.expected.amount, '2000');
    assert.equal(verify.body.expected.resource, '/task-request');
  } finally {
    await house.close();
    await attacker.close();
  }
});

test('PT8 a spent nonce or the same authorization cannot settle twice', async () => {
  const fac = await listenFacilitator();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pt8-'));
  try {
    const file = path.join(dir, 'challenges.json');
    const store = new DurableChallengeStore(file);
    const nonce = putChallenge(store);
    const header = evmHeader();
    const cfg = baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt()) });
    const first = await settle({ cfg, store, nonce, paymentHeader: header });
    assert.equal(first.kind, 'settled');
    const again = await settle({ cfg, store, nonce, paymentHeader: header });
    assert.equal(again.code, 'payment_replayed');
    const reopened = new DurableChallengeStore(file);
    const after = await settle({ cfg, store: reopened, nonce, paymentHeader: header });
    assert.equal(after.code, 'payment_replayed');

    const fresh = putChallenge(store, { nonce: `0x${'ef'.repeat(32)}` });
    const replayAuth = await settle({
      cfg,
      store,
      nonce: fresh,
      paymentHeader: header,
    });
    assert.equal(replayAuth.code, 'payment_replayed');
    assert.equal(fac.hits.filter((h) => h.url.endsWith('/settle')).length, 1);
  } finally {
    await fac.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PT9 one in-flight claim per challenge', async () => {
  const fac = await listenFacilitator({ delay: 40 });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt()) });
    const [a, b] = await Promise.all([
      settle({ cfg, store, nonce }),
      settle({ cfg, store, nonce }),
    ]);
    const codes = [a.code, b.code].filter(Boolean);
    assert.equal([a.kind, b.kind].filter((k) => k === 'settled').length, 1);
    assert.ok(codes.includes('payment_in_flight'));
    assert.equal(fac.hits.filter((h) => h.url.endsWith('/settle')).length, 1);

    const many = new ChallengeStore();
    const nonceN = putChallenge(many);
    const raced = await Promise.all(Array.from({ length: 10 }, () => settle({
      cfg, store: many, nonce: nonceN,
    })));
    assert.equal(raced.filter((r) => r.kind === 'settled').length, 1);
    assert.ok(raced.some((r) => r.code === 'payment_in_flight'));
  } finally {
    await fac.close();
  }
});

test('PT9c two processes share one claim', async () => {
  const fac = await listenFacilitator({ delay: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pt9c-'));
  try {
    const file = path.join(dir, 'challenges.json');
    const store = new DurableChallengeStore(file);
    const nonce = putChallenge(store);
    const worker = fileURLToPath(new URL('./fixtures/payment-binding-worker.mjs', import.meta.url));
    const cfg = baseCfg(fac.url, { quoteAmount: '2000' });
    delete cfg.chainReader;
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, file, nonce, 'task-1'], {
        env: { ...process.env, PB_CFG: JSON.stringify(cfg), PB_HEADER: evmHeader() },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (code) => {
        try {
          const matches = out.match(/\{[^{}]*\}/g);
          const line = matches ? matches[matches.length - 1] : null;
          if (code !== 0 || !line) reject(new Error(err || out || `worker ${code}`));
          else resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`${e.message}\n${out}\n${err}`));
        }
      });
    });
    const [a, b] = await Promise.all([run(), run()]);
    const kinds = [a, b];
    assert.equal(kinds.filter((r) => r.kind === 'settled').length, 1);
    assert.ok(kinds.some((r) => r.code === 'payment_in_flight'));
  } finally {
    await fac.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PT10 a challenge is bound to its resource and quote', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { resource: '/v1/book/ingest', amount: '2000' });
    const crossed = await settle({
      cfg: baseCfg(fac.url),
      store,
      nonce,
      amount: '500000',
      resource: '/v1/chat/completions',
    });
    assert.equal(crossed.code, 'challenge_mismatch');
    assert.equal(fac.hits.length, 0);

    const storeR = new ChallengeStore();
    const nonceR = putChallenge(storeR, { resource: '/task-request', amount: '2000' });
    const resourceOnly = await settle({
      cfg: baseCfg(fac.url),
      store: storeR,
      nonce: nonceR,
      amount: '2000',
      resource: '/v1/chat/completions',
    });
    assert.equal(resourceOnly.code, 'challenge_mismatch');

    const body = { model: 'same' };
    const storeQ = new ChallengeStore();
    const nonceQ = putChallenge(storeQ, { amount: '2000', quoteBodyHash: quoteBodyHash(body) });
    const priced = await settleBoundPayment({
      taskId: 'task-1',
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt()) }),
      store: storeQ,
      nonce: nonceQ,
      priceBody: body,
      paymentHeader: evmHeader(),
      resolveQuote: async () => '999999',
    });
    assert.equal(priced.kind, 'settled', priced.code);

    const storeD = new ChallengeStore();
    const nonceD = putChallenge(storeD, { amount: '2000', quoteBodyHash: quoteBodyHash(body) });
    const drifted = await settleBoundPayment({
      taskId: 'task-1',
      cfg: baseCfg(fac.url),
      store: storeD,
      nonce: nonceD,
      priceBody: { model: 'changed' },
      paymentHeader: evmHeader(),
      resolveQuote: async () => '5000',
    });
    assert.equal(drifted.code, 'challenge_mismatch');
  } finally {
    await fac.close();
  }
});

test('PT11 a job leg pays the worker, not the house', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const houseNonce = putChallenge(store, { payTo: HOUSE, taskId: 'board-job-payment-1' });
    const houseOnJob = await settle({
      cfg: baseCfg(fac.url),
      store,
      nonce: houseNonce,
      payTo: WORKER,
      strictTaskId: true,
      taskId: 'board-job-payment-1',
    });
    assert.equal(houseOnJob.code, 'challenge_mismatch');

    const storeW = new ChallengeStore();
    const workerNonce = putChallenge(storeW, { payTo: WORKER, taskId: 'board-job-payment-1' });
    const toHouse = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ to: HOUSE })) }),
      store: storeW,
      nonce: workerNonce,
      payTo: WORKER,
      strictTaskId: true,
      taskId: 'board-job-payment-1',
      expectedPayer: PAYER,
      paymentHeader: evmHeader({ to: WORKER }),
    });
    assert.equal(toHouse.code, 'settle_unconfirmed');

    const storeF = new ChallengeStore();
    const feeNonce = putChallenge(storeF, { payTo: HOUSE, taskId: 'board-job-fee-1' });
    const feeOnJob = await settle({
      cfg: baseCfg(fac.url),
      store: storeF,
      nonce: feeNonce,
      payTo: WORKER,
      strictTaskId: true,
      taskId: 'board-job-payment-1',
    });
    assert.equal(feeOnJob.code, 'challenge_mismatch');

    const storeOk = new ChallengeStore();
    const okNonce = putChallenge(storeOk, { payTo: WORKER, taskId: 'board-job-payment-1' });
    const paid = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ to: WORKER })) }),
      store: storeOk,
      nonce: okNonce,
      payTo: WORKER,
      strictTaskId: true,
      taskId: 'board-job-payment-1',
      expectedPayer: PAYER,
      paymentHeader: evmHeader({ to: WORKER }),
    });
    assert.equal(paid.kind, 'settled');
    assert.equal(paid.payTo, ethers.getAddress(WORKER));
    assert.equal(paid.confirmed, true);
  } finally {
    await fac.close();
  }
});

test('PT12 ERC-6492 deploys the derived payer and refuses a truncated wrapper', async () => {
  const factory = ethers.getAddress(`0x${'44'.repeat(20)}`);
  const salt = `0x${'45'.repeat(32)}`;
  const initCodeHash = `0x${'46'.repeat(32)}`;
  const derived = deriveCreate2Address(factory, salt, initCodeHash);
  const wrapped = wrapErc6492({ factory, salt, initCodeHash });
  const fac = await listenFacilitator({ payer: derived });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader({ from: derived, signature: wrapped });
    const ok = await settle({
      cfg: baseCfg(fac.url, {
        chainReader: chainFromReceipt(evmReceipt({
          from: derived,
          contractAddress: derived,
        })),
      }),
      store,
      nonce,
      paymentHeader: header,
    });
    assert.equal(ok.kind, 'settled', ok.code);
    assert.equal(ok.payerWallet, derived);

    const storeBad = new ChallengeStore();
    const nonceBad = putChallenge(storeBad);
    const wrong = await settle({
      cfg: baseCfg(fac.url, {
        // The factory deployed a different address, so USDC never accepted a
        // signature for `from`: no AuthorizationUsed(authorizer = derived).
        chainReader: chainFromReceipt((() => {
          const r = evmReceipt({ from: derived });
          r.logs[1].topics[1] = ethers.zeroPadValue(ATTACKER, 32);
          return r;
        })()),
      }),
      store: storeBad,
      nonce: nonceBad,
      paymentHeader: header,
    });
    assert.equal(wrong.code, 'settle_unconfirmed');

    const truncated = `${`0x${'11'.repeat(40)}`}64926492`;
    const storeT = new ChallengeStore();
    const nonceT = putChallenge(storeT);
    const cut = await settle({
      cfg: baseCfg(fac.url, {
        chainReader: chainFromReceipt(evmReceipt({ from: PAYER })),
      }),
      store: storeT,
      nonce: nonceT,
      paymentHeader: evmHeader({ signature: truncated }),
    });
    assert.equal(cut.code, 'settle_unconfirmed');
  } finally {
    await fac.close();
  }

  setOwnerProofVerifier(async ({ payer }) => ({ ok: true, signer: payer }));
  const now = Date.now();
  const proof = { nonce: 'owner-nonce-1', issued_at: now };
  const proved = await verifyOwnerProof({ agentId: 1, paymentRef: 'base:0x1', payer: derived, proof, now });
  assert.equal(proved.ok, true);
  const replay = await verifyOwnerProof({ agentId: 1, paymentRef: 'base:0x1', payer: derived, proof, now });
  assert.equal(replay.code, 'owner_proof_required');
  setOwnerProofVerifier(null);
  const closed = await verifyOwnerProof({
    agentId: 1,
    paymentRef: 'base:0x1',
    payer: derived,
    proof: { nonce: 'fresh', issued_at: now },
    now,
  });
  assert.equal(closed.code, 'owner_proof_unavailable');
});

test('PT13 Solana transfers are one finalized transferChecked into the house ATA', async () => {
  const ata = associatedTokenAddress(SOL_HOUSE, SOL_MINT);
  assert.ok(ata);
  const fac = await listenFacilitator({ tx: SOL_SIG, payer: SOL_PAYER });
  const solCfg = (reader) => baseCfg(fac.url, {
    solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
    chainReader: reader,
  });
  function tx(over = {}) {
    const destination = over.destination || ata;
    const authority = over.authority || SOL_PAYER;
    const mint = over.mint || SOL_MINT;
    const amount = over.amount || '2000';
    const type = over.type || 'transferChecked';
    const instructions = [...(over.extra || []), {
      programId: TOKEN_PROGRAM,
      parsed: {
        type,
        info: {
          mint,
          destination,
          authority,
          source: over.source || 'SourceToken111111111111111111111111111111',
          tokenAmount: { amount, decimals: over.decimals ?? 6 },
        },
      },
    }];
    return {
      confirmationStatus: over.status || 'finalized',
      finalized: over.finalized,
      slot: 4,
      meta: {
        err: null,
        preTokenBalances: [{ accountIndex: 1, mint, uiTokenAmount: { amount: '0' } }],
        postTokenBalances: [{ accountIndex: 1, mint, uiTokenAmount: { amount } }],
      },
      transaction: {
        signatures: [SOL_SIG],
        message: { accountKeys: [authority, destination], instructions },
      },
    };
  }
  async function once(built, challengeOver = {}) {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, {
      network: 'solana',
      payTo: SOL_HOUSE,
      asset: SOL_MINT,
      feePayer: SOL_FEE,
      ...challengeOver,
    });
    return settle({
      cfg: solCfg(async (args) => confirmSolanaTransaction(built, {
        challenge: args.challenge,
        expectedPayTo: args.expectedPayTo,
        facilitatorPayer: args.facilitator?.payer,
        signature: SOL_SIG,
      })),
      store,
      nonce,
      paymentHeader: solHeader(),
      clientVersion: 2,
    });
  }
  try {
    assert.equal((await once(tx({ mint: `Mint${'1'.repeat(32)}` }))).code, 'settle_unconfirmed');
    assert.equal((await once(tx({ destination: SOL_PAYER }))).code, 'settle_unconfirmed');
    assert.equal((await once(tx({ type: 'transfer' }))).code, 'settle_unconfirmed');
    assert.equal((await once(tx({ authority: SOL_FEE, source: SOL_FEE }), { feePayer: SOL_FEE })).code, 'settle_unconfirmed');
    assert.equal((await once(tx({
      extra: [{ programId: 'CloseAccount1111111111111111111111111111111', parsed: { type: 'closeAccount' } }],
    }))).code, 'settle_unconfirmed');
    const pending = await once(tx({ status: 'confirmed' }));
    assert.equal(pending.code, 'settle_unconfirmed');
    assert.equal((await once(tx({ authority: SOL_HOUSE }))).code, 'settle_unconfirmed');
    const ok = await once(tx());
    assert.equal(ok.kind, 'settled', ok.code);
    assert.equal(ok.payerWallet, SOL_PAYER);
    assert.equal(ok.payTo, SOL_HOUSE);
  } finally {
    await fac.close();
  }
});

test('PT14 ingest binds the on-chain payer to the agent', async () => {
  const tx = `0x${'d1'.repeat(32)}`;
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'seat' });
  const body = {
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx, payer: OTHER, network: 'base' },
    session: identity.session,
  };
  const verify = async () => ({ valid: true, payer: OTHER, txHash: tx, blockNumber: 1 });
  const stolen = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify,
  });
  assert.equal(stolen.status, 403);
  assert.equal(stolen.code, 'payer_not_bound');
  assert.equal(ledger.entries.length, 0);

  registry.bindWallet(identity.agent_id, { agentWallet: OTHER });
  const owned = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify,
  });
  assert.equal(owned.status, 201, owned.message);
  assert.equal(ledger.entries.length, 1);

  const tx2 = `0x${'d2'.repeat(32)}`;
  const mismatch = await ingestForeignX402({
    ...body,
    payment_response: { tx: tx2, payer: PAYER, network: 'base' },
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({ valid: true, payer: OTHER, txHash: tx2 }),
  });
  assert.equal(mismatch.code, 'payer_mismatch');
  assert.equal(ledger.entries.length, 1);

  const stranger = new AgentRegistry();
  const seat = stranger.allocate({ taskId: 'unbound' });
  const book = new UsageSettledLedger();
  const tx3 = `0x${'d3'.repeat(32)}`;
  const noHook = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: tx3, payer: PAYER, network: 'base' },
    session: seat.session,
    owner_proof: { nonce: 'n-1', issued_at: Date.now() },
  }, {
    ledger: book,
    registry: stranger,
    agentId: seat.agent_id,
    session: seat.session,
    verify: async () => ({ valid: true, payer: PAYER, txHash: tx3 }),
  });
  assert.equal(noHook.code, 'owner_proof_unavailable');
  assert.equal(book.entries.length, 0);

  setOwnerProofVerifier(async ({ payer }) => ({ ok: true, signer: payer }));
  const tx4 = `0x${'d4'.repeat(32)}`;
  const now = Date.now();
  const proved = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: tx4, payer: PAYER, network: 'base' },
    session: seat.session,
    owner_proof: { nonce: 'n-proof', issued_at: now },
  }, {
    ledger: book,
    registry: stranger,
    agentId: seat.agent_id,
    session: seat.session,
    verify: async () => ({ valid: true, payer: PAYER, txHash: tx4 }),
  });
  assert.equal(proved.status, 201, proved.message);

  const tx5 = `0x${'d5'.repeat(32)}`;
  const replayed = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: tx5, payer: PAYER, network: 'base' },
    session: seat.session,
    owner_proof: { nonce: 'n-proof', issued_at: now },
  }, {
    ledger: book,
    registry: stranger,
    agentId: seat.agent_id,
    session: seat.session,
    verify: async () => ({ valid: true, payer: PAYER, txHash: tx5 }),
  });
  assert.equal(replayed.code, 'owner_proof_required');

  const tx6 = `0x${'d6'.repeat(32)}`;
  const expired = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: tx6, payer: PAYER, network: 'base' },
    session: seat.session,
    owner_proof: { nonce: 'n-old', issued_at: now - 121_000 },
  }, {
    ledger: book,
    registry: stranger,
    agentId: seat.agent_id,
    session: seat.session,
    verify: async () => ({ valid: true, payer: PAYER, txHash: tx6 }),
  });
  assert.equal(expired.code, 'owner_proof_required');
  setOwnerProofVerifier(null);
});

test('PT15 payment refs are normalized and case-variant duplicates collide', async () => {
  const hash = `0x${'ab'.repeat(32)}`;
  const upper = `0x${'AB'.repeat(32)}`;
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'ref' });
  registry.bindWallet(identity.agent_id, { agentWallet: PAYER });
  const verify = async (args) => ({ valid: true, payer: PAYER, txHash: args.paymentRef });
  const first = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: hash, payer: PAYER, network: 'base' },
    session: identity.session,
  }, { ledger, registry, agentId: identity.agent_id, session: identity.session, verify });
  assert.equal(first.status, 201, first.message);
  const second = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: upper, payer: PAYER, network: 'base' },
    session: identity.session,
  }, { ledger, registry, agentId: identity.agent_id, session: identity.session, verify });
  assert.equal(second.status, 409);
  assert.equal(ledger.entries.length, 1);

  const third = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: hash, payer: PAYER, network: 'eip155:8453' },
    session: identity.session,
  }, { ledger, registry, agentId: identity.agent_id, session: identity.session, verify });
  assert.equal(third.status, 409);

  const flipped = SOL_SIG.slice(0, -1) + (SOL_SIG.endsWith('8') ? '7' : '8');
  const a = normalizePaymentRef('solana', SOL_SIG);
  const b = normalizePaymentRef('solana', flipped);
  assert.equal(a.ok, true);
  assert.notEqual(a.key, b.ok ? b.key : flipped);
  const solBook = new UsageSettledLedger();
  const solReg = new AgentRegistry();
  const solId = solReg.allocate({ taskId: 'sol' });
  solReg.bindWallet(solId.agent_id, { agentWallet: SOL_PAYER });
  const missing = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: SOL_HOUSE },
    payment_response: { tx: flipped, payer: SOL_PAYER, network: 'solana' },
    session: solId.session,
  }, {
    ledger: solBook,
    registry: solReg,
    agentId: solId.agent_id,
    session: solId.session,
    verify: async () => ({ valid: false, reason: 'not found' }),
  });
  assert.equal(missing.ok, false);
  assert.equal(solBook.entries.length, 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pt15-'));
  const low = hash.toLowerCase();
  const rows = [low, upper].map((tx, i) => JSON.stringify({
    agent_id: 1,
    task_id: `t-${i}`,
    payment_ref: `base:${tx}`,
    seq: i + 1,
  }));
  fs.writeFileSync(path.join(dir, 'usage-settled.jsonl'), `${rows.join('\n')}\n`);
  const loaded = new UsageSettledLedger({ dir, persist: true });
  assert.equal(loaded.refCollisionCount, 1);
  assert.equal(loaded.entries.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PT16 client input is not echoed on a binding refusal', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader({ network: `base<script>${MARKER}` });
    const decision = await settle({
      cfg: baseCfg(fac.url),
      store,
      nonce,
      paymentHeader: header,
      req: { headers: { 'x-payment-nonce': `${MARKER}<script>`, 'user-agent': 'pt16' } },
    });
    const body = JSON.stringify(decision);
    assert.equal(body.includes(MARKER), false);
    assert.equal(body.includes('<'), false);
    assert.ok(['network_not_accepted', 'challenge_mismatch', 'verify_failed'].includes(decision.code));
  } finally {
    await fac.close();
  }
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  sendPublicInternal(res, new Error(`boom ${MARKER} <script>`), 'ingest', 'ingest_failed');
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'internal', code: 'ingest_failed' });
  assert.equal(JSON.stringify(res.body).includes(MARKER), false);
  assert.equal(JSON.stringify(res.body).includes('<'), false);
});

test('PT17 a confirmed EVM settle binds amount, payer, and ref', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { amount: '2000' });
    const decision = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 2000n })) }),
      store,
      nonce,
    });
    assert.equal(decision.kind, 'settled');
    assert.equal(decision.confirmed, true);
    assert.equal(decision.settledAmount, '2000');
    assert.equal(decision.payerWallet, ethers.getAddress(PAYER));
    assert.equal(decision.payTo, ethers.getAddress(HOUSE));
    assert.equal(decision.paymentRef, `base:${TX}`);
    assert.equal(store.isSpent(nonce), true);
  } finally {
    await fac.close();
  }
});

test('PT18 a confirmed Solana settle keeps the exact signature and authority', async () => {
  const ata = associatedTokenAddress(SOL_HOUSE, SOL_MINT);
  const fac = await listenFacilitator({ tx: SOL_SIG, payer: SOL_PAYER });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, {
      network: 'solana',
      payTo: SOL_HOUSE,
      asset: SOL_MINT,
      feePayer: SOL_FEE,
    });
    const built = {
      confirmationStatus: 'finalized',
      slot: 8,
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
    const decision = await settle({
      cfg: baseCfg(fac.url, {
        solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
        chainReader: async (args) => confirmSolanaTransaction(built, {
          challenge: args.challenge,
          expectedPayTo: args.expectedPayTo,
          facilitatorPayer: args.facilitator?.payer,
          signature: SOL_SIG,
        }),
      }),
      store,
      nonce,
      paymentHeader: solHeader(),
      clientVersion: 2,
    });
    assert.equal(decision.kind, 'settled', decision.code);
    assert.equal(decision.paymentRef, `solana:${SOL_SIG}`);
    assert.equal(decision.payerWallet, SOL_PAYER);
    assert.notEqual(decision.payerWallet, SOL_FEE);
  } finally {
    await fac.close();
  }
});

test('PT19 overpay receipts carry the chain value', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { amount: '2000' });
    const decision = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 2500n })) }),
      store,
      nonce,
      amount: '2000',
    });
    assert.equal(decision.kind, 'settled', decision.code);
    assert.equal(decision.settledAmount, '2500');
  } finally {
    await fac.close();
  }
});

test('PT20 rolling debt stays until a bound payment covers it', async () => {
  const fac = await listenFacilitator();
  let marks = 0;
  const markSettled = () => { marks += 1; };
  const taskId = 'owed-task';
  const debt = 20000n;
  try {
    const unbound = await settle({
      cfg: baseCfg(fac.url),
      store: new ChallengeStore(),
      nonce: null,
      amount: String(debt),
      taskId,
    });
    assert.equal(unbound.code, 'challenge_required');
    assert.equal(isBindingRefusal(unbound.code), true);
    if (!isBindingRefusal(unbound.code)) markSettled();
    assert.equal(marks, 0);

    const cheapStore = new ChallengeStore();
    const cheapNonce = putChallenge(cheapStore, { amount: '2000', taskId });
    const cheap = await settle({
      cfg: baseCfg(fac.url),
      store: cheapStore,
      nonce: cheapNonce,
      amount: String(debt),
      taskId,
      strictTaskId: true,
    });
    assert.equal(cheap.code, 'challenge_mismatch');
    assert.equal(marks, 0);

    const store = new ChallengeStore();
    const nonce = putChallenge(store, { amount: String(debt), taskId });
    const paid = await settle({
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 25000n })) }),
      store,
      nonce,
      amount: String(debt),
      taskId,
      strictTaskId: true,
      paymentHeader: evmHeader({ value: '25000', amount: String(debt) }),
    });
    const pendingOk = paid.kind === 'settled'
      && paid.confirmed === true
      && paid.taskId === taskId
      && BigInt(paid.settledAmount) >= debt
      && paid.payTo === ethers.getAddress(HOUSE);
    if (pendingOk) markSettled();
    assert.equal(marks, 1);
    assert.equal(paid.settledAmount, '25000');
  } finally {
    await fac.close();
  }
});

test('PT21 stamp and register refuse a short or mismatched payment', async () => {
  const prev = config.x402.payTo;
  config.x402.payTo = HOUSE;
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const posts = new BoardPostStore();
  const agent = registry.allocate();
  registry.bindWallet(agent.agent_id, { agentWallet: PAYER });
  const app = express();
  app.use(express.json());
  registerBoardRoutes(app, {
    posts,
    ledger,
    registry,
    verify: () => ({ ok: true }),
    isDemoKey: () => false,
    x402Enabled: true,
    runX402Handshake: async () => ({
      kind: 'settled',
      confirmed: true,
      paymentRef: `base:${TX}`,
      settledAmount: '1999',
      payerWallet: PAYER,
      payTo: HOUSE,
    }),
    setPaymentHeaders: () => {},
    baseUrlFor: () => 'https://api.chit402.com',
    peekStampWaiver: () => ({ eligible: false }),
    commitStampWaiver: () => {},
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/board/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xfuel-session': agent.session },
      body: JSON.stringify({ endpoint: 'https://api.chit402.com/v1', outcome: 'success', text: 'no' }),
    });
    const body = await res.json();
    assert.equal(res.status, 402, JSON.stringify(body));
    assert.equal(body.code || body.error, 'stamp_underpaid', JSON.stringify(body));
    assert.equal(JSON.stringify(body).includes('1999'), false);
    assert.equal(posts.entries ? posts.entries.length : 0, 0);
  } finally {
    config.x402.payTo = prev;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }

  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const mismatch = await settle({
      cfg: baseCfg(fac.url, {
        chainReader: async () => ({
          ok: true,
          confirmed: true,
          amount: '2000',
          payer: ATTACKER,
          payTo: HOUSE,
          logIndex: 0,
          blockNumber: 1,
        }),
      }),
      store,
      nonce,
      expectedPayer: PAYER,
    });
    assert.equal(mismatch.code, 'payer_mismatch');
    assert.equal(store.isSpent(nonce), true);
  } finally {
    await fac.close();
  }
});

test('PT22 a chain read that throws or returns nothing stays unconfirmed', async () => {
  const readers = [
    async () => { throw new Error('timeout'); },
    async () => null,
    async () => ({ ok: false }),
    async () => ({ ok: false, pending: true }),
  ];
  const fac = await listenFacilitator();
  try {
    for (const chainReader of readers) {
      const store = new ChallengeStore();
      const nonce = putChallenge(store);
      const decision = await settle({
        cfg: baseCfg(fac.url, { chainReader }),
        store,
        nonce,
      });
      assert.equal(decision.code, 'settle_unconfirmed');
      assert.equal(decision.kind, 'failed');
      assert.ok(store.listPending().length >= 1);
    }
  } finally {
    await fac.close();
  }
});

test('PT23 the rollback flag is off unless testnet explicitly allows it', async () => {
  const fac = await listenFacilitator();
  const lines = [];
  const orig = logger.error.bind(logger);
  logger.error = (...args) => { lines.push(args); return orig(...args); };
  try {
    const refused = await settle({
      cfg: baseCfg(fac.url, { allowUnboundPayments: false }),
      store: new ChallengeStore(),
      nonce: 'missing',
    });
    assert.equal(refused.code, 'challenge_required');
    process.env.X402_ALLOW_UNBOUND = 'true';
    const allowed = await settleBoundPayment({
      taskId: 't',
      cfg: { network: 'base-sepolia', payTo: HOUSE, allowUnboundPayments: true, gatewayUrl: fac.url, apiKey: 'k' },
      paymentHeader: evmHeader({ network: 'base-sepolia' }),
      nonce: null,
    });
    assert.equal(allowed, null);
    assert.ok(lines.length >= 1);
    assert.throws(
      () => assertX402Boot({ allowUnboundPayments: true, network: 'eip155:8453' }),
      /mainnet/,
    );
    assert.throws(
      () => assertX402Boot({ allowUnboundPayments: true, solana: { network: 'solana' } }),
      /mainnet/,
    );
  } finally {
    logger.error = orig;
    delete process.env.X402_ALLOW_UNBOUND;
    await fac.close();
  }
});

test('PT24 a refusal is not a receipt and does not fall through to another rail', async () => {
  assert.throws(() => assertConfirmedSettlement({ kind: 'settled', confirmed: false }), /not confirmed/);
  const fac = await listenFacilitator();
  const ledger = new UsageSettledLedger();
  try {
    const decision = await settle({
      cfg: baseCfg(fac.url, { fallbackToTfuel: true }),
      store: new ChallengeStore(),
      nonce: null,
    });
    assert.equal(decision.code, 'challenge_required');
    assert.equal(isBindingRefusal(decision.code), true);
    assert.equal(paymentErrorStatus(decision.code), 402);
    const rail = isBindingRefusal(decision.code) ? null : 'tfuel';
    assert.equal(rail, null);
    assert.equal(ledger.entries.length, 0);
    const rows = [{ id: 'p1', nonce: 'n', status: 'pending' }];
    const pending = reconcilePending({
      listPending: () => rows,
      updatePending: (id, fields) => {
        const row = rows.find((r) => r.id === id);
        Object.assign(row, fields);
        return row;
      },
    }, [{ nonce: 'n', ok: false }]);
    assert.equal(pending[0].status, 'refund_flagged');
    assert.equal(pending[0].receipt, undefined);
  } finally {
    await fac.close();
  }
});

test('one matching transfer is confirmed and two are ambiguous', async () => {
  const provider = {
    async getTransactionReceipt() {
      const topic = ethers.id('Transfer(address,address,uint256)');
      const log = (value) => ({
        address: USDC,
        topics: [topic, ethers.zeroPadValue(PAYER, 32), ethers.zeroPadValue(HOUSE, 32)],
        data: ethers.toBeHex(BigInt(value), 32),
        logIndex: value,
      });
      return { status: 1, blockNumber: 3, logs: [log(1000), log(1000)] };
    },
  };
  const verify = buildOnChainVerify(provider);
  const ambiguous = await verify({
    paymentRef: `base:${TX}`,
    payer: PAYER,
    payTo: HOUSE,
    amount: '1000',
    network: 'base',
  });
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.reason, 'ambiguous_transfers');
  assert.equal(JSON.stringify(ambiguous).includes(PAYER), false);
});
