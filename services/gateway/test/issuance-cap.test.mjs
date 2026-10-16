/**
 * Receipt issuance cap. Off unless the hour or day env is set.
 * NODE_ENV=test. No network.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const saved = {};
for (const key of [
  'ISSUER_CAP_RECEIPTS_PER_HOUR',
  'ISSUER_CAP_RECEIPTS_PER_DAY',
  'ISSUER_CAP_SOFT_PCT',
  'ISSUER_CAP_DB',
  'ISSUER_SIGNER',
  'X402_LATE_ISSUE',
]) {
  saved[key] = process.env[key];
}

const {
  capGate,
  consumeReceiptSlot,
  readCapUsage,
  resetIssuanceCapForTests,
  capAlertsForTest,
  issuanceCapHealth,
} = await import('../src/issuance-cap.js');
const { signJwsAsync, _resetIssuerKey } = await import('../src/issuer-key.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const { runX402Handshake } = await import('../src/x402-server.js');
const { ChallengeStore } = await import('../src/x402-adapter.js');
const { setActiveChallengeStore } = await import('../src/x402-durable-store.js');
const { signJws: signHead } = await import('../src/issuer-key.js');

function restore() {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  resetIssuanceCapForTests();
  _resetIssuerKey();
  _setIssuerSignerForTest(null);
  setActiveChallengeStore(null);
}

after(restore);

function clearCap() {
  delete process.env.ISSUER_CAP_RECEIPTS_PER_HOUR;
  delete process.env.ISSUER_CAP_RECEIPTS_PER_DAY;
  delete process.env.ISSUER_CAP_SOFT_PCT;
  delete process.env.ISSUER_CAP_DB;
  delete process.env.X402_LATE_ISSUE;
  resetIssuanceCapForTests();
}

test('the cap is off by default across 10k signs', async () => {
  clearCap();
  process.env.NODE_ENV = 'test';
  for (let i = 0; i < 10000; i += 1) {
    await signJwsAsync({ n: i, kind: 'uncapped' });
  }
  const gate = capGate();
  assert.equal(gate.paused, false);
  assert.equal(gate.state, 'off');
  assert.equal(gate.hour_used, 0);
  assert.equal(issuanceCapHealth().state, 'off');
});

test('the soft gate returns 503 before the challenge and does not settle', async () => {
  clearCap();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-cap-'));
  process.env.ISSUER_CAP_DB = path.join(dir, 'cap.sqlite');
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '10';
  process.env.ISSUER_CAP_SOFT_PCT = '80';
  for (let i = 0; i < 8; i += 1) consumeReceiptSlot();
  assert.equal(capGate().paused, true);
  assert.equal(capGate().state, 'soft');
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response('no', { status: 500 });
  };
  try {
    const unpaid = await runX402Handshake({
      headers: {},
      body: { model: 'xfuel/auto' },
    }, { taskId: 'cap-soft', baseUrl: 'http://127.0.0.1', resource: 'http://127.0.0.1/v1/chat/completions' });
    assert.equal(unpaid.kind, 'issuance_paused');
    assert.equal(unpaid.status, 503);
    assert.equal(unpaid.body, undefined);
    const paid = await runX402Handshake({
      headers: { 'x-payment': Buffer.from('{}').toString('base64') },
      body: {},
    }, { taskId: 'cap-soft-paid', baseUrl: 'http://127.0.0.1', resource: 'http://127.0.0.1/v1/chat/completions' });
    assert.equal(paid.kind, 'issuance_paused');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('the hard cap throws and a late-issue row is created', async () => {
  clearCap();
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '1';
  process.env.X402_LATE_ISSUE = 'true';
  const store = new ChallengeStore();
  setActiveChallengeStore(store);
  const first = await signJwsAsync({ n: 1 }, { capKind: 'receipt', receiptId: 'rcpt-1' });
  assert.equal(typeof first.jws, 'string');
  await assert.rejects(
    async () => await signJwsAsync({ n: 2 }, { capKind: 'receipt', receiptId: 'rcpt-2' }),
    (err) => err.code === 'issuance_cap',
  );
  const rows = store.listLate();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, 'rcpt-2');
});

test('when late issue is off the hard cap logs the receipt id only', async () => {
  clearCap();
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '1';
  process.env.X402_LATE_ISSUE = 'false';
  await signJwsAsync({ n: 1 }, { capKind: 'receipt', receiptId: 'rcpt-lost' });
  await assert.rejects(
    async () => await signJwsAsync({ n: 2 }, { capKind: 'receipt', receiptId: 'rcpt-lost' }),
    (err) => err.code === 'issuance_cap',
  );
  const alerts = capAlertsForTest();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].receipt_id, 'rcpt-lost');
  assert.equal(alerts[0].alert, 'issuance_cap');
  assert.equal(Object.keys(alerts[0]).sort().join(','), 'alert,receipt_id');
});

test('heads and history are not blocked', async () => {
  clearCap();
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '1';
  await signJwsAsync({ n: 1 }, { capKind: 'receipt', receiptId: 'only-receipt' });
  const head = await signJwsAsync({ schema: 'chit402.tree_head.v2', root: 'ab' }, { typ: 'chit402-tree-head+jwt' });
  const history = signHead({ schema: 'chit402.issuer_history.v1', entry_count: 1 }, { typ: 'chit402-issuer-history+jwt' });
  assert.equal(typeof head.jws, 'string');
  assert.equal(typeof history.jws, 'string');
  await assert.rejects(
    async () => await signJwsAsync({ n: 2 }, { capKind: 'receipt', receiptId: 'blocked' }),
    (err) => err.code === 'issuance_cap',
  );
});

test('counters survive a restart and reset at the window boundary', () => {
  clearCap();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-cap-restart-'));
  process.env.ISSUER_CAP_DB = path.join(dir, 'cap.sqlite');
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '100';
  process.env.ISSUER_CAP_RECEIPTS_PER_DAY = '1000';
  const hour = 1_700_000_000_000;
  const hourStart = Math.floor(hour / 3_600_000) * 3_600_000;
  consumeReceiptSlot({ now: hourStart + 10 });
  consumeReceiptSlot({ now: hourStart + 20 });
  resetIssuanceCapForTests();
  const again = readCapUsage({ now: hourStart + 30 });
  assert.equal(again.hour_used, 2);
  assert.equal(again.day_used, 2);
  const nextHour = readCapUsage({ now: hourStart + 3_600_000 });
  assert.equal(nextHour.hour_used, 0);
  assert.equal(nextHour.day_used, 2);
  const dayStart = Math.floor(hourStart / 86_400_000) * 86_400_000;
  const nextDay = readCapUsage({ now: dayStart + 86_400_000 });
  assert.equal(nextDay.hour_used, 0);
  assert.equal(nextDay.day_used, 0);
  assert.equal(capGate({ now: dayStart + 86_400_000 }).state, 'open');
});
