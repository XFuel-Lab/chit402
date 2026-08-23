/**
 * Bug fix test: Solana x402 verify/settle routes to Solana facilitator, not CDP.
 *
 * Issue (2026-08-23): runX402Handshake passes cfg.facilitatorUrl (the Base CDP URL)
 * as opts.gatewayUrl. resolveGateway in x402-adapter.js was using opts.gatewayUrl
 * for Solana payments too, causing Solana verify/settle to hit CDP instead of PayAI.
 *
 * Fix: For Solana payments, resolveGateway now ignores opts.gatewayUrl and uses
 * X402_SOLANA_FACILITATOR_URL or PAYAI_FACILITATOR_URL.
 *
 * This test proves:
 *   1. Solana verify uses the Solana facilitator URL when opts.gatewayUrl is CDP URL
 *   2. Base/EVM verify still uses CDP (opts.gatewayUrl) as before
 *   3. No regression in the dual-network challenge flow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildPaymentChallenge,
  verifyPayment,
  settlePayment,
  ChallengeStore,
} from '../src/x402-adapter.js';

// Build a payment header the way the SDK's createEip3009Payer does
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
      domain: { name: 'USDC', version: '2', chainId: 84532 },
      message: { from, to: payTo, value: amount, validAfter: 0, validBefore: now + 3600, nonce: '0x' + 'ab'.repeat(32) },
      signature: '0x' + '11'.repeat(65),
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

// Track which mock received requests
const requestLog = { cdp: [], solana: [] };

function createTrackingMock(name, txRefPrefix) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requestLog[name].push({ url: req.url, method: req.method, body: body ? JSON.parse(body) : null });

      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };

      if (req.method !== 'POST') return send(404, { error: 'not_found' });

      const url = req.url || '';
      if (url.endsWith('/verify')) {
        // Standard x402 protocol response (isValid for x402 facilitator)
        return send(200, { isValid: true, payer: `0x${name}payer` });
      }
      if (url.endsWith('/settle')) {
        return send(200, { success: true, transaction: `${txRefPrefix}0x${name}tx`, network: 'test', payer: `0x${name}payer` });
      }
      return send(404, { error: 'not_found' });
    });
  });
  return server;
}

function startTrackingMock(name, txRefPrefix) {
  const server = createTrackingMock(name, txRefPrefix);
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

let cdpMock, solanaMock;
let originalSolanaEnv;

before(async () => {
  // Save original env
  originalSolanaEnv = process.env.X402_SOLANA_FACILITATOR_URL;

  // Start two tracking mocks
  cdpMock = await startTrackingMock('cdp', 'CDP_');
  solanaMock = await startTrackingMock('solana', 'SOLANA_');

  // Point Solana facilitator to the Solana mock
  process.env.X402_SOLANA_FACILITATOR_URL = solanaMock.url;
});

after(async () => {
  // Restore env
  if (originalSolanaEnv === undefined) {
    delete process.env.X402_SOLANA_FACILITATOR_URL;
  } else {
    process.env.X402_SOLANA_FACILITATOR_URL = originalSolanaEnv;
  }

  await cdpMock.close();
  await solanaMock.close();
});

// ════════════════════════════════════════════════════════════════════════════════
// BUG FIX VERIFICATION: Solana uses Solana facilitator even when gatewayUrl is CDP
// ════════════════════════════════════════════════════════════════════════════════

test('Solana verifyPayment uses Solana facilitator when opts.gatewayUrl is CDP URL', async () => {
  // Clear request logs
  requestLog.cdp = [];
  requestLog.solana = [];

  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-solana-routing',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      baseUrl: 'https://api.xfuel.app',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const solNonce = body.accepts[1].extra.nonce;

  // Build a proper payment header
  const paymentHeader = makePaymentHeader({
    network: 'solana',
    amount: '50000',
    payTo: 'SolanaATAaddress123',
  });

  // Simulate the bug scenario: pass CDP URL as gatewayUrl (what runX402Handshake does)
  const v = await verifyPayment(paymentHeader, {
    provider: 'x402',  // Standard x402 facilitator protocol
    gatewayUrl: cdpMock.url,  // CDP URL passed from runX402Handshake
    store,
    nonce: solNonce,
  });

  // BEFORE FIX: CDP mock would receive the request (BUG)
  // AFTER FIX: Solana mock receives the request (CORRECT)
  assert.equal(v.valid, true, 'verify should succeed');

  // Verify the Solana mock received the request, NOT CDP
  assert.equal(requestLog.solana.length, 1, 'Solana mock should receive 1 request');
  assert.equal(requestLog.solana[0].url, '/verify', 'Solana mock received /verify');
  assert.equal(requestLog.cdp.length, 0, 'CDP mock should NOT receive any requests for Solana payment');
});

test('Solana settlePayment uses Solana facilitator when opts.gatewayUrl is CDP URL', async () => {
  // Clear request logs
  requestLog.cdp = [];
  requestLog.solana = [];

  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-solana-settle-routing',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const solNonce = body.accepts[1].extra.nonce;

  // Build a proper payment header
  const paymentHeader = makePaymentHeader({
    network: 'solana',
    amount: '50000',
    payTo: 'SolanaATAaddress123',
  });

  // Simulate the bug scenario: pass CDP URL as gatewayUrl
  const s = await settlePayment(paymentHeader, {
    provider: 'x402',
    gatewayUrl: cdpMock.url,  // CDP URL passed from runX402Handshake
    store,
    nonce: solNonce,
  });

  assert.equal(s.settled, true, 'settle should succeed');

  // Verify the Solana mock received the request, NOT CDP
  assert.equal(requestLog.solana.length, 1, 'Solana mock should receive 1 request');
  assert.equal(requestLog.solana[0].url, '/settle', 'Solana mock received /settle');
  assert.equal(requestLog.cdp.length, 0, 'CDP mock should NOT receive any requests for Solana settle');
});

// ════════════════════════════════════════════════════════════════════════════════
// REGRESSION TEST: Base/EVM still uses CDP (opts.gatewayUrl)
// ════════════════════════════════════════════════════════════════════════════════

test('Base verifyPayment uses CDP facilitator (opts.gatewayUrl)', async () => {
  // Clear request logs
  requestLog.cdp = [];
  requestLog.solana = [];

  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-base-routing',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const baseNonce = body.accepts[0].extra.nonce;

  // Build a proper payment header for Base
  const paymentHeader = makePaymentHeader({
    network: 'base',
    amount: '50000',
    payTo: '0xBasetreasury',
  });

  // For Base payments, gatewayUrl (CDP) should be used
  const v = await verifyPayment(paymentHeader, {
    provider: 'x402',
    gatewayUrl: cdpMock.url,
    store,
    nonce: baseNonce,
  });

  assert.equal(v.valid, true, 'verify should succeed');

  // Verify the CDP mock received the request (correct for Base)
  assert.equal(requestLog.cdp.length, 1, 'CDP mock should receive 1 request for Base payment');
  assert.equal(requestLog.cdp[0].url, '/verify', 'CDP mock received /verify');
  assert.equal(requestLog.solana.length, 0, 'Solana mock should NOT receive Base payment');
});

test('Base settlePayment uses CDP facilitator (opts.gatewayUrl)', async () => {
  // Clear request logs
  requestLog.cdp = [];
  requestLog.solana = [];

  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-base-settle-routing',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const baseNonce = body.accepts[0].extra.nonce;

  // Build a proper payment header for Base
  const paymentHeader = makePaymentHeader({
    network: 'base',
    amount: '50000',
    payTo: '0xBasetreasury',
  });

  const s = await settlePayment(paymentHeader, {
    provider: 'x402',
    gatewayUrl: cdpMock.url,
    store,
    nonce: baseNonce,
  });

  assert.equal(s.settled, true, 'settle should succeed');

  // Verify the CDP mock received the request
  assert.equal(requestLog.cdp.length, 1, 'CDP mock should receive 1 request for Base settle');
  assert.equal(requestLog.cdp[0].url, '/settle', 'CDP mock received /settle');
  assert.equal(requestLog.solana.length, 0, 'Solana mock should NOT receive Base settle');
});

// ════════════════════════════════════════════════════════════════════════════════
// EDGE CASE: Solana routing works even without explicit gatewayUrl
// ════════════════════════════════════════════════════════════════════════════════

test('Solana verifyPayment routes to Solana facilitator without explicit gatewayUrl', async () => {
  // Clear request logs
  requestLog.cdp = [];
  requestLog.solana = [];

  const store = new ChallengeStore();
  const { body } = buildPaymentChallenge(
    {
      taskId: 'task-solana-no-gw',
      maxAmountRequired: '50000',
      network: 'base',
      payTo: '0xBasetreasury',
      solana: {
        enabled: true,
        payTo: 'SolanaATAaddress123',
        network: 'solana',
      },
    },
    { store },
  );

  const solNonce = body.accepts[1].extra.nonce;

  // Build a proper payment header
  const paymentHeader = makePaymentHeader({
    network: 'solana',
    amount: '50000',
    payTo: 'SolanaATAaddress123',
  });

  // No gatewayUrl — should resolve from X402_SOLANA_FACILITATOR_URL env
  const v = await verifyPayment(paymentHeader, {
    provider: 'x402',
    // gatewayUrl NOT set
    store,
    nonce: solNonce,
  });

  assert.equal(v.valid, true, 'verify should succeed');
  assert.equal(requestLog.solana.length, 1, 'Solana mock should receive request from env URL');
  assert.equal(requestLog.cdp.length, 0, 'CDP should not be hit');
});
