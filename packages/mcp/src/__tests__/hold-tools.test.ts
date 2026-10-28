import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeBoard } from '../board.js';
import { registerToolResult } from '../tools.js';
import { describeHold } from '../format.js';

const pending = {
  error: 'settle_pending',
  code: 'settle_pending',
  pending_id: 'ab'.repeat(16),
  verify_url: '/receipt/late-' + 'ab'.repeat(16),
};
const owed = {
  error: 'stamp_underpaid',
  code: 'stamp_underpaid',
  pending_id: 'cd'.repeat(16),
  verify_url: '/receipt/late-' + 'cd'.repeat(16),
  status: 'refund_owed',
};

test('describeHold names the handles and does not say rejected', () => {
  const pendingText = describeHold(pending) || '';
  const owedText = describeHold(owed) || '';
  assert.match(pendingText, /Do not pay again/);
  assert.match(pendingText, /(?:ab){16}/);
  assert.match(owedText, /Refund owed/);
  assert.doesNotMatch(pendingText, /rejected/i);
  assert.doesNotMatch(owedText, /wallet balance/i);
  assert.equal(describeHold({ message: 'Do not pay again.' }), 'Do not pay again.');
});

test('writeBoard returns a hold as an error, not ok', async () => {
  const original = globalThis.fetch;
  const config = { apiUrl: 'http://127.0.0.1:9', apiKey: undefined, transport: 'stdio' } as never;
  try {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 202,
      text: async () => JSON.stringify(pending),
    })) as typeof fetch;
    const held = await writeBoard(config, '/v1/board/posts', {}, 'create_board_post');
    assert.equal(held.isError, true);
    assert.match(held.content[0].text, /Do not pay again/);
    assert.match(held.content[0].text, /pending_id/);
    assert.doesNotMatch(held.content[0].text, /create_board_post ok/);

    globalThis.fetch = (async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify(owed),
    })) as typeof fetch;
    const refund = await writeBoard(config, '/v1/board/jobs/job_1/pay', {}, 'pay_board_job');
    assert.equal(refund.isError, true);
    assert.match(refund.content[0].text, /Refund owed/);
    assert.match(refund.content[0].text, /(?:cd){16}/);
    assert.doesNotMatch(refund.content[0].text, /HTTP 409/);
  } finally {
    globalThis.fetch = original;
  }
});

test('registerToolResult does not claim a registration for a hold', () => {
  const created = registerToolResult(202, true, pending);
  assert.equal(created.isError, true);
  assert.match(created.content[0].text, /pending_id/);
  assert.doesNotMatch(created.content[0].text, /Registered/);
  const refund = registerToolResult(409, false, owed);
  assert.equal(refund.isError, true);
  assert.match(refund.content[0].text, /Refund owed/);
  assert.match(refund.content[0].text, /verify_url/);
});
