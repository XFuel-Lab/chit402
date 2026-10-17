/**
 * Possession-gated reads are never cacheable.
 *
 * Every GET that needs the agent's session or book proof sends
 * `Cache-Control: private, no-store`, names the secret headers in Vary,
 * and sends no ETag, on success and on 401, 403 and 5xx. Public routes keep
 * their own headers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { bookHmacPayload } = await import('../src/agent-book.js');
const { recordCollectedSpend } = await import('../src/usage-settled.js');

const TASK_ID = 'private-read-cache-task-1';

let app;
let server;
let base;
let agent;
let other;

before(async () => {
  await initAIListener();
  app = await createApp();
  const registry = app.locals.__test.agentRegistry;
  agent = registry.allocate({});
  other = registry.allocate({});
  agent.agentWallet = '0x1111111111111111111111111111111111111111';
  other.agentWallet = '0x2222222222222222222222222222222222222222';
  await recordCollectedSpend({
    schema: 'xfuel.receipt.v4',
    task_id: TASK_ID,
    status: 'completed',
    payment: { rail: 'usdc', ref: 'base:0xprivatereadcache1', collected: true, gross_amount: '2000' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  }, { ledger: app.locals.__test.usageSettled, registry, agentId: agent.agent_id });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function varyNames(res) {
  return String(res.headers.get('vary') || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function assertPrivate(res, label, extraVary = []) {
  assert.equal(res.headers.get('cache-control'), 'private, no-store', `${label}: Cache-Control`);
  const vary = varyNames(res);
  for (const name of ['x-xfuel-session', 'x-xfuel-book-proof', ...extraVary]) {
    assert.ok(vary.includes(name), `${label}: Vary has ${name} (got ${vary.join(', ')})`);
  }
  assert.equal(res.headers.get('etag'), null, `${label}: no ETag`);
}

function proofFor(row, window = 50) {
  const digest = crypto.createHmac('sha256', row.session)
    .update(bookHmacPayload(row.agent_id, window))
    .digest('hex');
  return `sha256=${digest}`;
}

const routes = [
  { name: 'book', path: (id) => `/v1/agents/${id}/book` },
  { name: 'lineage', path: (id) => `/v1/agents/${id}/book/lineage/${TASK_ID}` },
  { name: 'policy', path: (id) => `/v1/agents/${id}/book/policy`, proof: true },
  { name: 'export', path: (id) => `/v1/agents/${id}/book/export?limit=50`, proof: true },
  { name: 'gaps', path: (id) => `/v1/agents/${id}/book/gaps`, proof: true },
  { name: 'assign', path: (id) => `/v1/agents/${id}/book/assign` },
  { name: 'dispute', path: (id) => `/v1/agents/${id}/book/dispute` },
  { name: 'a2a-escrow', path: (id) => `/v1/agents/${id}/book/a2a-escrow` },
  { name: 'webhook', path: (id) => `/v1/agents/${id}/book/webhook` },
];

for (const route of routes) {
  test(`GET ${route.name}: private, no-store on 401, 403 and the owner's read`, async () => {
    const url = `${base}${route.path(agent.agent_id)}`;

    const unauth = await fetch(url);
    assert.equal(unauth.status, 401, `${route.name}: no secret is 401`);
    assertPrivate(unauth, `${route.name} 401`);

    const wrong = await fetch(url, { headers: { 'x-xfuel-session': other.session } });
    assert.equal(wrong.status, 403, `${route.name}: another agent's session is 403`);
    assertPrivate(wrong, `${route.name} 403`);

    const owner = await fetch(url, {
      headers: { 'x-xfuel-session': agent.session, 'if-none-match': '*' },
    });
    assert.notEqual(owner.status, 304, `${route.name}: a conditional GET never gets 304`);
    assert.equal(owner.status, 200, `${route.name}: owner read status`);
    assertPrivate(owner, `${route.name} owner`);
    await owner.arrayBuffer();

    if (route.proof) {
      const byProof = await fetch(url, { headers: { 'x-xfuel-book-proof': proofFor(agent) } });
      assert.equal(byProof.status, 200, `${route.name}: book proof is accepted`);
      assertPrivate(byProof, `${route.name} proof`);
    }
  });
}

test('GET book: the owner read is 200 and still has no ETag on a repeat', async () => {
  const url = `${base}/v1/agents/${agent.agent_id}/book`;
  const first = await fetch(url, { headers: { 'x-xfuel-session': agent.session } });
  assert.equal(first.status, 200);
  assertPrivate(first, 'book first');
  await first.json();
  const second = await fetch(url, { headers: { 'x-xfuel-session': agent.session } });
  assert.equal(second.status, 200);
  assertPrivate(second, 'book second');
  await second.json();
});

test('GET book: HEAD carries the same headers', async () => {
  const res = await fetch(`${base}/v1/agents/${agent.agent_id}/book`, {
    method: 'HEAD',
    headers: { 'x-xfuel-session': agent.session },
  });
  assert.equal(res.status, 200);
  assertPrivate(res, 'book HEAD');
});

test('GET gaps: a 500 is private, no-store too', async () => {
  const ledger = app.locals.__test.usageSettled;
  const original = ledger.seqReport;
  ledger.seqReport = () => { throw new Error('forced'); };
  try {
    const res = await fetch(`${base}/v1/agents/${agent.agent_id}/book/gaps`, {
      headers: { 'x-xfuel-session': agent.session },
    });
    assert.equal(res.status, 500);
    assertPrivate(res, 'gaps 500');
    const body = await res.json();
    assert.equal(body.code, 'book_gaps_failed');
  } finally {
    ledger.seqReport = original;
  }
});

test('GET slice: private, no-store on 401, a bad token and a good token', async () => {
  const vary = ['x-xfuel-assign-token'];
  const none = await fetch(`${base}/v1/book/slice`);
  assert.equal(none.status, 401);
  assertPrivate(none, 'slice 401', vary);

  const bad = await fetch(`${base}/v1/book/slice`, { headers: { 'x-xfuel-assign-token': 'not-a-token' } });
  assert.ok(bad.status >= 400 && bad.status < 500, `slice bad token status ${bad.status}`);
  assertPrivate(bad, 'slice bad token', vary);

  const made = await fetch(`${base}/v1/agents/${agent.agent_id}/book/assign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xfuel-session': agent.session },
    body: JSON.stringify({ grantee: 'auditor', slice: { limit: 5 } }),
  });
  assert.equal(made.status, 201);
  const { token } = await made.json();
  assert.equal(typeof token, 'string');

  const good = await fetch(`${base}/v1/book/slice`, {
    headers: { 'x-xfuel-assign-token': token, 'if-none-match': '*' },
  });
  assert.equal(good.status, 200);
  assertPrivate(good, 'slice 200', vary);
  await good.json();
});

test('public routes keep their own headers', async () => {
  const llms = await fetch(`${base}/llms.txt`);
  assert.equal(llms.status, 200);
  assert.notEqual(llms.headers.get('cache-control'), 'private, no-store');
  assert.ok(llms.headers.get('etag'), 'llms.txt keeps its ETag');
  assert.ok(!varyNames(llms).includes('x-xfuel-session'));
  await llms.text();

  const receipt = await fetch(`${base}/receipt/no-such-task`, { headers: { accept: 'application/json' } });
  assert.equal(receipt.status, 404);
  assert.ok(!varyNames(receipt).includes('x-xfuel-session'), 'public receipt Vary is unchanged');
  assert.ok(!varyNames(receipt).includes('x-xfuel-book-proof'));
  await receipt.text();
});
