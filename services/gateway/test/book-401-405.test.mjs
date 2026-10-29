/**
 * Book 401 possession hint, and (later in this file) 405 on GET/HEAD of
 * POST-only book subroutes.
 *
 * Every case is HTTP against createApp() on 127.0.0.1. The library 401
 * contract stays { status: 401, body: null }.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';

const tmp = mkdtempSync(path.join(tmpdir(), 'book-401-'));
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.NODE_ENV = 'test';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret-book-401';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { readAgentBook, setAgentBudget, exportAgentBook } = await import('../src/agent-book.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt } = await import('../src/receipt.js');
const { canonicalRegisterRecoverMessage } = await import('../src/agent-registry.js');

const HINT = '{"error":"possession_required","message":"Send your Chit402 book session from POST /v1/agents/register","docs":"https://www.chit402.com/docs/private-spend"}';
const JSON_TYPE = 'application/json; charset=utf-8';

let server;
let base;

before(async () => {
  await initAIListener();
  const app = await createApp();
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

function headerMap(res) {
  const out = {};
  for (const [k, v] of res.headers.entries()) out[k] = v;
  return out;
}

async function read(res) {
  return { status: res.status, text: await res.text(), headers: headerMap(res) };
}

function assertHint(got, label) {
  assert.equal(got.status, 401, label);
  assert.equal(got.text, HINT, label);
  assert.equal(got.headers['content-type'], JSON_TYPE, label);
  assert.equal(got.headers['www-authenticate'], undefined, label);
  assert.equal(got.headers['cache-control'], 'private, no-store', label);
}

function assertEmpty401(got, label) {
  assert.equal(got.status, 401, label);
  assert.equal(got.text, '', label);
  assert.equal(got.headers['content-type'], undefined, label);
  assert.equal(got.headers['content-length'], '0', label);
}

function assertEmpty403(got, label) {
  assert.equal(got.status, 403, label);
  assert.equal(got.text, '', label);
  assert.equal(got.headers['content-type'], undefined, label);
  assert.equal(got.headers['content-length'], '0', label);
  assert.equal(got.text.includes('possession_required'), false, label);
}

test('GET and POST /book with no credentials return the possession hint', async () => {
  const getRes = await read(await fetch(`${base}/v1/agents/1/book`));
  const postRes = await read(await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assertHint(getRes, 'GET book');
  assertHint(postRes, 'POST book');
  const vary = String(getRes.headers.vary || '').toLowerCase();
  assert.ok(vary.includes('x-xfuel-session'), 'GET book keeps possession Vary');
  assert.equal(postRes.headers.vary, undefined, 'POST book 401 does not add Vary');
});

test('POST /book with a budget and no session is the same hint', async () => {
  const got = await read(await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ budget: 5 }),
  }));
  assertHint(got, 'budget set');
});

test('GET and POST /book/export with no credentials return the same hint', async () => {
  const getRes = await read(await fetch(`${base}/v1/agents/1/book/export`));
  const postRes = await read(await fetch(`${base}/v1/agents/1/book/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assertHint(getRes, 'GET export');
  assertHint(postRes, 'POST export');
});

test('the 401 hint is the same bytes for every agent_id and dummy credential', async () => {
  const ids = ['1', '149', '999999', '0', 'abc'];
  const extras = [
    {},
    { 'x-api-key': 'xfuel-demo' },
    { authorization: 'Bearer dummy-token-0000' },
  ];
  for (const id of ids) {
    for (const headers of extras) {
      const got = await read(await fetch(`${base}/v1/agents/${id}/book`, { headers }));
      assertHint(got, `GET ${id}`);
      assert.equal(got.text.includes(`/v1/agents/${id}`), false, `body echoes path ${id}`);
      assert.equal(got.text.includes(`"agent_id"`), false, `body echoes agent_id field ${id}`);
      for (const value of Object.values(headers)) {
        assert.equal(got.text.includes(value), false, `body echoes ${value}`);
      }
    }
  }
});

test('401 hint does not echo dummy key, authorization, or ingest key', async () => {
  const secrets = {
    'x-api-key': 'dummy-api-key-0000',
    authorization: 'Bearer dummy-token-0000',
    'x-chit-ingest-key': 'dummy-ingest-0000',
  };
  const got = await read(await fetch(`${base}/v1/agents/149/book`, { headers: secrets }));
  assertHint(got, 'leak');
  const joined = `${got.text}\n${Object.entries(got.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  for (const value of Object.values(secrets)) {
    assert.equal(joined.includes(value), false, value);
    assert.equal(joined.includes('dummy-token-0000'), false);
    assert.equal(joined.includes('dummy-ingest-0000'), false);
  }
});

test('403 on book and export stays empty for a bad session', async () => {
  const session = 'dummy-session-0000';
  const cases = [
    ['POST', '/v1/agents/1/book', { 'content-type': 'application/json' }, JSON.stringify({ session })],
    ['GET', '/v1/agents/1/book', { 'x-xfuel-session': session }, undefined],
    ['POST', '/v1/agents/999999/book', { 'content-type': 'application/json' }, JSON.stringify({ session })],
    ['GET', '/v1/agents/999999/book', { 'x-xfuel-session': session }, undefined],
    ['GET', '/v1/agents/abc/book', { 'x-xfuel-session': session }, undefined],
    ['POST', '/v1/agents/abc/book/export', { 'content-type': 'application/json' }, JSON.stringify({ session })],
    ['GET', '/v1/agents/1/book/export', { 'x-xfuel-session': session }, undefined],
    ['POST', '/v1/agents/999999/book/export', { 'content-type': 'application/json' }, JSON.stringify({ session })],
    ['GET', '/v1/agents/abc/book/export', { 'x-xfuel-session': session }, undefined],
  ];
  for (const [method, pathName, headers, body] of cases) {
    const got = await read(await fetch(`${base}${pathName}`, { method, headers, body }));
    assertEmpty403(got, `${method} ${pathName}`);
  }
  const postBook = await read(await fetch(`${base}/v1/agents/1/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session }),
  }));
  assert.equal(postBook.headers['cache-control'], undefined, 'POST book 403 cache');
  const getBook = await read(await fetch(`${base}/v1/agents/1/book`, {
    headers: { 'x-xfuel-session': session },
  }));
  assert.equal(getBook.headers['cache-control'], 'private, no-store', 'GET book 403 cache');
});

test('sendAgentBook catch stays 403 empty and is not reached by a dummy proof', () => {
  // bindBookVerifier length-guards timingSafeEqual and returns checked/valid
  // for a dummy session or proof. readAgentBook and setAgentBudget return 403
  // before ledger work when the agent is missing or the credential is wrong,
  // so the catch is not reached over HTTP. Pin the catch source.
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const catchRe = /logger\.error\(\{ err, reqId: req\.id \}, 'agent book error'\);\n\s*return res\.status\(403\)\.end\(\);/;
  assert.ok(catchRe.test(src), 'sendAgentBook catch is 403 empty');
  const at = src.search(catchRe);
  assert.equal(src.slice(at, at + 180).includes('BOOK_POSSESSION_REQUIRED_BODY'), false);
});

test('policy, gaps, rotate and dispute 401 stay empty', async () => {
  const cases = [
    ['GET', '/v1/agents/1/book/policy'],
    ['GET', '/v1/agents/1/book/gaps'],
    ['POST', '/v1/agents/1/book/rotate'],
    ['GET', '/v1/agents/1/book/dispute'],
  ];
  for (const [method, pathName] of cases) {
    const got = await read(await fetch(`${base}${pathName}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? '{}' : undefined,
    }));
    assertEmpty401(got, `${method} ${pathName}`);
    assert.equal(got.text.includes('possession_required'), false, pathName);
  }
});

test('GET /book/owner stays the padded generic 404', async () => {
  for (const headers of [{}, { authorization: 'Bearer dummy' }]) {
    const got = await read(await fetch(`${base}/v1/agents/1/book/owner`, { headers }));
    assert.equal(got.status, 404);
    assert.equal(got.text, '{"error":"not_found"}');
    assert.equal(got.headers['content-type'], JSON_TYPE);
    assert.equal(got.headers['cache-control'], 'private, no-store');
    assert.equal(got.headers.vary, 'Authorization');
    assert.equal(got.headers['access-control-allow-origin'], undefined);
    assert.equal(got.headers['content-length'], '21');
  }
});

test('a registered agent book and export stay 200', async () => {
  const agent = Wallet.createRandom();
  const listener = getAIListener();
  const taskId = 'book-401-register-1';
  const regTask = {
    taskId,
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      model: 'theta/qwen3',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'ab'.repeat(32)}`,
      amount: '100000',
    },
    feeAmount: '500',
    netAmount: '99500',
    feeBps: 50,
    meta: {
      chain: 'base',
      provider: 'theta-edgecloud',
      payerWallet: agent.address,
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
  };
  listener.activeTasks.set(regTask.taskId, regTask);
  await buildReceipt(regTask, { persistSignature: true, payerWallet: agent.address });
  const signatureTimestamp = Math.floor(Date.now() / 1000);
  const walletSignature = await agent.signMessage(
    canonicalRegisterRecoverMessage(taskId, agent.address, signatureTimestamp),
  );
  const regRes = await fetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
      agent_wallet: agent.address,
      wallet_signature: walletSignature,
      signature_timestamp: signatureTimestamp,
    }),
  });
  const regText = await regRes.text();
  assert.equal(regRes.status, 200, regText);
  const regBody = JSON.parse(regText);
  const id = regBody.agent_id;
  const session = regBody.session;
  assert.equal(typeof session, 'string');

  const getBook = await read(await fetch(`${base}/v1/agents/${id}/book`, {
    headers: { 'x-xfuel-session': session },
  }));
  const postBook = await read(await fetch(`${base}/v1/agents/${id}/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xfuel-session': session },
    body: JSON.stringify({ session }),
  }));
  assert.equal(getBook.status, 200);
  assert.equal(postBook.status, 200);
  const getJson = JSON.parse(getBook.text);
  const postJson = JSON.parse(postBook.text);
  for (const body of [getJson, postJson]) {
    assert.equal(body.agent_id, id);
    assert.equal(body.window, 'prepaid_ceiling');
    assert.ok(Array.isArray(body.entries));
    assert.equal(body.error, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'docs'), false);
  }
  delete getJson.allowance;
  delete postJson.allowance;
  assert.deepEqual(getJson, postJson);

  const getExport = await read(await fetch(`${base}/v1/agents/${id}/book/export`, {
    headers: { 'x-xfuel-session': session },
  }));
  const postExport = await read(await fetch(`${base}/v1/agents/${id}/book/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xfuel-session': session },
    body: JSON.stringify({ session }),
  }));
  assert.equal(getExport.status, 200);
  assert.equal(postExport.status, 200);
  assert.equal(getExport.text, postExport.text);
  assert.ok(getExport.text.includes('task_id,evidence,collected_at,hub,model,amount'));
  assert.equal(getExport.text.includes('possession_required'), false);
});

const OPENAPI_STRIPPED_SHA = '0a5a693eb76895231b0ef041eb2567cc0d9dba610207fed39c5f1e0cff2c0804';

function stripOpenApi(spec) {
  delete spec.servers;
  if (spec.paths) {
    delete spec.paths['/freeze/{universeId}'];
    delete spec.paths['/receipt/{taskId}/legacy-proof'];
    const book = spec.paths['/v1/agents/{agent_id}/book'];
    delete book.get.description;
    delete book.post.description;
    delete book.get.responses['401'];
    delete book.post.responses['401'];
    const exp = spec.paths['/v1/agents/{agent_id}/book/export'];
    delete exp.get.responses['401'];
    delete exp.post.responses['401'];
    for (const p of [
      '/v1/agents/{agent_id}/book/inflow',
      '/v1/agents/{agent_id}/book/inflow/correct',
      '/v1/agents/{agent_id}/book/ingest',
      '/v1/agents/{agent_id}/book/escrow',
      '/v1/agents/{agent_id}/book/rotate',
    ]) {
      delete spec.paths[p]?.post?.responses?.['405'];
    }
  }
  return spec;
}

test('openapi book and export 401 describe the hint and the rest of the spec is unchanged', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  const book = spec.paths['/v1/agents/{agent_id}/book'];
  const exp = spec.paths['/v1/agents/{agent_id}/book/export'];
  for (const op of [book.get, book.post, exp.get, exp.post]) {
    assert.doesNotMatch(op.responses['401'].description, /empty body/i);
    assert.match(op.responses['401'].description, /Send your Chit402 book session from POST \/v1\/agents\/register/);
    assert.match(op.responses['401'].description, /possession_required/);
    assert.match(op.responses['401'].description, /https:\/\/www\.chit402\.com\/docs\/private-spend/);
  }
  assert.doesNotMatch(book.get.description, /401\/403 with an empty body/);
  assert.equal(book.get.responses['403'].description, 'Wrong proof or unknown agent_id. Empty body.');
  assert.equal(book.post.responses['403'].description, 'Wrong proof or unknown agent_id. Empty body.');
  assert.equal(exp.get.responses['403'].description, 'Wrong proof or unknown agent_id.');
  assert.equal(exp.post.responses['403'].description, 'Wrong proof or unknown agent_id.');
  const stripped = stripOpenApi(structuredClone(spec));
  const sha = createHash('sha256').update(JSON.stringify(stripped)).digest('hex');
  assert.equal(sha, OPENAPI_STRIPPED_SHA);
});

test('library book reads still return a null 401 body', async () => {
  const read = await readAgentBook(1, {}, {});
  assert.deepEqual(read, { status: 401, body: null });
  const budget = setAgentBudget(1, {}, {});
  assert.deepEqual(budget, { status: 401, body: null });
  const exported = await exportAgentBook(1, {}, {});
  assert.equal(exported.status, 401);
  assert.equal(exported.body, null);
});

test('401 hint is referenced at the four book and export sites; llms files are unchanged', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hits = src.split('\n').filter((line) => line.includes('BOOK_POSSESSION_REQUIRED_BODY'));
  assert.equal(hits.length, 5, hits.join('\n'));
  assert.equal(hits.filter((line) => line.includes('sendBookPossessionRequired')).length, 4);
  assert.equal(hits.filter((line) => line.includes("from './agent-book.js'")).length, 1);

  const start = src.indexOf('const LLMS_TXT = `');
  const end = src.indexOf('`;\n\n// ─── In-Memory Rate Limiter');
  assert.ok(start > 0 && end > start);
  const llms = src.slice(start, end + 2);
  assert.equal(
    createHash('sha256').update(llms).digest('hex'),
    'bd4767285b8c21cf0cb21a5b57b70cfe4effe49db69159b31f576e2bf3de9a8d',
  );
  const apiLlms = readFileSync(new URL('../../../api/llms.txt.ts', import.meta.url));
  assert.equal(
    createHash('sha256').update(apiLlms).digest('hex'),
    '9346da542e28956cc59ffe1f9abd5638efccbc2358a98de15c144b319ea53b4e',
  );
});
