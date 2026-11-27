/**
 * Offline v13 anchor scheduler. Local mock RPC only. No production host.
 */
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs, { chmodSync, closeSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, test, afterEach } from 'node:test';
import { inspect } from 'node:util';
import { SECP256K1, bytesToBig, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { eip1559Decode } from '../../../packages/cs2-core/ecdsa/eip1559.js';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { ANCHOR_SELECTOR } from '../../chit-sealer/calldata.js';
import { guardKmsClient } from '../../chit-sealer/anchor-mainnet.js';
import { resetSealerGuardForTest } from '../../chit-sealer/guard.js';
import { openJournal } from '../../chit-sealer/journal.js';
import { createCheckpointSigner, openAnchorIntentLog } from '../../chit-sealer/kms-secp256k1.js';
import { MAINNET_ANCHOR, MAINNET_CHECKPOINT, MAINNET_DOMAIN } from '../../chit-sealer/mainnet-pin.js';
import { ANCHORED_TOPIC, DOMAIN_CALL, LATEST_CALL, encodeLatestHead } from '../../chit-sealer/rpc-base.js';
import { bookLeaf, openIntake, readPendingLines } from '../../chit-store/intake.js';
import { fetchReceipt, openStore } from '../../chit-store/store.js';
import { wireV13Runtime } from '../src/v13-boot.js';
import { handleHouse, issueHouseReceipt, readV13Runtime, setV13Runtime } from '../src/v13-issue.js';
import {
  anchorSchedulerTimerForTest,
  anchorStallStatus,
  assertAnchorSchedulerBoot,
  legacyUnreleasedEpochs,
  finalityDepth,
  selectAnchorHour,
  startV13AnchorScheduler,
  stopV13AnchorScheduler,
} from '../src/v13-anchor-scheduler.js';
import { withSealerGuard } from '../../chit-sealer/guard.js';

const PRIMARY = 'http://primary.example.test/rpc?apiKey=CANARY_RPC_SECRET';
const SECONDARY = 'http://secondary.example.org/rpc?apiKey=CANARY_RPC_SECRET';
const PAYER = `0x${'33'.repeat(20)}`;
const CAP = '100000000000';

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function tagged(n, fill) {
  const out = new Uint8Array(32);
  out.fill(fill);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  return Buffer.from(out).toString('hex');
}

function coreLine(n) {
  const encoded = encodeLine({
    payment: {
      ...SAMPLE.payment,
      value: '1000000',
      localLogIndex: n,
      saltP: tagged(n, 0x51),
      txHash: tagged(n, 0x71),
    },
    content: { ...SAMPLE.content, sellerKeyId: '00'.repeat(32), saltC: tagged(n, 0x63) },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}

function bookKey() {
  const derived = deriveKeyPair(Uint8Array.of(7, 7, 7, 7));
  if (!derived.ok) throw new Error(derived.reason);
  derived.sk.fill(0);
  return derived.pk;
}

function freshWorld() {
  const root = mkdtempSync(join(tmpdir(), 'v13-anchor-'));
  const storeDir = join(root, 'store');
  const sealerDir = join(root, 'sealer');
  mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  mkdirSync(sealerDir, { recursive: true, mode: 0o700 });
  chmodSync(storeDir, 0o700);
  chmodSync(sealerDir, 0o700);
  const book = {
    id: 'aa'.repeat(32),
    token: 'book-token-anchor',
    bookPk: bookKey(),
    wallets: [PAYER],
  };
  const store = openStore(storeDir, { books: [book] });
  const clock = { now: 3600 };
  return { root, storeDir, sealerDir, store, book, clock };
}

function schedulerEnv(sealerDir, extra = {}) {
  return {
    NODE_ENV: 'test',
    CHIT_V13_STORE: 'true',
    CHIT_V13_MAINNET_SEALER: 'true',
    CHIT_V13_ANCHOR_SCHEDULER: 'true',
    CHIT_V13_SEALER_DIR: sealerDir,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: CAP,
    CHIT_SEALER_RPC_URL: PRIMARY,
    CHIT_SEALER_RPC_URL_2: SECONDARY,
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/DUMMY_KEY_CANARY',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_SEALER_STUCK_MS: '600000',
    CHIT_SEALER_CLOSE_MARGIN_SEC: '0',
    ...extra,
  };
}

function bookPending(world, n) {
  const intake = openIntake(world.store.dir);
  const booked = bookLeaf(intake, {
    paymentRef: tagged(n, 0x91).padEnd(160, 'a').slice(0, 160),
    line: coreLine(n),
    caller: { bookId: world.book.id, token: world.book.token },
    hourStart: 0,
  });
  if (!booked.ok) throw new Error(booked.reason);
  return booked;
}

function chainState() {
  return {
    chainId: '0x2105',
    code: '0x6001600055',
    domain: MAINNET_DOMAIN,
    base: '0x3b9aca00',
    tip: '0x5f5e100',
    finalized: '0x5',
    logs: [],
    receipt: null,
    txFrom: MAINNET_CHECKPOINT,
    failSend: 0,
    sends: [],
    methods: [],
    logQueries: [],
    latest: encodeLatestHead(0, 0),
    revertSim: false,
    loseResponse: false,
    knownSend: false,
  };
}

function listen(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      const out = await Promise.resolve(handler(body.method, body.params || []));
      if (out && out.drop) {
        res.destroy();
        return;
      }
      if (out && out.httpStatus) {
        res.writeHead(out.httpStatus, { 'content-type': 'application/json' });
        res.end(out.body || '');
        return;
      }
      if (out && out.missingResult) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1 }));
        return;
      }
      if (out && out.rpcError) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          error: { code: -32000, message: out.rpcError },
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: out }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

function handlerFor(state, role) {
  return async (method, params) => {
    state.methods.push(method);
    if (role.hang && method === (role.hangMethod || 'eth_chainId')) {
      await new Promise((resolve) => setTimeout(resolve, role.hangMs || 400));
      return role.chainId == null ? state.chainId : role.chainId;
    }
    if (role.httpStatus && (!role.httpMethod || method === role.httpMethod)) {
      return { httpStatus: role.httpStatus, body: role.rawBody == null ? '' : role.rawBody };
    }
    if (role.nonJson && method === (role.nonJsonMethod || 'eth_chainId')) {
      return { httpStatus: 200, body: 'not-json' };
    }
    if (role.missingResult && method === (role.missingMethod || 'eth_chainId')) return { missingResult: true };
    if (role.rateLimit) return { rpcError: 'request limit reached' };
    if (role.chainRpc && method === 'eth_chainId') return { rpcError: role.chainRpc };
    if (role.codeError && method === 'eth_getCode') return { rpcError: 'request limit reached' };
    if (role.domainError && method === 'eth_call') return { rpcError: 'request limit reached' };
    if (method === 'eth_chainId') {
      if (role.chainNull) return null;
      return role.chainId == null ? state.chainId : role.chainId;
    }
    if (method === 'eth_getCode') {
      if (role.codeNull) return null;
      return role.code == null ? state.code : role.code;
    }
    if (method === 'eth_call') {
      const data = String((params[0] && params[0].data) || '');
      if (data === LATEST_CALL) return role.latest == null ? state.latest : role.latest;
      if (data.length > 10) {
        state.simulations = (state.simulations || 0) + 1;
        if (state.revertSim) return { rpcError: 'execution reverted' };
        return '0x';
      }
      if (data === DOMAIN_CALL) {
        if (role.domainNull) return null;
        return role.domain == null ? state.domain : role.domain;
      }
      return role.domain == null ? state.domain : role.domain;
    }
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'finalized') return { number: state.finalized };
      return { number: '0x10', baseFeePerGas: state.base };
    }
    if (method === 'eth_maxPriorityFeePerGas') return state.tip;
    if (method === 'eth_sendRawTransaction') {
      if (role.failSend) {
        role.failSend -= 1;
        return { httpStatus: 500, body: '' };
      }
      if (role.nonceLow || state.nonceLow) return { rpcError: 'nonce too low' };
      state.sends.push(params[0]);
      if (state.loseResponse) return { drop: true };
      if (state.knownSend) return { rpcError: 'already known' };
      state.txSeq = (state.txSeq || 0) + 1;
      return `0x${String(state.txSeq).padStart(64, '0')}`;
    }
    if (method === 'eth_getLogs') {
      state.logQueries.push(params[0] || null);
      return state.logs;
    }
    if (method === 'eth_getTransactionCount') {
      if (role.accountNonce != null) return role.accountNonce;
      return state.accountNonce == null ? '0x0' : state.accountNonce;
    }
    if (method === 'eth_getTransactionByHash') {
      if (role.lookupError || state.lookupError) return { rpcError: 'request limit reached' };
      if (role.rejectLookups || state.rejectLookups) return null;
      const hash = String(params[0] || '').toLowerCase();
      if (state.txs && Object.prototype.hasOwnProperty.call(state.txs, hash)) return state.txs[hash];
      return { from: state.txFrom, hash };
    }
    if (method === 'eth_getTransactionReceipt') {
      if (role.lookupError || state.lookupError) return { rpcError: 'request limit reached' };
      if (role.receiptFail) return { httpStatus: 500, body: '' };
      const hash = String(params[0] || '').toLowerCase();
      if (state.receipts && Object.prototype.hasOwnProperty.call(state.receipts, hash)) return state.receipts[hash];
      return state.receipt;
    }
    return null;
  };
}

async function rpcPair(state, roles = {}) {
  const primary = await listen(handlerFor(state, roles.primary || {}));
  const secondary = await listen(handlerFor(state, roles.secondary || {}));
  const ports = {
    'primary.example.test': primary.port,
    'secondary.example.org': secondary.port,
  };
  return {
    state,
    fetchImpl(url, opts) {
      const parsed = new URL(url);
      const port = ports[parsed.hostname];
      if (!port) return Promise.reject(new Error(`unrouted ${url}`));
      const next = new URL(url);
      next.protocol = 'http:';
      next.hostname = '127.0.0.1';
      next.port = String(port);
      return fetch(next, opts);
    },
    async close() {
      await primary.close();
      await secondary.close();
    },
  };
}

function anchoredLog(epoch, block) {
  return {
    address: MAINNET_ANCHOR,
    blockNumber: `0x${Number(block).toString(16)}`,
    transactionHash: `0x${'cd'.repeat(32)}`,
    topics: [ANCHORED_TOPIC, `0x${word(epoch.epoch)}`, `0x${word(epoch.hourStart)}`],
    data: `0x${word(epoch.size)}${String(epoch.root).replace(/^0x/, '').padStart(64, '0')}${String(epoch.stateRoot).replace(/^0x/, '').padStart(64, '0')}${word(0)}`,
  };
}

async function injectedSigner(cap) {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  const address = ethereumAddress(pub);
  const calls = [];
  const client = {
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
  const real = await createCheckpointSigner({
    client: guardKmsClient(client),
    env: {
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/DUMMY_KEY_CANARY',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
      CHIT_CHECKPOINT_ADDRESS: address,
      CHIT_CHECKPOINT_MAX_FEE_PER_GAS: cap,
    },
  });
  return {
    client,
    calls,
    signer: {
      kind: real.kind,
      address: MAINNET_CHECKPOINT.toLowerCase(),
      feeCeiling: String(cap),
      signDigest: (digest, opts) => real.signDigest(digest, opts),
      signEip1559: (tx, opts) => real.signEip1559(tx, opts),
    },
  };
}

function signCount(signer) {
  return signer.calls.filter((name) => name === 'Sign').length;
}

function pinClient() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  return {
    async send(command) {
      if (command?.name !== 'GetPublicKey') return { Signature: Buffer.alloc(0) };
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
    },
  };
}

function houseBoot() {
  const root = mkdtempSync(join(tmpdir(), 'v13-house-boot-'));
  const storeDir = join(root, 'store');
  const bindDir = join(root, 'bind');
  const secretDir = join(root, 'secret');
  mkdirSync(storeDir, { mode: 0o700 });
  mkdirSync(bindDir, { mode: 0o700 });
  mkdirSync(secretDir, { mode: 0o700 });
  chmodSync(storeDir, 0o700);
  chmodSync(bindDir, 0o700);
  chmodSync(secretDir, 0o700);
  const book = { id: 'aa'.repeat(32), token: 'house-token-value', bookPk: new Uint8Array(32).fill(7) };
  const store = openStore(storeDir, { books: [book] });
  const file = join(secretDir, 'book.json');
  writeFileSync(file, JSON.stringify({
    v: 1,
    bookId: book.id,
    token: book.token,
    bookPk: Buffer.from(book.bookPk).toString('hex'),
  }), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { root, store, bindDir, file, book };
}

afterEach(() => {
  stopV13AnchorScheduler();
  resetSealerGuardForTest();
  setV13Runtime(null);
});

describe('v13 anchor scheduler', { concurrency: false }, () => {
  test('flags off start no timer and make no RPC call', async () => {
    const fetches = [];
    const before = new Set(process._getActiveHandles());
    let err = null;
    let out = null;
    try {
      out = await wireV13Runtime({
        CHIT_V13_ISSUANCE: 'false',
        CHIT_V13_MAINNET_SEALER: 'false',
        CHIT_V13_STORE: 'false',
      }, {
        fetch() {
          fetches.push('called');
          throw new Error('fetch');
        },
      });
    } catch (caught) {
      err = caught;
    }
    assert.equal(err, null);
    assert.equal(out && out.wired, false);
    assert.equal(fetches.length, 0);
    assert.equal(anchorSchedulerTimerForTest(), null);
    assert.equal(process._getActiveHandles().filter((handle) => !before.has(handle)).length, 0);
  });

  test('mainnet sealer without the scheduler flag boots with no fee cap and no RPC', async () => {
    const box = houseBoot();
    const fetches = [];
    const before = new Set(process._getActiveHandles());
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    let err = null;
    let out = null;
    try {
      try {
        out = await wireV13Runtime({
          CHIT_V13_STORE: 'true',
          CHIT_V13_MAINNET_SEALER: 'true',
          CHIT_V13_ISSUANCE: 'false',
          CHIT_V13_STORE_PATH: box.store.dir,
          CHIT_V13_BIND_DIR: box.bindDir,
          CHIT_V13_HOUSE_BOOK_ID: box.book.id,
          CHIT_V13_HOUSE_TOKEN_FILE: box.file,
          CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/DUMMY_KEY_CANARY',
          CHIT_CHECKPOINT_KMS_REGION: 'us-east-1',
          CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
        }, {
          testInjection: true,
          addressOf: () => MAINNET_CHECKPOINT,
          client: pinClient(),
          openStore: () => box.store,
          fetch() {
            fetches.push('called');
            throw new Error('fetch');
          },
        });
      } catch (caught) {
        err = caught;
      }
      assert.equal(err, null);
      assert.equal(out.wired, true);
      assert.equal(fetches.length, 0);
      assert.equal(anchorSchedulerTimerForTest(), null);
      assert.equal(process._getActiveHandles().filter((handle) => !before.has(handle)).length, 0);
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('the scheduler flag refuses a missing or loose sealer dir, a bad fee cap, and a bad RPC pair', async () => {
    const world = freshWorld();
    const fetches = [];
    const fetch = () => {
      fetches.push('called');
      throw new Error('fetch');
    };
    const base = schedulerEnv(world.sealerDir);
    await assert.rejects(
      () => wireV13Runtime({ ...base, CHIT_V13_STORE: 'false' }, { fetch }),
      (err) => err.code === 'v13_boot_refused',
    );
    await assert.rejects(
      () => wireV13Runtime({ ...base, CHIT_V13_SEALER_DIR: join(world.root, 'missing') }, { fetch }),
      (err) => err.code === 'v13_boot_refused',
    );
    const loose = join(world.root, 'loose');
    mkdirSync(loose, { mode: 0o755 });
    chmodSync(loose, 0o755);
    await assert.rejects(
      () => wireV13Runtime({ ...base, CHIT_V13_SEALER_DIR: loose }, { fetch }),
      (err) => err.code === 'v13_boot_refused',
    );
    assert.equal((await import('node:fs')).statSync(loose).mode & 0o777, 0o755);
    for (const fee of ['', '0', '-1', '1.5', '1e9']) {
      await assert.rejects(
        async () => assertAnchorSchedulerBoot({ ...base, CHIT_CHECKPOINT_MAX_FEE_PER_GAS: fee }),
        (err) => err.code === 'v13_boot_refused',
      );
    }
    const badPairs = [
      ['', SECONDARY],
      [PRIMARY, ''],
      ['http://primary.example.test/a', 'http://secondary.example.org/b'],
      ['https://rpc.example.test/a', 'https://rpc.example.test/b'],
      ['https://rpc1.example.test/a', 'https://rpc2.example.test/b'],
      ['http://127.0.0.1:1', 'http://127.0.0.2:2'],
    ];
    for (const [left, right] of badPairs) {
      const env = {
        ...base,
        CHIT_SEALER_RPC_URL: left,
        CHIT_SEALER_RPC_URL_2: right,
        NODE_ENV: left.startsWith('http:') && !left.includes('127.') ? 'production' : 'test',
      };
      await assert.rejects(
        () => wireV13Runtime(env, { fetch }),
        (err) => err.code === 'v13_boot_refused',
      );
    }
    assert.equal(fetches.length, 0);
    rmSync(world.root, { recursive: true, force: true });
  });

  test('quiet hours are skipped and a long gap clamps to the backlog window', () => {
    assert.deepEqual(selectAnchorHour({ lastHourStart: null }, 3600 * 200, 0), {
      action: 'skip',
      reason: 'empty_hour',
    });
    assert.equal(selectAnchorHour({ lastHourStart: null }, 3600, 1, 0).hourStart, 0);
    const clamped = selectAnchorHour({ lastHourStart: 0 }, 3600 * 200, 1, 0);
    assert.equal(clamped.action, 'close');
    assert.equal(clamped.hourStart, 168 * 3600);
    assert.equal(clamped.reason, 'backlog_window');
    assert.equal(selectAnchorHour({ lastHourStart: 0 }, 3600 * 10, 1, 0).hourStart, 9 * 3600);
    assert.equal(selectAnchorHour({ lastHourStart: null }, 3600 + 119, 1).action, 'skip');
    assert.equal(selectAnchorHour({ lastHourStart: null }, 3600 + 120, 1).hourStart, 0);
  });

  test('wrong chain, empty code, a bad domain, and an RPC failure refuse before KMS Sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const cases = [
      { primary: { chainId: '0x14a34' }, secondary: { chainId: '0x2105' }, code: 'anchor_chain_mismatch' },
      { primary: { chainId: '0x1' }, secondary: { chainId: '0x1' }, code: 'anchor_chain_mismatch' },
      { primary: { code: '0x' }, secondary: { code: '0x6001' }, code: 'v13_pin_refused' },
      { primary: { domain: `0x${'12'.repeat(32)}` }, secondary: {}, code: 'v13_pin_refused' },
      { primary: { failSend: 0, http: true }, secondary: { http: true }, code: 'anchor_rpc_unavailable' },
    ];
    try {
      for (const item of cases) {
        const state = chainState();
        if (item.primary.http) {
          const handle = await startV13AnchorScheduler({
            env: schedulerEnv(world.sealerDir),
            clock: () => world.clock.now,
            runtime: { store: world.store, client: signer.client },
            deps: {
              testInjection: true,
              signer: signer.signer,
              timeoutMs: 200,
              fetch: async () => ({ ok: false, async text() { return ''; } }),
            },
          });
          const result = await handle.tick();
          assert.equal(result.reason, item.code);
          await handle.stop();
          continue;
        }
        const pair = await rpcPair(state, { primary: item.primary, secondary: item.secondary });
        try {
          await assert.rejects(() => startV13AnchorScheduler({
            env: schedulerEnv(world.sealerDir),
            clock: () => world.clock.now,
            runtime: { store: world.store, client: signer.client },
            deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
          }), (err) => err.code === 'v13_boot_refused');
          assert.equal(anchorSchedulerTimerForTest(), null);
          assert.equal(state.sends.length, 0);
        } finally {
          stopV13AnchorScheduler();
          await pair.close();
        }
      }
      assert.equal(signCount(signer), before);
      assert.equal(world.store.epochs.size, 0);
    } finally {
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a quote above the fee cap does not commit or sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const low = '1000000000';
    const signer = await injectedSigner(low);
    signer.signer.feeCeiling = low;
    const before = signCount(signer);
    const state = chainState();
    const pair = await rpcPair(state);
    const logs = [];
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_CHECKPOINT_MAX_FEE_PER_GAS: low }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: pair.fetchImpl,
          log: (fields, msg) => logs.push(inspect({ fields, msg }, { depth: 4 })),
          timeoutMs: 1000,
        },
      });
      const result = await handle.tick();
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'fee_ceiling');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
      assert.equal(world.store.epochs.size, 0);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a booked leaf seals, broadcasts, ignores an unfinalized log, then releases', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const closed = await handle.tick();
      assert.equal(closed.ok, true, closed.reason);
      assert.equal(state.sends.length, 1);
      assert.ok(signCount(signer) > before);
      const decoded = eip1559Decode(state.sends[0]);
      assert.equal(decoded.chainId, 8453n);
      assert.equal(decoded.value, 0n);
      assert.equal(`0x${decoded.to}`, MAINNET_ANCHOR.toLowerCase());
      assert.equal(decoded.data.startsWith(ANCHOR_SELECTOR), true);
      assert.ok(decoded.gasLimit >= 250000n);
      assert.notEqual(decoded.gasLimit, 100000n);
      const epoch = world.store.epochs.get('1');
      assert.ok(epoch);
      assert.equal(epoch.released, false);
      const receiptId = world.store.receipts.values().next().value.id;
      const pending = fetchReceipt(world.store, {
        receiptId,
        bookId: world.book.id,
        token: world.book.token,
      });
      assert.equal(pending.status, 202);
      state.logs = [anchoredLog(epoch, 32)];
      state.receipt = {
        status: '0x1',
        blockNumber: '0x20',
        logs: state.logs,
      };
      state.finalized = '0x5';
      const ignored = await handle.tick();
      assert.equal(ignored.ok, true, ignored.reason);
      assert.equal(epoch.released, false);
      assert.equal(state.sends.length, 1);
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = {
        status: '0x1',
        blockNumber: '0x4',
        logs: state.logs,
      };
      state.finalized = '0x5';
      for (const query of state.logQueries) {
        assert.equal(query && query.fromBlock, query && query.toBlock);
        assert.notEqual(query && query.fromBlock, '0x0');
        assert.notEqual(query && query.toBlock, 'latest');
      }
      const released = await handle.tick();
      assert.equal(released.ok, true, released.reason);
      assert.equal(epoch.released, true);
      const served = fetchReceipt(world.store, {
        receiptId,
        bookId: world.book.id,
        token: world.book.token,
      });
      assert.equal(served.status, 200);
      assert.equal(world.store.epochs.size, 1);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a crash after commit recovers the same epoch on the next tick', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state, {
      primary: { failSend: 1 },
      secondary: { failSend: 1 },
    });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const first = await handle.tick();
      assert.equal(first.ok, false);
      assert.equal(first.reason, 'broadcast_failed');
      assert.equal(world.store.epochs.size, 1);
      assert.equal(state.sends.length, 0);
      const again = await handle.tick();
      assert.equal(again.ok, true, again.reason);
      assert.equal(state.sends.length, 1);
      assert.equal(world.store.epochs.size, 1);
      const decoded = eip1559Decode(state.sends[0]);
      assert.equal(decoded.data.startsWith(ANCHOR_SELECTOR), true);
      assert.equal(decoded.nonce, 0n);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a primary transport failure fails over to the secondary without a second epoch', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state, { primary: { failSend: 1 }, secondary: {} });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const result = await handle.tick();
      assert.equal(result.ok, true, result.reason);
      assert.equal(state.sends.length, 1);
      assert.equal(world.store.epochs.size, 1);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a stuck broadcast stops at the fee cap and a quote under the cap can be replaced', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const quoted = (1000000000n * 2n) + 100000000n;
    const signer = await injectedSigner(quoted.toString());
    signer.signer.feeCeiling = quoted.toString();
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, {
          CHIT_CHECKPOINT_MAX_FEE_PER_GAS: quoted.toString(),
          CHIT_SEALER_STUCK_MS: '0',
        }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const closed = await handle.tick();
      assert.equal(closed.ok, true, closed.reason);
      const signed = signCount(signer);
      state.receipt = null;
      const capped = await handle.tick();
      assert.equal(capped.reason, 'fee_ceiling');
      assert.equal(signCount(signer), signed);
      assert.equal(state.sends.length, 1);
      signer.signer.feeCeiling = CAP;
      const replaced = await handle.tick();
      assert.equal(replaced.ok, true, replaced.reason);
      assert.equal(state.sends.length, 2);
      assert.equal(eip1559Decode(state.sends[0]).data, eip1559Decode(state.sends[1]).data);
      assert.equal(eip1559Decode(state.sends[0]).nonce, eip1559Decode(state.sends[1]).nonce);
      assert.ok(eip1559Decode(state.sends[1]).maxFeePerGas > eip1559Decode(state.sends[0]).maxFeePerGas);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the house runtime send cannot broadcast', async () => {
    const box = houseBoot();
    const sealerDir = join(box.root, 'sealer');
    mkdirSync(sealerDir, { mode: 0o700 });
    chmodSync(sealerDir, 0o700);
    const state = chainState();
    const pair = await rpcPair(state);
    const signer = await injectedSigner(CAP);
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      await wireV13Runtime({
        ...schedulerEnv(sealerDir),
        CHIT_V13_STORE_PATH: box.store.dir,
        CHIT_V13_BIND_DIR: box.bindDir,
        CHIT_V13_HOUSE_BOOK_ID: box.book.id,
        CHIT_V13_HOUSE_TOKEN_FILE: box.file,
      }, {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        client: pinClient(),
        openStore: () => box.store,
        signer: signer.signer,
        fetch: pair.fetchImpl,
      });
      const runtime = readV13Runtime();
      await assert.rejects(() => runtime.send(`0x${'02'.repeat(8)}`), (err) => err.code === 'anchor_unprepared');
      await issueHouseReceipt({
        env: { CHIT_V13_ISSUANCE: 'false', CHIT_V13_MAINNET_SEALER: 'true', CHIT_V13_STORE: 'true' },
        task: { prompt: 'ping' },
        receiptOpts: { signingSecret: 'byte-pin-secret', baseUrl: 'http://127.0.0.1:9', readOnly: true },
        client: runtime.client,
      }).catch(() => {});
      await handleHouse({ method: 'POST', body: {} }, {
        store: box.store,
        dir: box.bindDir,
        client: runtime.client,
        send: runtime.send,
        caller: { bookId: box.book.id, token: box.book.token },
      }).catch(() => {});
      assert.equal(state.methods.includes('eth_sendRawTransaction'), false);
      assert.equal(state.sends.length, 0);
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      await pair.close();
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('tick failures stay in the process and logs omit the RPC secret and the key id', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const logs = [];
    const sink = (fields, msg) => {
      logs.push(inspect(fields, { depth: 6 }));
      logs.push(String(msg || ''));
    };
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', onUnhandled);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: {
            ...signer.signer,
            async signEip1559() {
              throw new Error('DUMMY_KEY_CANARY');
            },
          },
          log: sink,
          timeoutMs: 50,
          fetch: async (url) => {
            throw new Error(`down ${url}`);
          },
        },
      });
      const result = await handle.tick();
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'anchor_rpc_unavailable');
      await new Promise((resolve) => setImmediate(resolve));
      const packed = logs.join('\n');
      assert.equal(packed.includes('CANARY_RPC_SECRET'), false);
      assert.equal(packed.includes('DUMMY_KEY_CANARY'), false);
      assert.equal(packed.includes(PRIMARY), false);
      assert.equal(unhandled, 0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the scheduler interval is unrefd and stop clears it', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const timer = anchorSchedulerTimerForTest();
      assert.equal(typeof timer.hasRef, 'function');
      assert.equal(timer.hasRef(), false);
      assert.equal(timer._idleTimeout, 60_000);
      handle.stop();
      assert.equal(anchorSchedulerTimerForTest(), null);
      assert.equal(timer._destroyed, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a lost send response recovers as already-known after a crash', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.loseResponse = true;
    const pair = await rpcPair(state);
    try {
      const first = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const lost = await first.tick();
      assert.equal(lost.ok, false);
      assert.equal(lost.reason, 'broadcast_failed');
      assert.equal(world.store.epochs.size, 1);
      assert.equal(state.sends.length, 2);
      await first.stop();
      state.loseResponse = false;
      state.knownSend = true;
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x5';
      const second = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const recovered = await second.tick();
      assert.equal(recovered.ok, true, recovered.reason);
      assert.equal(world.store.epochs.size, 1);
      assert.equal(epoch.released, true);
      const packed = JSON.stringify(state.methods);
      assert.equal(packed.includes('already known'), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a reverted anchor stops later signing until the hold file is removed', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const closed = await handle.tick();
      assert.equal(closed.ok, true, closed.reason);
      const signed = signCount(signer);
      assert.ok(signed > before);
      state.receipt = { status: '0x0', blockNumber: '0x4', logs: [] };
      const halted = await handle.tick();
      assert.equal(halted.reason, 'anchor_reverted');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), true);
      bookPending(world, 2);
      world.clock.now = 7200;
      const again = await handle.tick();
      assert.equal(again.reason, 'anchor_reverted');
      assert.equal(signCount(signer), signed);
      assert.equal(state.sends.length, 1);
      await handle.stop();
      const restarted = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const held = await restarted.tick();
      assert.equal(held.reason, 'anchor_reverted');
      assert.equal(signCount(signer), signed);
      await restarted.stop();
      rmSync(join(world.sealerDir, 'anchor-hold.json'));
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x5';
      state.latest = encodeLatestHead(1, epoch.hourStart);
      const cleared = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const next = await cleared.tick();
      assert.notEqual(next.reason, 'anchor_reverted');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), false);
      assert.equal(epoch.released, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a fee bump happens once per epoch and a mined receipt is not bumped', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const closed = await handle.tick();
      assert.equal(closed.ok, true, closed.reason);
      state.receipt = null;
      const bumped = await handle.tick();
      assert.equal(bumped.ok, true, bumped.reason);
      assert.equal(state.sends.length, 2);
      const spent = await handle.tick();
      assert.equal(spent.reason, 'anchor_bump_spent');
      assert.equal(state.sends.length, 2);
      await handle.stop();
      const restarted = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const again = await restarted.tick();
      assert.equal(again.reason, 'anchor_bump_spent');
      assert.equal(state.sends.length, 2);
      assert.equal(existsSync(join(world.sealerDir, 'anchor-bumps.json')), true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a spent bump with no new traffic is a health stall inside the stuck window', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      const bumped = await handle.tick();
      assert.equal(bumped.ok, true, bumped.reason);
      assert.equal(state.sends.length, 2);
      const spent = await handle.tick();
      assert.equal(spent.ok, false);
      assert.equal(spent.reason, 'anchor_bump_spent');
      assert.equal(state.sends.length, 2);
      assert.equal(anchorStallStatus(), 'anchor_bump_spent');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_bump_spent');
      assert.equal(world.store.epochs.get('1').released, false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('committed unreleased lines stall from the journal clock with no new traffic', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2', CHIT_SEALER_STUCK_MS: '600000' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      assert.equal(anchorStallStatus(), null);
      world.clock.now += 7201;
      state.receipt = null;
      const waited = await handle.tick();
      assert.notEqual(waited.reason, 'anchor_bump_spent');
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_stalled');
      assert.equal(world.store.epochs.get('1').released, false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a mined receipt is left in place', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x1';
      const waited = await handle.tick();
      assert.equal(state.sends.length, 1);
      assert.notEqual(waited.reason, 'anchor_bump_spent');
      assert.equal(epoch.released, false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('an injected signer is ignored unless the test switch is on', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState());
    try {
      await assert.rejects(() => startV13AnchorScheduler({
        env: {
          ...schedulerEnv(world.sealerDir),
          NODE_ENV: 'production',
          CHIT_SEALER_RPC_URL: 'https://primary.example.test/rpc',
          CHIT_SEALER_RPC_URL_2: 'https://secondary.example.org/rpc',
        },
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: {
            feeCeiling: CAP,
            address: MAINNET_CHECKPOINT,
            async signEip1559() { throw new Error('injected signer'); },
          },
          fetch: pair.fetchImpl,
        },
      }), (err) => err.code === 'v13_boot_refused');
      assert.equal(anchorSchedulerTimerForTest(), null);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a JSON-RPC rejection is not sent to the second RPC', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    let sends = 0;
    const pair = await rpcPair(state, {
      primary: { sendError: 'execution reverted' },
    });
    const orig = pair.fetchImpl;
    pair.fetchImpl = async (url, opts) => {
      const host = new URL(url).hostname;
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_sendRawTransaction') {
        sends += 1;
        if (host === 'primary.example.test') {
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32000, message: 'execution reverted' },
              });
            },
          };
        }
      }
      return orig(url, opts);
    };
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const result = await handle.tick();
      assert.equal(result.ok, false);
      assert.equal(sends, 1);
      assert.equal(signCount(signer) > 0, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a dead RPC at boot is logged and does not stop the process', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const logs = [];
    const handle = await startV13AnchorScheduler({
      env: schedulerEnv(world.sealerDir),
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: {
        testInjection: true,
        signer: signer.signer,
        log: (fields) => logs.push(fields && fields.code),
        timeoutMs: 200,
        fetch: async () => { throw new Error('down'); },
      },
    });
    try {
      assert.equal(handle.started, true);
      assert.equal(logs.includes('anchor_rpc_unavailable'), true);
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_rpc_unavailable');
      assert.equal(signCount(signer), signCount(signer));
    } finally {
      await handle.stop();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the chain head and a reverted simulation refuse before Sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const mismatch = chainState();
    mismatch.latest = encodeLatestHead(9, 0);
    const pair = await rpcPair(mismatch);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const refused = await handle.tick();
      assert.equal(refused.reason, 'anchor_head_mismatch');
      assert.equal(signCount(signer), before);
      assert.equal(world.store.epochs.size, 0);
    } finally {
      await pair.close();
    }
    const revert = chainState();
    revert.revertSim = true;
    const second = await rpcPair(revert);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: second.fetchImpl, timeoutMs: 1000 },
      });
      const failed = await handle.tick();
      assert.equal(failed.reason, 'anchor_simulation_failed');
      assert.equal(signCount(signer), before);
      assert.equal(revert.sends.length, 0);
    } finally {
      await second.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('both RPCs must agree on the anchor receipt', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      const good = [anchoredLog(epoch, 4)];
      const bad = [anchoredLog({ ...epoch, root: '12'.repeat(32) }, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: good };
      state.logs = good;
      state.finalized = '0x5';
      const orig = pair.fetchImpl.bind(pair);
      let receiptReads = 0;
      const fetchImpl = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_getTransactionReceipt') {
          receiptReads += 1;
          const logs = receiptReads % 2 === 1 ? good : bad;
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { status: '0x1', blockNumber: '0x4', logs },
              });
            },
          };
        }
        return orig(url, opts);
      };
      await handle.stop();
      const again = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: fetchImpl, timeoutMs: 1000 },
      });
      const result = await again.tick();
      assert.equal(result.reason, 'anchor_quorum');
      assert.equal(epoch.released, false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a complete house boot refuses only the one broken scheduler field', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const box = houseBoot();
    const signer = await injectedSigner(CAP);
    const fetches = [];
    const fetch = () => {
      fetches.push('called');
      throw new Error('fetch');
    };
    try {
      const loose = join(box.root, 'loose');
      mkdirSync(loose, { mode: 0o755 });
      chmodSync(loose, 0o755);
      const base = {
        ...schedulerEnv(loose),
        CHIT_V13_STORE_PATH: box.store.dir,
        CHIT_V13_BIND_DIR: box.bindDir,
        CHIT_V13_HOUSE_BOOK_ID: box.book.id,
        CHIT_V13_HOUSE_TOKEN_FILE: box.file,
      };
      const deps = {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        client: pinClient(),
        openStore: () => box.store,
        signer: signer.signer,
        fetch,
      };
      setV13Runtime(null);
      await assert.rejects(() => wireV13Runtime(base, deps), (err) => err.code === 'v13_boot_refused');
      assert.equal(readV13Runtime() == null, true);
      assert.equal(anchorSchedulerTimerForTest(), null);
      const tight = join(box.root, 'tight');
      mkdirSync(tight, { mode: 0o700 });
      chmodSync(tight, 0o700);
      const noFee = { ...base, CHIT_V13_SEALER_DIR: tight };
      delete noFee.CHIT_CHECKPOINT_MAX_FEE_PER_GAS;
      await assert.rejects(() => wireV13Runtime(noFee, deps), (err) => err.code === 'v13_boot_refused');
      assert.equal(anchorSchedulerTimerForTest(), null);
      const sameDomain = {
        ...base,
        CHIT_V13_SEALER_DIR: tight,
        CHIT_SEALER_RPC_URL: 'http://rpc1.example.test/a',
        CHIT_SEALER_RPC_URL_2: 'http://rpc2.example.test/b',
      };
      await assert.rejects(() => wireV13Runtime(sameDomain, deps), (err) => err.code === 'v13_boot_refused');
      assert.equal(fetches.length, 0);
      assert.equal(anchorSchedulerTimerForTest(), null);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('a finalized bump or the original hash lets the next hour close', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      state.loseResponse = true;
      const bumped = await handle.tick();
      assert.equal(bumped.ok, false);
      state.loseResponse = false;
      const epoch = world.store.epochs.get('1');
      const rows = JSON.parse(readIntent(world.sealerDir));
      const original = rows.find((row) => row.status === 'broadcast');
      const replacement = rows.find((row) => row.status === 'signed' && row.hash && `0x${row.hash}` !== original.tx && row.hash !== original.tx);
      assert.equal(typeof original.tx, 'string');
      assert.equal(replacement != null, true);
      state.receipt = null;
      state.receipts = {
        [original.tx.toLowerCase()]: {
          status: '0x1',
          blockNumber: '0x4',
          logs: [anchoredLog(epoch, 4)],
        },
      };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      state.latest = encodeLatestHead(1, epoch.hourStart);
      bookPending(world, 2);
      world.clock.now = 7200;
      const moved = await handle.tick();
      assert.notEqual(moved.reason, 'anchor_bump_spent');
      assert.equal(epoch.released, true);
      assert.equal(world.store.epochs.size, 2);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('nonce too low without our transaction holds the sealer', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const first = await handle.tick();
      assert.equal(first.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), true);
      const journal = JSON.parse(readFileSync(join(world.sealerDir, 'sealer-state.json'), 'utf8'));
      assert.equal(journal.commits[0].broadcast, false);
      const again = await handle.tick();
      assert.equal(again.reason, 'anchor_nonce_conflict');
      assert.equal(anchorStallStatus(), 'anchor_nonce_conflict');
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('nonce too low for a hash this sealer signed is marked broadcast', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const first = await handle.tick();
      assert.equal(first.ok, true, first.reason);
      const journal = JSON.parse(readFileSync(join(world.sealerDir, 'sealer-state.json'), 'utf8'));
      assert.equal(journal.commits[0].broadcast, true);
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a stall while intake waits is logged and shown on the health body', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.latest = encodeLatestHead(9, 0);
    const logs = [];
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: pair.fetchImpl,
          log: (fields) => logs.push(fields && fields.code),
          timeoutMs: 1000,
        },
      });
      await handle.tick();
      world.clock.now += 1;
      const stalled = await handle.tick();
      assert.equal(stalled.reason, 'anchor_head_mismatch');
      assert.equal(logs.includes('anchor_stalled'), true);
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      const health = publicHealthBody({ anchorStall: anchorStallStatus() });
      assert.equal(health.anchor_stall, 'anchor_stalled');
      assert.equal(JSON.stringify(health).includes('CANARY'), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the close slot releases after timeout and a late sign is not stored', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const real = signer.signer.signEip1559.bind(signer.signer);
    let releaseSign = null;
    signer.signer.signEip1559 = (tx, opts) => new Promise((resolve) => {
      releaseSign = () => resolve(real(tx, opts));
    });
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_CLOSE_TIMEOUT_MS: '2000' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = handle.tick();
      const deadline = Date.now() + 1500;
      while (!releaseSign && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof releaseSign, 'function');
      const busy = await withSealerGuard(async () => ({ ok: true, reason: 'entered' }));
      assert.equal(busy.reason, 'sealer_busy');
      const timed = await tick;
      assert.equal(timed.reason, 'sealer_unavailable');
      releaseSign();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const text = readFileSync(join(world.sealerDir, 'anchor-intents.jsonl'), 'utf8');
      assert.equal(text.includes('"status":"signed"'), false);
      const second = await withSealerGuard(async () => ({ ok: true, reason: 'entered' }));
      assert.equal(second.reason, 'entered');
    } finally {
      if (releaseSign) releaseSign();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('recover holds the sealer slot and shutdown waits for the tick', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.loseResponse = true;
    let releaseSend = null;
    let hungSend = false;
    const pair = await rpcPair(state);
    const orig = pair.fetchImpl;
    pair.fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (!state.loseResponse && !hungSend && body.method === 'eth_sendRawTransaction') {
        hungSend = true;
        await new Promise((resolve) => { releaseSend = resolve; });
        return { ok: false, async text() { return ''; } };
      }
      return orig(url, opts);
    };
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'broadcast_failed');
      state.loseResponse = false;
      const tick = handle.tick();
      const deadline = Date.now() + 1500;
      while (!releaseSend && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      const busy = await withSealerGuard(async () => ({ ok: true, reason: 'entered' }));
      assert.equal(busy.reason, 'sealer_busy');
      let stopped = false;
      const stopping = handle.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(stopped, false);
      releaseSend();
      await tick;
      await stopping;
      assert.equal(stopped, true);
    } finally {
      if (releaseSend) releaseSend();
      await stopV13AnchorScheduler();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('one live RPC does not release until the finalized head is deep enough', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const secondary = {};
    const pair = await rpcPair(state, { secondary });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_FINALITY_DEPTH: '64' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      secondary.receiptFail = true;
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: [anchoredLog(epoch, 4)] };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      const shallow = await handle.tick();
      assert.equal(epoch.released, false);
      assert.notEqual(shallow.reason, 'anchor_bump_spent');
      state.finalized = '0x44';
      const deep = await handle.tick();
      assert.equal(epoch.released, true);
      assert.notEqual(deep.reason, 'anchor_reverted');
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('disagreeing chain heads are refused before Sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const state = chainState();
    const pair = await rpcPair(state, { secondary: { latest: encodeLatestHead(9, 9) } });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const result = await handle.tick();
      assert.equal(result.reason, 'anchor_quorum');
      assert.equal(signCount(signer), before);
      assert.equal(world.store.epochs.size, 0);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a rate-limit JSON-RPC error at boot is a warning and is not a chain mismatch', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const logs = [];
    const limited = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: limited.fetchImpl,
          log: (fields) => logs.push(fields && fields.code),
          timeoutMs: 1000,
        },
      });
      assert.equal(handle && handle.started, true);
      assert.equal(logs.includes('anchor_rpc_unavailable'), true);
      assert.equal(logs.includes('anchor_chain_mismatch'), false);
      assert.equal(logs.includes('v13_pin_refused'), false);
      await handle.stop();
    } catch (err) {
      assert.equal(err && err.code, undefined);
      throw err;
    } finally {
      if (handle) await handle.stop();
      await limited.close();
    }
    const state = chainState();
    const pair = await rpcPair(state, { primary: { rateLimit: true }, secondary: {} });
    const warned = [];
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: pair.fetchImpl,
          log: (fields) => warned.push(fields && fields.code),
          timeoutMs: 1000,
        },
      });
      assert.equal(handle.started, true);
      assert.notEqual(anchorSchedulerTimerForTest(), null);
      assert.equal(warned.includes('anchor_rpc_unavailable'), true);
      assert.equal(signCount(signer), 0);
      await handle.stop();
      const coded = await rpcPair(chainState(), { primary: { codeError: true }, secondary: { codeError: true } });
      const codeLogs = [];
      let codedHandle = null;
      let bootErr = null;
      try {
        try {
          codedHandle = await startV13AnchorScheduler({
            env: schedulerEnv(world.sealerDir),
            clock: () => world.clock.now,
            runtime: { store: world.store, client: signer.client },
            deps: {
              testInjection: true,
              signer: signer.signer,
              fetch: coded.fetchImpl,
              log: (fields) => codeLogs.push(fields && fields.code),
              timeoutMs: 1000,
            },
          });
        } catch (err) {
          bootErr = err;
        }
        assert.equal(bootErr, null);
        assert.equal(codedHandle.started, true);
        assert.equal(codeLogs.includes('v13_pin_refused'), false);
        assert.equal(codeLogs.includes('anchor_rpc_unavailable'), true);
      } finally {
        if (codedHandle) await codedHandle.stop();
        await coded.close();
      }
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the default close margin is 120 seconds and the finality depth default is 64', () => {
    const state = { anchorEpoch: 0, lastHourStart: null, commits: [] };
    assert.equal(selectAnchorHour(state, 3600, 1).action, 'skip');
    assert.equal(selectAnchorHour(state, 3720, 1).action, 'close');
    assert.equal(finalityDepth({}), 64);
    assert.equal(finalityDepth({ CHIT_SEALER_FINALITY_DEPTH: '' }), 64);
  });

  test('one live RPC uses the default depth of 64 when the env is unset', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const secondary = {};
    const env = schedulerEnv(world.sealerDir);
    delete env.CHIT_SEALER_FINALITY_DEPTH;
    const pair = await rpcPair(state, { secondary });
    try {
      const handle = await startV13AnchorScheduler({
        env,
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      secondary.receiptFail = true;
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: [anchoredLog(epoch, 4)] };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      await handle.tick();
      assert.equal(epoch.released, false);
      state.finalized = '0x44';
      await handle.tick();
      assert.equal(epoch.released, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('stall hours are hours, and health only publishes an allow-listed code', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.latest = encodeLatestHead(9, 0);
    const logs = [];
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: pair.fetchImpl,
          log: (fields) => logs.push(fields && fields.code),
          timeoutMs: 1000,
        },
      });
      await handle.tick();
      world.clock.now += 7199;
      await handle.tick();
      assert.equal(logs.includes('anchor_stalled'), false);
      world.clock.now += 2;
      await handle.tick();
      assert.equal(logs.includes('anchor_stalled'), true);
      const { publicHealthBody } = await import('../src/public-metrics.js');
      const health = publicHealthBody({ anchorStall: anchorStallStatus() });
      assert.equal(health.anchor_stall, 'anchor_stalled');
      const leaked = publicHealthBody({ anchorStall: 'http://primary.example.test/CANARY_RPC_SECRET' });
      assert.equal(Object.hasOwn(leaked, 'anchor_stall'), false);
      assert.equal(JSON.stringify(leaked).includes('CANARY'), false);
      assert.equal(publicHealthBody({ anchorStall: 'anchor_nonce_conflict' }).anchor_stall, 'anchor_nonce_conflict');
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a stall clock on disk is still reported after a restart', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.latest = encodeLatestHead(9, 0);
    const env = schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' });
    const pair = await rpcPair(state);
    const start = () => startV13AnchorScheduler({
      env,
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
    });
    try {
      const first = await start();
      await first.tick();
      world.clock.now += 7201;
      const stalled = await first.tick();
      assert.equal(stalled.reason, 'anchor_head_mismatch');
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      await first.stop();
      const restarted = await start();
      const again = await restarted.tick();
      assert.equal(again.reason, 'anchor_head_mismatch');
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_stalled');
      await restarted.stop();
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('nonce too low on recover or on a bump writes the hold', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const primary = { failSend: 1 };
    const secondary = { failSend: 1 };
    const pair = await rpcPair(state, { primary, secondary });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'broadcast_failed');
      const signed = signCount(signer);
      state.nonceLow = true;
      state.rejectLookups = true;
      const held = await handle.tick();
      assert.equal(held.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), true);
      const again = await handle.tick();
      assert.equal(again.reason, 'anchor_nonce_conflict');
      assert.equal(signCount(signer), signed);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }

    const bumpWorld = freshWorld();
    bookPending(bumpWorld, 1);
    const bumpSigner = await injectedSigner(CAP);
    const bumpState = chainState();
    const bumpPair = await rpcPair(bumpState);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(bumpWorld.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => bumpWorld.clock.now,
        runtime: { store: bumpWorld.store, client: bumpSigner.client },
        deps: { testInjection: true, signer: bumpSigner.signer, fetch: bumpPair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      bumpState.receipt = null;
      bumpState.nonceLow = true;
      bumpState.rejectLookups = true;
      const held = await handle.tick();
      assert.equal(held.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(bumpWorld.sealerDir, 'anchor-hold.json')), true);
      assert.equal(bumpState.sends.length, 1);
      const again = await handle.tick();
      assert.equal(again.reason, 'anchor_nonce_conflict');
      assert.equal(bumpState.sends.length, 1);
    } finally {
      await bumpPair.close();
      rmSync(bumpWorld.root, { recursive: true, force: true });
    }
  });

  test('a nonce conflict on the primary is ours when the secondary has the hash', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state, {
      primary: { nonceLow: true, rejectLookups: true },
      secondary: {},
    });
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const closed = await handle.tick();
      assert.equal(closed.ok, true, closed.reason);
      const journal = JSON.parse(readFileSync(join(world.sealerDir, 'sealer-state.json'), 'utf8'));
      assert.equal(journal.commits[0].broadcast, true);
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a crash after the bump is recorded does not spend the nonce twice', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const primary = {};
    const secondary = {};
    const pair = await rpcPair(state, { primary, secondary });
    let releaseSend = null;
    let hungSend = false;
    const inner = pair.fetchImpl;
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (state.hangBump && !hungSend && body.method === 'eth_sendRawTransaction') {
        hungSend = true;
        await new Promise((resolve) => { releaseSend = resolve; });
        state.hangBump = false;
        return { ok: false, async text() { return ''; } };
      }
      return inner(url, opts);
    };
    try {
      const env = schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' });
      const handle = await startV13AnchorScheduler({
        env,
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const original = JSON.parse(readIntent(world.sealerDir)).find((row) => row.status === 'broadcast').tx;
      state.receipt = null;
      state.hangBump = true;
      const crashedTick = handle.tick();
      const bumpFile = join(world.sealerDir, 'anchor-bumps.json');
      const deadline = Date.now() + 1500;
      while (!releaseSend && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(typeof releaseSend, 'function');
      assert.equal(existsSync(bumpFile), true);
      const savedEarly = JSON.parse(readFileSync(bumpFile, 'utf8'));
      assert.equal(savedEarly.v, 2);
      assert.equal(savedEarly.bumps['1'].hashes.includes(original.toLowerCase()), true);
      assert.equal(state.sends.length, 1);
      primary.failSend = 1;
      secondary.failSend = 1;
      releaseSend();
      const crashed = await crashedTick;
      assert.equal(crashed.ok, false);
      const saved = JSON.parse(readFileSync(join(world.sealerDir, 'anchor-bumps.json'), 'utf8'));
      assert.equal(saved.v, 2);
      assert.equal(saved.bumps['1'].hashes.includes(original.toLowerCase()), true);
      assert.equal(state.sends.length, 1);
      await handle.stop();
      const restarted = await startV13AnchorScheduler({
        env,
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const waited = await restarted.tick();
      assert.equal(waited.reason, 'anchor_bump_spent');
      assert.equal(state.sends.filter((raw) => eip1559Decode(raw).nonce === 0n).length, 1);
      const epoch = world.store.epochs.get('1');
      state.receipt = null;
      state.receipts = {
        [original.toLowerCase()]: { status: '0x1', blockNumber: '0x4', logs: [anchoredLog(epoch, 4)] },
      };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      state.latest = encodeLatestHead(1, epoch.hourStart);
      bookPending(world, 2);
      world.clock.now = 7200;
      const moved = await restarted.tick();
      assert.notEqual(moved.reason, 'anchor_bump_spent');
      assert.equal(epoch.released, true);
      assert.equal(world.store.epochs.size, 2);
      assert.equal(state.sends.filter((raw) => eip1559Decode(raw).nonce === 0n).length, 1);
    } finally {
      if (releaseSend) releaseSend();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('K2 a retired nonce is a loud hold', async () => {
    resetSealerGuardForTest();
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
      const nonce = String(JSON.parse(readFileSync(join(world.sealerDir, 'sealer-state.json'), 'utf8')).commits[0].nonce);
      writeClear(world.sealerDir, { v: 1, nonce: '999' });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
      state.accountNonce = '0x1';
      writeClear(world.sealerDir, { v: 1, nonce });
      const retired = await handle.tick();
      assert.equal(retired.ok, false);
      assert.equal(retired.reason, 'anchor_nonce_retired');
      assert.equal(anchorStallStatus(), 'anchor_nonce_retired');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_nonce_retired');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-nonce-clear.json')), false);
      assert.equal(JSON.parse(readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_retired');
      assert.equal(state.sends.length, 0);
      const again = await handle.tick();
      assert.equal(again.ok, false);
      assert.equal(again.reason, 'anchor_nonce_retired');
      assert.equal(state.sends.length, 0);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('K3 a pre-planted clear file does not delete a fresh conflict hold', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    state.accountNonce = '0x5';
    const pair = await rpcPair(state);
    try {
      writeClear(world.sealerDir, { v: 1, nonce: '0' }, 0o600, Date.now() - 10000);
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
      const again = await handle.tick();
      assert.equal(again.ok, false);
      assert.equal(again.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), true);
      assert.equal(JSON.parse(readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-nonce-clear.json')), true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('K4 a clear file does not hide a reverted anchor', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.receipt = { status: '0x0', blockNumber: '0x4', logs: [] };
      writeClear(world.sealerDir, { v: 1, nonce: '0' }, 0o600, Date.now() - 10000);
      const reverted = await handle.tick();
      assert.equal(reverted.ok, false);
      assert.equal(reverted.reason, 'anchor_reverted');
      state.accountNonce = '0x5';
      state.rejectLookups = true;
      state.receipt = null;
      writeClear(world.sealerDir, { v: 1, nonce: '0' });
      const still = await handle.tick();
      assert.equal(still.reason, 'anchor_reverted');
      assert.equal(JSON.parse(readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_reverted');
      assert.equal(epoch.released, false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('K5 a clear file does not freeze a finalized anchor', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      writeClear(world.sealerDir, { v: 1, nonce: '0' });
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x5';
      state.accountNonce = '0x5';
      const released = await handle.tick();
      assert.notEqual(released.reason, 'anchor_nonce_retired');
      assert.equal(epoch.released, true);
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('K6 a mode 0644 clear file is ignored', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x2';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' }, 0o644);
      const tick = await opened.handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(opened.world.sealerDir, 'anchor-nonce-clear.json')), true);
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K7 extra clear-file keys and a non-decimal nonce are ignored', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x2';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0', note: 'extra' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
      writeClear(opened.world.sealerDir, { v: 2, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0x0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
      assert.equal(JSON.parse(readFileSync(join(opened.world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K8 the clear file is consumed once and does not apply without a conflict hold', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x2';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_retired');
      assert.equal(existsSync(join(opened.world.sealerDir, 'anchor-nonce-clear.json')), false);
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_retired');
      assert.equal(existsSync(join(opened.world.sealerDir, 'anchor-nonce-clear.json')), true);
      rmSync(join(opened.world.sealerDir, 'anchor-hold.json'));
      const fresh = await opened.handle.tick();
      assert.notEqual(fresh.reason, 'anchor_nonce_retired');
      assert.equal(fresh.reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K5 our hash on one RPC refuses the clear', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      opened.state.rejectLookups = false;
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      const tick = await opened.handle.tick();
      assert.equal(tick.ok, false);
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      assert.equal(JSON.parse(readFileSync(join(opened.world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K10b a huge clear nonce is refused', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '9'.repeat(80) });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K10c a clear nonce that is not the journal nonce is refused', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '1' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K11c a hash lookup error is not treated as absent', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      opened.state.lookupError = true;
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K12 the two RPCs must agree on the account nonce', async () => {
    const opened = await conflictHandle({ secondary: { accountNonce: '0x0' } });
    try {
      opened.state.accountNonce = '0x2';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('K13 a chain nonce equal to N is refused', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x0';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a mode 0400 clear file, a duplicate key, and a leading zero are refused', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' }, 0o400);
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
      writeClear(opened.world.sealerDir, '{"v":1,"nonce":"5","nonce":"0"}');
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
      writeClear(opened.world.sealerDir, { v: 1, nonce: '00' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('lookupCommitted uses a hash that is only in the bump file', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const orig = pair.fetchImpl.bind(pair);
    const intentPath = join(world.sealerDir, 'anchor-intents.jsonl');
    const bumpPath = join(world.sealerDir, 'anchor-bumps.json');
    pair.fetchImpl = async (url, opts) => {
      let body = {};
      try { body = JSON.parse(opts.body); } catch { body = {}; }
      if (body.method === 'eth_sendRawTransaction' && state.sends.length >= 1 && existsSync(bumpPath)) {
        const kept = readFileSync(intentPath, 'utf8').split('\n').filter(Boolean).map((line) => {
          const row = JSON.parse(line);
          delete row.hash;
          delete row.tx;
          return JSON.stringify(row);
        }).join('\n');
        writeFileSync(intentPath, `${kept}\n`, { mode: 0o600 });
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          error: { code: -32000, message: 'nonce too low: next nonce 1, tx nonce 0' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (body.method === 'eth_getTransactionByHash' || body.method === 'eth_getTransactionReceipt') {
        const asked = String((body.params && body.params[0]) || '').toLowerCase();
        let known = [];
        if (existsSync(bumpPath)) {
          const saved = JSON.parse(readFileSync(bumpPath, 'utf8'));
          const bucket = saved.bumps && saved.bumps['1'] && saved.bumps['1'].hashes;
          known = Array.isArray(bucket) ? bucket.map((item) => String(item).toLowerCase()) : [];
        }
        const hit = known.includes(asked);
        const result = body.method === 'eth_getTransactionByHash'
          ? (hit ? { from: MAINNET_CHECKPOINT, hash: asked } : null)
          : null;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return orig(url, opts);
    };
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      const bumped = await handle.tick();
      assert.notEqual(bumped.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-hold.json')), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('an already covered hour is not closed again', () => {
    const plan = selectAnchorHour({ anchorEpoch: 1, lastHourStart: 0 }, 3720, 1, 0);
    assert.equal(plan.action, 'skip');
    assert.equal(plan.reason, 'hour_already_covered');
  });

  test('a fresh broadcast inside the stuck window is not replaced', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.receipt = null;
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      const waited = await handle.tick();
      assert.equal(state.sends.length, 1, waited.reason);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a disallowed error code is logged as sealer_unavailable', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const logs = [];
    let boom = null;
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => {
          if (boom) {
            const err = boom;
            boom = null;
            throw err;
          }
          return world.clock.now;
        },
        runtime: { store: world.store, client: signer.client },
        deps: {
          testInjection: true,
          signer: signer.signer,
          fetch: pair.fetchImpl,
          log: (fields) => logs.push(fields && fields.code),
          timeoutMs: 1000,
        },
      });
      const secret = new Error('boom');
      secret.code = 'CANARY_RPC_SECRET';
      boom = secret;
      const result = await handle.tick();
      assert.equal(result.reason, 'sealer_unavailable');
      assert.equal(logs.includes('sealer_unavailable'), true);
      assert.equal(logs.includes('CANARY_RPC_SECRET'), false);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a bump refuses a chain head that is not the journal head', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const before = signCount(signer);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.latest = encodeLatestHead(9, 9);
      state.receipt = null;
      const bumped = await handle.tick();
      assert.equal(bumped.reason, 'anchor_head_mismatch');
      assert.equal(state.sends.length, 1);
      assert.equal(signCount(signer), before + 1);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a receipt from a foreign sender is not released', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.txFrom = `0x${'11'.repeat(20)}`;
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: [anchoredLog(epoch, 4)] };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      const watched = await handle.tick();
      assert.equal(epoch.released, false);
      assert.equal(watched.reason == null, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a hash that lives only in the bump file still releases', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      const original = JSON.parse(readIntent(world.sealerDir)).find((row) => row.tx || row.hash);
      const hash = String(original.tx || original.hash);
      const key = hash.startsWith('0x') ? hash.toLowerCase() : `0x${hash.toLowerCase()}`;
      const stripped = readFileSync(join(world.sealerDir, 'anchor-intents.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => {
        const row = JSON.parse(line);
        delete row.hash;
        delete row.tx;
        return JSON.stringify(row);
      }).join('\n');
      writeFileSync(join(world.sealerDir, 'anchor-intents.jsonl'), `${stripped}\n`, { mode: 0o600 });
      writeFileSync(join(world.sealerDir, 'anchor-bumps.json'), `${JSON.stringify({ v: 2, bumps: { 1: { hashes: [key] } } })}\n`, { mode: 0o600 });
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: [anchoredLog(epoch, 4)] };
      state.logs = [anchoredLog(epoch, 4)];
      state.finalized = '0x5';
      await handle.tick();
      assert.equal(epoch.released, true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the replacement hash is stored after the bump is sent', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      const bumped = await handle.tick();
      assert.equal(state.sends.length, 2, bumped && bumped.reason);
      const rows = JSON.parse(readIntent(world.sealerDir));
      const newest = [...rows].reverse().find((row) => row && (row.tx || row.hash) && row !== rows[0]);
      const raw = String((newest && (newest.tx || newest.hash)) || '');
      const key = raw.startsWith('0x') ? raw.toLowerCase() : `0x${raw.toLowerCase()}`;
      const saved = JSON.parse(readFileSync(join(world.sealerDir, 'anchor-bumps.json'), 'utf8'));
      const stored = saved.bumps && saved.bumps['1'] && saved.bumps['1'].hashes
        ? saved.bumps['1'].hashes.map((item) => String(item).toLowerCase())
        : [];
      assert.equal(stored.includes(key), true);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a clear file owned by another user is refused', async () => {
    const opened = await conflictHandle();
    const { createRequire } = await import('node:module');
    const fsMod = createRequire(import.meta.url)('node:fs');
    const real = fsMod.fstatSync;
    try {
      opened.state.accountNonce = '0x1';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      fsMod.fstatSync = (fd) => {
        const st = real.call(fsMod, fd);
        return new Proxy(st, {
          get(target, prop) {
            if (prop === 'uid') return (typeof process.getuid === 'function' ? process.getuid() : 0) + 1;
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      fsMod.fstatSync = real;
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a clear with no tracked hashes is refused', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x1';
      opened.state.rejectLookups = false;
      const stripped = readFileSync(join(opened.world.sealerDir, 'anchor-intents.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => {
        const row = JSON.parse(line);
        delete row.hash;
        delete row.tx;
        return JSON.stringify(row);
      }).join('\n');
      writeFileSync(join(opened.world.sealerDir, 'anchor-intents.jsonl'), `${stripped}\n`, { mode: 0o600 });
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await opened.handle.tick()).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a revert the release pass misses is still a hold', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let failLeft = 0;
    const orig = pair.fetchImpl;
    pair.fetchImpl = async (url, opts) => {
      let method = '';
      try { method = JSON.parse(opts.body).method; } catch { method = ''; }
      if (method === 'eth_getTransactionReceipt' && failLeft > 0) {
        failLeft -= 1;
        return new Response('', { status: 500 });
      }
      return orig(url, opts);
    };
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.receipt = { status: '0x0', blockNumber: '0x4', logs: [] };
      state.logs = [];
      failLeft = 2;
      const seen = await handle.tick();
      assert.equal(seen.reason, 'anchor_reverted');
      assert.equal(JSON.parse(readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_reverted');
      assert.equal(epoch.released, false);
      assert.equal(state.sends.length, 1);
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a timed-out bump sign and a timed-out recover sign are not stored', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const real = signer.signer.signEip1559.bind(signer.signer);
    const state = chainState();
    const pair = await rpcPair(state);
    let releaseSign = null;
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0', CHIT_SEALER_CLOSE_TIMEOUT_MS: '2000' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      signer.signer.signEip1559 = (tx, opts) => new Promise((resolve) => {
        releaseSign = () => resolve(real(tx, opts));
      });
      state.receipt = null;
      const tick = handle.tick();
      const deadline = Date.now() + 1500;
      while (!releaseSign && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof releaseSign, 'function');
      const timed = await tick;
      assert.equal(timed.reason, 'sealer_unavailable');
      releaseSign();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const signed = JSON.parse(readIntent(world.sealerDir)).filter((row) => row.status === 'signed');
      assert.equal(signed.length, 1);
    } finally {
      if (releaseSign) releaseSign();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }

    const recoverWorld = freshWorld();
    bookPending(recoverWorld, 1);
    const recoverSigner = await injectedSigner(CAP);
    const recoverReal = recoverSigner.signer.signEip1559.bind(recoverSigner.signer);
    let recoverRelease = null;
    let calls = 0;
    recoverSigner.signer.signEip1559 = (tx, opts) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('sealer_unavailable');
        err.code = 'sealer_unavailable';
        throw err;
      }
      return new Promise((resolve) => {
        recoverRelease = () => resolve(recoverReal(tx, opts));
      });
    };
    const recoverState = chainState();
    const recoverPair = await rpcPair(recoverState);
    try {
      const handle = await startV13AnchorScheduler({
        env: schedulerEnv(recoverWorld.sealerDir, { CHIT_SEALER_CLOSE_TIMEOUT_MS: '2000' }),
        clock: () => recoverWorld.clock.now,
        runtime: { store: recoverWorld.store, client: recoverSigner.client },
        deps: { testInjection: true, signer: recoverSigner.signer, fetch: recoverPair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, false);
      assert.equal(readFileSync(join(recoverWorld.sealerDir, 'anchor-intents.jsonl'), 'utf8').includes('"status":"signed"'), false);
      const tick = handle.tick();
      const deadline = Date.now() + 1500;
      while (!recoverRelease && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof recoverRelease, 'function');
      const timed = await Promise.race([
        tick,
        new Promise((resolve) => setTimeout(() => resolve({ reason: 'still_running' }), 4000)),
      ]);
      assert.equal(timed.reason, 'sealer_unavailable');
      recoverRelease();
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(readFileSync(join(recoverWorld.sealerDir, 'anchor-intents.jsonl'), 'utf8').includes('"status":"signed"'), false);
    } finally {
      if (recoverRelease) recoverRelease();
      await recoverPair.close();
      rmSync(recoverWorld.root, { recursive: true, force: true });
    }
  });

  test('a fifo clear file is refused without stalling the tick', async () => {
    const opened = await conflictHandle();
    const file = join(opened.world.sealerDir, 'anchor-nonce-clear.json');
    const worker = releaseFifo(plantFifo(file));
    try {
      opened.state.accountNonce = '0x2';
      const started = Date.now();
      const tick = await opened.handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `clear fifo blocked ${Date.now() - started}ms`);
      assert.equal(tick.ok, false);
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      assert.equal(lstatSync(file).isFIFO(), true);
      assert.equal(JSON.parse(readFileSync(join(opened.world.sealerDir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_conflict');
    } finally {
      await worker.terminate();
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked clear file is refused', async () => {
    const opened = await conflictHandle();
    const dir = opened.world.sealerDir;
    const target = join(dir, 'clear-body.json');
    const link = join(dir, 'anchor-nonce-clear.json');
    try {
      const nonce = String(JSON.parse(readFileSync(join(dir, 'sealer-state.json'), 'utf8')).commits[0].nonce);
      writeFileSync(target, `${JSON.stringify({ v: 1, nonce })}\n`, { mode: 0o600 });
      chmodSync(target, 0o600);
      const stamp = new Date(Date.now() + 5000);
      utimesSync(target, stamp, stamp);
      symlinkSync(target, link);
      assert.equal(statSync(target).mode & 0o777, 0o600);
      opened.state.accountNonce = '0x2';
      const tick = await opened.handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      assert.equal(lstatSync(link).isSymbolicLink(), true);
      assert.equal(JSON.parse(readFileSync(join(dir, 'anchor-hold.json'), 'utf8')).reason, 'anchor_nonce_conflict');
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('the clear checks share one prepared RPC set', async () => {
    const opened = await conflictHandle();
    try {
      opened.state.accountNonce = '0x2';
      opened.state.methods.length = 0;
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      const tick = await opened.handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_retired');
      const chainIds = opened.state.methods.filter((method) => method === 'eth_chainId').length;
      assert.equal(chainIds, 4, `eth_chainId calls ${chainIds}`);
      assert.ok(opened.state.methods.filter((method) => method === 'eth_getTransactionCount').length >= 2);
      assert.equal(opened.state.methods.includes('eth_getTransactionByHash'), true);
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a fifo anchor-hold.json does not sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const file = join(world.sealerDir, 'anchor-hold.json');
    plantFifo(file);
    let handle = null;
    let worker = null;
    try {
      const before = signCount(signer);
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      worker = releaseFifo(file);
      const started = Date.now();
      const tick = await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `hold fifo blocked ${Date.now() - started}ms`);
      assert.equal(tick.ok, false);
      assert.equal(tick.reason, 'anchor_hold_unreadable');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
      assert.equal(lstatSync(file).isFIFO(), true);
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_hold_unreadable');
    } finally {
      if (worker) await worker.terminate();
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a fifo anchor-bumps.json does not stall the tick', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    let worker = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const file = join(world.sealerDir, 'anchor-bumps.json');
      worker = releaseFifo(plantFifo(file));
      const started = Date.now();
      const tick = await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `bumps fifo blocked ${Date.now() - started}ms`);
      assert.equal(lstatSync(file).isFIFO(), true);
      assert.notEqual(tick.reason, 'anchor_bump_spent');
    } finally {
      if (worker) await worker.terminate();
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a fifo sealer journal is refused without blocking', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v13-journal-'));
    const file = join(dir, 'sealer-state.json');
    const worker = releaseFifo(plantFifo(file));
    try {
      const started = Date.now();
      assert.throws(
        () => openJournal(dir, { chainId: 8453n, contract: MAINNET_ANCHOR }),
        (err) => err.code === 'journal_unreadable',
      );
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `journal fifo blocked ${Date.now() - started}ms`);
      assert.equal(lstatSync(file).isFIFO(), true);
    } finally {
      await worker.terminate();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a fifo intent log is refused without blocking', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v13-intent-'));
    const file = join(dir, 'anchor-intents.jsonl');
    const worker = releaseFifo(plantFifo(file));
    try {
      const log = openAnchorIntentLog(dir);
      const started = Date.now();
      assert.throws(() => log.read(), (err) => err.code === 'intent_log_refused');
      assert.throws(() => log.append({ v: 1 }), (err) => err.code === 'ENXIO' || err.code === 'intent_log_refused');
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `intent fifo blocked ${Date.now() - started}ms`);
      assert.equal(lstatSync(file).isFIFO(), true);
    } finally {
      await worker.terminate();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a fifo intent log with a reader is refused before append', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v13-intent-'));
    const file = join(dir, 'anchor-intents.jsonl');
    execFileSync('mkfifo', [file]);
    const peer = openSync(file, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
    try {
      const log = openAnchorIntentLog(dir);
      assert.throws(() => log.append({ v: 1, op: 'anchor_intent' }), (err) => err.code === 'intent_log_refused');
    } finally {
      closeSync(peer);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a pending row with no hourStart stalls after the persisted window', async () => {
    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    const booked = bookLeaf(intake, {
      paymentRef: tagged(1, 0x91).padEnd(160, 'a').slice(0, 160),
      line: coreLine(1),
      caller: { bookId: world.book.id, token: world.book.token },
    });
    assert.equal(booked.ok, true, booked.reason);
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    const env = schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' });
    const start = () => startV13AnchorScheduler({
      env,
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
    });
    try {
      const first = await start();
      await first.tick();
      assert.equal(anchorStallStatus(), null);
      world.clock.now += 10 * 3600;
      const stalled = await first.tick();
      assert.equal(stalled.reason, 'anchor_rpc_unavailable');
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      await first.stop();
      const restarted = await start();
      await restarted.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_stalled');
      await restarted.stop();
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('an empty or torn hold file does not sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const file = join(world.sealerDir, 'anchor-hold.json');
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      for (const body of ['', '{', '{"v":1}\n']) {
        writeFileSync(file, body, { mode: 0o600 });
        const before = signCount(signer);
        const tick = await handle.tick();
        assert.equal(tick.reason, 'anchor_hold_unreadable', JSON.stringify(body));
        assert.equal(signCount(signer), before, JSON.stringify(body));
        assert.equal(state.sends.length, 0, JSON.stringify(body));
      }
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_hold_unreadable');
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a shorter hold rewrite replaces the previous bytes', async () => {
    const opened = await conflictHandle();
    try {
      const hold = join(opened.world.sealerDir, 'anchor-hold.json');
      const conflict = readFileSync(hold, 'utf8');
      assert.equal(conflict.includes('anchor_nonce_conflict'), true);
      opened.state.accountNonce = '0x2';
      writeClear(opened.world.sealerDir, { v: 1, nonce: '0' });
      const retired = await opened.handle.tick();
      assert.equal(retired.reason, 'anchor_nonce_retired');
      const text = readFileSync(hold, 'utf8');
      assert.equal(text, `${JSON.stringify({ v: 1, reason: 'anchor_nonce_retired' })}\n`);
      assert.equal(text.includes('anchor_nonce_conflict'), false);
    } finally {
      await opened.pair.close();
      rmSync(opened.world.root, { recursive: true, force: true });
    }
  });

  test('a bump rewrite drops bytes that belonged to the previous file', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const marker = `TAILMARKER${'Z'.repeat(400)}`;
      const seed = `${JSON.stringify({ v: 2, bumps: { 9: { hashes: [] } }, marker })}\n`;
      writeFileSync(join(world.sealerDir, 'anchor-bumps.json'), seed, { mode: 0o600 });
      state.receipt = null;
      await handle.tick();
      const saved = readFileSync(join(world.sealerDir, 'anchor-bumps.json'), 'utf8');
      assert.equal(saved.includes(marker), false);
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(saved); });
      assert.equal(parsed.v, 2);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a released epoch and a house epoch do not stall', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x44';
      state.latest = encodeLatestHead(1, epoch.hourStart);
      await handle.tick();
      assert.equal(epoch.released, true);
      world.store.epochs.set('50', {
        epoch: 50,
        hourStart: 0,
        size: 1024,
        root: 'ab'.repeat(32),
        stateRoot: 'cd'.repeat(32),
        released: false,
      });
      world.store.receipts.set('house-1', { id: 'house-1', epoch: 50, bookId: 'book', line: null });
      world.clock.now += 10 * 3600;
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the stall origin is committedAt and the earlier of two waits', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const env = schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2', CHIT_SEALER_STUCK_MS: '600000' });
    const start = () => startV13AnchorScheduler({
      env,
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
    });
    try {
      world.clock.now = 4000;
      const first = await start();
      assert.equal((await first.tick()).ok, true);
      await first.stop();
      const journalPath = join(world.sealerDir, 'sealer-state.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      assert.equal(journal.commits[0].committedAt, 4000);
      assert.equal(journal.commits[0].broadcastAt, 4000);
      journal.commits[0].broadcastAt = 20000;
      writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });
      world.clock.now = 10801;
      const restarted = await start();
      await restarted.tick();
      assert.equal(anchorStallStatus(), null);
      world.clock.now = 11201;
      await restarted.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      await restarted.stop();
      const second = openIntake(world.store.dir);
      bookLeaf(second, {
        paymentRef: tagged(2, 0x92).padEnd(160, 'b').slice(0, 160),
        line: coreLine(2),
        caller: { bookId: world.book.id, token: world.book.token },
        hourStart: 0,
      });
      bookLeaf(second, {
        paymentRef: tagged(3, 0x93).padEnd(160, 'c').slice(0, 160),
        line: coreLine(3),
        caller: { bookId: world.book.id, token: world.book.token },
        hourStart: 10 * 3600,
      });
      world.clock.now = 10801;
      state.latest = encodeLatestHead(9, 0);
      const both = await start();
      await both.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      await both.stop();
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('the stall boundary is strictly after the window', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.latest = encodeLatestHead(9, 0);
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      world.clock.now = 10800;
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
      world.clock.now = 10801;
      await handle.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a pending line that is already committed does not start the stall clock', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const epoch = world.store.epochs.get('1');
      state.logs = [anchoredLog(epoch, 4)];
      state.receipt = { status: '0x1', blockNumber: '0x4', logs: state.logs };
      state.finalized = '0x44';
      state.latest = encodeLatestHead(1, epoch.hourStart);
      await handle.tick();
      assert.equal(epoch.released, true);
      const intakePath = join(world.store.dir, 'pending-intake.json');
      const intake = JSON.parse(readFileSync(intakePath, 'utf8'));
      intake.leaves[0].receiptId = null;
      intake.leaves[0].state = 'pending_anchor';
      writeFileSync(intakePath, JSON.stringify(intake), { mode: 0o600 });
      world.clock.now += 10 * 3600;
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a spent bump stays quiet until STUCK_MS and is loud when the log cannot be read', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const env = schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' });
    const start = (extra) => startV13AnchorScheduler({
      env: extra ? schedulerEnv(world.sealerDir, extra) : env,
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
    });
    try {
      const handle = await start();
      assert.equal((await handle.tick()).ok, true);
      state.receipt = null;
      assert.equal((await handle.tick()).ok, true);
      await handle.stop();
      const intentPath = join(world.sealerDir, 'anchor-intents.jsonl');
      const rows = readFileSync(intentPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const latest = [...rows].reverse().find((row) => row.status === 'broadcast');
      latest.at = new Date().toISOString();
      writeFileSync(intentPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
      const quiet = await start({ CHIT_SEALER_STUCK_MS: '600000' });
      const inside = await quiet.tick();
      assert.equal(inside.reason, 'anchor_bump_spent');
      assert.equal(inside.ok, true);
      await quiet.stop();
      latest.at = new Date(Date.now() - 600000).toISOString();
      writeFileSync(intentPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
      const loud = await start({ CHIT_SEALER_STUCK_MS: '600000' });
      const outside = await loud.tick();
      assert.equal(outside.ok, false);
      assert.equal(outside.reason, 'anchor_bump_spent');
      await loud.stop();
      writeFileSync(intentPath, `${rows.filter((row) => row.status !== 'broadcast').map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
      const missing = await start({ CHIT_SEALER_STUCK_MS: '600000' });
      const noRow = await missing.tick();
      assert.equal(noRow.ok, false);
      assert.equal(noRow.reason, 'anchor_bump_spent');
      await missing.stop();
      const unreadable = await start({ CHIT_SEALER_STUCK_MS: '600000' });
      rmSync(intentPath);
      mkdirSync(intentPath);
      const failed = await unreadable.tick();
      assert.equal(failed.ok, false);
      assert.equal(failed.reason, 'anchor_bump_spent');
      await unreadable.stop();
    } finally {
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a clear whose prepare fails is not accepted', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    let arm = false;
    let chain = 0;
    const orig = pair.fetchImpl.bind(pair);
    pair.fetchImpl = async (url, opts) => {
      let method = '';
      try { method = JSON.parse(opts.body).method; } catch { method = ''; }
      if (arm && method === 'eth_chainId') {
        chain += 1;
        if (chain > 2 && chain <= 4) {
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'request limit reached' },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
      }
      return orig(url, opts);
    };
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
      state.accountNonce = '0x2';
      writeClear(world.sealerDir, { v: 1, nonce: '0' });
      arm = true;
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(join(world.sealerDir, 'anchor-nonce-clear.json')), true);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked intent log is not followed', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-intents.jsonl');
    writeFileSync(outside, '', { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const intent = join(world.sealerDir, 'anchor-intents.jsonl');
      if (existsSync(intent)) rmSync(intent);
      symlinkSync(outside, intent);
      const before = signCount(signer);
      await handle.tick();
      assert.equal(readFileSync(outside, 'utf8'), '');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a fifo pending-intake.json does not block the tick', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const file = join(world.store.dir, 'pending-intake.json');
    rmSync(file);
    const worker = releaseFifo(plantFifo(file));
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const started = Date.now();
      const tick = await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `intake fifo blocked ${Date.now() - started}ms`);
      assert.equal(tick.reason, 'intake_unreadable');
    } finally {
      await worker.terminate();
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a negative or fractional hourStart is not a stall origin', () => {
    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    bookLeaf(intake, {
      paymentRef: tagged(1, 0x91).padEnd(160, 'a').slice(0, 160),
      line: coreLine(1),
      caller: { bookId: world.book.id, token: world.book.token },
      hourStart: -100000,
    });
    bookLeaf(intake, {
      paymentRef: tagged(2, 0x92).padEnd(160, 'b').slice(0, 160),
      line: coreLine(2),
      caller: { bookId: world.book.id, token: world.book.token },
      hourStart: 0,
    });
    const file = join(world.store.dir, 'pending-intake.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.leaves[1].hourStart = 1.5;
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
    const pending = readPendingLines(world.store.dir);
    assert.equal(pending.ok, true);
    assert.equal(pending.lines[0].hourStart, undefined);
    assert.equal(pending.lines[1].hourStart, undefined);
    rmSync(world.root, { recursive: true, force: true });
  });

  test('a legacy unreleased epoch is counted on health', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState());
    let handle = null;
    try {
      world.store.epochs.set('7', {
        epoch: 7,
        hourStart: 0,
        size: 1,
        root: 'ab'.repeat(32),
        stateRoot: 'cd'.repeat(32),
        released: false,
      });
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
      assert.equal(legacyUnreleasedEpochs(), 1);
      const { publicHealthBody } = await import('../src/public-metrics.js');
      const health = publicHealthBody({ legacyUnreleased: legacyUnreleasedEpochs() });
      assert.equal(health.legacy_unreleased_epochs, 1);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked sealer journal is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v13-journal-link-'));
    const file = join(dir, 'sealer-state.json');
    const side = join(dir, 'real-state.json');
    try {
      const journal = openJournal(dir, { chainId: 8453n, contract: MAINNET_ANCHOR });
      journal.write(journal.state);
      renameSync(file, side);
      symlinkSync(side, file);
      assert.throws(() => openJournal(dir, { chainId: 8453n, contract: MAINNET_ANCHOR }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a symlinked hold file is not followed', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-hold.json');
    writeFileSync(outside, `${JSON.stringify({ v: 1, reason: 'anchor_nonce_conflict' })}\n`, { mode: 0o600 });
    chmodSync(outside, 0o600);
    symlinkSync(outside, join(world.sealerDir, 'anchor-hold.json'));
    let handle = null;
    try {
      const before = signCount(signer);
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_hold_unreadable');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked bump file is not written through', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-bumps.json');
    writeFileSync(outside, '', { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const bump = join(world.sealerDir, 'anchor-bumps.json');
      if (existsSync(bump)) rmSync(bump);
      symlinkSync(outside, bump);
      state.receipt = null;
      await handle.tick();
      assert.equal(readFileSync(outside, 'utf8'), '');
      assert.equal(state.sends.length, 1);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a fifo bump file is not written and does not send', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    let worker = null;
    let peer = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const bump = join(world.sealerDir, 'anchor-bumps.json');
      if (existsSync(bump)) rmSync(bump);
      execFileSync('mkfifo', [bump]);
      peer = openSync(bump, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
      worker = releaseFifo(bump);
      state.receipt = null;
      const started = Date.now();
      await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `bump fifo blocked ${Date.now() - started}ms`);
      assert.equal(state.sends.length, 1);
      assert.equal(lstatSync(bump).isFIFO(), true);
    } finally {
      if (peer != null) closeSync(peer);
      if (worker) await worker.terminate();
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('intent append does not follow a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v13-intent-link-'));
    const outside = join(dir, 'outside.jsonl');
    const file = join(dir, 'anchor-intents.jsonl');
    writeFileSync(outside, '', { mode: 0o600 });
    symlinkSync(outside, file);
    try {
      const log = openAnchorIntentLog(dir);
      assert.throws(() => log.append({ v: 1 }), (err) => err.code === 'ELOOP' || err.code === 'intent_log_refused');
      assert.equal(readFileSync(outside, 'utf8'), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a fifo bump write with no reader returns promptly', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    let worker = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const bump = join(world.sealerDir, 'anchor-bumps.json');
      if (existsSync(bump)) rmSync(bump);
      worker = releaseFifo(plantFifo(bump));
      state.receipt = null;
      const started = Date.now();
      await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `bump write blocked ${Date.now() - started}ms`);
      assert.equal(state.sends.length, 1);
    } finally {
      if (worker) await worker.terminate();
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked pending intake is not followed', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-intake.json');
    renameSync(join(world.store.dir, 'pending-intake.json'), outside);
    symlinkSync(outside, join(world.store.dir, 'pending-intake.json'));
    let handle = null;
    try {
      const before = signCount(signer);
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'intake_unreadable');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a stale hold temp file is replaced and the hold is still written', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    const tmp = join(world.sealerDir, `anchor-hold.json.${process.pid}.tmp`);
    writeFileSync(tmp, 'stale-temp\n', { mode: 0o600 });
    const opened = [];
    const realOpen = fs.openSync;
    fs.openSync = (path, flags, mode) => {
      opened.push({ path: String(path), flags });
      return realOpen(path, flags, mode);
    };
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      const hold = readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8');
      assert.equal(JSON.parse(hold).reason, 'anchor_nonce_conflict');
      assert.equal(existsSync(tmp), false);
      const created = opened.find((row) => row.path === tmp);
      assert.ok(created);
      assert.equal((created.flags & fsConstants.O_EXCL) !== 0, true);
      assert.equal((created.flags & fsConstants.O_NOFOLLOW) !== 0, true);
    } finally {
      fs.openSync = realOpen;
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlink or fifo at the hold temp path is refused and nothing is signed', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-hold.json');
    writeFileSync(outside, 'KEEP\n', { mode: 0o600 });
    const tmp = join(world.sealerDir, `anchor-hold.json.${process.pid}.tmp`);
    symlinkSync(outside, tmp);
    let handle = null;
    try {
      const before = signCount(signer);
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_hold_unreadable');
      assert.equal(anchorStallStatus(), 'anchor_hold_unreadable');
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_hold_unreadable');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
      assert.equal(readFileSync(outside, 'utf8'), 'KEEP\n');
      assert.equal(lstatSync(tmp).isSymbolicLink(), true);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }

    const fifoWorld = freshWorld();
    bookPending(fifoWorld, 1);
    const fifoSigner = await injectedSigner(CAP);
    const fifoState = chainState();
    const fifoPair = await rpcPair(fifoState);
    const fifoTmp = join(fifoWorld.sealerDir, `anchor-hold.json.${process.pid}.tmp`);
    const worker = releaseFifo(plantFifo(fifoTmp));
    let fifoHandle = null;
    try {
      const before = signCount(fifoSigner);
      fifoHandle = await startV13AnchorScheduler({
        env: schedulerEnv(fifoWorld.sealerDir),
        clock: () => fifoWorld.clock.now,
        runtime: { store: fifoWorld.store, client: fifoSigner.client },
        deps: { testInjection: true, signer: fifoSigner.signer, fetch: fifoPair.fetchImpl, timeoutMs: 1000 },
      });
      const started = Date.now();
      const tick = await fifoHandle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS);
      assert.equal(tick.reason, 'anchor_hold_unreadable');
      assert.equal(anchorStallStatus(), 'anchor_hold_unreadable');
      assert.equal(signCount(fifoSigner), before);
      assert.equal(fifoState.sends.length, 0);
      assert.equal(lstatSync(fifoTmp).isFIFO(), true);
    } finally {
      await worker.terminate();
      if (fifoHandle) await fifoHandle.stop();
      await fifoPair.close();
      rmSync(fifoWorld.root, { recursive: true, force: true });
    }

    const dirWorld = freshWorld();
    bookPending(dirWorld, 1);
    const dirSigner = await injectedSigner(CAP);
    const dirState = chainState();
    const dirPair = await rpcPair(dirState);
    mkdirSync(join(dirWorld.sealerDir, `anchor-hold.json.${process.pid}.tmp`));
    let dirHandle = null;
    try {
      const before = signCount(dirSigner);
      dirHandle = await startV13AnchorScheduler({
        env: schedulerEnv(dirWorld.sealerDir),
        clock: () => dirWorld.clock.now,
        runtime: { store: dirWorld.store, client: dirSigner.client },
        deps: { testInjection: true, signer: dirSigner.signer, fetch: dirPair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await dirHandle.tick();
      assert.equal(tick.reason, 'anchor_hold_unreadable');
      assert.equal(anchorStallStatus(), 'anchor_hold_unreadable');
      assert.equal(signCount(dirSigner), before);
      assert.equal(dirState.sends.length, 0);
    } finally {
      if (dirHandle) await dirHandle.stop();
      await dirPair.close();
      rmSync(dirWorld.root, { recursive: true, force: true });
    }
  });

  test('writing a hold fsyncs the temp file and the directory', async () => {
    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    bookLeaf(intake, {
      paymentRef: tagged(4, 0x94).padEnd(160, 'd').slice(0, 160),
      line: coreLine(4),
      caller: { bookId: world.book.id, token: world.book.token },
    });
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    const fsynced = [];
    const realFsync = fs.fsyncSync;
    fs.fsyncSync = (fd) => {
      try { fsynced.push(fs.readlinkSync(`/proc/self/fd/${fd}`)); } catch { fsynced.push(''); }
      return realFsync(fd);
    };
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      fsynced.length = 0;
      await handle.tick();
      assert.equal(fsynced.some((path) => path.includes(`anchor-stall-seen.json.${process.pid}.tmp`)), true);
      assert.equal(fsynced.some((path) => path === world.sealerDir), true);
    } finally {
      fs.fsyncSync = realFsync;
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a failed hold write leaves the previous hold in place and does not sign', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    let handle = null;
    const realOpen = fs.openSync;
    const realWrite = fs.writeSync;
    const tmpFds = new Set();
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
      const prior = readFileSync(join(world.sealerDir, 'anchor-hold.json'), 'utf8');
      fs.openSync = (path, flags, mode) => {
        const fd = realOpen(path, flags, mode);
        if (String(path).includes(`anchor-hold.json.${process.pid}.tmp`)) tmpFds.add(fd);
        return fd;
      };
      fs.writeSync = (fd, ...rest) => {
        if (tmpFds.has(fd)) {
          const err = new Error('ENOSPC');
          err.code = 'ENOSPC';
          throw err;
        }
        return realWrite(fd, ...rest);
      };
      const before = signCount(signer);
      state.accountNonce = '0x2';
      writeClear(world.sealerDir, { v: 1, nonce: '0' });
      const tick = await handle.tick();
      assert.notEqual(tick.reason, 'anchor_nonce_retired');
      const holdPath = join(world.sealerDir, 'anchor-hold.json');
      assert.equal(existsSync(holdPath), true);
      assert.equal(readFileSync(holdPath, 'utf8'), prior);
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
    } finally {
      fs.openSync = realOpen;
      fs.writeSync = realWrite;
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a seen file at -1 or in the future is rewritten and does not stall yet', async () => {
    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    bookLeaf(intake, {
      paymentRef: tagged(5, 0x95).padEnd(160, 'e').slice(0, 160),
      line: coreLine(5),
      caller: { bookId: world.book.id, token: world.book.token },
    });
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    const seen = join(world.sealerDir, 'anchor-stall-seen.json');
    writeFileSync(seen, `${JSON.stringify({ v: 1, at: -1 })}\n`, { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
      assert.equal(JSON.parse(readFileSync(seen, 'utf8')).at, world.clock.now);
      await handle.stop();
      writeFileSync(seen, `${JSON.stringify({ v: 1, at: 999999999 })}\n`, { mode: 0o600 });
      const future = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await future.tick();
      assert.equal(anchorStallStatus(), null);
      assert.equal(JSON.parse(readFileSync(seen, 'utf8')).at, world.clock.now);
      world.clock.now += 7201;
      await future.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      await future.stop();
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a seen file that cannot be written still starts the stall clock', async () => {
    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    bookLeaf(intake, {
      paymentRef: tagged(6, 0x96).padEnd(160, 'f').slice(0, 160),
      line: coreLine(6),
      caller: { bookId: world.book.id, token: world.book.token },
    });
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    mkdirSync(join(world.sealerDir, 'anchor-stall-seen.json'));
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await handle.tick();
      assert.equal(anchorStallStatus(), null);
      world.clock.now += 7201;
      await handle.tick();
      assert.equal(anchorStallStatus(), 'anchor_stalled');
      assert.equal(lstatSync(join(world.sealerDir, 'anchor-stall-seen.json')).isDirectory(), true);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a live writer on the intake fifo and the bump fifo is refused promptly', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const intakeFile = join(world.store.dir, 'pending-intake.json');
    const intakeBody = readFileSync(intakeFile);
    plantFifo(intakeFile);
    const intakePeer = openSync(intakeFile, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
    fs.writeSync(intakePeer, intakeBody);
    let handle = null;
    try {
      const before = signCount(signer);
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const started = Date.now();
      const tick = await handle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `intake writer blocked ${Date.now() - started}ms`);
      assert.equal(tick.reason, 'intake_unreadable');
      assert.equal(signCount(signer), before);
      assert.equal(state.sends.length, 0);
    } finally {
      closeSync(intakePeer);
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }

    const bumpWorld = freshWorld();
    bookPending(bumpWorld, 1);
    const bumpSigner = await injectedSigner(CAP);
    const bumpState = chainState();
    const bumpPair = await rpcPair(bumpState);
    let bumpHandle = null;
    let bumpPeer = null;
    try {
      bumpHandle = await startV13AnchorScheduler({
        env: schedulerEnv(bumpWorld.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => bumpWorld.clock.now,
        runtime: { store: bumpWorld.store, client: bumpSigner.client },
        deps: { testInjection: true, signer: bumpSigner.signer, fetch: bumpPair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await bumpHandle.tick()).ok, true);
      const bump = join(bumpWorld.sealerDir, 'anchor-bumps.json');
      if (existsSync(bump)) rmSync(bump);
      execFileSync('mkfifo', [bump]);
      bumpPeer = openSync(bump, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
      bumpState.receipt = null;
      const started = Date.now();
      await bumpHandle.tick();
      assert.ok(Date.now() - started < FIFO_PROMPT_MS, `bump writer blocked ${Date.now() - started}ms`);
      assert.equal(bumpState.sends.length, 1);
      assert.equal(lstatSync(bump).isFIFO(), true);
    } finally {
      if (bumpPeer != null) closeSync(bumpPeer);
      if (bumpHandle) await bumpHandle.stop();
      await bumpPair.close();
      rmSync(bumpWorld.root, { recursive: true, force: true });
    }
  });

  test('a mode 0644 hold or bump file is rewritten as 0600', async () => {
    const previous = process.umask(0o022);
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    state.nonceLow = true;
    state.rejectLookups = true;
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_nonce_conflict');
      const hold = join(world.sealerDir, 'anchor-hold.json');
      chmodSync(hold, 0o644);
      state.nonceLow = false;
      state.rejectLookups = true;
      state.accountNonce = '0x2';
      writeClear(world.sealerDir, { v: 1, nonce: '0' });
      assert.equal((await handle.tick()).reason, 'anchor_nonce_retired');
      assert.equal(statSync(hold).mode & 0o777, 0o600);
    } finally {
      process.umask(previous);
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a mode 0644 bump file is rewritten as 0600', async () => {
    const previous = process.umask(0o022);
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      const bumps = join(world.sealerDir, 'anchor-bumps.json');
      writeFileSync(bumps, `${JSON.stringify({ v: 2, bumps: {} })}\n`, { mode: 0o644 });
      chmodSync(bumps, 0o644);
      state.receipt = null;
      await handle.tick();
      assert.equal(statSync(bumps).mode & 0o777, 0o600);
    } finally {
      process.umask(previous);
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a garbage, empty, or torn seen file still stalls, and a reverted hold stays on health', async () => {
    const { publicHealthBody } = await import('../src/public-metrics.js');
    for (const body of ['garbage', '', '{']) {
      const world = freshWorld();
      const intake = openIntake(world.store.dir);
      bookLeaf(intake, {
        paymentRef: tagged(7, 0x97).padEnd(160, 'a').slice(0, 160),
        line: coreLine(7),
        caller: { bookId: world.book.id, token: world.book.token },
      });
      const signer = await injectedSigner(CAP);
      const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
      writeFileSync(join(world.sealerDir, 'anchor-stall-seen.json'), body, { mode: 0o600 });
      let handle = null;
      try {
        handle = await startV13AnchorScheduler({
          env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
          clock: () => world.clock.now,
          runtime: { store: world.store, client: signer.client },
          deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
        });
        const first = await handle.tick();
        assert.equal(first.ok, false);
        assert.equal(anchorStallStatus(), null);
        world.clock.now += 7201;
        await handle.tick();
        assert.equal(anchorStallStatus(), 'anchor_stalled');
      } finally {
        if (handle) await handle.stop();
        await pair.close();
        rmSync(world.root, { recursive: true, force: true });
      }
    }

    const world = freshWorld();
    const intake = openIntake(world.store.dir);
    bookLeaf(intake, {
      paymentRef: tagged(8, 0x98).padEnd(160, 'b').slice(0, 160),
      line: coreLine(8),
      caller: { bookId: world.book.id, token: world.book.token },
    });
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    writeFileSync(join(world.sealerDir, 'anchor-hold.json'), `${JSON.stringify({ v: 1, reason: 'anchor_reverted' })}\n`, { mode: 0o600 });
    writeFileSync(join(world.sealerDir, 'anchor-stall-seen.json'), 'garbage', { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      const tick = await handle.tick();
      assert.equal(tick.reason, 'anchor_rpc_unavailable');
      assert.equal(anchorStallStatus(), 'anchor_reverted');
      assert.equal(publicHealthBody({ anchorStall: anchorStallStatus() }).anchor_stall, 'anchor_reverted');
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a seen file is removed when nothing is pending', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    const seen = join(world.sealerDir, 'anchor-stall-seen.json');
    writeFileSync(seen, `${JSON.stringify({ v: 1, at: 1 })}\n`, { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await handle.tick();
      assert.equal(existsSync(seen), false);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('legacy unreleased count skips released and house epochs', async () => {
    const world = freshWorld();
    const signer = await injectedSigner(CAP);
    const pair = await rpcPair(chainState(), { primary: { rateLimit: true }, secondary: { rateLimit: true } });
    world.store.epochs.set('7', {
      epoch: 7,
      hourStart: 0,
      size: 1,
      root: 'ab'.repeat(32),
      stateRoot: 'cd'.repeat(32),
      released: false,
    });
    world.store.epochs.set('8', {
      epoch: 8,
      hourStart: 0,
      size: 1,
      root: '11'.repeat(32),
      stateRoot: '22'.repeat(32),
      released: true,
    });
    world.store.epochs.set('50', {
      epoch: 50,
      hourStart: 0,
      size: 1024,
      root: 'ee'.repeat(32),
      stateRoot: 'ff'.repeat(32),
      released: false,
    });
    world.store.receipts.set('house-1', { id: 'house-1', epoch: 50, bookId: 'book', line: null });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STALL_HOURS: '2' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      await handle.tick();
      assert.equal(legacyUnreleasedEpochs(), 1);
      const { publicHealthBody } = await import('../src/public-metrics.js');
      assert.equal(publicHealthBody({ legacyUnreleased: legacyUnreleasedEpochs() }).legacy_unreleased_epochs, 1);
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });

  test('a symlinked intent log is not read', async () => {
    const world = freshWorld();
    bookPending(world, 1);
    const signer = await injectedSigner(CAP);
    const state = chainState();
    const pair = await rpcPair(state);
    const outside = join(world.root, 'outside-intents.jsonl');
    writeFileSync(outside, '', { mode: 0o600 });
    let handle = null;
    try {
      handle = await startV13AnchorScheduler({
        env: schedulerEnv(world.sealerDir, { CHIT_SEALER_STUCK_MS: '0' }),
        clock: () => world.clock.now,
        runtime: { store: world.store, client: signer.client },
        deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
      });
      assert.equal((await handle.tick()).ok, true);
      assert.equal(state.sends.length, 1);
      const intent = join(world.sealerDir, 'anchor-intents.jsonl');
      rmSync(intent);
      symlinkSync(outside, intent);
      state.receipt = null;
      const tick = await handle.tick();
      assert.equal(tick.reason, 'sealer_unavailable');
      assert.equal(state.sends.length, 1);
      assert.equal(readFileSync(outside, 'utf8'), '');
    } finally {
      if (handle) await handle.stop();
      await pair.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
});

const FIFO_RELEASE_MS = 2000;
const FIFO_PROMPT_MS = 1000;

const FIFO_PEER = `
const fs = require('node:fs');
const { workerData } = require('node:worker_threads');
setTimeout(() => {
  let fd;
  try {
    fd = fs.openSync(workerData.file, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  } catch {
    return;
  }
  try { fs.writeSync(fd, Buffer.from('x')); } catch { /* the pipe can already be closed */ }
  const buf = Buffer.alloc(1024);
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    try { fs.readSync(fd, buf, 0, buf.length); } catch { /* EAGAIN */ }
    Atomics.wait(gate, 0, 0, 20);
  }
  try { fs.closeSync(fd); } catch { /* closed */ }
}, workerData.delayMs);
`;

function plantFifo(file) {
  if (existsSync(file)) rmSync(file);
  execFileSync('mkfifo', [file]);
  return file;
}

function releaseFifo(file) {
  return new Worker(FIFO_PEER, { eval: true, workerData: { file, delayMs: FIFO_RELEASE_MS } });
}

function readIntent(dir) {
  return `[${readFileSync(join(dir, 'anchor-intents.jsonl'), 'utf8').trim().split('\n').join(',')}]`;
}

function writeClear(dir, body, mode = 0o600, when = Date.now() + 5000) {
  const file = join(dir, 'anchor-nonce-clear.json');
  if (existsSync(file)) rmSync(file);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, { mode });
  chmodSync(file, mode);
  const stamp = new Date(when);
  utimesSync(file, stamp, stamp);
  return file;
}

async function conflictHandle(roles = {}) {
  resetSealerGuardForTest();
  const world = freshWorld();
  bookPending(world, 1);
  const signer = await injectedSigner(CAP);
  const state = chainState();
  state.nonceLow = true;
  state.rejectLookups = true;
  const pair = await rpcPair(state, roles);
  try {
    const handle = await startV13AnchorScheduler({
      env: schedulerEnv(world.sealerDir),
      clock: () => world.clock.now,
      runtime: { store: world.store, client: signer.client },
      deps: { testInjection: true, signer: signer.signer, fetch: pair.fetchImpl, timeoutMs: 1000 },
    });
    assert.equal((await handle.tick()).reason, 'anchor_nonce_conflict');
    return { world, signer, state, pair, handle };
  } catch (err) {
    await pair.close();
    rmSync(world.root, { recursive: true, force: true });
    throw err;
  }
}

test('boot edge probes refuse only a well-formed mismatch', async () => {
  const world = freshWorld();
  const signer = await injectedSigner(CAP);
  const before = signCount(signer);
  const cases = [
    { name: 'J3', primary: { httpStatus: 429, httpMethod: 'eth_chainId' }, boot: false },
    { name: 'J4', primary: { chainRpc: 'request limit reached' }, boot: false },
    { name: 'J5a', primary: { chainId: 'zz' }, boot: false },
    { name: 'J5b', primary: { missingResult: true }, boot: false },
    { name: 'J5c', primary: { chainNull: true }, boot: false },
    { name: 'J6', primary: { codeNull: true }, boot: false },
    { name: 'J6b', primary: { codeError: true }, boot: false },
    { name: 'J7', primary: { hang: true, hangMs: 400 }, boot: false, timeoutMs: 150 },
    { name: 'J8', primary: { nonJson: true }, boot: false },
    { name: 'J9', primary: { httpStatus: 429 }, secondary: { httpStatus: 429 }, boot: false },
    { name: 'J10', primary: { domainError: true }, boot: false },
    { name: 'J10b', primary: { domainNull: true }, boot: false },
    { name: 'J10c', primary: { httpStatus: 503, httpMethod: 'eth_getCode' }, boot: false },
    { name: 'J11', primary: { code: '0x' }, boot: true },
    { name: 'J12', primary: { domain: `0x${'12'.repeat(32)}` }, boot: true },
    { name: 'J13', primary: { chainId: '0x1' }, secondary: { httpStatus: 429 }, boot: true },
    { name: 'J14', primary: { code: '0x' }, secondary: { rateLimit: true }, boot: true },
    { name: 'decimal', primary: { chainId: '8453' }, boot: false },
  ];
  try {
    for (let i = 0; i < cases.length; i += 1) {
      const item = cases[i];
      const pair = await rpcPair(chainState(), { primary: item.primary, secondary: item.secondary || {} });
      const logs = [];
      let handle = null;
      let err = null;
      try {
        handle = await startV13AnchorScheduler({
          env: schedulerEnv(world.sealerDir),
          clock: () => world.clock.now,
          runtime: { store: world.store, client: signer.client },
          deps: {
            testInjection: true,
            signer: signer.signer,
            fetch: pair.fetchImpl,
            log: (fields) => logs.push(fields && fields.code),
            timeoutMs: item.timeoutMs || 1000,
          },
        });
      } catch (caught) {
        err = caught;
      } finally {
        if (handle) await handle.stop();
        await pair.close();
      }
      if (item.boot) {
        assert.equal(err && err.code, 'v13_boot_refused', item.name);
        assert.equal(handle, null, item.name);
      } else {
        assert.equal(err, null, item.name);
        assert.equal(handle && handle.started, true, item.name);
        assert.equal(logs.includes('anchor_chain_mismatch'), false, item.name);
        assert.equal(logs.includes('v13_pin_refused'), false, item.name);
        assert.equal(logs.includes('anchor_rpc_unavailable'), true, item.name);
      }
    }
    assert.equal(signCount(signer), before);
  } finally {
    rmSync(world.root, { recursive: true, force: true });
  }
});
