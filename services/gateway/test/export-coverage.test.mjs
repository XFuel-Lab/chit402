/**
 * Export coverage: a signed commitment to the set a book view or export covers.
 * Empty-by-policy (finished scan, empty-set hash) is not empty-by-drain (null hash).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { readAgentBook, exportAgentBook, bindBookVerifier } = await import('../src/agent-book.js');
const {
  buildExportCoverage,
  verifyExportCoverage,
  emptyUniverseHash,
  rowCommitment,
  hashOrderedCommitments,
  sortForCoverage,
  selectBookWindow,
  renderCoverageSection,
} = await import('../src/export-coverage.js');

function paid(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id,
    status: 'completed',
    payment: {
      rail: 'usdc',
      ref: over.ref,
      collected: true,
      gross_amount: over.amount || '2000',
    },
    route: { model: 'xfuel/auto', hub: 'mock' },
  };
}

function bookWith(n) {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  let recorded = null;
  for (let i = 0; i < n; i++) {
    recorded = recordCollectedSpend(paid({
      task_id: `cov-${i}`,
      ref: `base:0xcov${i}`,
      amount: String(1000 + i),
    }), { ledger, registry, agentId: recorded?.agent_id });
    assert.equal(recorded.ok, true);
  }
  return { ledger, registry, recorded };
}

test('a one-row export is a complete set and the hash matches the row', () => {
  const { ledger, registry, recorded } = bookWith(1);
  const result = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'json', limit: 50 }, {
    ledger,
    verify: bindBookVerifier(registry),
    baseUrl: 'https://api.chit402.com',
  });
  const coverage = result.body.coverage;
  assert.equal(coverage.schema, 'chit402.export_coverage.v1');
  assert.equal(coverage.payload_version, 1);
  assert.equal(coverage.enumerated_count, 1);
  assert.equal(coverage.universe_count, 1);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.truncated, false);
  assert.equal(coverage.empty_reason, null);
  assert.equal(coverage.scope.book_id, recorded.agent_id);
  const expected = hashOrderedCommitments(sortForCoverage(ledger.collectVisible(recorded.agent_id).rows).map(rowCommitment));
  assert.equal(coverage.universe_hash, expected);
  assert.equal(coverage.enumerated_hash, expected);
  const verified = verifyExportCoverage(coverage);
  assert.equal(verified.valid, true, verified.reason);
});

test('a short limit is a truncated export with a different enumerated hash', () => {
  const { ledger, registry, recorded } = bookWith(3);
  const result = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'json', limit: 1 }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  const coverage = result.body.coverage;
  assert.equal(result.body.row_count, 1);
  assert.equal(coverage.enumerated_count, 1);
  assert.equal(coverage.universe_count, 3);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.truncated, true);
  assert.notEqual(coverage.enumerated_hash, coverage.universe_hash);
  assert.equal(verifyExportCoverage(coverage).valid, true);
});

test('empty by policy commits to the empty-set hash; empty by drain does not', () => {
  const { ledger, registry, recorded } = bookWith(1);
  const hidden = readAgentBook(recorded.agent_id, {
    session: recorded.session,
    evidence: 'policy_blocked',
  }, { ledger, verify: bindBookVerifier(registry) });
  assert.equal(hidden.body.entries.length, 0);
  assert.equal(hidden.body.coverage.empty_reason, 'empty_by_policy');
  assert.equal(hidden.body.coverage.universe_hash, emptyUniverseHash());
  assert.equal(hidden.body.coverage.universe_count, 0);
  assert.equal(hidden.body.coverage.complete, true);
  assert.ok(hidden.body.coverage.filtered_out_count >= 1);
  assert.equal(verifyExportCoverage(hidden.body.coverage).valid, true);

  const drained = buildExportCoverage({
    bookId: recorded.agent_id,
    universe: [],
    enumerated: [],
    scanComplete: false,
    scope: { book_id: recorded.agent_id, limit: 50 },
  });
  assert.equal(drained.empty_reason, 'empty_by_drain');
  assert.equal(drained.universe_hash, null);
  assert.equal(drained.universe_count, null);
  assert.equal(drained.complete, false);
  assert.notEqual(drained.universe_hash, hidden.body.coverage.universe_hash);
});

test('an unmetered row is omitted by policy and does not enter the universe', () => {
  const { ledger, recorded } = bookWith(1);
  ledger._index({
    task_id: 'demo-row',
    payment_ref: 'demo:1',
    agent_id: recorded.agent_id,
    collected: true,
    rail: 'unmetered',
    amount: '0',
    collected_at: new Date().toISOString(),
  });
  const selected = selectBookWindow(ledger, recorded.agent_id, { limit: 50 });
  assert.equal(selected.coverage.enumerated_count, 1);
  assert.equal(selected.coverage.omitted_by_policy_count, 1);
  assert.equal(selected.entries.some((row) => row.task_id === 'demo-row'), false);
});

test('csv and html exports carry the same signed universe hash', () => {
  const { ledger, registry, recorded } = bookWith(1);
  const csv = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'csv', limit: 50 }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  const html = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'html', limit: 50 }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  const json = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'json', limit: 50 }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  assert.match(csv.body, /task_id,evidence,collected_at/);
  assert.match(csv.body, new RegExp(`# universe_hash=${json.body.coverage.universe_hash}`));
  assert.match(csv.body, /# empty_reason=/);
  assert.match(csv.body, /# coverage_jws=/);
  assert.match(html.body, /Export coverage/);
  assert.match(html.body, new RegExp(json.body.coverage.universe_hash));
  assert.match(renderCoverageSection(json.body.coverage), /complete/);
});

test('a time filter is inside the signed scope', () => {
  const { ledger, registry, recorded } = bookWith(1);
  const row = ledger.findByTask('cov-0');
  const after = new Date(Date.parse(row.collected_at) + 60_000).toISOString();
  const book = readAgentBook(recorded.agent_id, { session: recorded.session, from: after }, {
    ledger,
    verify: bindBookVerifier(registry),
  });
  assert.equal(book.body.coverage.empty_reason, 'empty_by_policy');
  assert.equal(book.body.coverage.scope.from, after);
  assert.equal(book.body.coverage.scope.filters.evidence, null);
});
