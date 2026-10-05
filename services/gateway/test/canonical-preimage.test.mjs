/**
 * Stored canonical object and versioned issuer history.
 * The preimage bytes are what was sealed at issuance. A missing store is not rebuilt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const {
  sealCanonicalObject,
  storedCanonicalPreimage,
  writeCanonicalPreimage,
  RECEIPT_CANONICAL_FIELDS,
  REFUSAL_CANONICAL_FIELDS,
} = await import('../src/canonical-preimage.js');
const { jcsCanonicalize } = await import('../src/offer-receipt.js');
const {
  buildReceipt,
  decodeReceiptClaims,
  RECEIPT_PAYLOAD_VERSION,
} = await import('../src/receipt.js');
const { issueRefusalReceipt, verifyRefusalReceipt } = await import('../src/refusal-receipt.js');
const {
  currentIssuerHistory,
  issuerHistoryRecord,
  resetIssuerHistoryStore,
  writeIssuerHistory,
  issuerKeyWindow,
  verifyIssuerHistory,
} = await import('../src/issuer-history.js');
const { getIssuerPublicKeyJwk, getIssuerKid } = await import('../src/issuer-key.js');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function paidTask(over = {}) {
  return {
    taskId: over.taskId || 'xfuel-canonical-1',
    status: 'completed',
    createdAt: '2026-09-26T17:27:32Z',
    updatedAt: '2026-09-26T17:27:32Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      amount: '2000',
      modelId: 'theta/qwen3',
      prompt: 'super-secret-prompt-text',
      messages: [{ role: 'user', content: 'super-secret-prompt-text' }],
    },
    meta: {
      payerWallet: '0x1111111111111111111111111111111111111111',
      payTo: '0x2222222222222222222222222222222222222222',
      provider: 'theta-edgecloud',
      agentId: 4,
      apiKey: 'sk-live-secret',
    },
    result: {
      provider: 'theta-edgecloud',
      model: 'theta/qwen3',
      output: 'model output text that stays private',
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

test('a new receipt stores the canonical object and does not rebuild it', () => {
  const previous = process.env.ISSUER_KEY_NOT_BEFORE;
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  resetIssuerHistoryStore();
  try {
    const receipt = buildReceipt(paidTask(), { signingSecret: 'canonical-secret', agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.payload_version, RECEIPT_PAYLOAD_VERSION);
    assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
    assert.equal(receipt.hmac_attestation.payload_version, 8);
    const bytes = receipt.issuer_signature.canonical_preimage;
    assert.equal(typeof bytes, 'string');
    assert.equal(bytes, jcsCanonicalize(JSON.parse(bytes)));
    assert.equal(sha256(bytes), claims.payload_hash);
    assert.equal(receipt.issuer_signature.payload_hash, claims.payload_hash);
    assert.equal(receipt.issuer_signature.hash_alg, 'sha256');
    assert.equal(claims.issuer_history.hash, currentIssuerHistory().hash);
    assert.equal(claims.issuer_history.version, claims.issuer_history.seq);
    assert.equal(bytes.includes('payload_hash'), false);
    assert.equal(bytes.includes('super-secret-prompt-text'), false);
    assert.equal(bytes.includes('sk-live-secret'), false);
    assert.equal(bytes.includes('model output text'), false);
    const keys = Object.keys(JSON.parse(bytes));
    for (const key of keys) assert.ok(RECEIPT_CANONICAL_FIELDS.includes(key), key);
    const stripped = {
      ...receipt,
      issuer_signature: { ...receipt.issuer_signature },
    };
    delete stripped.issuer_signature.canonical_preimage;
    assert.equal(storedCanonicalPreimage(stripped), null);
    assert.throws(
      () => sealCanonicalObject({ task_id: 't', prompt: 'nope' }, ['task_id', 'prompt']),
      /private field/,
    );
  } finally {
    if (previous == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
    else process.env.ISSUER_KEY_NOT_BEFORE = previous;
    resetIssuerHistoryStore();
  }
});

test('GET /preimage returns the stored bytes and names the hash algorithm', async () => {
  const previous = process.env.ISSUER_KEY_NOT_BEFORE;
  process.env.ISSUER_KEY_NOT_BEFORE = '2026-09-04T08:52:05Z';
  resetIssuerHistoryStore();
  const receipt = buildReceipt(paidTask({ taskId: 'xfuel-canonical-http' }), { agentId: 4 });
  const refusal = issueRefusalReceipt({
    agent_id: 7,
    task_id: 'blocked-canonical',
    seq: 1,
    prev_hash: null,
    row_hash: 'cd'.repeat(32),
    policy_code: 'daily_cap_exceeded',
    reason: 'over the cap',
    collected_at: '2026-09-26T17:27:32Z',
  });
  assert.equal(verifyRefusalReceipt(refusal).valid, true);
  assert.equal(sha256(refusal.canonical_preimage), refusal.payload_hash);
  const refusalKeys = Object.keys(JSON.parse(refusal.canonical_preimage));
  for (const key of refusalKeys) assert.ok(REFUSAL_CANONICAL_FIELDS.includes(key), key);

  const app = express();
  app.get('/receipt/:id/preimage', (_req, res) => writeCanonicalPreimage(res, receipt, _req.query));
  app.get('/refusal/:id/preimage', (_req, res) => writeCanonicalPreimage(res, refusal, _req.query));
  app.get('/.well-known/issuer-history.json', (req, res) => writeIssuerHistory(res, req.query));
  const { server, port } = await listen(app);
  try {
    const bodyRes = await fetch(`http://127.0.0.1:${port}/receipt/xfuel-canonical-http/preimage`);
    const body = Buffer.from(await bodyRes.arrayBuffer());
    assert.equal(bodyRes.headers.get('x-chit-hash-alg'), 'sha256');
    assert.equal(body.toString('utf8'), receipt.issuer_signature.canonical_preimage);
    assert.equal(sha256(body.toString('utf8')), bodyRes.headers.get('x-chit-payload-hash'));
    assert.equal(bodyRes.headers.get('x-chit-payload-hash'), decodeReceiptClaims(receipt).payload_hash);

    const meta = await fetch(`http://127.0.0.1:${port}/receipt/xfuel-canonical-http/preimage?meta=1`);
    const described = await meta.json();
    assert.equal(described.alg, 'sha256');
    assert.equal(described.hash, decodeReceiptClaims(receipt).payload_hash);

    const refusalRes = await fetch(`http://127.0.0.1:${port}/refusal/rfs/preimage`);
    const refusalBody = await refusalRes.text();
    assert.equal(refusalBody, refusal.canonical_preimage);
    assert.equal(refusalRes.headers.get('x-chit-hash-alg'), 'sha256');

    const historyRes = await fetch(`http://127.0.0.1:${port}/.well-known/issuer-history.json`);
    const historyBody = await historyRes.text();
    const latest = currentIssuerHistory();
    assert.equal(historyBody, latest.body);
    assert.equal(sha256(historyBody), historyRes.headers.get('x-chit-history-hash'));
    assert.equal(historyRes.headers.get('x-chit-hash-alg'), 'sha256');
    const parsed = JSON.parse(historyBody);
    assert.equal(jcsCanonicalize(parsed), historyBody);
    assert.equal(verifyIssuerHistory(parsed).valid, true);
  } finally {
    server.close();
    if (previous == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
    else process.env.ISSUER_KEY_NOT_BEFORE = previous;
    resetIssuerHistoryStore();
  }
});

test('issuer history keeps old versions and not_after comes from the pinned snapshot', () => {
  const previousBefore = process.env.ISSUER_KEY_NOT_BEFORE;
  const previousExtra = process.env.ISSUER_HISTORY_EXTRA;
  process.env.ISSUER_KEY_NOT_BEFORE = '2020-01-01T00:00:00Z';
  delete process.env.ISSUER_HISTORY_EXTRA;
  resetIssuerHistoryStore();
  try {
    const v1 = currentIssuerHistory();
    const receipt = buildReceipt(paidTask({ taskId: 'xfuel-pin-v1' }), { agentId: 4 });
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.issuer_history.version, v1.version);
    assert.equal(claims.issuer_history.hash, v1.hash);
    const kid = getIssuerKid();
    const pinned = JSON.parse(v1.body);
    const window = issuerKeyWindow(pinned, kid, claims.iat);
    assert.equal(window.ok, true, window.reason);
    assert.equal(window.not_after, null);

    const jwk = getIssuerPublicKeyJwk();
    process.env.ISSUER_HISTORY_EXTRA = JSON.stringify([{
      kid,
      jwk,
      alg: 'ES256',
      not_before: '2020-01-01T00:00:00Z',
      not_after: '2021-01-01T00:00:00Z',
      status: 'retired',
      revoked_at: null,
      reason: 'rotated',
      custody: 'test custody sentence',
    }]);
    const v2 = currentIssuerHistory();
    assert.equal(v2.version, v1.version + 1);
    assert.notEqual(v2.hash, v1.hash);
    assert.equal(issuerHistoryRecord({ version: v1.version }).body, v1.body);
    assert.equal(issuerHistoryRecord({ hash: v1.hash }).hash, v1.hash);
    const later = JSON.parse(v2.body);
    const retired = issuerKeyWindow(later, kid, claims.iat);
    assert.equal(retired.ok, false);
    assert.equal(retired.reason, 'issued_after_not_after');
    const stillPinned = issuerKeyWindow(JSON.parse(issuerHistoryRecord({ version: 1 }).body), kid, claims.iat);
    assert.equal(stillPinned.ok, true, stillPinned.reason);
  } finally {
    if (previousBefore == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
    else process.env.ISSUER_KEY_NOT_BEFORE = previousBefore;
    if (previousExtra == null) delete process.env.ISSUER_HISTORY_EXTRA;
    else process.env.ISSUER_HISTORY_EXTRA = previousExtra;
    resetIssuerHistoryStore();
  }
});
