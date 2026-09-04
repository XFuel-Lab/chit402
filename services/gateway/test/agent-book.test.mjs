/**
 * Possession-gated last-N spend book.
 *
 * Unauth / wrong proof → 401/403 empty body (no agent_id leak).
 * Demo / unmetered / collected:false never appear. Only the requested
 * agent_id. Dedup still holds. /v1 402 unchanged.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_SOLANA_ENABLED = 'true';
process.env.X402_SOLANA_PAY_TO = 'SolanaATAaddress123456789012345678901234';
process.env.X402_SOLANA_NETWORK = 'solana';
process.env.TASK_STORE_PERSIST = 'false';

const { createApp } = await import('../src/server.js');
const { canonicalSignedPayload, verifyReceiptHmac } = await import('../src/receipt.js');
const { AgentRegistry, registerAgent } = await import('../src/agent-registry.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const {
  readAgentBook,
  bindBookVerifier,
  bookHmacPayload,
  clampBookLimit,
} = await import('../src/agent-book.js');

const VERIFY_KEY = 'unit-test-hmac';
const WALLET_A = '0x1111111111111111111111111111111111111111';
const WALLET_B = '0x2222222222222222222222222222222222222222';

function sign(receipt, secret = VERIFY_KEY) {
  const value = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  receipt.hmac_attestation = { alg: 'HMAC-SHA256', payload_version: 5, value: `sha256=${value}`, role: 'attestor' };
  return receipt;
}

function collectedReceipt(over = {}) {
  return sign({
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id || 'task-paid-1',
    status: 'completed',
    proof_outcome: 'valid',
    proof: { tier: 'signed' },
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || 'base:0xabc123',
      collected: true,
      net_amount: '9950',
      fee_amount: '50',
      gross_amount: over.amount || '10000',
    },
    route: { model: over.model || 'xfuel/auto', provider: over.hub || 'mock' },
    output: { hash: '0x' + 'ab'.repeat(32) },
    verify_url: 'https://api.xfuel.app/receipt/task-paid-1',
    ...over,
  });
}

function deps(receipts, extra = {}) {
  const store = new Map(Object.entries(receipts));
  const registry = extra.registry || new AgentRegistry();
  const ledger = extra.ledger || new UsageSettledLedger();
  return {
    registry,
    ledger,
    loadReceipt: async (id) => store.get(id) || null,
    verify: (r) => verifyReceiptHmac(r, VERIFY_KEY, { sigField: 'hmac_attestation' }),
    bindWallet: async (w) => ({ ok: true, address: w, kind: 'aawp', official: true }),
    postA2A: async (fields) => ({ message_id: 'a2a-test', status: 'accepted', ...fields }),
    ...extra,
  };
}

function hmacProof(session, agentId, window) {
  const digest = crypto.createHmac('sha256', session).update(bookHmacPayload(agentId, window)).digest('hex');
  return `sha256=${digest}`;
}

async function emptyBody(res) {
  const text = await res.text();
  return text;
}

test('clampBookLimit defaults to 50 and caps at 200', () => {
  assert.equal(clampBookLimit(undefined), 50);
  assert.equal(clampBookLimit(0), 50);
  assert.equal(clampBookLimit(-1), 50);
  assert.equal(clampBookLimit(200), 200);
  assert.equal(clampBookLimit(999), 200);
  assert.equal(clampBookLimit(7), 7);
});

test('book with session returns last-N collected rows for that agent_id only', async () => {
  const a = collectedReceipt({ task_id: 'task-a', ref: 'base:0xa', amount: '10000', model: 'theta/glm', hub: 'theta' });
  const d = deps({ 'task-a': a });
  const registered = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-a' }, d);
  assert.equal(registered.ok, true);
  const agentId = registered.body.agent_id;
  const session = registered.body.session;

  d.ledger.append(collectedReceipt({
    task_id: 'task-a2', ref: 'base:0xa2', amount: '20000', rail: 'solana', model: 'xfuel/auto', hub: 'akash',
  }), { agentId });
  d.ledger.append(collectedReceipt({
    task_id: 'task-b', ref: 'base:0xb', amount: '50000',
  }), { agentId: agentId + 9 });

  const book = readAgentBook(agentId, { session }, {
    ledger: d.ledger,
    verify: bindBookVerifier(d.registry),
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.agent_id, agentId);
  assert.equal(book.body.limit, 50);
  assert.equal(book.body.entries.length, 2);
  assert.equal(book.body.entries.every((e) => typeof e.task_id === 'string'), true);
  assert.ok(book.body.entries.every((e) => e.task_id !== 'task-b'));
  assert.equal(book.body.totals.count, 2);
  assert.equal(book.body.totals.usdc_sum, '30000');
  assert.equal(book.body.totals.by_rail.usdc.count, 1);
  assert.equal(book.body.totals.by_rail.solana.count, 1);
  assert.ok(!JSON.stringify(book.body).includes(WALLET_A), 'pack does not name the payer');
  const first = book.body.entries.find((e) => e.task_id === 'task-a');
  assert.equal(first.payment.ref, 'base:0xa');
  assert.equal(first.payment.rail, 'usdc');
  assert.equal(first.payment.amount, '10000');
  assert.equal(first.route.model, 'theta/glm');
  assert.equal(first.route.hub, 'theta');
  assert.ok(first.collected_at);
});

test('HMAC over agent_id + window is valid possession', async () => {
  const a = collectedReceipt({ task_id: 'task-h', ref: 'base:0xh' });
  const d = deps({ 'task-h': a });
  const registered = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-h' }, d);
  const agentId = registered.body.agent_id;
  const proof = hmacProof(registered.body.session, agentId, 50);
  const book = readAgentBook(agentId, { proof }, {
    ledger: d.ledger,
    verify: bindBookVerifier(d.registry),
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.entries.length, 1);
});

test('unauth book is 401 with empty body', () => {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const miss = readAgentBook(1, {}, { ledger, verify: bindBookVerifier(registry) });
  assert.equal(miss.status, 401);
  assert.equal(miss.body, null);
});

test('wrong possession and unknown agent_id are 403 with empty body', async () => {
  const a = collectedReceipt({ task_id: 'task-w', ref: 'base:0xw' });
  const d = deps({ 'task-w': a });
  const registered = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-w' }, d);
  const verify = bindBookVerifier(d.registry);

  const wrong = readAgentBook(registered.body.agent_id, { session: 'not-the-session' }, {
    ledger: d.ledger,
    verify,
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body, null);

  const unknown = readAgentBook(99999, { session: registered.body.session }, {
    ledger: d.ledger,
    verify,
  });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.body, null);
  assert.deepEqual(wrong, unknown);
});

test('demo / unmetered / collected:false rows never appear', async () => {
  const a = collectedReceipt({ task_id: 'task-q', ref: 'base:0xq' });
  const d = deps({ 'task-q': a });
  const registered = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-q' }, d);
  const agentId = registered.body.agent_id;

  const demo = d.ledger.append({
    task_id: 'task-demo',
    payment: { rail: 'unmetered', ref: 'demo:1', collected: false, gross_amount: '0' },
  }, { agentId });
  assert.equal(demo.ok, false);

  d.ledger.entries.push({
    task_id: 'sneak-unmetered',
    payment_ref: 'unmetered:1',
    agent_id: agentId,
    collected: true,
    rail: 'unmetered',
    amount: '0',
  });
  d.ledger.entries.push({
    task_id: 'sneak-false',
    payment_ref: 'base:0xfalse',
    agent_id: agentId,
    collected: false,
    rail: 'usdc',
    amount: '10000',
  });

  const book = readAgentBook(agentId, { session: registered.body.session }, {
    ledger: d.ledger,
    verify: bindBookVerifier(d.registry),
  });
  assert.equal(book.status, 200);
  assert.deepEqual(book.body.entries.map((e) => e.task_id), ['task-q']);
  assert.equal(book.body.totals.count, 1);
});

test('only the requested agent_id appears', async () => {
  const a = collectedReceipt({ task_id: 'task-1', ref: 'base:0x1' });
  const b = collectedReceipt({ task_id: 'task-2', ref: 'base:0x2' });
  const d = deps({ 'task-1': a, 'task-2': b });
  const first = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-1' }, d);
  const second = await registerAgent({ agentWallet: WALLET_B, task_id: 'task-2' }, d);
  const book = readAgentBook(first.body.agent_id, { session: first.body.session }, {
    ledger: d.ledger,
    verify: bindBookVerifier(d.registry),
  });
  assert.equal(book.body.entries.length, 1);
  assert.equal(book.body.entries[0].task_id, 'task-1');
  assert.equal(book.body.agent_id, first.body.agent_id);
  assert.notEqual(first.body.agent_id, second.body.agent_id);
});

test('dedup still holds on payment.ref and task_id', async () => {
  const a = collectedReceipt({ task_id: 'task-d1', ref: 'base:0xsame' });
  const b = collectedReceipt({ task_id: 'task-d2', ref: 'base:0xsame' });
  const d = deps({ 'task-d1': a, 'task-d2': b });
  const first = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-d1' }, d);
  const second = await registerAgent({ agentWallet: WALLET_B, task_id: 'task-d2' }, d);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'duplicate_ref');
  assert.equal(d.ledger.entries.length, 1);

  const again = d.ledger.append(a, { agentId: first.body.agent_id });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'duplicate_ref');
});

test('limit hard-max 200', async () => {
  const a = collectedReceipt({ task_id: 'task-lim', ref: 'base:0xlim' });
  const d = deps({ 'task-lim': a });
  const registered = await registerAgent({ agentWallet: WALLET_A, task_id: 'task-lim' }, d);
  for (let i = 0; i < 210; i++) {
    d.ledger.append(collectedReceipt({
      task_id: `task-extra-${i}`,
      ref: `base:0xextra${i}`,
      amount: '10000',
    }), { agentId: registered.body.agent_id });
  }
  const book = readAgentBook(registered.body.agent_id, {
    session: registered.body.session,
    limit: 1000,
  }, {
    ledger: d.ledger,
    verify: bindBookVerifier(d.registry),
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.limit, 200);
  assert.equal(book.body.entries.length, 200);
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

test('unauth GET/POST book is 401 with empty body and no agent leak', async () => {
  const getRes = await fetch(`${base}/v1/agents/1/book`);
  const postRes = await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(getRes.status, 401);
  assert.equal(postRes.status, 401);
  assert.equal(await emptyBody(getRes), '');
  assert.equal(await emptyBody(postRes), '');
});

test('wrong possession is 403 with empty body for existing and missing agent_id', async () => {
  const a = await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'wrong' }),
  });
  const b = await fetch(`${base}/v1/agents/999999/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'wrong' }),
  });
  assert.equal(a.status, 403);
  assert.equal(b.status, 403);
  assert.equal(await emptyBody(a), '');
  assert.equal(await emptyBody(b), '');
});

test('API key is not possession', async () => {
  const res = await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'xfuel-demo' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
  assert.equal(await emptyBody(res), '');
});

test('GET /v1/agents is not a public list', async () => {
  const res = await fetch(`${base}/v1/agents`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
  assert.doesNotMatch(JSON.stringify(body), /scoreboard/i);
});

test('unauth GET/POST {} /v1/chat/completions is 402, amount 2000, both rails', async () => {
  const getRes = await fetch(`${base}/v1/chat/completions`);
  const postRes = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(getRes.status, 402);
  assert.equal(postRes.status, 402);
  const getBody = await getRes.json();
  const postBody = await postRes.json();
  assert.equal(getBody.accepts[0].amount, '2000');
  assert.equal(postBody.accepts[0].amount, '2000');
  assert.equal(getBody.accepts.length, 2);
  assert.equal(postBody.accepts.length, 2);
  const nets = postBody.accepts.map((a) => a.network);
  assert.ok(nets.some((n) => String(n).startsWith('eip155:')));
  assert.ok(nets.some((n) => String(n).startsWith('solana')));
});

test('GET /llms.txt names the book as possession-gated; paid door stays chat', async () => {
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /possession-gated/);
  assert.match(llms, /\/v1\/agents\/:agent_id\/book/);
  assert.match(llms, /POST \/v1\/chat\/completions/);
  assert.doesNotMatch(llms, /public door is POST \/task-request/i);
});
