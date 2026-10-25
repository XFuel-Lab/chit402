/**
 * Receipts issued before the public log (Oct 2, 2026) keep their exit code.
 * The gateway may add a `log_note` to the public shell JSON; the verdict is
 * the same with or without it: exit 1, not_in_log.
 *
 * The shell, the log's not_in_tree answer and the signed tree head come
 * from a loopback stub (the head is a recorded production head fixture).
 * Nothing is fetched from api.chit402.com: an in-process fetch off
 * loopback is refused and recorded, and the last test asserts none.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { tempDir } from './tmp-dirs.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const shell = JSON.parse(readFileSync(new URL('./fixtures/public/chit-43c98110-prelog-shell.json', import.meta.url), 'utf8'));
const head = JSON.parse(readFileSync(new URL('./fixtures/public/tree-head-size3.json', import.meta.url), 'utf8'));
const holder = JSON.parse(readFileSync(new URL('./fixtures/public/foreign-x402-muy1hh8y.json', import.meta.url), 'utf8'));
const { checkReceiptInput } = await import('../dist/check-input.js');
// Anything off loopback is refused and recorded: this file never reaches a real host.
const offHost = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const host = new URL(String(url)).hostname;
  if (host !== '127.0.0.1') {
    offHost.push(String(url));
    throw new TypeError('off-loopback fetch refused in test');
  }
  return realFetch(input, init);
};
const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9/', SOLANA_RPC_URL: 'http://127.0.0.1:9/' };

const stub = { doc: shell, head, gets: [] };
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    stub.gets.push(`${req.method} ${req.url}`);
    if (req.method !== 'GET') return send(405, { error: 'method' });
    if (req.url.startsWith(`/receipt/${shell.receipt_id}`)) return send(200, stub.doc);
    if (/^\/v1\/receipts\/[^/]+\/inclusion/.test(req.url)) return send(404, { error: 'not_in_tree' });
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, stub.head);
    return send(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

// Async: the stub answers from this process while the CLI runs.
function run(doc) {
  stub.doc = doc;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, `${origin}/receipt/${shell.receipt_id}`, '--json'], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      try {
        resolve({ status, body: JSON.parse(stdout) });
      } catch {
        reject(new Error(`status=${status} stdout=${stdout} stderr=${stderr}`));
      }
    });
  });
}

test('pre-log shell: exit 1 not_in_log, with or without log_note', async () => {
  assert.equal(shell.inclusion.leaf_hash, null);
  assert.ok(Date.parse(shell.issued_at) < Date.parse('2026-10-02T17:30:00Z'));
  stub.head = head;
  const plain = await run(shell);
  const noted = await run({ ...shell, log_note: 'Issued before the public log began on Oct 2, 2026.' });
  for (const r of [plain, noted]) {
    assert.equal(r.status, 1, JSON.stringify(r.body));
    assert.equal(r.body.exit_code, 1);
    assert.equal(r.body.result, 'invalid');
    assert.equal(r.body.reason, 'not_in_log');
    assert.equal(r.body.checks.log_inclusion, 'fail');
  }
  assert.deepEqual(noted.body.checks, plain.body.checks);
  assert.ok(stub.gets.some((line) => line.startsWith('GET /v1/receipts/tree/head')), stub.gets.join('\n'));
});

test('pre-log shell: an unsigned head is not NOT_IN_LOG', async () => {
  const { issuer_signature: _drop, ...unsigned } = head;
  stub.head = unsigned;
  const r = await run(shell);
  stub.head = head;
  assert.equal(r.status, 2, JSON.stringify(r.body));
  assert.notEqual(r.body.reason, 'not_in_log');
});

test('pre-log shell: a bad fixed head beside the signed head is not NOT_IN_LOG (N4)', async () => {
  for (const fixed of [{}, { schema: 'chit402.tree_head_eip712.v1' }]) {
    stub.head = { ...head, fixed_head: fixed };
    const r = await run(shell);
    assert.notEqual(r.body.reason, 'not_in_log', JSON.stringify(r.body));
    assert.notEqual(r.status, 0);
    assert.notEqual(r.body.checks.log_inclusion, 'fail');
  }
  stub.head = head;
});

test('absence on the full path: a bad fixed head is fixed_head_invalid, not NOT_IN_LOG (N4)', async () => {
  const dir = tempDir('chit-absence-');
  const file = join(dir, 'receipt.json');
  // Both URLs go to loopback: issuer history is looked up from jwks_uri first.
  const copy = {
    ...holder,
    verify_url: `${origin}/receipt/${holder.task_id}`,
    verification: { ...holder.verification, jwks_uri: `${origin}/.well-known/jwks.json` },
  };
  writeFileSync(file, JSON.stringify(copy));
  const opts = { rpcUrl: 'http://127.0.0.1:9/', solanaRpcUrl: 'http://127.0.0.1:9/' };
  try {
    stub.head = head;
    const plain = (await checkReceiptInput(file, opts)).verdict;
    assert.equal(plain.reason, 'not_in_log', JSON.stringify(plain));
    assert.equal(plain.exit_code, 1);
    stub.head = { ...head, fixed_head: {} };
    const bad = (await checkReceiptInput(file, opts)).verdict;
    assert.equal(bad.exit_code, 1, JSON.stringify(bad));
    assert.equal(bad.reason, 'fixed_head_invalid');
  } finally {
    stub.head = head;
  }
});

test('pre-log shell: only the loopback stub was read, GET only', () => {
  assert.deepEqual(offHost, [], `off-loopback fetches: ${offHost.join(', ')}`);
  assert.ok(stub.gets.length > 0);
  assert.ok(stub.gets.every((line) => line.startsWith('GET ')), stub.gets.join('\n'));
});
