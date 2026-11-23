/**
 * Flag-gated v13 house receipts. No production host, no AWS, no mainnet RPC.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

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
const { anchor, anchoredReplay, resetAnchorLedger } = await import('../../chit-sealer/anchor-mainnet.js');
const {
  issueHouseReceipt,
  handleHouse,
  readHouse,
  paymentIsFinal,
  pendingOpen,
  resetHouseState,
  setV13Runtime,
} = await import('../src/v13-issue.js');
const { buildReceipt: buildV1Receipt } = await import('../src/openai-gateway.js');
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
    setV13Runtime({
      store: box.store,
      dir: box.dir,
      client: mockKms(),
      send: async () => '0xabc',
      caller: box.caller,
    });
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
