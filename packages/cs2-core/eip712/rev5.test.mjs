/**
 * KEYHASH rev 5 checks that live in this module. Keys here are test keys only.
 * T1–T16 from the sign-off, limited to what this module decides.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import {
  EXIT_UNPROVEN,
  KEY_STATUS_ACTIVE,
  KEY_STATUS_INVALID,
  KEY_STATUS_REVOKED,
  checkAdmission,
  deriveKeySlotKey,
  keyStatus,
  readKeyLeaf,
} from '../key-status/status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pop = JSON.parse(readFileSync(join(here, 'vectors/pop.json'), 'utf8'));
const key = hexToBytes(pop.key);
const digest = hexToBytes(pop.d);
const sig = hexToBytes(pop.signature);
const admission = { absentAtPrev: true, memberAtEpoch: true, anchorPrev: 10n, anchorEpoch: 40n, block: 20n };

function assertKeyHashRejected(text) {
  assert.throws(() => {
    if (parseKeyHash(text) == null) {
      const err = new Error('bad_key_hash');
      err.code = 'bad_key_hash';
      throw err;
    }
  }, (err) => err.code === 'bad_key_hash');
}

function view(over = {}) {
  return {
    stateRoot: 'root',
    proofs: { payTo: true, key: true },
    sigmaKey: key,
    chainId: 8453n,
    block: 25n,
    hourStart: 100n,
    registration: {
      admissionBlock: 20n,
      expiry: 1800000000n,
      admission,
    },
    keyLeaf: { empty: true },
    ...over,
  };
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

test('T5 two roots are unproven', () => {
  const got = keyStatus(view({ otherRoot: 'elsewhere' }));
  assert.equal(got.exitCode, EXIT_UNPROVEN);
});

test('T6 an empty leaf is absent and a bad or doubled leaf is unproven', () => {
  assert.equal(readKeyLeaf({ empty: true }).tombstone, null);
  assert.equal(keyStatus(view()).status, KEY_STATUS_ACTIVE);
  assert.equal(readKeyLeaf({ records: [{ decodeOk: false }] }).exitCode, EXIT_UNPROVEN);
  assert.equal(readKeyLeaf({ records: [{ revokedAtBlock: 0n }, { revokedAtBlock: 1n }] }).exitCode, EXIT_UNPROVEN);
  assert.equal(readKeyLeaf(null).exitCode, undefined);
  assert.equal(keyStatus(view({ proofs: { payTo: true } })).exitCode, EXIT_UNPROVEN);
  const bare = keyStatus(view({ keyLeaf: { records: [{ revokedAtBlock: 0n, prevAnchorBlock: 1n, showAnchorBlock: 2n, admission }] } }));
  assert.equal(bare.exitCode, EXIT_UNPROVEN);
});

test('T7 and T8 a registration at or after the tombstone is invalid, and the receipt tie refuses', () => {
  const tomb = 30n;
  const leaf = { records: [{ revokedAtBlock: tomb, prevAnchorBlock: 10n, showAnchorBlock: 40n, admission: { ...admission, block: tomb }, decodeOk: true, signatureOk: true, keyHashOk: true }] };
  const at = keyStatus(view({ registration: { admissionBlock: tomb, expiry: 1800000000n, admission: { ...admission, block: tomb } }, keyLeaf: leaf, block: tomb }));
  assert.equal(at.status, KEY_STATUS_INVALID);
  const after = keyStatus(view({ registration: { admissionBlock: tomb + 1n, expiry: 1800000000n, admission: { ...admission, block: tomb + 1n } }, keyLeaf: leaf }));
  assert.equal(after.status, KEY_STATUS_INVALID);
  const before = keyStatus(view({ block: tomb - 1n, keyLeaf: leaf }));
  assert.equal(before.status, KEY_STATUS_ACTIVE);
  const tied = keyStatus(view({ block: tomb, keyLeaf: leaf }));
  assert.equal(tied.status, KEY_STATUS_REVOKED);
});

test('T9 an admission without the previous epoch is unproven', () => {
  assert.equal(checkAdmission({ memberAtEpoch: true, anchorPrev: 1n, anchorEpoch: 2n, block: 2n }).exitCode, EXIT_UNPROVEN);
  assert.equal(checkAdmission({ ...admission, block: 10n }).exitCode, EXIT_UNPROVEN);
  assert.equal(checkAdmission(admission).ok, true);
});

test('T10 expiry is compared to hourStart, not to the block number', () => {
  const block = 22000000n;
  const expiry = 1800000000n;
  const early = keyStatus(view({ block, hourStart: expiry - 1n, registration: { admissionBlock: 20n, expiry, admission } }));
  assert.equal(early.status, KEY_STATUS_ACTIVE);
  const late = keyStatus(view({ block, hourStart: expiry, registration: { admissionBlock: 20n, expiry, admission } }));
  assert.equal(late.status, KEY_STATUS_INVALID);
  assert.equal(block < expiry, true);
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

test('T14 a carried tombstone keeps its block', () => {
  const record = { revokedAtBlock: 20n, prevAnchorBlock: 10n, showAnchorBlock: 40n, admission };
  const again = { ...record };
  assert.equal(again.revokedAtBlock, 20n);
  assert.equal(readKeyLeaf({ records: [{ ...record, decodeOk: true, signatureOk: true, keyHashOk: true }] }).tombstone, 20n);
});

test('T16 two key-slot records are unproven', () => {
  const one = { revokedAtBlock: 20n, prevAnchorBlock: 10n, showAnchorBlock: 40n, admission, decodeOk: true, signatureOk: true, keyHashOk: true };
  const two = { ...one, revokedAtBlock: 30n, admission: { ...admission, block: 30n } };
  assert.equal(readKeyLeaf({ records: [one, two] }).exitCode, EXIT_UNPROVEN);
});

test('a payTo revoke blocks only its own keyHash, and an empty previous slot can admit', () => {
  const hash = keyHash(1, key).bytes;
  const slotRevoke = { keyHash: hash, revokedAtBlock: 22n };
  const registration = { ...view().registration, keyHash: hash };
  const rebound = keyStatus(view({ slotRevoke, registration, rebinding: true, block: 21n }));
  assert.equal(rebound.status, KEY_STATUS_INVALID);
  assert.equal(rebound.reason, 'slot_rebind');
  const used = keyStatus(view({ slotRevoke, registration, block: 22n }));
  assert.equal(used.status, KEY_STATUS_REVOKED);
  const other = new Uint8Array(hash);
  other[0] ^= 1;
  const untouched = keyStatus(view({ slotRevoke: { keyHash: other, revokedAtBlock: 22n }, registration, block: 22n }));
  assert.equal(untouched.status, KEY_STATUS_ACTIVE);
  const first = { ...admission, absentAtPrev: false, emptyAtPrev: true };
  assert.equal(checkAdmission(first).ok, true);
  const leaf = {
    revokedAtBlock: 22n,
    prevAnchorBlock: 10n,
    showAnchorBlock: 40n,
    admission: { ...admission, block: 22n },
    decodeOk: true,
    signatureOk: true,
    keyHashOk: true,
  };
  const copied = keyStatus(view({ keyLeaf: { records: [{ ...leaf, payToCopy: true }] } }));
  assert.equal(copied.status, KEY_STATUS_ACTIVE);
  const unsigned = keyStatus(view({ keyLeaf: { records: [{ ...leaf, signatureOk: false }] } }));
  assert.equal(unsigned.exitCode, EXIT_UNPROVEN);
  assert.equal(unsigned.reason, 'bad_leaf');
  const late = keyStatus(view({
    block: 25n,
    registration: {
      admissionBlock: 26n,
      expiry: 1800000000n,
      admission: { ...admission, block: 26n },
    },
  }));
  assert.equal(late.status, KEY_STATUS_INVALID);
  assert.equal(late.reason, 'inactive');
  // A block number cannot be negative, so prev < revokedAtBlock is false at 0.
  // Deleting the explicit zero check still returns bare_tombstone. Equivalent.
  const zero = readKeyLeaf({
    records: [{
      ...leaf,
      revokedAtBlock: 0n,
      prevAnchorBlock: 0n,
      admission: { ...admission, block: 0n },
    }],
  });
  assert.equal(zero.reason, 'bare_tombstone');
});

test('the key slot is derived from the sigma key', () => {
  const derived = deriveKeySlotKey({ sigmaKey: key, chainId: 8453n, bundleKey: new Uint8Array(32) });
  assert.equal(derived.exitCode, EXIT_UNPROVEN);
  const self = deriveKeySlotKey({ sigmaKey: key, chainId: 8453n });
  assert.equal(self.hex, slotKey({ kind: KIND_KEY, chainId: 8453n, id: keyHash(1, key).bytes }).hex);
  assert.equal(createHash('sha256').update(digest).digest('hex'), pop.ecdsa_input);
});
