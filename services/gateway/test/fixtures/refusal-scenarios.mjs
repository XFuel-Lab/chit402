/**
 * Refusal scenarios for settleBoundPayment, driven against a local
 * facilitator on 127.0.0.1 and an injected chain reader. No network leaves
 * the box. Every value is a dummy: the signature, nonces and addresses are
 * fixed marker patterns so a leak test can search output for them.
 *
 * Each scenario returns the settle decision. The refusal tests turn it into
 * the HTTP status and body the server sends (paymentErrorStatus /
 * paymentFailureBody, server.js), and read the refusal counts it logged.
 */
import http from 'node:http';
import { ethers } from 'ethers';
import { ChallengeStore } from '../../src/x402-adapter.js';
import { settleBoundPayment } from '../../src/x402-settle.js';
import { confirmEvmReceipt, readEvmAuthorization, clearChainReaderForTests } from '../../src/x402-chain.js';
import { setActiveChallengeStore } from '../../src/x402-durable-store.js';

export const HOUSE = `0x${'11'.repeat(20)}`;
export const PAYER = `0x${'55'.repeat(20)}`;
export const OTHER = `0x${'33'.repeat(20)}`;
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const OTHER_ASSET = `0x${'77'.repeat(20)}`;
export const TX1 = `0x${'ab'.repeat(32)}`;
/** Dummy secrets. None of these may appear in a log line, row or count. */
export const SIG_MARKER = `0x${'5e'.repeat(65)}`;
export const AUTH_NONCE_MARKER = `0x${'a7'.repeat(32)}`;
export const OTHER_AUTH_NONCE = `0x${'b8'.repeat(32)}`;
export const RESOURCE = 'https://api.chit402.com/v1/chat/completions';

const pad = (a) => ethers.zeroPadValue(a, 32);

function chainReceipt({ from = PAYER, nonce = AUTH_NONCE_MARKER, value = 2000n, to = HOUSE } = {}) {
  return {
    status: '0x1', blockNumber: '0x10', contractAddress: null, blockHash: `0x${'ee'.repeat(32)}`,
    logs: [
      { address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(from), pad(to)], data: ethers.toBeHex(value, 32), logIndex: '0x0' },
      { address: USDC, topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(from), pad(nonce)], data: '0x', logIndex: '0x1' },
    ],
  };
}

export function paymentHeader({
  from = PAYER, to = HOUSE, nonce = AUTH_NONCE_MARKER, value = '2000', amount = '2000',
  asset = USDC, validBefore = null, omitNonce = false, signature = SIG_MARKER,
} = {}) {
  const auth = {
    from, to, value, validAfter: '0',
    validBefore: validBefore ?? String(Math.floor(Date.now() / 1000) + 3600),
  };
  if (!omitNonce) auth.nonce = nonce;
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount, asset, payTo: HOUSE, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } },
    payload: { signature, authorization: auth },
  })).toString('base64');
}

/** Local facilitator. `settle` / `verify` pick the reply shape. */
export function listenFacilitator({ settle = 'ok', verify = 'ok', tx = TX1, payer = PAYER } = {}) {
  const hits = { verify: 0, settle: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const isSettle = String(req.url).endsWith('/settle');
      hits[isSettle ? 'settle' : 'verify'] += 1;
      res.setHeader('content-type', 'application/json');
      if (isSettle) {
        if (settle === 'http500') { res.statusCode = 500; return res.end('{"error":"boom"}'); }
        return res.end(JSON.stringify({ success: true, settled: true, transaction: tx, txRef: tx, network: 'base', payer }));
      }
      if (verify === 'invalid') return res.end(JSON.stringify({ valid: false, isValid: false, invalidReason: 'insufficient_funds' }));
      return res.end(JSON.stringify({ valid: true, isValid: true, payer }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) });
  }));
}

let counter = 0;
function challengeNonce() {
  counter += 1;
  return `0x${counter.toString(16).padStart(4, '0').repeat(16)}`;
}

/**
 * One settle attempt. `challenge` overrides the stored challenge row
 * (null = do not store one), `header` the payment header options, `cfg`
 * the settle config, `call` the settleBoundPayment arguments.
 */
export async function attempt({
  challenge = {}, header = {}, cfg = {}, call = {}, fac = {}, chain = {}, store = null, nonce = undefined,
} = {}) {
  clearChainReaderForTests();
  const active = store || new ChallengeStore();
  setActiveChallengeStore(active);
  const facilitator = await listenFacilitator(fac);
  const n = nonce === undefined ? challengeNonce() : nonce;
  if (challenge !== null && n) {
    active.put(n, {
      resource: RESOURCE, amount: '2000', payTo: HOUSE, network: 'base', asset: USDC,
      issuedAt: Date.now(), expiresAt: Date.now() + 120_000, ...challenge,
    });
  }
  const h = paymentHeader(header);
  const req = {
    id: `req-${counter}`,
    headers: { 'x-payment': h, 'x-payment-nonce': n || '', 'user-agent': 'refusal-test' },
    method: 'POST',
    path: '/v1/chat/completions',
  };
  try {
    const decision = await settleBoundPayment({
      req,
      taskId: `t-${counter}`,
      cfg: {
        enabled: true, payTo: HOUSE, network: 'base', asset: 'USDC',
        gatewayUrl: facilitator.url, apiKey: 'k', usdcPriceDefault: '2000',
        challengeTtlMs: 120000, defaultRail: 'usdc', lateIssue: false,
        chainReader: async ({ challenge: c, facilitator: f, paymentHeader: ph, expectedPayTo }) =>
          confirmEvmReceipt(chainReceipt(chain), {
            challenge: c, expectedPayTo,
            authorization: readEvmAuthorization(ph),
            facilitatorPayer: f?.payer,
          }),
        ...cfg,
      },
      priceBody: {},
      amount: '2000',
      baseUrl: 'https://api.chit402.com',
      resource: RESOURCE,
      store: active,
      paymentHeader: h,
      clientVersion: 2,
      nonce: n,
      serveStoredResponse: false,
      resolveQuote: async () => '2000',
      ...call,
    });
    return { decision, hits: facilitator.hits, store: active, nonce: n };
  } finally {
    await facilitator.close();
  }
}

/**
 * Named refusal paths. `want` is the code, the bounded sub_reason, and the
 * phase each path must log. The HTTP body each must produce is pinned in
 * refusal-body-pin.test.mjs.
 */
export const SCENARIOS = {
  no_nonce: { run: () => attempt({ nonce: null, challenge: null }), want: ['challenge_required', 'no_nonce', 'pre_settle'] },
  challenge_unknown: { run: () => attempt({ challenge: null }), want: ['challenge_required', 'challenge_unknown', 'pre_settle'] },
  network_not_allowed: { run: () => attempt({ challenge: { network: 'polygon' } }), want: ['network_not_accepted', 'network_not_allowed', 'pre_settle'] },
  asset_mismatch: { run: () => attempt({ header: { asset: OTHER_ASSET } }), want: ['network_not_accepted', 'asset_mismatch', 'pre_settle'] },
  payto_house: { run: () => attempt({ challenge: { payTo: OTHER } }), want: ['challenge_mismatch', 'payto_house', 'pre_settle'] },
  signed_recipient: { run: () => attempt({ header: { to: OTHER } }), want: ['challenge_mismatch', 'signed_recipient', 'pre_settle'] },
  resource: { run: () => attempt({ challenge: { resource: 'https://api.chit402.com/v1/other' } }), want: ['challenge_mismatch', 'resource', 'pre_settle'] },
  amount_inconsistent: { run: () => attempt({ challenge: { quotePrice: '1000' } }), want: ['challenge_mismatch', 'amount_inconsistent', 'pre_settle'] },
  quote_unavailable: {
    run: () => attempt({ call: { amount: null, resolveQuote: async () => { throw new Error('price feed down'); } } }),
    want: ['challenge_mismatch', 'quote_unavailable', 'pre_settle'],
  },
  price_increased: { run: () => attempt({ call: { amount: '3000' } }), want: ['challenge_mismatch', 'price_increased', 'pre_settle'] },
  auth_shape: { run: () => attempt({ header: { value: '20.5' } }), want: ['settle_unconfirmed', 'auth_shape', 'pre_settle'] },
  amount_short: { run: () => attempt({ header: { value: '1000' } }), want: ['challenge_mismatch', 'amount_short', 'pre_settle'] },
  auth_window: { run: () => attempt({ header: { validBefore: '1000' } }), want: ['settle_unconfirmed', 'auth_window', 'pre_settle'] },
  auth_nonce: { run: () => attempt({ header: { omitNonce: true } }), want: ['settle_unconfirmed', 'auth_nonce', 'pre_settle'] },
  auth_signature: { run: () => attempt({ header: { signature: '0x1234' } }), want: ['settle_unconfirmed', 'auth_signature', 'pre_settle'] },
  facilitator_invalid: { run: () => attempt({ fac: { verify: 'invalid' } }), want: ['verify_failed', 'facilitator_invalid', 'pre_settle'] },
  settle_http: { run: () => attempt({ fac: { settle: 'http500' } }), want: ['settle_failed', 'http', 'post_submit'] },
  chain_mismatch: { run: () => attempt({ chain: { nonce: OTHER_AUTH_NONCE } }), want: ['settle_unconfirmed', 'chain_mismatch', 'post_submit'] },
  underpaid: { run: () => attempt({ chain: { value: 1000n } }), want: ['settle_unconfirmed', 'underpaid', 'post_submit'] },
  // The chain transfer is from the signed payer, but the route is bound to
  // another wallet. Checked only after the chain read today (money moved).
  chain_payer: { run: () => attempt({ call: { expectedPayer: OTHER } }), want: ['payer_mismatch', 'chain_payer', 'post_submit'] },
};
