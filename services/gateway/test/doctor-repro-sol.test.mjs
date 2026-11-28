/**
 * Solana finality retry. Offline facilitator. No production host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChallengeStore } from '../src/x402-adapter.js';
import { settleBoundPayment, sweepSolanaHolds } from '../src/x402-settle.js';
import { clearChainReaderForTests } from '../src/x402-chain.js';
import { encodeBase58, decodeBase58 } from '../src/payment-ref.js';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function pubkey(byte) {
  return encodeBase58(Buffer.alloc(32, byte));
}

const SOL_HOUSE = pubkey(3);
const SOL_PAYER = pubkey(4);
const SOL_FEE = pubkey(5);

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

function listen() {
  const hits = { settle: 0, verify: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = req.url || '';
      if (url.endsWith('/verify')) {
        hits.verify += 1;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ valid: true, isValid: true }));
        return;
      }
      if (url.endsWith('/settle')) {
        hits.settle += 1;
        req.socket.destroy();
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

test.beforeEach(() => {
  clearChainReaderForTests();
});

test('DOC-R3 a same-header Solana retry after a finality hold re-reads the chain', async () => {
  const tx = compiledMessage(SOL_FEE, SOL_PAYER);
  const fac = await listen();
  let reads = 0;
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'ab'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-late',
      amount: '2000',
      asset: SOL_MINT,
      network: 'solana',
      payTo: SOL_HOUSE,
      resource: '/task-request',
      state: 'issued',
      expiresAt: Date.now() + 60_000,
      extra: { feePayer: SOL_FEE },
      nonce,
    });
    let finalNow = false;
    const cfg = {
      network: 'solana',
      payTo: SOL_HOUSE,
      facilitatorProvider: 'zan',
      gatewayUrl: fac.url,
      apiKey: 'k',
      asset: USDC,
      allowUnboundPayments: false,
      lateIssue: true,
      solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
      chainReader: async () => {
        reads += 1;
        if (!finalNow) return { ok: false, pending: true };
        return {
          ok: true,
          confirmed: true,
          finalized: true,
          amount: '2000',
          payer: SOL_PAYER,
          payTo: SOL_HOUSE,
          tx: 'sig-final',
        };
      },
    };
    const header = solHeader({ transaction: tx });
    const pay = (hdr) => settleBoundPayment({
      req: { headers: { 'x-payment': hdr }, body: { prompt: 'hello' }, path: '/v1/chat/completions' },
      taskId: 'task-late',
      amount: '2000',
      cfg,
      priceBody: { prompt: 'hello' },
      paymentHeader: hdr,
      clientVersion: 2,
      nonce,
      store,
    });
    const first = await pay(header);
    assert.equal(first.code, 'settle_pending');
    const readsAfterFirst = reads;
    const outs = [];
    for (let i = 0; i < 3; i += 1) outs.push(await pay(header));
    assert.ok(reads - readsAfterFirst > 0, 'retry never re-polls finality');
    assert.equal(outs[0].code, 'settle_pending');
    assert.equal(outs[0].pendingId, first.pendingId);
    assert.equal(fac.hits.settle, 1);
    const other = await pay(solHeader({ transaction: compiledMessage(SOL_FEE, SOL_FEE) }));
    assert.equal(other.pendingId || null, null);
    finalNow = true;
    const won = await pay(header);
    assert.equal(won.kind, 'settled', won.code);
    assert.notEqual(won.idempotentReplay, true);
    assert.equal(won.paymentRef, 'sig-final');
    const later = [];
    for (let i = 0; i < 3; i += 1) later.push(await pay(header));
    const raced = await Promise.all([pay(header), pay(header)]);
    const fresh = [won, ...later, ...raced].filter((row) => row.kind === 'settled' && row.idempotentReplay !== true);
    assert.equal(fresh.length, 1);
    for (const row of [...later, ...raced]) {
      assert.equal(row.idempotentReplay, true, row.code);
      assert.equal(row.paymentRef, 'sig-final');
    }
    assert.equal(fac.hits.settle, 1);
  } finally {
    await fac.close();
  }
});

test('DOC-R3 sweep a Solana hold with no retry shows the receipt', async () => {
  const fac = await listen();
  let finalNow = false;
  try {
    const store = new ChallengeStore();
    const nonce = `0x${'cd'.repeat(32)}`;
    store.put(nonce, {
      taskId: 'task-late',
      amount: '2000',
      asset: SOL_MINT,
      network: 'solana',
      payTo: SOL_HOUSE,
      resource: '/task-request',
      state: 'issued',
      expiresAt: Date.now() + 60_000,
      extra: { feePayer: SOL_FEE },
      nonce,
    });
    const cfg = {
      network: 'solana',
      payTo: SOL_HOUSE,
      facilitatorProvider: 'zan',
      gatewayUrl: fac.url,
      apiKey: 'k',
      asset: USDC,
      allowUnboundPayments: false,
      solana: { enabled: true, network: 'solana', payTo: SOL_HOUSE, facilitatorUrl: fac.url },
      chainReader: async () => (finalNow
        ? { ok: true, confirmed: true, finalized: true, amount: '2000', payer: SOL_PAYER, payTo: SOL_HOUSE, tx: 'sig' }
        : { ok: false, pending: true }),
    };
    const header = solHeader();
    const first = await settleBoundPayment({
      req: { headers: { 'x-payment': header }, body: { prompt: 'hello' }, path: '/v1/chat/completions' },
      taskId: 'task-late',
      amount: '2000',
      cfg,
      priceBody: { prompt: 'hello' },
      paymentHeader: header,
      clientVersion: 2,
      nonce,
      store,
    });
    assert.equal(first.code, 'settle_pending');
    finalNow = true;
    const swept = await sweepSolanaHolds(store, cfg);
    assert.equal(swept.length, 1);
    assert.equal(swept[0].pending_id, first.pendingId);
    assert.equal(swept[0].state, 'final');
  } finally {
    await fac.close();
  }
});
