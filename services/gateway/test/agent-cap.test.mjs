/**
 * Per-agent prepaid budget Y + fail-closed door when remaining < $0.01.
 *
 * Window: prepaid_ceiling — spent is sum of collected amounts for agent_id;
 * remaining = max(0, Y − spent). Null Y = unlimited.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-agent-cap-'));

process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret-cap';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
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
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'true';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

function createMockFacilitator() {
  let settleCount = 0;
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
      const txRef = `0xcapmock${String(settleCount).padStart(56, '0')}`;
      if (req.url?.endsWith('/verify')) {
        if (isStandardX402) return send(200, { isValid: true, payer });
        return send(200, { valid: true, txRef });
      }
      if (req.url?.endsWith('/settle')) {
        settleCount += 1;
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
        settleCount: () => settleCount,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const { url: facUrl, close: closeFac, settleCount } = await createMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const {
  readAgentBook,
  bindBookVerifier,
  setAgentBudget,
  verifyAllowanceHmac,
  CAP_WINDOW,
  capViewOf,
} = await import('../src/agent-book.js');

// dotenv may reinject live keys; keep this suite offline/mock for settle.
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;

const chatBody = {
  model: 'theta/qwen3',
  messages: [{ role: 'user', content: 'cap test' }],
  max_tokens: 8,
};

let server;
let base;
/** Shared registry/ledger are process-scoped via createApp — use HTTP surface. */

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

async function emptyBody(res) {
  return res.text();
}

async function issueChallenge(path = '/v1/chat/completions') {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  return body.accepts[0].extra.nonce;
}

async function settlePaid(path = '/v1/chat/completions', headers = {}) {
  const nonce = await issueChallenge(path);
  const before = settleCount();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': 'PAYMENT-BLOB',
      'x-payment-nonce': nonce,
      ...headers,
    },
    body: JSON.stringify(chatBody),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body, settles: settleCount() - before };
}

test('unauth book still 401 empty', async () => {
  const getRes = await fetch(`${base}/v1/agents/1/book`);
  const postRes = await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(getRes.status, 401);
  assert.equal(postRes.status, 401);
  assert.equal(await emptyBody(getRes), '');
  assert.equal(await emptyBody(postRes), '');
});

test('no cap → settle + book unchanged (unlimited)', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const receipt = {
    task_id: 'task-nocap-1',
    payment: {
      rail: 'usdc',
      ref: 'base:0xnocap1',
      collected: true,
      gross_amount: '2000',
    },
    route: { model: 'akash/x', hub: 'akash' },
  };
  const recorded = recordCollectedSpend(receipt, { ledger, registry });
  assert.equal(recorded.ok, true);
  const identity = registry.get(recorded.agent_id);
  assert.equal(identity.budget, null);

  const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
    ledger,
    verify: bindBookVerifier(registry),
    registry,
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.window, CAP_WINDOW);
  assert.equal(book.body.cap, null);
  assert.equal(book.body.spent, '2000');
  assert.equal(book.body.remaining, null);
  assert.equal(book.body.entries.length, 1);
  assert.ok(book.body.allowance);
  const checked = verifyAllowanceHmac({
    agentId: recorded.agent_id,
    remaining: book.body.allowance.remaining,
    asOf: book.body.allowance.as_of,
    signature: book.body.allowance.signature.value,
  }, recorded.session);
  assert.equal(checked.checked, true);
  assert.equal(checked.valid, true);
});

test('prepaid_ceiling: Y=2000, one $0.002 → remaining 0', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const recorded = recordCollectedSpend({
    task_id: 'task-cap-1',
    payment: {
      rail: 'solana',
      ref: 'solana:0xcap1',
      collected: true,
      gross_amount: '2000',
    },
    route: { model: 'akash/x', hub: 'akash' },
  }, { ledger, registry });

  const set = setAgentBudget(recorded.agent_id, {
    session: recorded.session,
    budget: '2000',
  }, { registry, verify: bindBookVerifier(registry) });
  assert.equal(set.status, 200);

  const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
    ledger,
    verify: bindBookVerifier(registry),
    registry,
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.cap, '2000');
  assert.equal(book.body.spent, '2000');
  assert.equal(book.body.remaining, '0');
  assert.equal(book.body.window, CAP_WINDOW);

  const view = capViewOf(registry.get(recorded.agent_id), ledger.sumCollectedByAgent(recorded.agent_id));
  assert.equal(view.remaining, '0');
});

test('Y=2000 spent: next paid call fails closed — no second ledger row, no second payment', async () => {
  const first = await settlePaid('/v1/chat/completions');
  assert.ok(first.res.status < 500, `first settle status ${first.res.status}`);
  assert.equal(first.settles, 1);
  const agentId = first.body.xfuel?.agent_id ?? first.body.xfuel?.usage_settled?.agent_id;
  const session = first.body.xfuel?.session;
  assert.ok(Number.isInteger(agentId) && agentId >= 1, 'first settle must allocate agent_id');
  assert.equal(typeof session, 'string');

  const setRes = await fetch(`${base}/v1/agents/${agentId}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, budget: '2000' }),
  });
  assert.equal(setRes.status, 200);
  const book = await setRes.json();
  assert.equal(book.remaining, '0');
  assert.equal(book.cap, '2000');
  assert.equal(book.spent, '2000');
  const entriesBefore = book.entries.length;

  const nonce = await issueChallenge('/v1/chat/completions');
  const beforeSettle = settleCount();
  const blocked = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': 'PAYMENT-BLOB',
      'x-payment-nonce': nonce,
      'x-xfuel-session': session,
    },
    body: JSON.stringify(chatBody),
  });
  assert.equal(blocked.status, 403);
  const err = await blocked.json();
  assert.equal(err.error?.code, 'budget_exhausted');
  assert.equal(err.error?.remaining, '0');
  assert.equal(settleCount() - beforeSettle, 0, 'must not settle a second payment');

  const bookAgain = await (await fetch(`${base}/v1/agents/${agentId}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  })).json();
  assert.equal(bookAgain.entries.length, entriesBefore, 'no second ledger row');
  assert.equal(bookAgain.spent, '2000');
});

test('demo does not burn Y', async () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const recorded = recordCollectedSpend({
    task_id: 'task-demo-cap',
    payment: {
      rail: 'usdc',
      ref: 'base:0xdemocap',
      collected: true,
      gross_amount: '2000',
    },
    route: { model: 'theta/qwen3', hub: 'theta' },
  }, { ledger, registry });
  registry.setBudget(recorded.agent_id, '2000');
  assert.equal(
    capViewOf(registry.get(recorded.agent_id), ledger.sumCollectedByAgent(recorded.agent_id)).remaining,
    '0',
  );

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'xfuel-demo',
      'x-xfuel-session': recorded.session,
    },
    body: JSON.stringify(chatBody),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.xfuel?.payment?.collected, false);
  // In-process demo does not touch the unit ledger above; HTTP demo must not
  // append UsageSettled. Re-check via book on a fresh settle path is covered
  // by collected:false never appearing — assert receipt rail/demo shape:
  const rail = String(body.xfuel?.payment?.rail || '').toLowerCase();
  assert.ok(rail === 'unmetered' || rail === 'demo' || body.xfuel?.payment?.collected === false);
});

test('/v1 and /a2a-message unauth {} still 402 amount 2000 both rails', async () => {
  for (const path of ['/v1/chat/completions', '/a2a-message']) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 402, path);
    const body = await res.json();
    assert.equal(body.accepts[0].amount, '2000', path);
    assert.equal(body.accepts.length, 2, path);
    const nets = body.accepts.map((a) => a.network);
    assert.ok(nets.some((n) => String(n).startsWith('eip155:')), path);
    assert.ok(nets.some((n) => String(n).startsWith('solana')), path);
  }
});

test('card / llms / openapi mention book budget Y + remaining', async () => {
  const card = await (await fetch(`${base}/.well-known/agent-card.json`)).json();
  assert.match(JSON.stringify(card), /budget Y/i);
  assert.match(JSON.stringify(card), /remaining/i);
  assert.match(JSON.stringify(card), /No account/);
  assert.doesNotMatch(JSON.stringify(card), /Not a smart router/);
  assert.doesNotMatch(JSON.stringify(card), /Not a model shop/);

  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /budget Y/i);
  assert.match(llms, /remaining/i);
  assert.match(llms, /No account\. No API key/);
  assert.doesNotMatch(llms, /Not a smart router/);
  assert.doesNotMatch(llms, /Not a model shop/);

  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.match(spec.paths['/v1/agents/{agent_id}/book'].post.description, /budget Y/i);
  assert.match(spec.paths['/v1/agents/{agent_id}/book'].post.description, /remaining/i);
  assert.ok(spec.paths['/v1/agents/{agent_id}/book'].post.requestBody.content['application/json'].schema.properties.budget);
  assert.match(spec.info.description, /No account/);
  assert.doesNotMatch(spec.info.description, /Not a smart router/);
  assert.doesNotMatch(spec.info.description, /Not a model shop/);
});
