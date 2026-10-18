import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReceiptHtml, signedParties, displayReceiptView } from '../src/receipt.js';
import { toPublicShell } from '../src/receipt-shell.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SIGNED_PAYEE = '0x1111111111111111111111111111111111111111';
const SIGNED_PAYER = '0x2222222222222222222222222222222222222222';
const OUTER_PAYEE = '0x9999999999999999999999999999999999999999';
const OUTER_PAYER = '0x8888888888888888888888888888888888888888';
const TASK = 'chit-0000000000000000000000000000000000000000000000000000000000000abc';

function foreignReceipt() {
  const claims = {
    task_id: TASK,
    payload_version: 6,
    payment: { rail: 'usdc', network: 'base', asset: 'USDC', gross_amount: '0.010000', payee: SIGNED_PAYEE },
    caller_binding: { payer_wallet: SIGNED_PAYER },
  };
  const jws = `${b64({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: 'k' })}.${b64(claims)}.sig`;
  return {
    task_id: TASK,
    evidence: 'foreign_ingest',
    foreign_x402: true,
    payment: {
      rail: 'usdc', network: 'base', asset: 'USDC',
      gross_amount: '777.000000', settled_amount: '777.000000',
      payTo: OUTER_PAYEE, payee: OUTER_PAYEE, payer: OUTER_PAYER,
    },
    caller_binding: { payer_wallet: OUTER_PAYER },
    issuer_signature: { jws, payload_version: 6 },
  };
}

test('foreign payout page shows signed parties and amounts only', () => {
  const html = renderReceiptHtml(foreignReceipt());
  for (const v of [SIGNED_PAYEE, SIGNED_PAYER]) assert.ok(html.toLowerCase().includes(v.slice(2, 10)), `missing ${v}`);
  for (const v of [OUTER_PAYEE, OUTER_PAYER]) assert.ok(!html.toLowerCase().includes(v.slice(2, 10)), `outer ${v} shown`);
  assert.ok(!html.includes('777'), 'outer gross shown');
});

test('display view and shell use signed values or null', () => {
  const r = foreignReceipt();
  const v = displayReceiptView(r);
  assert.equal(v.payment.payTo, SIGNED_PAYEE);
  assert.equal(v.payment.payer, SIGNED_PAYER);
  assert.equal(v.payment.gross_amount, '0.010000');
  assert.equal(v.payment.settled_amount, null);
  assert.equal(v.caller_binding.payer_wallet, SIGNED_PAYER);
  const shell = toPublicShell(r);
  assert.equal(shell.pay_to, SIGNED_PAYEE);
  assert.equal(shell.amount_gross, '0.010000');
  assert.equal(shell.amount_settled, null);
  assert.deepEqual(signedParties({}), { payee: null, payer: null, gross_amount: null, settled_amount: null, net_amount: null, fee_amount: null, asset: null });
});
