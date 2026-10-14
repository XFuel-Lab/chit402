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
import { clearChainReaderForTests } from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';
import { paymentFailureBody } from '../src/x402-flags.js';
import { toPublicShell } from '../src/receipt-shell.js';
import { UsageSettledLedger } from '../src/usage-settled.js';
import {
  findLatePublicReceipt,
  LATE_HORIZON_MS,
  listLateIssueOwnerView,
  resolveLateRecord,
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
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body.method);
      let result;
      try { result = handler(body.method, body.params, seen); }
      catch (err) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: err.message } }));
        return;
      }
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

function pay(store, cfg, nonce, header) {
  return settleBoundPayment({
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
      recordLedger: (receipt) => {
        recorded.push(receipt);
        return ledger.recordLateIssue(receipt);
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
