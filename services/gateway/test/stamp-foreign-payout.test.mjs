import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOnChainVerify } from '../src/foreign-x402-ingest.js';
import {
  formatStampLine,
  recordHasFingerprint,
  soleBaseUsdcTransfer,
  stampForeignPayouts,
} from '../scripts/stamp-foreign-payout.mjs';

const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}`;
const PAYER = '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52';
const PAYTO = '0x1111111111111111111111111111111111111111';

function topicAddress(addr) {
  return `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
}

function transferReceipt({ from = PAYER, to = PAYTO, amount = 1000000n, status = 1, extra = [] } = {}) {
  return {
    status,
    logs: [
      {
        address: USDC,
        topics: [TOPIC, topicAddress(from), topicAddress(to)],
        data: `0x${amount.toString(16).padStart(64, '0')}`,
      },
      ...extra,
    ],
  };
}

function deps(overrides = {}) {
  const calls = { verify: 0, ingest: 0, waiver: 0, commit: 0 };
  const base = {
    calls,
    findExisting: async () => null,
    readTransfer: async () => ({ ok: true, payer: PAYER, payTo: PAYTO, amount: '1000000' }),
    verify: async () => {
      calls.verify += 1;
      return { valid: true };
    },
    waiver: () => {
      calls.waiver += 1;
      return { eligible: true, remaining: 2 };
    },
    ingest: async () => {
      calls.ingest += 1;
      return {
        ok: true,
        receipt_id: 'foreign-x402-test',
        verify_url: 'https://api.chit402.com/receipt/foreign-x402-test',
      };
    },
    commitWaiver: () => {
      calls.commit += 1;
    },
  };
  return { ...base, ...overrides, calls };
}

test('soleBaseUsdcTransfer accepts one pair and refuses two', () => {
  const one = soleBaseUsdcTransfer(transferReceipt());
  assert.equal(one.ok, true);
  assert.equal(one.payer, PAYER);
  assert.equal(one.payTo, PAYTO);
  assert.equal(one.amount, '1000000');
  const two = soleBaseUsdcTransfer(transferReceipt({
    extra: [{
      address: USDC,
      topics: [TOPIC, topicAddress(PAYER), topicAddress('0x2222222222222222222222222222222222222222')],
      data: `0x${(1n).toString(16).padStart(64, '0')}`,
    }],
  }));
  assert.equal(two.ok, false);
  assert.equal(two.reason, 'ambiguous_transfers');
});

test('foreign-ingest verifier accepts the transfer the script would stamp', async () => {
  const txReceipt = transferReceipt();
  const described = soleBaseUsdcTransfer(txReceipt);
  const verify = buildOnChainVerify({
    async getTransactionReceipt() { return txReceipt; },
  });
  const ok = await verify({
    paymentRef: `base:${TX}`,
    payer: described.payer,
    payTo: described.payTo,
    amount: described.amount,
    network: 'base',
  });
  assert.equal(ok.valid, true);
  const wrong = await verify({
    paymentRef: `base:${TX}`,
    payer: described.payer,
    payTo: described.payTo,
    amount: '1000001',
    network: 'base',
  });
  assert.equal(wrong.valid, false);
});

test('an existing by-tx receipt is printed and not stamped again', async () => {
  let verified = 0;
  let ingested = 0;
  const results = await stampForeignPayouts([TX], deps({
    findExisting: async () => ({
      receipt_id: 'foreign-x402-already',
      verify_url: 'https://api.chit402.com/receipt/foreign-x402-already',
    }),
    verify: async () => { verified += 1; return { valid: true }; },
    ingest: async () => { ingested += 1; return { ok: true }; },
  }));
  assert.equal(results[0].status, 'existing');
  assert.equal(results[0].receipt_id, 'foreign-x402-already');
  assert.equal(verified, 0);
  assert.equal(ingested, 0);
  assert.match(formatStampLine(results[0]), /status=existing/);
});

test('a missing waiver does not ingest and does not move funds', async () => {
  let ingested = 0;
  const results = await stampForeignPayouts([TX], deps({
    waiver: () => ({ eligible: false, reason: 'stamp_waiver_required' }),
    ingest: async () => { ingested += 1; return { ok: true }; },
  }));
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].error, 'stamp_waiver_required');
  assert.equal(ingested, 0);
});

test('a failed on-chain check does not ingest', async () => {
  let ingested = 0;
  const results = await stampForeignPayouts([TX], deps({
    verify: async () => ({ valid: false, reason: 'no USDC Transfer' }),
    ingest: async () => { ingested += 1; return { ok: true }; },
  }));
  assert.equal(results[0].error, 'no USDC Transfer');
  assert.equal(ingested, 0);
});

test('a fingerprint that is not on the public record is not signed', async () => {
  let ingested = 0;
  const results = await stampForeignPayouts([{ tx: TX, fingerprint: 'ab'.repeat(32) }], deps({
    confirmFingerprint: async () => false,
    ingest: async () => { ingested += 1; return { ok: true }; },
  }));
  assert.equal(results[0].error, 'fingerprint_not_on_record');
  assert.equal(ingested, 0);
  assert.equal(recordHasFingerprint([{ hash: 'ab'.repeat(32) }], 'AB'.repeat(32)), true);
});

test('a verified transfer stamps once under the waiver', async () => {
  const d = deps();
  const results = await stampForeignPayouts([TX], d);
  assert.equal(results[0].status, 'stamped');
  assert.equal(results[0].receipt_id, 'foreign-x402-test');
  assert.equal(d.calls.ingest, 1);
  assert.equal(d.calls.commit, 1);
  assert.match(formatStampLine(results[0]), /verify_url=https:\/\/api\.chit402\.com\/receipt\/foreign-x402-test/);
});
