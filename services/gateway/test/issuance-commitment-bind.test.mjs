/**
 * Issuance-commitment bind + L1 dispute window (design-partner seat).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  computeIssuanceCommitment,
  parseIssuanceBindFromBody,
  verifyIssuanceBindAtSettle,
  buildDisputeWindow,
  isDisputeWindowOpen,
  issuanceBindForChallenge,
} from '../src/issuance-commitment.js';
import { runX402Handshake } from '../src/x402-server.js';
import { BookDisputeStore, CLAIM_TYPES, fileAndAdjudicate } from '../src/book-dispute.js';

const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const CONTENT_A = '0x' + 'aa'.repeat(32);
const CONTENT_B = '0x' + 'bb'.repeat(32);

function makePaymentHeader({ nonce, chainId = 84532, payTo = '0xtreasury' }) {
  const now = Math.floor(Date.now() / 1000);
  const blob = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
    amount: '50000',
    payTo,
    nonce,
    authorization: {
      type: 'eip3009-transferWithAuthorization',
      domain: { name: 'USDC', version: '2', chainId },
      message: {
        from: '0x1111111111111111111111111111111111111111',
        to: payTo,
        value: '50000',
        validAfter: 0,
        validBefore: now + 3600,
        nonce,
      },
      signature: '0x' + '11'.repeat(65),
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

let mockServer;
let mockUrl;
/** @type {object|null} */
let testCfg = null;

before(async () => {
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      if (req.method !== 'POST') return send(404, {});
      const url = req.url || '';
      if (url.endsWith('/verify')) return send(200, { isValid: true, payer: '0xpayer' });
      if (url.endsWith('/settle')) {
        return send(200, {
          success: true,
          transaction: '0xsettletx',
          network: 'base-sepolia',
          payer: '0xpayer',
        });
      }
      return send(404, {});
    });
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockUrl = `http://127.0.0.1:${mockServer.address().port}`;
  testCfg = {
    enabled: true,
    facilitatorProvider: 'x402',
    facilitatorUrl: mockUrl,
    payTo: '0xtreasury',
    network: 'base-sepolia',
    asset: USDC_SEPOLIA,
    issuanceDisputeWindowSec: 3600,
  };
});

after(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

test('parseIssuanceBindFromBody fail-closed on partial bind', () => {
  const bad = parseIssuanceBindFromBody({
    issuance_bind: { chain_id: 8453, content_hash: CONTENT_A },
  });
  assert.equal(bad.requested, true);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /settlement_contract/);

  const good = parseIssuanceBindFromBody({
    xfuel: {
      issuance_bind: {
        chain_id: 8453,
        settlement_contract: USDC_SEPOLIA,
        content_hash: CONTENT_A,
      },
    },
  });
  assert.equal(good.ok, true);
  assert.equal(good.bind.content_hash, CONTENT_A);
});

test('happy path: commitment + auth bind at settle', () => {
  const nonce = '0x' + 'cc'.repeat(32);
  const bind = {
    chain_id: 84532,
    settlement_contract: USDC_SEPOLIA,
    nonce,
    content_hash: CONTENT_A,
  };
  const commitment = computeIssuanceCommitment(bind);
  assert.match(commitment, /^0x[0-9a-f]{64}$/);

  const header = makePaymentHeader({ nonce, chainId: 84532 });
  const check = verifyIssuanceBindAtSettle({
    storedBind: { required: true, ...bind, nonce: null },
    paymentHeader: header,
    challengeNonce: nonce,
    settlementContract: USDC_SEPOLIA,
  });
  assert.equal(check.ok, true);
  assert.equal(check.commitment, commitment);
});

test('cross-batch replay: same content_hash, wrong payment nonce rejected', () => {
  const nonceChallenge = '0x' + 'dd'.repeat(32);
  const noncePayment = '0x' + 'ee'.repeat(32);
  const stored = {
    required: true,
    chain_id: 84532,
    settlement_contract: USDC_SEPOLIA,
    content_hash: CONTENT_A,
    nonce: nonceChallenge,
  };
  const header = makePaymentHeader({ nonce: noncePayment, chainId: 84532 });
  const check = verifyIssuanceBindAtSettle({
    storedBind: stored,
    paymentHeader: header,
    challengeNonce: nonceChallenge,
    settlementContract: USDC_SEPOLIA,
  });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'issuance_bind_nonce_mismatch');
});

test('cross-batch replay: wrong settlement contract rejected', () => {
  const nonce = '0x' + 'ff'.repeat(32);
  const wrongContract = '0x0000000000000000000000000000000000000001';
  const stored = {
    required: true,
    chain_id: 84532,
    settlement_contract: USDC_SEPOLIA,
    content_hash: CONTENT_A,
    nonce,
  };
  const header = makePaymentHeader({ nonce, chainId: 84532 });
  const check = verifyIssuanceBindAtSettle({
    storedBind: stored,
    paymentHeader: header,
    challengeNonce: nonce,
    settlementContract: wrongContract,
  });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'issuance_bind_settlement_contract_mismatch');
});

test('runX402Handshake: bind requested rejects mismatched payment', async () => {
  const taskId = 'task-bind-1';
  const body = {
    model_id: 'test/model',
    issuance_bind: {
      chain_id: 84532,
      settlement_contract: USDC_SEPOLIA,
      content_hash: CONTENT_A,
    },
  };

  const req1 = { body, headers: {} };
  const ch = await runX402Handshake(req1, {
    taskId,
    cfg: testCfg,
    body,
    baseUrl: 'https://api.chit402.com',
  });
  assert.equal(ch.kind, 'challenge');
  const nonce = ch.body.accepts[0].extra.nonce;

  const badHeader = makePaymentHeader({
    nonce: '0x' + '99'.repeat(32),
    chainId: 84532,
  });
  const req2 = {
    body,
    headers: { 'x-payment': badHeader, 'x-payment-nonce': nonce },
  };
  const failed = await runX402Handshake(req2, {
    taskId,
    cfg: { ...testCfg },
    body,
    baseUrl: 'https://api.chit402.com',
  });
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.reason, 'issuance_bind_nonce_mismatch');
});

test('runX402Handshake: successful bind stamps commitment + dispute window', async () => {
  const taskId = 'task-bind-2';
  const body = {
    model_id: 'test/model',
    issuance_bind: {
      chain_id: 84532,
      settlement_contract: USDC_SEPOLIA,
      content_hash: CONTENT_B,
    },
  };
  const ch = await runX402Handshake({ body, headers: {} }, {
    taskId,
    cfg: testCfg,
    body,
    baseUrl: 'https://api.chit402.com',
    l1Anchor: { chain_id: 8453, block_number: 42, timestamp: 1_700_000_000 },
  });
  assert.equal(ch.kind, 'challenge');
  const nonce = ch.body.accepts[0].extra.nonce;
  const header = makePaymentHeader({ nonce, chainId: 84532 });

  const settled = await runX402Handshake({
    body,
    headers: { 'x-payment': header, 'x-payment-nonce': nonce },
  }, {
    taskId,
    cfg: testCfg,
    body,
    baseUrl: 'https://api.chit402.com',
    l1Anchor: { chain_id: 8453, block_number: 42, timestamp: 1_700_000_000 },
  });
  assert.equal(settled.kind, 'settled');
  assert.ok(settled.issuance_commitment?.commitment);
  assert.equal(settled.issuance_commitment.bind.content_hash, CONTENT_B);
  assert.equal(settled.dispute_window.anchor_block, 42);
  assert.equal(settled.dispute_window.closes_at, 1_700_000_000 + 3600);
});

test('dispute within window vs after window', async () => {
  const window = buildDisputeWindow({
    chainId: 8453,
    anchorBlock: 100,
    anchorTimestamp: 1_000_000,
    durationSec: 600,
  });
  assert.equal(isDisputeWindowOpen(window, { l1Timestamp: 1_000_100 }).open, true);
  assert.equal(isDisputeWindowOpen(window, { l1Timestamp: 1_000_700 }).open, false);

  const disputes = new BookDisputeStore();
  const ledger = {
    findByTask: () => ({
      task_id: 'task-dw-1',
      amount: '1000',
      payment_ref: 'base:0x1',
      model: 'm',
    }),
    findByRef: () => null,
    entries: [],
  };
  const loadReceipt = async () => ({
    task_id: 'task-dw-1',
    dispute_window: window,
    payment: { ref: 'base:0x1', collected: true },
  });

  const inside = await fileAndAdjudicate({
    agent_id: 1,
    task_id: 'task-dw-1',
    claim_type: CLAIM_TYPES.OUTPUT_MISSING,
  }, { disputes, ledger, loadReceipt, l1Timestamp: 1_000_200 });

  assert.equal(inside.ok, true);

  const outside = await fileAndAdjudicate({
    agent_id: 1,
    task_id: 'task-dw-2',
    claim_type: CLAIM_TYPES.OUTPUT_MISSING,
  }, {
    disputes,
    ledger: {
      ...ledger,
      findByTask: () => ({
        task_id: 'task-dw-2',
        amount: '1000',
        payment_ref: 'base:0x2',
        model: 'm',
      }),
    },
    loadReceipt: async () => ({
      task_id: 'task-dw-2',
      dispute_window: window,
    }),
    l1Timestamp: 1_000_900,
  });

  assert.equal(outside.ok, false);
  assert.equal(outside.reason, 'dispute_window_closed');
});

test('issuanceBindForChallenge rejects asset mismatch', () => {
  const r = issuanceBindForChallenge(
    { chain_id: 8453, settlement_contract: USDC_SEPOLIA, content_hash: CONTENT_A },
    { challengeNonce: '0x' + '11'.repeat(32), settlementContract: '0x0000000000000000000000000000000000000002' },
  );
  assert.equal(r.ok, false);
});
