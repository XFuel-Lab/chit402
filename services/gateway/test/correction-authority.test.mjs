/**
 * Correction and successor rows name the subject, distinct from the writer
 * and the issuer, inside the signed book_chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { bindBookVerifier } = await import('../src/agent-book.js');
const { recordBookInflow, correctBookInflow } = await import('../src/book-inflow.js');
const { verifyBookSeq } = await import('../src/book-seq.js');

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

test('a correction names the subject and does not call the writer the subject', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const verify = bindBookVerifier(registry);
  const collected = recordCollectedSpend(paid('host-auth', 'base:0xauth'), { ledger, registry });
  assert.equal(collected.entry.authority, undefined);
  recordBookInflow(collected.agent_id, {
    bucket: 'treasury',
    allocation: '10000',
    task_id: 'inflow-auth',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  const corrected = correctBookInflow(collected.agent_id, {
    task_id: 'inflow-auth',
    bucket: 'treasury',
    allocation: '11000',
    reason: 'reclass',
    subject_handle: 'verdigris',
    subject_wallet: '0x2222222222222222222222222222222222222222',
  }, { ledger, registry, verify, claim: { session: collected.session } });
  assert.equal(corrected.status, 200);
  const row = ledger.findByTask(corrected.body.correction_row.task_id);
  assert.equal(row.authority.subject_handle, 'verdigris');
  assert.equal(row.authority.subject_wallet, '0x2222222222222222222222222222222222222222');
  assert.equal(row.authority.writer, 'gateway');
  assert.equal(row.authority.issuer, 'chit402');
  assert.notEqual(row.authority.subject_handle, row.authority.writer);
  assert.notEqual(row.authority.subject_handle, row.authority.issuer);
  const claims = decode(row.book_chain.issuer_signature.jws);
  assert.equal(claims.payload_version, 3);
  assert.equal(claims.authority.subject_handle, 'verdigris');
  assert.equal(claims.authority.writer, 'gateway');
  assert.equal(verifyBookSeq(row.book_chain).valid, true);
  assert.equal(collected.entry.book_chain.payload_version, 2);
});

test('a successor row with parent_ref gets an authority distinct from the issuer', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const parent = recordCollectedSpend(paid('parent-auth', 'base:0xparentauth'), { ledger, registry });
  const child = ledger.append(paid('child-auth', 'base:0xchildauth'), {
    agentId: parent.agent_id,
    parentRef: 'base:0xparentauth',
  });
  assert.equal(child.ok, true);
  assert.equal(child.entry.authority.writer, 'gateway');
  assert.equal(child.entry.authority.issuer, 'chit402');
  assert.equal(child.entry.authority.subject_handle, `agent:${parent.agent_id}`);
  assert.notEqual(child.entry.authority.subject_handle, child.entry.authority.issuer);
});
