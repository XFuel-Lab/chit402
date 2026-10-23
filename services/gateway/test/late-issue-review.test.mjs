/**
 * Regressions for the late-issue review. Each case failed on 5cbd5510.
 * EVM only. Offline facilitator, stub chain reads, temp replay store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { ethers } from 'ethers';

import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { runX402Handshake } from '../src/x402-server.js';
import { clearChainReaderForTests, readHeadBlock } from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';
import { paymentFailureBody } from '../src/x402-flags.js';
import { toPublicShell } from '../src/receipt-shell.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import { getIssuerKid } from '../src/issuer-key.js';
import {
  findLatePublicReceipt,
  LATE_HORIZON_MS,
  LATE_TICK_ROW_BUDGET,
  LATE_TICK_RPC_BUDGET,
  listLateIssueOwnerView,
  resolveLateRecord,
  startLateIssueResolver,
  stopLateIssueResolver,
  tickLateIssue,
} from '../src/late-issue.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AUTH_NONCE = `0x${'cd'.repeat(32)}`;
const TX = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'44'.repeat(32)}`;
const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const AUTH_USED = ethers.id('AuthorizationUsed(address,bytes32)');

function pad(addr) {
  return ethers.zeroPadValue(addr, 32);
}

function evmHeader({
  from = PAYER, to = HOUSE, value = '2000', nonce = AUTH_NONCE, network = 'base',
} = {}) {
  const blob = {
    network,
    amount: value,
    payTo: to,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from, to, value, validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function putChallenge(store, fields = {}) {
  const nonce = fields.nonce || `0x${'ab'.repeat(32)}`;
  store.put(nonce, {
    taskId: 'task-late',
    amount: '2000',
    asset: USDC,
    network: 'base',
    payTo: HOUSE,
    resource: '/task-request',
    state: 'issued',
    expiresAt: Date.now() + 60_000,
    ...fields,
    nonce,
  });
  return nonce;
}

function listen(handler) {
  const hits = { settle: 0, verify: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = req.url || '';
      if (url.endsWith('/verify')) {
        hits.verify += 1;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ valid: true, isValid: true, payer: PAYER }));
        return;
      }
      if (url.endsWith('/settle')) {
        hits.settle += 1;
        handler({ req, res, raw, hits });
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function rpcServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body.method);
      let result;
      try { result = await handler(body.method, body.params, seen); }
      catch (err) {
        if (res.writableEnded) return;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: err.message } }));
        return;
      }
      if (res.writableEnded) return;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function baseCfg(url, over = {}) {
  return {
    network: 'base',
    payTo: HOUSE,
    facilitatorProvider: 'zan',
    gatewayUrl: url,
    apiKey: 'k',
    asset: USDC,
    allowUnboundPayments: false,
    lateIssue: true,
    publicBaseUrl: 'https://api.chit402.com',
    chainReader: async () => ({ ok: false, pending: true, code: 'settle_unconfirmed' }),
    ...over,
  };
}

async function pay(store, cfg, nonce, header) {
  return await settleBoundPayment({
    req: { headers: { 'x-payment': header }, body: { prompt: 'hello' } },
    taskId: 'task-late',
    amount: '2000',
    cfg,
    priceBody: { prompt: 'hello' },
    paymentHeader: header,
    clientVersion: 1,
    nonce,
    store,
  });
}

function match(over = {}) {
  return {
    ok: true,
    confirmed: true,
    finalized: true,
    amount: '2000',
    payer: PAYER,
    payTo: HOUSE,
    authorizer: PAYER,
    asset: USDC,
    network: 'base',
    transferCount: 1,
    blockTimestamp: Math.floor(Date.now() / 1000) + 30,
    tx: TX,
    status: 1,
    blockHash: BLOCK,
    ...over,
  };
}

function receiptResult() {
  const ts = Math.floor(Date.now() / 1000) + 30;
  return {
    status: '0x1',
    blockNumber: '0xa',
    blockHash: BLOCK,
    logs: [
      {
        address: USDC,
        topics: [TRANSFER, pad(PAYER), pad(HOUSE)],
        data: ethers.toBeHex(2000n, 32),
        logIndex: '0x0',
      },
      {
        address: USDC,
        topics: [AUTH_USED, pad(PAYER), pad(AUTH_NONCE)],
        data: '0x',
        logIndex: '0x1',
      },
    ],
    _ts: ts,
  };
}

function evmRpc(over = {}) {
  const flip = { block: BLOCK };
  return (method, params) => {
    if (method === 'eth_getLogs') {
      if (over.logs) return over.logs;
      return [{
        address: USDC,
        topics: [AUTH_USED, pad(PAYER), pad(AUTH_NONCE)],
        transactionHash: TX,
        blockNumber: '0xa',
        blockHash: BLOCK,
      }];
    }
    if (method === 'eth_getTransactionReceipt') {
      const receipt = receiptResult();
      delete receipt._ts;
      if (over.receiptStatus) receipt.status = over.receiptStatus;
      if (over.receiptHash) receipt.blockHash = over.receiptHash;
      return receipt;
    }
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      const ts = Math.floor(Date.now() / 1000) + 30;
      if (tag === 'finalized') {
        return { number: '0x14', timestamp: `0x${ts.toString(16)}`, hash: `0x${'11'.repeat(32)}` };
      }
      const hash = typeof over.blockHash === 'function' ? over.blockHash(tag) : (over.blockHash || flip.block);
      return { number: tag, timestamp: `0x${ts.toString(16)}`, hash };
    }
    return null;
  };
}

test.beforeEach(() => {
  clearChainReaderForTests();
  setActiveChallengeStore(null);
  stopLateIssueResolver();
  delete process.env.X402_LATE_ISSUE;
  delete process.env.X402_LATE_ISSUE_SHADOW;
});

test.afterEach(() => {
  stopLateIssueResolver();
});

test('a failed settle keeps the facilitator tx and a log search finds one', async () => {
  const rpc = await rpcServer(evmRpc());
  const fac = await listen(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      settled: false, success: false, transaction: TX, txRef: TX, network: 'base', payer: PAYER,
    }));
  });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader();
    const cfg = baseCfg(fac.url, { chainReader: async () => ({ ok: false, pending: true }) });
    const pending = await pay(store, cfg, nonce, header);
    assert.equal(pending.code, 'settle_pending');
    assert.equal(store.listLate()[0].tx_hint, TX);
    assert.equal(store.listLate()[0].sent, true);

    const bare = new ChallengeStore();
    const bareNonce = putChallenge(bare);
    const dropped = await listen(({ req }) => { req.socket.destroy(); });
    try {
      const noTx = baseCfg(dropped.url, {
        chainReader: undefined,
        baseRpcUrl: rpc.url,
        lateSigner: () => { signs += 1; return 'jws.discovered'; },
        lateAppendLog: () => {},
      });
      const held = await pay(bare, noTx, bareNonce, header);
      assert.equal(held.code, 'settle_pending');
      assert.equal(bare.listLate()[0].tx_hint, null);
      const issued = await pay(bare, noTx, bareNonce, header);
      assert.equal(dropped.hits.settle, 1);
      assert.equal(issued.receiptJws, 'jws.discovered');
      assert.equal(signs, 1);
      assert.equal(bare.listLate()[0].tx_hint, TX);
      assert.equal(rpc.seen.includes('eth_getLogs'), true);
    } finally {
      await dropped.close();
    }
  } finally {
    await fac.close();
    await rpc.close();
  }
});

test('switch off still receipts an idempotent retry after HTTP 500 or success:false', async () => {
  const cases = [
    {
      name: 'http 500',
      fail({ res }) {
        res.statusCode = 500;
        res.end('nope');
      },
    },
    {
      name: 'success false',
      fail({ res }) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          settled: false, success: false, transaction: TX, network: 'base', payer: PAYER,
        }));
      },
    },
  ];
  for (const item of cases) {
    let mode = 'fail';
    const fac = await listen((ctx) => {
      if (mode === 'fail') item.fail(ctx);
      else {
        ctx.res.setHeader('content-type', 'application/json');
        ctx.res.end(JSON.stringify({
          settled: true, success: true, transaction: TX, txRef: TX, network: 'base', payer: PAYER,
        }));
      }
    });
    try {
      const store = new ChallengeStore();
      const nonce = putChallenge(store);
      const header = evmHeader({ nonce: `0x${item.name === 'http 500' ? '11' : '22'}${'ab'.repeat(31)}` });
      const cfg = baseCfg(fac.url, {
        lateIssue: false,
        chainReader: async () => match(),
      });
      const first = await pay(store, cfg, nonce, header);
      assert.notEqual(first.code, 'settle_pending', item.name);
      assert.equal(first.receiptJws, undefined, item.name);
      assert.equal(store.get(nonce)?.state, 'issued', item.name);
      if (item.name === 'success false') assert.equal(store.listLate()[0].tx_hint, TX, item.name);
      mode = 'ok';
      const retry = await pay(store, cfg, nonce, header);
      assert.equal(retry.kind, 'settled', item.name);
      assert.equal(fac.hits.settle, 2, item.name);
      assert.ok(retry.paymentRef, item.name);
    } finally {
      await fac.close();
    }
  }
});

test('a claim in submitted is payment_in_flight', async () => {
  const store = new ChallengeStore();
  const nonce = putChallenge(store);
  assert.equal(store.claim(nonce, 'owner').ok, true);
  assert.equal(store.markSubmitted(nonce), true);
  const again = store.claim(nonce, 'other');
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'payment_in_flight');
});

test('a reorg of the block hash or a failed status does not sign', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader();
    let n = 0;
    const cfg = baseCfg(fac.url, { chainReader: async () => ({ ok: false, pending: true }) });
    await pay(store, cfg, nonce, header);
    let signs = 0;
    const signer = () => { signs += 1; return 'jws.reorg'; };
    const flipped = await resolveLateRecord(store, store.listLate()[0], {
      cfg: {
        ...cfg,
        chainReader: async () => {
          n += 1;
          const blockHash = n >= 3 ? `0x${'b'.repeat(64)}` : BLOCK;
          return match({ blockHash });
        },
      },
      signer,
      appendLog: () => {},
    });
    assert.equal(flipped.jws, undefined);
    assert.equal(signs, 0);
    assert.equal(store.listLate()[0].state, 'unknown');

    const status = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { ...cfg, chainReader: async () => match({ status: 0 }) },
      signer,
      appendLog: () => {},
    });
    assert.equal(status.jws, undefined);
    assert.equal(signs, 0);

    const stable = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { ...cfg, chainReader: async () => match() },
      signer,
      appendLog: () => {},
    });
    assert.equal(stable.jws, 'jws.reorg');
    assert.equal(signs, 1);
  } finally {
    await fac.close();
  }
});

test('the resolver tick reads the configured RPC and boot passes that config', async () => {
  const rpc = await rpcServer(evmRpc());
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const fac = await listen(({ req }) => { req.socket.destroy(); });
    try {
      const cfg = baseCfg(fac.url, { chainReader: undefined, baseRpcUrl: rpc.url });
      const header = evmHeader();
      await pay(store, cfg, nonce, header);
      assert.equal(store.listLate()[0].tx_hint, null);
      let signs = 0;
      await tickLateIssue(store, {
        cfg: { lateIssue: true, baseRpcUrl: rpc.url, network: 'base' },
        signer: () => { signs += 1; return 'jws.tick'; },
        appendLog: () => {},
      });
      assert.equal(signs, 1);
      assert.equal(store.listLate()[0].state, 'issued');
      assert.equal(rpc.seen.includes('eth_getLogs'), true);
      assert.equal(rpc.seen.includes('eth_getTransactionReceipt'), true);
      assert.equal(rpc.seen.includes('eth_getBlockByNumber'), true);
    } finally {
      await fac.close();
    }
  } finally {
    await rpc.close();
  }
  const serverSrc = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(serverSrc, /startLateIssueResolver\(opened,\s*\{[\s\S]*cfg:\s*config\.x402/);
  assert.match(serverSrc, /const issueBlock = await readHeadBlock\(/);
  assert.match(serverSrc, /buildPaymentChallenge\(\{[\s\S]*?\}, \{ issueBlock \}\)/);
  assert.doesNotMatch(serverSrc, /stampChallengeIssueBlock/);
});

test('an expired issuing lease with no signature is signed once', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url);
    await pay(store, cfg, nonce, evmHeader());
    const row = store.listLate()[0];
    store.casLate(row.pending_id, 'unknown', 'issuing', {
      lease_owner: 'crashed',
      lease_until: Date.now() - 1000,
      jws: null,
    });
    let signs = 0;
    const recovered = await resolveLateRecord(store, store.getLate(row.pending_id), {
      cfg: { ...cfg, chainReader: async () => match() },
      signer: () => { signs += 1; return 'jws.recovered'; },
      appendLog: () => {},
      owner: 'resolver',
    });
    assert.equal(recovered.jws, 'jws.recovered');
    assert.equal(signs, 1);
    assert.equal(store.listLate()[0].state, 'issued');

    store.casLate(store.listLate()[0].pending_id, 'issued', 'issuing', {
      lease_owner: 'crashed',
      lease_until: Date.now() - 1000,
      jws: 'jws.recovered',
    });
    const republish = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { ...cfg, chainReader: async () => match() },
      signer: () => { signs += 1; return 'jws.other'; },
      appendLog: () => {},
    });
    assert.equal(republish.jws, 'jws.recovered');
    assert.equal(signs, 1);
  } finally {
    await fac.close();
  }
});

test('a late receipt has a public page, a ledger row, and old rows are pruned', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  const ledger = new UsageSettledLedger({ persist: false });
  const recorded = [];
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { chainReader: async () => match(), lateAppendLog: () => {} });
    const header = evmHeader();
    const pending = await pay(store, cfg, nonce, header);
    assert.equal(pending.code, 'settle_pending');
    const body = paymentFailureBody(pending);
    assert.equal(body.verify_url, pending.verifyUrl);
    assert.match(body.verify_url, /\/receipt\/late-/);
    const issued = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => 'jws.page',
      appendLog: () => {},
      recordLedger: async (receipt) => {
        recorded.push(receipt);
        return await ledger.recordLateIssue(receipt);
      },
    });
    assert.equal(issued.jws, 'jws.page');
    const delivered = await pay(store, cfg, nonce, header);
    assert.equal(delivered.receiptJws, 'jws.page');
    const row = store.listLate().find((item) => item.pending_id === pending.pendingId);
    assert.equal(row.public_receipt.task_id, `late-${row.pending_id}`);
    assert.equal(row.public_receipt.issuer_signature.jws, 'jws.page');
    assert.match(row.public_receipt.note, /not served/);
    const shell = toPublicShell(findLatePublicReceipt(row.receipt_id, store));
    assert.equal(shell.receipt_id, row.receipt_id);
    assert.equal(shell.task_id, row.receipt_id);
    assert.equal(recorded.length, 1);
    assert.equal(ledger.findByTask(row.receipt_id).source, 'late_issue');
    assert.equal(listLateIssueOwnerView(store).some((item) => item.receipt_id === row.receipt_id), true);

    const oldId = 'a'.repeat(32);
    const freshUnknown = 'd'.repeat(32);
    store.putLate({
      pending_id: oldId,
      state: 'issued',
      submitted_at: Date.now() - LATE_HORIZON_MS - 1000,
      auth_key: 'old-auth',
      nonce: `0x${'99'.repeat(32)}`,
    });
    store.putLate({
      pending_id: freshUnknown,
      state: 'unknown',
      submitted_at: Date.now(),
      auth_key: 'fresh-unknown',
      nonce: `0x${'77'.repeat(32)}`,
    });
    await tickLateIssue(store, { cfg: { lateIssue: false } });
    assert.equal(store.listLate().some((item) => item.pending_id === oldId), false);
    assert.equal(store.listLate().some((item) => item.pending_id === freshUnknown), true);
    assert.equal(store.listLate().some((item) => item.pending_id === row.pending_id), true);
  } finally {
    await fac.close();
  }
});

test('production ignores signer and chain-reader hooks on the config object', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const store = new ChallengeStore();
    store.putLate({
      pending_id: 'b'.repeat(32),
      state: 'unknown',
      sent: true,
      solana: false,
      submitted_at: Date.now(),
      nonce: `0x${'ab'.repeat(32)}`,
      network: 'base',
      asset: USDC,
      payee: HOUSE,
      challenge_amount: '2000',
      route_quote: '2000',
      auth: { from: PAYER, value: '2000', nonce: AUTH_NONCE, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600) },
      auth_key: 'k',
      challenge_issued_at: Date.now() - 1000,
      book_ref: 'c'.repeat(32),
      tx_hint: TX,
      receipt_id: `late-${'b'.repeat(32)}`,
    });
    let signs = 0;
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg: {
        lateIssue: true,
        chainReader: async () => match(),
        lateSigner: () => { signs += 1; return 'jws.hook'; },
      },
    });
    assert.equal(signs, 0);
    assert.equal(resolved.jws, undefined);
    assert.notEqual(store.listLate()[0].state, 'issued');
  } finally {
    if (previous == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('an RPC reorg between the two finality reads does not sign', async () => {
  let reads = 0;
  const rpc = await rpcServer(evmRpc({
    blockHash(tag) {
      if (tag === 'finalized') return `0x${'11'.repeat(32)}`;
      reads += 1;
      return reads >= 3 ? `0x${'b'.repeat(64)}` : BLOCK;
    },
  }));
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { chainReader: undefined, baseRpcUrl: rpc.url });
    await pay(store, cfg, nonce, evmHeader());
    let signs = 0;
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { lateIssue: true, baseRpcUrl: rpc.url },
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
    });
    assert.equal(signs, 0);
    assert.equal(resolved.jws, undefined);
    assert.equal(store.listLate()[0].state, 'unknown');
  } finally {
    await fac.close();
    await rpc.close();
  }
});

test('a log search at a 30M tip issues once and never asks for more than 2000 blocks', async () => {
  const tip = 30_000_000;
  const issueBlock = tip - 5000;
  // Inside the two-chunk cap that starts at issueBlock - 64.
  const logBlock = tip - 2000;
  const ranges = [];
  const rpc = await rpcServer((method, params) => {
    if (method === 'eth_getLogs') {
      const filter = params[0];
      const from = BigInt(filter.fromBlock);
      const to = BigInt(filter.toBlock);
      if (to < from || (to - from + 1n) > 2000n) throw new Error('range');
      ranges.push([from, to]);
      if (ranges.length > 8) throw new Error('too many chunks');
      const at = BigInt(logBlock);
      if (from <= at && at <= to) {
        return [{
          address: USDC,
          topics: [AUTH_USED, pad(PAYER), pad(AUTH_NONCE)],
          transactionHash: TX,
          blockNumber: `0x${at.toString(16)}`,
          blockHash: BLOCK,
        }];
      }
      return [];
    }
    if (method === 'eth_getTransactionReceipt') {
      const receipt = receiptResult();
      delete receipt._ts;
      receipt.blockNumber = `0x${logBlock.toString(16)}`;
      return receipt;
    }
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      const ts = `0x${(Math.floor(Date.now() / 1000) + 30).toString(16)}`;
      if (tag === 'finalized') {
        return { number: `0x${tip.toString(16)}`, timestamp: ts, hash: `0x${'11'.repeat(32)}` };
      }
      return { number: tag, timestamp: ts, hash: BLOCK };
    }
    return null;
  });
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { issueBlock });
    const cfg = baseCfg(fac.url, { chainReader: undefined, baseRpcUrl: rpc.url });
    const header = evmHeader();
    await pay(store, cfg, nonce, header);
    assert.equal(store.listLate()[0].issue_block, issueBlock);
    assert.equal(store.listLate()[0].tx_hint, null);
    const deps = {
      cfg: { lateIssue: true, baseRpcUrl: rpc.url },
      signer: (claims) => {
        signs += 1;
        assert.equal(claims.kid, getIssuerKid());
        return 'jws.chunked';
      },
      appendLog: () => {},
    };
    const issued = await resolveLateRecord(store, store.listLate()[0], deps);
    assert.equal(issued.jws, 'jws.chunked');
    assert.equal(signs, 1);
    assert.equal(ranges.length, 2);
    for (const [from, to] of ranges) {
      assert.ok(to - from + 1n <= 2000n);
      assert.ok(from > 0n);
      assert.ok(from >= BigInt(issueBlock) - 64n);
    }
    const again = await resolveLateRecord(store, store.listLate()[0], deps);
    assert.equal(again.jws, 'jws.chunked');
    assert.equal(signs, 1);
  } finally {
    await fac.close();
    await rpc.close();
  }
});

test('a receipt that does not match the authorization is mismatch_hold', async () => {
  const fac = await listen(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      settled: false, success: false, transaction: TX, network: 'base', payer: PAYER,
    }));
  });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      chainReader: async () => ({ ok: false, code: 'settle_unconfirmed' }),
    });
    const pending = await pay(store, cfg, nonce, evmHeader());
    assert.equal(pending.code, 'settle_pending');
    assert.equal(store.listLate()[0].tx_hint, TX);
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
    });
    assert.equal(signs, 0);
    assert.equal(resolved.state, 'mismatch_hold');
    assert.equal(store.listLate()[0].state, 'mismatch_hold');
  } finally {
    await fac.close();
  }
});

test('a failed inline-issue CAS does not return a settled receipt', async () => {
  const fac = await listen(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      settled: true, success: true, transaction: TX, txRef: TX, network: 'base', payer: PAYER,
    }));
  });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const orig = store.casLate.bind(store);
    store.casLate = (id, from, to, patch) => {
      if (to === 'issued' && patch?.inline === true) return null;
      return orig(id, from, to, patch);
    };
    const decision = await pay(store, baseCfg(fac.url, { chainReader: async () => match() }), nonce, evmHeader());
    assert.notEqual(decision.kind, 'settled');
    assert.equal(decision.code, 'settle_pending');
    assert.equal(decision.receiptJws, undefined);
    assert.notEqual(store.listLate()[0].state, 'issued');
  } finally {
    await fac.close();
  }
});

function parkUnknown(store, n, {
  validAfter = '1', issuedAt = Date.now(), scannedTo = null, authNonce = null, why = 'unresolved_submit',
} = {}) {
  const pendingId = `pend${n}`;
  const put = store.putLate({
    pending_id: pendingId,
    state: 'unknown',
    sent: true,
    inline: false,
    facilitator_id: 'zan',
    submitted_at: Date.now(),
    nonce: `0x${n.toString(16).padStart(64, '0')}`,
    network: 'base',
    asset: USDC,
    payee: HOUSE,
    challenge_amount: '2000',
    route_quote: '2000',
    auth_key: `auth-${n}-${pendingId}`,
    auth: {
      from: PAYER,
      value: '2000',
      nonce: authNonce || `0x${(n + 1).toString(16).padStart(64, 'ab')}`,
      validAfter,
      validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    },
    issue_block: null,
    challenge_issued_at: issuedAt,
    scanned_to: scannedTo,
    book_ref: `book${n}`,
    tx_hint: null,
    tx_ref: null,
    jws: null,
    receipt_id: `late-${pendingId}`,
    served: false,
    why,
  });
  if (!put?.ok) throw new Error(put?.reason || 'putLate');
  return pendingId;
}

function tipRpc(tipRef, ranges, { maxLogs = 2 } = {}) {
  const baseTip = tipRef.tip;
  const baseTs = Math.floor(Date.now() / 1000) + 30;
  return (method, params) => {
    if (method === 'eth_getLogs') {
      const from = BigInt(params[0].fromBlock);
      const to = BigInt(params[0].toBlock);
      if (to < from || (to - from + 1n) > 2000n) throw new Error('range');
      ranges.push([from, to]);
      if (ranges.length > maxLogs) throw new Error('too many chunks');
      if (from < BigInt(tipRef.tip - 10_000)) throw new Error('scan started too early');
      return [];
    }
    if (method === 'eth_getBlockByNumber') {
      const ts = baseTs + (tipRef.tip - baseTip) * 2;
      const hexTs = `0x${ts.toString(16)}`;
      const tag = params[0];
      if (tag === 'finalized') {
        return { number: `0x${tipRef.tip.toString(16)}`, timestamp: hexTs, hash: `0x${'11'.repeat(32)}` };
      }
      return { number: tag, timestamp: hexTs, hash: BLOCK };
    }
    return null;
  };
}

test('validAfter=1 costs at most two getLogs', async () => {
  const tipRef = { tip: 30_000_000 };
  const ranges = [];
  const rpc = await rpcServer(tipRpc(tipRef, ranges));
  try {
    const store = new ChallengeStore();
    parkUnknown(store, 1);
    await resolveLateRecord(store, store.listLate()[0], {
      cfg: { lateIssue: true, baseRpcUrl: rpc.url },
    });
    assert.ok(ranges.length >= 1);
    assert.ok(ranges.length <= 2);
    assert.ok(ranges[0][0] > BigInt(tipRef.tip - 10_000));
    assert.equal(store.listLate()[0].state, 'unknown');
    assert.ok(store.listLate()[0].scanned_to != null);
  } finally {
    await rpc.close();
  }
});

test('one background run keeps getLogs bounded across unknown rows', async () => {
  const tipRef = { tip: 30_000_000 };
  const ranges = [];
  const n = 8;
  const rpc = await rpcServer(tipRpc(tipRef, ranges, { maxLogs: n * 2 }));
  try {
    const store = new ChallengeStore();
    for (let i = 0; i < n; i += 1) parkUnknown(store, i + 1);
    await tickLateIssue(store, { cfg: { lateIssue: true, baseRpcUrl: rpc.url } });
    assert.ok(ranges.length <= n * 2);
    assert.ok(ranges.length >= n);
    for (const [from, to] of ranges) {
      assert.ok(from > BigInt(tipRef.tip - 10_000));
      assert.ok(to - from + 1n <= 2000n);
    }
    assert.equal(store.listLate().every((row) => row.state === 'unknown'), true);
  } finally {
    await rpc.close();
  }
});

test('a rescan after a saved scanned-to point only covers new blocks', async () => {
  const tipRef = { tip: 30_000_000 };
  const ranges = [];
  const rpc = await rpcServer(tipRpc(tipRef, ranges, { maxLogs: 8 }));
  try {
    const store = new ChallengeStore();
    parkUnknown(store, 1);
    const deps = { cfg: { lateIssue: true, baseRpcUrl: rpc.url } };
    await resolveLateRecord(store, store.listLate()[0], deps);
    const saved = store.listLate()[0].scanned_to;
    assert.ok(saved != null);
    const savedN = BigInt(saved);
    assert.ok(ranges.length <= 2);
    assert.ok(ranges.every(([from]) => from > BigInt(tipRef.tip - 10_000)));
    ranges.length = 0;
    await resolveLateRecord(store, store.listLate()[0], deps);
    assert.equal(ranges.length, 0);
    assert.equal(String(store.listLate()[0].scanned_to), String(saved));
    tipRef.tip += 2500;
    await resolveLateRecord(store, store.listLate()[0], deps);
    assert.ok(ranges.length >= 1);
    assert.ok(ranges.length <= 2);
    assert.equal(ranges[0][0], savedN + 1n);
    for (const [from, to] of ranges) {
      assert.ok(from > savedN);
      assert.ok(to - from + 1n <= 2000n);
    }
  } finally {
    await rpc.close();
  }
});

test('a challenge records the head block at issue time', async () => {
  const head = 12_345_678;
  const rpc = await rpcServer((method) => {
    if (method === 'eth_blockNumber') return `0x${head.toString(16)}`;
    return null;
  });
  try {
    const store = new ChallengeStore();
    const puts = [];
    const orig = store.put.bind(store);
    store.put = (nonce, data) => {
      puts.push({
        nonce,
        network: data?.network || null,
        issueBlock: data?.issueBlock ?? null,
      });
      return orig(nonce, data);
    };
    const decision = await runX402Handshake(
      { headers: {}, body: { prompt: 'hi' } },
      {
        taskId: 'task-issue-block',
        amount: '2000',
        store,
        cfg: {
          network: 'base',
          payTo: HOUSE,
          facilitatorProvider: 'zan',
          gatewayUrl: 'http://127.0.0.1:9',
          asset: USDC,
          baseRpcUrl: rpc.url,
          solana: {
            enabled: true,
            payTo: 'So11111111111111111111111111111111111111112',
            network: 'solana',
          },
        },
      },
    );
    assert.equal(decision.kind, 'challenge');
    const base = decision.body.accepts[0];
    const sol = decision.body.accepts[1];
    assert.equal(puts[0].network, 'base');
    assert.equal(puts[0].issueBlock, head);
    assert.equal(puts.find((row) => row.network === 'solana').issueBlock, null);
    assert.equal(store.get(base.extra.nonce).issueBlock, head);
    assert.equal(store.get(sol.extra.nonce).issueBlock ?? null, null);
  } finally {
    await rpc.close();
  }
});

test('a challenge still issues when the head-block read fails', async () => {
  const rpc = await rpcServer(() => { throw new Error('down'); });
  try {
    const store = new ChallengeStore();
    const decision = await runX402Handshake(
      { headers: {}, body: { prompt: 'hi' } },
      {
        taskId: 'task-issue-block-down',
        amount: '2000',
        store,
        cfg: {
          network: 'base',
          payTo: HOUSE,
          facilitatorProvider: 'zan',
          gatewayUrl: 'http://127.0.0.1:9',
          asset: USDC,
          baseRpcUrl: rpc.url,
        },
      },
    );
    assert.equal(decision.kind, 'challenge');
    const nonce = decision.body.accepts[0].extra.nonce;
    assert.equal(store.get(nonce).issueBlock ?? null, null);
  } finally {
    await rpc.close();
  }
});

test('late-issue runs do not overlap', async () => {
  let open = true;
  let finish = () => {};
  const gate = new Promise((resolve) => {
    finish = () => {
      if (!open) return;
      open = false;
      resolve();
    };
  });
  let calls = 0;
  let inflight = 0;
  let maxInflight = 0;
  const rpc = await rpcServer(async (method, params) => {
    inflight += 1;
    if (inflight > maxInflight) maxInflight = inflight;
    calls += 1;
    try {
      if (calls === 1) await gate;
      if (method === 'eth_getLogs') return [];
      if (method === 'eth_getBlockByNumber') {
        const ts = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
        if (params[0] === 'finalized') {
          return { number: '0x3e8', timestamp: ts, hash: `0x${'11'.repeat(32)}` };
        }
        return { number: params[0], timestamp: ts, hash: BLOCK };
      }
      return null;
    } finally {
      inflight -= 1;
    }
  });
  try {
    const store = new ChallengeStore();
    parkUnknown(store, 41);
    const deps = { cfg: { lateIssue: true, baseRpcUrl: rpc.url }, intervalMs: 15 };
    const first = tickLateIssue(store, deps);
    for (let i = 0; i < 40 && calls < 1; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(calls, 1);
    const second = await tickLateIssue(store, deps);
    assert.deepEqual(second, []);
    const otherRpc = await rpcServer((method, params) => {
      if (method === 'eth_getLogs') return [];
      if (method === 'eth_getBlockByNumber') {
        const ts = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
        if (params[0] === 'finalized') {
          return { number: '0x3e8', timestamp: ts, hash: `0x${'11'.repeat(32)}` };
        }
        return { number: params[0], timestamp: ts, hash: BLOCK };
      }
      return null;
    });
    try {
      const otherStore = new ChallengeStore();
      parkUnknown(otherStore, 42);
      const other = await tickLateIssue(otherStore, { cfg: { lateIssue: true, baseRpcUrl: otherRpc.url } });
      assert.equal(other.length, 1);
      assert.equal(calls, 1);
    } finally {
      await otherRpc.close();
    }
    startLateIssueResolver(store, deps);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);
    assert.equal(maxInflight, 1);
    stopLateIssueResolver();
    finish();
    await first;
    for (let i = 0; i < 30 && inflight > 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(inflight, 0);
    assert.equal(maxInflight, 1);
  } finally {
    finish();
    stopLateIssueResolver();
    for (let i = 0; i < 30 && inflight > 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await rpc.close();
  }
});

test('one tick stays inside the row and RPC budgets and the next tick continues round-robin', async () => {
  const tip = 30_000_000;
  const nonces = [];
  let rpcCount = 0;
  const rpc = await rpcServer((method, params) => {
    rpcCount += 1;
    if (method === 'eth_getLogs') {
      nonces.push(String(params[0].topics[2]).toLowerCase());
      return [];
    }
    if (method === 'eth_getBlockByNumber') {
      const ts = `0x${(Math.floor(Date.now() / 1000) + 30).toString(16)}`;
      if (params[0] === 'finalized') {
        return { number: `0x${tip.toString(16)}`, timestamp: ts, hash: `0x${'11'.repeat(32)}` };
      }
      return { number: params[0], timestamp: ts, hash: BLOCK };
    }
    return null;
  });
  try {
    const total = LATE_TICK_ROW_BUDGET + 4;
    const store = new ChallengeStore();
    for (let n = 1; n <= total; n += 1) parkUnknown(store, n);
    const deps = { cfg: { lateIssue: true, baseRpcUrl: rpc.url } };
    await tickLateIssue(store, deps);
    const firstRpc = rpcCount;
    const firstNonces = nonces.slice();
    assert.ok(firstRpc <= LATE_TICK_RPC_BUDGET);
    assert.ok(firstNonces.length > 0);
    assert.ok(firstNonces.length <= LATE_TICK_ROW_BUDGET);
    assert.ok(firstNonces.length < total);
    const nonceOf = (n) => ethers.zeroPadValue(
      `0x${(n + 1).toString(16).padStart(64, 'ab')}`,
      32,
    ).toLowerCase();
    assert.equal(firstNonces[0], nonceOf(1));
    rpcCount = 0;
    nonces.length = 0;
    await tickLateIssue(store, deps);
    assert.ok(rpcCount <= LATE_TICK_RPC_BUDGET);
    assert.equal(nonces[0], nonceOf(firstNonces.length + 1));
    assert.equal(store.listLate().every((row) => row.scanned_to != null), true);
  } finally {
    await rpc.close();
  }
});

test('a timeout row is visited ahead of ten thousand success:false rows', async () => {
  const tip = 30_000_000;
  const nonces = [];
  let logs = 0;
  const rpc = await rpcServer((method, params) => {
    if (method === 'eth_getLogs') {
      logs += 1;
      nonces.push(String(params[0].topics[2]).toLowerCase());
      return [];
    }
    if (method === 'eth_getBlockByNumber') {
      const ts = `0x${(Math.floor(Date.now() / 1000) + 30).toString(16)}`;
      if (params[0] === 'finalized') {
        return { number: `0x${tip.toString(16)}`, timestamp: ts, hash: `0x${'11'.repeat(32)}` };
      }
      return { number: params[0], timestamp: ts, hash: BLOCK };
    }
    return null;
  });
  try {
    const store = new ChallengeStore();
    const junk = 10_000;
    for (let n = 1; n <= junk; n += 1) parkUnknown(store, n, { why: 'success_false' });
    parkUnknown(store, junk + 1, { why: 'transport', authNonce: AUTH_NONCE });
    await tickLateIssue(store, { cfg: { lateIssue: true, baseRpcUrl: rpc.url } });
    assert.equal(nonces[0], ethers.zeroPadValue(AUTH_NONCE, 32).toLowerCase());
    const rows = store.listLate();
    assert.ok(rows.find((row) => row.why === 'transport').last_visited_at > 0);
    const junkVisited = rows.filter((row) => row.why === 'success_false' && row.last_visited_at).length;
    assert.ok(junkVisited <= LATE_TICK_ROW_BUDGET - 1);
    assert.ok(logs <= LATE_TICK_ROW_BUDGET);
    assert.ok(logs < junk);
  } finally {
    await rpc.close();
  }
});

test('a third open row from the same payer is released', async () => {
  const fac = await listen(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ settled: false, success: false, reason: 'nope' }));
  });
  try {
    const store = new ChallengeStore();
    parkUnknown(store, 1);
    parkUnknown(store, 2);
    const nonce = putChallenge(store, { nonce: `0x${'ee'.repeat(32)}` });
    const decision = await pay(store, baseCfg(fac.url), nonce, evmHeader());
    assert.notEqual(decision.code, 'settle_pending');
    assert.equal(store.listLate().length, 2);
    assert.equal(store.get(nonce).state, 'issued');
  } finally {
    await fac.close();
  }
});

test('a null or non-array eth_getLogs result does not advance the cursor', async () => {
  const tip = 30_000_000;
  const logBlock = tip - 10;
  for (const bad of [null, { unexpected: true }]) {
    let logs = 0;
    const rpc = await rpcServer((method, params) => {
      if (method === 'eth_getLogs') {
        logs += 1;
        if (logs === 1) return bad;
        const from = BigInt(params[0].fromBlock);
        const to = BigInt(params[0].toBlock);
        const at = BigInt(logBlock);
        if (from <= at && at <= to) {
          return [{
            address: USDC,
            topics: [AUTH_USED, pad(PAYER), pad(AUTH_NONCE)],
            transactionHash: TX,
            blockNumber: `0x${at.toString(16)}`,
            blockHash: BLOCK,
          }];
        }
        return [];
      }
      if (method === 'eth_getTransactionReceipt') {
        const receipt = receiptResult();
        delete receipt._ts;
        receipt.blockNumber = `0x${logBlock.toString(16)}`;
        return receipt;
      }
      if (method === 'eth_getBlockByNumber') {
        const ts = `0x${(Math.floor(Date.now() / 1000) + 30).toString(16)}`;
        if (params[0] === 'finalized') {
          return { number: `0x${tip.toString(16)}`, timestamp: ts, hash: `0x${'11'.repeat(32)}` };
        }
        return { number: params[0], timestamp: ts, hash: BLOCK };
      }
      return null;
    });
    try {
      const store = new ChallengeStore();
      parkUnknown(store, 70 + logs, { authNonce: AUTH_NONCE });
      const deps = {
        cfg: { lateIssue: true, baseRpcUrl: rpc.url },
        signer: () => 'jws.rescanned',
        appendLog: () => {},
      };
      const missed = await resolveLateRecord(store, store.listLate()[0], deps);
      assert.equal(missed.jws, undefined);
      assert.equal(store.listLate()[0].scanned_to ?? null, null);
      assert.equal(store.listLate()[0].tx_hint ?? null, null);
      const found = await resolveLateRecord(store, store.listLate()[0], deps);
      assert.equal(found.jws, 'jws.rescanned');
      assert.equal(store.listLate()[0].tx_hint, TX);
    } finally {
      await rpc.close();
    }
  }
});

test('the head-block read gives up in about 250ms', async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const started = Date.now();
    const block = await readHeadBlock(url);
    const elapsed = Date.now() - started;
    assert.equal(block, null);
    assert.ok(elapsed < 500, `head block read took ${elapsed}ms`);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
