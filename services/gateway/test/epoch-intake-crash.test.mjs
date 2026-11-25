/**
 * Crash between commitEpoch and the intake seal.
 * Offline. Local files only. No production host.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { SECP256K1, eip1559Digest, eip1559Serialize, eip1559TxHash } from '../../../packages/cs2-core/ecdsa/index.js';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { closeHour, openSealer, recover } from '../../chit-sealer/close.js';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { migrateHouseEpochs, openStore } from '../../chit-store/store.js';
import { INTAKE_FILE, bookLeaf, openIntake } from '../../chit-store/intake.js';
import { wireV13Runtime } from '../src/v13-boot.js';

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
  ['readFileSync', 'intake read'],
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
