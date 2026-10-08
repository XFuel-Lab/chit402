/**
 * External hold/settle API. The cap check is the gateway store, so two
 * overlapping reserves cannot both commit. Settle signs once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { SpendHoldStore } from '../src/spend-hold.js';
import { createSpendHoldService, BASE_SEPOLIA_USDC } from '../src/spend-hold-api.js';
import { renderReceiptHtml } from '../src/receipt.js';

const FUNDER = '0x1111111111111111111111111111111111111111';
const PAYTO = '0x2222222222222222222222222222222222222222';
const PAYER = '0x3333333333333333333333333333333333333333';
const TOKEN = 'test-token-not-a-secret';

function listen(handler) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(err.message);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function service(cap = '10000') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-hold-'));
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const ceilings = new Map([[FUNDER, BigInt(cap)]]);
  const api = createSpendHoldService({
    store,
    token: TOKEN,
    ceilings,
    dir,
    baseUrl: '',
  });
  return { api, dir, store };
}

async function call(base, method, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function holdBody(amount, requestId, network = 'eip155:84532') {
  return {
    request_id: requestId,
    amount: String(amount),
    funder: FUNDER,
    network,
    asset: BASE_SEPOLIA_USDC,
    pay_to: PAYTO,
    entry_at: 1_700_000_000_000,
  };
}

test('parallel reserves against one cap cannot exceed it', async () => {
  const { api } = service('10000');
  const { server, base } = await listen(api.handle);
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call(
      base,
      'POST',
      '/v1/spend/holds',
      holdBody(4000, `req-${i}`, 'eip155:84532'),
    )));
    const ok = results.filter((row) => row.status === 201);
    const denied = results.filter((row) => row.status === 409);
    assert.equal(ok.length, 2);
    assert.equal(denied.length, 6);
    assert.equal(denied[0].json.error.code, 'CEILING_EXCEEDED');
    const listed = await call(base, 'GET', `/v1/spend/holds?funder=${FUNDER}`);
    assert.equal(listed.json.held, '8000');
    assert.equal(listed.json.remaining, '2000');
  } finally {
    server.close();
  }
});

test('mainnet network and mainnet USDC are rejected', async () => {
  const { api } = service();
  const { server, base } = await listen(api.handle);
  try {
    const mainnet = await call(base, 'POST', '/v1/spend/holds', holdBody(1000, 'main', 'eip155:8453'));
    assert.equal(mainnet.status, 400);
    assert.equal(mainnet.json.error.code, 'testnet_only');
    const asset = await call(base, 'POST', '/v1/spend/holds', {
      ...holdBody(1000, 'usdc'),
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    });
    assert.equal(asset.status, 400);
    assert.equal(asset.json.error.code, 'testnet_only');
    const missing = await fetch(`${base}/v1/spend/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(holdBody(1000, 'no-token')),
    });
    assert.equal(missing.status, 401);
  } finally {
    server.close();
  }
});

test('release returns capacity and settle signs once', async () => {
  const { api } = service('10000');
  const { server, base } = await listen(api.handle);
  try {
    const placed = await call(base, 'POST', '/v1/spend/holds', holdBody(8000, 'once'));
    assert.equal(placed.status, 201);
    const replay = await call(base, 'POST', '/v1/spend/holds', holdBody(8000, 'once'));
    assert.equal(replay.status, 200);
    assert.equal(replay.json.idempotent, true);
    const blocked = await call(base, 'POST', '/v1/spend/holds', holdBody(3000, 'other'));
    assert.equal(blocked.status, 409);

    const released = await call(base, 'POST', '/v1/spend/holds/once/release');
    assert.equal(released.status, 200);
    const again = await call(base, 'POST', '/v1/spend/holds', holdBody(3000, 'after-release'));
    assert.equal(again.status, 201);

    const tx = `0x${'ab'.repeat(32)}`;
    const settleBody = {
      tx,
      payer: PAYER,
      resource: 'https://sandbox.example/v1/job',
      agent_id: 7,
    };
    const first = await call(base, 'POST', '/v1/spend/holds/after-release/settle', settleBody);
    assert.equal(first.status, 200);
    assert.equal(first.json.idempotent, false);
    assert.match(first.json.verify_url, /\/receipt\/xfuel-/);
    assert.match(first.json.receipt.issuer_signature.jws, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(first.json.receipt.payment.gross_amount, '3000');
    assert.equal(first.json.receipt.caller_binding.payer_wallet, PAYER);
    assert.equal(first.json.receipt.route.provider, 'sandbox.example');
    assert.equal(first.json.receipt.route.model, '/v1/job');
    assert.equal(first.json.receipt.spend_hold.onchain_check, 'not_performed');
    assert.equal(first.json.receipt.claim_id, '7');

    const second = await call(base, 'POST', '/v1/spend/holds/after-release/settle', settleBody);
    assert.equal(second.json.idempotent, true);
    assert.equal(second.json.receipt.issuer_signature.jws, first.json.receipt.issuer_signature.jws);

    const taskId = first.json.receipt.task_id;
    const got = await fetch(`${base}/receipt/${taskId}?format=json`);
    assert.equal(got.status, 200);
    const stored = await got.json();
    assert.equal(stored.schema, 'chit402.receipt_shell.v1');
    assert.equal(stored.issuer_signature, undefined);
    assert.equal(JSON.stringify(stored).includes(PAYER), false);
    const html = renderReceiptHtml(first.json.receipt);
    assert.match(html, /ES256 signed receipt/);
    assert.match(html, new RegExp(PAYER));
    assert.match(html, /issuer_signature|JWKS/);
  } finally {
    server.close();
  }
});

test('an expired hold is not receipted and does not keep the cap', async () => {
  let now = 1_000;
  const store = new SpendHoldStore({ ttlMs: 1_000, now: () => now });
  const api = createSpendHoldService({
    store,
    token: TOKEN,
    ceilings: new Map([[FUNDER, 5000n]]),
  });
  const { server, base } = await listen(api.handle);
  try {
    const placed = await call(base, 'POST', '/v1/spend/holds', holdBody(5000, 'expiring'));
    assert.equal(placed.status, 201);
    now = 3_000;
    const settled = await call(base, 'POST', '/v1/spend/holds/expiring/settle', {
      tx: `0x${'cd'.repeat(32)}`,
      payer: PAYER,
      resource: 'https://sandbox.example/v1/job',
      agent_id: 7,
    });
    assert.notEqual(settled.status, 200);
    assert.equal(settled.json.receipt, undefined);
    assert.equal(settled.json.verify_url, undefined);
    assert.equal(api.lookup('expiring'), null);
    const again = await call(base, 'POST', '/v1/spend/holds', holdBody(5000, 'after-expiry'));
    assert.equal(again.status, 201);
  } finally {
    server.close();
  }
});

test('settle does not receipt when consume fails', async () => {
  const { api, store } = service('5000');
  const { server, base } = await listen(api.handle);
  try {
    const placed = await call(base, 'POST', '/v1/spend/holds', holdBody(5000, 'stuck'));
    assert.equal(placed.status, 201);
    store.consume = async () => ({ ok: false, code: 'hold_not_open', state: 'expired' });
    const settled = await call(base, 'POST', '/v1/spend/holds/stuck/settle', {
      tx: `0x${'cd'.repeat(32)}`,
      payer: PAYER,
      resource: 'https://sandbox.example/v1/job',
    });
    assert.equal(settled.status, 409);
    assert.equal(settled.json.error.code, 'hold_not_open');
    assert.equal(settled.json.verify_url, undefined);
  } finally {
    server.close();
  }
});

test('unset token fails closed', async () => {
  const store = new SpendHoldStore({ ttlMs: 60_000 });
  const api = createSpendHoldService({
    store,
    token: '',
    ceilings: new Map([[FUNDER, 1000n]]),
  });
  const { server, base } = await listen(api.handle);
  try {
    const res = await fetch(`${base}/v1/spend/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(holdBody(1, 'x')),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'spend_hold_token_unset');
  } finally {
    server.close();
  }
});
