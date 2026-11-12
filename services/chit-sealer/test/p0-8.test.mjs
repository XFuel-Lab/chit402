/**
 * Offline P0-8 sealer and store tests.
 * Chain 31337 is a dummy id. No RPC, no KMS, no live network.
 * The signer scalar below is a dummy test value, not a key.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { eip1559Decode, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { SECP256K1, eip1559Digest, eip1559Serialize, eip1559TxHash } from '../../../packages/cs2-core/ecdsa/index.js';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { EMPTY_ROOT_HEX, leafHash, verifyInclusion } from '../../../packages/cs2-core/merkle/index.js';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { closeHour, feeBump, openSealer, pendingCommits, recover } from '../close.js';
import { P_MAX, P_MAX_BODY, P_MAX_STATUS } from '../lines.js';
import { TIER_N } from '../pad.js';
import { MAX_LOG_SIZE, addLogSize } from '../size.js';
import { STORE_BODY, STORE_STATUS, fetchReceipt, noteAnchored, openStore, sealedHeld } from '../../chit-store/store.js';
import fs from 'node:fs';

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
const BOOK_A = { id: 'aa'.repeat(32), token: 'book-a-token' };
const BOOK_B = { id: 'bb'.repeat(32), token: 'book-b-token' };

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

function bookKey() {
  const derived = deriveKeyPair(Uint8Array.of(7, 7, 7, 7));
  if (!derived.ok) throw new Error(derived.reason);
  derived.sk.fill(0);
  return derived.pk;
}

const BOOK_PK = bookKey();

function tagged(n, fill) {
  const out = new Uint8Array(32);
  out.fill(fill);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  return Buffer.from(out).toString('hex');
}

function coreLine({ n = 1, value = '1000000', sellerKey = '00'.repeat(32), zeroSigma = true } = {}) {
  const encoded = encodeLine({
    payment: {
      ...SAMPLE.payment,
      value,
      localLogIndex: n,
      saltP: tagged(n, 0x51),
      txHash: tagged(n, 0x71),
    },
    content: {
      ...SAMPLE.content,
      sellerKeyId: sellerKey,
      saltC: tagged(n, 0x63),
    },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  if (zeroSigma) line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
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

function fresh(extra = {}) {
  const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const root = join(tmpdir(), `p0-8-${stamp}`);
  const sealerDir = join(root, 'sealer');
  const storeDir = join(root, 'store');
  mkdirSync(sealerDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });
  const store = openStore(storeDir, { books: [BOOK_A, BOOK_B], io: extra.io });
  const sealer = openSealer({
    dir: sealerDir,
    store,
    signer: mockSigner(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    randomBytes: extra.randomBytes,
  });
  return { root, sealerDir, storeDir, store, sealer };
}

function lineItem(n, value, book = BOOK_A) {
  return { line: coreLine({ n, value }), bookId: book.id, bookPk: BOOK_PK };
}

function dataOf(wire) {
  return eip1559Decode(wire).data;
}

describe('p0-8 sealer and store', { concurrency: false }, () => {
  test('crash between commit and broadcast resends the same calldata', async () => {
    const { sealerDir, storeDir, sealer } = fresh();
    const crash = {
      async send() {
        throw new Error('crash');
      },
    };
    const first = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(1)],
      fees: FEES,
      send: crash.send,
    });
    assert.equal(first.ok, false);
    assert.equal(first.committed, true);
    assert.equal(first.reason, 'broadcast_failed');
    const pending = pendingCommits(sealer);
    assert.equal(pending.length, 1);
    const committedCalldata = pending[0].calldata;

    const store2 = openStore(storeDir, { books: [BOOK_A, BOOK_B] });
    const sealer2 = openSealer({
      dir: sealerDir,
      store: store2,
      signer: mockSigner(),
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });
    const againSend = recorder();
    const again = await closeHour(sealer2, {
      now: HOUR * 2,
      hourStart: HOUR,
      lines: [lineItem(2)],
      fees: FEES,
      send: againSend.send,
    });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'nonce_reused');
    assert.equal(againSend.wires.length, 0);
    assert.equal(pendingCommits(sealer2)[0].root, pending[0].root);

    const resent = recorder();
    const recovered = await recover(sealer2, { send: resent.send });
    assert.equal(recovered.ok, true);
    assert.equal(resent.wires.length, 1);
    assert.equal(dataOf(resent.wires[0]), committedCalldata);
    assert.equal(pendingCommits(sealer2).length, 0);
  });

  test('fee bump at the same nonce uses identical calldata', async () => {
    const { sealer } = fresh();
    const sent = recorder();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(closed.ok, true, closed.reason);
    const bumpSent = recorder();
    const bumped = await feeBump(sealer, { nonce: closed.record.nonce, send: bumpSent.send });
    assert.equal(bumped.ok, true, bumped.reason);
    assert.equal(bumpSent.wires.length, 1);
    assert.equal(dataOf(bumpSent.wires[0]), dataOf(sent.wires[0]));
    assert.equal(dataOf(bumpSent.wires[0]), closed.calldata);
    assert.equal(bumped.calldata, closed.calldata);
  });

  test('empty hour uses the same close path and pads to N', async () => {
    const { sealer } = fresh();
    const sent = recorder();
    const empty = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(empty.ok, true, empty.reason);
    assert.equal(empty.record.size, TIER_N);
    assert.equal(empty.record.leafCount, TIER_N);
    const filled = await closeHour(sealer, {
      now: HOUR * 2,
      hourStart: HOUR,
      lines: [lineItem(1)],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(filled.ok, true, filled.reason);
    assert.equal(filled.record.size, TIER_N * 2);
    assert.equal(sent.wires.length, 2);
    assert.notEqual(empty.record.stateRoot, filled.record.stateRoot);
  });

  test('unknown, other-book, and unauthenticated share one error', async () => {
    const { sealer, store } = fresh();
    const sent = recorder();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(1)],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(closed.ok, true, closed.reason);
    noteAnchored(store, {
      finalized: true,
      epoch: closed.record.epoch,
      hourStart: closed.record.hourStart,
      size: closed.record.size,
      root: closed.record.root,
      stateRoot: closed.record.stateRoot,
    });
    const id = closedBodyId(store, BOOK_A);
    const unknown = fetchReceipt(store, { receiptId: '00'.repeat(16), bookId: BOOK_A.id, token: BOOK_A.token });
    const other = fetchReceipt(store, { receiptId: id, bookId: BOOK_B.id, token: BOOK_B.token });
    const unauth = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: 'not-the-token' });
    assert.deepEqual(unknown, other);
    assert.deepEqual(other, unauth);
    assert.equal(unknown.status, STORE_STATUS);
    assert.deepEqual(unknown.body, STORE_BODY);
    assert.equal(unknown.ok, false);
    const samples = [unknown, other, unauth].map(() => 0);
    const times = { unknown: [], other: [], unauth: [] };
    for (let i = 0; i < 11; i += 1) {
      times.unknown.push(timeFetch(store, { receiptId: '11'.repeat(16), bookId: BOOK_A.id, token: BOOK_A.token }));
      times.other.push(timeFetch(store, { receiptId: id, bookId: BOOK_B.id, token: BOOK_B.token }));
      times.unauth.push(timeFetch(store, { receiptId: id, bookId: BOOK_A.id, token: 'not-the-token' }));
    }
    assert.equal(timingClass(median(times.unknown)), 'fast');
    assert.equal(timingClass(median(times.other)), timingClass(median(times.unknown)));
    assert.equal(timingClass(median(times.unauth)), timingClass(median(times.unknown)));
    void samples;
  });

  test('P_MAX is accepted and P_MAX + 1 is the uniform payment refusal', async () => {
    const over = fresh();
    const overSend = recorder();
    const refused = await closeHour(over.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(1, String(P_MAX + 1))],
      fees: FEES,
      send: overSend.send,
    });
    const huge = await closeHour(over.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(2, '100000000000')],
      fees: FEES,
      send: overSend.send,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, P_MAX_STATUS);
    assert.deepEqual(refused.body, P_MAX_BODY);
    assert.equal(huge.status, refused.status);
    assert.deepEqual(huge.body, refused.body);
    assert.equal(overSend.wires.length, 0);

    const ok = fresh();
    const okSend = recorder();
    const accepted = await closeHour(ok.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(3, String(P_MAX))],
      fees: FEES,
      send: okSend.send,
    });
    assert.equal(accepted.ok, true, accepted.reason);
    assert.equal(okSend.wires.length, 1);
  });

  test('the current hour is never closed', async () => {
    const early = fresh();
    const earlySend = recorder();
    const current = await closeHour(early.sealer, {
      now: HOUR + 1,
      hourStart: HOUR,
      lines: [],
      fees: FEES,
      send: earlySend.send,
    });
    assert.equal(current.ok, false);
    assert.equal(current.reason, 'hour_not_finished');
    assert.equal(earlySend.wires.length, 0);

    const done = fresh();
    const doneSend = recorder();
    const finished = await closeHour(done.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: doneSend.send,
    });
    assert.equal(finished.ok, true, finished.reason);
    assert.equal(finished.record.hourStart, 0);
  });

  test('book B cannot read book A receipt', async () => {
    const { sealer, store } = fresh();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(1)],
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(closed.ok, true, closed.reason);
    release(store, closed.record);
    const id = closedBodyId(store, BOOK_A);
    const own = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token });
    const other = fetchReceipt(store, { receiptId: id, bookId: BOOK_B.id, token: BOOK_B.token });
    assert.equal(own.ok, true);
    assert.equal(other.ok, false);
    assert.equal(other.status, STORE_STATUS);
    assert.deepEqual(other.body, STORE_BODY);
    assert.equal(JSON.stringify(other).includes(own.body.line), false);
  });

  test('empty and N-1 hours publish the same leaf count', async () => {
    const empty = fresh();
    const emptyClosed = await closeHour(empty.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: recorder().send,
    });
    const full = fresh();
    const lines = [];
    for (let n = 1; n < TIER_N; n += 1) lines.push(lineItem(n));
    const fullClosed = await closeHour(full.sealer, {
      now: HOUR,
      hourStart: 0,
      lines,
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(emptyClosed.ok, true, emptyClosed.reason);
    assert.equal(fullClosed.ok, true, fullClosed.reason);
    assert.equal(emptyClosed.record.size, TIER_N);
    assert.equal(fullClosed.record.size, TIER_N);
    assert.equal(emptyClosed.record.size, fullClosed.record.size);
    release(full.store, fullClosed.record);
    const id = closedBodyId(full.store, BOOK_A);
    const body = fetchReceipt(full.store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token }).body;
    assert.equal(body.size, TIER_N);
    assert.equal(body.realCount, undefined);
    assert.equal(body.decoyCount, undefined);
    assert.equal(Object.hasOwn(body, 'sealed'), false);
    assert.equal(Object.hasOwn(body, 'ciphertext'), false);
    const sealed = sealedHeld(full.store, id);
    assert.equal(typeof sealed, 'string');
    assert.equal(JSON.stringify(body).includes(sealed), false);
  });

  test('a close past 2^53 - 1 is refused and the cap does not wrap', async () => {
    const atCap = addLogSize(MAX_LOG_SIZE - TIER_N, TIER_N);
    assert.equal(atCap.ok, true);
    assert.equal(atCap.size, MAX_LOG_SIZE);
    assert.equal(Number.isSafeInteger(atCap.size), true);
    const wrapped = (MAX_LOG_SIZE - TIER_N + TIER_N) | 0;
    assert.notEqual(atCap.size, wrapped);
    const over = addLogSize(MAX_LOG_SIZE - (TIER_N - 1), TIER_N);
    assert.equal(over.ok, false);
    assert.equal(over.reason, 'size_cap');

    const { sealerDir, sealer } = fresh();
    const planted = {
      v: 1,
      chainId: String(CHAIN_ID),
      contract: CONTRACT,
      anchorEpoch: 0,
      lastHourStart: null,
      logSize: MAX_LOG_SIZE - (TIER_N - 1),
      logRoot: EMPTY_ROOT_HEX,
      nextNonce: 0,
      leaves: [],
      commits: [],
      tree: { leaves: [], epoch: null },
    };
    writeFileSync(join(sealerDir, 'sealer-state.json'), JSON.stringify(planted));
    const reopened = openSealer({
      dir: sealerDir,
      store: sealer.store,
      signer: mockSigner(),
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });
    const sent = recorder();
    const closed = await closeHour(reopened, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(closed.ok, false);
    assert.equal(closed.reason, 'size_cap');
    assert.equal(sent.wires.length, 0);
  });

  test('a core alg-0 line seals and a seller signature is not required', async () => {
    const { sealer, store } = fresh();
    const sent = recorder();
    const line = coreLine({ n: 4 });
    assert.equal(line[LAYOUT.sigma], 0);
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [{ line, bookId: BOOK_A.id, bookPk: BOOK_PK }],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(closed.ok, true, closed.reason);
    release(store, closed.record);
    const id = closedBodyId(store, BOOK_A);
    const body = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token }).body;
    const leaf = leafHash(line);
    assert.equal(leaf.ok, true);
    const included = verifyInclusion(
      Buffer.from(leaf.hash).toString('hex'),
      body.index,
      body.size,
      body.root,
      body.proof,
    );
    assert.equal(included.ok, true, included.reason);

    const badSigma = coreLine({ n: 5 });
    badSigma[LAYOUT.sigma + 1] = 1;
    const badKey = coreLine({ n: 6, sellerKey: '01' + '00'.repeat(31) });
    const refused = fresh();
    const refusedSend = recorder();
    const sigmaResult = await closeHour(refused.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [{ line: badSigma, bookId: BOOK_A.id, bookPk: BOOK_PK }],
      fees: FEES,
      send: refusedSend.send,
    });
    const keyResult = await closeHour(refused.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [{ line: badKey, bookId: BOOK_A.id, bookPk: BOOK_PK }],
      fees: FEES,
      send: refusedSend.send,
    });
    assert.equal(sigmaResult.ok, false);
    assert.equal(sigmaResult.reason, 'bad_sigma');
    assert.equal(keyResult.ok, false);
    assert.equal(keyResult.reason, 'bad_sigma');
    assert.equal(refusedSend.wires.length, 0);
  });

  test('proofs stay hidden until a matching finalized Anchored', async () => {
    const { sealer, store } = fresh();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(8)],
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(closed.ok, true, closed.reason);
    const id = closedBodyId(store, BOOK_A);
    const before = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token, payTo: '0x11'.padEnd(42, '1') });
    assert.equal(before.ok, false);
    assert.deepEqual(before.body, STORE_BODY);
    const mismatch = noteAnchored(store, {
      finalized: true,
      epoch: closed.record.epoch,
      hourStart: closed.record.hourStart,
      size: closed.record.size,
      root: '00'.repeat(32),
      stateRoot: closed.record.stateRoot,
    });
    assert.equal(mismatch.released, false);
    const still = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token });
    assert.deepEqual(still, before);
    const matched = noteAnchored(store, {
      finalized: true,
      epoch: closed.record.epoch,
      hourStart: closed.record.hourStart,
      size: closed.record.size,
      root: closed.record.root,
      stateRoot: closed.record.stateRoot,
    });
    assert.equal(matched.released, true);
    const after = fetchReceipt(store, {
      receiptId: id,
      bookId: BOOK_A.id,
      token: BOOK_A.token,
      payTo: '0x22'.padEnd(42, '2'),
      wallet: '0x33'.padEnd(42, '3'),
    });
    assert.equal(after.ok, true);
    assert.equal(after.body.proof.length > 0, true);
    assert.equal(JSON.stringify(after.body).includes(sealedHeld(store, id)), false);
  });

  test('the sealer does not broadcast an epoch the store has not committed', async () => {
    const io = { ...fs };
    io.openSync = (file, flag, mode) => {
      if (String(file).endsWith(`${join('store', 'store-state.json')}.tmp`) || String(file).includes('store-state.json.tmp')) {
        const err = new Error('ENOSPC');
        err.code = 'ENOSPC';
        throw err;
      }
      return fs.openSync(file, flag, mode);
    };
    const { sealer } = fresh({ io });
    const sent = recorder();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(9)],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(closed.ok, false);
    assert.equal(closed.reason, 'store_not_committed');
    assert.equal(closed.broadcast, false);
    assert.equal(sent.wires.length, 0);
    const pending = pendingCommits(sealer);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].hourStart, 0);
    assert.equal(pending[0].size, TIER_N);
  });

  test('the epoch slot is redrawn and a caller-supplied slot is ignored', async () => {
    function scripted(seed) {
      let n = seed;
      return (len) => {
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
          n = (n + 17) % 251;
          if (n === 0) n = 1;
          out[i] = n;
        }
        return out;
      };
    }
    const left = fresh({ randomBytes: scripted(1) });
    const right = fresh({ randomBytes: scripted(2) });
    const a = await closeHour(left.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: recorder().send,
    });
    const b = await closeHour(right.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(a.ok, true, a.reason);
    assert.equal(b.ok, true, b.reason);
    assert.notEqual(a.record.stateRoot, b.record.stateRoot);

    const supplied = new Uint8Array(32).fill(0xab);
    const withSlot = fresh({ randomBytes: scripted(1) });
    const without = fresh({ randomBytes: scripted(1) });
    const held = await closeHour(withSlot.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: recorder().send,
      epochSlot: supplied,
    });
    const plain = await closeHour(without.sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(held.ok, true, held.reason);
    assert.equal(plain.ok, true, plain.reason);
    assert.equal(held.record.stateRoot, plain.record.stateRoot);
  });

  test('a different caller with the same receipt id gets the uniform error', async () => {
    const { sealer, store } = fresh();
    const closed = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [lineItem(10)],
      fees: FEES,
      send: recorder().send,
    });
    assert.equal(closed.ok, true, closed.reason);
    release(store, closed.record);
    const id = closedBodyId(store, BOOK_A);
    const stranger = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: 'someone-else' });
    const missing = fetchReceipt(store, { receiptId: 'ff'.repeat(16), bookId: BOOK_A.id, token: BOOK_A.token });
    assert.deepEqual(stranger.body, STORE_BODY);
    assert.equal(stranger.status, STORE_STATUS);
    assert.deepEqual(stranger, missing);
    assert.equal(stranger.ok, false);
  });

  test('close and fetch sources do not carry live-network material', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const files = [
      'services/chit-sealer/close.js',
      'services/chit-sealer/lines.js',
      'services/chit-sealer/pad.js',
      'services/chit-sealer/size.js',
      'services/chit-sealer/calldata.js',
      'services/chit-sealer/journal.js',
      'services/chit-store/store.js',
    ];
    const banned = [
      /@aws-sdk/,
      /\baws-sdk\b/,
      /KMSClient/,
      /https:\/\//,
      /sepolia/i,
      /mainnet/i,
      /infura/i,
      /alchemy/i,
      /PRIVATE_KEY/,
      /BEGIN PRIVATE/,
      /BEGIN EC PRIVATE/,
    ];
    files.push('services/chit-sealer/anchor-class.js');
    for (const rel of files) {
      const text = readFileSync(join(root, rel), 'utf8');
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${rel} matched ${pattern}`);
      }
    }
    const gateway = readFileSync(join(root, 'services/gateway/src/receipt-merkle.js'), 'utf8');
    const local = readFileSync(join(root, 'services/chit-sealer/anchor-class.js'), 'utf8');
    for (const name of ['anchorBackoffMs', 'classifyAnchorSendError']) {
      const fromGateway = functionBody(gateway, name);
      const fromLocal = functionBody(local, name);
      assert.equal(fromLocal, fromGateway, `${name} drifted from receipt-merkle.js`);
    }
  });

  test('catch-up closes the last complete hour once, padded to k·N', async () => {
    const { sealer } = fresh();
    const sent = recorder();
    const first = await closeHour(sealer, {
      now: HOUR,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(first.ok, true, first.reason);
    const caught = await closeHour(sealer, {
      now: HOUR * 3,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(caught.ok, true, caught.reason);
    assert.equal(caught.record.hourStart, HOUR * 2);
    assert.equal(caught.record.size - first.record.size, TIER_N * 2);
    const twice = await closeHour(sealer, {
      now: HOUR * 3,
      hourStart: 0,
      lines: [],
      fees: FEES,
      send: sent.send,
    });
    assert.equal(twice.ok, false);
    assert.equal(twice.reason, 'hour_already_covered');
    assert.equal(sent.wires.length, 2);
  });
});

function release(store, record) {
  const noted = noteAnchored(store, {
    finalized: true,
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
  });
  assert.equal(noted.released, true);
}

function closedBodyId(store, book) {
  const listed = [...store.receipts.values()].filter((row) => row.bookId === book.id);
  assert.equal(listed.length > 0, true);
  return listed[0].id;
}

function timeFetch(store, input) {
  const start = process.hrtime.bigint();
  fetchReceipt(store, input);
  return process.hrtime.bigint() - start;
}

function median(values) {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

function timingClass(ns) {
  const ms = Number(ns) / 1e6;
  if (ms < 2000) return 'fast';
  if (ms < 10000) return 'slow';
  return 'stalled';
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.equal(start >= 0, true, name);
  let depth = 0;
  let seen = false;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
      seen = true;
    } else if (source[i] === '}') {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}
