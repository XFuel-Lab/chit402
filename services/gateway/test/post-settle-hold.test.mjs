/**
 * Post-settle holds: 202 while a receipt can still be issued, 409 refund_owed
 * when it cannot. Offline. Loopback only. Dummy values only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  paymentErrorStatus,
  paymentFailureBody,
  paymentFailureStatus,
  stampFailureBody,
  RESOLVABLE_RETRY_AFTER_SEC,
} from '../src/x402-flags.js';
import { LATE_RETRY_AFTER_SEC } from '../src/late-issue.js';
import { ChallengeStore } from '../src/x402-adapter.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';
import { holdPageForReceiptId, holdPagePayload, openPostSettleHandle, terminalStampHold } from '../src/hold-handle.js';
import { renderHoldPage, renderReceiptShellMissing } from '../src/receipt-shell.js';
import { attempt, HOUSE, OTHER, PAYER } from './fixtures/refusal-scenarios.mjs';
import { AgentRegistry } from '../src/agent-registry.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import { BoardPostStore } from '../src/board-posts.js';
import { registerBoardRoutes } from '../src/board-routes.js';
import { BoardJobStore } from '../src/board-jobs.js';
import { registerBoardJobRoutes } from '../src/board-job-routes.js';
import { registerAgent } from '../src/agent-registry.js';
import { ingestForeignX402 } from '../src/foreign-x402-ingest.js';
import { bindAgentWallet } from '../src/agent-wallet.js';
import { Wallet } from 'ethers';
import { canonicalRegisterPayMessage } from '../src/agent-registry.js';
import { inflightHoldDecision, openAiFailurePayload } from '../src/openai-gateway.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, '..', 'src');
const DUMMY_TOKEN = 'ops-read-token-dummy';
const DUMMY_HEADER = 'payment-header-dummy';
const DUMMY_NONCE = 'nonce-dummy-not-a-secret';

function read(name) {
  return readFileSync(join(SRC, name), 'utf8');
}

function hexId() {
  return crypto.randomBytes(16).toString('hex');
}

test('resolvable retry wait matches the late reconciler', () => {
  assert.equal(RESOLVABLE_RETRY_AFTER_SEC, LATE_RETRY_AFTER_SEC);
  assert.equal(LATE_RETRY_AFTER_SEC, 5);
});

test('fail closed: unknown code, missing decision, missing class, bad id', () => {
  assert.equal(paymentFailureStatus(undefined).status, paymentErrorStatus(undefined));
  assert.equal(paymentFailureStatus(null).refundOwed, false);
  assert.equal(paymentFailureStatus({ code: 'not_a_code' }).status, 402);
  assert.equal(paymentFailureStatus({ code: 'not_a_code' }).refundOwed, false);
  const noClass = paymentFailureStatus({ code: 'settle_unconfirmed', pendingId: hexId() });
  assert.equal(noClass.status, 402);
  assert.equal(noClass.refundOwed, false);
  assert.equal(paymentFailureBody({ code: 'settle_unconfirmed', pendingId: hexId() }).pending_id, undefined);
  const bad = paymentFailureStatus({ code: 'settle_unconfirmed', holdClass: 'resolvable', pendingId: 12 });
  assert.equal(bad.status, 409);
  assert.equal(bad.fallback, true);
  assert.equal(bad.refundOwed, false);
  const body = paymentFailureBody({ code: 'settle_unconfirmed', holdClass: 'terminal', pendingId: 'pending-abc-1' });
  assert.equal(body.status, undefined);
  assert.equal(body.pending_id, undefined);
  assert.equal(body.message, 'Do not pay again.');
  assert.equal(paymentFailureStatus({ code: 'payer_mismatch' }).status, 403);
  assert.equal(paymentFailureStatus({ code: 'payment_replayed' }).status, 409);
  assert.equal(paymentFailureStatus({ code: 'payment_replayed' }).refundOwed, false);
});

test('a throwing handle write is the non-402 fallback, never 202', () => {
  const store = { ensureHoldHandle() { throw new Error('disk full'); } };
  const opened = openPostSettleHandle(store, { key: 'settle:base:nonce-1', holdClass: 'resolvable', cfg: {} });
  assert.equal(opened, null);
  const view = paymentFailureStatus({ code: 'settle_failed', holdClass: 'resolvable', pendingId: null });
  assert.notEqual(view.status, 202);
  assert.equal(view.status, 409);
  assert.equal(view.refundOwed, false);
});

test('resolvable settle_pending is 202 with Retry-After and an unchanged body', async () => {
  const { decision } = await attempt({
    cfg: { lateIssue: true, chainReader: async () => ({ ok: false, pending: true }) },
  });
  assert.equal(decision.holdClass, 'resolvable');
  assert.equal(decision.code, 'settle_pending');
  const view = paymentFailureStatus(decision);
  assert.equal(view.status, 202);
  assert.equal(view.retryAfter, 5);
  const body = paymentFailureBody(decision);
  assert.deepEqual(Object.keys(body), ['error', 'code', 'pending_id', 'verify_url']);
  assert.equal(body.error, 'settle_pending');
  assert.equal(body.pending_id, decision.pendingId);
  assert.match(body.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(body).toLowerCase().includes('rejected'), false);
});

test('terminal underpaid, payee mismatch, and post-check payer mismatch are 409 refund_owed', async () => {
  const under = await attempt({
    cfg: {
      chainReader: async () => ({ ok: true, amount: '1', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  const payee = await attempt({
    cfg: {
      chainReader: async () => ({ ok: true, amount: '2000', payTo: OTHER, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  const payer = await attempt({
    call: { expectedPayer: PAYER },
    cfg: { chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: OTHER, blockNumber: 16, logIndex: 0 }) },
  });
  for (const [name, decision] of [['underpaid', under.decision], ['payee', payee.decision], ['payer', payer.decision]]) {
    assert.equal(decision.holdClass, 'terminal', name);
    const view = paymentFailureStatus(decision);
    assert.equal(view.status, 409, name);
    assert.equal(view.retryAfter, null, name);
    const body = paymentFailureBody(decision);
    assert.equal(body.status, 'refund_owed', name);
    assert.match(body.pending_id, /^[0-9a-f]{32}$/, name);
    assert.match(body.verify_url, /\/receipt\/late-[0-9a-f]{32}$/, name);
    assert.equal(JSON.stringify(body).includes('Retry-After'), false);
    if (name === 'payer') assert.equal(body.code, 'payer_mismatch');
  }
});

test('pre-settle payer mismatch stays 403 with the same body', async () => {
  const { decision } = await attempt({ call: { expectedPayer: OTHER } });
  assert.equal(decision.preSettle, true);
  assert.equal(decision.pendingId, null);
  assert.equal(decision.holdClass, undefined);
  assert.equal(paymentFailureStatus(decision).status, 403);
  assert.deepEqual(paymentFailureBody(decision), { error: 'payer_mismatch', code: 'payer_mismatch' });
});

test('S-B2: a capped EVM hold gets an unguessable handle, not the recordPending id', async () => {
  const store = new ChallengeStore();
  for (let i = 0; i < 64; i += 1) {
    store.putLate({
      pending_id: hexId(),
      state: 'unknown',
      auth_key: `cap-${i}`,
      submitted_at: 1,
    });
  }
  let settles = 0;
  const server = http.createServer((req, res) => {
    const isSettle = String(req.url).endsWith('/settle');
    if (isSettle) {
      settles += 1;
      req.socket.destroy();
      return;
    }
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ valid: true, isValid: true, payer: PAYER }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { decision } = await attempt({
      store,
      cfg: { gatewayUrl: `http://127.0.0.1:${server.address().port}`, lateIssue: false },
      fac: {},
    });
    // attempt() opens its own facilitator. Drive settleBoundPayment through a
    // destroyed settle by calling attempt only when the store is capped and the
    // fixture facilitator is replaced below if this path did not hold.
    assert.ok(settles >= 1, 'settle hit the capped path');
    assert.equal(decision.holdClass, 'resolvable');
    assert.equal(decision.kind, 'failed');
    assert.match(String(decision.pendingId), /^[0-9a-f]{32}$/);
    assert.equal(paymentFailureStatus(decision).status, 202);
    assert.doesNotMatch(JSON.stringify(decision), /pending-[0-9a-z]+-\d+/);
    assert.doesNotMatch(JSON.stringify(paymentFailureBody(decision)), /pending-[0-9a-z]+-\d+/);
  } finally {
    await new Promise((r) => server.close(r));
  }
  const handle = store.ensureHoldHandle({ key: 'settle:base:capped-nonce', holdClass: 'resolvable' });
  assert.match(handle.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(store.getHoldHandle(handle.pending_id).key, undefined);
  const before = store.holdHandles.length;
  const again = store.ensureHoldHandle({ key: 'settle:base:capped-nonce', holdClass: 'terminal' });
  assert.equal(again.pending_id, handle.pending_id);
  assert.equal(again.hold_class, 'resolvable');
  assert.equal(store.holdHandles.length, before);
});

test('S-B2: a Solana transport hold returns an unguessable handle', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevOffline = process.env.HUB_CATALOG_OFFLINE;
  process.env.NODE_ENV = 'test';
  process.env.HUB_CATALOG_OFFLINE = 'true';
  const { runX402Handshake } = await import('../src/x402-server.js');
  const { startMockFacilitator } = await import('../src/x402-mock-facilitator.js');
  const payer = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
  const solana = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (String(req.url).endsWith('/settle')) {
        req.socket.destroy();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ isValid: true, payer }));
    });
  });
  await new Promise((resolve) => solana.listen(0, '127.0.0.1', resolve));
  const cdp = await startMockFacilitator();
  const prev = process.env.X402_SOLANA_FACILITATOR_URL;
  process.env.X402_SOLANA_FACILITATOR_URL = `http://127.0.0.1:${solana.address().port}`;
  try {
    const cfg = {
      enabled: true,
      defaultRail: 'usdc',
      fallbackToTfuel: false,
      facilitatorProvider: 'x402',
      facilitatorUrl: cdp.url,
      gatewayUrl: cdp.url,
      apiKey: null,
      payTo: '0xtreasury',
      network: 'base',
      asset: 'USDC',
      challengeTtlMs: 120000,
      usdcPriceDefault: '2000',
      usdcPrices: {},
      solana: { enabled: true, payTo: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', network: 'solana' },
    };
    const baseUrl = 'https://api.chit402.com';
    const challenge = await runX402Handshake(
      { headers: {}, body: { model: 'xfuel/auto' } },
      { taskId: 'solana-hold', cfg, baseUrl, resource: `${baseUrl}/v1/chat/completions` },
    );
    assert.equal(challenge.kind, 'challenge');
    const solAccept = challenge.body.accepts.find((a) => String(a.network || '').startsWith('solana'));
    assert.ok(solAccept);
    const nonce = solAccept.extra.nonce;
    const paymentHeader = Buffer.from(JSON.stringify({
      x402Version: 2,
      resource: { url: `${baseUrl}/v1/chat/completions`, description: 'Chit paid inference', mimeType: 'application/json' },
      accepted: {
        scheme: 'exact',
        network: solAccept.network,
        amount: solAccept.amount,
        asset: solAccept.asset,
        payTo: solAccept.payTo,
        maxTimeoutSeconds: 60,
        extra: { feePayer: solAccept.payTo, nonce },
      },
      payload: { transaction: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
      extensions: {},
    })).toString('base64');
    const held = await runX402Handshake({
      headers: { 'payment-signature': paymentHeader, 'x-payment-nonce': nonce },
      body: { model: 'xfuel/auto' },
    }, {
      taskId: 'solana-hold',
      cfg,
      baseUrl,
      resource: `${baseUrl}/v1/chat/completions`,
      amount: solAccept.amount,
    });
    assert.equal(held.holdClass, 'resolvable', JSON.stringify(held));
    assert.match(String(held.pendingId), /^[0-9a-f]{32}$/);
    assert.equal(paymentFailureStatus(held).status, 202);
    assert.doesNotMatch(JSON.stringify(held), /pending-[0-9a-z]+-\d+/);
    const page = holdPageForReceiptId(`late-${held.pendingId}`);
    assert.deepEqual(page, { page: 'pending' });
  } finally {
    if (prev === undefined) delete process.env.X402_SOLANA_FACILITATOR_URL;
    else process.env.X402_SOLANA_FACILITATOR_URL = prev;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevOffline === undefined) delete process.env.HUB_CATALOG_OFFLINE;
    else process.env.HUB_CATALOG_OFFLINE = prevOffline;
    await new Promise((r) => solana.close(r));
    await cdp.close();
  }
});

test('paid replay in flight is 202, idempotent, and does not say could not be settled', () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const first = inflightHoldDecision('nonce-replay-1');
  const second = inflightHoldDecision('nonce-replay-1');
  assert.equal(first.pendingId, second.pendingId);
  assert.equal(store.holdHandles.length, 1);
  const payload = openAiFailurePayload(first);
  assert.equal(payload.status, 202);
  assert.equal(payload.retryAfter, 2);
  assert.equal(payload.body.error.type, 'payment_required');
  assert.equal(payload.body.error.code, 'payment_in_flight');
  assert.match(payload.body.error.message, /Do not pay again/);
  assert.doesNotMatch(payload.body.error.message, /could not be settled/i);
  assert.doesNotMatch(payload.body.error.message, /rejected/i);
  assert.equal(payload.body.error.pending_id, first.pendingId);
  const replayed = openAiFailurePayload({ code: 'payment_replayed', reason: 'payment_replayed' });
  assert.equal(replayed.status, 409);
  assert.equal(replayed.body.error.pending_id, undefined);
  assert.equal(replayed.body.error.message, 'Payment could not be settled');
});

test('stamp underpaid and wrong payee are terminal on register, ingest, board, and board-job', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const register = terminalStampHold('base:0xregister', { publicBaseUrl: '' });
  const again = terminalStampHold('base:0xregister', { publicBaseUrl: '' });
  assert.equal(register.status, 409);
  assert.equal(register.outcome, 'refund_owed');
  assert.equal(register.pending_id, again.pending_id);
  assert.equal(register.retryAfter, undefined);
  const client = stampFailureBody(register);
  assert.equal(client.status, 'refund_owed');
  assert.equal(client.code, 'stamp_underpaid');
  assert.match(client.pending_id, /^[0-9a-f]{32}$/);

  const signer = Wallet.createRandom();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(canonicalRegisterPayMessage(signer.address, timestamp));
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const passed = await registerAgent({
    agentWallet: signer.address,
    wallet_signature: signature,
    signature_timestamp: timestamp,
  }, {
    registry,
    ledger,
    bindWallet: async (w) => bindAgentWallet(w, {
      inspect: async () => ({ kind: 'eoa', official: false, eoa: true, code: '0x' }),
    }),
    proveSmartControl: null,
    ensureRegisterStamp: async () => register,
  });
  assert.equal(passed.pending_id, register.pending_id, JSON.stringify(passed));
  assert.equal(passed.outcome, 'refund_owed');
  assert.equal(stampFailureBody(passed).status, 'refund_owed');

  const agent = registry.allocate();
  registry.bindWallet(agent.agent_id, { agentWallet: '0x' + '11'.repeat(20) });
  const ingested = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '5000', payTo: '0x' + '22'.repeat(20) },
    payment_response: { tx: '0x' + 'ab'.repeat(32), payer: '0x' + '11'.repeat(20), network: 'base' },
    session: agent.session,
  }, {
    ledger: new UsageSettledLedger(),
    registry,
    agentId: agent.agent_id,
    session: agent.session,
    verify: async () => ({ valid: true, payer: '0x' + '11'.repeat(20) }),
    ensureStamp: async () => terminalStampHold('base:0xingest', { publicBaseUrl: '' }),
  });
  assert.equal(ingested.ok, false);
  assert.equal(ingested.status, 409);
  assert.equal(ingested.outcome, 'refund_owed');
  assert.match(ingested.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(stampFailureBody(ingested).code, 'stamp_underpaid');
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function post(server, path, body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), retry: res.headers.get('retry-after') };
}

test('board stamp and board-job pay deliver both classes to the client', async () => {
  const registry = new AgentRegistry();
  const poster = registry.allocate();
  registry.bindWallet(poster.agent_id, { agentWallet: '0x' + '11'.repeat(20) });
  const posts = new BoardPostStore();
  const id = hexId();
  let mode = 'resolvable';
  const app = express();
  app.use(express.json());
  const handshake = async () => {
    if (mode === 'terminal') {
      return {
        kind: 'settled',
        confirmed: true,
        paymentRef: 'base:0xboard',
        settledAmount: '1',
        payTo: '0x' + '99'.repeat(20),
        payerWallet: '0x' + '11'.repeat(20),
      };
    }
    return {
      kind: 'failed',
      code: 'settle_pending',
      reason: 'settle_pending',
      holdClass: 'resolvable',
      pendingId: id,
      verifyUrl: `/receipt/late-${id}`,
      preSettle: false,
    };
  };
  registerBoardRoutes(app, {
    posts,
    ledger: new UsageSettledLedger(),
    registry,
    verify: () => ({ ok: true }),
    isDemoKey: () => false,
    x402Enabled: true,
    runX402Handshake: handshake,
    setPaymentHeaders: () => {},
    baseUrlFor: () => 'http://127.0.0.1',
    peekStampWaiver: () => ({ eligible: false }),
    commitStampWaiver: () => {},
  });
  const jobs = new BoardJobStore();
  registerBoardJobRoutes(app, {
    jobs,
    posts,
    ledger: new UsageSettledLedger(),
    registry,
    verify: () => ({ ok: true }),
    isDemoKey: () => false,
    x402Enabled: true,
    runX402Handshake: handshake,
    setPaymentHeaders: () => {},
    baseUrlFor: () => 'http://127.0.0.1',
    peekStampWaiver: () => ({ eligible: false }),
    commitStampWaiver: () => {},
  });
  const server = await listen(app);
  try {
    const headers = { 'x-xfuel-session': poster.session };
    const postBody = { endpoint: 'https://api.chit402.com/v1', outcome: 'success', text: 'plain' };
    const resolvable = await post(server, '/v1/board/posts', postBody, headers);
    assert.equal(resolvable.status, 202, JSON.stringify(resolvable.body));
    assert.equal(resolvable.body.pending_id, id);
    assert.match(resolvable.body.verify_url, /late-/);
    assert.equal(resolvable.retry, '5');
    assert.equal(resolvable.body.status, undefined);
    mode = 'terminal';
    const terminal = await post(server, '/v1/board/posts', postBody, headers);
    assert.equal(terminal.status, 409, JSON.stringify(terminal.body));
    assert.equal(terminal.body.status, 'refund_owed');
    assert.equal(terminal.body.code, 'stamp_underpaid');
    assert.match(terminal.body.pending_id, /^[0-9a-f]{32}$/);
    assert.equal(terminal.retry, null);
    mode = 'resolvable';
    const jobHold = await post(server, '/v1/board/jobs', {
      text: 'Hold the payment.',
      budget: '5000000',
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      acceptance_test: 'none',
    }, headers);
    assert.equal(jobHold.status, 202, JSON.stringify(jobHold.body));
    assert.equal(jobHold.body.pending_id, id);
    assert.equal(jobHold.retry, '5');
    mode = 'terminal';
    const jobOwed = await post(server, '/v1/board/jobs', {
      text: 'Hold the payment.',
      budget: '5000000',
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      acceptance_test: 'none',
    }, headers);
    assert.equal(jobOwed.status, 409, JSON.stringify(jobOwed.body));
    assert.equal(jobOwed.body.status, 'refund_owed');
    assert.equal(jobOwed.retry, null);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('status page says pending or refund owed and unknown ids match', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const pending = store.ensureHoldHandle({ key: 'settle:base:page-pending', holdClass: 'resolvable' });
  const owed = store.ensureHoldHandle({ key: 'stamp:page-owed', holdClass: 'terminal' });
  assert.deepEqual(holdPageForReceiptId(`late-${pending.pending_id}`, store), { page: 'pending' });
  assert.deepEqual(holdPageForReceiptId(`late-${owed.pending_id}`, store), { page: 'refund_owed' });
  const htmlPending = holdPagePayload('pending');
  const htmlOwed = holdPagePayload('refund_owed');
  assert.match(htmlPending.html, /pending/);
  assert.deepEqual(htmlPending.json, { status: 'pending' });
  assert.match(htmlOwed.html, /refund owed, do not pay again/);
  assert.equal(htmlOwed.json.message, 'refund owed, do not pay again');
  assert.doesNotMatch(htmlOwed.html, /payer|amount|0x/i);
  const app = express();
  app.get('/receipt/:taskId', (req, res) => {
    const wantsJson = req.query.format === 'json';
    const page = holdPageForReceiptId(req.params.taskId, store);
    if (!page) {
      res.status(404);
      if (wantsJson) return res.json({ error: 'not_found' });
      return res.type('html').send(renderReceiptShellMissing());
    }
    const payload = holdPagePayload(page.page);
    if (wantsJson) return res.json(payload.json);
    return res.type('html').send(payload.html);
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const owedHtml = await fetch(`${base}/receipt/late-${owed.pending_id}`);
    const owedJson = await fetch(`${base}/receipt/late-${owed.pending_id}?format=json`);
    const pendingJson = await fetch(`${base}/receipt/late-${pending.pending_id}?format=json`);
    const missingA = await fetch(`${base}/receipt/late-${hexId()}`);
    const missingB = await fetch(`${base}/receipt/late-${hexId()}`);
    assert.match(await owedHtml.text(), /refund owed, do not pay again/);
    assert.deepEqual(await owedJson.json(), htmlOwed.json);
    assert.deepEqual(await pendingJson.json(), { status: 'pending' });
    const textA = await missingA.text();
    const textB = await missingB.text();
    assert.equal(missingA.status, 404);
    assert.equal(missingB.status, 404);
    assert.equal(textA, textB);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  const a = renderReceiptShellMissing();
  const b = renderReceiptShellMissing();
  assert.equal(a, b);
  assert.equal(holdPageForReceiptId('late-' + hexId(), store), null);
  assert.equal(holdPageForReceiptId('late-' + hexId(), store), null);
  assert.equal(holdPageForReceiptId(`late-${pending.pending_id.slice(0, 8)}`, store), null);
});

test('invariant: pending_id is never 402, never rejected, Retry-After only when resolvable', () => {
  const rows = [
    { code: 'settle_pending', holdClass: 'resolvable', pendingId: hexId(), verifyUrl: '/receipt/late-x' },
    { code: 'settle_unconfirmed', holdClass: 'resolvable', pendingId: hexId(), verifyUrl: '/receipt/late-y' },
    { code: 'settle_failed', holdClass: 'resolvable', pendingId: hexId(), verifyUrl: '/receipt/late-z' },
    { code: 'payment_in_flight', holdClass: 'resolvable', pendingId: hexId(), verifyUrl: '/receipt/late-q', retryAfter: 2 },
    { code: 'settle_unconfirmed', holdClass: 'terminal', pendingId: hexId(), verifyUrl: '/receipt/late-a' },
    { code: 'payer_mismatch', holdClass: 'terminal', pendingId: hexId(), verifyUrl: '/receipt/late-b' },
    { code: 'stamp_underpaid', holdClass: 'terminal', pendingId: hexId(), verifyUrl: '/receipt/late-c' },
  ];
  for (const decision of rows) {
    const view = paymentFailureStatus(decision);
    const body = paymentFailureBody(decision);
    assert.notEqual(view.status, 402, decision.code);
    const blob = JSON.stringify(body);
    assert.doesNotMatch(blob, /rejected|could not be settled/i);
    if (decision.holdClass === 'resolvable') assert.ok(view.retryAfter > 0);
    else assert.equal(view.retryAfter, null);
    assert.equal(body.pending_id, decision.pendingId);
  }
});

test('source scan: failure sites use the helper and holds do not say rejected', () => {
  const server = read('server.js');
  const openai = read('openai-gateway.js');
  const board = read('board-routes.js');
  const jobs = read('board-job-routes.js');
  const flags = read('x402-flags.js');
  const sdk = readFileSync(join(DIR, '../../../packages/sdk/src/index.ts'), 'utf8');
  const mcp = readFileSync(join(DIR, '../../../packages/mcp/src/format.ts'), 'utf8');
  assert.ok(/function paymentFailureStatus\(/.test(flags), 'helper exists');
  assert.ok(/status: 202/.test(flags), 'resolvable maps to 202');
  assert.ok(/status: 409/.test(flags), 'terminal maps to 409');
  assert.ok(/function sendX402Failure\(/.test(server), 'task-request helper');
  assert.ok((server.match(/sendX402Failure\(res,/g) || []).length >= 2, 'both task-request paths');
  assert.ok(/paymentFailureStatus\(decision\)/.test(server), 'server uses the status helper');
  assert.equal((server.match(/paymentErrorStatus\(/g) || []).length, 0, 'server does not call the old status');
  assert.ok(/openAiFailurePayload\(/.test(openai), 'openai uses the payload helper');
  assert.ok(/inflightHoldDecision\(/.test(openai), 'paid replay builds a hold');
  assert.ok(/paymentFailureStatus\(decision\)/.test(board), 'board uses the helper');
  assert.ok(/terminalStampHold\(/.test(jobs), 'board-job underpaid is a terminal hold');
  const holdFn = mcp.slice(mcp.indexOf('function pendingIdOf'), mcp.indexOf('if (err.status === 402'));
  assert.ok(/do not pay again/i.test(holdFn), 'mcp pending branch');
  assert.equal(/rejected/i.test(holdFn), false, 'mcp pending branch has no rejected');
  assert.equal(/wallet balance/i.test(holdFn), false, 'mcp pending branch has no wallet balance');
  const sdkHold = sdk.slice(sdk.indexOf('function paymentHoldOf'), sdk.indexOf('function paymentReplayError'));
  assert.equal(/payment_rejected/.test(sdkHold), false, 'sdk hold mapping is not payment_rejected');
  const heldMsg = openai.slice(openai.indexOf('function heldOpenAiMessage'), openai.indexOf('function unheldOpenAiMessage'));
  assert.equal(/could not be settled/i.test(heldMsg), false, 'openai hold message');
  assert.equal(/status\(402\)/.test(heldMsg), false, 'openai hold is not 402');
});

test('leak: dummy token, header and nonce do not appear on the new responses', () => {
  const store = new ChallengeStore();
  const opened = openPostSettleHandle(store, {
    key: `stamp:${DUMMY_TOKEN}:${DUMMY_HEADER}:${DUMMY_NONCE}`,
    holdClass: 'terminal',
    cfg: {},
  });
  const body = paymentFailureBody({
    code: 'stamp_underpaid',
    holdClass: 'terminal',
    pendingId: opened.pendingId,
    verifyUrl: opened.verifyUrl,
  });
  const page = renderHoldPage('refund_owed');
  const blob = JSON.stringify(body) + page + JSON.stringify(store.getHoldHandle(opened.pendingId));
  assert.equal(blob.includes(DUMMY_TOKEN), false);
  assert.equal(blob.includes(DUMMY_HEADER), false);
  assert.equal(blob.includes(DUMMY_NONCE), false);
  assert.doesNotMatch(blob, /pending-[0-9a-z]+-\d+/);
});

test('register success receipt bytes and leaf count stay stable for the same payment', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const signer = Wallet.createRandom();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(canonicalRegisterPayMessage(signer.address, timestamp));
  const bind = async (w) => bindAgentWallet(w, {
    inspect: async () => ({ kind: 'eoa', official: false, eoa: true, code: '0x' }),
  });
  async function once() {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const result = await registerAgent({
      agentWallet: signer.address,
      wallet_signature: signature,
      signature_timestamp: timestamp,
    }, {
      registry,
      ledger,
      bindWallet: bind,
      proveSmartControl: null,
      ensureRegisterStamp: async () => ({
        ok: true,
        waived: false,
        settlement: { paymentRef: 'base:0x' + 'ab'.repeat(32), amount: '2000', payerWallet: signer.address },
      }),
    });
    return { result, ledger };
  }
  const a = await once();
  const b = await once();
  assert.equal(a.result.ok, true);
  assert.equal(b.result.ok, true);
  assert.equal(a.ledger.entries.length, 1);
  assert.equal(b.ledger.entries.length, 1);
  const strip = (entry) => {
    const copy = structuredClone(entry);
    delete copy.recorded_at;
    delete copy.agent_id;
    delete copy.collected_at;
    const jws = copy.book_chain?.issuer_signature?.jws;
    if (typeof jws === 'string') {
      const [header, payload] = jws.split('.');
      copy.book_chain.issuer_signature.jws = `${header}.${payload}`;
    }
    return copy;
  };
  assert.equal(a.ledger.entries.length, 1);
  assert.equal(b.ledger.entries.length, 1);
  assert.equal(a.ledger.entries[0].row_hash, b.ledger.entries[0].row_hash);
  assert.deepEqual(strip(a.ledger.entries[0]), strip(b.ledger.entries[0]));
  if (prev === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prev;
});
