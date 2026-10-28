/**
 * Money-path fixes in settleBoundPayment (Protocol Review F-1, F-2).
 *
 * F-1: once /settle has returned sent, a store read or write that throws
 * (reserveTx, isTxSpent, isAuthSpent) goes through hold('local_failure'),
 * so the payer gets a pendingId and verifyUrl, never a bare
 * replay_store_unavailable. A source scan pins the invariant for every exit
 * after the /settle call.
 * F-2: a route bound to one payer refuses another wallet's authorization
 * before /settle; a chain payer that still differs writes a refund row and
 * returns a pendingId while the tx stays spent.
 *
 * Local facilitator on 127.0.0.1 and an injected chain reader; dummy values only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { confirmEvmReceipt, readEvmAuthorization, clearChainReaderForTests } from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';
import { paymentFailureBody, paymentFailureStatus } from '../src/x402-flags.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTLE_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'x402-settle.js'), 'utf8');

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}`;
const AUTH_NONCE = `0x${'a7'.repeat(32)}`;
const RESOURCE = 'https://api.chit402.com/v1/chat/completions';
const pad = (a) => ethers.zeroPadValue(a, 32);

function chainReceipt({ from = PAYER } = {}) {
  return {
    status: '0x1', blockNumber: '0x10', contractAddress: null, blockHash: `0x${'ee'.repeat(32)}`,
    logs: [
      { address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(from), pad(HOUSE)], data: ethers.toBeHex(2000n, 32), logIndex: '0x0' },
      { address: USDC, topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(from), pad(AUTH_NONCE)], data: '0x', logIndex: '0x1' },
    ],
  };
}

function header({ from = PAYER } = {}) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload: {
      signature: `0x${'5e'.repeat(65)}`,
      authorization: { from, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce: AUTH_NONCE },
    },
  })).toString('base64');
}

function facilitator() {
  const hits = { verify: 0, settle: 0 };
  const listeners = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const isSettle = String(req.url).endsWith('/settle');
      hits[isSettle ? 'settle' : 'verify'] += 1;
      if (isSettle) for (const fn of listeners) fn();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(isSettle
        ? { success: true, settled: true, transaction: TX, txRef: TX, network: 'base', payer: PAYER }
        : { valid: true, isValid: true, payer: PAYER }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, hits, onSettle: (fn) => listeners.push(fn),
    close: () => new Promise((r) => server.close(r)),
  })));
}

/** A ChallengeStore whose listed methods throw once /settle has been called. */
function storeDownAfterSettle(fac, methods) {
  const store = new ChallengeStore();
  let down = false;
  fac.onSettle(() => { down = true; });
  for (const name of methods) {
    const real = store[name].bind(store);
    store[name] = (...args) => {
      if (down) throw Object.assign(new Error('store unavailable'), { code: 'SQLITE_BUSY' });
      return real(...args);
    };
  }
  return store;
}

let n = 0;
async function settleOnce({ store, fac, from = PAYER, expectedPayer = null, chainReader = null }) {
  clearChainReaderForTests();
  setActiveChallengeStore(store);
  n += 1;
  const nonce = `0x${n.toString(16).padStart(4, '0').repeat(16)}`;
  store.put(nonce, { resource: RESOURCE, amount: '2000', payTo: HOUSE, network: 'base', asset: USDC, issuedAt: Date.now(), expiresAt: Date.now() + 120_000 });
  const h = header({ from });
  return settleBoundPayment({
    req: { id: `r-${n}`, headers: { 'x-payment': h, 'x-payment-nonce': nonce }, method: 'POST', path: '/v1/chat/completions' },
    taskId: `t-${n}`,
    cfg: {
      enabled: true, payTo: HOUSE, network: 'base', asset: 'USDC', gatewayUrl: fac.url, apiKey: 'k',
      usdcPriceDefault: '2000', challengeTtlMs: 120000, defaultRail: 'usdc', lateIssue: false,
      chainReader: chainReader || (async ({ challenge, facilitator: f, paymentHeader: ph, expectedPayTo }) =>
        confirmEvmReceipt(chainReceipt(), { challenge, expectedPayTo, authorization: readEvmAuthorization(ph), facilitatorPayer: f?.payer })),
    },
    priceBody: {}, amount: '2000', baseUrl: 'https://api.chit402.com', resource: RESOURCE,
    store, paymentHeader: h, clientVersion: 2, nonce, serveStoredResponse: false,
    resolveQuote: async () => '2000', expectedPayer,
  });
}

function assertPendingHandle(out, what) {
  assert.equal(out.kind, 'failed', `${what}: ${JSON.stringify(out)}`);
  assert.notEqual(out.code, 'replay_store_unavailable', `${what}: bare replay_store_unavailable after /settle`);
  assert.ok(/^[0-9a-f]{32}$/.test(String(out.pendingId)), `${what}: no pendingId`);
  assert.ok(String(out.verifyUrl).endsWith(`/receipt/late-${out.pendingId}`), `${what}: no verifyUrl`);
  const body = paymentFailureBody(out);
  assert.equal(body.pending_id, out.pendingId);
  assert.equal(body.verify_url, out.verifyUrl);
}

for (const method of ['reserveTx', 'isTxSpent', 'isAuthSpent']) {
  test(`F-1: ${method} throws after /settle: pendingId + verifyUrl, not replay_store_unavailable`, async () => {
    const fac = await facilitator();
    try {
      const store = storeDownAfterSettle(fac, [method]);
      const out = await settleOnce({ store, fac });
      assert.equal(fac.hits.settle, 1, '/settle was called');
      assertPendingHandle(out, method);
      assert.equal(out.code, 'settle_unconfirmed');
      assert.equal(out.holdClass, 'resolvable');
      const view = paymentFailureStatus(out);
      assert.equal(view.status, 202);
      assert.equal(view.retryAfter, 5);
      assert.equal(paymentFailureBody(out).status, undefined);
      const late = store.findLate({ nonce: store.listLate()[0]?.nonce });
      assert.equal(late?.pending_id, out.pendingId, 'the late row is the one returned');
      assert.equal(late?.state, 'unknown', 'the late row is left for the reconciler');
    } finally {
      await fac.close();
    }
  });
}

test('F-1: with late issue on, a reserveTx throw after /settle is settle_pending with Retry-After', async () => {
  const fac = await facilitator();
  const prior = process.env.X402_LATE_ISSUE;
  try {
    const store = storeDownAfterSettle(fac, ['reserveTx']);
    clearChainReaderForTests();
    setActiveChallengeStore(store);
    const out = await (async () => {
      process.env.X402_LATE_ISSUE = '1';
      n += 1;
      const nonce = `0x${n.toString(16).padStart(4, '0').repeat(16)}`;
      store.put(nonce, { resource: RESOURCE, amount: '2000', payTo: HOUSE, network: 'base', asset: USDC, issuedAt: Date.now(), expiresAt: Date.now() + 120_000 });
      const h = header();
      return settleBoundPayment({
        req: { id: `r-${n}`, headers: {}, method: 'POST', path: '/v1/chat/completions' },
        taskId: `t-${n}`,
        cfg: { enabled: true, payTo: HOUSE, network: 'base', asset: 'USDC', gatewayUrl: fac.url, apiKey: 'k', usdcPriceDefault: '2000', challengeTtlMs: 120000, defaultRail: 'usdc', lateIssue: true,
          chainReader: async ({ challenge, facilitator: f, paymentHeader: ph, expectedPayTo }) =>
            confirmEvmReceipt(chainReceipt(), { challenge, expectedPayTo, authorization: readEvmAuthorization(ph), facilitatorPayer: f?.payer }) },
        priceBody: {}, amount: '2000', baseUrl: 'https://api.chit402.com', resource: RESOURCE,
        store, paymentHeader: h, clientVersion: 2, nonce, serveStoredResponse: false, resolveQuote: async () => '2000',
      });
    })();
    assertPendingHandle(out, 'late on');
    assert.equal(out.code, 'settle_pending');
    assert.equal(out.retryAfter, 5);
  } finally {
    if (prior === undefined) delete process.env.X402_LATE_ISSUE; else process.env.X402_LATE_ISSUE = prior;
    await fac.close();
  }
});

test('F-2: a bound route refuses another wallet before /settle and never calls the facilitator', async () => {
  const fac = await facilitator();
  try {
    const store = new ChallengeStore();
    const out = await settleOnce({ store, fac, from: PAYER, expectedPayer: OTHER });
    assert.equal(out.code, 'payer_mismatch');
    assert.equal(out.preSettle, true);
    assert.equal(fac.hits.settle, 0, 'settlePayment must not be called');
    assert.equal(fac.hits.verify, 0, 'verify must not be called');
    assert.equal(store.listLate?.().length || 0, 0, 'no late row opened');
    assert.deepEqual(paymentFailureBody(out), { error: 'payer_mismatch', code: 'payer_mismatch' });
    const ok = await settleOnce({ store: new ChallengeStore(), fac, from: PAYER, expectedPayer: PAYER.toUpperCase().replace('0X', '0x') });
    assert.equal(ok.kind, 'settled', `the bound payer itself still settles: ${JSON.stringify(ok)}`);
  } finally {
    await fac.close();
  }
});

test('F-2: a chain payer that still differs marks the tx spent and returns a refund pendingId', async () => {
  const fac = await facilitator();
  try {
    const store = new ChallengeStore();
    const out = await settleOnce({
      store, fac, expectedPayer: PAYER,
      chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: OTHER, blockNumber: 16, logIndex: 0 }),
    });
    assert.equal(fac.hits.settle, 1);
    assert.equal(out.code, 'payer_mismatch');
    assert.equal(out.holdClass, 'terminal');
    const view = paymentFailureStatus(out);
    assert.equal(view.status, 409);
    assert.equal(view.retryAfter, null);
    assert.equal(paymentFailureBody(out).status, 'refund_owed');
    assertPendingHandle(out, 'chain payer');
    assert.equal(store.isTxSpent(`base:${TX}`) || store.isTxSpent(TX) || [...(store.txSpent?.keys?.() || [])].length > 0, true, 'tx marked spent');
    const late = store.listLate().find((r) => r.pending_id === out.pendingId);
    assert.equal(late?.state, 'mismatch_hold', 'refund row is terminal: no receipt is issued for it');
    assert.ok(store.listPending().some((p) => p.why === 'payer'), 'pending refund row written');
  } finally {
    await fac.close();
  }
});

test('invariant (source): after /settle returns sent, every exit is a hold, a named replay (tx_spent, auth_spent_post, reserve_lost, inflight_tx), settle_pending with a pendingId, or a receipt', () => {
  const start = SETTLE_SRC.indexOf('settled = await settlePayment(paymentHeader, gwOpts);');
  const end = SETTLE_SRC.indexOf('\nfunction refused(');
  assert.ok(start > 0 && end > start, 'settle call found');
  const tail = SETTLE_SRC.slice(SETTLE_SRC.indexOf('seenTx = settled.transaction', start), end);
  const exits = [...tail.matchAll(/return\s+([^;]*)/g)].map((m) => m[1].trim());
  const allowed = [
    /^await hold\(/,
    // Named exception: tx_spent, auth_spent_post, reserve_lost, inflight_tx.
    // The original payment already has its receipt. These four replays carry no handle.
    /^refused\(req, 'payment_replayed', \{ network: net, sub: '[a-z_]+' \}\)$/,
    /^refused\(req, 'settle_pending', \{\s*retryAfter: LATE_RETRY_AFTER_SEC,\s*pendingId,\s*verifyUrl: lateVerifyUrl\(cfg, pendingId\),\s*holdClass: 'resolvable',\s*(network: net,\s*sub: '[a-z_]+',\s*)?\}\)$/,
    /^held$/,
    /^await confirmAndSettle\(\)$/,
    /^\{\s*kind: 'settled',\s*confirmed: true,/,
  ];
  const bad = exits.filter((e) => !allowed.some((re) => re.test(e)));
  assert.deepEqual(bad, [], `exits after /settle without a pending handle: ${JSON.stringify(bad)}`);
  const replayRe = /^refused\(req, 'payment_replayed', \{ network: net, sub: '([a-z_]+)' \}\)$/;
  const replays = exits.filter((e) => replayRe.test(e));
  assert.equal(replays.length, 4, `post-settle replay exits must stay 4, got ${JSON.stringify(replays)}`);
  assert.deepEqual(replays.map((e) => e.match(replayRe)[1]).sort(), [
    'auth_spent_post',
    'inflight_tx',
    'reserve_lost',
    'tx_spent',
  ]);
  assert.ok(!/refused\(req, 'replay_store_unavailable'/.test(tail), 'no replay_store_unavailable after /settle');
  assert.ok(/pendingId,\s*\n\s*verifyUrl: lateVerifyUrl\(cfg, pendingId\)/.test(tail), 'settle_pending carries pendingId and verifyUrl');
});
