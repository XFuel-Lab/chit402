/**
 * Pre-settle facilitator refusals stay on the ops export and off receipt_failures.
 * The payer hint is an allowlist code plus a fixed message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { publicHealthBody } from '../src/public-metrics.js';
import { paymentFailureBody } from '../src/x402-flags.js';
import { openAiFailurePayload } from '../src/openai-gateway.js';
import { verifyPayment, ChallengeStore } from '../src/x402-adapter.js';
import { verifyViaFacilitator } from '../src/x402-facilitator.js';
import {
  listReceiptFailures,
  preSettleRefusalCount,
  receiptFailureCount,
  recordReceiptFailure,
  resetReceiptFailuresForTests,
} from '../src/receipt-failures.js';
import {
  VERIFY_HINT_CODE_MAX,
  VERIFY_HINT_CODES,
  VERIFY_HINT_INPUT_MAX,
  VERIFY_HINT_MESSAGE_MAX,
  VERIFY_HINT_MESSAGES,
  publicVerifyHint,
  verifyHint,
  verifyHintCode,
} from '../src/verify-hint.js';
import { SCENARIOS, attempt, paymentHeader } from './fixtures/refusal-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = path.resolve(HERE, '..');
const SERVER_SRC = fs.readFileSync(path.join(GATEWAY, 'src', 'server.js'), 'utf8');

const HOSTILE = [
  'http://evil.example/a?x=1',
  'Error: boom\n    at settle (x402-settle.js:1:1)',
  'PAYMENT-SIGNATURE.' + 'A'.repeat(80),
  'sk_live_' + 'a'.repeat(40),
  'not_a_known_reason',
  'amount_required',
  'insufficient_funds_extra',
  'x_insufficient_funds',
  'insufficient_funds http://evil.example',
  '',
  '   ',
];

test('verify hint maps each allowlist code to its fixed message inside the length bounds', () => {
  assert.deepEqual(VERIFY_HINT_CODES, [
    'insufficient_funds',
    'invalid_fee_payer',
    'amount_mismatch',
    'expired_authorization',
    'invalid_signature',
    'invalid_network',
    'unknown',
  ]);
  for (const code of VERIFY_HINT_CODES) {
    const hint = verifyHint(code);
    assert.deepEqual(hint, { code, message: VERIFY_HINT_MESSAGES[code] }, code);
    assert.ok(hint.code.length <= VERIFY_HINT_CODE_MAX, code);
    assert.ok(hint.message.length > 0 && hint.message.length <= VERIFY_HINT_MESSAGE_MAX, hint.message);
    assert.equal(JSON.stringify(hint).length <= 160, true, code);
  }
});

test('verify hint maps known facilitator identifiers onto the allowlist', () => {
  const cases = {
    insufficient_funds: 'insufficient_funds',
    INSUFFICIENT_FUNDS: 'insufficient_funds',
    InsufficientFunds: 'insufficient_funds',
    invalid_fee_payer: 'invalid_fee_payer',
    InvalidFeePayer: 'invalid_fee_payer',
    amount_mismatch: 'amount_mismatch',
    AMOUNT_MISMATCH: 'amount_mismatch',
    expired_authorization: 'expired_authorization',
    authorization_expired: 'expired_authorization',
    invalid_signature: 'invalid_signature',
    invalid_exact_evm_payload_signature: 'invalid_signature',
    invalid_exact_svm_payload_signature: 'invalid_signature',
    invalid_network: 'invalid_network',
    unknown: 'unknown',
  };
  for (const [raw, code] of Object.entries(cases)) {
    assert.equal(verifyHint(raw).code, code, raw);
    assert.equal(verifyHint(raw).message, VERIFY_HINT_MESSAGES[code], raw);
    assert.equal(raw.length <= VERIFY_HINT_INPUT_MAX, true, raw);
  }
});

test('verify hint maps hostile or unknown text to unknown and does not echo it', () => {
  for (const raw of HOSTILE) {
    const hint = verifyHint(raw);
    assert.deepEqual(hint, { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown }, JSON.stringify(raw));
    if (raw.trim() === '') continue;
    const packed = JSON.stringify(hint);
    assert.equal(packed.includes(raw), false, raw);
    if (raw.includes('evil.example')) assert.equal(packed.includes('evil.example'), false);
    if (raw.includes('PAYMENT-SIGNATURE')) assert.equal(packed.includes('PAYMENT-SIGNATURE'), false);
    if (raw.includes('sk_live_')) assert.equal(packed.includes('sk_live_'), false);
    if (raw.includes('at settle')) assert.equal(packed.includes('at settle'), false);
  }
  const long = 'Z'.repeat(VERIFY_HINT_INPUT_MAX + 50);
  const dropped = verifyHint(long);
  assert.equal(dropped.code, 'unknown');
  assert.equal(JSON.stringify(dropped).includes('Z'), false);
});

test('verify hint maps non-strings to unknown', () => {
  for (const raw of [null, undefined, 12, { toString: () => 'insufficient_funds' }, ['insufficient_funds']]) {
    assert.equal(verifyHint(raw).code, 'unknown');
  }
});

test('a substituted hint message is replaced by the fixed sentence', () => {
  const hostile = 'http://evil.example/raw-facilitator-text';
  const hint = publicVerifyHint({ code: 'insufficient_funds', message: hostile });
  assert.equal(hint.message, VERIFY_HINT_MESSAGES.insufficient_funds);
  assert.equal(JSON.stringify(hint).includes('evil.example'), false);
  assert.equal(publicVerifyHint({ code: hostile, message: hostile }), null);
  assert.equal(publicVerifyHint('insufficient_funds'), null);
  const body = paymentFailureBody({
    code: 'verify_failed',
    preSettle: true,
    hint: { code: 'insufficient_funds', message: hostile },
  });
  assert.equal(body.hint.message, VERIFY_HINT_MESSAGES.insufficient_funds);
  assert.equal(JSON.stringify(body).includes(hostile), false);
});

test('public health keeps existing fields and adds pre_settle_refusals', () => {
  const body = publicHealthBody({
    degraded: false,
    lastAnchoredRoot: 'abc',
    lastAnchoredTx: '0x1',
    anchorLagS: 3,
    unanchoredLeaves: 2,
    receiptFailures: 4,
    preSettleRefusals: 5,
    issuanceCap: { hour_used: 1, day_used: 2, state: 'off' },
  });
  assert.equal(body.status, 'ok');
  assert.equal(body.free_tier, 'available');
  assert.equal(body.last_anchored_root, 'abc');
  assert.equal(body.last_anchored_tx, '0x1');
  assert.equal(body.anchor_lag_s, 3);
  assert.equal(body.unanchored_leaves, 2);
  assert.equal(body.receipt_failures, 4);
  assert.equal(body.pre_settle_refusals, 5);
  assert.deepEqual(body.issuance.cap, { hour_used: 1, day_used: 2, state: 'off' });
});

test('GET /health reads receipt failures and pre-settle refusals', () => {
  assert.equal(SERVER_SRC.includes('receiptFailures: receiptFailureCount()'), true);
  assert.equal(SERVER_SRC.includes('preSettleRefusals: preSettleRefusalCount()'), true);
});

test('receipt_failures counts money that may have moved; pre_settle with no tx is separate and still a row', () => {
  resetReceiptFailuresForTests();
  recordReceiptFailure({
    stage: 'settle', outcome: 'refused', reason: 'settle_failed', network: 'base',
    sub_reason: 'http', phase: 'post_submit',
  });
  recordReceiptFailure({
    stage: 'settle', outcome: 'refused', reason: 'verify_failed', network: 'solana',
    sub_reason: 'facilitator_invalid', phase: 'pre_settle', tx: null, subDetail: 'insufficient_funds',
  });
  recordReceiptFailure({
    stage: 'settle', outcome: 'refused', reason: 'verify_failed', network: 'solana',
    sub_reason: 'facilitator_invalid', phase: 'pre_settle', tx: 'sig111', subDetail: 'http://evil.example/nope',
  });
  assert.equal(receiptFailureCount(), 2);
  assert.equal(preSettleRefusalCount(), 1);
  const rows = listReceiptFailures();
  assert.equal(rows.length, 3);
  const noMoney = rows.find((row) => row.phase === 'pre_settle' && row.tx == null);
  assert.equal(noMoney.preSettle, true);
  assert.equal(noMoney.stage, 'settle');
  assert.equal(noMoney.reason, 'verify_failed');
  assert.equal(noMoney.sub_reason, 'facilitator_invalid');
  assert.equal(noMoney.sub_detail, 'insufficient_funds');
  const withTx = rows.find((row) => row.tx === 'sig111');
  assert.equal(withTx.phase, 'pre_settle');
  assert.equal(withTx.preSettle, undefined);
  assert.equal(withTx.sub_detail, 'unknown');
  assert.equal(JSON.stringify(withTx).includes('evil.example'), false);
  const post = rows.find((row) => row.phase === 'post_submit');
  assert.equal(post.preSettle, undefined);
  assert.equal(post.sub_detail, undefined);
  assert.equal(post.sub_reason, 'http');
  const health = publicHealthBody({
    receiptFailures: receiptFailureCount(),
    preSettleRefusals: preSettleRefusalCount(),
  });
  assert.equal(health.receipt_failures, 2);
  assert.equal(health.pre_settle_refusals, 1);
});

test('pre-check refusals stay off both public counters', () => {
  resetReceiptFailuresForTests();
  recordReceiptFailure({
    stage: 'pre-check', outcome: 'refused', reason: 'challenge_mismatch', network: 'base',
    preSettle: true, sub_reason: 'resource', phase: 'pre_settle',
  });
  assert.equal(listReceiptFailures().length, 0);
  assert.equal(receiptFailureCount(), 0);
  assert.equal(preSettleRefusalCount(), 0);
});

test('a reloaded pre-settle row with no tx is tagged and leaves receipt_failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-settle-'));
  const file = path.join(dir, 'failures.jsonl');
  const prod = {
    time: '2026-11-01T00:00:00.000Z',
    network: 'solana',
    stage: 'settle',
    reason: 'verify_failed',
    tx: null,
    outcome: 'refused',
    request_id: null,
    sub_reason: 'facilitator_invalid',
    phase: 'pre_settle',
  };
  const post = {
    time: '2026-11-01T00:01:00.000Z',
    network: 'solana',
    stage: 'settle',
    reason: 'settle_failed',
    tx: null,
    outcome: 'refused',
    request_id: 'req-post',
    sub_reason: 'http',
    phase: 'post_submit',
  };
  fs.writeFileSync(file, `${JSON.stringify(prod)}\n${JSON.stringify(post)}\n`);
  const previous = process.env.RECEIPT_FAILURES_FILE;
  process.env.RECEIPT_FAILURES_FILE = file;
  try {
    resetReceiptFailuresForTests();
    assert.equal(preSettleRefusalCount(), 1);
    assert.equal(receiptFailureCount(), 1);
    const rows = listReceiptFailures();
    assert.equal(rows.length, 2);
    const tagged = rows.find((row) => row.reason === 'verify_failed');
    assert.equal(tagged.phase, 'pre_settle');
    assert.equal(tagged.tx, null);
    assert.equal(tagged.preSettle, true);
    assert.equal(tagged.sub_reason, 'facilitator_invalid');
    assert.equal(tagged.stage, 'settle');
    assert.equal(tagged.network, 'solana');
    assert.equal(tagged.outcome, 'refused');
    const kept = rows.find((row) => row.reason === 'settle_failed');
    assert.equal(kept.phase, 'post_submit');
    assert.equal(kept.request_id, 'req-post');
    assert.equal(kept.preSettle, undefined);
  } finally {
    if (previous == null) delete process.env.RECEIPT_FAILURES_FILE;
    else process.env.RECEIPT_FAILURES_FILE = previous;
    resetReceiptFailuresForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a /verify refusal is preSettle, hints the payer, and does not count as a receipt failure', async () => {
  resetReceiptFailuresForTests();
  const { decision } = await SCENARIOS.facilitator_invalid.run();
  assert.equal(decision.preSettle, true);
  assert.equal(decision.code, 'verify_failed');
  assert.deepEqual(decision.hint, {
    code: 'insufficient_funds',
    message: VERIFY_HINT_MESSAGES.insufficient_funds,
  });
  assert.deepEqual(paymentFailureBody(decision), {
    error: 'verify_failed',
    code: 'verify_failed',
    hint: decision.hint,
  });
  const chat = openAiFailurePayload(decision);
  assert.equal(chat.status, 402);
  assert.deepEqual(chat.body.error.hint, decision.hint);
  assert.equal(receiptFailureCount(), 0);
  assert.equal(preSettleRefusalCount(), 1);
  const rows = listReceiptFailures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'settle');
  assert.equal(rows[0].phase, 'pre_settle');
  assert.equal(rows[0].tx, null);
  assert.equal(rows[0].preSettle, true);
  assert.equal(rows[0].reason, 'verify_failed');
  assert.equal(rows[0].sub_reason, 'facilitator_invalid');
  assert.equal(rows[0].sub_detail, 'insufficient_funds');
  resetReceiptFailuresForTests();
});

test('a /verify refusal with hostile invalidReason returns unknown and stores the code only', async () => {
  resetReceiptFailuresForTests();
  const hostile = 'http://evil.example/a?x=1';
  const long = 'PAYMENT-SIGNATURE.' + 'A'.repeat(80);
  for (const invalidReason of [hostile, long]) {
    resetReceiptFailuresForTests();
    const { decision } = await attempt({ fac: { verify: 'invalid', invalidReason } });
    assert.equal(decision.preSettle, true);
    assert.deepEqual(decision.hint, { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown });
    const packed = JSON.stringify({
      body: paymentFailureBody(decision),
      chat: openAiFailurePayload(decision),
      rows: listReceiptFailures(),
    });
    assert.equal(packed.includes('evil.example'), false);
    assert.equal(packed.includes('PAYMENT-SIGNATURE'), false);
    assert.equal(packed.includes('AAAA'), false);
    assert.equal(listReceiptFailures()[0].sub_detail, 'unknown');
    assert.equal(listReceiptFailures()[0].preSettle, true);
    assert.equal(receiptFailureCount(), 0);
    assert.equal(preSettleRefusalCount(), 1);
  }
  resetReceiptFailuresForTests();
});

test('a post-settle failure still counts as a receipt failure and carries no hint', async () => {
  resetReceiptFailuresForTests();
  const { decision } = await SCENARIOS.settle_http.run();
  assert.equal(decision.preSettle, false);
  assert.equal(decision.hint, undefined);
  assert.equal(decision.code, 'settle_failed');
  assert.equal(paymentFailureBody(decision).hint, undefined);
  assert.equal(openAiFailurePayload(decision).body.error.hint, undefined);
  assert.equal(receiptFailureCount(), 1);
  assert.equal(preSettleRefusalCount(), 0);
  const row = listReceiptFailures()[0];
  assert.equal(row.phase, 'post_submit');
  assert.equal(row.sub_reason, 'http');
  assert.equal(row.preSettle, undefined);
  assert.equal(row.sub_detail, undefined);
  assert.equal(row.stage, 'settle');
  resetReceiptFailuresForTests();
});

test('a /verify refusal that reports a tx stores it and counts as a receipt failure', async () => {
  resetReceiptFailuresForTests();
  const tx = `0x${'cd'.repeat(32)}`;
  const { decision } = await attempt({ fac: { verify: 'invalid', verifyTx: tx } });
  assert.equal(decision.preSettle, false);
  assert.equal(decision.code, 'verify_failed');
  assert.equal(decision.hint.code, 'insufficient_funds');
  const body = paymentFailureBody(decision);
  assert.equal(body.hint.code, 'insufficient_funds');
  assert.equal(JSON.stringify(body).includes('Nothing was settled'), false);
  const chat = openAiFailurePayload(decision);
  assert.equal(chat.body.error.hint.code, 'insufficient_funds');
  assert.equal(receiptFailureCount(), 1);
  assert.equal(preSettleRefusalCount(), 0);
  const row = listReceiptFailures()[0];
  assert.equal(row.tx, tx);
  assert.equal(row.phase, 'pre_settle');
  assert.equal(row.stage, 'settle');
  assert.equal(row.preSettle, undefined);
  assert.equal(row.sub_reason, 'facilitator_invalid');
  assert.equal(row.sub_detail, 'insufficient_funds');
  const health = publicHealthBody({
    receiptFailures: receiptFailureCount(),
    preSettleRefusals: preSettleRefusalCount(),
  });
  assert.equal(health.receipt_failures, 1);
  assert.equal(health.pre_settle_refusals, 0);
  resetReceiptFailuresForTests();
});

test('a sign or log row with phase pre_settle and no tx stays a receipt failure', () => {
  resetReceiptFailuresForTests();
  for (const stage of ['sign', 'log', 'anchor', 'confirm']) {
    recordReceiptFailure({
      stage, outcome: 'refused', reason: 'verify_failed', network: 'base',
      phase: 'pre_settle', sub_reason: 'facilitator_invalid',
    });
  }
  assert.equal(listReceiptFailures().length, 4);
  assert.equal(receiptFailureCount(), 4);
  assert.equal(preSettleRefusalCount(), 0);
  for (const row of listReceiptFailures()) assert.equal(row.preSettle, undefined);
  resetReceiptFailuresForTests();
});

test('hint caps and an empty sub detail are not returned', () => {
  const overCode = 'c'.repeat(VERIFY_HINT_CODE_MAX + 1);
  const overMessage = publicVerifyHint({ code: 'cap_probe', message: 'http://evil.example/raw' });
  const overCodeHint = publicVerifyHint({ code: overCode, message: 'http://evil.example/raw' });
  assert.deepEqual(overMessage, { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown });
  assert.deepEqual(overCodeHint, { code: 'unknown', message: VERIFY_HINT_MESSAGES.unknown });
  assert.equal(JSON.stringify(overMessage).includes('m'.repeat(20)), false);
  assert.equal(JSON.stringify(overCodeHint).includes(overCode), false);
  assert.equal(overMessage.message.length <= VERIFY_HINT_MESSAGE_MAX, true);
  assert.equal(verifyHintCode(''), null);
  assert.equal(verifyHintCode(null), null);
  resetReceiptFailuresForTests();
  recordReceiptFailure({
    stage: 'settle', outcome: 'refused', reason: 'verify_failed', network: 'base',
    phase: 'pre_settle', sub_reason: 'facilitator_invalid', subDetail: '',
  });
  assert.equal(listReceiptFailures()[0].sub_detail, undefined);
  resetReceiptFailuresForTests();
});

test('the hint allowlist ignores inherited property names', () => {
  assert.equal(publicVerifyHint({ code: 'toString', message: 'http://evil.example/toString' }), null);
  assert.equal(publicVerifyHint({ code: 'constructor', message: 'http://evil.example/constructor' }), null);
  assert.equal(publicVerifyHint({ code: '__proto__', message: 'http://evil.example/proto' }), null);
  assert.equal(verifyHint('toString').code, 'unknown');
  assert.equal(verifyHint('constructor').code, 'unknown');
});

function listenJson(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      handler(req, res, Buffer.concat(chunks).toString('utf8'));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
  }));
}

test('verify results drop an over-long or non-string invalidReason before it is stored', async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const long = `L${'x'.repeat(VERIFY_HINT_INPUT_MAX)}`;
  const hostile = { leak: 'http://evil.example/token' };
  const header = paymentHeader();
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  const challenge = {
    network: decoded.accepted.network,
    amount: decoded.accepted.amount,
    payTo: decoded.accepted.payTo,
    asset: decoded.accepted.asset,
  };
  const zan = await listenJson((_req, res) => {
    res.end(JSON.stringify({ valid: false, reason: 'mock_rejected', invalidReason: long }));
  });
  const httpError = await listenJson((_req, res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ invalidReason: long, errorMessage: hostile.leak }));
  });
  const rejected = await listenJson((_req, res) => {
    res.end(JSON.stringify({ isValid: false, invalidReason: hostile }));
  });
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'11'.repeat(32)}`;
    store.put(nonce, { network: 'base', amount: '2000', payTo: '0xtreasury' });
    const adapter = await verifyPayment('X-PAYMENT-blob', {
      provider: 'zan', gatewayUrl: zan.url, apiKey: 'k', store, nonce,
    });
    assert.equal(adapter.valid, false);
    assert.equal(adapter.invalidReason, null);
    assert.equal(JSON.stringify(adapter).includes(long), false);

    const onError = await verifyViaFacilitator(header, { gateway: httpError.url, challenge, x402Version: 2 });
    assert.equal(onError.valid, false);
    assert.equal(onError.invalidReason, null);
    assert.equal(JSON.stringify(onError).includes(long), false);
    assert.equal(JSON.stringify(onError).includes('evil.example'), false);

    const onReject = await verifyViaFacilitator(header, { gateway: rejected.url, challenge, x402Version: 2 });
    assert.equal(onReject.valid, false);
    assert.equal(onReject.invalidReason, null);
    assert.equal(JSON.stringify(onReject).includes('evil.example'), false);
  } finally {
    await zan.close();
    await httpError.close();
    await rejected.close();
    if (previousEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test('GET /health reports the live pre-settle and receipt-failure counts', async () => {
  process.env.M2M_DEMO_MODE = 'true';
  process.env.HUB_CATALOG_OFFLINE = 'true';
  process.env.X402_ENABLED = 'false';
  const { createApp } = await import('../src/server.js');
  resetReceiptFailuresForTests();
  const app = await createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await (await fetch(`${base}/health`)).json();
    recordReceiptFailure({
      stage: 'settle', outcome: 'refused', reason: 'verify_failed', network: 'solana',
      phase: 'pre_settle', sub_reason: 'facilitator_invalid',
    });
    const mid = await (await fetch(`${base}/health`)).json();
    assert.equal(mid.pre_settle_refusals, before.pre_settle_refusals + 1);
    assert.equal(mid.receipt_failures, before.receipt_failures);
    assert.equal(mid.free_tier, 'available');
    recordReceiptFailure({
      stage: 'settle', outcome: 'refused', reason: 'verify_failed', network: 'solana',
      phase: 'pre_settle', sub_reason: 'facilitator_invalid', tx: `0x${'ab'.repeat(32)}`,
    });
    const after = await (await fetch(`${base}/health`)).json();
    assert.equal(after.pre_settle_refusals, mid.pre_settle_refusals);
    assert.equal(after.receipt_failures, mid.receipt_failures + 1);
    assert.equal(after.status, before.status);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    resetReceiptFailuresForTests();
  }
});
