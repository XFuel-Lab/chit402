/**
 * Late-issue receipts. Offline facilitator, stub chain reader, temp replay store.
 * Qualifying settle failures stay unknown and are not released. A restart
 * mid-resolve publishes the persisted signature once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment } from '../src/x402-settle.js';
import { DurableChallengeStore, setActiveChallengeStore } from '../src/x402-durable-store.js';
import { clearChainReaderForTests } from '../src/x402-chain.js';
import { assertV11Allowlist, V11_SIGNED_FIELDS } from '../src/v11-seal.js';
import {
  casLateRefund,
  listLateIssueOwnerView,
  noteIneligibleLanding,
  resolveLateRecord,
} from '../src/late-issue.js';

const HOUSE = `0x${'11'.repeat(20)}`;
const PAYER = `0x${'55'.repeat(20)}`;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AUTH_NONCE = `0x${'cd'.repeat(32)}`;
const TX = `0x${'ab'.repeat(32)}`;
const MARKER = 'ZZ_MARK_9f3';

function evmHeader({
  from = PAYER,
  to = HOUSE,
  value = '2000',
  nonce = AUTH_NONCE,
  network = 'base',
  note = null,
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
    chainReader: async () => ({ ok: false, pending: true, code: 'settle_unconfirmed' }),
    ...over,
  };
}

function pay(store, cfg, nonce, header, body = { prompt: 'hello' }) {
  return settleBoundPayment({
    req: { headers: { 'x-payment': header }, body },
    taskId: 'task-late',
    amount: '2000',
    cfg,
    priceBody: body,
    paymentHeader: header,
    clientVersion: 1,
    nonce,
    store,
  });
}

test.beforeEach(() => {
  clearChainReaderForTests();
  setActiveChallengeStore(null);
  delete process.env.X402_LATE_ISSUE;
  delete process.env.X402_LATE_ISSUE_SHADOW;
});

test('qualifying settle failures stay unknown and are not released', async () => {
  const cases = [
    {
      name: 'transport error',
      onSettle({ req }) { req.socket.destroy(); },
    },
    {
      name: 'non-2xx',
      onSettle({ res }) {
        res.statusCode = 500;
        res.end('nope');
      },
    },
    {
      name: 'success:false',
      onSettle({ res }) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ settled: false, success: false, reason: 'nope' }));
      },
    },
    {
      name: 'missing tx',
      onSettle({ res }) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          settled: true, success: true, network: 'base', payer: PAYER,
        }));
      },
    },
    {
      name: 'local failure after settle',
      onSettle({ res }) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          settled: true, success: true, txRef: TX, transaction: TX, network: 'base-sepolia', payer: PAYER,
        }));
      },
    },
  ];

  for (const item of cases) {
    const seen = [];
    const fac = await listen((ctx) => {
      seen.push(ctx);
      item.onSettle(ctx);
    });
    try {
      const store = new ChallengeStore();
      const nonce = putChallenge(store);
      const cfg = baseCfg(fac.url, {
        chainReader: async () => {
          const err = new Error('reader blew up after settle');
          throw err;
        },
      });
      const header = evmHeader({ note: MARKER });
      const first = await pay(store, cfg, nonce, header, { prompt: MARKER });
      assert.equal(first.code, 'settle_pending', item.name);
      assert.equal(first.kind, 'failed', item.name);
      assert.ok(first.pendingId, item.name);
      assert.match(first.verifyUrl, new RegExp(`/receipt/late-${first.pendingId}$`), item.name);
      assert.equal(first.paymentRef, undefined, item.name);
      assert.equal(fac.hits.settle, 1, item.name);
      assert.equal(seen.length, 1, item.name);
      const during = store.listLate();
      assert.equal(during.length, 1, item.name);
      assert.equal(during[0].state, 'unknown', item.name);
      assert.equal(during[0].sent, true, item.name);
      assert.equal(store.get(nonce)?.state, 'unknown', item.name);
      assert.equal(JSON.stringify(store.dumpState()).includes(MARKER), false, item.name);

      const again = await pay(store, cfg, nonce, header);
      assert.equal(again.code, 'settle_pending', item.name);
      assert.equal(fac.hits.settle, 1, `${item.name} retry must not settle again`);
      assert.equal(store.listLateLedger().length, 0, item.name);
      const view = listLateIssueOwnerView(store);
      assert.equal(view.length, 1, item.name);
      assert.equal(view[0].pending_id, first.pendingId, item.name);
      assert.equal(view[0].payer.includes(PAYER), false, item.name);
    } finally {
      await fac.close();
    }
  }
});

test('a thrown chain read after a successful settle stays unknown', async () => {
  const fac = await listen(({ res }) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      settled: true, success: true, txRef: TX, transaction: TX, network: 'base', payer: PAYER,
    }));
  });
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      chainReader: async () => { throw new Error('local confirm failed'); },
    });
    const header = evmHeader();
    const decision = await pay(store, cfg, nonce, header);
    assert.equal(decision.code, 'settle_pending');
    assert.equal(store.listLate()[0].state, 'unknown');
    assert.notEqual(store.get(nonce)?.state, 'issued');
    const again = await pay(store, cfg, nonce, header);
    assert.equal(again.code, 'settle_pending');
    assert.equal(fac.hits.settle, 1);
  } finally {
    await fac.close();
  }
});

function finalizedReader(over = {}) {
  return async () => ({
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
  });
}

test('transport failure then a finalized match issues one receipt', async () => {
  let phase = 'down';
  const fac = await listen(({ req, res }) => {
    if (phase === 'down') {
      req.socket.destroy();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      settled: true, success: true, txRef: TX, transaction: TX, network: 'base', payer: PAYER,
    }));
  });
  const signs = [];
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      lateForcePaymentOnly: true,
      lateSigner: (claims) => {
        signs.push(claims);
        assertV11Allowlist(claims);
        assert.deepEqual(Object.keys(claims).sort(), [...V11_SIGNED_FIELDS].sort());
        return 'jws.late.one';
      },
      lateAppendLog: () => {},
      chainReader: async () => ({ ok: false, pending: true }),
    });
    const header = evmHeader();
    const pending = await pay(store, cfg, nonce, header);
    assert.equal(pending.code, 'settle_pending');
    assert.equal(fac.hits.settle, 1);
    cfg.chainReader = finalizedReader();
    const issued = await pay(store, cfg, nonce, header);
    assert.equal(fac.hits.settle, 1);
    assert.equal(signs.length, 1);
    assert.equal(signs[0].amount_gross, '2000');
    assert.equal(signs[0].amount_settled, '2000');
    assert.equal(signs[0].payer.toLowerCase(), PAYER.toLowerCase());
    assert.equal(signs[0].payment_tx, TX);
    assert.ok(signs[0].routing_commitment);
    assert.equal(store.listLate()[0].state, 'issued');
    assert.equal(store.listLate()[0].jws, 'jws.late.one');
    assert.equal(store.listLateLedger().length, 1);
    assert.equal(issued.receiptJws, 'jws.late.one');
    const again = await resolveLateRecord(store, store.listLate()[0], {
      cfg,
      signer: cfg.lateSigner,
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(again.jws, 'jws.late.one');
    assert.equal(signs.length, 1);
  } finally {
    await fac.close();
  }
});

test('restart mid-resolve publishes the persisted signature once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'late-issue-'));
  const file = path.join(dir, 'replay.json');
  const store = new DurableChallengeStore(file);
  const nonce = putChallenge(store);
  let signs = 0;
  const signer = () => {
    signs += 1;
    return 'jws.persisted.bytes';
  };
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  try {
    const cfg = baseCfg(fac.url, {
      lateIssue: true,
      lateForcePaymentOnly: true,
      lateSigner: signer,
      lateAppendLog: () => {},
      chainReader: async () => ({ ok: false, pending: true }),
    });
    const pending = await pay(store, cfg, nonce, evmHeader({ note: MARKER }), { prompt: MARKER });
    assert.equal(pending.code, 'settle_pending');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes(MARKER), false);
    assert.equal(text.includes('submitted') || text.includes('unknown'), true);

    cfg.chainReader = finalizedReader();
    const row = store.listLate()[0];
    await assert.rejects(
      () => resolveLateRecord(store, row, {
        cfg,
        signer,
        appendLog: () => {},
        forcePaymentOnly: true,
        crashBeforeLedger: true,
      }),
      (err) => err.code === 'injected_crash',
    );
    assert.equal(signs, 1);
    assert.equal(store.listLateLedger().length, 0);

    const restarted = new DurableChallengeStore(file);
    const kept = restarted.listLate()[0];
    assert.equal(kept.jws, 'jws.persisted.bytes');
    assert.equal(kept.state, 'issuing');
    const published = await resolveLateRecord(restarted, kept, {
      cfg,
      signer: () => { signs += 1; return 'jws.other'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(published.jws, 'jws.persisted.bytes');
    assert.equal(signs, 1);
    assert.equal(restarted.listLateLedger().length, 1);
    assert.equal(restarted.listLate()[0].state, 'issued');
    const owner = listLateIssueOwnerView(restarted);
    assert.equal(owner.length, 1);
    assert.match(owner[0].note, /not served/);
  } finally {
    await fac.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('kill switch leaves the row unissued', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateIssue: false });
    const decision = await pay(store, cfg, nonce, evmHeader());
    assert.notEqual(decision.code, 'settle_pending');
    assert.equal(store.listLate()[0].state, 'unknown');
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { ...cfg, chainReader: finalizedReader() },
      signer: () => { signs += 1; return 'nope'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(signs, 0);
    assert.equal(resolved.jws, undefined);
    assert.equal(store.listLate()[0].state, 'confirmed');
    assert.equal(store.listLateLedger().length, 0);
  } finally {
    await fac.close();
  }
});

test('amount mismatch is a terminal hold with no receipt', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateIssue: true, lateForcePaymentOnly: true });
    await pay(store, cfg, nonce, evmHeader());
    const resolved = await resolveLateRecord(store, store.listLate()[0], {
      cfg: { ...cfg, chainReader: finalizedReader({ amount: '1999' }) },
      signer: () => { signs += 1; return 'jws.no'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(resolved.state, 'mismatch_hold');
    assert.equal(signs, 0);
    assert.equal(store.listLateLedger().length, 0);
    assert.equal(listLateIssueOwnerView(store)[0].state, 'mismatch_hold');
  } finally {
    await fac.close();
  }
});

test('two resolvers sign once', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, {
      lateForcePaymentOnly: true,
      chainReader: finalizedReader(),
    });
    await pay(store, cfg, nonce, evmHeader());
    const row = store.listLate()[0];
    const signer = () => {
      signs += 1;
      return 'jws.same';
    };
    const deps = { cfg, signer, appendLog: () => {}, forcePaymentOnly: true };
    const [a, b] = await Promise.all([
      resolveLateRecord(store, row, deps),
      resolveLateRecord(store, row, deps),
    ]);
    assert.equal(a.jws, 'jws.same');
    assert.equal(b.jws, 'jws.same');
    assert.equal(signs, 1);
    assert.equal(store.listLateLedger().length, 1);
  } finally {
    await fac.close();
  }
});

test('a used authorization is refused before verify and writes no second row', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  try {
    const store = new ChallengeStore();
    const firstNonce = putChallenge(store, { nonce: `0x${'11'.repeat(32)}` });
    const cfg = baseCfg(fac.url);
    await pay(store, cfg, firstNonce, evmHeader());
    assert.equal(store.listLate().length, 1);
    const secondNonce = putChallenge(store, { nonce: `0x${'22'.repeat(32)}` });
    const replay = await pay(store, cfg, secondNonce, evmHeader());
    assert.equal(replay.code, 'payment_replayed');
    assert.equal(replay.preSettle, true);
    assert.equal(store.listLate().length, 1);
    assert.equal(fac.hits.verify, 1);
  } finally {
    await fac.close();
  }
});

test('refund and late-issue cannot both win', async () => {
  const fac = await listen(({ req }) => { req.socket.destroy(); });
  let signs = 0;
  try {
    const store = new ChallengeStore();
    const nonce = putChallenge(store);
    const cfg = baseCfg(fac.url, { lateForcePaymentOnly: true, chainReader: finalizedReader() });
    await pay(store, cfg, nonce, evmHeader());
    const row = store.listLate()[0];
    store.casLate(row.pending_id, 'unknown', 'confirmed', { confirmed_at: Date.now(), why: 'confirmed' });
    const refund = casLateRefund(store, { nonce });
    assert.equal(refund.ok, true);
    const resolved = await resolveLateRecord(store, store.getLate(row.pending_id), {
      cfg,
      signer: () => { signs += 1; return 'jws.refund'; },
      appendLog: () => {},
      forcePaymentOnly: true,
    });
    assert.equal(signs, 0);
    assert.equal(resolved.state, 'refund_owed');
    const late = casLateRefund(store, { nonce });
    assert.equal(late.ok, false);
    assert.equal(late.reason, 'refund_conflict');
  } finally {
    await fac.close();
  }
});

test('an ineligible landing is an owner alert and is not issued', async () => {
  const store = new ChallengeStore();
  const noted = noteIneligibleLanding(store, { why: 'verify_failed', network: 'base', taskId: 'task-late' });
  assert.equal(noted.ok, true);
  let signs = 0;
  const resolved = await resolveLateRecord(store, store.listLate()[0], {
    cfg: { lateIssue: true, chainReader: finalizedReader() },
    signer: () => { signs += 1; return 'jws.no'; },
    forcePaymentOnly: true,
  });
  assert.equal(signs, 0);
  assert.equal(resolved.state, 'ineligible_alert');
  const view = listLateIssueOwnerView(store);
  assert.equal(view.length, 1);
  assert.match(view[0].note, /no auto-issue/);
});

test('the record is durable before the settle response returns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'late-before-'));
  const file = path.join(dir, 'replay.json');
  const store = new DurableChallengeStore(file);
  const nonce = putChallenge(store);
  let during = null;
  const fac = await listen(({ req }) => {
    during = fs.readFileSync(file, 'utf8');
    req.socket.destroy();
  });
  try {
    const cfg = baseCfg(fac.url);
    const decision = await pay(store, cfg, nonce, evmHeader({ note: MARKER }), { prompt: MARKER });
    assert.equal(decision.code, 'settle_pending');
    assert.match(during, /"state":"submitted"/);
    assert.equal(during.includes(MARKER), false);
    assert.equal(crypto.createHash('sha256').update(during).digest('hex').length, 64);
  } finally {
    await fac.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
