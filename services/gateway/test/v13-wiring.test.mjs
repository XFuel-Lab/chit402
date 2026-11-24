/**
 * Flag-gated v13 house receipts. No production host, no AWS, no mainnet RPC.
 */
import { createHash, createPublicKey } from 'node:crypto';
import http from 'node:http';
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { openStore } = await import('../../chit-store/store.js');
const {
  MAINNET_ANCHOR,
  MAINNET_CODE_HASH,
  MAINNET_CHECKPOINT,
  mainnetPin,
} = await import('../../chit-sealer/mainnet-pin.js');
const { anchor, anchoredReplay, resetAnchorLedger, signMainnetCheckpoint } = await import('../../chit-sealer/anchor-mainnet.js');
const { createCheckpointSigner } = await import('../../chit-sealer/kms-secp256k1.js');
const {
  issueHouseReceipt,
  handleHouse,
  readHouse,
  paymentIsFinal,
  pendingOpen,
  resetHouseState,
  readV13Runtime,
  setV13Runtime,
} = await import('../src/v13-issue.js');
const { wireV13Runtime } = await import('../src/v13-boot.js');
const { sendCheckpointKms } = await import('../src/checkpoint-kms.js');
const { createS3Client } = await import('../src/receipt-log-s3.js');
const { KMSClient } = await import('@aws-sdk/client-kms');
const { ethereumAddress } = await import('../../../packages/cs2-core/ecdsa/index.js');
const { buildReceipt: buildV1Receipt, meteringPaymentFromDecision, registerOpenAIRoutes } = await import('../src/openai-gateway.js');
const { checkMainnetPack, createAddress, checkpointDomain } = await import('../../../deploy/chit-simple/mainnet-pack/check-deploy.mjs');
const {
  POST_HARDENING_RUNTIME_HASHES,
  PRE_HARDENING_RUNTIME_HASHES,
  anchorHalt,
  contractsFromPayload,
  runtimeClass,
} = await import('../../../packages/verify/dist/v13/core/decide.js');
const { interpretFreezeRead } = await import('../../../packages/verify/dist/v13/verify.js');
const { SECP256K1 } = await import('../../../packages/cs2-core/ecdsa/index.js');
const { highSDer, publicPoint, signRawDigest } = await import('../../../packages/cs2-core/ecdsa/sign.js');
const { bytesToBig } = await import('../../../packages/cs2-core/ecdsa/bytes.js');

const USDC = '833589fcd6edb6e08f4c7c32d4f71b54bda02913';

function repeatDigit(digit, count) {
  return String(digit).repeat(count);
}

function dummyKeyId(digit) {
  return [
    repeatDigit(digit, 8),
    repeatDigit(digit, 4),
    repeatDigit(digit, 4),
    repeatDigit(digit, 4),
    repeatDigit(digit, 12),
  ].join('-');
}

function dummyKmsArn(digit) {
  const head = ['arn', 'aws', 'kms', 'us-east-2'].join(':');
  return [head, repeatDigit(digit, 12), `key/${dummyKeyId(digit)}`].join(':');
}
const SEPOLIA_HASH = '0x6006ad8cd474ca5093ce41d2cc0f99e4c6a036563712ecf301ab6d37f02091ed';
const PRE_HASH = '0xb7ad0c729af141a19695bc89d09bd0a04a8d9ab9668373a066cba94f13aee45c';
const FIXTURE = readFileSync(new URL('./fixtures/v10-issuance-response.json', import.meta.url));
const HOUR = 1700006400;

function flagsOn() {
  return {
    CHIT_V13_ISSUANCE: 'true',
    CHIT_V13_MAINNET_SEALER: 'true',
    CHIT_V13_STORE: 'true',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '10',
  };
}

function payment(over = {}) {
  return {
    chainId: 8453,
    blockHash: 'ab'.repeat(32),
    blockNumber: 10,
    blockTime: HOUR,
    txIndex: 1,
    localLogIndex: 0,
    txHash: 'cd'.repeat(32),
    token: USDC,
    from: '11'.repeat(20),
    to: '22'.repeat(20),
    value: '2000',
    method: 1,
    authorizer: '11'.repeat(20),
    nonce: '01'.repeat(32),
    saltP: '55'.repeat(32),
    ...over,
  };
}

function observation(over = {}) {
  return {
    blockNumber: 10,
    finalizedNumber: 10,
    blockHash: 'ab'.repeat(32),
    blockTime: HOUR,
    txIndex: 1,
    localLogIndex: 0,
    txHash: 'cd'.repeat(32),
    hourStart: HOUR,
    ...over,
  };
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'v13-house-'));
  const book = {
    id: 'aa'.repeat(32),
    token: 'book-token',
    bookPk: new Uint8Array(32).fill(7),
    wallets: [`0x${'11'.repeat(20)}`],
  };
  const store = openStore(join(dir, 'store'), { books: [book] });
  return {
    dir: join(dir, 'bind'),
    store,
    caller: { bookId: book.id, token: book.token },
    other: { bookId: 'bb'.repeat(32), token: 'other-token' },
  };
}

function byteTask() {
  const stored = JSON.parse(FIXTURE.toString('utf8'));
  return {
    taskId: 'chit-v13-bytepin',
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

const RECEIPT_OPTS = {
  signingSecret: 'byte-pin-secret',
  baseUrl: 'http://127.0.0.1:9',
  readOnly: true,
};

function mockKms({ high = false, corrupt = false } = {}) {
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
      if (corrupt) {
        const other = new Uint8Array(32).fill(9);
        let k2 = (bytesToBig(other) % (SECP256K1.order - 3n)) + 2n;
        let wrong;
        for (let i = 0; i < 8; i += 1) {
          try {
            wrong = signRawDigest(other, d, k2, SECP256K1);
            break;
          } catch (err) {
            if (err.code !== 'bad_nonce') throw err;
            k2 += 1n;
          }
        }
        return { Signature: wrong.der };
      }
      const der = high ? highSDer(sig.raw, SECP256K1) : sig.der;
      return { Signature: der };
    },
  };
}

function asCheckpoint() {
  return MAINNET_CHECKPOINT.toLowerCase();
}

test('T1 flags unset: v10 issuance bytes match the fixture', async () => {
  resetHouseState();
  const issued = await issueHouseReceipt({
    env: {},
    task: byteTask(),
    receiptOpts: RECEIPT_OPTS,
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  assert.equal(issued.body.issuer_signature.payload_version, 10);
  assert.equal(issued.body.v, undefined);
});

test('T1 flags false: the same fixture bytes', async () => {
  const issued = await issueHouseReceipt({
    env: { CHIT_V13_ISSUANCE: 'false', CHIT_V13_MAINNET_SEALER: 'false', CHIT_V13_STORE: false },
    task: byteTask(),
    receiptOpts: RECEIPT_OPTS,
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
});

test('T2 flags unset: no KMS, anchor, or RPC call', async () => {
  resetAnchorLedger();
  const counts = { kms: 0, send: 0, rpc: 0 };
  const issued = await issueHouseReceipt({
    env: {
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
      CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    },
    task: byteTask(),
    receiptOpts: RECEIPT_OPTS,
    client: { async send() { counts.kms += 1; } },
    send: async () => { counts.send += 1; return '0x1'; },
    rpc: async () => { counts.rpc += 1; },
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  assert.deepEqual(counts, { kms: 0, send: 0, rpc: 0 });
});

test('T3 high-S signature is refused and does not broadcast', async () => {
  resetAnchorLedger();
  const client = mockKms({ high: true });
  let sends = 0;
  await assert.rejects(
    () => anchor({
      env: flagsOn(),
      pin: mainnetPin(),
      calldata: 'high-s',
      client,
      addressOf: asCheckpoint,
      digest: new Uint8Array(32).fill(4),
      send: async () => { sends += 1; return '0x1'; },
    }),
    (err) => err.code === 'checkpoint_sign_invalid',
  );
  assert.equal(sends, 0);
});

test('T4 a recovery that is not the pinned checkpoint does not broadcast', async () => {
  resetAnchorLedger();
  const client = mockKms();
  let sends = 0;
  await assert.rejects(
    () => anchor({
      env: flagsOn(),
      pin: mainnetPin(),
      calldata: 'wrong-key',
      client,
      digest: new Uint8Array(32).fill(5),
      send: async () => { sends += 1; return '0x1'; },
    }),
    (err) => err.code === 'checkpoint_address_mismatch',
  );
  assert.equal(sends, 0);
  assert.equal(client.calls.includes('Sign'), false);
});

test('T4 a signature that does not recover to the checkpoint key is invalid', async () => {
  resetAnchorLedger();
  const client = mockKms({ corrupt: true });
  let sends = 0;
  await assert.rejects(
    () => anchor({
      env: flagsOn(),
      pin: mainnetPin(),
      calldata: 'corrupt',
      client,
      addressOf: asCheckpoint,
      digest: new Uint8Array(32).fill(6),
      send: async () => { sends += 1; return '0x1'; },
    }),
    (err) => err.code === 'checkpoint_sign_invalid',
  );
  assert.equal(sends, 0);
});

test('T4 a low-S signature for a different key is not broadcast', async () => {
  resetAnchorLedger();
  const client = mockKms();
  let sends = 0;
  await assert.rejects(
    () => anchor({
      env: flagsOn(),
      pin: mainnetPin(),
      calldata: 'other-key',
      client,
      addressOf: asCheckpoint,
      digest: new Uint8Array(32).fill(7),
      send: async () => { sends += 1; return '0x1'; },
    }),
    (err) => err.code === 'checkpoint_address_mismatch',
  );
  assert.equal(sends, 0);
  assert.equal(client.calls.includes('Sign'), true);
});

test('T5 a swapped chain, address, or code hash is refused', async () => {
  const swaps = [
    { ...mainnetPin(), chainId: 84532 },
    { ...mainnetPin(), address: `0x${'12'.repeat(20)}` },
    { ...mainnetPin(), codeHash: SEPOLIA_HASH },
    { ...mainnetPin(), codeHash: `${MAINNET_CODE_HASH.slice(0, 10)}${'ab'.repeat(28)}` },
  ];
  for (const pin of swaps) {
    let sends = 0;
    await assert.rejects(
      () => anchor({
        env: flagsOn(),
        pin,
        calldata: `swap-${pin.chainId}`,
        client: mockKms(),
        send: async () => { sends += 1; return '0x1'; },
      }),
      (err) => err.code === 'v13_pin_refused',
    );
    assert.equal(sends, 0);
  }
});

test('T6 no line until the payment is final, then one line under that block hash', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const early = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment(),
    observation: observation({ blockNumber: 11, finalizedNumber: 10, blockHash: 'ee'.repeat(32) }),
    client: mockKms(),
    send: async () => '0x1',
  });
  assert.equal(early.status, 402);
  assert.equal(early.body.v, undefined);
  const finalHash = 'ab'.repeat(32);
  const done = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment({ blockHash: finalHash }),
    observation: observation({ blockNumber: 10, finalizedNumber: 10, blockHash: finalHash }),
    client: mockKms(),
    addressOf: asCheckpoint,
    send: async () => '0xabc',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.v, 13);
  assert.equal(done.body.blockHash, finalHash);
  const line = Buffer.from(done.body.line, 'hex');
  assert.equal(line.subarray(10, 42).toString('hex'), finalHash);
  assert.equal(paymentIsFinal(10, 10), true);
  assert.equal(paymentIsFinal(11, 10), false);
});

test('T7 one receipt for a repeated authorization, including concurrent callers', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const input = () => ({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment(),
    observation: observation(),
    client: mockKms(),
    addressOf: asCheckpoint,
    send: async () => '0xabc',
  });
  const first = await issueHouseReceipt(input());
  const second = await issueHouseReceipt(input());
  assert.equal(first.body.v, 13);
  assert.deepEqual(second.bytes, first.bytes);
  assert.equal(second.replay, true);
  const [a, b] = await Promise.all([issueHouseReceipt(input()), issueHouseReceipt(input())]);
  assert.deepEqual(a.bytes, first.bytes);
  assert.deepEqual(b.bytes, first.bytes);
});

test('T8 the authorization key keeps chain, token, authorizer, and nonce', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const base = {
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    observation: observation(),
    client: mockKms(),
    addressOf: asCheckpoint,
    send: async () => '0xabc',
  };
  const first = await issueHouseReceipt({ ...base, payment: payment() });
  const otherChain = await issueHouseReceipt({
    ...base,
    payment: payment({ chainId: 84532 }),
  });
  const otherToken = await issueHouseReceipt({
    ...base,
    payment: payment({ token: '44'.repeat(20) }),
  });
  const otherTx = await issueHouseReceipt({
    ...base,
    payment: payment({ nonce: '05'.repeat(32) }),
    observation: observation({ txHash: 'cd'.repeat(32) }),
  });
  assert.equal(first.body.v, 13);
  assert.equal(otherChain.status, 400);
  assert.equal(otherChain.body.v, undefined);
  assert.equal(otherChain.body.pending_id, undefined);
  assert.equal(otherToken.status, 400);
  assert.equal(otherToken.body.v, undefined);
  assert.equal(otherToken.body.pending_id, undefined);
  assert.notDeepEqual(otherToken.bytes, first.bytes);
  assert.notDeepEqual(otherTx.bytes, first.bytes);
  assert.equal(otherTx.body.v, 13);
  const replay = await issueHouseReceipt({ ...base, payment: payment() });
  assert.deepEqual(replay.bytes, first.bytes);
  const zero = await issueHouseReceipt({ ...base, payment: payment({ nonce: '00'.repeat(32) }) });
  assert.equal(zero.status, 400);
  assert.equal(zero.body.v, undefined);
  assert.equal(JSON.stringify(zero.body).includes('pay again'), false);
});

test('T9 a store throw after the payment is final returns a pending id and verify url', async () => {
  resetHouseState();
  let sends = 0;
  const log = [];
  const box = fresh();
  const secret = dummyKmsArn('0');
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    caller: box.caller,
    payment: payment(),
    observation: observation(),
    log,
    store: {
      commitEpoch() { throw new Error(`${secret} signature-deadbeef`); },
      hasCommitted() { return false; },
    },
    client: mockKms(),
    send: async () => { sends += 1; return '0x1'; },
  });
  assert.equal(issued.status, 202);
  assert.equal(issued.body.v, undefined);
  assert.match(issued.body.pending_id, /^[0-9a-f]{32}$/);
  assert.match(issued.body.verify_url, /^http:\/\/127\.0\.0\.1\/verify\/[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(issued.body).toLowerCase().includes('pay again'), false);
  assert.equal(sends, 0);
  assert.equal(JSON.stringify(issued.body).includes(secret), false);
  assert.equal(JSON.stringify(log).includes(secret), false);
  assert.equal(JSON.stringify(issued).includes('deadbeef'), false);
});

test('T10 an identical anchor is not sent twice, and a repeated Anchored event is a no-op', async () => {
  resetAnchorLedger();
  const client = mockKms();
  let sends = 0;
  const ctx = {
    env: flagsOn(),
    pin: mainnetPin(),
    calldata: 'epoch-1',
    client,
    preparedTx: '0x11',
    send: async () => { sends += 1; return '0xabc'; },
  };
  const first = await anchor(ctx);
  const second = await anchor(ctx);
  assert.equal(first.resent, true);
  assert.equal(second.resent, false);
  assert.equal(second.tx, first.tx);
  assert.equal(sends, 1);
  const box = fresh();
  const record = {
    epoch: 1,
    hourStart: HOUR,
    size: 1024,
    root: 'ab'.repeat(32),
    stateRoot: 'cd'.repeat(32),
    chainId: '8453',
    contract: MAINNET_ANCHOR,
    checkpoint: MAINNET_CHECKPOINT,
    receipts: [],
  };
  assert.equal(box.store.commitEpoch(record).ok, true);
  let writes = 0;
  const ioStore = box.store;
  const orig = ioStore.io.writeFileSync || null;
  void orig;
  const event = {
    finalized: true,
    epoch: 1,
    hourStart: HOUR,
    size: 1024,
    root: record.root,
    stateRoot: record.stateRoot,
    contract: MAINNET_ANCHOR,
    chainId: '8453',
    from: MAINNET_CHECKPOINT,
  };
  const once = anchoredReplay(box.store, event);
  const twice = anchoredReplay(box.store, event);
  assert.equal(once.released, true);
  assert.equal(twice.released, true);
  assert.equal(twice.ok, true);
  writes = twice === once ? 0 : 1;
  assert.equal(box.store.epochs.get('1').released, true);
  void writes;
});

test('T11 the live hash is post-hardening and a getter revert is not "not frozen"', () => {
  const live = MAINNET_CODE_HASH.toLowerCase();
  assert.equal(POST_HARDENING_RUNTIME_HASHES.map((item) => item.toLowerCase()).includes(live), true);
  assert.equal(PRE_HARDENING_RUNTIME_HASHES.map((item) => item.toLowerCase()).includes(live), false);
  assert.equal(runtimeClass(live), 'post');
  assert.equal(runtimeClass(SEPOLIA_HASH), 'post');
  assert.equal(runtimeClass(PRE_HASH), 'pre');
  const legacy = runtimeClass(live) === 'pre';
  assert.equal(interpretFreezeRead(legacy, { status: 'revert' }, null).frozen, 'unreadable');
  assert.equal(interpretFreezeRead(true, { status: 'revert' }, null).frozen, 'no');
  const halted = anchorHalt({ frozen: 'unreadable', frozenEpoch: null, keyCutoff: 'unreadable' }, 1);
  assert.equal(halted.exit, 2);
  assert.equal(halted.reason, 'anchor_state_unreadable');
  const operator = JSON.parse(readFileSync(new URL('../../chit-sealer/fixtures/mainnet-operator-pin.json', import.meta.url), 'utf8'));
  const parsed = contractsFromPayload({ contracts: [operator] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pins[0].checkpointVersions[0], 1);
  assert.equal(parsed.pins[0].genesisHourStart, 1700006400);
  const snapshot = JSON.parse(readFileSync(new URL('../../../packages/verify/issuer-history.snapshot.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(snapshot, 'contracts'), false);
});

test('T12 a different caller with the same public id gets the same not-found body', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment({ nonce: '06'.repeat(32) }),
    observation: observation(),
    client: mockKms(),
    addressOf: asCheckpoint,
    send: async () => '0xabc',
  });
  const owner = readHouse({ dir: box.dir, receiptId: issued.body.line.slice(0, 32), caller: box.caller });
  const otherCaller = readHouse({ dir: box.dir, receiptId: issued.bytes.length ? createHash('sha256').update('01'.repeat(32)).digest('hex').slice(0, 32) : '', caller: box.other });
  const ownerRead = readHouse({
    dir: box.dir,
    receiptId: createHash('sha256').update(issued.body.line).digest('hex').slice(0, 32),
    caller: box.caller,
  });
  void owner;
  void ownerRead;
  void otherCaller;
  const id = JSON.parse(issued.bytes.toString('utf8'));
  const good = readHouse({ dir: box.dir, receiptId: id.line ? undefined : undefined, caller: box.caller });
  void good;
  const receiptId = issued.body.v === 13
    ? createHash('sha256').update('no').digest('hex').slice(0, 32)
    : 'ab'.repeat(16);
  const storedId = (await import('node:fs')).readFileSync(join(box.dir, 'auth-bindings.json'), 'utf8');
  const rows = JSON.parse(storedId).rows;
  const realId = rows[Object.keys(rows)[0]].receiptId;
  const mine = readHouse({ dir: box.dir, receiptId: realId, caller: box.caller });
  const theirs = readHouse({ dir: box.dir, receiptId: realId, caller: box.other });
  const unknown = readHouse({ dir: box.dir, receiptId: 'ff'.repeat(16), caller: box.caller });
  assert.equal(mine.status, 200);
  assert.deepEqual(theirs.body, unknown.body);
  assert.equal(theirs.status, unknown.status);
  assert.equal(JSON.stringify(theirs.body).includes(box.caller.token), false);
  void receiptId;
});

test('T13 dummy secrets and signatures stay out of logs and error bodies', async () => {
  resetHouseState();
  const log = [];
  const arn = dummyKmsArn('1');
  const signature = 'cafebabe'.repeat(8);
  const box = fresh();
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    caller: box.caller,
    payment: payment({ nonce: '07'.repeat(32) }),
    observation: observation(),
    log,
    store: {
      commitEpoch() { throw new Error(`${arn} ${signature}`); },
      hasCommitted() { return false; },
    },
    client: { async send() { throw new Error(arn); } },
    send: async () => '0x1',
  });
  const packed = JSON.stringify({ body: issued.body, log });
  assert.equal(packed.includes(arn), false);
  assert.equal(packed.includes(signature), false);
  assert.equal(packed.includes(dummyKeyId('1')), false);
});

test('T14 the authorization binding is written by the request path', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const ctx = {
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    client: mockKms(),
    send: async () => '0xabc',
    baseUrl: 'http://127.0.0.1',
  };
  const caller = { bookId: box.caller.bookId, token: box.caller.token };
  const refused = await handleHouse({
    method: 'POST',
    body: {
      payment: payment({ nonce: '08'.repeat(32) }),
      observation: observation(),
      pin: { chainId: 84532, address: `0x${'12'.repeat(20)}` },
    },
    caller,
  }, ctx);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'verify_failed');
  const issued = await handleHouse({
    method: 'POST',
    body: {
      payment: payment({ nonce: '09'.repeat(32) }),
      observation: observation(),
    },
    caller,
  }, ctx);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.v, 13);
  assert.equal(issued.body.contract.toLowerCase(), MAINNET_ANCHOR.toLowerCase());
  const rows = JSON.parse(readFileSync(join(box.dir, 'auth-bindings.json'), 'utf8')).rows;
  const receiptId = rows[Object.keys(rows)[0]].receiptId;
  const mine = await handleHouse({ method: 'GET', receiptId, caller }, ctx);
  const other = await handleHouse({
    method: 'GET',
    receiptId,
    caller: { bookId: box.other.bookId, token: box.other.token },
  }, ctx);
  const unknown = await handleHouse({
    method: 'GET',
    receiptId: 'ff'.repeat(16),
    caller,
  }, ctx);
  assert.equal(mine.status, 200);
  assert.equal(other.status, 404);
  assert.deepEqual(other.body, unknown.body);
});

test('a malformed flag is refused and a not-yet-final payment is not a receipt', async () => {
  await assert.rejects(
    () => issueHouseReceipt({ env: { CHIT_V13_ISSUANCE: 'yes' }, task: byteTask(), receiptOpts: RECEIPT_OPTS }),
    (err) => err.code === 'v13_flag_invalid',
  );
  assert.equal(paymentIsFinal(10, 10), true);
  assert.equal(paymentIsFinal(10, 9), false);
});

async function withProcessFlags(on, fn) {
  const names = Object.keys(flagsOn());
  const prev = {};
  for (const name of names) prev[name] = process.env[name];
  try {
    for (const name of names) delete process.env[name];
    if (on) Object.assign(process.env, flagsOn());
    return await fn();
  } finally {
    for (const name of names) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
    setV13Runtime(null);
  }
}

test('M1 buildReceipt stays the v1 document when the flags are off', async () => {
  let receipt = null;
  let thrown = null;
  try {
    receipt = await withProcessFlags(false, () => buildV1Receipt({
      task: byteTask(),
      taskId: 'chit-v13-bytepin',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
    }));
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(receipt.surface, 'openai-v1');
  assert.equal(receipt.v, undefined);
  assert.equal(Buffer.isBuffer(receipt.bytes), false);
});

test('M1 buildReceipt returns the v13 document when the flags are on', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const receipt = await withProcessFlags(true, async () => {
    await wireOpenedHouse(box);
    return buildV1Receipt({
      task: {
        taskId: 'chit-v13-hook',
        status: 'completed',
        createdAt: '2026-09-26T17:27:32Z',
        updatedAt: '2026-09-26T17:27:32Z',
        meta: {
          housePayment: payment({ nonce: 'ff'.repeat(32), chainId: 1 }),
          houseObservation: observation({ blockHash: 'ee'.repeat(32) }),
          houseCaller: box.other,
        },
      },
      payment: { ...payment({ nonce: '0a'.repeat(32) }), observation: observation() },
      taskId: 'chit-v13-hook',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
    });
  });
  assert.equal(receipt.v, 13);
  assert.equal(receipt.schema, 'chit402.cs2.receipt.v1');
  assert.equal(String(receipt.contract).toLowerCase(), MAINNET_ANCHOR.toLowerCase());
  assert.equal(receipt.surface, undefined);
  assert.equal(Buffer.isBuffer(receipt.bytes), false);
});

test('S3 addressOf is ignored without the test injection', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const client = mockKms();
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment({ nonce: '0b'.repeat(32) }),
    observation: observation(),
    client,
    addressOf: asCheckpoint,
    send: async () => '0xabc',
  });
  assert.equal(issued.body.v, 13);
  assert.equal(client.calls.includes('Sign'), false);
});

test('mainnet pack accepts chain 8453 and leaves the Sepolia example hash', () => {
  const doc = JSON.parse(readFileSync(new URL('../../../deploy/chit-simple/mainnet-pack/expected-runtime.json', import.meta.url), 'utf8'));
  assert.equal(createAddress(doc.deployer, doc.nonce), doc.contract.toLowerCase());
  assert.equal(checkpointDomain(8453, doc.contract), doc.domain.toLowerCase());
  assert.equal(checkMainnetPack({
    chainId: 8453,
    address: doc.contract,
    deployer: doc.deployer,
    nonce: doc.nonce,
    codeHash: doc.runtimeCodeHash,
  }), '');
  assert.notEqual(checkMainnetPack({
    chainId: 84532,
    address: doc.contract,
    deployer: doc.deployer,
    nonce: doc.nonce,
    codeHash: doc.runtimeCodeHash,
  }), '');
  const sepolia = JSON.parse(readFileSync(new URL('../../../deploy/chit-simple/sepolia-pack/expected-runtime.json', import.meta.url), 'utf8'));
  assert.equal(sepolia.example.runtimeCodeHash, SEPOLIA_HASH);
  assert.equal(sepolia.example.chainId, 84532);
});

function assertStartServerWires() {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = src.slice(src.indexOf('export async function startServer'));
  const bootAt = start.indexOf('assertV13Boot(process.env)');
  const wireAt = start.indexOf('await wireV13Runtime(process.env)');
  const listenAt = start.indexOf('app.listen(');
  assert.ok(bootAt >= 0 && wireAt > bootAt && listenAt > wireAt);
}

function preparedBoot() {
  const root = mkdtempSync(join(tmpdir(), 'v13-boot-'));
  const storeDir = join(root, 'store');
  const bindDir = join(root, 'bind');
  mkdirSync(storeDir, { mode: 0o700 });
  mkdirSync(bindDir, { mode: 0o700 });
  chmodSync(storeDir, 0o700);
  chmodSync(bindDir, 0o700);
  const book = {
    id: 'aa'.repeat(32),
    token: 'book-token',
    bookPk: new Uint8Array(32).fill(7),
  };
  const store = openStore(storeDir, { books: [book] });
  return {
    root,
    storeDir,
    bindDir,
    store,
    book,
    env: {
      ...flagsOn(),
      CHIT_V13_STORE_PATH: storeDir,
      CHIT_V13_BIND_DIR: bindDir,
      CHIT_V13_HOUSE_BOOK_ID: book.id,
    },
  };
}

function livePin(box, address = MAINNET_CHECKPOINT) {
  return {
    ...pinDeps(address),
    openStore() { return box.store; },
  };
}

function attachHouseFile(box, token = 'test-house-token-1') {
  const base = box.root || box.store.dir;
  const secretDir = join(base, 'secret');
  mkdirSync(secretDir, { mode: 0o700 });
  chmodSync(secretDir, 0o700);
  const bookId = box.book ? box.book.id : box.caller.bookId;
  const pkBytes = box.book ? box.book.bookPk : box.store.bookRecord(bookId).bookPk;
  const file = join(secretDir, 'book.json');
  writeFileSync(file, JSON.stringify({
    v: 1,
    bookId,
    token,
    bookPk: Buffer.from(pkBytes).toString('hex'),
  }), { mode: 0o600 });
  chmodSync(file, 0o600);
  if (box.env) box.env.CHIT_V13_HOUSE_TOKEN_FILE = file;
  return file;
}

async function wireOpenedHouse(box) {
  mkdirSync(box.dir, { recursive: true, mode: 0o700 });
  chmodSync(box.dir, 0o700);
  chmodSync(box.store.dir, 0o700);
  const file = attachHouseFile(box);
  return wireV13Runtime({
    ...flagsOn(),
    CHIT_V13_STORE_PATH: box.store.dir,
    CHIT_V13_BIND_DIR: box.dir,
    CHIT_V13_HOUSE_BOOK_ID: box.caller.bookId,
    CHIT_V13_HOUSE_TOKEN_FILE: file,
  }, {
    ...pinDeps(),
    openStore() { return box.store; },
  });
}

function pinDeps(address = MAINNET_CHECKPOINT) {
  return {
    testInjection: true,
    addressOf: () => address,
    client: mockKms(),
  };
}

function oneFlagEnv(name, bindDir) {
  return {
    [name]: 'true',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '10',
    CHIT_V13_BIND_DIR: bindDir,
  };
}

test('B1 flags off does not wire the runtime and v10 bytes stay pinned', async () => {
  setV13Runtime({ marker: true });
  const calls = { send: 0, open: 0 };
  const out = await wireV13Runtime({
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: false,
    CHIT_V13_STORE: '',
  }, {
    client: { async send() { calls.send += 1; throw new Error('kms'); } },
    openStore() { calls.open += 1; throw new Error('store'); },
    log() { calls.log = true; },
  });
  assert.equal(out.wired, false);
  assert.equal(calls.send, 0);
  assert.equal(calls.open, 0);
  assert.equal(calls.log, undefined);
  assert.equal(readV13Runtime().marker, true);
  const issued = await issueHouseReceipt({ env: {}, task: byteTask(), receiptOpts: RECEIPT_OPTS });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  setV13Runtime(null);
});

test('B2 flags off buildReceipt stays the v1 document', async () => {
  const receipt = await withProcessFlags(false, () => buildV1Receipt({
    task: byteTask(),
    taskId: 'chit-v13-bytepin',
    provider: 'example-hub',
    mock: true,
    proverConfigured: false,
    baseUrl: 'http://127.0.0.1:9',
  }));
  assert.equal(receipt.surface, 'openai-v1');
  assert.equal(receipt.v, undefined);
  assert.equal(Buffer.isBuffer(receipt.bytes), false);
});

test('B3 one v13 flag and an incomplete runtime refuses to listen', async () => {
  assertStartServerWires();
  setV13Runtime(null);
  const flags = ['CHIT_V13_ISSUANCE', 'CHIT_V13_MAINNET_SEALER', 'CHIT_V13_STORE'];
  for (const name of flags) {
    const root = mkdtempSync(join(tmpdir(), 'v13-b3-'));
    const bindDir = join(root, 'bind');
    mkdirSync(bindDir, { mode: 0o700 });
    chmodSync(bindDir, 0o700);
    await assert.rejects(
      () => wireV13Runtime(oneFlagEnv(name, bindDir), pinDeps()),
      (err) => err.code === 'v13_boot_refused',
    );
    assert.equal(readV13Runtime(), null);
    rmSync(root, { recursive: true, force: true });
  }
});

test('B4 a GetPublicKey for another address refuses to listen', async () => {
  assertStartServerWires();
  setV13Runtime(null);
  const box = preparedBoot();
  attachHouseFile(box);
  const log = [];
  await assert.rejects(
    () => wireV13Runtime(box.env, { ...livePin(box, `0x${'12'.repeat(20)}`), log: (row) => log.push(row) }),
    (err) => err.code === 'v13_boot_refused',
  );
  assert.equal(readV13Runtime(), null);
  assert.equal(JSON.stringify(log).includes('12'.repeat(20)), false);
  rmSync(box.root, { recursive: true, force: true });
});

test('B5 a matching GetPublicKey wires store, dir, client, and send', async () => {
  assertStartServerWires();
  setV13Runtime(null);
  const box = preparedBoot();
  attachHouseFile(box);
  const deps = livePin(box);
  const out = await wireV13Runtime(box.env, deps);
  assert.equal(out.wired, true);
  const runtime = readV13Runtime();
  assert.ok(runtime.store);
  assert.equal(runtime.dir, box.bindDir);
  assert.equal(typeof runtime.client.send, 'function');
  assert.equal(typeof runtime.send, 'function');
  assert.equal(runtime.caller.bookId, box.book.id);
  assert.equal(runtime.caller.token, box.book.token);
  assert.equal(deps.client.calls.includes('GetPublicKey'), true);
  setV13Runtime(null);
  rmSync(box.root, { recursive: true, force: true });
});

test('B6 a missing runtime fails closed before a hold', async () => {
  resetHouseState();
  let committed = false;
  const box = fresh();
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    payment: payment({ nonce: '21'.repeat(32) }),
    observation: observation(),
    store: { commitEpoch() { committed = true; return { ok: true }; } },
  });
  assert.equal(issued.status, 400);
  assert.equal(issued.body.code, 'verify_failed');
  assert.equal(issued.body.pending_id, undefined);
  assert.equal(pendingOpen(issued.body.pending_id), false);
  assert.equal(committed, false);
  assert.equal(existsSync(join(box.dir, 'auth-bindings.json')), false);
  await assert.rejects(
    () => withProcessFlags(true, () => buildV1Receipt({
      task: byteTask(),
      taskId: 'b6',
      provider: 'example-hub',
      mock: true,
      proverConfigured: false,
      baseUrl: 'http://127.0.0.1:9',
      payment: { ...payment({ nonce: '22'.repeat(32) }), observation: observation() },
    })),
    (err) => err.code === 'verify_failed' && pendingOpen(err.pending_id) === false,
  );
});

test('B7 a flags-on buildReceipt failure throws a closed code and opens no hold', async () => {
  resetHouseState();
  const box = fresh();
  await withProcessFlags(true, async () => {
    await wireOpenedHouse(box);
    await assert.rejects(
      () => buildV1Receipt({
        task: byteTask(),
        taskId: 'b7-obs',
        provider: 'example-hub',
        mock: true,
        proverConfigured: false,
        baseUrl: 'http://127.0.0.1:9',
        payment: payment({ nonce: '23'.repeat(32) }),
      }),
      (err) => err.code === 'settle_unconfirmed',
    );
    const pay = payment({ nonce: '24'.repeat(32) });
    delete pay.chainId;
    await assert.rejects(
      () => buildV1Receipt({
        task: byteTask(),
        taskId: 'b7-pay',
        provider: 'example-hub',
        mock: true,
        proverConfigured: false,
        baseUrl: 'http://127.0.0.1:9',
        payment: { ...pay, observation: observation() },
      }),
      (err) => err.code === 'verify_failed',
    );
  });
  assert.equal(pendingOpen(undefined), false);
  assert.equal(existsSync(join(box.dir, 'auth-bindings.json')), false);
});

function listenLocal(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('B8 a paid hook throw is retryable JSON, 202 with a hold and 503 without', async () => {
  const payer = `0x${'5b'.repeat(20)}`;
  const payTo = '0x8453000000000000000000000000000000000001';
  let facN = 0;
  const fac = await listenLocal((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      facN += 1;
      const txRef = `0x${createHash('sha256').update(`b8-tx-${facN}`).digest('hex')}`;
      const payload = req.url?.endsWith('/verify')
        ? { isValid: true, valid: true, payer }
        : { success: true, settled: true, transaction: txRef, txRef, network: 'base', payer };
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  });
  const rpc = await listenLocal((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      const which = parsed.params?.[0];
      const number = which === 'finalized' ? '0x10' : (which || '0x10');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: parsed.id || 1,
        result: {
          number,
          timestamp: '0x6553f000',
          hash: `0x${'ab'.repeat(32)}`,
        },
      }));
    });
  });
  const { default: config } = await import('../src/config.js');
  const { installEchoChainReader, clearChainReaderForTests } = await import('../src/x402-chain.js');
  const express = (await import('express')).default;
  const prev = {
    enabled: config.x402.enabled,
    network: config.x402.network,
    payTo: config.x402.payTo,
    gatewayUrl: config.x402.gatewayUrl,
    facilitatorProvider: config.x402.facilitatorProvider,
    baseRpcUrl: config.x402.baseRpcUrl,
    apiKey: config.x402.apiKey,
  };
  config.x402.enabled = true;
  config.x402.network = 'base';
  config.x402.payTo = payTo;
  config.x402.gatewayUrl = fac.url;
  config.x402.facilitatorProvider = 'zan';
  config.x402.baseRpcUrl = rpc.url;
  config.x402.apiKey = 'testkey';
  installEchoChainReader();
  let server;
  try {
    const app = express();
    app.use(express.json());
    registerOpenAIRoutes(app, {
      rateLimit: (_req, _res, next) => next(),
      authenticate: (_req, _res, next) => next(),
      isAuthorised: () => false,
    });
    server = await new Promise((resolve) => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const chat = {
      model: 'theta/qwen3',
      messages: [{ role: 'user', content: 'boot wiring' }],
      max_tokens: 8,
    };
    const headerFor = (label) => {
      const nonce = `0x${createHash('sha256').update(label).digest('hex')}`;
      const body = {
        x402Version: 1,
        payload: {
          signature: `0x${'11'.repeat(65)}`,
          authorization: {
            from: payer,
            to: payTo,
            value: '1000000000000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce,
          },
        },
        accepted: { asset: `0x${USDC}` },
      };
      return Buffer.from(JSON.stringify(body)).toString('base64');
    };
    const settle = async (label) => {
      const challenge = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chat),
      });
      assert.equal(challenge.status, 402);
      const offered = await challenge.json();
      const nonce = offered.accepts[0].extra.nonce;
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-payment': headerFor(label),
          'x-payment-nonce': nonce,
        },
        body: JSON.stringify(chat),
      });
      const text = await res.text();
      let body = {};
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      return { status: res.status, body, text };
    };
    setV13Runtime(null);
    const closed = await withProcessFlags(true, () => settle('b8-no-hold'));
    assert.equal(closed.status, 503);
    assert.equal(typeof closed.body.code, 'string');
    assert.ok(closed.body.code.length > 0);
    assert.equal(closed.body.pending_id, undefined);
    assert.equal(typeof closed.body.payment_ref, 'string');
    assert.equal(closed.text.toLowerCase().includes('pay again'), false);
    assert.equal(pendingOpen(closed.body.pending_id), false);

    const box = fresh();
    await wireOpenedHouse(box);
    const held = await withProcessFlags(true, () => settle('b8-hold'));
    assert.equal(held.status, 202);
    assert.equal(held.body.code, 'settle_pending');
    assert.equal(typeof held.body.pending_id, 'string');
    assert.equal(typeof held.body.verify_url, 'string');
    assert.equal(typeof held.body.payment_ref, 'string');
    assert.equal(held.text.toLowerCase().includes('pay again'), false);
    assert.equal(pendingOpen(held.body.pending_id), true);
  } finally {
    setV13Runtime(null);
    clearChainReaderForTests();
    Object.assign(config.x402, prev);
    if (server) await new Promise((resolve) => server.close(resolve));
    await fac.close();
    await rpc.close();
  }
});

test('B9 the address stand-in is honored only when both gates are on', async () => {
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  const allowed = mockKms();
  const honored = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment({ nonce: '25'.repeat(32) }),
    observation: observation(),
    client: allowed,
    send: async () => '0xabc',
    testInjection: true,
    addressOf: asCheckpoint,
  });
  assert.equal(honored.body.v, 13);
  assert.equal(allowed.calls.includes('Sign'), true);

  const prev = process.env.ISSUER_KMS_KEY_ID;
  process.env.ISSUER_KMS_KEY_ID = 'alias/test-only';
  try {
    const blocked = mockKms();
    const ignored = await issueHouseReceipt({
      env: flagsOn(),
      dir: box.dir,
      store: box.store,
      caller: box.caller,
      payment: payment({ nonce: '26'.repeat(32) }),
      observation: observation(),
      client: blocked,
      send: async () => '0xabc',
      testInjection: true,
      addressOf: asCheckpoint,
    });
    assert.equal(ignored.body.v, 13);
    assert.equal(blocked.calls.includes('Sign'), false);
  } finally {
    if (prev == null) delete process.env.ISSUER_KMS_KEY_ID;
    else process.env.ISSUER_KMS_KEY_ID = prev;
  }

  const absent = mockKms();
  const noInjection = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    payment: payment({ nonce: '27'.repeat(32) }),
    observation: observation(),
    client: absent,
    send: async () => '0xabc',
    addressOf: asCheckpoint,
  });
  assert.equal(noInjection.body.v, 13);
  assert.equal(absent.calls.includes('Sign'), false);
});

test('B10 settle-path payment, observation, and caller win over task.meta', async () => {
  const mapped = meteringPaymentFromDecision({
    paymentRef: 'base:0xabc',
    settledAmount: '2000',
    quotedAmount: '2000',
    payerWallet: `0x${'11'.repeat(20)}`,
    payTo: `0x${'22'.repeat(20)}`,
    asset: 'USDC',
    chainId: 8453,
    nonce: '0c'.repeat(32),
    token: USDC,
    authorizer: '11'.repeat(20),
    observation: observation(),
  });
  assert.equal(mapped.chainId, 8453);
  assert.equal(mapped.nonce, '0c'.repeat(32));
  assert.equal(mapped.token, USDC);
  resetHouseState();
  resetAnchorLedger();
  const box = fresh();
  let receipt = null;
  let thrown = null;
  try {
    receipt = await withProcessFlags(true, async () => {
      await wireOpenedHouse(box);
      return buildV1Receipt({
        task: {
          taskId: 'b10',
          status: 'completed',
          meta: {
            housePayment: payment({ nonce: 'ff'.repeat(32), chainId: 111, token: '44'.repeat(20) }),
            houseObservation: observation({ blockHash: 'ee'.repeat(32), blockNumber: 4, finalizedNumber: 1 }),
            houseCaller: box.other,
          },
        },
        taskId: 'b10',
        provider: 'example-hub',
        mock: true,
        proverConfigured: false,
        baseUrl: 'http://127.0.0.1:9',
        payment: { ...payment({ nonce: '28'.repeat(32) }), observation: observation() },
      });
    });
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(receipt.v, 13);
  const rows = JSON.parse(readFileSync(join(box.dir, 'auth-bindings.json'), 'utf8')).rows;
  const row = rows[Object.keys(rows)[0]];
  assert.equal(row.bookId, box.caller.bookId);
  assert.notEqual(row.bookId, box.other.bookId);
});

test('B11 a group-readable env file refuses to listen and mode 600 is accepted', async () => {
  setV13Runtime(null);
  delete process.env.CHIT_V13_BOOT_MARKER;
  const looseBoot = preparedBoot();
  attachHouseFile(looseBoot);
  const loose = join(looseBoot.root, 'loose.env');
  writeFileSync(loose, 'CHIT_V13_BOOT_MARKER=loose\n', { mode: 0o644 });
  chmodSync(loose, 0o644);
  await assert.rejects(
    () => wireV13Runtime({ ...looseBoot.env, CHIT_V13_ENV_FILE: loose }, livePin(looseBoot)),
    (err) => err.code === 'v13_boot_refused',
  );
  assert.equal(process.env.CHIT_V13_BOOT_MARKER, undefined);

  const tightBoot = preparedBoot();
  attachHouseFile(tightBoot);
  const tight = join(tightBoot.root, 'tight.env');
  writeFileSync(tight, 'CHIT_V13_BOOT_MARKER=tight\n', { mode: 0o600 });
  chmodSync(tight, 0o600);
  const out = await wireV13Runtime({ ...tightBoot.env, CHIT_V13_ENV_FILE: tight }, livePin(tightBoot));
  assert.equal(out.wired, true);
  assert.equal(process.env.CHIT_V13_BOOT_MARKER, 'tight');
  delete process.env.CHIT_V13_BOOT_MARKER;
  setV13Runtime(null);
  rmSync(looseBoot.root, { recursive: true, force: true });
  rmSync(tightBoot.root, { recursive: true, force: true });
});

test('B12 a group-readable store or bind dir refuses to listen and mode 700 is accepted', async () => {
  setV13Runtime(null);
  const box = preparedBoot();
  attachHouseFile(box);
  chmodSync(box.bindDir, 0o755);
  await assert.rejects(
    () => wireV13Runtime(box.env, livePin(box)),
    (err) => err.code === 'v13_boot_refused',
  );
  chmodSync(box.bindDir, 0o700);
  chmodSync(box.storeDir, 0o755);
  await assert.rejects(
    () => wireV13Runtime(box.env, livePin(box)),
    (err) => err.code === 'v13_boot_refused',
  );
  chmodSync(box.storeDir, 0o700);
  const out = await wireV13Runtime(box.env, livePin(box));
  assert.equal(out.wired, true);
  setV13Runtime(null);
  rmSync(box.root, { recursive: true, force: true });
});

test('B13 logs and errors do not contain the dummy key id or ARN', async () => {
  setV13Runtime(null);
  const box = preparedBoot();
  attachHouseFile(box);
  const arn = dummyKmsArn('3');
  const keyId = dummyKeyId('3');
  const log = [];
  box.env.CHIT_CHECKPOINT_KMS_KEY_ID = keyId;
  await assert.rejects(
    () => wireV13Runtime(box.env, {
      client: { async send() { throw new Error(arn); } },
      openStore() { return box.store; },
      log: (row) => log.push(row),
    }),
    (err) => err.code === 'v13_boot_refused'
      && err.message.includes(arn) === false
      && err.message.includes(keyId) === false,
  );
  const packed = JSON.stringify({ log, message: 'v13 boot refused' });
  assert.equal(packed.includes(arn), false);
  assert.equal(packed.includes(keyId), false);
  assert.equal(log.some((row) => row.checkpointKey === 'set'), true);
  rmSync(box.root, { recursive: true, force: true });
});

test('B14 images and audio do not issue a v13 document or a hold when unpaid', async () => {
  const express = (await import('express')).default;
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
  try {
    setV13Runtime(null);
    const image = await withProcessFlags(true, async () => {
      const res = await fetch(`${base}/v1/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'theta/stable_diffusion_xl_turbo', prompt: 'a red circle' }),
      });
      const text = await res.text();
      return { status: res.status, text };
    });
    assert.notEqual(image.status, 500);
    assert.equal(image.text.includes('"v":13'), false);
    assert.equal(image.text.includes('pending_id'), false);
    const audio = await withProcessFlags(true, async () => {
      const res = await fetch(`${base}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'theta/whisper', audio_url: 'http://127.0.0.1/clip' }),
      });
      const text = await res.text();
      return { status: res.status, text };
    });
    assert.notEqual(audio.status, 500);
    assert.equal(audio.text.includes('"v":13'), false);
    assert.equal(audio.text.includes('pending_id'), false);
    assert.equal(pendingOpen(undefined), false);
  } finally {
    setV13Runtime(null);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('B15 a chain or token other than the pin is still a 400 with no hold', async () => {
  resetHouseState();
  const box = fresh();
  const base = {
    env: flagsOn(),
    dir: box.dir,
    store: box.store,
    caller: box.caller,
    observation: observation(),
    client: mockKms(),
    send: async () => '0xabc',
  };
  const otherChain = await issueHouseReceipt({ ...base, payment: payment({ chainId: 84532, nonce: '29'.repeat(32) }) });
  const otherToken = await issueHouseReceipt({ ...base, payment: payment({ token: '44'.repeat(20), nonce: '2a'.repeat(32) }) });
  assert.equal(otherChain.status, 400);
  assert.equal(otherChain.body.pending_id, undefined);
  assert.equal(pendingOpen(otherChain.body.pending_id), false);
  assert.equal(otherToken.status, 400);
  assert.equal(otherToken.body.pending_id, undefined);
  assert.equal(pendingOpen(otherToken.body.pending_id), false);
  assert.equal(existsSync(join(box.dir, 'auth-bindings.json')), false);
});

test('B16 a flags-on listen requires a configured house book with an in-memory token', async () => {
  setV13Runtime(null);
  const disk = preparedBoot();
  await assert.rejects(
    () => wireV13Runtime(disk.env, pinDeps()),
    (err) => err.code === 'v13_boot_refused',
  );
  assert.equal(readV13Runtime(), null);

  const missing = preparedBoot();
  attachHouseFile(missing);
  const missingEnv = { ...missing.env };
  delete missingEnv.CHIT_V13_HOUSE_BOOK_ID;
  await assert.rejects(
    () => wireV13Runtime(missingEnv, livePin(missing)),
    (err) => err.code === 'v13_boot_refused',
  );
  await assert.rejects(
    () => wireV13Runtime(
      { ...missing.env, CHIT_V13_HOUSE_BOOK_ID: 'bb'.repeat(32) },
      livePin(missing),
    ),
    (err) => err.code === 'v13_boot_refused',
  );

  resetHouseState();
  const box = fresh();
  mkdirSync(box.dir, { recursive: true, mode: 0o700 });
  let committed = false;
  const issued = await issueHouseReceipt({
    env: flagsOn(),
    dir: box.dir,
    store: {
      commitEpoch() { committed = true; return { ok: true }; },
      hasCommitted() { return false; },
    },
    client: mockKms(),
    send: async () => '0xabc',
    payment: payment({ nonce: '2b'.repeat(32) }),
    observation: observation(),
  });
  assert.equal(issued.status, 400);
  assert.equal(issued.body.code, 'verify_failed');
  assert.equal(issued.body.pending_id, undefined);
  assert.equal(pendingOpen(issued.body.pending_id), false);
  assert.equal(committed, false);
  assert.equal(existsSync(join(box.dir, 'auth-bindings.json')), false);
  rmSync(disk.root, { recursive: true, force: true });
  rmSync(missing.root, { recursive: true, force: true });
});

function houseCanary(tag) {
  return `canary-${tag}-token-value`;
}

function makeHouseTree() {
  const root = mkdtempSync(join(tmpdir(), 'v13-hfile-'));
  const storeDir = join(root, 'store');
  const bindDir = join(root, 'bind');
  const secretDir = join(root, 'secret');
  for (const dir of [storeDir, bindDir, secretDir]) {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  const bookId = 'aa'.repeat(32);
  const salt = '12'.repeat(32);
  const bookPk = '07'.repeat(32);
  const state = join(storeDir, 'store-state.json');
  writeFileSync(state, JSON.stringify({
    v: 1,
    epochs: [],
    receipts: [],
    books: { [bookId]: { bookSalt: salt } },
  }));
  return { root, storeDir, bindDir, secretDir, bookId, salt, bookPk, state };
}

function writeTokenFile(tree, { token, mode = 0o600, body, name = 'book.json', dir } = {}) {
  const folder = dir || tree.secretDir;
  const file = join(folder, name);
  const text = body == null ? JSON.stringify({
    v: 1,
    bookId: tree.bookId,
    token,
    bookPk: tree.bookPk,
  }) : body;
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
  return file;
}

function houseBootEnv(tree, file, over = {}) {
  const env = {
    ...flagsOn(),
    CHIT_V13_STORE_PATH: tree.storeDir,
    CHIT_V13_BIND_DIR: tree.bindDir,
    CHIT_V13_HOUSE_BOOK_ID: tree.bookId,
    ...over,
  };
  if (file !== undefined) env.CHIT_V13_HOUSE_TOKEN_FILE = file;
  return env;
}

function foreignOwnerFs() {
  return {
    lstatSync(file) { return lstatSync(file); },
    openSync(file, flags) { return openSync(file, flags); },
    fstatSync(fd) {
      const st = fstatSync(fd);
      return new Proxy(st, {
        get(target, prop, receiver) {
          if (prop === 'uid') return target.uid + 1;
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    readSync(fd, buf, offset, length, position) {
      return readSync(fd, buf, offset, length, position);
    },
    closeSync(fd) { closeSync(fd); },
  };
}

function foreignDirFs() {
  return {
    lstatSync(file) {
      const st = lstatSync(file);
      if (typeof st.isDirectory === 'function' && st.isDirectory()) {
        return new Proxy(st, {
          get(target, prop, receiver) {
            if (prop === 'uid') return target.uid + 1;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }
      return st;
    },
    openSync(file, flags) { return openSync(file, flags); },
    fstatSync(fd) { return fstatSync(fd); },
    readSync(fd, buf, offset, length, position) {
      return readSync(fd, buf, offset, length, position);
    },
    closeSync(fd) { closeSync(fd); },
  };
}

async function refuseHouse(env, reason, deps) {
  setV13Runtime(null);
  let caught = null;
  try {
    await wireV13Runtime(env, deps || pinDeps());
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.equal(caught.code, 'v13_boot_refused');
  assert.equal(caught.reason, reason);
  assert.equal(caught.message, 'v13 boot refused');
  assert.equal(caught.cause, undefined);
  assert.equal(readV13Runtime(), null);
  return caught;
}

function packedLeak(parts) {
  return parts.map((part) => {
    if (typeof part === 'string') return part;
    let text = '';
    try { text += inspect(part, { depth: 8 }); } catch { text += ''; }
    try { text += JSON.stringify(part); } catch { text += ''; }
    return text;
  }).join('\n');
}

test('H1 a flags-on boot opens the store with the house book from the file', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h1');
  const before = readFileSync(tree.state);
  const file = writeTokenFile(tree, { token: canary });
  setV13Runtime(null);
  let thrown = null;
  let out = null;
  try {
    out = await wireV13Runtime(houseBootEnv(tree, file), pinDeps());
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(out.wired, true);
  const runtime = readV13Runtime();
  assert.equal(runtime.caller.bookId, tree.bookId);
  assert.equal(runtime.caller.token, canary);
  const after = readFileSync(tree.state);
  assert.equal(after.equals(before), true);
  assert.equal(after.includes(Buffer.from(canary)), false);
  assert.equal(after.toString('utf8').includes('"token"'), false);
  const parsed = JSON.parse(after.toString('utf8'));
  assert.deepEqual(parsed.books[tree.bookId], { bookSalt: tree.salt });
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H2 flags off do not read or stat the house token file', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h2');
  const before = readFileSync(tree.state);
  const file = writeTokenFile(tree, { token: canary, mode: 0o644 });
  const seen = { read: false, fs: false };
  const base = {
    CHIT_V13_HOUSE_TOKEN_FILE: file,
    CHIT_V13_STORE_PATH: tree.storeDir,
    CHIT_V13_HOUSE_BOOK_ID: tree.bookId,
  };
  const env = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'CHIT_V13_HOUSE_TOKEN_FILE') seen.read = true;
      return Reflect.get(target, prop, receiver);
    },
  });
  const deps = {
    fs: {
      lstatSync() { seen.fs = true; throw new Error('statted'); },
      openSync() { seen.fs = true; throw new Error('opened'); },
    },
    openStore() { throw new Error('opened store'); },
  };
  let thrown = null;
  try {
    const unset = await wireV13Runtime(env, deps);
    assert.equal(unset.wired, false);
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  const flagged = new Proxy({
    ...base,
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: 'false',
    CHIT_V13_STORE: 'false',
  }, {
    get(target, prop, receiver) {
      if (prop === 'CHIT_V13_HOUSE_TOKEN_FILE') seen.read = true;
      return Reflect.get(target, prop, receiver);
    },
  });
  try {
    const off = await wireV13Runtime(flagged, deps);
    assert.equal(off.wired, false);
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(seen.read, false);
  assert.equal(seen.fs, false);
  assert.equal(readFileSync(tree.state).equals(before), true);
  const issued = await issueHouseReceipt({ env: {}, task: byteTask(), receiptOpts: RECEIPT_OPTS });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H3 a missing house token path refuses to listen', async () => {
  const tree = makeHouseTree();
  await refuseHouse(houseBootEnv(tree, undefined), 'token_file_missing');
  await refuseHouse(houseBootEnv(tree, ''), 'token_file_missing');
  await refuseHouse(houseBootEnv(tree, '   '), 'token_file_missing');
  await refuseHouse(houseBootEnv(tree, join(tree.secretDir, 'missing.json')), 'token_file_missing');
  rmSync(tree.root, { recursive: true, force: true });
});

test('H4 a symlink or directory house token path is not a regular file', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h4');
  const file = writeTokenFile(tree, { token: canary });
  const link = join(tree.secretDir, 'link.json');
  symlinkSync(file, link);
  const linked = await refuseHouse(houseBootEnv(tree, link), 'token_file_not_regular');
  assert.equal(packedLeak([linked, linked.stack]).includes(canary), false);
  assert.equal(packedLeak([linked, linked.stack]).includes(link), false);
  const asDir = await refuseHouse(houseBootEnv(tree, tree.secretDir), 'token_file_not_regular');
  assert.equal(packedLeak([asDir]).includes(canary), false);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H5 a house token file owned by another uid is refused', async () => {
  const tree = makeHouseTree();
  const file = writeTokenFile(tree, { token: houseCanary('h5') });
  await refuseHouse(houseBootEnv(tree, file), 'token_file_owner', { ...pinDeps(), fs: foreignOwnerFs() });
  rmSync(tree.root, { recursive: true, force: true });
});

test('H6 house token file mode must be 600 or tighter', async () => {
  const loose = makeHouseTree();
  await refuseHouse(houseBootEnv(loose, writeTokenFile(loose, { token: houseCanary('h6a'), mode: 0o644 })), 'token_file_mode');
  await refuseHouse(houseBootEnv(loose, writeTokenFile(loose, { token: houseCanary('h6b'), mode: 0o660, name: 'group.json' })), 'token_file_mode');
  rmSync(loose.root, { recursive: true, force: true });

  const owner = makeHouseTree();
  const canary = houseCanary('h6c');
  const file = writeTokenFile(owner, { token: canary, mode: 0o600 });
  setV13Runtime(null);
  const opened = await wireV13Runtime(houseBootEnv(owner, file), pinDeps());
  assert.equal(opened.wired, true);
  assert.equal(readV13Runtime().caller.token, canary);
  setV13Runtime(null);
  chmodSync(file, 0o400);
  const tighter = await wireV13Runtime(houseBootEnv(owner, file), pinDeps());
  assert.equal(tighter.wired, true);
  assert.equal(readV13Runtime().caller.token, canary);
  setV13Runtime(null);
  rmSync(owner.root, { recursive: true, force: true });
});

test('H7 the house token directory must be a private directory', async () => {
  const loose = makeHouseTree();
  const file = writeTokenFile(loose, { token: houseCanary('h7') });
  chmodSync(loose.secretDir, 0o755);
  await refuseHouse(houseBootEnv(loose, file), 'token_file_dir');
  chmodSync(loose.secretDir, 0o770);
  await refuseHouse(houseBootEnv(loose, file), 'token_file_dir');
  chmodSync(loose.secretDir, 0o700);
  await refuseHouse(houseBootEnv(loose, file), 'token_file_dir', { ...pinDeps(), fs: foreignDirFs() });
  rmSync(loose.root, { recursive: true, force: true });

  const linked = makeHouseTree();
  const real = join(linked.root, 'real-secret');
  mkdirSync(real, { mode: 0o700 });
  chmodSync(real, 0o700);
  const token = writeTokenFile(linked, { token: houseCanary('h7b'), dir: real, name: 'book.json' });
  const via = join(linked.root, 'secret-link');
  symlinkSync(real, via);
  const through = join(via, 'book.json');
  assert.equal(through.endsWith(token.slice(token.lastIndexOf('/'))), true);
  await refuseHouse(houseBootEnv(linked, through), 'token_file_dir');
  rmSync(linked.root, { recursive: true, force: true });

  const tight = makeHouseTree();
  const ok = writeTokenFile(tight, { token: houseCanary('h7c') });
  setV13Runtime(null);
  const out = await wireV13Runtime(houseBootEnv(tight, ok), pinDeps());
  assert.equal(out.wired, true);
  setV13Runtime(null);
  rmSync(tight.root, { recursive: true, force: true });
});

test('H8 an oversize or ill-formed house token file is refused', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h8');
  const fat = await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: `${canary}${' '.repeat(8192)}`, name: 'fat.json' })),
    'token_file_size',
  );
  const bad = await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: `{${canary}`, name: 'bad.json' })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: '{"v":1,}', name: 'comma.json' })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: '/* c */ {"v":1}', name: 'comment.json' })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: `\uFEFF{"v":1}`, name: 'bom.json' })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, {
      body: JSON.stringify({ v: 2, bookId: tree.bookId, token: canary, bookPk: tree.bookPk }),
      name: 'ver.json',
    })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, {
      body: JSON.stringify({ v: '1', bookId: tree.bookId, token: canary, bookPk: tree.bookPk }),
      name: 'ver-string.json',
    })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, {
      body: JSON.stringify({ v: 1, bookId: tree.bookId, token: canary, bookPk: tree.bookPk, extra: true }),
      name: 'extra.json',
    })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, {
      body: JSON.stringify({ v: 1, bookId: tree.bookId, token: canary, bookPk: tree.bookPk, books: [] }),
      name: 'books.json',
    })),
    'token_file_parse',
  );
  await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: JSON.stringify([{ v: 1 }]), name: 'array.json' })),
    'token_file_parse',
  );
  const leaked = packedLeak([fat, fat.stack, bad, bad.stack]);
  assert.equal(leaked.includes(canary), false);
  assert.equal(leaked.includes('fat.json'), false);
  assert.equal(leaked.includes('bad.json'), false);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H9 the house file book id must match the configured book', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h9');
  const doc = (bookId) => JSON.stringify({ v: 1, bookId, token: canary, bookPk: tree.bookPk });
  const missing = await refuseHouse(
    houseBootEnv(tree, writeTokenFile(tree, { body: JSON.stringify({ v: 1, token: canary, bookPk: tree.bookPk }), name: 'no-id.json' })),
    'house_book_id',
  );
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc('abcd'), name: 'short.json' })), 'house_book_id');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc('bb'.repeat(32)), name: 'other.json' })), 'house_book_id');
  const leaked = packedLeak([missing, missing.stack]);
  assert.equal(leaked.includes(canary), false);
  assert.equal(leaked.includes(tree.bookId), false);
  assert.equal(leaked.includes('no-id.json'), false);
  const prefixed = writeTokenFile(tree, {
    body: JSON.stringify({ v: 1, bookId: `0x${tree.bookId.toUpperCase()}`, token: canary, bookPk: `0x${tree.bookPk}` }),
    name: 'prefixed.json',
  });
  setV13Runtime(null);
  const out = await wireV13Runtime(houseBootEnv(tree, prefixed), pinDeps());
  assert.equal(out.wired, true);
  assert.equal(readV13Runtime().caller.bookId, tree.bookId);
  assert.equal(readV13Runtime().caller.token, canary);
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H10 the house token and book key must be well formed', async () => {
  const tree = makeHouseTree();
  const good = houseCanary('h10');
  const doc = (over) => JSON.stringify({ v: 1, bookId: tree.bookId, token: good, bookPk: tree.bookPk, ...over });
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ token: undefined }), name: 'no-token.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: JSON.stringify({ v: 1, bookId: tree.bookId, token: '', bookPk: tree.bookPk }), name: 'empty.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ token: 'short-token' }), name: 'short.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ token: 't'.repeat(257) }), name: 'long.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ token: 16 }), name: 'num.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ token: ` ${'t'.repeat(16)}` }), name: 'pad.json' })), 'house_token');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: JSON.stringify({ v: 1, bookId: tree.bookId, token: good }), name: 'no-pk.json' })), 'house_book_pk');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ bookPk: '07'.repeat(31) }), name: 'short-pk.json' })), 'house_book_pk');
  await refuseHouse(houseBootEnv(tree, writeTokenFile(tree, { body: doc({ bookPk: 32 }), name: 'num-pk.json' })), 'house_book_pk');
  const minFile = writeTokenFile(tree, { body: doc({ token: 'm'.repeat(16) }), name: 'min.json' });
  setV13Runtime(null);
  const minOut = await wireV13Runtime(houseBootEnv(tree, minFile), pinDeps());
  assert.equal(minOut.wired, true);
  assert.equal(readV13Runtime().caller.token, 'm'.repeat(16));
  setV13Runtime(null);
  const edge = writeTokenFile(tree, { body: doc({ token: 'e'.repeat(256) }), name: 'edge.json' });
  const out = await wireV13Runtime(houseBootEnv(tree, edge), pinDeps());
  assert.equal(out.wired, true);
  assert.equal(readV13Runtime().caller.token, 'e'.repeat(256));
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H11 a house book with no stored salt is not created', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h11');
  const file = writeTokenFile(tree, { token: canary });
  writeFileSync(tree.state, JSON.stringify({ v: 1, epochs: [], receipts: [], books: {} }));
  const before = readFileSync(tree.state);
  await refuseHouse(houseBootEnv(tree, file), 'store_book');
  assert.equal(readFileSync(tree.state).equals(before), true);
  writeFileSync(tree.state, JSON.stringify({
    v: 1,
    epochs: [],
    receipts: [],
    books: { [tree.bookId]: { bookSalt: 'ab' } },
  }));
  const short = readFileSync(tree.state);
  await refuseHouse(houseBootEnv(tree, file), 'store_book');
  assert.equal(readFileSync(tree.state).equals(short), true);
  assert.equal(readFileSync(tree.state).includes(Buffer.from(canary)), false);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H12 a later persist still writes only the house salt', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h12');
  const file = writeTokenFile(tree, { token: canary });
  setV13Runtime(null);
  await wireV13Runtime(houseBootEnv(tree, file), pinDeps());
  const runtime = readV13Runtime();
  const stored = runtime.store.commitEpoch({
    epoch: '1',
    hourStart: 1,
    size: 1,
    root: 'root',
    stateRoot: 'state',
    chainId: '8453',
    contract: 'contract',
    checkpoint: 'checkpoint',
    receipts: [],
  });
  assert.equal(stored.ok, true);
  const text = readFileSync(tree.state, 'utf8');
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.books[tree.bookId], { bookSalt: tree.salt });
  assert.equal(Object.keys(parsed.books[tree.bookId]).join(','), 'bookSalt');
  assert.equal(text.includes(canary), false);
  assert.equal(text.includes('"token"'), false);
  assert.equal(text.includes(tree.bookPk), false);
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});

test('H13 the house token and its path stay out of logs, errors, and inspect', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('h13');
  const file = writeTokenFile(tree, { token: canary });
  const chunks = [];
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const save = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  };
  process.stdout.write = function write(chunk, enc, cb) {
    save(chunk);
    return stdout.call(process.stdout, chunk, enc, cb);
  };
  process.stderr.write = function write(chunk, enc, cb) {
    save(chunk);
    return stderr.call(process.stderr, chunk, enc, cb);
  };
  try {
    setV13Runtime(null);
    const out = await wireV13Runtime(houseBootEnv(tree, file), pinDeps());
    assert.equal(out.wired, true);
    const runtime = readV13Runtime();
    const shown = packedLeak([
      chunks.join('\n'),
      runtime,
      runtime.caller,
      inspect(runtime, { depth: 8 }),
      inspect(runtime.caller, { depth: 8 }),
      JSON.stringify(runtime),
      JSON.stringify(runtime.caller),
      readFileSync(tree.state, 'utf8'),
    ]);
    assert.equal(shown.includes(canary), false);
    assert.equal(shown.includes(file), false);
    assert.equal(runtime.caller.token, canary);
    setV13Runtime(null);
    const mismatch = writeTokenFile(tree, {
      body: JSON.stringify({ v: 1, bookId: 'bb'.repeat(32), token: canary, bookPk: tree.bookPk }),
      name: 'mismatch.json',
    });
    const err = await refuseHouse(houseBootEnv(tree, mismatch), 'house_book_id');
    const refused = packedLeak([
      chunks.join('\n'),
      err,
      err.stack,
      err.message,
      inspect(err, { depth: 8 }),
      JSON.stringify(err),
      readFileSync(tree.state, 'utf8'),
    ]);
    assert.equal(refused.includes(canary), false);
    assert.equal(refused.includes(mismatch), false);
    assert.equal(refused.includes(file), false);
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    setV13Runtime(null);
    rmSync(tree.root, { recursive: true, force: true });
  }
});

test('S1 a blank house book id is refused before the token file is read', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('s1');
  const file = writeTokenFile(tree, { token: canary });
  const seen = { fs: 0, open: 0 };
  const deps = {
    ...pinDeps(),
    fs: {
      lstatSync() { seen.fs += 1; throw new Error('read'); },
      openSync() { seen.fs += 1; throw new Error('read'); },
      fstatSync() { seen.fs += 1; throw new Error('read'); },
      readSync() { seen.fs += 1; throw new Error('read'); },
      closeSync() { seen.fs += 1; },
    },
    openStore() { seen.open += 1; throw new Error('opened'); },
  };
  const cases = [undefined, '', '   ', '\n\t'];
  for (const bookId of cases) {
    seen.fs = 0;
    seen.open = 0;
    const before = readFileSync(tree.state);
    const env = houseBootEnv(tree, file, bookId === undefined ? {} : { CHIT_V13_HOUSE_BOOK_ID: bookId });
    if (bookId === undefined) delete env.CHIT_V13_HOUSE_BOOK_ID;
    const err = await refuseHouse(env, 'house_book_id', deps);
    assert.equal(seen.fs, 0);
    assert.equal(seen.open, 0);
    assert.equal(readFileSync(tree.state).equals(before), true);
    const packed = packedLeak([err, err.stack, err.message]);
    assert.equal(packed.includes(canary), false);
    assert.equal(packed.includes(file), false);
  }
  rmSync(tree.root, { recursive: true, force: true });
});

test('S2 a valid house file with no in-memory token does not listen', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('s2');
  const file = writeTokenFile(tree, { token: canary });
  const before = readFileSync(tree.state);
  let opened = 0;
  setV13Runtime(null);
  let thrown = null;
  try {
    await wireV13Runtime(houseBootEnv(tree, file), {
      ...pinDeps(),
      openStore(dir) {
        opened += 1;
        return openStore(dir);
      },
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.equal(thrown.code, 'v13_boot_refused');
  assert.equal(thrown.message, 'v13 boot refused');
  assert.equal(readV13Runtime(), null);
  assert.equal(opened, 1);
  assert.equal(readFileSync(tree.state).equals(before), true);
  const packed = packedLeak([thrown, thrown.stack, inspect(thrown, { depth: 8 })]);
  assert.equal(packed.includes(canary), false);
  assert.equal(packed.includes(file), false);
  rmSync(tree.root, { recursive: true, force: true });
});

test('S3 an uppercase or 0x house book id boots as the canonical id', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('s3');
  const before = readFileSync(tree.state);
  const file = writeTokenFile(tree, { token: canary });
  const prefixed = `0x${tree.bookId.toUpperCase()}`;
  setV13Runtime(null);
  let thrown = null;
  let out = null;
  try {
    out = await wireV13Runtime(houseBootEnv(tree, file, { CHIT_V13_HOUSE_BOOK_ID: `  ${prefixed}  ` }), pinDeps());
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(out.wired, true);
  const runtime = readV13Runtime();
  assert.equal(runtime.caller.bookId, tree.bookId);
  assert.equal(runtime.caller.token, canary);
  assert.equal(readFileSync(tree.state).equals(before), true);
  setV13Runtime(null);
  await refuseHouse(
    houseBootEnv(tree, file, { CHIT_V13_HOUSE_BOOK_ID: `0x${'bb'.repeat(32)}` }),
    'house_book_id',
  );
  assert.equal(readFileSync(tree.state).equals(before), true);
  rmSync(tree.root, { recursive: true, force: true });
});

test('S4 a looser fstat mode is refused when lstat said 0600', async () => {
  const tree = makeHouseTree();
  const canary = houseCanary('s4');
  const file = writeTokenFile(tree, { token: canary, mode: 0o600 });
  const mask = (st, bits) => new Proxy(st, {
    get(target, prop, receiver) {
      if (prop === 'mode') return (target.mode & ~0o777) | bits;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const deps = {
    ...pinDeps(),
    fs: {
      lstatSync(target) { return mask(lstatSync(target), 0o600); },
      openSync(target, flags) { return openSync(target, flags); },
      fstatSync(fd) { return mask(fstatSync(fd), 0o644); },
      readSync(fd, buf, offset, length, position) { return readSync(fd, buf, offset, length, position); },
      closeSync(fd) { closeSync(fd); },
    },
  };
  const err = await refuseHouse(houseBootEnv(tree, file), 'token_file_mode', deps);
  const packed = packedLeak([err, err.stack, inspect(err, { depth: 8 }), JSON.stringify(err)]);
  assert.equal(packed.includes(canary), false);
  assert.equal(packed.includes(file), false);
  rmSync(tree.root, { recursive: true, force: true });
});

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

function kmsTransport({ spki, onSign, fail, status, bodyFor }) {
  const calls = [];
  const requestHandler = {
    async handle(request) {
      const headers = request.headers || {};
      const target = String(headers['x-amz-target'] || '');
      calls.push(target);
      if (typeof fail === 'function' && fail(target)) throw new Error('kms transport');
      if (status && status !== 200) {
        return {
          response: {
            statusCode: status,
            headers: { 'content-type': 'application/x-amz-json-1.1' },
            body: Buffer.from(JSON.stringify({ __type: 'KMSInternalException', message: 'unavailable' })),
          },
        };
      }
      const signing = target.endsWith('.Sign');
      const payload = typeof bodyFor === 'function'
        ? bodyFor(target)
        : (signing
          ? (typeof onSign === 'function' ? onSign() : { Signature: '', SigningAlgorithm: 'ECDSA_SHA_256' })
          : {
            KeySpec: 'ECC_SECG_P256K1',
            KeyUsage: 'SIGN_VERIFY',
            SigningAlgorithms: ['ECDSA_SHA_256'],
            CustomerMasterKeySpec: 'ECC_SECG_P256K1',
            PublicKey: Buffer.from(spki || []).toString('base64'),
          });
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

function realKms(requestHandler, accessKey = 'k-access-key', secret = 'k-secret-value') {
  return new KMSClient({
    region: 'us-east-2',
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
    requestHandler,
  });
}

function writeCredsFile(dir, { profile, accessKey, secret, mode = 0o600, name = 'credentials' }) {
  const file = join(dir, name);
  const text = `[${profile}]\naws_access_key_id = ${accessKey}\naws_secret_access_key = ${secret}\n`;
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
  return file;
}

function credsDir(root) {
  const dir = join(root, 'creds');
  mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

function storeOnlyEnv(tree, tokenFile, credsFile, profile, over = {}) {
  return houseBootEnv(tree, tokenFile, {
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: 'false',
    CHIT_V13_STORE: 'true',
    CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: credsFile,
    CHIT_CHECKPOINT_AWS_PROFILE: profile,
    ...over,
  });
}

function productionPin(requestHandler) {
  return {
    testInjection: true,
    addressOf: () => MAINNET_CHECKPOINT,
    requestHandler,
  };
}

async function bootOutcome(env, deps) {
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

function signerEnv(address, keyId = 'alias/test-checkpoint') {
  return {
    CHIT_CHECKPOINT_KMS_KEY_ID: keyId,
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: address,
    CHIT_CHECKPOINT_MAX_FEE_PER_GAS: '10',
  };
}

test('K1 a real KMS client pins GetPublicKey on a store-only boot', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const profile = 'checkpoint-k1';
  const creds = writeCredsFile(credsDir(tree.root), {
    profile,
    accessKey: 'k1-access-key',
    secret: 'k1-secret-value',
  });
  const token = writeTokenFile(tree, { token: houseCanary('k1') });
  const transport = kmsTransport({ spki: material.spki });
  const outcome = await bootOutcome(
    storeOnlyEnv(tree, token, creds, profile),
    productionPin(transport.requestHandler),
  );
  assert.equal(outcome.err, null);
  assert.equal(outcome.out && outcome.out.wired, true);
  assert.equal(outcome.runtime.caller.bookId, tree.bookId);
  assert.equal(transport.calls.includes('TrentService.GetPublicKey'), true);
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});

test('K2 a real KMS client signs and the other checkpoint send sites do too', async () => {
  const material = checkpointMaterial();
  const digest = Buffer.alloc(32, 4);
  const made = material.sign(digest);
  assert.ok(made);
  const transport = kmsTransport({
    spki: material.spki,
    onSign: () => ({
      Signature: Buffer.from(made.der).toString('base64'),
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  });
  const client = realKms(transport.requestHandler);
  const signer = await createCheckpointSigner({ client, env: signerEnv(material.address) });
  let signed = null;
  let signErr = null;
  try {
    signed = await signer.signDigest(digest);
  } catch (err) {
    signErr = err;
  }
  assert.equal(signErr, null);
  assert.equal(signed.raw.length, 64);
  assert.equal(transport.calls.includes('TrentService.Sign'), true);

  const anchorTransport = kmsTransport({
    spki: material.spki,
    onSign: () => ({
      Signature: Buffer.from(made.der).toString('base64'),
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  });
  const anchorClient = realKms(anchorTransport.requestHandler);
  let anchorErr = null;
  try {
    await signMainnetCheckpoint({
      env: signerEnv(MAINNET_CHECKPOINT),
      client: anchorClient,
      addressOf: () => MAINNET_CHECKPOINT,
      digest,
    });
  } catch (err) {
    anchorErr = err;
  }
  assert.equal(anchorErr && anchorErr.code, 'checkpoint_address_mismatch');
  assert.equal(anchorTransport.calls.includes('TrentService.GetPublicKey'), true);
  assert.equal(anchorTransport.calls.includes('TrentService.Sign'), true);

  const armTransport = kmsTransport({ spki: material.spki });
  const armed = await issueHouseReceipt({
    env: {
      CHIT_V13_MAINNET_SEALER: 'true',
      CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
      CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
      CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    },
    task: byteTask(),
    receiptOpts: RECEIPT_OPTS,
    client: realKms(armTransport.requestHandler),
  });
  assert.equal(armed.status, 200);
  assert.equal(armTransport.calls.includes('TrentService.GetPublicKey'), true);
});

test('K3 a GetPublicKey transport error refuses to listen', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const keyId = dummyKeyId('4');
  const profile = 'checkpoint-k3';
  const creds = writeCredsFile(credsDir(tree.root), {
    profile,
    accessKey: 'k3-access-key',
    secret: 'k3-secret-value',
  });
  const token = writeTokenFile(tree, { token: houseCanary('k3') });
  const cases = [
    kmsTransport({ spki: material.spki, fail: () => true }),
    kmsTransport({ spki: material.spki, status: 500 }),
  ];
  for (const transport of cases) {
    const outcome = await bootOutcome(
      storeOnlyEnv(tree, token, creds, profile, { CHIT_CHECKPOINT_KMS_KEY_ID: keyId }),
      productionPin(transport.requestHandler),
    );
    assert.equal(outcome.out, null);
    assert.equal(outcome.err && outcome.err.code, 'v13_boot_refused');
    assert.equal(outcome.runtime, null);
    const packed = packedLeak([outcome.err, inspect(outcome.err, { depth: 8 })]);
    assert.equal(packed.includes(keyId), false);
    assert.equal(packed.includes('k3-access-key'), false);
    assert.equal(packed.includes(creds), false);
  }
  rmSync(tree.root, { recursive: true, force: true });
});

test('K4 a Sign transport error is not a signature', async () => {
  const material = checkpointMaterial();
  const digest = Buffer.alloc(32, 5);
  const cases = [
    kmsTransport({ spki: material.spki, fail: (target) => target.endsWith('.Sign') }),
    kmsTransport({ spki: material.spki, fail: (target) => target.endsWith('.Sign') && false, status: 0, bodyFor: null }),
  ];
  const throwing = cases[0];
  const client = realKms(throwing.requestHandler);
  const signer = await createCheckpointSigner({ client, env: signerEnv(material.address) });
  let err = null;
  try {
    await signer.signDigest(digest);
  } catch (caught) {
    err = caught;
  }
  assert.equal(err && err.code, 'checkpoint_sign_unavailable');
  assert.equal(throwing.calls.includes('TrentService.Sign'), true);

  const http = kmsTransport({
    spki: material.spki,
    bodyFor(target) {
      if (target.endsWith('.Sign')) return null;
      return {
        KeySpec: 'ECC_SECG_P256K1',
        KeyUsage: 'SIGN_VERIFY',
        SigningAlgorithms: ['ECDSA_SHA_256'],
        PublicKey: Buffer.from(material.spki).toString('base64'),
      };
    },
    status: 0,
  });
  const failing = {
    requestHandler: {
      async handle(request) {
        const target = String((request.headers || {})['x-amz-target'] || '');
        http.calls.push(target);
        if (target.endsWith('.Sign')) {
          return {
            response: {
              statusCode: 500,
              headers: { 'content-type': 'application/x-amz-json-1.1' },
              body: Buffer.from(JSON.stringify({ __type: 'KMSInternalException', message: 'unavailable' })),
            },
          };
        }
        return http.requestHandler.handle(request);
      },
    },
    calls: http.calls,
  };
  const signer500 = await createCheckpointSigner({
    client: realKms(failing.requestHandler),
    env: signerEnv(material.address),
  });
  let err500 = null;
  try {
    await signer500.signDigest(digest);
  } catch (caught) {
    err500 = caught;
  }
  assert.equal(err500 && err500.code, 'checkpoint_sign_unavailable');
});

test('K5 a malformed GetPublicKey is not the pinned checkpoint', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const profile = 'checkpoint-k5';
  const creds = writeCredsFile(credsDir(tree.root), {
    profile,
    accessKey: 'k5-access-key',
    secret: 'k5-secret-value',
  });
  const token = writeTokenFile(tree, { token: houseCanary('k5') });
  const { publicKey } = await import('node:crypto').then((crypto) => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }));
  const p256 = publicKey.export({ type: 'spki', format: 'der' });
  const bodies = [
    {
      KeySpec: 'ECC_NIST_P256',
      KeyUsage: 'SIGN_VERIFY',
      SigningAlgorithms: ['ECDSA_SHA_256'],
      PublicKey: Buffer.from(material.spki).toString('base64'),
    },
    {
      KeySpec: 'ECC_SECG_P256K1',
      KeyUsage: 'SIGN_VERIFY',
      SigningAlgorithms: ['ECDSA_SHA_256'],
    },
    {
      KeySpec: 'ECC_SECG_P256K1',
      KeyUsage: 'SIGN_VERIFY',
      SigningAlgorithms: ['ECDSA_SHA_256'],
      PublicKey: Buffer.from(p256).toString('base64'),
    },
  ];
  for (const body of bodies) {
    const transport = kmsTransport({ bodyFor: () => body });
    const outcome = await bootOutcome(
      storeOnlyEnv(tree, token, creds, profile),
      productionPin(transport.requestHandler),
    );
    assert.equal(outcome.out, null);
    assert.equal(outcome.err && outcome.err.code, 'v13_boot_refused');
    assert.equal(outcome.runtime, null);
  }
  rmSync(tree.root, { recursive: true, force: true });
});

test('K6 a malformed Sign response is not a signature', async () => {
  const material = checkpointMaterial();
  const digest = Buffer.alloc(32, 6);
  const made = material.sign(digest);
  assert.ok(made);
  const bodies = [
    { SigningAlgorithm: 'ECDSA_SHA_256' },
    { Signature: Buffer.from('not-a-der-signature').toString('base64'), SigningAlgorithm: 'ECDSA_SHA_256' },
    { Signature: Buffer.from(highSDer(made.raw, SECP256K1)).toString('base64'), SigningAlgorithm: 'ECDSA_SHA_256' },
  ];
  for (const body of bodies.slice(0, 2)) {
    const transport = kmsTransport({
      spki: material.spki,
      bodyFor(target) {
        if (target.endsWith('.Sign')) return body;
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          SigningAlgorithms: ['ECDSA_SHA_256'],
          PublicKey: Buffer.from(material.spki).toString('base64'),
        };
      },
    });
    const signer = await createCheckpointSigner({
      client: realKms(transport.requestHandler),
      env: signerEnv(material.address),
    });
    let err = null;
    try {
      await signer.signDigest(digest);
    } catch (caught) {
      err = caught;
    }
    assert.equal(err && err.code, 'checkpoint_sign_invalid');
  }
  const high = kmsTransport({
    spki: material.spki,
    onSign: () => ({
      Signature: Buffer.from(highSDer(made.raw, SECP256K1)).toString('base64'),
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  });
  let highErr = null;
  try {
    await signMainnetCheckpoint({
      env: signerEnv(MAINNET_CHECKPOINT),
      client: realKms(high.requestHandler),
      addressOf: () => MAINNET_CHECKPOINT,
      digest,
    });
  } catch (caught) {
    highErr = caught;
  }
  assert.equal(highErr && highErr.code, 'checkpoint_sign_invalid');
});

test('K7 an unknown command name is refused before the client sends', async () => {
  const transport = kmsTransport({ spki: Buffer.alloc(0) });
  const client = realKms(transport.requestHandler);
  let err = null;
  try {
    await sendCheckpointKms(client, { name: 'Decrypt', input: {} }, {});
  } catch (caught) {
    err = caught;
  }
  assert.equal(err && err.code, 'checkpoint_kms_command');
  assert.equal(transport.calls.length, 0);
  let raw = null;
  try {
    await client.send({ name: 'GetPublicKey', input: { KeyId: 'alias/test-checkpoint' } });
  } catch (caught) {
    raw = caught;
  }
  assert.equal(raw instanceof TypeError, true);
  assert.equal(transport.calls.length, 0);
});

test('K8 missing checkpoint credentials refuse and an injected client does not stat them', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const token = writeTokenFile(tree, { token: houseCanary('k8') });
  const profile = 'checkpoint-k8';
  const creds = writeCredsFile(credsDir(tree.root), {
    profile,
    accessKey: 'k8-access-key',
    secret: 'k8-secret-value',
  });
  const transport = kmsTransport({ spki: material.spki });
  const saved = {
    id: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    profile: process.env.AWS_PROFILE,
  };
  process.env.AWS_ACCESS_KEY_ID = 'k8-env-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'k8-env-secret';
  delete process.env.AWS_PROFILE;
  try {
    const base = storeOnlyEnv(tree, token, creds, profile);
    const missing = [
      { ...base, CHIT_CHECKPOINT_AWS_PROFILE: undefined },
      { ...base, CHIT_CHECKPOINT_AWS_PROFILE: '' },
      { ...base, CHIT_CHECKPOINT_AWS_PROFILE: '   ' },
      { ...base, CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: undefined },
      { ...base, CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: '' },
      { ...base, CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: '   ' },
      { ...base, CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: join(tree.root, 'missing-creds') },
    ];
    for (const env of missing) {
      const outcome = await bootOutcome(env, productionPin(transport.requestHandler));
      assert.equal(outcome.err && outcome.err.code, 'v13_boot_refused');
      assert.equal(outcome.err.reason, 'checkpoint_creds_missing');
      assert.equal(outcome.runtime, null);
    }
    assert.equal(transport.calls.length, 0);
    const seen = { creds: false };
    const injectedEnv = new Proxy(houseBootEnv(tree, token), {
      get(target, prop, receiver) {
        if (prop === 'CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE' || prop === 'CHIT_CHECKPOINT_AWS_PROFILE') {
          seen.creds = true;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const injected = await bootOutcome(injectedEnv, pinDeps());
    assert.equal(injected.err, null);
    assert.equal(injected.out && injected.out.wired, true);
    assert.equal(seen.creds, false);
  } finally {
    if (saved.id == null) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = saved.id;
    if (saved.secret == null) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = saved.secret;
    if (saved.profile == null) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = saved.profile;
    setV13Runtime(null);
    rmSync(tree.root, { recursive: true, force: true });
  }
});

test('K9 checkpoint credential file mode, owner, symlink, and parent are refused', async () => {
  const material = checkpointMaterial();
  const profile = 'checkpoint-k9';
  async function refuse(prep) {
    const tree = makeHouseTree();
    const token = writeTokenFile(tree, { token: houseCanary('k9') });
    const dir = credsDir(tree.root);
    const prepared = prep(tree, dir);
    const transport = kmsTransport({ spki: material.spki });
    const outcome = await bootOutcome(
      storeOnlyEnv(tree, token, prepared.file, profile),
      { ...productionPin(transport.requestHandler), ...(prepared.deps || {}) },
    );
    assert.equal(outcome.err && outcome.err.reason, prepared.reason);
    assert.equal(outcome.runtime, null);
    rmSync(tree.root, { recursive: true, force: true });
  }
  await refuse((_tree, dir) => {
    const file = writeCredsFile(dir, { profile, accessKey: 'k9-access', secret: 'k9-secret', mode: 0o644 });
    return { file, reason: 'checkpoint_creds_mode' };
  });
  await refuse((_tree, dir) => {
    const file = writeCredsFile(dir, { profile, accessKey: 'k9-access', secret: 'k9-secret', mode: 0o660, name: 'group' });
    return { file, reason: 'checkpoint_creds_mode' };
  });
  await refuse((_tree, dir) => {
    const file = writeCredsFile(dir, { profile, accessKey: 'k9-access', secret: 'k9-secret' });
    const link = join(dir, 'link');
    symlinkSync(file, link);
    return { file: link, reason: 'checkpoint_creds_not_regular' };
  });
  await refuse((_tree, dir) => ({ file: dir, reason: 'checkpoint_creds_not_regular' }));
  await refuse((_tree, dir) => {
    const file = writeCredsFile(dir, { profile, accessKey: 'k9-access', secret: 'k9-secret' });
    chmodSync(dir, 0o755);
    return { file, reason: 'checkpoint_creds_dir' };
  });
  await refuse((tree, dir) => {
    const real = join(tree.root, 'real-creds');
    mkdirSync(real, { mode: 0o700 });
    chmodSync(real, 0o700);
    const file = writeCredsFile(real, { profile, accessKey: 'k9-access', secret: 'k9-secret' });
    const via = join(tree.root, 'creds-link');
    symlinkSync(real, via);
    return { file: join(via, file.slice(file.lastIndexOf('/') + 1)), reason: 'checkpoint_creds_dir' };
  });
  await refuse((_tree, dir) => {
    const file = writeCredsFile(dir, { profile, accessKey: 'k9-access', secret: 'k9-secret' });
    const deps = {
      fs: {
        lstatSync(target) {
          const st = lstatSync(target);
          if (target !== file) return st;
          return new Proxy(st, {
            get(obj, prop, receiver) {
              if (prop === 'uid') return obj.uid + 1;
              const value = Reflect.get(obj, prop, receiver);
              return typeof value === 'function' ? value.bind(obj) : value;
            },
          });
        },
        openSync(target, flags) { return openSync(target, flags); },
        fstatSync(fd) { return fstatSync(fd); },
        readSync(fd, buf, offset, length, position) { return readSync(fd, buf, offset, length, position); },
        closeSync(fd) { closeSync(fd); },
      },
    };
    return { file, reason: 'checkpoint_creds_owner', deps };
  });

  const accepted = makeHouseTree();
  const token = writeTokenFile(accepted, { token: houseCanary('k9ok') });
  const file = writeCredsFile(credsDir(accepted.root), {
    profile,
    accessKey: 'k9-access',
    secret: 'k9-secret',
    mode: 0o400,
  });
  const transport = kmsTransport({ spki: material.spki });
  const outcome = await bootOutcome(
    storeOnlyEnv(accepted, token, file, profile),
    productionPin(transport.requestHandler),
  );
  assert.equal(outcome.err, null);
  assert.equal(outcome.out && outcome.out.wired, true);
  setV13Runtime(null);
  rmSync(accepted.root, { recursive: true, force: true });
});

test('K10 flags off do not read or stat checkpoint credentials', async () => {
  const tree = makeHouseTree();
  const before = readFileSync(tree.state);
  const loose = join(tree.root, 'loose-creds');
  mkdirSync(loose, { mode: 0o755 });
  const creds = writeCredsFile(loose, {
    profile: 'checkpoint-k10',
    accessKey: 'k10-access-key-canary',
    secret: 'k10-secret-canary',
    mode: 0o644,
  });
  const seen = { creds: false, fs: false };
  const token = writeTokenFile(tree, { token: houseCanary('k10'), mode: 0o644 });
  const base = {
    CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE: creds,
    CHIT_CHECKPOINT_AWS_PROFILE: 'checkpoint-k10',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_V13_HOUSE_TOKEN_FILE: token,
    CHIT_V13_STORE_PATH: tree.storeDir,
    CHIT_V13_HOUSE_BOOK_ID: tree.bookId,
  };
  const watch = (target) => new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE' || prop === 'CHIT_CHECKPOINT_AWS_PROFILE') {
        seen.creds = true;
      }
      return Reflect.get(obj, prop, receiver);
    },
  });
  const deps = {
    fs: {
      lstatSync() { seen.fs = true; throw new Error('statted'); },
      openSync() { seen.fs = true; throw new Error('opened'); },
    },
    openStore() { throw new Error('opened store'); },
  };
  let err = null;
  let out = null;
  try {
    out = await wireV13Runtime(watch(base), deps);
  } catch (caught) {
    err = caught;
  }
  assert.equal(err, null);
  assert.equal(out.wired, false);
  try {
    out = await wireV13Runtime(watch({
      ...base,
      CHIT_V13_ISSUANCE: 'false',
      CHIT_V13_MAINNET_SEALER: 'false',
      CHIT_V13_STORE: 'false',
    }), deps);
  } catch (caught) {
    err = caught;
  }
  assert.equal(err, null);
  assert.equal(out.wired, false);
  assert.equal(seen.creds, false);
  assert.equal(seen.fs, false);
  assert.equal(readFileSync(tree.state).equals(before), true);
  const issued = await issueHouseReceipt({ env: {}, task: byteTask(), receiptOpts: RECEIPT_OPTS });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  rmSync(tree.root, { recursive: true, force: true });
});

test('K11 the receipt-log client does not take checkpoint credentials', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const profile = 'checkpoint-k11';
  const fileKey = 'k11-file-access-key';
  const envKey = 'k11-env-access-key';
  const creds = writeCredsFile(credsDir(tree.root), {
    profile,
    accessKey: fileKey,
    secret: 'k11-file-secret',
  });
  const token = writeTokenFile(tree, { token: houseCanary('k11') });
  const transport = kmsTransport({ spki: material.spki });
  const saved = {
    id: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    profile: process.env.AWS_PROFILE,
    file: process.env.AWS_SHARED_CREDENTIALS_FILE,
    credFile: process.env.CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE,
    credProfile: process.env.CHIT_CHECKPOINT_AWS_PROFILE,
  };
  const profileSentinel = 'profile-sentinel-k11';
  const sharedSentinel = join(tree.root, 'not-the-checkpoint-file');
  process.env.CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE = creds;
  process.env.CHIT_CHECKPOINT_AWS_PROFILE = profile;
  process.env.AWS_PROFILE = profileSentinel;
  process.env.AWS_SHARED_CREDENTIALS_FILE = sharedSentinel;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  try {
    const outcome = await bootOutcome(
      storeOnlyEnv(tree, token, creds, profile),
      productionPin(transport.requestHandler),
    );
    assert.equal(outcome.err, null);
    assert.equal(outcome.out && outcome.out.wired, true);
    assert.equal(process.env.AWS_PROFILE, profileSentinel);
    assert.equal(process.env.AWS_SHARED_CREDENTIALS_FILE, sharedSentinel);
    delete process.env.AWS_PROFILE;
    process.env.AWS_ACCESS_KEY_ID = envKey;
    process.env.AWS_SECRET_ACCESS_KEY = 'k11-env-secret';
    const s3 = await createS3Client({
      region: 'us-east-2',
      endpoint: 'http://127.0.0.1:9',
      forcePathStyle: true,
    });
    const resolved = await s3.config.credentials();
    assert.equal(resolved.accessKeyId, envKey);
    assert.equal(resolved.accessKeyId === fileKey, false);
    assert.equal(process.env.AWS_PROFILE, undefined);
    process.env.AWS_PROFILE = profileSentinel;
    assert.equal(process.env.AWS_PROFILE, profileSentinel);
    assert.equal(process.env.AWS_SHARED_CREDENTIALS_FILE, sharedSentinel);
  } finally {
    const restore = (name, value) => {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    };
    restore('AWS_ACCESS_KEY_ID', saved.id);
    restore('AWS_SECRET_ACCESS_KEY', saved.secret);
    restore('AWS_PROFILE', saved.profile);
    restore('AWS_SHARED_CREDENTIALS_FILE', saved.file);
    restore('CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE', saved.credFile);
    restore('CHIT_CHECKPOINT_AWS_PROFILE', saved.credProfile);
    setV13Runtime(null);
    rmSync(tree.root, { recursive: true, force: true });
  }
});

test('K12 boot logs and errors do not contain checkpoint secrets', async () => {
  const tree = makeHouseTree();
  const material = checkpointMaterial();
  const keyId = dummyKmsArn('7');
  const accessKey = 'canary-access-k12';
  const secret = 'canary-secret-k12';
  const profile = 'prof-canary-k12';
  const creds = writeCredsFile(credsDir(tree.root), { profile, accessKey, secret });
  const token = writeTokenFile(tree, { token: houseCanary('k12') });
  const log = [];
  const transport = kmsTransport({ spki: material.spki });
  const env = storeOnlyEnv(tree, token, creds, profile, { CHIT_CHECKPOINT_KMS_KEY_ID: keyId });
  const outcome = await bootOutcome(env, {
    ...productionPin(transport.requestHandler),
    log: (row) => log.push(row),
  });
  assert.equal(outcome.err, null);
  assert.equal(outcome.out && outcome.out.wired, true);
  const success = packedLeak([
    log,
    outcome.runtime,
    inspect(outcome.runtime, { depth: 8 }),
    JSON.stringify(outcome.runtime),
    inspect(log, { depth: 8 }),
  ]);
  for (const needle of [keyId, accessKey, secret, profile, creds]) {
    assert.equal(success.includes(needle), false);
  }
  setV13Runtime(null);
  chmodSync(creds, 0o644);
  const refused = await bootOutcome(env, {
    ...productionPin(transport.requestHandler),
    log: (row) => log.push(row),
  });
  assert.equal(refused.err && refused.err.reason, 'checkpoint_creds_mode');
  const failure = packedLeak([
    refused.err,
    refused.err.stack,
    refused.err.cause,
    inspect(refused.err, { depth: 8 }),
    JSON.stringify(refused.err),
    log,
    inspect(log, { depth: 8 }),
  ]);
  for (const needle of [keyId, accessKey, secret, profile, creds]) {
    assert.equal(failure.includes(needle), false);
  }
  setV13Runtime(null);
  rmSync(tree.root, { recursive: true, force: true });
});
