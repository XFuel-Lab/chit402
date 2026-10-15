import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptUrlAllowed } from '../../../packages/verify/dist/check-input.js';
import { createReceiptCheckLimiter } from '../src/receipt-check.js';

test('public receipt URL: https trusted host only, no loopback or userinfo', () => {
  assert.equal(receiptUrlAllowed('https://api.chit402.com/receipt/x'), true);
  for (const u of ['http://127.0.0.1:9999/x', 'http://localhost/x', 'http://2130706433/x',
    'http://0x7f000001/x', 'http://[::1]/x', 'http://169.254.169.254/', 'https://169.254.169.254/',
    'https://api.chit402.com.evil.example/x', 'https://u:p@api.chit402.com/x', 'file:///etc/passwd']) {
    assert.equal(receiptUrlAllowed(u), false, u);
  }
});

test('limiter key map is bounded and sweeps idle keys', () => {
  const l = createReceiptCheckLimiter(1000, 2, 100);
  for (let i = 0; i < 100; i++) assert.equal(l.allow(`ip${i}`, 0), true);
  assert.equal(l.allow('new', 0), false);
  assert.equal(l.allow('new', 2000), true);
  assert.ok(l.size <= 100);
});
