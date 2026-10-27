/**
 * HTTP refusal bodies stay byte-identical to main (5c17588f).
 *
 * The logging change adds a network and a bounded sub_reason to every
 * refusal's count and row. None of that may reach the response. For each
 * refusal path this pins the status and the exact JSON body the server sends
 * (server.js: res.status(paymentErrorStatus(code)).json(paymentFailureBody(d))),
 * the decision's key list (server.js reads retryAfter, pendingId, verifyUrl
 * off it), and how many /settle calls the path made. The bodies were taken
 * from main before any logging code changed. A post-submit hold carries a
 * random pending_id; its body is pinned by shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentErrorStatus, paymentFailureBody } from '../src/x402-flags.js';
import { SCENARIOS } from './fixtures/refusal-scenarios.mjs';

const DECISION_KEYS = 'kind,reason,code,preSettle,retryAfter,pendingId,verifyUrl';

const PINNED = {
  no_nonce: { status: 402, body: "{\"error\":\"challenge_required\",\"code\":\"challenge_required\"}", pendingCode: null, settles: 0 },
  challenge_unknown: { status: 402, body: "{\"error\":\"challenge_required\",\"code\":\"challenge_required\"}", pendingCode: null, settles: 0 },
  network_not_allowed: { status: 402, body: "{\"error\":\"network_not_accepted\",\"code\":\"network_not_accepted\"}", pendingCode: null, settles: 0 },
  asset_mismatch: { status: 402, body: "{\"error\":\"network_not_accepted\",\"code\":\"network_not_accepted\"}", pendingCode: null, settles: 0 },
  payto_house: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  signed_recipient: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  resource: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  amount_inconsistent: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  quote_unavailable: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  price_increased: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  auth_shape: { status: 402, body: "{\"error\":\"settle_unconfirmed\",\"code\":\"settle_unconfirmed\"}", pendingCode: null, settles: 0 },
  amount_short: { status: 402, body: "{\"error\":\"challenge_mismatch\",\"code\":\"challenge_mismatch\"}", pendingCode: null, settles: 0 },
  auth_window: { status: 402, body: "{\"error\":\"settle_unconfirmed\",\"code\":\"settle_unconfirmed\"}", pendingCode: null, settles: 0 },
  auth_nonce: { status: 402, body: "{\"error\":\"settle_unconfirmed\",\"code\":\"settle_unconfirmed\"}", pendingCode: null, settles: 0 },
  auth_signature: { status: 402, body: "{\"error\":\"settle_unconfirmed\",\"code\":\"settle_unconfirmed\"}", pendingCode: null, settles: 0 },
  facilitator_invalid: { status: 402, body: "{\"error\":\"verify_failed\",\"code\":\"verify_failed\"}", pendingCode: null, settles: 0 },
  settle_http: { status: 402, body: "{\"error\":\"settle_failed\",\"code\":\"settle_failed\"}", pendingCode: null, settles: 1 },
  chain_mismatch: { status: 402, body: null, pendingCode: "settle_unconfirmed", settles: 1 },
  chain_value_low: { status: 402, body: null, pendingCode: "settle_unconfirmed", settles: 1 },
  chain_payer: { status: 403, body: "{\"error\":\"payer_mismatch\",\"code\":\"payer_mismatch\"}", pendingCode: null, settles: 1 },
};

function pendingBody(code) {
  return new RegExp(`^\\{"error":"${code}","code":"${code}","pending_id":"([0-9a-f]{32})","verify_url":"/receipt/late-\\1"\\}$`);
}

test('every scenario has a pinned body', () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), Object.keys(PINNED).sort());
});

for (const [name, pin] of Object.entries(PINNED)) {
  test(`refusal body is byte-identical to main: ${name}`, async () => {
    const { decision, hits } = await SCENARIOS[name].run();
    assert.ok(decision && decision.kind === 'failed', `${name}: expected a refusal, got ${JSON.stringify(decision)}`);
    const code = decision.code || decision.reason;
    assert.equal(paymentErrorStatus(code), pin.status, `${name}: status`);
    const body = JSON.stringify(paymentFailureBody(decision));
    if (pin.body !== null) {
      assert.equal(body, pin.body, `${name}: body bytes`);
    } else {
      assert.ok(pendingBody(pin.pendingCode).test(body), `${name}: body ${body} is not the pinned pending shape`);
    }
    assert.equal(Object.keys(decision).join(','), DECISION_KEYS, `${name}: decision keys`);
    assert.equal(decision.retryAfter, undefined, `${name}: no Retry-After`);
    assert.equal(hits.settle, pin.settles, `${name}: /settle calls`);
  });
}
