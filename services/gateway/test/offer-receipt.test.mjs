/**
 * x402 Offer and Receipt extension (JWS), spec extension-offer-and-receipt.md @ 6b6ee91.
 *
 * Verifies signed offers for both live accepts[] entries (Base and Solana, the
 * shape of a live 402 body), a receipt, and did:web key resolution against the
 * served /.well-known/did.json. Legacy xfuel.receipt.v4 fields and the existing
 * JWKS verify path stay intact.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'false';

const {
  verifyOfferSignatureJWS,
  verifyReceiptSignatureJWS,
  extractJWSHeader,
  canonicalize,
  extractPublicKeyFromKid,
} = await import('@x402/extensions/offer-receipt');

const {
  buildOfferExtension,
  buildReceiptExtension,
  buildDidDocument,
  jcsCanonicalize,
  didWebFor,
  OFFER_RECEIPT_KEY,
} = await import('../src/offer-receipt.js');
const {
  getIssuerPublicKeyJwk,
  getIssuerKid,
  signJws,
} = await import('../src/issuer-key.js');
const {
  buildPaymentChallenge,
  encodeX402PaymentResponseHeader,
  BAZAAR_EXTENSION_KEY,
  ChallengeStore,
} = await import('../src/x402-adapter.js');
const { buildReceipt, verifyReceiptEcdsaWithJwks, verifyReceiptJwsWithJwks } = await import('../src/receipt.js');

/** Live 402 accepts[] (api.chit402.com /task-request), trimmed to the signed fields. */
const LIVE_RESOURCE = 'https://api.chit402.com/task-request';
const LIVE_EXPIRES_AT_MS = 1790785221128;
const LIVE_ACCEPTS = [
  {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '2000',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payTo: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
    extra: { expiresAt: LIVE_EXPIRES_AT_MS },
  },
  {
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    amount: '2000',
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    payTo: 'ALLdmmAsbUnhHS7x2556449syP5Wz73Gng4gzzLHqsC7',
    extra: { expiresAt: LIVE_EXPIRES_AT_MS },
  },
];

const PAYER = '0xE3AA1174f773Cb266C69e6bE909E9e777B50C87D';
const TX = '0x52bcc587da56ccce2991bdf8b677224a11955899e33e4059d2b0debf3878f68f';

function issuerJwk() {
  const { kid, alg, use, ...jwk } = getIssuerPublicKeyJwk();
  return jwk;
}

function payloadBytes(jws) {
  return Buffer.from(jws.split('.')[1], 'base64url').toString('utf8');
}

test('signJws keeps the chit402 receipt typ and thumbprint kid unless overridden', () => {
  const thumb = getIssuerKid();
  const legacy = signJws({ hello: 'receipt' });
  const header = extractJWSHeader(legacy.jws);
  assert.equal(header.alg, 'ES256');
  assert.equal(header.typ, 'chit402-receipt+jwt');
  assert.equal(header.kid, thumb);
  assert.equal(legacy.kid, thumb);

  const x402 = signJws({ version: 1 }, { typ: null, kid: `did:web:api.chit402.com#${thumb}` });
  const x402Header = extractJWSHeader(x402.jws);
  assert.equal(x402Header.typ, undefined);
  assert.equal(x402Header.alg, 'ES256');
  assert.equal(x402Header.kid, `did:web:api.chit402.com#${thumb}`);
  assert.deepEqual(Object.keys(x402Header), ['alg', 'kid']);
});

test('signed offers for both live accepts[] entries verify and use second validUntil', async () => {
  const ext = buildOfferExtension(LIVE_ACCEPTS, LIVE_RESOURCE, { expiresAtMs: LIVE_EXPIRES_AT_MS });
  assert.equal(ext.info.offers.length, 2);
  const jwk = issuerJwk();
  const expectedUntil = Math.floor(LIVE_EXPIRES_AT_MS / 1000);
  assert.equal(expectedUntil, 1790785221);
  assert.ok(expectedUntil < LIVE_EXPIRES_AT_MS, 'validUntil is seconds, expiresAt stays milliseconds');

  for (const [i, offer] of ext.info.offers.entries()) {
    assert.equal(offer.format, 'jws');
    assert.equal(offer.acceptIndex, i);
    assert.equal(offer.payload, undefined);
    const header = extractJWSHeader(offer.signature);
    assert.equal(header.alg, 'ES256');
    assert.equal(header.typ, undefined);
    assert.equal(header.kid, `${didWebFor(LIVE_RESOURCE)}#${getIssuerKid()}`);
    const raw = payloadBytes(offer.signature);
    const parsed = JSON.parse(raw);
    assert.equal(raw, jcsCanonicalize(parsed));
    assert.equal(raw, canonicalize(parsed));
    assert.equal(parsed.acceptIndex, undefined);
    const verified = await verifyOfferSignatureJWS(offer, jwk);
    assert.equal(verified.version, 1);
    assert.equal(verified.resourceUrl, LIVE_RESOURCE);
    assert.equal(verified.scheme, LIVE_ACCEPTS[i].scheme);
    assert.equal(verified.network, LIVE_ACCEPTS[i].network);
    assert.equal(verified.asset, LIVE_ACCEPTS[i].asset);
    assert.equal(verified.payTo, LIVE_ACCEPTS[i].payTo);
    assert.equal(verified.amount, LIVE_ACCEPTS[i].amount);
    assert.equal(verified.validUntil, expectedUntil);
  }
});

test('buildPaymentChallenge keeps bazaar and adds one offer per accepts[] entry', async () => {
  const store = new ChallengeStore();
  const { body, headers } = buildPaymentChallenge({
    taskId: 'task-offer',
    maxAmountRequired: '2000',
    network: 'base',
    payTo: LIVE_ACCEPTS[0].payTo,
    baseUrl: 'https://api.chit402.com',
    solana: {
      enabled: true,
      payTo: LIVE_ACCEPTS[1].payTo,
      network: 'solana',
    },
  }, { store });

  assert.ok(body.extensions[BAZAAR_EXTENSION_KEY], 'bazaar stays');
  const offers = body.extensions[OFFER_RECEIPT_KEY].info.offers;
  assert.equal(offers.length, body.accepts.length);
  assert.equal(body.accepts.length, 2);
  const decoded = JSON.parse(Buffer.from(headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.equal(decoded.extensions[OFFER_RECEIPT_KEY].info.offers.length, 2);
  assert.ok(decoded.extensions[BAZAAR_EXTENSION_KEY]);

  const jwk = issuerJwk();
  for (const offer of offers) {
    const payload = await verifyOfferSignatureJWS(offer, jwk);
    const accept = body.accepts[offer.acceptIndex];
    assert.equal(payload.network, accept.network);
    assert.equal(payload.amount, accept.amount);
    assert.equal(payload.asset, accept.asset);
    assert.equal(payload.payTo, accept.payTo);
    assert.equal(payload.resourceUrl, 'https://api.chit402.com/task-request');
    assert.equal(payload.validUntil, Math.floor(accept.extra.expiresAt / 1000));
    assert.ok(accept.extra.expiresAt > 1e12, 'accepts extra.expiresAt remains milliseconds');
  }

  const stored = store.get(body.accepts[0].extra.nonce);
  assert.ok(stored.extensions[BAZAAR_EXTENSION_KEY]);
  assert.equal(stored.extensions[OFFER_RECEIPT_KEY], undefined);
});

test('relative resource URL does not throw and still omits extensions when bazaar is off', () => {
  const { body } = buildPaymentChallenge({
    taskId: 'task-rel',
    maxAmountRequired: '2000',
    includeBazaar: false,
  });
  assert.equal(body.resource.url, '/task-request');
  assert.equal(body.extensions.bazaar, undefined);
  assert.equal(body.extensions['offer-receipt'], undefined);
  assert.ok(body.extensions.reviews, 'only the fixed Agorean reviews block remains');
});

test('receipt JWS verifies and the legacy settle fields stay put', async () => {
  const resourceUrl = LIVE_RESOURCE;
  const header = encodeX402PaymentResponseHeader({
    ref: `base:${TX}`,
    payer: PAYER,
    resourceUrl,
  });
  const bare = encodeX402PaymentResponseHeader({
    ref: `base:${TX}`,
    payer: PAYER,
  });
  assert.deepEqual(JSON.parse(Buffer.from(bare, 'base64').toString('utf8')), {
    success: true,
    transaction: TX,
    network: 'eip155:8453',
    payer: PAYER,
  });

  const body = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  assert.equal(body.success, true);
  assert.equal(body.transaction, TX);
  assert.equal(body.network, 'eip155:8453');
  assert.equal(body.payer, PAYER);
  const receipt = body.extensions[OFFER_RECEIPT_KEY].info.receipt;
  assert.equal(receipt.format, 'jws');
  assert.equal(receipt.payload, undefined);
  const payload = await verifyReceiptSignatureJWS(receipt, issuerJwk());
  assert.equal(payload.version, 1);
  assert.equal(payload.network, 'eip155:8453');
  assert.equal(payload.resourceUrl, resourceUrl);
  assert.equal(payload.payer, PAYER);
  assert.equal(payload.transaction, TX);
  assert.equal(typeof payload.issuedAt, 'number');
  assert.ok(payload.issuedAt < 1e11, 'issuedAt is unix seconds');
  const raw = payloadBytes(receipt.signature);
  assert.equal(raw, canonicalize(JSON.parse(raw)));
  assert.equal(extractJWSHeader(receipt.signature).typ, undefined);

  const direct = buildReceiptExtension({
    network: 'eip155:8453',
    resourceUrl,
    payer: PAYER,
    transaction: TX,
    issuedAt: 1789739532,
  });
  const pinned = await verifyReceiptSignatureJWS(direct.info.receipt, issuerJwk());
  assert.equal(pinned.issuedAt, 1789739532);
});

test('legacy xfuel.receipt.v4 schema, verify_url, and JWKS verify still pass', () => {
  const receipt = buildReceipt({
    taskId: 'xfuel-offer-receipt-legacy',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:${TX}`,
      amount: '2000',
      model: 'xfuel/auto',
    },
    feeAmount: '0',
    netAmount: '2000',
    feeBps: 0,
    meta: { provider: 'test' },
    result: { model: 'xfuel/auto', provider: 'test' },
    outputHash: '0x' + 'ab'.repeat(32),
  }, {
    baseUrl: 'https://api.chit402.com',
    signingSecret: 'test-receipt-secret',
    reqHost: 'api.chit402.com',
  });

  assert.equal(receipt.schema, 'xfuel.receipt.v4');
  assert.equal(receipt.verify_url, 'https://api.chit402.com/receipt/chit-offer-receipt-legacy');
  assert.equal(receipt.issuer_signature.alg, 'ES256');
  const header = extractJWSHeader(receipt.issuer_signature.jws);
  assert.equal(header.typ, 'chit402-receipt+jwt');
  assert.equal(header.kid, getIssuerKid());
  assert.equal(header.kid.includes('did:'), false);
  assert.equal(verifyReceiptEcdsaWithJwks(receipt, { keys: [] }).valid, true);
  assert.equal(verifyReceiptJwsWithJwks(receipt, { keys: [] }).valid, true);
  assert.equal(receipt.extensions, undefined);
});

function httpGet(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: host ? { host } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let server;
let port;

before(async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /.well-known/did.json is host-correct for both public hosts', async () => {
  for (const host of ['api.chit402.com', 'api.xfuel.app']) {
    const { status, json } = await httpGet(port, '/.well-known/did.json', host);
    assert.equal(status, 200);
    const expected = buildDidDocument(host);
    assert.deepEqual(json, expected);
    assert.equal(json.id, `did:web:${host}`);
    assert.equal(json.verificationMethod[0].id, `did:web:${host}#${getIssuerKid()}`);
    assert.equal(json.verificationMethod[0].type, 'JsonWebKey2020');
    assert.equal(json.assertionMethod[0], json.verificationMethod[0].id);
    const jwk = getIssuerPublicKeyJwk();
    assert.equal(json.verificationMethod[0].publicKeyJwk.x, jwk.x);
    assert.equal(json.verificationMethod[0].publicKeyJwk.y, jwk.y);
    assert.equal(json.verificationMethod[0].publicKeyJwk.crv, 'P-256');
  }
});

test('reference verifier resolves did:web against the served did.json for offers and a receipt', async () => {
  const localResource = `http://127.0.0.1:${port}/task-request`;
  const offers = buildOfferExtension(LIVE_ACCEPTS, localResource, { expiresAtMs: LIVE_EXPIRES_AT_MS });
  for (const offer of offers.info.offers) {
    const payload = await verifyOfferSignatureJWS(offer);
    assert.equal(payload.resourceUrl, localResource);
    assert.equal(payload.network, LIVE_ACCEPTS[offer.acceptIndex].network);
  }

  const challenge = await httpGet(port, '/task-request', `127.0.0.1:${port}`);
  assert.equal(challenge.status, 402);
  assert.ok(challenge.json.extensions.bazaar);
  const servedOffers = challenge.json.extensions[OFFER_RECEIPT_KEY].info.offers;
  assert.equal(servedOffers.length, challenge.json.accepts.length);
  assert.equal(challenge.json.resource.url, localResource);
  for (const offer of servedOffers) {
    const payload = await verifyOfferSignatureJWS(offer);
    const accept = challenge.json.accepts[offer.acceptIndex];
    assert.equal(payload.network, accept.network);
    assert.equal(payload.payTo, accept.payTo);
    assert.equal(payload.amount, accept.amount);
  }

  const receiptExt = buildReceiptExtension({
    network: 'eip155:8453',
    resourceUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
    payer: PAYER,
    transaction: TX,
    issuedAt: 1789739532,
  });
  const resolvedKey = await extractPublicKeyFromKid(extractJWSHeader(receiptExt.info.receipt.signature).kid);
  assert.ok(resolvedKey);
  const receiptPayload = await verifyReceiptSignatureJWS(receiptExt.info.receipt);
  assert.equal(receiptPayload.payer, PAYER);
  assert.equal(receiptPayload.transaction, TX);
  assert.equal(receiptPayload.issuedAt, 1789739532);
  assert.equal(receiptPayload.resourceUrl, `http://127.0.0.1:${port}/v1/chat/completions`);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url);
    if (parsed.pathname === '/.well-known/did.json'
      && (parsed.hostname === 'api.chit402.com' || parsed.hostname === 'api.xfuel.app')) {
      const served = await httpGet(port, '/.well-known/did.json', parsed.host);
      return new Response(JSON.stringify(served.json), {
        status: served.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };
  try {
    for (const host of ['api.chit402.com', 'api.xfuel.app']) {
      const resourceUrl = `https://${host}/task-request`;
      const ext = buildOfferExtension(LIVE_ACCEPTS, resourceUrl, { expiresAtMs: LIVE_EXPIRES_AT_MS });
      const evm = await verifyOfferSignatureJWS(ext.info.offers[0]);
      const svm = await verifyOfferSignatureJWS(ext.info.offers[1]);
      assert.equal(evm.network, 'eip155:8453');
      assert.equal(svm.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      assert.equal(evm.resourceUrl, resourceUrl);
      assert.equal(extractJWSHeader(ext.info.offers[0].signature).kid, `did:web:${host}#${getIssuerKid()}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
