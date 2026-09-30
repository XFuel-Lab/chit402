/**
 * Policy refusals record the observed Base block, and still append when the
 * RPC cannot be read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { UsageSettledLedger } = await import('../src/usage-settled.js');
const { observeBaseAnchor, ANCHOR_UNAVAILABLE } = await import('../src/refusal-anchor.js');
const { verifyBookSeq } = await import('../src/book-seq.js');

function decode(jws) {
  const payload = jws.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

test('a refusal with no RPC is UNAVAILABLE and still appends', async () => {
  const prev = process.env.BASE_RPC_URL;
  const prevSettle = process.env.SETTLEMENT_RPC_URL;
  delete process.env.BASE_RPC_URL;
  delete process.env.SETTLEMENT_RPC_URL;
  try {
    const anchor = await observeBaseAnchor();
    assert.equal(anchor.status, ANCHOR_UNAVAILABLE);
    const ledger = new UsageSettledLedger();
    const recorded = ledger.recordPolicyBlocked({
      agentId: 7,
      taskId: 'blocked-no-rpc',
      policyCode: 'kill_switch',
      reason: 'killed',
      anchor,
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.anchor.status, 'UNAVAILABLE');
    assert.equal(recorded.entry.event, 'policy_blocked');
    const claims = decode(recorded.entry.book_chain.issuer_signature.jws);
    assert.equal(claims.anchor.status, 'UNAVAILABLE');
    assert.equal(verifyBookSeq(recorded.entry.book_chain).valid, true);
  } finally {
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
    if (prevSettle == null) delete process.env.SETTLEMENT_RPC_URL;
    else process.env.SETTLEMENT_RPC_URL = prevSettle;
  }
});

test('a refusal signs the observed block hash', async () => {
  const prev = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = 'https://base.example/rpc';
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const result = body.method === 'eth_chainId'
      ? '0x2105'
      : { number: '0x10', hash: '0x' + 'ab'.repeat(32) };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const anchor = await observeBaseAnchor();
    assert.equal(anchor.status, 'observed');
    assert.equal(anchor.chain_id, 8453);
    assert.equal(anchor.block_number, '16');
    const ledger = new UsageSettledLedger();
    const recorded = ledger.recordPolicyBlocked({
      agentId: 7,
      taskId: 'blocked-anchored',
      policyCode: 'daily_cap_exceeded',
      reason: 'over cap',
      anchor,
    });
    assert.equal(recorded.ok, true);
    const claims = decode(recorded.entry.book_chain.issuer_signature.jws);
    assert.equal(claims.anchor.block_hash, anchor.block_hash);
    assert.equal(claims.anchor.chain_id, 8453);
    assert.equal(verifyBookSeq(recorded.entry.book_chain).valid, true);
  } finally {
    globalThis.fetch = original;
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
  }
});

test('an RPC failure does not fail the refusal', async () => {
  const prev = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = 'https://base.example/rpc';
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };
  try {
    const anchor = await observeBaseAnchor();
    assert.equal(anchor.status, 'UNAVAILABLE');
    const ledger = new UsageSettledLedger();
    const recorded = ledger.recordPolicyBlocked({
      agentId: 3,
      taskId: 'blocked-rpc-down',
      policyCode: 'kill_switch',
      reason: 'killed',
      anchor,
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.anchor.status, 'UNAVAILABLE');
    assert.match(recorded.entry.anchor.reason, /connection refused/);
  } finally {
    globalThis.fetch = original;
    if (prev == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
  }
});
