import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptUrlFor, verifyUrlOf, withReceiptFields } from '../receipt-fields.js';

test('verifyUrlOf prefers top-level verify_url', () => {
  assert.equal(
    verifyUrlOf({ verify_url: 'https://api.chit402.com/receipt/t1' }, 'https://api.chit402.com'),
    'https://api.chit402.com/receipt/t1',
  );
});

test('verifyUrlOf falls back to xfuel.verify_url then constructs from task_id', () => {
  assert.equal(
    verifyUrlOf({ xfuel: { verify_url: 'https://x/r/t2' } }, 'https://api.chit402.com'),
    'https://x/r/t2',
  );
  assert.equal(
    verifyUrlOf({ task_id: 't3' }, 'https://api.chit402.com/'),
    'https://api.chit402.com/receipt/t3',
  );
});

test('withReceiptFields promotes nested xfuel fields to the top level', () => {
  const out = withReceiptFields(
    {
      model: 'xfuel/auto',
      xfuel: { task_id: 'openai-abc', verify_url: 'https://api.chit402.com/receipt/openai-abc' },
    },
    'https://api.chit402.com',
  );
  assert.equal(out.task_id, 'openai-abc');
  assert.equal(out.verify_url, 'https://api.chit402.com/receipt/openai-abc');
  assert.deepEqual(out.xfuel, { task_id: 'openai-abc', verify_url: 'https://api.chit402.com/receipt/openai-abc' });
});

test('receiptUrlFor strips trailing slash on api base', () => {
  assert.equal(receiptUrlFor('https://api.chit402.com/', 'task-1'), 'https://api.chit402.com/receipt/task-1');
});
