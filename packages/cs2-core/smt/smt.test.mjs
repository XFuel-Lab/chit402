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
import { KIND_KEY, keySlotKey } from '../eip712/kinds.mjs';
import { readKeyLeaf } from '../key-status/status.mjs';
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
import { decodeKeySlot } from './history.mjs';
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
  admitKeyRevoke,
  assess,
  blankHash,
  createTree,
  decodeHistory,
  detectEquivocation,
  DOMAIN_TYPE,
  formatKeyHash,
  DOMAIN_VERSION,
  drawEpoch,
  emptyHistory,
  emptyRoot,
  encodeHistory,
  entryCount,
  extendsHistory,
  faultLine,
  getLeaf,
  MAX_RECORDS,
  PAYTO_CONTROL_TYPE,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  contractForHour,
  crossDigest,
  indexBytes,
  sellerKeyHash,
  keyStatus,
  padTo1024,
  payToEntryBytes,
  placeHistory,
  prove,
  putLeaf,
  redrawDummies,
  revokeAcross,
  rootBytes,
  parseKeyHash,
  verifyAdmission,
  verifyKeyRevoke,
  verifySellerSig,
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
const EXPIRY = 100n;
const EPOCH = {
  prevAnchorBlock: 0n,
  showAnchorBlock: 1n << 40n,
  hourStart: 0n,
  contract: CONTRACT,
};

function domainSeparator(chainId, contract) {
  return structHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)', [
    keccak256(ascii('Chit402')),
    keccak256(ascii('13')),
    padUint(chainId),
    padAddress(contract),
  ]);
}

function typedDigest(chainId, contract, typeString, fields) {
  const struct = structHash(typeString, fields);
  return keccak256(concat([Uint8Array.of(0x19, 0x01), domainSeparator(chainId, contract), struct]));
}

function seal(bytes, record, ctx) {
  return admit(bytes, record, { epochs: [EPOCH], ...(ctx || {}) });
}

function status(bytes, query) {
  const ctx = { epochs: [EPOCH], ...(query?.ctx || {}) };
  const chain = typeof query?.chainId === 'bigint' ? query.chainId : CHAIN;
  const decoded = decodeHistory(bytes);
  const bare = { chainId: chain, hourStart: 0n, ...query, ctx };
  if (!decoded.ok || !(query?.sellerKey instanceof Uint8Array)) return keyStatus(bytes, bare);
  const payKey = slotKey({ kind: decoded.kind, chainId: chain, id: decoded.id });
  const hashed = sellerKeyHash(1, query.sellerKey);
  if (!payKey.ok || !hashed) return keyStatus(bytes, bare);
  const queried = keySlotKey(chain, hashed);
  if (!queried.ok) return keyStatus(bytes, bare);
  let tree = putLeaf(createTree(), payKey.bytes, bytes).tree;
  let keyValue = null;
  if (ctx.keySlot instanceof Uint8Array) {
    const slotDecoded = decodeHistory(ctx.keySlot);
    if (slotDecoded.ok) {
      const placed = keySlotKey(chain, slotDecoded.id);
      if (placed.ok) {
        tree = putLeaf(tree, placed.bytes, ctx.keySlot).tree;
        if (bytesToHex(placed.bytes) === queried.hex) keyValue = ctx.keySlot;
      }
    }
  }
  const root = rootBytes(tree);
  const prev = createTree();
  const prevRoot = rootBytes(prev);
  return keyStatus(bytes, {
    ...bare,
    root,
    payToProof: prove(tree, payKey.bytes).proof,
    keyProof: prove(tree, queried.bytes).proof,
    keyValue,
    prevRoot,
    prevPayToProof: prove(prev, payKey.bytes).proof,
    prevPayToValue: null,
    prevKeyProof: prove(prev, queried.bytes).proof,
    prevKeyValue: null,
  });
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

function sign64(digest, scalar) {
  kCounter += 1n;
  return signRawDigest(sha256(digest), scalar, kCounter, P256).raw;
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

function keyHashOf(alg, key) {
  const preimage = new Uint8Array(1 + key.length);
  preimage[0] = alg;
  preimage.set(key, 1);
  return sha256(preimage);
}

const sellerHash = keyHashOf(1, sellerKey);

function controlDigest(addr, key, expiry, contract = CONTRACT) {
  return typedDigest(CHAIN, contract, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)', [
    padAddress(addr),
    padUint(1n),
    keccak256(key),
    padUint(expiry),
  ]);
}

function controlSig(addr, scalar, key, expiry = EXPIRY, contract = CONTRACT) {
  return sign(controlDigest(addr, key, expiry, contract), scalar, SECP256K1);
}

function register(bytes, addr, scalar, key, block, extra = {}) {
  const decoded = decodeHistory(bytes);
  const expiry = extra.expiry === undefined ? EXPIRY : extra.expiry;
  const contract = extra.contract || CONTRACT;
  const alg = extra.alg || 1;
  const sig = extra.sig || controlSig(addr, scalar, key, expiry, contract);
  const digest = typedDigest(extra.chain || CHAIN, contract, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)', [
    padAddress(addr), padUint(BigInt(alg)), keccak256(key), padUint(expiry),
  ]);
  return {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: extra.fromBlock === undefined ? null : extra.fromBlock,
    id: extra.id || freshId(),
    type: REC_REGISTER,
    sig,
    keySig: extra.keySig === undefined ? sign64(digest, extra.keyScalar || (bytesToHex(key) === bytesToHex(otherSeller) ? 13n : sellerScalar)) : extra.keySig,
    alg,
    key,
    expiry,
    cross: extra.cross || null,
  };
}

function keyRevokeSig(keyHash, contract = CONTRACT, scalar = sellerScalar) {
  const digest = typedDigest(CHAIN, contract, 'RevokeByKey(bytes32 keyHash)', [keyHash]);
  return sign64(digest, scalar);
}

function payToRevokeSig(addr, scalar, keyHash, contract = CONTRACT) {
  const digest = typedDigest(CHAIN, contract, 'Revoke(address payTo,bytes32 keyHash)', [
    padAddress(addr),
    keyHash,
  ]);
  return sign(digest, scalar, SECP256K1);
}

function revoke(bytes, keyHash, block, sig, by = 'key', key = sellerKey) {
  const decoded = decodeHistory(bytes);
  const record = {
    seq: BigInt(decoded.records.length),
    block,
    fromBlock: null,
    id: freshId(),
    type: REC_REVOKE,
    sig,
    keyHash,
    by,
  };
  if (by === 'key') {
    record.alg = 1;
    record.key = key;
  }
  return record;
}

function walletSig(typeString, fields, scalar) {
  return sign(typedDigest(CHAIN, CONTRACT, typeString, fields), scalar, SECP256K1);
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
  const first = seal(bytes, join);
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
  const second = seal(first.bytes, leave);
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

test('rule 2 keeps payTo intervals disjoint and a wallet at one book unless STOP', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const open = seal(bytes, register(bytes, payTo, payToScalar, sellerKey, 10n));
  assert.equal(open.ok, true, open.reason);
  const overlap = register(open.bytes, payTo, payToScalar, otherSeller, 15n);
  assert.equal(seal(open.bytes, overlap).reason, 'rule_2');
  const stillOpen = register(open.bytes, payTo, payToScalar, otherSeller, 11n);
  assert.equal(seal(open.bytes, stillOpen).reason, 'rule_2');

  const closedSig = payToRevokeSig(payTo, payToScalar, sellerHash);
  const closed = seal(open.bytes, revoke(open.bytes, sellerHash, 20n, closedSig, 'payTo'));
  assert.equal(closed.ok, true, closed.reason);
  const sameInstant = revoke(open.bytes, sellerHash, 10n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo');
  assert.equal(seal(open.bytes, sameInstant).reason, 'rule_2');
  const next = seal(closed.bytes, register(closed.bytes, payTo, payToScalar, otherSeller, 20n));
  assert.equal(next.ok, true, next.reason);
  const sameKey = register(closed.bytes, payTo, payToScalar, sellerKey, 25n);
  assert.equal(seal(closed.bytes, sameKey).reason, 'rule_2');
  const sameBlock = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, otherSeller, 10n);
  sameBlock.seq = 1n;
  const overlapped = encodeHistory({
    kind: KIND_PAYTO,
    chainId: CHAIN,
    id: payTo,
    records: [decodeHistory(open.bytes).records[0], sameBlock],
  });
  const overlappedView = viewOf(overlapped.bytes);
  assert.equal(overlappedView.killed, false);
  assert.equal(overlappedView.faults[0].rule, 'rule_2');
  assert.equal(overlappedView.keys.length, 1);

  const proved = status(next.bytes, { paymentBlock: 20n, sellerKey: otherSeller, transferTo: payTo });
  assert.equal(proved.ok, true);
  const atStart = status(open.bytes, { paymentBlock: 10n, sellerKey, transferTo: payTo });
  assert.equal(atStart.ok, true);
  const before = status(open.bytes, { paymentBlock: 9n, sellerKey, transferTo: payTo });
  assert.equal(before.status, 'key status unproven');
  assert.equal(before.status, KEY_STATUS_UNPROVEN);
  const atEnd = status(closed.bytes, { paymentBlock: 20n, sellerKey, transferTo: payTo });
  assert.equal(atEnd.status, KEY_STATUS_UNPROVEN);
  const justBeforeEnd = status(closed.bytes, { paymentBlock: 19n, sellerKey, transferTo: payTo });
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
  walletBytes = seal(walletBytes, join).bytes;
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
  assert.equal(seal(walletBytes, second).reason, 'rule_2');
  assert.equal(seal(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, { ...join, sig: new Uint8Array(65) }).reason, 'rule_4');
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
  const afterStop = seal(walletBytes, stopped);
  assert.equal(afterStop.ok, true, afterStop.reason);
  const view = viewOf(afterStop.bytes);
  assert.equal(view.stopped, true);
  assert.equal(view.active, null);
  assert.equal(view.killed, false);
  const resume = seal(afterStop.bytes, {
    seq: 2n,
    block: 5n,
    fromBlock: null,
    id: freshId(),
    type: REC_LEAVE,
    sig: walletSig('WalletLeave(address wallet,uint64 block)', [padAddress(wallet), padUint(5n)], walletScalar),
  });
  assert.equal(resume.ok, true, resume.reason);
  assert.equal(viewOf(resume.bytes).stopped, false);
});

test('rule 3 and rule 4: the covering key is signed, and a bad signature is unproven', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = seal(bytes, register(bytes, payTo, payToScalar, sellerKey, 8n)).bytes;
  const wrongTo = status(bytes, { paymentBlock: 8n, sellerKey, transferTo: otherPayTo });
  assert.equal(wrongTo.status, KEY_STATUS_UNPROVEN);
  const wrongKey = status(bytes, { paymentBlock: 8n, sellerKey: otherSeller, transferTo: payTo });
  assert.equal(wrongKey.status, KEY_STATUS_UNPROVEN);

  const zeros = new Uint8Array(65);
  assert.equal(seal(bytes, register(bytes, payTo, payToScalar, otherSeller, 40n, { sig: zeros })).reason, 'rule_4');

  const low = controlSig(payTo, payToScalar, otherSeller);
  const highS = bytesToBig(low.subarray(32, 64));
  const flipped = concat([
    low.subarray(0, 32),
    bigToBytes(SECP256K1.order - highS, 32),
    Uint8Array.of(low[64] ^ 1),
  ]);
  assert.equal(seal(bytes, register(bytes, payTo, payToScalar, otherSeller, 40n, { sig: flipped })).reason, 'rule_4');

  const low27 = controlSig(otherPayTo, otherScalar, otherSeller);
  const parity27 = new Uint8Array(low27);
  parity27[64] = low27[64] + 27;
  const emptyOther = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  const as27 = seal(emptyOther, register(emptyOther, otherPayTo, otherScalar, otherSeller, 2n, { sig: parity27 }));
  assert.equal(as27.reason, 'rule_4');

  assert.equal(seal(bytes, revoke(bytes, sellerHash, 12n, keyRevokeSig(sellerHash), 'key')).reason, 'rule_4');
  const byKey = admitKeyRevoke(CHAIN, revoke(bytes, sellerHash, 12n, keyRevokeSig(sellerHash), 'key'), { epochs: [EPOCH] });
  assert.equal(byKey.ok, true, byKey.reason);
  assert.equal(admitKeyRevoke(CHAIN, revoke(bytes, sellerHash, 14n, keyRevokeSig(sellerHash), 'key'), {
    epochs: [EPOCH], keySlot: byKey.keySlot,
  }).reason, 'rule_2');

  let fresh = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  fresh = seal(fresh, register(fresh, payTo, payToScalar, sellerKey, 1n)).bytes;
  const paySig = payToRevokeSig(payTo, payToScalar, sellerHash);
  const byPay = seal(fresh, revoke(fresh, sellerHash, 4n, paySig, 'payTo'));
  assert.equal(byPay.ok, true, byPay.reason);
  const foreign = payToRevokeSig(otherPayTo, otherScalar, sellerHash);
  assert.equal(seal(fresh, revoke(fresh, sellerHash, 4n, foreign, 'payTo')).reason, 'rule_4');
});

test('rule 5 detects equivocation between two roots and accepts a real extension', () => {
  let base = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  base = seal(base, register(base, payTo, payToScalar, sellerKey, 7n)).bytes;
  const extended = seal(base, revoke(base, sellerHash, 18n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo'));
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

  const grown = anchor(extended.bytes, 3);
  const ok = detectEquivocation(left, grown);
  assert.equal(ok.equivocation, false);

  const same = anchor(base, 4);
  assert.equal(detectEquivocation(left, same).equivocation, false);
  assert.notEqual(bytesToHex(left.root), bytesToHex(same.root));
});

test('a key may sit in two payTo slots when its holder signed both', () => {
  let first = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  first = seal(first, register(first, payTo, payToScalar, sellerKey, 5n)).bytes;
  const second = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  const both = seal(second, register(second, otherPayTo, otherScalar, sellerKey, 6n));
  assert.equal(both.ok, true, both.reason);
  const missing = register(second, otherPayTo, otherScalar, sellerKey, 6n, { keySig: new Uint8Array(64) });
  assert.equal(seal(second, missing).reason, 'rule_4');
  const tomb = admitKeyRevoke(CHAIN, revoke(first, sellerHash, 22n, keyRevokeSig(sellerHash), 'key'), { epochs: [EPOCH] });
  assert.equal(tomb.ok, true, tomb.reason);
  assert.equal(status(first, {
    paymentBlock: 22n, sellerKey, transferTo: payTo, ctx: { keySlot: tomb.keySlot },
  }).status, KEY_STATUS_UNPROVEN);
  assert.equal(status(both.bytes, {
    paymentBlock: 10n, sellerKey, transferTo: otherPayTo, ctx: { keySlot: tomb.keySlot },
  }).ok, true);
  assert.equal(seal(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, register(
    emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, sellerKey, 30n,
  ), { keySlot: tomb.keySlot }).reason, 'rule_2');
});

test('a breaching record is ignored and does not kill the slot', () => {
  const good = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, sellerKey, 10n);
  const bad = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, otherSeller, 11n, {
    sig: new Uint8Array(65),
  });
  bad.seq = 1n;
  const end = revoke(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, sellerHash, 30n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo');
  end.seq = 2n;
  const encoded = encodeHistory({
    kind: KIND_PAYTO,
    chainId: CHAIN,
    id: payTo,
    records: [good, bad, end],
  });
  const view = viewOf(encoded.bytes);
  assert.equal(view.ok, true);
  assert.equal(view.killed, false);
  assert.equal(view.count, 3);
  assert.deepEqual(view.faults.map((item) => item.line), [faultLine('1')]);
  assert.equal(view.faults[0].rule, 'rule_4');
  assert.equal(view.keys.length, 1);
  assert.equal(view.keys[0].revokedAt, 30n);
  assert.equal(status(encoded.bytes, { paymentBlock: 10n, sellerKey, transferTo: payTo }).ok, true);
  assert.equal(status(encoded.bytes, { paymentBlock: 30n, sellerKey, transferTo: payTo }).status, KEY_STATUS_UNPROVEN);
  assert.equal(status(encoded.bytes, { paymentBlock: 11n, sellerKey: otherSeller, transferTo: payTo }).status, KEY_STATUS_UNPROVEN);

  const clean = seal(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, good);
  assert.equal(seal(clean.bytes, { ...bad, seq: 1n }).reason, 'rule_4');
});

test('a clean payTo entry is 196 bytes, 228 with the slot key, and a revoked key adds 252', () => {
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = seal(bytes, register(bytes, payTo, payToScalar, sellerKey, 9n)).bytes;
  const entry = payToEntryBytes(bytes, { epochs: [EPOCH] });
  assert.equal(entry.bytes.length, 196);
  assert.equal(entry.bytes[9 + 34], 0);
  assert.equal(entry.bytes[9 + 41], Number(EXPIRY));
  const key = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo });
  assert.equal(entry.bytes.length + key.bytes.length, 228);
  bytes = seal(bytes, revoke(bytes, sellerHash, 15n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo')).bytes;
  bytes = seal(bytes, register(bytes, payTo, payToScalar, otherSeller, 15n)).bytes;
  const withRevoked = payToEntryBytes(bytes, { epochs: [EPOCH] });
  assert.equal(withRevoked.bytes.length - 196, 252);
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
  bytes = seal(bytes, register(bytes, payTo, payToScalar, sellerKey, 4n)).bytes;
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
  assert.equal(measured.max, 480);
  assert.equal(doc.cited.observed_tail_bytes, 544);
  assert.equal(doc.cited.verifier_cap, false);
  const wide = new Uint8Array(544);
  for (let depth = 0; depth < 16; depth += 1) {
    wide[Math.floor(depth / 8)] += Math.floor(128 / (2 ** (depth % 8)));
  }
  assert.equal(verifyProof(hexToBytes(measured.samples[0].key), hexToBytes(measured.samples[0].value), wide, hexToBytes(measured.root)).reason, 'bad_proof');
  assert.equal(doc.slot_keys.payTo_0x11, SPEC_KEYS.payTo);
  assert.equal(doc.slot_keys.epoch, SPEC_KEYS.epoch);
  const onDisk = readFileSync(VECTOR_PATH, 'utf8');
  assert.equal(onDisk, `${JSON.stringify(doc, null, 2)}\n`);
});

test('a book creation is signed by the identity key and a second one is ignored', () => {
  const bookId = new Uint8Array(32).fill(0x22);
  const digest = typedDigest(CHAIN, CONTRACT, 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)', [
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
  const admitted = seal(emptyHistory(KIND_BOOK, CHAIN, bookId).bytes, good);
  assert.equal(admitted.ok, true, admitted.reason);
  assert.equal(bytesToHex(viewOf(admitted.bytes).book), bytesToHex(identityKey));
  const unsigned = { ...good, seq: 1n, block: 2n, id: freshId(), sig: new Uint8Array(65) };
  assert.equal(seal(admitted.bytes, unsigned).reason, 'rule_4');
  const second = {
    ...good,
    seq: 1n,
    block: 2n,
    id: freshId(),
    sig: sign(typedDigest(CHAIN, CONTRACT, 'BookCreate(bytes32 bookId,bytes32 identityKeyHash,uint64 block)', [
      bookId, sha256(identityKey), padUint(2n),
    ]), identityScalar, P256),
  };
  assert.equal(seal(admitted.bytes, second).reason, 'rule_1');
  const anchored = encodeHistory({
    kind: KIND_BOOK,
    chainId: CHAIN,
    id: bookId,
    records: [good, unsigned],
  });
  const view = viewOf(anchored.bytes);
  assert.equal(view.killed, false);
  assert.equal(view.faults[0].line, 'invalid record at seq 1 (Chit fault)');
  assert.equal(bytesToHex(view.book), bytesToHex(identityKey));
});

test('domain version 13 names the admitting contract, and expiry replaces validFrom', () => {
  assert.equal(DOMAIN_TYPE, 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
  assert.equal(DOMAIN_VERSION, '13');
  assert.equal(PAYTO_CONTROL_TYPE, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)');
  assert.equal(REVOKE_TYPE, 'Revoke(address payTo,bytes32 keyHash)');
  assert.equal(REVOKE_BY_KEY_TYPE, 'RevokeByKey(bytes32 keyHash)');
  assert.notEqual(
    bytesToHex(controlDigest(payTo, sellerKey, EXPIRY, CONTRACT)),
    bytesToHex(controlDigest(payTo, sellerKey, EXPIRY, OTHER_CONTRACT)),
  );
  const listed = contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
    { address: OTHER_CONTRACT, fromHour: 3600n, untilHour: null },
  ], 3600n);
  assert.ok(listed instanceof Uint8Array);
  assert.equal(bytesToHex(listed), bytesToHex(OTHER_CONTRACT));
  assert.equal(contractForHour([
    { address: CONTRACT, fromHour: 0n, untilHour: 3600n },
    { address: OTHER_CONTRACT, fromHour: 0n, untilHour: 7200n },
  ], 1n), null);

  const oldStruct = structHash('PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)', [
    padAddress(payTo), padUint(1n), keccak256(sellerKey), padUint(EXPIRY),
  ]);
  const oldDomain = structHash('EIP712Domain(string name,string version,uint256 chainId)', [
    keccak256(ascii('Chit402')), keccak256(ascii('1')), padUint(CHAIN),
  ]);
  const oldSig = sign(keccak256(concat([Uint8Array.of(0x19, 0x01), oldDomain, oldStruct])), payToScalar, SECP256K1);
  const emptyPay = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n, { sig: oldSig })).reason, 'rule_4');
  const successor = [{
    prevAnchorBlock: 0n, showAnchorBlock: 1n << 40n, hourStart: 0n, contract: OTHER_CONTRACT,
  }];
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n), { epochs: successor }).reason, 'rule_4');
  const resigned = register(emptyPay, payTo, payToScalar, sellerKey, 10n, { contract: OTHER_CONTRACT });
  assert.equal(seal(emptyPay, resigned, { epochs: successor }).ok, true);

  const window = [{ prevAnchorBlock: 100n, showAnchorBlock: 200n, hourStart: 3600n, contract: CONTRACT }];
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 100n, { expiry: 3601n }), { epochs: window }).reason, 'rule_1');
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 201n, { expiry: 3601n }), { epochs: window }).reason, 'rule_1');
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 150n, { expiry: 3600n }), { epochs: window }).reason, 'rule_2');
  const inside = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 150n, { expiry: 3601n }), { epochs: window });
  assert.equal(inside.ok, true, inside.reason);
  assert.equal(viewOf(inside.bytes, { epochs: window }).keys[0].validFrom, 150n);
  const overlapEpochs = [
    { prevAnchorBlock: 0n, showAnchorBlock: 500n, hourStart: 0n, contract: CONTRACT },
    { prevAnchorBlock: 0n, showAnchorBlock: 500n, hourStart: 0n, contract: OTHER_CONTRACT },
  ];
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 150n, {
    contract: OTHER_CONTRACT,
    expiry: 1n,
  }), { epochs: overlapEpochs }).reason, 'rule_1');

  const opened = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n)).bytes;
  assert.equal(revokeAcross([opened], {
    key: sellerKey, block: 40n, sig: keyRevokeSig(sellerHash),
  }, { epochs: [EPOCH] }).reason, 'bad_key');
  const dropped = revokeAcross([opened], {
    alg: 1, chainId: CHAIN, key: sellerKey, block: 40n, sig: keyRevokeSig(sellerHash),
  }, { epochs: [EPOCH] });
  assert.equal(dropped.ok, true, dropped.reason);
  assert.equal(decodeHistory(dropped.keySlot).records[0].block, 40n);
  assert.equal(bytesToHex(decodeHistory(dropped.keySlot).records[0].keyHash), bytesToHex(sellerHash));
});

test('equivocation follows epoch order and stays on one slot', () => {
  let base = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  base = seal(base, register(base, payTo, payToScalar, sellerKey, 7n)).bytes;
  const extended = seal(base, revoke(base, sellerHash, 18n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo')).bytes;
  function anchor(historyBytes, seed) {
    let tree = createTree();
    const placed = placeHistory(tree, historyBytes);
    tree = drawEpoch(placed.tree, { chainId: CHAIN, epoch: 0, hourStart: 0, randomness: fill(seed) }).tree;
    return {
      key: placed.slotKey.bytes,
      value: historyBytes,
      proof: prove(tree, placed.slotKey.bytes).proof,
      root: rootBytes(tree),
      epoch: BigInt(seed),
    };
  }
  assert.equal(detectEquivocation(anchor(extended, 1), anchor(base, 2)).equivocation, true);
  assert.equal(detectEquivocation(anchor(base, 3), anchor(extended, 4)).equivocation, false);
  let other = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  other = seal(other, register(other, otherPayTo, otherScalar, otherSeller, 7n)).bytes;
  assert.equal(detectEquivocation(anchor(base, 5), anchor(other, 6)).equivocation, false);
  assert.equal(detectEquivocation(anchor(other, 8), anchor(base, 7)).reason, 'bad_epoch');
  const wrongKey = fill(9);
  const wrongTree = putLeaf(createTree(), wrongKey, base).tree;
  const wrongProof = prove(wrongTree, wrongKey).proof;
  const wrongRoot = rootBytes(wrongTree);
  assert.equal(detectEquivocation({
    key: wrongKey, value: base, proof: wrongProof, root: wrongRoot, epoch: 9n,
  }, {
    key: wrongKey, value: base, proof: wrongProof, root: wrongRoot, epoch: 10n,
  }).reason, 'bad_key');
  const decoyKey = fill(4);
  const decoyTree = putLeaf(createTree(), decoyKey, base).tree;
  assert.equal(detectEquivocation(anchor(extended, 11), {
    key: decoyKey,
    value: base,
    proof: prove(decoyTree, decoyKey).proof,
    root: rootBytes(decoyTree),
    epoch: 12n,
  }).equivocation, false);
});

test('an ignored record does not raise the block floor or claim its id', () => {
  const good = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, sellerKey, 10n);
  const bad = register(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, otherSeller, 1000n, {
    sig: new Uint8Array(65),
  });
  bad.seq = 1n;
  const later = revoke(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, sellerHash, 20n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo');
  later.seq = 2n;
  later.id = bad.id;
  const encoded = encodeHistory({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo, records: [good, bad, later] });
  const view = viewOf(encoded.bytes);
  assert.equal(view.killed, false);
  assert.equal(view.keys[0].revokedAt, 20n);
  assert.equal(view.faults.map((item) => item.seq).join(','), '1');
  assert.equal(status(encoded.bytes, { paymentBlock: 15n, sellerKey, transferTo: payTo }).ok, true);
  assert.equal(status(encoded.bytes, { paymentBlock: 30n, sellerKey, transferTo: payTo }).status, 'key status unproven');
});

test('rule 7 consent names the earlier holder, and the chain is part of key status', () => {
  const victimScalar = 17n;
  const victim = addressOf(victimScalar);
  let held = emptyHistory(KIND_PAYTO, CHAIN, victim).bytes;
  held = seal(held, register(held, victim, victimScalar, sellerKey, 5n)).bytes;
  const stolen = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const wrong = typedDigest(CHAIN, CONTRACT, 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)', (() => {
    const [a, b] = bytesToHex(payTo) <= bytesToHex(otherPayTo) ? [payTo, otherPayTo] : [otherPayTo, payTo];
    return [padAddress(a), padAddress(b), sellerHash];
  })());
  const attack = register(stolen, payTo, payToScalar, sellerKey, 8n, {
    cross: {
      other: otherPayTo,
      selfSig: sign(wrong, payToScalar, SECP256K1),
      otherSig: sign(wrong, otherScalar, SECP256K1),
    },
  });
  assert.equal(seal(stolen, attack, { others: [{ id: victim, bytes: held }] }).ok, true);
  const right = typedDigest(CHAIN, CONTRACT, 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)', (() => {
    const [a, b] = bytesToHex(payTo) <= bytesToHex(victim) ? [payTo, victim] : [victim, payTo];
    return [padAddress(a), padAddress(b), sellerHash];
  })());
  const allowed = register(stolen, payTo, payToScalar, sellerKey, 8n, {
    cross: {
      other: victim,
      selfSig: sign(right, payToScalar, SECP256K1),
      otherSig: sign(right, victimScalar, SECP256K1),
    },
  });
  assert.equal(seal(stolen, allowed, { others: [{ id: victim, bytes: held }] }).ok, true);
  const selfOnly = register(stolen, payTo, payToScalar, sellerKey, 8n, {
    cross: {
      other: victim,
      selfSig: new Uint8Array(65),
      otherSig: sign(right, victimScalar, SECP256K1),
    },
  });
  assert.equal(seal(stolen, selfOnly, { others: [{ id: victim, bytes: held }] }).ok, true);
  const noPop = register(stolen, payTo, payToScalar, sellerKey, 8n, { keySig: new Uint8Array(0) });
  assert.equal(seal(stolen, noPop, { others: [{ id: victim, bytes: held }] }).reason, 'rule_4');

  let first = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  first = seal(first, register(first, payTo, payToScalar, otherSeller, 4n)).bytes;
  const cd = typedDigest(CHAIN, CONTRACT, 'CrossPayTo(address payTo,address otherPayTo,bytes32 keyHash)', (() => {
    const hash = keyHashOf(1, otherSeller);
    const [a, b] = bytesToHex(payTo) <= bytesToHex(otherPayTo) ? [payTo, otherPayTo] : [otherPayTo, payTo];
    return [padAddress(a), padAddress(b), hash];
  })());
  const later = seal(emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes, register(emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes, otherPayTo, otherScalar, otherSeller, 9n, {
    cross: {
      other: payTo,
      selfSig: sign(cd, otherScalar, SECP256K1),
      otherSig: sign(cd, payToScalar, SECP256K1),
    },
  }), { others: [{ id: payTo, bytes: first }] }).bytes;
  assert.equal(status(first, { paymentBlock: 6n, sellerKey: otherSeller, transferTo: payTo }).ok, true);
  assert.equal(status(first, {
    paymentBlock: 6n, sellerKey: otherSeller, transferTo: payTo,
    ctx: { others: [{ id: otherPayTo, bytes: later }] },
  }).ok, true);

  const testnet = 84532n;
  const netSig = sign(typedDigest(testnet, CONTRACT, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)', [
    padAddress(payTo), padUint(1n), keccak256(sellerKey), padUint(EXPIRY),
  ]), payToScalar, SECP256K1);
  let foreign = emptyHistory(KIND_PAYTO, testnet, payTo).bytes;
  foreign = seal(foreign, register(foreign, payTo, payToScalar, sellerKey, 5n, { sig: netSig, chain: testnet })).bytes;
  assert.equal(status(foreign, { chainId: CHAIN, paymentBlock: 6n, sellerKey, transferTo: payTo }).reason, 'bad_history');
  assert.equal(status(foreign, { chainId: testnet, paymentBlock: 6n, sellerKey, transferTo: payTo }).ok, true);
  const baseKey = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo }).bytes;
  const planted = putLeaf(createTree(), baseKey, foreign).tree;
  assert.equal(verifySlot(KIND_PAYTO, CHAIN, payTo, foreign, prove(planted, baseKey).proof, rootBytes(planted)).reason, 'bad_history');
  const netKey = slotKey({ kind: KIND_PAYTO, chainId: testnet, id: payTo }).bytes;
  const netTree = putLeaf(createTree(), netKey, foreign).tree;
  assert.equal(verifySlot(KIND_PAYTO, testnet, payTo, foreign, prove(netTree, netKey).proof, rootBytes(netTree)).ok, true);
});

test('rule boundaries reject the extra mutant cases', () => {
  const emptyPay = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const algDigest = typedDigest(CHAIN, CONTRACT, 'PayToControl(address payTo,uint8 keyAlg,bytes key,uint64 expiry)', [
    padAddress(payTo), padUint(2n), keccak256(otherSeller), padUint(EXPIRY),
  ]);
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, otherSeller, 10n, {
    alg: 2, sig: sign(algDigest, payToScalar, SECP256K1),
  })).reason, 'rule_4');
  assert.equal(seal(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, {
    seq: 0n, block: 4n, fromBlock: null, id: freshId(), type: REC_LEAVE,
    sig: walletSig('WalletLeave(address wallet,uint64 block)', [padAddress(wallet), padUint(4n)], walletScalar),
  }).reason, 'rule_2');
  const stopCommit = sha256(ascii('stop'));
  assert.equal(seal(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, {
    seq: 0n, block: 4n, fromBlock: null, id: freshId(), type: REC_STOP, commitment: stopCommit,
    sig: walletSig('WalletStop(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(wallet), stopCommit, padUint(4n),
    ], walletScalar),
  }).reason, 'rule_2');
  assert.equal(status(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, {
    paymentBlock: 4n, sellerKey, transferTo: wallet,
  }).reason, 'bad_kind');
  assert.equal(seal(emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, register(
    emptyHistory(KIND_WALLET, CHAIN, wallet).bytes, wallet, walletScalar, sellerKey, 6n,
  )).reason, 'rule_4');
  const joinCommit = sha256(ascii('join-pay'));
  assert.equal(seal(emptyPay, {
    seq: 0n, block: 6n, fromBlock: null, id: freshId(), type: REC_JOIN, commitment: joinCommit,
    sig: walletSig('WalletJoin(address wallet,bytes32 bookCommitment,uint64 block)', [
      padAddress(payTo), joinCommit, padUint(6n),
    ], payToScalar),
  }).reason, 'rule_4');

  const opened = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n)).bytes;
  const patchedLen = opened.slice();
  patchedLen[10] = 19;
  assert.equal(decodeHistory(patchedLen).reason, 'bad_kind');
  const capped = emptyPay.slice();
  const countAt = 11 + payTo.length;
  const over = MAX_RECORDS + 1;
  capped[countAt] = Math.floor(over / 16777216) % 256;
  capped[countAt + 1] = Math.floor(over / 65536) % 256;
  capped[countAt + 2] = Math.floor(over / 256) % 256;
  capped[countAt + 3] = over % 256;
  assert.equal(decodeHistory(capped).reason, 'bad_size');
  const lone = encodeHistory({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo,
    records: [revoke(emptyPay, sellerHash, 12n, new Uint8Array(65), 'payTo')],
  });
  assert.equal(lone.bytes[35 + 59 + 32], 1);
  const byByte = lone.bytes.slice();
  byByte[35 + 59 + 32] = 3;
  assert.equal(decodeHistory(byByte).ok, false);
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n, { sig: new Uint8Array(64) })).reason, 'rule_4');
  const longSig = register(emptyPay, payTo, payToScalar, otherSeller, 12n, { sig: new Uint8Array(70) });
  longSig.seq = 1n;
  const mixed = viewOf(encodeHistory({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo,
    records: [decodeHistory(opened).records[0], longSig],
  }).bytes);
  assert.equal(mixed.killed, false);
  assert.equal(mixed.keys.length, 1);
  assert.equal(verifyProof(fill(1), fill(2), new Uint8Array(32), rootBytes(createTree()).subarray(0, 31)).reason, 'bad_length');
  assert.equal(drawEpoch(drawEpoch(createTree(), {
    chainId: CHAIN, epoch: 0, hourStart: 0, randomness: fill(1),
  }).tree, { chainId: 84532n, epoch: 1, hourStart: 3600, randomness: fill(2) }).reason, 'bad_epoch');
});

test('keyHash is SHA-256(keyAlg || compressed key), and a RevokeByKey tombstone is permanent', () => {
  assert.equal(bytesToHex(sellerKeyHash(1, sellerKey)), bytesToHex(sellerHash));
  assert.notEqual(bytesToHex(sellerHash), bytesToHex(sha256(sellerKey)));
  assert.equal(sellerKeyHash(2, compress(publicPoint(3n, SECP256K1))), null);
  assert.equal(sellerKeyHash(0, sellerKey), null);
  assert.equal(sellerKeyHash(undefined, sellerKey), null);
  assert.equal(sellerKeyHash(1, sellerKey.subarray(0, 32)), null);
  const uncompressed = publicPoint(sellerScalar, SECP256K1);
  assert.equal(uncompressed.length, 65);
  assert.equal(sellerKeyHash(1, uncompressed), null);
  const badPrefix = new Uint8Array(sellerKey);
  badPrefix[0] = 0x04;
  assert.equal(sellerKeyHash(1, badPrefix), null);

  const emptyPay = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const emptyOther = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, badPrefix, 10n)).reason, 'rule_4');
  assert.equal(seal(emptyPay, register(emptyPay, payTo, payToScalar, uncompressed, 10n)).reason, 'bad_history');

  let slotA = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n)).bytes;
  const byPay = seal(slotA, revoke(slotA, sellerHash, 20n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo'));
  assert.equal(byPay.ok, true, byPay.reason);
  const afterPay = seal(emptyOther, register(emptyOther, otherPayTo, otherScalar, sellerKey, 30n));
  assert.equal(afterPay.ok, true, afterPay.reason);

  slotA = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n)).bytes;
  const byKey = admitKeyRevoke(CHAIN, revoke(slotA, sellerHash, 20n, keyRevokeSig(sellerHash), 'key'), { epochs: [EPOCH] });
  assert.equal(byKey.ok, true, byKey.reason);
  const replay = seal(emptyOther, register(emptyOther, otherPayTo, otherScalar, sellerKey, 30n), {
    keySlot: byKey.keySlot,
  });
  assert.equal(replay.reason, 'rule_2');
  assert.equal(seal(byPay.bytes, register(byPay.bytes, payTo, payToScalar, sellerKey, 30n)).reason, 'rule_2');
  const lineage = [
    { prevAnchorBlock: 0n, showAnchorBlock: 100n, hourStart: 0n, contract: CONTRACT },
    { prevAnchorBlock: 100n, showAnchorBlock: 1n << 40n, hourStart: 3600n, contract: OTHER_CONTRACT },
  ];
  const moved = register(emptyOther, otherPayTo, otherScalar, sellerKey, 150n, {
    contract: OTHER_CONTRACT, expiry: 3601n,
  });
  assert.equal(seal(emptyOther, moved, { epochs: lineage, keySlot: byKey.keySlot }).reason, 'rule_2');
  assert.equal(seal(emptyOther, moved, {
    epochs: lineage,
    tombstones: [formatKeyHash(sellerHash)],
  }).reason, 'bad_history');
  assert.equal(status(slotA, {
    paymentBlock: 15n, sellerKey, transferTo: payTo, ctx: { keySlot: byKey.keySlot },
  }).ok, true);
  assert.equal(status(slotA, {
    paymentBlock: 20n, sellerKey, transferTo: payTo, ctx: { keySlot: byKey.keySlot },
  }).status, KEY_STATUS_UNPROVEN);

  const carried = seal(emptyPay, register(emptyPay, payTo, payToScalar, sellerKey, 10n), {
    tombstones: [sellerHash],
  });
  assert.equal(carried.reason, 'bad_history');
  const carriedBytes = seal(emptyPay, register(emptyPay, payTo, payToScalar, otherSeller, 10n), {
    tombstones: [{ keyHash: sellerHash, revokedAtBlock: 0n }],
  });
  assert.equal(carriedBytes.reason, 'bad_history');

  const mismatch = revoke(slotA, sha256(sellerKey), 20n, keyRevokeSig(sha256(sellerKey)), 'key');
  assert.equal(seal(slotA, mismatch).reason, 'rule_4');
  const wrongKey = revoke(slotA, sellerHash, 20n, keyRevokeSig(sellerHash, CONTRACT, 13n), 'key', otherSeller);
  assert.equal(seal(slotA, wrongKey).reason, 'rule_4');
  const forged = revoke(slotA, sellerHash, 20n, keyRevokeSig(sellerHash, CONTRACT, 13n), 'key', sellerKey);
  assert.equal(seal(slotA, forged).reason, 'rule_4');
  const anchored = encodeHistory({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo,
    records: [decodeHistory(slotA).records[0], mismatch],
  });
  const viewed = viewOf(anchored.bytes);
  assert.equal(viewed.keys[0].revokedAt, 0n);
});

test('rev 5.1: expiry, slot revoke scope, empty previous epoch, and the PoP vector', () => {
  const popKey = hexToBytes('0268739255d9bc5e2b747847d240b349248c6bd1d91dd63ef3c0c2ef7fba5fb8d3');
  const popHash = hexToBytes('70703a0707c1ba660d772d3b613966bf84599afa8059b29636a613fefbfa9390');
  const digest = new Uint8Array(32).fill(0x44);
  const sig = hexToBytes('2e238cb3c5b55330c113777a6695d5f94e5e4c3f2298dcdd397eb503c5c5c88938f10d7bce3aa35340558528143104c1f9c02ccba0be6026133ad4d15d7dc038');
  assert.equal(bytesToHex(sellerKeyHash(1, popKey)), bytesToHex(popHash));
  assert.equal(verifySellerSig(digest, sig, popKey), true);
  const high = new Uint8Array(sig);
  const n = SECP256K1.order;
  const s = bytesToBig(sig.subarray(32));
  high.set(bigToBytes((P256.order) - s, 32), 32);
  assert.equal(verifySellerSig(digest, high, popKey), false);
  assert.equal(n > 0n, true);

  const wide = [{ prevAnchorBlock: 0n, showAnchorBlock: 1n << 40n, hourStart: 0n, contract: CONTRACT }];
  let bytes = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  bytes = seal(bytes, register(bytes, payTo, payToScalar, sellerKey, 10n), { epochs: wide }).bytes;
  bytes = seal(bytes, revoke(bytes, sellerHash, 20n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo'), { epochs: wide }).bytes;
  bytes = seal(bytes, register(bytes, payTo, payToScalar, otherSeller, 20n), { epochs: wide }).bytes;
  assert.equal(status(bytes, { paymentBlock: 25n, sellerKey, transferTo: payTo, ctx: { epochs: wide } }).status, KEY_STATUS_UNPROVEN);
  assert.equal(status(bytes, { paymentBlock: 25n, sellerKey: otherSeller, transferTo: payTo, ctx: { epochs: wide } }).ok, true);
  assert.equal(status(bytes, {
    paymentBlock: 25n, hourStart: EXPIRY, sellerKey: otherSeller, transferTo: payTo, ctx: { epochs: wide },
  }).status, KEY_STATUS_UNPROVEN);

  const opened = seal(emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, register(
    emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes, payTo, payToScalar, sellerKey, 10n,
  )).bytes;
  const slot = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo }).bytes;
  const prev = createTree();
  const cur = putLeaf(createTree(), slot, opened).tree;
  assert.equal(verifyAdmission({
    kind: KIND_PAYTO,
    chainId: CHAIN,
    id: payTo,
    value: opened,
    proof: prove(cur, slot).proof,
    root: rootBytes(cur),
    prevValue: null,
    prevProof: prove(prev, slot).proof,
    prevRoot: rootBytes(prev),
    block: 10n,
    prevAnchor: 0n,
    showAnchor: 1n << 40n,
    seq: 0n,
  }).ok, true);

  const encoded = encodeHistory(decodeHistory(opened));
  const sigAt = encoded.bytes.length - 2 - 64 - 2 - 65;
  assert.equal(encoded.bytes[sigAt], 0);
  assert.equal(encoded.bytes[sigAt + 1], 65);
  const swapped = encoded.bytes.slice();
  swapped[sigAt] = 65;
  swapped[sigAt + 1] = 0;
  assert.equal(decodeHistory(swapped).ok, false);

  const keySlot = keySlotKey(CHAIN, new Uint8Array(32).fill(0x33));
  assert.equal(keySlot.ok, true, keySlot.reason);
  assert.equal(keySlot.hex, 'e791917a7c2f11b2f7d6db4b211822aa63593fd8a7e3b0abdfee3ec180e62613');
  assert.equal(KIND_KEY, 0x05);
  const many = readKeyLeaf({
    records: [
      {
        revokedAtBlock: 20n,
        prevAnchorBlock: 0n,
        showAnchorBlock: 100n,
        signatureOk: true,
        keyHashOk: true,
        decodeOk: true,
        admission: {
          absentAtPrev: true,
          memberAtEpoch: true,
          anchorPrev: 0n,
          anchorEpoch: 100n,
          block: 20n,
        },
      },
      {
        revokedAtBlock: 30n,
        prevAnchorBlock: 0n,
        showAnchorBlock: 100n,
        signatureOk: true,
        keyHashOk: true,
        decodeOk: true,
        admission: {
          absentAtPrev: true,
          memberAtEpoch: true,
          anchorPrev: 0n,
          anchorEpoch: 100n,
          block: 30n,
        },
      },
    ],
  });
  assert.equal(many.ok, false);
  assert.equal(many.reason, 'many_records');
});

test('F-rule7-other and a rollback are decided by proof of possession', () => {
  let held = emptyHistory(KIND_PAYTO, CHAIN, otherPayTo).bytes;
  held = seal(held, register(held, otherPayTo, otherScalar, sellerKey, 5n)).bytes;
  const stolen = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const withPossession = seal(stolen, register(stolen, payTo, payToScalar, sellerKey, 6n), {
    others: [{ id: otherPayTo, bytes: held }],
  });
  assert.equal(withPossession.ok, true, withPossession.reason);
  const without = register(stolen, payTo, payToScalar, sellerKey, 6n, { keySig: new Uint8Array(64) });
  assert.equal(seal(stolen, without).reason, 'rule_4');

  let base = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  base = seal(base, register(base, payTo, payToScalar, sellerKey, 5n)).bytes;
  const extended = seal(base, revoke(base, sellerHash, 9n, payToRevokeSig(payTo, payToScalar, sellerHash), 'payTo')).bytes;
  function anchor(historyBytes, epoch) {
    let tree = createTree();
    const placed = placeHistory(tree, historyBytes);
    tree = drawEpoch(placed.tree, { chainId: CHAIN, epoch: 0, hourStart: 0, randomness: fill(epoch) }).tree;
    return {
      key: placed.slotKey.bytes,
      value: historyBytes,
      proof: prove(tree, placed.slotKey.bytes).proof,
      root: rootBytes(tree),
      epoch: BigInt(epoch),
    };
  }
  assert.equal(detectEquivocation(anchor(extended, 1), anchor(base, 2)).equivocation, true);
  assert.equal(detectEquivocation(anchor(base, 1), anchor(extended, 2)).equivocation, false);
});

test('PR684-Q1 keyStatus with no SMT proof and no root is not proven', () => {
  const b0 = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const registered = seal(b0, register(b0, payTo, payToScalar, sellerKey, 10n));
  assert.equal(registered.ok, true, registered.reason);
  const got = keyStatus(registered.bytes, {
    chainId: CHAIN, hourStart: 0n, paymentBlock: 20n, sellerKey, transferTo: payTo, ctx: { epochs: [EPOCH] },
  });
  assert.notEqual(got.ok, true);
  assert.equal(got.status, KEY_STATUS_UNPROVEN);
  assert.equal(got.exitCode, 2);
});

test('PR684-Q2 keyStatus with a root that does not contain the slot is not proven', () => {
  const b0 = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const registered = seal(b0, register(b0, payTo, payToScalar, sellerKey, 10n));
  const other = putLeaf(createTree(), fill(0x99), fill(0x98)).tree;
  const got = keyStatus(registered.bytes, {
    chainId: CHAIN,
    hourStart: 0n,
    paymentBlock: 20n,
    sellerKey,
    transferTo: payTo,
    root: rootBytes(other),
    ctx: { epochs: [EPOCH] },
  });
  assert.notEqual(got.ok, true);
  assert.equal(got.exitCode, 2);
});

test('the previous-epoch proof, membership block, and absence are checked', () => {
  const b0 = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const registered = seal(b0, register(b0, payTo, payToScalar, sellerKey, 10n)).bytes;
  const slot = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo }).bytes;
  const tree = putLeaf(createTree(), slot, registered).tree;
  const proof = prove(tree, slot).proof;
  const root = rootBytes(tree);
  const prev = createTree();
  const prevProof = prove(prev, slot).proof;
  const broken = new Uint8Array(prevProof);
  broken[0] ^= 0x80;
  assert.equal(verifyAdmission({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo, value: registered, proof, root,
    prevValue: null, prevProof: broken, prevRoot: rootBytes(prev),
    block: 10n, prevAnchor: 0n, showAnchor: 1n << 40n, seq: 0n,
  }).ok, false);
  assert.equal(verifyAdmission({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo, value: registered, proof, root,
    prevValue: null, prevProof, prevRoot: rootBytes(prev),
    block: 11n, prevAnchor: 0n, showAnchor: 1n << 40n, seq: 0n,
  }).ok, false);
  assert.equal(verifyAdmission({
    kind: KIND_PAYTO, chainId: CHAIN, id: payTo, value: registered, proof, root,
    prevValue: registered, prevProof: proof, prevRoot: root,
    block: 10n, prevAnchor: 0n, showAnchor: 1n << 40n, seq: 0n,
  }).ok, false);
});

test('a key slot with two records or a mismatched id is refused', () => {
  const first = revoke(emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes, sellerHash, 12n, keyRevokeSig(sellerHash), 'key');
  const second = revoke(emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes, sellerHash, 14n, keyRevokeSig(sellerHash), 'key');
  second.seq = 1n;
  const two = encodeHistory({ kind: KIND_KEY, chainId: CHAIN, id: sellerHash, records: [first, second] });
  assert.equal(two.ok, true, two.reason);
  assert.equal(decodeKeySlot(two.bytes).ok, false);
  const mismatched = encodeHistory({
    kind: KIND_KEY, chainId: CHAIN, id: sha256(sellerHash), records: [first],
  });
  assert.equal(decodeKeySlot(mismatched.bytes).ok, false);
});

test('an unsigned RevokeByKey is refused', () => {
  const bad = admitKeyRevoke(CHAIN, revoke(
    emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes, sellerHash, 12n, new Uint8Array(64), 'key',
  ), { epochs: [EPOCH] });
  assert.equal(bad.ok, false);
  const crafted = encodeHistory({
    kind: KIND_KEY,
    chainId: CHAIN,
    id: sellerHash,
    records: [revoke(emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes, sellerHash, 12n, new Uint8Array(64), 'key')],
  });
  const again = admitKeyRevoke(CHAIN, revoke(
    emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes, sellerHash, 14n, keyRevokeSig(sellerHash), 'key',
  ), { epochs: [EPOCH], keySlot: crafted.bytes });
  assert.equal(again.reason, 'bad_history');
});

test('CrossPayTo sorts the two payTo addresses', () => {
  const left = crossDigest(CHAIN, CONTRACT, payTo, otherPayTo, sellerHash);
  const right = crossDigest(CHAIN, CONTRACT, otherPayTo, payTo, sellerHash);
  assert.equal(bytesToHex(left), bytesToHex(right));
});

test('the showing anchor is inside the epoch window', () => {
  const window = [{ prevAnchorBlock: 100n, showAnchorBlock: 200n, hourStart: 3600n, contract: CONTRACT }];
  const b0 = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const atShow = seal(b0, register(b0, payTo, payToScalar, sellerKey, 200n, { expiry: 3601n }), { epochs: window });
  assert.equal(atShow.ok, true, atShow.reason);
});

test('more than 255 payTo keys is refused', () => {
  const records = [];
  let cursor = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  for (let i = 0; i < 256; i += 1) {
    const scalar = 1000n + BigInt(i);
    const key = compress(publicPoint(scalar, P256));
    const opened = BigInt(i * 2 + 1);
    const rec = register(cursor, payTo, payToScalar, key, opened, { keyScalar: scalar });
    records.push(rec);
    cursor = encodeHistory({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo, records }).bytes;
    if (i < 255) {
      const hash = sellerKeyHash(1, key);
      const closed = revoke(cursor, hash, opened + 1n, payToRevokeSig(payTo, payToScalar, hash), 'payTo');
      records.push(closed);
      cursor = encodeHistory({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo, records }).bytes;
    }
  }
  const table = payToEntryBytes(cursor, { epochs: [EPOCH] });
  assert.equal(table.reason, 'bad_size');
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
  assert.equal(verifyProof(files.get('payto-slot.bytes'), files.get('payto-value.bytes'), files.get('payto-member.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('key-slot.bytes'), files.get('key-value.bytes'), files.get('key-member.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('blank-key-slot.bytes'), null, files.get('blank-key.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('absent-payto-slot.bytes'), null, files.get('absent-payto.proof'), root).ok, true);
  assert.equal(verifyProof(files.get('key-slot.bytes'), null, files.get('blank-key.proof'), root).ok, false);
});

test('an unsigned carried tombstone is not a leaf the builder can use', () => {
  const b0 = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const carried = seal(b0, register(b0, payTo, payToScalar, sellerKey, 10n), {
    tombstones: [{
      keyHash: sellerHash,
      revokedAtBlock: 20n,
      prevAnchorBlock: 0n,
      showAnchorBlock: 100n,
    }],
  });
  assert.equal(carried.reason, 'bad_history');
});

test('a second RevokeByKey in the same key history is refused', () => {
  const base = emptyHistory(KIND_KEY, CHAIN, sellerHash).bytes;
  const first = revoke(base, sellerHash, 12n, keyRevokeSig(sellerHash), 'key');
  const mid = encodeHistory({ kind: KIND_KEY, chainId: CHAIN, id: sellerHash, records: [first] }).bytes;
  const second = revoke(mid, sellerHash, 14n, keyRevokeSig(sellerHash), 'key');
  const both = encodeHistory({ kind: KIND_KEY, chainId: CHAIN, id: sellerHash, records: [first, second] });
  const view = assess(both.bytes, { epochs: [EPOCH] });
  assert.equal(view.ok, true);
  assert.equal(view.faults.some((item) => item.rule === 'rule_2'), true);
});

test('a foreign slot revoke stays in the status input', () => {
  const text = readFileSync(new URL('./history.mjs', import.meta.url), 'utf8');
  assert.equal(text.includes('const chosen = key.revokedAt !== 0n ? key : foreign;'), true);
});

test('source scan rejects literal booleans passed into shared-module checks', () => {
  const text = readFileSync(new URL('./history.mjs', import.meta.url), 'utf8');
  const names = ['checkAdmission', 'checkTombstone', 'readKeyLeaf', 'sharedKeyStatus'];
  const consts = new Map();
  for (const match of text.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(true|false)\b/g)) {
    consts.set(match[1], match[2]);
  }
  for (const name of names) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(`${name}(`, from);
      if (at < 0) break;
      const start = text.indexOf('(', at);
      let depth = 0;
      let end = start;
      for (; end < text.length; end += 1) {
        const ch = text[end];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = text.slice(start, end + 1);
      assert.equal(/\b(true|false)\b/.test(body), false, name);
      for (const [id, value] of consts) {
        assert.equal(new RegExp(`\\b${id}\\b`).test(body), false, `${name} folds ${id} = ${value}`);
      }
      from = end + 1;
    }
  }
});
