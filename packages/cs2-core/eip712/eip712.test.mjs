/**
 * Shared EIP-712 vectors. Keys here are test keys only.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { keccak256 } from '../ecdsa/keccak.js';
import { bigToBytes, bytesToHex, hexToBytes } from '../ecdsa/bytes.js';
import { P256 } from '../ecdsa/curves.js';
import {
  ALG_REGISTRY,
  DOMAIN_TYPE,
  KEY_ALG_P256,
  KEY_ALG_SECP256K1,
  LAUNCH_ALGS,
  PAYTO_CONTROL_TYPE,
  REVOKE_TYPE,
  REVOKE_BY_KEY_TYPE,
  TIME_UNIT,
  canonicalKey,
  expiryAllows,
  formatKeyHash,
  keyHash,
  parseKeyHash,
  tombstoned,
} from './index.mjs';

const vector = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vectors/eip712.json'), 'utf8'));

function assertKeyHashRejected(text) {
  assert.throws(() => {
    if (parseKeyHash(text) == null) {
      const err = new Error('bad_key_hash');
      err.code = 'bad_key_hash';
      throw err;
    }
  }, (err) => err.code === 'bad_key_hash');
}
const text = new TextEncoder();
const typehash = (value) => bytesToHex(keccak256(text.encode(value)));

test('typehashes, domain separators, registry, keyHash, and the time unit are pinned', () => {
  assert.equal(TIME_UNIT, vector.time_unit);
  assert.equal(DOMAIN_TYPE, vector.domain_type);
  assert.equal(typehash(DOMAIN_TYPE), vector.domain_typehash);
  assert.equal(typehash(PAYTO_CONTROL_TYPE), vector.payto_control_typehash);
  assert.equal(typehash(REVOKE_TYPE), vector.revoke_typehash);
  assert.equal(typehash(REVOKE_BY_KEY_TYPE), vector.revoke_by_key_typehash);
  assert.notEqual(vector.domain_separator_a, vector.domain_separator_b);
  assert.deepEqual(ALG_REGISTRY.map((row) => ({ ...row })), vector.registry);
  assert.deepEqual([...LAUNCH_ALGS], [KEY_ALG_P256]);
  assert.equal(KEY_ALG_P256, 0x01);
  assert.equal(KEY_ALG_SECP256K1, 0x02);
  assert.equal(ALG_REGISTRY.find((row) => row.keyAlg === 0x02).launch, false);
  const key = hexToBytes(vector.key);
  const hashed = keyHash(1, key);
  assert.equal(hashed.hex, vector.key_hash);
  const again = createHash('sha256');
  again.update(Uint8Array.of(1));
  again.update(key);
  assert.equal(again.digest('hex'), vector.key_hash);
  assert.equal(canonicalKey(1, key).ok, true);
  assert.equal(expiryAllows(1800000000n, 1800086400n), vector.expiry_allows_admission);
  assert.equal(expiryAllows(1800036000n, 1800000001n), vector.expiry_allows_later_hour);
  assert.equal(expiryAllows(1800000000n, 1800000000n), false);
  for (const name of ['off_curve', 'long_key', 'alg_00', 'alg_02']) {
    const row = vector.negatives[name];
    assert.equal(keyHash(row.keyAlg, hexToBytes(row.key)).reason, row.reason, name);
    assert.equal(canonicalKey(row.keyAlg, hexToBytes(row.key)).reason, row.reason, name);
  }
  assert.equal(keyHash(undefined, key).reason, vector.negatives.missing_alg.reason);
  assert.equal(canonicalKey(undefined, key).reason, 'bad_alg');
  assert.equal(keyHash(0, key).reason, 'bad_alg');
  assert.equal(keyHash(3, key).reason, 'bad_alg');
  assert.equal(keyHash(1, new Uint8Array(65).fill(4)).ok, false);
  const bad = new Uint8Array(33);
  bad[0] = 0x04;
  assert.equal(keyHash(1, bad).reason, 'bad_length');
  const hashBytes = hexToBytes(vector.key_hash);
  assert.equal(tombstoned([hashBytes], vector.key_hash), true);
  assert.equal(tombstoned([formatKeyHash(hashBytes)], vector.key_hash), true);
  assert.equal(tombstoned([1], vector.key_hash), true);
  assert.equal(formatKeyHash(hashBytes), `0x${vector.key_hash}`);
  assert.equal(parseKeyHash(`0x${vector.key_hash}`) && bytesToHex(parseKeyHash(`0x${vector.key_hash}`)), vector.key_hash);
  for (const bad of [vector.key_hash, `0x${vector.key_hash.toUpperCase()}`, `0x${vector.key_hash.slice(0, 63)}`, `0x${vector.key_hash}00`, `0X${vector.key_hash}`]) {
    assertKeyHashRejected(bad);
  }
});

test('no other package defines a keyAlg table', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const defs = [];
  const shape = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*[\s\S]{0,800}?(?:keyAlg\s*:|[{,\[]\s*(?:0x0)?1\s*:)[\s\S]{0,240}?(?:['"]P-256['"]|\bsecp256k1\b)|(?:export\s+)?(?:const|let|var)\s+ALG_REGISTRY\s*=|new\s+Map\s*\([\s\S]{0,500}?\[\s*(?:0x0)?1\s*,\s*['"]P-256['"]/;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(mjs|js|cjs|ts)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8');
        if (shape.test(text)) defs.push(path.split(/[/\\]/).join('/'));
      }
    }
  };
  walk(root);
  const rootSlash = root.split(/[/\\]/).join('/');
  const allowed = defs.map((path) => path.slice(rootSlash.length)).sort();
  assert.deepEqual(allowed, [
    '/packages/cs2-core/eip712/registry.mjs',
  ]);
});

test('canonicalKey refuses x at or above the field prime and a short key', () => {
  const over = new Uint8Array(33);
  over[0] = 0x02;
  over.set(bigToBytes(P256.p, 32), 1);
  assert.equal(canonicalKey(1, over).reason, 'bad_key');
  const short = new Uint8Array(32);
  short[0] = 0x02;
  short[1] = 1;
  assert.equal(canonicalKey(1, short).reason, 'bad_length');
  const long = new Uint8Array(34);
  long[0] = 0x03;
  assert.equal(canonicalKey(1, long).reason, 'bad_length');
  assert.throws(() => tombstoned([], 'abc'), /bad_key_hash/);
  assert.equal(tombstoned({}, '11'.repeat(32)), true);
  assert.equal(tombstoned([new Uint8Array(31)], '11'.repeat(32)), true);
  assertKeyHashRejected(`0x${'ab'.repeat(32).toUpperCase()}`);
  assertKeyHashRejected(`0X${'ab'.repeat(32)}`);
});
