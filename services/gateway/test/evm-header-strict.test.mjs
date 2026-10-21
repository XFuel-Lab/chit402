/**
 * EVM payment headers are checked in full before the facilitator: address
 * shapes, validity window, signature size, header size, and one authorization
 * per header. Every refused case makes zero facilitator calls. A real x402
 * exact EVM payload, the XFuel SDK shape, and a long ERC-6492 signature still
 * settle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import {
  EVM_AUTH_MAX_WINDOW_S,
  EVM_SIGNATURE_MAX_BYTES,
  PAYMENT_HEADER_MAX_CHARS,
  clearChainReaderForTests,
  confirmEvmReceipt,
  evmAuthorizationRefusal,
  readEvmAuthorization,
  wrapErc6492,
} from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}`;
const pad = (a) => ethers.zeroPadValue(a, 32);
const nowS = () => Math.floor(Date.now() / 1000);
let seq = 0;
const freshNonce = () => `0x${ethers.id(`evm-header-strict:${++seq}`).slice(2)}`;

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

function countingFacilitator(payer) {
  const hits = { verify: 0, settle: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const settle = String(req.url).endsWith('/settle');
      hits[settle ? 'settle' : 'verify'] += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(settle
        ? { success: true, settled: true, transaction: TX, txRef: TX, network: 'base', payer }
        : { valid: true, isValid: true, payer }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) });
  }));
}

/** One settle against a fresh store and a counting mock facilitator. */
async function settleOnce(paymentHeader, { payer = PAYER } = {}) {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const fac = await countingFacilitator(payer);
  const challengeNonce = freshNonce();
  store.put(challengeNonce, {
    resource: 'https://api.chit402.com/v1/chat/completions',
    amount: '2000', payTo: HOUSE, network: 'base', asset: USDC,
    issuedAt: Date.now(), expiresAt: Date.now() + 120_000,
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
      clientVersion: 2,
      nonce: challengeNonce,
      serveStoredResponse: false,
      resolveQuote: async () => '2000',
    });
    return { out, hits: { ...fac.hits }, store };
  } finally {
    await fac.close();
  }
}

const b64 = (body) => Buffer.from(JSON.stringify(body)).toString('base64');

/** x402 v2 exact EVM shape with an unsigned-but-well-formed signature. */
function x402Body(mutate = () => {}) {
  const auth = { from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(nowS() + 3600), nonce: freshNonce() };
  const payload = { signature: `0x${'11'.repeat(65)}`, authorization: auth };
  const body = {
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload,
  };
  mutate(body, auth, payload);
  return body;
}

const refusedCases = [
  ['expired validBefore', (b, a) => { a.validBefore = '1'; }],
  ['validBefore that already passed a minute ago', (b, a) => { a.validBefore = String(nowS() - 60); }],
  ['validBefore inside the settle margin', (b, a) => { a.validBefore = String(nowS() + 2); }],
  ['absurd validBefore (78 nines)', (b, a) => { a.validBefore = '9'.repeat(78); }],
  ['validBefore two hours out', (b, a) => { a.validBefore = String(nowS() + 7200); }],
  ['validAfter tomorrow', (b, a) => { a.validAfter = String(nowS() + 86400); }],
  ['negative validAfter', (b, a) => { a.validAfter = '-1'; }],
  ['fractional validBefore', (b, a) => { a.validBefore = `${nowS() + 600}.5`; }],
  ['non-integer validAfter', (b, a) => { a.validAfter = 'soon'; }],
  ['129-hex signature (odd length)', (b, a, p) => { p.signature = `0x${'1'.repeat(129)}`; }],
  ['131-hex signature (odd length, above the minimum)', (b, a, p) => { p.signature = `0x${'1'.repeat(131)}`; }],
  ['64-byte signature', (b, a, p) => { p.signature = `0x${'11'.repeat(64)}`; }],
  ['200,000-hex signature', (b, a, p) => { p.signature = `0x${'11'.repeat(100_000)}`; }],
  ['signature one byte over the cap', (b, a, p) => { p.signature = `0x${'11'.repeat(EVM_SIGNATURE_MAX_BYTES + 1)}`; }],
  ['non-string signature', (b, a, p) => { p.signature = ['0x11']; }],
  ['extra field in the authorization', (b, a) => { a.extra = 'x'; }],
  ['top-level authorization next to the payload', (b) => { b.authorization = { message: { from: PAYER, to: HOUSE, value: '2000', validBefore: String(nowS() + 3600), nonce: freshNonce() }, signature: `0x${'22'.repeat(65)}` }; }],
  ['bare top-level authorization next to the payload', (b) => { b.authorization = { from: PAYER, to: HOUSE }; }],
  ['top-level signature next to the payload', (b) => { b.signature = `0x${'22'.repeat(65)}`; }],
  ['from "abc"', (b, a) => { a.from = 'abc'; }],
  ['from with 39 hex digits', (b, a) => { a.from = `0x${'5'.repeat(39)}`; }],
  ['to "xyz"', (b, a) => { a.to = 'xyz'; }],
  ['authorization as an array', (b, a, p) => { p.authorization = [a]; }],
  ['header over the size cap', (b) => { b.memo = 'x'.repeat(PAYMENT_HEADER_MAX_CHARS); }],
];

for (const [name, mutate] of refusedCases) {
  test(`strict header: ${name} refuses with 0 facilitator calls`, async () => {
    const { out, hits, store } = await settleOnce(b64(x402Body(mutate)));
    assert.equal(out.kind, 'failed', JSON.stringify(out));
    // A bad `to` is caught by the payee binding first; everything else here
    // stops at the authorization check.
    assert.ok(['settle_unconfirmed', 'challenge_mismatch'].includes(out.code), out.code);
    assert.equal(out.preSettle, true);
    assert.equal(hits.verify, 0, 'facilitator verify not called');
    assert.equal(hits.settle, 0, 'facilitator settle not called');
    assert.equal(store.pending.length, 0);
  });
}

// Bare top-level authorization (no `message`) is not a shape any client sends.
test('strict header: a bare top-level authorization alone refuses with 0 facilitator calls', async () => {
  const header = b64({
    x402Version: 1, network: 'base', amount: '2000', payTo: HOUSE,
    authorization: { from: PAYER, to: HOUSE, value: '2000', validAfter: '0', validBefore: String(nowS() + 3600), nonce: freshNonce() },
    signature: `0x${'11'.repeat(65)}`,
  });
  const { out, hits } = await settleOnce(header);
  assert.equal(out.code, 'settle_unconfirmed');
  assert.deepEqual(hits, { verify: 0, settle: 0 });
});

// Review LOW 3: each Permit2 payload key is its own scheme refusal, even when a
// complete EIP-3009 authorization rides along and no assetTransferMethod is set.
for (const key of ['permit2Authorization', 'permit2', 'permit']) {
  test(`strict header: payload.${key} is payment_scheme_unsupported with 0 facilitator calls`, async () => {
    const { out, hits } = await settleOnce(b64(x402Body((b, a, p) => { p[key] = { owner: PAYER, spender: HOUSE }; })));
    assert.equal(out.kind, 'failed');
    assert.equal(out.code, 'payment_scheme_unsupported');
    assert.equal(out.reason, 'payment_scheme_unsupported');
    assert.deepEqual(hits, { verify: 0, settle: 0 });
  });
}

async function signedX402Header(wallet, { validBefore = nowS() + 120 } = {}) {
  const message = {
    from: wallet.address,
    to: HOUSE,
    value: '2000',
    validAfter: String(nowS() - 600),
    validBefore: String(validBefore),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };
  const signature = await wallet.signTypedData(
    { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
    {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    message,
  );
  return b64({
    x402Version: 2,
    resource: { url: 'https://api.chit402.com/v1/chat/completions', mimeType: 'application/json' },
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload: { signature, authorization: message },
  });
}

test('strict header: a real signed x402 exact EVM payload still settles', async () => {
  const wallet = ethers.Wallet.createRandom();
  const { out, hits } = await settleOnce(await signedX402Header(wallet), { payer: wallet.address });
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.deepEqual(hits, { verify: 1, settle: 1 });
});

test('strict header: an SDK-style one-hour validBefore still settles', async () => {
  const wallet = ethers.Wallet.createRandom();
  const { out } = await settleOnce(await signedX402Header(wallet, { validBefore: nowS() + EVM_AUTH_MAX_WINDOW_S }), { payer: wallet.address });
  assert.equal(out.kind, 'settled', JSON.stringify(out));
});

test('strict header: the XFuel SDK shape (top-level authorization.message, numeric times) still settles', async () => {
  const header = b64({
    x402Version: 1, scheme: 'exact', network: 'base', asset: USDC, amount: '2000', payTo: HOUSE,
    authorization: {
      type: 'eip3009-transferWithAuthorization',
      domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
      message: { from: PAYER, to: HOUSE, value: '2000', validAfter: 0, validBefore: nowS() + 3600, nonce: freshNonce() },
      signature: `0x${'11'.repeat(65)}`,
    },
  });
  const { out, hits } = await settleOnce(header);
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.deepEqual(hits, { verify: 1, settle: 1 });
});

test('strict header: an integer-equivalent "2000.0" value still settles', async () => {
  const { out } = await settleOnce(b64(x402Body((b, a) => { a.value = '2000.0'; })));
  assert.equal(out.kind, 'settled', JSON.stringify(out));
});

function smartWalletSignature(innerBytes) {
  return wrapErc6492({
    factory: `0x${'44'.repeat(20)}`,
    salt: `0x${'01'.repeat(32)}`,
    initCodeHash: `0x${'02'.repeat(32)}`,
    innerSig: `0x${'ab'.repeat(innerBytes)}`,
  });
}

test('strict header: a long ERC-6492 smart-wallet signature still settles', async () => {
  // About the size of a passkey smart-wallet signature with deploy calldata.
  const signature = smartWalletSignature(1500);
  assert.ok((signature.length - 2) / 2 > 1500);
  const { out, hits } = await settleOnce(b64(x402Body((b, a, p) => { p.signature = signature; })));
  assert.equal(out.kind, 'settled', JSON.stringify(out));
  assert.deepEqual(hits, { verify: 1, settle: 1 });
});

test('strict header: an ERC-6492 signature at the size cap is accepted, one byte over is not', () => {
  const at = smartWalletSignature(EVM_SIGNATURE_MAX_BYTES - 256);
  const atBytes = (at.length - 2) / 2;
  assert.ok(atBytes <= EVM_SIGNATURE_MAX_BYTES && atBytes > EVM_SIGNATURE_MAX_BYTES - 64, String(atBytes));
  const withSig = (signature) => b64(x402Body((b, a, p) => { p.signature = signature; }));
  assert.equal(evmAuthorizationRefusal(withSig(at)), null);
  assert.equal(evmAuthorizationRefusal(withSig(`0x${'11'.repeat(EVM_SIGNATURE_MAX_BYTES)}`)), null);
  assert.equal(evmAuthorizationRefusal(withSig(`0x${'11'.repeat(EVM_SIGNATURE_MAX_BYTES + 1)}`)), 'settle_unconfirmed');
});

test('evmAuthorizationRefusal: the window follows a longer advertised maxTimeoutSeconds', () => {
  const now = 1_800_000_000;
  const h = b64(x402Body((b, a) => { a.validBefore = String(now + 5000); }));
  assert.equal(evmAuthorizationRefusal(h, { nowSec: now }), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(h, { nowSec: now, maxTimeoutSeconds: 6000 }), null);
  // A shorter advertised timeout never shrinks the window below the SDK hour.
  const hour = b64(x402Body((b, a) => { a.validBefore = String(now + 3600); }));
  assert.equal(evmAuthorizationRefusal(hour, { nowSec: now, maxTimeoutSeconds: 120 }), null);
});

test('evmAuthorizationRefusal: the header cap applies to raw JSON and base64 alike', () => {
  const big = x402Body((b) => { b.memo = 'x'.repeat(PAYMENT_HEADER_MAX_CHARS); });
  assert.equal(evmAuthorizationRefusal(JSON.stringify(big)), 'settle_unconfirmed');
  assert.equal(evmAuthorizationRefusal(b64(big)), 'settle_unconfirmed');
  const fits = x402Body((b) => { b.memo = 'x'.repeat(1000); });
  assert.equal(evmAuthorizationRefusal(JSON.stringify(fits)), null);
});
