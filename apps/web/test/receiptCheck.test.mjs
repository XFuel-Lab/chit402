import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receiptCheckBody, receiptCheckView, receiptFeedbackBody } from '../src/lib/receiptCheckCore.mjs';

const MARKER = 'paste-marker-9f3c2a-do-not-store';

test('the check request is the pasted receipt and the web client', () => {
  const body = receiptCheckBody('{"task_id":"xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944"}');
  assert.deepEqual(Object.keys(body).sort(), ['client', 'input']);
  assert.equal(body.client, 'web');
  assert.equal(body.wallet, undefined);
  assert.equal(body.address, undefined);
});

test('a verified payload keeps the verifier lines', () => {
  const view = receiptCheckView(200, {
    overall: 'VERIFIED',
    lines: ['VERIFIED', 'Every check passed.'],
  });
  assert.equal(view.overall, 'VERIFIED');
  assert.deepEqual(view.lines, ['VERIFIED', 'Every check passed.']);
  assert.equal(view.error, null);
  assert.equal(view.hint, null);
});

test('400 and 413 are an input error, not INVALID', () => {
  const bad = receiptCheckView(400, {
    error: 'receipt_required',
    message: 'Paste a receipt, a receipt id, or a receipt URL.',
  });
  assert.equal(bad.kind, 'input-error');
  assert.equal(bad.overall, 'INPUT_ERROR');
  assert.equal(bad.lines[0], "Couldn't read that input.");
  assert.match(bad.lines[1], /Paste a receipt/);
  assert.equal(/INVALID/.test(bad.lines.join('\n')), false);

  const parsed = receiptCheckView(400, { error: 'invalid_json', message: 'Receipt JSON did not parse.' });
  assert.equal(parsed.kind, 'input-error');
  assert.equal(/INVALID/.test(parsed.lines.join('\n')), false);

  const large = receiptCheckView(413, { error: 'payload_too_large', message: 'Receipt input is too large.' });
  assert.equal(large.kind, 'input-error');
  assert.equal(large.lines[0], "Couldn't read that input.");
  assert.match(large.lines.join('\n'), /too large/);
  assert.equal(/INVALID/.test(large.lines.join('\n')), false);
  assert.equal(large.overall === 'INVALID', false);
  assert.deepEqual(bad.accepted, ['receipt JSON', 'a chit- id', 'a verify link']);
  assert.equal(bad.example, 'xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944');
  assert.equal(bad.hint, 'Paste receipt JSON, a chit- or xfuel- id, or a verify link.');
  assert.equal(bad.lines.includes(bad.hint), false);
});

test('a server-sent example replaces the local fallback', () => {
  const sent = 'xfuel-sent-by-the-check-server';
  const view = receiptCheckView(400, {
    error: 'receipt_required',
    message: 'Paste a receipt, a receipt id, or a receipt URL.',
    example: sent,
  });
  assert.equal(view.kind, 'input-error');
  assert.equal(view.example, sent);
});

test('invalid and could-not-check keep the same headlines', () => {
  const invalid = receiptCheckView(200, {
    overall: 'INVALID',
    lines: ['INVALID', 'The receipt does not match what the issuer signed.'],
  });
  assert.equal(invalid.overall, 'INVALID');
  const missed = receiptCheckView(200, {
    overall: 'COULD_NOT_CHECK',
    lines: ['COULD_NOT_CHECK', 'The receipt could not be fetched.', 'The receipt could not be checked.'],
  });
  assert.equal(missed.overall, 'COULD_NOT_CHECK');
  assert.equal(missed.lines[1], 'The receipt could not be fetched.');
  assert.equal(invalid.hint, 'Paste the signed receipt from the owner view and check it again.');
});

test('a server hint is shown once, and feedback stays off until the server says so', () => {
  const hint = 'Pass the signed receipt from the owner view.';
  const view = receiptCheckView(200, {
    overall: 'INVALID',
    lines: ['INVALID', 'This document is the public shell. The signed receipt is on the owner view.', hint],
    hint,
    feedback_enabled: false,
    request_id: 'chk_abc',
  });
  assert.equal(view.hint, hint);
  assert.equal(view.lines.includes(hint), false);
  assert.equal(view.feedbackEnabled, false);
  assert.equal(view.requestId, 'chk_abc');
});

test('feedback omits the receipt unless the caller opts in', () => {
  const view = receiptCheckView(200, {
    overall: 'INVALID',
    lines: ['INVALID', 'The receipt does not match what the issuer signed.'],
    hint: 'Paste the signed receipt from the owner view and check it again.',
    feedback_enabled: true,
    request_id: 'chk_abc',
    report: {
      result_code: 'INVALID',
      reason: 'signature_invalid',
      checks: { signature: 'fail' },
      input_kind: 'json',
      input_bytes: 42,
      client: 'web',
    },
  });
  const hidden = receiptFeedbackBody({
    view,
    expected: 'verified',
    intent: 'check a paste',
    note: 'see owner@example.com',
    attach: false,
    receipt: MARKER,
    contact: 'owner@example.com',
  });
  assert.equal(hidden.attach_receipt, false);
  assert.equal(hidden.receipt, undefined);
  assert.equal(hidden.contact, undefined);
  assert.equal(JSON.stringify(hidden).includes(MARKER), false);
  assert.equal(hidden.client, 'web');
  assert.equal(hidden.request_id, 'chk_abc');
  assert.equal(hidden.reason, 'signature_invalid');

  const shown = receiptFeedbackBody({
    view,
    expected: 'invalid',
    intent: 'check a paste',
    note: '',
    attach: true,
    receipt: MARKER,
  });
  assert.equal(shown.attach_receipt, true);
  assert.equal(shown.receipt, MARKER);
});

test('the feedback box is opt-in and does not collect a contact address', () => {
  const src = readFileSync(new URL('../src/pages/ReceiptCheck.tsx', import.meta.url), 'utf8');
  assert.match(src, /Something wrong\? Tell us/);
  assert.match(src, /What did you expect\?/);
  assert.match(src, /What were you trying to do\?/);
  assert.match(src, /Attach the receipt I pasted so the team can reproduce it/);
  assert.match(src, /Notes are posted publicly as GitHub issues\. Don't include private info\./);
  assert.equal(src.includes('defaultChecked'), false);
  assert.equal(src.includes('type="email"'), false);
  assert.equal(src.includes('contact'), false);
});

test('issuer history docs use the CLI exit', () => {
  const src = readFileSync(new URL('../src/pages/VerifyDocs.tsx', import.meta.url), 'utf8');
  assert.match(src, /id: 'issuer_history_unavailable'[\s\S]{0,160}Exit 1, matching the CLI/);
});
