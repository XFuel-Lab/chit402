import { test } from 'node:test';
import assert from 'node:assert/strict';

import { x402Client } from '@x402/core/client';
import { applySpendControls } from '@coinbase/cdp-sdk/x402';

import {
  attachChitReceipt,
  createChitSpendStore,
  createSpendBook,
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../src/index.js';
import {
  ASSET,
  FUNDER,
  NETWORK,
  PAYER,
  PAYTO,
  RESOURCE,
  TOKEN,
  countingScheme,
  paymentRequired,
  startHoldGateway,
} from './harness.mjs';

test('retrying the same CDP entry does not reserve twice, and settle does not re-sign', async () => {
  const gateway = await startHoldGateway(10000n);
  try {
    const counter = countingScheme();
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
      maxCumulativeSpend: { atomic: 1_000_000_000_000n, asset: BASE_SEPOLIA_USDC },
      allowedNetworks: [BASE_SEPOLIA_NETWORK],
      store,
    });
    attachChitReceipt(client, store);

    const entry = {
      atomicAmount: 4000n,
      asset: BASE_SEPOLIA_USDC.toLowerCase(),
      network: BASE_SEPOLIA_NETWORK,
      payTo: '0x2222222222222222222222222222222222222222',
      at: 50,
    };
    await store.append(entry);
    await store.append(entry);
    const listed = await fetch(`${gateway.base}/v1/spend/holds?funder=${FUNDER}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await listed.json();
    assert.equal(body.held, '4000');

    const payload = await client.createPaymentPayload(paymentRequired(4000));
    assert.equal(counter.state.signs, 1);
    const ctx = {
      paymentPayload: payload,
      requirements: payload.accepted,
      settleResponse: {
        success: true,
        transaction: `0x${'ef'.repeat(32)}`,
        payer: PAYER,
        network: BASE_SEPOLIA_NETWORK,
      },
    };
    await client.handlePaymentResponse(ctx);
    const first = ctx.chitReceipt;
    await client.handlePaymentResponse(ctx);
    const second = ctx.chitReceipt;
    assert.equal(second.idempotent, true);
    assert.equal(second.receipt.issuer_signature.jws, first.receipt.issuer_signature.jws);
    assert.equal(second.verify_url, first.verify_url);
  } finally {
    await gateway.close();
  }
});

test('a hold whose first POST failed still settles on retry', async () => {
  const gateway = await startHoldGateway(5000n);
  try {
    let posts = 0;
    const fetchImpl = async (url, init) => {
      if (String(init?.method || 'GET').toUpperCase() === 'POST' && String(url).endsWith('/v1/spend/holds')) {
        posts += 1;
        if (posts === 1) throw new Error('socket reset');
      }
      return fetch(url, init);
    };
    const book = createSpendBook({
      gatewayUrl: gateway.base,
      token: TOKEN,
      funder: FUNDER,
      agentId: 7,
      fetchImpl,
    });
    const entry = {
      atomicAmount: 1000n,
      asset: ASSET,
      network: NETWORK,
      payTo: PAYTO,
      at: 9,
    };
    await assert.rejects(() => book.holdEntry(entry), /socket reset/);
    await book.holdEntry(entry);
    const payload = {
      x402Version: 2,
      resource: { url: RESOURCE },
      accepted: { amount: '1000', asset: ASSET, network: NETWORK, payTo: PAYTO },
      payload: { nonce: 'retry-1' },
    };
    book.notePayload(payload, payload.accepted);
    const settled = await book.onPaymentResponse({
      paymentPayload: payload,
      settleResponse: {
        success: true,
        transaction: `0x${'ab'.repeat(32)}`,
        payer: PAYER,
        network: NETWORK,
      },
    });
    assert.match(settled.verify_url, /\/receipt\/xfuel-/);
    assert.equal(posts, 2);
  } finally {
    await gateway.close();
  }
});
