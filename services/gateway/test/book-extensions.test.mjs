/**
 * Book Extensions: lineage, caps as rows, assign, dispute, possession sanity.
 *
 * Per whitepaper: the book is NOT a router. GET /v1/agents/:agent_id/book is the product.
 * POST /v1/chat/completions is bait. A holder can prove:
 *   (a) 2-hop lineage (A→B→inference)
 *   (b) daily cap set by possession holder
 *   (c) slice assigned to a second reader
 *   (d) dispute outcome row after binding+hash recheck
 *   (e) book across key rotate
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.TASK_STORE_PERSIST = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'test-book-ext-secret';

const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { readAgentBook, bindBookVerifier, queryLineage, exportAgentBook, buildBookExportCsv, buildBookAuditPack } = await import('../src/agent-book.js');
const {
  BookPolicyStore,
  POLICY_TYPES,
  DEFAULT_RISK_TIERS,
  enforcePolicy,
  enforceSessionActApproval,
  classifySessionActRisk,
  SessionActApprovalStore,
} = await import('../src/book-policy.js');
const { BookAssignmentStore, GRANT_TYPES, filterBySlice, readSliceByToken } = await import('../src/book-assign.js');
const { BookDisputeStore, CLAIM_TYPES, OUTCOME_TYPES, fileAndAdjudicate, recheckDispute } = await import('../src/book-dispute.js');

const WALLET_A = '0x1111111111111111111111111111111111111111';

function collectedReceipt(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id || 'task-paid-1',
    status: 'completed',
    proof_outcome: 'valid',
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || 'base:0xabc123',
      collected: true,
      gross_amount: over.amount || '10000',
    },
    route: { model: over.model || 'xfuel/auto', hub: over.hub || 'mock' },
    output: over.output || { hash: '0x' + 'ab'.repeat(32) },
  };
}

// ─── LINEAGE TESTS ─────────────────────────────────────────────────────────────

describe('Lineage', () => {
  test('parent_ref field is stored and returned in book entries', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const parent = collectedReceipt({ task_id: 'parent-task', ref: 'base:0xparent' });
    const recorded = recordCollectedSpend(parent, { ledger, registry });
    assert.equal(recorded.ok, true);

    const child = collectedReceipt({ task_id: 'child-task', ref: 'base:0xchild' });
    const childRecorded = ledger.append(child, {
      agentId: recorded.agent_id,
      parentRef: 'base:0xparent',
    });
    assert.equal(childRecorded.ok, true);
    assert.equal(childRecorded.entry.parent_ref, 'base:0xparent');

    const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.status, 200);
    const childEntry = book.body.entries.find(e => e.task_id === 'child-task');
    assert.equal(childEntry.parent_ref, 'base:0xparent');
  });

  test('lineageOf walks A→B→inference chain', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const agentA = collectedReceipt({ task_id: 'agent-a', ref: 'base:0xa', amount: '10000' });
    const recordedA = recordCollectedSpend(agentA, { ledger, registry });

    ledger.append(collectedReceipt({ task_id: 'agent-b', ref: 'base:0xb' }), {
      agentId: recordedA.agent_id,
      parentRef: 'base:0xa',
    });

    ledger.append(collectedReceipt({ task_id: 'inference', ref: 'base:0xc' }), {
      agentId: recordedA.agent_id,
      parentRef: 'base:0xb',
    });

    const lineage = ledger.lineageOf('inference');
    assert.equal(lineage.self.task_id, 'inference');
    assert.equal(lineage.ancestors.length, 2);
    assert.equal(lineage.ancestors[0].task_id, 'agent-b');
    assert.equal(lineage.ancestors[1].task_id, 'agent-a');
    assert.equal(lineage.root.task_id, 'agent-a');
    assert.equal(lineage.depth, 2);
  });

  test('queryLineage is possession-gated', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 'task-1', ref: 'base:0x1' }), { ledger, registry });
    const verify = bindBookVerifier(registry);

    const unauth = queryLineage(recorded.agent_id, 'task-1', {}, { ledger, verify });
    assert.equal(unauth.status, 401);

    const wrongSession = queryLineage(recorded.agent_id, 'task-1', { session: 'wrong' }, { ledger, verify });
    assert.equal(wrongSession.status, 403);

    const ok = queryLineage(recorded.agent_id, 'task-1', { session: recorded.session }, { ledger, verify });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.task_id, 'task-1');
  });
});

// ─── CAPS AS ROWS TESTS ─────────────────────────────────────────────────────────

describe('Caps as Rows', () => {
  test('set and get policy: daily_cap', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.DAILY_CAP, '100000');
    assert.equal(result.ok, true);
    assert.equal(result.policy.daily_cap.limit, '100000');

    const current = policy.get(1);
    assert.equal(current.daily_cap.limit, '100000');
  });

  test('set and get policy: model_allowlist', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.MODEL_ALLOWLIST, ['theta/qwen3', 'akash/llama']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.policy.model_allowlist, ['theta/qwen3', 'akash/llama']);
  });

  test('set and get policy: kill_switch', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.KILL_SWITCH, true);
    assert.equal(result.ok, true);
    assert.equal(result.policy.kill_switch, true);
  });

  test('enforcePolicy blocks when kill_switch active', () => {
    const policy = new BookPolicyStore();
    policy.set(1, POLICY_TYPES.KILL_SWITCH, true);

    const check = enforcePolicy(1, { model: 'theta/qwen3', amount: '10000' }, { policy });
    assert.equal(check.allowed, false);
    assert.equal(check.code, 'kill_switch');
  });

  test('enforcePolicy blocks model not in allowlist', () => {
    const policy = new BookPolicyStore();
    policy.set(1, POLICY_TYPES.MODEL_ALLOWLIST, ['theta/qwen3']);

    const blocked = enforcePolicy(1, { model: 'akash/llama' }, { policy });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.code, 'model_not_allowed');

    const allowed = enforcePolicy(1, { model: 'theta/qwen3' }, { policy });
    assert.equal(allowed.allowed, true);
  });

  test('enforcePolicy blocks when daily cap exceeded', () => {
    const policy = new BookPolicyStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't1', ref: 'base:0x1', amount: '50000' }), { ledger, registry });
    policy.set(recorded.agent_id, POLICY_TYPES.DAILY_CAP, '60000');

    const smallSpend = enforcePolicy(recorded.agent_id, { amount: '10000' }, { policy, ledger });
    assert.equal(smallSpend.allowed, true);

    const bigSpend = enforcePolicy(recorded.agent_id, { amount: '20000' }, { policy, ledger });
    assert.equal(bigSpend.allowed, false);
    assert.equal(bigSpend.code, 'daily_cap_exceeded');
  });

  test('no policy = allowed', () => {
    const policy = new BookPolicyStore();
    const check = enforcePolicy(999, { model: 'anything' }, { policy });
    assert.equal(check.allowed, true);
  });

  test('set and get policy: hourly_cap', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.HOURLY_CAP, '50000');
    assert.equal(result.ok, true);
    assert.equal(result.policy.hourly_cap.limit, '50000');
    assert.ok(result.policy.hourly_cap.reset_at);
  });

  test('enforcePolicy blocks when hourly cap exceeded', () => {
    const policy = new BookPolicyStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't1', ref: 'base:0x1', amount: '40000' }), { ledger, registry });
    policy.set(recorded.agent_id, POLICY_TYPES.HOURLY_CAP, '50000');

    const smallSpend = enforcePolicy(recorded.agent_id, { amount: '10000' }, { policy, ledger });
    assert.equal(smallSpend.allowed, true);

    const bigSpend = enforcePolicy(recorded.agent_id, { amount: '20000' }, { policy, ledger });
    assert.equal(bigSpend.allowed, false);
    assert.equal(bigSpend.code, 'hourly_cap_exceeded');
    assert.equal(bigSpend.policy_key, 'hourly_cap');
    assert.equal(bigSpend.spent_atomic, '40000');
    assert.equal(bigSpend.cap_atomic, '50000');
    assert.ok(bigSpend.period_start);
  });

  test('set and get policy: require_payment_ref', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.REQUIRE_PAYMENT_REF, true);
    assert.equal(result.ok, true);
    assert.equal(result.policy.require_payment_ref, true);
  });

  test('enforcePolicy blocks when require_payment_ref and ledger gap', () => {
    const policy = new BookPolicyStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't1', ref: 'base:0x1' }), { ledger, registry });
    policy.set(recorded.agent_id, POLICY_TYPES.REQUIRE_PAYMENT_REF, true);

    const ok = enforcePolicy(recorded.agent_id, { amount: '10000' }, { policy, ledger });
    assert.equal(ok.allowed, true);

    ledger.entries.push({
      task_id: 'gap-row',
      agent_id: recorded.agent_id,
      collected: true,
      rail: 'usdc',
      amount: '5000',
      payment_ref: null,
    });

    const blocked = enforcePolicy(recorded.agent_id, { amount: '10000' }, { policy, ledger });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.code, 'payment_ref_required');
  });

  test('set and get policy: tier2_above', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.TIER2_ABOVE, '100000');
    assert.equal(result.ok, true);
    assert.equal(result.policy.tier2_above.threshold, '100000');
  });

  test('enforcePolicy blocks tier2_above without proof_tier', () => {
    const policy = new BookPolicyStore();
    policy.set(1, POLICY_TYPES.TIER2_ABOVE, '50000');

    const blocked = enforcePolicy(1, { amount: '60000' }, { policy });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.code, 'tier2_required');

    const allowed = enforcePolicy(1, { amount: '60000', proof_tier: 'settlement' }, { policy });
    assert.equal(allowed.allowed, true);

    const below = enforcePolicy(1, { amount: '40000' }, { policy });
    assert.equal(below.allowed, true);
  });

  test('set and get policy: approval_ttl', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.APPROVAL_TTL, 3600);
    assert.equal(result.ok, true);
    assert.equal(result.policy.approval_ttl.seconds, 3600);

    const bad = policy.set(1, POLICY_TYPES.APPROVAL_TTL, 10);
    assert.equal(bad.ok, false);
  });

  test('set and get policy: risk_tiers override', () => {
    const policy = new BookPolicyStore();
    const result = policy.set(1, POLICY_TYPES.RISK_TIERS, {
      high: ['handoff'],
      low: ['read_private', 'redeem'],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.policy.risk_tiers.high, ['handoff']);
    assert.deepEqual(result.policy.risk_tiers.low, ['read_private', 'redeem']);
  });

  test('classifySessionActRisk uses defaults and custom tiers', () => {
    assert.equal(classifySessionActRisk('handoff'), 'high');
    assert.equal(classifySessionActRisk('read_private'), 'low');
    assert.equal(classifySessionActRisk('redeem'), 'high');
    assert.equal(classifySessionActRisk('unknown_act'), 'unknown');
    assert.deepEqual(DEFAULT_RISK_TIERS.high, ['handoff', 'redeem']);

    const policy = new BookPolicyStore();
    policy.set(1, POLICY_TYPES.RISK_TIERS, { high: ['redeem'], low: ['handoff', 'read_private'] });
    const row = policy.get(1);
    assert.equal(classifySessionActRisk('handoff', row), 'low');
    assert.equal(classifySessionActRisk('redeem', row), 'high');
  });

  test('enforceSessionActApproval: low-blast unaffected; high-blast needs challenge after TTL', () => {
    const policy = new BookPolicyStore();
    const approvals = new SessionActApprovalStore();
    policy.set(1, POLICY_TYPES.APPROVAL_TTL, 120);
    const now = 1_700_000_000;

    const low = enforceSessionActApproval(1, 'read_private', { delegationHash: '0x' + 'aa'.repeat(32), now }, { policy, approvalStore: approvals });
    assert.equal(low.allowed, true);

    const firstHigh = enforceSessionActApproval(1, 'handoff', {
      delegationHash: '0x' + 'bb'.repeat(32),
      hasFreshChallenge: false,
      now,
    }, { policy, approvalStore: approvals });
    assert.equal(firstHigh.allowed, false);
    assert.equal(firstHigh.code, 'approval_ttl_expired');

    const challenged = enforceSessionActApproval(1, 'handoff', {
      delegationHash: '0x' + 'bb'.repeat(32),
      hasFreshChallenge: true,
      now,
    }, { policy, approvalStore: approvals });
    assert.equal(challenged.allowed, true);

    approvals.recordHighBlast('0x' + 'bb'.repeat(32), now - 30);
    const within = enforceSessionActApproval(1, 'handoff', {
      delegationHash: '0x' + 'bb'.repeat(32),
      hasFreshChallenge: false,
      now,
    }, { policy, approvalStore: approvals });
    assert.equal(within.allowed, true);

    approvals.recordHighBlast('0x' + 'bb'.repeat(32), now - 200);
    const expired = enforceSessionActApproval(1, 'handoff', {
      delegationHash: '0x' + 'bb'.repeat(32),
      hasFreshChallenge: false,
      now,
    }, { policy, approvalStore: approvals });
    assert.equal(expired.allowed, false);
    assert.equal(expired.code, 'approval_ttl_expired');
  });
});

// ─── EXPORT TESTS ───────────────────────────────────────────────────────────────

describe('Book Export', () => {
  test('exportAgentBook returns CSV for possession holder', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'export-t1',
      ref: 'base:0xexport1',
      amount: '10000',
      model: 'theta/qwen3',
      hub: 'theta',
    }), { ledger, registry });

    const result = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'csv' }, {
      ledger,
      verify: bindBookVerifier(registry),
      baseUrl: 'https://api.chit402.com',
    });
    assert.equal(result.status, 200);
    assert.equal(result.contentType, 'text/csv; charset=utf-8');
    assert.match(result.body, /task_id,evidence,collected_at,hub,model,amount/);
    assert.match(result.body, /export-t1/);
    assert.match(result.body, /theta\/qwen3/);
  });

  test('exportAgentBook returns JSON audit pack', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 'audit-t1', ref: 'base:0xa1' }), { ledger, registry });

    const result = exportAgentBook(recorded.agent_id, { session: recorded.session, format: 'json' }, {
      ledger,
      verify: bindBookVerifier(registry),
      baseUrl: 'https://api.chit402.com',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.schema, 'chit402.book_audit.v1');
    assert.equal(result.body.row_count, 1);
    assert.equal(result.body.rows[0].task_id, 'audit-t1');
    assert.match(result.body.rows[0].auditor_url, /format=auditor/);
  });

  test('exportAgentBook is possession-gated', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't1', ref: 'base:0x1' }), { ledger, registry });

    const unauth = exportAgentBook(recorded.agent_id, {}, { ledger, verify: bindBookVerifier(registry) });
    assert.equal(unauth.status, 401);

    const wrong = exportAgentBook(recorded.agent_id, { session: 'wrong' }, { ledger, verify: bindBookVerifier(registry) });
    assert.equal(wrong.status, 403);
  });

  test('buildBookExportCsv escapes commas', () => {
    const entries = [{
      task_id: 't1',
      payment_ref: 'base:0x1',
      rail: 'usdc',
      amount: '1000',
      collected_at: '2026-08-01T00:00:00Z',
      model: 'hub/model,with,comma',
      hub: 'hub',
    }];
    const csv = buildBookExportCsv(entries, 1, 'https://api.chit402.com');
    assert.match(csv, /"hub\/model,with,comma"/);
  });
});

// ─── ASSIGN TESTS ───────────────────────────────────────────────────────────────

describe('Assign', () => {
  test('create assignment with slice', () => {
    const assignments = new BookAssignmentStore();
    const result = assignments.create(1, {
      grant_type: GRANT_TYPES.READ,
      slice: { from_date: '2026-08-01T00:00:00Z', to_date: '2026-08-31T23:59:59Z' },
    });
    assert.equal(result.ok, true);
    assert.ok(result.assignment.assignment_id);
    assert.ok(result.assignment.token);
    assert.equal(result.assignment.grant_type, 'read');
    assert.equal(result.assignment.slice.from_date, '2026-08-01T00:00:00Z');
  });

  test('read slice by token', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const assignments = new BookAssignmentStore();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 't1',
      ref: 'base:0x1',
      amount: '10000',
    }), { ledger, registry });
    ledger.append(collectedReceipt({ task_id: 't2', ref: 'base:0x2' }), { agentId: recorded.agent_id });

    const assign = assignments.create(recorded.agent_id, {
      grant_type: GRANT_TYPES.READ,
      slice: { limit: 10 },
    });

    const slice = readSliceByToken(assign.assignment.token, { assignments, ledger });
    assert.equal(slice.status, 200);
    assert.equal(slice.body.entries.length, 2);
    assert.equal(slice.body.grant_type, 'read');
  });

  test('invalid token returns 403', () => {
    const assignments = new BookAssignmentStore();
    const ledger = new UsageSettledLedger();

    const slice = readSliceByToken('invalid-token', { assignments, ledger });
    assert.equal(slice.status, 403);
  });

  test('revoke assignment invalidates token', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const assignments = new BookAssignmentStore();

    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't1', ref: 'base:0x1' }), { ledger, registry });
    const assign = assignments.create(recorded.agent_id, {
      grant_type: GRANT_TYPES.READ,
      slice: { limit: 10 },
    });

    const revoke = assignments.revoke(recorded.agent_id, assign.assignment.assignment_id);
    assert.equal(revoke.ok, true);
    assert.equal(revoke.assignment.revoked, true);

    const slice = readSliceByToken(assign.assignment.token, { assignments, ledger });
    assert.equal(slice.status, 403);
  });

  test('filterBySlice filters by date range', () => {
    const entries = [
      { task_id: 't1', collected_at: '2026-08-10T12:00:00Z' },
      { task_id: 't2', collected_at: '2026-08-20T12:00:00Z' },
      { task_id: 't3', collected_at: '2026-09-01T12:00:00Z' },
    ];

    const filtered = filterBySlice(entries, {
      from_date: '2026-08-01T00:00:00Z',
      to_date: '2026-08-31T23:59:59Z',
    });
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered.map(e => e.task_id), ['t1', 't2']);
  });

  test('filterBySlice filters by task_ids', () => {
    const entries = [
      { task_id: 't1' },
      { task_id: 't2' },
      { task_id: 't3' },
    ];

    const filtered = filterBySlice(entries, { task_ids: ['t1', 't3'] });
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered.map(e => e.task_id), ['t1', 't3']);
  });
});

// ─── DISPUTE TESTS ──────────────────────────────────────────────────────────────

describe('Dispute', () => {
  test('file dispute: output_missing', async () => {
    const disputes = new BookDisputeStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-dispute-1',
      ref: 'base:0xd1',
    }), { ledger, registry });

    const result = await fileAndAdjudicate({
      agent_id: recorded.agent_id,
      task_id: 'task-dispute-1',
      claim_type: CLAIM_TYPES.OUTPUT_MISSING,
    }, {
      disputes,
      ledger,
      loadReceipt: async () => ({ output: null }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.dispute.claim_type, 'output_missing');
    assert.equal(result.dispute.outcome, OUTCOME_TYPES.REFUND);
    assert.equal(result.auto_adjudicated, true);
  });

  test('file dispute: double_charge', async () => {
    const disputes = new BookDisputeStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-dc-1',
      ref: 'base:0xsame',
    }), { ledger, registry });

    ledger.entries.push({
      task_id: 'task-dc-2',
      payment_ref: 'base:0xsame',
      agent_id: recorded.agent_id,
      collected: true,
      rail: 'usdc',
      amount: '10000',
    });

    const result = await fileAndAdjudicate({
      agent_id: recorded.agent_id,
      task_id: 'task-dc-1',
      claim_type: CLAIM_TYPES.DOUBLE_CHARGE,
    }, { disputes, ledger });

    assert.equal(result.ok, true);
    assert.equal(result.dispute.outcome, OUTCOME_TYPES.REFUND);
  });

  test('file dispute: wrong_model (partial refund)', async () => {
    const disputes = new BookDisputeStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-wm-1',
      ref: 'base:0xwm',
      model: 'akash/llama',
    }), { ledger, registry });

    const result = await fileAndAdjudicate({
      agent_id: recorded.agent_id,
      task_id: 'task-wm-1',
      claim_type: CLAIM_TYPES.WRONG_MODEL,
      evidence: { requested_model: 'theta/qwen3' },
    }, { disputes, ledger });

    assert.equal(result.ok, true);
    assert.equal(result.dispute.outcome, OUTCOME_TYPES.PARTIAL);
  });

  test('cannot file duplicate dispute', async () => {
    const disputes = new BookDisputeStore();
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-dup',
      ref: 'base:0xdup',
    }), { ledger, registry });

    await fileAndAdjudicate({
      agent_id: recorded.agent_id,
      task_id: 'task-dup',
      claim_type: CLAIM_TYPES.OUTPUT_MISSING,
    }, { disputes, ledger });

    const dup = await fileAndAdjudicate({
      agent_id: recorded.agent_id,
      task_id: 'task-dup',
      claim_type: CLAIM_TYPES.OUTPUT_MISSING,
    }, { disputes, ledger });

    assert.equal(dup.ok, false);
    assert.match(dup.reason, /already filed/);
  });
});

// ─── POSSESSION SANITY TESTS ────────────────────────────────────────────────────

describe('Possession Sanity', () => {
  test('key rotation does not drop the book (entries stay with agent_id)', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-rotate-1',
      ref: 'base:0xrotate1',
    }), { ledger, registry });
    ledger.append(collectedReceipt({ task_id: 'task-rotate-2', ref: 'base:0xrotate2' }), {
      agentId: recorded.agent_id,
    });

    const bookBefore = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(bookBefore.status, 200);
    assert.equal(bookBefore.body.entries.length, 2);

    const rotated = registry.rotateSession(recorded.agent_id, recorded.session);
    assert.equal(rotated.ok, true);
    assert.notEqual(rotated.session, recorded.session);

    const bookWithOldSession = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(bookWithOldSession.status, 403, 'old session is invalid');

    const bookWithNewSession = readAgentBook(recorded.agent_id, { session: rotated.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(bookWithNewSession.status, 200, 'new session works');
    assert.equal(bookWithNewSession.body.entries.length, 2, 'entries preserved');
  });

  test('rotateSession requires correct old session', () => {
    const registry = new AgentRegistry();
    const identity = registry.allocate({ taskId: 't1' });

    const wrongSession = registry.rotateSession(identity.agent_id, 'wrong-session');
    assert.equal(wrongSession.ok, false);
    assert.equal(wrongSession.reason, 'session mismatch');

    const correct = registry.rotateSession(identity.agent_id, identity.session);
    assert.equal(correct.ok, true);
  });

  test('wallet binding preserves session', () => {
    const registry = new AgentRegistry();
    const identity = registry.allocate({ taskId: 't1' });
    const originalSession = identity.session;

    const bound = registry.bindWallet(identity.agent_id, {
      agentWallet: WALLET_A,
      kind: 'aawp',
    });
    assert.equal(bound.ok, true);
    assert.equal(bound.identity.session, originalSession, 'session unchanged after bind');
  });
});

// ─── FIXTURE: 2-hop lineage ─────────────────────────────────────────────────────

describe('Fixtures', () => {
  test('2-hop lineage fixture: A→B→inference', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const agentA = recordCollectedSpend(collectedReceipt({
      task_id: 'agent-A-task',
      ref: 'base:0xAgentA',
      amount: '20000',
      model: 'theta/qwen3',
      hub: 'theta',
    }), { ledger, registry });

    ledger.append(collectedReceipt({
      task_id: 'agent-B-task',
      ref: 'base:0xAgentB',
      amount: '15000',
      model: 'akash/llama',
      hub: 'akash',
    }), { agentId: agentA.agent_id, parentRef: 'base:0xAgentA' });

    ledger.append(collectedReceipt({
      task_id: 'inference-task',
      ref: 'base:0xInference',
      amount: '10000',
      model: 'theta/glm4',
      hub: 'theta',
    }), { agentId: agentA.agent_id, parentRef: 'base:0xAgentB' });

    const lineage = queryLineage(agentA.agent_id, 'inference-task', { session: agentA.session }, {
      ledger,
      verify: bindBookVerifier(registry),
    });

    assert.equal(lineage.status, 200);
    assert.equal(lineage.body.depth, 2, '2-hop lineage');
    assert.equal(lineage.body.root.task_id, 'agent-A-task');
    assert.equal(lineage.body.ancestors[0].task_id, 'agent-B-task');
    assert.equal(lineage.body.ancestors[1].task_id, 'agent-A-task');

    const totals = {
      agent_a: lineage.body.ancestors[1].payment.amount,
      agent_b: lineage.body.ancestors[0].payment.amount,
      inference: lineage.body.self.payment.amount,
    };
    assert.equal(totals.agent_a, '20000');
    assert.equal(totals.agent_b, '15000');
    assert.equal(totals.inference, '10000');
  });
});
