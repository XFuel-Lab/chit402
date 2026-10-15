/**
 * Stopgap payment-binding guard inside runX402Handshake.
 *
 * The guard is on unless cfg.allowUnboundPayments is exactly true. These tests
 * cover a live challenge, payee binding, the price floor, one in-flight claim,
 * a required settlement tx, and a network check. settledAmount is the payer's
 * signed value, so an overpay of quote+1 is recorded as quote+1.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { runX402Handshake } from '../src/x402-server.js';
import logger from '../src/logger.js';
import config from '../src/config.js';
import { echoChainReader, installEchoChainReader, setChainReaderForTests } from '../src/x402-chain-hook.js';

installEchoChainReader();

const HOUSE = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x2222222222222222222222222222222222222222';
const WORKER = '0x6666666666666666666666666666666666666666';
const PAYER = '0x5555555555555555555555555555555555555555';
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_HOUSE = 'ALLdmmYEYLEhMVkQUCDnydXrc4PceSPeqB3YqsC7';
const TX = '0x' + 'ab'.repeat(32);
const SOL_TX = '5'.repeat(87);

function cfgFor(url, over = {}) {
  return {
    enabled: true,
    defaultRail: 'usdc',
    fallbackToTfuel: false,
    gatewayUrl: url,
    apiKey: 'testkey',
    payTo: HOUSE,
    network: 'base',
    asset: 'USDC',
    challengeTtlMs: 120000,
    usdcPriceDefault: '2000',
    usdcPrices: {},
    solana: { enabled: true, payTo: SOL_HOUSE, network: 'solana' },
    ...over,
  };
}

function evmHeader({
  network = 'eip155:8453',
  amount = '2000',
  payTo = HOUSE,
  asset = BASE_USDC,
  authNonce = `0x${crypto.randomBytes(32).toString('hex')}`,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network,
      amount,
      asset,
      payTo,
      maxTimeoutSeconds: 120,
      extra: { name: 'USD Coin', version: '2' },
    },
    payload: {
      signature: '0x' + '22'.repeat(65),
      authorization: {
        from: PAYER,
        to: payTo,
        value: amount,
        validAfter: '0',
        validBefore: String(now + 3600),
        nonce: authNonce,
      },
    },
  });
}

function solanaHeader({ amount = '2000', payTo = SOL_HOUSE, nonce } = {}) {
  return JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount,
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      payTo,
      maxTimeoutSeconds: 120,
      extra: { feePayer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', nonce },
    },
    payload: { transaction: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
  });
}

function startMock({ delayMs = 0, settleBody = null } = {}) {
  const counts = { verify: 0, settle: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const finish = () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
        const send = (status, obj) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        const url = req.url || '';
        const standard = !!parsed.paymentPayload;
        if (url.endsWith('/verify')) {
          counts.verify += 1;
          return send(200, standard
            ? { isValid: true, payer: PAYER }
            : { valid: true, txRef: TX });
        }
        if (url.endsWith('/settle')) {
          counts.settle += 1;
          if (settleBody) {
            const produced = typeof settleBody === 'function' ? settleBody(parsed) : settleBody;
            return Promise.resolve(produced).then((body) => send(200, body));
          }
          if (standard) {
            return send(200, {
              success: true,
              transaction: parsed.paymentRequirements?.network?.startsWith('solana') ? SOL_TX : TX,
              network: parsed.paymentRequirements?.network || 'eip155:8453',
              payer: PAYER,
            });
          }
          const network = parsed.network || 'base';
          const solana = String(network).startsWith('solana');
          const txRef = solana ? SOL_TX : `0x${crypto.randomBytes(32).toString('hex')}`;
          return send(200, {
            settled: true,
            success: true,
            txRef,
            transaction: txRef,
            network,
            payer: PAYER,
          });
        }
        return send(404, { error: 'not_found' });
      };
      if (delayMs > 0) setTimeout(finish, delayMs);
      else finish();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        counts,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function issueChallenge(cfg, opts = {}) {
  const decision = await runX402Handshake(
    { headers: {}, body: opts.body || {} },
    {
      taskId: opts.taskId || `stopgap-${Date.now()}`,
      cfg,
      amount: opts.amount,
      payTo: opts.payTo,
      evmOnly: opts.evmOnly,
    },
  );
  assert.equal(decision.kind, 'challenge');
  return decision.body;
}


import { probeSettlementSide, resetSettlementRpcForTests, settlementRefusal, BASE_MAINNET_CHAIN_ID } from '../src/x402-chain.js';
import { getActiveChallengeStore, setActiveChallengeStore, DurableChallengeStore } from '../src/x402-durable-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('pause versus confirm', { concurrency: 1 }, () => {
test('a pause flip mid-settle still settles when the transfer is on this chain', async () => {
  resetSettlementRpcForTests();
  const previousStore = getActiveChallengeStore();
  const mock = await startMock({
    settleBody: async (parsed) => {
      // The recheck flips the side to mismatch while /settle is in flight.
      await probeSettlementSide({
        side: 'base',
        url: 'http://local.invalid',
        expected: BASE_MAINNET_CHAIN_ID,
        request: async () => '0x14a34',
      });
      return {
        success: true,
        transaction: TX,
        network: parsed.paymentRequirements?.network || 'eip155:8453',
        payer: PAYER,
        settled: true,
        txRef: TX,
      };
    },
  });
  setActiveChallengeStore(new DurableChallengeStore(join(mkdtempSync(join(tmpdir(), 'mf1-')), 's.json')));
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'mf1', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: { 'x-payment': evmHeader({ amount: '2000' }), 'x-payment-nonce': nonce },
      body: {},
    }, { taskId: 'mf1', cfg, amount: '2000' });
    assert.equal(mock.counts.settle, 1, 'money moved');
    assert.equal(decision.kind, 'settled');
    const store = getActiveChallengeStore();
    const pending = typeof store?.listPending === 'function' ? store.listPending() : [];
    assert.equal(pending.length, 0);
    assert.equal(settlementRefusal('base'), 'network_not_accepted');
    const next = await issueChallenge(cfg, { taskId: 'mf1-next', amount: '2000' });
    const blocked = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: '2000' }),
        'x-payment-nonce': next.accepts[0].extra.nonce,
      },
      body: {},
    }, { taskId: 'mf1-next', cfg, amount: '2000' });
    assert.equal(blocked.code, 'network_not_accepted');
    assert.equal(mock.counts.settle, 1);
  } finally {
    setActiveChallengeStore(previousStore);
    await mock.close();
    resetSettlementRpcForTests();
  }
});

test('a wrong-chain read still holds the payment with one pending row', async () => {
  resetSettlementRpcForTests();
  const previousStore = getActiveChallengeStore();
  setChainReaderForTests(async () => ({ ok: false, confirmed: false, pending: true }));
  const mock = await startMock({
    settleBody: async (parsed) => {
      await probeSettlementSide({
        side: 'base',
        url: 'http://local.invalid',
        expected: BASE_MAINNET_CHAIN_ID,
        request: async () => '0x14a34',
      });
      return {
        success: true,
        transaction: TX,
        network: parsed.paymentRequirements?.network || 'eip155:8453',
        payer: PAYER,
        settled: true,
        txRef: TX,
      };
    },
  });
  setActiveChallengeStore(new DurableChallengeStore(join(mkdtempSync(join(tmpdir(), 'mf1-')), 's.json')));
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'mf1-miss', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: { 'x-payment': evmHeader({ amount: '2000' }), 'x-payment-nonce': nonce },
      body: {},
    }, { taskId: 'mf1-miss', cfg, amount: '2000' });
    assert.equal(mock.counts.settle, 1);
    assert.equal(decision.code, 'settle_unconfirmed');
    const pending = getActiveChallengeStore().listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nonce, nonce);
    assert.equal(pending[0].tx, TX);
    assert.equal(pending[0].amount, '2000');
    assert.equal(pending[0].reason, 'settle_unconfirmed');
    assert.equal(pending[0].payer, undefined);
  } finally {
    installEchoChainReader();
    setActiveChallengeStore(previousStore);
    await mock.close();
    resetSettlementRpcForTests();
  }
});

test('late-issue does not ignore a pause, and settle still runs the reader', async () => {
  resetSettlementRpcForTests();
  await probeSettlementSide({
    side: 'base',
    url: 'http://local.invalid',
    expected: BASE_MAINNET_CHAIN_ID,
    request: async () => '0x14a34',
  });
  let calls = 0;
  setChainReaderForTests(async () => {
    calls += 1;
    return echoChainReader({
      challenge: { amount: '2000', payTo: HOUSE, network: 'base' },
      facilitator: { transaction: TX, payer: PAYER },
    });
  });
  try {
    const { confirmSettlement } = await import('../src/x402-chain.js');
    const paused = await confirmSettlement({
      challenge: { network: 'base', amount: '2000', payTo: HOUSE },
      facilitator: { transaction: TX, payer: PAYER, network: 'base', success: true },
      ignorePause: false,
    });
    assert.equal(calls, 0);
    assert.equal(paused.ok, false);
    assert.equal(paused.pending, true);
    const seen = await confirmSettlement({
      challenge: { network: 'base', amount: '2000', payTo: HOUSE },
      facilitator: { transaction: TX, payer: PAYER, network: 'base', success: true },
      ignorePause: true,
    });
    assert.equal(calls, 1);
    assert.equal(seen.ok, true);
    assert.equal(seen.transaction, TX);
    assert.equal(seen.payTo, HOUSE);
  } finally {
    installEchoChainReader();
    resetSettlementRpcForTests();
  }
});
});
