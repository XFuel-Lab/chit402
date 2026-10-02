/**
 * claim_id is the book agent_id inside the v8 payment JWS.
 * The HMAC array does not cover it. Lanes without that JWS sign payment_ref
 * on book_chain payload version 4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { buildReceipt, decodeReceiptClaims, canonicalSignedPayload, verifyIssuerForHtml } = await import('../src/receipt.js');
const { UsageSettledLedger, BOOK_EVIDENCE } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { verifyBookSeq } = await import('../src/book-seq.js');
const { signJws } = await import('../src/issuer-key.js');
const { resolvePaidClaimAgent } = await import('../src/claim-id.js');

function paidTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-claim',
    status: 'completed',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
    intent: {
      type: 'inference_request',
      modelId: 'llama-3-70b',
      amount: '2000',
      paymentRail: over.rail || 'usdc',
      paymentRef: over.ref === undefined ? 'base:0x' + 'aa'.repeat(32) : over.ref,
    },
    result: { provider: 'theta-edgecloud', model: 'llama-3-70b' },
    meta: { chain: 'base', provider: 'theta-edgecloud', ...(over.meta || {}) },
  };
}

test('a paid receipt signs claim_id and leaves the v8 HMAC array unchanged', () => {
  const secret = 'claim-secret';
  const withSeat = buildReceipt(paidTask(), { agentId: 42, signingSecret: secret });
  const withoutSeat = buildReceipt(paidTask(), { signingSecret: secret });
  const seated = decodeReceiptClaims(withSeat);
  const bare = decodeReceiptClaims(withoutSeat);
  assert.equal(seated.payload_version, 9);
  assert.equal(seated.claim_id, '42');
  assert.equal(withSeat.claim_id, '42');
  assert.equal(bare.claim_id, null);
  assert.equal(Object.prototype.hasOwnProperty.call(bare, 'claim_id'), true);
  assert.equal(canonicalSignedPayload(withSeat), canonicalSignedPayload(withoutSeat));
  assert.equal(verifyIssuerForHtml(withSeat).verified, true);
  assert.equal(verifyIssuerForHtml(withoutSeat).reason, 'claim_id_missing');
});

test('private desk uses the same claim_id as a native paid call', () => {
  const receipt = buildReceipt(paidTask({
    meta: { privateSpend: true, privacyMode: 'vendor_blind', privacyProduct: 'private_desk' },
  }), { agentId: 9 });
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.claim_id, '9');
  assert.equal(claims.payload_version, 9);
  assert.equal(receipt.privacy.product, 'private_desk');
  assert.equal(verifyIssuerForHtml(receipt).verified, true);
});

test('an unmetered receipt may sign claim_id null', () => {
  const receipt = buildReceipt(paidTask({ ref: null, rail: 'unmetered' }), {});
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.payment.ref, null);
  assert.equal(claims.claim_id, null);
  assert.equal(verifyIssuerForHtml(receipt).verified, true);
});

test('the book id is chosen before the receipt is signed', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const identity = registry.allocate({ taskId: 'seat' });
  ledger.recordIngestStamp({
    agentId: identity.agent_id,
    taskId: 'already',
    paymentRef: 'base:0xalready',
    amount: '2000',
  });
  const resolved = resolvePaidClaimAgent({
    paymentRef: 'base:0xalready',
    taskId: 'already',
    ledger,
    registry,
    sessionAgentId: 99999,
  });
  assert.equal(resolved, identity.agent_id);
  const fresh = resolvePaidClaimAgent({
    paymentRef: 'base:0xnew',
    taskId: 'new-task',
    ledger,
    registry,
  });
  assert.equal(typeof fresh, 'number');
  assert.notEqual(fresh, identity.agent_id);
  const task = paidTask({ taskId: 'new-task', ref: 'base:0xnew' });
  task.meta.agentId = fresh;
  const claims = decodeReceiptClaims(buildReceipt(task, { agentId: fresh }));
  assert.equal(claims.claim_id, String(fresh));
});

test('a board stamp row signs the stamp tx with the poster book', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const identity = registry.allocate({ taskId: 'poster' });
  const stamped = ledger.recordBoardEvent({
    agentId: identity.agent_id,
    kind: 'board_stamp',
    taskId: 'board-stamp-1',
    paymentRef: 'base:0xboardstamp',
    amount: '2000',
    collected: true,
    rail: 'usdc',
  });
  assert.equal(stamped.ok, true);
  assert.equal(stamped.entry.evidence, BOOK_EVIDENCE.BOARD_STAMP);
  assert.equal(stamped.entry.book_chain.payload_version, 4);
  assert.equal(stamped.entry.book_chain.book_id, identity.agent_id);
  assert.equal(stamped.entry.book_chain.payment_ref, 'base:0xboardstamp');
  assert.equal(verifyBookSeq(stamped.entry.book_chain).valid, true);
  const tampered = { ...stamped.entry.book_chain, payment_ref: 'base:0xother' };
  assert.equal(verifyBookSeq(tampered).reason, 'payment_ref_mismatch');
  assert.equal(ledger.sumCollectedByAgent(identity.agent_id), 0n);
});

test('a version 2 book signature without payment_ref still verifies', () => {
  const claims = {
    schema: 'chit402.book_seq.v1',
    payload_version: 2,
    book_id: 3,
    task_id: 'legacy-row',
    seq: 1,
    prev_hash: null,
    row_hash: 'abc',
    event: 'collected',
    act: 'spend',
    replay_of: null,
  };
  const { jws, kid } = signJws(claims, { typ: 'chit402-book-seq+jwt' });
  const signed = {
    ...claims,
    issuer_signature: { alg: 'ES256', jws, kid, payload_version: 2 },
  };
  const result = verifyBookSeq(signed);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.payload.payment_ref, undefined);
});

test('legacy v8 JWS bytes without claim_id are not the claim_id-era format', () => {
  const payload = {
    task_id: 'legacy-v8',
    payload_version: 8,
    payment: { rail: 'usdc', ref: 'base:0xlegacy', gross_amount: '2000' },
  };
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'claim_id'), false);
  const { jws } = signJws(payload);
  const decoded = JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(decoded, 'claim_id'), false);
});
