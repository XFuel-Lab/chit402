/**
 * Book webhooks and agent owner keys survive a restart.
 * State changes go through the HTTP routes. Prod is never called.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const gatewayRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(gatewayRoot, '../..');
const childScript = fileURLToPath(new URL('./persist-gateway-child.mjs', import.meta.url));
const parentTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-parent-'));

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(parentTmp, 'tasks');
process.env.AGENTS_DIR = path.join(parentTmp, 'agents');
process.env.RECEIPT_LOG_BOOT = '0';
process.env.SPEND_HOLD_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'persist-webhook-test-secret';
process.env.ISSUER_TEST_KEY = '1';
process.env.ISSUER_HISTORY_TEST_ROTATION = 'true';
process.env.OWNER_VIEW_NOT_FOUND_BUDGET_MS = '0';
process.env.OWNER_VIEW_AUDIENCES = '127.0.0.1';
process.env.OWNER_VIEW_FETCH_MAX = '8000';
process.env.OWNER_VIEW_CHALLENGE_MAX = '800';
process.env.OWNER_VIEW_DB = path.join(parentTmp, 'owner.sqlite');
fs.mkdirSync(process.env.TASK_STORE_DIR, { recursive: true });
fs.mkdirSync(process.env.AGENTS_DIR, { recursive: true });

const DUMMY_SECRET = 'dummy-webhook-secret-0000';
const leakChunks = [];
const needles = new Set([DUMMY_SECRET]);

function track(value) {
  if (value != null && String(value).length > 0) needles.add(String(value));
}

function tapStream(stream) {
  const orig = stream.write.bind(stream);
  stream.write = (chunk, enc, cb) => {
    leakChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return orig(chunk, enc, cb);
  };
}
tapStream(process.stdout);
tapStream(process.stderr);

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt } = await import('../src/receipt.js');
const { canonicalRegisterRecoverMessage } = await import('../src/agent-registry.js');
const { regTask } = await import('./persist-reg-task.mjs');
const {
  writeAtomicJsonFile,
} = await import('../src/atomic-json-file.js');
const {
  BookWebhookRegistry,
  resetBookWebhookRegistry,
} = await import('../src/book-webhook.js');
const { AgentOwnerKeyStore, agentBindMessage } = await import('../src/agent-owner-key.js');
const { jcsCanonicalize } = await import('../src/receipt-shell.js');

await initAIListener();
after(() => {
  try { getAIListener().stopListening(); } catch { /* not started */ }
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'persist-wh-'));
}

function specFor(wallet, label) {
  return {
    taskId: `xfuel-persist-${label}-${crypto.randomBytes(4).toString('hex')}`,
    address: wallet.address,
    paymentRef: `base:0x${crypto.randomBytes(32).toString('hex')}`,
  };
}

function httpCall({ method, url, headers = {}, body = null }) {
  const target = new URL(url);
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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
        if (text) {
          try { json = JSON.parse(text); } catch { json = null; }
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(killer);
}

function spawnGateway(dir, { role, umask = null, plant = null }) {
  const agents = path.join(dir, 'agents');
  const tasks = path.join(dir, 'tasks');
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(tasks, { recursive: true });
  const result = path.join(dir, `result-${crypto.randomBytes(4).toString('hex')}.json`);
  let plantFile = '';
  if (plant) {
    plantFile = path.join(dir, `plant-${crypto.randomBytes(4).toString('hex')}.json`);
    fs.writeFileSync(plantFile, JSON.stringify(plant));
  }
  let output = '';
  const child = spawn(process.execPath, [childScript], {
    cwd: gatewayRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HUB_CATALOG_OFFLINE: 'true',
      X402_ENABLED: 'false',
      TASK_STORE_PERSIST: 'true',
      RECEIPT_LOG_BOOT: '0',
      SPEND_HOLD_ENABLED: 'false',
      RECEIPT_SIGNING_SECRET: 'persist-webhook-test-secret',
      ISSUER_TEST_KEY: '1',
      ISSUER_HISTORY_TEST_ROTATION: 'true',
      OWNER_VIEW_NOT_FOUND_BUDGET_MS: '0',
      OWNER_VIEW_AUDIENCES: '127.0.0.1',
      OWNER_VIEW_FETCH_MAX: '8000',
      OWNER_VIEW_CHALLENGE_MAX: '800',
      AGENTS_DIR: agents,
      TASK_STORE_DIR: tasks,
      OWNER_VIEW_DB: path.join(dir, 'owner.sqlite'),
      PERSIST_RESULT: result,
      PERSIST_PLANT: plantFile,
      PERSIST_ROLE: role,
      PERSIST_UMASK: umask == null ? '' : String(umask),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
  return {
    child,
    agents,
    result,
    output: () => output,
    stop: () => stopChild(child),
  };
}

async function waitResult(gateway) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (fs.existsSync(gateway.result)) {
      const text = fs.readFileSync(gateway.result, 'utf8');
      if (text.trim().startsWith('{')) return JSON.parse(text);
    }
    if (gateway.child.exitCode != null) {
      throw new Error(`child exited ${gateway.child.exitCode} before ready`);
    }
    await delay(20);
  }
  gateway.child.kill('SIGKILL');
  throw new Error('child timeout');
}

async function serve(dir, { umask = null, plant = [] } = {}) {
  const gateway = spawnGateway(dir, { role: 'serve', umask, plant });
  try {
    const info = await waitResult(gateway);
    if (!info.booted) {
      leakChunks.push(gateway.output());
      await gateway.stop();
      throw new Error(`boot failed ${info.code || ''}`);
    }
    return {
      base: `http://127.0.0.1:${info.port}`,
      agents: gateway.agents,
      output: gateway.output,
      stop: gateway.stop,
    };
  } catch (err) {
    leakChunks.push(gateway.output());
    await gateway.stop();
    throw err;
  }
}

async function bootChild(dir) {
  const gateway = spawnGateway(dir, { role: 'boot' });
  try {
    const info = await waitResult(gateway);
    leakChunks.push(gateway.output());
    await gateway.stop();
    return { info, output: gateway.output() };
  } catch (err) {
    leakChunks.push(gateway.output());
    await gateway.stop();
    throw err;
  }
}

async function register(base, wallet, spec) {
  const signatureTimestamp = Math.floor(Date.now() / 1000);
  const walletSignature = await wallet.signMessage(
    canonicalRegisterRecoverMessage(spec.taskId, wallet.address, signatureTimestamp),
  );
  track(walletSignature);
  const res = await httpCall({
    method: 'POST',
    url: `${base}/v1/agents/register`,
    body: {
      task_id: spec.taskId,
      agent_wallet: wallet.address,
      wallet_signature: walletSignature,
      signature_timestamp: signatureTimestamp,
    },
  });
  assert.equal(res.status, 200);
  track(res.json.session);
  return res.json;
}

async function plantParent(specs) {
  const listener = getAIListener();
  for (const spec of specs) {
    const task = regTask(spec);
    listener.activeTasks.set(task.taskId, task);
    await buildReceipt(task, { persistSignature: true, payerWallet: spec.address });
  }
}

function sessionHeader(session) {
  return { 'x-xfuel-session': session };
}

async function putWebhook(base, agentId, session, body) {
  return httpCall({
    method: 'PUT',
    url: `${base}/v1/agents/${agentId}/book/webhook`,
    headers: sessionHeader(session),
    body,
  });
}

async function getWebhook(base, agentId, session) {
  return httpCall({
    method: 'GET',
    url: `${base}/v1/agents/${agentId}/book/webhook`,
    headers: session ? sessionHeader(session) : {},
  });
}

async function inflow(base, agentId, session, taskId) {
  const res = await httpCall({
    method: 'POST',
    url: `${base}/v1/agents/${agentId}/book/inflow`,
    headers: sessionHeader(session),
    body: { allocation: '1500', bucket: 'patron', task_id: taskId },
  });
  assert.equal(res.status, 201);
  return res;
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}/hook`,
        close: () => new Promise((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

async function openAgent(base, agentId, key) {
  const issued = await httpCall({
    method: 'POST',
    url: `${base}/v1/receipts/owner/challenge`,
    body: { scope: { agent_id: agentId } },
  });
  if (issued.status !== 200) return { issued, opened: null };
  const signature = await key.signMessage(jcsCanonicalize(issued.json.challenge));
  track(signature);
  const opened = await httpCall({
    method: 'POST',
    url: `${base}/v1/receipts/owner/session`,
    body: {
      challenge: issued.json.challenge,
      signature,
      signer: key.address,
      kind: 'agent',
    },
  });
  track(opened.json?.token);
  return { issued, opened };
}

async function bindKey(base, agentId, agentWallet, key) {
  const message = agentBindMessage(agentId, key.address);
  const walletSignature = await agentWallet.signMessage(message);
  const keySignature = await key.signMessage(message);
  track(walletSignature);
  track(keySignature);
  return httpCall({
    method: 'POST',
    url: `${base}/v1/agents/${agentId}/owner-key`,
    body: {
      public_key: key.address,
      wallet_signature: walletSignature,
      key_signature: keySignature,
    },
  });
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

function readSrc(rel) {
  return fs.readFileSync(path.join(gatewayRoot, rel), 'utf8').replace(/\r\n/g, '\n');
}

function normalizePinBody(body) {
  const match = /"secret_once":"([0-9a-fA-F]+)"/.exec(body);
  if (match) {
    assert.equal(/^[0-9a-f]{64}$/.test(match[1]), true);
    track(match[1]);
  }
  return body
    .replace(/"secret_once":"[0-9a-fA-F]{64}"/g, `"secret_once":"${'0'.repeat(64)}"`)
    .replace(/"createdAt":\d+/g, '"createdAt":0')
    .replace(/"updatedAt":\d+/g, '"updatedAt":0')
    .replace(/"boundAt":\d+/g, '"boundAt":0');
}

const DROP_HEADERS = new Set(['date', 'etag', 'content-length', 'x-ratelimit-remaining', 'x-ratelimit-reset']);

function pinHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (DROP_HEADERS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

async function closeApp(app, server) {
  try { app?.locals?.ownerStore?.close?.(); } catch { /* already closed */ }
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('1 webhook restart in a fresh process delivers with the same secret', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't1');
  const hits = [];
  const sink = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      hits.push({ raw, sig: req.headers['x-chit-signature'] || '' });
      res.writeHead(200).end('ok');
    });
  });
  let first;
  let second;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    const put = await putWebhook(first.base, identity.agent_id, identity.session, {
      url: sink.url,
      secret: DUMMY_SECRET,
      events: ['settle', 'inflow'],
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.secret_once, undefined);
    const before = await getWebhook(first.base, identity.agent_id, identity.session);
    assert.equal(before.status, 200);
    assert.deepEqual(before.json.webhook.events, ['settle', 'inflow']);
    leakChunks.push(first.output());
    await first.stop();
    first = null;

    second = await serve(dir);
    const after = await getWebhook(second.base, identity.agent_id, identity.session);
    assert.equal(after.text, before.text);
    await inflow(second.base, identity.agent_id, identity.session, `${spec.taskId}-in`);
    const start = Date.now();
    while (hits.length < 1 && Date.now() - start < 4000) await delay(30);
    assert.equal(hits.length >= 1, true);
    const expected = `sha256=${crypto.createHmac('sha256', DUMMY_SECRET).update(hits[0].raw).digest('hex')}`;
    track(hits[0].sig);
    assert.equal(hits[0].sig, expected);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'agents', 'book-webhooks.json'), 'utf8'));
    assert.deepEqual(Object.keys(snap), ['version', 'webhooks']);
    assert.equal(`keys=${Object.keys(snap).length};webhooks=${Object.keys(snap.webhooks).length}`, 'keys=2;webhooks=1');
  } finally {
    if (first) {
      leakChunks.push(first.output());
      await first.stop();
    }
    if (second) {
      leakChunks.push(second.output());
      await second.stop();
    }
    await sink.close();
  }
});

test('2 a second createApp in-process reloads the webhook file', async () => {
  const dir = dataDir();
  const agents = path.join(dir, 'agents');
  fs.mkdirSync(agents, { recursive: true });
  process.env.AGENTS_DIR = agents;
  process.env.OWNER_VIEW_DB = path.join(dir, 'owner.sqlite');
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't2');
  await plantParent([spec]);
  const app1 = await createApp();
  const server1 = await new Promise((resolve) => {
    const listening = app1.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base1 = `http://127.0.0.1:${server1.address().port}`;
  let app2;
  let server2;
  try {
    const identity = await register(base1, wallet, spec);
    const put = await putWebhook(base1, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/same-process',
      secret: DUMMY_SECRET,
      events: ['collected', 'settle'],
    });
    assert.equal(put.status, 200);
    const before = await getWebhook(base1, identity.agent_id, identity.session);
    resetBookWebhookRegistry();
    app2 = await createApp();
    server2 = await new Promise((resolve) => {
      const listening = app2.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base2 = `http://127.0.0.1:${server2.address().port}`;
    const after = await getWebhook(base2, identity.agent_id, identity.session);
    assert.equal(after.text, before.text);
    assert.deepEqual(after.json.webhook.events, ['collected', 'settle']);
  } finally {
    await closeApp(app1, server1);
    await closeApp(app2, server2);
  }
});

test('3 delivery counters survive a restart', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't3');
  const okSink = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.writeHead(200).end('ok'));
  });
  const badSink = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.writeHead(500).end('no'));
  });
  let first;
  let second;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    let put = await putWebhook(first.base, identity.agent_id, identity.session, {
      url: okSink.url,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    });
    assert.equal(put.status, 200);
    await inflow(first.base, identity.agent_id, identity.session, `${spec.taskId}-ok`);
    let seen;
    const startOk = Date.now();
    while (Date.now() - startOk < 4000) {
      seen = await getWebhook(first.base, identity.agent_id, identity.session);
      if (seen.json?.webhook?.deliveries === 1) break;
      await delay(30);
    }
    assert.equal(seen.json.webhook.deliveries, 1);
    put = await putWebhook(first.base, identity.agent_id, identity.session, {
      url: badSink.url,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    });
    assert.equal(put.status, 200);
    await inflow(first.base, identity.agent_id, identity.session, `${spec.taskId}-bad`);
    const startBad = Date.now();
    while (Date.now() - startBad < 5000) {
      seen = await getWebhook(first.base, identity.agent_id, identity.session);
      if (seen.json?.webhook?.failures === 1) break;
      await delay(40);
    }
    assert.equal(seen.json.webhook.deliveries, 1);
    assert.equal(seen.json.webhook.failures, 1);
    assert.equal(seen.json.webhook.lastStatus, null);
    assert.equal(seen.json.webhook.lastError, 'HTTP 500');
    const before = seen.text;
    leakChunks.push(first.output());
    await first.stop();
    first = null;
    second = await serve(dir);
    const after = await getWebhook(second.base, identity.agent_id, identity.session);
    assert.equal(after.text, before);
  } finally {
    if (first) {
      leakChunks.push(first.output());
      await first.stop();
    }
    if (second) {
      leakChunks.push(second.output());
      await second.stop();
    }
    await okSink.close();
    await badSink.close();
  }
});

test('4 owner-key bind survives a restart and an unbound dir still refuses', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  const spec = specFor(wallet, 't4');
  let first;
  let second;
  let control;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    const bound = await bindKey(first.base, identity.agent_id, wallet, key);
    assert.equal(bound.status, 200);
    assert.equal(bound.text, `{"bound":true,"agent_id":${identity.agent_id}}`);
    await first.stop();
    first = null;
    second = await serve(dir);
    const opened = await openAgent(second.base, identity.agent_id, key);
    assert.equal(opened.opened.status, 200);
    const book = await httpCall({
      method: 'GET',
      url: `${second.base}/v1/agents/${identity.agent_id}/book/owner`,
      headers: { authorization: `Bearer ${opened.opened.json.token}` },
    });
    assert.equal(book.status, 200);
    assert.equal(book.json.agent_id, identity.agent_id);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'agents', 'agent-owner-keys.json'), 'utf8'));
    assert.deepEqual(Object.keys(snap), ['version', 'bindings']);
    assert.equal(`keys=${Object.keys(snap).length};bindings=${Object.keys(snap.bindings).length}`, 'keys=2;bindings=1');

    const bare = dataDir();
    const bareWallet = Wallet.createRandom();
    const bareKey = Wallet.createRandom();
    const bareSpec = specFor(bareWallet, 't4c');
    control = await serve(bare, { plant: [bareSpec] });
    const bareIdentity = await register(control.base, bareWallet, bareSpec);
    const refused = await openAgent(control.base, bareIdentity.agent_id, bareKey);
    assert.equal(refused.opened.status, 401);
    assert.equal(refused.opened.text, '{"error":"unauthorized"}');
  } finally {
    for (const gateway of [first, second, control]) {
      if (!gateway) continue;
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
  }
});

test('5 delete survives a restart and matches a never-set agent', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't5');
  let first;
  let second;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    const unset = await getWebhook(first.base, identity.agent_id, identity.session);
    const put = await putWebhook(first.base, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/gone',
      secret: DUMMY_SECRET,
      events: ['settle'],
    });
    assert.equal(put.status, 200);
    const removed = await httpCall({
      method: 'DELETE',
      url: `${first.base}/v1/agents/${identity.agent_id}/book/webhook`,
      headers: sessionHeader(identity.session),
    });
    assert.equal(removed.status, 200);
    await first.stop();
    first = null;
    second = await serve(dir);
    const after = await getWebhook(second.base, identity.agent_id, identity.session);
    assert.equal(after.text, unset.text);
    assert.equal(after.text.includes('"webhook":null'), true);
  } finally {
    for (const gateway of [first, second]) {
      if (!gateway) continue;
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
  }
});

test('6 rebind leaves only the second key after a restart', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const firstKey = Wallet.createRandom();
  const secondKey = Wallet.createRandom();
  const spec = specFor(wallet, 't6');
  let first;
  let second;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    assert.equal((await bindKey(first.base, identity.agent_id, wallet, firstKey)).status, 200);
    assert.equal((await bindKey(first.base, identity.agent_id, wallet, secondKey)).status, 200);
    await first.stop();
    first = null;
    second = await serve(dir);
    const old = await openAgent(second.base, identity.agent_id, firstKey);
    assert.equal(old.opened.status, 401);
    assert.equal(old.opened.text, '{"error":"unauthorized"}');
    const next = await openAgent(second.base, identity.agent_id, secondKey);
    assert.equal(next.opened.status, 200);
  } finally {
    for (const gateway of [first, second]) {
      if (!gateway) continue;
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
  }
});

test('7 a late delivery does not resurrect a deleted or replaced hook', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't7');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let arrived;
  const seen = new Promise((resolve) => { arrived = resolve; });
  const slow = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      arrived();
      gate.then(() => {
        if (!res.writableEnded) res.writeHead(200).end('ok');
      });
    });
  });
  let first;
  let second;
  try {
    first = await serve(dir, { plant: [spec] });
    const identity = await register(first.base, wallet, spec);
    assert.equal((await putWebhook(first.base, identity.agent_id, identity.session, {
      url: slow.url,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    })).status, 200);
    await inflow(first.base, identity.agent_id, identity.session, `${spec.taskId}-slow`);
    await Promise.race([seen, delay(4000).then(() => { throw new Error('slow hook was not called'); })]);
    const removed = await httpCall({
      method: 'DELETE',
      url: `${first.base}/v1/agents/${identity.agent_id}/book/webhook`,
      headers: sessionHeader(identity.session),
    });
    assert.equal(removed.status, 200);
    release();
    await delay(400);
    const gone = await getWebhook(first.base, identity.agent_id, identity.session);
    assert.equal(gone.json.webhook, null);
    await first.stop();
    first = null;
    second = await serve(dir);
    const after = await getWebhook(second.base, identity.agent_id, identity.session);
    assert.equal(after.json.webhook, null);
    await second.stop();
    second = null;

    let release2;
    const gate2 = new Promise((resolve) => { release2 = resolve; });
    let arrived2;
    const seen2 = new Promise((resolve) => { arrived2 = resolve; });
    const slow2 = await listen((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        arrived2();
        gate2.then(() => {
          if (!res.writableEnded) res.writeHead(200).end('ok');
        });
      });
    });
    try {
      first = await serve(dir, { plant: [spec] });
      assert.equal((await putWebhook(first.base, identity.agent_id, identity.session, {
        url: slow2.url,
        secret: DUMMY_SECRET,
        events: ['inflow'],
      })).status, 200);
      await inflow(first.base, identity.agent_id, identity.session, `${spec.taskId}-repl`);
      await Promise.race([seen2, delay(4000).then(() => { throw new Error('replaced hook was not called'); })]);
      const replaced = await putWebhook(first.base, identity.agent_id, identity.session, {
        url: 'http://127.0.0.1:9/replacement',
        secret: DUMMY_SECRET,
        events: ['settle'],
      });
      assert.equal(replaced.status, 200);
      release2();
      await delay(400);
      const live = await getWebhook(first.base, identity.agent_id, identity.session);
      assert.equal(live.json.webhook.url_path, '/replacement');
      assert.equal(live.json.webhook.deliveries, 0);
      assert.equal(live.json.webhook.failures, 0);
      assert.deepEqual(live.json.webhook.events, ['settle']);
      const before = live.text;
      await first.stop();
      first = null;
      second = await serve(dir);
      const restarted = await getWebhook(second.base, identity.agent_id, identity.session);
      assert.equal(restarted.text, before);
    } finally {
      await slow2.close();
    }
  } finally {
    for (const gateway of [first, second]) {
      if (!gateway) continue;
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
    await slow.close();
  }
});

test('8 webhook and owner-key files are mode 600 under umask 022 and 000', async () => {
  for (const umask of ['022', '000']) {
    const dir = dataDir();
    const wallet = Wallet.createRandom();
    const key = Wallet.createRandom();
    const spec = specFor(wallet, `t8-${umask}`);
    const gateway = await serve(dir, { umask, plant: [spec] });
    try {
      const identity = await register(gateway.base, wallet, spec);
      assert.equal((await putWebhook(gateway.base, identity.agent_id, identity.session, {
        url: 'http://127.0.0.1:9/mode',
        secret: DUMMY_SECRET,
        events: ['settle'],
      })).status, 200);
      assert.equal((await bindKey(gateway.base, identity.agent_id, wallet, key)).status, 200);
      assert.equal(modeOf(path.join(gateway.agents, 'book-webhooks.json')), 0o600);
      assert.equal(modeOf(path.join(gateway.agents, 'agent-owner-keys.json')), 0o600);
    } finally {
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
  }
});

test('9 a mid-write failure leaves the target and the memory unchanged', async () => {
  const steps = ['write', 'fsync', 'rename'];
  for (const step of steps) {
    const dir = dataDir();
    const target = path.join(dir, 'snap.json');
    const prior = '{"version":1,"ok":true}';
    fs.writeFileSync(target, prior);
    const fake = {
      openSync: fs.openSync.bind(fs),
      writeSync(fd, data, ...args) {
        if (step === 'write') {
          fs.writeSync(fd, String(data).slice(0, 1));
          throw new Error('write failed');
        }
        return fs.writeSync(fd, data, ...args);
      },
      fsyncSync(fd) {
        if (step === 'fsync') throw new Error('fsync failed');
        return fs.fsyncSync(fd);
      },
      closeSync: fs.closeSync.bind(fs),
      renameSync(from, to) {
        if (step === 'rename') throw new Error('rename failed');
        return fs.renameSync(from, to);
      },
      unlinkSync: fs.unlinkSync.bind(fs),
    };
    assert.throws(
      () => writeAtomicJsonFile(target, '{"version":1,"ok":false}', { fs: fake, label: 'atomic-json: save failed' }),
      (err) => err.code === 'persist_failed',
    );
    assert.equal(fs.readFileSync(target, 'utf8'), prior);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('tmp')), []);
  }

  const dir = dataDir();
  const file = path.join(dir, 'book-webhooks.json');
  const stored = {
    version: 1,
    webhooks: {
      1: {
        agent_id: 1,
        url: 'http://127.0.0.1:9/prior',
        secret: DUMMY_SECRET,
        events: ['settle', 'collected'],
        enabled: true,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        deliveries: 2,
        failures: 1,
        lastStatus: 200,
        lastError: null,
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(stored));
  const before = fs.readFileSync(file);
  const failing = {
    mkdirSync: fs.mkdirSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    writeSync() { throw new Error('write failed'); },
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
  };
  const store = new BookWebhookRegistry({ dir, persist: true, fs: failing });
  assert.equal(store.get(1).url, 'http://127.0.0.1:9/prior');
  assert.throws(
    () => store.upsert(1, {
      url: 'http://127.0.0.1:9/next',
      secret: DUMMY_SECRET,
      events: ['inflow'],
    }),
    (err) => err.code === 'persist_failed',
  );
  assert.equal(store.get(1).url, 'http://127.0.0.1:9/prior');
  assert.equal(store.get(1).deliveries, 2);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('tmp')), []);
  assert.equal(Buffer.compare(fs.readFileSync(file), before), 0);

  const ownerFile = path.join(dir, 'agent-owner-keys.json');
  const ownerBefore = JSON.stringify({
    version: 1,
    bindings: {
      1: {
        agentId: 1,
        publicKey: '0x' + 'ab'.repeat(20),
        boundAt: 1700000000000,
      },
    },
  });
  fs.writeFileSync(ownerFile, ownerBefore);
  const keys = new AgentOwnerKeyStore({ dir, persist: true, fs: failing });
  const agentWallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  const message = agentBindMessage(1, key.address);
  const walletSignature = await agentWallet.signMessage(message);
  const keySignature = await key.signMessage(message);
  track(walletSignature);
  track(keySignature);
  assert.throws(
    () => keys.bind({
      agentId: 1,
      publicKey: key.address,
      walletSignature,
      keySignature,
      agentWallet: agentWallet.address,
    }),
    (err) => err.code === 'persist_failed',
  );
  assert.equal(keys.get(1).publicKey, '0x' + 'ab'.repeat(20));
  assert.equal(fs.readFileSync(ownerFile, 'utf8'), ownerBefore);
});

test('10 a non-writable agents dir fails the write and keeps the prior state', async (t) => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  const spec = specFor(wallet, 't10');
  const gateway = await serve(dir, { plant: [spec] });
  let locked = false;
  try {
    const identity = await register(gateway.base, wallet, spec);
    const put = await putWebhook(gateway.base, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/kept',
      secret: DUMMY_SECRET,
      events: ['settle', 'inflow'],
    });
    assert.equal(put.status, 200);
    const before = await getWebhook(gateway.base, identity.agent_id, identity.session);
    const snap = path.join(gateway.agents, 'book-webhooks.json');
    const snapBytes = fs.readFileSync(snap);
    fs.rmSync(snap);
    fs.mkdirSync(snap);
    const blockedPut = await putWebhook(gateway.base, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/blocked',
      secret: DUMMY_SECRET,
      events: ['collected'],
    });
    assert.equal(blockedPut.status, 500);
    assert.equal(blockedPut.text, '{"error":"internal","code":"book_webhook_failed"}');
    const blockedDelete = await httpCall({
      method: 'DELETE',
      url: `${gateway.base}/v1/agents/${identity.agent_id}/book/webhook`,
      headers: sessionHeader(identity.session),
    });
    assert.equal(blockedDelete.status, 500);
    assert.equal(blockedDelete.text, '{"error":"internal","code":"book_webhook_failed"}');
    const keptInMemory = await getWebhook(gateway.base, identity.agent_id, identity.session);
    assert.equal(keptInMemory.text, before.text);
    fs.rmSync(snap, { recursive: true });
    fs.writeFileSync(snap, snapBytes);
    fs.chmodSync(snap, 0o600);
    fs.chmodSync(gateway.agents, 0o500);
    locked = true;
    let writable = false;
    try {
      fs.writeFileSync(path.join(gateway.agents, 'probe-write'), 'x');
      writable = true;
    } catch {
      writable = false;
    }
    if (writable) {
      fs.chmodSync(gateway.agents, 0o700);
      locked = false;
      t.skip('this process can still write a mode-500 directory');
      return;
    }
    const failedPut = await putWebhook(gateway.base, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/replaced',
      secret: DUMMY_SECRET,
      events: ['collected'],
    });
    assert.equal(failedPut.status, 500);
    assert.equal(failedPut.text, '{"error":"internal","code":"book_webhook_failed"}');
    const still = await getWebhook(gateway.base, identity.agent_id, identity.session);
    assert.equal(still.text, before.text);
    const failedDelete = await httpCall({
      method: 'DELETE',
      url: `${gateway.base}/v1/agents/${identity.agent_id}/book/webhook`,
      headers: sessionHeader(identity.session),
    });
    assert.equal(failedDelete.status, 500);
    assert.equal(failedDelete.text, '{"error":"internal","code":"book_webhook_failed"}');
    const kept = await getWebhook(gateway.base, identity.agent_id, identity.session);
    assert.equal(kept.text, before.text);
    const failedBind = await bindKey(gateway.base, identity.agent_id, wallet, key);
    assert.equal(failedBind.status, 404);
    assert.equal(failedBind.text, '{"error":"not_found"}');
    assert.equal(failedBind.text.includes('bound'), false);
    fs.chmodSync(gateway.agents, 0o700);
    locked = false;
    const opened = await openAgent(gateway.base, identity.agent_id, key);
    assert.equal(opened.opened.status, 401);
    assert.equal(opened.opened.text, '{"error":"unauthorized"}');
    assert.equal(fs.existsSync(path.join(gateway.agents, 'agent-owner-keys.json')), false);
  } finally {
    if (locked) fs.chmodSync(gateway.agents, 0o700);
    leakChunks.push(gateway.output());
    await gateway.stop();
  }
});

test('11 a corrupt store refuses to boot and is left byte-identical', async (t) => {
  const marker = 'CORRUPT-MARKER-9f3a';
  const cases = [
    ['book-webhooks.json', `{"${marker}":`, 'book-webhook: load failed'],
    ['book-webhooks.json', `{"${marker}":true}`, 'book-webhook: load failed'],
    ['book-webhooks.json', `{"version":2,"webhooks":{},"marker":"${marker}"}`, 'book-webhook: load failed'],
    ['book-webhooks.json', JSON.stringify({
      version: 1,
      webhooks: { 1: { agent_id: 1, url: `notaurl-${marker}`, secret: DUMMY_SECRET, events: ['settle'], enabled: true, createdAt: 1, updatedAt: 1, deliveries: 0, failures: 0, lastStatus: null, lastError: null } },
    }), 'book-webhook: load failed'],
    ['book-webhooks.json', JSON.stringify({
      version: 1,
      webhooks: { 1: { agent_id: 1, url: 'http://127.0.0.1:9/x', secret: DUMMY_SECRET, events: { marker }, enabled: true, createdAt: 1, updatedAt: 1, deliveries: 0, failures: 0, lastStatus: null, lastError: null } },
    }), 'book-webhook: load failed'],
    ['agent-owner-keys.json', `{"${marker}-owner":`, 'agent-owner-key: load failed'],
    ['agent-owner-keys.json', '{}', 'agent-owner-key: load failed'],
    ['agent-owner-keys.json', `{"version":9,"bindings":{},"marker":"${marker}"}`, 'agent-owner-key: load failed'],
    ['agent-owner-keys.json', JSON.stringify({
      version: 1,
      bindings: { 1: { agentId: 1, publicKey: `0x${marker}`, boundAt: 1 } },
    }), 'agent-owner-key: load failed'],
  ];
  for (const [name, contents, message] of cases) {
    const dir = dataDir();
    const agents = path.join(dir, 'agents');
    fs.mkdirSync(agents, { recursive: true });
    const file = path.join(agents, name);
    fs.writeFileSync(file, contents);
    const before = fs.statSync(file);
    const { info, output } = await bootChild(dir);
    assert.equal(info.booted, false);
    assert.equal(info.code, 'persist_failed');
    assert.equal(info.message, message);
    assert.equal(String(info.message).includes(marker), false);
    assert.equal(output.includes(marker), false);
    assert.equal(output.includes(DUMMY_SECRET), false);
    const after = fs.statSync(file);
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
    assert.equal(after.mtimeMs, before.mtimeMs);
  }

  const dir = dataDir();
  const agents = path.join(dir, 'agents');
  fs.mkdirSync(agents, { recursive: true });
  const file = path.join(agents, 'book-webhooks.json');
  const hidden = `{"version":1,"marker":"${marker}-unreadable"}`;
  fs.writeFileSync(file, hidden);
  fs.chmodSync(file, 0o000);
  let denied = false;
  try {
    fs.readFileSync(file);
  } catch (err) {
    denied = err.code === 'EACCES' || err.code === 'EPERM';
  }
  if (!denied) {
    fs.chmodSync(file, 0o644);
    t.skip('this process can still read a mode-000 file');
    return;
  }
  try {
    const before = fs.statSync(file);
    const { info, output } = await bootChild(dir);
    assert.equal(info.booted, false);
    assert.equal(info.code, 'persist_failed');
    assert.equal(info.message, 'book-webhook: load failed');
    assert.equal(output.includes(marker), false);
    fs.chmodSync(file, 0o644);
    const after = fs.statSync(file);
    assert.equal(fs.readFileSync(file, 'utf8'), hidden);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    try { fs.chmodSync(file, 0o644); } catch { /* already restored */ }
  }
});

test('12 first boot creates neither file until the first write', async () => {
  const dir = dataDir();
  const wallet = Wallet.createRandom();
  const spec = specFor(wallet, 't12');
  const gateway = await serve(dir, { plant: [spec] });
  try {
    assert.equal(fs.existsSync(path.join(gateway.agents, 'book-webhooks.json')), false);
    assert.equal(fs.existsSync(path.join(gateway.agents, 'agent-owner-keys.json')), false);
    const identity = await register(gateway.base, wallet, spec);
    const got = await getWebhook(gateway.base, identity.agent_id, identity.session);
    assert.equal(got.json.webhook, null);
    assert.equal(fs.existsSync(path.join(gateway.agents, 'book-webhooks.json')), false);
    assert.equal(fs.existsSync(path.join(gateway.agents, 'agent-owner-keys.json')), false);
    assert.equal((await putWebhook(gateway.base, identity.agent_id, identity.session, {
      url: 'http://127.0.0.1:9/first',
      secret: DUMMY_SECRET,
      events: ['settle'],
    })).status, 200);
    assert.equal(fs.existsSync(path.join(gateway.agents, 'book-webhooks.json')), true);
    assert.equal(fs.existsSync(path.join(gateway.agents, 'agent-owner-keys.json')), false);
  } finally {
    leakChunks.push(gateway.output());
    await gateway.stop();
  }
});

test('13 concurrent puts and binds are all present after a restart', async () => {
  const dir = dataDir();
  const fan = Array.from({ length: 20 }, () => Wallet.createRandom());
  const hot = Wallet.createRandom();
  const specs = [...fan.map((wallet, i) => specFor(wallet, `fan-${i}`)), specFor(hot, 'hot')];
  const sink = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => res.writeHead(200).end('ok'));
  });
  let first;
  let second;
  try {
    first = await serve(dir, { plant: specs });
    const identities = [];
    for (let i = 0; i < fan.length; i += 1) {
      identities.push(await register(first.base, fan[i], specs[i]));
    }
    const hotIdentity = await register(first.base, hot, specs[specs.length - 1]);
    assert.equal((await putWebhook(first.base, identities[0].agent_id, identities[0].session, {
      url: sink.url,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    })).status, 200);
    const eventSets = [
      ['settle'],
      ['collected'],
      ['inflow'],
      ['policy_blocked'],
      ['settle', 'inflow'],
    ];
    let seq = 0;
    const hotResults = [];
    await Promise.all([
      ...identities.slice(1).map((identity, index) => putWebhook(first.base, identity.agent_id, identity.session, {
        url: `http://127.0.0.1:9/agent-${index + 1}`,
        secret: DUMMY_SECRET,
        events: ['settle', 'collected'],
      })),
      ...eventSets.map(async (events, i) => {
        const res = await putWebhook(first.base, hotIdentity.agent_id, hotIdentity.session, {
          url: `http://127.0.0.1:9/hot-${i}`,
          secret: DUMMY_SECRET,
          events,
        });
        const at = ++seq;
        hotResults.push({ at, res });
      }),
      inflow(first.base, identities[0].agent_id, identities[0].session, `${specs[0].taskId}-burst`),
    ]);
    const start = Date.now();
    let delivered = false;
    while (Date.now() - start < 4000) {
      const row = await getWebhook(first.base, identities[0].agent_id, identities[0].session);
      if (row.json?.webhook?.deliveries >= 1) {
        delivered = true;
        break;
      }
      await delay(40);
    }
    assert.equal(delivered, true);
    const last = hotResults.sort((a, b) => a.at - b.at).at(-1);
    assert.equal(last.res.status, 200);
    const before = [];
    for (const identity of identities) {
      before.push((await getWebhook(first.base, identity.agent_id, identity.session)).text);
    }
    const hotBefore = await getWebhook(first.base, hotIdentity.agent_id, hotIdentity.session);
    assert.equal(hotBefore.json.webhook.url_path, last.res.json.webhook.url_path);
    assert.deepEqual(hotBefore.json.webhook.events, last.res.json.webhook.events);
    await first.stop();
    first = null;
    second = await serve(dir);
    for (let i = 0; i < identities.length; i += 1) {
      const after = await getWebhook(second.base, identities[i].agent_id, identities[i].session);
      assert.equal(after.text, before[i]);
    }
    const hotAfter = await getWebhook(second.base, hotIdentity.agent_id, hotIdentity.session);
    assert.equal(hotAfter.text, hotBefore.text);
    await second.stop();
    second = null;

    const bindDir = dataDir();
    const binders = Array.from({ length: 10 }, () => ({
      wallet: Wallet.createRandom(),
      key: Wallet.createRandom(),
    }));
    const bindSpecs = binders.map((row, i) => specFor(row.wallet, `bind-${i}`));
    const hotBinder = { wallet: Wallet.createRandom(), keys: Array.from({ length: 5 }, () => Wallet.createRandom()) };
    const hotSpec = specFor(hotBinder.wallet, 'bind-hot');
    first = await serve(bindDir, { plant: [...bindSpecs, hotSpec] });
    const boundIds = [];
    for (let i = 0; i < binders.length; i += 1) {
      boundIds.push(await register(first.base, binders[i].wallet, bindSpecs[i]));
    }
    const hotBound = await register(first.base, hotBinder.wallet, hotSpec);
    await Promise.all(binders.map((row, i) => bindKey(first.base, boundIds[i].agent_id, row.wallet, row.key)));
    let bindSeq = 0;
    const bindResults = [];
    await Promise.all(hotBinder.keys.map(async (key) => {
      const res = await bindKey(first.base, hotBound.agent_id, hotBinder.wallet, key);
      const at = ++bindSeq;
      bindResults.push({ at, res, key });
    }));
    const lastBind = bindResults.sort((a, b) => a.at - b.at).at(-1);
    assert.equal(lastBind.res.status, 200);
    await first.stop();
    first = null;
    second = await serve(bindDir);
    for (let i = 0; i < binders.length; i += 1) {
      const opened = await openAgent(second.base, boundIds[i].agent_id, binders[i].key);
      assert.equal(opened.opened.status, 200);
    }
    for (const row of bindResults) {
      if (row === lastBind) continue;
      const opened = await openAgent(second.base, hotBound.agent_id, row.key);
      assert.equal(opened.opened.status, 401);
    }
    const winner = await openAgent(second.base, hotBound.agent_id, lastBind.key);
    assert.equal(winner.opened.status, 200);
    const snap = JSON.parse(fs.readFileSync(path.join(bindDir, 'agents', 'agent-owner-keys.json'), 'utf8'));
    assert.equal(Object.keys(snap.bindings).length, 11);
  } finally {
    for (const gateway of [first, second]) {
      if (!gateway) continue;
      leakChunks.push(gateway.output());
      await gateway.stop();
    }
    await sink.close();
  }
});

test('14 pinned responses match the capture from main', async () => {
  const pins = JSON.parse(fs.readFileSync(new URL('./fixtures/persist-webhook-ownerkey-pins.json', import.meta.url), 'utf8'));
  const dir = dataDir();
  const agents = path.join(dir, 'agents');
  fs.mkdirSync(agents, { recursive: true });
  process.env.AGENTS_DIR = agents;
  process.env.OWNER_VIEW_DB = path.join(dir, 'pin-owner.sqlite');
  const app = await createApp();
  const registry = app.locals.__test.agentRegistry;
  function agent() {
    const row = registry.allocate({});
    const wallet = Wallet.createRandom();
    row.agentWallet = wallet.address;
    return { row, wallet };
  }
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  async function pin(name, spec) {
    const res = await httpCall(spec);
    const expected = pins[seen.length];
    assert.equal(expected.name, name);
    assert.equal(res.status, expected.status);
    assert.equal(normalizePinBody(res.text), expected.body);
    assert.deepEqual(pinHeaders(res.headers), expected.headers);
    seen.push(name);
    return res;
  }
  try {
    const a = agent();
    const b = agent();
    const c = agent();
    const owner = agent();
    const key = Wallet.createRandom();
    const sess = sessionHeader(a.row.session);
    const id = a.row.agent_id;
    await pin('webhook-get-unset', { method: 'GET', url: `${base}/v1/agents/${id}/book/webhook`, headers: sess });
    const put = await pin('webhook-put-with-secret', {
      method: 'PUT',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sess,
      body: { url: 'http://127.0.0.1:9/hook', secret: DUMMY_SECRET, events: ['settle', 'collected'] },
    });
    await pin('webhook-get-set', { method: 'GET', url: `${base}/v1/agents/${id}/book/webhook`, headers: sess });
    await pin('webhook-post', {
      method: 'POST',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sess,
      body: { url: 'http://127.0.0.1:9/hook-post', events: ['inflow'] },
    });
    await pin('webhook-delete', { method: 'DELETE', url: `${base}/v1/agents/${id}/book/webhook`, headers: sess });
    await pin('webhook-delete-again', { method: 'DELETE', url: `${base}/v1/agents/${id}/book/webhook`, headers: sess });
    await pin('webhook-put-generated-secret', {
      method: 'PUT',
      url: `${base}/v1/agents/${c.row.agent_id}/book/webhook`,
      headers: sessionHeader(c.row.session),
      body: { url: 'http://127.0.0.1:9/gen', events: ['policy_blocked', 'settle'] },
    });
    await pin('webhook-401', { method: 'GET', url: `${base}/v1/agents/${id}/book/webhook` });
    await pin('webhook-403', {
      method: 'GET',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sessionHeader(b.row.session),
    });
    await pin('webhook-400-no-url', {
      method: 'PUT',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sess,
      body: { events: ['settle'] },
    });
    await pin('webhook-400-bad-url', {
      method: 'PUT',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sess,
      body: { url: 'notaurl', events: ['settle'] },
    });
    await pin('webhook-400-unknown-event', {
      method: 'PUT',
      url: `${base}/v1/agents/${id}/book/webhook`,
      headers: sess,
      body: { url: 'http://127.0.0.1:9/hook', events: ['nope'] },
    });
    const message = agentBindMessage(owner.row.agent_id, key.address);
    await pin('owner-key-200', {
      method: 'POST',
      url: `${base}/v1/agents/${owner.row.agent_id}/owner-key`,
      body: {
        public_key: key.address,
        wallet_signature: await owner.wallet.signMessage(message),
        key_signature: await key.signMessage(message),
      },
    });
    await pin('owner-key-404', {
      method: 'POST',
      url: `${base}/v1/agents/${owner.row.agent_id}/owner-key`,
      body: { public_key: key.address, wallet_signature: '0xdead', key_signature: '0xbeef' },
    });
    await pin('owner-key-404-unknown-agent', {
      method: 'POST',
      url: `${base}/v1/agents/999999/owner-key`,
      body: { public_key: key.address, wallet_signature: '0xdead', key_signature: '0xbeef' },
    });
    assert.equal(seen.length, pins.length);
    assert.equal(put.status, 200);
    assert.equal((await putWebhook(base, b.row.agent_id, b.row.session, {
      url: 'http://127.0.0.1:9/order',
      secret: DUMMY_SECRET,
      events: ['settle', 'collected'],
    })).status, 200);

    resetBookWebhookRegistry();
    const app2 = await createApp();
    const server2 = await new Promise((resolve) => {
      const listening = app2.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const again = await getWebhook(`http://127.0.0.1:${server2.address().port}`, c.row.agent_id, c.row.session);
      assert.deepEqual(again.json.webhook.events, ['policy_blocked', 'settle']);
      assert.equal(again.json.webhook.url_path, '/gen');
      const ordered = await getWebhook(`http://127.0.0.1:${server2.address().port}`, b.row.agent_id, b.row.session);
      assert.deepEqual(ordered.json.webhook.events, ['settle', 'collected']);
      assert.equal(again.text, (await getWebhook(base, c.row.agent_id, c.row.session)).text);
    } finally {
      await closeApp(app2, server2);
    }
  } finally {
    await closeApp(app, server);
  }
});

test('15 logs and error text do not contain secrets or file bytes', () => {
  const blob = leakChunks.join('\n');
  for (const item of needles) {
    assert.equal(blob.includes(item), false, `tracked value appeared in logs (${crypto.createHash('sha256').update(item).digest('hex').slice(0, 12)})`);
  }
});

test('16 source pins the writer, the stores, and the llms text', () => {
  const atomic = readSrc('src/atomic-json-file.js');
  assert.ok(/openSync\(tmp, 'wx', 0o600\)/.test(atomic), 'helper opens the tmp wx mode 600');
  assert.ok(/fsyncSync\(fd\)/.test(atomic), 'helper fsyncs the file');
  const fsyncAt = atomic.indexOf('fsyncSync(fd)');
  const renameAt = atomic.indexOf('renameSync(tmp, target)');
  assert.ok(fsyncAt !== -1 && renameAt !== -1 && fsyncAt < renameAt, 'fsync runs before rename');
  assert.ok(/unlinkSync\(tmp\)/.test(atomic), 'helper unlinks the tmp on error');

  const webhook = readSrc('src/book-webhook.js');
  const owner = readSrc('src/agent-owner-key.js');
  assert.ok(/writeAtomicJsonFile\(/.test(webhook), 'webhook store calls the helper');
  assert.ok(/writeAtomicJsonFile\(/.test(owner), 'owner-key store calls the helper');
  for (const [src, label] of [[webhook, 'webhook'], [owner, 'owner-key']]) {
    const start = src.indexOf('  _load() {');
    const end = src.indexOf('  _save()', start);
    const load = src.slice(start, end);
    const returns = load.match(/\breturn\b/g) || [];
    assert.equal(returns.length, 1, `${label} _load has a single return`);
    assert.ok(/if \(err\.code === 'ENOENT'\) return;/.test(load), `${label} returns only on ENOENT`);
  }

  const server = readSrc('src/server.js');
  assert.ok(/new BookWebhookRegistry\(\{\n    dir: agentsDir,\n    persist: !!config\.taskStore\?\.persist,/.test(server), 'server constructs the webhook store');
  assert.ok(/new AgentOwnerKeyStore\(\{\n    dir: agentsDir,\n    persist: !!config\.taskStore\?\.persist,/.test(server), 'server constructs the owner-key store');
  assert.ok(/agentKeys: agentOwnerKeys/.test(server), 'server passes agentKeys');

  const llmsStart = server.indexOf('const LLMS_TXT = `');
  const llmsBody = server.slice(server.indexOf('`', llmsStart) + 1, server.indexOf('`;', llmsStart));
  assert.equal(
    crypto.createHash('sha256').update(llmsBody).digest('hex'),
    '849b93d4cf438207817eda145e6ed40193a2f9137e28428c7ce0718f5d5e4970',
  );
  const llmsTs = fs.readFileSync(path.join(repoRoot, 'api/llms.txt.ts'));
  assert.equal(
    crypto.createHash('sha256').update(llmsTs).digest('hex'),
    '9346da542e28956cc59ffe1f9abd5638efccbc2358a98de15c144b319ea53b4e',
  );
});
