/**
 * Stopgap payment-binding guard inside runX402Handshake.
 *
 * The guard is on unless cfg.allowUnboundPayments is exactly true. These tests
 * cover a live challenge, payee binding, the price floor, one in-flight claim,
 * a required settlement tx, and a network check. settledAmount is the payer's
 * signed value, so an overpay of quote+1 is recorded as quote+1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runX402Handshake } from '../src/x402-server.js';
import logger from '../src/logger.js';
import config from '../src/config.js';

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
        nonce: '0x' + '11'.repeat(32),
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
          if (settleBody) return send(200, typeof settleBody === 'function' ? settleBody(parsed) : settleBody);
          if (standard) {
            return send(200, {
              success: true,
              transaction: parsed.paymentRequirements?.network?.startsWith('solana') ? SOL_TX : TX,
              network: parsed.paymentRequirements?.network || 'eip155:8453',
              payer: PAYER,
            });
          }
          return send(200, { settled: true, txRef: TX });
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

test('allowUnboundPayments is off unless X402_ALLOW_UNBOUND=true', () => {
  assert.equal(config.x402.allowUnboundPayments, process.env.X402_ALLOW_UNBOUND === 'true');
  if (process.env.X402_ALLOW_UNBOUND !== 'true') {
    assert.equal(config.x402.allowUnboundPayments, false);
  }
});

test('challenge required: unbound payment is refused before the facilitator', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const decision = await runX402Handshake({
      headers: { 'x-payment': evmHeader({ amount: '1', payTo: ATTACKER, network: 'base-sepolia' }) },
      body: {},
    }, { taskId: 'stopgap-unbound', cfg });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_required');
    assert.equal(decision.preSettle, true);
    assert.equal(decision.paymentRef, undefined);
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('challenge required: unknown nonce is refused before the facilitator', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader(),
        'x-payment-nonce': '0x' + 'ee'.repeat(32),
      },
      body: {},
    }, { taskId: 'stopgap-unknown', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_required');
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('payee bound: client recipient must be the house payTo', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-payee', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ payTo: ATTACKER, amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-payee', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_mismatch');
    assert.equal(decision.paymentRef, undefined);
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('payee bound: a house challenge cannot settle a worker-leg payTo', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-worker', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ payTo: WORKER, amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-worker', cfg, amount: '2000', payTo: WORKER });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_mismatch');
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('price floor: a cheaper challenge cannot pay a higher quote', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url, { usdcPriceDefault: '500000' });
    const body = await issueChallenge(cfg, { taskId: 'stopgap-swap', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: '500000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-swap', cfg });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_mismatch');
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('price floor: signed value one unit under the quote is refused', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-under', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: '1999' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-under', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_mismatch');
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('overpay of quote+1 settles with settledAmount = quote+1', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const quote = 2000;
    const body = await issueChallenge(cfg, { taskId: 'stopgap-overpay', amount: String(quote) });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: String(quote + 1) }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-overpay', cfg, amount: String(quote) });
    assert.equal(decision.kind, 'settled');
    assert.equal(decision.settledAmount, String(quote + 1));
    assert.notEqual(decision.settledAmount, String(quote));
    assert.equal(decision.payTo, HOUSE);
    assert.match(decision.paymentRef, new RegExp(`^base:${TX}$`));
  } finally {
    await mock.close();
  }
});

test('single claim: one challenge cannot mint two receipts', async () => {
  const mock = await startMock({ delayMs: 40 });
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-claim', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const pay = () => runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-claim', cfg, amount: '2000' });

    const results = await Promise.all(Array.from({ length: 10 }, () => pay()));
    const settled = results.filter((r) => r.kind === 'settled');
    const inflight = results.filter((r) => r.reason === 'payment_in_flight');
    assert.equal(settled.length, 1);
    assert.equal(inflight.length, 9);
    assert.equal(mock.counts.settle, 1);
    assert.equal(mock.counts.verify, 1);
    for (const refused of inflight) {
      assert.equal(refused.paymentRef, undefined);
      assert.equal(refused.preSettle, true);
    }

    const replay = await pay();
    assert.equal(replay.kind, 'failed');
    assert.equal(replay.reason, 'payment_replayed');
    assert.equal(mock.counts.settle, 1);
  } finally {
    await mock.close();
  }
});

test('tx required: settle with no transaction does not mint a receipt', async () => {
  const mock = await startMock({ settleBody: { settled: true } });
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-notx', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-notx', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'settle_unconfirmed');
    assert.equal(decision.paymentRef, undefined);
    assert.ok(!String(decision.paymentRef || '').includes('unknown'));
  } finally {
    await mock.close();
  }
});

test('tx required: an explicit unknown tx ref is not recorded', async () => {
  const mock = await startMock({ settleBody: { settled: true, txRef: 'unknown' } });
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-unknown-tx', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'x-payment': evmHeader(),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-unknown-tx', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'settle_unconfirmed');
    assert.equal(decision.paymentRef, undefined);
  } finally {
    await mock.close();
  }
});

test('network check: a Sepolia blob cannot be recorded as Base mainnet', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-sepolia', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const swapped = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ network: 'base-sepolia', asset: SEPOLIA_USDC, amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-sepolia', cfg, amount: '2000' });
    assert.equal(swapped.kind, 'failed');
    assert.equal(swapped.reason, 'network_not_accepted');
    assert.equal(swapped.paymentRef, undefined);
    assert.equal(mock.counts.verify, 0);

    const assetOnly = await runX402Handshake({
      headers: {
        'x-payment': evmHeader({ network: 'eip155:8453', asset: SEPOLIA_USDC, amount: '2000' }),
        'x-payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-sepolia', cfg, amount: '2000' });
    assert.equal(assetOnly.kind, 'failed');
    assert.equal(assetOnly.reason, 'network_not_accepted');
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('network check: a Sepolia settle response is not labeled base:', async () => {
  const mock = await startMock({
    settleBody: () => ({
      success: true,
      transaction: TX,
      network: 'eip155:84532',
      payer: PAYER,
    }),
  });
  try {
    const cfg = cfgFor(mock.url, { facilitatorProvider: 'x402', facilitatorUrl: mock.url });
    const body = await issueChallenge(cfg, { taskId: 'stopgap-settle-net', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const decision = await runX402Handshake({
      headers: {
        'payment-signature': evmHeader({ amount: '2000' }),
        'payment-nonce': nonce,
      },
      body: {},
    }, { taskId: 'stopgap-settle-net', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'network_not_accepted');
    assert.equal(decision.paymentRef, undefined);
    assert.equal(mock.counts.settle, 1);
  } finally {
    await mock.close();
  }
});

test('Solana client amount label cannot raise settledAmount above the quote', async () => {
  const mock = await startMock();
  const previous = process.env.X402_SOLANA_FACILITATOR_URL;
  process.env.X402_SOLANA_FACILITATOR_URL = mock.url;
  try {
    const cfg = cfgFor(mock.url, { facilitatorProvider: 'x402', facilitatorUrl: mock.url });
    const body = await issueChallenge(cfg, { taskId: 'stopgap-solana', amount: '2000' });
    const sol = body.accepts.find((a) => String(a.network).startsWith('solana'));
    assert.ok(sol, 'challenge includes a Solana accept');
    const decision = await runX402Handshake({
      headers: {
        'payment-signature': solanaHeader({ amount: '999999999000', nonce: sol.extra.nonce }),
        'payment-nonce': sol.extra.nonce,
      },
      body: {},
    }, { taskId: 'stopgap-solana', cfg, amount: '2000' });
    assert.equal(decision.kind, 'settled');
    assert.equal(decision.settledAmount, '2000');
    assert.notEqual(decision.settledAmount, '999999999000');
    assert.equal(decision.payTo, SOL_HOUSE);
    assert.equal(decision.paymentRef, `solana:${SOL_TX}`);
  } finally {
    if (previous === undefined) delete process.env.X402_SOLANA_FACILITATOR_URL;
    else process.env.X402_SOLANA_FACILITATOR_URL = previous;
    await mock.close();
  }
});

test('Base unsigned authorization copy cannot raise settledAmount', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-decoy', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const now = Math.floor(Date.now() / 1000);
    const header = JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: 'eip155:8453',
      asset: BASE_USDC,
      amount: '2000',
      payTo: HOUSE,
      authorization: {
        type: 'eip3009-transferWithAuthorization',
        domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC },
        message: {
          from: PAYER,
          to: HOUSE,
          value: '2000',
          validAfter: 0,
          validBefore: now + 3600,
          nonce: '0x' + '11'.repeat(32),
        },
        signature: '0x' + '22'.repeat(65),
      },
      payload: {
        authorization: {
          from: PAYER,
          to: HOUSE,
          value: '999999999000',
          validAfter: '0',
          validBefore: String(now + 3600),
          nonce: '0x' + '11'.repeat(32),
        },
      },
    });
    const decision = await runX402Handshake({
      headers: { 'x-payment': header, 'x-payment-nonce': nonce },
      body: {},
    }, { taskId: 'stopgap-decoy', cfg, amount: '2000' });
    assert.equal(decision.kind, 'settled');
    assert.equal(decision.settledAmount, '2000');
    assert.notEqual(decision.settledAmount, '999999999000');
    assert.equal(decision.payTo, HOUSE);
  } finally {
    await mock.close();
  }
});

test('every client payee must match the house payee', async () => {
  const mock = await startMock();
  try {
    const cfg = cfgFor(mock.url);
    const body = await issueChallenge(cfg, { taskId: 'stopgap-payees', amount: '2000' });
    const nonce = body.accepts[0].extra.nonce;
    const split = JSON.parse(evmHeader({ amount: '2000', payTo: HOUSE }));
    split.accepted.payTo = ATTACKER;
    const decision = await runX402Handshake({
      headers: { 'x-payment': JSON.stringify(split), 'x-payment-nonce': nonce },
      body: {},
    }, { taskId: 'stopgap-payees', cfg, amount: '2000' });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'challenge_mismatch');
    assert.equal(decision.paymentRef, undefined);
    assert.equal(mock.counts.verify, 0);
    assert.equal(mock.counts.settle, 0);
  } finally {
    await mock.close();
  }
});

test('X402_ALLOW_UNBOUND restores unbound settle and logs the use', async () => {
  const mock = await startMock();
  const orig = logger.error;
  let errors = 0;
  logger.error = (...args) => {
    errors += 1;
    return orig.apply(logger, args);
  };
  try {
    const cfg = cfgFor(mock.url, { allowUnboundPayments: true });
    const decision = await runX402Handshake({
      headers: { 'x-payment': evmHeader({ amount: '1', payTo: ATTACKER }) },
      body: {},
    }, { taskId: 'stopgap-rollback', cfg });
    assert.equal(decision.kind, 'settled');
    assert.ok(errors >= 1, 'unbound rollback logs at error level');

    const guarded = await runX402Handshake({
      headers: { 'x-payment': evmHeader({ amount: '1', payTo: ATTACKER }) },
      body: {},
    }, { taskId: 'stopgap-rollback-off', cfg: cfgFor(mock.url) });
    assert.equal(guarded.kind, 'failed');
    assert.equal(guarded.reason, 'challenge_required');
  } finally {
    logger.error = orig;
    await mock.close();
  }
});
