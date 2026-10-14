/**
 * Late-issue attack cases. Offline facilitator, stub chain reads, temp replay
 * store, throwaway addresses. A refusal leaves 0 receipts, 0 ledger rows,
 * and 0 signer calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { clearChainReaderForTests } from '../src/x402-chain.js';
import { setActiveChallengeStore } from '../src/x402-durable-store.js';
import { encodeBase58, decodeBase58 } from '../src/payment-ref.js';
import { assertV11Allowlist, V11_SIGNED_FIELDS, v11Commit, V11_LABEL_OUTPUT } from '../src/v11-seal.js';
import logger from '../src/logger.js';
import {
  lateClaimSalt,
  listLateIssueOwnerView,
  resolveLateRecord,
} from '../src/late-issue.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const OTHER = `0x${'66'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OTHER_ASSET = `0x${'22'.repeat(20)}`;
const AUTH_NONCE = `0x${'cd'.repeat(32)}`;
const TX = `0x${'ab'.repeat(32)}`;
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MARKER = 'ZZ_MARK_9f3';

function pubkey(byte) {
  return encodeBase58(Buffer.alloc(32, byte));
}

const SOL_HOUSE = pubkey(3);
const SOL_PAYER = pubkey(4);
const SOL_FEE = pubkey(5);
const SOL_OTHER = pubkey(6);
const SOL_TX = encodeBase58(Buffer.alloc(64, 9));

function compiledMessage(feePayer, authority) {
  const fee = decodeBase58(feePayer);
  const auth = decodeBase58(authority);
  const sig = Buffer.alloc(64, 7);
  const msg = Buffer.concat([
    Buffer.from([2, 0, 0, 2]),
    fee,
    auth,
    Buffer.alloc(32, 8),
    Buffer.from([0]),
  ]);
  return Buffer.concat([Buffer.from([1]), sig, msg]).toString('base64');
}

function evmHeader({
  from = PAYER,
  to = HOUSE,
  value = '2000',
  nonce = AUTH_NONCE,
  network = 'base',
  note = null,
  validBefore = null,
} = {}) {
  const blob = {
    network,
    amount: value,
    payTo: to,
    note,
    payload: {
      authorization: {
        from,
        to,
        value,
        validAfter: '0',
        validBefore: validBefore || String(Math.floor(Date.now() / 1000) + 3600),
        nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(blob), 'utf8').toString('base64');
}

function solHeader({ payTo = SOL_HOUSE, amount = '2000', transaction } = {}) {
  const blob = {
    x402Version: 2,
    network: 'solana',
    accepted: {
      scheme: 'exact',
      network: 'solana',
      amount,
      payTo,
      asset: SOL_MINT,
      extra: { feePayer: SOL_FEE },
    },
    payload: { transaction: transaction || compiledMessage(SOL_FEE, SOL_PAYER) },
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

function listen(onSettle) {
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
        onSettle({ req, res, raw, hits });
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
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const result = handler(body.method, body.params);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
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
    chainReader: async () => ({ ok: false, pending: true }),
    ...over,
  };
}

function pay(store, cfg, nonce, header, reqOver = {}) {
  const req = {
    headers: { 'x-payment': header, ...(reqOver.headers || {}) },
    body: reqOver.body || { prompt: 'hello' },
    method: reqOver.method,
    path: reqOver.path,
  };
  return settleBoundPayment({
    req,
    taskId: 'task-late',
    amount: '2000',
    cfg,
    priceBody: req.body,
    paymentHeader: header,
    clientVersion: reqOver.clientVersion || 1,
    nonce,
    store,
    l1Anchor: reqOver.l1Anchor,
  });
}

function dropSettle(ctx) {
  ctx.req.socket.destroy();
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
    ...over,
  };
}

function reader(over = {}) {
  return async () => match(over);
}

test.beforeEach(() => {
  clearChainReaderForTests();
  setActiveChallengeStore(null);
  delete process.env.X402_LATE_ISSUE;
  delete process.env.X402_LATE_ISSUE_SHADOW;
});

test('LT1 Solana is not a late-issue network', async () => {
  const tx = compiledMessage(SOL_FEE, SOL_PAYER);
  assert.equal(decodeBase58(SOL_PAYER).length, 32);
  const fac = await listen(dropSettle);
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, {
      network: 'solana',
      payTo: SOL_HOUSE,
      asset: SOL_MINT,
      extra: { feePayer: SOL_FEE },
    });
    const cfg = baseCfg(fac.url, {
      solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
      chainReader: async () => ({ ok: false, pending: true }),
      lateSigner: () => { signs += 1; return 'jws.sol.no'; },
    });
    const pending = await pay(store, cfg, nonce, solHeader({ transaction: tx }), { clientVersion: 2 });
    assert.notEqual(pending.code, 'settle_pending');
    assert.equal(pending.receiptJws, undefined);
    assert.equal(fac.hits.settle, 1);
    assert.equal(store.listLate().length, 0);
    assert.equal(store.listLateLedger().length, 0);
    assert.equal(signs, 0);
    assert.equal(store.get(nonce)?.state, 'unknown');
  } finally {
    await fac.close();
  }
});

test('LT3 LT4 LT5 mismatches issue nothing', async () => {
  const cases = [
    { name: 'value minus one', over: { amount: '1999' } },
    { name: 'value plus one', over: { amount: '2001' } },
    { name: 'two transfers', over: { transferCount: 2 } },
    { name: 'other payee', over: { payTo: OTHER } },
    { name: 'sepolia', over: { network: 'base-sepolia' } },
    { name: 'other asset', over: { asset: OTHER_ASSET } },
  ];
  for (const item of cases) {
    const fac = await listen(dropSettle);
    let signs = 0;
    try {
      const store = new ChallengeStore();
      const nonce = putChallenge(store);
      const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true, chainReader: reader(item.over) });
      await pay(store, cfg, nonce, evmHeader());
      const resolved = await resolveLateRecord(store, store.listLate()[0], {
        cfg,
        signer: () => { signs += 1; return 'jws.no'; },
        appendLog: () => {},
        forcePaymentOnly: true,
      });
      assert.equal(resolved.state, 'mismatch_hold', item.name);
      assert.equal(signs, 0, item.name);
      assert.equal(store.listLateLedger().length, 0, item.name);
      const again = await resolveLateRecord(store, store.getLate(store.listLate()[0].pending_id), {
        cfg,
        signer: () => { signs += 1; return 'jws.no'; },
        appendLog: () => {},
        forcePaymentOnly: true,
      });
      assert.equal(again.state, 'mismatch_hold', item.name);
      assert.equal(signs, 0, item.name);
    } finally {
      await fac.close();
    }
  }
});

test('LT4 Solana payee and LT3 Solana amount do not open a late row', async () => {
  const tx = compiledMessage(SOL_FEE, SOL_PAYER);
  const fac = await listen(({ res }) => {
    res.statusCode = 500;
    res.end('nope');
  });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store, { network: 'solana', payTo: SOL_HOUSE, asset: SOL_MINT });
    const cfg = baseCfg(fac.url, {
      solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
      lateSigner: () => { signs += 1; return 'jws.no'; },
    });
    const decision = await pay(store, cfg, nonce, solHeader({ transaction: tx }), { clientVersion: 2 });
    assert.notEqual(decision.code, 'settle_pending');
    assert.equal(decision.receiptJws, undefined);
    assert.equal(store.listLate().length, 0);
    assert.equal(store.listLateLedger().length, 0);
    assert.equal(signs, 0);
    assert.equal(store.get(nonce)?.state, 'issued');
  } finally {
    await fac.close();
  }
});

test('LT6 only the matching authorization issues', async () => {
  const fac = await listen(dropSettle);
  const nonceA = `0x${'a1'.repeat(32)}`;
  const nonceB = `0x${'b2'.repeat(32)}`;
  const authA = `0x${'11'.repeat(32)}`;
  const authB = `0x${'22'.repeat(32)}`;
  let signs = 0;
  try {
    const store = new ChallengeStore();
    putChallenge(store, { nonce: nonceA });
    putChallenge(store, { nonce: nonceB });
    const cfg = baseCfg(fac.url, {
      lateForcePaymentOnly: true,
      chainReader: async ({ authorization }) => (
        authorization?.nonce === authA
          ? match({ tx: TX })
          : { ok: false, pending: true }
      ),
    });
    await pay(store, cfg, nonceA, evmHeader({ nonce: authA, from: PAYER }));
    await pay(store, cfg, nonceB, evmHeader({ nonce: authB, from: OTHER }));
    assert.equal(store.listLate().length, 2);
    for (const row of store.listLate()) {
      await resolveLateRecord(store, row, {
        cfg,
        signer: () => { signs += 1; return 'jws.one-payer'; },
        appendLog: () => {},
        forcePaymentOnly: true,
      });
    }
    const rows = store.listLate();
    const issued = rows.filter((row) => row.state === 'issued');
    const waiting = rows.filter((row) => row.state === 'unknown');
    assert.equal(issued.length, 1);
    assert.equal(waiting.length, 1);
    assert.equal(issued[0].auth.nonce, authA);
    assert.equal(signs, 1);
    assert.equal(store.listLateLedger().length, 1);
  } finally {
    await fac.close();
  }
});

test('LT7 a chain-used authorization is refused before verify', async () => {
  const fac = await listen(dropSettle);
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      authorizationState: async () => 'used',
    });
    const decision = await pay(store, cfg, nonce, evmHeader());
    assert.equal(decision.code, 'payment_replayed');
    assert.equal(decision.preSettle, true);
    assert.equal(fac.hits.verify, 0);
    assert.equal(fac.hits.settle, 0);
    assert.equal(store.listLate().length, 0);
    assert.equal(signs, 0);
    assert.equal(store.listLateLedger().length, 0);
  } finally {
    await fac.close();
  }
});

test('LT8 expiry windows', async () => {
  const fac = await listen(dropSettle);
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const soon = String(Math.floor(Date.now() / 1000) + 30);
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true });
    await pay(store, cfg, nonce, evmHeader({ validBefore: soon }));
    const row = store.listLate()[0];
    let signs = 0;
    const deps = (over, chainOver) => ({
      cfg: { ...cfg, chainReader: reader({ blockTimestamp: Math.floor(Date.now() / 1000) + 10, ...chainOver }) },
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
      forcePaymentOnly: true,
      ...over,
    });
    const late = await resolveLateRecord(store, row, deps({}, { blockTimestamp: Number(soon) + 5 }));
    assert.equal(late.state, 'mismatch_hold');
    assert.equal(signs, 0);

    const storeB = new ChallengeStore();
    const nonceB = putChallenge(storeB, { issuedAt: Date.now() });
    await pay(storeB, cfg, nonceB, evmHeader({ nonce: `0x${'31'.repeat(32)}` }));
    let gets = 0;
    const originalGet = storeB.get.bind(storeB);
    storeB.get = (...args) => { gets += 1; return originalGet(...args); };
    const early = await resolveLateRecord(storeB, storeB.listLate()[0], deps({}, {
      blockTimestamp: Math.floor(Date.now() / 1000) - 3600,
    }));
    assert.equal(early.state, 'mismatch_hold');
    assert.equal(gets, 0);
    assert.equal(signs, 0);

    const storeC = new ChallengeStore();
    const nonceC = putChallenge(storeC);
    const t0 = Date.now();
    const cfgC = baseCfg(fac.url, { now: () => t0, lateForcePaymentOnly: true });
    await pay(storeC, cfgC, nonceC, evmHeader({ nonce: `0x${'32'.repeat(32)}` }));
    const held = await resolveLateRecord(storeC, storeC.listLate()[0], {
      ...deps({ now: () => t0 + (24 * 60 * 60 * 1000) + 5, horizonMs: 24 * 60 * 60 * 1000 }),
    });
    assert.equal(held.state, 'expired_unresolved');
    assert.equal(storeC.listLateLedger().length, 0);
    assert.equal(listLateIssueOwnerView(storeC)[0].state, 'expired_unresolved');

    const storeD = new ChallengeStore();
    const nonceD = putChallenge(storeD);
    await pay(storeD, cfg, nonceD, evmHeader({ nonce: `0x${'33'.repeat(32)}` }));
    storeD.get(nonceD).expiresAt = Date.now() - 1000;
    let lateGets = 0;
    const getLate = storeD.get.bind(storeD);
    storeD.get = (...args) => { lateGets += 1; return getLate(...args); };
    const ok = await resolveLateRecord(storeD, storeD.listLate()[0], {
      cfg: { ...cfg, chainReader: reader() },
      signer: (claims) => { signs += 1; assertV11Allowlist(claims); return 'jws.ttl'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(ok.jws, 'jws.ttl');
    assert.equal(lateGets, 0);
    assert.equal(signs, 1);

    const storeE = new ChallengeStore();
    const nonceE = putChallenge(storeE);
    const validBefore = String(Math.floor(Date.now() / 1000) + 50);
    await pay(storeE, cfg, nonceE, evmHeader({ nonce: `0x${'34'.repeat(32)}`, validBefore }));
    const still = await resolveLateRecord(storeE, storeE.listLate()[0], {
      cfg: { ...cfg, chainReader: async () => ({ ok: false, pending: true, nonceUnused: true }) },
      now: () => Date.now(),
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
    });
    assert.equal(still.pending, true);
    assert.equal(storeE.listLate()[0].state, 'unknown');
    const unused = await resolveLateRecord(storeE, storeE.getLate(storeE.listLate()[0].pending_id), {
      cfg: { ...cfg, chainReader: async () => ({ ok: false, pending: true, nonceUnused: true }) },
      now: () => (Number(validBefore) + 5) * 1000,
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
    });
    assert.equal(unused.state, 'not_settled');
    assert.equal(signs, 1);
    assert.equal(storeE.listLateLedger().length, 0);
  } finally {
    await fac.close();
  }
});

test('LT9 a match that is not finalized is not signed', async () => {
  const fac = await listen(dropSettle);
  let tip = 5;
  const rpc = await rpcServer((method, params) => {
    assert.equal(method, 'eth_getBlockByNumber');
    const tag = params[0];
    if (tag === 'finalized') return { number: `0x${tip.toString(16)}`, timestamp: '0x1' };
    const ts = Math.floor(Date.now() / 1000) + 20;
    return { number: tag, timestamp: `0x${ts.toString(16)}` };
  });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      lateForcePaymentOnly: true,
      baseRpcUrl: rpc.url,
      chainReader: async () => match({ finalized: undefined, blockTimestamp: undefined, blockNumber: 10 }),
    });
    await pay(store, cfg, nonce, evmHeader());
    const first = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { signs += 1; return 'jws.early'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(first.jws, undefined);
    assert.equal(signs, 0);
    assert.equal(store.listLate()[0].state, 'unknown');
    tip = 10;
    const second = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { signs += 1; return 'jws.final'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(second.jws, 'jws.final');
    assert.equal(signs, 1);
    assert.equal(store.listLateLedger().length, 1);
  } finally {
    await fac.close();
    await rpc.close();
  }
});

test('LT11 the resolver reads the stored tuple through confirmSettlement', async () => {
  const fac = await listen(dropSettle);
  const seen = [];
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      lateForcePaymentOnly: true,
      chainReader: async (args) => {
        seen.push(args);
        return match();
      },
    });
    await pay(store, cfg, nonce, evmHeader({ value: '2000' }));
    const row = store.listLate()[0];
    assert.equal(row.expected_settled_amount, '2000');
    assert.equal(row.route_quote, '2000');
    await resolveLateRecord(store, row, {
      cfg,
      signer: (claims) => {
        assert.equal(claims.amount_gross, '2000');
        assert.equal(claims.amount_settled, '2000');
        return 'jws.bound';
      },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(seen.length >= 1, true);
    const call = seen.at(-1);
    assert.equal(call.paymentHeader, null);
    assert.equal(call.authorization.value, '2000');
    assert.equal(call.authorization.from.toLowerCase(), PAYER.toLowerCase());
    assert.equal(call.challenge.amount, '2000');
  } finally {
    await fac.close();
  }
});

test('LT12 a retry cannot change the tuple or call settle again', async () => {
  const fac = await listen(dropSettle);
  const other = await listen(({ res }) => {
    res.statusCode = 500;
    res.end('other facilitator');
  });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader();
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true, chainReader: reader() });
    await pay(store, cfg, nonce, header);
    const signed = [];
    const retryCfg = {
      ...cfg,
      gatewayUrl: other.url,
      facilitatorUrl: other.url,
      lateSigner: (claims) => { signed.push(claims); signs += 1; return 'jws.stable'; },
      lateAppendLog: () => {},
    };
    const mutated = await pay(
      store,
      retryCfg,
      nonce,
      evmHeader({ value: '9', to: OTHER, network: 'base-sepolia' }),
    );
    assert.equal(fac.hits.settle, 1);
    assert.equal(other.hits.settle, 0);
    assert.equal(mutated.receiptJws, undefined);
    assert.equal(signs, 0);
    const again = await pay(store, retryCfg, nonce, header);
    assert.equal(fac.hits.settle, 1);
    assert.equal(other.hits.settle, 0);
    assert.equal(again.receiptJws, 'jws.stable');
    assert.equal(signs, 1);
    assert.equal(signed[0].amount_gross, '2000');
    assert.equal(signed[0].amount_settled, '2000');
    assert.equal(signed[0].payer.toLowerCase(), PAYER.toLowerCase());
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg: retryCfg,
      signer: () => { signs += 1; return 'jws.other'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(resolved.jws, 'jws.stable');
    assert.equal(signs, 1);
  } finally {
    await fac.close();
    await other.close();
  }
});

test('LT13 the late payload is the current receipt signed once', async () => {
  const fac = await listen(dropSettle);
  const leaves = [];
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const body = { prompt: 'bound-body' };
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true, chainReader: reader() });
    const req = { method: 'POST', path: '/task-request', body, headers: { 'idempotency-key': 'idem-lt13' } };
    await pay(store, cfg, nonce, evmHeader({ note: MARKER }), req);
    const before = store.dumpState();
    let signs = 0;
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: (claims) => {
        signs += 1;
        assertV11Allowlist(claims);
        assert.deepEqual(Object.keys(claims).sort(), [...V11_SIGNED_FIELDS].sort());
        assert.equal(Object.hasOwn(claims, 'late'), false);
        assert.equal(Object.hasOwn(claims, 'pending_id'), false);
        assert.equal(claims.request_digest, store.listLate()[0].request_digest);
        assert.ok(claims.routing_commitment);
        const salt = lateClaimSalt(store.listLate()[0]);
        assert.equal(claims.output_commitment, v11Commit(salt, V11_LABEL_OUTPUT, Buffer.alloc(0)));
        return 'jws.v11.once';
      },
      appendLog: (_row, digest) => { leaves.push(digest); },
      forcePaymentOnly: true,
    });
    const again = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { signs += 1; return 'jws.other'; },
      appendLog: (_row, digest) => { leaves.push(digest); },
      forcePaymentOnly: true,
    });
    assert.equal(resolved.jws, 'jws.v11.once');
    assert.equal(again.jws, 'jws.v11.once');
    assert.equal(signs, 1);
    assert.equal(leaves.length, 1);
    assert.equal(store.listLateLedger().length, 1);
    assert.equal(JSON.stringify(before).includes(MARKER), false);
    assert.equal(JSON.stringify(store.dumpState()).includes(MARKER), false);
  } finally {
    await fac.close();
  }
});

test('LT14 an anchor failure never reaches settle', async () => {
  const fac = await listen(dropSettle);
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'ab'.repeat(32)}`;
    putChallenge(store, {
      nonce,
      issuance_bind: {
        required: true,
        chain_id: 8453,
        settlement_contract: USDC,
        content_hash: `0x${'aa'.repeat(32)}`,
        nonce,
      },
    });
    const cfg = baseCfg(fac.url);
    const decision = await pay(store, cfg, nonce, evmHeader({ nonce }), {
      l1Anchor: { timestamp: 0 },
    });
    assert.equal(decision.reason, 'dispute_window_anchor_failed');
    assert.equal(fac.hits.settle, 0);
    assert.equal(store.listLate().length, 0);
    assert.equal(store.listLateLedger().length, 0);
  } finally {
    await fac.close();
  }
});

test('LT16 fail closed', async () => {
  const fac = await listen(dropSettle);
  const rpcA = await rpcServer((method, params) => {
    const ts = params[0] === 'finalized' ? 1 : 100;
    const number = params[0] === 'finalized' ? '0x10' : params[0];
    return { number, timestamp: `0x${ts.toString(16)}` };
  });
  const rpcB = await rpcServer((method, params) => {
    const ts = params[0] === 'finalized' ? 1 : 200;
    const number = params[0] === 'finalized' ? '0x10' : params[0];
    return { number, timestamp: `0x${ts.toString(16)}` };
  });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true });
    await pay(store, cfg, nonce, evmHeader());
    const row = () => store.listLate()[0];
    let signs = 0;
    const signer = () => { signs += 1; return 'jws.no'; };
    const thrown = await resolveLateRecord(store, row(), {
      cfg: { ...cfg, chainReader: async () => { throw new Error('rpc down'); } },
      signer, appendLog: () => {}, forcePaymentOnly: true,
    });
    assert.equal(thrown.pending, true);
    assert.equal(row().state, 'unknown');
    const timeout = await resolveLateRecord(store, row(), {
      cfg: { ...cfg, chainReader: async () => ({ ok: false, pending: true }) },
      signer, appendLog: () => {}, forcePaymentOnly: true,
    });
    assert.equal(timeout.state, 'unknown');
    const disagree = await resolveLateRecord(store, row(), {
      cfg: {
        ...cfg,
        chainReader: reader({ amount: '2000' }),
        chainReader2: reader({ amount: '2001' }),
      },
      signer, appendLog: () => {}, forcePaymentOnly: true,
    });
    assert.equal(disagree.pending, true);
    assert.equal(row().state, 'unknown');
    const urls = await resolveLateRecord(store, row(), {
      cfg: {
        ...cfg,
        baseRpcUrl: rpcA.url,
        baseRpcUrl2: rpcB.url,
        chainReader: async () => match({ finalized: undefined, blockTimestamp: undefined, blockNumber: 10 }),
      },
      signer, appendLog: () => {}, forcePaymentOnly: true,
    });
    assert.equal(urls.pending, true);
    assert.equal(row().state, 'unknown');
    const kms = await resolveLateRecord(store, row(), {
      cfg: { ...cfg, chainReader: reader() },
      signer: () => { signs += 1; throw new Error('kms'); },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(kms.signerFailed, true);
    assert.equal(row().state, 'confirmed');
    assert.equal(row().jws, null);
    assert.equal(store.listLateLedger().length, 0);
    cfg.lateIssue = false;
    const off = await resolveLateRecord(store, row(), {
      cfg: { ...cfg, lateIssue: false, chainReader: reader() },
      signer, appendLog: () => {}, forcePaymentOnly: true,
    });
    assert.equal(off.state, 'confirmed');
    assert.equal(signs, 1);
    assert.equal(store.listLateLedger().length, 0);

    const bare = new ChallengeStore();
    const bareNonce = putChallenge(bare);
    bare.putLate = () => { throw new Error('store down'); };
    const down = await pay(bare, baseCfg(fac.url), bareNonce, evmHeader({ nonce: `0x${'51'.repeat(32)}` }));
    assert.equal(down.code, 'replay_store_unavailable');
    assert.equal(fac.hits.settle, 1);
    assert.equal(bare.listLate().length, 0);
  } finally {
    await fac.close();
    await rpcA.close();
    await rpcB.close();
  }
});

test('LT18 logs truncate wallets', async () => {
  const fac = await listen(dropSettle);
  const notes = [];
  const orig = logger.warn.bind(logger);
  logger.warn = (obj, msg) => {
    notes.push({ obj, msg });
    return orig(obj, msg);
  };
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true, chainReader: reader() });
    await pay(store, cfg, nonce, evmHeader({ note: MARKER }), { body: { prompt: MARKER } });
    await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { throw new Error('kms'); },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    const logged = notes.find((note) => note.msg === 'late-issue signer failed');
    assert.ok(logged);
    assert.equal(logged.obj.payer, `${PAYER.slice(0, 6)}…${PAYER.slice(-4)}`);
    assert.equal(String(logged.obj.payer).includes(PAYER.slice(6, 12)), false);
    assert.equal(JSON.stringify(store.dumpState()).includes(MARKER), false);
  } finally {
    logger.warn = orig;
    await fac.close();
  }
});

test('LT19 a finalized match is issued once and only to the same header', async () => {
  const fac = await listen(dropSettle);
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const header = evmHeader();
    const cfg = baseCfg(fac.url, {
      publicBaseUrl: 'https://api.chit402.com',
      chainReader: async () => ({ ok: false, pending: true }),
    });
    const pending = await pay(store, cfg, nonce, header);
    assert.equal(pending.code, 'settle_pending');
    assert.match(pending.verifyUrl, /\/receipt\/late-/);
    let signs = 0;
    cfg.chainReader = reader();
    cfg.lateSigner = (claims) => {
      signs += 1;
      const salt = lateClaimSalt(store.listLate()[0]);
      assert.equal(claims.output_commitment, v11Commit(salt, V11_LABEL_OUTPUT, Buffer.alloc(0)));
      return 'jws.payment-only';
    };
    cfg.lateAppendLog = () => {};
    const garbage = await pay(store, cfg, nonce, 'not-a-payment');
    assert.equal(garbage.receiptJws, undefined);
    assert.equal(signs, 0);
    const nonceOnly = await pay(store, cfg, nonce, nonce);
    assert.equal(nonceOnly.receiptJws, undefined);
    assert.equal(signs, 0);
    const otherNonce = `0x${'22'.repeat(32)}`;
    putChallenge(store, { nonce: otherNonce });
    const swapped = await pay(store, cfg, otherNonce, evmHeader({ nonce: `0x${'62'.repeat(32)}` }), {
      headers: { 'x-pending-id': pending.pendingId },
    });
    assert.equal(swapped.receiptJws, undefined);
    assert.equal(signs, 0);
    const issued = await pay(store, cfg, nonce, header);
    assert.equal(issued.receiptJws, 'jws.payment-only');
    assert.equal(issued.served, false);
    assert.equal(signs, 1);
    assert.equal(store.listLate()[0].served, false);
    assert.match(issued.verifyUrl, /\/receipt\/late-/);
    assert.match(listLateIssueOwnerView(store).find((row) => row.pending_id === pending.pendingId).note, /not served/);
    const repeat = await pay(store, cfg, nonce, header);
    assert.equal(repeat.receiptJws, 'jws.payment-only');
    assert.equal(signs, 1);
  } finally {
    await fac.close();
  }
});

test('shadow mode logs the decision and does not sign', async () => {
  const fac = await listen(dropSettle);
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateIssue: false, lateIssueShadow: true, chainReader: reader() });
    await pay(store, cfg, nonce, evmHeader());
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: () => { signs += 1; return 'jws.shadow'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(signs, 0);
    assert.equal(resolved.state, 'confirmed');
    assert.equal(store.listLateLedger().length, 0);
    assert.equal(listLateIssueOwnerView(store).length, 1);
  } finally {
    await fac.close();
  }
});
