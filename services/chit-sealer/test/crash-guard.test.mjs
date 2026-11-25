/**
 * Sealer crash guard. Offline. No production host, no RPC, no IMDS.
 * Dummy values are built at runtime. Chain 31337 is a dummy id.
 */
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  readSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';
import { bytesToBig } from '../../../packages/cs2-core/ecdsa/bytes.js';
import { SECP256K1, eip1559Digest, eip1559Serialize, eip1559TxHash, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { openStore } from '../../chit-store/store.js';
import { openSealer } from '../close.js';
import { guardCloseHour, resetSealerGuardForTest, sealerCloseTimeoutMs } from '../guard.js';
import { checkpointKmsTimeoutMs, createCheckpointSigner, setCheckpointRefusalLog } from '../kms-secp256k1.js';
import { MAINNET_CHECKPOINT } from '../mainnet-pin.js';

process.env.NODE_ENV = 'test';

const require = createRequire(new URL('../../gateway/package.json', import.meta.url));
const { KMSClient } = require('@aws-sdk/client-kms');
const { signMainnetCheckpoint } = await import('../anchor-mainnet.js');
const { issueHouseReceipt, readV13Runtime, setV13Runtime } = await import('../../gateway/src/v13-issue.js');
const { wireV13Runtime } = await import('../../gateway/src/v13-boot.js');

const HOUR = 3600;
const CHAIN_ID = 31337;
const CONTRACT = '0x3333333333333333333333333333333333333333';
const DUMMY_D = 0xA11CEn;
const DUMMY_ADDRESS = ethereumAddress(publicPoint(DUMMY_D, SECP256K1));
const FEES = {
  gasLimit: '100000',
  maxFeePerGas: '1000000000',
  maxPriorityFeePerGas: '100000000',
};
const FIXTURE = readFileSync(new URL('../../gateway/test/fixtures/v10-issuance-response.json', import.meta.url));
const WATCH = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_DEFAULTS_MODE',
  'AWS_EC2_METADATA_DISABLED',
];

function bookKey() {
  const derived = deriveKeyPair(Uint8Array.of(7, 7, 7, 7));
  if (!derived.ok) throw new Error(derived.reason);
  derived.sk.fill(0);
  return derived.pk;
}

const BOOK_PK = bookKey();
const PAYER = `0x${'33'.repeat(20)}`;
const BOOK_A = {
  id: 'aa'.repeat(32),
  token: 'book-a-token',
  bookPk: BOOK_PK,
  wallets: [PAYER],
};

function tagged(n, fill) {
  const out = new Uint8Array(32);
  out.fill(fill);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  return Buffer.from(out).toString('hex');
}

function coreLine(n = 1) {
  const encoded = encodeLine({
    payment: {
      ...SAMPLE.payment,
      value: '1000000',
      localLogIndex: n,
      saltP: tagged(n, 0x51),
      txHash: tagged(n, 0x71),
    },
    content: {
      ...SAMPLE.content,
      sellerKeyId: '00'.repeat(32),
      saltC: tagged(n, 0x63),
    },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}

function lineItem(n = 1) {
  return { line: coreLine(n), bookId: BOOK_A.id, bookPk: BOOK_PK };
}

function mockSigner() {
  return {
    address: DUMMY_ADDRESS,
    feeCeiling: '100000000000000',
    async signEip1559(tx) {
      const digest = eip1559Digest(tx);
      for (let k = 3n; k < 80n; k += 1n) {
        try {
          const sig = signRawDigest(digest, DUMMY_D, k, SECP256K1);
          const raw = eip1559Serialize(tx, sig);
          return { raw, hash: eip1559TxHash(raw), yParity: sig.yParity };
        } catch {
          // another dummy nonce
        }
      }
      throw new Error('mock signer could not sign');
    },
  };
}

function fresh() {
  const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const root = join(tmpdir(), `sealer-cg-${stamp}`);
  const sealerDir = join(root, 'sealer');
  const storeDir = join(root, 'store');
  mkdirSync(sealerDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });
  const store = openStore(storeDir, { books: [BOOK_A] });
  const sealer = openSealer({
    dir: sealerDir,
    store,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => HOUR,
  });
  return { root, sealer };
}

function signerEnv(address, extra = {}) {
  return {
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/cg-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: address,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '10',
    CHIT_CHECKPOINT_KMS_TIMEOUT_MS: '1000',
    ...extra,
  };
}

function checkpointMaterial() {
  const d = 0xA11CEn;
  const pub = publicPoint(d, SECP256K1);
  const jwk = {
    kty: 'EC',
    crv: 'secp256k1',
    x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
    y: Buffer.from(pub.subarray(33)).toString('base64url'),
  };
  const spki = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' });
  function sign(digest) {
    let k = (bytesToBig(digest) % (SECP256K1.order - 3n)) + 2n;
    for (let i = 0; i < 8; i += 1) {
      try {
        return signRawDigest(digest, d, k, SECP256K1);
      } catch (err) {
        if (err.code !== 'bad_nonce') throw err;
        k += 1n;
      }
    }
    return null;
  }
  return { pub, spki, address: ethereumAddress(pub), sign };
}

function publicKeyBody(spki) {
  return {
    KeySpec: 'ECC_SECG_P256K1',
    KeyUsage: 'SIGN_VERIFY',
    SigningAlgorithms: ['ECDSA_SHA_256'],
    PublicKey: spki,
  };
}

function kmsTransport(spki) {
  const calls = [];
  const requestHandler = {
    async handle(request) {
      const target = String((request.headers || {})['x-amz-target'] || '');
      calls.push(target);
      const signing = target.endsWith('.Sign');
      const payload = signing
        ? { Signature: '', SigningAlgorithm: 'ECDSA_SHA_256' }
        : {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          CustomerMasterKeySpec: 'ECC_SECG_P256K1',
          PublicKey: Buffer.from(spki).toString('base64'),
        };
      return {
        response: {
          statusCode: 200,
          headers: { 'content-type': 'application/x-amz-json-1.1' },
          body: Buffer.from(JSON.stringify(payload)),
        },
      };
    },
  };
  return { requestHandler, calls };
}

function realKms(requestHandler) {
  return new KMSClient({
    region: 'us-east-2',
    credentials: { accessKeyId: 'cg-access', secretAccessKey: 'cg-secret' },
    requestHandler,
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeArn() {
  return ['arn', 'aws', 'kms', 'us-east-2', '9'.repeat(12), 'key', 'ab'].join(':');
}

function savedEnv() {
  const saved = {};
  for (const key of WATCH) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of WATCH) {
    if (saved[key] == null) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function guardSockets() {
  const hits = [];
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const blob = args.map((part) => {
      if (part && typeof part === 'object') {
        try { return JSON.stringify(part); } catch { return ''; }
      }
      return String(part);
    }).join(' ');
    if (blob.includes('169.254.169.254') || blob.includes('fd00:ec2::254')) hits.push('imds');
    const err = new Error('socket opened during sealer crash-guard test');
    err.code = 'socket_opened';
    throw err;
  };
  return {
    hits,
    restore() { net.Socket.prototype.connect = orig; },
  };
}

function makeHouseTree() {
  const root = mkdtempSync(join(tmpdir(), 'sealer-cg-house-'));
  const storeDir = join(root, 'store');
  const bindDir = join(root, 'bind');
  const secretDir = join(root, 'secret');
  const credsDir = join(root, 'creds');
  for (const dir of [storeDir, bindDir, secretDir, credsDir]) {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  const bookId = 'aa'.repeat(32);
  writeFileSync(join(storeDir, 'store-state.json'), JSON.stringify({
    v: 1,
    epochs: [],
    receipts: [],
    books: { [bookId]: { bookSalt: '12'.repeat(32) } },
  }));
  const token = join(secretDir, 'book.json');
  writeFileSync(token, JSON.stringify({
    v: 1,
    bookId,
    token: 'canary-cg-house-token',
    bookPk: '07'.repeat(32),
  }), { mode: 0o600 });
  chmodSync(token, 0o600);
  return { root, storeDir, bindDir, credsDir, bookId, token };
}

function writeIni(dir, { profile, accessKey, secret, otherProfile, otherKey, name = 'credentials', mode = 0o600 }) {
  const file = join(dir, name);
  let text = `[${profile}]\naws_access_key_id = ${accessKey}\naws_secret_access_key = ${secret}\n`;
  if (otherProfile) {
    text += `[${otherProfile}]\naws_access_key_id = ${otherKey}\naws_secret_access_key = ${secret}\n`;
  }
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
  return file;
}

function bootEnv(tree, creds, profile, over = {}) {
  return {
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: 'false',
    CHIT_V13_STORE: 'true',
    CHIT_V13_STORE_PATH: tree.storeDir,
    CHIT_V13_BIND_DIR: tree.bindDir,
    CHIT_V13_HOUSE_BOOK_ID: tree.bookId,
    CHIT_V13_HOUSE_TOKEN_FILE: tree.token,
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/cg-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '10',
    CHIT_CHECKPOINT_KMS_TIMEOUT_MS: '1000',
    CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: creds,
    CHIT_CHECKPOINT_AWS_PROFILE: profile,
    ...over,
  };
}

async function boot(env, deps) {
  setV13Runtime(null);
  let out = null;
  let err = null;
  try {
    out = await wireV13Runtime(env, deps);
  } catch (caught) {
    err = caught;
  }
  return { out, err, runtime: readV13Runtime() };
}

function byteTask() {
  const stored = JSON.parse(FIXTURE.toString('utf8'));
  return {
    taskId: 'chit-cg-bytepin',
    status: 'completed',
    createdAt: '2026-09-26T17:27:32Z',
    updatedAt: '2026-09-26T17:27:32Z',
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:0x${'ab'.repeat(32)}`,
      amount: '2000',
      modelId: 'example/model',
    },
    meta: {
      provider: 'example-hub',
      payerWallet: `0x${'11'.repeat(20)}`,
      payTo: `0x${'22'.repeat(20)}`,
    },
    result: { provider: 'example-hub', model: 'example/model', output: 'ok' },
    issuerSignature: stored.issuer_signature,
  };
}

describe('sealer crash guard', { concurrency: false }, () => {
  test('CG1 a hung Sign is checkpoint_sign_unavailable within the timeout', async () => {
    const material = checkpointMaterial();
    const lines = [];
    setCheckpointRefusalLog((fields, msg) => lines.push(fields, msg));
    const client = {
      async send(command) {
        if (command?.name === 'GetPublicKey') return publicKeyBody(material.spki);
        return new Promise(() => {});
      },
    };
    const env = signerEnv(material.address);
    const signer = await createCheckpointSigner({ client, env });
    const started = Date.now();
    const outcome = await Promise.race([
      signer.signDigest(Buffer.alloc(32, 4)).then((value) => ({ value })).catch((err) => ({ err })),
      delay(2500).then(() => ({ hung: true })),
    ]);
    const elapsed = Date.now() - started;
    assert.equal(outcome.hung, undefined);
    assert.equal(outcome.err && outcome.err.code, 'checkpoint_sign_unavailable');
    assert.ok(elapsed < 2200);
    assert.ok(elapsed >= 700);
    const packed = [inspect(lines, { depth: 8 }), JSON.stringify(lines)].join('\n');
    assert.equal(packed.includes('checkpoint_sign_unavailable'), true);
    assert.equal(packed.includes(env.CHIT_CHECKPOINT_KMS_KEY_ID), false);
    assert.equal(lines.some((part) => part && part.code === 'checkpoint_sign_unavailable'), true);
    setCheckpointRefusalLog(null);
  });

  test('CG2 a hung GetPublicKey on the signer path is the same named refusal', async () => {
    const lines = [];
    setCheckpointRefusalLog((fields, msg) => lines.push(fields, msg));
    const client = { send() { return new Promise(() => {}); } };
    const started = Date.now();
    const outcome = await Promise.race([
      createCheckpointSigner({ client, env: signerEnv(DUMMY_ADDRESS) }).then((value) => ({ value })).catch((err) => ({ err })),
      delay(2500).then(() => ({ hung: true })),
    ]);
    assert.equal(outcome.hung, undefined);
    assert.equal(outcome.err && outcome.err.code, 'checkpoint_sign_unavailable');
    assert.ok(Date.now() - started < 2200);
    assert.equal(lines.some((part) => part && part.code === 'checkpoint_sign_unavailable'), true);
    const packed = JSON.stringify(lines);
    assert.equal(packed.includes('alias/cg-checkpoint'), false);
    const tree = makeHouseTree();
    const pinStarted = Date.now();
    const pin = await Promise.race([
      boot(bootEnv(tree, join(tree.root, 'unused'), 'checkpoint-cg2'), {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        client: { send() { return new Promise(() => {}); } },
      }),
      delay(2500).then(() => ({ hung: true })),
    ]);
    assert.equal(pin.hung, undefined);
    assert.equal(pin.err && pin.err.code, 'v13_boot_refused');
    assert.equal(pin.runtime, null);
    assert.ok(Date.now() - pinStarted < 2200);
    setV13Runtime(null);
    rmSync(tree.root, { recursive: true, force: true });
    setCheckpointRefusalLog(null);
  });

  test('CG3 a hung close send is sealer_unavailable and a late result is not broadcast', async () => {
    resetSealerGuardForTest();
    const { root, sealer } = fresh();
    const lines = [];
    let entered = 0;
    let release;
    const send = () => {
      entered += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    const started = Date.now();
    const result = await Promise.race([
      guardCloseHour(sealer, {
        hourStart: 0,
        lines: [lineItem(1)],
        fees: FEES,
        send,
      }, { env: { CHIT_SEALER_CLOSE_TIMEOUT_MS: '1000' }, log: (fields, msg) => lines.push(fields, msg) }),
      delay(3000).then(() => ({ reason: 'hung' })),
    ]);
    assert.equal(result.reason, 'sealer_unavailable');
    assert.equal(entered, 1);
    assert.ok(Date.now() - started < 2500);
    release(`0x${'ab'.repeat(32)}`);
    await delay(40);
    const rows = sealer.intentLog.read();
    assert.equal(rows.some((row) => row.status === 'broadcast'), false);
    assert.equal(sealer.state.commits.every((row) => row.broadcast === false), true);
    assert.equal(lines.some((part) => part && part.code === 'sealer_unavailable'), true);
    assert.equal(JSON.stringify(lines).includes('0x'), false);
    resetSealerGuardForTest();
    rmSync(root, { recursive: true, force: true });
  });

  test('CG4 both timeout envs clamp and never return NaN', () => {
    const samples = [undefined, null, '', '   ', 'nope', 'NaN', 'Infinity', NaN, Infinity];
    for (const raw of samples) {
      const checkpoint = checkpointKmsTimeoutMs({ CHIT_CHECKPOINT_KMS_TIMEOUT_MS: raw });
      const close = sealerCloseTimeoutMs({ CHIT_SEALER_CLOSE_TIMEOUT_MS: raw });
      assert.equal(checkpoint, 10000);
      assert.equal(close, 20000);
      assert.equal(Number.isNaN(checkpoint), false);
      assert.equal(Number.isNaN(close), false);
    }
    for (const raw of [0, -5, '-5', '40', 40]) {
      assert.equal(checkpointKmsTimeoutMs({ CHIT_CHECKPOINT_KMS_TIMEOUT_MS: raw }), 1000);
      assert.equal(sealerCloseTimeoutMs({ CHIT_SEALER_CLOSE_TIMEOUT_MS: raw }), 1000);
    }
    assert.equal(checkpointKmsTimeoutMs({ CHIT_CHECKPOINT_KMS_TIMEOUT_MS: '30001' }), 30000);
    assert.equal(sealerCloseTimeoutMs({ CHIT_SEALER_CLOSE_TIMEOUT_MS: '999999' }), 30000);
    assert.equal(checkpointKmsTimeoutMs({ CHIT_CHECKPOINT_KMS_TIMEOUT_MS: '15000' }), 15000);
    assert.equal(sealerCloseTimeoutMs({ CHIT_SEALER_CLOSE_TIMEOUT_MS: '20000' }), 20000);
    assert.equal(Number.isNaN(checkpointKmsTimeoutMs({ CHIT_CHECKPOINT_KMS_TIMEOUT_MS: 'nope' })), false);
    assert.equal(Number.isNaN(sealerCloseTimeoutMs({ CHIT_SEALER_CLOSE_TIMEOUT_MS: '1e99' })), false);
  });

  test('CG5 the production checkpoint client pins standard mode and two attempts', async () => {
    const tree = makeHouseTree();
    const material = checkpointMaterial();
    const profile = 'checkpoint-cg5';
    const fileKey = 'cg5-file-access';
    const creds = writeIni(tree.credsDir, { profile, accessKey: fileKey, secret: 'cg5-file-secret' });
    const transport = kmsTransport(material.spki);
    const saved = savedEnv();
    process.env.AWS_DEFAULTS_MODE = 'auto';
    process.env.AWS_ACCESS_KEY_ID = 'cg5-env-access';
    process.env.AWS_SECRET_ACCESS_KEY = 'cg5-env-secret';
    delete process.env.AWS_EC2_METADATA_DISABLED;
    const sockets = guardSockets();
    let client = null;
    try {
      const outcome = await boot(bootEnv(tree, creds, profile), {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        requestHandler: transport.requestHandler,
      });
      assert.equal(outcome.err, null);
      assert.equal(outcome.out && outcome.out.wired, true);
      client = outcome.runtime.client;
      const mode = client.config.defaultsMode;
      const defaults = typeof mode === 'function' ? await mode() : mode;
      assert.equal(String(defaults).toLowerCase(), 'standard');
      const attempts = client.config.maxAttempts;
      const maxAttempts = typeof attempts === 'function' ? await attempts() : attempts;
      assert.equal(maxAttempts, 2);
      assert.equal(sockets.hits.length, 0);
    } finally {
      if (client && typeof client.destroy === 'function') client.destroy();
      sockets.restore();
      restoreEnv(saved);
      setV13Runtime(null);
      rmSync(tree.root, { recursive: true, force: true });
    }
  });

  test('CG6 checkpoint login is the file profile, not the process env', async () => {
    const tree = makeHouseTree();
    const material = checkpointMaterial();
    const profile = 'checkpoint-cg6';
    const other = 'env-profile-cg6';
    const fileKey = 'cg6-file-access';
    const envKey = 'cg6-env-access';
    const creds = writeIni(tree.credsDir, {
      profile,
      accessKey: fileKey,
      secret: 'cg6-file-secret',
      otherProfile: other,
      otherKey: envKey,
    });
    const transport = kmsTransport(material.spki);
    const saved = savedEnv();
    process.env.AWS_ACCESS_KEY_ID = envKey;
    process.env.AWS_SECRET_ACCESS_KEY = 'cg6-env-secret';
    process.env.AWS_PROFILE = other;
    process.env.AWS_SHARED_CREDENTIALS_FILE = join(tree.root, 'not-the-checkpoint-file');
    let client = null;
    try {
      const outcome = await boot(bootEnv(tree, creds, profile), {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        requestHandler: transport.requestHandler,
      });
      assert.equal(outcome.err, null);
      client = outcome.runtime.client;
      const resolved = await client.config.credentials();
      assert.equal(resolved.accessKeyId, fileKey);
      assert.equal(resolved.accessKeyId === envKey, false);
      assert.equal(process.env.AWS_PROFILE, other);
      assert.equal(process.env.AWS_ACCESS_KEY_ID, envKey);
      const missingProfile = await boot(bootEnv(tree, creds, profile, { CHIT_CHECKPOINT_AWS_PROFILE: '' }), {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        requestHandler: transport.requestHandler,
      });
      assert.equal(missingProfile.err && missingProfile.err.reason, 'checkpoint_creds_missing');
      const missingFile = await boot(bootEnv(tree, join(tree.root, 'missing-creds'), profile), {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        requestHandler: transport.requestHandler,
      });
      assert.equal(missingFile.err && missingFile.err.reason, 'checkpoint_creds_missing');
      assert.equal(process.env.AWS_PROFILE, other);
    } finally {
      if (client && typeof client.destroy === 'function') client.destroy();
      restoreEnv(saved);
      setV13Runtime(null);
      rmSync(tree.root, { recursive: true, force: true });
    }
  });

  test('CG7 a second close while one is in flight is sealer_busy', async () => {
    resetSealerGuardForTest();
    const { root, sealer } = fresh();
    let signs = 0;
    let sends = 0;
    const inner = mockSigner();
    sealer.signer = {
      address: inner.address,
      feeCeiling: inner.feeCeiling,
      async signEip1559(tx) {
        signs += 1;
        return inner.signEip1559(tx);
      },
    };
    const send = () => {
      sends += 1;
      return new Promise(() => {});
    };
    const input = { hourStart: 0, lines: [lineItem(2)], fees: FEES, send };
    const deps = { env: { CHIT_SEALER_CLOSE_TIMEOUT_MS: '1500' }, log() {} };
    const first = guardCloseHour(sealer, input, deps);
    let second;
    let secondErr;
    try {
      second = await guardCloseHour(sealer, input, deps);
    } catch (err) {
      secondErr = err;
    }
    const deadline = Date.now() + 1000;
    while (sends < 1 && Date.now() < deadline) await delay(10);
    assert.equal(secondErr, undefined);
    assert.equal(second && second.reason, 'sealer_busy');
    assert.equal(signs, 1);
    assert.equal(sends, 1);
    const firstResult = await first;
    assert.equal(firstResult.reason, 'sealer_unavailable');
    resetSealerGuardForTest();
    rmSync(root, { recursive: true, force: true });
  });

  test('CG8 a late Sign after timeout does not send', async () => {
    resetSealerGuardForTest();
    const { root, sealer } = fresh();
    const inner = mockSigner();
    let started = 0;
    let sends = 0;
    let release;
    sealer.signer = {
      address: inner.address,
      feeCeiling: inner.feeCeiling,
      signEip1559(tx) {
        started += 1;
        return new Promise((resolve, reject) => {
          release = () => { Promise.resolve(inner.signEip1559(tx)).then(resolve, reject); };
        });
      },
    };
    const pending = guardCloseHour(sealer, {
      hourStart: 0,
      lines: [lineItem(3)],
      fees: FEES,
      send: async () => { sends += 1; return `0x${'cd'.repeat(32)}`; },
    }, { env: { CHIT_SEALER_CLOSE_TIMEOUT_MS: '1000' }, log() {} });
    const deadline = Date.now() + 800;
    while (started < 1 && Date.now() < deadline) await delay(10);
    assert.equal(started, 1);
    const result = await pending;
    assert.equal(result.reason, 'sealer_unavailable');
    assert.equal(sends, 0);
    release();
    await delay(40);
    assert.equal(sends, 0);
    assert.equal(sealer.intentLog.read().some((row) => row.status === 'broadcast'), false);
    resetSealerGuardForTest();
    rmSync(root, { recursive: true, force: true });
  });

  test('CG9 an unexpected close throw is named and does not exit', async () => {
    resetSealerGuardForTest();
    const { root, sealer } = fresh();
    const lines = [];
    const unhandled = [];
    const onUnhandled = (err) => { unhandled.push(err); };
    const exits = [];
    const origExit = process.exit;
    process.on('unhandledRejection', onUnhandled);
    process.exit = ((code) => { exits.push(code); });
    const boom = new Proxy(sealer, {
      get(target, prop, receiver) {
        if (prop === 'state') throw new Error('close blew up');
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      const outcome = await Promise.race([
        guardCloseHour(boom, { hourStart: 0, lines: [], fees: FEES, send: async () => '0xabc' }, {
          env: { CHIT_SEALER_CLOSE_TIMEOUT_MS: '20000' },
          log: (fields, msg) => lines.push(fields, msg),
        }).then((v) => ({ v })).catch((e) => ({ e })),
        delay(2000).then(() => ({ hung: true })),
      ]);
      await delay(20);
      assert.equal(exits.length, 0);
      assert.equal(outcome.hung, undefined);
      assert.equal(outcome.e, undefined);
      assert.equal(outcome.v && outcome.v.reason, 'sealer_unavailable');
      assert.equal(unhandled.length, 0);
      const packed = [inspect(lines, { depth: 8 }), JSON.stringify(lines), inspect(outcome.v, { depth: 8 })].join('\n');
      assert.equal(packed.includes('sealer_unavailable'), true);
      assert.equal(packed.includes('close blew up'), false);
    } finally {
      process.exit = origExit;
      process.off('unhandledRejection', onUnhandled);
      resetSealerGuardForTest();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('CG10 a close refusal does not leak a key, a session, or a key id', async () => {
    resetSealerGuardForTest();
    const { root, sealer } = fresh();
    const access = `AKIA${'Q'.repeat(16)}`;
    const session = `sess-${'w'.repeat(24)}`;
    const arn = runtimeArn();
    const lines = [];
    const blown = new Error(`${access} ${arn}`);
    blown.cause = session;
    const boom = new Proxy(sealer, {
      get(target, prop, receiver) {
        if (prop === 'state') throw blown;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await guardCloseHour(boom, {
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: async () => '0xabc',
      accessKeyId: access,
      sessionToken: session,
      keyId: arn,
    }, {
      env: { CHIT_SEALER_CLOSE_TIMEOUT_MS: '20000' },
      log: (fields, msg) => lines.push(fields, msg),
    });
    const packed = [
      inspect(lines, { depth: 8 }),
      inspect(result, { depth: 8 }),
      JSON.stringify(lines),
      JSON.stringify(result),
      result && result.reason,
    ].join('\n');
    assert.equal(result.reason, 'sealer_unavailable');
    assert.equal(lines.some((part) => part && part.code === 'sealer_unavailable'), true);
    for (const needle of [access, session, arn]) assert.equal(packed.includes(needle), false);
    resetSealerGuardForTest();
    rmSync(root, { recursive: true, force: true });
  });

  test('CG11 a symlink swapped in after lstat is refused, and mode 0600 still boots', async () => {
    const material = checkpointMaterial();
    const profile = 'checkpoint-cg11';
    const accepted = makeHouseTree();
    const okFile = writeIni(accepted.credsDir, {
      profile,
      accessKey: 'cg11-ok-access',
      secret: 'cg11-ok-secret',
      mode: 0o600,
    });
    const okTransport = kmsTransport(material.spki);
    const ok = await boot(bootEnv(accepted, okFile, profile), {
      testInjection: true,
      addressOf: () => MAINNET_CHECKPOINT,
      requestHandler: okTransport.requestHandler,
    });
    assert.equal(ok.err, null);
    assert.equal(ok.out && ok.out.wired, true);
    assert.equal(lstatSync(okFile).uid, process.getuid());
    if (ok.runtime && ok.runtime.client && typeof ok.runtime.client.destroy === 'function') ok.runtime.client.destroy();
    setV13Runtime(null);
    rmSync(accepted.root, { recursive: true, force: true });

    const tree = makeHouseTree();
    const decoy = writeIni(tree.credsDir, {
      profile,
      accessKey: 'cg11-decoy-access',
      secret: 'cg11-decoy-secret',
      name: 'decoy',
    });
    const file = writeIni(tree.credsDir, {
      profile,
      accessKey: 'cg11-real-access',
      secret: 'cg11-real-secret',
    });
    let swapped = false;
    const io = {
      lstatSync(target) {
        const st = lstatSync(target);
        if (target === file && !swapped && typeof st.isFile === 'function' && st.isFile()) {
          swapped = true;
          unlinkSync(file);
          symlinkSync(decoy, file);
          return st;
        }
        return lstatSync(target);
      },
      openSync(target, flags) { return openSync(target, flags); },
      fstatSync(fd) { return fstatSync(fd); },
      readSync(fd, buf, offset, length, position) { return readSync(fd, buf, offset, length, position); },
      closeSync(fd) { return closeSync(fd); },
    };
    const transport = kmsTransport(material.spki);
    const outcome = await boot(bootEnv(tree, file, profile), {
      testInjection: true,
      addressOf: () => MAINNET_CHECKPOINT,
      requestHandler: transport.requestHandler,
      fs: io,
    });
    assert.equal(swapped, true);
    assert.equal(outcome.out, null);
    assert.equal(outcome.err && outcome.err.code, 'v13_boot_refused');
    assert.equal(outcome.err.reason, 'checkpoint_creds_not_regular');
    assert.equal(outcome.runtime, null);
    assert.equal(transport.calls.length, 0);
    setV13Runtime(null);
    rmSync(tree.root, { recursive: true, force: true });
  });

  test('CG12 a plain-object send at the leftover sites is a TypeError the test asserts', async () => {
    const material = checkpointMaterial();
    const digest = Buffer.alloc(32, 4);
    const made = material.sign(digest);
    assert.ok(made);
    const transport = kmsTransport(material.spki);
    transport.requestHandler = {
      async handle(request) {
        const target = String((request.headers || {})['x-amz-target'] || '');
        transport.calls.push(target);
        const signing = target.endsWith('.Sign');
        const payload = signing
          ? { Signature: Buffer.from(made.der).toString('base64'), SigningAlgorithm: 'ECDSA_SHA_256' }
          : {
            KeySpec: 'ECC_SECG_P256K1',
            KeyUsage: 'SIGN_VERIFY',
            SigningAlgorithms: ['ECDSA_SHA_256'],
            PublicKey: Buffer.from(material.spki).toString('base64'),
          };
        return {
          response: {
            statusCode: 200,
            headers: { 'content-type': 'application/x-amz-json-1.1' },
            body: Buffer.from(JSON.stringify(payload)),
          },
        };
      },
    };
    let anchorErr = null;
    try {
      await signMainnetCheckpoint({
        env: signerEnv(MAINNET_CHECKPOINT),
        client: realKms(transport.requestHandler),
        addressOf: () => MAINNET_CHECKPOINT,
        digest,
      });
    } catch (err) {
      anchorErr = err;
    }
    assert.equal(anchorErr instanceof TypeError, false);
    assert.equal(anchorErr && anchorErr.code, 'checkpoint_address_mismatch');

    const armTransport = kmsTransport(material.spki);
    let armErr = null;
    let armed = null;
    try {
      armed = await issueHouseReceipt({
        env: {
          CHIT_V13_MAINNET_SEALER: 'true',
          CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/cg-checkpoint',
          CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
          CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
        },
        task: byteTask(),
        receiptOpts: { signingSecret: 'byte-pin-secret', baseUrl: 'http://127.0.0.1:9', readOnly: true },
        client: realKms(armTransport.requestHandler),
      });
    } catch (err) {
      armErr = err;
    }
    assert.equal(armErr instanceof TypeError, false);
    assert.equal(armed && armed.status, 200);
    assert.equal(armTransport.calls.includes('TrentService.GetPublicKey'), true);
  });

  test('CG13 flags off do not build a client, open creds, or arm a loop', async () => {
    const tree = makeHouseTree();
    const creds = writeIni(tree.credsDir, {
      profile: 'checkpoint-cg13',
      accessKey: 'cg13-access',
      secret: 'cg13-secret',
      mode: 0o644,
    });
    const seen = { fs: false };
    const deps = {
      fs: {
        lstatSync() { seen.fs = true; throw new Error('statted'); },
        openSync() { seen.fs = true; throw new Error('opened'); },
      },
      openStore() { throw new Error('opened store'); },
    };
    const base = {
      CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: creds,
      CHIT_CHECKPOINT_AWS_PROFILE: 'checkpoint-cg13',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/cg-checkpoint',
      CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
      CHIT_V13_HOUSE_TOKEN_FILE: tree.token,
      CHIT_V13_STORE_PATH: tree.storeDir,
      CHIT_V13_HOUSE_BOOK_ID: tree.bookId,
    };
    const before = new Set(process._getActiveHandles());
    let unsetErr = null;
    let offErr = null;
    let unset;
    let off;
    try {
      try {
        unset = await wireV13Runtime(base, deps);
      } catch (err) {
        unsetErr = err;
      }
      try {
        off = await wireV13Runtime({
          ...base,
          CHIT_V13_ISSUANCE: 'false',
          CHIT_V13_MAINNET_SEALER: 'false',
          CHIT_V13_STORE: 'false',
        }, deps);
      } catch (err) {
        offErr = err;
      }
      assert.equal(unsetErr, null);
      assert.equal(offErr, null);
      assert.equal(unset.wired, false);
      assert.equal(off.wired, false);
      assert.equal(seen.fs, false);
      const started = process._getActiveHandles().filter((handle) => !before.has(handle));
      assert.equal(started.length, 0);
    } finally {
      for (const handle of process._getActiveHandles()) {
        if (!before.has(handle)) clearInterval(handle);
      }
    }
    const src = readFileSync(new URL('../../gateway/src/server.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function startServer'), src.indexOf('export default createApp'));
    assert.equal(body.includes('guardCloseHour'), false);
    assert.equal(body.includes('closeHour'), false);
    assert.equal(body.includes('setInterval'), false);
    rmSync(tree.root, { recursive: true, force: true });
  });
});
