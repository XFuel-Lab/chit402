/**
 * nak_nanaz acceptance seats (#4246): treasury-grade receipt idempotent replay
 * + path-rotation prove (payer_wallet ↔ payment.ref survives session rotate).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.TASK_STORE_PERSIST = 'false';

const { AgentRegistry, registerAgent } = await import('../src/agent-registry.js');
const {
  UsageSettledLedger,
  recordCollectedSpend,
  recordSettleBookRow,
  SETTLEMENT_STATUS,
} = await import('../src/usage-settled.js');
const {
  readAgentBook,
  bindBookVerifier,
  exportAgentBook,
  buildBookExportCsv,
  buildBookAuditPack,
  totalsOf,
} = await import('../src/agent-book.js');
const { BookPolicyStore, POLICY_TYPES, enforcePolicy } = await import('../src/book-policy.js');
const { buildVerifyUrl } = await import('../src/receipt.js');
const { canonicalSignedPayload, verifyReceiptHmac } = await import('../src/receipt.js');

const VERIFY_KEY = 'nak-nanaz-test-hmac';
const PAYER = '0xabcdef1234567890abcdef1234567890abcdef12';
const WALLET = '0x1111111111111111111111111111111111111111';

function sign(receipt, secret = VERIFY_KEY) {
  const value = crypto.createHmac('sha256', secret).update(canonicalSignedPayload(receipt)).digest('hex');
  receipt.hmac_attestation = { alg: 'HMAC-SHA256', payload_version: 5, value: `sha256=${value}`, role: 'attestor' };
  return receipt;
}

function collectedReceipt(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id || 'task-nak-1',
    status: 'completed',
    proof_outcome: 'valid',
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || 'base:0xnakabc',
      collected: true,
      gross_amount: over.amount || '10000',
    },
    route: { model: over.model || 'xfuel/auto', hub: over.hub || 'mock' },
    caller_binding: over.caller_binding || { payer_wallet: PAYER },
    ...over,
  };
}

describe('A) Idempotent replay classification', () => {
  test('first settle collects; second same payment.ref returns idempotent_replay', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const first = recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-first',
      ref: 'base:0xidem1',
      amount: '10000',
    }), { ledger, registry, payer: PAYER });
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(first.settlement_status, SETTLEMENT_STATUS.SETTLED);
    assert.equal(first.idempotent_replay, false);
    assert.equal(first.replay_of, null);
    assert.equal(ledger.entries.length, 1);

    const second = recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-first',
      ref: 'base:0xidem1',
      amount: '10000',
    }), { ledger, registry, payer: PAYER, agentId: first.agent_id });
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.idempotent_replay, true);
    assert.equal(second.settlement_status, SETTLEMENT_STATUS.IDEMPOTENT_REPLAY);
    assert.equal(second.replay_of, 'xfuel-first');
    assert.equal(ledger.entries.length, 1, 'no second row');

    const book = readAgentBook(first.agent_id, { session: second.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.status, 200);
    assert.equal(book.body.totals.usdc_sum, '10000', 'amount not double-counted');
    const row = book.body.entries.find((e) => e.task_id === 'xfuel-first');
    assert.equal(row.payer_wallet, PAYER);
    assert.equal(row.replay_count, 1);
    assert.equal(row.replay_events[0].replay_of, 'xfuel-first');
    assert.equal(row.replay_events[0].settlement_status, SETTLEMENT_STATUS.IDEMPOTENT_REPLAY);
  });

  test('recordSettleBookRow replay does not double-count under daily cap', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const policy = new BookPolicyStore();

    const first = recordSettleBookRow({
      taskId: 'xfuel-cap-1',
      paymentRef: 'base:0xcap1',
      amount: '50000',
      payer: PAYER,
      ledger,
      registry,
    });
    policy.set(first.agent_id, POLICY_TYPES.DAILY_CAP, '60000');

    const replay = recordSettleBookRow({
      taskId: 'xfuel-cap-1',
      paymentRef: 'base:0xcap1',
      amount: '50000',
      payer: PAYER,
      ledger,
      registry,
      agentId: first.agent_id,
    });
    assert.equal(replay.settlement_status, SETTLEMENT_STATUS.IDEMPOTENT_REPLAY);
    assert.equal(replay.replay_of, 'xfuel-cap-1');

    const capCheck = enforcePolicy(first.agent_id, { amount: '20000' }, { policy, ledger });
    assert.equal(capCheck.allowed, false, 'cap sees one settle, not two');
    assert.equal(capCheck.code, 'daily_cap_exceeded');
  });

  test('register re-submit classifies idempotent_replay with replay_of link', async () => {
    const receipt = sign(collectedReceipt({ task_id: 'task-reg-replay', ref: 'base:0xregreplay' }));
    const store = new Map([[receipt.task_id, receipt]]);
    const deps = {
      registry: new AgentRegistry(),
      ledger: new UsageSettledLedger(),
      loadReceipt: async (id) => store.get(id) || null,
      verify: (r) => verifyReceiptHmac(r, VERIFY_KEY, { sigField: 'hmac_attestation' }),
      bindWallet: async (w) => ({ ok: true, address: w, kind: 'aawp', official: true }),
      postA2A: async (fields) => ({ message_id: 'a2a', status: 'accepted', ...fields }),
    };

    const first = await registerAgent({ agentWallet: WALLET, task_id: receipt.task_id }, deps);
    assert.equal(first.ok, true);
    assert.equal(first.body.settlement_status, SETTLEMENT_STATUS.SETTLED);
    assert.equal(first.body.idempotent_replay, false);

    const second = await registerAgent({ agentWallet: WALLET, task_id: receipt.task_id }, deps);
    assert.equal(second.ok, true);
    assert.equal(second.body.settlement_status, SETTLEMENT_STATUS.IDEMPOTENT_REPLAY);
    assert.equal(second.body.idempotent_replay, true);
    assert.equal(second.body.replay_of, 'task-reg-replay');
    assert.equal(deps.ledger.entries.length, 1);
  });

  test('export shows replay_count and payer_wallet without double-count', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const first = recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-export',
      ref: 'base:0xexport1',
      amount: '8000',
    }), { ledger, registry, payer: PAYER, intentId: 'intent-a', attemptIndex: 0 });
    recordCollectedSpend(collectedReceipt({
      task_id: 'xfuel-export',
      ref: 'base:0xexport1',
      amount: '8000',
    }), { ledger, registry, payer: PAYER, agentId: first.agent_id });

    const exported = exportAgentBook(first.agent_id, { session: first.session, format: 'json' }, {
      ledger,
      verify: bindBookVerifier(registry),
      baseUrl: 'https://api.chit402.com',
    });
    const row = exported.body.rows.find((r) => r.task_id === 'xfuel-export');
    assert.equal(row.payer_wallet, PAYER);
    assert.equal(row.intent_id, 'intent-a');
    assert.equal(row.attempt_index, 0);
    assert.equal(row.replay_count, 1);
    assert.equal(exported.body.totals.usdc_sum, '8000');

    const csv = buildBookExportCsv(ledger.listByAgent(first.agent_id), first.agent_id, 'https://api.chit402.com');
    assert.match(csv, /xfuel-export,.*,8000,base:0xexport1/);
    assert.match(csv, /,1,https:\/\/api\.chit402\.com\/receipt\/xfuel-export/);

    const pack = buildBookAuditPack(ledger.listByAgent(first.agent_id), first.agent_id, 'https://api.chit402.com');
    assert.equal(pack.rows[0].replay_events?.[0]?.replay_of, 'xfuel-export');
  });
});

describe('B) Path-rotation prove', () => {
  test('payer_wallet ↔ payment.ref survives session rotate on book + export', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();

    const recorded = recordCollectedSpend(collectedReceipt({
      task_id: 'task-rotate-bind',
      ref: 'base:0xrotatebind',
      amount: '12000',
    }), { ledger, registry, payer: PAYER });

    const bookBefore = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    const rowBefore = bookBefore.body.entries[0];
    assert.equal(rowBefore.payer_wallet, PAYER);
    assert.equal(rowBefore.payment.ref, 'base:0xrotatebind');

    const rotated = registry.rotateSession(recorded.agent_id, recorded.session);
    assert.equal(rotated.ok, true);

    const bookAfter = readAgentBook(recorded.agent_id, { session: rotated.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(bookAfter.status, 200);
    const rowAfter = bookAfter.body.entries.find((e) => e.task_id === 'task-rotate-bind');
    assert.equal(rowAfter.payer_wallet, PAYER, 'payer binding survives rotate');
    assert.equal(rowAfter.payment.ref, 'base:0xrotatebind');
    assert.equal(bookAfter.body.totals.usdc_sum, '12000');

    const exported = exportAgentBook(recorded.agent_id, { session: rotated.session, format: 'json' }, {
      ledger,
      verify: bindBookVerifier(registry),
      baseUrl: 'https://api.chit402.com',
    });
    const exportRow = exported.body.rows.find((r) => r.task_id === 'task-rotate-bind');
    assert.equal(exportRow.payer_wallet, PAYER);
    assert.equal(exportRow.payment_ref, 'base:0xrotatebind');
    assert.equal(exportRow.verify_url, buildVerifyUrl('https://api.chit402.com', 'task-rotate-bind'));
  });

  test('register then rotate: possession session changes, ledger bind unchanged', async () => {
    const receipt = sign(collectedReceipt({
      task_id: 'task-reg-rotate',
      ref: 'base:0xregrotate',
    }));
    const store = new Map([[receipt.task_id, receipt]]);
    const registry = new AgentRegistry();
    const ledger = new UsageSettledLedger();
    const deps = {
      registry,
      ledger,
      loadReceipt: async (id) => store.get(id) || null,
      verify: (r) => verifyReceiptHmac(r, VERIFY_KEY, { sigField: 'hmac_attestation' }),
      bindWallet: async (w) => ({ ok: true, address: w, kind: 'aawp', official: true }),
      postA2A: async () => ({ status: 'accepted' }),
    };

    const registered = await registerAgent({ agentWallet: WALLET, task_id: receipt.task_id }, deps);
    assert.equal(registered.ok, true);
    const oldSession = registered.body.session;

    const rotated = registry.rotateSession(registered.body.agent_id, oldSession);
    assert.equal(rotated.ok, true);

    const book = readAgentBook(registered.body.agent_id, { session: rotated.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.status, 200);
    const row = book.body.entries[0];
    assert.equal(row.payer_wallet, WALLET);
    assert.equal(row.payment.ref, 'base:0xregrotate');
    assert.equal(totalsOf(ledger.listByAgent(registered.body.agent_id)).usdc_sum, '10000');
  });
});
