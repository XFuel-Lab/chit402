/**
 * EVM settlement requires the EIP-3009 authorization nonce. A payment that
 * omits it cannot confirm a transfer, and cannot open a second settlement on a
 * different tx that only shares the payer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { confirmEvmReceipt, readEvmAuthorization, clearChainReaderForTests } from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX1 = `0x${'ab'.repeat(32)}`;
const TX2 = `0x${'cd'.repeat(32)}`;
const N1 = `0x${'11'.repeat(32)}`;
const N2 = `0x${'22'.repeat(32)}`;
const pad = (a) => ethers.zeroPadValue(a, 32);

function receipt({ from = PAYER, authorizer = from, nonce = N1, value = 2000n, to = HOUSE } = {}) {
  return {
    status: '0x1', blockNumber: '0x10', contractAddress: null, blockHash: `0x${'ee'.repeat(32)}`,
    logs: [
      { address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(from), pad(to)], data: ethers.toBeHex(value, 32), logIndex: '0x0' },
      { address: USDC, topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(authorizer), pad(nonce)], data: '0x', logIndex: '0x1' },
    ],
  };
}

function header({ from = PAYER, nonce = N1, value = '2000', amount = '2000', omitNonce = false, emptyNonce = false } = {}) {
  const auth = { from, to: HOUSE, value, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  if (emptyNonce) auth.nonce = '';
  else if (!omitNonce) auth.nonce = nonce;
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount, asset: USDC, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload: { signature: `0x${'11'.repeat(65)}`, authorization: auth },
  })).toString('base64');
}

function headerV1({ from = PAYER, nonce = N1, omitNonce = false } = {}) {
  const auth = { from, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  if (!omitNonce) auth.nonce = nonce;
  return Buffer.from(JSON.stringify({
    network: 'base', amount: '2000', payTo: HOUSE,
    payload: { signature: `0x${'11'.repeat(65)}`, authorization: auth },
  })).toString('base64');
}

clearChainReaderForTests();

test('confirmEvmReceipt: matching nonce confirms', () => {
  const r = confirmEvmReceipt(receipt({ nonce: N1 }), {
    challenge: { asset: USDC, amount: '2000', network: 'base' },
    expectedPayTo: HOUSE,
    authorization: { from: PAYER, nonce: N1, signature: `0x${'11'.repeat(65)}` },
    facilitatorPayer: PAYER,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('confirmEvmReceipt: wrong nonce refuses', () => {
  const r = confirmEvmReceipt(receipt({ nonce: N1 }), {
    challenge: { asset: USDC, amount: '2000', network: 'base' },
    expectedPayTo: HOUSE,
    authorization: { from: PAYER, nonce: N2 },
    facilitatorPayer: PAYER,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'settle_unconfirmed');
});

test('confirmEvmReceipt: missing nonce refuses (does not skip)', () => {
  for (const authorization of [
    { from: PAYER, nonce: null },
    { from: PAYER, nonce: '' },
    { from: PAYER },
  ]) {
    const r = confirmEvmReceipt(receipt({ nonce: N1 }), {
      challenge: { asset: USDC, amount: '2000', network: 'base' },
      expectedPayTo: HOUSE,
      authorization,
      facilitatorPayer: PAYER,
    });
    assert.equal(r.ok, false, JSON.stringify(authorization));
    assert.equal(r.code, 'settle_unconfirmed');
  }
});

test('confirmEvmReceipt: missing nonce and Transfer-only receipt refuses', () => {
  const bare = {
    status: '0x1', blockNumber: '0x10', contractAddress: null,
    logs: [{ address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(PAYER), pad(HOUSE)], data: ethers.toBeHex(2000n, 32), logIndex: '0x0' }],
  };
  const r = confirmEvmReceipt(bare, {
    challenge: { asset: USDC, amount: '2000', network: 'base' },
    expectedPayTo: HOUSE,
    authorization: { from: PAYER },
    facilitatorPayer: PAYER,
  });
  assert.equal(r.ok, false);
});

test('confirmEvmReceipt: other authorizer refuses even with a matching nonce field', () => {
  const r = confirmEvmReceipt(receipt({ from: PAYER, authorizer: OTHER, nonce: N1 }), {
    challenge: { asset: USDC, amount: '2000', network: 'base' },
    expectedPayTo: HOUSE,
    authorization: { from: PAYER, nonce: N1 },
    facilitatorPayer: PAYER,
  });
  assert.equal(r.ok, false);
});

test('readEvmAuthorization: empty string nonce is absent', () => {
  const h = Buffer.from(JSON.stringify({
    payload: { signature: '0x11', authorization: { from: PAYER, to: HOUSE, value: '2000', nonce: '' } },
  })).toString('base64');
  assert.equal(readEvmAuthorization(h).nonce, null);
});

function listenFac({ tx = TX1, payer = PAYER } = {}) {
  const hits = { verify: 0, settle: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      hits[String(req.url).endsWith('/settle') ? 'settle' : 'verify'] += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(String(req.url).endsWith('/settle')
        ? { success: true, settled: true, transaction: tx, txRef: tx, network: 'base', payer }
        : { valid: true, isValid: true, payer }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) });
  }));
}

async function oneSettle({ store, fac, challengeNonce, authNonce = N1, omitNonce = false, emptyNonce = false, headerFn = header, txReceiptNonce = N1 }) {
  store.put(challengeNonce, {
    resource: 'https://api.chit402.com/v1/chat/completions',
    amount: '2000', payTo: HOUSE, network: 'base', asset: USDC,
    issuedAt: Date.now(), expiresAt: Date.now() + 120_000,
  });
  const paymentHeader = headerFn({ from: PAYER, nonce: authNonce, omitNonce, emptyNonce });
  const req = { headers: { 'x-payment': paymentHeader, 'x-payment-nonce': challengeNonce }, method: 'POST', path: '/v1/chat/completions' };
  return settleBoundPayment({
    req,
    taskId: `t-${challengeNonce.slice(0, 8)}`,
    cfg: {
      enabled: true, payTo: HOUSE, network: 'base', asset: 'USDC',
      gatewayUrl: fac.url, apiKey: 'k', usdcPriceDefault: '2000',
      challengeTtlMs: 120000, defaultRail: 'usdc',
      chainReader: async ({ challenge, facilitator, paymentHeader: h, expectedPayTo }) =>
        confirmEvmReceipt(receipt({ nonce: txReceiptNonce }), {
          challenge, expectedPayTo,
          authorization: readEvmAuthorization(h),
          facilitatorPayer: facilitator?.payer,
        }),
    },
    priceBody: {},
    amount: '2000',
    baseUrl: 'https://api.chit402.com',
    resource: 'https://api.chit402.com/v1/chat/completions',
    store,
    paymentHeader,
    clientVersion: 2,
    nonce: challengeNonce,
    serveStoredResponse: false,
    resolveQuote: async () => '2000',
  });
}

test('settle: omitted auth nonce refuses before the facilitator', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await listenFac({ tx: TX1 });
  const out = await oneSettle({ store, fac, challengeNonce: `0x${'a1'.repeat(32)}`, omitNonce: true });
  await fac.close();
  assert.equal(out.kind, 'failed', JSON.stringify(out));
  assert.equal(out.reason || out.code, 'settle_unconfirmed');
  assert.equal(fac.hits.settle, 0, 'facilitator must not be called');
  assert.equal(fac.hits.verify, 0);
});

test('settle: empty-string auth nonce refuses before the facilitator', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await listenFac({ tx: TX1 });
  const out = await oneSettle({ store, fac, challengeNonce: `0x${'a2'.repeat(32)}`, emptyNonce: true });
  await fac.close();
  assert.equal(out.kind, 'failed');
  assert.equal(out.reason || out.code, 'settle_unconfirmed');
  assert.equal(fac.hits.settle, 0);
});

test('settle: v1 omitted auth nonce refuses', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await listenFac({ tx: TX1 });
  const out = await oneSettle({ store, fac, challengeNonce: `0x${'a3'.repeat(32)}`, omitNonce: true, headerFn: headerV1 });
  await fac.close();
  assert.equal(out.kind, 'failed');
  assert.equal(out.reason || out.code, 'settle_unconfirmed');
  assert.equal(fac.hits.settle, 0);
});

test('settle: two challenges with no auth nonce and different txs do not both settle', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const f1 = await listenFac({ tx: TX1 });
  const first = await oneSettle({ store, fac: f1, challengeNonce: `0x${'b1'.repeat(32)}`, omitNonce: true });
  await f1.close();
  const f2 = await listenFac({ tx: TX2 });
  const second = await oneSettle({ store, fac: f2, challengeNonce: `0x${'b2'.repeat(32)}`, omitNonce: true });
  await f2.close();
  assert.equal(first.kind, 'failed');
  assert.equal(second.kind, 'failed');
  assert.equal(f1.hits.settle, 0);
  assert.equal(f2.hits.settle, 0);
});

test('settle: matching auth nonce still settles once; same tx replay is payment_replayed', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await listenFac({ tx: TX1 });
  const first = await oneSettle({ store, fac, challengeNonce: `0x${'c1'.repeat(32)}`, authNonce: N1 });
  const second = await oneSettle({ store, fac, challengeNonce: `0x${'c2'.repeat(32)}`, authNonce: N1 });
  await fac.close();
  assert.equal(first.kind, 'settled', JSON.stringify(first));
  assert.equal(second.kind, 'failed');
  assert.equal(second.reason || second.code, 'payment_replayed');
});

test('settle: matching auth nonce then a no-nonce claim of the same tx refuses without a second settle', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await listenFac({ tx: TX1 });
  const first = await oneSettle({ store, fac, challengeNonce: `0x${'d1'.repeat(32)}`, authNonce: N1 });
  const before = fac.hits.settle;
  const second = await oneSettle({ store, fac, challengeNonce: `0x${'d2'.repeat(32)}`, omitNonce: true });
  await fac.close();
  assert.equal(first.kind, 'settled');
  assert.equal(second.kind, 'failed');
  assert.equal(second.reason || second.code, 'settle_unconfirmed');
  assert.equal(fac.hits.settle, before, 'no-nonce path must not call settle again');
});

// Review LOW 2: the nonce must be exactly 0x plus 64 hex before the facilitator.
test('settle: malformed auth nonces refuse before the facilitator', async () => {
  const bad = ['0x0', '0x', '0x11', ` ${N1}`, `${N1}\n`, N1.slice(2), `0x${'11'.repeat(31)}`, `0x${'11'.repeat(33)}`, `0x${'zz'.repeat(32)}`, 17, { n: N1 }, [N1]];
  let i = 0;
  for (const authNonce of bad) {
    const store = new ChallengeStore();
    setActiveChallengeStore(store);
    const fac = await listenFac({ tx: TX1 });
    i += 1;
    const out = await oneSettle({ store, fac, challengeNonce: `0x${String(i).padStart(2, '0').repeat(32)}`, authNonce });
    await fac.close();
    assert.equal(out.kind, 'failed', JSON.stringify(authNonce));
    assert.equal(out.reason || out.code, 'settle_unconfirmed', JSON.stringify(authNonce));
    assert.equal(fac.hits.settle, 0, `facilitator not called for ${JSON.stringify(authNonce)}`);
    assert.equal(fac.hits.verify, 0);
  }
});

test('confirmEvmReceipt: only a bytes32 nonce matches; short or bare aliases do not', () => {
  const opts = (nonce) => ({ challenge: { asset: USDC, amount: '2000', network: 'base' }, expectedPayTo: HOUSE, authorization: { from: PAYER, nonce } });
  assert.equal(confirmEvmReceipt(receipt({ nonce: pad('0x11') }), opts('0x11')).ok, false);
  assert.equal(confirmEvmReceipt(receipt({ nonce: `0x${'00'.repeat(32)}` }), opts('0x')).ok, false);
  assert.equal(confirmEvmReceipt(receipt({ nonce: N1 }), opts(N1.slice(2))).ok, false);
  assert.equal(confirmEvmReceipt(receipt({ nonce: N1 }), opts([N1])).ok, false);
  assert.equal(confirmEvmReceipt(receipt({ nonce: N1 }), opts(N1.toUpperCase().replace('0X', '0x'))).ok, true);
});

// Review LOW 3: one (payer, nonce) is one key, whatever the case.
test('settle: an alias of a spent nonce on another tx never settles a second claim', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const NA = `0x${'ab'.repeat(32)}`;
  const f1 = await listenFac({ tx: TX1 });
  const first = await oneSettle({ store, fac: f1, challengeNonce: `0x${'e1'.repeat(32)}`, authNonce: NA, txReceiptNonce: NA });
  await f1.close();
  const f2 = await listenFac({ tx: TX2 });
  const upper = await oneSettle({ store, fac: f2, challengeNonce: `0x${'e2'.repeat(32)}`, authNonce: `0x${'AB'.repeat(32)}`, txReceiptNonce: NA });
  const bare = await oneSettle({ store, fac: f2, challengeNonce: `0x${'e3'.repeat(32)}`, authNonce: NA.slice(2), txReceiptNonce: NA });
  await f2.close();
  assert.equal(first.kind, 'settled', JSON.stringify(first));
  assert.equal(upper.kind, 'failed');
  assert.equal(upper.reason || upper.code, 'payment_replayed');
  assert.equal(bare.kind, 'failed', JSON.stringify(bare));
  assert.equal(f2.hits.settle, 0, 'no second facilitator settle');
});

test('evmAuthKey: canonical keys equal the keys earlier releases stored', async () => {
  const { evmAuthKey } = await import('../src/late-issue.js');
  const legacy = (net, asset, from, nonce) => `${net}|${String(asset).toLowerCase()}|${String(from).toLowerCase()}|${String(nonce).toLowerCase()}`;
  for (const n of [N1, `0x${'AbCd'.repeat(16)}`, `0x${'00'.repeat(32)}`]) {
    assert.equal(evmAuthKey('base', USDC, PAYER, n), legacy('base', USDC, PAYER, n));
  }
  assert.equal(evmAuthKey('base', USDC, PAYER, `0x${'AB'.repeat(32)}`), evmAuthKey('base', USDC, PAYER, `0x${'ab'.repeat(32)}`));
  // A stored key from a malformed nonce keeps its old form, so it still matches.
  assert.equal(evmAuthKey('base', USDC, PAYER, 'XYZ'), legacy('base', USDC, PAYER, 'XYZ'));
});

// Review MEDIUM 1: EVM payments need a decodable EIP-3009 authorization.
const opaqueHeader = () => 'PAYMENT-BLOB-OPAQUE';
const permit2Header = ({ from = PAYER } = {}) => Buffer.from(JSON.stringify({
  x402Version: 2,
  accepted: { scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: HOUSE, extra: { assetTransferMethod: 'permit2' } },
  payload: {
    signature: `0x${'11'.repeat(65)}`,
    permit2Authorization: { from, permitted: { token: USDC, amount: '2000' }, spender: HOUSE, nonce: '1', deadline: '9999999999', witness: { to: HOUSE } },
  },
})).toString('base64');

for (const [name, headerFn] of [['opaque', opaqueHeader], ['Permit2-shaped', permit2Header]]) {
  test(`settle: ${name} EVM header refuses before the facilitator and holds nothing`, async () => {
    const store = new ChallengeStore();
    setActiveChallengeStore(store);
    const fac = await listenFac({ tx: TX1 });
    const challengeNonce = `0x${(name === 'opaque' ? 'f1' : 'f2').repeat(32)}`;
    const out = await oneSettle({ store, fac, challengeNonce, headerFn });
    await fac.close();
    assert.equal(out.kind, 'failed', JSON.stringify(out));
    assert.equal(out.reason || out.code, 'settle_unconfirmed');
    assert.equal(fac.hits.settle, 0, 'facilitator settle not called');
    assert.equal(fac.hits.verify, 0, 'facilitator verify not called');
    assert.equal(store.pending.length, 0, 'no pending hold row');
    assert.equal(store.late.length, 0, 'no late-issue row');
    assert.equal(store.txReserved.size, 0);
    assert.equal(store.spent.size, 0);
  });
}
