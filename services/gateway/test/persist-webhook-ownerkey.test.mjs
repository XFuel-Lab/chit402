/**
 * Book webhooks and agent owner keys survive a restart under the agents dir.
 * State changes go through the HTTP routes. The atomic-write cases call the
 * store only to force an injected fs error mid-write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const gatewayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(gatewayRoot, '..', '..');
const childPath = path.join(gatewayRoot, 'test', 'support', 'persist-webhook-ownerkey-child.mjs');
const fixtureDir = path.join(gatewayRoot, 'test', 'fixtures', 'persist-webhook-ownerkey');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-wh-'));

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmpRoot, 'tasks');
process.env.AGENTS_DIR = path.join(tmpRoot, 'agents-default');
process.env.OWNER_VIEW_DB = path.join(tmpRoot, 'owner-default.sqlite');
process.env.RECEIPT_LOG_BOOT = '0';
process.env.SPEND_HOLD_ENABLED = 'false';
process.env.OWNER_VIEW_NOT_FOUND_BUDGET_MS = '0';
process.env.OWNER_VIEW_AUDIENCES = '127.0.0.1';
process.env.ISSUER_HISTORY_TEST_ROTATION = 'true';
process.env.ISSUER_TEST_KEY = '1';
process.env.PUBLIC_ATTESTATION_SIGN = 'false';
process.env.PUBLIC_ATTESTATION_SERVE = 'false';

const DUMMY_SECRET = 'dummy-webhook-secret-0000';
const forbidden = new Set([DUMMY_SECRET]);
const leakLog = [];

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { BookWebhookRegistry, resetBookWebhookRegistry, getBookWebhookRegistry, manageBookWebhook } = await import('../src/book-webhook.js');
const { writeAtomicJson } = await import('../src/atomic-json-file.js');
const { jcsCanonicalize } = await import('../src/receipt-shell.js');
const { agentBindMessage, NOT_FOUND_BODY } = await import('../src/owner-view.js');
const logger = (await import('../src/logger.js')).default;

for (const level of ['info', 'warn', 'error', 'fatal', 'debug']) {
  if (typeof logger[level] !== 'function') continue;
  const orig = logger[level].bind(logger);
  logger[level] = (...args) => {
    try {
      leakLog.push(args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
    } catch {
      leakLog.push('[unserializable]');
    }
    return orig(...args);
  };
}

await initAIListener();

let childSeq = 0;

function bootLayout(agentsDir) {
  const dir = agentsDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pwo-'));
  const agents = path.join(dir, 'agents');
  const tasks = path.join(dir, 'tasks');
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(tasks, { recursive: true });
  return {
    dir,
    agents,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HUB_CATALOG_OFFLINE: 'true',
      X402_ENABLED: 'false',
      TASK_STORE_PERSIST: 'true',
      TASK_STORE_DIR: tasks,
      AGENTS_DIR: agents,
      OWNER_VIEW_DB: path.join(dir, 'owner.sqlite'),
      RECEIPT_LOG_BOOT: '0',
      SPEND_HOLD_ENABLED: 'false',
      OWNER_VIEW_NOT_FOUND_BUDGET_MS: '0',
      OWNER_VIEW_AUDIENCES: '127.0.0.1',
      ISSUER_HISTORY_TEST_ROTATION: 'true',
      ISSUER_TEST_KEY: '1',
      PUBLIC_ATTESTATION_SIGN: 'false',
      PUBLIC_ATTESTATION_SERVE: 'false',
    },
  };
}

function useMemoryDir() {
  const layout = bootLayout();
  process.env.AGENTS_DIR = layout.agents;
  process.env.OWNER_VIEW_DB = path.join(layout.dir, 'owner.sqlite');
  return layout;
}

function remember(value) {
  if (value != null && value !== '') forbidden.add(String(value));
}

function httpCall(port, method, pathname, { headers = {}, body = null } = {}) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: pathname,
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
        const rawHeaders = {};
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          rawHeaders[res.rawHeaders[i]] = res.rawHeaders[i + 1];
        }
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, text, json, rawHeaders });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function spawnLogged(env) {
  const logs = { out: '', err: '' };
  const proc = spawn(process.execPath, [childPath], { env, cwd: gatewayRoot });
  proc.stdout.on('data', (chunk) => { logs.out += chunk; });
  proc.stderr.on('data', (chunk) => { logs.err += chunk; });
  return { proc, logs };
}

function keepLogs(logs) {
  leakLog.push(logs.out, logs.err);
}

async function stopProc(proc) {
  if (!proc || proc.exitCode != null || proc.signalCode) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 4000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startChild(layout, extra = {}) {
  childSeq += 1;
  const portFile = path.join(layout.dir, `port-${childSeq}`);
  const agentsFile = path.join(layout.dir, `agents-${childSeq}.json`);
  const { proc, logs } = spawnLogged({
    ...layout.env,
    PORT_FILE: portFile,
    AGENTS_FILE: agentsFile,
    ...extra,
  });
  const started = Date.now();
  while (!fs.existsSync(portFile)) {
    if (proc.exitCode != null) {
      keepLogs(logs);
      throw new Error(`child exited ${proc.exitCode} before listen`);
    }
    if (Date.now() - started > 30000) {
      keepLogs(logs);
      await stopProc(proc);
      throw new Error('child listen timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const port = Number(fs.readFileSync(portFile, 'utf8'));
  const agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
  for (const agent of agents) remember(agent.session);
  return {
    proc,
    port,
    agents,
    logs,
    async stop() {
      await stopProc(proc);
      keepLogs(logs);
    },
  };
}

async function bootOnce(layout) {
  const resultFile = path.join(layout.dir, `boot-${crypto.randomBytes(4).toString('hex')}.json`);
  const { proc, logs } = spawnLogged({
    ...layout.env,
    SCENARIO: 'boot',
    RESULT_FILE: resultFile,
  });
  const outcome = await new Promise((resolve) => proc.once('exit', resolve));
  keepLogs(logs);
  assert.notEqual(outcome, null);
  assert.equal(fs.existsSync(resultFile), true, 'boot child wrote no result');
  return { body: JSON.parse(fs.readFileSync(resultFile, 'utf8')), logs };
}

async function closeApp(server, app) {
  try { app?.locals?.ownerStore?.close?.(); } catch { /* already closed */ }
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function sessionHeaders(session) {
  remember(session);
  return { 'x-xfuel-session': session };
}

function webhookPath(agentId) {
  return `/v1/agents/${agentId}/book/webhook`;
}

async function putWebhook(port, agent, body) {
  if (body.secret) remember(body.secret);
  const res = await httpCall(port, 'PUT', webhookPath(agent.agent_id), {
    headers: sessionHeaders(agent.session),
    body,
  });
  if (res.json?.secret_once) remember(res.json.secret_once);
  return res;
}

async function getWebhook(port, agent) {
  return httpCall(port, 'GET', webhookPath(agent.agent_id), {
    headers: sessionHeaders(agent.session),
  });
}

function signed(raw) {
  return `sha256=${crypto.createHmac('sha256', DUMMY_SECRET).update(raw).digest('hex')}`;
}

async function pollUntil(fn, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

function normalizeBody(text) {
  if (!text) return text;
  const parsed = JSON.parse(text);
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === 'createdAt' || key === 'updatedAt' || key === 'boundAt') out[key] = 0;
        else if (key === 'secret_once') {
          assert.equal(/^[0-9a-f]{64}$/.test(item), true, 'secret_once must be 64 hex');
          remember(item);
          out[key] = 'SECRET_ONCE';
        } else out[key] = walk(item);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(walk(parsed));
}

function pinHeaders(rawHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (/^(date|etag)$/i.test(key)) continue;
    headers[key] = value;
  }
  return headers;
}

function failingFs(step) {
  return {
    openSync(file, flag, mode) {
      return fs.openSync(file, flag, mode);
    },
    writeSync(fd, data) {
      if (step === 'write') {
        fs.writeSync(fd, String(data).slice(0, 1));
        throw new Error('write exploded');
      }
      return fs.writeSync(fd, data);
    },
    fsyncSync(fd) {
      if (step === 'fsync') throw new Error('fsync exploded');
      return fs.fsyncSync(fd);
    },
    closeSync(fd) {
      return fs.closeSync(fd);
    },
    renameSync(from, to) {
      if (step === 'rename') throw new Error('rename exploded');
      return fs.renameSync(from, to);
    },
    unlinkSync(file) {
      return fs.unlinkSync(file);
    },
  };
}

function assertNoTmp(dir) {
  const names = fs.readdirSync(dir);
  assert.equal(names.some((name) => name.includes('.tmp')), false, 'temp file left behind');
}

function dirStillWritable(dir) {
  const probe = path.join(dir, `.probe-${process.pid}`);
  try {
    const fd = fs.openSync(probe, 'wx', 0o600);
    fs.closeSync(fd);
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

async function openAgentSession(port, agentId, key) {
  const issued = await httpCall(port, 'POST', '/v1/receipts/owner/challenge', {
    body: { scope: { agent_id: agentId } },
  });
  if (issued.status !== 200) return { issued, opened: null, book: null };
  const signature = await key.signMessage(jcsCanonicalize(issued.json.challenge));
  remember(signature);
  const opened = await httpCall(port, 'POST', '/v1/receipts/owner/session', {
    body: {
      challenge: issued.json.challenge,
      signature,
      signer: key.address,
      kind: 'agent',
    },
  });
  if (opened.json?.token) remember(opened.json.token);
  return { issued, opened, signature };
}

async function bindKey(port, agentId, wallet, key) {
  const message = agentBindMessage(agentId, key.address);
  const walletSignature = await wallet.signMessage(message);
  const keySignature = await key.signMessage(message);
  remember(walletSignature);
  remember(keySignature);
  return httpCall(port, 'POST', `/v1/agents/${agentId}/owner-key`, {
    body: {
      public_key: key.address,
      wallet_signature: walletSignature,
      key_signature: keySignature,
    },
  });
}

test('webhook restart in a fresh process returns the same GET and a valid signature', async () => {
  const hits = [];
  const hookServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({ sig: req.headers['x-chit-signature'], raw: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
  const hookUrl = `http://127.0.0.1:${hookServer.address().port}/treasury`;
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '1' });
  try {
    const agent = first.agents[0];
    const put = await putWebhook(first.port, agent, {
      url: hookUrl,
      secret: DUMMY_SECRET,
      events: ['settle', 'inflow'],
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.secret_once, undefined);
    const before = await getWebhook(first.port, agent);
    assert.equal(before.status, 200);
    assert.deepEqual(before.json.webhook.events, ['settle', 'inflow']);
    await first.stop();

    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      const after = await getWebhook(second.port, agent);
      assert.equal(after.status, 200);
      assert.equal(after.text, before.text);
      const inflow = await httpCall(second.port, 'POST', `/v1/agents/${agent.agent_id}/book/inflow`, {
        headers: sessionHeaders(agent.session),
        body: { bucket: 'patron', allocation: '15000', task_id: `inflow-restart-${agent.agent_id}` },
      });
      assert.equal(inflow.status, 201, inflow.text);
      const hit = await pollUntil(() => hits.length > 0);
      assert.ok(hit, 'restarted process did not deliver');
      assert.ok(hits[0].sig === signed(hits[0].raw), 'signature mismatch');
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
    hookServer.close();
  }
});

test('a second createApp in-process loads the webhook from disk', async () => {
  const layout = useMemoryDir();
  const app1 = await createApp();
  const server1 = await new Promise((resolve) => {
    const server = http.createServer(app1);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const row = app1.locals.__test.agentRegistry.allocate({ taskId: 'same-proc' });
  remember(row.session);
  const agent = { agent_id: row.agent_id, session: row.session };
  try {
    const put = await putWebhook(server1.address().port, agent, {
      url: 'https://treasury.example/hooks/same',
      secret: DUMMY_SECRET,
      events: ['collected', 'settle'],
    });
    assert.equal(put.status, 200);
    const before = await getWebhook(server1.address().port, agent);
    await closeApp(server1, app1);
    resetBookWebhookRegistry(new BookWebhookRegistry());
    const app2 = await createApp();
    const server2 = await new Promise((resolve) => {
      const server = http.createServer(app2);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    try {
      const loaded = getBookWebhookRegistry();
      assert.equal(loaded.get(agent.agent_id)?.url, 'https://treasury.example/hooks/same');
      const after = await getWebhook(server2.address().port, agent);
      assert.equal(after.text, before.text);
    } finally {
      await closeApp(server2, app2);
    }
  } finally {
    if (server1.listening) await closeApp(server1, app1);
  }
});

test('delivery counters survive a restart', async () => {
  let fail = false;
  const hookServer = http.createServer((_req, res) => {
    res.writeHead(fail ? 500 : 200).end(fail ? 'no' : 'ok');
  });
  await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
  const hookUrl = `http://127.0.0.1:${hookServer.address().port}/hook`;
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '1' });
  try {
    const agent = first.agents[0];
    const put = await putWebhook(first.port, agent, {
      url: hookUrl,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    });
    assert.equal(put.status, 200);
    const ok = await httpCall(first.port, 'POST', `/v1/agents/${agent.agent_id}/book/inflow`, {
      headers: sessionHeaders(agent.session),
      body: { bucket: 'patron', allocation: '1000', task_id: `count-ok-${agent.agent_id}` },
    });
    assert.equal(ok.status, 201, ok.text);
    const afterOk = await pollUntil(async () => {
      const got = await getWebhook(first.port, agent);
      return got.json?.webhook?.deliveries === 1 ? got : null;
    });
    assert.ok(afterOk, 'successful delivery was not counted');
    fail = true;
    const bad = await httpCall(first.port, 'POST', `/v1/agents/${agent.agent_id}/book/inflow`, {
      headers: sessionHeaders(agent.session),
      body: { bucket: 'patron', allocation: '1000', task_id: `count-bad-${agent.agent_id}` },
    });
    assert.equal(bad.status, 201, bad.text);
    const afterBad = await pollUntil(async () => {
      const got = await getWebhook(first.port, agent);
      return got.json?.webhook?.failures === 1 ? got : null;
    }, 5000);
    assert.ok(afterBad, 'failed delivery was not counted');
    assert.equal(afterBad.json.webhook.deliveries, 1);
    assert.equal(afterBad.json.webhook.lastStatus, null);
    assert.equal(afterBad.json.webhook.lastError, 'HTTP 500');
    const before = afterBad.text;
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      const after = await getWebhook(second.port, agent);
      assert.equal(after.text, before);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
    hookServer.close();
  }
});

test('an owner key survives a fresh process and an unbound key is refused', async () => {
  const wallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '1', WALLET_ADDRESSES: wallet.address });
  try {
    const agent = first.agents[0];
    const bound = await bindKey(first.port, agent.agent_id, wallet, key);
    assert.equal(bound.status, 200, bound.text);
    assert.equal(bound.text, JSON.stringify({ bound: true, agent_id: agent.agent_id }));
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      const opened = await openAgentSession(second.port, agent.agent_id, key);
      assert.equal(opened.opened.status, 200, opened.opened.text);
      const book = await httpCall(second.port, 'GET', `/v1/agents/${agent.agent_id}/book/owner`, {
        headers: { authorization: `Bearer ${opened.opened.json.token}` },
      });
      assert.equal(book.status, 200, book.text);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }

  const control = bootLayout();
  const bare = await startChild(control, { SEED_COUNT: '1', WALLET_ADDRESSES: Wallet.createRandom().address });
  try {
    const stranger = Wallet.createRandom();
    const refused = await openAgentSession(bare.port, bare.agents[0].agent_id, stranger);
    assert.equal(refused.opened.status, 401);
    assert.equal(refused.opened.text, '{"error":"unauthorized"}');
  } finally {
    await bare.stop();
  }
});

test('deleting a webhook survives a restart', async () => {
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '2' });
  try {
    const agent = first.agents[0];
    const never = first.agents[1];
    const unset = await getWebhook(first.port, agent);
    const put = await putWebhook(first.port, agent, {
      url: 'https://treasury.example/hooks/gone',
      secret: DUMMY_SECRET,
      events: ['settle'],
    });
    assert.equal(put.status, 200);
    const removed = await httpCall(first.port, 'DELETE', webhookPath(agent.agent_id), {
      headers: sessionHeaders(agent.session),
    });
    assert.equal(removed.status, 200);
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      const after = await getWebhook(second.port, agent);
      const other = await getWebhook(second.port, never);
      assert.equal(after.text, unset.text);
      assert.equal(after.json.webhook, null);
      assert.deepEqual(after.json.supported_events, other.json.supported_events);
      assert.equal(other.json.webhook, null);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }
});

test('rebinding an owner key leaves only the second key after restart', async () => {
  const wallet = Wallet.createRandom();
  const key1 = Wallet.createRandom();
  const key2 = Wallet.createRandom();
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '1', WALLET_ADDRESSES: wallet.address });
  try {
    const agent = first.agents[0];
    assert.equal((await bindKey(first.port, agent.agent_id, wallet, key1)).status, 200);
    assert.equal((await bindKey(first.port, agent.agent_id, wallet, key2)).status, 200);
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      const old = await openAgentSession(second.port, agent.agent_id, key1);
      assert.equal(old.opened.status, 401);
      assert.equal(old.opened.text, '{"error":"unauthorized"}');
      const next = await openAgentSession(second.port, agent.agent_id, key2);
      assert.equal(next.opened.status, 200, next.opened.text);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }
});

test('a late delivery does not resurrect a deleted webhook', async () => {
  let received = 0;
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const hookServer = http.createServer((req, res) => {
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ received }));
      return;
    }
    req.on('data', () => {});
    req.on('end', () => {
      received += 1;
      held.then(() => res.writeHead(200).end('ok'));
    });
  });
  await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
  const port = hookServer.address().port;
  const layout = useMemoryDir();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = http.createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const row = app.locals.__test.agentRegistry.allocate({ taskId: 'late-delete' });
  const agent = { agent_id: row.agent_id, session: row.session };
  remember(row.session);
  try {
    assert.equal((await putWebhook(server.address().port, agent, {
      url: `http://127.0.0.1:${port}/hook`,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    })).status, 200);
    const inflow = await httpCall(server.address().port, 'POST', `/v1/agents/${agent.agent_id}/book/inflow`, {
      headers: sessionHeaders(agent.session),
      body: { bucket: 'patron', allocation: '1000', task_id: `late-del-${agent.agent_id}` },
    });
    assert.equal(inflow.status, 201, inflow.text);
    const saw = await pollUntil(async () => {
      const status = await httpCall(port, 'GET', '/status');
      return status.json?.received >= 1 ? status : null;
    });
    assert.ok(saw, 'slow listener never received the delivery');
    const removed = await httpCall(server.address().port, 'DELETE', webhookPath(agent.agent_id), {
      headers: sessionHeaders(agent.session),
    });
    assert.equal(removed.status, 200);
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await closeApp(server, app);
    const app2 = await createApp();
    const server2 = await new Promise((resolve) => {
      const listening = http.createServer(app2);
      listening.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const after = await getWebhook(server2.address().port, agent);
      assert.equal(after.json.webhook, null);
    } finally {
      await closeApp(server2, app2);
    }
  } finally {
    release();
    if (server.listening) await closeApp(server, app);
    hookServer.close();
  }
});

test('a late delivery does not change the replacement webhook counters', async () => {
  let received = 0;
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  const slow = http.createServer((req, res) => {
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ received }));
      return;
    }
    req.on('data', () => {});
    req.on('end', () => {
      received += 1;
      held.then(() => res.writeHead(200).end('ok'));
    });
  });
  const fast = http.createServer((_req, res) => res.writeHead(200).end('ok'));
  await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => fast.listen(0, '127.0.0.1', resolve));
  const layout = useMemoryDir();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = http.createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const row = app.locals.__test.agentRegistry.allocate({ taskId: 'late-replace' });
  const agent = { agent_id: row.agent_id, session: row.session };
  remember(row.session);
  try {
    assert.equal((await putWebhook(server.address().port, agent, {
      url: `http://127.0.0.1:${slow.address().port}/hook`,
      secret: DUMMY_SECRET,
      events: ['inflow'],
    })).status, 200);
    const inflow = await httpCall(server.address().port, 'POST', `/v1/agents/${agent.agent_id}/book/inflow`, {
      headers: sessionHeaders(agent.session),
      body: { bucket: 'patron', allocation: '1000', task_id: `late-rep-${agent.agent_id}` },
    });
    assert.equal(inflow.status, 201, inflow.text);
    const saw = await pollUntil(async () => {
      const status = await httpCall(slow.address().port, 'GET', '/status');
      return status.json?.received >= 1 ? status : null;
    });
    assert.ok(saw, 'slow listener never received the delivery');
    const replaced = await putWebhook(server.address().port, agent, {
      url: `http://127.0.0.1:${fast.address().port}/hook`,
      secret: DUMMY_SECRET,
      events: ['settle'],
    });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.json.webhook.deliveries, 0);
    assert.equal(replaced.json.webhook.failures, 0);
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const live = await getWebhook(server.address().port, agent);
    assert.deepEqual(live.json.webhook.events, ['settle']);
    assert.equal(live.json.webhook.deliveries, 0);
    assert.equal(live.json.webhook.failures, 0);
    await closeApp(server, app);
    const app2 = await createApp();
    const server2 = await new Promise((resolve) => {
      const listening = http.createServer(app2);
      listening.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const after = await getWebhook(server2.address().port, agent);
      assert.equal(after.text, live.text);
    } finally {
      await closeApp(server2, app2);
    }
  } finally {
    release();
    if (server.listening) await closeApp(server, app);
    slow.close();
    fast.close();
  }
});

test('both files are mode 600 under umask 022 and 000', async () => {
  for (const umask of [0o022, 0o000]) {
    const wallet = Wallet.createRandom();
    const key = Wallet.createRandom();
    const layout = bootLayout();
    const child = await startChild(layout, {
      SEED_COUNT: '1',
      WALLET_ADDRESSES: wallet.address,
      TEST_UMASK: String(umask),
    });
    try {
      const agent = child.agents[0];
      assert.equal((await putWebhook(child.port, agent, {
        url: 'https://treasury.example/hooks/mode',
        secret: DUMMY_SECRET,
        events: ['settle'],
      })).status, 200);
      assert.equal((await bindKey(child.port, agent.agent_id, wallet, key)).status, 200);
      for (const name of ['book-webhooks.json', 'agent-owner-keys.json']) {
        const file = path.join(layout.agents, name);
        assert.equal(fs.existsSync(file), true, name);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${name} mode under umask ${umask.toString(8)}`);
      }
    } finally {
      await child.stop();
    }
  }
});

test('a mid-write fs error leaves the file, drops the temp, and rolls memory back', async () => {
  for (const step of ['write', 'fsync', 'rename']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwo-atomic-'));
    const store = new BookWebhookRegistry({ dir, persist: true });
    store.upsert(1, {
      url: 'https://treasury.example/hooks/a',
      secret: DUMMY_SECRET,
      events: ['settle'],
    });
    const file = path.join(dir, 'book-webhooks.json');
    const before = fs.readFileSync(file);
    const failing = new BookWebhookRegistry({ dir, persist: true, fs: failingFs(step) });
    assert.throws(() => failing.upsert(1, {
      url: 'https://treasury.example/hooks/b',
      secret: DUMMY_SECRET,
      events: ['collected'],
    }), (err) => err.code === 'persist_failed');
    assert.equal(fs.readFileSync(file).equals(before), true);
    assertNoTmp(dir);
    assert.equal(failing.getPublic(1).url_path, '/hooks/a');
    const reloaded = new BookWebhookRegistry({ dir, persist: true });
    assert.equal(reloaded.getPublic(1).url_path, '/hooks/a');
  }
});

test('manageBookWebhook rethrows persist_failed instead of answering 400', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwo-rethrow-'));
  const verify = () => ({ checked: true, valid: true });
  const session = 'dummy-session-0000';
  remember(session);
  const claim = { session };
  const seeded = new BookWebhookRegistry({ dir, persist: true });
  const first = manageBookWebhook(1, 'PUT', claim, {
    url: 'https://treasury.example/hooks/a',
    secret: DUMMY_SECRET,
    events: ['settle'],
  }, { verify, registry: seeded });
  assert.equal(first.status, 200);
  const failing = new BookWebhookRegistry({ dir, persist: true, fs: failingFs('rename') });
  assert.throws(() => manageBookWebhook(1, 'PUT', claim, {
    url: 'https://treasury.example/hooks/b',
    secret: DUMMY_SECRET,
    events: ['inflow'],
  }, { verify, registry: failing }), (err) => err && err.code === 'persist_failed');
  assert.equal(failing.getPublic(1).url_path, '/hooks/a');
});

test('webhook persist failure is 500 and keeps the previous hook', async (t) => {
  const layout = useMemoryDir();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = http.createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const row = app.locals.__test.agentRegistry.allocate({ taskId: 'chmod-wh' });
  const agent = { agent_id: row.agent_id, session: row.session };
  remember(row.session);
  try {
    const put = await putWebhook(server.address().port, agent, {
      url: 'https://treasury.example/hooks/keep',
      secret: DUMMY_SECRET,
      events: ['settle', 'collected'],
    });
    assert.equal(put.status, 200);
    const before = await getWebhook(server.address().port, agent);
    fs.chmodSync(layout.agents, 0o500);
    if (dirStillWritable(layout.agents)) {
      fs.chmodSync(layout.agents, 0o700);
      t.skip('this process can still write a mode-500 directory');
      return;
    }
    const failed = await putWebhook(server.address().port, agent, {
      url: 'https://treasury.example/hooks/new',
      secret: DUMMY_SECRET,
      events: ['inflow'],
    });
    assert.equal(failed.status, 500);
    assert.equal(failed.text, '{"error":"internal","code":"book_webhook_failed"}');
    const still = await getWebhook(server.address().port, agent);
    assert.equal(still.text, before.text);
    const deleted = await httpCall(server.address().port, 'DELETE', webhookPath(agent.agent_id), {
      headers: sessionHeaders(agent.session),
    });
    assert.equal(deleted.status, 500);
    assert.equal(deleted.text, '{"error":"internal","code":"book_webhook_failed"}');
    const kept = await getWebhook(server.address().port, agent);
    assert.equal(kept.text, before.text);
  } finally {
    try { fs.chmodSync(layout.agents, 0o700); } catch { /* restore best effort */ }
    await closeApp(server, app);
  }
});

test('owner-key persist failure is the generic 404 and does not bind', async (t) => {
  const layout = useMemoryDir();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = http.createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const wallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  const row = app.locals.__test.agentRegistry.allocate({ taskId: 'chmod-key' });
  app.locals.__test.agentRegistry.bindWallet(row.agent_id, { agentWallet: wallet.address });
  try {
    fs.chmodSync(layout.agents, 0o500);
    if (dirStillWritable(layout.agents)) {
      fs.chmodSync(layout.agents, 0o700);
      t.skip('this process can still write a mode-500 directory');
      return;
    }
    const bound = await bindKey(server.address().port, row.agent_id, wallet, key);
    assert.equal(bound.status, 404);
    assert.equal(bound.text, NOT_FOUND_BODY);
    assert.equal(bound.text.includes('bound'), false);
    fs.chmodSync(layout.agents, 0o700);
    const opened = await openAgentSession(server.address().port, row.agent_id, key);
    assert.equal(opened.opened.status, 401);
    assert.equal(opened.opened.text, '{"error":"unauthorized"}');
  } finally {
    try { fs.chmodSync(layout.agents, 0o700); } catch { /* restore best effort */ }
    await closeApp(server, app);
  }
});

test('a corrupt webhook or owner-key file refuses to start and is left untouched', async (t) => {
  const marker = 'MARKER-persist-file-0000';
  remember(marker);
  const webhookRow = {
    version: 1,
    webhooks: {
      1: {
        agent_id: 1,
        url: 'https://treasury.example/hooks/ok',
        secret: marker,
        events: ['settle'],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        deliveries: 0,
        failures: 0,
        lastStatus: null,
        lastError: null,
      },
    },
  };
  const ownerRow = {
    version: 1,
    bindings: {
      1: { agentId: 1, publicKey: `0x${'ab'.repeat(20)}`, boundAt: 1 },
    },
  };
  const cases = [
    ['book-webhooks.json', `${marker}{`],
    ['book-webhooks.json', '{}'],
    ['book-webhooks.json', '{"version":2,"webhooks":{}}'],
    ['book-webhooks.json', JSON.stringify({
      version: 1,
      webhooks: { 1: { ...webhookRow.webhooks[1], url: 'notaurl' } },
    })],
    ['book-webhooks.json', JSON.stringify({
      version: 1,
      webhooks: { 1: { ...webhookRow.webhooks[1], events: 'settle' } },
    })],
    ['agent-owner-keys.json', `${marker}{`],
    ['agent-owner-keys.json', '{}'],
    ['agent-owner-keys.json', '{"version":2,"bindings":{}}'],
    ['agent-owner-keys.json', JSON.stringify({
      version: 1,
      bindings: { 1: { agentId: 1, publicKey: 'not-an-address', boundAt: 1 } },
    })],
  ];
  for (const [name, contents] of cases) {
    const layout = bootLayout();
    const file = path.join(layout.agents, name);
    fs.writeFileSync(file, contents);
    const before = fs.statSync(file).mtimeMs;
    const result = await bootOnce(layout);
    assert.equal(result.body.booted, false, name);
    assert.equal(result.body.code, 'persist_failed', name);
    assert.equal(result.body.message.includes(marker), false, name);
    assert.equal(fs.readFileSync(file, 'utf8'), contents, name);
    assert.equal(fs.statSync(file).mtimeMs, before, name);
    const blob = `${result.logs.out}\n${result.logs.err}\n${result.body.message}`;
    assert.equal(blob.includes(marker), false, name);
  }

  const layout = bootLayout();
  const file = path.join(layout.agents, 'book-webhooks.json');
  const contents = JSON.stringify(webhookRow);
  fs.writeFileSync(file, contents);
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
    const before = fs.statSync(file).mtimeMs;
    const result = await bootOnce(layout);
    assert.equal(result.body.booted, false);
    assert.equal(result.body.code, 'persist_failed');
    assert.equal(result.body.message.includes(marker), false);
    assert.equal(fs.statSync(file).mtimeMs, before);
  } finally {
    fs.chmodSync(file, 0o644);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
});

test('first boot creates neither file until the first write', async () => {
  const layout = bootLayout();
  const child = await startChild(layout, { SEED_COUNT: '1' });
  try {
    const got = await getWebhook(child.port, child.agents[0]);
    assert.equal(got.status, 200);
    assert.equal(got.json.webhook, null);
    assert.equal(fs.existsSync(path.join(layout.agents, 'book-webhooks.json')), false);
    assert.equal(fs.existsSync(path.join(layout.agents, 'agent-owner-keys.json')), false);
  } finally {
    await child.stop();
  }
});

test('concurrent webhook puts and owner-key binds do not drop rows', async () => {
  const hookServer = http.createServer((_req, res) => {
    res.writeHead(200).end('ok');
  });
  await new Promise((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
  const hookUrl = `http://127.0.0.1:${hookServer.address().port}/fan`;
  const layout = bootLayout();
  const first = await startChild(layout, { SEED_COUNT: '20' });
  try {
    const agents = first.agents;
    const variants = [
      ['settle'],
      ['inflow'],
      ['collected', 'settle'],
      ['policy_blocked'],
      ['settle', 'inflow', 'collected'],
    ];
    let lastAck = null;
    const writes = [
      putWebhook(first.port, agents[1], {
        url: hookUrl,
        secret: DUMMY_SECRET,
        events: ['inflow'],
      }),
    ];
    for (let i = 2; i < agents.length; i++) {
      writes.push(putWebhook(first.port, agents[i], {
        url: `https://treasury.example/hooks/${i}`,
        secret: DUMMY_SECRET,
        events: ['settle', 'inflow'],
      }));
    }
    for (const events of variants) {
      writes.push(putWebhook(first.port, agents[0], {
        url: 'https://treasury.example/hooks/shared',
        secret: DUMMY_SECRET,
        events,
      }).then((res) => {
        lastAck = { status: res.status, events };
        return res;
      }));
    }
    writes.push(httpCall(first.port, 'POST', `/v1/agents/${agents[1].agent_id}/book/inflow`, {
      headers: sessionHeaders(agents[1].session),
      body: { bucket: 'patron', allocation: '1000', task_id: `fan-${agents[1].agent_id}` },
    }));
    const results = await Promise.all(writes);
    for (const res of results) {
      assert.equal(res.status === 200 || res.status === 201, true, res.text);
    }
    assert.equal(lastAck.status, 200);
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      for (let i = 0; i < agents.length; i++) {
        const got = await getWebhook(second.port, agents[i]);
        assert.equal(got.status, 200);
        assert.ok(got.json.webhook, `agent ${agents[i].agent_id} missing`);
      }
      const shared = await getWebhook(second.port, agents[0]);
      assert.deepEqual(shared.json.webhook.events, lastAck.events);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
    hookServer.close();
  }
});

test('ten concurrent owner-key binds all survive a restart', async () => {
  const wallets = Array.from({ length: 10 }, () => ({
    wallet: Wallet.createRandom(),
    key: Wallet.createRandom(),
  }));
  const layout = bootLayout();
  const first = await startChild(layout, {
    SEED_COUNT: '10',
    WALLET_ADDRESSES: wallets.map((item) => item.wallet.address).join(','),
  });
  try {
    const bound = await Promise.all(wallets.map((item, index) => (
      bindKey(first.port, first.agents[index].agent_id, item.wallet, item.key)
    )));
    assert.deepEqual(bound.map((res) => res.status), Array(10).fill(200));
    await first.stop();
    const second = await startChild(layout, { SEED_COUNT: '0' });
    try {
      for (let i = 0; i < wallets.length; i++) {
        const opened = await openAgentSession(second.port, first.agents[i].agent_id, wallets[i].key);
        assert.equal(opened.opened.status, 200, opened.opened.text);
      }
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }
});

test('webhook and owner-key responses match the pins captured on main', async () => {
  const layout = useMemoryDir();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = http.createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const registry = app.locals.__test.agentRegistry;
  const a = registry.allocate({ taskId: 'pin-a' });
  const b = registry.allocate({ taskId: 'pin-b' });
  const wallet = Wallet.createRandom();
  const key = Wallet.createRandom();
  registry.bindWallet(a.agent_id, { agentWallet: wallet.address });
  remember(a.session);
  remember(b.session);
  const port = server.address().port;
  const sess = { 'x-xfuel-session': a.session };
  const base = webhookPath(a.agent_id);
  try {
    const cases = [];
    const snap = async (name, method, pathname, opts) => {
      const res = await httpCall(port, method, pathname, opts);
      cases.push({ name, ...res });
    };
    await snap('get-unset', 'GET', base, { headers: sess });
    await snap('put-with-secret', 'PUT', base, {
      headers: sess,
      body: { url: 'https://treasury.example/hooks/chit', secret: DUMMY_SECRET, events: ['settle', 'collected'] },
    });
    await snap('post-with-secret', 'POST', base, {
      headers: sess,
      body: { url: 'https://treasury.example/hooks/chit', secret: DUMMY_SECRET, events: ['collected', 'settle'] },
    });
    await snap('get-set', 'GET', base, { headers: sess });
    await snap('delete', 'DELETE', base, { headers: sess });
    await snap('delete-again', 'DELETE', base, { headers: sess });
    await snap('get-401', 'GET', base, {});
    await snap('get-403', 'GET', base, { headers: { 'x-xfuel-session': b.session } });
    await snap('put-400-no-url', 'PUT', base, { headers: sess, body: { events: ['settle'] } });
    await snap('put-400-bad-url', 'PUT', base, { headers: sess, body: { url: 'notaurl', events: ['settle'] } });
    await snap('put-400-unknown-event', 'PUT', base, {
      headers: sess,
      body: { url: 'https://treasury.example/hooks/chit', events: ['nope'] },
    });
    await snap('put-generated-secret', 'PUT', base, {
      headers: sess,
      body: { url: 'https://treasury.example/hooks/chit', events: ['inflow'] },
    });
    const message = agentBindMessage(a.agent_id, key.address);
    const walletSignature = await wallet.signMessage(message);
    const keySignature = await key.signMessage(message);
    remember(walletSignature);
    remember(keySignature);
    cases.push({
      name: 'owner-bind-200',
      ...await httpCall(port, 'POST', `/v1/agents/${a.agent_id}/owner-key`, {
        body: { public_key: key.address, wallet_signature: walletSignature, key_signature: keySignature },
      }),
    });
    cases.push({
      name: 'owner-bind-404',
      ...await httpCall(port, 'POST', `/v1/agents/${a.agent_id}/owner-key`, {
        body: { public_key: key.address, wallet_signature: '0x11', key_signature: '0x22' },
      }),
    });
    cases.push({
      name: 'owner-bind-404-missing',
      ...await httpCall(port, 'POST', '/v1/agents/999999/owner-key', {
        body: { public_key: key.address, wallet_signature: '0x11', key_signature: '0x22' },
      }),
    });
    for (const item of cases) {
      const pinned = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${item.name}.json`), 'utf8'));
      const body = item.text ? normalizeBody(item.text) : item.text;
      assert.equal(item.status, pinned.status, item.name);
      assert.deepEqual(pinHeaders(item.rawHeaders), pinned.headers, item.name);
      assert.equal(body, pinned.body, item.name);
    }
  } finally {
    await closeApp(server, app);
  }
});

test('logs and errors from the persist paths do not contain secrets', () => {
  const haystack = leakLog.join('\n');
  for (const secret of forbidden) {
    assert.equal(haystack.includes(secret), false, 'log contained a forbidden value');
  }
});

test('source pins the atomic writer, the stores, and the llms text', () => {
  const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const helper = read(path.join(gatewayRoot, 'src', 'atomic-json-file.js'));
  const webhook = read(path.join(gatewayRoot, 'src', 'book-webhook.js'));
  const owner = read(path.join(gatewayRoot, 'src', 'agent-owner-key.js'));
  const server = read(path.join(gatewayRoot, 'src', 'server.js'));
  const llmsApi = fs.readFileSync(path.join(repoRoot, 'api', 'llms.txt.ts'));
  assert.ok(/openSync\(tmp, 'wx', 0o600\)/.test(helper), 'helper opens the temp file with wx and mode 600');
  assert.ok(/fsyncSync\(fd\)[\s\S]*renameSync\(tmp, target\)/.test(helper), 'helper fsyncs before rename');
  assert.ok(/unlinkSync\(tmp\)/.test(helper), 'helper unlinks the temp file on the error path');
  assert.ok(/writeAtomicJson\(/.test(webhook), 'webhook store calls the helper');
  assert.ok(/writeAtomicJson\(/.test(owner), 'owner-key store calls the helper');
  assert.ok(/if \(err\.code === 'ENOENT'\) return;/.test(webhook), 'webhook load treats ENOENT as first run');
  assert.ok(/if \(err\.code === 'ENOENT'\) return;/.test(owner), 'owner-key load treats ENOENT as first run');
  assert.ok(!/catch \(err\) \{\s*return;\s*\}/.test(webhook), 'webhook load does not swallow a corrupt file');
  assert.ok(!/catch \(err\) \{\s*return;\s*\}/.test(owner), 'owner-key load does not swallow a corrupt file');
  assert.ok(/new BookWebhookRegistry\(\{\n\s*dir: agentsDir,\n\s*persist: !!config\.taskStore\?\.persist,/.test(server), 'server constructs the webhook store');
  assert.ok(/new AgentOwnerKeyStore\(\{\n\s*dir: agentsDir,\n\s*persist: !!config\.taskStore\?\.persist,/.test(server), 'server constructs the owner-key store');
  assert.ok(/agentKeys: agentOwnerKeys,/.test(server), 'server passes agentKeys into createOwnerView');
  const marker = 'const LLMS_TXT = `';
  const start = server.indexOf(marker);
  const end = server.indexOf('`;\n', start);
  const llms = server.slice(start + marker.length, end);
  assert.equal(crypto.createHash('sha256').update(llms).digest('hex'), '849b93d4cf438207817eda145e6ed40193a2f9137e28428c7ce0718f5d5e4970');
  assert.equal(crypto.createHash('sha256').update(llmsApi).digest('hex'), '9346da542e28956cc59ffe1f9abd5638efccbc2358a98de15c144b319ea53b4e');
  assert.equal(typeof writeAtomicJson, 'function');
});
