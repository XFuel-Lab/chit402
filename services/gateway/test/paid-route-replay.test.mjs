/**
 * Each paid route settles once. A second copy of the same payment does not
 * run the handler again. Only chat, responses, and a2a opt in to the stored body.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Wallet } from 'ethers';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';

import { evmAuthHeader } from './helpers/evm-auth-header.mjs';

// An hour out: inside the gateway's validBefore window.
const VALID_BEFORE = String(Math.floor(Date.now() / 1000) + 3600);
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_PAY_TO = '0x1111111111111111111111111111111111111111';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'true';
process.env.TASK_STORE_PERSIST = 'false';
delete process.env.THETA_EDGECLOUD_API_KEY;
delete process.env.THETA_EDGE_URL;
delete process.env.AKASHML_API_KEY;

const { url: facUrl, close: closeFac, server: facServer } = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { paidFulfillmentRuns, resetPaidFulfillmentRuns } = await import('../src/paid-response-replay.js');
const { canonicalRegisterPayMessage } = await import('../src/agent-registry.js');
const { setForeignIngestVerifyForTests } = await import('../src/foreign-x402-ingest.js');
const { registerBoardRoutes } = await import('../src/board-routes.js');
const { registerBoardJobRoutes } = await import('../src/board-job-routes.js');
const { BoardPostStore } = await import('../src/board-posts.js');
const { BoardJobStore } = await import('../src/board-jobs.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const { bindBookVerifier } = await import('../src/agent-book.js');
const { runX402Handshake } = await import('../src/x402-server.js');
const config = (await import('../src/config.js')).default;

const WALLET_A = '0x1111111111111111111111111111111111111111';

let server;
let base;
let app;

function replayCode(body) {
  if (!body || typeof body !== 'object') return null;
  return body?.error?.code || body?.code || (typeof body.error === 'string' ? body.error : null);
}

async function read(res) {
  const raw = await res.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  return { status: res.status, raw, body };
}

async function post(url, { headers = {}, body = {}, payment = undefined, nonce = undefined } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (nonce) h['x-payment-nonce'] = nonce;
  if (payment !== undefined && payment !== null) h['x-payment'] = payment;
  return await read(await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) }));
}

before(async () => {
  setForeignIngestVerifyForTests(async (args) => ({
    valid: true,
    payer: args?.payer || WALLET_A,
    txHash: args?.paymentRef,
    blockNumber: 12,
  }));
  await initAIListener();
  app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  setForeignIngestVerifyForTests(null);
  await closeFac();
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function nonceOf(body) {
  return body?.accepts?.[0]?.extra?.nonce || null;
}

/**
 * One challenge, one settle, a second copy that does not run the handler.
 * closed routes expect 409. stored routes expect the original bytes.
 */
async function replayRoute({
  url, body, headers = {}, payment = evmAuthHeader(), okStatus, stored = false, sideEffect = null,
}) {
  const open = await post(url, { headers, body });
  assert.equal(open.status, 402, open.raw);
  const nonce = nonceOf(open.body);
  assert.ok(nonce, open.raw);
  const settlesBefore = facServer.settleCount;
  if (stored) resetPaidFulfillmentRuns();
  const first = await post(url, { headers, body, payment, nonce });
  assert.equal(first.status, okStatus, first.raw);
  const afterFirst = typeof sideEffect === 'function' ? sideEffect() : null;
  const second = await post(url, { headers, body, payment, nonce });
  if (typeof sideEffect === 'function') assert.equal(sideEffect(), afterFirst);
  assert.equal(facServer.settleCount - settlesBefore, 1, second.raw);
  if (stored) {
    assert.equal(second.status, okStatus, second.raw);
    assert.equal(second.raw, first.raw);
    assert.equal(paidFulfillmentRuns(), 1);
  } else {
    assert.equal(second.status, 409, second.raw);
    assert.equal(replayCode(second.body), 'payment_replayed');
    const taskId = first.body?.task_id || first.body?.xfuel?.task_id || null;
    const ref = first.body?.payment_ref || first.body?.payment?.ref || first.body?.xfuel?.payment?.ref || null;
    if (taskId) assert.equal(second.raw.includes(taskId), false);
    if (ref) assert.equal(second.raw.includes(String(ref)), false);
    if (first.body?.session) assert.equal(second.raw.includes(first.body.session), false);
  }
  return { first, second, nonce };
}

test('POST /task-request exact replay is 409 and does not open a second task', async () => {
  const { first } = await replayRoute({
    url: `${base}/task-request`,
    okStatus: 202,
    sideEffect: () => getAIListener().activeTasks.size,
    body: {
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'theta/qwen3',
      input: 'hello',
    },
  });
  assert.ok(first.body.task_id);
});

test('POST /v1/chat/completions resends the stored bytes and does not run again', async () => {
  await replayRoute({
    url: `${base}/v1/chat/completions`,
    okStatus: 200,
    stored: true,
    body: {
      model: 'xfuel/auto',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16,
    },
  });
});

test('POST /v1/responses resends the stored bytes and does not run again', async () => {
  await replayRoute({
    url: `${base}/v1/responses`,
    okStatus: 200,
    stored: true,
    body: { model: 'xfuel/auto', input: 'ping', max_output_tokens: 16 },
  });
});

test('POST /a2a-message resends the stored bytes and does not run again', async () => {
  await replayRoute({
    url: `${base}/a2a-message`,
    okStatus: 200,
    stored: true,
    body: {
      model: 'xfuel/auto',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16,
    },
  });
});

test('POST /v1/agents/register exact replay is 409 and does not register again', async () => {
  const signer = Wallet.createRandom();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(canonicalRegisterPayMessage(signer.address, timestamp));
  const payment = Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: { from: signer.address, to: config.x402.payTo, value: '2000', validBefore: VALID_BEFORE, nonce: `0x${'ab'.repeat(32)}` },
    },
  }), 'utf8').toString('base64');
  const ledger = app.locals.__test.usageSettled;
  const { first } = await replayRoute({
    url: `${base}/v1/agents/register`,
    okStatus: 200,
    payment,
    sideEffect: () => ledger.entries.length,
    body: {
      agentWallet: signer.address,
      wallet_signature: signature,
      signature_timestamp: timestamp,
    },
  });
  assert.ok(first.body.agent_id);
  assert.ok(ledger.entries.length >= 1);
});

test('POST /v1/agents/:agent_id/book/ingest exact replay is 409 and does not ingest again', async () => {
  const registry = app.locals.__test.agentRegistry;
  const identity = registry.allocate({ taskId: 'ingest-replay' });
  registry.bindWallet(identity.agent_id, { agentWallet: WALLET_A });
  const ledger = app.locals.__test.usageSettled;
  const url = `${base}/v1/agents/${identity.agent_id}/book/ingest`;
  const invoice = (tx) => ({
    session: identity.session,
    payment_required: {
      resource: 'https://api.shop.io/v1/infer',
      amount: '5000',
      payTo: '0x2222222222222222222222222222222222222222',
    },
    payment_response: { tx, payer: WALLET_A, network: 'base' },
  });
  const open = await post(url, { body: invoice(`0x${'a1'.repeat(32)}`) });
  assert.equal(open.status, 402, open.raw);
  const nonce = nonceOf(open.body);
  assert.ok(nonce, open.raw);
  const settlesBefore = facServer.settleCount;
  const first = await post(url, {
    body: invoice(`0x${'a1'.repeat(32)}`),
    payment: evmAuthHeader('PAYMENT-BLOB'),
    nonce,
  });
  assert.equal(first.status, 201, first.raw);
  const rows = ledger.entries.length;
  const second = await post(url, {
    body: invoice(`0x${'b2'.repeat(32)}`),
    payment: evmAuthHeader('PAYMENT-BLOB'),
    nonce,
  });
  assert.equal(second.status, 409, second.raw);
  assert.equal(replayCode(second.body), 'payment_replayed');
  assert.equal(ledger.entries.length, rows);
  assert.equal(facServer.settleCount - settlesBefore, 1);
  assert.equal(second.raw.includes(first.body.task_id), false);
});

function boardApp(register) {
  const board = express();
  board.use(express.json());
  const registry = new AgentRegistry();
  const actor = registry.allocate();
  registry.bindWallet(actor.agent_id, { agentWallet: WALLET_A });
  const ledger = new UsageSettledLedger();
  const posts = new BoardPostStore();
  const jobs = new BoardJobStore();
  register(board, { registry, ledger, posts, jobs, actor });
  return { board, posts, jobs, actor };
}

test('POST /v1/board/posts exact replay is 409 and does not post again', async () => {
  const { board, posts, actor } = boardApp((appBoard, ctx) => {
    registerBoardRoutes(appBoard, {
      posts: ctx.posts,
      ledger: ctx.ledger,
      registry: ctx.registry,
      verify: bindBookVerifier(ctx.registry),
      isDemoKey: () => false,
      x402Enabled: true,
      runX402Handshake,
      setPaymentHeaders: () => {},
      baseUrlFor: () => 'https://api.chit402.com',
      peekStampWaiver: () => ({ eligible: false }),
      commitStampWaiver: () => {},
    });
  });
  const started = await new Promise((resolve) => {
    const s = board.listen(0, () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${started.address().port}/v1/board/posts`;
    await replayRoute({
      url,
      okStatus: 201,
      headers: { 'x-xfuel-session': actor.session },
      sideEffect: () => posts.list().length,
      body: {
        endpoint: 'https://example.com/v1',
        outcome: 'success',
        text: 'one stamp',
      },
    });
    assert.equal(posts.list().length, 1);
  } finally {
    if (typeof started.closeAllConnections === 'function') started.closeAllConnections();
    await new Promise((resolve) => started.close(resolve));
  }
});

test('POST /v1/board/jobs exact replay is 409 and does not open a second job', async () => {
  const { board, jobs, actor } = boardApp((appBoard, ctx) => {
    registerBoardJobRoutes(appBoard, {
      jobs: ctx.jobs,
      posts: ctx.posts,
      ledger: ctx.ledger,
      registry: ctx.registry,
      verify: bindBookVerifier(ctx.registry),
      isDemoKey: () => false,
      x402Enabled: true,
      runX402Handshake,
      setPaymentHeaders: () => {},
      baseUrlFor: () => 'https://api.chit402.com',
      peekStampWaiver: () => ({ eligible: false }),
      commitStampWaiver: () => {},
      chitPayTo: config.x402.payTo,
      persistTask: () => {},
      signingSecret: null,
    });
  });
  const started = await new Promise((resolve) => {
    const s = board.listen(0, () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${started.address().port}/v1/board/jobs`;
    await replayRoute({
      url,
      okStatus: 201,
      headers: { 'x-xfuel-session': actor.session },
      sideEffect: () => jobs.list().length,
      body: {
        text: 'Summarize the receipt and stop.',
        budget: '5000000',
        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        acceptance_test: 'Names the amount.',
      },
    });
    assert.equal(jobs.list().length, 1);
  } finally {
    if (typeof started.closeAllConnections === 'function') started.closeAllConnections();
    await new Promise((resolve) => started.close(resolve));
  }
});
