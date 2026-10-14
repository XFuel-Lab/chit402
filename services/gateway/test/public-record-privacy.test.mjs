/**
 * Privacy leak tests for chit402.public.v1 (design T1–T6).
 * T7 lives with the verifier. Option B (T3 salts) is parked.
 * payment_tx is not in the record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.ALLOW_EPHEMERAL_ISSUER_KEY = 'true';
delete process.env.PUBLIC_RECORD_SERVE;
delete process.env.PUBLIC_RECORD_JOB;

const { PRIVATE_KEYS } = await import('../src/receipt-shell.js');
const { renderReceiptShellHtml, toPublicShell } = await import('../src/receipt-shell.js');
const {
  PUBLIC_RECORD_ALLOWLIST,
  buildPublicRecordPayload,
  inputsFromTasks,
  isRefusalReceipt,
  signMissingPublicRecords,
  signPublicRecordOnce,
} = await import('../src/public-record.js');
const {
  configurePublicRecordDir,
  getPublicRecordBytes,
  publicRecordCount,
  publicRecordServeEnabled,
  reloadPublicRecords,
  resetPublicRecords,
  ROTATION_TRUST_SHIPPED,
} = await import('../src/public-record-store.js');
const { handlePublicRecordGet, NOT_FOUND_BODY, sendStoredPublicRecord } = await import('../src/public-record-http.js');
const { signJws } = await import('../src/issuer-key.js');

const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const WALLET = `0x${'11'.repeat(20)}`;
const AGENT = 'agent-same-book';
const BOOK = 'book-same-payer';

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function leafHash(taskId, rowHash) {
  const body = Buffer.from(`${taskId}|${rowHash}`);
  return createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), body])).digest('hex');
}

function receiptFor(taskId, { version = 10, minute = '2026-10-14T11:07:33.000Z', amount = '2000' } = {}) {
  const claims = version === 11
    ? {
      v: 11,
      task_id: taskId,
      iss: 'chit402',
      iat: Math.floor(Date.parse(minute) / 1000),
      payment: {
        asset: 'USDC',
        network: 'base',
        payee: PAYEE,
        gross_amount: amount,
        settled_amount: amount,
        ref: `base:0x${'ab'.repeat(32)}`,
      },
      caller_binding: { payer_wallet: WALLET, agent_id: AGENT },
      route: { provider: 'akash-network', model: 'secret-model' },
      usage: { prompt_tokens: 12, completion_tokens: 34 },
      output: { hash: 'cd'.repeat(32) },
      request_digest: 'ef'.repeat(32),
    }
    : {
      payload_version: version,
      task_id: taskId,
      iss: 'chit402',
      iat: Math.floor(Date.parse(minute) / 1000),
      payment: {
        asset: 'USDC',
        network: 'base',
        payee: PAYEE,
        gross_amount: amount,
        settled_amount: amount,
        ref: `base:0x${'cd'.repeat(32)}`,
      },
      caller_binding: { payer_wallet: WALLET, agent_id: AGENT },
      route: { provider: 'akash-network', model: 'secret-model' },
      usage: { prompt_tokens: 12, completion_tokens: 34 },
      output: { hash: 'cd'.repeat(32) },
      request_digest: 'ef'.repeat(32),
    };
  const { jws, kid } = signJws(claims);
  return {
    task_id: taskId,
    created_at: minute,
    issuer_signature: { alg: 'ES256', jws, kid, payload_version: version === 11 ? 11 : version },
    payer_wallet: WALLET,
    agent_id: AGENT,
    book_id: BOOK,
    book_seq: 7,
    payment_tx: `0x${'ab'.repeat(32)}`,
    provider: 'akash-network',
    model: 'secret-model',
    prompt_tokens: 12,
    completion_tokens: 34,
    output_hash: 'cd'.repeat(32),
    request_digest: 'ef'.repeat(32),
  };
}

function payloadOf(bytes) {
  const jws = bytes.toString('utf8');
  return JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
}

function signOne(receipt, { leaf = true, signedAt = '2026-10-14T12:00:00.000Z' } = {}) {
  const row = '11'.repeat(32);
  return signPublicRecordOnce(receipt, {
    leafHash: leaf ? leafHash(receipt.task_id, row) : null,
    logId: leaf ? 'epoch:2' : null,
    signedAt: new Date(signedAt),
  });
}

test('T1 field allowlist matches the public record and excludes private keys', () => {
  resetPublicRecords();
  const receipt = receiptFor('xfuel-allow-1', { version: 10 });
  const signed = signOne(receipt);
  const payload = payloadOf(signed.bytes);
  assert.deepEqual(Object.keys(payload).sort(), [...PUBLIC_RECORD_ALLOWLIST].sort());
  for (const key of PRIVATE_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, key), false, key);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'payment_tx'), false);
  assert.equal(payload.schema, 'chit402.public.v1');
  assert.equal(payload.full_receipt_sha256, sha256(receipt.issuer_signature.jws));
  assert.equal(payload.leaf_hash, leafHash(receipt.task_id, '11'.repeat(32)));
  const text = signed.bytes.toString('utf8');
  assert.equal(text.includes(WALLET), false);
  assert.equal(text.includes(AGENT), false);
  assert.equal(text.includes(BOOK), false);
  assert.equal(text.includes('secret-model'), false);
  assert.equal(text.includes('akash-network'), false);
});

test('T2 hashes in the record are only the receipt binding and the log leaf', () => {
  resetPublicRecords();
  const receipt = receiptFor('xfuel-hash-1');
  const payload = payloadOf(signOne(receipt).bytes);
  const hashKeys = Object.keys(payload).filter((key) => /hash|sha256|digest|commitment|salt/i.test(key));
  assert.deepEqual(hashKeys.sort(), ['full_receipt_sha256', 'leaf_hash']);
  assert.match(payload.full_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.match(payload.leaf_hash, /^[0-9a-f]{64}$/);
  assert.equal(payload.amount_gross, '2000');
  assert.equal(/^[0-9a-f]{32,}$/i.test(payload.amount_gross), false);
  assert.equal(payload.full_receipt_sha256 === sha256(String(payload.amount_gross)), false);
  const signature = signOne(receipt).bytes.toString('utf8').split('.')[2];
  assert.ok(Buffer.from(signature, 'base64url').length >= 64);
  assert.equal(textHas(payload, receipt.payment_tx), false);
});

function textHas(payload, needle) {
  return JSON.stringify(payload).includes(needle);
}

test('T3 Option B is parked: the record has no salts', () => {
  resetPublicRecords();
  const src = readFileSync(fileURLToPath(new URL('../src/public-record.js', import.meta.url)), 'utf8');
  assert.equal(src.includes('randomBytes'), false);
  assert.equal(src.includes('Option B'), true);
  const payload = payloadOf(signOne(receiptFor('xfuel-nosalt')).bytes);
  assert.equal(payload.salts, undefined);
  assert.equal(payload.commitments, undefined);
  assert.equal(Object.keys(payload).some((key) => /salt/i.test(key)), false);
});

test('T4 two receipts from one payer, agent, and book do not share a private id', () => {
  resetPublicRecords();
  const a = receiptFor('xfuel-link-a', { minute: '2026-10-14T11:07:33.000Z', amount: '2000' });
  const b = receiptFor('xfuel-link-b', { minute: '2026-10-14T11:09:10.000Z', amount: '3000', version: 11 });
  assert.equal(a.payer_wallet, b.payer_wallet);
  assert.equal(a.agent_id, b.agent_id);
  assert.equal(a.book_id, b.book_id);
  assert.equal(a.book_seq, b.book_seq);
  const left = payloadOf(signOne(a, { signedAt: '2026-10-14T12:00:00.000Z' }).bytes);
  const right = payloadOf(signOne(b, { signedAt: '2026-10-14T12:05:00.000Z' }).bytes);
  assert.equal(left.payload_version, 10);
  assert.equal(right.payload_version, 11);
  assert.equal(left.issued_at, '2026-10-14T11:07:00.000Z');
  assert.equal(right.issued_at, '2026-10-14T11:09:00.000Z');
  const shared = Object.keys(left).filter((key) => Object.is(left[key], right[key]));
  const allowed = new Set(['schema', 'asset', 'chain', 'pay_to', 'kid', 'log_id']);
  for (const key of shared) assert.equal(allowed.has(key), true, key);
  assert.equal(left.receipt_id === right.receipt_id, false);
  assert.equal(Object.prototype.hasOwnProperty.call(left, 'book_seq'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(left, 'book_id'), false);
  assert.equal(JSON.stringify(left).includes(WALLET), false);
  assert.equal(JSON.stringify(right).includes(AGENT), false);
});

test('T5 the stored record is byte-identical and serving stays off', async () => {
  resetPublicRecords();
  assert.equal(ROTATION_TRUST_SHIPPED, false);
  assert.equal(publicRecordServeEnabled(), false);
  const receipt = receiptFor('xfuel-cache-1');
  const signed = signOne(receipt);
  const shell = toPublicShell(receipt);
  const html = renderReceiptShellHtml(shell);
  assert.equal(html.includes(signed.bytes.toString('utf8')), false);
  assert.equal(html.includes(payloadOf(signed.bytes).full_receipt_sha256), false);
  assert.match(html, /property="og:title"/);
  assert.equal(html.includes('payment_tx') === false || html.includes('Payment tx'), true);

  reloadPublicRecords();
  const stored = getPublicRecordBytes('xfuel-cache-1');
  assert.equal(stored.toString('utf8'), signed.bytes.toString('utf8'));

  const app = express();
  app.get('/receipt/:taskId/public', (req, res) => handlePublicRecordGet(req, res));
  app.get('/stored/:taskId', (req, res) => sendStoredPublicRecord(res, stored));
  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/receipt/xfuel-cache-1/public`;
  try {
    process.env.PUBLIC_RECORD_SERVE = 'true';
    assert.equal(publicRecordServeEnabled(), false);
    const flagged = await fetch(url, { headers: { Accept: 'application/json' } });
    const flaggedBody = Buffer.from(await flagged.arrayBuffer());
    assert.equal(flagged.status, 404);
    assert.equal(Buffer.compare(flaggedBody, NOT_FOUND_BODY), 0);
    assert.equal(flagged.headers.get('cache-control'), 'private, no-store');

    const served = await fetch(`http://127.0.0.1:${port}/stored/xfuel-cache-1`);
    const servedBody = Buffer.from(await served.arrayBuffer());
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('cache-control'), 'public, immutable');
    assert.equal(served.headers.get('content-type'), 'application/jose');
    assert.equal(Buffer.compare(servedBody, signed.bytes), 0);

    delete process.env.PUBLIC_RECORD_SERVE;
    const hidden = await fetch(url, { headers: { Accept: 'text/html' } });
    const unknown = await fetch(`http://127.0.0.1:${port}/receipt/xfuel-no-such/public`);
    const hiddenBody = Buffer.from(await hidden.arrayBuffer());
    const unknownBody = Buffer.from(await unknown.arrayBuffer());
    assert.equal(hidden.status, 404);
    assert.equal(unknown.status, 404);
    assert.equal(Buffer.compare(hiddenBody, unknownBody), 0);
    assert.equal(Buffer.compare(hiddenBody, NOT_FOUND_BODY), 0);
  } finally {
    delete process.env.PUBLIC_RECORD_SERVE;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('T6 a missing record stays missing across 1000 GETs', async () => {
  resetPublicRecords();
  const httpSrc = readFileSync(fileURLToPath(new URL('../src/public-record-http.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(httpSrc, /signJws|signPublicRecord|putPublicRecord|signMissing/);
  const serverSrc = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8');
  const at = serverSrc.indexOf("'/receipt/:taskId/public'");
  assert.ok(at > 0);
  const route = serverSrc.slice(at, at + 280);
  assert.match(route, /handlePublicRecordGet/);
  assert.doesNotMatch(route, /signJws|signPublicRecord|signMissing/);

  process.env.PUBLIC_RECORD_SERVE = 'true';
  const app = express();
  app.get('/receipt/:taskId/public', (req, res) => handlePublicRecordGet(req, res));
  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/receipt/xfuel-missing/public`;
  try {
    assert.equal(publicRecordCount(), 0);
    for (let i = 0; i < 1000; i += 1) {
      const res = await fetch(url, {
        headers: { Accept: i % 2 === 0 ? 'application/json' : 'text/html' },
      });
      assert.equal(res.status, 404);
      await res.arrayBuffer();
    }
    assert.equal(publicRecordCount(), 0);
    assert.equal(getPublicRecordBytes('xfuel-missing'), null);
  } finally {
    delete process.env.PUBLIC_RECORD_SERVE;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the job signs once, skips refusals, and does not replace a record', () => {
  resetPublicRecords();
  const receipt = receiptFor('xfuel-once');
  const first = signOne(receipt);
  assert.equal(first.created, true);
  const again = signPublicRecordOnce(receipt, {
    leafHash: 'ff'.repeat(32),
    logId: 'epoch:9',
    signedAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  assert.equal(again.created, false);
  assert.equal(again.bytes.toString('utf8'), first.bytes.toString('utf8'));
  const payload = payloadOf(again.bytes);
  assert.equal(payload.leaf_hash, leafHash(receipt.task_id, '11'.repeat(32)));
  assert.notEqual(payload.log_id, 'epoch:9');

  const refusal = {
    schema: 'chit402.refusal.v1',
    refusal_id: 'refusal-1',
    charged: false,
    issuer_signature: receipt.issuer_signature,
  };
  assert.equal(isRefusalReceipt(refusal), true);
  const skipped = signPublicRecordOnce(refusal, { leafHash: 'aa'.repeat(32), logId: 'epoch:2' });
  assert.equal(skipped.skipped, 'refusal');
  assert.equal(getPublicRecordBytes('refusal-1'), null);

  const extra = receiptFor('xfuel-batch', { amount: '4000' });
  const created = signMissingPublicRecords([
    { receipt, leafHash: 'ff'.repeat(32), logId: 'epoch:9' },
    { receipt: extra, leafHash: leafHash(extra.task_id, '22'.repeat(32)), logId: 'epoch:2' },
    { receipt: refusal },
  ]);
  assert.deepEqual(created, ['xfuel-batch']);
  assert.equal(getPublicRecordBytes('xfuel-once').toString('utf8'), first.bytes.toString('utf8'));

  const waiting = inputsFromTasks([extra], () => ({ leafHash: null, logId: null }));
  assert.deepEqual(waiting, []);
  const ready = inputsFromTasks([extra], () => ({ leafHash: 'ab'.repeat(32), logId: 'epoch:2' }));
  assert.equal(ready.length, 1);
  assert.equal(ready[0].leafHash, 'ab'.repeat(32));
});

test('a pre-log receipt is signed with a null leaf and v11 is labelled by payload version', () => {
  resetPublicRecords();
  const pre = receiptFor('xfuel-prelog-job');
  const signed = signOne(pre, { leaf: false });
  const payload = payloadOf(signed.bytes);
  assert.equal(payload.leaf_hash, null);
  assert.equal(payload.log_id, null);
  assert.equal(payload.payload_version, 10);

  const v11 = receiptFor('xfuel-v11-job', { version: 11 });
  const v11Payload = buildPublicRecordPayload(v11, {
    leafHash: leafHash(v11.task_id, '33'.repeat(32)),
    logId: 'epoch:2',
    signedAt: new Date('2026-10-14T12:00:00.000Z'),
  });
  assert.equal(v11Payload.payload_version, 11);
  assert.equal(Object.prototype.hasOwnProperty.call(v11Payload, 'payment_tx'), false);
});

test('the sign script dry-run does not write a record', () => {
  const folder = mkdtempSync(join(tmpdir(), 'public-job-'));
  const receipt = receiptFor('xfuel-script');
  const file = join(folder, 'receipts.json');
  writeFileSync(file, JSON.stringify([{
    receipt,
    leaf_hash: leafHash(receipt.task_id, '44'.repeat(32)),
    log_id: 'epoch:2',
  }]));
  const script = fileURLToPath(new URL('../scripts/sign-public-records.mjs', import.meta.url));
  const out = join(folder, 'out');
  const res = spawnSync(process.execPath, [script, '--receipts', file, '--out', out], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ALLOW_EPHEMERAL_ISSUER_KEY: 'true' },
  });
  assert.equal(res.status, 0, res.stderr);
  const summary = JSON.parse(res.stdout);
  assert.equal(summary.would_sign, 1);
  assert.equal(summary.apply, false);
  assert.equal(res.stdout.includes('ISSUER_PRIVATE_KEY'), false);
  assert.equal(existsSync(join(out, 'xfuel-script.jws')), false);
});

test('a restart serves the first backfill bytes and ignores the quote', () => {
  resetPublicRecords();
  const receipt = receiptFor('xfuel-durable', { amount: '2000' });
  receipt.payment = {
    asset: 'QUOTE',
    network: 'solana',
    payee: '0xquotequotequotequotequotequotequotequote',
    gross_amount: '1',
    settled_amount: '1',
  };
  receipt.payment_meta = { network: 'solana' };
  receipt.created_at = '1999-01-01T00:00:00.000Z';
  const first = signOne(receipt);
  const payload = payloadOf(first.bytes);
  assert.equal(payload.asset, 'USDC');
  assert.equal(payload.chain, 'base');
  assert.equal(payload.pay_to, PAYEE);
  assert.equal(payload.amount_gross, '2000');
  assert.equal(payload.amount_settled, '2000');
  assert.equal(payload.issued_at, '2026-10-14T11:07:00.000Z');
  assert.equal(JSON.stringify(payload).includes('QUOTE'), false);
  assert.equal(JSON.stringify(payload).includes('1999'), false);

  reloadPublicRecords();
  const again = signPublicRecordOnce(receipt, {
    leafHash: 'ff'.repeat(32),
    logId: 'epoch:9',
    signedAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  assert.equal(again.created, false);
  assert.equal(again.bytes.toString('utf8'), first.bytes.toString('utf8'));

  const folder = mkdtempSync(join(tmpdir(), 'public-backfill-'));
  const file = join(folder, 'receipts.json');
  const backfill = receiptFor('xfuel-backfill');
  writeFileSync(file, JSON.stringify([{
    receipt: backfill,
    leaf_hash: leafHash(backfill.task_id, '55'.repeat(32)),
    log_id: 'epoch:2',
  }]));
  const script = fileURLToPath(new URL('../scripts/sign-public-records.mjs', import.meta.url));
  const out = join(folder, 'records');
  const applied = spawnSync(process.execPath, [script, '--receipts', file, '--apply', '--out', out], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ALLOW_EPHEMERAL_ISSUER_KEY: 'true' },
  });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).signed, 1);
  const disk = readFileSync(join(out, 'xfuel-backfill.jws'));
  configurePublicRecordDir(out);
  assert.equal(getPublicRecordBytes('xfuel-backfill').toString('utf8'), disk.toString('utf8'));
  const second = spawnSync(process.execPath, [script, '--receipts', file, '--apply', '--out', out], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ALLOW_EPHEMERAL_ISSUER_KEY: 'true' },
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).signed, 0);
  assert.equal(readFileSync(join(out, 'xfuel-backfill.jws')).toString('utf8'), disk.toString('utf8'));
});

test('a missing signed payment is not filled from the quote', () => {
  resetPublicRecords();
  const claims = {
    payload_version: 10,
    task_id: 'xfuel-no-pay',
    iss: 'chit402',
    iat: Math.floor(Date.parse('2026-10-14T11:07:33.000Z') / 1000),
  };
  const { jws, kid } = signJws(claims);
  const receipt = {
    task_id: 'xfuel-no-pay',
    created_at: '2026-10-14T11:07:33.000Z',
    issuer_signature: { jws, kid },
    payment: { asset: 'USDC', network: 'base', payee: PAYEE, gross_amount: '9', settled_amount: '9' },
  };
  assert.throws(() => signOne(receipt), (err) => err.code === 'public_record_payment_missing');
  assert.equal(getPublicRecordBytes('xfuel-no-pay'), null);
});
