/**
 * Solana payer binding: facilitator settle payer → caller_binding.payer_wallet in JWS.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runX402Handshake } from '../src/x402-server.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';
import { buildReceipt, mergeReceiptView, decodeReceiptClaims, callerBindingOf } from '../src/receipt.js';

const SOLANA_PAYER = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
const SOLANA_TX = '5'.repeat(87);

function makeSvmPaymentHeader({ nonce, resourceUrl = 'https://api.chit402.com/v1/chat/completions' } = {}) {
  const blob = {
    x402Version: 2,
    resource: { url: resourceUrl, description: 'Chit paid inference', mimeType: 'application/json' },
    accepted: {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount: '2000',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      payTo: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',
      maxTimeoutSeconds: 60,
      extra: { feePayer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', nonce },
    },
    payload: { transaction: 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    extensions: {},
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function cfgFor(cdpUrl, solanaUrl, over = {}) {
  return {
    enabled: true,
    defaultRail: 'usdc',
    fallbackToTfuel: false,
    facilitatorProvider: 'x402',
    facilitatorUrl: cdpUrl,
    gatewayUrl: cdpUrl,
    apiKey: null,
    payTo: '0xtreasury',
    network: 'base',
    asset: 'USDC',
    challengeTtlMs: 120000,
    usdcPriceDefault: '2000',
    usdcPrices: {},
    solana: {
      enabled: true,
      payTo: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',
      network: 'solana',
    },
    ...over,
  };
}

function startSolanaPayerMock() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      if (req.method !== 'POST') return send(404, { error: 'not_found' });
      const url = req.url || '';
      if (url.endsWith('/verify')) {
        return send(200, { isValid: true, payer: SOLANA_PAYER });
      }
      if (url.endsWith('/settle')) {
        return send(200, {
          success: true,
          transaction: SOLANA_TX,
          network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          payer: SOLANA_PAYER,
        });
      }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

let originalSolanaEnv;

after(() => {
  if (originalSolanaEnv === undefined) delete process.env.X402_SOLANA_FACILITATOR_URL;
  else process.env.X402_SOLANA_FACILITATOR_URL = originalSolanaEnv;
});

test('callerBindingOf accepts Solana payer from task meta', () => {
  const task = { meta: { payerWallet: SOLANA_PAYER } };
  const binding = callerBindingOf(task);
  assert.equal(binding.payer_wallet, SOLANA_PAYER);
});

test('callerBindingOf still checksums Base EVM payers', () => {
  const lower = '0x1234567890123456789012345678901234567890';
  const binding = callerBindingOf({ meta: {} }, { payerWallet: lower });
  assert.equal(binding.payer_wallet, '0x1234567890123456789012345678901234567890');
});

test('Solana settle path stamps caller_binding.payer_wallet in signed JWS claims', async () => {
  originalSolanaEnv = process.env.X402_SOLANA_FACILITATOR_URL;
  const { url: cdpUrl, close: closeCdp } = await startMockFacilitator();
  const solanaMock = await startSolanaPayerMock();
  process.env.X402_SOLANA_FACILITATOR_URL = solanaMock.url;

  try {
    const cfg = cfgFor(cdpUrl);
    const baseUrl = 'https://api.chit402.com';
    const challenge = await runX402Handshake(
      { headers: {}, body: { model: 'xfuel/auto' } },
      { taskId: 'xfuel-solana-payer-bind', cfg, baseUrl, resource: `${baseUrl}/v1/chat/completions` },
    );
    assert.equal(challenge.kind, 'challenge');
    const solAccept = challenge.body.accepts.find((a) => a.network?.startsWith('solana'));
    assert.ok(solAccept, 'challenge must include Solana accepts entry');
    const nonce = solAccept.extra.nonce;

    const paymentHeader = makeSvmPaymentHeader({ nonce });
    const settled = await runX402Handshake({
      headers: {
        'payment-signature': paymentHeader,
        'x-payment-nonce': nonce,
      },
      body: { model: 'xfuel/auto' },
    }, { taskId: 'xfuel-solana-payer-bind', cfg, baseUrl, resource: `${baseUrl}/v1/chat/completions` });

    assert.equal(settled.kind, 'settled');
    assert.equal(settled.payerWallet, SOLANA_PAYER, 'handshake must surface facilitator payer');
    assert.equal(settled.paymentRef, `solana:${SOLANA_TX}`);

    const task = {
      taskId: 'xfuel-solana-payer-bind',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        amount: settled.settledAmount,
        paymentRail: 'usdc',
        paymentRef: settled.paymentRef,
      },
      meta: { payerWallet: settled.payerWallet, chain: 'solana' },
      feeAmount: '10',
      netAmount: '1990',
      feeBps: 50,
    };
    const receipt = buildReceipt(task, { payerWallet: settled.payerWallet, persistSignature: true });
    const view = mergeReceiptView(receipt);
    assert.equal(view.caller_binding.payer_wallet, SOLANA_PAYER);
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.caller_binding.payer_wallet, SOLANA_PAYER);
  } finally {
    await closeCdp();
    await solanaMock.close();
  }
});

test('Base settle path still stamps EVM caller_binding.payer_wallet', () => {
  const evmPayer = '0x1234567890123456789012345678901234567890';
  const task = {
    taskId: 'xfuel-base-payer-bind',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      amount: '2000',
      paymentRail: 'usdc',
      paymentRef: 'base:0x' + 'ab'.repeat(32),
    },
    meta: { payerWallet: evmPayer },
    feeAmount: '10',
    netAmount: '1990',
    feeBps: 50,
  };
  const receipt = buildReceipt(task, { payerWallet: evmPayer, persistSignature: true });
  assert.equal(mergeReceiptView(receipt).caller_binding.payer_wallet, evmPayer);
  assert.equal(decodeReceiptClaims(receipt).caller_binding.payer_wallet, evmPayer);
});
