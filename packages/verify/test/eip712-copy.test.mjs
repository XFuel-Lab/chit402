/**
 * The frozen cs2-core files are a byte copy of 62bddfe8.
 * The pin hashes LF bytes. Drop the copy when rebasing after #687 merges.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const HEAD = '62bddfe8cf6ac843956522f42a877591ec38bed9';

const PIN = Object.freeze({
  'eip712/domain.mjs': 'cab2b24de9d70ddb404ba7e7c382641816907b90910657201e9889dc78142112',
  'eip712/index.mjs': '35da67c280fd409a5262edef2e4a3919d03b68058e15336223bae33234fad97c',
  'eip712/key-hash.mjs': '801c0913ae0ad08720fa20e2cdd85fb564f04fa75a819406d743fff2b2ca45a6',
  'eip712/kinds.mjs': '189ce1716087dcb10f060877072f657c3f8347418aff60f774510d478860b9ba',
  'eip712/possession.mjs': '2d0ec851879b96a4df1238c75cf7f65aa9edbf09be4a9cb5ecc9706fd6d8523f',
  'eip712/registry.mjs': '616d9a0b12fb98b2e3151a84547606bfced928e10716d8d411e945dfcf14c945',
  'eip712/sigma-range.mjs': '0d12721c23148fa483317926c754410bc37a5a95ba35be025927c60d6d4b9df5',
  'eip712/time.mjs': '5c56ee98d41971601729b595ae2850ba9a1193163227067831be8b92a327d51b',
  'eip712/vectors/eip712.json': '6c521dad84d683302fe011f7e6ae5c412e38aa584c92adf58fbaa81c06e4e098',
  'eip712/vectors/pop.json': '8ff1a07f30f879a9e18597a6e9688461703622659b434460f9d6ef4fc094e8b7',
  'ecdsa/bytes.js': '1626523e9f3e878693c0ae7c203a8eb62620c974f199cff767c1419d53222692',
  'ecdsa/curves.js': 'e0bf67c3f1c80332276ff4d5acafb17eff3f8b529de2d68cff8bd2b1ef221932',
  'ecdsa/recover.js': '53960460d0155c31446e474196d9fd72590729530431c9bbcb50ec20c63d8b09',
  'key-status/status.mjs': '49c0d22ea6baf800b2c24205925a1f715b643ca02686960b433ca3a576b4355f',
});

function sha256(abs) {
  const bytes = readFileSync(abs).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return createHash('sha256').update(bytes).digest('hex');
}

test(`frozen cs2-core files match ${HEAD}`, () => {
  const source = fileURLToPath(new URL('../../cs2-core/', import.meta.url));
  const vendor = fileURLToPath(new URL('../vendor/cs2-core/', import.meta.url));
  assert.equal(Object.keys(PIN).length, 14);
  for (const [name, expected] of Object.entries(PIN)) {
    const hash = sha256(join(source, name));
    assert.equal(hash, expected, name);
    assert.equal(sha256(join(vendor, name)), hash, `vendor ${name}`);
  }
});
