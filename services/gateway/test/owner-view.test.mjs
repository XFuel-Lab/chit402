/**
 * Owner view attack tests O1–O17.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Wallet, ethers } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'owner-view-test-secret';
process.env.OWNER_VIEW_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chit-owner-view-')), 'owner-view.sqlite');
process.env.OWNER_VIEW_FETCH_MAX = '8000';
process.env.OWNER_VIEW_CHALLENGE_MAX = '800';
process.env.OWNER_VIEW_NOT_FOUND_BUDGET_MS = '8';

const payerA = Wallet.createRandom();
const payerB = Wallet.createRandom();
const payTo = Wallet.createRandom();
const housePayer = Wallet.createRandom();
const agentWallet = Wallet.createRandom();
const agentKey = Wallet.createRandom();
const otherAgentWallet = Wallet.createRandom();
const otherAgentKey = Wallet.createRandom();

process.env.HOUSE_AGENT_ID = '7';
process.env.HOUSE_PAYER_WALLETS = housePayer.address;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { getJwks } = await import('../src/issuer-key.js');
const { verifyReceiptEcdsaWithJwks } = await import('../src/receipt.js');
const { toPublicShell, jcsCanonicalize } = await import('../src/receipt-shell.js');
const { buildReceiptOgSvg } = await import('../src/receipt-og.js');
const {
  DEFAULT_NONCE_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
  NOT_FOUND_BODY,
  SOLANA_PREFIX,
  typedDataFor,
  solanaAddressFromBase64,
  agentBindMessage,
} = await import('../src/owner-view.js');

const TASK_A = 'xfuel-owner-a';
const TASK_B = 'xfuel-owner-b';
const MODEL = 'hidden-model-o10';
const PAYER_A = payerA.address;

let server;
let base;
let app;

function plant(taskId, payer, agentId) {
  const task = {
    taskId,
    status: 'completed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    intent: {
      type: 'inference_request',
      amount: '2000',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'ab'.repeat(32)}`,
      model: MODEL,
    },
    meta: {
      payerWallet: payer,
      agentId,
      provider: 'hidden-provider',
      payTo: payTo.address,
    },
    outputHash: `0x${'cd'.repeat(32)}`,
  };
  getAIListener().activeTasks.set(taskId, task);
  return task;
}

function httpJson({ method, url, headers = {}, body = null }) {
  const target = new URL(url);
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      method,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': String(payload.length),
        } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function challenge(scope, host) {
  const headers = {};
  if (host) headers.host = host;
  const res = await httpJson({
    method: 'POST',
    url: `${base}/v1/receipts/owner/challenge`,
    headers,
    body: { scope },
  });
  return { res, body: res.json };
}

async function openEvm(wallet, scope, host) {
  const issued = await challenge(scope, host);
  assert.equal(issued.res.status, 200, JSON.stringify(issued.body));
  const sig = await wallet.signTypedData(
    issued.body.typed_data.domain,
    issued.body.typed_data.types,
    issued.body.typed_data.message,
  );
  const headers = {};
  if (host) headers.host = host;
  const res = await httpJson({
    method: 'POST',
    url: `${base}/v1/receipts/owner/session`,
    headers,
    body: {
      challenge: issued.body.challenge,
      signature: sig,
      signer: wallet.address,
      kind: 'evm',
    },
  });
  return { res, body: res.json, issued: issued.body, signature: sig };
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function readNotFound(url, headers = {}) {
  const started = Date.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  return {
    ms: Date.now() - started,
    status: res.status,
    text,
    type: res.headers.get('content-type'),
    cache: res.headers.get('cache-control'),
    vary: res.headers.get('vary'),
    acao: res.headers.get('access-control-allow-origin'),
    acac: res.headers.get('access-control-allow-credentials'),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

before(async () => {
  await initAIListener();
  app = createApp();
  plant(TASK_A, PAYER_A, 4);
  plant(TASK_B, payerB.address, 4);
  app.locals.__test.agentRegistry.byId.set(4, {
    agent_id: 4,
    agentWallet: agentWallet.address,
    session: 'sess-a',
  });
  app.locals.__test.agentRegistry.byId.set(5, {
    agent_id: 5,
    agentWallet: otherAgentWallet.address,
    session: 'sess-b',
  });
  app.locals.__test.agentRegistry.byId.set(7, {
    agent_id: 7,
    agentWallet: housePayer.address,
    session: 'sess-house',
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  try { getAIListener().stopListening(); } catch { /* listener was not started */ }
  try { app?.locals?.ownerStore?.close?.(); } catch { /* store already closed */ }
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('O1 replay, expiry, and one winner on concurrent use', async () => {
  assert.equal(DEFAULT_NONCE_TTL_MS, 120_000);
  assert.equal(DEFAULT_SESSION_TTL_MS, 600_000);
  const opened = await openEvm(payerA, { receipt_ids: [TASK_A] });
  assert.equal(opened.res.status, 200);
  const again = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: opened.issued.challenge,
      signature: opened.signature,
      signer: payerA.address,
      kind: 'evm',
    }),
  });
  assert.equal(again.status, 401);
  assert.equal((await again.json()).error, 'unauthorized');

  const issued = await challenge({ payer: true });
  const sig = await payerA.signTypedData(
    issued.body.typed_data.domain,
    issued.body.typed_data.types,
    issued.body.typed_data.message,
  );
  const body = JSON.stringify({
    challenge: issued.body.challenge,
    signature: sig,
    signer: payerA.address,
    kind: 'evm',
  });
  const [first, second] = await Promise.all([
    fetch(`${base}/v1/receipts/owner/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
    fetch(`${base}/v1/receipts/owner/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 401]);

  const prev = process.env.OWNER_VIEW_NONCE_TTL_MS;
  process.env.OWNER_VIEW_NONCE_TTL_MS = '40';
  const shortApp = createApp();
  const short = await new Promise((resolve) => {
    const listening = shortApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const shortBase = `http://127.0.0.1:${short.address().port}`;
    const issuedShort = await fetch(`${shortBase}/v1/receipts/owner/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { payer: true } }),
    });
    const shortBody = await issuedShort.json();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 80);
      timer.unref();
    });
    const lateSig = await payerA.signTypedData(
      shortBody.typed_data.domain,
      shortBody.typed_data.types,
      shortBody.typed_data.message,
    );
    const late = await fetch(`${shortBase}/v1/receipts/owner/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challenge: shortBody.challenge,
        signature: lateSig,
        signer: payerA.address,
        kind: 'evm',
      }),
    });
    assert.equal(late.status, 401);
  } finally {
    if (prev == null) delete process.env.OWNER_VIEW_NONCE_TTL_MS;
    else process.env.OWNER_VIEW_NONCE_TTL_MS = prev;
    if (typeof short.closeAllConnections === 'function') short.closeAllConnections();
    await new Promise((resolve) => short.close(resolve));
  }
});

test('O2 a challenge signed for another host is rejected', async () => {
  const foreign = await challenge({ payer: true }, 'staging.example');
  assert.equal(foreign.res.status, 200);
  assert.equal(foreign.body.challenge.audience, 'staging.example');
  const sig = await payerA.signTypedData(
    foreign.body.typed_data.domain,
    foreign.body.typed_data.types,
    foreign.body.typed_data.message,
  );
  const res = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: foreign.body.challenge,
      signature: sig,
      signer: payerA.address,
      kind: 'evm',
    }),
  });
  assert.equal(res.status, 401);
});

test('O3 O4 O5 cross-agent, payer scope, and non-owners are the generic 404', async () => {
  const message = agentBindMessage(4, agentKey.address);
  const bind = await fetch(`${base}/v1/agents/4/owner-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      public_key: agentKey.address,
      wallet_signature: await agentWallet.signMessage(message),
      key_signature: await agentKey.signMessage(message),
    }),
  });
  assert.equal(bind.status, 200, await bind.clone().text());
  const otherMessage = agentBindMessage(5, otherAgentKey.address);
  const bindOther = await fetch(`${base}/v1/agents/5/owner-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      public_key: otherAgentKey.address,
      wallet_signature: await otherAgentWallet.signMessage(otherMessage),
      key_signature: await otherAgentKey.signMessage(otherMessage),
    }),
  });
  assert.equal(bindOther.status, 200);

  const issued = await challenge({ agent_id: 5 });
  const sig = await otherAgentKey.signMessage(jcsCanonicalize(issued.body.challenge));
  const opened = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: issued.body.challenge,
      signature: sig,
      signer: otherAgentKey.address,
      kind: 'agent',
    }),
  });
  assert.equal(opened.status, 200, await opened.clone().text());
  const token = (await opened.json()).token;
  const foreign = await readNotFound(`${base}/v1/receipts/${TASK_A}/owner`, auth(token));
  const unknown = await readNotFound(`${base}/v1/receipts/xfuel-does-not-exist/owner`, auth(token));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, unknown.text);
  assert.equal(foreign.text, NOT_FOUND_BODY);
  assert.equal(foreign.cache, unknown.cache);
  assert.equal(foreign.vary, unknown.vary);
  const bookForeign = await readNotFound(`${base}/v1/agents/4/book/owner`, auth(token));
  const bookUnknown = await readNotFound(`${base}/v1/agents/999999/book/owner`, auth(token));
  assert.equal(bookForeign.text, bookUnknown.text);

  const sessionA = await openEvm(payerA, { payer: true });
  const otherReceipt = await readNotFound(`${base}/v1/receipts/${TASK_B}/owner`, auth(sessionA.body.token));
  assert.equal(otherReceipt.status, 404);
  assert.equal(otherReceipt.text, NOT_FOUND_BODY);
  const own = await fetch(`${base}/v1/receipts/${TASK_A}/owner`, { headers: auth(sessionA.body.token) });
  assert.equal(own.status, 200, await own.clone().text());

  for (const wallet of [payTo, Wallet.createRandom()]) {
    const denied = await openEvm(wallet, { receipt_ids: [TASK_A] });
    assert.equal(denied.res.status, 200);
    const got = await readNotFound(`${base}/v1/receipts/${TASK_A}/owner`, auth(denied.body.token));
    assert.equal(got.text, NOT_FOUND_BODY);
  }
  const headerOnly = await readNotFound(`${base}/v1/receipts/${TASK_A}/owner`, { 'x-agent-id': '4' });
  assert.equal(headerOnly.text, NOT_FOUND_BODY);
});

test('O6 ERC-1271 passes for the payer and fails closed otherwise', async () => {
  const payer = Wallet.createRandom().address;
  const stranger = Wallet.createRandom().address;
  plant('xfuel-owner-1271', payer, 4);
  const iface = new ethers.Interface([
    'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  ]);
  const magic = iface.encodeFunctionResult('isValidSignature', ['0x1626ba7e']);
  app.locals.__test.ownerView.setRpcProvider({
    async getCode() { return '0x01'; },
    async call() { return magic; },
  });
  const issued = await challenge({ receipt_ids: ['xfuel-owner-1271'] });
  const ok = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: issued.body.challenge,
      signature: '0x1234',
      signer: payer,
      kind: 'erc1271',
    }),
  });
  assert.equal(ok.status, 200, await ok.clone().text());
  const token = (await ok.json()).token;
  const receipt = await fetch(`${base}/v1/receipts/xfuel-owner-1271/owner`, { headers: auth(token) });
  assert.equal(receipt.status, 200);

  const issuedBad = await challenge({ receipt_ids: ['xfuel-owner-1271'] });
  const bad = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: issuedBad.body.challenge,
      signature: '0x1234',
      signer: stranger,
      kind: 'erc1271',
    }),
  });
  assert.equal(bad.status, 200);
  const badToken = (await bad.json()).token;
  const denied = await readNotFound(`${base}/v1/receipts/xfuel-owner-1271/owner`, auth(badToken));
  assert.equal(denied.text, NOT_FOUND_BODY);

  app.locals.__test.ownerView.setRpcProvider({
    async getCode() { return '0x'; },
    async call({ to }) {
      if (String(to).toLowerCase() === stranger.toLowerCase()) {
        throw new Error('rpc down');
      }
      return ethers.zeroPadValue(Wallet.createRandom().address, 32);
    },
  });
  const rpcIssued = await challenge({ payer: true });
  const rpc = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: rpcIssued.body.challenge,
      signature: `0x${'11'.repeat(32)}`,
      signer: stranger,
      kind: 'erc1271',
    }),
  });
  assert.equal(rpc.status, 401);

  const factory = Wallet.createRandom().address;
  const inner = '0xabcd';
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'bytes', 'bytes'],
    [factory, '0x', inner],
  );
  const wrapped = `${encoded}${'6492'.repeat(16)}`;
  const wrapIssued = await challenge({ payer: true });
  const wrappedRes = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: wrapIssued.body.challenge,
      signature: wrapped,
      signer: payer,
      kind: 'erc6492',
    }),
  });
  assert.equal(wrappedRes.status, 401);
  app.locals.__test.ownerView.setRpcProvider(null);
});

test('O7 a challenge signature is not a transfer, permit, or Solana transaction', async () => {
  const issued = await challenge({ payer: true });
  const sig = await payerA.signTypedData(
    issued.body.typed_data.domain,
    issued.body.typed_data.types,
    issued.body.typed_data.message,
  );
  const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: usdc };
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  const message = {
    from: payerA.address,
    to: payTo.address,
    value: 1n,
    validAfter: 0n,
    validBefore: 1n,
    nonce: `0x${'11'.repeat(32)}`,
  };
  const recovered = ethers.verifyTypedData(domain, types, message, sig);
  assert.notEqual(recovered.toLowerCase(), payerA.address.toLowerCase());
  const permitSig = await payerA.signTypedData(domain, types, message);
  const asChallenge = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: issued.body.challenge,
      signature: permitSig,
      signer: payerA.address,
      kind: 'evm',
    }),
  });
  assert.equal(asChallenge.status, 401);
  const sol = Buffer.from(issued.body.solana_message_b64, 'base64').toString('utf8');
  assert.equal(sol.startsWith(SOLANA_PREFIX), true);
  assert.equal(sol.includes('not a Solana transaction'), true);
});

test('O8 enumeration returns identical 404s and the rate limit trips', async () => {
  const realRows = [];
  const unknownRows = [];
  for (let offset = 0; offset < 1000; offset += 25) {
    const batch = [];
    for (let i = offset; i < offset + 25; i += 1) {
      batch.push(readNotFound(`${base}/v1/receipts/${i % 2 === 0 ? TASK_A : TASK_B}/owner`).then((row) => realRows.push(row)));
      batch.push(readNotFound(`${base}/v1/receipts/xfuel-miss-${i}/owner`).then((row) => unknownRows.push(row)));
    }
    await Promise.all(batch);
  }
  for (let i = 0; i < realRows.length; i += 1) {
    assert.equal(realRows[i].status, 404);
    assert.equal(realRows[i].text, unknownRows[i].text);
    assert.equal(realRows[i].text, NOT_FOUND_BODY);
    assert.equal(realRows[i].type, unknownRows[i].type);
    assert.equal(realRows[i].cache, 'private, no-store');
    assert.equal(realRows[i].vary, 'Authorization');
    assert.equal(realRows[i].acao, null);
  }
  const realMedian = median(realRows.map((row) => row.ms));
  const unknownMedian = median(unknownRows.map((row) => row.ms));
  assert.ok(Math.abs(realMedian - unknownMedian) < 40, `medians ${realMedian} vs ${unknownMedian}`);

  const recordReal = await readNotFound(`${base}/v1/agents/4/record`);
  const recordUnknown = await readNotFound(`${base}/v1/agents/424242/record`);
  assert.equal(recordReal.text, recordUnknown.text);
  assert.equal(recordReal.text, NOT_FOUND_BODY);
  assert.equal(recordReal.cache, recordUnknown.cache);
  assert.equal(recordReal.vary, recordUnknown.vary);
  assert.equal(recordReal.type, recordUnknown.type);

  const prev = process.env.OWNER_VIEW_FETCH_MAX;
  process.env.OWNER_VIEW_FETCH_MAX = '2';
  const limitedApp = createApp();
  const limited = await new Promise((resolve) => {
    const listening = limitedApp.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const limitedBase = `http://127.0.0.1:${limited.address().port}`;
    const first = await fetch(`${limitedBase}/v1/receipts/missing-1/owner`);
    const second = await fetch(`${limitedBase}/v1/receipts/missing-2/owner`);
    const third = await fetch(`${limitedBase}/v1/receipts/missing-3/owner`);
    assert.equal(first.status, 404);
    assert.equal(second.status, 404);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, 'rate_limit_exceeded');
  } finally {
    if (prev == null) delete process.env.OWNER_VIEW_FETCH_MAX;
    else process.env.OWNER_VIEW_FETCH_MAX = prev;
    if (typeof limited.closeAllConnections === 'function') limited.closeAllConnections();
    await new Promise((resolve) => limited.close(resolve));
  }
});

test('O9 private material stays off public routes and private responses are uncached', async () => {
  const opened = await openEvm(payerA, { receipt_ids: [TASK_A] });
  const token = opened.body.token;
  app.locals.__test.saltStore.put({
    receiptId: TASK_A,
    salt: 'ef'.repeat(32),
    privateFields: { model: MODEL },
  });
  const owner = await fetch(`${base}/v1/receipts/${TASK_A}/owner`, { headers: auth(token) });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('cache-control'), 'private, no-store');
  assert.equal(owner.headers.get('vary'), 'Authorization');
  assert.equal(owner.headers.get('access-control-allow-origin'), null);
  const ownerBody = await owner.json();
  assert.equal(ownerBody.salt, 'ef'.repeat(32));
  const surfaces = [
    await (await fetch(`${base}/health`)).text(),
    await (await fetch(`${base}/stats`)).text(),
    await (await fetch(`${base}/stats?format=json`)).text(),
    await (await fetch(`${base}/stats/door`)).text(),
    await (await fetch(`${base}/receipt/${TASK_A}`)).text(),
    await (await fetch(`${base}/receipt/${TASK_A}?format=json`)).text(),
  ];
  for (const body of surfaces) {
    assert.equal(body.includes(token), false);
    assert.equal(body.includes(ownerBody.salt), false);
    assert.equal(body.includes(ownerBody.jws), false);
    assert.equal(body.includes(MODEL), false);
  }
});

test('O10 public surfaces for v1–v11 shells omit excluded fields', async () => {
  for (let version = 1; version <= 11; version += 1) {
    const shell = toPublicShell({
      task_id: `xfuel-v${version}`,
      created_at: 1_700_000_060,
      issuer_signature: { payload_version: version },
      payment: {
        gross_amount: '2000',
        settled_amount: '2000',
        ref: `base:0x${'ab'.repeat(32)}`,
        payee: payTo.address,
        asset: 'USDC',
        network: 'base',
      },
      route: { model: MODEL, provider: 'hidden-provider' },
      caller_binding: { payer_wallet: PAYER_A },
      usage: { prompt_tokens: 12, completion_tokens: 3 },
      output: { hash: `0x${'cd'.repeat(32)}`, text: 'plaintext-output' },
      book_id: 4,
      request_digest: 'digest-secret',
    });
    const raw = JSON.stringify(shell);
    assert.equal(shell.schema, 'chit402.receipt_shell.v1');
    assert.equal(shell.unsigned, true);
    assert.equal(shell.payload_version, version);
    for (const banned of [MODEL, 'hidden-provider', PAYER_A.toLowerCase(), 'prompt_tokens', 'plaintext-output', 'request_digest', 'issuer_signature']) {
      assert.equal(raw.toLowerCase().includes(banned.toLowerCase()), false, `${banned} in v${version}`);
    }
  }
  const page = await (await fetch(`${base}/receipt/${TASK_A}`)).text();
  const json = await (await fetch(`${base}/receipt/${TASK_A}?format=json`)).json();
  const auditor = await (await fetch(`${base}/receipt/${TASK_A}?format=auditor`)).json();
  const preimage = await (await fetch(`${base}/receipt/${TASK_A}/preimage`)).text();
  const raw = await (await fetch(`${base}/receipt/${TASK_A}/preimage?raw=1`)).text();
  const field = await fetch(`${base}/receipt/${TASK_A}/preimage/output`);
  const byTx = await fetch(`${base}/receipt/by-tx?tx=0x${'ab'.repeat(32)}`, { redirect: 'manual' });
  assert.equal(field.status, 404);
  assert.equal(json.schema, 'chit402.receipt_shell.v1');
  assert.equal(auditor.schema, 'chit402.receipt_shell.v1');
  assert.equal(byTx.status, 302);
  const svg = buildReceiptOgSvg({ task_id: TASK_A, payment: { gross_amount: '2000', rail: 'usdc', ref: `base:0x${'ab'.repeat(32)}`, collected: true }, route: { model: MODEL } });
  for (const body of [page, JSON.stringify(json), JSON.stringify(auditor), preimage, raw, svg]) {
    assert.equal(body.includes(MODEL), false);
    assert.equal(body.includes(PAYER_A), false);
    assert.equal(body.includes('issuer_signature'), false);
  }
});

test('O12 the owner view returns this receipt row_hash', async () => {
  const taskId = 'xfuel-owner-rowhash';
  plant(taskId, PAYER_A, 4);
  const appended = app.locals.__test.usageSettled.append({
    task_id: taskId,
    payment: {
      rail: 'usdc',
      collected: true,
      ref: `base:0x${'ef'.repeat(32)}`,
      gross_amount: '2000',
    },
    route: { model: MODEL },
  }, { payer: PAYER_A, agentId: 4 });
  assert.equal(appended.ok, true, appended.reason);
  const row = appended.entry.book_chain?.row_hash || appended.entry.row_hash;
  assert.match(String(row), /^[0-9a-f]{64}$/i);
  const opened = await openEvm(payerA, { receipt_ids: [taskId] });
  const body = await (await fetch(`${base}/v1/receipts/${taskId}/owner`, { headers: auth(opened.body.token) })).json();
  assert.equal(body.row_hash, row);
});

test('O12 the owner view returns the original JWS bytes', async () => {
  const opened = await openEvm(payerA, { receipt_ids: [TASK_A] });
  const first = await (await fetch(`${base}/v1/receipts/${TASK_A}/owner`, { headers: auth(opened.body.token) })).json();
  const second = await (await fetch(`${base}/v1/receipts/${TASK_A}/owner`, { headers: auth(opened.body.token) })).json();
  assert.equal(typeof first.jws, 'string');
  assert.equal(first.jws, second.jws);
  const verified = verifyReceiptEcdsaWithJwks(
    { issuer_signature: { jws: first.jws } },
    getJwks(),
    { validateClaims: false },
  );
  assert.equal(verified.valid, true, verified.reason || 'jws did not verify');
  const task = getAIListener().activeTasks.get(TASK_A);
  assert.equal(task.issuerSignature?.jws || task.issuer_signature?.jws, first.jws);
});

test('O13 owner view code does not sign with the receipt issuer key', () => {
  const source = fs.readFileSync(new URL('../src/owner-view.js', import.meta.url), 'utf8');
  assert.equal(source.includes('issuer-key'), false);
  assert.equal(source.includes('signJws'), false);
  assert.equal(source.includes('signReceiptEcdsa'), false);
});

test('O15 a cross-origin credentialed request cannot read the owner response', async () => {
  const opened = await openEvm(payerA, { payer: true });
  const res = await fetch(`${base}/v1/receipts/${TASK_A}/owner`, {
    headers: {
      ...auth(opened.body.token),
      origin: 'https://www.chit402.com',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('O16 public health and stats hide business fields', async () => {
  const names = [
    'tasks', 'settled', 'failed', 'first_seen', 'last_24h', 'last_7d', 'revenue', 'fees',
    'gross', 'fee_amount', 'usdc_fees', 'north_star', 'payers', 'unique_payers', 'payers_tracked',
    'payers_owing', 'by_provider', 'prompt_tokens', 'completion_tokens', 'tokens', 'proven_pct',
    'proofs', 'cogs_bps', 'cogs', 'floats', 'balance_ok', 'above_low_water', 'provider_health',
    'last_ok_at', 'uptime', 'uptime_s', 'server', 'fee_config', 'revenue_split', 'private_spend',
    'unsettled', 'stamped_receipts_7d', 'stamped_receipts_24h', 'series_30d',
  ];
  const bodies = [
    await (await fetch(`${base}/health`)).text(),
    await (await fetch(`${base}/stats`)).text(),
    await (await fetch(`${base}/stats?format=json`)).text(),
    await (await fetch(`${base}/stats/door`)).text(),
  ];
  for (const body of bodies) {
    for (const name of names) {
      assert.equal(body.includes(name), false, `${name} leaked`);
    }
  }
  const health = JSON.parse(bodies[0]);
  assert.equal(health.free_tier, 'available');
  assert.ok(health.status === 'ok' || health.status === 'degraded');
});

test('O17 a non-house session gets 404 on house metrics', async () => {
  const payer = await openEvm(payerA, { payer: true });
  const denied = await readNotFound(`${base}/v1/house/metrics`, auth(payer.body.token));
  assert.equal(denied.status, 404);
  assert.equal(denied.text, NOT_FOUND_BODY);
  const anon = await readNotFound(`${base}/v1/house/metrics`);
  assert.equal(anon.text, denied.text);
  const house = await openEvm(housePayer, { house: true });
  assert.equal(house.res.status, 200, JSON.stringify(house.body));
  const metrics = await fetch(`${base}/v1/house/metrics`, { headers: auth(house.body.token) });
  assert.equal(metrics.status, 200);
  assert.equal(metrics.headers.get('cache-control'), 'private, no-store');
  const body = await metrics.json();
  assert.equal(body.health.server, 'xfuel-m2m-api');
  assert.ok(body.health.fee_config.revenue_split);
  assert.ok(body.stats.north_star);
  assert.ok(body.door);
  assert.equal(body.health.free_tier.enforced === undefined || typeof body.health.free_tier === 'object', true);
});

test('Solana owner signatures use the prefixed message', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const signer = raw.toString('base64');
  const address = solanaAddressFromBase64(signer);
  plant('xfuel-owner-sol', address, null);
  const issued = await challenge({ receipt_ids: ['xfuel-owner-sol'] });
  const message = Buffer.from(issued.body.solana_message_b64, 'base64');
  const signature = crypto.sign(null, message, privateKey).toString('base64');
  const opened = await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: issued.body.challenge,
      signature,
      signer,
      kind: 'solana',
    }),
  });
  assert.equal(opened.status, 200, await opened.clone().text());
  const token = (await opened.json()).token;
  const receipt = await fetch(`${base}/v1/receipts/xfuel-owner-sol/owner`, { headers: auth(token) });
  assert.equal(receipt.status, 200, await receipt.clone().text());
});

test('typed data names the owner view and carries the statement', () => {
  const typed = typedDataFor({
    action: 'receipt.owner_view.v1',
    audience: 'api.chit402.com',
    scope: { payer: true },
    nonce: 'abc',
    issued_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-01-01T00:02:00.000Z',
  });
  assert.equal(typed.domain.name, 'Chit402 Receipt Owner View');
  assert.equal(typed.domain.chainId, 8453);
  assert.equal(typed.domain.verifyingContract, undefined);
  assert.match(typed.message.statement, /not a transfer, permit, or payment authorization/);
});
