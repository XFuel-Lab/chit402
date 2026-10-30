/**
 * Curve-parameterized ECDSA, y-parity, and the SIMPLE §S6 Q14 dry-run vector.
 * No network. Node is the signature oracle for hashed messages. The Q14 raw
 * transaction is pinned to an ethers cross-check done when the vector was frozen.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBig, bytesToHex, hexToBytes } from './bytes.js';
import {
  P256,
  SECP256K1,
  checkpointDomainHex,
  derToRaw,
  eip1559Decode,
  eip1559Digest,
  eip1559Serialize,
  ethereumAddress,
  highSDer,
  keccak256,
  lowS,
  normalizeDer,
  pointMultiply,
  publicPoint,
  recoverPublicKey,
  signRawDigest,
  yParityByTrial,
} from './index.js';
import { rlpBytes, rlpDecode, rlpInt, rlpList } from './rlp.js';

const P256_N = 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551';
const K1_N = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./vectors/${name}`, import.meta.url), 'utf8'));
}

function derInt(bytes) {
  let v = Buffer.from(bytes);
  if (v.length === 0) v = Buffer.from([0]);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
  return Buffer.concat([Buffer.from([0x02, v.length]), v]);
}

function derSeq(r, s) {
  const body = Buffer.concat([derInt(r), derInt(s)]);
  if (body.length >= 128) return Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function sig64(s, rByte = 1) {
  const out = new Uint8Array(64);
  out[31] = rByte;
  out.set(hexToBytes(s.toString(16).padStart(64, '0')), 32);
  return out;
}

function b64(bi) {
  return Buffer.from(bi.toString(16).padStart(64, '0'), 'hex').toString('base64url');
}

test('keccak256 matches the empty and abc digests', () => {
  assert.equal(bytesToHex(keccak256(new Uint8Array())), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(bytesToHex(keccak256(new TextEncoder().encode('abc'))), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
});

test('private key 1 on secp256k1 is the generator and the known address', () => {
  const pub = publicPoint(1n, SECP256K1);
  assert.equal(bytesToBig(pub.subarray(1, 33)), SECP256K1.G.x);
  assert.equal(bytesToBig(pub.subarray(33)), SECP256K1.G.y);
  assert.equal(ethereumAddress(pub), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
});

test('RLP matches the ethereum wiki strings and the integer 0', () => {
  assert.equal(bytesToHex(rlpBytes(new TextEncoder().encode('dog'))), '83646f67');
  assert.equal(bytesToHex(rlpList([
    rlpBytes(new TextEncoder().encode('cat')),
    rlpBytes(new TextEncoder().encode('dog')),
  ])), 'c88363617483646f67');
  assert.equal(bytesToHex(rlpBytes(new Uint8Array())), '80');
  assert.equal(bytesToHex(rlpList([])), 'c0');
  assert.equal(bytesToHex(rlpInt(0)), '80');
  assert.equal(bytesToHex(rlpInt(15)), '0f');
  assert.equal(bytesToHex(rlpInt(1024)), '820400');
  assert.equal(bytesToHex(rlpDecode(hexToBytes('83646f67'))), bytesToHex(new TextEncoder().encode('dog')));
});

test('DS-65 domain for 0x33…33 on chain 8453 is the illustrative digest', () => {
  const contract = `0x${'33'.repeat(20)}`;
  assert.equal(checkpointDomainHex(8453, contract), '1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0');
  assert.notEqual(checkpointDomainHex(84532, contract), checkpointDomainHex(8453, contract));
});

test('strict DER rejects the same malformed shapes on both curves', () => {
  for (const curve of [SECP256K1, P256]) {
    const rejects = (der) => assert.throws(() => derToRaw(der, curve), (err) => err.code === 'der_invalid');
    rejects(Buffer.alloc(0));
    rejects(Buffer.from([0x30, 0x00]));
    rejects(Buffer.from([0x31, 0x00]));
    rejects(Buffer.from([0x30, 0x80, 0x00, 0x00]));
    rejects(Buffer.from([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
    const good = derSeq(Buffer.from([1]), Buffer.from([2]));
    rejects(Buffer.concat([good, Buffer.from([0x00])]));
    const inside = Buffer.concat([good, Buffer.from([0x00])]);
    inside[1] = good[1] + 1;
    rejects(inside);
    rejects(Buffer.from([0x30, 0x06, 0x02, 0x01, 0x81, 0x02, 0x01, 0x01]));
    rejects(derSeq(Buffer.from([0]), Buffer.from([1])));
    rejects(derSeq(Buffer.from([1]), Buffer.from([0])));
    rejects(Buffer.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]));
    rejects(Buffer.from([0x30, 0x05, 0x02, 0x00, 0x02, 0x01, 0x01]));
    const wide = Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.alloc(32, 0x11)]);
    rejects(derSeq(wide, Buffer.from([1])));
  }
});

test('the secp256k1 path never uses the P-256 order', () => {
  assert.equal(SECP256K1.order.toString(16), K1_N);
  assert.equal(P256.order.toString(16), P256_N);
  assert.notEqual(SECP256K1.order, P256.order);
  const derSrc = readFileSync(new URL('./der.js', import.meta.url), 'utf8').toLowerCase();
  const recoverSrc = readFileSync(new URL('./recover.js', import.meta.url), 'utf8').toLowerCase();
  assert.equal(derSrc.includes(P256_N), false);
  assert.equal(recoverSrc.includes(P256_N), false);

  const half = SECP256K1.order >> 1n;
  assert.ok(half > (P256.order >> 1n));
  assert.ok(half < P256.order);
  const boundary = sig64(half);
  assert.equal(bytesToBig(lowS(boundary, SECP256K1).subarray(32)), half);
  assert.equal(bytesToBig(lowS(boundary, P256).subarray(32)), P256.order - half);
  assert.notEqual(P256.order - half, half);

  const above = (SECP256K1.order >> 1n) + 1n;
  assert.equal(bytesToBig(lowS(sig64(above), SECP256K1).subarray(32)), SECP256K1.order - above);

  const pastP256 = SECP256K1.order - 2n;
  assert.ok(pastP256 >= P256.order);
  assert.equal(bytesToBig(lowS(sig64(pastP256), SECP256K1).subarray(32)), 2n);
  assert.throws(() => lowS(sig64(pastP256), P256), (err) => err.code === 'der_invalid');
  const pastDer = derSeq(Buffer.from([2]), hexToBytes(pastP256.toString(16)));
  assert.equal(bytesToBig(derToRaw(pastDer, SECP256K1).subarray(32)), pastP256);
  assert.throws(() => derToRaw(pastDer, P256), (err) => err.code === 'der_invalid');
});

test('low-S leaves s == order/2 and flips s == order/2 + 1 on both curves', () => {
  for (const curve of [SECP256K1, P256]) {
    const half = curve.order >> 1n;
    assert.equal(bytesToBig(lowS(sig64(half), curve).subarray(32)), half);
    assert.equal(bytesToBig(lowS(sig64(half + 1n), curve).subarray(32)), curve.order - (half + 1n));
    assert.equal(bytesToBig(lowS(sig64(1n), curve).subarray(32)), 1n);
    assert.throws(() => lowS(sig64(0n), curve), (err) => err.code === 'der_invalid');
    assert.throws(() => lowS(sig64(curve.order), curve), (err) => err.code === 'der_invalid');
    assert.throws(() => derToRaw(derSeq(Buffer.from([1]), hexToBytes(curve.order.toString(16))), curve), (err) => err.code === 'der_invalid');
    assert.throws(() => lowS(new Uint8Array(63), curve), (err) => err.code === 'der_invalid');
  }
});

test('low-S and y-parity vectors for both curves', () => {
  const doc = load('low-s-parity.json');
  assert.equal(doc.signatures.length, 2);
  for (const row of doc.signatures) {
    const curve = row.curve === 'secp256k1' ? SECP256K1 : P256;
    const digest = hexToBytes(row.digest);
    const pub = hexToBytes(row.public_key);
    const der = hexToBytes(row.kms_der_high_s);
    const raw = normalizeDer(der, curve);
    assert.equal(bytesToHex(raw), row.low_s);
    const s = bytesToBig(raw.subarray(32));
    assert.ok(s <= (curve.order >> 1n));
    const highS = curve.order - s;
    assert.ok(highS > (curve.order >> 1n));
    assert.equal(bytesToBig(derToRaw(der, curve).subarray(32)), highS);
    assert.equal(yParityByTrial(digest, raw, pub, curve), row.y_parity);
    const other = row.y_parity === 0 ? 1 : 0;
    const wrong = recoverPublicKey(digest, raw.subarray(0, 32), raw.subarray(32), other, curve);
    assert.ok(!wrong || !Buffer.from(wrong).equals(Buffer.from(pub)));
    if (curve === SECP256K1 && highS < P256.order) {
      assert.notEqual(P256.order - highS, s);
    }
  }
});

test('a raw digest signature verifies in Node and the trial parity matches', () => {
  for (const [curve, crv] of [[SECP256K1, 'secp256k1'], [P256, 'P-256']]) {
    const msg = Buffer.from(`raw-digest-${curve.name}`);
    const digest = createHash('sha256').update(msg).digest();
    const d = 9n;
    const sig = signRawDigest(digest, d, 13n, curve);
    const pub = publicPoint(d, curve);
    assert.equal(yParityByTrial(digest, sig.raw, pub, curve), sig.yParity);
    const jwk = {
      kty: 'EC',
      crv,
      x: Buffer.from(pub.subarray(1, 33)).toString('base64url'),
      y: Buffer.from(pub.subarray(33)).toString('base64url'),
    };
    const key = createPrivateKey({ key: { ...jwk, d: b64(d) }, format: 'jwk' });
    assert.equal(verify('sha256', msg, { key, dsaEncoding: 'der' }, sig.der), true);
    const high = highSDer(sig.raw, curve);
    assert.equal(bytesToHex(normalizeDer(high, curve)), bytesToHex(sig.raw));
    assert.equal(verify('sha256', msg, { key, dsaEncoding: 'der' }, high), true);
  }
});

test('Node-generated signatures on both curves recover to that Node public key', () => {
  for (const [curve, named] of [[SECP256K1, 'secp256k1'], [P256, 'prime256v1']]) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: named });
    const jwk = publicKey.export({ format: 'jwk' });
    const pub = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    const msg = Buffer.from(`node-${curve.name}`);
    const der = sign(null, msg, { key: privateKey, dsaEncoding: 'der' });
    const digest = createHash('sha256').update(msg).digest();
    const raw = normalizeDer(der, curve);
    const bit = yParityByTrial(digest, raw, pub, curve);
    assert.ok(bit === 0 || bit === 1);
    assert.equal(bytesToBig(raw.subarray(32)) <= (curve.order >> 1n), true);
    const other = publicPoint(4n, curve);
    assert.throws(() => yParityByTrial(digest, raw, other, curve), (err) => err.code === 'y_parity_unmatched');
  }
});

test('2G is the point Node binds to scalar 2', () => {
  const Q = pointMultiply(SECP256K1.G, 2n, SECP256K1);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'secp256k1', d: b64(2n), x: b64(Q.x), y: b64(Q.y) },
    format: 'jwk',
  });
  assert.equal(key.asymmetricKeyType, 'ec');
  assert.equal(pointMultiply(P256.G, 1n, P256).x, P256.G.x);
});

test('SIMPLE §S6 Q14 dry-run vector: high-S DER, secp256k1 low-S, y-parity, EIP-1559', () => {
  const q = load('q14-dry-run.json');
  assert.equal(q.illustrative_domain_chain_8453, '1ec6130d39d03ed3b8bce8139d615ffe17377a1cf2cab8f4b7bf98f45dda27b0');
  assert.equal(checkpointDomainHex(q.chainId, q.contract), q.domain);
  assert.equal(q.hourStart % 3600, 0);
  const tx = {
    chainId: q.chainId,
    nonce: q.nonce,
    maxPriorityFeePerGas: BigInt(q.fees.maxPriorityFeePerGas),
    maxFeePerGas: BigInt(q.fees.maxFeePerGas),
    gasLimit: BigInt(q.fees.gasLimit),
    to: q.contract,
    value: 0n,
    data: hexToBytes(q.calldata),
  };
  assert.equal(bytesToHex(eip1559Digest(tx)), q.digest);
  const rawSig = normalizeDer(hexToBytes(q.kms_der_high_s), SECP256K1);
  assert.equal(bytesToHex(rawSig), q.low_s);
  const s = bytesToBig(rawSig.subarray(32));
  const highS = SECP256K1.order - s;
  assert.ok(highS > (SECP256K1.order >> 1n));
  assert.ok(highS > (P256.order >> 1n) && highS < P256.order);
  assert.notEqual(P256.order - highS, s);
  assert.equal(bytesToBig(lowS(sig64(highS), P256).subarray(32)), P256.order - highS);
  assert.equal(bytesToBig(lowS(sig64(highS), SECP256K1).subarray(32)), s);
  const parity = yParityByTrial(hexToBytes(q.digest), rawSig, hexToBytes(q.public_key), SECP256K1);
  assert.equal(parity, q.y_parity);
  const raw = eip1559Serialize(tx, { yParity: parity, r: rawSig.subarray(0, 32), s: rawSig.subarray(32) });
  assert.equal(`0x${bytesToHex(raw)}`, q.raw);
  const decoded = eip1559Decode(raw);
  assert.equal(decoded.data, q.calldata);
  assert.equal(decoded.to, q.contract.slice(2));
  assert.equal(decoded.chainId, BigInt(q.chainId));
  assert.equal(decoded.yParity, q.y_parity);
  assert.equal(decoded.s, q.low_s.slice(64));
  assert.equal(ethereumAddress(hexToBytes(q.public_key)), q.address);
  assert.throws(() => eip1559Digest({ ...tx, value: 1n }), (err) => err.code === 'bad_tx');
});

test('a nonzero checkpoint value is refused', () => {
  assert.throws(() => eip1559Serialize({
    chainId: 84532n,
    nonce: 0n,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    gasLimit: 21000n,
    to: `0x${'11'.repeat(20)}`,
    value: 1n,
    data: new Uint8Array(),
  }, { yParity: 0, r: new Uint8Array(32).fill(1), s: new Uint8Array(32).fill(1) }), (err) => err.code === 'bad_tx');
});
