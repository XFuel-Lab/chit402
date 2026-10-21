/**
 * Follow-ups to the strict EVM payment header check:
 * - value, validAfter and validBefore are capped at 2^256 - 1 before the
 *   facilitator is called;
 * - "2000.0" style integers go to the facilitator as "2000" on the v1 and
 *   SDK wire shape too, not only on the CDP-native v2 shape;
 * - the exact edges of the validity window, the SDK-shape guards, and the
 *   advertised maxTimeoutSeconds each have a test that fails if the check
 *   is removed.
 * Local mock facilitator only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment, boundSettledAmount } from '../src/x402-settle.js';
import {
  EVM_AUTH_CLOCK_SKEW_S,
  EVM_AUTH_MAX_WINDOW_S,
  EVM_AUTH_MIN_REMAINING_S,
  clearChainReaderForTests,
  confirmEvmReceipt,
  evmAuthorizationRefusal,
  readEvmAuthorization,
} from '../src/x402-chain.js';
import { toPaymentPayload } from '../src/x402-facilitator.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}`;
const SIG = `0x${'11'.repeat(65)}`;
const pad = (a) => ethers.zeroPadValue(a, 32);
const nowS = () => Math.floor(Date.now() / 1000);
let seq = 0;
const freshNonce = () => `0x${ethers.id(`evm-header-followups:${++seq}`).slice(2)}`;
const b64 = (body) => Buffer.from(JSON.stringify(body)).toString('base64');
const UINT256_MAX = (1n << 256n) - 1n;
const OVER_UINT256 = (UINT256_MAX + 1n).toString();

clearChainReaderForTests();

function receipt({ from, nonce, value = 2000n }) {
  return {
    status: '0x1', blockNumber: '0x10', contractAddress: null, blockHash: `0x${'ee'.repeat(32)}`,
    logs: [
      { address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(from), pad(HOUSE)], data: ethers.toBeHex(value, 32), logIndex: '0x0' },
      { address: USDC, topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(from), pad(nonce)], data: '0x', logIndex: '0x1' },
    ],
  };
}

/** Counts calls and keeps each request body. */
function countingFacilitator(payer) {
  const hits = { verify: 0, settle: 0 };
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const settle = String(req.url).endsWith('/settle');
      hits[settle ? 'settle' : 'verify'] += 1;
      try { bodies.push(JSON.parse(raw)); } catch { bodies.push(null); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(settle
        ? { success: true, settled: true, transaction: TX, txRef: TX, network: 'base', payer }
        : { valid: true, isValid: true, payer }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, bodies, close: () => new Promise((r) => server.close(r)) });
  }));
}

/**
 * One settle against a fresh store and a counting mock facilitator on
 * 127.0.0.1. With standard: true the gateway speaks the x402 facilitator
 * protocol, which is where toPaymentPayload shapes the body.
 */
async function settleOnce(paymentHeader, { challengeExtra = {}, clientVersion = 2, standard = false } = {}) {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await countingFacilitator(PAYER);
  const challengeNonce = freshNonce();
  store.put(challengeNonce, {
    resource: 'https://api.chit402.com/v1/chat/completions',
    amount: '2000', payTo: HOUSE, network: 'base', asset: USDC,
    issuedAt: Date.now(), expiresAt: Date.now() + 120_000,
    ...challengeExtra,
  });
  const req = { headers: { 'x-payment': paymentHeader, 'x-payment-nonce': challengeNonce }, method: 'POST', path: '/v1/chat/completions' };
  try {
    const out = await settleBoundPayment({
      req,
      taskId: `t-${challengeNonce.slice(2, 10)}`,
      cfg: {
        enabled: true, payTo: HOUSE, network: 'base', asset: 'USDC',
        gatewayUrl: fac.url, apiKey: 'k', usdcPriceDefault: '2000',
        challengeTtlMs: 120000, defaultRail: 'usdc',
        // standard: speak x402 (paymentPayload) to the same local mock.
        ...(standard ? { facilitatorProvider: 'x402', facilitatorUrl: fac.url } : {}),
        chainReader: async ({ challenge, facilitator, paymentHeader: h, expectedPayTo }) => {
          const authorization = readEvmAuthorization(h);
          return confirmEvmReceipt(receipt({ from: authorization.from, nonce: authorization.nonce }), {
            challenge, expectedPayTo, authorization, facilitatorPayer: facilitator?.payer,
          });
        },
      },
      priceBody: {},
      amount: '2000',
      baseUrl: 'https://api.chit402.com',
      resource: 'https://api.chit402.com/v1/chat/completions',
      store,
      paymentHeader,
      clientVersion,
      nonce: challengeNonce,
      serveStoredResponse: false,
      resolveQuote: async () => '2000',
    });
    return { out, hits: { ...fac.hits }, bodies: fac.bodies };
  } finally {
    await fac.close();
  }
}

/** x402 v2 exact EVM shape. */
function x402Body(mutate = () => {}) {
  const auth = { from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(nowS() + 3600), nonce: freshNonce() };
  const payload = { signature: SIG, authorization: auth };
  const body = {
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload,
  };
  mutate(body, auth, payload);
  return body;
}

/** XFuel SDK shape: top-level authorization { message, signature }. */
function sdkBody(mutate = () => {}) {
  const message = { from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(nowS() + 3600), nonce: freshNonce() };
  const body = {
    x402Version: 1, scheme: 'exact', network: 'base', asset: USDC, amount: '2000', payTo: HOUSE,
    authorization: {
      type: 'eip3009-transferWithAuthorization',
      domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
      message,
      signature: SIG,
    },
  };
  mutate(body, message);
  return body;
}

// (a) uint256 cap

test('uint256 cap: value, validAfter and validBefore above 2^256 - 1 are refused', () => {
  assert.equal(OVER_UINT256.length, 78);
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.value = OVER_UINT256; }))), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.value = '9'.repeat(78); }))), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.value = `${OVER_UINT256}.0`; }))), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.validAfter = OVER_UINT256; }))), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.validBefore = OVER_UINT256; }))), 'settle_unconfirmed');
});

test('uint256 cap: 2^256 - 1 itself is a well-formed value', () => {
  assert.equal(evmAuthorizationRefusal(b64(x402Body((b, a) => { a.value = UINT256_MAX.toString(); }))), null);
});

for (const [name, body] of [
  ['x402 shape', () => x402Body((b, a) => { a.value = '9'.repeat(78); })],
  ['SDK shape', () => sdkBody((b, m) => { m.value = '9'.repeat(78); })],
]) {
  test(`uint256 cap: a 78-nines value (${name}) refuses with 0 facilitator calls`, async () => {
    const { out, hits } = await settleOnce(b64(body()));
    assert.equal(out.kind, 'failed', JSON.stringify(out));
    assert.equal(out.code, 'settle_unconfirmed');
    assert.equal(out.preSettle, true);
    assert.deepEqual(hits, { verify: 0, settle: 0 });
  });
}

// (b) integer forms on the v1 and SDK wire shape

test('toPaymentPayload: the SDK shape sends "2000.0" style fields as integers', () => {
  const vb = nowS() + 600;
  const decoded = sdkBody((b, m) => { m.value = '2000.0'; m.validAfter = '0.00'; m.validBefore = `${vb}.0`; });
  for (const x402Version of [1, 2]) {
    const sent = toPaymentPayload(decoded, { x402Version });
    assert.equal(sent.payload.authorization.value, '2000');
    assert.equal(sent.payload.authorization.validAfter, '0');
    assert.equal(sent.payload.authorization.validBefore, String(vb));
  }
});

test('toPaymentPayload: the SDK shape still sends JSON numbers as integer strings', () => {
  const vb = nowS() + 600;
  const sent = toPaymentPayload(sdkBody((b, m) => { m.value = 2000; m.validAfter = 0; m.validBefore = vb; }), { x402Version: 1 });
  assert.deepEqual(
    [sent.payload.authorization.value, sent.payload.authorization.validAfter, sent.payload.authorization.validBefore],
    ['2000', '0', String(vb)],
  );
});

test('toPaymentPayload: the SDK shape refuses a fractional value, as the v2 shape does', () => {
  assert.throws(
    () => toPaymentPayload(sdkBody((b, m) => { m.value = '2000.5'; }), { x402Version: 1 }),
    /^Error: authorization_value_must_be_integer_string/,
  );
  assert.throws(
    () => toPaymentPayload(x402Body((b, a) => { a.value = '2000.5'; }), { x402Version: 2 }),
    /^Error: authorization_value_must_be_integer_string/,
  );
});

test('settle: an SDK-shape "2000.0" value reaches the facilitator as "2000"', async () => {
  const { out, hits, bodies } = await settleOnce(b64(sdkBody((b, m) => { m.value = '2000.0'; })), { standard: true, clientVersion: 1 });
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.deepEqual(hits, { verify: 1, settle: 1 });
  assert.ok(bodies.length >= 2);
  for (const body of bodies) {
    assert.equal(body.paymentPayload.payload.authorization.value, '2000', JSON.stringify(body.paymentPayload));
  }
});

// (c) exact window edges, pinned with a fixed clock

const NOW = 1_800_000_000;
const at = (fields, opts = {}) => evmAuthorizationRefusal(b64(x402Body((b, a) => { Object.assign(a, { validBefore: String(NOW + 600) }, fields); })), { nowSec: NOW, ...opts });

test('window edge: validBefore must be more than EVM_AUTH_MIN_REMAINING_S away', () => {
  assert.equal(EVM_AUTH_MIN_REMAINING_S, 6);
  assert.equal(at({ validBefore: String(NOW + EVM_AUTH_MIN_REMAINING_S) }), 'settle_unconfirmed');
  assert.equal(at({ validBefore: String(NOW + EVM_AUTH_MIN_REMAINING_S + 1) }), null);
});

test('window edge: validBefore may be exactly window plus skew away, not one second more', () => {
  const edge = NOW + EVM_AUTH_MAX_WINDOW_S + EVM_AUTH_CLOCK_SKEW_S;
  assert.equal(at({ validBefore: String(edge) }), null);
  assert.equal(at({ validBefore: String(edge + 1) }), 'settle_unconfirmed');
});

test('window edge: a longer advertised maxTimeoutSeconds moves the upper edge exactly', () => {
  const edge = NOW + 6000 + EVM_AUTH_CLOCK_SKEW_S;
  assert.equal(at({ validBefore: String(edge) }, { maxTimeoutSeconds: 6000 }), null);
  assert.equal(at({ validBefore: String(edge + 1) }, { maxTimeoutSeconds: 6000 }), 'settle_unconfirmed');
});

test('window edge: validAfter may be up to the clock skew ahead, not one second more', () => {
  assert.equal(at({ validAfter: String(NOW + EVM_AUTH_CLOCK_SKEW_S) }), null);
  assert.equal(at({ validAfter: String(NOW + EVM_AUTH_CLOCK_SKEW_S + 1) }), 'settle_unconfirmed');
});

// (c) SDK-shape guards in singleAuthorization

test('SDK shape: the plain form is accepted (control for the guards below)', () => {
  assert.equal(evmAuthorizationRefusal(b64(sdkBody())), null);
});

test('SDK shape: a stray top-level signature next to authorization.signature is refused', () => {
  assert.equal(evmAuthorizationRefusal(b64(sdkBody((b) => { b.signature = `0x${'22'.repeat(65)}`; }))), 'settle_unconfirmed');
});

test('SDK shape: a stray payload.signature next to authorization.signature is refused', () => {
  assert.equal(evmAuthorizationRefusal(b64(sdkBody((b) => { b.payload = { signature: `0x${'22'.repeat(65)}` }; }))), 'settle_unconfirmed');
});

test('SDK shape: a bare top-level authorization (no message, own signature) is refused', () => {
  const header = b64({
    x402Version: 1, scheme: 'exact', network: 'base', asset: USDC, amount: '2000', payTo: HOUSE,
    authorization: { from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(NOW + 600), nonce: freshNonce(), signature: SIG },
  });
  assert.equal(evmAuthorizationRefusal(header, { nowSec: NOW }), 'settle_unconfirmed');
});

// (c) the stored challenge's maxTimeoutSeconds reaches the check

test('settle: a challenge that advertises maxTimeoutSeconds 7200 accepts a 7000 s validBefore', async () => {
  const header = b64(x402Body((b, a) => { a.validBefore = String(nowS() + 7000); }));
  const { out, hits } = await settleOnce(header, { challengeExtra: { maxTimeoutSeconds: 7200 } });
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.deepEqual(hits, { verify: 1, settle: 1 });
});

test('settle: without that advertisement the same 7000 s validBefore is refused before the facilitator', async () => {
  const header = b64(x402Body((b, a) => { a.validBefore = String(nowS() + 7000); }));
  const { out, hits } = await settleOnce(header);
  assert.equal(out.code, 'settle_unconfirmed');
  assert.deepEqual(hits, { verify: 0, settle: 0 });
});

// Settled amount comes from the one signed authorization, not unsigned copies.

test('settle: unsigned amount copies outside the authorization do not change the settled amount', async () => {
  const header = b64(sdkBody((b) => {
    b.value = '999999999000';
    b.maxAmountRequired = '999999999000';
    b.payload = { value: '999999999000', amount: '999999999000' };
  }));
  assert.equal(evmAuthorizationRefusal(header), null, 'reaches the facilitator');
  assert.deepEqual(boundSettledAmount(header, 1, { network: 'base' }), { amount: '2000' });
  const { out, hits, bodies } = await settleOnce(header, { standard: true, clientVersion: 1 });
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.equal(out.settledAmount, '2000');
  assert.deepEqual(hits, { verify: 1, settle: 1 });
  for (const body of bodies) assert.equal(body.paymentPayload.payload.authorization.value, '2000');
});
