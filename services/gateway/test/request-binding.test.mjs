/**
 * request_digest binds a refusal to the client request.
 * The pinned preimage and digest are what verifier PR #484 checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  claimIdempotency,
  refusalMatchesRequest,
  requestDigest,
  requestDigestCanonical,
  requestDigestPreimage,
  resetIdempotencyStore,
} from '../src/request-binding.js';
import { issueRefusalReceipt } from '../src/refusal-receipt.js';
import { jcsRfc8785 } from '../src/offer-receipt.js';

const BODY = '{"model":"xfuel/auto","messages":[{"role":"user","content":"hello"}]}';
const REQUEST = {
  method: 'POST',
  path: '/v1/chat/completions',
  body: BODY,
  idempotency_key: 'idem-1',
  nonce: null,
};
const PREIMAGE = '{"body_sha256":"93dda1aa54d9bb86b7c2cdfaad61fd78e5b81656484a8941eee498adc9a54e54","idempotency_key":"idem-1","method":"POST","nonce":null,"path":"/v1/chat/completions"}';
const DIGEST = 'a9a7ca02eb504b94c7efb7a3a5832c0fc847e37cf6930ca48db3c0b6e04498f6';

test('matching request_digest vector', () => {
  const terms = requestDigestPreimage(REQUEST);
  assert.equal(requestDigestCanonical(REQUEST), PREIMAGE);
  assert.equal(PREIMAGE, jcsRfc8785(terms));
  assert.equal(requestDigest(REQUEST), DIGEST);
  assert.equal(crypto.createHash('sha256').update(PREIMAGE, 'utf8').digest('hex'), DIGEST);
  assert.equal(terms.idempotency_key, 'idem-1');
  assert.equal(terms.nonce, null);
});

test('a tampered body changes request_digest', () => {
  const tampered = requestDigest({ ...REQUEST, body: `${BODY} ` });
  assert.notEqual(tampered, DIGEST);
  assert.equal(tampered, '58d6c3fc6c8d7c641c1a16a14ea6b5b9e7926dc5cf74e45fd717363d0506704f');
});

test('the same idempotency key with a different payload fails closed', () => {
  resetIdempotencyStore();
  assert.equal(claimIdempotency('idem-1', DIGEST).replay, false);
  assert.equal(claimIdempotency('idem-1', DIGEST).replay, true);
  assert.throws(
    () => claimIdempotency('idem-1', requestDigest({ ...REQUEST, body: `${BODY} ` })),
    (err) => err.code === 'idempotency_conflict' && /different request/.test(err.message),
  );
});

test('a missing intent_id fails closed when the request carried one', () => {
  assert.throws(() => issueRefusalReceipt({
    policy_code: 'policy_blocked',
    reason: 'cap',
    agent_id: 4,
    task_id: 'xfuel-missing-intent',
    collected_at: '2026-09-26T17:27:32Z',
    seq: 1,
    prev_hash: null,
    row_hash: 'cd'.repeat(32),
    anchor: { status: 'UNAVAILABLE', reason: 'no_observation' },
    intent_supplied: true,
    intent_id: null,
    request: REQUEST,
  }), (err) => err.code === 'intent_id_required');
});

test('replaying a refusal against a different request does not match', () => {
  resetIdempotencyStore();
  const stored = { request_digest: DIGEST };
  claimIdempotency('idem-replay', DIGEST);
  const other = { ...REQUEST, idempotency_key: 'idem-replay', body: '{"model":"other"}' };
  assert.equal(refusalMatchesRequest(stored, REQUEST), true);
  assert.equal(refusalMatchesRequest(stored, other), false);
  assert.throws(
    () => claimIdempotency('idem-replay', requestDigest(other)),
    (err) => err.code === 'idempotency_conflict',
  );
});
