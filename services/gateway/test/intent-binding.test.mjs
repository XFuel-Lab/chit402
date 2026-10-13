/**
 * Bundle 2: signed intent, freeze-time pins, optional v12 receipt block.
 * v12 minting is flag-gated and refused in production. The main payload
 * version constant stays 10.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import express from 'express';
import { generateKeyPairSync } from 'node:crypto';

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

test('v12 minting stays off in production and the live payload version stays 10', () => {
  assert.equal(v12MintEnabled({ NODE_ENV: 'production', RECEIPT_V12_MINT: 'true' }), false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'test', RECEIPT_V12_MINT: 'false' }), false);
  assert.equal(v12MintEnabled({ NODE_ENV: 'test', RECEIPT_V12_MINT: 'true' }), true);
  assert.equal(CANONICAL_PAYLOAD_VERSION, 10);
  assert.equal(RECEIPT_PAYLOAD_VERSION, 10);
  assert.notEqual(activeReceiptPayloadVersion(), 12);
});

test('public GET reveals nothing until a receipt exists, then no extra plaintext', async () => {
  const httpStore = openIntentStore(path.join(dir, 'http.sqlite'));
  const app = express();
  app.use(express.json());
  registerIntentRoutes(app, { store: httpStore });
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
    assert.equal(issued.status, 400, issued.text);

    const created = await json(server.base, 'POST', '/intent', {
      payer: PAYER,
      payee: PAYEE,
      max_amount: '5000',
      expiry: '2026-12-01T00:00:00.000Z',
      use_count: 1,
      external_ref: TOKEN,
    });
    assert.equal(created.status, 201, created.text);
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
      amount: '5000',
    });
    assert.equal(settled.status, 200, settled.text);
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
      payer: PAYER,
      payee: PAYEE,
      amount: '5000',
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

test('spend, expiry, and subject failures do not mint a second receipt', () => {
  const local = openIntentStore(path.join(dir, 'rules.sqlite'));
  try {
    const over = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-01-01T00:00:00.000Z', use_count: 2,
    });
    assert.equal(settleIntent(local, {
      intent_id: over.body.intent_id, payer: PAYER, payee: PAYEE, amount: '101',
      now_ms: Date.parse('2025-12-01T00:00:00.000Z'),
    }).error, 'intent_violation');
    const late = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-01-01T00:00:00.000Z', use_count: 1,
    });
    assert.equal(settleIntent(local, {
      intent_id: late.body.intent_id, payer: PAYER, payee: PAYEE, amount: '100',
      now_ms: Date.parse('2026-02-01T00:00:00.000Z'),
    }).error, 'intent_violation');
    const cross = issueIntent(local, {
      payer: PAYER, payee: PAYEE, max_amount: '100', expiry: '2026-12-01T00:00:00.000Z', use_count: 1,
    });
    assert.equal(settleIntent(local, {
      intent_id: cross.body.intent_id, payer: OTHER, payee: PAYEE, amount: '100',
    }).error, 'intent_mismatch');
    assert.equal(settleIntent(local, {
      intent_id: cross.body.intent_id, payer: PAYER, payee: OTHER, amount: '100',
    }).error, 'intent_mismatch');
    assert.equal(local.receiptsFor(over.body.intent_id).length, 0);
    assert.equal(local.receiptsFor(late.body.intent_id).length, 0);
    assert.equal(local.receiptsFor(cross.body.intent_id).length, 0);
    assert.equal(settleIntent(local, {
      intent_id: cross.body.intent_id, payer: PAYER, payee: PAYEE, amount: '100',
    }, { NODE_ENV: 'production', RECEIPT_V12_MINT: 'true' }).error, 'v12_mint_disabled');
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
        amount: '100',
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
