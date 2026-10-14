import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptCheckBody, receiptCheckView } from '../src/lib/receiptCheckCore.mjs';

test('the check request is the pasted receipt and nothing else', () => {
  const body = receiptCheckBody('{"task_id":"chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96"}');
  assert.deepEqual(Object.keys(body), ['input']);
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
});
