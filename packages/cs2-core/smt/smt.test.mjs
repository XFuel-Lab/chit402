/**
 * State SMT, compressed proofs, and slot rules 1–7.
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
  KIND_PAYTO,
  KIND_WALLET,
  emptyHash,
  slotKey,
  stateNode,
} from '../line/index.mjs';
import { renderSlotProofs, VECTOR_PATH } from './build-vectors.mjs';
import {
  CITED_PROOF_BYTES,
  HOUR_SECONDS,
  KEY_STATUS_UNPROVEN,
  MAX_SMT_ENTRIES,
  PAD_ENTRIES,
  REC_BOOK,
  REC_JOIN,
  REC_LEAVE,
  REC_REGISTER,
  REC_REVOKE,
  REC_STOP,
  acceptSize,
  admit,
  assess,
  blankHash,
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
  keyStatus,
  padTo1024,
  payToEntryBytes,
  placeHistory,
  prove,
  putLeaf,
  redrawDummies,
  revokeAcross,
  rootBytes,
  verifyProof,
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

function domainSeparator(chainId) {
  return structHash('EIP712Domain(string name,string version,uint256 chainId)', [
    keccak256(ascii('Chit402')),
    keccak256(ascii('1')),
    padUint(chainId),
  ]);
}

function typedDigest(chainId, typeString, fields) {
  const struct = structHash(typeString, fields);
  return keccak256(concat([Uint8Array.of(0x19, 0x01), domainSeparator(chainId), struct]));
}

function sign(digest, scalar, curve) {
  kCounter += 1n;
  const sig = signRawDigest(digest, scalar, kCounter, curve);
  const out = new Uint8Array(65);
  out.set(sig.raw, 0);
  out[64] = sig.yParity;
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

const payToScalar = 3n;
const otherScalar = 5n;
const walletScalar = 9n;
const sellerScalar = 7n;
const identityScalar = 11n;
const payTo = addressOf(payToScalar);
const otherPayTo = addressOf(otherScalar);
const wallet = addressOf(walletScalar);
const sellerKey = compress(publicPoint(sellerScalar, P256));
const otherSeller = compress(publicPoint(13n, P256));
const identityKey = compress(publicPoint(identityScalar, P256));
const sellerHash = sha256(sellerKey);

function controlDigest(addr, key, validFrom) {
  return typedDigest(CHAIN, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 validFrom)', [
    padAddress(addr),
    padUint(1n),
    keccak256(key),
    padUint(validFrom),
  ]);
}

function controlSig(addr, scalar, key, validFrom) {
  return sign(controlDigest(addr, key, validFrom), scalar, SECP256K1);
}

function register(bytes, addr, scalar, key, block, extra = {}) {
  const decoded = decodeHistory(bytes);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: extra.fromBlock === undefined ? null : extra.fromBlock,
    id: extra.id || freshId(),
    type: REC_REGISTER,
    sig: extra.sig || controlSig(addr, scalar, key, block),
    alg: 1,
    key,
    validFrom: block,
    cross: extra.cross || null,
  };
}

function keyRevokeSig(keyHash, revokedAt) {
  const digest = typedDigest(CHAIN, 'RevokeByKey(bytes32 keyHash,uint64 revokedAt)', [
    keyHash,
    padUint(revokedAt),
  ]);
  return sign(digest, sellerScalar, P256);
}

function payToRevokeSig(addr, scalar, keyHash, revokedAt) {
  const digest = typedDigest(CHAIN, 'Revoke(address payTo,bytes32 keyHash,uint64 revokedAt)', [
    padAddress(addr),
    keyHash,
    padUint(revokedAt),
  ]);
  return sign(digest, scalar, SECP256K1);
}

function revoke(bytes, keyHash, revokedAt, block, sig, by = 'key') {
  const decoded = decodeHistory(bytes);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_REVOKE,
    sig,
    keyHash,
    revokedAt,
    by,
  };
}

function walletSig(typeString, fields, scalar) {
  return sign(typedDigest(CHAIN, typeString, fields), scalar, SECP256K1);
}

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

test('rule 1 orders by admission block, and fromBlock is not that block', () => {
  const commitment = sha256(ascii('book-commit'));
  let bytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const join = {
    seq: 0n,
    block: 10n,
    fromBlock: 100n,
    id: freshId(),
    type: REC_JOIN,
    sig: walletSig('WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(wallet), commitment, padUint(10n),
    ], walletScalar),
    commitment,
  };
  const first = admit(bytes, join);
  assert.equal(first.ok, true, first.reason);
  const leave = {
    seq: 1n,
    block: 10n,
    fromBlock: 0n,
    id: freshId(),
    type: REC_LEAVE,
    sig: walletSig('WalletLeave(address wallet,uint64 block)', [
      padAddress(wallet), padUint(10n),
    ], walletScalar),
  };
  const second = admit(first.bytes, leave);
  assert.equal(second.ok, true, second.reason);
  const early = {
    ...leave,
    seq: 2n,
    block: 9n,
    fromBlock: 1000n,
    id: freshId(),
    sig: walletSig('WalletLeave(address wallet,uint64 block)', [
      padAddress(wallet), padUint(9n),
    ], walletScalar),
  };
  assert.equal(admit(second.bytes, early).reason, 'rule_1');

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
  const judged = assess(decreasing.bytes);
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
  const dupView = assess(dup.bytes);
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

test('rule 2 keeps payTo intervals disjoint and a wallet at one book unless STOP', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const open = admit(bytes, register(bytes, payTo, payToScalar, sellerKey, 10n));
  assert.equal(open.ok, true, open.reason);
  const overlap = register(open.bytes, payTo, payToScalar, otherSeller, 15n);
  assert.equal(admit(open.bytes, overlap).reason, 'rule_2');
  const stillOpen = register(open.bytes, payTo, payToScalar, otherSeller, 11n);
  assert.equal(admit(open.bytes, stillOpen).reason, 'rule_2');

  const closedSig = payToRevokeSig(payTo, payToScalar, sellerHash, 20n);
  const closed = admit(open.bytes, revoke(open.bytes, sellerHash, 20n, 20n, closedSig, 'payTo'));
  assert.equal(closed.ok, true, closed.reason);
  const future = register(closed.bytes, payTo, payToScalar, otherSeller, 30n, {
    sig: controlSig(payTo, payToScalar, otherSeller, 31n),
  });
  future.validFrom = 31n;
  assert.equal(admit(closed.bytes, future).reason, 'rule_2');
  const next = admit(closed.bytes, register(closed.bytes, payTo, payToScalar, otherSeller, 20n));
  assert.equal(next.ok, true, next.reason);
  const sameBlock = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, otherSeller, 10n);
  sameBlock.seq = 1n;
  const overlapped = encodeHistory({
    kind: KIND_PAYTO,
    chainId: CHAIN,
    id: payTo,
    records: [decodeHistory(open.bytes).records[0], sameBlock],
  });
  const overlappedView = assess(overlapped.bytes);
  assert.equal(overlappedView.killed, false);
  assert.equal(overlappedView.faults[0].rule, 'rule_2');
  assert.equal(overlappedView.keys.length, 1);

  const proved = keyStatus(next.bytes, { paymentBlock: 20n, sellerKey: otherSeller, transferTo: payTo });
  assert.equal(proved.ok, true);
  const atStart = keyStatus(open.bytes, { paymentBlock: 10n, sellerKey, transferTo: payTo });
  assert.equal(atStart.ok, true);
  const before = keyStatus(open.bytes, { paymentBlock: 9n, sellerKey, transferTo: payTo });
  assert.equal(before.status, 'key status unproven');
  assert.equal(before.status, KEY_STATUS_UNPROVEN);
  const atEnd = keyStatus(closed.bytes, { paymentBlock: 20n, sellerKey, transferTo: payTo });
  assert.equal(atEnd.status, KEY_STATUS_UNPROVEN);
  const justBeforeEnd = keyStatus(closed.bytes, { paymentBlock: 19n, sellerKey, transferTo: payTo });
  assert.equal(justBeforeEnd.ok, true);

  const commitment = sha256(ascii('wallet-book'));
  const otherCommit = sha256(ascii('other-book'));
  let walletBytes = emptyHistory(KIND_WALLET, CHAIN, wallet).bytes;
  const join = {
    seq: 0n,
    block: 3n,
    fromBlock: null,
    id: freshId(),
    type: REC_JOIN,
    commitment,
    sig: walletSig('WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(wallet), commitment, padUint(3n),
    ], walletScalar),
  };
  walletBytes = admit(walletBytes, join).bytes;
  const second = {
    ...join,
    seq: 1n,
    block: 4n,
    id: freshId(),
    commitment: otherCommit,
    sig: walletSig('WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(wallet), otherCommit, padUint(4n),
    ], walletScalar),
  };
  assert.equal(admit(walletBytes, second).reason, 'rule_2');
  assert.equal(admit(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, { ...join, sig: new Uint8Array(65) }).reason, 'rule_4');
  const stopped = {
    seq: 1n,
    block: 4n,
    fromBlock: 1n,
    id: freshId(),
    type: REC_STOP,
    commitment: otherCommit,
    sig: walletSig('WalletStop(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(wallet), otherCommit, padUint(4n),
    ], walletScalar),
  };
  const afterStop = admit(walletBytes, stopped);
  assert.equal(afterStop.ok, true, afterStop.reason);
  const view = assess(afterStop.bytes);
  assert.equal(view.stopped, true);
  assert.equal(view.active, null);
  assert.equal(view.killed, false);
  const resume = admit(afterStop.bytes, {
    seq: 2n,
    block: 5n,
    fromBlock: null,
    id: freshId(),
    type: REC_LEAVE,
    sig: walletSig('WalletLeave(address wallet,uint64 block)', [padAddress(wallet), padUint(5n)], walletScalar),
  });
  assert.equal(resume.ok, true, resume.reason);
  assert.equal(assess(resume.bytes).stopped, false);
});

test('rule 3 and rule 4: the covering key is signed, and a bad signature is unproven', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = admit(bytes, register(bytes, payTo, payToScalar, sellerKey, 8n)).bytes;
  const wrongTo = keyStatus(bytes, { paymentBlock: 8n, sellerKey, transferTo: otherPayTo });
  assert.equal(wrongTo.status, KEY_STATUS_UNPROVEN);
  const wrongKey = keyStatus(bytes, { paymentBlock: 8n, sellerKey: otherSeller, transferTo: payTo });
  assert.equal(wrongKey.status, KEY_STATUS_UNPROVEN);

  const zeros = new Uint8Array(65);
  assert.equal(admit(bytes, register(bytes, payTo, payToScalar, otherSeller, 40n, { sig: zeros })).reason, 'rule_4');

  const low = controlSig(payTo, payToScalar, otherSeller, 40n);
  const highS = bytesToBig(low.subarray(32, 64));
  const flipped = concat([
    low.subarray(0, 32),
    bigToBytes(SECP256K1.order - highS, 32),
    Uint8Array.of(low[64] ^ 1),
  ]);
  assert.equal(admit(bytes, register(bytes, payTo, payToScalar, otherSeller, 40n, { sig: flipped })).reason, 'rule_4');

  const low27 = controlSig(otherPayTo, otherScalar, otherSeller, 2n);
  const parity27 = new Uint8Array(low27);
  parity27[64] = low27[64] + 27;
  const emptyOther = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  const as27 = admit(emptyOther, register(emptyOther, otherPayTo, otherScalar, otherSeller, 2n, { sig: parity27 }));
  assert.equal(as27.ok, true, as27.reason);

  const keySig = keyRevokeSig(sellerHash, 12n);
  const byKey = admit(bytes, revoke(bytes, sellerHash, 12n, 12n, keySig, 'key'));
  assert.equal(byKey.ok, true, byKey.reason);
  const again = keyRevokeSig(sellerHash, 14n);
  assert.equal(admit(byKey.bytes, revoke(byKey.bytes, sellerHash, 14n, 14n, again, 'key')).reason, 'rule_2');

  let fresh = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  fresh = admit(fresh, register(fresh, payTo, payToScalar, sellerKey, 1n)).bytes;
  const paySig = payToRevokeSig(payTo, payToScalar, sellerHash, 6n);
  const byPay = admit(fresh, revoke(fresh, sellerHash, 6n, 4n, paySig, 'payTo'));
  assert.equal(byPay.ok, true, byPay.reason);
  const foreign = payToRevokeSig(otherPayTo, otherScalar, sellerHash, 6n);
  assert.equal(admit(fresh, revoke(fresh, sellerHash, 6n, 4n, foreign, 'payTo')).reason, 'rule_4');
});

test('rule 5 detects equivocation between two roots and accepts a real extension', () => {
  let base = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  base = admit(base, register(base, payTo, payToScalar, sellerKey, 7n)).bytes;
  const extended = admit(base, revoke(base, sellerHash, 18n, 18n, keyRevokeSig(sellerHash, 18n), 'key'));
  assert.equal(extended.ok, true);
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
    const proof = prove(tree, placed.slotKey.bytes);
    return {
      key: placed.slotKey.bytes,
      value: historyBytes,
      proof: proof.proof,
      root: rootBytes(tree),
    };
  }

  const left = anchor(base, 1);
  const right = anchor(mutated.bytes, 2);
  const clash = detectEquivocation(left, right);
  assert.equal(clash.ok, true);
  assert.equal(clash.equivocation, true);
  assert.equal(clash.reason, 'rule_5');
  assert.notEqual(bytesToHex(left.root), bytesToHex(right.root));

  const grown = anchor(extended.bytes, 3);
  const ok = detectEquivocation(left, grown);
  assert.equal(ok.equivocation, false);

  const same = anchor(base, 4);
  assert.equal(detectEquivocation(left, same).equivocation, false);
  assert.notEqual(bytesToHex(left.root), bytesToHex(same.root));
});

test('rule 7 requires both payTos, and a keyHash revocation hits every slot', () => {
  let first = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  first = admit(first, register(first, payTo, payToScalar, sellerKey, 5n)).bytes;
  let second = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  const ctx = { others: [{ id: payTo, bytes: first }] };
  const bare = register(second, otherPayTo, otherScalar, sellerKey, 6n);
  assert.equal(admit(second, bare, ctx).reason, 'rule_7');

  const cross = typedDigest(CHAIN, 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)', (() => {
    const [a, b] = bytesToHex(payTo) <= bytesToHex(otherPayTo)
      ? [payTo, otherPayTo]
      : [otherPayTo, payTo];
    return [padAddress(a), padAddress(b), sellerHash];
  })());
  const signed = register(second, otherPayTo, otherScalar, sellerKey, 6n, {
    cross: {
      other: payTo,
      selfSig: sign(cross, otherScalar, SECP256K1),
      otherSig: sign(cross, payToScalar, SECP256K1),
    },
  });
  const both = admit(second, signed, ctx);
  assert.equal(both.ok, true, both.reason);
  const oneSided = register(second, otherPayTo, otherScalar, sellerKey, 6n, {
    cross: {
      other: payTo,
      selfSig: sign(cross, otherScalar, SECP256K1),
      otherSig: new Uint8Array(65),
    },
  });
  assert.equal(admit(second, oneSided, ctx).reason, 'rule_7');

  const revokedAt = 22n;
  const spread = revokeAcross([first, both.bytes], {
    key: sellerKey,
    revokedAt,
    block: revokedAt,
    sig: keyRevokeSig(sellerHash, revokedAt),
  });
  assert.equal(spread.ok, true, spread.reason);
  assert.equal(spread.applied, 2);
  for (const bytes of spread.histories) {
    const view = assess(bytes);
    assert.equal(view.keys[0].revokedAt, revokedAt);
    assert.equal(keyStatus(bytes, {
      paymentBlock: revokedAt,
      sellerKey,
      transferTo: view.id,
    }).status, KEY_STATUS_UNPROVEN);
  }
});

test('a breaching record is ignored and does not kill the slot', () => {
  const good = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, sellerKey, 10n);
  const bad = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, otherSeller, 11n, {
    sig: new Uint8Array(65),
  });
  bad.seq = 1n;
  const end = revoke(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, sellerHash, 30n, 30n, keyRevokeSig(sellerHash, 30n), 'key');
  end.seq = 2n;
  const encoded = encodeHistory({
    kind: KIND_PAYTO,
    chainId: CHAIN,
    id: payTo,
    records: [good, bad, end],
  });
  const view = assess(encoded.bytes);
  assert.equal(view.ok, true);
  assert.equal(view.killed, false);
  assert.equal(view.count, 3);
  assert.deepEqual(view.faults.map((item) => item.line), [faultLine('1')]);
  assert.equal(view.faults[0].rule, 'rule_4');
  assert.equal(view.keys.length, 1);
  assert.equal(view.keys[0].revokedAt, 30n);
  assert.equal(keyStatus(encoded.bytes, { paymentBlock: 10n, sellerKey, transferTo: payTo }).ok, true);
  assert.equal(keyStatus(encoded.bytes, { paymentBlock: 30n, sellerKey, transferTo: payTo }).status, KEY_STATUS_UNPROVEN);
  assert.equal(keyStatus(encoded.bytes, { paymentBlock: 11n, sellerKey: otherSeller, transferTo: payTo }).status, KEY_STATUS_UNPROVEN);

  const clean = admit(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, good);
  assert.equal(admit(clean.bytes, { ...bad, seq: 1n }).reason, 'rule_4');
});

test('a clean payTo entry is 124 bytes, 156 with the slot key, and a revoked key adds 180', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = admit(bytes, register(bytes, payTo, payToScalar, sellerKey, 9n)).bytes;
  const entry = payToEntryBytes(bytes);
  assert.equal(entry.bytes.length, 124);
  const key = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo });
  assert.equal(entry.bytes.length + key.bytes.length, 156);
  bytes = admit(bytes, revoke(bytes, sellerHash, 15n, 15n, payToRevokeSig(payTo, payToScalar, sellerHash, 15n), 'payTo')).bytes;
  bytes = admit(bytes, register(bytes, payTo, payToScalar, otherSeller, 15n)).bytes;
  const withRevoked = payToEntryBytes(bytes);
  assert.equal(withRevoked.bytes.length - 124, 180);
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
});

test('padding reaches 1,024 leaves and a redraw keeps real slots', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = admit(bytes, register(bytes, payTo, payToScalar, sellerKey, 4n)).bytes;
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
  assert.equal(bytesToHex(getLeaf(again.tree, placed.slotKey.bytes).value), bytesToHex(bytes));
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
  assert.ok(measured.max >= 448 && measured.max <= 480, `measured max ${measured.max}; cited 448-480`);
  assert.equal(doc.slot_keys.payTo_0x11, SPEC_KEYS.payTo);
  assert.equal(doc.slot_keys.epoch, SPEC_KEYS.epoch);
  const onDisk = readFileSync(VECTOR_PATH, 'utf8');
  assert.equal(onDisk, `${JSON.stringify(doc, null, 2)}\n`);
});

test('a book creation is signed by the identity key and a second one is ignored', () => {
  const bookId = new Uint8Array(32).fill(0x22);
  const digest = typedDigest(CHAIN, 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)', [
    bookId,
    sha256(identityKey),
    padUint(1n),
  ]);
  const good = {
    seq: 0n,
    block: 1n,
    fromBlock: null,
    id: freshId(),
    type: REC_BOOK,
    identityKey,
    sig: sign(digest, identityScalar, P256),
  };
  const admitted = admit(emptyHistory(KIND_BOOK, CHAIN, bookId).bytes, good);
  assert.equal(admitted.ok, true, admitted.reason);
  assert.equal(bytesToHex(assess(admitted.bytes).book), bytesToHex(identityKey));
  const unsigned = { ...good, seq: 1n, block: 2n, id: freshId(), sig: new Uint8Array(65) };
  assert.equal(admit(admitted.bytes, unsigned).reason, 'rule_4');
  const second = {
    ...good,
    seq: 1n,
    block: 2n,
    id: freshId(),
    sig: sign(typedDigest(CHAIN, 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)', [
      bookId, sha256(identityKey), padUint(2n),
    ]), identityScalar, P256),
  };
  assert.equal(admit(admitted.bytes, second).reason, 'rule_1');
  const anchored = encodeHistory({
    kind: KIND_BOOK,
    chainId: CHAIN,
    id: bookId,
    records: [good, unsigned],
  });
  const view = assess(anchored.bytes);
  assert.equal(view.killed, false);
  assert.equal(view.faults[0].line, 'invalid record at seq 1 (Chit fault)');
  assert.equal(bytesToHex(view.book), bytesToHex(identityKey));
});
