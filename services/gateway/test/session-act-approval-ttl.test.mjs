/**
 * SessionAct approval_ttl + risk-tier re-challenge.
 *
 * Acceptance: same session, low-blast passes; high-blast after TTL →
 * challenge or policy_blocked on book.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const {
  buildAuthorizeTypedData,
  acceptDelegationProof,
  getSessionStore,
} = await import('../src/session-delegation.js');
const {
  buildSessionActTypedData,
  SessionActChallengeStore,
  getSessionActStore,
  _resetSessionActStore,
} = await import('../src/session-act.js');
const {
  getSessionActApprovalStore,
  resetSessionActApprovalStore,
} = await import('../src/book-policy.js');
const { buildReceipt } = await import('../src/receipt.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');

const PAYER = Wallet.createRandom();
const AGENT = Wallet.createRandom();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

let _nonce = 0;
function uniqueNonce() {
  _nonce += 1;
  return `0x${_nonce.toString(16).padStart(2, '0').repeat(32)}`.slice(0, 66);
}

async function bindSession() {
  const typed = buildAuthorizeTypedData({
    agentPubkey: AGENT.address,
    validAfter: nowSec() - 60,
    validUntil: nowSec() + 3600,
    maxCumulativeSpend: 1_000_000n,
    allowedRoutes: ['/v1/chat/completions'],
    nonce: uniqueNonce(),
  });
  const signature = await PAYER.signTypedData(typed.domain, typed.types, typed.message);
  const accepted = acceptDelegationProof({ signature, typed_data: typed });
  assert.equal(accepted.ok, true);
  return { typed, signature, session: accepted.session };
}

function usdcTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-ttl-parent',
    status: 'completed',
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      model: 'theta/qwen3',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'cd'.repeat(32),
      amount: '100000',
    },
    feeAmount: '500',
    netAmount: '99500',
    feeBps: 50,
    meta: {
      chain: 'base',
      provider: 'theta-edgecloud',
      payerWallet: PAYER.address,
      ...(over.meta || {}),
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
    ...over,
  };
}

async function signAct(challenge, { action, resource, signer = AGENT, deadline = null } = {}) {
  const typed = buildSessionActTypedData({
    delegationHash: challenge.delegation_hash,
    nonce: challenge.nonce,
    action,
    resource,
    deadline: deadline ?? challenge.expires_at,
  });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  return { typed, signature };
}

describe('SessionAct approval_ttl HTTP', () => {
  let server;
  let base;
  let agentId;
  let possessionSession;

  before(async () => {
    _resetSessionActStore();
    resetSessionActApprovalStore();
    resetHubCatalogCache();
    await initAIListener();
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const listener = getAIListener();
    const regTask = usdcTask({ taskId: 'xfuel-ttl-register' });
    listener.activeTasks.set(regTask.taskId, regTask);
    buildReceipt(regTask, { persistSignature: true, payerWallet: PAYER.address });

    const regRes = await fetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: regTask.taskId, agent_wallet: AGENT.address }),
    });
    assert.equal(regRes.status, 200);
    const regBody = await regRes.json();
    agentId = regBody.agent_id;
    possessionSession = regBody.session;

    const policyRes = await fetch(`${base}/v1/agents/${agentId}/book/policy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-XFuel-Session': possessionSession,
      },
      body: JSON.stringify({
        session: possessionSession,
        policy_type: 'approval_ttl',
        value: 120,
      }),
    });
    assert.equal(policyRes.status, 200);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function putBoundSession() {
    const bound = await bindSession();
    getSessionStore().put(bound.session);
    return bound;
  }

  async function challengeFor(session, body = {}) {
    const res = await fetch(`${base}/v1/sessions/${session.delegation_hash}/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, json: await res.json() };
  }

  test('within TTL: 1-shot high-blast handoff succeeds after challenge approval', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-ttl-within' });
    listener.activeTasks.set(parent.taskId, parent);

    const { json: ch } = await challengeFor(session, { resource: parent.taskId });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'handoff', resource: parent.taskId });

    const first = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
      }),
    });
    assert.equal(first.status, 201);

    const nonce = uniqueNonce();
    const deadline = nowSec() + 90;
    const oneshot = await signAct({
      delegation_hash: session.delegation_hash,
      nonce,
      expires_at: deadline,
    }, { action: 'handoff', resource: parent.taskId });

    const parent2 = usdcTask({ taskId: 'xfuel-ttl-within-2' });
    listener.activeTasks.set(parent2.taskId, parent2);
    const oneshotTyped = buildSessionActTypedData({
      delegationHash: session.delegation_hash,
      nonce,
      action: 'handoff',
      resource: parent2.taskId,
      deadline,
    });
    const oneshotSig = await AGENT.signTypedData(oneshotTyped.domain, oneshotTyped.types, oneshotTyped.message);

    const second = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent2.taskId,
        signature: oneshotSig,
        nonce,
        deadline,
        typed_data: oneshotTyped,
      }),
    });
    assert.equal(second.status, 201);
  });

  test('after TTL: 1-shot high-blast blocked with policy_blocked on book', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-ttl-expired' });
    listener.activeTasks.set(parent.taskId, parent);

    getSessionActApprovalStore().recordHighBlast(session.delegation_hash, nowSec() - 300);

    const nonce = uniqueNonce();
    const deadline = nowSec() + 90;
    const typed = buildSessionActTypedData({
      delegationHash: session.delegation_hash,
      nonce,
      action: 'handoff',
      resource: parent.taskId,
      deadline,
    });
    const signature = await AGENT.signTypedData(typed.domain, typed.types, typed.message);

    const blocked = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature,
        nonce,
        deadline,
        typed_data: typed,
      }),
    });
    assert.equal(blocked.status, 403);
    const body = await blocked.json();
    assert.equal(body.error, 'policy_blocked');
    assert.equal(body.code, 'approval_ttl_expired');
    assert.ok(body.task_id);

    const bookRes = await fetch(`${base}/v1/agents/${agentId}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: possessionSession, limit: 20 }),
    });
    assert.equal(bookRes.status, 200);
    const book = await bookRes.json();
    const row = book.entries.find((e) => e.task_id === body.task_id);
    assert.ok(row);
    assert.equal(row.evidence, 'policy_blocked');
    assert.equal(row.policy_code, 'approval_ttl_expired');
  });

  test('after TTL: low-blast read_private still succeeds via 1-shot', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const task = usdcTask({
      taskId: 'xfuel-ttl-read',
      meta: { payerWallet: PAYER.address, session },
    });
    listener.activeTasks.set(task.taskId, task);
    buildReceipt(task, { persistSignature: true, payerWallet: PAYER.address });

    getSessionActApprovalStore().recordHighBlast(session.delegation_hash, nowSec() - 300);

    const nonce = uniqueNonce();
    const deadline = nowSec() + 90;
    const typed = buildSessionActTypedData({
      delegationHash: session.delegation_hash,
      nonce,
      action: 'read_private',
      resource: task.taskId,
      deadline,
    });
    const signature = await AGENT.signTypedData(typed.domain, typed.types, typed.message);

    const res = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'read_private',
        resource: task.taskId,
        signature,
        nonce,
        deadline,
        typed_data: typed,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.action, 'read_private');
  });

  test('after TTL: fresh challenge allows high-blast handoff', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-ttl-rechallenge' });
    listener.activeTasks.set(parent.taskId, parent);

    getSessionActApprovalStore().recordHighBlast(session.delegation_hash, nowSec() - 300);

    const { json: ch } = await challengeFor(session, { resource: parent.taskId });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'handoff', resource: parent.taskId });

    const actRes = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
      }),
    });
    assert.equal(actRes.status, 201);
  });

  test('unauth book policy write is gated', async () => {
    const res = await fetch(`${base}/v1/agents/${agentId}/book/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policy_type: 'approval_ttl', value: 60 }),
    });
    assert.equal(res.status, 401);
  });
});
