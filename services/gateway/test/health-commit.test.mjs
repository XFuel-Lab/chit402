/**
 * /health carries the deployed commit: the full 40-hex GATEWAY_COMMIT, or
 * null. Never an abbreviated or malformed value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { publicHealthBody } = await import('../src/public-metrics.js');
const { deployedCommit, gatewayCommit } = await import('../src/gateway-commit.js');
const feedback = await import('../src/receipt-feedback.js');

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('a full 40-hex GATEWAY_COMMIT is reported in lower case', () => {
  assert.equal(publicHealthBody({ env: { GATEWAY_COMMIT: SHA } }).commit, SHA);
  assert.equal(publicHealthBody({ env: { GATEWAY_COMMIT: ` ${SHA.toUpperCase()}\n` } }).commit, SHA);
});

test('a missing GATEWAY_COMMIT gives null', () => {
  for (const env of [{}, { GATEWAY_COMMIT: '' }, { GATEWAY_COMMIT: '   ' }, undefined]) {
    const body = publicHealthBody(env === undefined ? { env: {} } : { env });
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'commit'));
    assert.equal(body.commit, null);
  }
  assert.equal(deployedCommit(null), null);
});

test('a malformed GATEWAY_COMMIT gives null, never a partial value', () => {
  for (const value of [
    SHA.slice(0, 7),
    SHA.slice(0, 39),
    `${SHA}0`,
    `${SHA.slice(0, 39)}g`,
    `${'0'.repeat(64)}`,
    'GATEWAY_COMMIT unset',
    `${SHA} extra`,
    `${SHA}\nX-Injected: 1`,
    `v1.2.3`,
    `<script>${SHA}</script>`,
  ]) {
    assert.equal(publicHealthBody({ env: { GATEWAY_COMMIT: value } }).commit, null, JSON.stringify(value));
  }
});

test('the default reads process.env', () => {
  const previous = process.env.GATEWAY_COMMIT;
  try {
    process.env.GATEWAY_COMMIT = SHA;
    assert.equal(publicHealthBody().commit, SHA);
    process.env.GATEWAY_COMMIT = 'abc1234';
    assert.equal(publicHealthBody().commit, null);
  } finally {
    if (previous == null) delete process.env.GATEWAY_COMMIT;
    else process.env.GATEWAY_COMMIT = previous;
  }
});

test('receipt feedback keeps its commit rule (abbreviated sha accepted)', () => {
  assert.equal(feedback.gatewayCommit, gatewayCommit);
  assert.equal(feedback.GATEWAY_COMMIT_ENV, 'GATEWAY_COMMIT');
  assert.equal(gatewayCommit({ GATEWAY_COMMIT: 'ABCDEF1' }), 'abcdef1');
  assert.equal(gatewayCommit({}), 'GATEWAY_COMMIT unset');
});

test('a local /health serving the body carries commit as JSON', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(publicHealthBody({ env: { GATEWAY_COMMIT: SHA } })));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const body = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(body.commit, SHA);
    assert.equal(body.status, 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
