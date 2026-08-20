import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePaymentHeader,
  toPaymentRequirements,
  toPaymentPayload,
  catalogResourceUrl,
  parseExtensionResponses,
  verifyViaFacilitator,
  settleViaFacilitator,
  DEFAULT_FACILITATOR_URL,
} from '../src/x402-facilitator.js';
import { buildBazaarExtension } from '../src/x402-adapter.js';
import { runX402Handshake } from '../src/x402-server.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

// Build an X-PAYMENT header the way the SDK's createEip3009Payer does: a base64
// JSON envelope with an EIP-3009 authorization message + signature.
function makePaymentHeader({
  network = 'base-sepolia',
  amount = '50000',
  payTo = '0xtreasury',
  from = '0xpayer',
  nonce = 'abc123',
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const blob = {
    x402Version: 1,
    scheme: 'exact',
    network,
    asset: 'USDC',
    amount,
    payTo,
    nonce,
    authorization: {
      type: 'eip3009-transferWithAuthorization',
      domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      message: { from, to: payTo, value: amount, validAfter: 0, validBefore: now + 3600, nonce: '0x' + 'ab'.repeat(32) },
      signature: '0x' + '11'.repeat(65),
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function cfgX402(url, over = {}) {
  return {
    enabled: true,
    defaultRail: 'usdc',
    fallbackToTfuel: true,
    facilitatorProvider: 'x402',
    facilitatorUrl: url,
    gatewayUrl: null,
    apiKey: null,
    payTo: '0xtreasury',
    network: 'base-sepolia',
    asset: 'USDC',
    challengeTtlMs: 120000,
    usdcPriceDefault: '50000',
    usdcPrices: {},
    ...over,
  };
}

test('DEFAULT_FACILITATOR_URL is the public reference facilitator', () => {
  assert.equal(DEFAULT_FACILITATOR_URL, 'https://x402.org/facilitator');
});

test('CDP_FACILITATOR_URL is the Coinbase CDP hosted facilitator', async () => {
  const { CDP_FACILITATOR_URL, defaultFacilitatorUrlForNetwork } = await import('../src/x402-facilitator.js');
  assert.equal(CDP_FACILITATOR_URL, 'https://api.cdp.coinbase.com/platform/v2/x402');
  assert.equal(defaultFacilitatorUrlForNetwork('base'), CDP_FACILITATOR_URL);
});

test('decodePaymentHeader: raw JSON and base64 JSON', () => {
  const obj = { x402Version: 1, scheme: 'exact' };
  assert.deepEqual(decodePaymentHeader(JSON.stringify(obj)), obj);
  const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  assert.deepEqual(decodePaymentHeader(b64), obj);
  assert.equal(decodePaymentHeader(''), null);
  assert.equal(decodePaymentHeader(undefined), null);
});

test('toPaymentRequirements maps Base Sepolia USDC address + EIP-712 domain', () => {
  const r = toPaymentRequirements({ network: 'base-sepolia', amount: '50000', payTo: '0xtreasury', taskId: 't1' });
  assert.equal(r.scheme, 'exact');
  assert.equal(r.network, 'base-sepolia');
  assert.equal(r.maxAmountRequired, '50000');
  assert.equal(r.payTo, '0xtreasury');
  assert.equal(r.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  assert.deepEqual(r.extra, { name: 'USDC', version: '2' });
  assert.equal(typeof r.maxTimeoutSeconds, 'number');
});

test('toPaymentPayload reshapes the XFuel blob into the standard exact-scheme payload', () => {
  const decoded = decodePaymentHeader(makePaymentHeader());
  const p = toPaymentPayload(decoded, { network: 'base-sepolia' });
  assert.equal(p.x402Version, 1);
  assert.equal(p.scheme, 'exact');
  assert.equal(p.network, 'base-sepolia');
  assert.equal(p.payload.signature, '0x' + '11'.repeat(65));
  assert.equal(p.payload.authorization.from, '0xpayer');
  assert.equal(p.payload.authorization.to, '0xtreasury');
  assert.equal(p.payload.authorization.value, '50000');
  assert.equal(p.payload.authorization.validAfter, '0');
  assert.match(p.payload.authorization.nonce, /^0x[0-9a-f]{64}$/);
  assert.equal(p.resource, undefined, 'no catalog resource without an absolute URL');
  assert.equal(p.extensions, undefined);
});

test('toPaymentPayload attaches absolute resource + bazaar extension for CDP cataloging', () => {
  const decoded = decodePaymentHeader(makePaymentHeader());
  const extensions = buildBazaarExtension({ method: 'POST' });
  const p = toPaymentPayload(decoded, {
    network: 'base',
    resource: 'https://api.xfuel.app/task-request',
    extensions,
  });
  assert.equal(p.resource, 'https://api.xfuel.app/task-request');
  assert.equal(p.extensions.bazaar.info.input.bodyType, 'json');
});

test('toPaymentPayload prefers challenge resource over a relative header resource', () => {
  const decoded = decodePaymentHeader(makePaymentHeader());
  decoded.resource = '/task-request';
  const p = toPaymentPayload(decoded, {
    network: 'base',
    resource: 'https://api.xfuel.app/task-request',
  });
  assert.equal(p.resource, 'https://api.xfuel.app/task-request');
});

test('catalogResourceUrl accepts only absolute http(s) URLs', () => {
  assert.equal(catalogResourceUrl('https://api.xfuel.app/task-request'), 'https://api.xfuel.app/task-request');
  assert.equal(catalogResourceUrl({ url: 'https://api.xfuel.app/task-request' }), 'https://api.xfuel.app/task-request');
  assert.equal(catalogResourceUrl('/task-request'), undefined);
  assert.equal(catalogResourceUrl(undefined), undefined);
});

test('parseExtensionResponses decodes JSON and base64-JSON headers', () => {
  const json = { bazaar: { status: 'processing' } };
  assert.deepEqual(
    parseExtensionResponses(new Headers({ 'EXTENSION-RESPONSES': JSON.stringify(json) })),
    json,
  );
  const b64 = Buffer.from(JSON.stringify(json), 'utf8').toString('base64');
  assert.deepEqual(
    parseExtensionResponses(new Headers({ 'extension-responses': b64 })),
    json,
  );
  assert.equal(parseExtensionResponses(new Headers()), null);
});

test('toPaymentRequirements forwards v1 outputSchema', () => {
  const outputSchema = { input: { type: 'http', method: 'POST', bodyType: 'json', body: {} } };
  const r = toPaymentRequirements({
    network: 'base-sepolia',
    amount: '10000',
    payTo: '0xtreasury',
    resource: 'https://api.xfuel.app/task-request',
    description: 'Paid inference on Base USDC via x402',
    outputSchema,
  });
  assert.equal(r.resource, 'https://api.xfuel.app/task-request');
  assert.equal(r.description, 'Paid inference on Base USDC via x402');
  assert.deepEqual(r.outputSchema, outputSchema);
});

test('toPaymentPayload throws on a header missing signature/authorization', () => {
  assert.throws(() => toPaymentPayload({ scheme: 'exact' }, {}), /missing signature/);
});

test('verifyViaFacilitator: happy path against the mock (x402 shape)', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const header = makePaymentHeader();
    const challenge = { network: 'base-sepolia', amount: '50000', payTo: '0xtreasury', taskId: 't1' };
    const r = await verifyViaFacilitator(header, { gateway: url, challenge });
    assert.equal(r.valid, true);
    assert.equal(r.payer, '0xpayer');
  } finally {
    await close();
  }
});

test('settleViaFacilitator returns the on-chain tx ref', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const header = makePaymentHeader();
    const challenge = { network: 'base-sepolia', amount: '50000', payTo: '0xtreasury', taskId: 't1' };
    const r = await settleViaFacilitator(header, { gateway: url, challenge });
    assert.equal(r.settled, true);
    assert.match(r.txRef, /^0x/);
  } finally {
    await close();
  }
});

test('verifyViaFacilitator surfaces facilitator rejection', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const r = await verifyViaFacilitator(makePaymentHeader(), { gateway: url, challenge: { network: 'base-sepolia', amount: '50000', payTo: '0xtreasury' } });
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'mock_rejected');
  } finally {
    await close();
  }
});

test('full x402 handshake via the standard facilitator: challenge → settle → replay-rejected', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgX402(url);

    // Step 1: no X-PAYMENT → 402 challenge on Base Sepolia.
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-bs-1', cfg });
    assert.equal(challenge.kind, 'challenge');
    const accept = challenge.body.accepts[0];
    assert.equal(accept.network, 'base-sepolia');
    assert.equal(accept.maxAmountRequired, '50000');
    const nonce = accept.extra.nonce;

    // Step 2: retry with a real-shaped X-PAYMENT + nonce → verify + settle via facilitator.
    const header = makePaymentHeader({ nonce });
    const reqPay = {
      headers: { 'x-payment': header, 'x-payment-nonce': nonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPay, { taskId: 'x402-bs-1', cfg });
    assert.equal(settled.kind, 'settled');
    assert.match(settled.paymentRef, /^base-sepolia:0x/);

    // Step 3: replay the same nonce → rejected (spent).
    const replay = await runX402Handshake(reqPay, { taskId: 'x402-bs-1', cfg });
    assert.equal(replay.kind, 'failed');
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('x402 handshake defaults to the public facilitator when no URL is configured', async () => {
  // With facilitatorUrl null the adapter should target DEFAULT_FACILITATOR_URL.
  // We don't hit the network here — just assert the challenge step works offline.
  const cfg = cfgX402(null);
  const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' } } };
  const challenge = await runX402Handshake(reqNoPay, { taskId: 't', cfg });
  assert.equal(challenge.kind, 'challenge');
  assert.equal(challenge.body.accepts[0].network, 'base-sepolia');
});
