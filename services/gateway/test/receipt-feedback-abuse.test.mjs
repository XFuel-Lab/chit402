import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackIssue, prepareFeedback } from '../src/receipt-feedback.js';

test('feedback text cannot mention, link, embed or break the fence', () => {
  const p = prepareFeedback({ expected: 'other', intent: 'hi @octocat #12 ![x](//e.example/p.png) <img>', note: 'me@x.com https://e.example', attach_receipt: true, receipt: 'a\n~~~~\n@octocat' }, { buildDigest: 'd', verifierVersion: 'v', gatewayCommit: 'c', timestamp: 't' });
  assert.equal(p.ok, true);
  const { body } = buildFeedbackIssue(p.record);
  const outside = body.replace(/^~~~~text\n[\s\S]*?\n~~~~$/m, '');
  assert.doesNotMatch(outside, /@octocat/);
  assert.doesNotMatch(outside, /#12/);
  assert.doesNotMatch(outside, /!\[|<img|https:\/\/e\.example|me@/);
  assert.equal((body.match(/^~~~~/gm) || []).length, 2);
});
