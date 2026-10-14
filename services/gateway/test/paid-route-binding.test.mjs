/**
 * A paid amount settles only the route and price it was quoted for.
 * NEW-3, PB4, PB7, PB12, PB13.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { ethers } from 'ethers';

import { ChallengeStore } from '../src/x402-adapter.js';
import { quoteBodyHash, settleBoundPayment } from '../src/x402-settle.js';
import { confirmEvmReceipt, readEvmAuthorization } from '../src/x402-chain.js';
import {
  atomicUnits,
  canonicalPaidRoute,
  chainCoversPrice,
  samePaidRoute,
  sameQuotedPrice,
} from '../src/paid-route.js';
import { applyPaymentToOwedTask, paymentBindsDebt, recordPending, resetRollingSettlement } from '../src/rolling-settlement.js';
import {
  BoardJobStore,
  createBoardJob,
  awardBoardBid,
  deliverBoardJob,
  feeLegAmount,
  legSettlement,
  payBoardJob,
  placeBoardBid,
  sha256Prefixed,
} from '../src/board-jobs.js';
import { AgentRegistry } from '../src/agent-registry.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const WORKER = `0x${'66'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AUTH_NONCE = `0x${'cd'.repeat(32)}`;
const TX = `0x${'ab'.repeat(32)}`;

function evmHeader({
  from = PAYER,
  to = HOUSE,
  value = '2000',
  nonce = AUTH_NONCE,
  payTo = HOUSE,
  amount = '2000',
} = {}) {
  const blob = {
    network: 'base',
    amount,
    payTo,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
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

function evmReceipt({ from = PAYER, to = HOUSE, value = 2000n, nonce = AUTH_NONCE } = {}) {
  return {
    status: 1,
    blockNumber: 12,
    logs: [
      {
        address: USDC,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          ethers.zeroPadValue(from, 32),
          ethers.zeroPadValue(to, 32),
        ],
        data: ethers.toBeHex(BigInt(value), 32),
        logIndex: 0,
      },
      {
        address: USDC,
        topics: [
          ethers.id('AuthorizationUsed(address,bytes32)'),
          ethers.zeroPadValue(from, 32),
          ethers.zeroPadValue(nonce, 32),
        ],
        data: '0x',
        logIndex: 1,
      },
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

function listenFacilitator({ tx = TX, payer = PAYER } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      hits.push(req.url);
      const network = body.network || 'base';
      const from = body.paymentPayload?.payload?.authorization?.from || payer;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      if ((req.url || '').endsWith('/verify')) {
        res.end(JSON.stringify({ valid: true, isValid: true, txRef: tx, payer: from }));
        return;
      }
      if ((req.url || '').endsWith('/settle')) {
        res.end(JSON.stringify({ settled: true, success: true, txRef: tx, transaction: tx, network, payer: from }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
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
  const nonce = fields.nonce || `0x${crypto.randomBytes(32).toString('hex')}`;
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

function debt(over = {}) {
  return {
    amount: '10100',
    taskId: 'owed-1',
    route: '/task-request',
    ...over,
  };
}

test('canonical route and quoted price compare the path and the integer', () => {
  assert.equal(canonicalPaidRoute('https://api.chit402.com/task-request/'), '/task-request');
  assert.equal(samePaidRoute('https://api.chit402.com/v1/chat/completions', '/v1/chat/completions'), true);
  assert.equal(samePaidRoute('/task-request', '/v1/chat/completions'), false);
  assert.equal(samePaidRoute('', '/task-request'), false);
  assert.equal(sameQuotedPrice('2000', 2000), true);
  assert.equal(sameQuotedPrice('2000', '2001'), false);
  assert.equal(sameQuotedPrice('2000', '0x10'), false);
  assert.equal(chainCoversPrice('2001', '2000'), true);
  assert.equal(chainCoversPrice('1999', '2000'), false);
  assert.equal(atomicUnits(''), null);
});

test('NEW-3 a challenge settles only its route, its quoted price, and its payee', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const missing = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, { resource: '' }),
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    assert.equal(missing.code, 'challenge_mismatch');
    assert.equal(fac.hits.length, 0);

    const crossed = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, { resource: '/task-request', amount: '2000' }),
      paymentHeader: evmHeader(),
      resource: '/v1/chat/completions',
    });
    assert.equal(crossed.code, 'challenge_mismatch');

    const cheap = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, { amount: '500000', resource: '/v1/chat/completions' }),
      paymentHeader: evmHeader({ value: '2000', amount: '2000' }),
      resource: '/v1/chat/completions',
    });
    assert.equal(cheap.code, 'challenge_mismatch');

    const dear = await settleBoundPayment({
      taskId: 'task-1',
      amount: '500000',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, { amount: '2000' }),
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    assert.equal(dear.code, 'challenge_mismatch');

    const otherPayee = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, { payTo: WORKER }),
      paymentHeader: evmHeader(),
      payTo: HOUSE,
      resource: '/task-request',
    });
    assert.equal(otherPayee.code, 'challenge_mismatch');

    const body = { model: 'same' };
    const drifted = await settleBoundPayment({
      taskId: 'task-1',
      cfg: baseCfg(fac.url),
      store,
      nonce: putChallenge(store, {
        amount: '2000',
        quoteBodyHash: quoteBodyHash(body),
        quotePrice: '2000',
        routeQuote: '2000',
      }),
      priceBody: body,
      paymentHeader: evmHeader(),
      resource: 'https://api.chit402.com/task-request',
      resolveQuote: async () => '999999',
    });
    assert.equal(drifted.code, 'challenge_mismatch');
    assert.equal(fac.hits.length, 0);

    const aboveQuote = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 3000n })) }),
      store,
      nonce: putChallenge(store, { amount: '3000', resource: '/task-request', quotePrice: '3000', routeQuote: '3000' }),
      paymentHeader: evmHeader({ value: '3000', amount: '3000' }),
      resource: '/task-request',
    });
    assert.equal(aboveQuote.kind, 'settled', aboveQuote.code);
    assert.equal(aboveQuote.quotedAmount, '3000');
    assert.equal(aboveQuote.settledAmount, '3000');
    assert.equal(aboveQuote.route, '/task-request');

    const unlocked = putChallenge(store, { quotePrice: '999999', amount: '2000', routeQuote: '2000' });
    const unlockedDecision = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url),
      store,
      nonce: unlocked,
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    assert.equal(unlockedDecision.code, 'challenge_mismatch');

    // aboveQuote already spent the default facilitator transfer and auth nonce.
    const paidNonce = `0x${'ee'.repeat(32)}`;
    const paidTx = `0x${'cd'.repeat(32)}`;
    const paidFac = await listenFacilitator({ tx: paidTx });
    try {
    const paid = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(paidFac.url, { chainReader: chainFromReceipt(evmReceipt({ value: 2001n, nonce: paidNonce })) }),
      store,
      nonce: putChallenge(store, {
        resource: 'https://api.chit402.com/task-request/',
        quoteRoute: '/task-request',
        quotePrice: '2000',
        routeQuote: '2000',
      }),
      paymentHeader: evmHeader({ value: '2001', amount: '2001', nonce: paidNonce }),
      resource: '/task-request',
    });
    assert.equal(paid.kind, 'settled', paid.code);
    assert.equal(paid.confirmed, true);
    assert.equal(paid.route, '/task-request');
    assert.equal(paid.quotedAmount, '2000');
    assert.equal(paid.settledAmount, '2001');
    assert.equal(paid.paymentRef, `base:${paidTx}`);
    } finally {
      await paidFac.close();
    }
  } finally {
    await fac.close();
  }
});

test('PB4 the same transfer does not settle a second challenge at the same price', async () => {
  const fac = await listenFacilitator();
  const n1 = `0x${'a1'.repeat(32)}`;
  const n2 = `0x${'a2'.repeat(32)}`;
  try {
    const store = new ChallengeStore();
    const first = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ nonce: n1 })) }),
      store,
      nonce: putChallenge(store, { amount: '2000', resource: '/task-request' }),
      paymentHeader: evmHeader({ nonce: n1 }),
      resource: '/task-request',
    });
    assert.equal(first.kind, 'settled', first.code);
    const second = await settleBoundPayment({
      taskId: 'task-2',
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt({ nonce: n2, value: 2000n })) }),
      store,
      nonce: putChallenge(store, { amount: '2000', resource: '/task-request' }),
      paymentHeader: evmHeader({ nonce: n2 }),
      resource: '/task-request',
    });
    assert.equal(second.code, 'payment_replayed');
    assert.notEqual(second.kind, 'settled');
    assert.notEqual(second.confirmed, true);
  } finally {
    await fac.close();
  }
});

test('PB12 facilitator success without a chain confirmation is not settled', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const decision = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: async () => ({ ok: false, pending: false }) }),
      store,
      nonce: putChallenge(store),
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    assert.equal(decision.code, 'settle_unconfirmed');
    assert.notEqual(decision.kind, 'settled');
    assert.notEqual(decision.confirmed, true);
    assert.ok(fac.hits.some((url) => String(url).endsWith('/settle')));
  } finally {
    await fac.close();
  }
});

test('PB7 fee and leg checks use the on-chain amount, not a larger quote', async () => {
  const quoteAsTransfer = legSettlement({
    paymentRef: 'base:0xabc',
    amount: '1000000',
    settledAmount: '2000',
    route: '/v1/board/jobs/job-1/pay/winner',
  }, '1000000', '/v1/board/jobs/job-1/pay/winner');
  assert.equal(quoteAsTransfer, null);

  const covered = legSettlement({
    paymentRef: 'base:0xabc',
    quotedAmount: '1000000',
    amount: '1000000',
    settledAmount: '1000001',
    route: 'https://api.chit402.com/v1/board/jobs/job-1/pay/winner',
  }, '1000000', '/v1/board/jobs/job-1/pay/winner');
  assert.equal(covered.amount, '1000001');
  assert.equal(covered.quoted_amount, '1000000');

  const feeOnWinner = legSettlement({
    paymentRef: 'base:0xfee',
    quotedAmount: '12000',
    settledAmount: '12000',
    route: '/v1/board/jobs/job-1/pay/fee',
  }, '1000000', '/v1/board/jobs/job-1/pay/winner');
  assert.equal(feeOnWinner, null);

  const registry = new AgentRegistry();
  const jobs = new BoardJobStore();
  const poster = registry.allocate();
  registry.bindWallet(poster.agent_id, { agentWallet: PAYER });
  const bidder = registry.allocate();
  registry.bindWallet(bidder.agent_id, { agentWallet: WORKER });
  const actor = { agent_id: poster.agent_id, agentWallet: PAYER };
  const bidderActor = { agent_id: bidder.agent_id, agentWallet: WORKER };
  const base = {
    jobs,
    registry,
    actor,
    baseUrl: 'https://api.chit402.com',
    chitPayTo: HOUSE,
    ensureStamp: async () => ({ ok: true, waived: true }),
  };
  const created = await createBoardJob({
    text: 'Name the amount.',
    budget: '5000000',
    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  }, base);
  assert.equal(created.status, 201, created.message);
  const id = created.body.job.id;
  const bid = await placeBoardBid(id, { price: '1000000', pitch: 'ready' }, { ...base, actor: bidderActor });
  assert.equal(bid.status, 201, bid.message);
  awardBoardBid(id, { bid_id: bid.body.bid_id }, base);
  deliverBoardJob(id, { output_sha256: sha256Prefixed('done') }, { ...base, actor: bidderActor });

  const winnerRoute = `/v1/board/jobs/${id}/pay/winner`;
  const feeRoute = `/v1/board/jobs/${id}/pay/fee`;
  const seen = [];
  const rejected = await payBoardJob(id, {
    ...base,
    settleLeg: async (spec) => {
      seen.push(spec);
      return {
        ok: true,
        settlement: {
          paymentRef: 'base:0xwinner',
          amount: '1000000',
          quotedAmount: '1000000',
          settledAmount: '2000000',
          payer: PAYER,
          payTo: spec.payTo,
          route: feeRoute,
        },
      };
    },
  });
  assert.equal(rejected.status, 402);
  assert.equal(rejected.error, 'stamp_underpaid');
  assert.equal(jobs.get(id).winner_leg, null);

  const paid = await payBoardJob(id, {
    ...base,
    settleLeg: async (spec) => {
      seen.push({ leg: spec.leg, amount: String(spec.amount), route: spec.route, challengeOnly: !!spec.challengeOnly });
      if (spec.challengeOnly) {
        return { ok: false, status: 402, challenge: { payTo: spec.payTo, maxAmountRequired: String(spec.amount) } };
      }
      return {
        ok: true,
        settlement: {
          paymentRef: `base:0x${spec.leg}`,
          quotedAmount: String(spec.amount),
          settledAmount: spec.leg === 'winner' ? '2000000' : String(spec.amount),
          amount: String(spec.amount),
          payer: PAYER,
          payTo: spec.payTo,
          route: spec.route,
        },
      };
    },
  });
  assert.equal(paid.status, 402, paid.message);
  assert.equal(paid.error, 'fee_payment_required');
  const feeChallenge = seen.find((row) => row.leg === 'fee' && row.challengeOnly);
  assert.equal(feeChallenge.amount, feeLegAmount(1_000_000n).toString());
  assert.notEqual(feeChallenge.amount, feeLegAmount(2_000_000n).toString());
  assert.equal(feeChallenge.route, feeRoute);
  assert.equal(seen.find((row) => row.leg === 'winner' && !row.challengeOnly).route, winnerRoute);

  const task = { taskId: 'owed-1', intent: { amount: '1000000' }, meta: {} };
  applyPaymentToOwedTask(task, {
    paymentRef: 'base:0xabc',
    settledAmount: '2000',
    quotedAmount: '1000000',
    protocolFeeBps: 50,
  });
  assert.equal(task.intent.amount, '2000');
  assert.equal(task.meta.quotedAmount, '1000000');
  assert.equal(task.feeAmount, '10');
  assert.equal(task.netAmount, '1990');
});

test('PB13 a debt and a board leg clear only for their own quoted price and route', () => {
  resetRollingSettlement();
  const pending = debt();
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '10100',
    settledAmount: '10100',
    route: 'https://api.chit402.com/task-request/',
    taskId: 'owed-1',
  }), true);
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '2000',
    settledAmount: '10100',
    route: '/task-request',
    taskId: 'owed-1',
  }), false);
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '10100',
    settledAmount: '2000',
    route: '/task-request',
    taskId: 'owed-1',
  }), false);
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '10100',
    settledAmount: '10100',
    route: '/v1/chat/completions',
    taskId: 'owed-1',
  }), false);
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '10100',
    settledAmount: '10100',
    route: '/task-request',
    taskId: 'other-task',
  }), false);
  assert.equal(paymentBindsDebt(pending, {
    quotedAmount: '10100',
    settledAmount: '10101',
    route: '/v1/board/jobs/job-1/pay/fee',
  }), false);

  recordPending('payer-1', { quote: { amount: '10100' }, taskId: 'owed-1' });
  assert.equal(paymentBindsDebt(
    { amount: '10100', taskId: 'owed-1', route: '/task-request' },
    { quotedAmount: '10100', settledAmount: '10100', route: '/task-request', taskId: 'owed-1' },
  ), true);
  resetRollingSettlement();
});

test('PB4 concurrent challenges carrying one transfer settle once', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const slow = (receipt) => async (args) => {
      await new Promise((r) => setTimeout(r, 30));
      return chainFromReceipt(receipt)(args);
    };
    const run = (task) => settleBoundPayment({
      taskId: task,
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: slow(evmReceipt()) }),
      store,
      nonce: putChallenge(store, { taskId: task, amount: '2000', resource: '/task-request' }),
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    const results = await Promise.all([run('race-a'), run('race-b'), run('race-c')]);
    assert.equal(results.filter((r) => r.kind === 'settled').length, 1, JSON.stringify(results.map((r) => r.code || r.kind)));
    assert.equal(results.filter((r) => r.code === 'payment_replayed').length, 2);
  } finally {
    await fac.close();
  }
});

test('PB4 concurrent duplicates of one challenge settle once and replay the receipt', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { taskId: 'race-same', amount: '2000', resource: '/task-request' });
    const slow = (receipt) => async (args) => {
      await new Promise((r) => setTimeout(r, 30));
      return chainFromReceipt(receipt)(args);
    };
    const run = () => settleBoundPayment({
      taskId: 'race-same',
      amount: '2000',
      cfg: baseCfg(fac.url, { chainReader: slow(evmReceipt()) }),
      store,
      nonce,
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    const results = await Promise.all([run(), run(), run()]);
    const fresh = results.filter((r) => r.kind === 'settled' && r.idempotentReplay !== true);
    const replays = results.filter((r) => r.idempotentReplay === true);
    assert.equal(fresh.length, 1, JSON.stringify(results.map((r) => ({ kind: r.kind, code: r.code, replay: r.idempotentReplay }))));
    assert.equal(replays.length, 2);
    assert.equal(fac.hits.filter((url) => String(url).endsWith('/settle')).length, 1);
    for (const replay of replays) {
      assert.equal(replay.kind, 'settled');
      assert.equal(replay.confirmed, true);
      assert.equal(replay.replay, true);
      assert.equal(replay.paymentRef, fresh[0].paymentRef);
      assert.equal(replay.quotedAmount, fresh[0].quotedAmount);
      assert.equal(replay.settledAmount, fresh[0].settledAmount);
      assert.equal(replay.payerWallet, fresh[0].payerWallet);
    }
  } finally {
    await fac.close();
  }
});

test('a spent challenge on another route or price is payment_replayed', async () => {
  const fac = await listenFacilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { amount: '2000', resource: '/task-request' });
    const cfg = baseCfg(fac.url, { chainReader: chainFromReceipt(evmReceipt()) });
    const first = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg,
      store,
      nonce,
      paymentHeader: evmHeader(),
      resource: '/task-request',
    });
    assert.equal(first.kind, 'settled', first.code);
    const otherRoute = await settleBoundPayment({
      taskId: 'task-1',
      amount: '2000',
      cfg,
      store,
      nonce,
      paymentHeader: evmHeader(),
      resource: '/v1/chat/completions',
    });
    assert.equal(otherRoute.code, 'payment_replayed');
    assert.notEqual(otherRoute.kind, 'settled');
    const higher = await settleBoundPayment({
      taskId: 'task-1',
      amount: '500000',
      cfg,
      store,
      nonce,
      paymentHeader: evmHeader({ value: '500000', amount: '500000' }),
      resource: '/task-request',
    });
    assert.equal(higher.code, 'payment_replayed');
    assert.notEqual(higher.kind, 'settled');
    assert.equal(fac.hits.filter((url) => String(url).endsWith('/settle')).length, 1);
  } finally {
    await fac.close();
  }
});
