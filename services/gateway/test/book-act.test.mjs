/**
 * Each book row has an explicit act inside the signed book_chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { verifyBookSeq } = await import('../src/book-seq.js');

function decode(jws) {
  return JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
}

test('spend, refusal, and correction rows carry signed acts', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const spent = recordCollectedSpend({
    schema: 'xfuel.receipt.v4',
    task_id: 'act-spend',
    payment: { rail: 'usdc', ref: 'base:0xact', collected: true, gross_amount: '2000' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  }, { ledger, registry });
  assert.equal(spent.entry.act, 'spend');
  const spendClaims = decode(spent.entry.book_chain.issuer_signature.jws);
  assert.equal(spendClaims.act, 'spend');
  assert.equal(spendClaims.payload_version, 2);
  assert.equal(verifyBookSeq(spent.entry.book_chain).valid, true);

  const blocked = ledger.recordPolicyBlocked({
    agentId: spent.agent_id,
    taskId: 'act-block',
    policyCode: 'kill_switch',
    reason: 'killed',
    anchor: { status: 'UNAVAILABLE', rail: 'base', chain_id: null, block_number: null, block_hash: null, reason: 'no_rpc' },
  });
  assert.equal(blocked.entry.act, 'refusal');
  assert.equal(decode(blocked.entry.book_chain.issuer_signature.jws).act, 'refusal');

  ledger._index({
    task_id: 'act-fix',
    agent_id: spent.agent_id,
    event: 'inflow_correction',
    evidence: 'inflow_correction',
    collected: false,
    collected_at: new Date().toISOString(),
  });
  const fix = ledger.findByTask('act-fix');
  assert.equal(fix.act, 'correction');
  assert.equal(decode(fix.book_chain.issuer_signature.jws).act, 'correction');
});
