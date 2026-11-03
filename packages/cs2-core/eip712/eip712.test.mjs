/**
 * Shared EIP-712 vectors. Keys here are test keys only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { keccak256 } from '../ecdsa/keccak.js';
import { bytesToHex, hexToBytes } from '../ecdsa/bytes.js';
import {
  DOMAIN_TYPE,
  PAYTO_CONTROL_TYPE,
  REVOKE_TYPE,
  REVOKE_BY_KEY_TYPE,
  TIME_UNIT,
  expiryAllows,
  keyHash,
} from './index.mjs';

const vector = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vectors/eip712.json'), 'utf8'));
const text = new TextEncoder();
const typehash = (value) => bytesToHex(keccak256(text.encode(value)));

test('typehashes, domain separators, keyHash, and the time unit are pinned', () => {
  assert.equal(TIME_UNIT, vector.time_unit);
  assert.equal(DOMAIN_TYPE, vector.domain_type);
  assert.equal(typehash(DOMAIN_TYPE), vector.domain_typehash);
  assert.equal(typehash(PAYTO_CONTROL_TYPE), vector.payto_control_typehash);
  assert.equal(typehash(REVOKE_TYPE), vector.revoke_typehash);
  assert.equal(typehash(REVOKE_BY_KEY_TYPE), vector.revoke_by_key_typehash);
  assert.notEqual(vector.domain_separator_a, vector.domain_separator_b);
  const hashed = keyHash(1, hexToBytes(vector.key));
  assert.equal(hashed.hex, vector.key_hash);
  const again = createHash('sha256');
  again.update(Uint8Array.of(1));
  again.update(hexToBytes(vector.key));
  assert.equal(again.digest('hex'), vector.key_hash);
  assert.equal(expiryAllows(1800000000n, 1800086400n), vector.expiry_allows_admission);
  assert.equal(expiryAllows(1800036000n, 1800000001n), vector.expiry_allows_later_hour);
  assert.equal(keyHash(1, new Uint8Array(65).fill(4)).ok, false);
  const bad = new Uint8Array(33);
  bad[0] = 0x04;
  assert.equal(keyHash(1, bad).ok, false);
});
