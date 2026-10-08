import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewaySrc = path.resolve(here, '../../../services/gateway/src');

const { createSpendHoldService } = await import(pathToFileURL(path.join(gatewaySrc, 'spend-hold-api.js')).href);
const { SpendHoldStore } = await import(pathToFileURL(path.join(gatewaySrc, 'spend-hold.js')).href);

export const FUNDER = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca';
export const PAYTO = '0x2222222222222222222222222222222222222222';
export const PAYER = '0x3333333333333333333333333333333333333333';
export const TOKEN = 'sandbox-token-not-a-secret';
export const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const NETWORK = 'eip155:84532';
export const RESOURCE = 'http://127.0.0.1/paid';

/**
 * One gateway process. Workers talk to it over HTTP.
 * @param {bigint | string | number} cap
 */
export async function startHoldGateway(cap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-cdp-hold-'));
  const store = new SpendHoldStore({ ttlMs: 60_000, dir, persist: true });
  const api = createSpendHoldService({
    store,
    token: TOKEN,
    ceilings: new Map([[FUNDER, BigInt(cap)]]),
    dir,
  });
  const server = http.createServer((req, res) => {
    api.handle(req, res).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(err.message);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    token: TOKEN,
    funder: FUNDER,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function paymentRequired(amount) {
  return {
    x402Version: 2,
    resource: { url: RESOURCE, description: 'chit402 spend-hold test', mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact',
      network: NETWORK,
      asset: ASSET,
      payTo: PAYTO,
      amount: String(amount),
      maxTimeoutSeconds: 60,
      extra: {},
    }],
  };
}

export function countingScheme() {
  const state = { signs: 0 };
  return {
    state,
    scheme: {
      scheme: 'exact',
      async createPaymentPayload() {
        state.signs += 1;
        const n = state.signs;
        return {
          x402Version: 2,
          payload: {
            signature: `sig-${process.pid}-${n}`,
            nonce: `${process.pid}-${n}-${Date.now()}`,
          },
        };
      },
    },
  };
}
