/**
 * Paid register never settles a payment it will refuse.
 * The 402 offers Base only. A Solana payload and an EVM payload from
 * another address are rejected before the facilitator verify/settle.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Wallet } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.X402_ENABLED = 'true';
process.env.X402_NETWORK = 'base';
process.env.X402_PAY_TO = '0x1111111111111111111111111111111111111111';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'x402';
process.env.X402_SOLANA_ENABLED = 'true';
process.env.X402_SOLANA_PAY_TO = 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww';
process.env.X402_SOLANA_NETWORK = 'solana';
process.env.RECEIPT_SIGNING_SECRET = 'register-rail-test';
delete process.env.M2M_API_KEYS;

const hits = { verify: 0, settle: 0 };

function startFacilitator() {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.endsWith('/verify')) hits.verify += 1;
    if (url.endsWith('/settle')) hits.settle += 1;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ isValid: true, success: true, settled: true, transaction: '0x' + 'ab'.repeat(32), payer: '0x' + '22'.repeat(20) }));
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

const fac = await startFacilitator();
process.env.X402_FACILITATOR_URL = fac.url;

const { installEchoChainReader } = await import('../src/x402-chain.js');
installEchoChainReader();

const { createApp } = await import('../src/server.js');
const { canonicalRegisterPayMessage } = await import('../src/agent-registry.js');

const SOL_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

function paymentHeader(blob) {
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await fac.close();
});

async function signedBody(wallet) {
  const timestamp = Math.floor(Date.now() / 1000);
  const wallet_signature = await wallet.signMessage(canonicalRegisterPayMessage(wallet.address, timestamp));
  return {
    agentWallet: wallet.address,
    wallet_signature,
    signature_timestamp: timestamp,
  };
}

test('register 402 offers Base only while chat still offers Solana', async () => {
  const signer = Wallet.createRandom();
  const res = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await signedBody(signer)),
  });
  const body = await res.json();
  assert.equal(res.status, 402);
  assert.match(body.message, /on Base/);
  assert.doesNotMatch(body.message, /on Base or Solana/);
  assert.match(body.message, /not accepted/);
  assert.equal(body.accepts.length, 1);
  assert.ok(String(body.accepts[0].network).startsWith('eip155:'));
  assert.equal(hits.verify, 0);
  assert.equal(hits.settle, 0);

  const chat = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const chatBody = await chat.json();
  assert.equal(chat.status, 402);
  assert.ok(chatBody.accepts.some((a) => String(a.network).startsWith('solana:')));
});

test('an EVM payment from another address is rejected before settle', async () => {
  const signer = Wallet.createRandom();
  const other = Wallet.createRandom();
  const beforeHits = { ...hits };
  const res = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'payment-signature': paymentHeader({
        x402Version: 2,
        accepted: { network: 'eip155:8453' },
        payload: { authorization: { from: other.address } },
      }),
    },
    body: JSON.stringify(await signedBody(signer)),
  });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.error, 'payer_mismatch');
  assert.match(body.message, /Nothing was settled/);
  assert.equal(hits.verify, beforeHits.verify);
  assert.equal(hits.settle, beforeHits.settle);
});

test('a Solana payment on register is rejected before settle', async () => {
  const signer = Wallet.createRandom();
  const beforeHits = { ...hits };
  const res = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'payment-signature': paymentHeader({
        x402Version: 2,
        accepted: { network: SOL_CAIP },
        payload: { transaction: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
      }),
    },
    body: JSON.stringify(await signedBody(signer)),
  });
  const body = await res.json();
  assert.equal(res.status, 402);
  assert.equal(body.error, 'stamp_payment_required');
  assert.match(body.message, /Base only/);
  assert.equal(body.accepts, undefined);
  assert.equal(hits.verify, beforeHits.verify);
  assert.equal(hits.settle, beforeHits.settle);
});
