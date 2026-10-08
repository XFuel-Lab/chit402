/**
 * request_digest binds a refusal to the client request.
 * The pinned preimage and digest are what verifier PR #484 checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  applyRequestSaltHeader,
  bodyCommitmentHex,
  captureRawRequestBody,
  claimIdempotency,
  clientRequestForRefusal,
  refusalMatchesRequest,
  requestDigest,
  requestDigestCanonical,
  requestDigestPreimage,
  requestSalt,
  resetIdempotencyStore,
} from '../src/request-binding.js';
import { issueRefusalReceipt } from '../src/refusal-receipt.js';
import { jcsRfc8785 } from '../src/offer-receipt.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import { assertIssuerRootStartup, KEY_RETIRED_TOPIC, _resetIssuerRootStartupState } from '../src/issuer-root.js';
import { _resetIssuerKey } from '../src/issuer-key.js';
import { resetIssuerHistoryStore } from '../src/issuer-history.js';
import { buildLegacyReceiptSet } from '../src/legacy-receipt-merkle.js';

const BODY = '{"model":"xfuel/auto","messages":[{"role":"user","content":"hello"}]}';
const SALT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const UNSALTED_BODY = '93dda1aa54d9bb86b7c2cdfaad61fd78e5b81656484a8941eee498adc9a54e54';
const REQUEST = {
  method: 'POST',
  path: '/v1/chat/completions',
  body: BODY,
  idempotency_key: 'idem-1',
  nonce: null,
  salt: SALT,
};
const PREIMAGE = '{"body_commitment":"e0999743fe405e9e30642542e9bb27a015b05425e6f7e9ac9f782b3109a88f59","idempotency_key":"idem-1","method":"POST","nonce":null,"path":"/v1/chat/completions"}';
const DIGEST = '78a29ef11d09b407b58fe01fdc22a98108bea8bf34ed6dc3830878744a2356bf';

test('matching request_digest vector', () => {
  const terms = requestDigestPreimage(REQUEST);
  assert.equal(requestDigestCanonical(REQUEST), PREIMAGE);
  assert.equal(PREIMAGE, jcsRfc8785(terms));
  assert.equal(requestDigest(REQUEST), DIGEST);
  assert.equal(crypto.createHash('sha256').update(PREIMAGE, 'utf8').digest('hex'), DIGEST);
  assert.equal(terms.idempotency_key, 'idem-1');
  assert.equal(terms.nonce, null);
  assert.equal(terms.body_commitment, bodyCommitmentHex(SALT, BODY));
  assert.equal(Object.prototype.hasOwnProperty.call(terms, 'body_sha256'), false);
  assert.equal(PREIMAGE.includes(SALT), false);
  assert.equal(PREIMAGE.includes(UNSALTED_BODY), false);
  assert.notEqual(DIGEST, UNSALTED_BODY);
});

test('a tampered body changes request_digest', () => {
  const tampered = requestDigest({ ...REQUEST, body: `${BODY} ` });
  assert.notEqual(tampered, DIGEST);
  assert.equal(tampered, 'e555aad716602779ec85d9899c47da6a58eba729355a2cf11da7758902e7890c');
});

test('the same idempotency key with a different payload fails closed', () => {
  resetIdempotencyStore();
  const first = { ...REQUEST };
  const digest = requestDigest(first);
  assert.equal(claimIdempotency('idem-1', digest, requestSalt(first)).replay, false);
  const replay = {
    method: 'POST',
    path: '/v1/chat/completions',
    body: BODY,
    idempotency_key: 'idem-1',
    nonce: null,
  };
  assert.equal(requestDigest(replay), digest);
  assert.equal(requestSalt(replay), SALT);
  assert.equal(claimIdempotency('idem-1', digest, requestSalt(replay)).replay, true);
  assert.throws(
    () => claimIdempotency('idem-1', requestDigest({ ...REQUEST, body: `${BODY} ` })),
    (err) => err.code === 'idempotency_conflict' && /different request/.test(err.message),
  );
});

test('a missing intent_id fails closed when the request carried one', () => {
  assert.throws(() => issueRefusalReceipt({
    policy_code: 'policy_blocked',
    reason: 'cap',
    agent_id: 4,
    task_id: 'xfuel-missing-intent',
    collected_at: '2026-09-26T17:27:32Z',
    seq: 1,
    prev_hash: null,
    row_hash: 'cd'.repeat(32),
    anchor: { status: 'UNAVAILABLE', reason: 'no_observation' },
    intent_supplied: true,
    intent_id: null,
    request: REQUEST,
  }), (err) => err.code === 'intent_id_required');
});

test('a binding failure is returned and does not keep the book row', () => {
  const ledger = new UsageSettledLedger();
  const missing = ledger.recordPolicyBlocked({
    agentId: 4,
    taskId: 'bind-missing-intent',
    policyCode: 'policy_blocked',
    reason: 'cap',
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      body: BODY,
      intent_supplied: true,
    },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'intent_id_required');
  assert.equal(ledger.findByTask('bind-missing-intent'), null);
  const kept = ledger.recordPolicyBlocked({
    agentId: 4,
    taskId: 'bind-missing-intent',
    policyCode: 'policy_blocked',
    reason: 'cap',
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      body: BODY,
      intent_supplied: true,
      intent_id: 'intent-1',
    },
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.entry.seq, 1);
  assert.equal(kept.entry.refusal.intent_id, 'intent-1');
});

test('the JSON parser keeps raw body bytes for the salted commitment', async () => {
  const app = express();
  app.use(express.json({ verify: captureRawRequestBody }));
  app.post('/v1/chat/completions', (req, res) => {
    const binding = clientRequestForRefusal(req, req.path);
    const digest = requestDigest(binding);
    res.setHeader('X-Chit-Request-Salt', requestSalt(binding));
    res.json({ digest, preimage: requestDigestCanonical(binding) });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const port = server.address().port;
    const raw = `${BODY} `;
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    const json = await res.json();
    const salt = res.headers.get('x-chit-request-salt');
    const spaced = requestDigest({ method: 'POST', path: '/v1/chat/completions', body: raw, salt });
    assert.equal(json.digest, spaced);
    assert.equal(
      requestDigestPreimage({ method: 'POST', path: '/v1/chat/completions', body: raw, salt }).body_commitment,
      bodyCommitmentHex(salt, raw),
    );
    assert.equal(json.preimage.includes(salt), false);
    assert.equal(json.preimage.includes(crypto.createHash('sha256').update(raw, 'utf8').digest('hex')), false);
    const collapsed = clientRequestForRefusal({
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: JSON.parse(raw),
    }, '/v1/chat/completions');
    collapsed.salt = salt;
    assert.notEqual(requestDigest(collapsed), json.digest);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an open v11 refusal without a request is request_unbound and is not stored', async () => {
  const prev = {};
  const keys = [
    'ISSUER_ROOT_ENABLED', 'ISSUER_ROOT_CHAIN_ID', 'ISSUER_ROOT_REGISTRY', 'ISSUER_ROOT_SEQ',
    'ISSUER_ROOT_HASH', 'ISSUER_ROOT_STARTUP_CHECK', 'ISSUER_ROOT_RPC_URL', 'ISSUER_ROOT_RPC_URL_2',
    'ISSUER_ROOT_LEGACY_SET', 'ISSUER_PRIVATE_KEY', 'ISSUER_KEY_NOT_BEFORE', 'ISSUER_ROOT_CUTOVER',
  ];
  for (const key of keys) prev[key] = process.env[key];
  try {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
    _resetIssuerKey();
    resetIssuerHistoryStore();
    const chain = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-bind-'));
    const file = path.join(dir, 'set.json');
    fs.writeFileSync(file, JSON.stringify(chain.legacy || buildLegacyReceiptSet([])));
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = chain.registry;
    process.env.ISSUER_ROOT_SEQ = chain.rootSeq;
    process.env.ISSUER_ROOT_HASH = chain.rootHash;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    process.env.ISSUER_ROOT_LEGACY_SET = file;
    delete process.env.ISSUER_ROOT_CUTOVER;
    const fetchImpl = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_chainId') return { ok: true, json: async () => ({ result: '0x14a34' }) };
      if (body.method === 'eth_getBlockByNumber') {
        const tag = body.params[0];
        if (tag === 'finalized') {
          return { ok: true, json: async () => ({ result: { number: `0x${chain.finalizedNumber.toString(16)}`, hash: chain.finalizedHash } }) };
        }
        if (Number(tag) === chain.frozenBlock) {
          return { ok: true, json: async () => ({ result: { number: chain.frozen.blockNumber, hash: chain.frozenBlockHash } }) };
        }
        throw new Error(`unexpected block ${tag}`);
      }
      if (body.method === 'eth_getLogs') {
        const topic0 = body.params[0].topics[0];
        if (topic0 === KEY_RETIRED_TOPIC) return { ok: true, json: async () => ({ result: [] }) };
        const source = topic0 === chain.frozen.topics[0] ? chain.frozen : chain.rootCommitted;
        return { ok: true, json: async () => ({ result: [source] }) };
      }
      throw new Error(`unexpected ${body.method}`);
    };
    await assertIssuerRootStartup({ fetchImpl, log() {} });
    const ledger = new UsageSettledLedger();
    const unbound = ledger.recordPolicyBlocked({
      agentId: 4,
      taskId: 'bind-unbound',
      policyCode: 'policy_blocked',
      reason: 'cap',
    });
    assert.equal(unbound.ok, false);
    assert.equal(unbound.code, 'request_unbound');
    assert.equal(ledger.findByTask('bind-unbound'), null);
    const boundRequest = { method: 'POST', path: '/v1/chat/completions', body: BODY };
    const bound = ledger.recordPolicyBlocked({
      agentId: 4,
      taskId: 'bind-unbound',
      policyCode: 'policy_blocked',
      reason: 'cap',
      request: boundRequest,
    });
    assert.equal(bound.ok, true);
    assert.equal(bound.entry.seq, 1);
    assert.equal(bound.entry.refusal.request_digest, requestDigest(boundRequest));
  } finally {
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
    _resetIssuerKey();
    resetIssuerHistoryStore();
    _resetIssuerRootStartupState();
  }
});

test('replaying a refusal against a different request does not match', () => {
  resetIdempotencyStore();
  const stored = { request_digest: DIGEST };
  claimIdempotency('idem-replay', DIGEST);
  const other = { ...REQUEST, idempotency_key: 'idem-replay', body: '{"model":"other"}' };
  assert.equal(refusalMatchesRequest(stored, REQUEST), true);
  assert.equal(refusalMatchesRequest(stored, other), false);
  assert.throws(
    () => claimIdempotency('idem-replay', requestDigest(other)),
    (err) => err.code === 'idempotency_conflict',
  );
});

test('a paid settle signs request_digest without publishing an unsalted body hash', async () => {
  const gatewaySrc = fs.readFileSync(fileURLToPath(new URL('../src/openai-gateway.js', import.meta.url)), 'utf8');
  const settleCalls = [...gatewaySrc.matchAll(/registerPaidV1Shell\(\{([\s\S]*?)\}\)/g)]
    .map((match) => match[1])
    .filter((body) => body.includes('payment:'));
  assert.equal(settleCalls.length, 2);
  for (const body of settleCalls) {
    assert.match(body, /\breq,/);
    assert.match(body, /resourcePath/);
  }

  const prev = {};
  const keys = [
    'ISSUER_ROOT_ENABLED', 'ISSUER_ROOT_CHAIN_ID', 'ISSUER_ROOT_REGISTRY', 'ISSUER_ROOT_SEQ',
    'ISSUER_ROOT_HASH', 'ISSUER_ROOT_STARTUP_CHECK', 'ISSUER_ROOT_RPC_URL', 'ISSUER_ROOT_RPC_URL_2',
    'ISSUER_ROOT_LEGACY_SET', 'ISSUER_PRIVATE_KEY', 'ISSUER_KEY_NOT_BEFORE', 'ISSUER_ROOT_CUTOVER',
  ];
  for (const key of keys) prev[key] = process.env[key];
  try {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
    _resetIssuerKey();
    resetIssuerHistoryStore();
    const chain = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/issuer-root-chain.json', import.meta.url)), 'utf8'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-paid-bind-'));
    const file = path.join(dir, 'set.json');
    fs.writeFileSync(file, JSON.stringify(chain.legacy || buildLegacyReceiptSet([])));
    process.env.ISSUER_ROOT_ENABLED = 'true';
    process.env.ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
    process.env.ISSUER_ROOT_REGISTRY = chain.registry;
    process.env.ISSUER_ROOT_SEQ = chain.rootSeq;
    process.env.ISSUER_ROOT_HASH = chain.rootHash;
    process.env.ISSUER_ROOT_STARTUP_CHECK = 'strict';
    process.env.ISSUER_ROOT_RPC_URL = 'http://rpc.provider-a.example:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://rpc.provider-b.test:10';
    process.env.ISSUER_ROOT_LEGACY_SET = file;
    delete process.env.ISSUER_ROOT_CUTOVER;
    const fetchImpl = async (_url, opts) => {
      const rpcBody = JSON.parse(opts.body);
      if (rpcBody.method === 'eth_chainId') return { ok: true, json: async () => ({ result: '0x14a34' }) };
      if (rpcBody.method === 'eth_getBlockByNumber') {
        const tag = rpcBody.params[0];
        if (tag === 'finalized') {
          return { ok: true, json: async () => ({ result: { number: `0x${chain.finalizedNumber.toString(16)}`, hash: chain.finalizedHash } }) };
        }
        if (Number(tag) === chain.frozenBlock) {
          return { ok: true, json: async () => ({ result: { number: chain.frozen.blockNumber, hash: chain.frozenBlockHash } }) };
        }
        throw new Error(`unexpected block ${tag}`);
      }
      if (rpcBody.method === 'eth_getLogs') {
        const topic0 = rpcBody.params[0].topics[0];
        if (topic0 === KEY_RETIRED_TOPIC) return { ok: true, json: async () => ({ result: [] }) };
        const source = topic0 === chain.frozen.topics[0] ? chain.frozen : chain.rootCommitted;
        return { ok: true, json: async () => ({ result: [source] }) };
      }
      throw new Error(`unexpected ${rpcBody.method}`);
    };
    await assertIssuerRootStartup({ fetchImpl, log() {} });

    const { registerPaidV1Shell } = await import('../src/openai-gateway.js');
    const { buildReceipt, decodeReceiptClaims } = await import('../src/receipt.js');
    const raw = '{"model":"xfuel/auto","messages":[{"role":"user","content":"secret prompt"}]}';
    const unsalted = crypto.createHash('sha256').update(raw).digest('hex');
    const req = {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'idempotency-key': 'pay-1' },
      rawBody: Buffer.from(raw),
      body: JSON.parse(raw),
    };
    const { task } = registerPaidV1Shell({
      taskId: 'xfuel-paid-bind',
      payment: {
        amount: '2000',
        ref: `base:0x${'ab'.repeat(32)}`,
        payer: `0x${'11'.repeat(20)}`,
        payTo: `0x${'22'.repeat(20)}`,
        asset: 'USDC',
      },
      model: 'xfuel/auto',
      messages: req.body.messages,
      req,
      resourcePath: '/v1/chat/completions',
    });
    assert.ok(task.request);
    const receipt = buildReceipt(task, { signingSecret: 'paid-bind', agentId: 4 });
    const headers = {};
    applyRequestSaltHeader({ setHeader(name, value) { headers[name.toLowerCase()] = value; } }, receipt);
    const salt = headers['x-chit-request-salt'];
    assert.equal(salt, requestSalt(task.request));
    assert.match(salt, /^[0-9a-f]{64}$/);
    const claims = decodeReceiptClaims(receipt);
    assert.equal(typeof claims.request_digest, 'string');
    assert.equal(claims.request_digest, receipt.request_digest);
    assert.equal(claims.request_digest, requestDigest(task.request));
    const published = JSON.stringify(receipt);
    const signed = JSON.stringify(claims);
    assert.equal(published.includes(salt), false);
    assert.equal(signed.includes(salt), false);
    assert.equal(receipt.request_preimage, undefined);
    assert.equal(published.includes(unsalted), false);
    assert.equal(published.includes('body_sha256'), false);
    assert.equal(published.includes(raw), false);
    assert.equal(published.includes(bodyCommitmentHex(salt, raw)), false);
    assert.notEqual(receipt.request_digest, unsalted);

    const storedJws = receipt.issuer_signature.jws;
    task.issuerSignature = receipt.issuer_signature;
    const replay = buildReceipt(task, { signingSecret: 'paid-bind', agentId: 4 });
    assert.equal(replay.issuer_signature.jws, storedJws);
    task.request = { ...task.request, body: `${raw} ` };
    assert.throws(
      () => buildReceipt(task, { signingSecret: 'paid-bind', agentId: 4 }),
      (err) => err.code === 'idempotency_conflict',
    );
    assert.equal(task.issuerSignature.jws, storedJws);
  } finally {
    for (const key of keys) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
    _resetIssuerKey();
    resetIssuerHistoryStore();
    _resetIssuerRootStartupState();
  }
});
