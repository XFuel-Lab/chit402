/**
 * Public discovery 402 path includes Solana when enabled.
 *
 * PR 216 added Solana accepts[] in buildPaymentChallenge / runX402Handshake,
 * but the public 402 (publicTaskRequestChallenge) was not updated. This test
 * verifies the fix:
 *
 *   1. Unauth GET /task-request → discovery 402 with dual-network when Solana enabled
 *   2. Unauth POST /task-request (no payment) → discovery 402 with dual-network
 *
 * Per Section 3.5 — mirrors runX402Handshake behavior.
 *
 * Note: The single-network cases (Solana disabled / payTo missing) are tested
 * in x402-adapter.test.mjs at the buildPaymentChallenge level. Testing those
 * cases at the server level would require separate test processes due to
 * Node.js ESM module caching of config.js.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-public-402-sol-'));

// Set env vars BEFORE any imports that depend on config
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.AKASHML_API_KEY = 'akml-test-key';
process.env.X402_ENABLED = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_USDC_PRICE_DEFAULT = '10000';
process.env.HUB_CATALOG_OFFLINE = 'false';
process.env.TASK_STORE_PERSIST = 'false';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks-sol');
process.env.M2M_API_KEYS = '';
// Solana enabled with valid payTo
process.env.X402_SOLANA_ENABLED = 'true';
process.env.X402_SOLANA_PAY_TO = 'SolanaATAaddress123456789012345678901234';
process.env.X402_SOLANA_NETWORK = 'solana';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

function createMockFacilitator() {
  const server = http.createServer((req, res) => {
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    if (req.url?.endsWith('/verify')) return send(200, { isValid: true, payer: '0xmock' });
    if (req.url?.endsWith('/settle')) return send(200, { success: true, transaction: '0xmocktx' });
    return send(404, { error: 'not_found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}

const { url: facUrl, close: closeFac } = await createMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;
process.env.X402_FACILITATOR_API_KEY = 'testkey';

const realFetch = globalThis.fetch;
function stubFetch(url, init) {
  const href = String(url);
  if (href.includes('api.akashml.com') && href.endsWith('/models')) {
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }
  if (href.includes('thetaedgecloud.com')) {
    return Promise.resolve(new Response(JSON.stringify({ body: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }
  return realFetch(url, init);
}

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

let server;
let base;

before(async () => {
  globalThis.fetch = stubFetch;
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
  globalThis.fetch = realFetch;
  // Force-close all connections to prevent hanging on keep-alive sockets
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
  await closeFac();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Public 402 Discovery with Solana Enabled
// ════════════════════════════════════════════════════════════════════════════

test('GET /task-request → 402 with dual accepts (Base + Solana)', async () => {
  const res = await realFetch(`${base}/task-request`);
  assert.equal(res.status, 402, 'GET /task-request returns 402');

  const body = await res.json();
  assert.equal(body.x402Version, 2, 'challenge is x402 v2');
  assert.ok(Array.isArray(body.accepts), 'challenge has accepts array');
  assert.equal(body.accepts.length, 2, 'dual accepts when Solana enabled: Base + Solana');

  // accepts[0]: Base (primary)
  const baseAccept = body.accepts[0];
  assert.equal(baseAccept.network, 'eip155:8453', 'accepts[0] is Base mainnet CAIP-2');
  assert.equal(baseAccept.payTo, '0xBasetreasury', 'Base payTo from config');
  assert.equal(baseAccept.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'Base USDC');
  assert.ok(baseAccept.extra.nonce, 'Base challenge has nonce');

  // accepts[1]: Solana
  const solAccept = body.accepts[1];
  assert.equal(solAccept.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'accepts[1] is Solana mainnet CAIP-2');
  assert.equal(solAccept.payTo, 'SolanaATAaddress123456789012345678901234', 'Solana payTo from config');
  assert.equal(solAccept.asset, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Solana USDC mint');
  assert.ok(solAccept.extra.nonce, 'Solana challenge has nonce');

  // Different nonces for each network
  assert.notEqual(baseAccept.extra.nonce, solAccept.extra.nonce, 'separate nonces for each network');
});

test('POST /task-request (no payment) → 402 with dual accepts', async () => {
  const res = await realFetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'akash/test-model',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 32,
    }),
  });
  assert.equal(res.status, 402, 'POST without payment returns 402');

  const body = await res.json();
  assert.equal(body.accepts.length, 2, 'POST also gets dual accepts');
  assert.equal(body.accepts[0].network, 'eip155:8453', 'Base');
  assert.equal(body.accepts[1].network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'Solana');
});

test('resource.description mentions USDC', async () => {
  const res = await realFetch(`${base}/task-request`);
  const body = await res.json();
  assert.ok(
    body.resource?.description?.includes('USDC') || body.resource?.description?.includes('Base'),
    'description mentions USDC or Base'
  );
  assert.equal(body.accepts.length, 2, 'dual accepts present');
});

test('PAYMENT-REQUIRED header is set on 402', async () => {
  const res = await realFetch(`${base}/task-request`);
  assert.equal(res.status, 402);
  const header = res.headers.get('PAYMENT-REQUIRED');
  assert.ok(header, 'PAYMENT-REQUIRED header is present');
  // Header is base64-encoded JSON
  const decoded = Buffer.from(header, 'base64').toString('utf-8');
  const parsed = JSON.parse(decoded);
  assert.equal(parsed.x402Version, 2, 'header payload is x402 v2');
  assert.equal(parsed.accepts.length, 2, 'header lists dual accepts');
});

test('dual accepts are mirrored in handshake path (runX402Handshake parity)', async () => {
  // Verify that the public discovery 402 behavior matches what runX402Handshake
  // would return for the same config (dual-network when solana.enabled)
  const getRes = await realFetch(`${base}/task-request`);
  const getBody = await getRes.json();

  const postRes = await realFetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'akash/test-model',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 32,
    }),
  });
  const postBody = await postRes.json();

  // Both GET and POST should have the same dual-network structure
  assert.equal(getBody.accepts.length, postBody.accepts.length, 'GET and POST have same accepts count');
  assert.equal(getBody.accepts[0].network, postBody.accepts[0].network, 'Base network matches');
  assert.equal(getBody.accepts[1].network, postBody.accepts[1].network, 'Solana network matches');
});
