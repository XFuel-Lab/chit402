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
  railFromNetwork,
} = await import('../src/foreign-x402-ingest.js');

const WALLET_A = '0x1111111111111111111111111111111111111111';

function makeSession() {
  return crypto.randomBytes(32).toString('hex');
}

/** Mock verify that always returns valid: true */
const verifyOk = async () => ({ valid: true });

/** Mock verify that always returns valid: false */
const verifyFail = async () => ({ valid: false, reason: 'mock rejection' });

/** Mock verify that throws */
const verifyThrows = async () => { throw new Error('verify exploded'); };

function setupDeps() {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'initial' });
  return { registry, ledger, identity };
}

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

test('railFromNetwork: EVM → usdc, Solana → solana', () => {
  assert.equal(railFromNetwork('base'), 'usdc');
  assert.equal(railFromNetwork('base-sepolia'), 'usdc');
  assert.equal(railFromNetwork('eip155:8453'), 'usdc');
  assert.equal(railFromNetwork(null), 'usdc');
  assert.equal(railFromNetwork(''), 'usdc');
  assert.equal(railFromNetwork('solana'), 'solana');
  assert.equal(railFromNetwork('solana-devnet'), 'solana');
  assert.equal(railFromNetwork('solana-mainnet'), 'solana');
  assert.equal(railFromNetwork('SOLANA'), 'solana', 'case insensitive');
});

// ─── Integration tests ────────────────────────────────────────────────────────

test('happy path: foreign x402 → book row (with valid verify)', async () => {
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
    verify: verifyOk,
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

test('Solana network sets rail to solana, not usdc', async () => {
  const { registry, ledger, identity } = setupDeps();

  // Mock verify that would throw for Solana (real impl does) — but we use verifyOk to bypass
  // since the test is about rail detection, not actual Solana verification.
  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.solana-shop.io/infer',
      amount: '5000',
      payTo: 'SoLanaTreasuryAddress123',
    },
    payment_response: {
      tx: '3vZ9Y9X...solana-sig',
      payer: 'SolanaPayerAddress456',
      network: 'solana',
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,  // bypassing actual Solana verification for rail detection test
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.payment.rail, 'solana', 'Solana network → solana rail');
  assert.equal(result.body.payment.ref, 'solana:3vZ9Y9X...solana-sig');

  const entry = ledger.entries[0];
  assert.equal(entry.rail, 'solana');
});

test('reject naked tx hash (no payer) — fails before verify', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_payment_response');
  assert.match(result.message, /payer.*required/i);
  assert.equal(ledger.entries.length, 0);
});

test('reject naked tx hash (no payment_required context) — fails before verify', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid_payment_required');
  assert.equal(ledger.entries.length, 0);
});

test('reject replay (same tx twice) — ledger is nullifier', async () => {
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
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(first.ok, true);
  assert.equal(ledger.entries.length, 1);

  const second = await ingestForeignX402(body, {
    ledger, registry, agentId: identity.agent_id, session: identity.session, verify: verifyOk,
  });
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'duplicate_ref', 'replay blocked by ledger findByRef');
  assert.equal(ledger.entries.length, 1, 'replay should not add');
});

test('demo key never writes to book (rejects before verify)', async () => {
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
    verify: verifyOk,
    isDemo: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'demo_rejected');
  assert.match(result.message, /Demo.*cannot/i);
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: wrong session rejected (before verify)', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: no session rejected (before verify)', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'unauthorized');
  assert.equal(ledger.entries.length, 0);
});

test('possession-gated: session for different agent_id rejected (before verify)', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
  assert.match(result.message, /does not match/i);
});

test('house self-pay is allowed if real on-chain tx (with valid verify)', async () => {
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
    verify: verifyOk,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.body.route.hub, 'api.xfuel.app');
  assert.equal(ledger.entries.length, 1);
});

// ─── Verification fail-closed tests ───────────────────────────────────────────

test('FAIL CLOSED: verify unavailable → 502, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xnoverify',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    // verify NOT provided
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error, 'verify_unavailable');
  assert.match(result.message, /not configured/i);
  assert.equal(ledger.entries.length, 0, 'no row without verify');
});

test('FAIL CLOSED: verify throws → 502, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifythrows',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyThrows,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error, 'verify_failed');
  assert.match(result.message, /exploded/i);
  assert.equal(ledger.entries.length, 0, 'no row when verify throws');
});

test('FAIL CLOSED: verify returns valid: false → 400, no book row', async () => {
  const { registry, ledger, identity } = setupDeps();

  const result = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyrejects',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyFail,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'payment_invalid');
  assert.match(result.message, /mock rejection/i);
  assert.equal(ledger.entries.length, 0, 'no row when verify fails');
});

test('FAIL CLOSED: only valid: true writes a row', async () => {
  const { registry, ledger, identity } = setupDeps();

  // First: verify returns undefined (not explicit valid: true)
  const resultUndef = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyundef',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({}), // returns {}, not { valid: true }
  });

  assert.equal(resultUndef.ok, false);
  assert.equal(resultUndef.status, 400);
  assert.equal(resultUndef.error, 'payment_invalid');
  assert.equal(ledger.entries.length, 0, 'no row without explicit valid: true');

  // Second: verify returns valid: true
  const resultValid = await ingestForeignX402({
    payment_required: {
      resource: 'https://api.grokbot.app/v1/chat',
      amount: '10000',
      payTo: '0xTreasury',
    },
    payment_response: {
      tx: '0xverifyok',
      payer: WALLET_A,
    },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: verifyOk,
  });

  assert.equal(resultValid.ok, true);
  assert.equal(resultValid.status, 201);
  assert.equal(ledger.entries.length, 1, 'row written only with valid: true');
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
