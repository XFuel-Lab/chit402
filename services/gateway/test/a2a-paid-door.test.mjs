/**
 * A2A paid door = same $0.01 x402 + chat fulfillment as /v1.
 *
 * Unauth POST /a2a-message {} → 402 (not 401), amount 10000, Base+Solana.
 * Collected settle appends UsageSettled (hub, model, amount) under a bookable
 * agent_id without waiting for register.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-a2a-door-'));

process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret-a2a';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '10000';
process.env.X402_SOLANA_ENABLED = 'true';
process.env.X402_SOLANA_PAY_TO = 'SolanaATAaddress123456789012345678901234';
process.env.X402_SOLANA_NETWORK = 'solana';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.TASK_STORE_PERSIST = 'false';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.M2M_API_KEYS = '';
process.env.M2M_DEMO_MODE = 'true';
process.env.M2M_DEMO_API_KEY = 'xfuel-demo';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

function createMockFacilitator() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad_json' }); }
      const isStandardX402 = !!parsed.paymentPayload;
      const payer = parsed.paymentPayload?.payload?.authorization?.from || '0xmockpayer';
      const network = parsed.paymentRequirements?.network || 'base';
      const txRef = '0xa2amocktxref000000000000000000000000000000000000000000000000';
      if (req.url?.endsWith('/verify')) {
        if (isStandardX402) return send(200, { isValid: true, payer });
        return send(200, { valid: true, txRef });
      }
      if (req.url?.endsWith('/settle')) {
        if (isStandardX402) return send(200, { success: true, transaction: txRef, network, payer });
        return send(200, { settled: true, txRef });
      }
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

const { url: facUrl, close: closeFac } = await createMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { recordCollectedSpend, UsageSettledLedger, hubOf } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { readAgentBook, bindBookVerifier } = await import('../src/agent-book.js');

let server;
let base;

before(async () => {
  resetHubCatalogCache();
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
  await closeFac();
});

test('hubOf prefers route.hub then model prefix', () => {
  assert.equal(hubOf({ hub: 'theta', model: 'akash/x' }), 'theta');
  assert.equal(hubOf({ model: 'theta/qwen3' }), 'theta');
  assert.equal(hubOf({ provider: 'akashml' }), 'akashml');
});

test('unauth POST /a2a-message {} is 402 amount 10000 Base+Solana not 401', async () => {
  const res = await fetch(`${base}/a2a-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 402, 'must 402 not 401');
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.accepts[0].amount, '10000');
  assert.equal(body.accepts.length, 2);
  const nets = body.accepts.map((a) => a.network);
  assert.ok(nets.some((n) => String(n).startsWith('eip155:')));
  assert.ok(nets.some((n) => String(n).startsWith('solana')));
  assert.match(body.resource.url, /\/a2a-message$/);
  assert.ok(!body.resource.url.includes('/task-request'));
});

test('unauth POST /a2a-message {} matches /v1 floor and rails', async () => {
  const a2a = await (await fetch(`${base}/a2a-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })).json();
  const v1 = await (await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })).json();
  assert.equal(a2a.accepts[0].amount, v1.accepts[0].amount);
  assert.equal(a2a.accepts.length, v1.accepts.length);
  assert.deepEqual(
    a2a.accepts.map((a) => a.network).sort(),
    v1.accepts.map((a) => a.network).sort(),
  );
});

test('demo key on /a2a-message skips payment then 400s on empty body', async () => {
  const res = await fetch(`${base}/a2a-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error?.type || body.error, body.error?.type ? 'invalid_request_error' : body.error);
});

test('recordCollectedSpend appends hub/model/amount under bookable agent_id without register', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const receipt = {
    task_id: 'task-settle-1',
    payment: {
      rail: 'usdc',
      ref: 'base:0xsettle1',
      collected: true,
      gross_amount: '10000',
    },
    route: { model: 'theta/qwen3', provider: 'theta-edgecloud' },
  };
  const recorded = recordCollectedSpend(receipt, { ledger, registry });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.duplicate, false);
  assert.ok(Number.isInteger(recorded.agent_id) && recorded.agent_id >= 1);
  assert.equal(typeof recorded.session, 'string');
  assert.ok(recorded.session.length >= 32);
  assert.equal(recorded.entry.amount, '10000');
  assert.equal(recorded.entry.model, 'theta/qwen3');
  assert.equal(recorded.entry.hub, 'theta');
  assert.equal(ledger.entries.length, 1);

  const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.entries.length, 1);
  assert.equal(book.body.entries[0].payment.amount, '10000');
  assert.equal(book.body.entries[0].route.model, 'theta/qwen3');
  assert.equal(book.body.entries[0].route.hub, 'theta');
});

test('agent-card skill describes a2a as $0.01 book lead', async () => {
  const res = await fetch(`${base}/.well-known/agent-card.json`);
  assert.equal(res.status, 200);
  const card = await res.json();
  assert.equal(card.supportedInterfaces[0].url.includes('/a2a-message'), true);
  const skill = card.skills.find((s) => s.id === 'a2a-message');
  assert.ok(skill);
  assert.match(skill.description, /\$0\.01/);
  assert.match(skill.description, /hub, model, and amount/);
  assert.doesNotMatch(JSON.stringify(card), /Not a smart router/);
  assert.doesNotMatch(JSON.stringify(card), /Not a model shop/);
});
