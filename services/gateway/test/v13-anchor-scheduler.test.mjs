/**
 * Offline v13 anchor scheduler. Local mock RPC only. No production host.
 */
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createCheckpointSigner } from '../../chit-sealer/kms-secp256k1.js';
import { MAINNET_ANCHOR, MAINNET_CHECKPOINT, MAINNET_DOMAIN } from '../../chit-sealer/mainnet-pin.js';
import { ANCHORED_TOPIC, DOMAIN_CALL, LATEST_CALL, encodeLatestHead } from '../../chit-sealer/rpc-base.js';
import { bookLeaf, openIntake } from '../../chit-store/intake.js';
import { fetchReceipt, openStore } from '../../chit-store/store.js';
import { wireV13Runtime } from '../src/v13-boot.js';
import { handleHouse, issueHouseReceipt, readV13Runtime, setV13Runtime } from '../src/v13-issue.js';
import {
  anchorSchedulerTimerForTest,
  anchorStallStatus,
  assertAnchorSchedulerBoot,
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
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function handlerFor(state, role) {
  return (method, params) => {
    state.methods.push(method);
    if (method === 'eth_chainId') return role.chainId == null ? state.chainId : role.chainId;
    if (method === 'eth_getCode') return role.code == null ? state.code : role.code;
    if (method === 'eth_call') {
      const data = String((params[0] && params[0].data) || '');
      if (data === LATEST_CALL) return role.latest == null ? state.latest : role.latest;
      if (data.length > 10) {
        state.simulations = (state.simulations || 0) + 1;
        if (state.revertSim) return { rpcError: 'execution reverted' };
        return '0x';
      }
      if (data === DOMAIN_CALL) return role.domain == null ? state.domain : role.domain;
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
      if (state.nonceLow) return { rpcError: 'nonce too low' };
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
    if (method === 'eth_getTransactionByHash') {
      if (state.rejectLookups) return null;
      const hash = String(params[0] || '').toLowerCase();
      if (state.txs && Object.prototype.hasOwnProperty.call(state.txs, hash)) return state.txs[hash];
      return { from: state.txFrom, hash };
    }
    if (method === 'eth_getTransactionReceipt') {
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
    try {
      const out = await wireV13Runtime({
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
      handle.stop();
      assert.equal(anchorSchedulerTimerForTest(), null);
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
      await assert.rejects(() => wireV13Runtime(base, deps), (err) => err.code === 'v13_boot_refused');
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
    const pair = await rpcPair(state);
    const orig = pair.fetchImpl;
    pair.fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (!state.loseResponse && body.method === 'eth_sendRawTransaction') {
        await new Promise((resolve) => { releaseSend = resolve; });
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
});

function readIntent(dir) {
  return `[${readFileSync(join(dir, 'anchor-intents.jsonl'), 'utf8').trim().split('\n').join(',')}]`;
}
