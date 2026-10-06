/**
 * RFC 8785 vectors from cyberphone/json-canonicalization testdata
 * (input/, output/, and the ES6 number file described in testdata/README.md).
 * The first 1,000 number lines are the published prefix whose SHA-256 is
 * be18b62b6f69cdab33a7e0dae0d9cfa869fda80ddc712221570f9f40a5878687.
 * jcsCanonicalize (chit402-jcs-v1) is not this canonicalizer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const { jcsCanonicalize, jcsRfc8785 } = await import('../src/offer-receipt.js');
const { issuerHistoryEntryBody, issuerHistoryEntryHash } = await import('../src/issuer-history.js');

const fixtureDir = fileURLToPath(new URL('./fixtures/rfc8785/', import.meta.url));
const NAMES = ['arrays', 'french', 'structures', 'unicode', 'values', 'weird'];

function read(name) {
  return fs.readFileSync(path.join(fixtureDir, name));
}

test('control vector matches RFC 8785 and not chit402-jcs-v1', () => {
  const vector = { s: '\t\n\u0001\u{1F600}' };
  assert.equal(
    Buffer.from(jcsRfc8785(vector), 'utf8').toString('hex'),
    '7b2273223a225c745c6e5c7530303031f09f9880227d',
  );
  assert.equal(
    Buffer.from(jcsCanonicalize(vector), 'utf8').toString('hex'),
    '7b2273223a225c75303030395c75303030615c7530303031f09f9880227d',
  );
});

test('cyberphone json-canonicalization input files match their output', () => {
  for (const name of NAMES) {
    const input = JSON.parse(read(`input/${name}.json`).toString('utf8'));
    const expected = read(`output/${name}.json`).toString('utf8');
    const got = jcsRfc8785(input);
    assert.equal(got, expected, name);
    assert.equal(Buffer.from(got, 'utf8').equals(Buffer.from(expected, 'utf8')), true, name);
  }
});

test('ES6 number serialization matches the official 1000-line prefix', () => {
  const file = read('es6-first-1000.txt');
  const digest = crypto.createHash('sha256').update(file).digest('hex');
  assert.equal(digest, 'be18b62b6f69cdab33a7e0dae0d9cfa869fda80ddc712221570f9f40a5878687');
  const lines = file.toString('utf8').split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1000);
  const buf = Buffer.alloc(8);
  const samples = {
    '444b1ae4d6e2ef50': '1e+21',
    '3eb0c6f7a0b5ed8d': '0.000001',
    '3eb0c6f7a0b5ed8c': '9.999999999999997e-7',
    '8000000000000000': '0',
    '0': '0',
  };
  for (const line of lines) {
    const comma = line.indexOf(',');
    const hex = line.slice(0, comma);
    const expected = line.slice(comma + 1);
    buf.writeBigUInt64LE(BigInt(`0x${hex.padStart(16, '0')}`));
    const number = buf.readDoubleLE(0);
    assert.equal(jcsRfc8785(number), expected, hex);
    if (samples[hex]) assert.equal(expected, samples[hex], hex);
  }
});

test('entry_hash stays on chit402-jcs-v1 when a string needs escaping', () => {
  const entry = {
    kid: 'k',
    jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'k' },
    alg: 'ES256',
    not_before: '2026-01-01T00:00:00Z',
    not_after: null,
    status: 'retired',
    revoked_at: null,
    reason: 'line\nbreak\t',
    custody: 'env',
    prev_hash: null,
  };
  const body = issuerHistoryEntryBody(entry);
  const legacy = jcsCanonicalize(body);
  const rfc = jcsRfc8785(body);
  assert.notEqual(legacy, rfc);
  assert.match(legacy, /\\u000a/);
  assert.match(rfc, /\\n/);
  const hashed = issuerHistoryEntryHash(entry);
  assert.equal(hashed, crypto.createHash('sha256').update(legacy, 'utf8').digest('hex'));
  assert.notEqual(hashed, crypto.createHash('sha256').update(rfc, 'utf8').digest('hex'));
});

test('lone surrogates and non-finite numbers are rejected', () => {
  assert.throws(() => jcsRfc8785('\uDEAD'), /lone surrogate/);
  assert.throws(() => jcsRfc8785(Number.NaN), /Infinity or NaN/);
  assert.throws(() => jcsRfc8785(Number.POSITIVE_INFINITY), /Infinity or NaN/);
});
