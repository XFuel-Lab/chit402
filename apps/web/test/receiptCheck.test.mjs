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
