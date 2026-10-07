/**
 * Hold-then-settle for the prepaid ceiling.
 *
 * The lock is the thing under test: each successful reserve yields inside the
 * critical section. Without the lock, the parallel calls would all pass the
 * check and all commit. Paths stay on node:path so Windows CI can run this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CEILING_EXCEEDED,
  SpendHoldStore,
  ceilingErrorBody,
  ceilingLegsFromContext,
  reservationAmount,
  spendHoldEnabled,
  spendHoldTtlMs,
  DEFAULT_HOLD_TTL_MS,
} from '../src/spend-hold.js';
import { capViewOf } from '../src/agent-book.js';

function yieldTurn() {
  return new Promise((resolve) => { setImmediate(resolve); });
}

function agentLeg(cap, spent = 0n) {
  return {
    scope: 'agent',
    key: '7',
    cap,
    settled: () => spent,
  };
}

test('flag defaults off and the TTL has a positive default', () => {
  assert.equal(spendHoldEnabled({}), false);
  assert.equal(spendHoldEnabled({ SPEND_HOLD_ENABLED: 'false' }), false);
  assert.equal(spendHoldEnabled({ SPEND_HOLD_ENABLED: 'true' }), true);
  assert.equal(spendHoldTtlMs({}), DEFAULT_HOLD_TTL_MS);
  assert.equal(DEFAULT_HOLD_TTL_MS, 10 * 60 * 1000);
  assert.equal(spendHoldTtlMs({ SPEND_HOLD_TTL_MS: '45000' }), 45000);
  assert.equal(spendHoldTtlMs({ SPEND_HOLD_TTL_MS: '0' }), DEFAULT_HOLD_TTL_MS);
});

test('worst-case reservation is the quote, raised to the hop floor', () => {
  assert.equal(reservationAmount(8000n, 2000n), 8000n);
  assert.equal(reservationAmount('500', '2000'), 2000n);
  assert.equal(reservationAmount(null, '2000'), 2000n);
  assert.equal(reservationAmount('nope', '2000'), 2000n);
  assert.equal(reservationAmount(0, 2000), 2000n);
});

test('cap view counts open holds and omits the field when nothing is held', () => {
  const open = capViewOf({ budget: '10000' }, 2000n, 3000n);
  assert.equal(open.spent, '2000');
  assert.equal(open.held, '3000');
  assert.equal(open.remaining, '5000');
  const plain = capViewOf({ budget: '10000' }, 2000n);
  assert.equal(plain.remaining, '8000');
  assert.equal(Object.hasOwn(plain, 'held'), false);
  const unlimited = capViewOf({ budget: null }, 2000n, 0n);
  assert.equal(unlimited.remaining, null);
  assert.equal(Object.hasOwn(unlimited, 'held'), false);
});

test('N parallel reserves cannot exceed the ceiling', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  store.testYield = yieldTurn;
  const amount = 3000n;
  const cap = 10000n;
  const n = 8;
  const results = await Promise.all(Array.from({ length: n }, (_, i) => store.reserve({
    requestId: `call-${i}`,
    amount,
    ceilings: [agentLeg(cap)],
    now: 1_000,
  })));

  const ok = results.filter((row) => row.ok);
  const denied = results.filter((row) => !row.ok);
  assert.equal(ok.length, 3);
  assert.equal(denied.length, 5);
  assert.equal(store.openReserved('agent', '7', 1_000), 9000n);
  for (const row of denied) {
    assert.equal(row.code, CEILING_EXCEEDED);
    assert.equal(row.remaining, '1000');
    assert.equal(row.requested, '3000');
    assert.equal(row.ceiling, 'agent');
    assert.equal(row.spent, '0');
    assert.equal(row.held, '9000');
    assert.equal(typeof row.remaining, 'string');
    assert.equal(typeof row.requested, 'string');
  }
  const body = ceilingErrorBody(denied[0], { agent_id: 7 });
  assert.equal(body.error.type, 'ceiling_exceeded');
  assert.equal(body.error.code, 'CEILING_EXCEEDED');
  assert.equal(body.error.remaining, '1000');
  assert.equal(body.error.requested, '3000');
  assert.equal(body.error.agent_id, 7);
  assert.equal(body.error.ceiling, 'agent');
});

test('parallel retries of one request id reserve once', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  store.testYield = yieldTurn;
  const results = await Promise.all(Array.from({ length: 6 }, () => store.reserve({
    requestId: 'same-call',
    amount: 4000n,
    ceilings: [agentLeg(10000n)],
    now: 50,
  })));
  assert.equal(results.every((row) => row.ok), true);
  const ids = new Set(results.map((row) => row.hold.id));
  assert.equal(ids.size, 1);
  assert.equal(store.openReserved('agent', '7', 50), 4000n);
  const replay = results.filter((row) => row.idempotent);
  assert.equal(replay.length, 5);
});

test('release on failure returns the capacity', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const first = await store.reserve({
    requestId: 'will-fail',
    amount: 8000n,
    ceilings: [agentLeg(10000n)],
    now: 10,
  });
  assert.equal(first.ok, true);
  const released = await store.release('will-fail', 11);
  assert.equal(released.ok, true);
  assert.equal(released.hold.state, 'released');
  assert.equal(store.openReserved('agent', '7', 11), 0n);
  const again = await store.release('will-fail', 12);
  assert.equal(again.idempotent, true);
  const next = await store.reserve({
    requestId: 'after-failure',
    amount: 10000n,
    ceilings: [agentLeg(10000n)],
    now: 13,
  });
  assert.equal(next.ok, true);
  assert.equal(store.openReserved('agent', '7', 13), 10000n);
});

test('TTL expiry frees a hold whose request never returned', async () => {
  const ttlMs = 1_000;
  const store = new SpendHoldStore({ ttlMs });
  const held = await store.reserve({
    requestId: 'crashed',
    amount: 7000n,
    ceilings: [agentLeg(7000n)],
    now: 0,
  });
  assert.equal(held.ok, true);
  assert.equal(store.openReserved('agent', '7', 999), 7000n);
  const blocked = await store.reserve({
    requestId: 'while-open',
    amount: 1n,
    ceilings: [agentLeg(7000n)],
    now: 999,
  });
  assert.equal(blocked.code, CEILING_EXCEEDED);

  await store.expireDue(ttlMs);
  assert.equal(store.openReserved('agent', '7', ttlMs), 0n);
  const after = await store.reserve({
    requestId: 'crashed',
    amount: 7000n,
    ceilings: [agentLeg(7000n)],
    now: ttlMs,
  });
  assert.equal(after.ok, true);
  assert.equal(after.idempotent, false);
  assert.notEqual(after.hold.id, held.hold.id);
  assert.equal(after.hold.state, 'open');
});

test('idempotent retry while open does not reserve twice', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const first = await store.reserve({
    requestId: 'retry-me',
    amount: 2500n,
    ceilings: [agentLeg(5000n)],
    now: 1,
  });
  const second = await store.reserve({
    requestId: 'retry-me',
    amount: 2500n,
    ceilings: [agentLeg(5000n)],
    now: 2,
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.hold.id, first.hold.id);
  assert.equal(store.openReserved('agent', '7', 2), 2500n);
  const room = await store.reserve({
    requestId: 'other',
    amount: 2500n,
    ceilings: [agentLeg(5000n)],
    now: 3,
  });
  assert.equal(room.ok, true);
});

test('consume settles the actual cost and releases the difference', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const session = { scope: 'session', key: '0xABC', cap: 10000n };
  const reserved = await store.reserve({
    requestId: 'metered',
    amount: 8000n,
    ceilings: [session],
    now: 20,
  });
  assert.equal(reserved.ok, true);
  const consumed = await store.consume('metered', 3000n, 21);
  assert.equal(consumed.ok, true);
  assert.equal(consumed.released, '5000');
  assert.equal(consumed.hold.state, 'consumed');
  assert.equal(consumed.hold.consumed_amount, '3000');
  assert.equal(store.openReserved('session', '0xabc', 21), 0n);

  const replay = await store.consume('metered', 3000n, 22);
  assert.equal(replay.idempotent, true);
  assert.equal(store.openReserved('session', '0xabc', 22), 0n);

  const fits = await store.reserve({
    requestId: 'next',
    amount: 7000n,
    ceilings: [session],
    now: 23,
  });
  assert.equal(fits.ok, true);
  const over = await store.reserve({
    requestId: 'over',
    amount: 1n,
    ceilings: [session],
    now: 24,
  });
  assert.equal(over.code, CEILING_EXCEEDED);
  assert.equal(over.remaining, '0');
  assert.equal(over.requested, '1');
  assert.equal(over.ceiling, 'session');
  assert.equal(over.spent, '3000');
  assert.equal(over.held, '7000');
  const body = ceilingErrorBody(over);
  assert.equal(body.error.code, 'CEILING_EXCEEDED');
  assert.equal(body.error.delegation_hash, '0xabc');
  assert.equal(body.error.remaining, '0');
  assert.equal(body.error.requested, '1');
});

test('agent ceiling uses settled spend plus open holds, not consumed holds', async () => {
  let settled = 0n;
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const leg = () => ({
    scope: 'agent',
    key: '7',
    cap: 10000n,
    settled: () => settled,
  });
  const reserved = await store.reserve({
    requestId: 'paid',
    amount: 8000n,
    ceilings: [leg()],
    now: 1,
  });
  assert.equal(reserved.ok, true);
  settled = 5000n;
  await store.consume('paid', 5000n, 2);
  assert.equal(store.openReserved('agent', '7', 2), 0n);
  const next = await store.reserve({
    requestId: 'sibling',
    amount: 5000n,
    ceilings: [leg()],
    now: 3,
  });
  assert.equal(next.ok, true);
  const over = await store.reserve({
    requestId: 'too-much',
    amount: 1n,
    ceilings: [leg()],
    now: 4,
  });
  assert.equal(over.ok, false);
  assert.equal(over.spent, '5000');
  assert.equal(over.held, '5000');
  assert.equal(over.remaining, '0');
});

test('a reservation that fails one ceiling does not hold the other', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const legs = ceilingLegsFromContext({
    agentId: 7,
    budget: '100000',
    settledByAgent: () => 0n,
    session: { delegation_hash: '0xAbC', max_cumulative_spend: '5000' },
  });
  assert.equal(legs.length, 2);
  assert.equal(legs[1].key, '0xabc');
  const denied = await store.reserve({
    requestId: 'both',
    amount: 6000n,
    ceilings: legs,
    now: 1,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, CEILING_EXCEEDED);
  assert.equal(denied.ceiling, 'session');
  assert.equal(denied.remaining, '5000');
  assert.equal(denied.requested, '6000');
  assert.equal(store.openReserved('agent', '7', 1), 0n);
  assert.equal(store.openReserved('session', '0xabc', 1), 0n);
});

test('max-cumulative-spend is enforced through the same reserve path', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const legs = ceilingLegsFromContext({
    session: { delegation_hash: '0xDead', max_cumulative_spend: '4000' },
  });
  const first = await store.reserve({
    requestId: 's1',
    amount: 2500n,
    ceilings: legs,
    now: 1,
  });
  assert.equal(first.ok, true);
  await store.consume('s1', 2500n, 2);
  const second = await store.reserve({
    requestId: 's2',
    amount: 2000n,
    ceilings: legs,
    now: 3,
  });
  assert.equal(second.code, CEILING_EXCEEDED);
  assert.equal(second.ceiling, 'session');
  assert.equal(second.spent, '2500');
  assert.equal(second.remaining, '1500');
  assert.equal(second.requested, '2000');
  const exact = await store.reserve({
    requestId: 's3',
    amount: 1500n,
    ceilings: legs,
    now: 4,
  });
  assert.equal(exact.ok, true);
});

test('an unreadable or empty budget is not a ceiling', () => {
  assert.deepEqual(ceilingLegsFromContext({ agentId: 7, budget: null }), []);
  assert.deepEqual(ceilingLegsFromContext({ agentId: 7, budget: '' }), []);
  assert.deepEqual(ceilingLegsFromContext({
    session: { delegation_hash: '0x1', max_cumulative_spend: null },
  }), []);
});

test('holds reload from disk and survive a replace on the same path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-hold-'));
  try {
    const store = new SpendHoldStore({ dir, persist: true, ttlMs: 60_000 });
    const reserved = await store.reserve({
      requestId: 'disk',
      amount: 4000n,
      ceilings: [{ scope: 'session', key: '0xDisk', cap: 9000n }],
      now: 10,
    });
    assert.equal(reserved.ok, true);
    await store.consume('disk', 1500n, 11);
    const reloaded = new SpendHoldStore({ dir, persist: true, ttlMs: 60_000 });
    const next = await reloaded.reserve({
      requestId: 'disk-2',
      amount: 7500n,
      ceilings: [{ scope: 'session', key: '0xDisk', cap: 9000n }],
      now: 12,
    });
    assert.equal(next.ok, true);
    const over = await reloaded.reserve({
      requestId: 'disk-3',
      amount: 1n,
      ceilings: [{ scope: 'session', key: '0xdisk', cap: 9000n }],
      now: 13,
    });
    assert.equal(over.code, CEILING_EXCEEDED);
    assert.equal(over.spent, '1500');
    assert.equal(over.held, '7500');
    assert.equal(fs.existsSync(path.join(dir, 'spend-holds.json')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
