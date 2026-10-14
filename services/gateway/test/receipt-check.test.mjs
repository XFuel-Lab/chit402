/**
 * Free POST /v1/receipts/check. Not x402.
 * Verdict text matches chit402-verify. The pasted input is not stored.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'false';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { createApp } = await import('../src/server.js');
const { mountReceiptCheck, receiptCheckLogFields } = await import('../src/receipt-check.js');
const { buildVerifyVerdict, humanVerdictLines } = await import('../../../packages/verify/dist/verdict.js');

const cli = fileURLToPath(new URL('../../../packages/verify/dist/cli.js', import.meta.url));
const MARKER = 'paste-marker-9f3c2a-do-not-store';
const BAD_RECEIPT = JSON.stringify({
  task_id: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
  issuer_signature: { alg: 'ES256', kid: 'not-a-kid', jws: 'aaa.bbb.ccc' },
  note: MARKER,
});

function cliLines(target) {
  const proc = spawnSync(process.execPath, [cli, target], { encoding: 'utf8', timeout: 15000 });
  assert.notEqual(proc.status, null, proc.stderr);
  return proc.stdout.trim().split('\n').filter((line) => line.length > 0);
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let server;
let base;

before(async () => {
  const app = createApp();
  ({ server, base } = await listen(app));
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function postCheck(input, origin = base) {
  const res = await fetch(`${origin}/v1/receipts/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ input }),
  });
  const body = await res.json();
  return { res, body };
}

test('a pasted receipt and the CLI print the same INVALID lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-check-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, BAD_RECEIPT);
  const { res, body } = await postCheck(BAD_RECEIPT);
  assert.equal(res.status, 200);
  assert.notEqual(res.status, 402);
  assert.equal(body.overall, 'INVALID');
  assert.deepEqual(body.lines, cliLines(file));
  assert.equal(body.lines[0], 'INVALID');
  assert.equal(body.verdict.result, 'invalid');
  assert.equal(body.verdict.exit_code, 1);
  assert.equal(JSON.stringify(body).includes(MARKER), false);
});

test('an unreachable receipt URL is COULD_NOT_CHECK with the CLI lines', async () => {
  const url = 'http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
  const { res, body } = await postCheck(url);
  assert.equal(res.status, 200);
  assert.equal(body.overall, 'COULD_NOT_CHECK');
  assert.deepEqual(body.lines, cliLines(url));
  assert.match(body.lines.join('\n'), /The receipt could not be fetched\./);
  assert.match(body.lines.join('\n'), /The receipt could not be checked\./);
  assert.equal(/invalid/i.test(body.lines.join('\n')), false);
  assert.equal(body.verdict.exit_code, 2);
});

test('VERIFIED uses the verifier headline and message', async () => {
  const verdict = buildVerifyVerdict({
    version: '0.4.1',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  assert.equal(verdict.result, 'verified');
  const lines = humanVerdictLines(verdict);
  assert.equal(lines[0], 'VERIFIED');
  assert.equal(lines[1], 'Every check passed.');

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const seen = [];
  mountReceiptCheck(app, {
    maxHits: 5,
    check: async () => ({ verdict, lines, report: 'lines' }),
    log(record) { seen.push(record); },
  });
  const { server: local, base: origin } = await listen(app);
  try {
    const { res, body } = await postCheck('chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96', origin);
    assert.equal(res.status, 200);
    assert.equal(body.overall, 'VERIFIED');
    assert.deepEqual(body.lines, lines);
    assert.equal(body.verdict.exit_code, 0);
    assert.deepEqual(seen, [{ overall: 'VERIFIED', status: 200 }]);
    assert.equal(JSON.stringify(seen).includes('chit-1ebc5616'), false);
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
});

test('per-IP rate limit rejects the next call', async () => {
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    maxHits: 2,
    windowMs: 60_000,
    check: async () => {
      const verdict = buildVerifyVerdict({ version: '0.4.1', absentReason: 'receipt_unavailable' });
      return { verdict, lines: humanVerdictLines(verdict), report: 'lines' };
    },
  });
  const { server: local, base: origin } = await listen(app);
  try {
    const first = await postCheck('http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96', origin);
    const second = await postCheck('http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96', origin);
    const third = await postCheck('http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96', origin);
    assert.equal(first.res.status, 200);
    assert.equal(second.res.status, 200);
    assert.equal(third.res.status, 429);
    assert.equal(third.body.error, 'rate_limit_exceeded');
    assert.ok(third.res.headers.get('retry-after'));
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
});

test('oversized input is rejected and a wallet is not looked up', async () => {
  const { res, body } = await postCheck(`${MARKER}${'x'.repeat(70_000)}`);
  assert.equal(res.status, 413);
  assert.equal(body.error, 'payload_too_large');
  assert.equal(JSON.stringify(body).includes(MARKER), false);

  const wallet = `0x${'ab'.repeat(20)}`;
  const looked = await postCheck(wallet);
  assert.equal(looked.res.status, 400);
  assert.equal(looked.body.error, 'receipt_required');
  assert.equal(JSON.stringify(looked.body).includes(wallet), false);
});

test('anonymous counts do not keep the pasted input', async () => {
  const app = createApp();
  const state = app.locals.receiptCheck;
  const before = JSON.stringify(state);
  assert.equal(before.includes(MARKER), false);
  const { server: local, base: origin } = await listen(app);
  try {
    const { res } = await postCheck(BAD_RECEIPT, origin);
    assert.equal(res.status, 200);
    const dumped = JSON.stringify(state);
    assert.equal(dumped.includes(MARKER), false);
    assert.equal(dumped.includes('aaa.bbb.ccc'), false);
    assert.ok(state.counts.invalid >= 1);
    assert.deepEqual(Object.keys(state.counts).sort(), ['could_not_check', 'invalid', 'rejected', 'verified']);
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
  const fields = receiptCheckLogFields({ overall: 'INVALID', status: 200, input: MARKER, body: BAD_RECEIPT });
  assert.deepEqual(fields, { overall: 'INVALID', status: 200 });
});

test('a server-side issuer-history read error is COULD_NOT_CHECK', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountReceiptCheck(app, {
    check: async () => ({
      verdict: buildVerifyVerdict({
        version: '0.4.1',
        errors: ['unreadable'],
        signatureChecked: true,
        signatureValid: false,
      }),
      lines: [],
      report: 'stderr',
      message: 'Error reading issuer history: ENOENT: snapshot',
      reason: 'unreadable',
    }),
  });
  const { server: local, base: origin } = await listen(app);
  try {
    const { res, body } = await postCheck(BAD_RECEIPT, origin);
    assert.equal(res.status, 200);
    assert.equal(body.overall, 'COULD_NOT_CHECK');
    assert.equal(body.verdict.result, 'could_not_check');
    assert.equal(body.verdict.exit_code, 2);
    assert.equal(body.verdict.reason, 'issuer_history_unavailable');
    assert.equal(body.lines[0], 'COULD_NOT_CHECK');
    assert.match(body.lines.join('\n'), /Issuer history could not be read\./);
    assert.match(body.lines.join('\n'), /The receipt could not be checked\./);
    assert.equal(/invalid/i.test(JSON.stringify({ overall: body.overall, lines: body.lines, message: body.verdict.message })), false);
    assert.equal(JSON.stringify(body).includes('ENOENT'), false);
    assert.equal(JSON.stringify(body).includes(MARKER), false);
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
});

test('the live check returns COULD_NOT_CHECK when the issuer-history snapshot cannot be read', async () => {
  const snapshot = fileURLToPath(new URL('../../../packages/verify/issuer-history.snapshot.json', import.meta.url));
  const aside = `${snapshot}.aside-check`;
  renameSync(snapshot, aside);
  try {
    const { res, body } = await postCheck(BAD_RECEIPT);
    assert.equal(res.status, 200);
    assert.equal(body.overall, 'COULD_NOT_CHECK');
    assert.equal(body.verdict.result, 'could_not_check');
    assert.equal(body.verdict.exit_code, 2);
    assert.equal(body.verdict.reason, 'issuer_history_unavailable');
    assert.match(body.lines.join('\n'), /Issuer history could not be read\./);
    assert.equal(/invalid/i.test(body.lines.join('\n')), false);
    assert.equal(JSON.stringify(body).includes('issuer-history.snapshot'), false);
  } finally {
    renameSync(aside, snapshot);
  }
});

test('GET is not a paid door', async () => {
  const res = await fetch(`${base}/v1/receipts/check`);
  assert.notEqual(res.status, 402);
  assert.equal(res.status, 404);
});
