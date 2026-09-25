/**
 * Paid x402 responses carry the settlement header @x402/fetch decodes
 * (PAYMENT-RESPONSE and X-PAYMENT-RESPONSE), on both Base and Solana.
 * A Solana payment also stamps route_meta.chain_id as solana.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const EVM_PAYER = '0x1234567890123456789012345678901234567890';
const EVM_TX = '0x' + 'ab'.repeat(32);
const SOL_PAYER = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
const SOL_TX = '5'.repeat(87);
const SOL_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/** Same check as @x402/core decodePaymentResponseHeader (regex, then base64 JSON). */
const PAYMENT_RESPONSE_B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodePaymentResponseHeader(header) {
  if (!header || !PAYMENT_RESPONSE_B64.test(header)) {
    throw new Error('Invalid payment response header');
  }
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
}

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.X402_SOLANA_ENABLED = 'true';
process.env.X402_SOLANA_PAY_TO = 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww';
process.env.X402_SOLANA_NETWORK = 'solana';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
delete process.env.M2M_API_KEYS;
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;
delete process.env.OPENAI_GATEWAY_ALLOW_FALLBACK;

function startFacilitator() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      if (req.method !== 'POST') return send(404, { error: 'not_found' });
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad_json' }); }
      const url = req.url || '';
      if (parsed.paymentPayload) {
        const network = String(parsed.paymentRequirements?.network || '');
        const solana = network.startsWith('solana');
        const payer = solana ? SOL_PAYER : EVM_PAYER;
        const transaction = solana ? SOL_TX : EVM_TX;
        if (url.endsWith('/verify')) return send(200, { isValid: true, payer });
        if (url.endsWith('/settle')) {
          return send(200, { success: true, transaction, network, payer });
        }
        return send(404, { error: 'not_found' });
      }
      if (url.endsWith('/verify')) return send(200, { valid: true, txRef: EVM_TX });
      if (url.endsWith('/settle')) return send(200, { settled: true, txRef: EVM_TX });
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const facilitator = await startFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facilitator.url;
process.env.X402_SOLANA_FACILITATOR_URL = facilitator.url;

const { createApp } = await import('../src/server.js');
const { encodeX402PaymentResponseHeader } = await import('../src/x402-adapter.js');
const { toCaip2Network } = await import('../src/x402-facilitator.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { verifyReceiptEcdsaWithJwks, decodeReceiptClaims } = await import('../src/receipt.js');

test('encodeX402PaymentResponseHeader matches the settle-response shape for Base and Solana', () => {
  const baseHeader = encodeX402PaymentResponseHeader({
    ref: `base:${EVM_TX}`,
    payer: EVM_PAYER,
  });
  assert.deepEqual(decodePaymentResponseHeader(baseHeader), {
    success: true,
    transaction: EVM_TX,
    network: 'eip155:8453',
    payer: EVM_PAYER,
  });
  assert.equal(toCaip2Network('base'), 'eip155:8453');

  const solHeader = encodeX402PaymentResponseHeader({
    ref: `solana:${SOL_TX}`,
    network: 'solana',
    payer: SOL_PAYER,
  });
  assert.deepEqual(decodePaymentResponseHeader(solHeader), {
    success: true,
    transaction: SOL_TX,
    network: SOL_CAIP,
    payer: SOL_PAYER,
  });
  assert.equal(encodeX402PaymentResponseHeader({ ref: null }), null);
});

let server;
let base;

const chatBody = {
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 16,
};

before(async () => {
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await facilitator.close();
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function evmPaymentHeader() {
  return Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: { authorization: { from: EVM_PAYER } },
  }), 'utf8').toString('base64');
}

function svmPaymentHeader(nonce) {
  const blob = {
    x402Version: 2,
    resource: { url: `${base}/v1/chat/completions`, mimeType: 'application/json' },
    accepted: {
      scheme: 'exact',
      network: SOL_CAIP,
      amount: '2000',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      payTo: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',
      maxTimeoutSeconds: 60,
      extra: { feePayer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', nonce },
    },
    payload: { transaction: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function assertSettleHeader(res, expected) {
  const header = res.headers.get('payment-response');
  const legacy = res.headers.get('x-payment-response');
  assert.ok(header, 'PAYMENT-RESPONSE is set on a paid response');
  assert.equal(legacy, header, 'X-PAYMENT-RESPONSE matches PAYMENT-RESPONSE');
  assert.deepEqual(decodePaymentResponseHeader(header), expected);
  const expose = res.headers.get('access-control-expose-headers') || '';
  assert.match(expose, /PAYMENT-RESPONSE/);
  assert.match(expose, /X-PAYMENT-RESPONSE/);
}

async function challenge(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.chit402.com',
    },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 402, `${path} unpaid probe must 402`);
  assert.equal(res.headers.get('payment-response'), null);
  return res.json();
}

test('paid POST /v1/chat/completions on Base returns a 200 settlement header', async () => {
  const body = await challenge('/v1/chat/completions', chatBody);
  const nonce = body.accepts[0].extra.nonce;
  assert.equal(body.accepts[0].network, 'eip155:8453');

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.chit402.com',
      'x-payment': evmPaymentHeader(),
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(chatBody),
  });
  const paid = await res.json();
  assert.equal(res.status, 200, JSON.stringify(paid));
  assertSettleHeader(res, {
    success: true,
    transaction: EVM_TX,
    network: 'eip155:8453',
    payer: EVM_PAYER,
  });
  assert.equal(paid.xfuel.route_meta.chain_id, 'base');
  assert.equal(paid.xfuel.payment_meta.network, 'base');
  assert.equal(decodeReceiptClaims(paid.xfuel).payment.ref, `base:${EVM_TX}`);
  assert.equal(verifyReceiptEcdsaWithJwks(paid.xfuel, { keys: [] }).valid, true);
});

test('paid POST /v1/chat/completions on Solana returns a 200 settlement header and solana route_meta', async () => {
  const body = await challenge('/v1/chat/completions', chatBody);
  const solAccept = body.accepts.find((a) => String(a.network).startsWith('solana'));
  assert.ok(solAccept, '402 must advertise Solana');
  const nonce = solAccept.extra.nonce;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.chit402.com',
      'payment-signature': svmPaymentHeader(nonce),
    },
    body: JSON.stringify(chatBody),
  });
  const paid = await res.json();
  assert.equal(res.status, 200, JSON.stringify(paid));
  assertSettleHeader(res, {
    success: true,
    transaction: SOL_TX,
    network: SOL_CAIP,
    payer: SOL_PAYER,
  });
  assert.equal(paid.xfuel.route_meta.chain_id, 'solana');
  assert.equal(paid.xfuel.payment_meta.network, 'solana');
  const claims = decodeReceiptClaims(paid.xfuel);
  assert.equal(claims.payment.ref, `solana:${SOL_TX}`);
  assert.equal(verifyReceiptEcdsaWithJwks(paid.xfuel, { keys: [] }).valid, true);

  const receiptRes = await fetch(`${base}/receipt/${paid.xfuel.task_id}?format=json`);
  assert.equal(receiptRes.status, 200);
  const receipt = await receiptRes.json();
  assert.equal(receipt.route_meta.chain_id, 'solana');
  assert.equal(receipt.payment_meta.network, 'solana');
  assert.equal(receipt.issuer_signature.jws, paid.xfuel.issuer_signature.jws);
  assert.equal(verifyReceiptEcdsaWithJwks(receipt, { keys: [] }).valid, true);
});

test('paid POST /a2a-message and /v1/responses share the settlement header', async () => {
  const a2aChallenge = await challenge('/a2a-message', chatBody);
  const a2a = await fetch(`${base}/a2a-message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.chit402.com',
      'x-payment': evmPaymentHeader(),
      'x-payment-nonce': a2aChallenge.accepts[0].extra.nonce,
    },
    body: JSON.stringify(chatBody),
  });
  const a2aBody = await a2a.json();
  assert.equal(a2a.status, 200, JSON.stringify(a2aBody));
  assertSettleHeader(a2a, {
    success: true,
    transaction: EVM_TX,
    network: 'eip155:8453',
    payer: EVM_PAYER,
  });

  const responsesBody = { model: 'xfuel/auto', input: 'hello', max_output_tokens: 16 };
  const responsesChallenge = await challenge('/v1/responses', responsesBody);
  const responses = await fetch(`${base}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.chit402.com',
      'x-payment': evmPaymentHeader(),
      'x-payment-nonce': responsesChallenge.accepts[0].extra.nonce,
    },
    body: JSON.stringify(responsesBody),
  });
  const responsesPaid = await responses.json();
  assert.equal(responses.status, 200, JSON.stringify(responsesPaid));
  assertSettleHeader(responses, {
    success: true,
    transaction: EVM_TX,
    network: 'eip155:8453',
    payer: EVM_PAYER,
  });
});

test('an authorised unpaid 200 does not claim a settlement', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'partner-key',
    },
    body: JSON.stringify(chatBody),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get('payment-response'), null);
  assert.equal(res.headers.get('x-payment-response'), null);
  assert.equal(body.xfuel.payment_meta.collected, false);
});
