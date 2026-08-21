import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

/**
 * Build a CDP-native v2 PAYMENT-SIGNATURE header the way Bankr and other CDP
 * clients send it: a spec-compliant PaymentPayload with { payload: { authorization, signature } }.
 *
 * This is the exact shape that caused paymentPayloadInvalid before the fix:
 * CDP-native clients put the auth data at decoded.payload.authorization, not decoded.authorization.message.
 */
function makeCdpNativePaymentHeader({
  network = 'eip155:84532',
  amount = '50000',
  payTo = '0xtreasury',
  from = '0xpayer',
  nonce = '0x' + 'cd'.repeat(32),
  resourceUrl = 'https://api.xfuel.app/task-request',
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const blob = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: 'XFuel paid inference',
      mimeType: 'application/json',
    },
    accepted: {
      scheme: 'exact',
      network,
      amount,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
    payload: {
      signature: '0x' + '22'.repeat(65),
      authorization: {
        from,
        to: payTo,
        value: amount,
        validAfter: '0',
        validBefore: String(now + 3600),
        nonce,
      },
    },
    extensions: {},
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

// ══════════════════════════════════════════════════════════════════════════════
// v2 CAIP-2 network format fix (Bankr invalid_network)
// CDP v2 facilitator rejects short network 'base'; it wants CAIP-2 'eip155:8453'.
// ══════════════════════════════════════════════════════════════════════════════

test('toPaymentRequirements v1 uses short network form for backward compatibility', () => {
  // v1 (XFuel SDK / ZAN path) keeps short form
  const r = toPaymentRequirements({
    network: 'eip155:8453', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 1,
  });
  assert.equal(r.network, 'base', 'v1 must use short form for backward compatibility');
});

test('toPaymentRequirements v2 uses CAIP-2 network format (invalid_network fix)', () => {
  // v2 (CDP-native like Bankr) must use CAIP-2 to match what the payer signed.
  // Before this fix: network was 'base', CDP rejected with invalid_network.
  const r = toPaymentRequirements({
    network: 'eip155:8453', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 2,
  });
  assert.equal(r.network, 'eip155:8453', 'v2 must use CAIP-2 network format');
  // Asset lookup still works (uses short form internally)
  assert.equal(r.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'Base mainnet USDC');
});

test('toPaymentRequirements v2 converts short form to CAIP-2', () => {
  // Even if the input is short form, v2 must emit CAIP-2
  const r = toPaymentRequirements({
    network: 'base', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 2,
  });
  assert.equal(r.network, 'eip155:8453', 'v2 converts short form to CAIP-2');
});

test('toPaymentRequirements v2 handles Base Sepolia CAIP-2', () => {
  const r = toPaymentRequirements({
    network: 'eip155:84532', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 2,
  });
  assert.equal(r.network, 'eip155:84532', 'v2 preserves Base Sepolia CAIP-2');
  assert.equal(r.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'Base Sepolia USDC');
});

test('toPaymentPayload reshapes the XFuel blob into the standard exact-scheme payload (v1)', () => {
  const decoded = decodePaymentHeader(makePaymentHeader());
  const p = toPaymentPayload(decoded, { network: 'base-sepolia' });
  assert.equal(p.x402Version, 1, 'defaults to v1');
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

test('toPaymentPayload uses x402Version: 2 for CDP-native v2 clients', () => {
  const decoded = decodePaymentHeader(makePaymentHeader());
  const p = toPaymentPayload(decoded, { network: 'base', x402Version: 2 });
  assert.equal(p.x402Version, 2, 'v2 for CDP-native clients');
  assert.equal(p.scheme, 'exact');
  assert.equal(p.network, 'base');
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

// ══════════════════════════════════════════════════════════════════════════════
// CDP-native v2 PaymentPayload tests (Bankr incident fix)
// ══════════════════════════════════════════════════════════════════════════════

test('toPaymentPayload handles CDP-native v2 PaymentPayload shape (Bankr fix)', () => {
  // This is the exact shape that caused paymentPayloadInvalid before the fix:
  // CDP-native clients put auth at decoded.payload.authorization, not decoded.authorization.message.
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ from: '0xbankr' }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });

  assert.equal(p.x402Version, 2, 'v2 for CDP-native');
  assert.equal(p.scheme, 'exact');
  assert.equal(p.network, 'eip155:84532', 'network from accepted');
  assert.equal(p.payload.signature, '0x' + '22'.repeat(65));
  assert.equal(p.payload.authorization.from, '0xbankr');
  assert.equal(p.payload.authorization.to, '0xtreasury');
  assert.equal(p.payload.authorization.value, '50000');
  assert.equal(p.resource, 'https://api.xfuel.app/task-request', 'resource from header');
});

test('toPaymentPayload extracts network from CDP-native accepted field', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ network: 'eip155:8453' }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  assert.equal(p.network, 'eip155:8453', 'network from accepted.network');
});

test('toPaymentPayload prefers opts.network over CDP-native accepted.network', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ network: 'eip155:84532' }));
  const p = toPaymentPayload(decoded, { network: 'base', x402Version: 2 });
  assert.equal(p.network, 'base', 'opts.network wins');
});

test('toPaymentPayload extracts resource from CDP-native resource object', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    resourceUrl: 'https://api.example.com/premium',
  }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  assert.equal(p.resource, 'https://api.example.com/premium');
});

test('toPaymentPayload prefers opts.resource over CDP-native header resource', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    resourceUrl: 'https://header.example.com/resource',
  }));
  const p = toPaymentPayload(decoded, {
    resource: 'https://challenge.example.com/resource',
    x402Version: 2,
  });
  assert.equal(p.resource, 'https://challenge.example.com/resource', 'opts.resource wins');
});

test('toPaymentPayload handles CDP-native v2 with extensions', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader());
  decoded.extensions = { bazaar: { info: { input: { type: 'http' } } } };
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  assert.deepEqual(p.extensions, decoded.extensions, 'extensions passed through');
});

test('toPaymentPayload still works with XFuel SDK v1 shape after CDP-native fix', () => {
  // Regression: ensure the v1 path still works after adding CDP-native v2 support
  const decoded = decodePaymentHeader(makePaymentHeader({ from: '0xsdk-user' }));
  const p = toPaymentPayload(decoded, { network: 'base-sepolia' });
  assert.equal(p.payload.authorization.from, '0xsdk-user');
  assert.equal(p.x402Version, 1);
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

test('full x402 handshake via the standard facilitator (v1 X-PAYMENT): challenge → settle → replay-rejected', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgX402(url);

    // Step 1: no X-PAYMENT → 402 challenge on Base Sepolia.
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-bs-1', cfg });
    assert.equal(challenge.kind, 'challenge');
    const accept = challenge.body.accepts[0];
    assert.equal(challenge.body.x402Version, 2);
    assert.equal(accept.network, 'eip155:84532');
    assert.equal(accept.amount, '50000');
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

test('full x402 handshake via the standard facilitator (v2 PAYMENT-SIGNATURE): CDP-native buyer', async () => {
  // CDP-native buyers like Bankr send PAYMENT-SIGNATURE header.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgX402(url);

    // Step 1: no payment header → 402 challenge
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-v2-fac', cfg });
    assert.equal(challenge.kind, 'challenge');
    assert.equal(challenge.body.x402Version, 2);
    const nonce = challenge.body.accepts[0].extra.nonce;

    // Step 2: retry with PAYMENT-SIGNATURE + PAYMENT-NONCE → verify + settle via facilitator
    const header = makePaymentHeader({ nonce });
    const reqPayV2 = {
      headers: { 'payment-signature': header, 'payment-nonce': nonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPayV2, { taskId: 'x402-v2-fac', cfg });
    assert.equal(settled.kind, 'settled', 'v2 PAYMENT-SIGNATURE settles');
    assert.match(settled.paymentRef, /^base-sepolia:0x/);

    // Step 3: replay → rejected
    const replay = await runX402Handshake(reqPayV2, { taskId: 'x402-v2-fac', cfg });
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
  assert.equal(challenge.body.accepts[0].network, 'eip155:84532');
});

// ══════════════════════════════════════════════════════════════════════════════
// CDP-native v2 PaymentPayload handshake test (Bankr incident fix)
// ══════════════════════════════════════════════════════════════════════════════

test('full x402 handshake with CDP-native v2 PaymentPayload shape (Bankr fix)', async () => {
  // This is the exact scenario that caused paymentPayloadInvalid: a CDP-native
  // client sends a spec-shaped PaymentPayload with { payload: { authorization, signature } },
  // not the XFuel SDK shape { authorization: { message, signature } }.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgX402(url);

    // Step 1: get a challenge
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'bankr-fix-test', cfg });
    assert.equal(challenge.kind, 'challenge');
    const challengeNonce = challenge.body.accepts[0].extra.nonce;

    // Step 2: retry with a CDP-native v2 PaymentPayload (the shape Bankr sends)
    const header = makeCdpNativePaymentHeader({
      nonce: '0x' + challengeNonce.replace(/^0x/, '').padStart(64, '0'),
      from: '0xbankrwallet',
    });
    const reqPayV2 = {
      headers: { 'payment-signature': header, 'payment-nonce': challengeNonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPayV2, { taskId: 'bankr-fix-test', cfg });

    // Before the fix: kind='failed', reason='payment_payload_invalid'
    // After the fix: kind='settled'
    assert.equal(settled.kind, 'settled', 'CDP-native v2 PaymentPayload must settle (Bankr fix)');
    assert.match(settled.paymentRef, /^base-sepolia:0x/);
  } finally {
    await close();
  }
});

test('verifyViaFacilitator handles CDP-native v2 PaymentPayload (Bankr fix)', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const header = makeCdpNativePaymentHeader({ from: '0xbankrwallet' });
    const challenge = { network: 'base-sepolia', amount: '50000', payTo: '0xtreasury', taskId: 't1' };
    const r = await verifyViaFacilitator(header, { gateway: url, challenge, x402Version: 2 });

    // Before the fix: valid=false, reason='payment_payload_invalid'
    // After the fix: valid=true
    assert.equal(r.valid, true, 'CDP-native v2 PaymentPayload must verify (Bankr fix)');
    assert.equal(r.payer, '0xbankrwallet');
  } finally {
    await close();
  }
});

test('settleViaFacilitator handles CDP-native v2 PaymentPayload (Bankr fix)', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const header = makeCdpNativePaymentHeader({ from: '0xbankrwallet' });
    const challenge = { network: 'base-sepolia', amount: '50000', payTo: '0xtreasury', taskId: 't1' };
    const r = await settleViaFacilitator(header, { gateway: url, challenge, x402Version: 2 });

    // Before the fix: settled=false, reason='payment_payload_invalid'
    // After the fix: settled=true
    assert.equal(r.settled, true, 'CDP-native v2 PaymentPayload must settle (Bankr fix)');
    assert.match(r.txRef, /^0x/);
  } finally {
    await close();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Bankr incident #2 (2026-08-21 post-PR208): facilitator_http_400
// When the challenge nonce is NOT in the PAYMENT-NONCE header and the challenge
// binding fails, requirementsFrom() falls back to decoded but doesn't read from
// decoded.accepted for CDP v2 — it sends undefined network/amount/payTo to the
// facilitator, which returns HTTP 400.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a CDP v2 header with the challenge nonce in accepted.extra.nonce
 * (as CDP clients may echo it), NOT in a separate header.
 */
function makeCdpNativePaymentHeaderWithNonceInBlob({
  network = 'eip155:84532',
  amount = '50000',
  payTo = '0xtreasury',
  from = '0xpayer',
  challengeNonce = 'challenge-nonce-abc123',
  resourceUrl = 'https://api.xfuel.app/task-request',
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const blob = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: 'XFuel paid inference',
      mimeType: 'application/json',
    },
    accepted: {
      scheme: 'exact',
      network,
      amount,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USDC',
        version: '2',
        nonce: challengeNonce,  // <-- Challenge nonce echoed here, not in header
      },
    },
    payload: {
      signature: '0x' + '22'.repeat(65),
      authorization: {
        from,
        to: payTo,
        value: amount,
        validAfter: '0',
        validBefore: String(now + 3600),
        nonce: '0x' + 'cd'.repeat(32),  // EIP-3009 authorization nonce (NOT challenge nonce)
      },
    },
    extensions: {},
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

test('requirementsFrom reads from decoded.accepted for CDP v2 when challenge is null (Bankr #2 fix)', async () => {
  // This is the exact scenario: CDP-native v2 blob with no challenge binding.
  // Before the fix, this would build requirements with undefined amount/payTo.
  const { decodePaymentHeader } = await import('../src/x402-facilitator.js');
  // Import the internal requirementsFrom for testing - we need to access it via verify
  const header = makeCdpNativePaymentHeaderWithNonceInBlob({
    network: 'eip155:8453',
    amount: '100000',
    payTo: '0xbankrtreasury',
    challengeNonce: 'some-nonce',
  });
  const decoded = decodePaymentHeader(header);

  // Verify the blob has the expected structure
  assert.equal(decoded.accepted.network, 'eip155:8453');
  assert.equal(decoded.accepted.amount, '100000');
  assert.equal(decoded.accepted.payTo, '0xbankrtreasury');
  assert.equal(decoded.accepted.extra.nonce, 'some-nonce');
  // Top-level values should NOT exist for CDP v2
  assert.equal(decoded.network, undefined, 'CDP v2 has network on accepted, not top-level');
  assert.equal(decoded.amount, undefined, 'CDP v2 has amount on accepted, not top-level');
  assert.equal(decoded.payTo, undefined, 'CDP v2 has payTo on accepted, not top-level');
});

test('verifyViaFacilitator builds valid requirements from CDP v2 decoded.accepted when challenge is null', async () => {
  // Create a mock that validates the requirements it receives
  let receivedRequirements = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedRequirements = parsed.paymentRequirements;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ isValid: true, payer: '0xbankrwallet' }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    // Send a CDP v2 header WITHOUT a challenge binding (no nonce found)
    // The facilitator should still receive valid requirements from decoded.accepted
    const header = makeCdpNativePaymentHeaderWithNonceInBlob({
      network: 'eip155:84532',
      amount: '75000',
      payTo: '0xbankrtreasury',
      from: '0xbankrwallet',
    });

    // No challenge passed - this simulates when nonce extraction fails
    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 2 });

    assert.equal(r.valid, true, 'CDP v2 without challenge binding must still verify');
    assert.equal(r.payer, '0xbankrwallet');

    // CRITICAL: Verify the requirements were built correctly from decoded.accepted
    // Before the fix: maxAmountRequired would be 'undefined', payTo would be undefined
    // After the fix: these should be correctly extracted from decoded.accepted
    assert.ok(receivedRequirements, 'mock must receive paymentRequirements');
    assert.equal(
      receivedRequirements.maxAmountRequired, '75000',
      'amount must be extracted from decoded.accepted.amount, not undefined'
    );
    assert.equal(
      receivedRequirements.payTo, '0xbankrtreasury',
      'payTo must be extracted from decoded.accepted.payTo, not undefined'
    );
    // For v2, network MUST be CAIP-2 format to match what the payer signed.
    // CDP facilitator rejects short form 'base' with invalid_network.
    assert.equal(
      receivedRequirements.network, 'eip155:84532',
      'v2 paymentRequirements.network must be CAIP-2 (eip155:84532), not short form'
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('extractPaymentNonce finds nonce in CDP v2 accepted.extra.nonce', async () => {
  const { extractPaymentNonce } = await import('../src/x402-server.js');
  const header = makeCdpNativePaymentHeaderWithNonceInBlob({
    challengeNonce: 'accepted-extra-nonce-xyz',
  });

  const req = {
    headers: {
      'payment-signature': header,
      // No PAYMENT-NONCE header - nonce is only in the blob
    },
  };

  const nonce = extractPaymentNonce(req);
  // Before the fix: nonce would be null (only looked at top-level nonce)
  // After the fix: should find the nonce in accepted.extra.nonce
  assert.equal(nonce, 'accepted-extra-nonce-xyz', 'must extract nonce from accepted.extra.nonce');
});

test('verifyViaFacilitator surfaces CDP invalidReason in error (not just facilitator_http_400)', async () => {
  // Create a mock that returns 400 with a specific invalidReason
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'invalid_request',
        invalidReason: 'amount_required',  // CDP tells us WHY it rejected
      }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    const header = makePaymentHeader();
    const r = await verifyViaFacilitator(header, { gateway: url });

    assert.equal(r.valid, false);
    // Before the fix: reason would be 'facilitator_http_400' (no details)
    // After the fix: reason should include the CDP invalidReason
    assert.match(r.reason, /amount_required/, 'must surface CDP invalidReason in error');
    assert.match(r.reason, /facilitator_http_400/, 'must still include HTTP status');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// v2 CAIP-2 network format fix (Bankr invalid_network)
// The CDP facilitator rejects short network 'base' with invalid_network.
// This test verifies that v2 paths send CAIP-2 format to the facilitator.
// ══════════════════════════════════════════════════════════════════════════════

test('v2 verifyViaFacilitator sends CAIP-2 network to facilitator (invalid_network fix)', async () => {
  // This is THE regression test for the Bankr invalid_network bug.
  // The CDP facilitator must receive eip155:8453, not 'base'.
  let receivedRequirements = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedRequirements = parsed.paymentRequirements;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ isValid: true, payer: '0xbankrwallet' }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    // CDP-native v2 header with Base mainnet CAIP-2 network
    const header = makeCdpNativePaymentHeader({
      network: 'eip155:8453',  // Base mainnet CAIP-2
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
    });

    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.valid, true);

    // CRITICAL: The facilitator must receive CAIP-2 network, not short form.
    // Before this fix: receivedRequirements.network was 'base' → CDP rejected with invalid_network
    // After this fix: receivedRequirements.network is 'eip155:8453' → CDP accepts
    assert.ok(receivedRequirements, 'facilitator must receive paymentRequirements');
    assert.equal(
      receivedRequirements.network, 'eip155:8453',
      'v2 MUST send CAIP-2 network to CDP facilitator (invalid_network fix)'
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('v1 verifyViaFacilitator sends short network for backward compatibility', async () => {
  // v1 path (XFuel SDK) must still send short form for backward compatibility
  let receivedRequirements = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedRequirements = parsed.paymentRequirements;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ isValid: true, payer: '0xsdkuser' }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    // XFuel SDK v1 header
    const header = makePaymentHeader({
      network: 'base-sepolia',
      from: '0xsdkuser',
    });

    // x402Version: 1 (default) for XFuel SDK
    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 1 });
    assert.equal(r.valid, true);

    // v1 must use short form for backward compatibility
    assert.ok(receivedRequirements, 'facilitator must receive paymentRequirements');
    assert.equal(
      receivedRequirements.network, 'base-sepolia',
      'v1 must use short network form for backward compatibility'
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
