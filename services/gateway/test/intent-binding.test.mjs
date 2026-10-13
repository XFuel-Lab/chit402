/**
 * Bundle 2: signed intent, freeze-time pins, optional v12 receipt block.
 * v12 minting is flag-gated and refused in production. The main payload
 * version constant stays 10.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import express from 'express';
import { ethers } from 'ethers';
import { generateKeyPairSync } from 'node:crypto';
import { ChallengeStore } from '../src/x402-adapter.js';
import { confirmEvmReceipt, readEvmAuthorization } from '../src/x402-chain.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.NODE_ENV = 'test';
process.env.ALLOW_EPHEMERAL_ISSUER_KEY = 'true';
process.env.RECEIPT_V12_MINT = 'true';
delete process.env.ISSUER_KID;
process.env.ISSUER_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');

const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const {
  CANONICAL_PAYLOAD_VERSION,
} = await import('../src/canonical-preimage.js');
const { activeReceiptPayloadVersion, RECEIPT_PAYLOAD_VERSION } = await import('../src/receipt.js');
const {
  INTENT_PROJECTION_SPEC,
  SPEND_COMPARATOR,
  buildV12Receipt,
  comparatorPin,
  hashExternalRef,
  intentHash,
  issueIntent,
  INTENT_ISSUE_COMPILED,
  parseV12Uuid,
  publicIntentShell,
  settleIntent,
  specDigest,
  v12MintEnabled,
} = await import('../src/intent-record.js');
const { openIntentStore } = await import('../src/intent-store.js');
const { registerIntentRoutes } = await import('../src/intent-api.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-b2-'));
const store = openIntentStore(path.join(dir, 'intent.sqlite'));
const TOKEN = 'amex-intent-tok_9f3c-not-a-hash';
const MERCHANT = 'Amex Merchant Plaza';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAYEE = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';

after(() => {
  try { store.close(); } catch { /* closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function json(base, method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, text, body: parsed, cache: res.headers.get('cache-control') };
}

function keysNamed(value, names, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item) => keysNamed(item, names, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (names.includes(key)) found.push(key);
    keysNamed(child, names, found);
  }
  return found;
}

test('v12 uuid parser rejects anything that is not a lowercase uuid', () => {
  const uuid = '6f1e2d3c-4b5a-6978-8a7b-6c5d4e3f2a1b';
  assert.deepEqual(parseV12Uuid(uuid), { uuid, prefix: null });
  assert.deepEqual(parseV12Uuid(`chit-${uuid}`), { uuid, prefix: 'chit' });
  assert.deepEqual(parseV12Uuid(`xfuel-${uuid}`), { uuid, prefix: 'xfuel' });
  for (const bad of [
    `CHIT-${uuid}`,
    uuid.toUpperCase(),
    `chit-xfuel-${uuid}`,
    `${uuid}/`,
    ` ${uuid}`,
    `${uuid}\u0000`,
    `${uuid}?task=xfuel-other`,
    '6f1e2d3c-4b5a-6978-8a7b-6c5d4e3f2a1',
    `chit-${uuid.slice(0, 8)}`,
  ]) {
    assert.equal(parseV12Uuid(bad), null, bad);
  }
});

test('intent_hash is sha256 of the JCS signed bytes only', () => {
  const claims = {
    schema: 'chit402.intent.v1',
    intent_id: crypto.randomUUID(),
    payer: PAYER,
    payee: PAYEE,
    asset: 'USDC',
    chain: 'eip155:8453',
    max_amount: '5000',
    expiry: '2026-10-20T00:00:00.000Z',
    use_count: 1,
    iat: '2026-10-13T12:00:00.000Z',
    iss: 'chit402',
    spec_digest: specDigest(),
    comparator_pin: comparatorPin(),
    external_ref_hash: hashExternalRef(TOKEN),
  };
  const hash = intentHash(claims);
  assert.equal(hash, crypto.createHash('sha256').update(jcsRfc8785(claims), 'utf8').digest('hex'));
  const wrapped = { ...claims, merchant: MERCHANT, jws: 'not-signed-bytes' };
  assert.notEqual(intentHash(wrapped), hash);
  assert.equal(hashExternalRef(TOKEN), crypto.createHash('sha256').update(TOKEN, 'utf8').digest('hex'));
  assert.equal(specDigest(), crypto.createHash('sha256').update(jcsRfc8785(INTENT_PROJECTION_SPEC), 'utf8').digest('hex'));
  assert.equal(comparatorPin(), crypto.createHash('sha256').update(jcsRfc8785(SPEND_COMPARATOR), 'utf8').digest('hex'));
  assert.equal(INTENT_PROJECTION_SPEC.absent.includes('cap_row_hash'), true);
});

function paymentDeps({
  amount = '5000',
  payer = PAYER,
  payee = PAYEE,
  tx = `base:0x${'ab'.repeat(32)}`,
  calls = [],
} = {}) {
  return {
    cfg: { network: 'base' },
    calls,
    async settleBoundPayment(args) {
      calls.push(args);
      return {
        kind: 'settled',
        confirmed: true,
        settledAmount: amount,
        payerWallet: payer,
        payTo: payee,
        paymentRef: tx,
        bookSpent() {},
        releaseClaim() {},
      };
    },
  };
}

test('v12 minting stays off in production and the live payload version stays 10', () => {
  assert.equal(INTENT_ISSUE_COMPILED, false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'production', RECEIPT_V12_MINT: 'true' }), false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'development', RECEIPT_V12_MINT: 'true' }), false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'test', RECEIPT_V12_MINT: 'false' }), false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'test', RECEIPT_V12_MINT: 'true' }), true);
  assert.equal(CANONICAL_PAYLOAD_VERSION, 10);
  assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
  assert.notEqual(activeReceiptPayloadVersion(), 12);
});

test('public GET reveals nothing until a receipt exists, then no extra plaintext', async () => {
  const httpStore = openIntentStore(path.join(dir, 'http.sqlite'));
  const pay = paymentDeps({ amount: '5000', tx: `base:0x${'11'.repeat(32)}` });
  const app = express();
  app.use(express.json());
  registerIntentRoutes(app, { store: httpStore, payment: pay });
  const server = await listen(app);
  try {
    const issued = await json(server.base, 'POST', '/intent', {
      payer: PAYER,
      payee: PAYEE,
      max_amount: '5000',
      expiry: '2026-12-01T00:00:00.000Z',
      use_count: 1,
      external_ref: TOKEN,
      merchant: MERCHANT,
    });
    assert.equal(issued.status, 404);
    assert.equal(issued.text, '{"error":"not_found"}');
    assert.equal(issued.text.includes(TOKEN), false);
    assert.equal(issued.text.includes(PAYER), false);

    const merchant = issueIntent(httpStore, {
      payer: PAYER, payee: PAYEE, max_amount: '5000', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
      external_ref: TOKEN, merchant: MERCHANT,
    });
    assert.equal(merchant.error, 'invalid_intent');
    const created = issueIntent(httpStore, {
      payer: PAYER, payee: PAYEE, max_amount: '5000', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
      external_ref: TOKEN,
    });
    assert.equal(created.ok, true, created.error);
    assert.equal(created.body.claims.external_ref_hash, hashExternalRef(TOKEN));
    assert.equal(JSON.stringify(created.body).includes(TOKEN), false);
    assert.equal(JSON.stringify(created.body).includes(MERCHANT), false);
    assert.equal(created.body.claims.intent_id, created.body.intent_id);
    assert.equal(parseV12Uuid(created.body.intent_id)?.prefix, null);

    const hidden = await json(server.base, 'GET', `/intent/${created.body.intent_id}`);
    const unknown = await json(server.base, 'GET', `/intent/${crypto.randomUUID()}`);
    const prefixed = await json(server.base, 'GET', `/intent/chit-${created.body.intent_id}`);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.text, unknown.text);
    assert.equal(hidden.text, prefixed.text);
    assert.equal(hidden.text, '{"error":"not_found"}');
    assert.equal(hidden.cache, 'private, no-store');
    assert.equal(hidden.text.includes(created.body.intent_id), false);
    assert.equal(hidden.text.includes('5000'), false);

    const settled = await json(server.base, 'POST', `/intent/${created.body.intent_id}/settle`, {
      payer: PAYER,
      payee: PAYEE,
      amount: '1',
      payment_header: 'pay',
      nonce: 'nonce-http',
    });
    assert.equal(settled.status, 200, settled.text);
    assert.equal(pay.calls[0].amount, null);
    assert.equal(settled.body.receipt.payment.gross_amount, '5000');
    const receipt = settled.body.receipt;
    assert.equal(receipt.payload_version, 12);
    assert.equal(receipt.issuer_signature.payload_version, 12);
    assert.deepEqual(Object.keys(receipt.issuer_history).sort(), ['entry_count', 'head_hash']);
    assert.equal(receipt.issuer_history.entry_count >= 1, true);
    assert.match(receipt.issuer_history.head_hash, /^[0-9a-f]{64}$/);
    assert.equal(Object.prototype.hasOwnProperty.call(receipt, 'cap_row_hash'), false);
    assert.deepEqual(keysNamed(receipt, ['max_amount', 'merchant', 'merchant_name', 'external_ref', 'cap_row_hash']), []);
    assert.equal(JSON.stringify(receipt).includes(TOKEN), false);
    assert.equal(receipt.intent.intent_id, created.body.intent_id);
    assert.equal(receipt.intent.intent_hash, created.body.intent_hash);
    assert.equal(receipt.intent.spec_digest, specDigest());
    assert.equal(receipt.intent.comparator_pin, comparatorPin());
    assert.equal(receipt.task_id.startsWith('chit-'), true);

    const again = await json(server.base, 'POST', `/intent/${created.body.intent_id}/settle`, {
      payment_header: 'pay',
      nonce: 'nonce-http',
      amount: '1',
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'intent_violation');
    assert.equal(httpStore.receiptsFor(created.body.intent_id).length, 1);

    const pub = await json(server.base, 'GET', `/intent/xfuel-${created.body.intent_id}`);
    assert.equal(pub.status, 200, pub.text);
    assert.equal(pub.body.intent_id, created.body.intent_id);
    assert.equal(pub.body.intent_id.startsWith('xfuel-'), false);
    assert.deepEqual(keysNamed(pub.body, ['max_amount', 'payee', 'payer', 'merchant', 'external_ref', 'cap_row_hash']), []);
    assert.equal(JSON.stringify(pub.body).includes(TOKEN), false);
    assert.equal(pub.cache, 'private, no-store');
  } finally {
    await server.close();
    httpStore.close();
  }
});

test('spend, expiry, and subject failures do not mint a second receipt', async () => {
  const local = openIntentStore(path.join(dir, 'rules.sqlite'));
  const input = (intentId, extra = {}) => ({
    intent_id: intentId,
    amount: '1',
    payer: OTHER,
    payee: OTHER,
    now_ms: Date.parse('2020-01-01T00:00:00.000Z'),
    history_pin: { head_hash: '00'.repeat(32), entry_count: 9 },
    payment_header: 'h',
    nonce: 'n',
    ...extra,
  });
  try {
    const overPay = paymentDeps({ amount: '101', tx: `base:0x${'a1'.repeat(32)}` });
    const over = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-12-01T00:00:00.000Z', use_count: 2,
    });
    assert.equal((await settleIntent(local, input(over.body.intent_id), process.env, overPay)).error, 'intent_violation');
    assert.equal(overPay.calls[0].amount, null);
    const late = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-01-01T00:00:00.000Z', use_count: 1,
    });
    assert.equal((await settleIntent(local, input(late.body.intent_id), process.env, paymentDeps())).error, 'intent_violation');
    const cross = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
    });
    assert.equal((await settleIntent(local, input(cross.body.intent_id), process.env, paymentDeps({
      payer: OTHER, tx: `base:0x${'a2'.repeat(32)}`,
    }))).error, 'intent_mismatch');
    assert.equal((await settleIntent(local, input(cross.body.intent_id), process.env, paymentDeps({
      payee: OTHER, tx: `base:0x${'a3'.repeat(32)}`,
    }))).error, 'intent_mismatch');
    assert.equal(local.receiptsFor(over.body.intent_id).length, 0);
    assert.equal(local.receiptsFor(late.body.intent_id).length, 0);
    assert.equal(local.receiptsFor(cross.body.intent_id).length, 0);
    assert.equal((await settleIntent(local, input(cross.body.intent_id), {
      NODE_ENV: 'production', RECEIPT_V12_MINT: 'true',
    }, paymentDeps())).error, 'v12_mint_disabled');
  } finally {
    local.close();
  }
});

test('one use is consumed by one of two concurrent settlers', async () => {
  const file = path.join(dir, 'race.sqlite');
  const race = openIntentStore(file);
  const issued = issueIntent(race, {
    payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
  });
  assert.equal(issued.ok, true, issued.error);
  const run = () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./intent-consume-worker.mjs', import.meta.url), {
      workerData: {
        file,
        intentId: issued.body.intent_id,
        payer: PAYER,
        payee: PAYEE,
        chainAmount: '100',
        tx: `base:0x${'44'.repeat(32)}`,
      },
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
  const [a, b] = await Promise.all([run(), run()]);
  const wins = [a, b].filter((row) => row.ok);
  assert.equal(wins.length, 1, JSON.stringify([a, b]));
  assert.equal(race.receiptsFor(issued.body.intent_id).length, 1);
  race.close();
});

test('a built v12 receipt does not carry cap_row_hash', () => {
  const receipt = buildV12Receipt({
    claims: {
      asset: 'USDC',
      comparator_pin: comparatorPin(),
      spec_digest: specDigest(),
      intent_id: crypto.randomUUID(),
    },
    intentHash: 'ab'.repeat(32),
    amount: '10',
    paymentRef: `base:0x${'10'.repeat(32)}`,
    payer: PAYER,
    payee: PAYEE,
    issued: '2026-10-13T12:00:00.000Z',
    useIndex: 1,
    pin: { head_hash: 'cd'.repeat(32), entry_count: 1 },
    kid: null,
  });
  assert.equal(JSON.stringify(receipt).includes('cap_row_hash'), false);
  assert.deepEqual(publicIntentShell({
    schema: 'chit402.intent.v1',
    intent_id: receipt.intent.intent_id,
    intent_hash: receipt.intent.intent_hash,
    claims: { spec_digest: specDigest(), comparator_pin: comparatorPin(), max_amount: '10', payee: PAYEE },
  }, { receiptId: receipt.task_id, useIndex: 1 }).max_amount, undefined);
});

test('settle uses the #520 confirmed transfer, not the request amount', async () => {
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const tx = `0x${'cd'.repeat(32)}`;
  const authNonce = `0x${'ee'.repeat(32)}`;
  const challengeNonce = `0x${'ab'.repeat(32)}`;
  const pad = (addr) => ethers.zeroPadValue(addr, 32);
  const header = Buffer.from(JSON.stringify({
    network: 'base',
    amount: '1',
    payTo: PAYEE,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: PAYER,
        to: PAYEE,
        value: '2500',
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: authNonce,
      },
    },
  })).toString('base64');
  const chainReceipt = {
    status: '0x1',
    blockNumber: '0x10',
    contractAddress: null,
    logs: [
      {
        address: USDC,
        topics: [ethers.id('Transfer(address,address,uint256)'), pad(PAYER), pad(PAYEE)],
        data: ethers.toBeHex(2500n, 32),
        logIndex: '0x0',
      },
      {
        address: USDC,
        topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(PAYER), pad(authNonce)],
        data: '0x',
        logIndex: '0x1',
      },
    ],
  };
  const listenHttp = (handler) => new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(handler(req, body)));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
  const fac = await listenHttp((req, body) => {
    const from = body.paymentPayload?.payload?.authorization?.from || PAYER;
    if (req.url.endsWith('/verify')) return { valid: true, isValid: true, payer: from };
    return { settled: true, success: true, txRef: tx, transaction: tx, network: 'base', payer: from };
  });
  const local = openIntentStore(path.join(dir, 'paid.sqlite'));
  try {
    const challenges = new ChallengeStore();
    challenges.put(challengeNonce, {
      taskId: 'intent-pay',
      amount: '2500',
      asset: USDC,
      network: 'base',
      payTo: PAYEE,
      resource: '/task-request',
      state: 'issued',
      expiresAt: Date.now() + 60_000,
      nonce: challengeNonce,
    });
    const issued = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '5000', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
    });
    const result = await settleIntent(local, {
      intent_id: issued.body.intent_id,
      amount: '1',
      payer: OTHER,
      payee: OTHER,
      payment_header: header,
      nonce: challengeNonce,
    }, process.env, {
      cfg: {
        network: 'base',
        payTo: PAYEE,
        facilitatorProvider: 'zan',
        gatewayUrl: fac.url,
        apiKey: 'k',
        asset: USDC,
        allowUnboundPayments: false,
        chainReader: async ({ challenge, facilitator, paymentHeader }) => confirmEvmReceipt(chainReceipt, {
          challenge,
          expectedPayTo: PAYEE,
          authorization: readEvmAuthorization(paymentHeader),
          facilitatorPayer: facilitator?.payer,
        }),
      },
      store: challenges,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.body.receipt.payment.gross_amount, '2500');
    assert.equal(result.body.receipt.payment.ref.endsWith(tx), true);
    assert.equal(JSON.stringify(result.body.receipt).includes('"gross_amount":"1"'), false);
    const replay = await settleIntent(local, {
      intent_id: issued.body.intent_id,
      amount: '2500',
      payment_header: header,
      nonce: challengeNonce,
    }, process.env, {
      cfg: { network: 'base', allowUnboundPayments: false },
      store: challenges,
    });
    assert.notEqual(replay.ok, true);
    assert.equal(local.receiptsFor(issued.body.intent_id).length, 1);
  } finally {
    await fac.close();
    local.close();
  }
});
