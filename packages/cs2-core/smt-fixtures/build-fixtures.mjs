/**
 * Deterministic depth-256 compressed proofs for the state SMT.
 * Run from the repo root: node packages/cs2-core/smt-fixtures/build-fixtures.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex } from '../ecdsa/bytes.js';
import { P256, SECP256K1 } from '../ecdsa/curves.js';
import { publicPoint, signRawDigest } from '../ecdsa/sign.js';
import { ethereumAddress } from '../ecdsa/address.js';
import { hexToBytes } from '../ecdsa/bytes.js';
import { keccak256 } from '../ecdsa/keccak.js';
import { bigToBytes, concat } from '../ecdsa/bytes.js';
import { KIND_KEY, KIND_PAYTO, keySlotKey } from '../eip712/kinds.mjs';
import { slotKey } from '../line/index.mjs';
import {
  admitKeyRevoke,
  createTree,
  emptyHistory,
  keyStatus,
  payToControlDigest,
  prove,
  putLeaf,
  revokeByKeyDigest,
  rootBytes,
  sellerKeyHash,
} from '../smt/index.mjs';
import { REC_REGISTER, REC_REVOKE, admit } from '../smt/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAIN = 8453n;
const CONTRACT = new Uint8Array(20).fill(0x33);
const EPOCH = {
  prevAnchorBlock: 0n,
  showAnchorBlock: 1n << 40n,
  hourStart: 0n,
  contract: CONTRACT,
};
const EXPIRY = 100n;

function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
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

function compress(point) {
  const y = BigInt('0x' + bytesToHex(point.subarray(33)));
  const out = new Uint8Array(33);
  out[0] = (y & 1n) === 1n ? 0x03 : 0x02;
  out.set(point.subarray(1, 33), 1);
  return out;
}

let kCounter = 1n;
function sign65(digest, scalar, curve) {
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

function addressOf(scalar) {
  return hexToBytes(ethereumAddress(publicPoint(scalar, SECP256K1)).slice(2));
}

export function renderFixtures() {
  const payToScalar = 3n;
  const sellerScalar = 7n;
  const absentScalar = 9n;
  const payTo = addressOf(payToScalar);
  const sellerKey = compress(publicPoint(sellerScalar, P256));
  const sellerHash = sellerKeyHash(1, sellerKey);
  const absentKey = compress(publicPoint(absentScalar, P256));
  const absentHash = sellerKeyHash(1, absentKey);
  const absentPayTo = addressOf(11n);

  const control = payToControlDigest(CHAIN, CONTRACT, payTo, 1, sellerKey, EXPIRY);
  const empty = emptyHistory(KIND_PAYTO, CHAIN, payTo).bytes;
  const registered = admit(empty, {
    seq: 0n,
    block: 10n,
    fromBlock: null,
    id: sha256(ascii('fixture-register')),
    type: REC_REGISTER,
    sig: sign65(control, payToScalar, SECP256K1),
    keySig: sign64(control, sellerScalar),
    alg: 1,
    key: sellerKey,
    expiry: EXPIRY,
  }, { epochs: [EPOCH] });
  if (!registered.ok) throw new Error(registered.reason);
  const keySig = sign64(revokeByKeyDigest(CHAIN, CONTRACT, sellerHash), sellerScalar);
  const revoked = admitKeyRevoke(CHAIN, {
    seq: 0n,
    block: 30n,
    fromBlock: null,
    id: sha256(ascii('fixture-revoke')),
    type: REC_REVOKE,
    sig: keySig,
    keyHash: sellerHash,
    by: 'key',
    alg: 1,
    key: sellerKey,
  }, { epochs: [EPOCH] });
  if (!revoked.ok) throw new Error(revoked.reason);

  const paySlot = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: payTo });
  const absentPaySlot = slotKey({ kind: KIND_PAYTO, chainId: CHAIN, id: absentPayTo });
  const keySlot = keySlotKey(CHAIN, sellerHash);
  const blankKeySlot = keySlotKey(CHAIN, absentHash);
  if (!paySlot.ok || !absentPaySlot.ok || !keySlot.ok || !blankKeySlot.ok) throw new Error('slot');

  let tree = createTree();
  tree = putLeaf(tree, paySlot.bytes, registered.bytes).tree;
  tree = putLeaf(tree, keySlot.bytes, revoked.keySlot).tree;
  const root = rootBytes(tree);
  const payProof = prove(tree, paySlot.bytes);
  const keyProof = prove(tree, keySlot.bytes);
  const blankProof = prove(tree, blankKeySlot.bytes);
  const absentPayProof = prove(tree, absentPaySlot.bytes);
  if (!payProof.present || !keyProof.present || blankProof.present || absentPayProof.present) {
    throw new Error('proof presence');
  }
  const status = keyStatus(registered.bytes, {
    chainId: CHAIN,
    hourStart: 0n,
    paymentBlock: 20n,
    sellerKey,
    transferTo: payTo,
    ctx: { epochs: [EPOCH] },
    root,
    payToProof: payProof.proof,
    keyProof: keyProof.proof,
    keyValue: revoked.keySlot,
    prevRoot: rootBytes(createTree()),
    prevPayToProof: prove(createTree(), paySlot.bytes).proof,
    prevPayToValue: null,
    prevKeyProof: prove(createTree(), keySlot.bytes).proof,
    prevKeyValue: null,
  });
  if (!status.ok) throw new Error(`fixture status ${status.reason}`);

  const files = {
    'root.bytes': root,
    'payto-slot.bytes': paySlot.bytes,
    'payto-value.bytes': registered.bytes,
    'payto-member.proof': payProof.proof,
    'absent-payto-slot.bytes': absentPaySlot.bytes,
    'absent-payto.proof': absentPayProof.proof,
    'key-slot.bytes': keySlot.bytes,
    'key-value.bytes': revoked.keySlot,
    'key-member.proof': keyProof.proof,
    'blank-key-slot.bytes': blankKeySlot.bytes,
    'blank-key.proof': blankProof.proof,
  };
  return { files, meta: { chainId: CHAIN.toString(), paymentProven: status.status } };
}

function sums(files) {
  return Object.keys(files).sort().map((name) => {
    const digest = createHash('sha256').update(files[name]).digest('hex');
    return `${digest}  ${name}`;
  }).join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files } = renderFixtures();
  mkdirSync(HERE, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(HERE, name), bytes);
  writeFileSync(join(HERE, 'SHA256SUMS'), sums(files));
}
