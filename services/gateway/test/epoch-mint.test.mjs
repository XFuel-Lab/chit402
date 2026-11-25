/**
 * Epoch mint. Only closeHour advances the sealer counter.
 * Offline. Local files only. No production host.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { eip1559Digest, eip1559Serialize, eip1559TxHash, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { SECP256K1 } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { LAYOUT, authorizationKey, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { buildAnchorCalldata } from '../../chit-sealer/calldata.js';
import { closeHour, openSealer, recover } from '../../chit-sealer/close.js';
import { TIER_N } from '../../chit-sealer/pad.js';
import {
  commitAnchorIntent,
  openAnchorIntentLog,
  signCommittedAnchor,
} from '../../chit-sealer/kms-secp256k1.js';
import { anchor } from '../../chit-sealer/anchor-mainnet.js';
import { MAINNET_CHECKPOINT, MAINNET_USDC, mainnetPin } from '../../chit-sealer/mainnet-pin.js';
import { bookLeaf, openIntake } from '../../chit-store/intake.js';
import { fetchReceipt, migrateHouseEpochs, noteAnchored, openStore } from '../../chit-store/store.js';
import { sendThroughCommittedAnchor } from '../src/v13-boot.js';
import { v13PaidHookFailure } from '../src/openai-gateway.js';
import { handleHouse, issueHouseReceipt, resetHouseState } from '../src/v13-issue.js';

const HOUR = 3600;
const CHAIN_ID = 31337;
const CONTRACT = '0x3333333333333333333333333333333333333333';
const DUMMY_D = 0xA11CEn;
const DUMMY_ADDRESS = ethereumAddress(publicPoint(DUMMY_D, SECP256K1));
const FROM = '11'.repeat(20);
const PAYER = `0x${FROM}`;
const USDC = MAINNET_USDC.replace(/^0x/, '').toLowerCase();
const FEES = {
  gasLimit: '100000',
  maxFeePerGas: '1000000000',
  maxPriorityFeePerGas: '100000000',
};
const FIXTURE = readFileSync(new URL('./fixtures/v10-issuance-response.json', import.meta.url));

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

function client() {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command?.name || '');
      return {};
    },
  };
}

function tagged(n, fill) {
  const out = Buffer.alloc(32, fill);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  return out.toString('hex');
}

function payment(n, over = {}) {
  return {
    chainId: 8453,
    blockHash: 'ab'.repeat(32),
    blockNumber: 10,
    blockTime: HOUR,
    txIndex: 1,
    localLogIndex: n,
    txHash: tagged(n, 0x71),
    token: USDC,
    from: FROM,
    to: '22'.repeat(20),
    value: '2000',
    method: 1,
    authorizer: FROM,
    nonce: tagged(n, 0x11),
    saltP: tagged(n, 0x51),
    ...over,
  };
}

function observation(n, over = {}) {
  return {
    blockNumber: 10,
    finalizedNumber: 10,
    blockHash: 'ab'.repeat(32),
    blockTime: HOUR,
    txIndex: 1,
    localLogIndex: n,
    txHash: tagged(n, 0x71),
    hourStart: 0,
    ...over,
  };
}

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'epoch-mint-'));
  const storeDir = join(root, 'store');
  const bindDir = join(root, 'bind');
  const book = {
    id: 'aa'.repeat(32),
    token: 'book-token',
    bookPk: new Uint8Array(32).fill(7),
    wallets: [PAYER],
  };
  const store = openStore(storeDir, { books: [book] });
  const clock = { now: HOUR };
  const sealer = openSealer({
    dir: join(root, 'sealer'),
    store,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => clock.now,
  });
  return { root, storeDir, bindDir, book, store, sealer, clock };
}

function issueInput(box, n, extra = {}) {
  return {
    env: flagsOn(),
    dir: box.bindDir,
    store: box.store,
    caller: { bookId: box.book.id, token: box.book.token },
    payment: payment(n),
    observation: observation(n),
    client: extra.client || client(),
    send: async () => '0x1',
    baseUrl: 'http://127.0.0.1',
    ...extra,
  };
}

async function book(box, n, extra) {
  return issueHouseReceipt(issueInput(box, n, extra));
}

function recorder() {
  const wires = [];
  return {
    wires,
    async send(wire) {
      wires.push(wire);
      return `0x${'ab'.repeat(32)}`;
    },
  };
}

async function closeOne(box, hourStart) {
  box.clock.now = hourStart + HOUR;
  return closeHour(box.sealer, {
    hourStart,
    lines: [],
    fees: FEES,
    send: recorder().send,
  });
}

function leafCount(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'pending-intake.json'), 'utf8'));
    return Array.isArray(parsed.leaves) ? parsed.leaves.length : 0;
  } catch {
    return 0;
  }
}

function anchorEvent(record) {
  return {
    finalized: true,
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    chainId: CHAIN_ID,
    contract: CONTRACT,
    from: DUMMY_ADDRESS,
  };
}

test('T1 a thousand house receipts and twenty-four closes stay sequential', async () => {
  resetHouseState();
  const box = fresh();
  for (let n = 1; n <= 1000; n += 1) {
    const issued = await book(box, n);
    assert.equal(issued.status, 202, issued.body && issued.body.code);
    assert.equal(issued.body.state, 'pending_anchor');
  }
  assert.equal(leafCount(box.storeDir), 1000);
  assert.equal(box.store.epochs.size, 0);
  for (let hour = 0; hour < 24; hour += 1) {
    const closed = await closeOne(box, hour * HOUR);
    assert.equal(closed.ok, true, closed.reason);
    assert.notEqual(closed.reason, 'store_conflict');
  }
  const epochs = [...box.store.epochs.keys()].map(Number).sort((a, b) => a - b);
  assert.deepEqual(epochs, Array.from({ length: 24 }, (_, i) => i + 1));
  rmSync(box.root, { recursive: true, force: true });
});

test('T2 a house receipt before and after a close does not freeze the sealer', async () => {
  resetHouseState();
  const box = fresh();
  const first = await book(box, 1);
  assert.equal(first.body.state, 'pending_anchor');
  const closed = await closeOne(box, 0);
  assert.equal(closed.ok, true, closed.reason);
  const second = await book(box, 2);
  assert.equal(second.body.state, 'pending_anchor');
  const next = await closeOne(box, HOUR);
  assert.equal(next.ok, true, next.reason);
  assert.equal(box.store.epochs.has('1'), true);
  assert.equal(box.store.epochs.has('2'), true);
  rmSync(box.root, { recursive: true, force: true });
});

test('T3 the issue path makes no checkpoint Sign call', async () => {
  resetHouseState();
  const box = fresh();
  const kms = client();
  const issued = await book(box, 3, { client: kms });
  assert.equal(issued.body.state, 'pending_anchor');
  assert.equal(kms.calls.includes('Sign'), false);
  assert.equal(kms.calls.filter((name) => name === 'Sign').length, 0);
  rmSync(box.root, { recursive: true, force: true });
});

test('T4 a broadcast tx is a hash from the injected send', async () => {
  const sends = [];
  await assert.rejects(
    () => anchor({
      env: flagsOn(),
      pin: mainnetPin(),
      calldata: 'unprepared',
      client: client(),
      send: async (raw) => {
        sends.push(raw);
        return `0x${'ab'.repeat(32)}`;
      },
    }),
    (err) => err.code === 'anchor_unprepared',
  );
  assert.deepEqual(sends, []);
  const prepared = `0x${'cd'.repeat(32)}`;
  let seen = null;
  const sent = await anchor({
    env: flagsOn(),
    pin: mainnetPin(),
    calldata: 'prepared-once',
    preparedTx: prepared,
    client: client(),
    send: async (raw) => {
      seen = raw;
      return `0x${'ef'.repeat(32)}`;
    },
  });
  assert.equal(seen, prepared);
  assert.equal(sent.tx, `0x${'ef'.repeat(32)}`);
  const root = mkdtempSync(join(tmpdir(), 'epoch-mint-log-'));
  const log = openAnchorIntentLog(root);
  const packed = buildAnchorCalldata({
    chainId: CHAIN_ID,
    contract: CONTRACT,
    epoch: 1,
    hourStart: 0,
    size: TIER_N,
    root: 'ab'.repeat(32),
    stateRoot: 'cd'.repeat(32),
    proof: [],
  });
  commitAnchorIntent(log, {
    chainId: CHAIN_ID,
    to: CONTRACT,
    nonce: 0,
    epoch: 1,
    hourStart: 0,
    size: TIER_N,
    root: 'ab'.repeat(32),
    stateRoot: 'cd'.repeat(32),
    calldata: packed.calldata,
  }, DUMMY_ADDRESS);
  await signCommittedAnchor(mockSigner(), log, { nonce: 0, fees: FEES });
  await assert.rejects(
    () => sendThroughCommittedAnchor(log)(`0x${'11'.repeat(32)}`),
    (err) => err.code === 'anchor_unprepared',
  );
  const broadcast = log.read().filter((row) => row.status === 'broadcast');
  assert.equal(broadcast.length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('T5 a paid house call ends pending, released, or refund_owed', async () => {
  resetHouseState();
  const box = fresh();
  const issued = await book(box, 5);
  assert.equal(issued.status, 202);
  assert.equal(issued.body.state, 'pending_anchor');
  assert.equal(issued.body.code, 'pending_anchor');
  const closed = await closeOne(box, 0);
  assert.equal(closed.ok, true, closed.reason);
  const pendingFetch = fetchReceipt(box.store, {
    receiptId: issued.body.pending_id,
    bookId: box.book.id,
    token: box.book.token,
  });
  assert.equal(pendingFetch.status, 202);
  assert.equal(pendingFetch.body.state, 'pending_anchor');
  const record = box.sealer.state.commits[0];
  assert.equal(noteAnchored(box.store, anchorEvent(record)).released, true);
  const released = fetchReceipt(box.store, {
    receiptId: issued.body.pending_id,
    bookId: box.book.id,
    token: box.book.token,
  });
  assert.equal(released.status, 200);
  assert.equal(typeof released.body.line, 'string');
  const houseRead = await handleHouse({
    method: 'GET',
    receiptId: issued.body.pending_id,
    caller: { bookId: box.book.id, token: box.book.token },
  }, { dir: box.bindDir, store: box.store });
  assert.equal(houseRead.status, 200);
  assert.equal(houseRead.body.line, released.body.line);
  const replay = await book(box, 5);
  assert.equal(replay.status, 200);
  assert.equal(replay.replay, true);
  assert.equal(replay.body.line, released.body.line);
  const broken = fresh();
  const file = join(broken.root, 'not-a-directory');
  writeFileSync(file, 'x');
  broken.store.dir = file;
  const owed = await book(broken, 6);
  assert.equal(owed.status, 409);
  assert.equal(owed.body.state, 'refund_owed');
  assert.equal(owed.body.status, 'refund_owed');
  assert.equal(owed.retryAfter ?? null, null);
  assert.equal(JSON.stringify(owed.body).includes('Retry-After'), false);
  const hook = v13PaidHookFailure(Object.assign(new Error('hold'), {
    code: owed.body.state,
    state: owed.body.state,
    pending_id: owed.body.pending_id,
    verify_url: owed.body.verify_url,
  }), { ref: 'base:local' });
  assert.equal(hook.status, 409);
  assert.equal(hook.body.retryable, false);
  assert.equal(hook.retryAfter, null);
  assert.equal(hook.body.code, 'refund_owed');
  rmSync(box.root, { recursive: true, force: true });
  rmSync(broken.root, { recursive: true, force: true });
});

test('T6 commitEpoch accepts only the next epoch and an exact replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'epoch-mint-store-'));
  const store = openStore(root, {
    books: [{ id: 'aa'.repeat(32), token: 't', bookPk: new Uint8Array(32).fill(1) }],
  });
  const row = (epoch, rootHex = 'ab'.repeat(32)) => ({
    epoch,
    hourStart: epoch,
    size: TIER_N,
    root: rootHex,
    stateRoot: 'cd'.repeat(32),
    chainId: '8453',
    contract: CONTRACT,
    checkpoint: DUMMY_ADDRESS,
    receipts: [],
  });
  assert.equal(store.commitEpoch(row(2)).reason, 'epoch_not_next');
  assert.equal(store.commitEpoch(row(1)).ok, true);
  assert.equal(store.commitEpoch(row(1)).ok, true);
  assert.equal(store.commitEpoch(row(1, 'ef'.repeat(32))).reason, 'store_conflict');
  assert.equal(store.commitEpoch(row(3)).reason, 'epoch_not_next');
  assert.equal(store.commitEpoch(row(2)).ok, true);
  assert.equal(store.commitEpoch({ epoch: 0 }).reason, 'bad_epoch');
  assert.equal(store.commitEpoch({ epoch: 'nope' }).reason, 'bad_epoch');
  rmSync(root, { recursive: true, force: true });
});

test('T7 a planted house epoch is refused until migrate', async () => {
  resetHouseState();
  const box = fresh();
  const line = coreLeaf(7);
  const root = createHash('sha256').update(line).digest('hex');
  const key = authorizationKey({
    chainId: 8453,
    token: USDC,
    authorizer: FROM,
    nonce: tagged(7, 0x11),
  });
  assert.equal(key.ok, true);
  const tokenHash = createHash('sha256').update(box.book.token).digest('hex');
  const salt = Buffer.from(box.store.bookRecord(box.book.id).bookSalt).toString('hex');
  writeFileSync(join(box.storeDir, 'store-state.json'), JSON.stringify({
    v: 1,
    epochs: [{
      epoch: 1,
      hourStart: 0,
      size: 1024,
      root,
      stateRoot: 'cd'.repeat(32),
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      checkpoint: DUMMY_ADDRESS,
      released: false,
    }],
    receipts: [{
      id: 'ee'.repeat(16),
      bookId: box.book.id,
      epoch: 1,
      paymentRef: key.hex,
      tokenHash,
      line: Buffer.from(line).toString('hex'),
    }],
    books: { [box.book.id]: { bookSalt: salt } },
  }));
  const planted = openStore(box.storeDir, { books: [box.book] });
  const sealer = openSealer({
    dir: join(box.root, 'sealer'),
    store: planted,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => HOUR,
  });
  const refused = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: recorder().send });
  assert.equal(refused.reason, 'epoch_house_conflict');
  assert.equal(sealer.state.anchorEpoch, 0);
  const again = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: recorder().send });
  assert.equal(again.reason, 'epoch_house_conflict');
  assert.notEqual(again.reason, 'nonce_reused');
  const recovered = await recover(sealer, { send: recorder().send });
  assert.notEqual(recovered.reason, 'nonce_reused');
  const moved = migrateHouseEpochs(planted);
  assert.equal(moved.ok, true, moved.reason);
  assert.equal(moved.migrated, 1);
  assert.equal(moved.booked, 1);
  const kept = JSON.parse(readFileSync(join(box.storeDir, 'store-state.json'), 'utf8'));
  assert.equal(kept.houseRetired.length, 1);
  assert.equal(kept.epochs.length, 0);
  const reopened = openStore(box.storeDir, { books: [box.book] });
  const after = openSealer({
    dir: join(box.root, 'sealer-2'),
    store: reopened,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => HOUR,
  });
  const closed = await closeHour(after, { hourStart: 0, lines: [], fees: FEES, send: recorder().send });
  assert.equal(closed.ok, true, closed.reason);
  assert.equal(reopened.epochs.has('1'), true);
  rmSync(box.root, { recursive: true, force: true });
});

test('T8 a booked leaf survives a reopen and does not double', async () => {
  resetHouseState();
  const box = fresh();
  const first = await book(box, 8);
  assert.equal(first.body.state, 'pending_anchor');
  const reopened = openStore(box.storeDir, { books: [box.book] });
  const againBox = { ...box, store: reopened };
  const second = await book(againBox, 8);
  assert.equal(second.replay, true);
  assert.equal(second.body.pending_id, first.body.pending_id);
  assert.equal(leafCount(box.storeDir), 1);
  rmSync(box.root, { recursive: true, force: true });
});

test('T9 the same payment ref replays one pending anchor', async () => {
  resetHouseState();
  const box = fresh();
  const first = await book(box, 9);
  const second = await book(box, 9);
  assert.equal(second.replay, true);
  assert.deepEqual(second.bytes, first.bytes);
  assert.equal(leafCount(box.storeDir), 1);
  assert.equal(box.store.epochs.size, 0);
  rmSync(box.root, { recursive: true, force: true });
});

test('T10 the house path does not sign a checkpoint digest', async () => {
  resetHouseState();
  const box = fresh();
  const kms = client();
  const issued = await book(box, 10, { client: kms });
  assert.equal(issued.status, 202);
  assert.equal(kms.calls.includes('Sign'), false);
  const source = readFileSync(new URL('../src/v13-issue.js', import.meta.url), 'utf8');
  const house = source.slice(source.indexOf('async function issueV13'), source.indexOf('function holdFromIntake'));
  assert.equal(house.includes('signDigest'), false);
  assert.equal(house.includes('signMainnetCheckpoint'), false);
  rmSync(box.root, { recursive: true, force: true });
});

test('T11 a different caller does not receive the pending body', async () => {
  resetHouseState();
  const box = fresh();
  const issued = await handleHouse({
    method: 'POST',
    body: { payment: payment(11), observation: observation(11) },
    caller: { bookId: box.book.id, token: box.book.token },
  }, {
    env: flagsOn(),
    dir: box.bindDir,
    store: box.store,
    client: client(),
    send: async () => '0x1',
    baseUrl: 'http://127.0.0.1',
  });
  assert.equal(issued.status, 202);
  const id = issued.body.pending_id;
  const mine = await handleHouse({
    method: 'GET',
    receiptId: id,
    caller: { bookId: box.book.id, token: box.book.token },
  }, { dir: box.bindDir, store: box.store });
  const other = await handleHouse({
    method: 'GET',
    receiptId: id,
    caller: { bookId: 'bb'.repeat(32), token: 'other-token' },
  }, { dir: box.bindDir, store: box.store });
  const unknown = await handleHouse({
    method: 'GET',
    receiptId: 'ff'.repeat(16),
    caller: { bookId: box.book.id, token: box.book.token },
  }, { dir: box.bindDir, store: box.store });
  assert.equal(mine.status, 202);
  assert.equal(mine.body.state, 'pending_anchor');
  assert.equal(other.status, 404);
  assert.deepEqual(other.body, unknown.body);
  assert.equal(JSON.stringify(other.body).includes(box.book.token), false);
  const fetched = fetchReceipt(box.store, {
    receiptId: id,
    bookId: 'bb'.repeat(32),
    token: 'other-token',
  });
  assert.equal(fetched.status, 404);
  assert.deepEqual(fetched.body, unknown.body);
  rmSync(box.root, { recursive: true, force: true });
});

test('T12 a store outage after payment is refund_owed', async () => {
  resetHouseState();
  const box = fresh();
  const file = join(box.root, 'blocked');
  writeFileSync(file, 'x');
  box.store.dir = file;
  const log = [];
  const issued = await book(box, 12, { log });
  assert.equal(issued.status, 409);
  assert.equal(issued.body.state, 'refund_owed');
  assert.equal(issued.body.code, 'refund_owed');
  assert.notEqual(issued.status, 500);
  assert.equal(issued.body.retryable, undefined);
  const hook = v13PaidHookFailure(Object.assign(new Error('book'), {
    code: 'refund_owed',
    state: 'refund_owed',
    pending_id: issued.body.pending_id,
    verify_url: issued.body.verify_url,
  }), null);
  assert.equal(hook.status, 409);
  assert.equal(hook.body.retryable, false);
  assert.equal(hook.body.code, 'refund_owed');
  rmSync(box.root, { recursive: true, force: true });
});

test('T13 canaries stay out of logs and error bodies', async () => {
  resetHouseState();
  const box = fresh();
  const digit = '7';
  const keyId = [
    digit.repeat(8),
    digit.repeat(4),
    digit.repeat(4),
    digit.repeat(4),
    digit.repeat(12),
  ].join('-');
  const arn = ['arn', 'aws', 'kms', 'us-east-2', `${digit.repeat(12)}:key/${keyId}`].join(':');
  const access = `access-${digit.repeat(8)}`;
  const session = `session-${digit.repeat(8)}`;
  const log = [];
  const issued = await book(box, 13, {
    log,
    intakeIo: {
      existsSync() { return false; },
      mkdirSync() {},
      openSync() { throw new Error(`${arn} ${access} ${session}`); },
    },
  });
  const packed = JSON.stringify({ body: issued.body, log, inspect: String(issued.body && issued.body.error) });
  assert.equal(packed.includes(arn), false);
  assert.equal(packed.includes(access), false);
  assert.equal(packed.includes(session), false);
  assert.equal(packed.includes(keyId), false);
  assert.equal(issued.status, 409);
  rmSync(box.root, { recursive: true, force: true });
});

test('a stale intake snapshot does not drop a booked leaf', async () => {
  const box = fresh();
  const first = openIntake(box.storeDir);
  const second = openIntake(box.storeDir);
  const left = bookLeaf(first, {
    paymentRef: authorizationKey({
      chainId: 8453, token: USDC, authorizer: FROM, nonce: tagged(41, 0x11),
    }).hex,
    line: coreLeaf(41),
    caller: { bookId: box.book.id, token: box.book.token },
  });
  const right = bookLeaf(second, {
    paymentRef: authorizationKey({
      chainId: 8453, token: USDC, authorizer: FROM, nonce: tagged(42, 0x11),
    }).hex,
    line: coreLeaf(42),
    caller: { bookId: box.book.id, token: box.book.token },
  });
  assert.equal(left.ok, true, left.reason);
  assert.equal(right.ok, true, right.reason);
  assert.equal(leafCount(box.storeDir), 2);
  rmSync(box.root, { recursive: true, force: true });
});

test('recover stamps a leaf the close left unsealed', async () => {
  resetHouseState();
  const box = fresh();
  const issued = await book(box, 43);
  assert.equal(issued.body.state, 'pending_anchor');
  box.clock.now = HOUR;
  const crashed = await closeHour(box.sealer, {
    hourStart: 0,
    lines: [],
    fees: FEES,
    send: async () => { throw new Error('crash'); },
  });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.committed, true);
  const file = join(box.storeDir, 'pending-intake.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(typeof parsed.leaves[0].receiptId, 'string');
  parsed.leaves[0].receiptId = null;
  parsed.leaves[0].epoch = null;
  writeFileSync(file, JSON.stringify(parsed));
  const again = await recover(box.sealer, { send: recorder().send });
  assert.equal(again.ok, true, again.reason);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(typeof after.leaves[0].receiptId, 'string');
  assert.notEqual(after.leaves[0].receiptId, null);
  rmSync(box.root, { recursive: true, force: true });
});

test('T14 flags off do not write intake or commit an epoch', async () => {
  resetHouseState();
  const box = fresh();
  let commits = 0;
  const store = {
    dir: box.storeDir,
    commitEpoch() { commits += 1; return { ok: true }; },
    epochs: box.store.epochs,
  };
  const stored = JSON.parse(FIXTURE.toString('utf8'));
  const issued = await issueHouseReceipt({
    env: {},
    task: {
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
    },
    receiptOpts: { signingSecret: 'byte-pin-secret', baseUrl: 'http://127.0.0.1:9', readOnly: true },
    store,
    dir: box.bindDir,
    payment: payment(14),
    observation: observation(14),
    client: client(),
    send: async () => '0x1',
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(issued.bytes, FIXTURE);
  assert.equal(commits, 0);
  assert.equal(box.store.epochs.size, 0);
  let intake = false;
  try {
    readFileSync(join(box.storeDir, 'pending-intake.json'));
    intake = true;
  } catch {
    intake = false;
  }
  assert.equal(intake, false);
  rmSync(box.root, { recursive: true, force: true });
});

function coreLeaf(n) {
  const encoded = encodeLine({
    payment: {
      ...SAMPLE.payment,
      value: '2000',
      localLogIndex: n,
      saltP: tagged(n, 0x51),
      txHash: tagged(n, 0x71),
      from: FROM,
      authorizer: FROM,
      nonce: tagged(n, 0x11),
      token: USDC,
    },
    content: { ...SAMPLE.content, sellerKeyId: '00'.repeat(32) },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}
