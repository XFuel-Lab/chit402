/**
 * A throw from the before-hook must happen before the scheme signs.
 * @x402/core 2.28 runs onBeforePaymentCreation outside the signing try.
 * CDP 1.58 calls store.append inside that hook and does not catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { x402Client } from '@x402/core/client';
import { applySpendControls } from '@coinbase/cdp-sdk/x402';

import {
  attachChitReceipt,
  attachHoldSettle,
  createChitSpendStore,
  createSpendBook,
  SpendCapExceeded,
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../src/index.js';
import {
  FUNDER,
  PAYER,
  TOKEN,
  countingScheme,
  paymentRequired,
  startHoldGateway,
} from './harness.mjs';

const LOCAL_CAP = 1_000_000_000_000n;

function clientWithStore(gateway, counter) {
  const client = new x402Client();
  if (typeof client.setSpendControls === 'function') client.setSpendControls(false);
  client.register(BASE_SEPOLIA_NETWORK, counter.scheme);
  const store = createChitSpendStore({
    gatewayUrl: gateway.base,
    token: TOKEN,
    funder: FUNDER,
    agentId: 7,
  });
  applySpendControls(client, {
    maxCumulativeSpend: { atomic: LOCAL_CAP, asset: BASE_SEPOLIA_USDC },
    allowedNetworks: [BASE_SEPOLIA_NETWORK],
    store,
  });
  attachChitReceipt(client, store);
  return { client, store };
}

test('an over-cap hold blocks the signature', async () => {
  const gateway = await startHoldGateway(5000n);
  try {
    const counter = countingScheme();
    const { client } = clientWithStore(gateway, counter);
    const first = await client.createPaymentPayload(paymentRequired(4000));
    assert.equal(counter.state.signs, 1);
    assert.equal(typeof first.payload.signature, 'string');

    await assert.rejects(
      () => client.createPaymentPayload(paymentRequired(4000)),
      (err) => err instanceof SpendCapExceeded && err.code === 'CEILING_EXCEEDED',
    );
    assert.equal(counter.state.signs, 1);
  } finally {
    await gateway.close();
  }
});

test('a signer failure releases the hold', async () => {
  const gateway = await startHoldGateway(5000n);
  try {
    let failNext = true;
    const counter = countingScheme();
    const scheme = {
      scheme: 'exact',
      async createPaymentPayload() {
        counter.state.signs += 1;
        if (failNext) {
          failNext = false;
          throw new Error('signer failed');
        }
        return {
          x402Version: 2,
          payload: { signature: 'ok', nonce: `ok-${process.pid}` },
        };
      },
    };
    const client = new x402Client();
    if (typeof client.setSpendControls === 'function') client.setSpendControls(false);
    client.register(BASE_SEPOLIA_NETWORK, scheme);
    const store = createChitSpendStore({
      gatewayUrl: gateway.base,
      token: TOKEN,
      funder: FUNDER,
      agentId: 7,
    });
    applySpendControls(client, {
      maxCumulativeSpend: { atomic: LOCAL_CAP, asset: BASE_SEPOLIA_USDC },
      allowedNetworks: [BASE_SEPOLIA_NETWORK],
      store,
    });
    attachChitReceipt(client, store);

    await assert.rejects(
      () => client.createPaymentPayload(paymentRequired(5000)),
      /signer failed/,
    );
    assert.equal(counter.state.signs, 1);
    const second = await client.createPaymentPayload(paymentRequired(5000));
    assert.equal(second.payload.signature, 'ok');
    assert.equal(counter.state.signs, 2);
  } finally {
    await gateway.close();
  }
});

test('the client-agnostic hook also blocks signing, then settles once', async () => {
  const gateway = await startHoldGateway(5000n);
  try {
    const counter = countingScheme();
    const client = new x402Client();
    if (typeof client.setSpendControls === 'function') client.setSpendControls(false);
    client.register(BASE_SEPOLIA_NETWORK, counter.scheme);
    const book = createSpendBook({
      gatewayUrl: gateway.base,
      token: TOKEN,
      funder: FUNDER,
      agentId: 7,
    });
    attachHoldSettle(client, book);

    const payload = await client.createPaymentPayload(paymentRequired(3000));
    assert.equal(counter.state.signs, 1);
    await assert.rejects(
      () => client.createPaymentPayload(paymentRequired(3000)),
      (err) => err instanceof SpendCapExceeded,
    );
    assert.equal(counter.state.signs, 1);

    const tx = `0x${'cd'.repeat(32)}`;
    const ctx = {
      paymentPayload: payload,
      requirements: payload.accepted,
      settleResponse: { success: true, transaction: tx, payer: PAYER, network: BASE_SEPOLIA_NETWORK },
    };
    await client.handlePaymentResponse(ctx);
    const settled = ctx.chitReceipt;
    assert.match(settled.verify_url, /\/receipt\/xfuel-/);
    await client.handlePaymentResponse(ctx);
    assert.equal(ctx.chitReceipt.receipt.issuer_signature.jws, settled.receipt.issuer_signature.jws);
    assert.equal(ctx.chitReceipt.idempotent, true);

    const got = await fetch(settled.verify_url);
    assert.equal(got.status, 200);
    const stored = await got.json();
    assert.equal(stored.issuer_signature.jws, settled.receipt.issuer_signature.jws);
    assert.equal(stored.payment.ref, `base-sepolia:${tx}`);
    assert.equal(stored.caller_binding.payer_wallet, PAYER);
  } finally {
    await gateway.close();
  }
});
