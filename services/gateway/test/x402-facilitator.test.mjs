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
  // v2 uses `amount`, not `maxAmountRequired` (per x402 spec section 5.1.2)
  assert.equal(r.amount, '50000', 'v2 must use `amount` field');
  assert.equal(r.maxAmountRequired, undefined, 'v2 must NOT have maxAmountRequired');
});

test('toPaymentRequirements v2 converts short form to CAIP-2', () => {
  // Even if the input is short form, v2 must emit CAIP-2
  const r = toPaymentRequirements({
    network: 'base', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 2,
  });
  assert.equal(r.network, 'eip155:8453', 'v2 converts short form to CAIP-2');
  assert.equal(r.amount, '50000', 'v2 uses `amount`');
  assert.equal(r.maxAmountRequired, undefined, 'v2 does NOT have maxAmountRequired');
});

test('toPaymentRequirements v2 handles Base Sepolia CAIP-2', () => {
  const r = toPaymentRequirements({
    network: 'eip155:84532', amount: '50000', payTo: '0xtreasury', taskId: 't1',
    x402Version: 2,
  });
  assert.equal(r.network, 'eip155:84532', 'v2 preserves Base Sepolia CAIP-2');
  assert.equal(r.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'Base Sepolia USDC');
  assert.equal(r.amount, '50000', 'v2 uses `amount`');
  assert.equal(r.maxAmountRequired, undefined, 'v2 does NOT have maxAmountRequired');
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

test('toPaymentPayload uses x402Version: 2 for XFuel SDK blob with v2 flag (v1 shape, v2 wire)', () => {
  // XFuel SDK v1 blob reshaped for v2 wire format (keeps top-level scheme/network).
  // This is NOT the same as a CDP-native v2 blob (which has `accepted`).
  const decoded = decodePaymentHeader(makePaymentHeader());
  const p = toPaymentPayload(decoded, { network: 'base', x402Version: 2 });
  assert.equal(p.x402Version, 2, 'v2 for wire format');
  // v1 SDK blobs don't have `accepted`, so the v1 reshape path is used.
  assert.equal(p.scheme, 'exact', 'v1 SDK blob → top-level scheme');
  assert.equal(p.network, 'base', 'v1 SDK blob → top-level network');
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

test('toPaymentPayload handles CDP-native v2 PaymentPayload shape (Bankr fix, schema fix)', () => {
  // CDP-native v2: must preserve the spec shape with `accepted` at top level.
  // CDP's /verify schema REJECTS payloads with top-level scheme/network (v1 shape).
  // Per https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md:
  //   PaymentPayload = { x402Version, accepted, payload, resource?, extensions? }
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ from: '0xbankr' }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });

  assert.equal(p.x402Version, 2, 'v2 for CDP-native');

  // CRITICAL: CDP v2 requires `accepted` at top level, NOT top-level scheme/network.
  // Before this fix: p.scheme='exact', p.network='eip155:84532' → CDP rejected with schema error.
  // After this fix: p.accepted.scheme='exact', p.accepted.network='eip155:84532' → CDP accepts.
  assert.equal(p.scheme, undefined, 'CDP v2 must NOT have top-level scheme');
  assert.equal(p.network, undefined, 'CDP v2 must NOT have top-level network');
  assert.ok(p.accepted, 'CDP v2 must have `accepted` field');
  assert.equal(p.accepted.scheme, 'exact', 'scheme in accepted');
  assert.equal(p.accepted.network, 'eip155:84532', 'network in accepted');

  // Payload preserved from header
  assert.equal(p.payload.signature, '0x' + '22'.repeat(65));
  assert.equal(p.payload.authorization.from, '0xbankr');
  assert.equal(p.payload.authorization.to, '0xtreasury');
  assert.equal(p.payload.authorization.value, '50000');

  // Resource as object for v2
  assert.equal(p.resource.url, 'https://api.xfuel.app/task-request', 'resource.url from header');
});

test('toPaymentPayload preserves network in CDP-native accepted field', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ network: 'eip155:8453' }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  // CDP v2: network stays in accepted, NOT at top level
  assert.equal(p.network, undefined, 'no top-level network for CDP v2');
  assert.equal(p.accepted.network, 'eip155:8453', 'network in accepted');
});

test('toPaymentPayload merges opts.network into CDP-native accepted', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({ network: 'eip155:84532' }));
  const p = toPaymentPayload(decoded, { network: 'eip155:8453', x402Version: 2 });
  // CDP v2: opts.network overrides accepted.network but stays in accepted
  assert.equal(p.network, undefined, 'no top-level network for CDP v2');
  assert.equal(p.accepted.network, 'eip155:8453', 'opts.network merged into accepted');
});

test('toPaymentPayload extracts resource from CDP-native resource object', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    resourceUrl: 'https://api.example.com/premium',
  }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  // CDP v2: resource is an object with url property
  assert.equal(p.resource.url, 'https://api.example.com/premium');
});

test('toPaymentPayload prefers opts.resource over CDP-native header resource', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    resourceUrl: 'https://header.example.com/resource',
  }));
  const p = toPaymentPayload(decoded, {
    resource: 'https://challenge.example.com/resource',
    x402Version: 2,
  });
  // CDP v2: resource is an object, opts.resource URL takes precedence
  assert.equal(p.resource.url, 'https://challenge.example.com/resource', 'opts.resource wins');
});

test('toPaymentPayload handles CDP-native v2 with extensions', () => {
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader());
  decoded.extensions = { bazaar: { info: { input: { type: 'http' } } } };
  const p = toPaymentPayload(decoded, { x402Version: 2 });
  assert.deepEqual(p.extensions, decoded.extensions, 'extensions passed through');
});

// ══════════════════════════════════════════════════════════════════════════════
// CDP v2 PaymentPayload schema validation (Bankr paymentPayload schema error fix)
// CDP's /verify endpoint returns 400 'paymentPayload'_is_invalid when it receives
// a payload with top-level scheme/network instead of the spec-required `accepted` field.
// ══════════════════════════════════════════════════════════════════════════════

test('CDP-native v2 paymentPayload has correct schema for CDP /verify (no top-level scheme/network)', () => {
  // This is THE regression test for the paymentPayload schema error:
  //   400 'paymentPayload'_is_invalid:_must_match_one_of_[x402V2PaymentPayload...
  //
  // Per https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md:
  // v2 PaymentPayload REQUIRED fields: x402Version, accepted, payload
  // v2 PaymentPayload OPTIONAL fields: resource, extensions
  // v2 PaymentPayload does NOT have top-level scheme or network.
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    network: 'eip155:8453',
    amount: '100000',
    payTo: '0xtreasury',
    from: '0xbankrwallet',
  }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });

  // Schema validation: required fields present
  assert.equal(p.x402Version, 2, 'x402Version required');
  assert.ok(p.accepted, 'accepted field required for CDP v2');
  assert.ok(p.payload, 'payload field required');

  // Schema validation: scheme/network MUST NOT be at top level
  assert.strictEqual(p.scheme, undefined, 'top-level scheme breaks CDP v2 schema');
  assert.strictEqual(p.network, undefined, 'top-level network breaks CDP v2 schema');

  // Schema validation: scheme/network live INSIDE accepted
  assert.equal(p.accepted.scheme, 'exact');
  assert.equal(p.accepted.network, 'eip155:8453');
  assert.equal(p.accepted.amount, '100000');
  assert.equal(p.accepted.payTo, '0xtreasury');

  // payload preserved from header (spec shape)
  assert.equal(p.payload.signature, '0x' + '22'.repeat(65));
  assert.equal(p.payload.authorization.from, '0xbankrwallet');
});

test('CDP-native v2 paymentPayload resource is object (not string) per CDP v2 schema', () => {
  // CDP v2 schema expects resource as { url, description?, mimeType? }, not string.
  const decoded = decodePaymentHeader(makeCdpNativePaymentHeader({
    resourceUrl: 'https://api.xfuel.app/task-request',
  }));
  const p = toPaymentPayload(decoded, { x402Version: 2 });

  assert.equal(typeof p.resource, 'object', 'resource must be object for CDP v2');
  assert.equal(p.resource.url, 'https://api.xfuel.app/task-request');
  assert.equal(p.resource.description, 'XFuel paid inference', 'description from header');
  assert.equal(p.resource.mimeType, 'application/json', 'mimeType from header');
});

test('toPaymentPayload still works with XFuel SDK v1 shape after CDP-native fix', () => {
  // Regression: ensure the v1 path still works after adding CDP-native v2 support
  const decoded = decodePaymentHeader(makePaymentHeader({ from: '0xsdk-user' }));
  const p = toPaymentPayload(decoded, { network: 'base-sepolia' });
  assert.equal(p.payload.authorization.from, '0xsdk-user');
  assert.equal(p.x402Version, 1);
});

test('XFuel SDK v1 paymentPayload has top-level scheme/network (NOT accepted) for ZAN/testnet', () => {
  // XFuel SDK v1 / ZAN path uses top-level scheme/network (different from CDP v2).
  // This is the legacy shape the testnet facilitator and ZAN adapter expect.
  const decoded = decodePaymentHeader(makePaymentHeader({
    network: 'base-sepolia',
    amount: '50000',
    payTo: '0xtreasury',
    from: '0xsdk-user',
  }));
  const p = toPaymentPayload(decoded, { network: 'base-sepolia' });

  // v1 schema: top-level scheme/network (NOT in accepted)
  assert.equal(p.x402Version, 1);
  assert.equal(p.scheme, 'exact', 'v1 has top-level scheme');
  assert.equal(p.network, 'base-sepolia', 'v1 has top-level network');
  assert.equal(p.accepted, undefined, 'v1 does NOT have accepted field');

  // payload reshaped from SDK authorization
  assert.equal(p.payload.authorization.from, '0xsdk-user');
  assert.equal(p.payload.authorization.to, '0xtreasury');
});

// ══════════════════════════════════════════════════════════════════════════════
// Bankr fat accepted slimming fix (2026-08-21 PR: invalid_payload on CDP /verify)
// CDP-native clients echo the 402 accepts[0] verbatim into their PaymentPayload.
// Our 402 includes challenge-binding fields CDP rejects: maxAmountRequired,
// extra.taskId, extra.expiresAt, extra.nonce. toPaymentPayload must slim these.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a Bankr-shaped CDP v2 header that echoes our fat 402 accepts[0] verbatim.
 * This is what causes CDP to return `invalid_payload` — extra fields it doesn't expect.
 */
function makeBankrFatAcceptedHeader({
  network = 'eip155:8453',
  amount = '100000',
  payTo = '0xtreasury',
  from = '0xbankrwallet',
  challengeNonce = '0x' + 'ab'.repeat(32),  // Our EIP-3009 bytes32 challenge nonce
  resourceUrl = 'https://api.xfuel.app/task-request',
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  // This is what Bankr sends: echoes our 402 accepts[0] into accepted, including
  // the fields CDP doesn't want: maxAmountRequired, extra.taskId, extra.expiresAt, extra.nonce
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
      // FAT FIELD 1: maxAmountRequired (v1 compat, CDP v2 rejects)
      maxAmountRequired: amount,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo,
      maxTimeoutSeconds: 120,
      extra: {
        name: 'USD Coin',
        version: '2',
        // FAT FIELD 2: taskId (challenge binding, CDP rejects)
        taskId: 'task-bankr-123',
        // FAT FIELD 3: expiresAt (challenge binding, CDP rejects)
        expiresAt: now + 120000,
        // FAT FIELD 4: nonce (challenge binding, CDP rejects)
        nonce: challengeNonce,
      },
    },
    payload: {
      signature: '0x' + '33'.repeat(65),
      authorization: {
        from,
        to: payTo,
        value: amount,
        validAfter: '0',
        validBefore: String(now + 3600),
        nonce: '0x' + 'cd'.repeat(32),  // Authorization nonce (different from challenge nonce)
      },
    },
    extensions: {},
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

test('toPaymentPayload slims Bankr fat accepted to spec fields only (invalid_payload fix)', () => {
  // This is THE regression test for the Bankr invalid_payload error.
  // Bankr echoes our 402 accepts[0] into accepted, including fields CDP rejects:
  //   - maxAmountRequired (v1 compat)
  //   - extra.taskId, extra.expiresAt, extra.nonce (challenge binding)
  // toPaymentPayload must slim these before sending to CDP /verify.
  const decoded = decodePaymentHeader(makeBankrFatAcceptedHeader({
    network: 'eip155:8453',
    amount: '100000',
    payTo: '0xtreasury',
    challengeNonce: '0x' + 'ab'.repeat(32),
  }));

  // Verify the header has the fat fields
  assert.equal(decoded.accepted.maxAmountRequired, '100000', 'header has maxAmountRequired');
  assert.equal(decoded.accepted.extra.taskId, 'task-bankr-123', 'header has extra.taskId');
  assert.ok(decoded.accepted.extra.expiresAt, 'header has extra.expiresAt');
  assert.equal(decoded.accepted.extra.nonce, '0x' + 'ab'.repeat(32), 'header has extra.nonce');

  const p = toPaymentPayload(decoded, { x402Version: 2 });

  // CRITICAL: Verify fat fields are removed
  assert.strictEqual(p.accepted.maxAmountRequired, undefined,
    'maxAmountRequired must be stripped for CDP v2');
  assert.strictEqual(p.accepted.extra.taskId, undefined,
    'extra.taskId must be stripped (challenge binding)');
  assert.strictEqual(p.accepted.extra.expiresAt, undefined,
    'extra.expiresAt must be stripped (challenge binding)');
  assert.strictEqual(p.accepted.extra.nonce, undefined,
    'extra.nonce must be stripped (challenge binding stays in our store)');

  // Verify spec fields are preserved
  assert.equal(p.accepted.scheme, 'exact', 'scheme preserved');
  assert.equal(p.accepted.network, 'eip155:8453', 'network preserved');
  assert.equal(p.accepted.amount, '100000', 'amount preserved');
  assert.equal(p.accepted.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'asset preserved');
  assert.equal(p.accepted.payTo, '0xtreasury', 'payTo preserved');
  assert.equal(p.accepted.maxTimeoutSeconds, 120, 'maxTimeoutSeconds preserved');

  // Verify EIP-712 domain extra fields are preserved
  assert.equal(p.accepted.extra.name, 'USD Coin', 'extra.name (EIP-712) preserved');
  assert.equal(p.accepted.extra.version, '2', 'extra.version (EIP-712) preserved');

  // Verify only allowed keys exist on accepted
  const allowedAcceptedKeys = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'];
  for (const key of Object.keys(p.accepted)) {
    assert.ok(allowedAcceptedKeys.includes(key), `accepted should not have key: ${key}`);
  }

  // Verify only allowed keys exist on extra
  const allowedExtraKeys = ['name', 'version'];
  for (const key of Object.keys(p.accepted.extra)) {
    assert.ok(allowedExtraKeys.includes(key), `extra should not have key: ${key}`);
  }
});

test('v2 verifyViaFacilitator slims Bankr fat accepted before sending to facilitator', async () => {
  // Integration test: verify the slimmed accepted is actually sent to the facilitator.
  let receivedPayload = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedPayload = parsed.paymentPayload;
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
    // Bankr-shaped header with fat accepted
    const header = makeBankrFatAcceptedHeader({
      network: 'eip155:8453',
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
    });

    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.valid, true, 'Bankr fat accepted must verify after slimming');

    // Verify the fat fields were stripped before sending
    assert.ok(receivedPayload, 'facilitator must receive paymentPayload');
    assert.ok(receivedPayload.accepted, 'paymentPayload.accepted required');

    // Fat fields must be stripped
    assert.strictEqual(receivedPayload.accepted.maxAmountRequired, undefined,
      'maxAmountRequired must not reach facilitator');
    assert.strictEqual(receivedPayload.accepted.extra.taskId, undefined,
      'extra.taskId must not reach facilitator');
    assert.strictEqual(receivedPayload.accepted.extra.expiresAt, undefined,
      'extra.expiresAt must not reach facilitator');
    assert.strictEqual(receivedPayload.accepted.extra.nonce, undefined,
      'extra.nonce must not reach facilitator');

    // Spec fields must be preserved
    assert.equal(receivedPayload.accepted.amount, '100000');
    assert.equal(receivedPayload.accepted.extra.name, 'USD Coin');
    assert.equal(receivedPayload.accepted.extra.version, '2');
  } finally {
    await new Promise((r) => server.close(r));
  }
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
    // Before the fix: amount field would be missing (v1 uses maxAmountRequired), payTo undefined
    // After the fix: v2 uses `amount` and values are correctly extracted from decoded.accepted
    assert.ok(receivedRequirements, 'mock must receive paymentRequirements');
    // v2 uses `amount`, NOT `maxAmountRequired` (per x402 spec section 5.1.2)
    assert.equal(
      receivedRequirements.amount, '75000',
      'v2 must use `amount` field extracted from decoded.accepted.amount'
    );
    assert.equal(
      receivedRequirements.maxAmountRequired, undefined,
      'v2 must NOT have maxAmountRequired (v1-only field)'
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
    // v2 does NOT have v1 discovery fields
    assert.equal(receivedRequirements.resource, undefined, 'v2 has no resource');
    assert.equal(receivedRequirements.description, undefined, 'v2 has no description');
    assert.equal(receivedRequirements.mimeType, undefined, 'v2 has no mimeType');
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

// ══════════════════════════════════════════════════════════════════════════════
// CDP paymentPayload schema fix (Bankr schema error: 'paymentPayload'_is_invalid)
// CDP's /verify endpoint returns 400 schema error when paymentPayload has
// top-level scheme/network instead of the spec-required `accepted` field.
// This is THE regression test proving the fix works.
// ══════════════════════════════════════════════════════════════════════════════

test('verifyViaFacilitator sends CDP v2 paymentPayload with accepted field (schema fix)', async () => {
  // This is THE regression test for the paymentPayload schema error:
  //   400 'paymentPayload'_is_invalid:_must_match_one_of_[x402V2PaymentPayload...
  //
  // Before this fix: paymentPayload had top-level scheme/network → CDP rejected
  // After this fix: paymentPayload has `accepted` field → CDP accepts
  let receivedPayload = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedPayload = parsed.paymentPayload;
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
    // CDP-native v2 header (the shape Bankr sends)
    const header = makeCdpNativePaymentHeader({
      network: 'eip155:8453',
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
    });

    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.valid, true);

    // CRITICAL: Verify the paymentPayload has the correct CDP v2 schema.
    // This is what was broken - we were sending top-level scheme/network.
    assert.ok(receivedPayload, 'facilitator must receive paymentPayload');
    assert.equal(receivedPayload.x402Version, 2, 'x402Version required');

    // CDP v2 schema: `accepted` field REQUIRED, top-level scheme/network FORBIDDEN
    assert.ok(receivedPayload.accepted, 'CDP v2 paymentPayload MUST have accepted field');
    assert.strictEqual(
      receivedPayload.scheme, undefined,
      'CDP v2 paymentPayload MUST NOT have top-level scheme (causes schema error)'
    );
    assert.strictEqual(
      receivedPayload.network, undefined,
      'CDP v2 paymentPayload MUST NOT have top-level network (causes schema error)'
    );

    // Verify accepted contains the correct values
    assert.equal(receivedPayload.accepted.scheme, 'exact');
    assert.equal(receivedPayload.accepted.network, 'eip155:8453');
    assert.equal(receivedPayload.accepted.amount, '100000');
    assert.equal(receivedPayload.accepted.payTo, '0xtreasury');

    // Verify payload is preserved (signature + authorization)
    assert.ok(receivedPayload.payload, 'paymentPayload.payload required');
    assert.equal(receivedPayload.payload.authorization.from, '0xbankrwallet');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('settleViaFacilitator sends CDP v2 paymentPayload with accepted field (schema fix)', async () => {
  // Same schema validation for settle path
  let receivedPayload = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedPayload = parsed.paymentPayload;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, transaction: '0x123abc', payer: '0xbankrwallet' }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    const header = makeCdpNativePaymentHeader({
      network: 'eip155:8453',
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
    });

    const r = await settleViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.settled, true);

    // CDP v2 schema validation on settle path
    assert.ok(receivedPayload, 'facilitator must receive paymentPayload');
    assert.ok(receivedPayload.accepted, 'CDP v2 paymentPayload MUST have accepted field');
    assert.strictEqual(receivedPayload.scheme, undefined, 'no top-level scheme');
    assert.strictEqual(receivedPayload.network, undefined, 'no top-level network');
    assert.equal(receivedPayload.accepted.network, 'eip155:8453');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('XFuel SDK v1 paymentPayload still uses top-level scheme/network for ZAN/testnet', async () => {
  // v1 SDK path must NOT change - it uses top-level scheme/network for backward compat.
  let receivedPayload = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      receivedPayload = parsed.paymentPayload;
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
    // XFuel SDK v1 header (NOT CDP-native)
    const header = makePaymentHeader({
      network: 'base-sepolia',
      from: '0xsdkuser',
    });

    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 1 });
    assert.equal(r.valid, true);

    // v1 SDK: top-level scheme/network for backward compatibility
    assert.ok(receivedPayload, 'facilitator must receive paymentPayload');
    assert.equal(receivedPayload.scheme, 'exact', 'v1 has top-level scheme');
    assert.equal(receivedPayload.network, 'base-sepolia', 'v1 has top-level network');
    assert.equal(receivedPayload.accepted, undefined, 'v1 does NOT have accepted field');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// v2 PaymentRequirements shape fix (PR 212 — Bankr 'paymentRequirements' is invalid)
// CDP's /verify endpoint returns 400 when paymentRequirements has v1 fields:
//   'paymentRequirements'_is_invalid:_must_match_one_of_...
// v2 uses `amount` (not maxAmountRequired) and omits resource/description/mimeType.
// ══════════════════════════════════════════════════════════════════════════════

test('toPaymentRequirements v2 has spec-compliant shape (amount, no v1 discovery fields)', () => {
  // This is THE unit test for the paymentRequirements v2 shape fix.
  // Per https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md 5.1.2/7.1:
  //   v2 PaymentRequirements REQUIRED: scheme, network (CAIP-2), amount, asset, payTo, maxTimeoutSeconds
  //   v2 PaymentRequirements OPTIONAL: extra (for EIP-712 domain)
  //   v2 does NOT have: maxAmountRequired, resource, description, mimeType, outputSchema
  const r = toPaymentRequirements({
    network: 'eip155:8453',
    amount: '100000',
    payTo: '0xtreasury',
    resource: 'https://api.xfuel.app/task-request',  // v1-only, should be ignored for v2
    taskId: 't1',
    description: 'Some task',  // v1-only, should be ignored for v2
    outputSchema: { input: {} },  // v1-only, should be ignored for v2
    x402Version: 2,
  });

  // v2 REQUIRED fields
  assert.equal(r.scheme, 'exact', 'v2 has scheme');
  assert.equal(r.network, 'eip155:8453', 'v2 uses CAIP-2 network');
  assert.equal(r.amount, '100000', 'v2 uses `amount` field');
  assert.equal(r.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'v2 has asset');
  assert.equal(r.payTo, '0xtreasury', 'v2 has payTo');
  assert.equal(typeof r.maxTimeoutSeconds, 'number', 'v2 has maxTimeoutSeconds');
  assert.deepEqual(r.extra, { name: 'USD Coin', version: '2' }, 'v2 has EIP-712 domain in extra');

  // v2 does NOT have v1 fields (they should be undefined, not present)
  assert.strictEqual(r.maxAmountRequired, undefined, 'v2 must NOT have maxAmountRequired');
  assert.strictEqual(r.resource, undefined, 'v2 must NOT have resource');
  assert.strictEqual(r.description, undefined, 'v2 must NOT have description');
  assert.strictEqual(r.mimeType, undefined, 'v2 must NOT have mimeType');
  assert.strictEqual(r.outputSchema, undefined, 'v2 must NOT have outputSchema');

  // Verify no extra keys exist
  const allowedKeys = ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'];
  const actualKeys = Object.keys(r);
  for (const key of actualKeys) {
    assert.ok(allowedKeys.includes(key), `v2 PaymentRequirements should not have key: ${key}`);
  }
});

test('toPaymentRequirements v1 still has discovery fields for backward compatibility', () => {
  // v1 (XFuel SDK / ZAN) keeps maxAmountRequired, resource, description, mimeType
  const r = toPaymentRequirements({
    network: 'base-sepolia',
    amount: '50000',
    payTo: '0xtreasury',
    resource: 'https://api.xfuel.app/task-request',
    taskId: 't1',
    description: 'Some task',
    x402Version: 1,
  });

  // v1 has maxAmountRequired (NOT amount)
  assert.equal(r.maxAmountRequired, '50000', 'v1 uses maxAmountRequired');
  assert.strictEqual(r.amount, undefined, 'v1 does NOT have `amount` field');

  // v1 has discovery fields
  assert.equal(r.resource, 'https://api.xfuel.app/task-request', 'v1 has resource');
  assert.equal(r.description, 'Some task', 'v1 has description');
  assert.equal(r.mimeType, 'application/json', 'v1 has mimeType');

  // v1 uses short network form
  assert.equal(r.network, 'base-sepolia', 'v1 uses short network form');
});

test('v2 verifyViaFacilitator sends spec-compliant paymentRequirements (amount, no v1 fields)', async () => {
  // This is THE integration test for the paymentRequirements v2 shape fix.
  // The body posted to CDP /verify must have v2 paymentRequirements (amount, no maxAmountRequired).
  // Before this fix: CDP rejected with 'paymentRequirements'_is_invalid because we sent maxAmountRequired.
  let receivedBody = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      receivedBody = JSON.parse(body);
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
    // Bankr-shaped CDP-native v2 PAYMENT-SIGNATURE header
    const header = makeCdpNativePaymentHeader({
      network: 'eip155:8453',
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
      resourceUrl: 'https://api.xfuel.app/v1/chat/completions',
    });

    const r = await verifyViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.valid, true, 'v2 must verify');

    // Verify the FULL body posted to the facilitator
    assert.ok(receivedBody, 'facilitator must receive body');
    assert.equal(receivedBody.x402Version, 2, 'body.x402Version = 2');

    // paymentPayload: v2 spec shape with `accepted` (already fixed in PR 211)
    const pp = receivedBody.paymentPayload;
    assert.ok(pp, 'body.paymentPayload required');
    assert.ok(pp.accepted, 'paymentPayload.accepted required for v2');
    assert.strictEqual(pp.scheme, undefined, 'paymentPayload must NOT have top-level scheme');
    assert.strictEqual(pp.network, undefined, 'paymentPayload must NOT have top-level network');

    // paymentRequirements: v2 spec shape with `amount` (THIS PR's fix)
    const pr = receivedBody.paymentRequirements;
    assert.ok(pr, 'body.paymentRequirements required');
    assert.equal(pr.scheme, 'exact', 'paymentRequirements.scheme');
    assert.equal(pr.network, 'eip155:8453', 'paymentRequirements.network (CAIP-2)');
    assert.equal(pr.amount, '100000', 'paymentRequirements.amount (v2 field)');
    assert.equal(pr.payTo, '0xtreasury', 'paymentRequirements.payTo');

    // v2 does NOT have v1 fields
    assert.strictEqual(pr.maxAmountRequired, undefined, 'v2 must NOT have maxAmountRequired');
    assert.strictEqual(pr.resource, undefined, 'v2 must NOT have resource');
    assert.strictEqual(pr.description, undefined, 'v2 must NOT have description');
    assert.strictEqual(pr.mimeType, undefined, 'v2 must NOT have mimeType');
    assert.strictEqual(pr.outputSchema, undefined, 'v2 must NOT have outputSchema');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('v2 settleViaFacilitator sends spec-compliant paymentRequirements (amount, no v1 fields)', async () => {
  // Same validation for the settle path
  let receivedBody = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, transaction: '0x123abc', payer: '0xbankrwallet' }));
    });
  });
  const url = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });

  try {
    const header = makeCdpNativePaymentHeader({
      network: 'eip155:8453',
      amount: '100000',
      payTo: '0xtreasury',
      from: '0xbankrwallet',
    });

    const r = await settleViaFacilitator(header, { gateway: url, x402Version: 2 });
    assert.equal(r.settled, true, 'v2 must settle');

    // paymentRequirements: v2 spec shape
    const pr = receivedBody.paymentRequirements;
    assert.ok(pr, 'body.paymentRequirements required');
    assert.equal(pr.amount, '100000', 'paymentRequirements.amount (v2 field)');
    assert.strictEqual(pr.maxAmountRequired, undefined, 'v2 must NOT have maxAmountRequired');
    assert.strictEqual(pr.resource, undefined, 'v2 must NOT have resource');
    assert.strictEqual(pr.description, undefined, 'v2 must NOT have description');
    assert.strictEqual(pr.mimeType, undefined, 'v2 must NOT have mimeType');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('v1 verifyViaFacilitator sends legacy paymentRequirements (maxAmountRequired, discovery fields)', async () => {
  // v1 path must NOT change - it uses maxAmountRequired and discovery fields for backward compat.
  let receivedBody = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      receivedBody = JSON.parse(body);
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
    const challenge = {
      network: 'base-sepolia',
      amount: '50000',
      payTo: '0xtreasury',
      taskId: 't1',
      resource: 'https://api.xfuel.app/task-request',
      description: 'XFuel task',
    };

    const r = await verifyViaFacilitator(header, { gateway: url, challenge, x402Version: 1 });
    assert.equal(r.valid, true);

    // paymentRequirements: v1 shape (backward compatibility)
    const pr = receivedBody.paymentRequirements;
    assert.ok(pr, 'body.paymentRequirements required');
    assert.equal(pr.maxAmountRequired, '50000', 'v1 uses maxAmountRequired');
    assert.strictEqual(pr.amount, undefined, 'v1 does NOT have `amount` field');
    assert.equal(pr.resource, 'https://api.xfuel.app/task-request', 'v1 has resource');
    assert.equal(pr.description, 'XFuel task', 'v1 has description');
    assert.equal(pr.mimeType, 'application/json', 'v1 has mimeType');
    assert.equal(pr.network, 'base-sepolia', 'v1 uses short network form');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
