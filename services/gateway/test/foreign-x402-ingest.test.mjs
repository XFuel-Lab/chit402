/**
 * Foreign x402 Book Ingest tests.
 *
 * Per whitepaper §2: An agent's arbitrary x402 spend writes a possession-gated
 * book row IF the shop supplies: (1) 402 payment required, (2) payment response,
 * (3) agent_id session. Naked tx hash is rejected. Demo never writes.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '10000';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const {
  ingestForeignX402,
  validatePaymentRequired,
  validatePaymentResponse,
  extractRouteFromResource,
  resetForeignTxNullifier,
} = await import('../src/foreign-x402-ingest.js');

const WALLET_A = '0x1111111111111111111111111111111111111111';

function makeSession() {
  return crypto.randomBytes(32).toString('hex');
}

function setupDeps() {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'initial' });
  return { registry, ledger, identity };
}

beforeEach(() => {
  resetForeignTxNullifier();
});

// ─── Unit tests ───────────────────────────────────────────────────────────────

test('extractRouteFromResource extracts hub and model from URL', () => {
  const r1 = extractRouteFromResource('https://api.grokbot.app/v1/chat/completions');
  assert.equal(r1.hub, 'api.grokbot.app');
  assert.equal(r1.model, '/v1/chat/completions');

  const r2 = extractRouteFromResource('https://openrouter.ai/api/v1/chat');
  assert.equal(r2.hub, 'openrouter.ai');
  assert.equal(r2.model, '/api/v1/chat');

  const r3 = extractRouteFromResource(null);
  assert.equal(r3.hub, null);
  assert.equal(r3.model, null);

  const r4 = extractRouteFromResource('not-a-url');
  assert.equal(r4.hub, null);
  assert.equal(r4.model, null);
});

test('validatePaymentRequired requires resource, amount, payTo', () => {
  assert.equal(validatePaymentRequired(null).ok, false);
  assert.equal(validatePaymentRequired({}).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x' }).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x', amount: '10000' }).ok, false);
  assert.equal(validatePaymentRequired({ resource: 'x', amount: '10000', payTo: '0x123' }).ok, true);
});

test('validatePaymentResponse requires tx and payer (no naked tx)', () => {
  assert.equal(validatePaymentResponse(null).ok, false);
  assert.equal(validatePaymentResponse({}).ok, false);
  assert.equal(validatePaymentResponse({ tx: '0xabc' }).ok, false, 'naked tx rejected');
  assert.equal(validatePaymentResponse({ payer: '0x123' }).ok, false);
  assert.equal(validatePaymentResponse({ tx: '0xabc', payer: '0x123' }).ok, true);
});

// ─── Integration tests ────────────────────────────────────────────────────────

test('happy path: foreign x402 → book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xGrokBotTreasury',
    },
    payment_response: {
      tx: '0xabc123def456',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.agent_id, identity.agent_id);
  assert.match(result.body.task_id, /^foreign-x402-/);
  assert.equal(result.body.payment.ref, 'base:0xabc123def456');
  assert.equal(result.body.payment.rail, 'usdc');
  assert.equal(result.body.payment.amount, '10000');
  assert.equal(result.body.route.hub, 'api.grokbot.app');
  assert.equal(result.body.route.model, '/v1/chat/completions');
  assert.equal(result.body.foreign_x402, true);
  assert.ok(result.body.recorded_at);

  // Verify it's in the ledger
  assert.equal(ledger.entries.length, 1);
  const entry = ledger.entries[0];
  assert.equal(entry.agent_id, identity.agent_id);
  assert.equal(entry.payment_ref, 'base:0xabc123def456');
  assert.equal(entry.hub, 'api.grokbot.app');
  assert.equal(entry.model, '/v1/chat/completions');
});

test('reject naked tx hash (no payer)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xabc123',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_payment_response');
  assert.match(result.message, /payer.*required/i);
  assert.equal(ledger.entries.length, 0);
});

test('reject naked tx hash (no payment_required context)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_response: {
      tx: '0xabc123',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_payment_required');
  assert.equal(ledger.entries.length, 0);
});

test('reject replay (same tx twice)', async () => {
  const { registry, ledger, identity } = setupDeps();

  const body = {
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '20000',
      payTo: '0xExampleTreasury',
    },
    payment_response: {
      tx: '0xreplayme',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  };

  const first = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session,
  });
  assert.equal(first.ok, true);
  assert.equal(ledger.entries.length, 1);

  const second = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session,
  });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'duplicate_tx');
  assert.equal(ledger.entries.length, 1, 'replay should not add');
});

test('demo key never writes to book', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xdemo123',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    isDemo: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'demo_rejected');
  assert.match(result.message, /Demo.*cannot/i);
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: wrong session rejected', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xwrongsession',
      payer: WALLET_A,
    },
    session: 'wrong-session-value',
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: 'wrong-session-value',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: no session rejected', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xnosession',
      payer: WALLET_A,
    },
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'unauthorized');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: session for different agent_id rejected', async () => {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity1 = registry.allocate({ taskId: 'agent1' });
  const identity2 = registry.allocate({ taskId: 'agent2' });

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.example.com/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xwrongagent',
      payer: WALLET_A,
    },
    session: identity1.session,
  }, {
    ledger,
    registry,
    agentId: identity2.agent_id,
    session: identity1.session,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.match(result.message, /does not match/i);
});

test('house self-pay is allowed if real on-chain tx', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.xfuel.app/v1/chat/completions',
      amount: '10000',
      payTo: '0xBasetreasury',
    },
    payment_response: {
      tx: '0xhouseselfpay',
      payer: WALLET_A,
      network: 'base',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.route.hub, 'api.xfuel.app');
  assert.equal(ledger.entries.length, 1);
});

// ─── HTTP route tests ─────────────────────────────────────────────────────────

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('POST /v1/agents/:agent_id/book/ingest without session is 401', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
});

test('POST /v1/agents/:agent_id/book/ingest with xfuel-demo key is 403', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'xfuel-demo',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'demo_rejected');
});

test('POST /v1/agents/:agent_id/book/ingest without payment_required is rejected (wrong session → 403)', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_response: { tx: '0xabc', payer: '0x2' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'forbidden');
});

test('POST /v1/agents/:agent_id/book/ingest without payment_response is rejected (wrong session → 403)', async () => {
  const res = await fetch(`${base}/v1/agents/1/book/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xfuel-Session': 'any-session',
    },
    body: JSON.stringify({
      payment_required: { resource: 'https://x.com/v1', amount: '10000', payTo: '0x1' },
    }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'forbidden');
});

test('GET /openapi.json includes /v1/agents/{agent_id}/book/ingest', async () => {
  const res = await fetch(`${base}/openapi.json`);
  const spec = await res.json();
  assert.ok(spec.paths['/v1/agents/{agent_id}/book/ingest']);
  const op = spec.paths['/v1/agents/{agent_id}/book/ingest'].post;
  assert.equal(op.operationId, 'ingestForeignX402');
  assert.match(op.description, /x402.*spend.*foreign/i);
  assert.match(op.description, /naked.*tx.*rejected/i);
});

test('GET /llms.txt mentions book/ingest', async () => {
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /\/v1\/agents\/:agent_id\/book\/ingest/);
});
