/**
 * Fast P0-9 checks. No chain, no network, no live key.
 * Fixtures are testnet dummy data.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { bytesToHex, hexToBytes } from '../../../packages/cs2-core/ecdsa/bytes.js';
import { keccak256 } from '../../../packages/cs2-core/ecdsa/keccak.js';
import { eip1559TxHash, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { SECP256K1, eip1559Digest, eip1559Serialize } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../../packages/cs2-core/ecdsa/sign.js';
import { LAYOUT, KIND_PAYMENT, KIND_PAYTO, KIND_WALLET, canonicalPaymentId, encodeLine, slotKey } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { leafHash } from '../../../packages/cs2-core/merkle/index.js';
import { deriveKeyPair } from '../../../packages/cs2-core/seal/hpke.js';
import { openLineAny } from '../../../packages/cs2-core/seal/index.js';
import { encodeHistory, getLeaf, placeHistory } from '../../../packages/cs2-core/smt/index.mjs';
import { ANCHOR_SELECTOR, ANCHOR_SIGNATURE, buildAnchorCalldata } from '../../../services/chit-sealer/calldata.js';
import { closeHour, openSealer } from '../../../services/chit-sealer/close.js';
import { commitAnchorIntent } from '../../../services/chit-sealer/kms-secp256k1.js';
import { openAnchorIntentLog } from '../../../services/chit-sealer/kms-secp256k1.js';
import { fetchReceipt, noteAnchored, openStore, sealedHeld } from '../../../services/chit-store/store.js';
import { acceptAnchoredLog } from '../anchored.mjs';
import {
  AUTHORIZATION_USED_TOPIC0,
  MAX_TREE_SIZE,
  PAYMENT_SLOT_MISSING,
  TRANSFER_TOPIC0,
  paymentStatus,
  runV13,
  treeSizeFromHead,
} from '../../../packages/verify/dist/v13/core/decide.js';

const HOUR = 3600;
const CHAIN_ID = 31337;
const CONTRACT = '0x3333333333333333333333333333333333333333';
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const DUMMY_D = 0xA11CEn;
const DUMMY_ADDRESS = ethereumAddress(publicPoint(DUMMY_D, SECP256K1));
const FEES = { gasLimit: '100000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000' };
const PAYER = `0x${'33'.repeat(20)}`;

function bookPair(seed) {
  const derived = deriveKeyPair(Uint8Array.of(seed, seed, seed, seed));
  if (!derived.ok) throw new Error(derived.reason);
  return derived;
}

const RECORD = bookPair(7);
const CALLER = bookPair(9);

function signer() {
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
        } catch { /* next dummy nonce */ }
      }
      throw new Error('dev signer could not sign');
    },
  };
}

function coreLine(over = {}, n = 1) {
  const encoded = encodeLine({
    payment: { ...SAMPLE.payment, localLogIndex: n, saltP: `${n.toString(16).padStart(2, '0')}${'51'.repeat(31)}`, ...over },
    content: { ...SAMPLE.content, sellerKeyId: '00'.repeat(32) },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}

function fresh(books) {
  const root = mkdtempSync(join(tmpdir(), 'p09-'));
  const sealerDir = join(root, 'sealer');
  const storeDir = join(root, 'store');
  mkdirSync(sealerDir);
  mkdirSync(storeDir);
  const store = openStore(storeDir, { books });
  const clock = { now: HOUR };
  const sealer = openSealer({
    dir: sealerDir,
    store,
    signer: signer(),
    chainId: CHAIN_ID,
    contract: CONTRACT,
    clock: () => clock.now,
  });
  return { store, sealer, clock, root };
}

function book(id, pk, wallets = [PAYER]) {
  return { id, token: `token-${id.slice(0, 4)}`, bookPk: pk, wallets };
}

const BOOK_A = book('aa'.repeat(32), RECORD.pk);
const BOOK_B = book('bb'.repeat(32), RECORD.pk);

function sendOk() {
  return async () => `0x${'ab'.repeat(32)}`;
}

describe('p0-9 sealer, store, and verifier', { concurrency: false }, () => {
  test('anchor calldata is the ABI selector, recomputed from the signature', () => {
    const selector = bytesToHex(keccak256(new TextEncoder().encode(ANCHOR_SIGNATURE)).subarray(0, 4));
    assert.equal(selector, ANCHOR_SELECTOR);
    const built = buildAnchorCalldata({
      chainId: 84532n,
      contract: CONTRACT,
      epoch: 1,
      hourStart: 1_700_006_400,
      size: 128,
      root: '11'.repeat(32),
      stateRoot: '22'.repeat(32),
      proof: [],
    });
    assert.equal(built.calldata.slice(0, 8), selector);
    assert.equal(built.calldata.length, 260 * 2);
  });

  test('a rotate selector is refused by the intent guard', () => {
    const built = buildAnchorCalldata({
      chainId: 84532n,
      contract: CONTRACT,
      epoch: 1,
      hourStart: 1_700_006_400,
      size: 1,
      root: '11'.repeat(32),
      stateRoot: '22'.repeat(32),
      proof: [],
    });
    const rotate = bytesToHex(keccak256(new TextEncoder().encode('rotateCheckpointKey(address,uint64)')).subarray(0, 4));
    const { root } = fresh([BOOK_A]);
    const log = openAnchorIntentLog(join(root, 'sealer'));
    assert.throws(
      () => commitAnchorIntent(log, {
        chainId: 84532,
        to: CONTRACT,
        nonce: 0,
        epoch: 1,
        hourStart: 1_700_006_400,
        size: 1,
        root: '11'.repeat(32),
        stateRoot: '22'.repeat(32),
        calldata: rotate + built.calldata.slice(8),
      }, DUMMY_ADDRESS),
      (err) => err.code === 'intent_payload_mismatch',
    );
  });

  test('one payment is booked once, across hours, books, and block numbers', async () => {
    const { sealer, clock } = fresh([BOOK_A, BOOK_B]);
    const line = coreLine();
    const first = await closeHour(sealer, { hourStart: 0, lines: [{ line, bookId: BOOK_A.id, bookPk: CALLER.pk }], fees: FEES, send: sendOk() });
    assert.equal(first.ok, true, first.reason);
    clock.now = HOUR * 2;
    const again = await closeHour(sealer, { hourStart: HOUR, lines: [{ line, bookId: BOOK_A.id }], fees: FEES, send: sendOk() });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'duplicate_payment');
    const shared = fresh([BOOK_A, BOOK_B]);
    const lineB = coreLine({ localLogIndex: 8 });
    const inA = await closeHour(shared.sealer, { hourStart: 0, lines: [{ line: lineB, bookId: BOOK_A.id }], fees: FEES, send: sendOk() });
    assert.equal(inA.ok, true, inA.reason);
    shared.clock.now = HOUR * 2;
    const inB = await closeHour(shared.sealer, { hourStart: HOUR, lines: [{ line: lineB, bookId: BOOK_B.id }], fees: FEES, send: sendOk() });
    assert.equal(inB.reason, 'duplicate_payment');
    const shifted = coreLine({ blockNumber: SAMPLE.payment.blockNumber + 1 });
    const both = await closeHour(fresh([BOOK_A]).sealer, {
      hourStart: 0,
      lines: [{ line, bookId: BOOK_A.id }, { line: shifted, bookId: BOOK_A.id }],
      fees: FEES,
      send: sendOk(),
    });
    assert.equal(both.reason, 'duplicate_payment');
  });

  test('an unknown wallet is refused and the caller book key is ignored', async () => {
    const { sealer, store } = fresh([BOOK_A]);
    const stranger = book('cc'.repeat(32), RECORD.pk, [`0x${'44'.repeat(20)}`]);
    const closed = await closeHour(fresh([stranger]).sealer, {
      hourStart: 0,
      lines: [{ line: coreLine(), bookId: stranger.id, bookPk: CALLER.pk }],
      fees: FEES,
      send: sendOk(),
    });
    assert.equal(closed.reason, 'unknown_wallet');
    const line = coreLine({ localLogIndex: 3 });
    const sealed = await closeHour(sealer, {
      hourStart: 0,
      lines: [{ line, bookId: BOOK_A.id, bookPk: CALLER.pk }],
      fees: FEES,
      send: sendOk(),
    });
    assert.equal(sealed.ok, true, sealed.reason);
    const id = sealer.state.commits.at(-1).receipts[0].id;
    const raw = hexToBytes(sealedHeld(store, id));
    const opened = openLineAny(raw, RECORD.sk);
    assert.equal(opened.ok, true, opened.reason);
    const wrong = openLineAny(raw, CALLER.sk);
    assert.equal(wrong.ok, false);
  });

  test('payment slot values are salted per book and the payTo slot is present', async () => {
    const left = fresh([BOOK_A]);
    const right = fresh([BOOK_B]);
    const line = coreLine({ localLogIndex: 4 });
    const a = await closeHour(left.sealer, { hourStart: 0, lines: [{ line, bookId: BOOK_A.id }], fees: FEES, send: sendOk() });
    const b = await closeHour(right.sealer, { hourStart: 0, lines: [{ line, bookId: BOOK_B.id }], fees: FEES, send: sendOk() });
    assert.equal(a.ok, true, a.reason);
    assert.equal(b.ok, true, b.reason);
    const receiptA = left.sealer.state.commits.at(-1).receipts[0];
    const receiptB = right.sealer.state.commits.at(-1).receipts[0];
    assert.notEqual(receiptA.saltedBook, receiptB.saltedBook);
    assert.notEqual(receiptA.saltedBook, BOOK_A.id);
    const id = canonicalPaymentId({ ...SAMPLE.payment, localLogIndex: 4 });
    assert.equal(id.ok, true);
    const key = slotKey({ kind: KIND_PAYMENT, chainId: 8453n, id: id.bytes });
    const toKey = slotKey({ kind: KIND_PAYTO, chainId: 8453n, id: hexToBytes(SAMPLE.payment.to) });
    const found = getLeaf(left.sealer.state.tree, key.bytes);
    assert.ok(found);
    const leaf = leafHash(line);
    const salt = left.store.bookRecord(BOOK_A.id).bookSalt;
    const salted = sha256(Buffer.concat([Buffer.from(BOOK_A.id, 'hex'), Buffer.from(salt)]));
    const expected = sha256(Buffer.concat([Buffer.from('cs2-pay-slot'), Buffer.from(salted, 'hex'), Buffer.from(leaf.hash)]));
    assert.equal(Buffer.from(found.value).toString('hex'), expected);
    const bare = sha256(Buffer.concat([Buffer.from('cs2-pay-slot'), Buffer.from(sha256(Buffer.from(BOOK_A.id, 'hex')), 'hex'), Buffer.from(leaf.hash)]));
    assert.notEqual(Buffer.from(found.value).toString('hex'), bare);
    assert.ok(getLeaf(left.sealer.state.tree, toKey.bytes));
  });

  test('own pending fetch is 202 and every other caller stays not_found', async () => {
    const { sealer, store } = fresh([BOOK_A, BOOK_B]);
    const closed = await closeHour(sealer, {
      hourStart: 0,
      lines: [{ line: coreLine({ localLogIndex: 5 }), bookId: BOOK_A.id }],
      fees: FEES,
      send: sendOk(),
    });
    const id = sealer.state.commits.at(-1).receipts[0].id;
    const own = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: BOOK_A.token });
    assert.equal(own.status, 202);
    assert.deepEqual(own.body, { state: 'pending_anchor', epoch: closed.record.epoch });
    const other = fetchReceipt(store, { receiptId: id, bookId: BOOK_B.id, token: BOOK_B.token });
    const unknown = fetchReceipt(store, { receiptId: '00'.repeat(16), bookId: BOOK_A.id, token: BOOK_A.token });
    const bad = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: 'nope' });
    const elseWho = fetchReceipt(store, { receiptId: id, bookId: BOOK_A.id, token: 'someone-else' });
    assert.deepEqual(other, unknown);
    assert.deepEqual(unknown, bad);
    assert.deepEqual(bad, elseWho);
    assert.equal(other.status, 404);
    assert.deepEqual(other.body, { error: 'not_found' });
  });

  test('an Anchored tuple from another contract or sender does not release', async () => {
    const { sealer, store } = fresh([BOOK_A]);
    const closed = await closeHour(sealer, { hourStart: 0, lines: [], fees: FEES, send: sendOk() });
    const base = {
      finalized: true,
      epoch: closed.record.epoch,
      hourStart: closed.record.hourStart,
      size: closed.record.size,
      root: closed.record.root,
      stateRoot: closed.record.stateRoot,
      chainId: CHAIN_ID,
      contract: CONTRACT,
      from: DUMMY_ADDRESS,
    };
    assert.equal(noteAnchored(store, { ...base, contract: `0x${'44'.repeat(20)}` }).released, false);
    assert.equal(noteAnchored(store, { ...base, chainId: CHAIN_ID + 1 }).released, false);
    assert.equal(noteAnchored(store, { ...base, from: `0x${'55'.repeat(20)}` }).released, false);
    const capped = noteAnchored(store, { ...base, size: Number.MAX_SAFE_INTEGER + 1 });
    assert.equal(capped.reason, 'uint64_above_cap');
    assert.equal(capped.released, false);
    assert.equal(noteAnchored(store, base).released, true);
  });

  test('a known broadcast returns the signed transaction hash', async () => {
    const { sealer } = fresh([BOOK_A]);
    let wire = '';
    const closed = await closeHour(sealer, {
      hourStart: 0,
      lines: [],
      fees: FEES,
      send(raw) {
        wire = raw;
        throw new Error('already known');
      },
    });
    assert.equal(closed.ok, true, closed.reason);
    const hash = `0x${bytesToHex(eip1559TxHash(wire))}`;
    assert.equal(closed.tx, hash);
    assert.notEqual(closed.tx, '0xknown');
  });

  test('header, cap, leaf, and size refusals', () => {
    const line = viewLine();
    const paid = validPayment(line);
    assert.equal(paymentStatus(line, { ...paid, chainNumber: line.blockNumber + 1 }), 'payment_mismatch');
    assert.equal(paymentStatus(line, { ...paid, chainTime: line.blockTime + 1 }), 'payment_mismatch');
    assert.equal(paymentStatus(line, { ...paid, chainTime: null }), 'header_unchecked');
    assert.equal(treeSizeFromHead(BigInt(MAX_TREE_SIZE) + 1n).ok, false);
    assert.equal(treeSizeFromHead(BigInt(MAX_TREE_SIZE)).ok, true);
    const receipt = dummyReceipt();
    const leafy = runV13({ ...receipt, leaf: 'ab'.repeat(32) }, world(line), hooks());
    assert.equal(leafy.exit, 1);
    assert.equal(leafy.reason, 'caller_supplied_leaf');
    const sized = runV13({ ...receipt, treeSize: 4 }, world(line), hooks());
    assert.equal(sized.exit, 1);
    assert.equal(sized.reason, 'caller_supplied_tree_size');
    const late = runV13(receipt, world(line, { blockNumber: 50 }), hooks());
    assert.equal(late.exit, 1);
    assert.equal(late.reason, 'payment_after_anchor');
    const unbound = runV13({ ...receipt, saltedBook: 'ab'.repeat(32), paymentProof: '00'.repeat(32) }, world(line), {
      ...hooks(),
      paymentOk: () => ({ ok: false, exit: 1, reason: 'payment_mismatch' }),
    });
    assert.equal(unbound.exit, 1);
    assert.equal(unbound.reason, 'payment_mismatch');
    const bare = dummyReceipt();
    delete bare.paymentProof;
    delete bare.saltedBook;
    const both = runV13(bare, world(line), hooks());
    assert.equal(both.exit, 2);
    assert.equal(both.reason, 'payment_unchecked');
    assert.equal(both.message, PAYMENT_SLOT_MISSING);
    const proofOnly = dummyReceipt();
    delete proofOnly.saltedBook;
    const saltOnly = dummyReceipt();
    delete saltOnly.paymentProof;
    assert.equal(runV13(proofOnly, world(line), hooks()).message, PAYMENT_SLOT_MISSING);
    assert.equal(runV13(saltOnly, world(line), hooks()).message, PAYMENT_SLOT_MISSING);
  });

  test('a drawn book salt is the same when the store is reopened before any commit', () => {
    const { store, root } = fresh([BOOK_A]);
    const salt = Buffer.from(store.bookRecord(BOOK_A.id).bookSalt).toString('hex');
    const mode = statSync(join(root, 'store', 'store-state.json')).mode & 0o777;
    assert.equal(mode, 0o600);
    const again = openStore(join(root, 'store'), { books: [BOOK_A] });
    assert.equal(Buffer.from(again.bookRecord(BOOK_A.id).bookSalt).toString('hex'), salt);
  });

  test('a wallet history that is already present survives a payment', async () => {
    const { sealer } = fresh([BOOK_A]);
    const from = Uint8Array.from(Buffer.from(PAYER.slice(2), 'hex'));
    const history = encodeHistory({
      kind: KIND_WALLET,
      chainId: BigInt(CHAIN_ID),
      id: from,
      records: [{
        seq: 0n,
        block: 1n,
        fromBlock: null,
        id: new Uint8Array(32).fill(7),
        type: 4,
        sig: Uint8Array.of(1),
      }],
    });
    assert.equal(history.ok, true, history.reason);
    const placed = placeHistory(sealer.state.tree, history.bytes);
    assert.equal(placed.ok, true, placed.reason);
    sealer.state.tree = placed.tree;
    const closed = await closeHour(sealer, {
      hourStart: 0,
      lines: [{ line: coreLine(), bookId: BOOK_A.id }],
      fees: FEES,
      send: sendOk(),
    });
    assert.equal(closed.ok, true, closed.reason);
    const found = getLeaf(sealer.state.tree, placed.slotKey.bytes);
    assert.equal(Buffer.from(found.value).toString('hex'), Buffer.from(history.bytes).toString('hex'));
  });

  test('the listener keeps a log that fails the contract, the sender, or finality', () => {
    const contract = CONTRACT;
    const checkpoint = DUMMY_ADDRESS;
    const ok = {
      address: contract,
      txFrom: checkpoint,
      checkpoint,
      chainId: 84532,
      blockNumber: '0x10',
      finalizedNumber: 0x10n,
      contract,
    };
    assert.equal(acceptAnchoredLog(ok), true);
    assert.equal(acceptAnchoredLog({ ...ok, address: `0x${'44'.repeat(20)}` }), false);
    assert.equal(acceptAnchoredLog({ ...ok, txFrom: `0x${'55'.repeat(20)}` }), false);
    assert.equal(acceptAnchoredLog({ ...ok, finalizedNumber: 0x0fn }), false);
    assert.equal(acceptAnchoredLog({ ...ok, chainId: 84533 }), false);
  });
});

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function viewLine() {
  return {
    chainId: 84532,
    blockHash: `0x${'ab'.repeat(32)}`,
    blockNumber: 100,
    blockTime: 1_700_000_000,
    txIndex: 0,
    localLogIndex: 1,
    txHash: `0x${'cd'.repeat(32)}`,
    token: USDC,
    from: PAYER,
    to: `0x${'11'.repeat(20)}`,
    value: 1000000n,
    method: 1,
    authorizer: PAYER,
    nonce: `0x${'44'.repeat(32)}`,
    bytes: new Uint8Array(1024),
  };
}

function padAddr(address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

function validPayment(line) {
  return {
    blockHash: line.blockHash,
    txIndexMatch: true,
    txTo: USDC,
    input: '0x',
    chainNumber: line.blockNumber,
    chainTime: line.blockTime,
    logs: [
      {
        index: 0,
        address: USDC,
        topics: [AUTHORIZATION_USED_TOPIC0, padAddr(line.authorizer), line.nonce],
        data: '0x',
      },
      {
        index: 1,
        address: USDC,
        topics: [TRANSFER_TOPIC0, padAddr(line.from), padAddr(line.to)],
        data: `0x${line.value.toString(16).padStart(64, '0')}`,
      },
    ],
  };
}

function dummyReceipt() {
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: `0x${'00'.repeat(1024)}`,
    index: 0,
    epoch: 1,
    contract: CONTRACT,
    proof: [],
    paymentProof: '11'.repeat(32),
    saltedBook: '22'.repeat(32),
  };
}

function world(line, eventPatch = {}) {
  const pin = {
    chainId: 84532,
    address: CONTRACT,
    codeHash: `0x${'ab'.repeat(32)}`,
    predecessor: `0x${'00'.repeat(20)}`,
    checkpoint: DUMMY_ADDRESS,
    genesisHourStart: 0,
    retireHourStart: null,
  };
  return {
    history: { ok: true, reason: null, source: 'bundled', headHash: 'ab'.repeat(32), entryCount: 1, asOf: null },
    snapshotSigned: true,
    bundledPayload: { contracts: [pin] },
    narrowing: [],
    liveExtension: null,
    rpcConfigured: true,
    finalizedNumber: 200,
    events: [{
      epoch: 1n,
      hourStart: 0n,
      size: 128n,
      root: '11'.repeat(32),
      stateRoot: '22'.repeat(32),
      kind: 0,
      blockNumber: 105,
      blockHash: `0x${'ef'.repeat(32)}`,
      txHash: `0x${'ee'.repeat(32)}`,
      logIndex: 0,
      address: CONTRACT,
      ...eventPatch,
    }],
    codeHash: pin.codeHash,
    anchorFrom: DUMMY_ADDRESS,
    anchorTo: CONTRACT,
    successor: 'not_required',
    chainGenesis: null,
    line,
    lineReason: null,
    rotatedTo: null,
    payment: validPayment(line),
    canonical: 'ok',
    priorStatus: 'absent',
  };
}

function hooks() {
  return {
    leafHash: () => ({ ok: true, hash: new Uint8Array(32).fill(1) }),
    verifyInclusion: () => ({ ok: true }),
    stateOk: () => true,
    paymentOk: () => ({ ok: true, exit: 0, reason: null }),
  };
}
