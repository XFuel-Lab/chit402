/**
 * Session-delegation v1 — Bankr lock (2026-09-04).
 *
 * Bind-at-settle, reusable EIP-712 session, immutable genesis JWS,
 * child handoff, revoke status, secp256k1 typing, atomic USDC units.
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
  USDC_ATOMIC_DECIMALS,
  USDC_ATOMIC_UNIT,
  AUTHORIZE_SESSION_TYPES,
  REVOKE_SESSION_TYPES,
  buildAuthorizeTypedData,
  buildRevokeTypedData,
  delegationHashOf,
  verifyAuthorizeSession,
  verifyRevokeSession,
  verifySessionWindow,
  acceptDelegationProof,
  sessionOf,
  SessionDelegationStore,
} = await import('../src/session-delegation.js');
const {
  buildReceipt,
  decodeReceiptClaims,
  mergeReceiptView,
  renderReceiptHtml,
  verifyReceiptEcdsaWithJwks,
  issueSessionHandoffReceipt,
} = await import('../src/receipt.js');
const { getJwks } = await import('../src/issuer-key.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');

const PAYER = Wallet.createRandom();
const AGENT = Wallet.createRandom();
const OTHER = Wallet.createRandom();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function signAuthorize(overrides = {}) {
  const t = nowSec();
  const typed = buildAuthorizeTypedData({
    agentPubkey: AGENT.address,
    validAfter: t - 60,
    validUntil: t + 3600,
    maxCumulativeSpend: 1_000_000n,
    allowedRoutes: ['/v1/chat/completions', '/task-request'],
    nonce: `0x${'ab'.repeat(32)}`,
    ...overrides,
  });
  const signature = await PAYER.signTypedData(typed.domain, typed.types, typed.message);
  return { typed, signature };
}

function usdcTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-session-genesis',
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
      providerCogs: {
        provider: 'theta-edgecloud',
        actual: '2000',
        basis: 'measured',
      },
      ...(over.meta || {}),
    },
    result: { provider: 'theta-edgecloud', model: 'theta/qwen3' },
    ...over,
  };
}

describe('EIP-712 AuthorizeSession / RevokeSession', () => {
  test('domain is Base 8453 with Chit402 name and verifyingContract', () => {
    const typed = buildAuthorizeTypedData({
      agentPubkey: AGENT.address,
      validAfter: 1,
      validUntil: 2,
      maxCumulativeSpend: 1000,
      nonce: `0x${'01'.repeat(32)}`,
    });
    assert.equal(typed.domain.chainId, SESSION_CHAIN_ID);
    assert.equal(typed.domain.chainId, 8453);
    assert.equal(typed.domain.name, 'Chit402');
    assert.equal(typed.domain.version, '1');
    assert.equal(typed.domain.verifyingContract, SESSION_VERIFYING_CONTRACT_DEFAULT);
    assert.equal(typed.primaryType, 'AuthorizeSession');
    assert.ok(AUTHORIZE_SESSION_TYPES.AuthorizeSession.find((f) => f.name === 'agentPubkey'));
    assert.ok(REVOKE_SESSION_TYPES.RevokeSession.find((f) => f.name === 'delegationHash'));
  });

  test('agent_pubkey is typed secp256k1 (EVM address); other key types rejected', async () => {
    const { typed, signature } = await signAuthorize();
    assert.equal(typed.message.agentKeyType, AGENT_KEY_TYPE_SECP256K1);
    const ok = verifyAuthorizeSession(typed, signature);
    assert.equal(ok.valid, true);
    assert.equal(ok.agent_key_type, 'secp256k1');
    assert.match(ok.agent_pubkey, /^0x[0-9a-fA-F]{40}$/);

    assert.throws(
      () => buildAuthorizeTypedData({
        agentPubkey: AGENT.address,
        agentKeyType: 'ed25519',
        validAfter: 1,
        validUntil: 2,
        maxCumulativeSpend: 1,
      }),
      /secp256k1/,
    );
    assert.throws(
      () => buildAuthorizeTypedData({
        agentPubkey: 'not-an-address',
        validAfter: 1,
        validUntil: 2,
        maxCumulativeSpend: 1,
      }),
      /secp256k1 EVM address/,
    );
  });

  test('maxCumulativeSpend is atomic USDC (6 decimals)', async () => {
    const { typed, signature } = await signAuthorize({ maxCumulativeSpend: 2_000n });
    const ok = verifyAuthorizeSession(typed, signature);
    assert.equal(ok.max_cumulative_spend, '2000');
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.session.decimals, USDC_ATOMIC_DECIMALS);
    assert.equal(accepted.session.unit, USDC_ATOMIC_UNIT);
    assert.equal(accepted.session.max_cumulative_spend, '2000');
  });

  test('wrong signer fails AuthorizeSession verify', async () => {
    const { typed } = await signAuthorize();
    const bad = await OTHER.signTypedData(typed.domain, typed.types, typed.message);
    const result = verifyAuthorizeSession(typed, bad);
    assert.equal(result.valid, true);
    assert.notEqual(result.payer_wallet.toLowerCase(), PAYER.address.toLowerCase());
    const accepted = acceptDelegationProof(
      { signature: bad, typed_data: typed },
      { expectedPayer: PAYER.address },
    );
    assert.equal(accepted.ok, false);
    assert.equal(accepted.reason, 'payer_mismatch');
  });

  test('delegation_hash is the EIP-712 digest', async () => {
    const { typed, signature } = await signAuthorize();
    const hash = delegationHashOf(typed);
    const ok = verifyAuthorizeSession(typed, signature);
    assert.equal(ok.delegation_hash, hash);
    assert.match(hash, /^0x[0-9a-fA-F]{64}$/);
  });
});

describe('Bind-at-settle JWS claims', () => {
  test('receipt JWS is born with payer_wallet + session agent fields', async () => {
    const { typed, signature } = await signAuthorize();
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    assert.equal(accepted.ok, true);

    const task = usdcTask({
      meta: {
        payerWallet: PAYER.address,
        session: accepted.session,
        providerCogs: { provider: 'theta-edgecloud', actual: '2000', basis: 'measured' },
      },
    });
    const receipt = buildReceipt(task, { persistSignature: true, payerWallet: PAYER.address });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.caller_binding.payer_wallet, PAYER.address);
    assert.equal(claims.agent_pubkey, AGENT.address);
    assert.equal(claims.caller_binding.agent_pubkey, AGENT.address);
    assert.equal(claims.delegation_hash, accepted.session.delegation_hash);
    assert.equal(claims.session_expiry, accepted.session.session_expiry);
    assert.equal(claims.session.agent_key_type, 'secp256k1');
    assert.equal(claims.session.decimals, 6);
    assert.equal(claims.session.unit, 'atomic_usdc');
    assert.equal(claims.session.max_cumulative_spend, '1000000');
    assert.ok(claims.session.proof.signature);
    assert.ok(claims.session.proof.lookup_uri.includes('/v1/sessions/'));
    assert.equal(receipt.session.agent_pubkey, AGENT.address);

    const jwks = getJwks();
    const verified = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(verified.valid, true);

    const html = renderReceiptHtml(receipt);
    assert.match(html, /agent_pubkey delegation/);
    assert.match(html, /secp256k1/);
  });

  test('provider_cogs unit laws stay intact on a session-bound receipt', async () => {
    const { typed, signature } = await signAuthorize();
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    const receipt = buildReceipt(usdcTask({
      meta: {
        payerWallet: PAYER.address,
        session: accepted.session,
        providerCogs: { provider: 'theta-edgecloud', actual: '2000', basis: 'measured' },
      },
    }));
    assert.equal(receipt.provider_cogs.decimals, 6);
    assert.equal(receipt.provider_cogs.unit, 'atomic_usdc');
    assert.equal(receipt.provider_cogs.actual, '2000');
  });
});

describe('Session window verify', () => {
  test('iat outside session window fails verify', async () => {
    const t = nowSec();
    const { typed, signature } = await signAuthorize({
      validAfter: t - 10_000,
      validUntil: t - 1_000,
      nonce: `0x${'cd'.repeat(32)}`,
    });
    // Bypass acceptDelegationProof clock check — stamp an expired window directly.
    const verified = verifyAuthorizeSession(typed, signature);
    assert.equal(verified.valid, true);
    const session = {
      agent_pubkey: verified.agent_pubkey,
      agent_key_type: 'secp256k1',
      delegation_hash: verified.delegation_hash,
      session_expiry: verified.valid_until,
      valid_after: verified.valid_after,
      valid_until: verified.valid_until,
      max_cumulative_spend: verified.max_cumulative_spend,
      decimals: 6,
      unit: 'atomic_usdc',
      allowed_routes: verified.allowed_routes,
      nonce: verified.nonce,
      proof: { type: 'eip712', signature },
    };
    const task = usdcTask({
      createdAt: Date.now(),
      meta: { payerWallet: PAYER.address, session },
    });
    const receipt = buildReceipt(task);
    const claims = decodeReceiptClaims(receipt);
    const window = verifySessionWindow(claims);
    assert.equal(window.valid, false);
    assert.equal(window.reason, 'iat_outside_session_window');

    const jwks = getJwks();
    const ecdsa = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(ecdsa.valid, false);
    assert.equal(ecdsa.reason, 'iat_outside_session_window');
  });

  test('iat inside window verifies without a new payer signature', async () => {
    const { typed, signature } = await signAuthorize();
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    const receipt = buildReceipt(usdcTask({
      meta: { payerWallet: PAYER.address, session: accepted.session },
    }));
    const claims = decodeReceiptClaims(receipt);
    assert.equal(verifySessionWindow(claims).valid, true);
    assert.equal(verifyReceiptEcdsaWithJwks(receipt, getJwks()).valid, true);
  });
});

describe('Genesis immutability + child handoff', () => {
  test('never re-signs the same genesis receipt id', async () => {
    const { typed, signature } = await signAuthorize({ nonce: `0x${'11'.repeat(32)}` });
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    const task = usdcTask({
      taskId: 'xfuel-genesis-immutable',
      meta: { payerWallet: PAYER.address, session: accepted.session },
    });
    const first = buildReceipt(task, { persistSignature: true });
    const firstJws = first.issuer_signature.jws;
    const firstHash = decodeReceiptClaims(first).delegation_hash;

    task.meta.session = null;
    task.meta.agentPubkey = OTHER.address;
    const second = buildReceipt(task, { persistSignature: true });
    assert.equal(second.issuer_signature.jws, firstJws, 'genesis JWS must not be re-signed');
    assert.equal(decodeReceiptClaims(second).delegation_hash, firstHash);
    assert.equal(decodeReceiptClaims(second).agent_pubkey, AGENT.address);
  });

  test('child handoff references parent and leaves genesis JWS untouched', async () => {
    const { typed, signature } = await signAuthorize({ nonce: `0x${'22'.repeat(32)}` });
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    const parent = usdcTask({
      taskId: 'xfuel-parent-genesis',
      meta: { payerWallet: PAYER.address },
    });
    const genesis = buildReceipt(parent, { persistSignature: true });
    const genesisJws = genesis.issuer_signature.jws;
    assert.equal(decodeReceiptClaims(genesis).delegation_hash, null);

    const { childTask, receipt: child } = issueSessionHandoffReceipt(parent, accepted.session, {
      childTaskId: 'xfuel-child-handoff',
    });
    assert.equal(child.kind, 'session_handoff');
    assert.equal(child.parent_receipt_id, 'xfuel-parent-genesis');
    assert.equal(child.task_id, 'xfuel-child-handoff');
    assert.notEqual(child.task_id, parent.taskId);
    assert.notEqual(child.issuer_signature.jws, genesisJws);

    const childClaims = decodeReceiptClaims(child);
    assert.equal(childClaims.parent_receipt_id, 'xfuel-parent-genesis');
    assert.equal(childClaims.agent_pubkey, AGENT.address);
    assert.equal(childClaims.delegation_hash, accepted.session.delegation_hash);
    assert.equal(childClaims.caller_binding.payer_wallet, PAYER.address);

    const again = buildReceipt(parent, { persistSignature: true });
    assert.equal(again.issuer_signature.jws, genesisJws, 'parent genesis JWS stays frozen');
    assert.equal(decodeReceiptClaims(again).delegation_hash, null);
    assert.equal(childTask.parentReceiptId, parent.taskId);
    assert.equal(sessionOf(childTask).agent_pubkey, AGENT.address);
  });
});

describe('Revoke status store', () => {
  test('revoke flips status; does not amend receipts', async () => {
    const store = new SessionDelegationStore();
    const { typed, signature } = await signAuthorize({ nonce: `0x${'33'.repeat(32)}` });
    const accepted = acceptDelegationProof({ signature, typed_data: typed });
    store.put(accepted.session);

    const receipt = buildReceipt(usdcTask({
      taskId: 'xfuel-revoke-genesis',
      meta: { payerWallet: PAYER.address, session: accepted.session },
    }), { persistSignature: true });
    const jws = receipt.issuer_signature.jws;

    assert.equal(store.status(accepted.session.delegation_hash).status, 'active');
    assert.equal(store.isRevoked(accepted.session.delegation_hash), false);

    const revokeTd = buildRevokeTypedData({
      agentPubkey: AGENT.address,
      nonce: accepted.session.nonce,
      delegationHash: accepted.session.delegation_hash,
    });
    const revokeSig = await PAYER.signTypedData(revokeTd.domain, revokeTd.types, revokeTd.message);
    const revoked = verifyRevokeSession(revokeTd, revokeSig, { expectedPayer: PAYER.address });
    assert.equal(revoked.valid, true);

    store.revoke({
      delegation_hash: accepted.session.delegation_hash,
      agent_pubkey: AGENT.address,
      payer_wallet: PAYER.address,
      nonce: accepted.session.nonce,
    });
    assert.equal(store.isRevoked(accepted.session.delegation_hash), true);
    assert.equal(store.status(accepted.session.delegation_hash).status, 'revoked');
    assert.equal(store.listRevocations().length, 1);

    const after = buildReceipt(usdcTask({
      taskId: 'xfuel-revoke-genesis',
      meta: { payerWallet: PAYER.address, session: accepted.session },
      issuerSignature: receipt.issuer_signature,
    }), { persistSignature: true });
    assert.equal(after.issuer_signature.jws, jws, 'revoke must not re-sign or amend genesis');
  });
});

describe('HTTP session status + revoke + child handoff', () => {
  let server;
  let base;

  before(async () => {
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

  test('GET /.well-known/revocations and session status', async () => {
    const empty = await (await fetch(`${base}/.well-known/revocations`)).json();
    assert.equal(empty.schema, 'xfuel.session.revocations.v1');
    assert.equal(empty.chain_id, 8453);
    assert.equal(empty.agent_key_type, 'secp256k1');
    assert.ok(Array.isArray(empty.revocations));

    const { typed, signature } = await signAuthorize({ nonce: `0x${'44'.repeat(32)}` });
    const accepted = acceptDelegationProof({ signature, typed_data: typed });

    const listener = getAIListener();
    const task = usdcTask({
      taskId: 'xfuel-http-session',
      meta: { payerWallet: PAYER.address, session: accepted.session },
    });
    listener.activeTasks.set(task.taskId, task);

    const receipt = await (await fetch(`${base}/receipt/${task.taskId}?format=json`)).json();
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.agent_pubkey, AGENT.address);
    assert.equal(claims.delegation_hash, accepted.session.delegation_hash);
    assert.match(mergeReceiptView(receipt).session.agent_pubkey, /^0x/i);

    const html = await (await fetch(`${base}/receipt/${task.taskId}`)).text();
    assert.match(html, /agent_pubkey delegation/);

    const revokeTd = buildRevokeTypedData({
      agentPubkey: AGENT.address,
      nonce: accepted.session.nonce,
      delegationHash: accepted.session.delegation_hash,
    });
    const revokeSig = await PAYER.signTypedData(revokeTd.domain, revokeTd.types, revokeTd.message);
    const revokeRes = await fetch(`${base}/v1/sessions/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: revokeSig, typed_data: revokeTd }),
    });
    assert.equal(revokeRes.status, 200);
    const revokeBody = await revokeRes.json();
    assert.equal(revokeBody.status, 'revoked');

    const status = await (await fetch(`${base}/v1/sessions/${accepted.session.delegation_hash}`)).json();
    assert.equal(status.status, 'revoked');

    const listed = await (await fetch(`${base}/.well-known/revocations`)).json();
    assert.ok(listed.revocations.some((r) => r.delegation_hash.toLowerCase() === accepted.session.delegation_hash.toLowerCase()));

    const after = await (await fetch(`${base}/receipt/${task.taskId}?format=json`)).json();
    assert.equal(after.issuer_signature.jws, receipt.issuer_signature.jws);
  });

  test('POST /receipt/:id/session/handoff issues a child and keeps genesis JWS', async () => {
    const { typed, signature } = await signAuthorize({ nonce: `0x${'55'.repeat(32)}` });
    const listener = getAIListener();
    const parent = usdcTask({
      taskId: 'xfuel-http-parent',
      meta: { payerWallet: PAYER.address },
    });
    listener.activeTasks.set(parent.taskId, parent);

    const genesis = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    const genesisJws = genesis.issuer_signature.jws;
    assert.equal(decodeReceiptClaims(genesis).delegation_hash, null);

    const res = await fetch(`${base}/receipt/${parent.taskId}/session/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_delegation: { signature, typed_data: typed } }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'session_handoff');
    assert.equal(body.parent_receipt_id, parent.taskId);
    assert.ok(body.task_id.startsWith('xfuel-'));
    assert.notEqual(body.task_id, parent.taskId);
    assert.equal(body.receipt.parent_receipt_id, parent.taskId);
    assert.equal(decodeReceiptClaims(body.receipt).agent_pubkey, AGENT.address);

    const parentAgain = await (await fetch(`${base}/receipt/${parent.taskId}?format=json`)).json();
    assert.equal(parentAgain.issuer_signature.jws, genesisJws);
  });

  test('/v1 chat bind-at-settle stamps session on the signed receipt', async () => {
    const { typed, signature } = await signAuthorize({ nonce: `0x${'66'.repeat(32)}` });
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 16,
        session_delegation: { signature, typed_data: typed },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const claims = decodeReceiptClaims(body.xfuel);
    assert.equal(claims.agent_pubkey, AGENT.address);
    assert.equal(claims.delegation_hash, delegationHashOf(typed));
    assert.equal(body.xfuel.session.agent_key_type, 'secp256k1');
    assert.equal(body.xfuel.session.decimals, 6);
    assert.equal(body.xfuel.session.unit, 'atomic_usdc');
  });
});
