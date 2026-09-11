/**
 * Intent / retry grouping + live policy_blocked mid-burn.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-intent-policy-'));

process.env.RECEIPT_SIGNING_SECRET = 'test-intent-policy-secret';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'true';
process.env.X402_METER_V1 = 'true';
process.env.X402_PAY_TO = '0xBasetreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.TASK_STORE_PERSIST = 'false';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.M2M_API_KEYS = '';
process.env.M2M_DEMO_MODE = 'true';
process.env.OPENAI_GATEWAY_ALLOW_FALLBACK = 'true';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

function createMockFacilitator() {
  let settleCount = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad_json' }); }
      const isStandardX402 = !!parsed.paymentPayload;
      const payer = parsed.paymentPayload?.payload?.authorization?.from || '0xmockpayer';
      const network = parsed.paymentRequirements?.network || 'base';
      const txRef = `0xintentmock${String(settleCount).padStart(52, '0')}`;
      if (req.url?.endsWith('/verify')) {
        if (isStandardX402) return send(200, { isValid: true, payer });
        return send(200, { valid: true, txRef });
      }
      if (req.url?.endsWith('/settle')) {
        settleCount += 1;
        if (isStandardX402) return send(200, { success: true, transaction: txRef, network, payer });
        return send(200, { settled: true, txRef });
      }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        settleCount: () => settleCount,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const { url: facUrl, close: closeFac, settleCount } = await createMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { AgentRegistry } = await import('../src/agent-registry.js');
const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const {
  readAgentBook,
  bindBookVerifier,
  queryLineage,
  groupEntriesByIntent,
  buildBookExportCsv,
  buildBookAuditPack,
} = await import('../src/agent-book.js');
const { BookPolicyStore, POLICY_TYPES, enforcePolicy, currentHourStartUTC } = await import('../src/book-policy.js');
const { extractIntentMeta, resolveIntentFields } = await import('../src/intent-meta.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');

const chatBody = {
  model: 'theta/qwen3',
  messages: [{ role: 'user', content: 'intent test' }],
  max_tokens: 8,
};

function collectedReceipt(over = {}) {
  return {
    schema: 'xfuel.receipt.v4',
    task_id: over.task_id || `task-${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    proof_outcome: 'valid',
    payment: {
      rail: over.rail || 'usdc',
      ref: over.ref || `base:0x${Math.random().toString(16).slice(2)}`,
      collected: true,
      gross_amount: over.amount || '2000',
    },
    route: { model: over.model || 'theta/qwen3', hub: over.hub || 'theta' },
    output: { hash: '0x' + 'ab'.repeat(32) },
  };
}

let server;
let base;

before(async () => {
  resetHubCatalogCache();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await closeFac();
});

async function issueChallenge() {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  return body.accepts[0].extra.nonce;
}

async function settlePaid(headers = {}, body = chatBody) {
  const nonce = await issueChallenge();
  const before = settleCount();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': 'PAYMENT-BLOB',
      'x-payment-nonce': nonce,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, body: json, settles: settleCount() - before };
}

describe('Intent / retry grouping', () => {
  test('explicit intent_id and attempt_index stored on ledger row', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 't-int-1', ref: 'base:0xi1' }), {
      ledger,
      registry,
      intentId: 'intent-abc',
      attemptIndex: 0,
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.intent_id, 'intent-abc');
    assert.equal(recorded.entry.attempt_index, 0);

    const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.status, 200);
    assert.equal(book.body.entries[0].intent_id, 'intent-abc');
    assert.equal(book.body.entries[0].attempt_index, 0);
    assert.ok(book.body.intents?.['intent-abc']);
    assert.equal(book.body.intents['intent-abc'].collected_count, 1);
  });

  test('N hops share one intent_id in book intents map', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const intentId = 'intent-shared-1';
    const first = recordCollectedSpend(collectedReceipt({ task_id: 't-a0', ref: 'base:0xa0' }), {
      ledger, registry, intentId, attemptIndex: 0,
    });
    recordCollectedSpend(collectedReceipt({ task_id: 't-a1', ref: 'base:0xa1' }), {
      ledger,
      registry,
      agentId: first.agent_id,
      intentId,
      attemptIndex: 1,
    });
    recordCollectedSpend(collectedReceipt({ task_id: 't-a2', ref: 'base:0xa2' }), {
      ledger,
      registry,
      agentId: first.agent_id,
      intentId,
      attemptIndex: 2,
    });

    const book = readAgentBook(first.agent_id, { session: first.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    assert.equal(book.body.entries.length, 3);
    const group = book.body.intents[intentId];
    assert.equal(group.attempts.length, 3);
    assert.equal(group.collected_count, 3);
    assert.equal(group.blocked_count, 0);
  });

  test('resolveIntentFields generates intent_id when attempt metadata present', () => {
    const ledger = new UsageSettledLedger();
    const meta = extractIntentMeta({
      headers: { 'x-xfuel-attempt': '1' },
      body: {},
    });
    assert.equal(meta.intentId, null);
    assert.equal(meta.attemptIndex, 1);
    assert.equal(meta.hasAttemptMeta, true);
    const fields = resolveIntentFields(meta, ledger, 1);
    assert.ok(fields.intent_id?.startsWith('intent-'));
    assert.equal(fields.attempt_index, 1);
  });

  test('lineage includes intent_attempts when intent_id present', () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const intentId = 'intent-lineage';
    const first = recordCollectedSpend(collectedReceipt({ task_id: 'lin-0', ref: 'base:0xl0' }), {
      ledger, registry, intentId, attemptIndex: 0,
    });
    recordCollectedSpend(collectedReceipt({ task_id: 'lin-1', ref: 'base:0xl1' }), {
      ledger, registry, agentId: first.agent_id, intentId, attemptIndex: 1,
    });

    const result = queryLineage(first.agent_id, 'lin-1', { session: first.session }, {
      ledger,
      verify: bindBookVerifier(registry),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.intent_id, intentId);
    assert.equal(result.body.intent_attempts.length, 2);
  });

  test('groupEntriesByIntent aggregates collected and blocked', () => {
    const ledger = new UsageSettledLedger();
    ledger.recordPolicyBlocked({
      agentId: 1,
      taskId: 'block-1',
      policyCode: 'kill_switch',
      reason: 'kill switch active',
      intentId: 'intent-mix',
      attemptIndex: 1,
    });
    ledger.append(collectedReceipt({ task_id: 'col-1', ref: 'base:0xc1' }), {
      agentId: 1,
      intentId: 'intent-mix',
      attemptIndex: 0,
    });
    const groups = groupEntriesByIntent(ledger.listByAgent(1));
    assert.equal(groups['intent-mix'].collected_count, 1);
    assert.equal(groups['intent-mix'].blocked_count, 1);
  });
});

describe('policy_blocked mid-burn', () => {
  test('kill_switch blocks next hop: no settle + book row', async () => {
    const first = await settlePaid();
    assert.equal(first.settles, 1);
    const agentId = first.body.xfuel?.agent_id;
    const session = first.body.xfuel?.session;
    assert.ok(agentId && session);

    const policyRes = await fetch(`${base}/v1/agents/${agentId}/book/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, policy_type: 'kill_switch', value: true }),
    });
    assert.equal(policyRes.status, 200);

    const beforeSettle = settleCount();
    const blocked = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-payment': 'PAYMENT-BLOB',
        'x-payment-nonce': await issueChallenge(),
        'x-xfuel-session': session,
        'x-xfuel-intent': 'intent-kill-test',
        'x-xfuel-attempt': '1',
      },
      body: JSON.stringify(chatBody),
    });
    assert.equal(blocked.status, 403);
    const err = await blocked.json();
    assert.equal(err.error?.type, 'policy_blocked');
    assert.equal(err.error?.code, 'kill_switch');
    assert.equal(settleCount() - beforeSettle, 0, 'must not settle');

    const book = await (await fetch(`${base}/v1/agents/${agentId}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session }),
    })).json();

    const blockedRow = book.entries.find((e) => e.event === 'policy_blocked');
    assert.ok(blockedRow, 'book must show policy_blocked row');
    assert.equal(blockedRow.policy_code, 'kill_switch');
    assert.equal(blockedRow.intent_id, 'intent-kill-test');
    assert.equal(blockedRow.attempt_index, 1);
    assert.equal(blockedRow.collected, false);
  });

  test('hourly cap mid-sequence: policy_blocked without charge + counter fields', async () => {
    const ledger = new UsageSettledLedger();
    const registry = new AgentRegistry();
    const policy = new BookPolicyStore();
    const recorded = recordCollectedSpend(collectedReceipt({ task_id: 'cap-base', ref: 'base:0xcapbase', amount: '50000' }), {
      ledger, registry,
    });
    policy.set(recorded.agent_id, POLICY_TYPES.HOURLY_CAP, '60000');

    const policyCheck = enforcePolicy(recorded.agent_id, { amount: '20000' }, { policy, ledger });
    assert.equal(policyCheck.allowed, false);
    assert.equal(policyCheck.code, 'hourly_cap_exceeded');
    assert.equal(policyCheck.policy_key, POLICY_TYPES.HOURLY_CAP);
    assert.equal(policyCheck.spent_atomic, '50000');
    assert.equal(policyCheck.cap_atomic, '60000');
    assert.equal(policyCheck.period_start, currentHourStartUTC());

    ledger.recordPolicyBlocked({
      agentId: recorded.agent_id,
      taskId: 'cap-block-task',
      policyCode: policyCheck.code,
      reason: policyCheck.reason,
      model: 'theta/qwen3',
      hub: 'theta',
      policyKey: policyCheck.policy_key,
      spentAtomic: policyCheck.spent_atomic,
      capAtomic: policyCheck.cap_atomic,
      periodStart: policyCheck.period_start,
    });

    const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
      ledger,
      verify: bindBookVerifier(registry),
      registry,
    });
    const blocked = book.body.entries.find((e) => e.event === 'policy_blocked');
    assert.ok(blocked);
    assert.equal(blocked.policy_code, 'hourly_cap_exceeded');
    assert.equal(blocked.policy_key, 'hourly_cap');
    assert.equal(blocked.spent_atomic, '50000');
    assert.equal(blocked.cap_atomic, '60000');
    assert.equal(blocked.period_start, currentHourStartUTC());
    assert.equal(book.body.spent, '50000', 'blocked hop must not increase spent');

    const entries = ledger.listByAgent(recorded.agent_id);
    const csv = buildBookExportCsv(entries, recorded.agent_id, 'https://api.chit402.com');
    assert.match(csv, /policy_key,spent_atomic,cap_atomic,period_start/);
    assert.match(csv, /hourly_cap,50000,60000/);

    const pack = buildBookAuditPack(entries, recorded.agent_id, 'https://api.chit402.com');
    const auditRow = pack.rows.find((r) => r.task_id === 'cap-block-task');
    assert.equal(auditRow.policy_key, 'hourly_cap');
    assert.equal(auditRow.spent_atomic, '50000');
    assert.equal(auditRow.cap_atomic, '60000');
    assert.equal(auditRow.period_start, currentHourStartUTC());
  });
});
