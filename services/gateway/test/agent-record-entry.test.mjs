/**
 * New receipts stamp agent_record_entry into the issuer JWS when asked.
 * An existing JWS is not rewritten to add or replace it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { agentRecordEntryClaim, agentRecordEntryFromRequest } = await import('../src/agent-record-entry.js');
const { buildReceipt, decodeReceiptClaims } = await import('../src/receipt.js');
const { jcsCanonicalize } = await import('../src/offer-receipt.js');

const FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const OTHER = 'b4874aa36c769b41b7566cee64c601e4074ff9b57349bfb5f1eb704bfddc1447';

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function paidTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-agent-record-1',
    status: 'completed',
    createdAt: '2026-09-26T17:27:32Z',
    updatedAt: '2026-09-26T17:27:32Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      amount: '2000',
      modelId: 'theta/qwen3',
    },
    meta: {
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      ...(over.meta || {}),
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
    issuerSignature: over.issuerSignature || null,
  };
}

test('a fingerprint claim is the 1F916 object and a bad one is refused', () => {
  const claim = agentRecordEntryClaim(FINGERPRINT);
  assert.equal(claim.fingerprint, FINGERPRINT);
  assert.equal(claim.registry, '1f916');
  assert.equal(claim.fingerprint_alg, '1f916-entry-hash');
  assert.equal(claim.signed, false);
  assert.equal(agentRecordEntryClaim('zz'), null);
  assert.equal(agentRecordEntryClaim({ fingerprint: FINGERPRINT, registry: 'other' }), null);
  const header = agentRecordEntryFromRequest({
    headers: { 'x-chit-agent-record-fingerprint': FINGERPRINT },
    body: {},
  });
  assert.equal(header.error, null);
  assert.equal(header.entry.fingerprint, FINGERPRINT);
  const disagree = agentRecordEntryFromRequest({
    headers: { 'x-chit-agent-record-fingerprint': FINGERPRINT },
    body: { agent_record_entry: { fingerprint: OTHER } },
  });
  assert.match(disagree.error, /disagree/);
  const bad = agentRecordEntryFromRequest({
    headers: { 'x-chit-agent-record-fingerprint': 'nope' },
    body: {},
  });
  assert.match(bad.error, /64 hex/);
});

test('a new receipt stamps the fingerprint into the signed payload and the preimage', () => {
  const receipt = buildReceipt(paidTask({
    meta: { agent_record_entry: { fingerprint: FINGERPRINT } },
  }), { signingSecret: 'agent-record-secret' });
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.agent_record_entry.fingerprint, FINGERPRINT);
  assert.equal(claims.payload_version, 10);
  assert.equal(receipt.agent_record_entry.fingerprint, FINGERPRINT);
  const bytes = receipt.issuer_signature.canonical_preimage;
  assert.equal(sha256(bytes), claims.payload_hash);
  assert.equal(bytes, jcsCanonicalize(JSON.parse(bytes)));
  assert.equal(JSON.parse(bytes).agent_record_entry.fingerprint, FINGERPRINT);
  assert.equal(bytes.includes('payload_hash'), false);
});

test('a receipt that was not asked omits the claim', () => {
  const receipt = buildReceipt(paidTask({ taskId: 'xfuel-agent-record-plain' }));
  const claims = decodeReceiptClaims(receipt);
  assert.equal(claims.agent_record_entry, undefined);
  assert.equal(receipt.agent_record_entry, undefined);
  assert.equal(receipt.issuer_signature.canonical_preimage.includes('agent_record_entry'), false);
});

test('an existing JWS is not re-signed to add or swap the fingerprint', () => {
  const task = paidTask({ taskId: 'xfuel-agent-record-keep' });
  const first = buildReceipt(task, { persistSignature: true });
  const jws = first.issuer_signature.jws;
  assert.equal(decodeReceiptClaims(first).agent_record_entry, undefined);
  task.issuerSignature = first.issuer_signature;
  task.meta.agent_record_entry = { fingerprint: FINGERPRINT };
  const second = buildReceipt(task);
  assert.equal(second.issuer_signature.jws, jws);
  assert.equal(second.agent_record_entry, undefined);
  assert.equal(decodeReceiptClaims(second).agent_record_entry, undefined);

  const stamped = paidTask({
    taskId: 'xfuel-agent-record-stamped',
    meta: { agent_record_entry: { fingerprint: FINGERPRINT } },
  });
  const issued = buildReceipt(stamped, { persistSignature: true });
  const stampedJws = issued.issuer_signature.jws;
  stamped.issuerSignature = issued.issuer_signature;
  stamped.meta.agent_record_entry = { fingerprint: OTHER };
  const again = buildReceipt(stamped);
  assert.equal(again.issuer_signature.jws, stampedJws);
  assert.equal(decodeReceiptClaims(again).agent_record_entry.fingerprint, FINGERPRINT);
  assert.equal(again.agent_record_entry.fingerprint, FINGERPRINT);
});
