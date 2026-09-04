/**
 * Prove-key execution v1 — SessionAct (act side of session-delegation).
 *
 * Challenge → EIP-712 SessionAct → handoff / read_private / redeem.
 * secp256k1, Base 8453. Genesis JWS never re-signed.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';

const {
  SESSION_CHAIN_ID,
  SESSION_VERIFYING_CONTRACT_DEFAULT,
  AGENT_KEY_TYPE_SECP256K1,
  buildAuthorizeTypedData,
  acceptDelegationProof,
  buildRevokeTypedData,
  getSessionStore,
} = await import('../src/session-delegation.js');
const {
  SESSION_ACT_PRIMARY,
  SESSION_ACT_TYPES,
  SESSION_ACT_ACTIONS,
  CHALLENGE_TTL_SEC_DEFAULT,
  CHALLENGE_TTL_SEC_MIN,
  CHALLENGE_TTL_SEC_MAX,
  buildSessionActTypedData,
  verifySessionAct,
  acceptSessionAct,
  sessionBindsAgent,
  sessionIsActive,
  SessionActChallengeStore,
  getSessionActStore,
  _resetSessionActStore,
  clampChallengeTtlSec,
} = await import('../src/session-act.js');
const {
  buildReceipt,
  decodeReceiptClaims,
} = await import('../src/receipt.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');

const PAYER = Wallet.createRandom();
const AGENT = Wallet.createRandom();
const OTHER = Wallet.createRandom();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

let _nonce = 0;
function uniqueNonce() {
  _nonce += 1;
  return `0x${_nonce.toString(16).padStart(2, '0').repeat(32)}`.slice(0, 66);
}

async function bindSession(overrides = {}) {
  const typed = buildAuthorizeTypedData({
    agentPubkey: AGENT.address,
    validAfter: nowSec() - 60,
    validUntil: nowSec() + 3600,
    maxCumulativeSpend: 1_000_000n,
    allowedRoutes: ['/v1/chat/completions'],
    nonce: uniqueNonce(),
    ...overrides,
  });
  const signature = await PAYER.signTypedData(typed.domain, typed.types, typed.message);
  const accepted = acceptDelegationProof({ signature, typed_data: typed });
  assert.equal(accepted.ok, true);
  return { typed, signature, session: accepted.session };
}

function usdcTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-act-genesis',
    status: 'completed',
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      model: 'theta/qwen3',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
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

describe('EIP-712 SessionAct', () => {
  test('domain is Base 8453 with Chit402 name; types map is complete', () => {
    const typed = buildSessionActTypedData({
      delegationHash: `0x${'11'.repeat(32)}`,
      nonce: `0x${'22'.repeat(32)}`,
      action: 'handoff',
      resource: 'xfuel-parent',
      deadline: 1_800_000_000,
    });
    assert.equal(typed.domain.chainId, SESSION_CHAIN_ID);
    assert.equal(typed.domain.chainId, 8453);
    assert.equal(typed.domain.name, 'Chit402');
    assert.equal(typed.domain.version, '1');
    assert.equal(typed.domain.verifyingContract, SESSION_VERIFYING_CONTRACT_DEFAULT);
    assert.equal(typed.primaryType, SESSION_ACT_PRIMARY);
    assert.ok(SESSION_ACT_TYPES.SessionAct.find((f) => f.name === 'delegationHash'));
    assert.ok(SESSION_ACT_TYPES.SessionAct.find((f) => f.name === 'nonce'));
    assert.ok(SESSION_ACT_TYPES.SessionAct.find((f) => f.name === 'action'));
    assert.ok(SESSION_ACT_TYPES.SessionAct.find((f) => f.name === 'resource'));
    assert.ok(SESSION_ACT_TYPES.SessionAct.find((f) => f.name === 'deadline'));
    assert.equal(clampChallengeTtlSec(60), CHALLENGE_TTL_SEC_MIN);
    assert.equal(clampChallengeTtlSec(9999), CHALLENGE_TTL_SEC_MAX);
    assert.equal(clampChallengeTtlSec(null), CHALLENGE_TTL_SEC_DEFAULT);
  });

  test('SessionAct recovers secp256k1 agent; wrong key is signer_mismatch', async () => {
    const store = new SessionActChallengeStore();
    const { session } = await bindSession();
    const challenge = store.issue(session.delegation_hash);
    const { typed, signature } = await signAct(challenge, {
      action: 'handoff',
      resource: 'xfuel-r',
    });
    const ok = verifySessionAct(typed, signature, { expectedAgent: AGENT.address });
    assert.equal(ok.valid, true);
    assert.equal(ok.agent_key_type, AGENT_KEY_TYPE_SECP256K1);
    assert.equal(ok.agent_pubkey, AGENT.address);
    assert.deepEqual(ok.types, SESSION_ACT_TYPES);

    const bad = await OTHER.signTypedData(typed.domain, typed.types, typed.message);
    const rejected = verifySessionAct(typed, bad, { expectedAgent: AGENT.address });
    assert.equal(rejected.valid, false);
    assert.equal(rejected.reason, 'signer_mismatch');
  });

  test('acceptSessionAct consumes nonce once; reuse fails', async () => {
    const store = new SessionActChallengeStore();
    const { session } = await bindSession();
    const challenge = store.issue(session.delegation_hash);
    const { typed, signature } = await signAct(challenge, {
      action: 'handoff',
      resource: 'xfuel-once',
    });
    const first = acceptSessionAct({
      session,
      challenge,
      proof: { action: 'handoff', resource: 'xfuel-once', signature, typed_data: typed },
      delegationHash: session.delegation_hash,
      store,
    });
    assert.equal(first.ok, true);
    assert.ok(first.proof.types.SessionAct);
    assert.equal(first.proof.primaryType, 'SessionAct');

    const second = acceptSessionAct({
      session,
      challenge,
      proof: { action: 'handoff', resource: 'xfuel-once', signature, typed_data: typed },
      delegationHash: session.delegation_hash,
      store,
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'nonce_reused');
  });

  test('expired challenge and revoked session fail before execute', async () => {
    const store = new SessionActChallengeStore();
    const { session } = await bindSession();
    const challenge = store.issue(session.delegation_hash);
    store.expire(challenge.challenge_id);
    const { typed, signature } = await signAct({
      ...challenge,
      expires_at: challenge.expires_at,
    }, { action: 'handoff', resource: 'xfuel-exp' });
    const expired = acceptSessionAct({
      session,
      challenge: store.peek(challenge.challenge_id) || { ...challenge, expires_at: nowSec() - 1 },
      proof: { action: 'handoff', resource: 'xfuel-exp', signature, typed_data: typed },
      delegationHash: session.delegation_hash,
      store,
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, 'challenge_expired');

    const live = store.issue(session.delegation_hash);
    const signed = await signAct(live, { action: 'handoff', resource: 'xfuel-rev' });
    const revoked = acceptSessionAct({
      session,
      revoked: true,
      challenge: live,
      proof: { action: 'handoff', resource: 'xfuel-rev', signature: signed.signature, typed_data: signed.typed },
      delegationHash: session.delegation_hash,
      store,
    });
    assert.equal(revoked.ok, false);
    assert.equal(revoked.reason, 'session_revoked');
  });

  test('sessionBindsAgent requires agent_pubkey + delegation_hash', () => {
    assert.equal(sessionBindsAgent(null).ok, false);
    assert.equal(sessionBindsAgent({ agent_pubkey: AGENT.address }).ok, false);
    assert.equal(sessionIsActive({
      agent_pubkey: AGENT.address,
      delegation_hash: `0x${'aa'.repeat(32)}`,
      valid_until: nowSec() - 10,
    }).ok, false);
  });
});

describe('HTTP prove-key challenge → SessionAct → handoff', () => {
  let server;
  let base;

  before(async () => {
    _resetSessionActStore();
    resetHubCatalogCache();
    await initAIListener();
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
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
    const json = await res.json();
    return { res, json };
  }

  test('challenge issues nonce with full SessionAct types', async () => {
    const { session } = await putBoundSession();
    const { res, json } = await challengeFor(session, { resource: 'xfuel-http-parent-act' });
    assert.equal(res.status, 200);
    assert.match(json.challenge_id, /^0x[0-9a-fA-F]{64}$/);
    assert.match(json.nonce, /^0x[0-9a-fA-F]{64}$/);
    assert.ok(json.expires_at > nowSec());
    assert.ok(json.expires_at <= nowSec() + CHALLENGE_TTL_SEC_MAX);
    assert.ok(Array.isArray(json.resources));
    assert.ok(json.resources.includes('handoff'));
    assert.equal(json.agent_key_type, 'secp256k1');
    assert.equal(json.chain_id, 8453);
    assert.ok(json.types.SessionAct);
    assert.equal(json.primaryType, 'SessionAct');
    assert.equal(json.domain.chainId, 8453);
    assert.equal(json.domain.name, 'Chit402');
    assert.ok(json.typed_data.types.SessionAct);
  });

  test('act with valid SessionAct succeeds for handoff; genesis JWS unchanged', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-http-parent-act' });
    listener.activeTasks.set(parent.taskId, parent);

    const genesis = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    const genesisJws = genesis.issuer_signature.jws;
    assert.equal(decodeReceiptClaims(genesis).delegation_hash, null);

    const { json: ch } = await challengeFor(session, { resource: parent.taskId, action: 'handoff' });
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
    const body = await actRes.json();
    assert.equal(body.status, 'session_handoff');
    assert.equal(body.parent_receipt_id, parent.taskId);
    assert.ok(body.task_id.startsWith('xfuel-'));
    assert.notEqual(body.task_id, parent.taskId);
    assert.equal(body.receipt.parent_receipt_id, parent.taskId);
    assert.equal(decodeReceiptClaims(body.receipt).agent_pubkey, AGENT.address);
    assert.equal(decodeReceiptClaims(body.receipt).parent_receipt_id, parent.taskId);
    assert.ok(body.proof.types.SessionAct);
    assert.equal(body.proof.agent_key_type, 'secp256k1');

    const parentAgain = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    assert.equal(parentAgain.issuer_signature.jws, genesisJws, 'genesis JWS must not be re-signed');
  });

  test('handoff rejects a session whose payer is not the parent receipt payer', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const strangerParent = usdcTask({
      taskId: 'xfuel-http-stranger-parent',
      meta: { payerWallet: OTHER.address },
    });
    listener.activeTasks.set(strangerParent.taskId, strangerParent);
    const genesis = await (await fetch(`${base}/receipt/${strangerParent.taskId}?format=json`)).json();
    const genesisJws = genesis.issuer_signature.jws;

    const { json: ch } = await challengeFor(session, { resource: strangerParent.taskId, action: 'handoff' });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'handoff', resource: strangerParent.taskId });

    const actRes = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: strangerParent.taskId,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
      }),
    });
    assert.equal(actRes.status, 403);
    assert.equal((await actRes.json()).reason, 'payer_mismatch');

    const parentAgain = await (await fetch(`${base}/receipt/${strangerParent.taskId}?format=json`)).json();
    assert.equal(parentAgain.issuer_signature.jws, genesisJws);
    assert.equal(listener.activeTasks.has('xfuel-http-stranger-parent'), true);
  });

  test('handoff does not treat a Solana parent payer as an EVM mismatch', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const solanaPayer = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const parent = usdcTask({
      taskId: 'xfuel-http-solana-parent',
      meta: { payerWallet: solanaPayer, chain: 'solana' },
    });
    listener.activeTasks.set(parent.taskId, parent);
    const genesis = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    const genesisJws = genesis.issuer_signature.jws;

    const { json: ch } = await challengeFor(session, { resource: parent.taskId, action: 'handoff' });
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
    const body = await actRes.json();
    assert.equal(body.status, 'session_handoff');
    assert.equal(body.parent_receipt_id, parent.taskId);
    assert.ok(body.task_id.startsWith('xfuel-'));
    const parentAgain = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    assert.equal(parentAgain.issuer_signature.jws, genesisJws);
  });

  test('wrong key / reused nonce / expired challenge / revoked session fail', async () => {
    const { session, typed: authTyped, signature: authSig } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-http-fail-parent' });
    listener.activeTasks.set(parent.taskId, parent);

    // Wrong key
    const ch1 = (await challengeFor(session, { resource: parent.taskId })).json;
    const wrong = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch1.nonce,
      expires_at: ch1.expires_at,
    }, { action: 'handoff', resource: parent.taskId, signer: OTHER });
    const wrongRes = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature: wrong.signature,
        challenge_id: ch1.challenge_id,
        typed_data: wrong.typed,
      }),
    });
    assert.equal(wrongRes.status, 403);
    assert.equal((await wrongRes.json()).reason, 'signer_mismatch');

    // Reused nonce
    const ch2 = (await challengeFor(session, { resource: parent.taskId })).json;
    const ok = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch2.nonce,
      expires_at: ch2.expires_at,
    }, { action: 'handoff', resource: parent.taskId });
    const first = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature: ok.signature,
        challenge_id: ch2.challenge_id,
        typed_data: ok.typed,
      }),
    });
    assert.equal(first.status, 201);
    const reuse = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature: ok.signature,
        challenge_id: ch2.challenge_id,
        typed_data: ok.typed,
      }),
    });
    assert.equal(reuse.status, 403);
    assert.equal((await reuse.json()).reason, 'nonce_reused');

    // Expired challenge
    const ch3 = (await challengeFor(session, { resource: parent.taskId })).json;
    getSessionActStore().expire(ch3.challenge_id);
    const late = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch3.nonce,
      expires_at: ch3.expires_at,
    }, { action: 'handoff', resource: parent.taskId });
    const expRes = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature: late.signature,
        challenge_id: ch3.challenge_id,
        typed_data: late.typed,
      }),
    });
    assert.equal(expRes.status, 403);
    assert.equal((await expRes.json()).reason, 'challenge_expired');

    // Revoked session
    const revokeTd = buildRevokeTypedData({
      agentPubkey: AGENT.address,
      nonce: session.nonce,
      delegationHash: session.delegation_hash,
    });
    const revokeSig = await PAYER.signTypedData(revokeTd.domain, revokeTd.types, revokeTd.message);
    const revokeRes = await fetch(`${base}/v1/sessions/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signature: revokeSig,
        typed_data: revokeTd,
        authorize: { signature: authSig, typed_data: authTyped },
      }),
    });
    assert.equal(revokeRes.status, 200);
    const ch4 = await fetch(`${base}/v1/sessions/${session.delegation_hash}/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: parent.taskId }),
    });
    assert.equal(ch4.status, 403);
    assert.equal((await ch4.json()).reason, 'session_revoked');
  });

  test('POST /receipt/:id/session/handoff accepts prove-key SessionAct', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const parent = usdcTask({ taskId: 'xfuel-http-legacy-handoff' });
    listener.activeTasks.set(parent.taskId, parent);
    const genesis = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    const genesisJws = genesis.issuer_signature.jws;

    const { json: ch } = await challengeFor(session, { resource: parent.taskId });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'handoff', resource: parent.taskId });

    const res = await fetch(`${base}/receipt/${parent.taskId}/session/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        resource: parent.taskId,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
        delegation_hash: session.delegation_hash,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.parent_receipt_id, parent.taskId);
    assert.ok(body.task_id.startsWith('xfuel-'));
    const parentAgain = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    assert.equal(parentAgain.issuer_signature.jws, genesisJws);
  });

  test('read_private returns possession-gated fields for a session-bound receipt', async () => {
    const { session } = await putBoundSession();
    const listener = getAIListener();
    const task = usdcTask({
      taskId: 'xfuel-http-private',
      meta: { payerWallet: PAYER.address, session },
    });
    listener.activeTasks.set(task.taskId, task);
    buildReceipt(task, { persistSignature: true, payerWallet: PAYER.address });

    const { json: ch } = await challengeFor(session, { resource: task.taskId });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'read_private', resource: task.taskId });

    const res = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'read_private',
        resource: task.taskId,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.action, 'read_private');
    assert.equal(body.private.agent_pubkey, AGENT.address);
    assert.equal(body.private.delegation_hash, session.delegation_hash);
    assert.ok(body.private.caller_binding);
  });

  test('redeem stub returns 501 after prove-key verify; bad sig never reaches stub', async () => {
    const { session } = await putBoundSession();
    const resource = 'xfuel-redeem-target';

    const { json: ch } = await challengeFor(session, { resource });
    const { typed, signature } = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: ch.nonce,
      expires_at: ch.expires_at,
    }, { action: 'redeem', resource });

    const ok = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'redeem',
        resource,
        signature,
        challenge_id: ch.challenge_id,
        typed_data: typed,
      }),
    });
    assert.equal(ok.status, 501);
    const stub = await ok.json();
    assert.equal(stub.error, 'not_implemented');
    assert.equal(stub.verified, true);
    assert.equal(stub.agent_pubkey, AGENT.address);
    assert.ok(stub.proof.types.SessionAct);

    const { json: chBad } = await challengeFor(session, { resource });
    const bad = await signAct({
      delegation_hash: session.delegation_hash,
      nonce: chBad.nonce,
      expires_at: chBad.expires_at,
    }, { action: 'redeem', resource, signer: OTHER });
    const denied = await fetch(`${base}/v1/sessions/${session.delegation_hash}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'redeem',
        resource,
        signature: bad.signature,
        challenge_id: chBad.challenge_id,
        typed_data: bad.typed,
      }),
    });
    assert.equal(denied.status, 403);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.reason, 'signer_mismatch');
    assert.notEqual(deniedBody.error, 'not_implemented');
  });
});
