import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertStuckPayment,
  flushStuckPaymentAlert,
  resetStuckPaymentAlertsForTests,
} from '../src/stuck-payment-alert.js';
import { ChallengeStore } from '../src/x402-adapter.js';

test('a stuck payment logs tx, network, amount, and reason, and posts without logging the webhook url', async () => {
  resetStuckPaymentAlertsForTests();
  const lines = [];
  const posts = [];
  const secretUrl = 'http://alerts.invalid/hook/not-a-real-secret-path';
  const logger = {
    error(obj, msg) { lines.push({ obj, msg }); },
  };
  await alertStuckPayment({
    tx: '0x' + 'ab'.repeat(32),
    network: 'base',
    amount: '2000',
    reason: 'settle_unconfirmed',
    payer: '0x5555555555555555555555555555555555555555',
  }, {
    logger,
    webhookUrl: secretUrl,
    fetch: async (url, init) => {
      posts.push({ url, body: init.body });
      return { ok: true };
    },
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, secretUrl);
  const posted = JSON.parse(posts[0].body);
  assert.deepEqual(Object.keys(posted).sort(), ['amount', 'network', 'reason', 'tx']);
  assert.equal(posted.amount, '2000');
  assert.equal(posted.reason, 'settle_unconfirmed');
  const logged = JSON.stringify(lines);
  assert.equal(logged.includes(secretUrl), false);
  assert.equal(logged.includes('ALERT_WEBHOOK_URL'), true);
  assert.equal(logged.includes('0x5555'), false);
});

test('pending alerts stay at one a minute and the rest are a summary count', async () => {
  resetStuckPaymentAlertsForTests();
  const lines = [];
  const posts = [];
  let now = 1_700_000_000_000;
  const logger = { error(obj, msg) { lines.push({ obj, msg }); } };
  const deps = {
    logger,
    webhookUrl: 'http://alerts.invalid/hook',
    now: () => now,
    fetch: async (_url, init) => {
      posts.push(JSON.parse(init.body));
      return { ok: true };
    },
  };
  await alertStuckPayment({ tx: '0xaaa', network: 'base', amount: '1', reason: 'settle_unconfirmed' }, deps);
  await alertStuckPayment({ tx: '0xbbb', network: 'base', amount: '2', reason: 'settle_unconfirmed' }, deps);
  await alertStuckPayment({ tx: '0xccc', network: 'base', amount: '3', reason: 'settle_unconfirmed' }, deps);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].obj.count, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].tx, '0xaaa');
  await flushStuckPaymentAlert(deps);
  assert.equal(posts.length, 1);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].obj.count, 2);
  assert.equal(lines[1].obj.summary, true);
  assert.equal(lines[1].msg, 'stuck payment summary');
  now += 60_000;
  await alertStuckPayment({ tx: '0xddd', network: 'base', amount: '4', reason: 'settle_unconfirmed' }, deps);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].obj.count, 1);
  assert.equal(posts.length, 2);
  resetStuckPaymentAlertsForTests();
});

test('recordPending emits one alert and does not call a webhook when the env is unset', async () => {
  resetStuckPaymentAlertsForTests();
  const saved = process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_WEBHOOK_URL;
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true }; };
  try {
    const store = new ChallengeStore();
    const row = await store.recordPending({
      tx: '0x' + 'cd'.repeat(32),
      network: 'base',
      amount: '2000',
      reason: 'settle_unconfirmed',
      why: 'awaiting_finality',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(row.status, 'pending');
    assert.equal(calls, 0);
    assert.equal(store.listPending().length, 1);
  } finally {
    globalThis.fetch = previous;
    if (saved == null) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = saved;
  }
});
