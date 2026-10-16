/**
 * Strict DER to 64-byte JOSE, and low-S. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { derToJose, lowS, P256_ORDER, P256_HALF_ORDER } from '../src/ecdsa-der.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

function derInt(bytes) {
  let v = Buffer.from(bytes);
  if (v.length === 0) v = Buffer.from([0]);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
  const body = Buffer.concat([Buffer.from([0x02, v.length]), v]);
  return body;
}

function derSeq(r, s) {
  const body = Buffer.concat([derInt(r), derInt(s)]);
  if (body.length >= 128) {
    return Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body]);
  }
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function josePair(sig64) {
  return [sig64.subarray(0, 32), sig64.subarray(32)];
}

test('a node DER signature round-trips to ieee-p1363 and verifies', () => {
  const msg = Buffer.from('ecdsa-der-roundtrip');
  const der = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'der' });
  const jose = lowS(derToJose(der));
  assert.equal(jose.length, 64);
  const s = BigInt(`0x${jose.subarray(32).toString('hex')}`);
  assert.ok(s <= P256_HALF_ORDER);
  assert.equal(crypto.verify('sha256', msg, { key: publicKey, dsaEncoding: 'ieee-p1363' }, jose), true);
});

test('a leading 0x00 sign byte and a short integer pad to 32 bytes', () => {
  const r = Buffer.alloc(32, 0);
  r[0] = 0x80;
  r[31] = 0x11;
  const s = Buffer.from([0x02]);
  const jose = derToJose(derSeq(r, s));
  assert.equal(jose.length, 64);
  assert.equal(jose[0], 0x80);
  assert.equal(jose[31], 0x11);
  assert.equal(jose[63], 0x02);
  assert.equal(jose.subarray(32, 63).every((b) => b === 0), true);
});

test('high S normalises to n - s and stays under n/2', () => {
  const r = Buffer.alloc(32, 1);
  const high = (P256_ORDER - 3n).toString(16).padStart(64, '0');
  const s = Buffer.from(high, 'hex');
  const jose = lowS(derToJose(derSeq(r, s)));
  const got = BigInt(`0x${jose.subarray(32).toString('hex')}`);
  assert.equal(got, 3n);
  assert.ok(got <= P256_HALF_ORDER);
  const [, sBytes] = josePair(jose);
  assert.equal(sBytes[31], 3);
});

test('low S is left unchanged', () => {
  const sig = Buffer.alloc(64, 0);
  sig[31] = 4;
  sig[63] = 9;
  const out = lowS(sig);
  assert.equal(out.equals(sig), true);
  assert.notEqual(out, sig);
});

function rejects(der) {
  assert.throws(() => derToJose(der), (err) => err.code === 'der_invalid');
}

test('wycheproof-style DER is rejected', () => {
  rejects(Buffer.alloc(0));
  rejects(Buffer.from([0x30, 0x00]));
  rejects(Buffer.from([0x31, 0x00]));
  // Indefinite length.
  rejects(Buffer.from([0x30, 0x80, 0x00, 0x00]));
  // Long form of a short length.
  rejects(Buffer.from([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
  // Leading zero in the length bytes.
  const paddedLen = Buffer.concat([
    Buffer.from([0x30, 0x82, 0x00]),
    derSeq(Buffer.from([1]), Buffer.from([1])).subarray(1),
  ]);
  rejects(paddedLen);
  // Trailing byte.
  const good = derSeq(Buffer.from([1]), Buffer.from([2]));
  rejects(Buffer.concat([good, Buffer.from([0x00])]));
  // Negative integer.
  rejects(Buffer.from([0x30, 0x06, 0x02, 0x01, 0x81, 0x02, 0x01, 0x01]));
  // r = 0 and s = 0.
  rejects(derSeq(Buffer.from([0]), Buffer.from([1])));
  rejects(derSeq(Buffer.from([1]), Buffer.from([0])));
  // r >= n.
  const n = Buffer.from(P256_ORDER.toString(16), 'hex');
  rejects(derSeq(n, Buffer.from([1])));
  // More than 32 bytes after stripping the sign byte.
  const wide = Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.alloc(32, 0x11)]);
  rejects(derSeq(wide, Buffer.from([1])));
  // Non-minimal integer (extra 0x00 when the next byte is not negative).
  rejects(Buffer.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]));
  // Empty integer.
  rejects(Buffer.from([0x30, 0x05, 0x02, 0x00, 0x02, 0x01, 0x01]));
});

test('a 64-byte signature with s >= n is rejected by lowS', () => {
  const sig = Buffer.alloc(64, 0xff);
  assert.throws(() => lowS(sig), (err) => err.code === 'der_invalid');
});
