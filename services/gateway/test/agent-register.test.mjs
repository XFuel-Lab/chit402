/**
 * P0 agent register + A2A agent-card.
 *
 * Unit: register issues agent_id; demo/unmetered does not ledger; duplicate
 * payment.ref rejected; HMAC fail rejected; agent-card 200; MCP has no
 * human payer-key path.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { canonicalSignedPayload, verifyReceiptHmac } = await import('../src/receipt.js');
const { AgentRegistry, registerAgent } = await import('../src/agent-registry.js');
const { UsageSettledLedger, receiptQualifiesForLedger } = await import('../src/usage-settled.js');
const { buildAgentCard } = await import('../src/agent-card.js');
const { inspectWalletShape, bindAgentWallet } = await import('../src/agent-wallet.js');

const VERIFY_KEY = 'unit-test-hmac';
const WALLET = '0x1111111111111111111111111111111111111111';

function sign(receipt, secret = VERIFY_KEY) {
  const value = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  receipt.signature = { alg: 'HMAC-SHA256', payload_version: 3, value: `sha256=${value}` };
  return receipt;
}

function collectedReceipt(over = {}) {
  return sign({
    schema: 'xfuel.receipt.v3',
    task_id: over.task_id || 'task-paid-1',
    status: 'completed',
    proof_outcome: 'valid',
    proof: { tier: 'signed' },
    payment: {
      rail: 'usdc',
      ref: over.ref || 'base:0xabc123',
      collected: true,
      net_amount: '9950',
      fee_amount: '50',
      gross_amount: '10000',
    },
    route: { model: 'xfuel/auto', provider: 'mock' },
    output: { hash: '0x' + 'ab'.repeat(32) },
    verify_url: 'https://api.xfuel.app/receipt/task-paid-1',
    ...over,
  });
}

function demoReceipt() {
  return sign({
    schema: 'xfuel.receipt.v3',
    task_id: 'task-demo-1',
    status: 'completed',
    proof_outcome: 'valid',
    proof: { tier: 'signed' },
    payment: { rail: 'unmetered', ref: null, collected: false, gross_amount: '0' },
    route: { model: 'xfuel/auto', provider: 'mock' },
    output: { hash: '0x' + 'cd'.repeat(32) },
  });
}

function deps(receipts, extra = {}) {
  const store = new Map(Object.entries(receipts));
  return {
    registry: new AgentRegistry(),
    ledger: new UsageSettledLedger(),
    loadReceipt: async (id) => store.get(id) || null,
    verify: (r) => verifyReceiptHmac(r, VERIFY_KEY),
    bindWallet: async (w) => ({ ok: true, address: w, kind: 'aawp', official: true }),
    postA2A: async (fields) => ({ message_id: 'a2a-test', status: 'accepted', ...fields }),
    ...extra,
  };
}

test('register issues an integer agent_id', async () => {
  const receipt = collectedReceipt();
  const result = await registerAgent(
    { agentWallet: WALLET, task_id: receipt.task_id },
    deps({ [receipt.task_id]: receipt }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.agent_id, 'number');
  assert.equal(Number.isInteger(result.body.agent_id), true);
  assert.ok(result.body.agent_id >= 1);
  assert.equal(result.body.agentWallet, WALLET);
  assert.equal(typeof result.body.validate_score, 'number');
  assert.equal(result.body.a2a.status, 'accepted');
  assert.equal(result.body.usage_settled.collected, true);
  assert.equal(result.body.usage_settled.agent_id, result.body.agent_id);
});

test('demo/unmetered receipt does not ledger-credit and does not register', async () => {
  const receipt = demoReceipt();
  const d = deps({ [receipt.task_id]: receipt });
  const result = await registerAgent(
    { agentWallet: WALLET, task_id: receipt.task_id },
    d,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'not_qualifying');
  assert.equal(d.ledger.entries.length, 0);
  assert.equal(d.registry.byId.size, 0);
  assert.equal(receiptQualifiesForLedger(receipt).ok, false);
});

test('collected:false USDC receipt does not ledger-credit', async () => {
  const receipt = collectedReceipt();
  receipt.payment.collected = false;
  sign(receipt);
  const d = deps({ [receipt.task_id]: receipt });
  const result = await registerAgent(
    { agentWallet: WALLET, task_id: receipt.task_id },
    d,
  );
  assert.equal(result.ok, false);
  assert.equal(d.ledger.entries.length, 0);
});

test('duplicate payment.ref is rejected', async () => {
  const a = collectedReceipt({ task_id: 'task-a', ref: 'base:0xsame' });
  const b = collectedReceipt({ task_id: 'task-b', ref: 'base:0xsame' });
  const d = deps({ 'task-a': a, 'task-b': b });
  const first = await registerAgent({ agentWallet: WALLET, task_id: 'task-a' }, d);
  assert.equal(first.ok, true);
  const second = await registerAgent({
    agentWallet: '0x2222222222222222222222222222222222222222',
    task_id: 'task-b',
  }, d);
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'duplicate_ref');
  assert.equal(d.ledger.entries.length, 1);
});

test('HMAC fail is rejected', async () => {
  const receipt = collectedReceipt();
  receipt.signature.value = 'sha256=' + '00'.repeat(32);
  const d = deps({ [receipt.task_id]: receipt });
  const result = await registerAgent(
    { agentWallet: WALLET, task_id: receipt.task_id },
    d,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'hmac_invalid');
  assert.equal(d.ledger.entries.length, 0);
  assert.equal(d.registry.byId.size, 0);
});

test('inspectWalletShape rejects a pasteable secret and API key', () => {
  assert.equal(inspectWalletShape('0x' + 'ab'.repeat(32)).ok, false);
  assert.equal(inspectWalletShape('xfuel-demo').ok, false);
  assert.equal(inspectWalletShape(WALLET, { apiKey: WALLET }).ok, false);
  assert.equal(inspectWalletShape(WALLET).ok, true);
});

test('bindAgentWallet rejects a detectable EOA', async () => {
  const res = await bindAgentWallet(WALLET, {
    inspect: async () => ({ kind: 'eoa', official: false, eoa: true, code: '0x' }),
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /EOA/i);
});

test('buildAgentCard is A2A v1.0', () => {
  const card = buildAgentCard('https://api.xfuel.app');
  assert.equal(card.name, 'XFuel');
  assert.equal(card.version, '1.0.0');
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'HTTP+JSON');
  assert.ok(card.skills.length >= 1);
  assert.ok(card.skills.every((s) => Array.isArray(s.tags) && s.tags.length));
  assert.ok(card.skills.some((s) => s.id === 'register-agent'));
  assert.doesNotMatch(JSON.stringify(card), /unmetered/i);
  assert.doesNotMatch(JSON.stringify(card), /free path/i);
});

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

test('GET /.well-known/agent-card.json returns A2A v1.0 card (200)', async () => {
  const res = await fetch(`${base}/.well-known/agent-card.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/(a2a\+)?json/);
  const card = await res.json();
  assert.equal(card.name, 'XFuel');
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  assert.ok(Array.isArray(card.skills));
  assert.ok(card.skills.some((s) => s.id === 'register-agent'));
});

test('POST /v1/agents/register without task_id / wallet is 400', async () => {
  const res = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'validation_error');
});

test('GET /llms.txt and /openapi.json mention register honestly', async () => {
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /\/v1\/agents\/register/);
  assert.match(llms, /agent-card\.json/);
  assert.doesNotMatch(llms, /unmetered/i);
  assert.doesNotMatch(llms, /XFUEL_PAYER_PRIVATE_KEY/);

  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.ok(spec.paths['/v1/agents/register']);
  assert.equal(spec.paths['/v1/chat/completions'].post['x-payment-info'].price.amount, '0.01');
});

test('packages/mcp has no XFUEL_PAYER_PRIVATE_KEY', () => {
  const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/mcp');
  const hits = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === 'package-lock.json') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|js|md|json|example)$/.test(name) || name === '.env.example') {
        const text = readFileSync(p, 'utf8');
        if (text.includes('XFUEL_PAYER_PRIVATE_KEY')) hits.push(p);
      }
    }
  }

  walk(mcpRoot);
  assert.deepEqual(hits, [], `human payer-key path still present:\n${hits.join('\n')}`);
});
