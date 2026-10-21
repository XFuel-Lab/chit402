/**
 * Arc rail behind ARC_RAIL_ENABLED. Flag off: every Arc id is refused and
 * Base is unchanged. Flag on: Arc testnet only, its own RPC row, its own USDC,
 * and the 0xff..fe system Transfer is never counted. Fixture is a real Arc
 * testnet settle receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARC_SYSTEM_TRANSFER_EMITTER, arcAssetAllowed, arcNetwork, arcRefused, evmRpcUrlFor,
  evmSettlementSide, isArcSystemLog, lateIssueWindow,
} from '../src/arc-rail.js';
import { facilitatorNetwork, fromCaip2Network, isEvmNetwork, toCaip2Network } from '../src/x402-facilitator.js';
import { canonicalNetwork, normalizePaymentRef } from '../src/payment-ref.js';
import {
  confirmEvmReceipt, expectedEvmChainId, findAuthorizationTx, probeConfiguredSettlementRpcs,
  probeSettlementSide, resetSettlementRpcForTests, settlementRefusal, settlementRpcState,
} from '../src/x402-chain.js';
import { buildSellerProof, circleSettle } from '../src/arc-circle-settle.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { ChallengeStore } from '../src/x402-adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/arc-testnet-settle-receipt.json'), 'utf8'));
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC = 'eip155:5042002';
const ON = { ARC_RAIL_ENABLED: 'true' };

function withFlag(value, fn) {
  const saved = process.env.ARC_RAIL_ENABLED;
  if (value == null) delete process.env.ARC_RAIL_ENABLED;
  else process.env.ARC_RAIL_ENABLED = value;
  const restore = () => {
    if (saved == null) delete process.env.ARC_RAIL_ENABLED;
    else process.env.ARC_RAIL_ENABLED = saved;
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function confirmArgs(over = {}) {
  return {
    challenge: { asset: ARC_USDC, amount: '10000', network: ARC },
    expectedPayTo: FIX.payTo,
    authorization: { ...FIX.authorization },
    ...over,
  };
}

test('flag off: Arc ids are refused everywhere, Base and Solana unchanged', () => withFlag(null, () => {
  for (const id of [ARC, 'arc-testnet', 'eip155:5042', 'arc']) {
    assert.equal(arcNetwork(id), null);
    assert.equal(arcRefused(id), true);
    assert.equal(facilitatorNetwork(id), 'unknown-network');
    assert.equal(evmRpcUrlFor(id, { baseRpcUrl: 'http://base.invalid' }), null);
    assert.equal(evmSettlementSide(id), null);
  }
  assert.equal(toCaip2Network('arc-testnet'), 'arc-testnet');
  assert.equal(fromCaip2Network(ARC), ARC);
  assert.equal(canonicalNetwork(ARC), ARC);
  assert.equal(expectedEvmChainId(ARC), null);
  assert.equal(arcAssetAllowed(ARC, ARC_USDC), false);
  // Base: same answers as before this change.
  assert.equal(facilitatorNetwork('eip155:8453'), 'base');
  assert.equal(facilitatorNetwork('base-sepolia'), 'base-sepolia');
  assert.equal(toCaip2Network('base'), 'eip155:8453');
  assert.equal(fromCaip2Network('eip155:84532'), 'base-sepolia');
  assert.equal(canonicalNetwork('eip155:8453'), 'base');
  assert.equal(expectedEvmChainId('base'), 8453);
  assert.equal(evmRpcUrlFor('base', { baseRpcUrl: 'http://b.invalid', rpcUrl: 'http://r.invalid' }), 'http://b.invalid');
  assert.equal(evmRpcUrlFor('base', { rpcUrl: 'http://r.invalid' }), 'http://r.invalid');
  assert.equal(evmRpcUrlFor(undefined, {}), null);
  assert.equal(evmSettlementSide('base'), 'base');
  assert.deepEqual(lateIssueWindow('base'), { marginBlocks: 64n, chunkBlocks: 2000n, chunkCap: 2n, blockMs: 2000n });
  assert.deepEqual(lateIssueWindow(ARC), lateIssueWindow('base'));
  const ref = normalizePaymentRef('eip155:8453', `0x${'ab'.repeat(32)}`);
  assert.equal(ref.key, `base:0x${'ab'.repeat(32)}`);
}));

test('flag on: Arc testnet is live, Arc mainnet stays disabled', () => withFlag('true', () => {
  assert.equal(facilitatorNetwork(ARC), 'arc-testnet');
  assert.equal(facilitatorNetwork('ARC-TESTNET'), 'arc-testnet');
  assert.equal(toCaip2Network('arc-testnet'), ARC);
  assert.equal(fromCaip2Network(ARC), 'arc-testnet');
  assert.equal(canonicalNetwork(ARC), 'arc-testnet');
  assert.equal(isEvmNetwork('arc-testnet'), true);
  assert.equal(expectedEvmChainId(ARC), 5042002);
  assert.equal(evmSettlementSide(ARC), 'arc');
  const ref = normalizePaymentRef(ARC, `0x${'cd'.repeat(32)}`);
  assert.equal(ref.key, `arc-testnet:0x${'cd'.repeat(32)}`);
  // Never the Base URL for Arc.
  assert.equal(evmRpcUrlFor(ARC, { baseRpcUrl: 'http://base.invalid' }), null);
  assert.equal(evmRpcUrlFor(ARC, { baseRpcUrl: 'http://base.invalid', arcRpcUrl: 'http://arc.invalid' }), 'http://arc.invalid');
  for (const id of ['eip155:5042', 'arc']) {
    assert.equal(arcNetwork(id), null);
    assert.equal(arcRefused(id), true);
    assert.equal(facilitatorNetwork(id), 'unknown-network');
    assert.equal(expectedEvmChainId(id), null);
  }
  // Base still the same with the flag on.
  assert.equal(facilitatorNetwork('base'), 'base');
  assert.equal(expectedEvmChainId('eip155:84532'), 84532);
  assert.deepEqual(lateIssueWindow('base'), { marginBlocks: 64n, chunkBlocks: 2000n, chunkCap: 2n, blockMs: 2000n });
}));

test('Arc asset allowlist: native USDC only, never the system emitter', () => {
  assert.equal(arcAssetAllowed(ARC, ARC_USDC, ON), true);
  assert.equal(arcAssetAllowed(ARC, ARC_USDC.toUpperCase().replace('0X', '0x'), ON), true);
  assert.equal(arcAssetAllowed(ARC, ARC_SYSTEM_TRANSFER_EMITTER, ON), false);
  assert.equal(arcAssetAllowed(ARC, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', ON), false);
  assert.equal(arcAssetAllowed('eip155:5042', ARC_USDC, ON), false);
  assert.equal(arcAssetAllowed(ARC, null, ON), false);
});

test('real Arc receipt: system Transfer is present and never counted', () => {
  const logs = FIX.receipt.logs;
  const sys = logs.filter(isArcSystemLog);
  assert.equal(sys.length, 1);
  assert.equal(BigInt(sys[0].data), 10n ** 16n); // 0.01 USDC at 18 decimals
  const ok = confirmEvmReceipt(FIX.receipt, confirmArgs());
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, '10000');
  assert.equal(ok.transferCount, 1);
  assert.equal(ok.logIndex, 10);
  assert.equal(confirmEvmReceipt(FIX.receipt, confirmArgs({
    challenge: { asset: ARC_USDC, amount: '10001', network: ARC },
  })).ok, false);
  assert.equal(confirmEvmReceipt(FIX.receipt, confirmArgs({
    authorization: { ...FIX.authorization, nonce: `0x${'11'.repeat(32)}` },
  })).ok, false);
  // Naming the system emitter as the asset never matches, at any amount.
  for (const amount of ['1', '10000', String(10n ** 16n)]) {
    assert.equal(confirmEvmReceipt(FIX.receipt, confirmArgs({
      challenge: { asset: ARC_SYSTEM_TRANSFER_EMITTER, amount, network: ARC },
    })).ok, false);
  }
});

test('the system Transfer alone never confirms, and extra system logs never add a match', () => {
  // Drop the real USDC Transfer: only the 18-decimal system log is left.
  const onlySystem = {
    ...FIX.receipt,
    logs: FIX.receipt.logs.filter((l) => !(l.address.toLowerCase() === ARC_USDC && l.topics[0].startsWith('0xddf252ad'))),
  };
  assert.equal(confirmEvmReceipt(onlySystem, confirmArgs()).ok, false);
  // Two system logs plus the real one: still exactly one counted transfer.
  const doubled = { ...FIX.receipt, logs: [...FIX.receipt.logs, { ...FIX.receipt.logs[1], logIndex: '0xb' }] };
  const out = confirmEvmReceipt(doubled, confirmArgs());
  assert.equal(out.ok, true);
  assert.equal(out.transferCount, 1);
  assert.equal(out.amount, '10000');
});

test('flag off: settle refuses an Arc challenge before the facilitator', async () => withFlag(null, async () => {
  const store = new ChallengeStore();
  const nonce = 'nonce-arc-off';
  store.put(nonce, {
    network: ARC, state: 'issued', expiresAt: Date.now() + 60_000,
    payTo: FIX.payTo, amount: '10000', asset: ARC_USDC, resource: '/task-request',
  });
  const out = await settleBoundPayment({
    req: { headers: {} }, taskId: 'task-arc-off', amount: '10000',
    cfg: { payTo: FIX.payTo, network: ARC, allowUnboundPayments: false, arcRpcUrl: 'http://arc.invalid' },
    store, nonce, paymentHeader: '', resource: '/task-request',
  });
  assert.equal(out.code, 'network_not_accepted');
}));

test('flag on: settle refuses an Arc challenge pinned to a non-allowlisted asset', async () => withFlag('true', async () => {
  const run = async (asset) => {
    const store = new ChallengeStore();
    const nonce = `nonce-arc-asset-${asset.slice(2, 6)}`;
    store.put(nonce, {
      network: ARC, state: 'issued', expiresAt: Date.now() + 60_000,
      payTo: FIX.payTo, amount: '10000', asset, resource: '/task-request',
    });
    return settleBoundPayment({
      req: { headers: {} }, taskId: 'task-arc-asset', amount: '10000',
      cfg: { payTo: FIX.payTo, network: ARC, allowUnboundPayments: false, arcRpcUrl: 'http://arc.invalid' },
      store, nonce, paymentHeader: '', resource: '/task-request',
    });
  };
  for (const bad of [ARC_SYSTEM_TRANSFER_EMITTER, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']) {
    assert.equal((await run(bad)).code, 'network_not_accepted');
  }
  // Native USDC passes the network and asset gates (and stops later on the empty header).
  assert.notEqual((await run(ARC_USDC)).code, 'network_not_accepted');
}));

test('Arc gets its own settlement RPC row; pausing it leaves Base open', async () => withFlag('true', async () => {
  resetSettlementRpcForTests();
  const st = await probeSettlementSide({ side: 'arc', url: 'http://arc.invalid', expected: 5042002, request: async () => '0x2105' });
  assert.equal(st.paused, true);
  assert.equal(settlementRefusal(ARC), 'network_not_accepted');
  assert.equal(settlementRefusal('base'), null);
  assert.equal(settlementRpcState('base').paused, false);
  resetSettlementRpcForTests();
  const both = await probeConfiguredSettlementRpcs(
    { network: 'base', baseRpcUrl: 'http://base.invalid', arcRpcUrl: 'http://arc.invalid' },
    { request: async (url) => (url.includes('arc') ? '0x4cef52' : '0x2105') },
  );
  assert.equal(both.base.paused, false);
  assert.equal(both.arc.paused, false);
  resetSettlementRpcForTests();
}));

test('flag off: settlement probe result has no arc row and never calls an Arc RPC', async () => withFlag(null, async () => {
  resetSettlementRpcForTests();
  const urls = [];
  const out = await probeConfiguredSettlementRpcs(
    { network: 'base', baseRpcUrl: 'http://base.invalid', arcRpcUrl: 'http://arc.invalid' },
    { request: async (url) => { urls.push(url); return '0x2105'; } },
  );
  assert.deepEqual(Object.keys(out).sort(), ['base', 'solana']);
  assert.deepEqual(urls, ['http://base.invalid']);
  resetSettlementRpcForTests();
}));

test('late-issue window is sized by time per chain; Base windows are unchanged', async () => {
  const arcWin = lateIssueWindow(ARC, ON);
  assert.equal(arcWin.blockMs, 500n);
  assert.equal(arcWin.marginBlocks, 256n); // 128 s at 0.5 s
  assert.ok(arcWin.chunkBlocks <= 9000n); // under the 10k eth_getLogs cap
  assert.equal(arcWin.chunkBlocks * arcWin.chunkCap, 16000n); // 8,000 s at 0.5 s

  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    let result = null;
    if (method === 'eth_getBlockByNumber') result = { number: '0x100000', timestamp: '0x6ad80000' };
    if (method === 'eth_getLogs') result = [];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  };
  const args = { asset: ARC_USDC, from: FIX.authorization.from, nonce: FIX.authorization.nonce, issueBlock: 0x0f0000 };
  try {
    await withFlag(null, () => findAuthorizationTx('http://rpc.invalid', { ...args, network: 'base' }));
    const baseLogs = calls.filter((c) => c.method === 'eth_getLogs').map((c) => c.params[0]);
    assert.deepEqual(baseLogs.map((p) => [p.fromBlock, p.toBlock]), [
      [`0x${(0x0f0000 - 64).toString(16)}`, `0x${(0x0f0000 - 64 + 1999).toString(16)}`],
      [`0x${(0x0f0000 - 64 + 2000).toString(16)}`, `0x${(0x0f0000 - 64 + 3999).toString(16)}`],
    ]);
    // No network argument: the Base window, same as before this change.
    calls.length = 0;
    await withFlag(null, () => findAuthorizationTx('http://rpc.invalid', args));
    assert.deepEqual(calls.filter((c) => c.method === 'eth_getLogs').map((c) => c.params[0].fromBlock), baseLogs.map((p) => p.fromBlock));
    calls.length = 0;
    await withFlag('true', () => findAuthorizationTx('http://rpc.invalid', { ...args, network: ARC }));
    const arcLogs = calls.filter((c) => c.method === 'eth_getLogs').map((c) => c.params[0]);
    assert.equal(arcLogs.length, 2);
    assert.equal(arcLogs[0].fromBlock, `0x${(0x0f0000 - 256).toString(16)}`);
    assert.equal(arcLogs[1].toBlock, `0x${(0x0f0000 - 256 + 16000 - 1).toString(16)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Circle settle client fails closed: flag off, no key, wrong key', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  const req = { scheme: 'exact', network: ARC, amount: '10000', asset: ARC_USDC, payTo: FIX.payTo };
  assert.deepEqual(await circleSettle({ paymentPayload: {}, paymentRequirements: req, env: {}, fetchImpl }), { ok: false, code: 'network_not_accepted' });
  assert.deepEqual(await circleSettle({ paymentPayload: {}, paymentRequirements: req, env: ON, fetchImpl }), { ok: false, code: 'gateway_not_configured' });
  const wrongKey = { ...ON, ARC_SELLER_PROOF_KEY: `0x${'01'.repeat(32)}` }; // controls a different address
  assert.deepEqual(await circleSettle({ paymentPayload: {}, paymentRequirements: req, env: wrongKey, fetchImpl }), { ok: false, code: 'gateway_not_configured' });
  assert.deepEqual(await circleSettle({ paymentPayload: {}, paymentRequirements: { ...req, network: 'eip155:5042' }, env: wrongKey, fetchImpl }), { ok: false, code: 'network_not_accepted' });
});

test('Circle settle client: proof shape, pending is never paid, key never leaves', async () => {
  const { ethers } = await import('ethers');
  const key = `0x${'02'.repeat(32)}`;
  const payTo = new ethers.Wallet(key).address;
  const env = { ...ON, ARC_SELLER_PROOF_KEY: key };
  const req = { scheme: 'exact', network: ARC, amount: '10000', asset: ARC_USDC, payTo };
  let seen = null;
  const answer = (body) => async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(body), { status: 200 }); };
  const paid = await circleSettle({ paymentPayload: { x: 1 }, paymentRequirements: req, env, fetchImpl: answer({ success: true, transaction: '0xab', network: ARC, payer: '0x01' }) });
  assert.equal(paid.ok, true);
  assert.equal(seen.url, 'https://api.circle.com/v1/facilitator/x402/settle');
  const proof = JSON.parse(Buffer.from(seen.init.headers['Facilitator-Seller-Proof'], 'base64url').toString('utf8'));
  assert.equal(proof.version, 1);
  assert.equal(proof.network, ARC);
  assert.equal(proof.payTo, payTo);
  const recovered = ethers.verifyTypedData(
    { name: 'Circle Facilitator Seller Request', version: '1', chainId: 5042002 },
    { SellerRequest: [
      { name: 'purpose', type: 'string' }, { name: 'method', type: 'string' }, { name: 'bodyHash', type: 'bytes32' },
      { name: 'network', type: 'string' }, { name: 'payTo', type: 'address' }, { name: 'nonce', type: 'bytes32' },
      { name: 'issuedAt', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
    ] },
    { purpose: 'settle', method: 'POST', bodyHash: ethers.keccak256(ethers.toUtf8Bytes(seen.init.body)), network: ARC, payTo, nonce: proof.nonce, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt },
    proof.signature,
  );
  assert.equal(recovered, payTo);
  assert.ok(!JSON.stringify(seen).includes(key.slice(2)));
  const pending = await circleSettle({ paymentPayload: {}, paymentRequirements: req, env, fetchImpl: answer({ success: false, errorReason: 'settlement_pending' }) });
  assert.equal(pending.ok, false);
  assert.equal(pending.code, 'settle_pending');
  assert.equal(await buildSellerProof({ purpose: 'settle', method: 'POST', network: ARC, payTo, env: {} }), null);
});
