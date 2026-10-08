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
  captureRawRequestBody,
  claimIdempotency,
  clientRequestForRefusal,
  refusalMatchesRequest,
  requestDigest,
  requestDigestCanonical,
  requestDigestPreimage,
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
const REQUEST = {
  method: 'POST',
  path: '/v1/chat/completions',
  body: BODY,
  idempotency_key: 'idem-1',
  nonce: null,
};
const PREIMAGE = '{"body_sha256":"93dda1aa54d9bb86b7c2cdfaad61fd78e5b81656484a8941eee498adc9a54e54","idempotency_key":"idem-1","method":"POST","nonce":null,"path":"/v1/chat/completions"}';
const DIGEST = 'a9a7ca02eb504b94c7efb7a3a5832c0fc847e37cf6930ca48db3c0b6e04498f6';

test('matching request_digest vector', () => {
  const terms = requestDigestPreimage(REQUEST);
  assert.equal(requestDigestCanonical(REQUEST), PREIMAGE);
  assert.equal(PREIMAGE, jcsRfc8785(terms));
  assert.equal(requestDigest(REQUEST), DIGEST);
  assert.equal(crypto.createHash('sha256').update(PREIMAGE, 'utf8').digest('hex'), DIGEST);
  assert.equal(terms.idempotency_key, 'idem-1');
  assert.equal(terms.nonce, null);
});

test('a tampered body changes request_digest', () => {
  const tampered = requestDigest({ ...REQUEST, body: `${BODY} ` });
  assert.notEqual(tampered, DIGEST);
  assert.equal(tampered, '58d6c3fc6c8d7c641c1a16a14ea6b5b9e7926dc5cf74e45fd717363d0506704f');
});

test('the same idempotency key with a different payload fails closed', () => {
  resetIdempotencyStore();
  assert.equal(claimIdempotency('idem-1', DIGEST).replay, false);
  assert.equal(claimIdempotency('idem-1', DIGEST).replay, true);
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

test('the JSON parser keeps raw body bytes for body_sha256', async () => {
  const app = express();
  app.use(express.json({ verify: captureRawRequestBody }));
  app.post('/v1/chat/completions', (req, res) => {
    const binding = clientRequestForRefusal(req, req.path);
    res.json({ digest: requestDigest(binding) });
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
    const spaced = requestDigest({ method: 'POST', path: '/v1/chat/completions', body: raw });
    assert.equal(json.digest, spaced);
    assert.equal(
      requestDigestPreimage({ method: 'POST', path: '/v1/chat/completions', body: raw }).body_sha256,
      crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
    );
    const collapsed = clientRequestForRefusal({
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: JSON.parse(raw),
    }, '/v1/chat/completions');
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
    process.env.ISSUER_ROOT_RPC_URL = 'http://127.0.0.1:9';
    process.env.ISSUER_ROOT_RPC_URL_2 = 'http://127.0.0.1:10';
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
    const bound = ledger.recordPolicyBlocked({
      agentId: 4,
      taskId: 'bind-unbound',
      policyCode: 'policy_blocked',
      reason: 'cap',
      request: { method: 'POST', path: '/v1/chat/completions', body: BODY },
    });
    assert.equal(bound.ok, true);
    assert.equal(bound.entry.seq, 1);
    assert.equal(bound.entry.refusal.request_digest, requestDigest({ method: 'POST', path: '/v1/chat/completions', body: BODY }));
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
