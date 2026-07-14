import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XFuelApiError } from 'xfuel-sdk';
import { ok, fail, describeError, CHARACTER_LIMIT } from '../format.js';

test('ok() returns a text block and structured payload', () => {
  const result = ok({ task_id: 't1', status: 'completed' }, 'done');
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /^done\n\n/);
  assert.match(result.content[0].text, /"task_id": "t1"/);
  assert.deepEqual(result.structuredContent, { task_id: 't1', status: 'completed' });
});

test('ok() without a summary just serializes JSON', () => {
  const result = ok({ a: 1 });
  assert.equal(result.content[0].text, JSON.stringify({ a: 1 }, null, 2));
});

test('ok() truncates payloads that exceed the character limit', () => {
  const big = { blob: 'x'.repeat(CHARACTER_LIMIT + 500) };
  const result = ok(big);
  assert.ok(result.content[0].text.includes('… (truncated)'));
  // Structured payload is preserved in full even when the text is truncated.
  assert.equal((result.structuredContent as { blob: string }).blob.length, CHARACTER_LIMIT + 500);
});

test('fail() flags an error result with an actionable message', () => {
  const result = fail('boom');
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'Error: boom');
  assert.equal(result.structuredContent, undefined);
});

test('describeError maps a 401 to an API-key hint', () => {
  const err = new XFuelApiError('unauthorized', 401, 'unauthorized');
  const msg = describeError(err);
  assert.match(msg, /401/);
  assert.match(msg, /XFUEL_API_KEY/);
});

test('describeError maps a 429 to a rate-limit hint', () => {
  const err = new XFuelApiError('slow down', 429, 'rate_limit_exceeded');
  assert.match(describeError(err), /rate limited/);
});

test('describeError maps a 404 to a not-found hint', () => {
  const err = new XFuelApiError('nope', 404, 'not_found');
  assert.match(describeError(err), /not found/);
});

test('describeError includes API error details when present', () => {
  const err = new XFuelApiError('bad request', 400, 'validation_error', ['amount is required']);
  const msg = describeError(err);
  assert.match(msg, /amount is required/);
  assert.match(msg, /invalid request/);
});

test('describeError maps a transport failure (status 0 / network_error) to a connectivity hint', () => {
  const err = new XFuelApiError('connect ECONNREFUSED', 0, 'network_error');
  const msg = describeError(err);
  assert.match(msg, /could not reach the XFuel API/);
  assert.match(msg, /XFUEL_API_URL/);
});

test('describeError maps a polling timeout to a retry hint', () => {
  const err = new XFuelApiError('did not complete', 0, 'polling_timeout');
  assert.match(describeError(err), /has not settled yet/);
});

test('describeError maps a 402 / payment_rejected to a payment hint', () => {
  assert.match(describeError(new XFuelApiError('paid?', 402, 'payment_required')), /payment was rejected/);
  assert.match(describeError(new XFuelApiError('nope', 0, 'payment_rejected')), /payment was rejected/);
});

test('describeError maps a 5xx to a retry hint', () => {
  const err = new XFuelApiError('boom', 503, 'internal');
  assert.match(describeError(err), /server error/);
});

test('describeError handles plain Errors and non-Error values', () => {
  assert.equal(describeError(new Error('plain')), 'plain');
  assert.equal(describeError('just a string'), 'just a string');
});
