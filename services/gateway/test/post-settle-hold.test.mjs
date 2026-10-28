/**
 * Post-settle holds: 202 while a receipt can still be issued, 409 refund_owed
 * when it cannot. Offline. Loopback only. Dummy values only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { DurableChallengeStore, setActiveChallengeStore } from '../src/x402-durable-store.js';
import { getIssuerKid } from '../src/issuer-key.js';
import { createBoardJob } from '../src/board-jobs.js';
import { flagBoardPost } from '../src/board-posts.js';
import { holdPageForReceiptId, holdPagePayload, openPostSettleHandle, terminalStampHold } from '../src/hold-handle.js';
import { renderHoldPage, renderReceiptShellMissing } from '../src/receipt-shell.js';
import { attempt, HOUSE, OTHER, PAYER, RESOURCE, USDC, paymentHeader } from './fixtures/refusal-scenarios.mjs';
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

test('a pre-settle decision with a class and an id stays on today status', () => {
  const id = hexId();
  const decision = {
    code: 'payer_mismatch',
    reason: 'payer_mismatch',
    preSettle: true,
    holdClass: 'terminal',
    pendingId: id,
    verifyUrl: `/receipt/late-${id}`,
  };
  assert.equal(paymentFailureStatus(decision).status, 403);
  assert.equal(paymentFailureStatus(decision).refundOwed, false);
  assert.equal(paymentFailureBody(decision).pending_id, undefined);
});

test('pre-settle payer mismatch stays 403 with the same body', async () => {
  const { decision } = await attempt({ call: { expectedPayer: OTHER } });
  assert.equal(decision.preSettle, true);
  assert.equal(decision.pendingId, null);
  assert.equal(decision.holdClass, undefined);
  assert.equal(paymentFailureStatus(decision).status, 403);
  assert.deepEqual(paymentFailureBody(decision), { error: 'payer_mismatch', code: 'payer_mismatch' });
});

test('S-B2: late-issue on and the admission cap still returns a handle and opens no late row', async () => {
  const store = new ChallengeStore();
  for (let i = 0; i < 64; i += 1) {
    store.putLate({
      pending_id: hexId(),
      state: 'unknown',
      auth_key: `cap-${i}`,
      submitted_at: 1,
    });
  }
  const before = store.listLate().length;
  let settles = 0;
  const server = http.createServer((req, res) => {
    if (String(req.url).endsWith('/settle')) {
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
      cfg: { gatewayUrl: `http://127.0.0.1:${server.address().port}`, lateIssue: true },
    });
    assert.ok(settles >= 1);
    assert.equal(store.listLate().length, before, 'admission cap opened no late row');
    assert.equal(decision.holdClass, 'resolvable');
    assert.match(String(decision.pendingId), /^[0-9a-f]{32}$/);
    assert.ok(store.holdHandles.some((row) => row.pending_id === decision.pendingId));
    assert.equal(paymentFailureStatus(decision).status, 202);
    assert.doesNotMatch(JSON.stringify(decision), /pending-[0-9a-z]+-\d+/);
    assert.doesNotMatch(JSON.stringify(paymentFailureBody(decision)), /pending-[0-9a-z]+-\d+/);
  } finally {
    await new Promise((r) => server.close(r));
  }
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
  const header = 'inflight-replay-header';
  const first = inflightHoldDecision('nonce-replay-1', '', header);
  const second = inflightHoldDecision('nonce-replay-1', '', header);
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
  const helper = flags.slice(flags.indexOf('export function paymentFailureStatus'), flags.indexOf('export function paymentErrorBody'));
  assert.ok(/function paymentFailureStatus\(/.test(flags), 'helper exists');
  assert.ok(/status: 202/.test(helper), 'resolvable maps to 202');
  assert.ok(/status: 409/.test(helper), 'terminal maps to 409');
  assert.ok(/preSettle === true/.test(helper), 'pre-settle guard');
  const inflight = openai.slice(openai.indexOf('export function inflightHoldDecision'), openai.indexOf('async function maybeServePaidReplay'));
  assert.equal(/inflight:/.test(inflight), false, 'in-flight handle is not a separate key');
  assert.ok(/settleHoldKey\(/.test(inflight), 'in-flight handle uses the settle key');
  assert.ok(/get\?\.\(nonce\)\?\.network \|\| network/.test(inflight), 'in-flight handle prefers the payment network');
  assert.ok(/function sendX402Failure\(/.test(server), 'task-request helper');
  assert.ok((server.match(/sendX402Failure\(res,/g) || []).length >= 2, 'both task-request paths');
  assert.ok(/paymentFailureStatus\(decision\)/.test(server), 'server uses the status helper');
  assert.equal((server.match(/paymentErrorStatus\(/g) || []).length, 0, 'server does not call the old status');
  assert.ok(/openAiFailurePayload\(/.test(openai), 'openai uses the payload helper');
  const replayFn = openai.slice(openai.indexOf('async function maybeServePaidReplay'), openai.indexOf('function finishPaidBody'));
  assert.equal(/config\.x402\?\.network/.test(replayFn), false, 'paid replay does not pass the configured network');
  const timedOut = replayFn.slice(replayFn.indexOf('if (stored?.timedOut)'), replayFn.indexOf('if (!stored?.bytes)'));
  assert.ok(/inflightHoldDecision\(/.test(timedOut), 'paid replay in flight builds a hold');
  assert.ok(/sendOpenAiPaymentResult\(/.test(timedOut), 'paid replay in flight uses the hold response');
  assert.equal(/status\(402\)/.test(timedOut), false, 'paid replay in flight is not 402');
  assert.equal(/could not be settled/i.test(timedOut), false, 'paid replay in flight does not say could not be settled');
  assert.ok(/paymentFailureStatus\(decision\)/.test(board), 'board uses the helper');
  assert.ok(/terminalStampHold\(/.test(jobs), 'board-job underpaid is a terminal hold');
  assert.equal((server.match(/return terminalStampDecision\(decision\.paymentRef\)/g) || []).length, 2, 'register and ingest stamp underpaid return the hold');
  assert.equal(/decisionHoldResult\(terminalStampDecision/.test(server), false, 'stamp hold is not wrapped twice');
  assert.ok(/terminalHold\('payer_mismatch'/.test(jobs), 'board-job route payer mismatch is a terminal hold');
  assert.ok(/terminalHold\('payer_mismatch'/.test(read('board-jobs.js')), 'board-job leg payer mismatch is a terminal hold');
  const holdFn = mcp.slice(mcp.indexOf('export function describeHold'), mcp.indexOf('function pendingIdOf'));
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

test('register and ingest success receipts match the fcd81206 byte pin', async () => {
  const prevNow = Date.now;
  const prevRandom = crypto.randomBytes;
  const fixedNow = 1761640000000;
  Date.now = () => fixedNow;
  try {
    const signer = new Wallet('0x' + '11'.repeat(32));
    const timestamp = Math.floor(fixedNow / 1000);
    const signature = await signer.signMessage(canonicalRegisterPayMessage(signer.address, timestamp));
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const result = await registerAgent({
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
      ensureRegisterStamp: async () => ({
        ok: true,
        waived: false,
        settlement: { paymentRef: 'base:0x' + 'ab'.repeat(32), amount: '2000', payerWallet: signer.address },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(ledger.entries.length, 1);
    const reg = ledger.entries[0];
    const [regHeader, regPayload] = reg.book_chain.issuer_signature.jws.split('.');
    assert.equal(JSON.parse(Buffer.from(regHeader, 'base64url').toString()).kid, getIssuerKid());
    assert.equal(reg.row_hash, '263c236fdeaa93ab2f20b10e8b1ad4eb836c1e1660bc0b7a08cb295c59218c0c');
    assert.equal(regPayload, 'eyJzY2hlbWEiOiJjaGl0NDAyLmJvb2tfc2VxLnYxIiwicGF5bG9hZF92ZXJzaW9uIjo0LCJib29rX2lkIjoxLCJ0YXNrX2lkIjoicmVnaXN0ZXItOTI0NmFjMTBhOTE0MjgyZjczMTVmYzk3MjI2YTVjZjAiLCJzZXEiOjEsInByZXZfaGFzaCI6bnVsbCwicm93X2hhc2giOiIyNjNjMjM2ZmRlYWE5M2FiMmYyMGIxMGU4YjFhZDRlYjgzNmMxZTE2NjBiYzBiN2EwOGNiMjk1YzU5MjE4YzBjIiwiZXZlbnQiOiJjb2xsZWN0ZWQiLCJhY3QiOiJzcGVuZCIsInJlcGxheV9vZiI6bnVsbCwicGF5bWVudF9yZWYiOiJiYXNlOjB4YWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYiJ9');

    crypto.randomBytes = (n) => Buffer.alloc(n, 0xab);
    const ingestLedger = new UsageSettledLedger();
    const ingestRegistry = new AgentRegistry();
    const identity = ingestRegistry.allocate({ taskId: 'seat' });
    ingestRegistry.bindWallet(identity.agent_id, { agentWallet: PAYER });
    const tx = '0x' + 'd1'.repeat(32);
    const ingested = await ingestForeignX402({
      payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
      payment_response: { tx, payer: PAYER, network: 'base' },
      session: identity.session,
    }, {
      ledger: ingestLedger,
      registry: ingestRegistry,
      agentId: identity.agent_id,
      session: identity.session,
      verify: async () => ({ valid: true, payer: PAYER, txHash: tx, blockNumber: 1 }),
      ensureStamp: async () => ({ ok: true, waived: true }),
    });
    assert.equal(ingested.status, 201);
    assert.equal(ingestLedger.entries.length, 1);
    const ing = ingestLedger.entries[0];
    assert.equal(ing.row_hash, '6d83424e6ec82cdaab71539248bd31b0285f3ec9626ae31c6a99e19d17a6b820');
  } finally {
    Date.now = prevNow;
    crypto.randomBytes = prevRandom;
    const { resetIssuerHistoryStore } = await import('../src/issuer-history.js');
    resetIssuerHistoryStore();
  }
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

test('a second call resumes the same resolvable hold for the task route and the OpenAI route', async () => {
  const store = new ChallengeStore();
  const fixed = { validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  const pending = async () => ({ ok: false, pending: true });
  const first = await attempt({
    store,
    header: fixed,
    cfg: { lateIssue: true, chainReader: pending },
  });
  assert.equal(first.decision.holdClass, 'resolvable');
  const second = await attempt({
    store,
    nonce: first.nonce,
    header: fixed,
    cfg: { lateIssue: true, chainReader: pending },
  });
  assert.equal(second.decision.pendingId, first.decision.pendingId);
  assert.equal(second.decision.holdClass, 'resolvable');
  const task = paymentFailureStatus(second.decision);
  assert.equal(task.status, 202);
  assert.equal(task.retryAfter, 5);
  assert.equal(paymentFailureBody(second.decision).pending_id, first.decision.pendingId);
  const openai = openAiFailurePayload(second.decision);
  assert.equal(openai.status, 202);
  assert.equal(openai.body.error.pending_id, first.decision.pendingId);
  assert.match(openai.body.error.message, /Do not pay again/);
  assert.doesNotMatch(openai.body.error.message, /could not be settled/i);
});

test('a second call on a terminal late row is 409 refund_owed with the same id', async () => {
  const store = new ChallengeStore();
  const fixed = { validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  const first = await attempt({
    store,
    header: fixed,
    cfg: {
      lateIssue: true,
      chainReader: async () => ({ ok: true, amount: '1', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(first.decision.holdClass, 'terminal');
  const second = await attempt({
    store,
    nonce: first.nonce,
    header: fixed,
    cfg: { lateIssue: true, chainReader: async () => ({ ok: false, pending: true }) },
  });
  assert.equal(second.decision.pendingId, first.decision.pendingId);
  assert.equal(second.decision.holdClass, 'terminal');
  assert.equal(paymentFailureStatus(second.decision).status, 409);
  assert.equal(paymentFailureStatus(second.decision).retryAfter, null);
  const openai = openAiFailurePayload(second.decision);
  assert.equal(openai.status, 409);
  assert.equal(openai.body.error.status, 'refund_owed');
  assert.match(openai.body.error.message, /Refund owed/);
});

test('prior_unknown returns the stored code and does not settle again', async () => {
  const store = new ChallengeStore();
  const { settleHoldKey } = await import('../src/hold-handle.js');
  const nonce = '0x' + '21'.repeat(32);
  const fixed = { validBefore: '1893456000' };
  const header = paymentHeader(fixed);
  const paymentHash = crypto.createHash('sha256').update(header, 'utf8').digest('hex');
  store.put(nonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'unknown',
    payment_hash: paymentHash,
  });
  const opened = store.ensureHoldHandle({
    key: settleHoldKey('base', nonce),
    holdClass: 'resolvable',
    code: 'settle_failed',
    paymentHash,
  });
  const second = await attempt({
    store,
    nonce,
    challenge: null,
    header: fixed,
    fac: { settle: 'http500' },
  });
  assert.equal(second.hits.settle, 0);
  assert.equal(second.decision.pendingId, opened.pending_id);
  assert.equal(second.decision.code, 'settle_failed');
  assert.equal(second.decision.holdClass, 'resolvable');
  assert.equal(second.decision.preSettle, false);
  assert.equal(paymentFailureStatus(second.decision).status, 202);
});

test('the in-flight replay uses the late row id and the page follows it', async () => {
  const { inflightHoldDecision } = await import('../src/openai-gateway.js');
  const { holdPageForReceiptId, settleHoldKey } = await import('../src/hold-handle.js');
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const nonce = '0x' + 'ab'.repeat(32);
  store.put(nonce, {
    resource: 'https://api.chit402.com/v1/chat/completions',
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: 'USDC',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'issued',
  });
  const early = inflightHoldDecision(nonce, 'base');
  assert.match(early.pendingId, /^[0-9a-f]{32}$/);
  const lateId = hexId();
  store.putLate({
    pending_id: lateId,
    state: 'unknown',
    nonce,
    sent: true,
    hold_class: 'resolvable',
    payment_hash: 'abc',
  });
  store.linkHoldHandle(settleHoldKey('base', nonce), lateId);
  const again = inflightHoldDecision(nonce, 'base');
  assert.equal(again.pendingId, lateId);
  assert.deepEqual(holdPageForReceiptId(`late-${early.pendingId}`, store), { page: 'pending' });
  const row = store.getLate(lateId);
  row.public_receipt = { issuer_signature: { jws: 'header.payload.sig' }, task_id: `late-${lateId}` };
  row.receipt_id = `late-${lateId}`;
  assert.equal(holdPageForReceiptId(`late-${early.pendingId}`, store).page, 'receipt');
});

test('GET /receipt on the app serves a hold and matches unknown ids', async () => {
  process.env.NODE_ENV = 'test';
  process.env.HUB_CATALOG_OFFLINE = 'true';
  process.env.TASK_STORE_PERSIST = 'false';
  process.env.X402_ENABLED = 'false';
  const { initAIListener } = await import('../src/ai-listener.js');
  await initAIListener();
  const { createApp } = await import('../src/server.js');
  const app = await createApp();
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const owed = store.ensureHoldHandle({ key: 'pay:page-owed:stamp_underpaid', holdClass: 'terminal' });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(`${base}/receipt/late-${owed.pending_id}`, { headers: { accept: 'text/html' } });
    const json = await fetch(`${base}/receipt/late-${owed.pending_id}?format=json`, { headers: { accept: 'application/json' } });
    const unknownHold = await fetch(`${base}/receipt/late-${hexId()}`, { headers: { accept: 'text/html' } });
    const unknownOther = await fetch(`${base}/receipt/not-a-hold-${hexId()}`, { headers: { accept: 'text/html' } });
    assert.equal(html.status, 200, await html.clone().text());
    assert.equal(html.headers.get('cache-control'), 'private, no-store');
    assert.ok(html.headers.get('content-security-policy'), [...html.headers.entries()].map(([k]) => k).join(','));
    assert.match(await html.text(), /refund owed, do not pay again/);
    assert.equal((await json.json()).message, 'refund owed, do not pay again');
    const holdText = await unknownHold.text();
    const otherText = await unknownOther.text();
    assert.equal(unknownHold.status, unknownOther.status);
    assert.equal(holdText, otherText);
    assert.equal(unknownHold.headers.get('cache-control'), unknownOther.headers.get('cache-control'));
    let storeReads = 0;
    const origList = store.listLate.bind(store);
    store.listLate = () => { storeReads += 1; return origList(); };
    const origLink = store.holdPageLink.bind(store);
    store.holdPageLink = (id) => { storeReads += 1; return origLink(id); };
    const plain = await fetch(`${base}/receipt/plain-${hexId()}`, { headers: { accept: 'text/html' } });
    assert.equal(plain.status, unknownOther.status);
    assert.equal(storeReads, 0, 'a non-late receipt id does not read the challenge store');
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

function fillCap(store, n = 64) {
  for (let i = 0; i < n; i += 1) {
    store.putLate({ pending_id: hexId(), state: 'unknown', auth_key: `cap-x-${i}`, submitted_at: 1 });
  }
}

test('a successful capped settle writes no hold handle', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const { decision } = await attempt({
    store,
    cfg: {
      lateIssue: true,
      chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(decision.kind, 'settled', JSON.stringify(decision));
  assert.equal(store.holdHandles.length, 0);
});

test('a capped underpaid settle is terminal and its page says refund owed', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const { decision } = await attempt({
    store,
    cfg: {
      lateIssue: true,
      chainReader: async () => ({ ok: true, amount: '1', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(decision.holdClass, 'terminal');
  assert.equal(paymentFailureStatus(decision).status, 409);
  assert.equal(paymentFailureBody(decision).status, 'refund_owed');
  assert.deepEqual(holdPageForReceiptId(`late-${decision.pendingId}`, store), { page: 'refund_owed' });
});

test('a capped facilitator error is a released resolvable hold', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const { decision, nonce } = await attempt({
    store,
    fac: { settle: 'http500' },
    cfg: { lateIssue: true },
  });
  assert.equal(decision.holdClass, 'resolvable');
  assert.match(decision.pendingId, /^[0-9a-f]{32}$/);
  assert.equal(paymentFailureStatus(decision).status, 202);
  assert.equal(paymentFailureStatus(decision).retryAfter, 5);
  assert.equal(store.get(nonce).state, 'issued');
});

test('a throw after settle returns 202 with a handle', async () => {
  const store = new ChallengeStore();
  const { decision } = await attempt({
    store,
    cfg: {
      afterSent: () => { throw new Error('disk'); },
      chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(decision.code, 'settle_unconfirmed');
  assert.equal(decision.holdClass, 'resolvable');
  assert.match(decision.pendingId, /^[0-9a-f]{32}$/);
  assert.equal(paymentFailureStatus(decision).status, 202);
  assert.equal(paymentFailureStatus(decision).retryAfter, 5);
});

test('a released hold page follows the receipt after the retry settles', async () => {
  const store = new ChallengeStore();
  const fixed = { validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  const server = http.createServer((req, res) => {
    if (String(req.url).endsWith('/settle')) {
      res.statusCode = 500;
      res.end('{"error":"boom"}');
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
    const first = await attempt({
      store,
      header: fixed,
      cfg: { gatewayUrl: `http://127.0.0.1:${server.address().port}`, lateIssue: false },
    });
    assert.equal(first.decision.holdClass, 'resolvable');
    const second = await attempt({
      store,
      nonce: first.nonce,
      header: fixed,
      cfg: {
        lateIssue: false,
        chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
      },
    });
    assert.equal(second.decision.kind, 'settled', JSON.stringify(second.decision));
    const page = holdPageForReceiptId(`late-${first.decision.pendingId}`, store);
    assert.equal(page?.page, 'receipt');
    assert.ok(page.taskId);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('an issued late row is a receipt even when the class is resolvable', () => {
  const store = new ChallengeStore();
  const id = hexId();
  store.putLate({
    pending_id: id,
    state: 'issued',
    inline: true,
    task_id: 'task-issued-1',
    hold_class: 'resolvable',
    receipt_id: `late-${id}`,
  });
  assert.deepEqual(holdPageForReceiptId(`late-${id}`, store), { page: 'receipt', taskId: 'task-issued-1' });
});

test('a Solana in-flight replay reuses the payment network handle', async () => {
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const nonce = '0x' + 'cd'.repeat(32);
  store.put(nonce, {
    resource: 'https://api.chit402.com/v1/chat/completions',
    amount: '2000',
    payTo: HOUSE,
    network: 'solana',
    asset: 'USDC',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'issued',
  });
  const { settleHoldKey } = await import('../src/hold-handle.js');
  const { paymentHeaderDigest } = await import('../src/hold-handle.js');
  const inflightHeader = 'solana-inflight-header';
  const opened = store.ensureHoldHandle({
    key: settleHoldKey('solana', nonce),
    holdClass: 'resolvable',
    code: 'settle_failed',
    paymentHash: paymentHeaderDigest(inflightHeader),
  });
  const again = inflightHoldDecision(nonce, 'base', inflightHeader);
  assert.equal(again.pendingId, opened.pending_id);
  assert.equal(store.holdHandles.length, 1);
});

test('a Solana success:false exit is a released resolvable hold', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevOffline = process.env.HUB_CATALOG_OFFLINE;
  process.env.NODE_ENV = 'test';
  process.env.HUB_CATALOG_OFFLINE = 'true';
  const { runX402Handshake } = await import('../src/x402-server.js');
  const { startMockFacilitator } = await import('../src/x402-mock-facilitator.js');
  const { getActiveChallengeStore } = await import('../src/x402-durable-store.js');
  const payer = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
  const solana = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (String(req.url).endsWith('/settle')) {
        res.end(JSON.stringify({ success: false, settled: false, transaction: 'sig', payer }));
        return;
      }
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
      solana: { enabled: true, payTo: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', network: 'solana', facilitatorUrl: `http://127.0.0.1:${solana.address().port}` },
    };
    const baseUrl = 'https://api.chit402.com';
    const challenge = await runX402Handshake(
      { headers: {}, body: { model: 'xfuel/auto' } },
      { taskId: 'solana-release', cfg, baseUrl, resource: `${baseUrl}/v1/chat/completions` },
    );
    const solAccept = challenge.body.accepts.find((a) => String(a.network || '').startsWith('solana'));
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
      taskId: 'solana-release',
      cfg,
      baseUrl,
      resource: `${baseUrl}/v1/chat/completions`,
      amount: solAccept.amount,
    });
    assert.equal(held.holdClass, 'resolvable', JSON.stringify(held));
    assert.match(String(held.pendingId), /^[0-9a-f]{32}$/);
    assert.equal(paymentFailureStatus(held).status, 202);
    assert.equal(paymentFailureStatus(held).retryAfter, 5);
    const active = getActiveChallengeStore();
    assert.equal(active.get(nonce)?.state, 'issued');
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

test('ingest refusals after a collected stamp carry a terminal handle', async () => {
  const registry = new AgentRegistry();
  const ledger = new UsageSettledLedger();
  const identity = registry.allocate({ taskId: 'seat' });
  registry.bindWallet(identity.agent_id, { agentWallet: PAYER });
  const tx = `0x${'e1'.repeat(32)}`;
  const result = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx, payer: PAYER, network: 'base' },
    session: identity.session,
  }, {
    ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({ valid: false }),
    ensureStamp: async () => ({
      ok: true,
      waived: false,
      settlement: { paymentRef: 'base:0xstampingest', amount: '2000', payerWallet: PAYER },
    }),
  });
  assert.equal(result.status, 409);
  assert.equal(result.message, 'Do not pay again.');
  assert.match(result.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(result.outcome, 'refund_owed');
  assert.match(result.detail, /did not confirm/);
  assert.match(result.verify_url, /\/receipt\/late-[0-9a-f]{32}$/);
});

function assertHold(result, code) {
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.equal(result.outcome, 'refund_owed');
  assert.match(result.pending_id, /^[0-9a-f]{32}$/);
  assert.match(result.verify_url, /\/receipt\/late-[0-9a-f]{32}$/);
  assert.match(result.message, /Do not pay again/);
  if (code) assert.equal(result.code || result.error, code);
}

async function signedStampCall(stamp, extra = {}) {
  const signer = Wallet.createRandom();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(canonicalRegisterPayMessage(signer.address, timestamp));
  const ledger = extra.ledger || new UsageSettledLedger();
  const registry = extra.registry || new AgentRegistry();
  const result = await registerAgent({
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
    publicBaseUrl: 'https://api.chit402.com',
    ensureRegisterStamp: async () => stamp(signer),
    ...extra.deps,
  });
  return { result, signer, ledger, registry };
}

test('register hold sites after the stamp each return a handle', async () => {
  const thrown = await signedStampCall(() => { throw new Error('before settle'); });
  assert.equal(thrown.result.status, 402);
  assert.equal(thrown.result.pending_id, undefined);

  const presented = await signedStampCall(
    () => { throw new Error('after header'); },
    { deps: { stampPresented: true } },
  );
  assert.equal(presented.result.status, 409);
  assert.match(presented.result.message, /Do not pay again/);
  assert.equal(presented.result.pending_id, undefined);

  const nonce = '0x' + 'ab'.repeat(32);
  const header = paymentHeader({ validBefore: '1893456000' });
  const paymentHash = crypto.createHash('sha256').update(header, 'utf8').digest('hex');
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  store.put(nonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'unknown',
    payment_hash: paymentHash,
  });
  const { settleHoldKey } = await import('../src/hold-handle.js');
  const opened = store.ensureHoldHandle({
    key: settleHoldKey('base', nonce),
    holdClass: 'resolvable',
    code: 'settle_failed',
    paymentHash,
  });
  try {
    const traced = await signedStampCall(
      () => { throw new Error('after header'); },
      { deps: { stampPresented: true, stampNetwork: 'eip155:1', stampNonce: nonce, stampPaymentHeader: header } },
    );
    assertHold(traced.result, 'stamp_payment_required');
    assert.equal(traced.result.pending_id, opened.pending_id);
    assert.equal(store.holdHandles[0].key, settleHoldKey('base', nonce));
  } finally {
    setActiveChallengeStore(null);
  }

  const noRef = await signedStampCall(() => ({
    ok: true,
    waived: false,
    settlement: { amount: '2000', payerWallet: '0x' + '11'.repeat(20) },
  }));
  assert.equal(noRef.result.status, 409);
  assert.match(noRef.result.message, /Do not pay again/);

  const under = await signedStampCall((signer) => ({
    ok: true,
    waived: false,
    settlement: { paymentRef: 'base:0x' + 'c1'.repeat(32), amount: '1', payerWallet: signer.address },
  }));
  assertHold(under.result, 'stamp_underpaid');
  assert.match(under.result.verify_url, /^https:\/\/api\.chit402\.com\/receipt\/late-/);

  const dupRef = 'base:0x' + 'c2'.repeat(32);
  const dupLedger = new UsageSettledLedger();
  dupLedger.findByRef = () => ({ task_id: 'someone-else', agent_id: 9 });
  const dup = await signedStampCall((signer) => ({
    ok: true,
    waived: false,
    settlement: { paymentRef: dupRef, amount: '2000', payerWallet: signer.address },
  }), { ledger: dupLedger });
  assertHold(dup.result, 'duplicate_ref');

  const bindRef = 'base:0x' + 'c3'.repeat(32);
  const bindTask = `register-${crypto.createHash('sha256').update(bindRef).digest('hex').slice(0, 32)}`;
  const bindLedger = new UsageSettledLedger();
  bindLedger.findByRef = () => ({ task_id: bindTask, agent_id: 3 });
  const bindRegistry = new AgentRegistry();
  bindRegistry.get = () => ({ agentWallet: '0x' + '99'.repeat(20) });
  const bound = await signedStampCall((signer) => ({
    ok: true,
    waived: false,
    settlement: { paymentRef: bindRef, amount: '2000', payerWallet: signer.address },
  }), { ledger: bindLedger, registry: bindRegistry });
  assertHold(bound.result, 'bind_failed');

  const againRef = 'base:0x' + 'c4'.repeat(32);
  const againTask = `register-${crypto.createHash('sha256').update(againRef).digest('hex').slice(0, 32)}`;
  const againLedger = new UsageSettledLedger();
  againLedger.findByRef = () => ({ task_id: againTask, agent_id: 4 });
  const againRegistry = new AgentRegistry();
  againRegistry.bindWallet = () => ({ ok: false, reason: 'bind refused' });
  const again = await signedStampCall((signer) => ({
    ok: true,
    waived: false,
    settlement: { paymentRef: againRef, amount: '2000', payerWallet: signer.address },
  }), { ledger: againLedger, registry: againRegistry });
  assertHold(again.result, 'bind_failed');

  const appendLedger = new UsageSettledLedger();
  appendLedger.append = async () => ({ ok: false, code: 'append_failed', reason: 'full' });
  const appended = await signedStampCall((signer) => ({
    ok: true,
    waived: false,
    settlement: { paymentRef: 'base:0x' + 'c5'.repeat(32), amount: '2000', payerWallet: signer.address },
  }), { ledger: appendLedger });
  assertHold(appended.result, 'append_failed');
});

function ingestDeps(identity, registry, over = {}) {
  return {
    ledger: over.ledger === undefined ? new UsageSettledLedger() : over.ledger,
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: over.verify || (async () => ({ valid: true, payer: PAYER })),
    ensureStamp: async () => ({
      ok: true,
      waived: false,
      settlement: { paymentRef: 'base:0xstampingest', amount: '2000', payerWallet: PAYER },
    }),
  };
}

test('ingest hold sites that were unpinned each return a handle', async () => {
  const registry = new AgentRegistry();
  const identity = registry.allocate({ taskId: 'seat' });
  registry.bindWallet(identity.agent_id, { agentWallet: PAYER });
  const body = {
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: '0x' + 'e2'.repeat(32), payer: PAYER, network: 'base' },
    session: identity.session,
  };
  const noPayer = await ingestForeignX402(body, ingestDeps(identity, registry, {
    verify: async () => ({ valid: true }),
  }));
  assertHold(noPayer, 'payer_not_bound');

  const upto = await ingestForeignX402({
    ...body,
    payment_required: { resource: 'https://shop.example/v1', scheme: 'upto', payTo: HOUSE, max_amount: '5000' },
    payment_response: { tx: '0x' + 'e3'.repeat(32), payer: PAYER, network: 'base' },
  }, ingestDeps(identity, registry, {
    verify: async () => ({ valid: true, payer: PAYER }),
  }));
  assertHold(upto, 'payment_invalid');
  assert.match(upto.detail, /no amount/);

  const bareLedger = { findByRef() { return null; } };
  const unavailable = await ingestForeignX402({
    ...body,
    payment_response: { tx: '0x' + 'e4'.repeat(32), payer: PAYER, network: 'base' },
  }, ingestDeps(identity, registry, { ledger: bareLedger }));
  assertHold(unavailable, 'service_unavailable');

  const failing = new UsageSettledLedger();
  failing.append = async () => ({ ok: false, code: 'append_failed', reason: 'full' });
  const appended = await ingestForeignX402({
    ...body,
    payment_response: { tx: '0x' + 'e5'.repeat(32), payer: PAYER, network: 'base' },
  }, ingestDeps(identity, registry, { ledger: failing }));
  assertHold(appended, 'append_failed');

  const noRef = await ingestForeignX402({
    ...body,
    payment_response: { tx: '0x' + 'e6'.repeat(32), payer: PAYER, network: 'base' },
  }, {
    ...ingestDeps(identity, registry, { verify: async () => ({ valid: false }) }),
    ensureStamp: async () => ({ ok: true, waived: false, settlement: {} }),
  });
  assert.equal(noRef.status, 409);
  assert.match(noRef.message, /Do not pay again/);
  assert.equal(noRef.pending_id, undefined);
});

test('a stamp throw with no payment header stays 402 on ingest and the boards', async () => {
  const registry = new AgentRegistry();
  const identity = registry.allocate({ taskId: 'seat' });
  registry.bindWallet(identity.agent_id, { agentWallet: PAYER });
  const bare = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: '0x' + 'e7'.repeat(32), payer: PAYER, network: 'base' },
    session: identity.session,
  }, {
    ledger: new UsageSettledLedger(),
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({ valid: true, payer: PAYER }),
    ensureStamp: async () => { throw new Error('store down'); },
  });
  assert.equal(bare.status, 402);

  const presented = async () => { throw new Error('settled maybe'); };
  presented.stampAttempt = { presented: true, network: 'base', nonce: 'unit-ingest-nonce', baseUrl: 'http://127.0.0.1' };
  const held = await ingestForeignX402({
    payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
    payment_response: { tx: '0x' + 'e8'.repeat(32), payer: PAYER, network: 'base' },
    session: identity.session,
  }, {
    ledger: new UsageSettledLedger(),
    registry,
    agentId: identity.agent_id,
    session: identity.session,
    verify: async () => ({ valid: true, payer: PAYER }),
    ensureStamp: presented,
  });
  assert.equal(held.status, 409);
  assert.equal(held.pending_id, undefined);
  assert.equal(held.outcome, undefined);
  assert.match(held.message, /Do not pay again/);

  const jobStamp = async () => { throw new Error('job'); };
  jobStamp.stampAttempt = { presented: true, network: 'base', nonce: 'unit-job-nonce', baseUrl: 'http://127.0.0.1' };
  const job = await createBoardJob({
    text: 'ship the receipt',
    budget: '1000',
    deadline: new Date(Date.now() + 86400000).toISOString(),
  }, { actor: { agent_id: 1 }, ensureStamp: jobStamp, jobs: {} });
  assert.equal(job.status, 409);
  assert.equal(job.pending_id, undefined);
  assert.equal(job.outcome, undefined);
  assert.match(job.message, /Do not pay again/);

  const postStamp = async () => { throw new Error('post'); };
  postStamp.stampAttempt = { presented: true, network: 'base', nonce: 'unit-post-nonce', baseUrl: 'http://127.0.0.1' };
  const flagged = await flagBoardPost('p1', {
    posts: { get: () => ({ id: 'p1', status: 'live', flags: [], receipt_key: 'r' }) },
    actor: { agent_id: 1 },
    ensureStamp: postStamp,
  });
  assert.equal(flagged.status, 409);
  assert.equal(flagged.pending_id, undefined);
  assert.equal(flagged.outcome, undefined);
  assert.match(flagged.message, /Do not pay again/);
});

test('a hold with no stored hash is not returned on a later read', () => {
  const store = new ChallengeStore();
  const key = `settle:base:0x${'12'.repeat(32)}`;
  const opened = store.ensureHoldHandle({
    key,
    holdClass: 'resolvable',
    code: 'settle_failed',
  });
  assert.match(opened.pending_id, /^[0-9a-f]{32}$/);
  const again = store.ensureHoldHandle({
    key,
    holdClass: 'resolvable',
    code: 'settle_failed',
    paymentHash: 'ab'.repeat(32),
  });
  assert.equal(again, null);
  const bare = store.ensureHoldHandle({ key, holdClass: 'resolvable' });
  assert.equal(bare, null);
  assert.equal(store.holdHandles[0].hold_class, 'resolvable');
  assert.equal(store.getHoldHandle(opened.pending_id).pending_id, opened.pending_id);
});

test('a third party who knows the nonce cannot read or upgrade the hold', async () => {
  const { presentedStampHold, settleHoldKey } = await import('../src/hold-handle.js');
  const store = new ChallengeStore();
  const fixed = { validBefore: '1893456000' };
  const header = paymentHeader(fixed);
  const other = { ...fixed, signature: '0x' + '22'.repeat(65) };
  const paymentHash = crypto.createHash('sha256').update(header, 'utf8').digest('hex');
  const nonce = '0x' + '44'.repeat(32);
  store.put(nonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'solana',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'unknown',
    payment_hash: paymentHash,
  });
  const opened = store.ensureHoldHandle({
    key: settleHoldKey('solana', nonce),
    holdClass: 'resolvable',
    code: 'settle_failed',
    paymentHash,
  });
  const payer = await attempt({
    store,
    nonce,
    challenge: null,
    header: fixed,
    fac: { settle: 'http500' },
  });
  assert.equal(payer.hits.settle, 0);
  assert.equal(payer.decision.pendingId, opened.pending_id);
  assert.equal(payer.decision.holdClass, 'resolvable');

  const stranger = await attempt({
    store,
    nonce,
    challenge: null,
    header: other,
    fac: { settle: 'http500' },
  });
  assert.equal(stranger.hits.settle, 0);
  assert.equal(stranger.decision.pendingId, null);
  assert.equal(stranger.decision.preSettle, true);
  assert.equal(stranger.decision.code, 'settle_unconfirmed');
  assert.equal(store.holdHandles.find((row) => row.pending_id === opened.pending_id).hold_class, 'resolvable');

  const lateNonce = '0x' + '46'.repeat(32);
  const lateId = hexId();
  store.put(lateNonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'unknown',
  });
  store.putLate({
    pending_id: lateId,
    state: 'unknown',
    nonce: lateNonce,
    sent: true,
    hold_class: 'resolvable',
    payment_hash: paymentHash,
    public_code: 'settle_pending',
  });
  const latePayer = await attempt({
    store,
    nonce: lateNonce,
    challenge: null,
    header: fixed,
    cfg: { lateIssue: false },
    fac: { settle: 'http500' },
  });
  assert.equal(latePayer.decision.pendingId, lateId);
  const lateStranger = await attempt({
    store,
    nonce: lateNonce,
    challenge: null,
    header: other,
    cfg: { lateIssue: false },
    fac: { settle: 'http500' },
  });
  assert.equal(lateStranger.decision.pendingId, null);
  assert.equal(lateStranger.decision.code, 'settle_unconfirmed');

  const stolen = presentedStampHold('base', nonce, {
    paymentHeader: paymentHeader(other),
    store,
    publicBaseUrl: 'http://127.0.0.1',
  });
  assert.equal(stolen, null);
  const otherHash = crypto.createHash('sha256').update(paymentHeader(other), 'utf8').digest('hex');
  const forced = store.ensureHoldHandle({
    key: settleHoldKey('solana', nonce),
    holdClass: 'terminal',
    code: 'stamp_payment_required',
    paymentHash: otherHash,
  });
  assert.equal(forced, null);
  assert.equal(store.holdHandles.find((row) => row.pending_id === opened.pending_id).hold_class, 'resolvable');
  assert.equal(store.holdHandles.length, 1);

  const owed = presentedStampHold('base', nonce, {
    paymentHeader: header,
    store,
    publicBaseUrl: 'http://127.0.0.1',
  });
  assert.equal(owed.status, 409);
  assert.equal(owed.outcome, 'refund_owed');
  assert.equal(owed.pending_id, opened.pending_id);
  const row = store.holdHandles.find((item) => item.pending_id === opened.pending_id);
  assert.equal(row.hold_class, 'terminal');
  assert.equal(row.key, settleHoldKey('solana', nonce));

  const fresh = '0x' + '55'.repeat(32);
  store.put(fresh, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'issued',
    payment_hash: paymentHash,
  });
  const unclaimed = presentedStampHold('base', fresh, { paymentHeader: header, store });
  assert.equal(unclaimed, null);
  assert.equal(store.holdHandles.some((item) => item.key === settleHoldKey('base', fresh)), false);
  assert.equal(store.holdHandles.length, 1);
});

test('a bad signature does not keep the claim hash, and the payer still gets the handle', async () => {
  const { presentedStampHold, settleHoldKey } = await import('../src/hold-handle.js');
  const store = new ChallengeStore();
  const nonce = '0x' + '77'.repeat(32);
  const badHeader = 'bad-signature-header';
  const goodHeader = 'payer-signature-header';
  const badHash = crypto.createHash('sha256').update(badHeader, 'utf8').digest('hex');
  const goodHash = crypto.createHash('sha256').update(goodHeader, 'utf8').digest('hex');
  store.put(nonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'issued',
  });
  const squat = store.claim(nonce, 'stranger', 60_000, badHash);
  assert.equal(squat.ok, true);
  assert.equal(store.get(nonce).payment_hash ?? null, null);
  assert.equal(store.noteVerifiedPayment(nonce, badHash), true);
  assert.equal(store.release(nonce, 'stranger'), true);
  assert.equal(store.get(nonce).state, 'issued');
  assert.equal(store.get(nonce).payment_hash ?? null, null);
  assert.equal(store.claim(nonce, 'payer').ok, true);
  assert.equal(store.noteVerifiedPayment(nonce, goodHash), true);
  assert.equal(store.get(nonce).payment_hash, goodHash);
  assert.equal(store.markSubmitted(nonce), true);
  const stolen = presentedStampHold('base', nonce, { paymentHeader: badHeader, store });
  assert.equal(stolen, null);
  assert.equal(store.holdHandles.length, 0);
  const held = presentedStampHold('base', nonce, {
    paymentHeader: goodHeader,
    store,
    publicBaseUrl: 'http://127.0.0.1',
  });
  assert.equal(held.status, 409);
  assert.equal(held.outcome, 'refund_owed');
  assert.match(held.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(store.holdHandles[0].payment_hash, goodHash);
  assert.equal(store.holdHandles[0].key, settleHoldKey('base', nonce));
});

test('a third party cannot create or link a hold before the payer has a row', async () => {
  const { presentedStampHold, settleHoldKey } = await import('../src/hold-handle.js');
  const store = new ChallengeStore();
  const fixed = { validBefore: '1893456000' };
  const header = paymentHeader(fixed);
  const otherHeader = paymentHeader({ ...fixed, signature: '0x' + '22'.repeat(65) });
  const paymentHash = crypto.createHash('sha256').update(header, 'utf8').digest('hex');
  const otherHash = crypto.createHash('sha256').update(otherHeader, 'utf8').digest('hex');
  const nonce = '0x' + '66'.repeat(32);
  store.put(nonce, {
    resource: RESOURCE,
    amount: '2000',
    payTo: HOUSE,
    network: 'base',
    asset: USDC,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120000,
    state: 'issued',
  });
  const claimed = store.claim(nonce, 'payer', 60_000, paymentHash);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.challenge.payment_hash ?? null, null);
  assert.equal(store.noteVerifiedPayment(nonce, paymentHash), true);
  assert.equal(store.markSubmitted(nonce), true);
  assert.equal(store.holdHandles.length, 0);

  const stolen = presentedStampHold('solana', nonce, { paymentHeader: otherHeader, store });
  assert.equal(stolen, null);
  assert.equal(store.holdHandles.length, 0);

  const payer = presentedStampHold('solana', nonce, {
    paymentHeader: header,
    store,
    publicBaseUrl: 'http://127.0.0.1',
  });
  assert.equal(payer.status, 409);
  assert.equal(payer.outcome, 'refund_owed');
  assert.match(payer.pending_id, /^[0-9a-f]{32}$/);
  assert.equal(store.holdHandles.length, 1);
  assert.equal(store.holdHandles[0].payment_hash, paymentHash);
  assert.equal(store.holdHandles[0].key, settleHoldKey('base', nonce));

  const linkStolen = store.linkHoldHandle(settleHoldKey('base', nonce), { taskId: 'task-stolen' }, otherHash);
  assert.equal(linkStolen, null);
  assert.equal(store.holdHandles[0].linked_task_id, undefined);

  const linkPayer = store.linkHoldHandle(settleHoldKey('base', nonce), { taskId: 'task-real' }, paymentHash);
  assert.equal(linkPayer.pending_id, payer.pending_id);
  assert.equal(store.holdHandles[0].linked_task_id, 'task-real');
});

test('a store outage during a stamp throw is the 409 fallback', async () => {
  const registry = new AgentRegistry();
  const identity = registry.allocate({ taskId: 'seat' });
  registry.bindWallet(identity.agent_id, { agentWallet: PAYER });
  const boom = { isSpent() { throw new Error('lock timeout'); } };
  setActiveChallengeStore(boom);
  try {
    const result = await ingestForeignX402({
      payment_required: { resource: 'https://shop.example/v1', amount: '1000', payTo: HOUSE },
      payment_response: { tx: '0x' + 'e1'.repeat(32), payer: PAYER, network: 'base' },
      session: identity.session,
    }, {
      ledger: new UsageSettledLedger(),
      registry,
      agentId: identity.agent_id,
      session: identity.session,
      verify: async () => ({ valid: true, payer: PAYER }),
      ensureStamp: Object.assign(async () => { throw new Error('stamp'); }, {
        stampAttempt: {
          presented: true,
          network: 'base',
          nonce: '0x' + '99'.repeat(32),
          baseUrl: 'http://127.0.0.1',
          paymentHeader: 'present',
        },
      }),
    });
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal(result.pending_id, undefined);
    assert.equal(result.outcome, undefined);
    assert.match(result.message, /Do not pay again/);
  } finally {
    setActiveChallengeStore(null);
  }
});

test('a capped release then underpaid upgrades the same handle to refund owed', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const fixed = { validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  const first = await attempt({
    store,
    header: fixed,
    fac: { settle: 'http500' },
    cfg: { lateIssue: true },
  });
  assert.equal(first.decision.holdClass, 'resolvable');
  const second = await attempt({
    store,
    nonce: first.nonce,
    header: fixed,
    cfg: {
      lateIssue: true,
      chainReader: async () => ({ ok: true, amount: '1', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(second.decision.pendingId, first.decision.pendingId);
  assert.equal(second.decision.holdClass, 'terminal');
  assert.equal(store.holdHandles[0].hold_class, 'terminal');
  assert.equal(store.holdHandles[0].code, second.decision.code);
  assert.deepEqual(holdPageForReceiptId(`late-${first.decision.pendingId}`, store), { page: 'refund_owed' });
});

test('a capped release then a settled retry links the handle to the receipt', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const fixed = { validBefore: String(Math.floor(Date.now() / 1000) + 3600) };
  const first = await attempt({
    store,
    header: fixed,
    fac: { settle: 'http500' },
    cfg: { lateIssue: true },
  });
  const second = await attempt({
    store,
    nonce: first.nonce,
    header: fixed,
    cfg: {
      lateIssue: true,
      chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(second.decision.kind, 'settled', JSON.stringify(second.decision));
  assert.equal(store.holdHandles.length, 1);
  assert.equal(store.holdHandles[0].linked_task_id, second.decision.taskId);
  assert.deepEqual(
    holdPageForReceiptId(`late-${first.decision.pendingId}`, store),
    { page: 'receipt', taskId: second.decision.taskId },
  );
});

test('a throw after a capped settle opens the handle in the post-sent catch', async () => {
  const store = new ChallengeStore();
  fillCap(store);
  const { decision } = await attempt({
    store,
    cfg: {
      lateIssue: true,
      afterSent: () => { throw new Error('disk'); },
      chainReader: async () => ({ ok: true, amount: '2000', payTo: HOUSE, payer: PAYER, blockNumber: 1, logIndex: 0 }),
    },
  });
  assert.equal(decision.holdClass, 'resolvable');
  assert.match(decision.pendingId, /^[0-9a-f]{32}$/);
  assert.equal(store.holdHandles.length, 1);
  assert.equal(paymentFailureStatus(decision).status, 202);
});

test('a hold lookup that misses does not rewrite the durable store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hold-'));
  const file = join(dir, 'challenges.json');
  const store = new DurableChallengeStore(file, { createIfMissing: true });
  const before = readFileSync(file);
  assert.equal(store.findHoldHandleByKey('settle:base:0x' + 'ab'.repeat(32)), null);
  assert.equal(readFileSync(file).equals(before), true);
});

