/**
 * Signed refusal document (chit402.refusal.v1).
 *
 * A policy refusal is not a payment. The issuer signs that it refused, at
 * an anchor, for a code. Changing refusal_code or nonce fails verification.
 * Nothing is charged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger } = await import('../src/usage-settled.js');
const { observeBaseAnchor, ANCHOR_UNAVAILABLE } = await import('../src/refusal-anchor.js');
const {
  verifyRefusalReceipt,
  presentRefusal,
  REFUSAL_SCHEMA,
  REFUSAL_PAYLOAD_VERSION,
} = await import('../src/refusal-receipt.js');
const { RECEIPT_PAYLOAD_VERSION } = await import('../src/receipt.js');
const { getJwks } = await import('../src/issuer-key.js');

function rewritePayload(jws, mutate) {
  const parts = jws.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  mutate(payload);
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}

test('a policy refusal signs a v1 document and does not charge', async () => {
  const prev = process.env.BASE_RPC_URL;
  const prevSettle = process.env.SETTLEMENT_RPC_URL;
  delete process.env.BASE_RPC_URL;
  delete process.env.SETTLEMENT_RPC_URL;
  try {
    const anchor = await observeBaseAnchor();
    assert.equal(anchor.status, ANCHOR_UNAVAILABLE);
    assert.equal(anchor.state_root, null);
    const ledger = new UsageSettledLedger();
    const before = ledger.sumCollectedByAgent(7);
    const recorded = ledger.recordPolicyBlocked({
      agentId: 7,
      taskId: 'blocked-signed',
      policyCode: 'daily_cap_exceeded',
      reason: 'over the daily cap',
      model: 'theta/qwen3',
      hub: 'theta',
      amountRequested: '2000',
      spentAtomic: '100000',
      capAtomic: '50000',
      anchor,
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.amount, null);
    assert.equal(recorded.entry.collected, false);
    assert.equal(ledger.sumCollectedByAgent(7), before);
    const doc = recorded.entry.refusal;
    assert.equal(doc.schema, REFUSAL_SCHEMA);
    assert.equal(doc.payload_version, REFUSAL_PAYLOAD_VERSION);
    assert.equal(doc.kind, 'refusal');
    assert.equal(doc.charged, false);
    assert.equal(doc.amount_charged, '0');
    assert.equal(doc.refusal_code, 'daily_cap_exceeded');
    assert.equal(doc.amount_requested, '2000');
    assert.equal(doc.asset, 'USDC');
    assert.equal(doc.agent_id, 7);
    assert.equal(doc.book_id, 7);
    assert.equal(doc.chain_id, null);
    assert.equal(doc.anchor.status, 'UNAVAILABLE');
    assert.equal(doc.anchor.state_root, null);
    assert.equal(doc.book_row.seq, recorded.entry.seq);
    assert.equal(doc.book_row.task_id, 'blocked-signed');
    assert.equal(doc.book_row.event, 'policy_blocked');
    assert.equal(doc.book_row.row_hash, recorded.entry.row_hash);
    assert.equal(doc.issuer_signature.alg, 'ES256');
    assert.equal(doc.issuer_signature.typ, 'chit402-refusal+jwt');
    assert.equal(verifyRefusalReceipt(doc).valid, true);
    assert.equal(RECEIPT_PAYLOAD_VERSION, 9);
    const found = ledger.findByRefusal(doc.refusal_id);
    assert.equal(found.task_id, 'blocked-signed');
    const again = ledger.recordPolicyBlocked({
      agentId: 7,
      taskId: 'blocked-signed',
      policyCode: 'daily_cap_exceeded',
      reason: 'over the daily cap',
      anchor,
    });
    assert.equal(again.duplicate, true);
    assert.equal(again.entry.refusal.nonce, doc.nonce);
  } finally {
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
    if (prevSettle == null) delete process.env.SETTLEMENT_RPC_URL;
    else process.env.SETTLEMENT_RPC_URL = prevSettle;
  }
});

test('an observed block hash and state root are inside the signature', async () => {
  const prev = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = 'https://base.example/rpc';
  const original = globalThis.fetch;
  const stateRoot = `0x${'cd'.repeat(32)}`;
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const result = body.method === 'eth_chainId'
      ? '0x2105'
      : { number: '0x10', hash: `0x${'ab'.repeat(32)}`, stateRoot };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const anchor = await observeBaseAnchor();
    assert.equal(anchor.chain_id, 8453);
    assert.equal(anchor.state_root, stateRoot);
    const ledger = new UsageSettledLedger();
    const recorded = ledger.recordPolicyBlocked({
      agentId: 4,
      taskId: 'blocked-rooted',
      policyCode: 'kill_switch',
      reason: 'killed',
      anchor,
    });
    const doc = recorded.entry.refusal;
    assert.equal(doc.chain_id, 8453);
    assert.equal(doc.anchor.block_hash, anchor.block_hash);
    assert.equal(doc.anchor.state_root, stateRoot);
    assert.equal(doc.amount_requested, null);
    assert.equal(doc.asset, null);
    assert.equal(verifyRefusalReceipt(doc, getJwks()).valid, true);
    const presented = presentRefusal(doc, 'https://api.chit402.com');
    assert.equal(presented.verify_url, `https://api.chit402.com/refusal/${doc.refusal_id}`);
    assert.equal(verifyRefusalReceipt(presented).valid, true);
  } finally {
    globalThis.fetch = original;
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
  }
});

test('changing refusal_code or nonce fails verification', () => {
  const ledger = new UsageSettledLedger();
  const recorded = ledger.recordPolicyBlocked({
    agentId: 3,
    taskId: 'blocked-tamper',
    policyCode: 'hourly_cap_exceeded',
    reason: 'over the hour',
    amountRequested: '2000',
  });
  const doc = recorded.entry.refusal;
  assert.equal(verifyRefusalReceipt(doc).valid, true);

  const coded = { ...doc, refusal_code: 'kill_switch' };
  const codeResult = verifyRefusalReceipt(coded);
  assert.equal(codeResult.valid, false);
  assert.equal(codeResult.reason, 'refusal_code_mismatch');

  const nonced = { ...doc, nonce: 'f'.repeat(32) };
  const nonceResult = verifyRefusalReceipt(nonced);
  assert.equal(nonceResult.valid, false);
  assert.equal(nonceResult.reason, 'nonce_mismatch');

  const rewritten = {
    ...doc,
    refusal_code: 'kill_switch',
    issuer_signature: {
      ...doc.issuer_signature,
      jws: rewritePayload(doc.issuer_signature.jws, (payload) => {
        payload.refusal_code = 'kill_switch';
      }),
    },
  };
  const rewrittenCode = verifyRefusalReceipt(rewritten);
  assert.equal(rewrittenCode.valid, false);
  assert.equal(rewrittenCode.reason, 'signature_invalid');

  const rewrittenNonce = {
    ...doc,
    nonce: 'ab'.repeat(16),
    issuer_signature: {
      ...doc.issuer_signature,
      jws: rewritePayload(doc.issuer_signature.jws, (payload) => {
        payload.nonce = 'ab'.repeat(16);
      }),
    },
  };
  const nonceSig = verifyRefusalReceipt(rewrittenNonce);
  assert.equal(nonceSig.valid, false);
  assert.equal(nonceSig.reason, 'signature_invalid');
});

test('dropping the outer schema still verifies the signed refusal', () => {
  const ledger = new UsageSettledLedger();
  const doc = {
    ...ledger.recordPolicyBlocked({
      agentId: 2,
      taskId: 'blocked-outer-schema',
      policyCode: 'kill_switch',
      reason: 'killed',
    }).entry.refusal,
  };
  delete doc.schema;
  const result = verifyRefusalReceipt(doc);
  assert.equal(result.valid, true);
  assert.equal(result.refusal_code, 'kill_switch');
  const rewritten = { ...doc, schema: 'xfuel.receipt.v4' };
  assert.equal(verifyRefusalReceipt(rewritten).reason, 'schema_mismatch');
});

test('a refusal that claims a charge does not verify', () => {
  const ledger = new UsageSettledLedger();
  const doc = ledger.recordPolicyBlocked({
    agentId: 2,
    taskId: 'blocked-charge',
    policyCode: 'kill_switch',
    reason: 'killed',
  }).entry.refusal;
  const charged = { ...doc, charged: true };
  assert.equal(verifyRefusalReceipt(charged).reason, 'charged_not_zero');
});
