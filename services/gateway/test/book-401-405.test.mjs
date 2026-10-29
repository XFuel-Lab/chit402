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
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const tmp = mkdtempSync(path.join(tmpdir(), 'book-401-'));
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.NODE_ENV = 'test';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret-book-401';
process.env.X402_ENABLED = 'false';

if (process.env.BOOK_405_RATE_CHILD === '1') {
  process.env.M2M_RATE_MAX_HITS = '3';
  process.env.M2M_RATE_WINDOW_MS = '600000';
  const { createApp: createRateApp } = await import('../src/server.js');
  const app = await createRateApp();
  const rateServer = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const rateBase = `http://127.0.0.1:${rateServer.address().port}`;
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${rateBase}/v1/agents/149/book/rotate`);
    rows.push({
      status: res.status,
      text: await res.text(),
      limit: res.headers.get('x-ratelimit-limit'),
      remaining: res.headers.get('x-ratelimit-remaining'),
      reset: res.headers.get('x-ratelimit-reset'),
      retry: res.headers.get('retry-after'),
      allow: res.headers.get('allow'),
    });
  }
  if (typeof rateServer.closeAllConnections === 'function') rateServer.closeAllConnections();
  await new Promise((resolve) => rateServer.close(resolve));
  process.stdout.write(`\nBOOK_405_RATE_JSON ${JSON.stringify(rows)}\n`);
  process.exit(0);
}

const { createApp, BOOK_POST_ONLY_SUBROUTES } = await import('../src/server.js');
const { readAgentBook, setAgentBudget, exportAgentBook } = await import('../src/agent-book.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt } = await import('../src/receipt.js');
const { canonicalRegisterRecoverMessage } = await import('../src/agent-registry.js');

const HINT = '{"error":"possession_required","message":"Send your Chit402 book session from POST /v1/agents/register","docs":"https://www.chit402.com/docs/private-spend"}';
const JSON_TYPE = 'application/json; charset=utf-8';

let server;
let base;
let app;

before(async () => {
  await initAIListener();
  app = await createApp();
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

const NOT_ALLOWED = '{"error":"method_not_allowed"}';
const NOT_FOUND = '{"error":"not_found"}';
const POST_ONLY = ['inflow', 'inflow/correct', 'ingest', 'escrow', 'rotate'];

const OPTIONS_ALLOW_HEADERS = 'Content-Type, Authorization, X-API-Key, X-Chit-Ingest-Key, X-Chit-Strict-Model, X-PAYMENT, X-PAYMENT-NONCE, PAYMENT-SIGNATURE, PAYMENT-NONCE, X-XFuel-Session, x-xfuel-session, X-Chit-Board-Ops';
const OPTIONS_EXPOSE_HEADERS = 'X-XFuel-Signature, x-xfuel-task-id, x-xfuel-provider, x-xfuel-compute-real, x-xfuel-payment-rail, x-xfuel-proof-status, x-xfuel-proof-url, x-xfuel-verify-url, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Chit-Requested-Model, X-Chit-Served-Model, X-Chit-Model-Substituted, X-Chit-Request-Salt, X-Chit-Verifier-Min';

test('GET and HEAD on POST-only book subroutes are 405 with Allow POST', async () => {
  for (const sub of POST_ONLY) {
    const url = `${base}/v1/agents/149/book/${sub}`;
    const getRes = await read(await fetch(url));
    assert.equal(getRes.status, 405, sub);
    assert.equal(getRes.text, NOT_ALLOWED, sub);
    assert.equal(getRes.headers.allow, 'POST', sub);
    assert.equal(getRes.headers['cache-control'], 'private, no-store', sub);
    assert.equal(getRes.headers['content-type'], JSON_TYPE, sub);
    const headRes = await fetch(url, { method: 'HEAD' });
    const headBody = await headRes.text();
    assert.equal(headRes.status, 405, `HEAD ${sub}`);
    assert.equal(headBody, '', `HEAD ${sub} body`);
    assert.equal(headRes.headers.get('allow'), 'POST', `HEAD ${sub}`);
    assert.equal(headRes.headers.get('cache-control'), 'private, no-store', `HEAD ${sub}`);
    assert.equal(headRes.headers.get('content-type'), JSON_TYPE, `HEAD ${sub}`);
  }
});

test('unauthenticated POST on POST-only book subroutes stays the main response', async () => {
  const empty = ['inflow', 'inflow/correct', 'escrow', 'rotate'];
  for (const sub of empty) {
    const got = await read(await fetch(`${base}/v1/agents/149/book/${sub}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    assertEmpty401(got, `POST ${sub}`);
    assert.equal(got.headers.allow, undefined, sub);
    assert.equal(got.headers['cache-control'], undefined, sub);
  }
  const ingest = await read(await fetch(`${base}/v1/agents/149/book/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(ingest.status, 401);
  assert.equal(ingest.text, '{"error":"unauthorized","message":"Possession proof (session) is required"}');
  assert.equal(ingest.headers['content-type'], JSON_TYPE);
  assert.equal(ingest.headers['content-length'], '75');
  assert.equal(ingest.headers.etag, 'W/"4b-78YK7u58yeDurwzY70v7AyxCMvM"');
  assert.equal(ingest.headers.allow, undefined);
});

test('unknown book paths stay 404 and other wrong methods stay 404', async () => {
  const paths = [
    '/v1/agents/149/book/rotate%22',
    '/v1/agents/149/book/inflow%22',
    '/v1/agents/149/book/rotate&quot',
    '/v1/agents/149/book/inflow&quot',
    '/v1/agents/149/book/webhook/v1/models',
    '/v1/agents/149/book/rotate/extra',
    '/v1/agents/149/book/nope',
  ];
  for (const pathName of paths) {
    const got = await read(await fetch(`${base}${pathName}`));
    assert.equal(got.status, 404, pathName);
    assert.equal(got.text, NOT_FOUND, pathName);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const got = await read(await fetch(`${base}/v1/agents/149/book/rotate`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    assert.equal(got.status, 404, method);
    assert.equal(got.text, NOT_FOUND, method);
  }
});

test('existing book GET routes are not turned into 405', async () => {
  const empty = [
    '/v1/agents/1/book/dispute',
    '/v1/agents/1/book/a2a-escrow',
    '/v1/agents/1/book/policy',
    '/v1/agents/1/book/assign',
    '/v1/agents/1/book/gaps',
  ];
  for (const pathName of empty) {
    const got = await read(await fetch(`${base}${pathName}`));
    assertEmpty401(got, pathName);
  }
  const exp = await read(await fetch(`${base}/v1/agents/1/book/export`));
  assertHint(exp, 'export still the hint');
});

test('router walk: POST-only book routes match BOOK_POST_ONLY_SUBROUTES', () => {
  const routes = [];
  for (const layer of app.router.stack) {
    if (!layer.route) continue;
    routes.push({ path: layer.route.path, methods: layer.route.methods });
  }
  const has = (pathName, method) => routes.some((r) => r.path === pathName && r.methods[method]);
  for (const pattern of BOOK_POST_ONLY_SUBROUTES) {
    assert.equal(has(pattern, 'post'), true, `POST ${pattern}`);
    assert.equal(has(pattern, 'get'), false, `GET ${pattern}`);
    assert.equal(has(pattern, 'head'), false, `HEAD ${pattern}`);
  }
  const seen = new Set(routes.map((r) => r.path).filter((p) => typeof p === 'string' && p.startsWith('/v1/agents/:agent_id/book/')));
  for (const pathName of seen) {
    if (has(pathName, 'post') && !has(pathName, 'get') && !has(pathName, 'head')) {
      assert.ok(BOOK_POST_ONLY_SUBROUTES.includes(pathName), pathName);
    }
  }
});

test('GET book/rotate 405 is still rate limited', async () => {
  const file = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [file], {
    env: {
      ...process.env,
      BOOK_405_RATE_CHILD: '1',
      M2M_RATE_MAX_HITS: '3',
      M2M_RATE_WINDOW_MS: '600000',
      HUB_CATALOG_OFFLINE: 'true',
      NODE_ENV: 'test',
      ISSUER_TEST_KEY: '1',
      TASK_STORE_PERSIST: 'false',
    },
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 0, out.slice(-500));
  const line = out.split('\n').find((row) => row.startsWith('BOOK_405_RATE_JSON '));
  assert.ok(line, out.slice(-500));
  const rows = JSON.parse(line.slice('BOOK_405_RATE_JSON '.length));
  assert.equal(rows.length, 5);
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.status, 405);
    assert.equal(row.text, NOT_ALLOWED);
    assert.equal(row.allow, 'POST');
    assert.equal(row.limit, '3');
    assert.ok(row.remaining != null && row.remaining !== '');
    assert.ok(row.reset);
  }
  assert.equal(rows[3].status, 429);
  assert.equal(rows[4].status, 429);
  const limited = JSON.parse(rows[3].text);
  assert.equal(limited.error, 'rate_limit_exceeded');
  assert.equal(limited.message, 'Too many requests — slow down.');
  assert.equal(typeof limited.retryAfterMs, 'number');
  assert.ok(rows[3].retry);
});

test('OPTIONS on book/rotate and book matches the values captured on main', async () => {
  const paths = ['/v1/agents/149/book/rotate', '/v1/agents/149/book'];
  for (const pathName of paths) {
    const bare = await read(await fetch(`${base}${pathName}`, { method: 'OPTIONS' }));
    assert.equal(bare.status, 404, pathName);
    assert.equal(bare.text, NOT_FOUND, pathName);
    assert.equal(bare.headers.allow, undefined, pathName);
    assert.equal(bare.headers['access-control-allow-origin'], undefined, pathName);
    assert.equal(bare.headers['access-control-allow-methods'], undefined, pathName);
    assert.equal(bare.headers['access-control-allow-headers'], undefined, pathName);
    assert.equal(bare.headers['access-control-expose-headers'], undefined, pathName);
    assert.equal(bare.headers['content-type'], JSON_TYPE, pathName);

    const allowed = await read(await fetch(`${base}${pathName}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://www.chit402.com',
        'Access-Control-Request-Method': 'POST',
      },
    }));
    assert.equal(allowed.status, 204, pathName);
    assert.equal(allowed.text, '', pathName);
    assert.equal(allowed.headers.allow, undefined, pathName);
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://www.chit402.com', pathName);
    assert.equal(allowed.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS', pathName);
    assert.equal(allowed.headers['access-control-allow-headers'], OPTIONS_ALLOW_HEADERS, pathName);
    assert.equal(allowed.headers['access-control-expose-headers'], OPTIONS_EXPOSE_HEADERS, pathName);
    assert.equal(allowed.headers.vary, 'Origin', pathName);
  }
});

test('GET book/rotate with an allowed Origin keeps the CORS headers', async () => {
  const origin = 'https://www.chit402.com';
  const hit = await read(await fetch(`${base}/v1/agents/149/book/rotate`, { headers: { Origin: origin } }));
  const miss = await read(await fetch(`${base}/v1/agents/149/book/nope`, { headers: { Origin: origin } }));
  assert.equal(hit.status, 405);
  assert.equal(miss.status, 404);
  assert.equal(hit.headers['access-control-allow-origin'], miss.headers['access-control-allow-origin']);
  assert.equal(hit.headers['access-control-allow-origin'], origin);
  assert.equal(hit.headers.vary, miss.headers.vary);
  assert.equal(hit.headers.vary, 'Origin');
});

test('405 handler is registered after the real routes and before the 404 fallback', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const guardAt = src.indexOf('app.use(bookPostOnlyMethodGuard)');
  const mountAt = src.indexOf('ownerView.mount(app)');
  const broadcastAt = src.indexOf('registerOpenRouterBroadcast(');
  const fallbackAt = src.indexOf('// ── 404 fallback');
  let lastPost = -1;
  const marker = "app.post('/v1/agents/:agent_id/book";
  for (let from = 0; ;) {
    const at = src.indexOf(marker, from);
    if (at < 0) break;
    lastPost = at;
    from = at + marker.length;
  }
  assert.ok(guardAt > mountAt, 'after ownerView.mount');
  assert.ok(guardAt > broadcastAt, 'after registerOpenRouterBroadcast');
  assert.ok(guardAt > lastPost, 'after the last book POST');
  assert.ok(guardAt < fallbackAt, 'before the 404 fallback');
  assert.equal(src.indexOf('app.use(bookPostOnlyMethodGuard)', guardAt + 1), -1);
});

test('openapi lists 405 on the five POST-only book paths', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  for (const p of [
    '/v1/agents/{agent_id}/book/inflow',
    '/v1/agents/{agent_id}/book/inflow/correct',
    '/v1/agents/{agent_id}/book/ingest',
    '/v1/agents/{agent_id}/book/escrow',
    '/v1/agents/{agent_id}/book/rotate',
  ]) {
    const res = spec.paths[p].post.responses['405'];
    assert.ok(res, p);
    assert.match(res.description, /method_not_allowed/);
    assert.match(res.description, /Allow is POST/);
    assert.equal(res.content['application/json'].schema.properties.error.const, 'method_not_allowed');
  }
  assert.equal(spec.paths['/v1/agents/{agent_id}/book/dispute'].get.responses['405'], undefined);
  assert.equal(spec.paths['/v1/agents/{agent_id}/book/dispute'].post.responses['405'], undefined);
});
