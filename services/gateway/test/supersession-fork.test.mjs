/**
 * Supersession forks are explicit. A monotonic seq does not elect a tip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { readAgentBook, bindBookVerifier } = await import('../src/agent-book.js');
const { recordBookInflow, correctBookInflow } = await import('../src/book-inflow.js');
const { verifyBookSeq } = await import('../src/book-seq.js');
const {
  reportSupersession,
  supersessionForRow,
  summarizeSupersession,
  renderSupersessionSection,
} = await import('../src/supersession-fork.js');

function decode(jws) {
  return JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
}

function paid(taskId, ref) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: taskId,
    payment: { rail: 'usdc', ref, collected: true, gross_amount: '2000' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

function row(over) {
  return {
    task_id: over.task_id,
    seq: over.seq ?? null,
    prev_hash: over.prev_hash ?? null,
    row_hash: over.row_hash || `hash-${over.task_id}`,
    recorded_at: over.recorded_at || '2026-01-01T00:00:00.000Z',
    authority: over.authority || null,
    subject_handle: over.subject_handle || null,
    supersedes: over.supersedes || null,
    corrects: over.corrects || null,
    act: over.act || null,
    event: over.event || null,
    parent_ref: over.parent_ref || null,
  };
}

test('no successor is none and elects nobody', () => {
  const subject = row({ task_id: 'spend-1', seq: 1, authority: { subject_handle: 'verdigris' } });
  const report = reportSupersession(subject, []);
  assert.equal(report.status, 'none');
  assert.equal(report.authoritative, null);
  assert.deepEqual(report.successors, []);
  assert.equal(report.signed, false);
});

test('one matching successor is authoritative', () => {
  const subject = row({ task_id: 'spend-1', seq: 1, authority: { subject_handle: 'verdigris' } });
  const successor = row({
    task_id: 'spend-1:correction:1',
    seq: 4,
    supersedes: 'spend-1',
    recorded_at: '2026-06-01T00:00:00.000Z',
    authority: { subject_handle: 'verdigris', writer: 'gateway', issuer: 'chit402' },
  });
  const report = reportSupersession(subject, [successor]);
  assert.equal(report.status, 'linear');
  assert.equal(report.authoritative, 'spend-1:correction:1');
  assert.equal(report.successors.length, 1);
  assert.equal(report.successors[0].id, 'spend-1:correction:1');
  assert.equal(report.successors[0].seq, 4);
});

test('two successors are FORKED and do not elect the later one', () => {
  const subject = row({ task_id: 'spend-1', seq: 1, authority: { subject_handle: 'verdigris' } });
  const earlier = row({
    task_id: 'corr-a',
    seq: 2,
    supersedes: 'spend-1',
    recorded_at: '2026-02-01T00:00:00.000Z',
    authority: { subject_handle: 'verdigris' },
  });
  const later = row({
    task_id: 'corr-b',
    seq: 9,
    supersedes: 'spend-1',
    recorded_at: '2026-08-01T00:00:00.000Z',
    authority: { subject_handle: 'verdigris' },
  });
  const forward = reportSupersession(subject, [earlier, later]);
  const reversed = reportSupersession(subject, [later, earlier]);
  for (const report of [forward, reversed]) {
    assert.equal(report.status, 'forked');
    assert.equal(report.authoritative, null);
    assert.deepEqual(report.successors.map((item) => item.id), report === forward
      ? ['corr-a', 'corr-b']
      : ['corr-b', 'corr-a']);
    assert.notEqual(report.authoritative, 'corr-b');
  }
  assert.match(renderSupersessionSection(forward), /FORKED/);
  assert.match(renderSupersessionSection(forward), /corr-a/);
  assert.match(renderSupersessionSection(forward), /corr-b/);
});

test('a single successor that does not match the subject is not a tip', () => {
  const subject = row({ task_id: 'spend-1', seq: 1, authority: { subject_handle: 'verdigris' } });
  const other = row({
    task_id: 'corr-other',
    seq: 2,
    corrects: 'spend-1',
    authority: { subject_handle: 'someone-else' },
  });
  const report = reportSupersession(subject, [other]);
  assert.equal(report.status, 'forked');
  assert.equal(report.authoritative, null);
  assert.equal(report.successors[0].id, 'corr-other');
});

test('exactly one subject match is authoritative even when its seq is lower', () => {
  const subject = row({
    task_id: 'spend-1',
    seq: 1,
    authority: { subject_handle: 'verdigris', subject_wallet: '0xabc' },
  });
  const match = row({
    task_id: 'corr-low',
    seq: 2,
    supersedes: 'spend-1',
    authority: { subject_handle: 'verdigris' },
  });
  const other = row({
    task_id: 'corr-high',
    seq: 8,
    supersedes: 'spend-1',
    recorded_at: '2026-12-01T00:00:00.000Z',
    authority: { subject_handle: 'other-handle' },
  });
  const report = reportSupersession(subject, [other, match]);
  assert.equal(report.status, 'linear');
  assert.equal(report.authoritative, 'corr-low');
  assert.deepEqual(report.successors.map((item) => item.id), ['corr-high', 'corr-low']);
});

test('a seq-monotonic hash chain stays FORKED when two rows supersede one subject', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const verify = bindBookVerifier(registry);
  const collected = recordCollectedSpend(paid('host-fork', 'base:0xfork'), { ledger, registry });
  recordBookInflow(collected.agent_id, {
    bucket: 'treasury',
    allocation: '10000',
    task_id: 'inflow-fork',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  const original = ledger.findByTask('inflow-fork');
  const first = correctBookInflow(collected.agent_id, {
    task_id: 'inflow-fork',
    bucket: 'treasury',
    allocation: '11000',
    reason: 'first pass',
    subject_handle: 'verdigris',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  const second = correctBookInflow(collected.agent_id, {
    task_id: 'inflow-fork',
    bucket: 'treasury',
    allocation: '12000',
    reason: 'second pass',
    subject_handle: 'verdigris',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const a = ledger.findByTask(first.body.correction_row.task_id);
  const b = ledger.findByTask(second.body.correction_row.task_id);
  assert.equal(a.supersedes, 'inflow-fork');
  assert.equal(b.supersedes, 'inflow-fork');
  assert.equal(b.prev_hash, a.row_hash);
  assert.equal(a.prev_hash, original.row_hash);
  assert.ok(b.seq > a.seq);

  const report = ledger.seqReport(collected.agent_id);
  assert.equal(report.gapless, true);
  assert.equal(report.supersession.status, 'forked');
  assert.equal(report.supersession.authoritative, null);
  assert.equal(report.supersession.signed, false);
  const fork = report.supersession.forks.find((item) => item.subject === 'inflow-fork');
  assert.ok(fork);
  assert.equal(fork.status, 'forked');
  assert.equal(fork.authoritative, null);
  assert.deepEqual(fork.successors.map((item) => item.id).sort(), [a.task_id, b.task_id].sort());

  const onSubject = ledger.supersessionOf('inflow-fork');
  assert.equal(onSubject.status, 'forked');
  assert.equal(onSubject.authoritative, null);
  const onLater = ledger.supersessionOf(b.task_id);
  assert.equal(onLater.status, 'forked');
  assert.equal(onLater.authoritative, null);
  assert.notEqual(onLater.authoritative, b.task_id);

  for (const signed of [original, a, b]) {
    assert.equal(verifyBookSeq(signed.book_chain).valid, true);
    const claims = decode(signed.book_chain.issuer_signature.jws);
    assert.equal(claims.supersession, undefined);
    assert.equal(claims.supersedes, undefined);
  }

  const book = readAgentBook(collected.agent_id, { session: collected.session }, {
    ledger, verify,
  });
  const inflow = book.body.entries.find((entry) => entry.task_id === 'inflow-fork');
  assert.equal(inflow.supersession.status, 'forked');
  assert.equal(inflow.supersession.authoritative, null);
  assert.equal(second.body.supersession.status, 'forked');
  assert.equal(second.body.supersession.authoritative, null);
});

test('a lineage parent_ref is not a supersession claim', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const parent = recordCollectedSpend(paid('parent-line', 'base:0xparentline'), { ledger, registry });
  const child = ledger.append(paid('child-line', 'base:0xchildline'), {
    agentId: parent.agent_id,
    parentRef: 'base:0xparentline',
  });
  assert.equal(child.ok, true);
  assert.equal(child.entry.parent_ref, 'base:0xparentline');
  const report = ledger.supersessionOf('parent-line');
  assert.equal(report.status, 'none');
  assert.equal(report.authoritative, null);
  assert.deepEqual(report.successors, []);
  assert.equal(ledger.seqReport(parent.agent_id).supersession.status, 'none');
});

test('one real correction stays linear and the signed book chain is unchanged', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const verify = bindBookVerifier(registry);
  const collected = recordCollectedSpend(paid('host-line', 'base:0xline'), { ledger, registry });
  const before = collected.entry.book_chain.issuer_signature.jws;
  recordBookInflow(collected.agent_id, {
    bucket: 'treasury',
    allocation: '10000',
    task_id: 'inflow-line',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  const corrected = correctBookInflow(collected.agent_id, {
    task_id: 'inflow-line',
    allocation: '11000',
    reason: 'once',
    subject_handle: 'verdigris',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  assert.equal(corrected.status, 200);
  const report = ledger.supersessionOf('inflow-line');
  assert.equal(report.status, 'linear');
  assert.equal(report.authoritative, corrected.body.correction_row.task_id);
  assert.equal(collected.entry.book_chain.issuer_signature.jws, before);
  assert.equal(verifyBookSeq(collected.entry.book_chain).valid, true);
  const spend = supersessionForRow(collected.entry, ledger.entries);
  assert.equal(spend.status, 'none');
  const summary = summarizeSupersession(ledger.entries.filter((e) => e.agent_id === collected.agent_id));
  assert.equal(summary.status, 'linear');
  assert.equal(summary.authoritative, null);
});
