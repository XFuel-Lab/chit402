/**
 * Crash between commitEpoch and the intake seal.
 * Offline. Local files only. No production host.
 */
import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { SECP256K1, eip1559Digest, eip1559Serialize, eip1559TxHash } from '../../../packages/cs2-core/ecdsa/index.js';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { closeHour, openSealer, recover } from '../../chit-sealer/close.js';
import { MAINNET_CHECKPOINT } from '../../chit-sealer/mainnet-pin.js';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { migrateHouseEpochs, openStore as realOpen } from '../../chit-store/store.js';
import { INTAKE_FILE, bookLeaf, openIntake } from '../../chit-store/intake.js';
import { wireV13Runtime } from '../src/v13-boot.js';
import { readV13Runtime, setV13Runtime } from '../src/v13-issue.js';

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
const openStore = realOpen;

const derived = deriveKeyPair(Uint8Array.of(7, 7, 7, 7));
if (!derived.ok) throw new Error(derived.reason);
const BOOK = {
  id: 'aa'.repeat(32),
  token: 'book-a-token',
  bookPk: derived.pk,
  wallets: [`0x${'33'.repeat(20)}`],
};

// Store-io calls after the commit's directory fsync and before the intake rename.
const WINDOW = [
  ['closeSync', 'store dir close after commit fsync'],
  ['existsSync', 'intake exists'],
  ['openSync', 'intake open'],
  ['readFileSync', 'intake read'],
  ['closeSync', 'intake close'],
  ['mkdirSync', 'intake mkdir'],
  ['existsSync', 'intake tmp exists'],
  ['openSync', 'intake tmp open'],
  ['fchmodSync', 'intake tmp mode'],
  ['writeSync', 'intake tmp write'],
  ['fsyncSync', 'intake tmp fsync'],
  ['closeSync', 'intake tmp close'],
  ['renameSync', 'intake rename'],
];

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

function hexOf(line) {
  return Buffer.from(line).toString('hex');
}

function paymentRef(fill) {
  return fill.repeat(80);
}

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'epoch-intake-crash-'));
  const storeDir = join(root, 'store');
  const sealerDir = join(root, 'sealer');
  const store = openStore(storeDir, { books: [BOOK] });
  return { root, storeDir, sealerDir, store };
}

function armCrash(store, index) {
  const base = store.io;
  let phase = 'pre';
  let n = 0;
  let crashed = null;
  const names = ['mkdirSync', 'existsSync', 'chmodSync', 'openSync', 'fchmodSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'readFileSync'];
  const wrap = (name) => (...args) => {
    if (phase === 'pre' && name === 'renameSync' && typeof args[1] === 'string' && args[1].endsWith('store-state.json')) {
      phase = 'renamed';
    } else if (phase === 'renamed' && name === 'fsyncSync') {
      phase = 'durable';
    } else if (phase === 'durable') {
      if (crashed != null || n === index) {
        if (crashed == null) crashed = name;
        const err = new Error(`crash before ${crashed}`);
        err.code = 'injected_crash';
        throw err;
      }
      n += 1;
    }
    return base[name](...args);
  };
  const io = { ...base };
  for (let i = 0; i < names.length; i += 1) io[names[i]] = wrap(names[i]);
  store.io = io;
  return () => crashed;
}

function fileBytes(dir) {
  const names = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()).sort();
  const out = {};
  for (let i = 0; i < names.length; i += 1) out[names[i]] = readFileSync(join(dir, names[i]));
  return out;
}

function epochsOf(store, lineHex) {
  const found = [];
  for (const item of store.receipts.values()) {
    if (item && item.line === lineHex) found.push(Number(item.epoch));
  }
  return found;
}

function sendOk() {
  return async () => `0x${'ab'.repeat(32)}`;
}

async function crashThenNextHour(index, expectedOp) {
  const box = fresh();
  try {
    assert.equal(existsSync(join(box.storeDir, INTAKE_FILE)), false);
    const line1 = coreLine(1);
    const booked = bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
      paymentRef: paymentRef('ab'),
      line: line1,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: 0,
    });
    assert.equal(booked.ok, true, booked.reason);
    const crashedOp = armCrash(box.store, index);
    const sealer = openSealer({
      dir: box.sealerDir,
      store: box.store,
      signer: mockSigner(),
      chainId: CHAIN_ID,
      contract: CONTRACT,
      clock: () => HOUR,
    });
    const first = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(first.ok, false);
    assert.equal(crashedOp(), expectedOp);

    const restarted = openStore(box.storeDir, { books: [BOOK] });
    const again = openSealer({
      dir: box.sealerDir,
      store: restarted,
      signer: mockSigner(),
      chainId: CHAIN_ID,
      contract: CONTRACT,
      clock: () => HOUR * 3,
    });
    const beforeReplay = {
      store: readFileSync(join(box.storeDir, 'store-state.json')),
      intake: readFileSync(join(box.storeDir, INTAKE_FILE)),
      journal: readFileSync(join(box.sealerDir, 'sealer-state.json')),
    };
    const replay = await closeHour(again, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, 'hour_already_covered');
    assert.deepEqual(readFileSync(join(box.storeDir, 'store-state.json')), beforeReplay.store);
    assert.deepEqual(readFileSync(join(box.storeDir, INTAKE_FILE)), beforeReplay.intake);
    assert.deepEqual(readFileSync(join(box.sealerDir, 'sealer-state.json')), beforeReplay.journal);
    assert.equal(restarted.epochs.size, 1);

    const recovered = await recover(again, { send: sendOk() });
    assert.equal(recovered.ok, true, recovered.reason);
    const line2 = coreLine(2);
    const second = bookLeaf(openIntake(box.storeDir, { io: restarted.io }), {
      paymentRef: paymentRef('cd'),
      line: line2,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: HOUR,
    });
    assert.equal(second.ok, true, second.reason);
    const next = await closeHour(again, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(next.ok, true, next.reason);
    assert.deepEqual(epochsOf(restarted, hexOf(line1)), [1]);
    assert.deepEqual(epochsOf(restarted, hexOf(line2)), [2]);
    const sealedIntake = readFileSync(join(box.storeDir, INTAKE_FILE));
    openStore(box.storeDir, { books: [BOOK] });
    assert.deepEqual(readFileSync(join(box.storeDir, INTAKE_FILE)), sealedIntake);
    const seen = new Map();
    for (const item of restarted.receipts.values()) {
      const list = seen.get(item.line) || [];
      list.push(Number(item.epoch));
      seen.set(item.line, list);
    }
    for (const epochs of seen.values()) assert.deepEqual(epochs.length, 1);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
}

for (let i = 0; i < WINDOW.length; i += 1) {
  const [op, label] = WINDOW[i];
  test(`crash before ${label}: replay is a no-op and each leaf is in one epoch`, async () => {
    await crashThenNextHour(i, op);
  });
}

test('flags off boot leaves store files byte-identical and does not create pending-intake', async () => {
  const root = mkdtempSync(join(tmpdir(), 'epoch-intake-flags-'));
  try {
    const withIntake = join(root, 'with-intake');
    const without = join(root, 'without');
    mkdirSync(withIntake);
    mkdirSync(without);
    const line = hexOf(coreLine(4));
    const rootHex = createHash('sha256').update(Buffer.from(line, 'hex')).digest('hex');
    const state = JSON.stringify({
      v: 1,
      epochs: [{
        epoch: 1,
        hourStart: 0,
        size: 128,
        root: rootHex,
        stateRoot: 'cd'.repeat(32),
        chainId: String(CHAIN_ID),
        contract: CONTRACT,
        checkpoint: DUMMY_ADDRESS,
        released: false,
      }],
      receipts: [{
        id: 'ee'.repeat(16),
        bookId: BOOK.id,
        epoch: 1,
        line,
        index: 0,
        proof: [],
        sealed: '00',
      }],
      books: {},
    });
    writeFileSync(join(withIntake, 'store-state.json'), state);
    writeFileSync(join(withIntake, INTAKE_FILE), JSON.stringify({
      v: 1,
      leaves: [{
        paymentRef: paymentRef('ab'),
        pendingId: '11'.repeat(16),
        bookId: BOOK.id,
        tokenHash: '22'.repeat(32),
        line,
        hourStart: 0,
        state: 'pending_anchor',
        receiptId: null,
        epoch: null,
      }],
    }));
    writeFileSync(join(without, 'store-state.json'), state);
    writeFileSync(join(without, 'marker.txt'), 'leave-me');
    const beforeWith = fileBytes(withIntake);
    const beforeWithout = fileBytes(without);
    const flagsOff = {
      CHIT_V13_ISSUANCE: 'false',
      CHIT_V13_MAINNET_SEALER: 'false',
      CHIT_V13_STORE: 'false',
    };
    const wiredWith = await wireV13Runtime({ ...flagsOff, CHIT_V13_STORE_PATH: withIntake });
    const wiredWithout = await wireV13Runtime({ ...flagsOff, CHIT_V13_STORE_PATH: without });
    assert.deepEqual(wiredWith, { ok: true, wired: false });
    assert.deepEqual(wiredWithout, { ok: true, wired: false });
    assert.deepEqual(fileBytes(withIntake), beforeWith);
    assert.deepEqual(fileBytes(without), beforeWithout);
    assert.equal(Object.hasOwn(fileBytes(without), INTAKE_FILE), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migrateHouseEpochs restores in-memory state when persist fails', () => {
  const box = fresh();
  try {
    const line = hexOf(coreLine(9));
    const root = createHash('sha256').update(Buffer.from(line, 'hex')).digest('hex');
    const salt = Buffer.from(box.store.bookRecord(BOOK.id).bookSalt).toString('hex');
    const intakeText = JSON.stringify({
      v: 1,
      leaves: [{
        paymentRef: paymentRef('ef'),
        pendingId: '11'.repeat(16),
        bookId: BOOK.id,
        tokenHash: '22'.repeat(32),
        line,
        hourStart: 0,
        state: 'pending_anchor',
        receiptId: null,
        epoch: null,
      }],
    });
    writeFileSync(join(box.storeDir, INTAKE_FILE), intakeText);
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
      receipts: [{ id: 'ee'.repeat(16), bookId: BOOK.id, epoch: 1, line }],
      books: { [BOOK.id]: { bookSalt: salt } },
    }));
    const planted = openStore(box.storeDir, { books: [BOOK] });
    assert.equal(readFileSync(join(box.storeDir, INTAKE_FILE), 'utf8'), intakeText);
    const gate = planted.acceptEpoch({
      epoch: 2,
      hourStart: HOUR,
      size: 128,
      root: 'ab'.repeat(32),
      stateRoot: 'cd'.repeat(32),
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      checkpoint: DUMMY_ADDRESS,
      receipts: [],
    });
    assert.equal(gate.reason, 'epoch_house_conflict');
    const epochKeys = [...planted.epochs.keys()];
    const receiptKeys = [...planted.receipts.keys()];
    const retired = planted.houseRetired;
    const base = planted.io;
    planted.io = {
      ...base,
      renameSync(from, to) {
        if (String(to).endsWith('store-state.json')) {
          const err = new Error('ENOSPC');
          err.code = 'ENOSPC';
          throw err;
        }
        return base.renameSync(from, to);
      },
    };
    const moved = migrateHouseEpochs(planted);
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, 'store_not_committed');
    assert.deepEqual([...planted.epochs.keys()], epochKeys);
    assert.deepEqual([...planted.receipts.keys()], receiptKeys);
    assert.equal(planted.houseRetired, retired);
    const disk = JSON.parse(readFileSync(join(box.storeDir, 'store-state.json'), 'utf8'));
    assert.equal(disk.epochs.length, 1);
    assert.equal(disk.houseRetired, undefined);
    const after = planted.acceptEpoch({
      epoch: 1,
      hourStart: 0,
      size: 128,
      root: 'ab'.repeat(32),
      stateRoot: 'cd'.repeat(32),
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      checkpoint: DUMMY_ADDRESS,
      receipts: [],
    });
    assert.equal(after.reason, 'epoch_house_conflict');
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

function intakeRows(dir) {
  return JSON.parse(readFileSync(join(dir, INTAKE_FILE), 'utf8')).leaves;
}

function receiptIdFor(store, lineHex) {
  for (const item of store.receipts.values()) {
    if (item && item.line === lineHex) return item.id;
  }
  return null;
}

function sealerOn(box, store, now) {
  return openSealer({
    dir: box.sealerDir,
    store,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => now,
  });
}

test('boot is refused when the startup intake seal fails', async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  setV13Runtime(null);
  const root = mkdtempSync(join(tmpdir(), 'epoch-intake-boot-'));
  try {
    const storeDir = join(root, 'store');
    const bindDir = join(root, 'bind');
    const secretDir = join(root, 'secret');
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(bindDir, { recursive: true });
    mkdirSync(secretDir, { recursive: true });
    chmodSync(storeDir, 0o700);
    chmodSync(bindDir, 0o700);
    chmodSync(secretDir, 0o700);
    const opened = openStore(storeDir, { books: [BOOK] });
    const salt = Buffer.from(opened.bookRecord(BOOK.id).bookSalt).toString('hex');
    const line = hexOf(coreLine(21));
    writeFileSync(join(storeDir, 'store-state.json'), JSON.stringify({
      v: 1,
      epochs: [{
        epoch: 1,
        hourStart: 0,
        size: 128,
        root: 'ab'.repeat(32),
        stateRoot: 'cd'.repeat(32),
        chainId: String(CHAIN_ID),
        contract: CONTRACT,
        checkpoint: DUMMY_ADDRESS,
        released: false,
      }],
      receipts: [{
        id: 'ee'.repeat(16),
        bookId: BOOK.id,
        epoch: 1,
        line,
        index: 0,
        proof: [],
        sealed: '00',
      }],
      books: { [BOOK.id]: { bookSalt: salt } },
    }));
    writeFileSync(join(storeDir, INTAKE_FILE), JSON.stringify({
      v: 1,
      leaves: [{
        paymentRef: paymentRef('ab'),
        pendingId: '11'.repeat(16),
        bookId: BOOK.id,
        tokenHash: '22'.repeat(32),
        line,
        hourStart: 0,
        state: 'pending_anchor',
        receiptId: null,
        epoch: null,
      }],
    }));
    const tokenFile = join(secretDir, 'house.json');
    writeFileSync(tokenFile, JSON.stringify({
      v: 1,
      bookId: BOOK.id,
      token: 'book-a-token-value',
      bookPk: Buffer.from(BOOK.bookPk).toString('hex'),
    }), { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    let caught = null;
    try {
      await wireV13Runtime({
        CHIT_V13_ISSUANCE: 'false',
        CHIT_V13_MAINNET_SEALER: 'false',
        CHIT_V13_STORE: 'true',
        CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
        CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
        CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
        CHIT_V13_STORE_PATH: storeDir,
        CHIT_V13_BIND_DIR: bindDir,
        CHIT_V13_HOUSE_BOOK_ID: BOOK.id,
        CHIT_V13_HOUSE_TOKEN_FILE: tokenFile,
      }, {
        testInjection: true,
        addressOf: () => MAINNET_CHECKPOINT,
        client: {
          async send(command) {
            if (command?.name !== 'GetPublicKey') return {};
            const pub = publicPoint(DUMMY_D, SECP256K1);
            const jwk = {
              kty: 'EC',
              crv: 'secp256k1',
              x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
              y: Buffer.from(pub.subarray(33)).toString('base64url'),
            };
            return {
              KeySpec: 'ECC_SECG_P256K1',
              KeyUsage: 'SIGN_VERIFY',
              PublicKey: createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }),
            };
          },
        },
        openStore(dir, opts = {}) {
          const io = {
            ...fs,
            renameSync(from, to) {
              if (String(to).endsWith(INTAKE_FILE)) {
                const err = new Error('ENOSPC');
                err.code = 'ENOSPC';
                throw err;
              }
              return fs.renameSync(from, to);
            },
          };
          return realOpen(dir, { ...opts, io });
        },
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught);
    assert.equal(caught.code, 'v13_boot_refused');
    assert.equal(readV13Runtime(), null);
    assert.equal(intakeRows(storeDir)[0].receiptId, null);
    assert.equal(intakeRows(storeDir)[0].epoch, null);
  } finally {
    setV13Runtime(null);
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
});

test('only the committed leaf is stamped and the other is minted next hour', async () => {
  const box = fresh();
  try {
    const line1 = coreLine(31);
    const line2 = coreLine(32);
    const booked = bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
      paymentRef: paymentRef('ab'),
      line: line1,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: 0,
    });
    assert.equal(booked.ok, true, booked.reason);
    const sealer = sealerOn(box, box.store, HOUR);
    const closed = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(closed.ok, true, closed.reason);
    const parsed = JSON.parse(readFileSync(join(box.storeDir, INTAKE_FILE), 'utf8'));
    parsed.leaves[0].receiptId = null;
    parsed.leaves[0].epoch = null;
    writeFileSync(join(box.storeDir, INTAKE_FILE), JSON.stringify(parsed));
    const second = bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
      paymentRef: paymentRef('cd'),
      line: line2,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: HOUR,
    });
    assert.equal(second.ok, true, second.reason);
    const restarted = openStore(box.storeDir, { books: [BOOK] });
    const rows = intakeRows(box.storeDir);
    const stamped = rows.find((row) => row.paymentRef === paymentRef('ab'));
    const waiting = rows.find((row) => row.paymentRef === paymentRef('cd'));
    assert.equal(stamped.epoch, 1);
    assert.equal(stamped.receiptId, receiptIdFor(restarted, hexOf(line1)));
    assert.equal(waiting.receiptId, null);
    assert.equal(waiting.epoch, null);
    const again = sealerOn(box, restarted, HOUR * 3);
    const next = await closeHour(again, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(next.ok, true, next.reason);
    assert.deepEqual(epochsOf(restarted, hexOf(line1)), [1]);
    assert.deepEqual(epochsOf(restarted, hexOf(line2)), [2]);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('the stamped intake epoch is exactly the committed epoch number', () => {
  const box = fresh();
  try {
    const opened = openStore(box.storeDir, { books: [BOOK] });
    const salt = Buffer.from(opened.bookRecord(BOOK.id).bookSalt).toString('hex');
    const line = 'ab'.repeat(1024);
    writeFileSync(join(box.storeDir, 'store-state.json'), JSON.stringify({
      v: 1,
      epochs: [{
        epoch: 4,
        hourStart: 0,
        size: 128,
        root: 'cd'.repeat(32),
        stateRoot: 'ef'.repeat(32),
        chainId: String(CHAIN_ID),
        contract: CONTRACT,
        checkpoint: DUMMY_ADDRESS,
        released: false,
      }],
      receipts: [{
        id: '12'.repeat(16),
        bookId: BOOK.id,
        epoch: 4,
        line,
        index: 0,
        proof: [],
        sealed: '00',
      }],
      books: { [BOOK.id]: { bookSalt: salt } },
    }));
    writeFileSync(join(box.storeDir, INTAKE_FILE), JSON.stringify({
      v: 1,
      leaves: [{
        paymentRef: paymentRef('ef'),
        pendingId: '11'.repeat(16),
        bookId: BOOK.id,
        tokenHash: '22'.repeat(32),
        line,
        hourStart: 0,
        state: 'pending_anchor',
        receiptId: null,
        epoch: null,
      }],
    }));
    openStore(box.storeDir, { books: [BOOK] });
    const row = intakeRows(box.storeDir)[0];
    assert.equal(row.epoch, 4);
    assert.equal(typeof row.epoch, 'number');
    assert.equal(row.receiptId, '12'.repeat(16));
    const io = {
      ...fs,
      renameSync(from, to) {
        if (String(to).endsWith(INTAKE_FILE)) throw new Error('rewrote sealed intake');
        return fs.renameSync(from, to);
      },
    };
    openStore(box.storeDir, { books: [BOOK], io });
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('migrateHouseEpochs rolls back when the second house epoch fails to book', () => {
  const box = fresh();
  try {
    const line1 = hexOf(coreLine(41));
    const line2 = hexOf(coreLine(42));
    const root1 = createHash('sha256').update(Buffer.from(line1, 'hex')).digest('hex');
    const root2 = createHash('sha256').update(Buffer.from(line2, 'hex')).digest('hex');
    const salt = Buffer.from(box.store.bookRecord(BOOK.id).bookSalt).toString('hex');
    const ref = paymentRef('ab');
    const tokenHash = '22'.repeat(32);
    const receipt = (epoch, line) => ({
      id: epoch === 1 ? '11'.repeat(16) : '22'.repeat(16),
      bookId: BOOK.id,
      epoch,
      line,
      paymentRef: ref,
      tokenHash,
    });
    const epochRow = (epoch, root) => ({
      epoch,
      hourStart: 0,
      size: 1024,
      root,
      stateRoot: 'cd'.repeat(32),
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      checkpoint: DUMMY_ADDRESS,
      released: false,
    });
    writeFileSync(join(box.storeDir, 'store-state.json'), JSON.stringify({
      v: 1,
      epochs: [epochRow(1, root1), epochRow(2, root2)],
      receipts: [receipt(1, line1), receipt(2, line2)],
      books: { [BOOK.id]: { bookSalt: salt } },
    }));
    const planted = openStore(box.storeDir, { books: [BOOK] });
    const epochKeys = [...planted.epochs.keys()];
    const receiptKeys = [...planted.receipts.keys()];
    const retired = planted.houseRetired;
    const moved = migrateHouseEpochs(planted);
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, 'intake_conflict');
    assert.deepEqual([...planted.epochs.keys()], epochKeys);
    assert.deepEqual([...planted.receipts.keys()], receiptKeys);
    assert.equal(planted.houseRetired, retired);
    const gate = planted.acceptEpoch({
      epoch: 1,
      hourStart: 0,
      size: 128,
      root: 'ab'.repeat(32),
      stateRoot: 'cd'.repeat(32),
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      checkpoint: DUMMY_ADDRESS,
      receipts: [],
    });
    assert.equal(gate.reason, 'epoch_house_conflict');
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

function onceRename(store, suffix) {
  const base = store.io;
  let thrown = false;
  store.io = {
    ...base,
    renameSync(from, to) {
      if (!thrown && String(to).endsWith(suffix)) {
        thrown = true;
        const err = new Error(`crash before ${suffix}`);
        err.code = 'injected_crash';
        throw err;
      }
      return base.renameSync(from, to);
    },
  };
}

async function closeBooked(box, n) {
  const line = coreLine(n);
  const booked = bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
    paymentRef: paymentRef('ab'),
    line,
    caller: { bookId: BOOK.id, token: BOOK.token },
    hourStart: 0,
  });
  assert.equal(booked.ok, true, booked.reason);
  const sealer = sealerOn(box, box.store, HOUR);
  return { line, sealer };
}

test('recover stamps intake after a crash before the store rename', async () => {
  const box = fresh();
  try {
    const { line, sealer } = await closeBooked(box, 51);
    onceRename(box.store, 'store-state.json');
    const first = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(first.ok, false);
    assert.equal(first.reason, 'store_not_committed');
    const recovered = await recover(sealer, { send: sendOk() });
    assert.equal(recovered.ok, true, recovered.reason);
    const row = intakeRows(box.storeDir)[0];
    assert.equal(row.epoch, 1);
    assert.equal(row.receiptId, receiptIdFor(box.store, hexOf(line)));
    const line2 = coreLine(52);
    const second = bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
      paymentRef: paymentRef('cd'),
      line: line2,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: HOUR,
    });
    assert.equal(second.ok, true, second.reason);
    const clocked = openSealer({
      dir: box.sealerDir,
      store: box.store,
      signer: mockSigner(),
      chainId: CHAIN_ID,
      contract: CONTRACT,
      clock: () => HOUR * 3,
    });
    const next = await closeHour(clocked, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(next.ok, true, next.reason);
    assert.deepEqual(epochsOf(box.store, hexOf(line)), [1]);
    assert.deepEqual(epochsOf(box.store, hexOf(line2)), [2]);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('a failed intake seal is stamped on the next close without a restart', async () => {
  const box = fresh();
  try {
    const { line, sealer } = await closeBooked(box, 61);
    onceRename(box.store, INTAKE_FILE);
    const first = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(first.ok, false);
    assert.equal(first.committed, true);
    const clock = { now: HOUR * 3 };
    sealer.clock = () => clock.now;
    const blocked = await closeHour(sealer, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(blocked.reason, 'nonce_reused');
    const row = intakeRows(box.storeDir)[0];
    assert.equal(row.epoch, 1);
    assert.equal(typeof row.epoch, 'number');
    const recovered = await recover(sealer, { send: sendOk() });
    assert.equal(recovered.ok, true, recovered.reason);
    const line2 = coreLine(62);
    bookLeaf(openIntake(box.storeDir, { io: box.store.io }), {
      paymentRef: paymentRef('cd'),
      line: line2,
      caller: { bookId: BOOK.id, token: BOOK.token },
      hourStart: HOUR,
    });
    const next = await closeHour(sealer, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(next.ok, true, next.reason);
    assert.deepEqual(epochsOf(box.store, hexOf(line)), [1]);
    assert.deepEqual(epochsOf(box.store, hexOf(line2)), [2]);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

test('a stuck intake rename does not mint a committed leaf into the next epoch', async () => {
  const box = fresh();
  try {
    const { line, sealer } = await closeBooked(box, 71);
    const base = box.store.io;
    box.store.io = {
      ...base,
      renameSync(from, to) {
        if (String(to).endsWith(INTAKE_FILE)) {
          const err = new Error('ENOSPC');
          err.code = 'ENOSPC';
          throw err;
        }
        return base.renameSync(from, to);
      },
    };
    const first = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    assert.equal(first.ok, false);
    assert.equal(first.committed, true);
    const recovered = await recover(sealer, { send: sendOk() });
    assert.equal(recovered.ok, true, recovered.reason);
    assert.equal(intakeRows(box.storeDir)[0].receiptId, null);
    sealer.clock = () => HOUR * 3;
    const next = await closeHour(sealer, { hourStart: HOUR, lines: [], fees: FEES, send: sendOk() });
    assert.equal(next.ok, true, next.reason);
    assert.deepEqual(epochsOf(box.store, hexOf(line)), [1]);
    assert.equal(box.store.epochs.size, 2);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
});

function storeOnlyEnv(storeDir, bindDir, tokenFile) {
  return {
    CHIT_V13_ISSUANCE: 'false',
    CHIT_V13_MAINNET_SEALER: 'false',
    CHIT_V13_STORE: 'true',
    CHIT_CHECKPOINT_KMS_KEY_ID: 'alias/test-checkpoint',
    CHIT_CHECKPOINT_KMS_REGION: 'us-east-2',
    CHIT_CHECKPOINT_ADDRESS: MAINNET_CHECKPOINT,
    CHIT_V13_STORE_PATH: storeDir,
    CHIT_V13_BIND_DIR: bindDir,
    CHIT_V13_HOUSE_BOOK_ID: BOOK.id,
    CHIT_V13_HOUSE_TOKEN_FILE: tokenFile,
  };
}

function pinClient() {
  return {
    testInjection: true,
    addressOf: () => MAINNET_CHECKPOINT,
    client: {
      async send(command) {
        if (command?.name !== 'GetPublicKey') return {};
        const pub = publicPoint(DUMMY_D, SECP256K1);
        const jwk = {
          kty: 'EC',
          crv: 'secp256k1',
          x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
          y: Buffer.from(pub.subarray(33)).toString('base64url'),
        };
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          PublicKey: createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }),
        };
      },
    },
  };
}

test('store-only boot does not create intake and leaves an unmatched directory byte-identical', async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  setV13Runtime(null);
  const root = mkdtempSync(join(tmpdir(), 'epoch-intake-store-only-'));
  try {
    const matched = join(root, 'unmatched');
    const bare = join(root, 'bare');
    const bindDir = join(root, 'bind');
    const secretDir = join(root, 'secret');
    for (const dir of [matched, bare, bindDir, secretDir]) {
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o700);
    }
    const tokenFile = join(secretDir, 'house.json');
    writeFileSync(tokenFile, JSON.stringify({
      v: 1,
      bookId: BOOK.id,
      token: 'book-a-token-value',
      bookPk: Buffer.from(BOOK.bookPk).toString('hex'),
    }), { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    const saltStore = openStore(matched, { books: [BOOK] });
    const salt = Buffer.from(saltStore.bookRecord(BOOK.id).bookSalt).toString('hex');
    const committed = 'ab'.repeat(1024);
    const other = 'cd'.repeat(1024);
    const state = JSON.stringify({
      v: 1,
      epochs: [{
        epoch: 1,
        hourStart: 0,
        size: 128,
        root: '11'.repeat(32),
        stateRoot: '22'.repeat(32),
        chainId: String(CHAIN_ID),
        contract: CONTRACT,
        checkpoint: DUMMY_ADDRESS,
        released: false,
      }],
      receipts: [{
        id: 'ee'.repeat(16),
        bookId: BOOK.id,
        epoch: 1,
        line: committed,
        index: 0,
        proof: [],
        sealed: '00',
      }],
      books: { [BOOK.id]: { bookSalt: salt } },
    });
    writeFileSync(join(matched, 'store-state.json'), state);
    writeFileSync(join(matched, INTAKE_FILE), JSON.stringify({
      v: 1,
      leaves: [{
        paymentRef: paymentRef('ef'),
        pendingId: '11'.repeat(16),
        bookId: BOOK.id,
        tokenHash: '22'.repeat(32),
        line: other,
        hourStart: 0,
        state: 'pending_anchor',
        receiptId: null,
        epoch: null,
      }],
    }));
    writeFileSync(join(bare, 'store-state.json'), state);
    chmodSync(matched, 0o700);
    chmodSync(bare, 0o700);
    const beforeMatched = fileBytes(matched);
    const beforeBare = fileBytes(bare);
    const wiredMatched = await wireV13Runtime(storeOnlyEnv(matched, bindDir, tokenFile), pinClient());
    setV13Runtime(null);
    const wiredBare = await wireV13Runtime(storeOnlyEnv(bare, bindDir, tokenFile), pinClient());
    assert.equal(wiredMatched.wired, true);
    assert.equal(wiredBare.wired, true);
    assert.deepEqual(fileBytes(matched), beforeMatched);
    assert.deepEqual(fileBytes(bare), beforeBare);
    assert.equal(existsSync(join(bare, INTAKE_FILE)), false);
  } finally {
    setV13Runtime(null);
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
});
