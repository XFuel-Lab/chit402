/**
 * PR #520 Part B must-fixes (MF1-MF4 + boot allowlist). Offline: loopback
 * facilitator and loopback stub RPC, throwaway addresses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { confirmEvmReceipt, readEvmAuthorization, clearChainReaderForTests } from '../src/x402-chain.js';
import { assertX402Boot } from '../src/x402-flags.js';
import { challengeStorePlan, setActiveChallengeStore } from '../src/x402-durable-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TX = `0x${'ab'.repeat(32)}`;
const pad = (a) => ethers.zeroPadValue(a, 32);

function evmHeader({ from = PAYER, nonce = `0x${'cd'.repeat(32)}`, value = '2000', amount = '2000', signature = `0x${'11'.repeat(65)}` } = {}) {
  return Buffer.from(JSON.stringify({
    network: 'base', amount, payTo: HOUSE,
    payload: { signature, authorization: { from, to: HOUSE, value, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce } },
  })).toString('base64');
}
function receipt({ from = PAYER, authorizer = from, nonce, value = 2000n } = {}) {
  return {
    status: '0x1', blockNumber: '0x10', contractAddress: null,
    logs: [
      { address: USDC, topics: [ethers.id('Transfer(address,address,uint256)'), pad(from), pad(HOUSE)], data: ethers.toBeHex(value, 32), logIndex: '0x0' },
      { address: USDC, topics: [ethers.id('AuthorizationUsed(address,bytes32)'), pad(authorizer), pad(nonce)], data: '0x', logIndex: '0x1' },
    ],
  };
}
function listen(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      hits.push({ url: req.url, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(handler(req, body)));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((c) => server.close(c)),
  })));
}
function facilitator({ tx = () => TX, payer = null } = {}) {
  return listen((req, body) => {
    const from = payer || body.paymentPayload?.payload?.authorization?.from || PAYER;
    if (req.url.endsWith('/verify')) return { valid: true, isValid: true, payer: from };
    const t = tx();
    return { settled: true, success: true, txRef: t, transaction: t, network: 'base', payer: from };
  });
}
function cfgFor(url, over = {}) {
  return { network: 'base', payTo: HOUSE, facilitatorProvider: 'zan', gatewayUrl: url, apiKey: 'k', asset: USDC, allowUnboundPayments: false, ...over };
}
function putChallenge(store, nonce, amount = '2000') {
  store.put(nonce, { taskId: 'task-1', amount, asset: USDC, network: 'base', payTo: HOUSE, resource: '/task-request', state: 'issued', expiresAt: Date.now() + 60_000, nonce });
  return nonce;
}
const settleHits = (fac) => fac.hits.filter((h) => h.url.endsWith('/settle')).length;

test.beforeEach(() => { clearChainReaderForTests(); setActiveChallengeStore(null); });

test('MF1 config.x402 carries BASE_RPC_URL for chain confirmation', () => {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { default: c } = await import('./src/config.js'); process.stdout.write(String(c.x402.baseRpcUrl));"],
  { cwd: ROOT, env: { PATH: process.env.PATH, NODE_ENV: 'test', BASE_RPC_URL: 'http://127.0.0.1:9' }, encoding: 'utf8' });
  assert.equal(out.stdout.trim().split('\n').pop(), 'http://127.0.0.1:9', out.stderr);
});

test('MF1 no confirmation RPC refuses before the facilitator collects funds', async () => {
  const fac = await facilitator();
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, `0x${'a1'.repeat(32)}`);
    const d = await settleBoundPayment({ taskId: 'task-1', amount: '2000', cfg: cfgFor(fac.url), store, nonce, paymentHeader: evmHeader() });
    assert.notEqual(d.kind, 'settled');
    assert.equal(settleHits(fac), 0, 'facilitator /settle must not be called without a confirmation RPC');
  } finally { await fac.close(); }
});

test('MF1 a configured Base RPC (no injected reader) confirms through the real reader', async () => {
  const fac = await facilitator();
  const nonceAuth = `0x${'c1'.repeat(32)}`;
  const rpc = await listen(() => ({ jsonrpc: '2.0', id: 1, result: receipt({ nonce: nonceAuth }) }));
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, `0x${'a2'.repeat(32)}`);
    const d = await settleBoundPayment({ taskId: 'task-1', amount: '2000', cfg: cfgFor(fac.url, { baseRpcUrl: rpc.url }), store, nonce, paymentHeader: evmHeader({ nonce: nonceAuth }) });
    assert.equal(d.kind, 'settled', d.code);
    assert.equal(d.confirmed, true);
    assert.ok(rpc.hits.length >= 1);
  } finally { await fac.close(); await rpc.close(); }
});

test('MF2 a tx already booked for another challenge is refused, not re-served', async () => {
  const fac = await facilitator({ tx: () => TX });
  const n1 = `0x${'d1'.repeat(32)}`;
  const n2 = `0x${'d2'.repeat(32)}`;
  // The chain shows one 2000 transfer for auth n1; the facilitator echoes it for auth n2.
  const reader = async ({ challenge, facilitator: f, paymentHeader }) => confirmEvmReceipt(receipt({ nonce: n1 }), {
    challenge, expectedPayTo: HOUSE, authorization: readEvmAuthorization(paymentHeader), facilitatorPayer: f?.payer,
  });
  try {
    const store = new ChallengeStore();
    const c1 = putChallenge(store, `0x${'e1'.repeat(32)}`, '2000');
    const first = await settleBoundPayment({ taskId: 'task-1', amount: '2000', cfg: cfgFor(fac.url, { chainReader: reader }), store, nonce: c1, paymentHeader: evmHeader({ nonce: n1 }) });
    assert.equal(first.kind, 'settled', first.code);
    const c2 = putChallenge(store, `0x${'e2'.repeat(32)}`, '500000');
    const second = await settleBoundPayment({ taskId: 'task-1', amount: '500000', cfg: cfgFor(fac.url, { chainReader: reader }), store, nonce: c2, paymentHeader: evmHeader({ nonce: n2, value: '500000', amount: '500000' }) });
    assert.notEqual(second.kind, 'settled', 'a booked tx must not serve a second, larger quote');
    assert.equal(second.code, 'payment_replayed');
  } finally { await fac.close(); }
});

function erc6492({ factory = `0x${'44'.repeat(20)}`, inner = `0x${'11'.repeat(65)}` } = {}) {
  // Real-shaped factory calldata: createAccount(bytes[] owners, uint256 nonce).
  const iface = new ethers.Interface(['function createAccount(bytes[] owners, uint256 nonce)']);
  const calldata = iface.encodeFunctionData('createAccount', [[ethers.zeroPadValue(PAYER, 32)], 0n]);
  const body = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes', 'bytes'], [factory, calldata, inner]);
  return `${body}${'6492'.repeat(16)}`;
}

test('MF3 an undeployed smart-wallet payer (ERC-6492) settles on Transfer + AuthorizationUsed', async () => {
  const sw = `0x${'77'.repeat(20)}`;
  const fac = await facilitator({ payer: sw });
  const n = `0x${'f1'.repeat(32)}`;
  const mk = (authorizer) => async ({ challenge, facilitator: f, paymentHeader }) => confirmEvmReceipt(receipt({ from: sw, authorizer, nonce: n }), {
    challenge, expectedPayTo: HOUSE, authorization: readEvmAuthorization(paymentHeader), facilitatorPayer: f?.payer,
  });
  try {
    const store = new ChallengeStore();
    const ok = await settleBoundPayment({ taskId: 'task-1', amount: '2000', cfg: cfgFor(fac.url, { chainReader: mk(sw) }), store, nonce: putChallenge(store, `0x${'f2'.repeat(32)}`), paymentHeader: evmHeader({ from: sw, nonce: n, signature: erc6492() }) });
    assert.equal(ok.kind, 'settled', ok.code);
    assert.equal(ethers.getAddress(ok.payerWallet), ethers.getAddress(sw));
    // The factory deployed some other address: USDC never accepted `from`'s signature.
    const store2 = new ChallengeStore();
    const bad = await settleBoundPayment({ taskId: 'task-1', amount: '2000', cfg: cfgFor(fac.url, { chainReader: mk(OTHER) }), store: store2, nonce: putChallenge(store2, `0x${'f3'.repeat(32)}`), paymentHeader: evmHeader({ from: sw, nonce: n, signature: erc6492() }) });
    assert.equal(bad.code, 'settle_unconfirmed');
  } finally { await fac.close(); }
});

test('MF4 only an exact test/development NODE_ENV runs without the durable store', () => {
  for (const nodeEnv of [undefined, '', 'production', 'Production', 'prod', 'staging', ' production', 'TEST']) {
    const plan = challengeStorePlan({ nodeEnv, configured: null });
    assert.equal(plan.required, true, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
    assert.ok(plan.storePath, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
  }
  for (const nodeEnv of ['test', 'development']) {
    assert.equal(challengeStorePlan({ nodeEnv, configured: null }).required, false);
  }
});

test('boot allows the rollback flag only on known testnets', () => {
  for (const network of ['base ', 'BASE-MAINNET', 'base-mainnet', 'eip155:8453 ']) {
    assert.throws(() => assertX402Boot({ allowUnboundPayments: true, network }), /refused/, network);
  }
  assert.throws(() => assertX402Boot({ allowUnboundPayments: true, network: 'base-sepolia', solana: { network: 'mainnet-beta' } }), /refused/);
  assert.doesNotThrow(() => assertX402Boot({ allowUnboundPayments: true, network: 'base-sepolia', solana: { network: 'solana-devnet' } }));
  assert.doesNotThrow(() => assertX402Boot({ allowUnboundPayments: false, network: 'base' }));
});
