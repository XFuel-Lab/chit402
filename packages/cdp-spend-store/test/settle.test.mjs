import { test } from 'node:test';
import assert from 'node:assert/strict';

import { x402Client } from '@x402/core/client';
import { applySpendControls } from '@coinbase/cdp-sdk/x402';

import {
  attachChitReceipt,
  createChitSpendStore,
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
