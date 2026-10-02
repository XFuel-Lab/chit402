/**
 * A claim_id settles once. Concurrent closes cannot both commit.
 * The same payment on the same receipt returns the stored receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentRegistry } from '../src/agent-registry.js';
import { ClaimSettlementStore, CLAIM_ALREADY_SETTLED } from '../src/claim-settlement.js';
import { recordCollectedSpend, UsageSettledLedger } from '../src/usage-settled.js';

function receipt(over = {}) {
  return {
    task_id: over.task_id,
    claim_id: over.claim_id,
    payment: {
      rail: 'usdc',
      ref: over.ref,
      collected: true,
      gross_amount: '2000',
    },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

test('concurrent double-settle: one commit, the other is claim_already_settled', async () => {
  const store = new ClaimSettlementStore();
  store.beforeWrite = () => Promise.resolve();
  const first = receipt({ task_id: 'receipt-a', claim_id: 'claim-7', ref: 'base:0xaaa' });
  const second = receipt({ task_id: 'receipt-b', claim_id: 'claim-7', ref: 'base:0xbbb' });
  const [left, right] = await Promise.all([
    store.settle({ claimId: 'claim-7', taskId: first.task_id, paymentRef: first.payment.ref, receipt: first }),
    store.settle({ claimId: 'claim-7', taskId: second.task_id, paymentRef: second.payment.ref, receipt: second }),
  ]);
  const results = [left, right];
  const won = results.filter((row) => row.ok);
  const lost = results.filter((row) => !row.ok);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].code, CLAIM_ALREADY_SETTLED);
  assert.equal(won[0].idempotent, false);
  assert.equal(won[0].state, 'settled');
  assert.equal(store.rows.size, 1);
  assert.equal(lost[0].receipt.task_id, won[0].receipt.task_id);

  const replay = await store.settle({
    claimId: 'claim-7',
    taskId: won[0].receipt.task_id,
    paymentRef: won[0].receipt.payment.ref,
    receipt: { task_id: 'ignored' },
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.receipt, won[0].receipt);
  assert.equal(replay.state, 'settled');
  assert.equal(store.rows.size, 1);
});

test('a second receipt is rejected and a replay of the same payment returns the stored receipt', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const firstBody = receipt({ task_id: 'task-1', claim_id: 'claim-9', ref: 'base:0x111' });
  const first = recordCollectedSpend(firstBody, {
    ledger,
    registry,
    agentId: null,
    singleUseClaim: true,
  });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.idempotent_replay, false);
  assert.equal(ledger.entries.length, 1);

  const second = recordCollectedSpend(
    receipt({ task_id: 'task-2', claim_id: 'claim-9', ref: 'base:0x222' }),
    { ledger, registry, agentId: first.agent_id, singleUseClaim: true },
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, 'claim_already_settled');
  assert.equal(second.receipt.task_id, 'task-1');
  assert.equal(ledger.entries.length, 1);

  const replay = recordCollectedSpend(firstBody, {
    ledger,
    registry,
    agentId: first.agent_id,
    singleUseClaim: true,
  });
  assert.equal(replay.ok, true, replay.reason);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.entry.task_id, 'task-1');
  assert.equal(replay.replay_of, 'task-1');
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.claims.rows.get('claim-9').state, 'settled');
});

test('two spends on the same book seat both record', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const first = recordCollectedSpend(
    receipt({ task_id: 'seat-1', claim_id: '1', ref: 'base:0xseat1' }),
    { ledger, registry },
  );
  assert.equal(first.ok, true, first.reason);
  const seat = String(first.agent_id);
  const second = recordCollectedSpend(
    receipt({ task_id: 'seat-2', claim_id: seat, ref: 'base:0xseat2' }),
    { ledger, registry, agentId: first.agent_id },
  );
  assert.equal(second.ok, true, second.reason);
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.claims.rows.size, 0);
});

test('a persisted close survives a reload and does not reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-close-'));
  const file = path.join(dir, 'claim-settlements.json');
  const store = new ClaimSettlementStore({ file });
  const body = receipt({ task_id: 'persist-1', claim_id: 'claim-p', ref: 'base:0xpersist' });
  const closed = store.settleSync({
    claimId: 'claim-p',
    taskId: body.task_id,
    paymentRef: body.payment.ref,
    receipt: body,
  });
  assert.equal(closed.ok, true);

  const reloaded = new ClaimSettlementStore({ file });
  const again = reloaded.settleSync({
    claimId: 'claim-p',
    taskId: 'persist-2',
    paymentRef: 'base:0xother',
    receipt: receipt({ task_id: 'persist-2', claim_id: 'claim-p', ref: 'base:0xother' }),
  });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'claim_already_settled');
  assert.equal(again.receipt.task_id, 'persist-1');
  assert.equal(reloaded.rows.get('claim-p').state, 'settled');
});
