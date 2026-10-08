import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertSandboxGateway, createSpendBook } from '../src/index.js';

test('production gateway hosts are refused', () => {
  assert.throws(
    () => assertSandboxGateway('https://api.chit402.com'),
    (err) => err.code === 'production_gateway',
  );
  assert.throws(
    () => assertSandboxGateway('https://api.xfuel.app', { CHIT402_SPEND_HOLD_SANDBOX: 'true' }),
    (err) => err.code === 'production_gateway',
  );
});

test('a non-local host needs the sandbox flag', () => {
  assert.throws(
    () => assertSandboxGateway('https://sandbox.example', {}),
    (err) => err.code === 'sandbox_required',
  );
  const url = assertSandboxGateway('https://sandbox.example/hold', { CHIT402_SPEND_HOLD_SANDBOX: 'true' });
  assert.equal(url.hostname, 'sandbox.example');
  assert.equal(assertSandboxGateway('http://127.0.0.1:9', {}).hostname, '127.0.0.1');
});

test('the book refuses to construct against production', () => {
  assert.throws(
    () => createSpendBook({
      gatewayUrl: 'https://api.chit402.com',
      token: 'x',
      funder: '0x1111111111111111111111111111111111111111',
    }),
    (err) => err.code === 'production_gateway',
  );
});
