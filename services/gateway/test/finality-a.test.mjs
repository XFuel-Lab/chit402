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

test('FA1 a lagging finalized head books one pending leaf and returns 202', async () => {
  resetHouseState();
  const box = freshBox();
  const gate = await bootGateway(box);
  try {
    await withFlags({}, async () => {
      const out = await pay(gate.base, 'fa1');
      assert.notEqual(out.status, 503);
      assert.notEqual(out.status, 402, JSON.stringify(out.body));
      assert.equal(out.status, 202, JSON.stringify(out.body));
      assert.equal(out.headers.get('retry-after'), '30');
      assert.equal(out.body.code, 'pending_anchor');
      assert.equal(out.body.finality, 'pending');
      assert.equal(out.body.retryable, true);
      assert.match(out.body.pending_id, /^[0-9a-f]{32}$/);
      assert.match(out.body.verify_url, /\/receipt\/[0-9a-f]{32}$/);
      const leaves = readIntakeLeaves(box.store.dir);
      assert.equal(leaves.leaves.filter((row) => row.state === 'pending_anchor').length, 1);
      assert.equal(leaves.leaves[0].finality, 'pending');
    });
  } finally {
    await gate.close();
  }
});

function schedulerEnv(dir, urls) {
  return flagsOn({
    NODE_ENV: 'test',
    CHIT_V13_ANCHOR_SCHEDULER: 'true',
    CHIT_V13_SEALER_DIR: dir,
    CHIT_SEALER_RPC_URL: urls[0],
    CHIT_SEALER_RPC_URL_2: urls[1],
  });
}

async function injectedSigner() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  const address = ethereumAddress(pub);
  const client = mockKms();
  const real = await createCheckpointSigner({
    client: guardKmsClient(client),
    env: {
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/DUMMY_KEY_CANARY',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
      CHIT_CHECKPOINT_ADDRESS: address,
      CHIT_CHECKPOINT_MAX_FEE_PER_GAS: CAP,
    },
  });
  return {
    client,
    signer: {
      kind: real.kind,
      address: MAINNET_CHECKPOINT.toLowerCase(),
      feeCeiling: CAP,
      signDigest: (digest, opts) => real.signDigest(digest, opts),
      signEip1559: (tx, opts) => real.signEip1559(tx, opts),
    },
  };
}

test('FA2 and FA3 a leaf waits for finality, then seals into the close window', async () => {
  resetHouseState();
  const box = freshBox();
  const left = await startLagRpc({ lag: 450, latest: 1000, salt: 'left' });
  const right = await startLagRpc({ lag: 450, latest: 1000, salt: 'left' });
  const sealerDir = join(box.root, 'sealer');
  mkdirSync(sealerDir, { recursive: true, mode: 0o700 });
  chmodSync(sealerDir, 0o700);
  const signer = await injectedSigner();
  const clock = { now: 7200 };
  const block = 1000;
  const hash = left.hashOf(block).slice(2);
  try {
    await withFlags(schedulerEnv(sealerDir, [PRIMARY, SECONDARY]), async () => {
      const booked = await issueHouseReceipt({
        env: flagsOn(),
        dir: box.bind,
        store: box.store,
        caller: box.caller,
        client: mockKms(),
        send: async () => '0x1',
        payment: {
          chainId: 8453,
          token: USDC.slice(2).toLowerCase(),
          from: PAYER.slice(2).toLowerCase(),
          to: PAY_TO.slice(2).toLowerCase(),
          authorizer: PAYER.slice(2).toLowerCase(),
          value: AMOUNT,
          method: 1,
          nonce: '21'.repeat(32),
          saltP: '55'.repeat(32),
        },
        observation: {
          blockNumber: block,
          finalizedNumber: null,
          blockHash: hash,
          blockTime: 1_700_000_000,
          txIndex: 0,
          localLogIndex: 0,
          txHash: 'cd'.repeat(32),
          hourStart: 1_699_999_200,
        },
      });
      assert.equal(booked.status, 202, JSON.stringify(booked.body));
      setV13Runtime({ store: box.store, dir: box.bind, caller: box.caller, client: mockKms(), send: async () => '0x1' });
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(sealerDir, [PRIMARY, SECONDARY]),
        clock: () => clock.now,
        runtime: { store: box.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: routeLagFetch(left, right),
          timeoutMs: 1000,
        },
      });
      clock.now = 10_800;
      const waiting = await handle.tick();
      assert.equal(waiting.ok, true);
      assert.ok(waiting.reason === 'empty_hour' || waiting.reason === 'hour_not_finished');
      assert.equal(left.sends.length, 0);
      assert.equal(box.store.epochs.size, 0);
      const journalPath = join(sealerDir, 'sealer-state.json');
      if (existsSync(journalPath)) {
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        assert.equal(journal.nextNonce, 0);
      }
      left.tick(450);
      right.tick(450);
      assert.ok(left.finalized() >= block);
      const sealed = await handle.tick();
      assert.equal(sealed.ok, true, sealed.reason);
      assert.equal(left.sends.length, 1);
      const epoch = box.store.epochs.get('1');
      assert.ok(epoch);
      assert.equal(epoch.hourStart, 7200);
      assert.notEqual(epoch.hourStart, 1_699_999_200);
      await stopV13AnchorScheduler();
    });
  } finally {
    await left.close();
    await right.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('FA14 flags-off receipt has no v13 pending fields', async () => {
  const { buildReceipt } = await import('../src/openai-gateway.js');
  const prev = {};
  for (const name of ['CHIT_V13_ISSUANCE', 'CHIT_V13_MAINNET_SEALER', 'CHIT_V13_STORE']) {
    prev[name] = process.env[name];
    delete process.env[name];
  }
  try {
    const receipt = await buildReceipt({
      task: { taskId: 'fa14', status: 'completed', intent: { type: 'inference_request' }, meta: {} },
      taskId: 'fa14',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
    });
    assert.equal(receipt.v, undefined);
    assert.equal(receipt.surface, 'openai-v1');
    assert.equal(receipt.finality, undefined);
    assert.equal(JSON.stringify(receipt).includes('pending_anchor'), false);
  } finally {
    for (const name of Object.keys(prev)) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
  }
});

void MAINNET_ANCHOR;
void publicHealthBody;
void anchorStallStatus;
void houseIssueCallsForTest;
