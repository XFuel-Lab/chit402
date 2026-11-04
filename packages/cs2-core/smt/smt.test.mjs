/**
 * State SMT, compressed proofs, and the wallet, book, and epoch slots.
 * Expected hashes are computed here, or taken from the §S5 literals.
 * m7.out is not in the repository. Proof sizes are cited from SIMPLE §S5.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { publicPoint, signRawDigest } from '../ecdsa/sign.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { bigToBytes, bytesToBig, bytesToHex, concat, hexToBytes } from '../ecdsa/bytes.js';
import {
  KIND_BOOK,
  KIND_EPOCH,
  KIND_KEY,
  KIND_PAYTO,
  KIND_WALLET,
  emptyHash,
  slotKey,
  stateNode,
} from '../line/index.mjs';
import { renderSlotProofs, VECTOR_PATH } from './build-vectors.mjs';
import {
  BOOK_CREATE_TYPE,
  CITED_PROOF_BYTES,
  HOUR_SECONDS,
  MAX_RECORDS,
  MAX_SMT_ENTRIES,
  PAD_ENTRIES,
  REC_BOOK,
  REC_JOIN,
  REC_LEAVE,
  REC_STOP,
  WALLET_JOIN_TYPE,
  WALLET_LEAVE_TYPE,
  WALLET_STOP_TYPE,
  acceptSize,
  admit,
  assess,
  blankHash,
  contractForHour,
  createTree,
  decodeHistory,
  detectEquivocation,
  drawEpoch,
  emptyHistory,
  emptyRoot,
  encodeHistory,
  entryCount,
  extendsHistory,
  faultLine,
  getLeaf,
  indexBytes,
  padTo1024,
  placeHistory,
  prove,
  putLeaf,
  redrawDummies,
  rootBytes,
  verifyProof,
  verifySlot,
} from './index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAIN = 8453n;
const SPEC_KEYS = {
  payTo: 'c6b40c18d820237cb21ae8016f9f92a5a68f42b5bb30ae56969ff04c7a7b5e14',
  wallet: '4ccc2ec4ceae1ff0046f133bb181b6d489d16271e113279784f446e081f0de9b',
  book: 'e0b35a2c3b103508754c6ba420f0e9bc3c9ae5d75c0f8b8a48dba569cf686af7',
  epoch: '704eb0fa877f4f138ae508a4e5a29dc4c001ffe4415856c2ff7d6453f37c70d7',
};

let kCounter = 50n;
let idCounter = 0;

function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function ascii(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function padUint(value) {
  return bigToBytes(value, 32);
}

function padAddress(addr) {
  const out = new Uint8Array(32);
  out.set(addr, 12);
  return out;
}

function structHash(typeString, fields) {
  return keccak256(concat([keccak256(ascii(typeString)), ...fields]));
}

const CONTRACT = new Uint8Array(20).fill(0x33);
const OTHER_CONTRACT = new Uint8Array(20).fill(0x44);
const EPOCH = {
  prevAnchorBlock: 0n,
  showAnchorBlock: 1n << 40n,
  hourStart: 0n,
  contract: CONTRACT,
};

function typedDigest(chainId, contract, typeString, fields) {
  const struct = structHash(typeString, fields);
  return keccak256(concat([
    Uint8Array.of(0x19, 0x01),
    structHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)', [
      keccak256(ascii('Chit402')),
      keccak256(ascii('13')),
      padUint(chainId),
      padAddress(contract),
    ]),
    struct,
  ]));
}

function seal(bytes, record, ctx) {
  return admit(bytes, record, { epochs: [EPOCH], ...(ctx || {}) });
}

function viewOf(bytes, ctx) {
  return assess(bytes, { epochs: [EPOCH], ...(ctx || {}) });
}

function sign(digest, scalar, curve) {
  kCounter += 1n;
  const sig = signRawDigest(digest, scalar, kCounter, curve);
  const out = new Uint8Array(65);
  out.set(sig.raw, 0);
  out[64] = sig.yParity;
  return out;
}

function highS(sig, curve) {
  const out = new Uint8Array(65);
  out.set(sig.subarray(0, 32), 0);
  out.set(bigToBytes(curve.order - bytesToBig(sig.subarray(32, 64)), 32), 32);
  out[64] = sig[64] ^ 1;
  return out;
}

function compress(point) {
  const y = bytesToBig(point.subarray(33));
  const out = new Uint8Array(33);
  out[0] = (y & 1n) === 1n ? 0x03 : 0x02;
  out.set(point.subarray(1, 33), 1);
  return out;
}

function addressOf(scalar) {
  return hexToBytes(ethereumAddress(publicPoint(scalar, SECP256K1)).slice(2));
}

function freshId() {
  idCounter += 1;
  return sha256(ascii(`chit402-smt-test-id-${idCounter}`));
}

function fill(byte) {
  return new Uint8Array(32).fill(byte);
}

const walletScalar = 9n;
const otherWalletScalar = 13n;
const identityScalar = 11n;
const otherIdentityScalar = 19n;
const thirdIdentityScalar = 23n;
const wallet = addressOf(walletScalar);
const otherWallet = addressOf(otherWalletScalar);
const identityKey = compress(publicPoint(identityScalar, P256));
const otherIdentity = compress(publicPoint(otherIdentityScalar, P256));
const thirdIdentity = compress(publicPoint(thirdIdentityScalar, P256));

function keyBit(key, depth) {
  const bitInByte = depth % 8;
  const mask = Math.floor(128 / (2 ** bitInByte));
  return Math.floor(key[Math.floor(depth / 8)] / mask) % 2;
}

function independentBlank(height) {
  let hash = sha256(Uint8Array.of(0x02), ascii('empty'));
  for (let i = 0; i < height; i += 1) hash = sha256(Uint8Array.of(0x01), hash, hash);
  return hash;
}

function independentLeaf(key, value) {
  return sha256(Uint8Array.of(0x00), ascii('chit402-state-v1'), key, sha256(value));
}

function independentNode(left, right) {
  return sha256(Uint8Array.of(0x01), left, right);
}

function independentHash(pairs, depth) {
  if (pairs.length === 0) return independentBlank(256 - depth);
  if (depth === 256) return independentLeaf(pairs[0].key, pairs[0].value);
  const left = [];
  const right = [];
  for (const pair of pairs) {
    if (keyBit(pair.key, depth) === 0) left.push(pair);
    else right.push(pair);
  }
  return independentNode(independentHash(left, depth + 1), independentHash(right, depth + 1));
}

function walletJoin(bytes, block, commitment, scalar = walletScalar, contract = CONTRACT) {
  const decoded = decodeHistory(bytes);
  const holder = decoded.id;
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_JOIN,
    commitment,
    sig: sign(typedDigest(CHAIN, contract, WALLET_JOIN_TYPE, [
      padAddress(holder), commitment, padUint(block),
    ]), scalar, SECP256K1),
  };
}

function walletLeave(bytes, block, scalar = walletScalar, contract = CONTRACT) {
  const decoded = decodeHistory(bytes);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_LEAVE,
    sig: sign(typedDigest(CHAIN, contract, WALLET_LEAVE_TYPE, [
      padAddress(decoded.id), padUint(block),
    ]), scalar, SECP256K1),
  };
}

function walletStop(bytes, block, commitment, scalar = walletScalar, contract = CONTRACT) {
  const decoded = decodeHistory(bytes);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_STOP,
    commitment,
    sig: sign(typedDigest(CHAIN, contract, WALLET_STOP_TYPE, [
      padAddress(decoded.id), commitment, padUint(block),
    ]), scalar, SECP256K1),
  };
}

function bookCreate(bytes, block, key, scalar, contract = CONTRACT) {
  const decoded = decodeHistory(bytes);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_BOOK,
    identityKey: key,
    sig: sign(typedDigest(CHAIN, contract, BOOK_CREATE_TYPE, [
      decoded.id,
      sha256(key),
      padUint(block),
    ]), scalar, P256),
  };
}

test('slot keys are the line module values, including the §S5 literals', () => {
  const pay = slotKey({ kind: KIND_PAYTO, chainId: 8453, id: new Uint8Array(20).fill(0x11) });
  const wal = slotKey({ kind: KIND_WALLET, chainId: 8453, id: new Uint8Array(20).fill(0x11) });
  const book = slotKey({ kind: KIND_BOOK, chainId: 8453, id: new Uint8Array(32).fill(0x22) });
  const epoch = slotKey({ kind: KIND_EPOCH, chainId: 8453, id: new Uint8Array(0) });
  assert.equal(pay.hex, SPEC_KEYS.payTo);
  assert.equal(wal.hex, SPEC_KEYS.wallet);
  assert.equal(book.hex, SPEC_KEYS.book);
  assert.equal(epoch.hex, SPEC_KEYS.epoch);
  assert.notEqual(pay.hex, wal.hex);
});

test('implementation files do not take a tree cap from a vector', () => {
  const files = readdirSync(HERE).filter((name) => name.endsWith('.mjs') && !name.includes('test') && name !== 'build-vectors.mjs');
  for (const name of files) {
    const text = readFileSync(join(HERE, name), 'utf8');
    assert.equal(text.includes('rfc9162.json'), false, name);
    assert.equal(text.includes('max_tree_size'), false, name);
  }
  assert.equal(MAX_SMT_ENTRIES, Number.MAX_SAFE_INTEGER);
});

test('tree size and index stay inside the safe-integer cap', () => {
  assert.equal(acceptSize(0).ok, true);
  assert.equal(acceptSize(PAD_ENTRIES).ok, true);
  assert.equal(acceptSize(Number.MAX_SAFE_INTEGER).ok, true);
  assert.equal(acceptSize(Number.MAX_SAFE_INTEGER + 1).reason, 'bad_size');
  assert.equal(acceptSize(-0).reason, 'bad_size');
  assert.equal(acceptSize(1.5).reason, 'bad_size');
  assert.equal(acceptSize(NaN).reason, 'bad_size');
  assert.equal(acceptSize(-1).reason, 'bad_size');
  const topped = indexBytes(Number.MAX_SAFE_INTEGER);
  assert.equal(topped.ok, true);
  assert.equal(bytesToHex(topped.bytes), '001fffffffffffff');
  assert.equal(indexBytes(Number.MAX_SAFE_INTEGER + 1).reason, 'bad_size');
});

test('blank hashes follow the line-module recurrence through depth 256', () => {
  const zero = emptyHash(0);
  const one = stateNode(zero.bytes, zero.bytes);
  assert.equal(bytesToHex(blankHash(0).bytes), zero.hex);
  assert.equal(bytesToHex(blankHash(1).bytes), one.hex);
  const at64 = emptyHash(64);
  const at65 = stateNode(at64.bytes, at64.bytes);
  assert.equal(bytesToHex(blankHash(65).bytes), at65.hex);
  assert.equal(bytesToHex(emptyRoot().bytes), bytesToHex(independentBlank(256)));
  assert.equal(blankHash(257).reason, 'bad_depth');
  assert.equal(blankHash(1.5).reason, 'bad_depth');
});

test('a one-key and a two-key root match an independent hasher', () => {
  const keyA = new Uint8Array(32);
  const keyB = new Uint8Array(32);
  keyB[0] = 0x80;
  const valueA = sha256(ascii('a'));
  const valueB = sha256(ascii('b'));
  let tree = createTree();
  tree = putLeaf(tree, keyA, valueA).tree;
  const alone = rootBytes(tree);
  assert.equal(bytesToHex(alone), bytesToHex(independentHash([{ key: keyA, value: valueA }], 0)));
  const one = prove(tree, keyA);
  assert.equal(one.proof.length, 32);
  assert.equal(verifyProof(keyA, valueA, one.proof, alone).ok, true);
  const bloated = new Uint8Array(64);
  bloated[0] = 0x80;
  bloated.set(blankHash(255).bytes, 32);
  assert.equal(verifyProof(keyA, valueA, bloated, alone).reason, 'bad_proof');
  assert.equal(verifyProof(keyA, valueB, one.proof, alone).reason, 'bad_proof');

  tree = putLeaf(tree, keyB, valueB).tree;
  const both = rootBytes(tree);
  const pairs = [{ key: keyA, value: valueA }, { key: keyB, value: valueB }];
  assert.equal(bytesToHex(both), bytesToHex(independentHash(pairs, 0)));
  const two = prove(tree, keyA);
  assert.equal(two.proof.length, 64);
  assert.equal(verifyProof(keyA, valueA, two.proof, both).ok, true);
  const missing = new Uint8Array(32);
  missing[0] = 0x01;
  const absent = prove(tree, missing);
  assert.equal(absent.present, false);
  assert.equal(verifyProof(missing, null, absent.proof, both).ok, true);
  assert.equal(verifyProof(missing, valueA, absent.proof, both).reason, 'bad_proof');

  const tampered = new Uint8Array(two.proof);
  tampered[32] ^= 0x01;
  assert.equal(verifyProof(keyA, valueA, tampered, both).reason, 'bad_proof');
  const canonical = new Uint8Array(32 + 32);
  canonical.set(two.proof.subarray(32));
  assert.equal(verifyProof(keyA, valueA, canonical, both).reason, 'bad_proof');
});

test('one key holds one value', () => {
  const key = fill(4);
  let tree = createTree();
  tree = putLeaf(tree, key, fill(1)).tree;
  tree = putLeaf(tree, key, fill(2)).tree;
  assert.equal(entryCount(tree), 1);
  assert.equal(bytesToHex(getLeaf(tree, key).value), bytesToHex(fill(2)));
  const proof = prove(tree, key);
  assert.equal(verifyProof(key, fill(1), proof.proof, rootBytes(tree)).reason, 'bad_proof');
  assert.equal(verifyProof(key, fill(2), proof.proof, rootBytes(tree)).ok, true);
});

test('rule 1 orders wallet records by admission block, and fromBlock is not that block', () => {
  const commitment = sha256(ascii('book-commit'));
  let bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const join = walletJoin(bytes, 10n, commitment);
  join.fromBlock = 100n;
  const first = seal(bytes, join);
  assert.equal(first.ok, true, first.reason);
  const leave = walletLeave(first.bytes, 10n);
  leave.fromBlock = 0n;
  const second = seal(first.bytes, leave);
  assert.equal(second.ok, true, second.reason);
  const early = walletLeave(second.bytes, 9n);
  early.fromBlock = 1000n;
  assert.equal(seal(second.bytes, early).reason, 'rule_1');

  const decoded = decodeHistory(second.bytes);
  const decreasing = encodeHistory({
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    records: [
      decoded.records[0],
      { ...decoded.records[1], block: 4n },
    ],
  });
  const judged = viewOf(decreasing.bytes);
  assert.equal(judged.ok, true);
  assert.equal(judged.killed, false);
  assert.equal(judged.faults[0].line, faultLine(1n));
  assert.equal(judged.faults[0].rule, 'rule_1');
  assert.equal(bytesToHex(judged.active), bytesToHex(commitment));

  const dup = encodeHistory({
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    records: [decoded.records[0], { ...decoded.records[1], id: decoded.records[0].id }],
  });
  const dupView = viewOf(dup.bytes);
  assert.equal(dupView.killed, false);
  assert.equal(dupView.faults.some((item) => item.rule === 'rule_1'), true);

  const header = 15 + wallet.length;
  const patchedSeq = second.bytes.slice();
  assert.equal(patchedSeq[header + 7], 0);
  patchedSeq[header + 7] = 1;
  assert.equal(decodeHistory(patchedSeq).reason, 'rule_1');

  const patchedCount = second.bytes.slice();
  const countAt = 11 + wallet.length;
  assert.equal(patchedCount[countAt + 3], 2);
  patchedCount[countAt + 3] = 0;
  assert.equal(decodeHistory(patchedCount).reason, 'bad_history');
  const trailing = new Uint8Array(second.bytes.length + 1);
  trailing.set(second.bytes);
  trailing[trailing.length - 1] = 1;
  assert.equal(decodeHistory(trailing).reason, 'bad_history');
});

test('a wallet holds one book unless it stops, and a bad signature does not kill the slot', () => {
  const commitment = sha256(ascii('wallet-book'));
  const otherCommit = sha256(ascii('other-book'));
  let bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const join = walletJoin(bytes, 3n, commitment);
  bytes = seal(bytes, join).bytes;
  const second = walletJoin(bytes, 4n, otherCommit);
  assert.equal(seal(bytes, second).reason, 'rule_2');
  const unsigned = walletJoin(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, 3n, commitment);
  unsigned.sig = new Uint8Array(65);
  assert.equal(seal(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, unsigned).reason, 'rule_4');
  const foreign = walletJoin(bytes, 4n, otherCommit, otherWalletScalar);
  assert.equal(seal(bytes, foreign).reason, 'rule_4');

  const stopped = walletStop(bytes, 4n, otherCommit);
  stopped.fromBlock = 1n;
  const afterStop = seal(bytes, stopped);
  assert.equal(afterStop.ok, true, afterStop.reason);
  const view = viewOf(afterStop.bytes);
  assert.equal(view.stopped, true);
  assert.equal(view.active, null);
  assert.equal(view.killed, false);
  const resume = seal(afterStop.bytes, walletLeave(afterStop.bytes, 5n));
  assert.equal(resume.ok, true, resume.reason);
  assert.equal(viewOf(resume.bytes).stopped, false);
  assert.equal(viewOf(resume.bytes).active, null);
  assert.equal(seal(afterStop.bytes, walletJoin(afterStop.bytes, 6n, commitment)).reason, 'rule_2');
  const emptyWallet = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  assert.equal(seal(emptyWallet, walletLeave(emptyWallet, 5n)).reason, 'rule_2');
  assert.equal(seal(emptyWallet, walletStop(emptyWallet, 4n, sha256(ascii('stop-empty')))).reason, 'rule_2');
});

test('a wallet signature under the pinned contract is accepted, and high-S is refused', () => {
  const commitment = sha256(ascii('pinned-book'));
  const bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const joined = seal(bytes, walletJoin(bytes, 10n, commitment));
  assert.equal(joined.ok, true, joined.reason);
  assert.equal(bytesToHex(viewOf(joined.bytes).active), bytesToHex(commitment));

  const otherEpoch = [{
    prevAnchorBlock: 0n,
    showAnchorBlock: 1n << 40n,
    hourStart: 0n,
    contract: OTHER_CONTRACT,
  }];
  assert.equal(seal(bytes, walletJoin(bytes, 10n, commitment), { epochs: otherEpoch }).reason, 'rule_4');
  const resigned = seal(bytes, walletJoin(bytes, 10n, commitment, walletScalar, OTHER_CONTRACT), {
    epochs: otherEpoch,
  });
  assert.equal(resigned.ok, true, resigned.reason);

  const malleable = walletJoin(bytes, 11n, commitment);
  malleable.sig = highS(malleable.sig, SECP256K1);
  assert.equal(seal(bytes, malleable).reason, 'rule_4');
  const seenParity = new Map();
  let parityBlock = 20n;
  while (seenParity.size < 2 && parityBlock < 40n) {
    const rec = walletJoin(bytes, parityBlock, commitment);
    seenParity.set(rec.sig[64], rec);
    parityBlock += 1n;
  }
  assert.equal(seenParity.size, 2);
  for (const rec of seenParity.values()) {
    assert.ok(rec.sig[64] === 0 || rec.sig[64] === 1);
    rec.sig = new Uint8Array(rec.sig);
    rec.sig[64] = 27 + rec.sig[64];
    assert.equal(seal(bytes, rec).reason, 'rule_4');
  }
});

test('the epoch window admits a block after the previous anchor and through the showing anchor', () => {
  const commitment = sha256(ascii('window-book'));
  const bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const window = [{
    prevAnchorBlock: 100n,
    showAnchorBlock: 200n,
    hourStart: 3600n,
    contract: CONTRACT,
  }];
  assert.equal(seal(bytes, walletJoin(bytes, 100n, commitment), { epochs: window }).reason, 'rule_1');
  const atShow = seal(bytes, walletJoin(bytes, 200n, commitment), { epochs: window });
  assert.equal(atShow.ok, true, atShow.reason);
  assert.equal(seal(bytes, walletJoin(bytes, 201n, commitment), { epochs: window }).reason, 'rule_1');
  const inside = seal(bytes, walletJoin(bytes, 101n, commitment), { epochs: window });
  assert.equal(inside.ok, true, inside.reason);
  assert.equal(seal(bytes, walletJoin(bytes, 0n, commitment)).reason, 'rule_1');
  const noContract = [{
    prevAnchorBlock: 0n,
    showAnchorBlock: 1n << 40n,
    hourStart: 0n,
  }];
  assert.doesNotThrow(() => {
    const refused = seal(bytes, walletJoin(bytes, 10n, commitment), { epochs: noContract });
    assert.equal(refused.reason, 'rule_1');
  });
  const listed = [{ address: CONTRACT, fromHour: 0n, untilHour: null }];
  const fromList = seal(bytes, walletJoin(bytes, 10n, commitment), {
    epochs: noContract,
    contracts: listed,
  });
  assert.equal(fromList.ok, true, fromList.reason);
  assert.equal(seal(bytes, walletJoin(bytes, 10n, commitment), {
    epochs: noContract,
    contracts: [{ address: OTHER_CONTRACT, fromHour: 0n, untilHour: null }],
  }).reason, 'rule_4');
});

test('two epochs that both cover the block refuse the record', () => {
  const commitment = sha256(ascii('overlap-book'));
  const bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const overlap = [
    { prevAnchorBlock: 0n, showAnchorBlock: 500n, hourStart: 0n, contract: CONTRACT },
    { prevAnchorBlock: 0n, showAnchorBlock: 500n, hourStart: 0n, contract: OTHER_CONTRACT },
  ];
  const signedForLast = walletJoin(bytes, 150n, commitment, walletScalar, OTHER_CONTRACT);
  assert.equal(seal(bytes, signedForLast, { epochs: overlap }).reason, 'rule_1');
  const signedForFirst = walletJoin(bytes, 150n, commitment, walletScalar, CONTRACT);
  assert.equal(seal(bytes, signedForFirst, { epochs: overlap }).reason, 'rule_1');
});

test('the epoch slot takes fresh randomness every hourly epoch', () => {
  assert.equal(HOUR_SECONDS, 3600);
  const epochKey = slotKey({ kind: KIND_EPOCH, chainId: CHAIN, id: new Uint8Array(0) });
  assert.equal(epochKey.hex, SPEC_KEYS.epoch);
  const unaligned = drawEpoch(createTree(), {
    chainId: CHAIN,
    epoch: 0,
    hourStart: 1,
    randomness: fill(3),
  });
  assert.equal(unaligned.reason, 'bad_epoch');
  let tree = createTree();
  const first = drawEpoch(tree, { chainId: CHAIN, epoch: 0, hourStart: 0, randomness: fill(1) });
  assert.equal(first.ok, true, first.reason);
  assert.equal(bytesToHex(first.slotKey.bytes), epochKey.hex);
  const reused = drawEpoch(first.tree, {
    chainId: CHAIN,
    epoch: 1,
    hourStart: HOUR_SECONDS,
    randomness: fill(1),
  });
  assert.equal(reused.reason, 'bad_random');
  const skewed = drawEpoch(first.tree, {
    chainId: CHAIN,
    epoch: 1,
    hourStart: 1,
    randomness: fill(2),
  });
  assert.equal(skewed.reason, 'bad_epoch');
  const skipped = drawEpoch(first.tree, {
    chainId: CHAIN,
    epoch: 1,
    hourStart: HOUR_SECONDS * 2,
    randomness: fill(2),
  });
  assert.equal(skipped.reason, 'bad_epoch');
  const second = drawEpoch(first.tree, {
    chainId: CHAIN,
    epoch: 1,
    hourStart: HOUR_SECONDS,
    randomness: fill(2),
  });
  assert.equal(second.ok, true, second.reason);
  assert.notEqual(bytesToHex(rootBytes(first.tree)), bytesToHex(rootBytes(second.tree)));
  const proof = prove(second.tree, epochKey.bytes);
  assert.equal(verifyProof(epochKey.bytes, fill(2), proof.proof, rootBytes(second.tree)).ok, true);
  assert.equal(verifyProof(epochKey.bytes, fill(1), proof.proof, rootBytes(second.tree)).reason, 'bad_proof');
  assert.equal(entryCount(first.tree), 1);
  assert.equal(entryCount(second.tree), 1);
  assert.equal(drawEpoch(createTree(), {
    chainId: CHAIN,
    epoch: 1,
    hourStart: 0,
    randomness: fill(4),
  }).reason, 'bad_epoch');
  assert.equal(drawEpoch(first.tree, {
    chainId: CHAIN,
    epoch: 2,
    hourStart: HOUR_SECONDS,
    randomness: fill(5),
  }).reason, 'bad_epoch');
  assert.equal(drawEpoch(first.tree, {
    chainId: 84532n,
    epoch: 1,
    hourStart: HOUR_SECONDS,
    randomness: fill(6),
  }).reason, 'bad_epoch');
});

test('padding reaches 1,024 leaves and a redraw keeps the wallet slot', () => {
  const commitment = sha256(ascii('pad-book'));
  let bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  bytes = seal(bytes, walletJoin(bytes, 4n, commitment)).bytes;
  let tree = createTree();
  const placed = placeHistory(tree, bytes);
  tree = drawEpoch(placed.tree, {
    chainId: CHAIN,
    epoch: 0,
    hourStart: 0,
    randomness: fill(8),
  }).tree;
  const padded = padTo1024(tree, fill(9));
  assert.equal(padded.ok, true, padded.reason);
  assert.equal(PAD_ENTRIES, 1024);
  assert.equal(entryCount(padded.tree), 1024);
  const proof = prove(padded.tree, placed.slotKey.bytes);
  assert.equal(verifyProof(placed.slotKey.bytes, bytes, proof.proof, rootBytes(padded.tree)).ok, true);
  const again = redrawDummies(padded.tree, fill(10));
  assert.equal(entryCount(again.tree), 1024);
  assert.notEqual(bytesToHex(rootBytes(padded.tree)), bytesToHex(rootBytes(again.tree)));
  const epochLeaf = getLeaf(again.tree, slotKey({ kind: KIND_EPOCH, chainId: CHAIN, id: new Uint8Array(0) }).bytes);
  assert.ok(epochLeaf);
  assert.equal(bytesToHex(epochLeaf.value), bytesToHex(fill(8)));
  const historyLeaf = getLeaf(again.tree, placed.slotKey.bytes);
  assert.ok(historyLeaf);
  assert.equal(bytesToHex(historyLeaf.value), bytesToHex(bytes));
  const refreshed = prove(again.tree, placed.slotKey.bytes);
  assert.equal(verifyProof(placed.slotKey.bytes, bytes, refreshed.proof, rootBytes(again.tree)).ok, true);
  assert.equal(verifyProof(placed.slotKey.bytes, bytes, proof.proof, rootBytes(again.tree)).reason, 'bad_proof');
});

test('proof sizes at 1,024 entries sit on the SIMPLE §S5 citation', () => {
  const doc = renderSlotProofs();
  const measured = doc.measured_1024;
  assert.equal(doc.m7_out, 'not in this repository');
  assert.equal(doc.cited.mean_bytes, CITED_PROOF_BYTES.mean);
  assert.equal(measured.entries, 1024);
  for (const sample of measured.samples) {
    assert.equal(sample.bytes, 32 + 32 * sample.siblings);
    const proof = hexToBytes(sample.proof);
    const root = hexToBytes(measured.root);
    assert.equal(verifyProof(hexToBytes(sample.key), hexToBytes(sample.value), proof, root).ok, true);
  }
  assert.ok(Math.abs(measured.mean - 363) < 1.5, `measured mean ${measured.mean}; cited 363; m7.out is not in the repo`);
  assert.equal(measured.max, 480);
  assert.equal(doc.cited.observed_tail_bytes, 544);
  assert.equal(doc.cited.verifier_cap, false);
  const wide = new Uint8Array(544);
  for (let depth = 0; depth < 16; depth += 1) {
    wide[Math.floor(depth / 8)] += Math.floor(128 / (2 ** (depth % 8)));
  }
  assert.equal(verifyProof(
    hexToBytes(measured.samples[0].key),
    hexToBytes(measured.samples[0].value),
    wide,
    hexToBytes(measured.root),
  ).reason, 'bad_proof');
  assert.equal(doc.slot_keys.payTo_0x11, SPEC_KEYS.payTo);
  assert.equal(doc.slot_keys.epoch, SPEC_KEYS.epoch);
  const onDisk = readFileSync(VECTOR_PATH, 'utf8');
  assert.equal(onDisk, `${JSON.stringify(doc, null, 2)}\n`);
});

test('BookCreate accepts only the signature of the identity key the record names', () => {
  const bookA = new Uint8Array(32).fill(0x22);
  const bookB = new Uint8Array(32).fill(0x23);
  const firstBytes = emptyHistory(KIND_BOOK, CHAIN, bookA).bytes;
  const bound = bookCreate(firstBytes, 1n, identityKey, identityScalar);
  const admitted = seal(firstBytes, bound);
  assert.equal(admitted.ok, true, admitted.reason);
  assert.equal(bytesToHex(viewOf(admitted.bytes).book), bytesToHex(identityKey));

  const fromOther = bookCreate(firstBytes, 1n, identityKey, otherIdentityScalar);
  assert.equal(seal(firstBytes, fromOther).reason, 'rule_4');
  const fromThird = bookCreate(firstBytes, 1n, identityKey, thirdIdentityScalar);
  assert.equal(seal(firstBytes, fromThird).reason, 'rule_4');

  const secondBytes = emptyHistory(KIND_BOOK, CHAIN, bookB).bytes;
  const otherBound = seal(secondBytes, bookCreate(secondBytes, 1n, otherIdentity, otherIdentityScalar));
  assert.equal(otherBound.ok, true, otherBound.reason);
  assert.equal(seal(secondBytes, bookCreate(secondBytes, 1n, otherIdentity, identityScalar)).reason, 'rule_4');
  assert.equal(seal(secondBytes, bookCreate(secondBytes, 1n, otherIdentity, thirdIdentityScalar)).reason, 'rule_4');

  const again = bookCreate(admitted.bytes, 2n, identityKey, identityScalar);
  assert.equal(seal(admitted.bytes, again).reason, 'rule_1');
  const unsigned = bookCreate(admitted.bytes, 2n, thirdIdentity, thirdIdentityScalar);
  unsigned.sig = new Uint8Array(65);
  assert.equal(seal(admitted.bytes, unsigned).reason, 'rule_4');
  const malleable = bookCreate(firstBytes, 1n, identityKey, identityScalar);
  malleable.sig = highS(malleable.sig, P256);
  assert.equal(seal(firstBytes, malleable).reason, 'rule_4');

  const anchored = encodeHistory({
    kind: KIND_BOOK,
    chainId: CHAIN,
    id: bookA,
    records: [bound, unsigned],
  });
  const view = viewOf(anchored.bytes);
  assert.equal(view.killed, false);
  assert.equal(view.faults[0].line, 'invalid record at seq 1 (Chit fault)');
  assert.equal(bytesToHex(view.book), bytesToHex(identityKey));
});

test('contractForHour is half-open at untilHour and refuses two matches', () => {
  assert.equal(contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
  ], 3600n), null);
  assert.equal(contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
  ], 3599n) && bytesToHex(contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
  ], 3599n)), bytesToHex(CONTRACT));
  const listed = contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
    { address: OTHER_CONTRACT, fromHour: 3600n, untilHour: null },
  ], 3600n);
  assert.ok(listed instanceof Uint8Array);
  assert.equal(bytesToHex(listed), bytesToHex(OTHER_CONTRACT));
  assert.equal(contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 7200n },
    { address: OTHER_CONTRACT, fromHour: 0n, untilHour: 7200n },
  ], 1n), null);
  assert.equal(contractForHour([
    { address: CONTRACT, fromHour: 10n, untilHour: null },
  ], 9n), null);
});

test('equivocation follows epoch order and stays on one wallet slot', () => {
  const commitment = sha256(ascii('eq-book'));
  let base = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  base = seal(base, walletJoin(base, 7n, commitment)).bytes;
  const extended = seal(base, walletStop(base, 18n, commitment));
  assert.equal(extended.ok, true, extended.reason);
  assert.equal(extendsHistory(base, extended.bytes).extends, true);
  assert.equal(extendsHistory(extended.bytes, base).extends, false);

  const decoded = decodeHistory(base);
  const mutated = encodeHistory({
    kind: decoded.kind,
    chainId: decoded.chainId,
    id: decoded.id,
    records: [{ ...decoded.records[0], sig: new Uint8Array(65).fill(3) }],
  });
  assert.equal(extendsHistory(base, mutated.bytes).extends, false);
  assert.equal(extendsHistory(mutated.bytes, base).extends, false);

  function anchor(historyBytes, seed) {
    let tree = createTree();
    const placed = placeHistory(tree, historyBytes);
    tree = drawEpoch(placed.tree, {
      chainId: CHAIN,
      epoch: 0,
      hourStart: 0,
      randomness: fill(seed),
    }).tree;
    return {
      key: placed.slotKey.bytes,
      value: historyBytes,
      proof: prove(tree, placed.slotKey.bytes).proof,
      root: rootBytes(tree),
      epoch: BigInt(seed),
    };
  }

  const left = anchor(base, 1);
  const right = anchor(mutated.bytes, 2);
  const clash = detectEquivocation(left, right);
  assert.equal(clash.ok, true);
  assert.equal(clash.equivocation, true);
  assert.equal(clash.reason, 'rule_5');
  assert.notEqual(bytesToHex(left.root), bytesToHex(right.root));
  assert.equal(detectEquivocation(anchor(extended.bytes, 1), anchor(base, 2)).equivocation, true);
  assert.equal(detectEquivocation(left, anchor(extended.bytes, 3)).equivocation, false);
  assert.equal(detectEquivocation(anchor(base, 4), anchor(base, 5)).equivocation, false);

  let other = emptyHistory(KIND_WALLET, CHAIN, otherWallet).bytes;
  other = seal(other, walletJoin(other, 7n, commitment, otherWalletScalar)).bytes;
  assert.equal(detectEquivocation(anchor(base, 6), anchor(other, 7)).equivocation, false);
  assert.equal(detectEquivocation(anchor(other, 8), anchor(base, 7)).reason, 'bad_epoch');
  const sameEpochLeft = anchor(base, 9);
  const sameEpochRight = anchor(mutated.bytes, 10);
  sameEpochRight.epoch = sameEpochLeft.epoch;
  assert.equal(detectEquivocation(sameEpochLeft, sameEpochRight).reason, 'bad_epoch');
  const wrongKey = fill(9);
  const wrongTree = putLeaf(createTree(), wrongKey, base).tree;
  assert.equal(detectEquivocation({
    key: wrongKey,
    value: base,
    proof: prove(wrongTree, wrongKey).proof,
    root: rootBytes(wrongTree),
    epoch: 9n,
  }, {
    key: wrongKey,
    value: base,
    proof: prove(wrongTree, wrongKey).proof,
    root: rootBytes(wrongTree),
    epoch: 10n,
  }).reason, 'bad_key');
});

test('an ignored wallet record does not raise the block floor or claim its id', () => {
  const commitment = sha256(ascii('floor-book'));
  const bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const good = walletJoin(bytes, 10n, commitment);
  const bad = walletLeave(bytes, 1000n);
  bad.seq = 1n;
  bad.sig = new Uint8Array(65);
  const later = walletLeave(bytes, 20n);
  later.seq = 2n;
  later.id = bad.id;
  const encoded = encodeHistory({
    kind: KIND_WALLET,
    chainId: CHAIN,
    id: wallet,
    records: [good, bad, later],
  });
  const view = viewOf(encoded.bytes);
  assert.equal(view.killed, false);
  assert.equal(view.active, null);
  assert.equal(view.stopped, false);
  assert.equal(view.faults.map((item) => item.seq).join(','), '1');
  assert.equal(view.faults[0].rule, 'rule_4');
});

test('verifySlot checks the wallet header against the proved leaf', () => {
  const commitment = sha256(ascii('slot-book'));
  let bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  bytes = seal(bytes, walletJoin(bytes, 6n, commitment)).bytes;
  const key = slotKey({ kind: KIND_WALLET, chainId: CHAIN, id: wallet });
  const tree = putLeaf(createTree(), key.bytes, bytes).tree;
  const proof = prove(tree, key.bytes).proof;
  const root = rootBytes(tree);
  assert.equal(verifySlot(KIND_WALLET, CHAIN, wallet, bytes, proof, root).ok, true);
  assert.equal(verifySlot(KIND_WALLET, CHAIN, otherWallet, bytes, proof, root).reason, 'bad_proof');

  const foreignKey = slotKey({ kind: KIND_WALLET, chainId: 1n, id: wallet }).bytes;
  const planted = putLeaf(createTree(), foreignKey, bytes).tree;
  assert.equal(verifySlot(
    KIND_WALLET,
    1n,
    wallet,
    bytes,
    prove(planted, foreignKey).proof,
    rootBytes(planted),
  ).reason, 'bad_history');
  const otherBytes = seal(
    emptyHistory(KIND_WALLET, CHAIN, otherWallet).bytes,
    walletJoin(emptyHistory(KIND_WALLET, CHAIN, otherWallet).bytes, 6n, commitment, otherWalletScalar),
  ).bytes;
  const keyA = slotKey({ kind: KIND_WALLET, chainId: CHAIN, id: wallet }).bytes;
  const namedOther = putLeaf(createTree(), keyA, otherBytes).tree;
  assert.equal(verifySlot(
    KIND_WALLET,
    CHAIN,
    wallet,
    otherBytes,
    prove(namedOther, keyA).proof,
    rootBytes(namedOther),
  ).reason, 'bad_history');
});

test('retained boundaries reject a bad root, a full history, and a cross-kind record', () => {
  const key = fill(7);
  let tree = createTree();
  tree = putLeaf(tree, key, fill(1)).tree;
  const proof = prove(tree, key).proof;
  const trailing = new Uint8Array(proof.length + 32);
  trailing.set(proof);
  trailing.set(fill(9), proof.length);
  assert.equal(verifyProof(key, fill(1), trailing, rootBytes(tree)).reason, 'bad_proof');
  assert.equal(putLeaf(createTree(), new Uint8Array(31), fill(1)).reason, 'bad_key');
  assert.equal(verifyProof(fill(1), fill(2), new Uint8Array(32), rootBytes(createTree()).subarray(0, 31)).reason, 'bad_length');

  const walletBytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const patchedLen = walletBytes.slice();
  patchedLen[10] = 19;
  assert.equal(decodeHistory(patchedLen).reason, 'bad_kind');
  const capped = walletBytes.slice();
  const countAt = 11 + wallet.length;
  const over = MAX_RECORDS + 1;
  capped[countAt] = Math.floor(over / 16777216) % 256;
  capped[countAt + 1] = Math.floor(over / 65536) % 256;
  capped[countAt + 2] = Math.floor(over / 256) % 256;
  capped[countAt + 3] = over % 256;
  assert.equal(decodeHistory(capped).reason, 'bad_size');

  const bookOnWallet = bookCreate(walletBytes, 6n, identityKey, identityScalar);
  const walletWithBook = encodeHistory({
    kind: KIND_WALLET,
    chainId: CHAIN,
    id: wallet,
    records: [bookOnWallet],
  });
  assert.doesNotThrow(() => {
    const view = assess(walletWithBook.bytes, { epochs: [EPOCH] });
    assert.equal(view.ok, true);
    assert.equal(view.killed, false);
    assert.equal(view.book, null);
    assert.equal(view.faults[0].rule, 'rule_4');
  });

  const bookId = new Uint8Array(32).fill(0x41);
  const joinOnBook = {
    seq: 0n,
    block: 6n,
    fromBlock: null,
    id: freshId(),
    type: REC_JOIN,
    commitment: sha256(ascii('cross-kind')),
    sig: new Uint8Array(65),
  };
  const bookWithJoin = encodeHistory({
    kind: KIND_BOOK,
    chainId: CHAIN,
    id: bookId,
    records: [joinOnBook],
  });
  assert.doesNotThrow(() => {
    const view = assess(bookWithJoin.bytes, { epochs: [EPOCH] });
    assert.equal(view.ok, true);
    assert.equal(view.killed, false);
    assert.equal(view.faults[0].rule, 'rule_4');
  });

  const offCurve = new Uint8Array(33);
  offCurve[0] = 0x02;
  offCurve.fill(0x01, 1);
  const offBook = new Uint8Array(32).fill(0x42);
  const offBytes = emptyHistory(KIND_BOOK, CHAIN, offBook).bytes;
  const offRecord = bookCreate(offBytes, 1n, offCurve, identityScalar);
  const anchored = encodeHistory({
    kind: KIND_BOOK,
    chainId: CHAIN,
    id: offBook,
    records: [offRecord],
  });
  assert.doesNotThrow(() => {
    const view = assess(anchored.bytes, { epochs: [EPOCH] });
    assert.equal(view.ok, true);
    assert.equal(view.killed, false);
    assert.equal(view.book, null);
    assert.equal(view.faults[0].rule, 'rule_4');
  });
});

test('payTo and the 0x05 key slot are not histories in this module', () => {
  assert.equal(emptyHistory(KIND_PAYTO, CHAIN, wallet).reason, 'bad_kind');
  assert.equal(emptyHistory(KIND_KEY, CHAIN, fill(1)).reason, 'bad_kind');
  assert.equal(emptyHistory(KIND_BOOK, CHAIN, wallet).reason, 'bad_length');
  assert.equal(emptyHistory(KIND_WALLET, CHAIN, fill(2)).reason, 'bad_length');
});

test('smt fixtures verify under the committed root', () => {
  const dir = join(HERE, '..', 'smt-fixtures');
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  const files = new Map();
  for (const line of sums.trim().split('\n')) {
    const digest = line.slice(0, 64);
    const name = line.slice(66);
    const bytes = readFileSync(join(dir, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, name);
    files.set(name, bytes);
  }
  const root = files.get('root.bytes');
  assert.ok(root instanceof Uint8Array);
  assert.equal(root.length, 32);
  assert.equal(verifyProof(files.get('payto-slot.bytes'), files.get('payto-value.bytes'), files.get('payto-member.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('key-slot.bytes'), files.get('key-value.bytes'), files.get('key-member.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('blank-key-slot.bytes'), null, files.get('blank-key.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('absent-payto-slot.bytes'), null, files.get('absent-payto.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('key-slot.bytes'), null, files.get('blank-key.proof'), root).ok, false);
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.equal(readme.includes('root.bin'), false);
  assert.equal(readme.includes('root.bytes'), true);
});

test('source scan rejects fabricated proofs, roots, and flags', () => {
  const flagName = /^(?:signatureOk|keyHashOk|payToOk|keyOk|proofOk|absent|member|absentAtPrev|memberAtEpoch)$/;
  const literalOrFold = /^(?:true|false)$|\.length\b|\bsig\b|&&|\|\|/;
  for (const name of ['history.mjs', 'sig.mjs']) {
    const text = readFileSync(join(HERE, name), 'utf8');
    assert.equal(/\bcheckSigma\b/.test(text), false, name);
    assert.equal(/\b(?:signatureOk|keyHashOk|absentAtPrev|memberAtEpoch|payToOk|keyOk)\b/.test(text), false, name);
    assert.equal(/\broot\s*=\s*[^;\n]*\b(?:contract|padAddress)\b/.test(text), false, `${name} root`);
    assert.equal(/\b(?:proof|proved|member|absent)\s*=\s*[^;\n]*\.length\b/.test(text), false, `${name} length`);
    assert.equal(/verify(?:Proof|WalletJoin|WalletLeave|WalletStop|BookCreate)\([^)]*\b(?:true|false)\b/.test(text), false, name);
    for (const match of text.matchAll(/(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+)/g)) {
      if (!flagName.test(match[1])) continue;
      assert.equal(literalOrFold.test(match[2]), false, `${name} ${match[1]} = ${match[2].trim()}`);
    }
  }
});
