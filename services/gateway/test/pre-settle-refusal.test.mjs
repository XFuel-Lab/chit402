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
import { publicHealthBody } from '../src/public-metrics.js';
import { paymentFailureBody } from '../src/x402-flags.js';
import { openAiFailurePayload } from '../src/openai-gateway.js';
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
} from '../src/verify-hint.js';
import { SCENARIOS, attempt } from './fixtures/refusal-scenarios.mjs';

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
  assert.match(SERVER_SRC, /receiptFailures: receiptFailureCount\(\)/);
  assert.match(SERVER_SRC, /preSettleRefusals: preSettleRefusalCount\(\)/);
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
  assert.equal(withTx.preSettle, true);
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
    assert.equal(receiptFailureCount(), 1);
    assert.equal(preSettleRefusalCount(), 1);
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
