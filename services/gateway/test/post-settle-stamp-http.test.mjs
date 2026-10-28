/**
 * Register and ingest stamp underpaid, over HTTP, after /settle.
 * Offline. Loopback only.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Wallet } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.NODE_ENV = 'test';
process.env.X402_ENABLED = 'true';
process.env.X402_NETWORK = 'base';
process.env.X402_PAY_TO = '0x1111111111111111111111111111111111111111';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'x402';
process.env.RECEIPT_SIGNING_SECRET = 'stamp-http-test';
delete process.env.M2M_API_KEYS;

const HOUSE = process.env.X402_PAY_TO;
let facSeq = 0;
let facPayer = '0x' + '22'.repeat(20);

function startFacilitator() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const tx = `0x${String(facSeq).padStart(2, '0')}${'ab'.repeat(31)}`;
      if (String(req.url).endsWith('/settle')) facSeq += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        isValid: true,
        success: true,
        settled: true,
        transaction: tx,
        txRef: tx,
        payer: facPayer,
        network: 'base',
      }));
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

const fac = await startFacilitator();
process.env.X402_FACILITATOR_URL = fac.url;
process.env.X402_GATEWAY_URL = fac.url;

const { setChainReaderForTests } = await import('../src/x402-chain-hook.js');
const configMod = await import('../src/config.js');
const config = configMod.default;
const { createApp } = await import('../src/server.js');
const { canonicalRegisterPayMessage } = await import('../src/agent-registry.js');
const { paymentHeader } = await import('./fixtures/refusal-scenarios.mjs');

let server;
let base;
let chainAmount = '2000';
let shiftPayee = false;

before(async () => {
  setChainReaderForTests(async ({ facilitator }) => {
    if (shiftPayee) config.x402.payTo = '0x' + '99'.repeat(20);
    const tx = facilitator?.transaction || facilitator?.txRef || `0x${'ab'.repeat(32)}`;
    return {
      ok: true,
      confirmed: true,
      amount: chainAmount,
      payer: facPayer,
      payTo: HOUSE,
      transaction: tx,
      network: 'base',
      logIndex: 0,
      blockNumber: 1,
    };
  });
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  setChainReaderForTests(null);
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await fac.close();
});

async function signedBody(wallet) {
  const timestamp = Math.floor(Date.now() / 1000);
  const wallet_signature = await wallet.signMessage(canonicalRegisterPayMessage(wallet.address, timestamp));
  return { agentWallet: wallet.address, wallet_signature, signature_timestamp: timestamp };
}

function paidHeader(from, nonce) {
  return paymentHeader({ from, to: HOUSE, nonce, value: '2000', amount: '2000' });
}

test('register stamp underpaid over HTTP is 409 refund_owed', async () => {
  chainAmount = '2000';
  shiftPayee = true;
  const signer = Wallet.createRandom();
  facPayer = signer.address;
  const open = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await signedBody(signer)),
  });
  const challenge = await open.json();
  assert.equal(open.status, 402, JSON.stringify(challenge));
  const nonce = challenge.accepts?.[0]?.extra?.nonce;
  assert.ok(nonce, JSON.stringify(challenge));
  const paid = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'payment-signature': paidHeader(signer.address, nonce),
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(await signedBody(signer)),
  });
  const body = await paid.json();
  assert.equal(paid.status, 409, JSON.stringify(body));
  assert.equal(body.code || body.error, 'stamp_underpaid');
  assert.equal(body.status, 'refund_owed');
  assert.match(body.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(paid.headers.get('retry-after'), null);
  assert.doesNotMatch(JSON.stringify(body), /rejected|could not be settled/i);
  assert.match(body.verify_url, /\/receipt\/late-[0-9a-f]{32}$/);
});

test('a header failure after a settled register stamp still returns the agent', async () => {
  config.x402.payTo = HOUSE;
  shiftPayee = false;
  chainAmount = '2000';
  process.env.X402_HEADER_THROW = '1';
  try {
    const signer = Wallet.createRandom();
    facPayer = signer.address;
    const open = await fetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await signedBody(signer)),
    });
    const challenge = await open.json();
    assert.equal(open.status, 402, JSON.stringify(challenge));
    const nonce = challenge.accepts?.[0]?.extra?.nonce;
    const paid = await fetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': paidHeader(signer.address, nonce),
        'x-payment-nonce': nonce,
      },
      body: JSON.stringify(await signedBody(signer)),
    });
    const body = await paid.json();
    assert.equal(paid.status, 200, JSON.stringify(body));
    assert.ok(body.agent_id, JSON.stringify(body));
    const openIngest = await fetch(`${base}/v1/agents/${body.agent_id}/book/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: body.session,
        payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
        payment_response: { tx: '0x' + 'e9'.repeat(32), payer: signer.address, network: 'base' },
      }),
    });
    const ingestChallenge = await openIngest.json();
    assert.equal(openIngest.status, 402, JSON.stringify(ingestChallenge));
    const ingestNonce = ingestChallenge.accepts?.[0]?.extra?.nonce;
    const ingestPaid = await fetch(`${base}/v1/agents/${body.agent_id}/book/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': paidHeader(signer.address, ingestNonce),
        'x-payment-nonce': ingestNonce,
      },
      body: JSON.stringify({
        session: body.session,
        payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
        payment_response: { tx: '0x' + 'ea'.repeat(32), payer: signer.address, network: 'base' },
      }),
    });
    const ingestBody = await ingestPaid.json();
    assert.equal(ingestPaid.status, 409, JSON.stringify(ingestBody));
    assert.equal(ingestBody.error, 'verify_unavailable', JSON.stringify(ingestBody));
    assert.match(ingestBody.pending_id, /^[0-9a-f]{32}$/);
  } finally {
    delete process.env.X402_HEADER_THROW;
  }
});

async function registerPaid() {
  delete process.env.X402_STAMP_THROW;
  delete process.env.X402_HEADER_THROW;
  config.x402.payTo = HOUSE;
  shiftPayee = false;
  chainAmount = '2000';
  const signer = Wallet.createRandom();
  facPayer = signer.address;
  const open = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await signedBody(signer)),
  });
  const challenge = await open.json();
  assert.equal(open.status, 402, JSON.stringify(challenge));
  const nonce = challenge.accepts?.[0]?.extra?.nonce;
  assert.ok(nonce, JSON.stringify(challenge));
  const paid = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'payment-signature': paidHeader(signer.address, nonce),
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(await signedBody(signer)),
  });
  const body = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(body));
  assert.ok(body.agent_id, JSON.stringify(body));
  assert.ok(body.session, JSON.stringify(body));
  return { signer, agent_id: body.agent_id, session: body.session };
}

function stampHeaders(mode, nonce) {
  const headers = { 'content-type': 'application/json' };
  if (mode !== 'none') headers['x-payment'] = 'present';
  if (nonce) headers['x-payment-nonce'] = nonce;
  return headers;
}

test('a thrown stamp is 402 with no payment header and 409 once a header was sent', async () => {
  const seat = await registerPaid();
  const deadline = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const calls = [
    {
      name: 'ingest',
      url: `${base}/v1/agents/${seat.agent_id}/book/ingest`,
      body: {
        session: seat.session,
        payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
        payment_response: { tx: '0x' + 'eb'.repeat(32), payer: seat.signer.address, network: 'base' },
      },
    },
    {
      name: 'board-jobs',
      url: `${base}/v1/board/jobs`,
      body: { session: seat.session, text: 'ship the receipt page', budget: '1000', deadline },
    },
    {
      name: 'board-posts',
      url: `${base}/v1/board/posts`,
      body: { session: seat.session, endpoint: 'https://shop.example/v1', outcome: 'success', text: 'answered' },
    },
  ];
  process.env.X402_STAMP_THROW = '1';
  try {
    for (const call of calls) {
      const bare = await fetch(call.url, {
        method: 'POST',
        headers: stampHeaders('none'),
        body: JSON.stringify(call.body),
      });
      const bareBody = await bare.json();
      assert.equal(bare.status, 402, `${call.name} ${JSON.stringify(bareBody)}`);
      assert.equal(bareBody.pending_id, undefined, call.name);
      assert.equal(bare.headers.get('retry-after'), null, call.name);

      const named = `http-${call.name}-nonce`;
      const held = await fetch(call.url, {
        method: 'POST',
        headers: stampHeaders('header', named),
        body: JSON.stringify(call.body),
      });
      const heldBody = await held.json();
      assert.equal(held.status, 409, `${call.name} ${JSON.stringify(heldBody)}`);
      assert.equal(heldBody.pending_id, undefined, `${call.name} unclaimed nonce opens no handle`);
      assert.equal(heldBody.status, undefined, call.name);
      assert.equal(heldBody.error, 'stamp_payment_required', call.name);
      assert.match(heldBody.message, /Do not pay again/, call.name);
      assert.equal(held.headers.get('retry-after'), null, call.name);

      const fallback = await fetch(call.url, {
        method: 'POST',
        headers: stampHeaders('header'),
        body: JSON.stringify(call.body),
      });
      const fallbackBody = await fallback.json();
      assert.equal(fallback.status, 409, `${call.name} fallback ${JSON.stringify(fallbackBody)}`);
      assert.equal(fallbackBody.error, 'stamp_payment_required', call.name);
      assert.equal(fallbackBody.pending_id, undefined, `${call.name} fallback must miss the nonce handle`);
      assert.match(fallbackBody.message, /Do not pay again/, call.name);
      assert.equal(fallback.headers.get('retry-after'), null, call.name);
      assert.notEqual(fallbackBody.error, 'stamp_failed', call.name);
    }
  } finally {
    delete process.env.X402_STAMP_THROW;
  }
});
