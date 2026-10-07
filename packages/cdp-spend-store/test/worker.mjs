/**
 * One payer process. The parent starts two of these against one gateway.
 * execArgv must be empty: node --test would otherwise re-exec this file.
 */
import { x402Client } from '@x402/core/client';
import { applySpendControls } from '@coinbase/cdp-sdk/x402';

import {
  attachChitReceipt,
  createChitSpendStore,
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
} from '../src/index.js';

const amount = process.env.CHIT_AMOUNT;
const count = Number(process.env.CHIT_COUNT || '1');
const payTo = '0x2222222222222222222222222222222222222222';
const asset = BASE_SEPOLIA_USDC;
const network = BASE_SEPOLIA_NETWORK;

const state = { signs: 0 };
const client = new x402Client();
if (typeof client.setSpendControls === 'function') client.setSpendControls(false);
client.register(network, {
  scheme: 'exact',
  async createPaymentPayload() {
    state.signs += 1;
    const n = state.signs;
    return {
      x402Version: 2,
      payload: { signature: `sig-${process.pid}-${n}`, nonce: `${process.pid}-${n}-${Date.now()}` },
    };
  },
});
const store = createChitSpendStore({
  gatewayUrl: process.env.CHIT_GATEWAY,
  token: process.env.CHIT_TOKEN,
  funder: process.env.CHIT_FUNDER,
});
applySpendControls(client, {
  maxCumulativeSpend: { atomic: BigInt(process.env.CHIT_LOCAL_CAP || '1000000000000'), asset },
  allowedNetworks: [network],
  store,
});
attachChitReceipt(client, store);

const required = {
  x402Version: 2,
  resource: { url: 'http://127.0.0.1/paid', description: 'worker', mimeType: 'application/json' },
  accepts: [{
    scheme: 'exact',
    network,
    asset,
    payTo,
    amount: String(amount),
    maxTimeoutSeconds: 60,
    extra: {},
  }],
};

const attempts = await Promise.all(Array.from({ length: count }, async () => {
  try {
    await client.createPaymentPayload(required);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: err.code || err.name };
  }
}));

process.stdout.write(`${JSON.stringify({
  pid: process.pid,
  signs: state.signs,
  ok: attempts.filter((row) => row.ok).length,
  codes: attempts.filter((row) => !row.ok).map((row) => row.code),
})}\n`);
