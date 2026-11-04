/**
 * KEYHASH rev 5 checks that live in this module. Keys here are test keys only.
 * T1–T16 from the sign-off, limited to what this module decides.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { P256 } from '../ecdsa/curves.js';
import { bigToBytes, bytesToBig, bytesToHex, hexToBytes } from '../ecdsa/bytes.js';
import { publicPoint, signRawDigest } from '../ecdsa/sign.js';
import { slotKey } from '../line/index.mjs';
import {
  KIND_CHANNEL,
  KIND_KEY,
  canonicalKey,
  checkSigma,
  formatKeyHash,
  keyHash,
  parseKeyHash,
  possessionPreimage,
  verifyPossession,
} from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pop = JSON.parse(readFileSync(join(here, 'vectors/pop.json'), 'utf8'));
const key = hexToBytes(pop.key);
const digest = hexToBytes(pop.d);
const sig = hexToBytes(pop.signature);

function assertKeyHashRejected(text) {
  assert.throws(() => {
    if (parseKeyHash(text) == null) {
      const err = new Error('bad_key_hash');
      err.code = 'bad_key_hash';
      throw err;
    }
  }, (err) => err.code === 'bad_key_hash');
}

test('T4 possession vector verifies and the high-S form does not', () => {
  assert.equal(bytesToHex(possessionPreimage(digest)), pop.ecdsa_input);
  assert.equal(keyHash(1, key).hex, pop.key_hash);
  assert.equal(canonicalKey(1, key).ok, true);
  const point = canonicalKey(1, key).uncompressed;
  assert.equal(verifyPossession(digest, point, sig).ok, true);
  const high = new Uint8Array(sig);
  high.set(bigToBytes(P256.order - bytesToBig(sig.subarray(32)), 32), 32);
  assert.equal(verifyPossession(digest, point, high).reason, 'bad_sigma');
  assert.equal(checkSigma(high).ok, false);
});

test('T1 a possession signature with a bad range or the wrong key is refused', () => {
  const point = canonicalKey(1, key).uncompressed;
  assert.equal(checkSigma(sig.subarray(0, 63)).ok, false);
  const zero = new Uint8Array(64);
  assert.equal(checkSigma(zero).reason, 'bad_sigma');
  const wide = new Uint8Array(64);
  wide.set(bigToBytes(P256.order, 32));
  wide.set(bigToBytes(1n, 32), 32);
  assert.equal(checkSigma(wide).reason, 'bad_sigma');
  const other = canonicalKey(1, (() => {
    const pub = publicPoint(3n, P256);
    const out = new Uint8Array(33);
    out[0] = (pub[64] & 1) ? 3 : 2;
    out.set(pub.subarray(1, 33), 1);
    return out;
  })()).uncompressed;
  assert.equal(verifyPossession(digest, other, sig).ok, false);
});

test('T3 a sigma-sized blob is not a possession of a different preimage', () => {
  const message = possessionPreimage(digest);
  const signed = signRawDigest(message, BigInt(`0x${pop.scalar}`), 9n, P256);
  assert.equal(verifyPossession(new Uint8Array(32).fill(1), canonicalKey(1, key).uncompressed, signed.raw).ok, false);
});

test('T11 keyHash text is not normalized', () => {
  const text = formatKeyHash(hexToBytes(pop.key_hash));
  assert.equal(text, `0x${pop.key_hash}`);
  for (const bad of [pop.key_hash, text.toUpperCase(), `0x${pop.key_hash}00`, `0x${pop.key_hash.slice(1)}`, `0X${pop.key_hash}`]) {
    assertKeyHashRejected(bad);
  }
});

test('T12 the registry refuses the reserved algs and a bad point', () => {
  const off = new Uint8Array(33);
  off[0] = 2;
  off[32] = 1;
  assert.equal(keyHash(0, key).reason, 'bad_alg');
  assert.equal(keyHash(2, key).reason, 'bad_alg');
  assert.equal(keyHash(3, key).reason, 'bad_alg');
  assert.equal(keyHash(undefined, key).reason, 'bad_alg');
  assert.equal(keyHash(1, off).reason, 'bad_key');
  assert.equal(keyHash(1, new Uint8Array(65)).reason, 'bad_length');
  const over = new Uint8Array(33);
  over[0] = 2;
  over.set(bigToBytes(P256.p, 32), 1);
  assert.equal(canonicalKey(1, over).reason, 'bad_key');
  const short = new Uint8Array(32);
  short[0] = 0x02;
  assert.equal(canonicalKey(1, short).reason, 'bad_length');
});

test('T13 the 0x05 slot key matches the literal and 0x06 stays reserved', () => {
  const id = hexToBytes('33'.repeat(32));
  assert.equal(slotKey({ kind: KIND_KEY, chainId: 8453, id }).hex, pop.slot_key_33);
  assert.equal(slotKey({ kind: KIND_CHANNEL, chainId: 8453, id }).reason, 'bad_kind');
  assert.equal(slotKey({ kind: 0x05, chainId: 8453, id: id.subarray(1) }).reason, 'bad_id_length');
  assert.equal(slotKey({ kind: 0xff, chainId: 8453, id }).reason, 'bad_kind');
});
