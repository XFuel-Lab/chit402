/**
 * Payload version 12 asks for the chain-head pin. Issuance stays at 10,
 * which still pins the document hash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.NODE_ENV = 'test';
process.env.ISSUER_KEY_NOT_BEFORE = '2020-01-01T00:00:00.000Z';

const {
  currentHistoryPin,
  HISTORY_HEAD_PAYLOAD_VERSION,
  issuerKeyWindow,
  resetIssuerHistoryStore,
} = await import('../src/issuer-history.js');
const { RECEIPT_PAYLOAD_VERSION, activeReceiptPayloadVersion } = await import('../src/receipt.js');

test('payload version 12 pins the chain head and issuance stays at 10', () => {
  resetIssuerHistoryStore();
  const head = currentHistoryPin(HISTORY_HEAD_PAYLOAD_VERSION);
  assert.equal(HISTORY_HEAD_PAYLOAD_VERSION, 12);
  assert.deepEqual(Object.keys(head).sort(), ['entry_count', 'head_hash']);
  assert.equal(typeof head.head_hash, 'string');
  assert.equal(head.head_hash.length, 64);
  assert.equal(head.entry_count >= 1, true);
  const issued = currentHistoryPin(10);
  assert.equal(typeof issued.hash, 'string');
  assert.equal(Object.hasOwn(issued, 'head_hash'), false);
  assert.equal(currentHistoryPin().hash, issued.hash);
  assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
  assert.equal(activeReceiptPayloadVersion(), 10);
  resetIssuerHistoryStore();
});

test('the last issuer-history entry for a kid is the window', () => {
  const kid = 'kid-window';
  const first = {
    kid,
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
  };
  const retired = issuerKeyWindow({
    entries: [first, {
      kid,
      not_before: '2026-05-01T00:00:00.000Z',
      not_after: '2026-06-01T00:00:00.000Z',
      status: 'retired',
      revoked_at: null,
    }],
  }, kid, '2026-07-01T00:00:00.000Z');
  assert.equal(retired.ok, false);
  assert.equal(retired.reason, 'issued_after_not_after');

  const revokedEntries = [first, {
    kid,
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: null,
    status: 'revoked',
    revoked_at: '2026-06-01T00:00:00.000Z',
  }];
  const late = issuerKeyWindow({ entries: revokedEntries }, kid, '2026-09-01T00:00:00.000Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow({ entries: revokedEntries }, kid, '2026-03-01T00:00:00.000Z');
  assert.equal(early.ok, true, early.reason);
});
