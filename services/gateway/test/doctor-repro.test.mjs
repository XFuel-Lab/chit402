/**
 * Finality-aware issuance. Offline. Lagging finalized head. No production host.
 * FA1–FA17.
 */
import { createHash, createPublicKey } from 'node:crypto';
import http from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { bytesToBig } from '../../../packages/cs2-core/ecdsa/bytes.js';
import { ethereumAddress, SECP256K1 } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { openStore } from '../../chit-store/store.js';
import { readIntakeLeaves } from '../../chit-store/intake.js';
import { acceptCoreLine } from '../../chit-sealer/lines.js';
import { paidFulfillmentRuns, clearReplayMemory, setReplayLimitsForTests } from '../src/paid-response-replay.js';
import { MAINNET_ANCHOR, MAINNET_CHECKPOINT } from '../../chit-sealer/mainnet-pin.js';
import { guardKmsClient } from '../../chit-sealer/anchor-mainnet.js';
import { createCheckpointSigner } from '../../chit-sealer/kms-secp256k1.js';
import { startLagRpc, routeLagFetch } from '../../chit-sealer/test/helpers/lag-rpc.mjs';
import { anchorStallStatus, startV13AnchorScheduler, stopV13AnchorScheduler } from '../src/v13-anchor-scheduler.js';
import {
  houseIssueCallsForTest,
  issueHouseReceipt,
  resetHouseState,
  setV13Runtime,
} from '../src/v13-issue.js';
import { wireV13Runtime } from '../src/v13-boot.js';
import { publicHealthBody } from '../src/public-metrics.js';
import { clearChainReaderForTests } from '../src/x402-chain.js';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const USDC = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const PAYER = ethers.getAddress(`0x${'5b'.repeat(20)}`);
const PAY_TO = ethers.getAddress('0x8453000000000000000000000000000000000001');
const AMOUNT = '5000000';
const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const AUTH_USED = ethers.id('AuthorizationUsed(address,bytes32)');
const PAD = (addr) => ethers.zeroPadValue(addr, 32);
const CAP = '100000000000';
const PRIMARY = 'http://primary.example.test/rpc';
const SECONDARY = 'http://secondary.example.org/rpc';

function flagsOn(extra = {}) {
  return {
    CHIT_V13_ISSUANCE: 'true',
    CHIT_V13_MAINNET_SEALER: 'true',
    CHIT_V13_STORE: 'true',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: CAP,
    CHIT_SEALER_CLOSE_MARGIN_SEC: '0',
    CHIT_SEALER_STUCK_MS: '600000',
    ...extra,
  };
}

function withFlags(extra, fn) {
  const env = flagsOn(extra);
  const prev = {};
  for (const name of Object.keys(env)) prev[name] = process.env[name];
  Object.assign(process.env, env);
  return Promise.resolve(fn()).finally(() => {
    for (const name of Object.keys(env)) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
    setV13Runtime(null);
  });
}

function mockKms() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command?.name);
      if (command?.name === 'GetPublicKey') {
        const jwk = {
          kty: 'EC',
          crv: 'secp256k1',
          x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
          y: Buffer.from(pub.subarray(33)).toString('base64url'),
        };
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }),
        };
      }
      const digest = new Uint8Array(command.input.Message);
      let k = (bytesToBig(digest) % (SECP256K1.order - 3n)) + 2n;
      let sig;
      for (let i = 0; i < 8; i += 1) {
        try {
          sig = signRawDigest(digest, d, k, SECP256K1);
          break;
        } catch (err) {
          if (err.code !== 'bad_nonce') throw err;
          k += 1n;
        }
      }
      return { Signature: sig.der };
    },
  };
}

function freshBox() {
  const dir = mkdtempSync(join(tmpdir(), 'fa-house-'));
  const book = {
    id: 'aa'.repeat(32),
    token: 'test-house-token-1',
    bookPk: new Uint8Array(32).fill(7),
    wallets: [PAYER],
  };
  const store = openStore(join(dir, 'store'), { books: [book] });
  const bind = join(dir, 'bind');
  mkdirSync(bind, { recursive: true, mode: 0o700 });
  const secret = join(dir, 'secret');
  mkdirSync(secret, { mode: 0o700 });
  chmodSync(secret, 0o700);
  const file = join(secret, 'book.json');
  writeFileSync(file, JSON.stringify({
    v: 1,
    bookId: book.id,
    token: book.token,
    bookPk: Buffer.from(book.bookPk).toString('hex'),
  }), { mode: 0o600 });
  chmodSync(file, 0o600);
  chmodSync(store.dir, 0o700);
  return { root: dir, store, bind, book, file, caller: { bookId: book.id, token: book.token } };
}

function receiptFor(tx, nonce, blockNumber) {
  return {
    txHash: tx,
    transactionIndex: '0x4',
    blockNumber,
    from: PAYER,
    status: '0x1',
    logs: [
      {
        address: USDC,
        topics: [TRANSFER, PAD(PAYER), PAD(PAY_TO)],
        data: ethers.toBeHex(BigInt(AMOUNT), 32),
        logIndex: '0x0',
      },
      {
        address: USDC,
        topics: [AUTH_USED, PAD(PAYER), PAD(nonce)],
        data: '0x',
        logIndex: '0x1',
      },
    ],
  };
}

function paymentHeader(label) {
  const nonce = `0x${createHash('sha256').update(label).digest('hex')}`;
  const body = {
    x402Version: 1,
    network: 'base',
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: AMOUNT,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce,
      },
    },
    accepted: { asset: USDC },
  };
  return { header: Buffer.from(JSON.stringify(body)).toString('base64'), nonce };
}

async function bootGateway(box) {
  const lag = await startLagRpc({ lag: 450, latest: 1000, salt: 'fa' });
  const { default: config } = await import('../src/config.js');
  const express = (await import('express')).default;
  const { registerOpenAIRoutes } = await import('../src/openai-gateway.js');
  const prev = { ...config.x402 };
  config.x402.enabled = true;
  config.x402.meterV1 = true;
  config.x402.network = 'base';
  config.x402.payTo = PAY_TO;
  config.x402.asset = USDC;
  config.x402.facilitatorProvider = 'zan';
  config.x402.baseRpcUrl = lag.url;
  config.x402.apiKey = 'testkey';
  let settles = 0;
  const fac = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
        let auth = {};
        if (typeof body.payment === 'string') {
          try { auth = JSON.parse(Buffer.from(body.payment, 'base64').toString('utf8')).payload?.authorization || {}; } catch { auth = {}; }
        }
        const nonce = auth.nonce || `0x${'ab'.repeat(32)}`;
        const tx = `0x${createHash('sha256').update(`tx:${nonce}`).digest('hex')}`;
        if (String(req.url || '').endsWith('/settle')) settles += 1;
        if (!String(req.url || '').endsWith('/verify')) {
          lag.putReceipt(receiptFor(tx, nonce, lag.latest));
        }
        const payload = String(req.url || '').endsWith('/verify')
          ? { isValid: true, valid: true, payer: PAYER }
          : { success: true, settled: true, transaction: tx, txRef: tx, network: 'base', payer: PAYER };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
  config.x402.gatewayUrl = fac.url;
  clearChainReaderForTests();
  await wireV13Runtime({
    ...flagsOn(),
    CHIT_V13_STORE_PATH: box.store.dir,
    CHIT_V13_BIND_DIR: box.bind,
    CHIT_V13_HOUSE_BOOK_ID: box.book.id,
    CHIT_V13_HOUSE_TOKEN_FILE: box.file,
  }, {
    testInjection: true,
    addressOf: () => MAINNET_CHECKPOINT,
    client: mockKms(),
    openStore: () => box.store,
  });
  const app = express();
  app.use(express.json());
  registerOpenAIRoutes(app, {
    rateLimit: (_req, _res, next) => next(),
    authenticate: (_req, _res, next) => next(),
    isAuthorised: () => false,
  });
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    lag,
    fac,
    config,
    prev,
    settles: () => settles,
    async close() {
      setV13Runtime(null);
      clearChainReaderForTests();
      Object.assign(config.x402, prev);
      await new Promise((resolve) => server.close(resolve));
      await fac.close();
      await lag.close();
      rmSync(box.root, { recursive: true, force: true });
    },
  };
}

async function pay(base, label) {
  const chat = { model: 'theta/qwen3', messages: [{ role: 'user', content: 'finality' }], max_tokens: 8 };
  const challenge = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chat),
  });
  const offered = await challenge.json();
  const nonce = offered.accepts?.[0]?.extra?.nonce;
  const paid = paymentHeader(label);
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': paid.header,
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(chat),
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body, text, headers: res.headers, offered, challengeStatus: challenge.status, paid };
}


async function replayOnce(gate, first) {
  const nonce = first.offered.accepts?.[0]?.extra?.nonce;
  const chat = { model: 'theta/qwen3', messages: [{ role: 'user', content: 'finality' }], max_tokens: 8 };
  const started = Date.now();
  const res = await fetch(`${gate.base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': first.paid.header,
      'x-payment-nonce': nonce,
    },
    body: JSON.stringify(chat),
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 80) }; }
  return { status: res.status, ms: Date.now() - started, code: body.code || body.error?.code, body, text };
}

test('DOC-R1a in-process replay of a 202 returns pending_anchor without waiting out the waiter', async () => {
  resetHouseState();
  setReplayLimitsForTests({ waiterMs: 800 });
  const box = freshBox();
  const gate = await bootGateway(box);
  try {
    await withFlags({}, async () => {
      const first = await pay(gate.base, 'docr1a');
      assert.equal(first.status, 202, JSON.stringify(first.body));
      const again = await replayOnce(gate, first);
      assert.equal(again.code, 'pending_anchor');
      assert.ok(again.ms < 2000, `replay took ${again.ms}ms`);
      assert.equal(again.body.pending_id, first.body.pending_id);
    });
  } finally {
    setReplayLimitsForTests(null);
    await gate.close();
  }
});

test('DOC-R1b after replay memory is gone a replay does not re-run paid inference', async () => {
  resetHouseState();
  const box = freshBox();
  const gate = await bootGateway(box);
  try {
    await withFlags({}, async () => {
      const first = await pay(gate.base, 'docr1b');
      assert.equal(first.status, 202, JSON.stringify(first.body));
      clearReplayMemory();
      const runs0 = paidFulfillmentRuns();
      const out = [];
      for (let i = 0; i < 3; i += 1) out.push(await replayOnce(gate, first));
      assert.equal(paidFulfillmentRuns() - runs0, 0, 'replay re-ran paid inference');
      assert.equal(out.every((row) => !String(row.text).includes('xfuel.receipt.v4')), true);
      assert.equal(gate.settles(), 1);
    });
  } finally {
    await gate.close();
  }
});

test('DOC-R2 a booked line does not carry a salt derived from the public nonce', async () => {
  resetHouseState();
  const box = freshBox();
  const gate = await bootGateway(box);
  try {
    await withFlags({}, async () => {
      const out = await pay(gate.base, 'docr2');
      assert.equal(out.status, 202, JSON.stringify(out.body));
      const leaves = readIntakeLeaves(box.store.dir).leaves;
      assert.equal(leaves.length, 1);
      const acc = acceptCoreLine(Uint8Array.from(Buffer.from(leaves[0].line, 'hex')));
      assert.equal(acc.ok, true, acc.reason);
      const salt = Buffer.from(acc.payment.saltP).toString('hex');
      const fromNonce = createHash('sha256').update(String(out.paid.nonce)).digest('hex');
      const fromNonceNo0x = createHash('sha256').update(String(out.paid.nonce).replace(/^0x/, '')).digest('hex');
      assert.notEqual(salt, fromNonce);
      assert.notEqual(salt, fromNonceNo0x);
      assert.equal(acc.payment.txIndex, 4);
      assert.equal(acc.payment.localLogIndex, 0);
      const id = createHash('sha256').update(leaves[0].paymentRef).digest('hex').slice(0, 32);
      assert.notEqual(leaves[0].pendingId, id);
    });
  } finally {
    await gate.close();
  }
});
