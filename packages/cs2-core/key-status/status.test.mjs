/**
 * Key-status decisions. These tests sit outside the frozen eip712 module.
 * Keys here are test keys only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hexToBytes } from '../ecdsa/bytes.js';
import { KIND_KEY } from '../eip712/kinds.mjs';
import { keyHash } from '../eip712/key-hash.mjs';
import { slotKey } from '../line/index.mjs';
import {
  EXIT_UNPROVEN,
  KEY_STATUS_ACTIVE,
  KEY_STATUS_INVALID,
  KEY_STATUS_REVOKED,
  checkAdmission,
  deriveKeySlotKey,
  keyStatus,
  readKeyLeaf,
} from './status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pop = JSON.parse(readFileSync(join(here, '../eip712/vectors/pop.json'), 'utf8'));
const key = hexToBytes(pop.key);
const admission = { absentAtPrev: true, memberAtEpoch: true, anchorPrev: 10n, anchorEpoch: 40n, block: 20n };

function view(over = {}) {
  return {
    stateRoot: 'root',
    proofs: { payTo: true, key: true },
    sigmaKey: key,
    chainId: 84532n,
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
  const derived = deriveKeySlotKey({ sigmaKey: key, chainId: 84532n, bundleKey: new Uint8Array(32) });
  assert.equal(derived.exitCode, EXIT_UNPROVEN);
  const self = deriveKeySlotKey({ sigmaKey: key, chainId: 84532n });
  assert.equal(self.hex, slotKey({ kind: KIND_KEY, chainId: 84532n, id: keyHash(1, key).bytes }).hex);
});
