/**
 * Per-book seq: monotonic append position, hash chain, replay does not consume
 * a seq, a correction does, and gaps are visible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger, recordCollectedSpend, noteIdempotentReplay } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { readAgentBook, exportAgentBook, bindBookVerifier } = await import('../src/agent-book.js');
const { correctBookInflow, recordBookInflow } = await import('../src/book-inflow.js');
const { verifyBookSeq, bookRowHash, analyzeSeq } = await import('../src/book-seq.js');

function paid(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id,
    status: 'completed',
    payment: {
      rail: 'usdc',
      ref: over.ref,
      collected: true,
      gross_amount: '2000',
    },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

test('append assigns gapless seq and chains the previous hash', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const first = recordCollectedSpend(paid({ task_id: 's1', ref: 'base:0xs1' }), { ledger, registry });
  const second = recordCollectedSpend(paid({ task_id: 's2', ref: 'base:0xs2' }), {
    ledger, registry, agentId: first.agent_id,
  });
  assert.equal(first.entry.seq, 1);
  assert.equal(first.entry.prev_hash, null);
  assert.equal(second.entry.seq, 2);
  assert.equal(second.entry.prev_hash, first.entry.row_hash);
  assert.equal(second.entry.row_hash, bookRowHash(second.entry));
  assert.equal(verifyBookSeq(first.entry.book_chain).valid, true);
  assert.equal(verifyBookSeq(second.entry.book_chain).valid, true);
  const report = ledger.seqReport(first.agent_id);
  assert.equal(report.gapless, true);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.next_seq, 3);
});

test('an idempotent replay does not consume a seq', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const first = recordCollectedSpend(paid({ task_id: 'once', ref: 'base:0xonce' }), { ledger, registry });
  const again = recordCollectedSpend(paid({ task_id: 'once', ref: 'base:0xonce' }), {
    ledger, registry, agentId: first.agent_id,
  });
  assert.equal(again.idempotent_replay, true);
  assert.equal(again.replay_of, 'once');
  assert.equal(first.entry.seq, 1);
  assert.equal(ledger.seqReport(first.agent_id).count, 1);
  noteIdempotentReplay(first.entry);
  assert.equal(first.entry.seq, 1);
  assert.equal(ledger.entries.filter((e) => e.agent_id === first.agent_id).length, 1);
});

test('an inflow correction appends a new seq and leaves the original position', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const verify = bindBookVerifier(registry);
  const collected = recordCollectedSpend(paid({ task_id: 'host', ref: 'base:0xhost' }), { ledger, registry });
  recordBookInflow(collected.agent_id, {
    bucket: 'treasury',
    allocation: '10000',
    task_id: 'inflow-seq-1',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  const original = ledger.findByTask('inflow-seq-1');
  const originalSeq = original.seq;
  const corrected = correctBookInflow(collected.agent_id, {
    task_id: 'inflow-seq-1',
    bucket: 'treasury',
    allocation: '12000',
    reason: 'allocation_adjusted',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  assert.equal(corrected.status, 200);
  assert.equal(ledger.findByTask('inflow-seq-1').seq, originalSeq);
  assert.equal(corrected.body.correction_row.seq, originalSeq + 1);
  assert.equal(corrected.body.correction_row.prev_hash, original.row_hash);
  const row = ledger.findByTask(corrected.body.correction_row.task_id);
  assert.equal(row.event, 'inflow_correction');
  assert.equal(ledger.seqReport(collected.agent_id).gapless, true);
});

test('the book view and the gaps helper report a hole', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const first = recordCollectedSpend(paid({ task_id: 'g1', ref: 'base:0xg1' }), { ledger, registry });
  recordCollectedSpend(paid({ task_id: 'g2', ref: 'base:0xg2' }), { ledger, registry, agentId: first.agent_id });
  const second = ledger.findByTask('g2');
  second.seq = 4;
  const report = analyzeSeq(ledger.entries.filter((e) => e.agent_id === first.agent_id));
  assert.equal(report.gapless, false);
  assert.deepEqual(report.gaps, [2, 3]);
  const book = readAgentBook(first.agent_id, { session: first.session }, {
    ledger, verify: bindBookVerifier(registry),
  });
  assert.equal(book.body.entries[0].seq != null, true);
  const exported = exportAgentBook(first.agent_id, { session: first.session, format: 'csv', limit: 50 }, {
    ledger, verify: bindBookVerifier(registry),
  });
  assert.match(exported.body, /,seq,prev_hash,row_hash/);
});
